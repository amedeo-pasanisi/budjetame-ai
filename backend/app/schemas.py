from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.models import WalletType


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class AccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str


class WalletCreate(BaseModel):
    """Create a Wallet. A nonzero opening balance (>= EUR 0) seeds an Opening
    Balance Transaction; EUR 0 (the default) records none."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=80)
    type: WalletType
    opening_balance: Decimal = Field(default=Decimal("0.00"), ge=0)


class WalletUpdate(BaseModel):
    """Edit a Wallet. Only the name is editable; the type cannot change."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=80)


class WalletOut(BaseModel):
    """A Wallet as seen through the API, with its derived balance (ADR-0001)."""

    id: int
    name: str
    type: WalletType
    balance: Decimal
    created_at: datetime

    @field_validator("balance")
    @classmethod
    def _balance_in_euros(cls, value: Decimal) -> Decimal:
        return value.quantize(Decimal("0.01"))

