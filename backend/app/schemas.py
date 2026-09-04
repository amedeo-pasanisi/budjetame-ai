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

from app.models import CategoryType, IntervalUnit, TransactionType, WalletType


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)


class GoogleSignInRequest(BaseModel):
    """The Google ID token (JWT) the frontend received from Google Identity
    Services (issue #81)."""

    id_token: str = Field(min_length=1)


class AuthConfigOut(BaseModel):
    """Public sign-in options for the auth screen: the Google client id, or
    empty when Google sign-in is not configured."""

    google_client_id: str


class ForgotPasswordRequest(BaseModel):
    """A request for a password-reset link (issue #83)."""

    email: EmailStr


class ResetPasswordRequest(BaseModel):
    """A password-reset submission: the token from the emailed link plus the
    new password."""

    token: str = Field(min_length=1)
    new_password: str = Field(min_length=8)


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
    least one editable field must be present. A `name` that collides with an
    existing same-Type Category is not applied: the endpoint answers 409 with
    a structured detail carrying the existing Category's id (`target_id`) and
    the count of Transactions on the renamed Category (`transaction_count`),
    the merge offer (ADR-0007). The merge itself is a separate confirmed call
    — POST /categories/{id}/merge."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str | None = Field(default=None, min_length=1, max_length=80)
    icon: str | None = Field(default=None, max_length=16)
    color: str | None = Field(default=None, pattern=_HEX_COLOR)

    @model_validator(mode="after")
    def _at_least_one_change(self) -> "CategoryUpdate":
        if self.name is None and self.icon is None and self.color is None:
            raise ValueError("at least one of name, icon, or color is required")
        return self


class CategoryMergeRequest(BaseModel):
    """The confirmed merge (ADR-0007): move the renamed Category's
    Transactions into the existing Category the rename collided with.
    `target_id` is the `target_id` the 409 conflict response carried; the
    target survives with its name, icon, and color."""

    model_config = ConfigDict(extra="forbid")

    target_id: int


class CategoryOut(BaseModel):
    """A Category as seen through the API."""

    id: int
    name: str
    type: CategoryType
    icon: str | None
    color: str
    created_at: datetime


_MAX_AMOUNT = Decimal("9999999999.99")  # matches the Numeric(12, 2) column

