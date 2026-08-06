import enum
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Index, Numeric, String, func, text
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

    OPENING_BALANCE = "opening_balance"


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
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Transaction(Base):
    """A dated money movement on a Wallet, discriminated by `type`.

    Balances are the sum of these rows (ADR-0001); the table is extended in later
    tickets (expense/income, transfers, category, location).
    """

    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    wallet_id: Mapped[int] = mapped_column(
        ForeignKey("wallets.id", ondelete="CASCADE"), index=True
    )
    type: Mapped[str] = mapped_column(String(20))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
