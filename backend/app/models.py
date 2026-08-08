import enum
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Numeric, String, Text, func, text
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