# Google place_ids run to 255 characters; the name is capped at the same
# generous bound (ADR-0005). The columns are unbounded TEXT — like
# `description`, the API enforces the length.
_MAX_PLACE_LENGTH = 255


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
    never carries a Category (spec decision #6). `place_name`/`place_id` are
    the optional Place reference, carried alongside the coordinates (ADR-0005).
    `recurring_cost_id` is the optional Recurring Cost link (issue #57):
    Expenses only — Income and Transfer reject it; the link pays the cost's
    oldest Unpaid Occurrence at link time, pinned on the row.
    `recurring_income_id` is the optional Recurring Income link (issue #61):
    Incomes only — Expense and Transfer reject it; the link pays the
    income's oldest Unpaid Occurrence at link time, pinned on the row. A
    Transaction is one type, so the two links can never coexist: at most one
    link per Transaction."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    type: Literal["expense", "income", "transfer"]
    amount: Decimal = Field(gt=0, le=_MAX_AMOUNT)
    date: str
    wallet_id: int | None = None
    source_wallet_id: int | None = None
    destination_wallet_id: int | None = None
    category_id: int | None = None
    recurring_cost_id: int | None = None
    recurring_income_id: int | None = None
    description: str | None = Field(default=None, max_length=500)
    latitude: Decimal | None = Field(default=None, ge=-90, le=90)
    longitude: Decimal | None = Field(default=None, ge=-180, le=180)
    place_name: str | None = Field(
        default=None, min_length=1, max_length=_MAX_PLACE_LENGTH
    )
    place_id: str | None = Field(
        default=None, min_length=1, max_length=_MAX_PLACE_LENGTH
    )

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
            if self.recurring_cost_id is not None:
                raise ValueError("Transfers never carry a Recurring Cost link")
            if self.recurring_income_id is not None:
                raise ValueError("Transfers never carry a Recurring Income link")
            if self.source_wallet_id is None or self.destination_wallet_id is None:
                raise ValueError("Transfers need source and destination Wallets")
        else:
            if self.wallet_id is None:
                raise ValueError("wallet_id is required for Expense and Income")
            if self.source_wallet_id is not None or self.destination_wallet_id is not None:
                raise ValueError(
                    "source and destination Wallets are only for Transfers"
                )
            if self.type == "income" and self.recurring_cost_id is not None:
                raise ValueError("Only Expenses can be linked to a Recurring Cost")
            if self.type == "expense" and self.recurring_income_id is not None:
                raise ValueError("Only Incomes can be linked to a Recurring Income")
        return self


class TransactionUpdate(BaseModel):
    """Edit an Expense, Income, or Transfer. Type and Wallets cannot change; a
    field present in the payload is applied even when null (clearing it); a
    field absent is untouched. Transfers never carry a Category — the service
    rejects a `category_id` on them. A `place_name`/`place_id` present in the
    payload replaces the Place reference; null clears it (ADR-0005).
    `recurring_cost_id` follows the same contract (issue #57): present with a
    value, it links (or relinks) the Expense, paying the cost's oldest Unpaid
    Occurrence at that moment; present as null, it unlinks, freeing the
    Occurrence; absent, the stored pin is untouched — a date edit never
    reassigns it. The service rejects it on Income and Transfer.
    `recurring_income_id` mirrors it (issue #61): the same contract on
    Incomes only — the service rejects it on Expense and Transfer."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    amount: Decimal | None = Field(default=None, gt=0, le=_MAX_AMOUNT)
    date: str | None = None
    category_id: int | None = None
    recurring_cost_id: int | None = None
    recurring_income_id: int | None = None
    description: str | None = Field(default=None, max_length=500)
    latitude: Decimal | None = Field(default=None, ge=-90, le=90)
    longitude: Decimal | None = Field(default=None, ge=-180, le=180)
    place_name: str | None = Field(
        default=None, min_length=1, max_length=_MAX_PLACE_LENGTH
    )
    place_id: str | None = Field(
        default=None, min_length=1, max_length=_MAX_PLACE_LENGTH
    )

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


class CategoryExpense(BaseModel):
    """One slice of the Dashboard's category pies (T11): a Category's
    Expenses or Incomes in the reference month. `category_id` is null for
    the "Uncategorized" slice — Transactions whose Category was deleted
    (spec decision #10) — and then `color` is null too: the frontend renders
    a neutral color for it. The slices always sum to the month's total for
    the pie's side."""

    category_id: int | None
    name: str
    icon: str | None
    color: str | None
    amount: Decimal

    @field_validator("amount")
    @classmethod
    def _amount_in_euros(cls, value: Decimal) -> Decimal:
        return value.quantize(Decimal("0.01"))


class DashboardSummary(BaseModel):
    """The Dashboard overview: Net Worth — the algebraic sum of all
    Wallet balances, Contact and frozen (always €0) Wallets included — and the
    reference month's (default: the current Europe/Rome month) Income and
    Expense totals. Opening Balance Transactions never count toward the
    statistics; Transfers are excluded by construction. `expenses_by_category`
    is the expense pie and `incomes_by_category` the income pie for the same
    month (T11) — the frontend toggles between them."""

    net_worth: Decimal
    month: str
    income: Decimal
    expenses: Decimal
    expenses_by_category: list[CategoryExpense]
    incomes_by_category: list[CategoryExpense]

    @field_validator("net_worth", "income", "expenses")
    @classmethod
    def _euros(cls, value: Decimal) -> Decimal:
        return value.quantize(Decimal("0.01"))


class MonthBucket(BaseModel):
    """One bucket of a Dashboard trend (T12): a Europe/Rome month and the
    total Expenses (`kind` expense) or Incomes (`kind` income) recorded in
    it."""

    month: str
    amount: Decimal

    @field_validator("amount")
    @classmethod
    def _amount_in_euros(cls, value: Decimal) -> Decimal:
        return value.quantize(Decimal("0.01"))


class Trend(BaseModel):
    """A monthly trend over an inclusive month range (T12): one bucket per
    month, oldest first, zero-filled for months with no Transactions of the
    trend's kind, bucketed in Europe/Rome server-side (US28). `expense-trend`
    serves Expenses and `income-trend` Incomes — same shape, the frontend
    toggles between them."""

    from_month: str
    to_month: str
    months: list[MonthBucket]


class BudgetView(BaseModel):
    """The Dashboard's Budget card (issue #65): the current Europe/Rome
    month's frame — no month parameter, the Budget is current-month-only by
    product decision (the summary endpoint stays month-parameterized and
    untouched). `monthly_spendable` is the Recurring Income Occurrences due
    in the month minus the Recurring Cost Occurrences due in it, counted by
    due date whether paid or not; `daily_allowance` divides it by the days
    of the month, floored to the cent, and floors at 0 when the month is
    negative (ADR-0012); `spendable_today` is the allowance accrued from
    the 1st through today minus the Discretionary Expenses dated in that
    span — sent raw, possibly negative, the card renders it as 0 until
    future accruals repay it (issue #63, story 12)."""

    month: str
    monthly_spendable: Decimal
    daily_allowance: Decimal
    spendable_today: Decimal

    @field_validator("monthly_spendable", "daily_allowance", "spendable_today")
    @classmethod
    def _euros(cls, value: Decimal) -> Decimal:
        return value.quantize(Decimal("0.01"))


class ImportRow(BaseModel):
    """One row of an import preview (T13): the extracted template fields plus
    the pipeline's verdict. `status` is "ok" (ready to insert), "error" (a
    parse or rule failure, detailed in `error`), or "duplicate" (a row already
    in the database, keyed per ADR-0006); `row` is the file's line number (the
    header is line 1). Fields that failed to parse are null."""

    row: int
    status: Literal["ok", "error", "duplicate"] = "ok"
    type: str | None = None
    date: str | None = None
    amount: Decimal | None = None
    wallet: str | None = None
    source_wallet: str | None = None
    destination_wallet: str | None = None
    category: str | None = None
    description: str | None = None
    latitude: str | None = None
    longitude: str | None = None
    error: str | None = None

    @field_validator("amount")
    @classmethod
    def _amount_in_euros(cls, value: Decimal | None) -> Decimal | None:
        if value is None:
            return None
        return value.quantize(Decimal("0.01"))


class ImportPreview(BaseModel):
    """The validated extract of an uploaded file (T13): every row with its
    verdict and the counts. Nothing is inserted by this step."""

    rows: list[ImportRow]
    ok_count: int
    error_count: int
    duplicate_count: int


class ImportRowInput(BaseModel):
    """A row the user confirmed for insertion (T13). The fields mirror the
    template's columns as extracted — names, not ids: the backend re-resolves
    names and re-runs every rule before anything is written."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    row: int | None = Field(default=None, ge=1)
    type: Literal["expense", "income", "transfer"]
    amount: Decimal = Field(gt=0, le=_MAX_AMOUNT)
    date: str
    wallet: str | None = None
    source_wallet: str | None = None
    destination_wallet: str | None = None
    category: str | None = None
    description: str | None = Field(default=None, max_length=500)
    latitude: str | None = None
    longitude: str | None = None

    @field_validator("amount")
    @classmethod
    def _amount_in_euros(cls, value: Decimal) -> Decimal:
        """The file's amounts are euros: normalize to cents so duplicate keys
        and the Numeric(12, 2) column agree ("12.501" lands as "12.50")."""
        return value.quantize(Decimal("0.01"))

    @field_validator("date")
    @classmethod
    def _date_is_a_rome_day(cls, value: str) -> str:
        return _valid_rome_day(value)

    @field_validator("latitude")
    @classmethod
    def _latitude_in_range(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not -90 <= Decimal(value) <= 90:
            raise ValueError("latitude must be between -90 and 90")
        return value

    @field_validator("longitude")
    @classmethod
    def _longitude_in_range(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not -180 <= Decimal(value) <= 180:
            raise ValueError("longitude must be between -180 and 180")
        return value

    @model_validator(mode="after")
    def _location_is_a_pair(self) -> "ImportRowInput":
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("latitude and longitude must be set together")
        return self


class ImportConfirmRequest(BaseModel):
    """The rows the user confirmed (T13): the subset of the preview they kept.
    The insert is transactional — any invalid row rejects the whole batch."""

    model_config = ConfigDict(extra="forbid")

    rows: list[ImportRowInput]


class ImportRowValidationRequest(BaseModel):
    """One edited Preview row to re-validate during Verification (issue #44):
    `row` carries the row's edited fields (names, not ids); `earlier_rows` the
    draft's rows that precede it in the file — the in-file Duplicate context
    (CONTEXT.md: a row matching an earlier row of the same file is a
    Duplicate), which the endpoint cannot see by itself."""

    model_config = ConfigDict(extra="forbid")

    row: ImportRowInput
    earlier_rows: list[ImportRowInput] = Field(default_factory=list)


class ImportRowValidation(BaseModel):
    """The fresh verdict for one edited row (issue #44). `status` speaks the
    Preview's vocabulary — "ok" (ready in the UI), "duplicate", or "error" —
    and `error` carries the message for an error row."""

    status: Literal["ok", "duplicate", "error"]
    error: str | None = None


class ImportBatchRevalidationRequest(BaseModel):
    """A batch Revalidation (issue #76): the draft's rows plus the target row
    numbers to re-validate, in one call. `rows` is the whole draft in file
    order, with the user's edits applied — the preceding rows are the in-file
    Duplicate context; `targets` names the rows (by their `row` number, the
    file's line number) whose verdicts are wanted."""

    model_config = ConfigDict(extra="forbid")

    rows: list[ImportRowInput]
    targets: list[int]


class ImportRowRevalidation(BaseModel):
    """The fresh verdict for one target row of a batch Revalidation (issue
    #76): `row` echoes the target's row number so the client can map each
    verdict back to its draft row; `status` and `error` speak the Preview's
    vocabulary, exactly like the single-row re-validation."""

    row: int
    status: Literal["ok", "duplicate", "error"]
    error: str | None = None


class TransactionOut(BaseModel):
    """A Transaction as seen through the API. `warning` is the Cash negative-
    Balance indicator (true only right after a write that made a Cash Wallet
    negative); `date` is the calendar day in Europe/Rome. Expense/Income fill
    `wallet_id`; a Transfer fills `source_wallet_id` and `destination_wallet_id`.
    `place_name`/`place_id` are the optional Place reference (ADR-0005).
    `recurring_cost_id` is the optional Recurring Cost link (issue #57);
    `recurring_income_id` is the optional Recurring Income link (issue #61);
    `occurrence_date` is the Occurrence (its own date) the link paid at link
    time — stored, never recomputed. All three are null when the Transaction
    carries no link."""

    id: int
    type: TransactionType
    amount: Decimal
    date: str
    wallet_id: int | None
    source_wallet_id: int | None
    destination_wallet_id: int | None
    category_id: int | None
    recurring_cost_id: int | None
    recurring_income_id: int | None
    occurrence_date: str | None
    description: str | None
    latitude: str | None
    longitude: str | None
    place_name: str | None
    place_id: str | None
    warning: bool
    created_at: datetime

    @field_validator("amount")
    @classmethod
    def _amount_in_euros(cls, value: Decimal) -> Decimal:
        return value.quantize(Decimal("0.01"))


class TransactionPage(BaseModel):
    """One page of the Transactions list (cursor paging): the page's rows,
    newest first, and the opaque `next_cursor` for the next page — null
    exactly when this is the last page (no further fetch will ever return
    rows). Clients hand `next_cursor` back verbatim; they never parse it."""

    items: list[TransactionOut]
    next_cursor: str | None


class RecurringOccurrenceUpdate(BaseModel):
    """The per-Occurrence skip write (ADR-0026): PUT the Occurrence's date
    with `skipped` true to excuse it (it never enters the Backlog, never
    counts toward Monthly Spendable, and a link can never pay it), false to
    restore it to Unpaid. Shared by Recurring Costs and their Incomes
    mirror (ADR-0011) — the shape has no side-specific field.
    """

    model_config = ConfigDict(extra="forbid")

    skipped: bool


class RecurringOccurrenceOut(BaseModel):
    """One row of the Occurrences section (ADR-0026): a non-Paid Occurrence
    of a Recurring Cost or Recurring Income — its own date (ADR-0024: an
    Occurrence's due date is its own date) and whether the user excused it
    (ADR-0016). Paid history lives in the ledger and never appears here: a
    link already covers it, so there is nothing to skip or un-skip. The
    read lists the rows newest first — the section's one order: the next
    incoming Unpaid one (the live row) on top, then every excused future
    row and the past rows (today first) down to the oldest. Shared by the
    Costs side and its Incomes mirror (ADR-0011).
    """

    date: str
    skipped: bool


class RecurringCostCreate(BaseModel):
    """Create a Recurring Cost (issue #56). `interval_value` + `interval_unit`
    are the repetition (every N days, weeks, months, or years); `start_date`
    is an optional Europe/Rome calendar day: left empty at creation it is
    set to the creation day, so every definition always carries one
    (ADR-0024).
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=80)
    amount: Decimal = Field(gt=0, le=_MAX_AMOUNT)
    interval_value: int = Field(ge=1)
    interval_unit: IntervalUnit
    start_date: str | None = None

    @field_validator("start_date")
    @classmethod
    def _start_date_is_a_rome_day(cls, value: str | None) -> str | None:
        return _valid_rome_day(value) if value is not None else None

    @field_validator("amount")
    @classmethod
    def _amount_in_euros(cls, value: Decimal) -> Decimal:
        return value.quantize(Decimal("0.01"))


class RecurringCostUpdate(BaseModel):
    """Edit a Recurring Cost (issue #56). Every field is editable — name,
    amount, interval, start date — and follows the TransactionUpdate
    contract: a field present in the payload is applied; a field absent is
    untouched. `start_date` is the one exception to the null-clears rule: an
    explicit null is rejected, because a definition always carries a start
    date (ADR-0024) — it can be changed, never unset.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str | None = Field(default=None, min_length=1, max_length=80)
    amount: Decimal | None = Field(default=None, gt=0, le=_MAX_AMOUNT)
    interval_value: int | None = Field(default=None, ge=1)
    interval_unit: IntervalUnit | None = None
    start_date: str | None = None

    @field_validator("start_date")
    @classmethod
    def _start_date_is_a_rome_day(cls, value: str | None) -> str | None:
        return _valid_rome_day(value) if value is not None else None

    @field_validator("amount")
    @classmethod
    def _amount_in_euros(cls, value: Decimal | None) -> Decimal | None:
        return value.quantize(Decimal("0.01")) if value is not None else None

    @model_validator(mode="after")
    def _at_least_one_change(self) -> "RecurringCostUpdate":
        if not self.model_fields_set:
            raise ValueError("at least one field is required")
        return self


class RecurringCostOut(BaseModel):
    """A Recurring Cost as seen through the API, with its derived state:
    `next_due_date` is the next Occurrence's own date (ADR-0024: its due
    date) on or after today in Europe/Rome (issue #56);
    `next_unpaid_occurrence_date` is the next Occurrence a new linked Expense
    would pay — the oldest Unpaid one's own date (issue #57), what the
    transaction form's picker shows. `backlog_count` is the Backlog (issue
    #58): Unpaid Occurrences whose due date is today or earlier in
    Europe/Rome — the "N unpaid" badge, derived on the fly from the stored
    pins and skips, never stored. Skip controls live per Occurrence (ADR-0026)
    on the Occurrences read, not on the definition. `start_date` is the
    stored start date — every definition carries one (ADR-0024)."""

    id: int
    name: str
    amount: Decimal
    interval_value: int
    interval_unit: IntervalUnit
    start_date: str
    next_due_date: str
    next_unpaid_occurrence_date: str
    backlog_count: int
    created_at: datetime

    @field_validator("amount")
    @classmethod
    def _amount_in_euros(cls, value: Decimal) -> Decimal:
        return value.quantize(Decimal("0.01"))


class RecurringIncomeCreate(BaseModel):
    """Create a Recurring Income (issue #60), mirroring RecurringCostCreate
    (ADR-0011). `interval_value` + `interval_unit` are the repetition (every
    N days, weeks, months, or years); `start_date` is an optional Europe/Rome
    calendar day: left empty at creation it is set to the creation day, so
    every definition always carries one (ADR-0024).
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=80)
    amount: Decimal = Field(gt=0, le=_MAX_AMOUNT)
    interval_value: int = Field(ge=1)
    interval_unit: IntervalUnit
    start_date: str | None = None

    @field_validator("start_date")
    @classmethod
    def _start_date_is_a_rome_day(cls, value: str | None) -> str | None:
        return _valid_rome_day(value) if value is not None else None

    @field_validator("amount")
    @classmethod
    def _amount_in_euros(cls, value: Decimal) -> Decimal:
        return value.quantize(Decimal("0.01"))


class RecurringIncomeUpdate(BaseModel):
    """Edit a Recurring Income (issue #60), mirroring RecurringCostUpdate
    (ADR-0011). Every field is editable — name, amount, interval, start
    date — and follows the TransactionUpdate contract: a field present in
    the payload is applied; a field absent is untouched. `start_date` is the
    one exception to the null-clears rule: an explicit null is rejected,
    because a definition always carries a start date (ADR-0024) — it can be
    changed, never unset.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str | None = Field(default=None, min_length=1, max_length=80)
    amount: Decimal | None = Field(default=None, gt=0, le=_MAX_AMOUNT)
    interval_value: int | None = Field(default=None, ge=1)
    interval_unit: IntervalUnit | None = None
    start_date: str | None = None

    @field_validator("start_date")
    @classmethod
    def _start_date_is_a_rome_day(cls, value: str | None) -> str | None:
        return _valid_rome_day(value) if value is not None else None

    @field_validator("amount")
    @classmethod
    def _amount_in_euros(cls, value: Decimal | None) -> Decimal | None:
        return value.quantize(Decimal("0.01")) if value is not None else None

    @model_validator(mode="after")
    def _at_least_one_change(self) -> "RecurringIncomeUpdate":
        if not self.model_fields_set:
            raise ValueError("at least one field is required")
        return self


class RecurringIncomeOut(BaseModel):
    """A Recurring Income as seen through the API (issue #60), mirroring
    RecurringCostOut (ADR-0011). `next_due_date` is the next Occurrence's own
    date (ADR-0024: its due date) on or after today in Europe/Rome, derived
    on the fly from the stored definition — never
    stored. `next_unpaid_occurrence_date` is the next Occurrence a new linked
    Income would pay — the oldest Unpaid one's own date (issue #61), what the
    transaction form's picker shows. `backlog_count` is the Backlog (issue
    #62): Unpaid Occurrences whose due date is today or earlier in
    Europe/Rome — the "N unpaid" badge, derived on the fly from the stored
    pins and skips, never stored. Skip controls live per Occurrence (ADR-0026)
    on the Occurrences read, not on the definition. `start_date` is the
    stored start date — every definition carries one (ADR-0024)."""

    id: int
    name: str
    amount: Decimal
    interval_value: int
    interval_unit: IntervalUnit
    start_date: str
    next_due_date: str
    next_unpaid_occurrence_date: str
    backlog_count: int
    created_at: datetime

    @field_validator("amount")
    @classmethod
    def _amount_in_euros(cls, value: Decimal) -> Decimal:
        return value.quantize(Decimal("0.01"))


class TransactionDeleteOut(BaseModel):
    """The result of a Transaction delete (US10/ID8): `warning` is the Cash
    negative-Balance indicator, true exactly when the delete left a Cash
    Wallet negative. Reads never carry the indicator — it belongs to writes."""

    warning: bool

