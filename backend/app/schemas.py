from datetime import datetime
from decimal import Decimal

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
    model_validator,
)

from app.models import CategoryType, WalletType


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


_HEX_COLOR = r"^#[0-9a-fA-F]{6}$"


class CategoryCreate(BaseModel):
    """Create a Category. `icon` is an optional short marker (e.g. an emoji);
    `color` is a hex string used to render the Category."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=80)
    type: CategoryType
    icon: str | None = Field(default=None, max_length=16)
    color: str = Field(pattern=_HEX_COLOR)


class CategoryUpdate(BaseModel):
    """Edit a Category: name, icon, or color. The type cannot change, and at
    least one editable field must be present."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str | None = Field(default=None, min_length=1, max_length=80)
    icon: str | None = Field(default=None, max_length=16)
    color: str | None = Field(default=None, pattern=_HEX_COLOR)

    @model_validator(mode="after")
    def _at_least_one_change(self) -> "CategoryUpdate":
        if self.name is None and self.icon is None and self.color is None:
            raise ValueError("at least one of name, icon, or color is required")
        return self


class CategoryOut(BaseModel):
    """A Category as seen through the API."""

    id: int
    name: str
    type: CategoryType
    icon: str | None
    color: str
    created_at: datetime

