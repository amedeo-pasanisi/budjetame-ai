from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import bearer_scheme, get_session
from app.models import Account
from app.schemas import AccountOut, LoginRequest, TokenResponse
from app.security import create_access_token, decode_access_token, verify_password

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
    if account is None or not verify_password(payload.password, account.password_hash):
        raise _INVALID_CREDENTIALS
    return TokenResponse(access_token=create_access_token(account.id))


@router.get("/me", response_model=AccountOut)
def me(account: Account = Depends(get_current_account)) -> Account:
    return account
