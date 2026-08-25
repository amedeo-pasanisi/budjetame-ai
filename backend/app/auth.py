from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import bearer_scheme, get_google_verifier, get_mailer, get_session
from app.google_auth import GoogleVerifier
from app.mailer import EmailMessage, Mailer
from app.models import Account, PasswordResetToken
from app.schemas import (
    AccountOut,
    AuthConfigOut,
    ForgotPasswordRequest,
    GoogleSignInRequest,
    LoginRequest,
    RegisterRequest,
    ResetPasswordRequest,
    TokenResponse,
)
from app.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    hash_reset_token,
    new_reset_token,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])

_INVALID_CREDENTIALS = HTTPException(
    status_code=401,
    detail="Incorrect email or password",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_current_account(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    session: Session = Depends(get_session),
) -> Account:
    """The Account behind a valid bearer token, or 401."""
    if credentials is None:
        raise _INVALID_CREDENTIALS
    account_id = decode_access_token(credentials.credentials)
    if account_id is None:
        raise _INVALID_CREDENTIALS
    account = session.get(Account, account_id)
    if account is None:
        raise _INVALID_CREDENTIALS
    return account


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, session: Session = Depends(get_session)) -> TokenResponse:
    account = session.scalar(select(Account).where(Account.email == payload.email.lower()))
    # A Google-provisioned Account (issue #81) has no password hash: any
    # password fails for it, exactly like an unknown email.
    if (
        account is None
        or account.password_hash is None
        or not verify_password(payload.password, account.password_hash)
    ):
        raise _INVALID_CREDENTIALS
    return TokenResponse(access_token=create_access_token(account.id))


@router.post("/register", response_model=TokenResponse)
def register(payload: RegisterRequest, session: Session = Depends(get_session)) -> TokenResponse:
    """Create an Account and sign it in (ADR-0020): email is the identity key,
    stored lowercased; a duplicate email is a 409, not a second Account."""
    email = payload.email.lower()
    if session.scalar(select(Account).where(Account.email == email)) is not None:
        raise HTTPException(status_code=409, detail="An Account with this email already exists")
    account = Account(email=email, password_hash=hash_password(payload.password))
    session.add(account)
    session.commit()
    return TokenResponse(access_token=create_access_token(account.id))


@router.get("/config", response_model=AuthConfigOut)
def auth_config(request: Request) -> AuthConfigOut:
    """Public sign-in options for the auth screen (issue #81): the Google
    client id is public by design (it ships to the browser); empty means the
    frontend hides the Google button."""
    return AuthConfigOut(google_client_id=request.app.state.google_client_id)


@router.post("/google", response_model=TokenResponse)
def google_sign_in(
    payload: GoogleSignInRequest,
    session: Session = Depends(get_session),
    verifier: GoogleVerifier = Depends(get_google_verifier),
) -> TokenResponse:
    """Sign in with Google (issue #81): the verifier checks the ID token's
    signature, issuer, and audience; the verified email is the identity key
    (ADR-0021) — an unknown email auto-provisions an Account (ADR-0020), a
    known one enters it, and an email Google has not verified is rejected."""
    identity = verifier.verify(payload.id_token)
    if identity is None or not identity.email_verified:
        raise HTTPException(status_code=401, detail="Invalid Google sign-in")
    email = identity.email.lower()
    account = session.scalar(select(Account).where(Account.email == email))
    if account is None:
        account = Account(email=email, password_hash=None)
        session.add(account)
        session.commit()
    return TokenResponse(access_token=create_access_token(account.id))


@router.post("/forgot-password", status_code=204)
def forgot_password(
    payload: ForgotPasswordRequest,
    request: Request,
    session: Session = Depends(get_session),
    mailer: Mailer = Depends(get_mailer),
) -> Response:
    """Request a password-reset link (issue #83). Always succeeds — an
    unknown email must be indistinguishable from a known one, so the endpoint
    cannot be used to probe which emails have Accounts."""
    account = session.scalar(
        select(Account).where(Account.email == payload.email.lower())
    )
    if account is not None:
        token = new_reset_token()
        expires_at = datetime.now(timezone.utc) + timedelta(
            minutes=request.app.state.password_reset_expire_minutes
        )
        session.add(
            PasswordResetToken(
                account_id=account.id,
                token_hash=hash_reset_token(token),
                expires_at=expires_at,
            )
        )
        session.commit()
        link = f"{request.app.state.public_base_url}/reset-password?token={token}"
        mailer.send(
            EmailMessage(
                to=account.email,
                subject="Reset your Budjetame password",
                body=(
                    "Someone asked to reset your Budjetame password. "
                    f"Click this link to choose a new one:\n\n{link}\n\n"
                    "The link works once and expires after "
                    f"{request.app.state.password_reset_expire_minutes} minutes.\n"
                    "If you didn't ask for this, ignore the email."
                ),
            )
        )
    return Response(status_code=204)


@router.post("/reset-password", status_code=204)
def reset_password(
    payload: ResetPasswordRequest, session: Session = Depends(get_session)
) -> Response:
    """Set a new password with a reset token (issue #83). The token is
    consumed before the password is applied — a used, expired, or forged
    token is a 400 with a friendly detail."""
    row = session.scalar(
        select(PasswordResetToken).where(
            PasswordResetToken.token_hash == hash_reset_token(payload.token)
        )
    )
    if row is None or row.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(
            status_code=400, detail="This reset link is invalid or has expired"
        )
    account = session.get(Account, row.account_id)
    if account is None:
        raise HTTPException(
            status_code=400, detail="This reset link is invalid or has expired"
        )
    session.delete(row)  # single-use: consumed before applying
    account.password_hash = hash_password(payload.new_password)
    session.commit()
    return Response(status_code=204)


@router.delete("/me", status_code=204)
def delete_me(
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> Response:
    """Delete the signed-in Account and everything scoped to it (issue #84):
    the schema cascades every owned row (ondelete=CASCADE), and the JWT dies
    with the Account — a deleted Account's token and credentials stop working."""
    session.delete(account)
    session.commit()
    return Response(status_code=204)


@router.get("/me", response_model=AccountOut)
def me(account: Account = Depends(get_current_account)) -> Account:
    return account
