from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
    model_validator,
)

from app.models import CategoryType, TransactionType, WalletType


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
    """A Wallet as seen through the API, with its derived balance (ADR-0001)
    and its freeze state (ADR-0002). The default wallet list hides frozen
    Wallets; `?include_frozen=true` returns them with `frozen: true` so the
    history screen can reach their Transactions."""

    id: int
    name: str
    type: WalletType
    balance: Decimal
    frozen: bool
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


_MAX_AMOUNT = Decimal("9999999999.99")  # matches the Numeric(12, 2) column


def fmt_coord(value: Decimal | None) -> str | None:
    """Canonical shortest form of a coordinate ("41.9028", not "41.902800")."""
    if value is None:
        return None
    return f"{value:.6f}".rstrip("0").rstrip(".")


def _valid_rome_day(value: str) -> str:
    """Accept only a real YYYY-MM-DD calendar day (in Europe/Rome)."""
    datetime.strptime(value, "%Y-%m-%d")  # ValueError -> 422
    return value


class TransactionCreate(BaseModel):
    """Record an Expense, Income, or Transfer. Date is the calendar day in
    Europe/Rome ("YYYY-MM-DD"); the backend stores it as a UTC timestamp.
    Expense/Income use `wallet_id` (plus an optional matching `category_id`); a
    Transfer uses `source_wallet_id` and `destination_wallet_id` instead and
    never carries a Category (spec decision #6)."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    type: Literal["expense", "income", "transfer"]
    amount: Decimal = Field(gt=0, le=_MAX_AMOUNT)
    date: str
    wallet_id: int | None = None
    source_wallet_id: int | None = None
    destination_wallet_id: int | None = None
    category_id: int | None = None
    description: str | None = Field(default=None, max_length=500)
    latitude: Decimal | None = Field(default=None, ge=-90, le=90)
    longitude: Decimal | None = Field(default=None, ge=-180, le=180)

    @field_validator("date")
    @classmethod
    def _date_is_a_rome_day(cls, value: str) -> str:
        return _valid_rome_day(value)

    @model_validator(mode="after")
    def _location_is_a_pair(self) -> "TransactionCreate":
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("latitude and longitude must be set together")
        return self

    @model_validator(mode="after")
    def _fields_match_the_type(self) -> "TransactionCreate":
        if self.type == "transfer":
            if self.wallet_id is not None or self.category_id is not None:
                raise ValueError(
                    "Transfers use source and destination Wallets and never "
                    "carry a Category"
                )
            if self.source_wallet_id is None or self.destination_wallet_id is None:
                raise ValueError("Transfers need source and destination Wallets")
        else:
            if self.wallet_id is None:
                raise ValueError("wallet_id is required for Expense and Income")
            if self.source_wallet_id is not None or self.destination_wallet_id is not None:
                raise ValueError(
                    "source and destination Wallets are only for Transfers"
                )
        return self


class TransactionUpdate(BaseModel):
    """Edit an Expense, Income, or Transfer. Type and Wallets cannot change; a
    field present in the payload is applied even when null (clearing it); a
    field absent is untouched. Transfers never carry a Category — the service
    rejects a `category_id` on them."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    amount: Decimal | None = Field(default=None, gt=0, le=_MAX_AMOUNT)
    date: str | None = None
    category_id: int | None = None
    description: str | None = Field(default=None, max_length=500)
    latitude: Decimal | None = Field(default=None, ge=-90, le=90)
    longitude: Decimal | None = Field(default=None, ge=-180, le=180)

    @field_validator("date")
    @classmethod
    def _date_is_a_rome_day(cls, value: str | None) -> str | None:
        return _valid_rome_day(value) if value is not None else None

    @model_validator(mode="after")
    def _at_least_one_change(self) -> "TransactionUpdate":
        if not self.model_fields_set:
            raise ValueError("at least one field is required")
        return self

    @model_validator(mode="after")
    def _location_is_a_pair(self) -> "TransactionUpdate":
        if "latitude" in self.model_fields_set or "longitude" in self.model_fields_set:
            if (self.latitude is None) != (self.longitude is None):
                raise ValueError("latitude and longitude must be set together")
        return self


class DashboardSummary(BaseModel):
    """The Dashboard overview (T10): Net Worth — the algebraic sum of all
    Wallet balances, Contact and frozen (always €0) Wallets included — and the
    current Europe/Rome month's Income and Expense totals. Opening Balance
    Transactions never count toward the statistics; Transfers are excluded by
    construction."""

    net_worth: Decimal
    month: str
    income: Decimal
    expenses: Decimal

    @field_validator("net_worth", "income", "expenses")
    @classmethod
    def _euros(cls, value: Decimal) -> Decimal:
        return value.quantize(Decimal("0.01"))


class TransactionOut(BaseModel):
    """A Transaction as seen through the API. `warning` is the Cash negative-
    Balance indicator (true only right after a write that made a Cash Wallet
    negative); `date` is the calendar day in Europe/Rome. Expense/Income fill
    `wallet_id`; a Transfer fills `source_wallet_id` and `destination_wallet_id`."""

    id: int
    type: TransactionType
    amount: Decimal
    date: str
    wallet_id: int | None
    source_wallet_id: int | None
    destination_wallet_id: int | None
    category_id: int | None
    description: str | None
    latitude: str | None
    longitude: str | None
    warning: bool
    created_at: datetime

    @field_validator("amount")
    @classmethod
    def _amount_in_euros(cls, value: Decimal) -> Decimal:
        return value.quantize(Decimal("0.01"))

