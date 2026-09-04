import enum
from datetime import date, datetime

# The Transaction class has a column named `date`; the Occurrence pin's
# annotation uses this alias so the class body doesn't shadow the import.
OccurrenceDate = date
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class WalletType(str, enum.Enum):
    """The four kinds of money-holder in the system."""

    CHECKING = "checking"
    CREDIT_CARD = "credit_card"
    CASH = "cash"
    CONTACT = "contact"


class TransactionType(str, enum.Enum):
    """The discriminator of the single Transaction entity."""

    EXPENSE = "expense"
    INCOME = "income"
    OPENING_BALANCE = "opening_balance"
    TRANSFER = "transfer"


class CategoryType(str, enum.Enum):
    """A Category groups Transactions of one type only."""

    EXPENSE = "expense"
    INCOME = "income"


class IntervalUnit(str, enum.Enum):
    """The unit of a Recurring definition's interval (every N units) —
    shared by Recurring Costs and Recurring Incomes (ADR-0011)."""

    DAYS = "days"
    WEEKS = "weeks"
    MONTHS = "months"
    YEARS = "years"


class Account(Base):
    """A person's login identity and personal data space (ADR-0020): created
    by email+password registration or by a first Google sign-in (issue #81,
    nullable password_hash). Every other table scopes to it."""

    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class PasswordResetToken(Base):
    """One issued password-reset link (issue #83): only the sha256 of the raw
    token is stored, expiry is enforced at use, and consuming the token
    deletes the row — single-use by construction."""

    __tablename__ = "password_reset_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Wallet(Base):
    """A money-holder of one of four types. Its balance is never stored (ADR-0001)."""

    __tablename__ = "wallets"
    __table_args__ = (
        # Names are unique per Account, case-insensitively.
        Index(
            "uq_wallets_account_name_lower",
            "account_id",
            text("lower(name)"),
            unique=True,
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(80))
    type: Mapped[str] = mapped_column(String(20))
    # A frozen (deleted) Wallet is hidden from the UI but stays in the database;
    # every write against it or its Transactions is rejected (ADR-0002).
    frozen: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Transaction(Base):
    """A dated money movement on a Wallet, discriminated by `type`.

    Balances are the sum of these rows (ADR-0001); the table is extended in later
    tickets (expense/income, transfers, location).
    """

    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    # Expense/Income/Opening Balance reference a single Wallet; a Transfer
    # references Source and Destination Wallets instead (spec decision #6).
    wallet_id: Mapped[int | None] = mapped_column(
        ForeignKey("wallets.id", ondelete="CASCADE"), index=True
    )
    source_wallet_id: Mapped[int | None] = mapped_column(
        ForeignKey("wallets.id", ondelete="CASCADE"), index=True
    )
    destination_wallet_id: Mapped[int | None] = mapped_column(
        ForeignKey("wallets.id", ondelete="CASCADE"), index=True
    )
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), index=True
    )
    type: Mapped[str] = mapped_column(String(20))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    description: Mapped[str | None] = mapped_column(Text)
    latitude: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    longitude: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    # An optional Place reference (ADR-0005): the name from a name-search pick
    # plus the provider's opaque reference id (e.g. a Google place_id). Written
    # and cleared together; never without coordinates (frontend invariant).
    place_name: Mapped[str | None] = mapped_column(Text)
    place_id: Mapped[str | None] = mapped_column(Text)
    # The optional Recurring Cost link (issue #57, ADR-0010): an Expense may
    # pin one Recurring Cost, paying exactly one Occurrence — the oldest
    # Unpaid one at link time. `occurrence_date` is the paid Occurrence's own
    # date, stored and never recomputed: later edits to the Transaction's
    # date don't reassign it, and editing the cost's definition leaves
    # already-Paid Occurrences as they were. Unlinking or deleting the
    # Expense nulls both columns (freeing the Occurrence); deleting the
    # Recurring Cost severs the link via ON DELETE SET NULL, the Expense
    # surviving as an ordinary one. Income and Transfer never carry a link.
    recurring_cost_id: Mapped[int | None] = mapped_column(
        ForeignKey("recurring_costs.id", ondelete="SET NULL"), index=True
    )
    # The pin of the paid Occurrence (issue #57): the occurrence's own date,
    # stored at link time and never recomputed. Uses the OccurrenceDate
    # alias: the column named `date` shadows the import in this class body.
    occurrence_date: Mapped[OccurrenceDate | None] = mapped_column(Date)
    # The optional Recurring Income link (issue #61, ADR-0010/0011): the
    # mirror of the Recurring Cost link above — an Income may pin one
    # Recurring Income, paying exactly one Occurrence (the oldest Unpaid one
    # at link time) via the same shared `occurrence_date` pin. The same
    # invariants hold: the pin is stored, never recomputed; unlinking or
    # deleting the Income nulls both columns (freeing the Occurrence);
    # deleting the Recurring Income severs the link via ON DELETE SET NULL.
    # A Transaction is one type, so the two links never coexist: Expenses
    # carry only recurring_cost_id, Incomes only recurring_income_id.
    recurring_income_id: Mapped[int | None] = mapped_column(
        ForeignKey("recurring_incomes.id", ondelete="SET NULL"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class RecurringSkip(Base):
    """One skipped Occurrence of a Recurring Cost or Recurring Income
    (ADR-0016): the user marked the Occurrence as not applying, so it never
    enters the Backlog, never counts toward Monthly Spendable, and a link
    can never pay it — un-skipping comes first. `occurrence_date` is the
    skipped Occurrence's own date at skip time; its effective period under
    the definition's current interval unit — the date for day/week
    intervals, (year, month) for months, the year for years
    (app.recurrence.period_of) — is what travels with the Occurrence when
    the definition is edited: a skipped month becomes its year when the
    interval turns yearly, a skipped year becomes its month when it turns
    monthly, and a period holding no Occurrence lies dormant. Exactly one
    of the two definition FKs is set (the CHECK enforces it, mirroring the
    Transaction link columns); deleting a definition cascades its skips
    away (ON DELETE CASCADE). Un-skipping deletes the row.
    """

    __tablename__ = "recurring_skips"
    __table_args__ = (
        CheckConstraint(
            "num_nonnulls(recurring_cost_id, recurring_income_id) = 1",
            name="ck_recurring_skips_one_definition",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    recurring_cost_id: Mapped[int | None] = mapped_column(
        ForeignKey("recurring_costs.id", ondelete="CASCADE"), index=True
    )
    recurring_income_id: Mapped[int | None] = mapped_column(
        ForeignKey("recurring_incomes.id", ondelete="CASCADE"), index=True
    )
    occurrence_date: Mapped[date] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Category(Base):
    """A user-defined label grouping Transactions of one type.

    Names are unique per (Account, Type), case-insensitively: an expense "Food"
    and an income "Food" can coexist. Deleting a Category nulls the Category on
    its Transactions (they become "Uncategorized"); Transactions are never deleted.
    """

    __tablename__ = "categories"
    __table_args__ = (
        Index(
            "uq_categories_account_name_type_lower",
            "account_id",
            "type",
            text("lower(name)"),
            unique=True,
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(80))
    type: Mapped[str] = mapped_column(String(20))
    icon: Mapped[str | None] = mapped_column(String(16))
    color: Mapped[str] = mapped_column(String(7))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class RecurringCost(Base):
    """A definition of a cost expected to repeat at a fixed interval (ADR-0010).

    Occurrences are derived, never stored: start date + k×interval, clamped
    for short months (app.recurrence). An Occurrence's due date is its own
    date — the due-date override is gone (ADR-0024). Every definition
    carries a start date: left empty at creation it is set to the creation
    day. Deleting a Recurring Cost is a hard delete; linked Expenses (issue
    #57) survive as ordinary Expenses via ON DELETE SET NULL.
    """

    __tablename__ = "recurring_costs"
    __table_args__ = (
        # Names are unique per Account, case-insensitively.
        Index(
            "uq_recurring_costs_account_name_lower",
            "account_id",
            text("lower(name)"),
            unique=True,
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(80))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    # The interval: every N days, weeks, months, or years.
    interval_value: Mapped[int] = mapped_column(Integer)
    interval_unit: Mapped[str] = mapped_column(String(10))
    # The first-Occurrence day (Europe/Rome calendar day). Every definition
    # always carries one: left empty at creation it is set to the creation
    # day (ADR-0024); it can be changed, never unset. An Occurrence's due
    # date is its own date — the due-date override is gone.
    start_date: Mapped[date] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class RecurringIncome(Base):
    """A definition of an income expected to repeat at a fixed interval
    (ADR-0011).

    The mirror of RecurringCost, deliberately not a generalization: the same
    field set and the same derived Occurrences, sharing the pure recurrence
    module (app.recurrence) unchanged. Deleting a Recurring Income is a hard
    delete; linked Incomes (issue #61) survive as ordinary Incomes: the link
    FK is ON DELETE SET NULL, mirroring the Recurring Cost sever (issue #57).
    """

    __tablename__ = "recurring_incomes"
    __table_args__ = (
        # Names are unique per Account, case-insensitively.
        Index(
            "uq_recurring_incomes_account_name_lower",
            "account_id",
            text("lower(name)"),
            unique=True,
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(80))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    # The interval: every N days, weeks, months, or years.
    interval_value: Mapped[int] = mapped_column(Integer)
    interval_unit: Mapped[str] = mapped_column(String(10))
    # The first-Occurrence day (Europe/Rome calendar day). Every definition
    # always carries one: left empty at creation it is set to the creation
    # day (ADR-0024); it can be changed, never unset. An Occurrence's due
    # date is its own date — the due-date override is gone.
    start_date: Mapped[date] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
