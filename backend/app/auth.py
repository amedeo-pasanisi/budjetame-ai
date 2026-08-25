from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import bearer_scheme, get_google_verifier, get_session
from app.google_auth import GoogleVerifier
from app.models import Account
from app.schemas import (
    AccountOut,
    AuthConfigOut,
    GoogleSignInRequest,
    LoginRequest,
    RegisterRequest,
    TokenResponse,
)
from app.security import create_access_token, decode_access_token, hash_password, verify_password

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


@router.get("/me", response_model=AccountOut)
def me(account: Account = Depends(get_current_account)) -> Account:
    return account
