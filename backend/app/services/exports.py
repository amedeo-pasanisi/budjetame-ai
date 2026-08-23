"""Export pipeline (US 7.3): turn resolved Transactions into the import
template's .xlsx.

Mirrors the import service's split: this module's builder is pure (no
database access) — it formats an already-resolved ExportRow, whose names were
resolved against the Account by the route, exactly like `services.imports`
parses files without touching the database. The file is the fixed template
(one flat sheet; amounts always positive; columns date, type, amount, wallet,
source wallet, destination wallet, category, description, location), so an
Export round-trips through Import into a fresh Account once its Wallets and
Categories exist (ADR-0015). Opening Balance Transactions never reach the
builder: the template's type vocabulary has no value for them.
"""

from dataclasses import dataclass
from decimal import Decimal
from io import BytesIO

from openpyxl import Workbook

# The fixed template's columns (US 7.1 / US 7.3), in file order. The header
# matches what the import's normalized header map accepts ("source wallet"
# normalizes to source_wallet), so the file is byte-compatible both ways.
_HEADER = [
    "date",
    "type",
    "amount",
    "wallet",
    "source wallet",
    "destination wallet",
    "category",
    "description",
    "location",
]


@dataclass(frozen=True, slots=True)
class ExportRow:
    """One row of the file, already resolved to the Account's names: the
    Europe/Rome "YYYY-MM-DD" day, the template's type, a positive amount, the
    Wallet/Category names as the user sees them, and the coordinates the
    template's location column carries (a Place reference is never in the
    file — ADR-0015). A blank or missing description is written the same way
    (CONTEXT.md's blank-equals-missing rule)."""

    date: str
    type: str
    amount: Decimal
    wallet: str | None
    source_wallet: str | None
    destination_wallet: str | None
    category: str | None
    description: str | None
    latitude: Decimal | None
    longitude: Decimal | None


def _coord(value: Decimal | None) -> str:
    """The template's canonical coordinate form: shortest decimal, no trailing
    zeros — the same form the import parses back ("45.4642,9.19")."""
    if value is None:
        return ""
    return f"{value:.6f}".rstrip("0").rstrip(".")


def build_export_workbook(rows: list[ExportRow]) -> bytes:
    """The file: one flat sheet, header first, then one row per ExportRow,
    amounts written as two-decimal text ("12.50", never "12.5"), dates as
    "YYYY-MM-DD" text, location as "lat,lon" (or blank)."""
    workbook = Workbook()
    sheet = workbook.active
    assert sheet is not None  # a new Workbook always has one active sheet
    sheet.append(_HEADER)
    for row in rows:
        location = (
            f"{_coord(row.latitude)},{_coord(row.longitude)}"
            if row.latitude is not None and row.longitude is not None
            else ""
        )
        sheet.append(
            [
                row.date,
                row.type,
                f"{row.amount:.2f}",
                row.wallet or "",
                row.source_wallet or "",
                row.destination_wallet or "",
                row.category or "",
                row.description or "",
                location,
            ]
        )
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()
