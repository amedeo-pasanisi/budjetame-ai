import enum
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
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
    """The unit of a Recurring Cost's interval (every N units)."""

    DAYS = "days"
    WEEKS = "weeks"
    MONTHS = "months"
    YEARS = "years"


class Account(Base):
    """The single login identity, seeded at setup. There is no registration path."""

    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
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
    for short months (app.recurrence). The optional due-date override — a
    day-of-month for month intervals, a month+day for year intervals, never
    for day/week intervals — shifts each Occurrence's due date within its
    month/year. An unset start date defaults to the creation date. Deleting
    a Recurring Cost is a hard delete; linked Expenses (issue #57) survive as
    ordinary Expenses via ON DELETE SET NULL.
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
    # Wallets are never hard-deleted (ADR-0002), so the FK never fires;
    # CASCADE matches the Transaction convention.
    wallet_id: Mapped[int] = mapped_column(
        ForeignKey("wallets.id", ondelete="CASCADE"), index=True
    )
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), index=True
    )
    # The interval: every N days, weeks, months, or years.
    interval_value: Mapped[int] = mapped_column(Integer)
    interval_unit: Mapped[str] = mapped_column(String(10))
    # The user's chosen first-Occurrence day (Europe/Rome calendar day);
    # null means "the creation date".
    start_date: Mapped[date | None] = mapped_column(Date)
    # The optional due-date override (ADR-0010): due_day alone for month
    # intervals; due_day + due_month for year intervals; both null for
    # day/week intervals. The service enforces the per-unit combination.
    due_day: Mapped[int | None] = mapped_column(Integer)
    due_month: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
