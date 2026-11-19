"""The Assistant turn (ADR-0035, issues #122/#128): the system prompt, the
four Draft tools and the tool loop, run on the server through the provider
seam (`app.assistant_seam`) with the tools bound to one Account.

What the model is given, each turn: today's date in Europe/Rome, the
Locale, and the Account's active Wallets, Categories and active Recurring
definitions as `id name type` lines in the system prompt — never a ledger
row, a balance or the Budget (ADR-0035: a misheard sentence or a hostile
name can at worst produce a Draft nobody approves). What it can do: list,
create, update and discard Draft Transactions (ADR-0036) — nothing else.

The conversation is stored nowhere: the client hands back the transcript
each turn and the Drafts the open conversation may change are derived from
it (the ids its earlier `create_draft_transaction` results carry, plus the
ones created this turn). Update and discard refuse any other id with a tool
error pointing at the Transactions tab.

Tool-input hygiene, learned from the prototype (#122): a model without
strict schemas sends ids as strings, "None" for null, "1,20" for an amount
and omits keys, so every input is normalised before validation; and a
validator that only says what is wrong sends the model into a junk-filling
cascade, so every contradiction message names the field to leave null. A
tool error goes back to the model as an error result and the loop goes on.

Bounds (ADR-0035, issue #129; `app.assistant_bounds`): the turns-per-hour
window is checked by `admit_turn` before the loop runs (the next turn is
`TurnLimitReached`, a 429); the tool-step cap asks the model for a final
answer with no tools; the seconds-per-turn budget is checked between model
calls — a tool round that ends past it yields the "gave up" reply instead
of another call, and an adapter whose request timed out raises the seam's
`AssistantProviderTimeout` for the same reply. A slow final answer is still
returned: it is complete. Time is read through the seam's `Clock`, so
tests spend the budget on a fake clock.

Provider failures reach the loop as the seam's typed errors and become one
honest reply in the Account's Locale, status 200, never a retry storm: a
rejected key (401) points at Assistant Settings and is never retried; a
busy provider (429/503) is waited out for the delay it announced and
retried once per turn while that fits the remaining budget, otherwise the
reply names the seconds to wait. A model that never calls a tool — none in
the transcript, none this turn — gets the "cannot drive the Assistant"
reply in place of its text, so a text-only model cannot pass for a working
one, and a made-up "done" is never shown. The server cannot tell that case
from a correct model answering a first sentence that names no money
movement, so the reply says what was observed (no tool used, no Draft)
and what to do if a money movement was named. Any other seam error stays
a 502.
"""

import json
import re
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import date as DateObj
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.assistant_bounds import AssistantBounds, TurnWindow
from app.assistant_providers import provider_spec
from app.assistant_seam import (
    AssistantKeyRejected,
    AssistantModel,
    AssistantModelFactory,
    AssistantProviderBusy,
    AssistantProviderTimeout,
    AssistantReply,
    Clock,
    Message,
    TextBlock,
    ToolCallBlock,
    ToolResultBlock,
    ToolSpec,
    whole_seconds,
)
from app.dates import ROME
from app.models import (
    Account,
    Category,
    DraftTransaction,
    RecurringCost,
    RecurringIncome,
    Wallet,
)
from app.services import draft_transactions as draft_service
from app.services.assistant_settings import assistant_key_for
from app.services.scoping import NotOwned

# What the server itself answers, keyed by the Account's Locale (CONTEXT.md:
# every client formats and speaks in the Locale; a server-written reply too).
_REPLIES: dict[str, dict[str, str]] = {
    "en": {
        "key_rejected": "The provider rejected the Assistant Key: check it in Assistant Settings.",
        "busy": "The provider is busy, try again in {seconds} s.",
        "gave_up": "The Assistant gave up on this turn: it took longer than {seconds} s.",
        "cannot_drive": (
            "No Draft was written: this model answered without using the Assistant's tools. "
            "If you named a money movement, this model cannot drive the Assistant: pick "
            "another one in Assistant Settings."
        ),
        "turn_limit": (
            "The Assistant's limit of {per_hour} turns per hour is reached, "
            "try again in {seconds} s."
        ),
    },
    "it": {
        "key_rejected": (
            "Il provider ha rifiutato la chiave dell'Assistente: controllala nelle "
            "Impostazioni dell'Assistente."
        ),
        "busy": "Il provider è occupato, riprova tra {seconds} s.",
        "gave_up": "L'Assistente ha rinunciato a questo turno: ha superato i {seconds} s.",
        "cannot_drive": (
            "Nessuna bozza scritta: questo modello ha risposto senza usare gli strumenti "
            "dell'Assistente. Se hai nominato un movimento di denaro, questo modello non può "
            "guidare l'Assistente: scegline un altro nelle Impostazioni dell'Assistente."
        ),
        "turn_limit": (
            "Il limite dell'Assistente di {per_hour} turni all'ora è stato raggiunto, "
            "riprova tra {seconds} s."
        ),
    },
}


def reply_text(locale: str, key: str, **values: object) -> str:
    """One server-written reply in the Account's Locale (English unless
    Italian), like the password-reset mail picks its language."""
    catalog = _REPLIES.get(locale, _REPLIES["en"])
    return catalog[key].format(**values)


class TurnLimitReached(Exception):
    """The Account has used its turns for the hour; `wait_seconds` is how
    long until one frees. The handler answers 429 with the message as
    `detail` and the seconds as `Retry-After`."""

    def __init__(self, message: str, *, wait_seconds: int) -> None:
        super().__init__(message)
        self.wait_seconds = wait_seconds


def admit_turn(account: Account, window: TurnWindow, *, now: float, bounds: AssistantBounds) -> None:
    """The turns-per-hour bound (ADR-0035): record this turn, or refuse it
    with `TurnLimitReached` in the Account's Locale."""
    wait = window.admit(account.id, now=now, limit=bounds.turns_per_hour)
    if wait is not None:
        seconds = whole_seconds(wait)
        raise TurnLimitReached(
            reply_text(
                account.language, "turn_limit", per_hour=bounds.turns_per_hour, seconds=seconds
            ),
            wait_seconds=seconds,
        )


_DRAFT_TYPES = ("expense", "income", "transfer")
_ID_FIELDS = (
    "wallet_id",
    "source_wallet_id",
    "destination_wallet_id",
    "category_id",
    "recurring_cost_id",
    "recurring_income_id",
)
_NULLISH = re.compile(r"^(|none|null|nil|n/a)$", re.IGNORECASE)
_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_MAX_DESCRIPTION = 500


class AssistantNotConfigured(Exception):
    """The Account has no Assistant Settings (or its key is unreadable):
    there is no Assistant to turn to. The handler answers 409."""


class ToolError(Exception):
    """A tool refused its input; the message goes back to the model as an
    error result, naming what to change, and the loop continues."""


def model_for_account(
    account: Account, *, secret: str, factory: AssistantModelFactory
) -> AssistantModel:
    """The seam implementation for one turn: the Account's provider, model
    and Assistant Key (decrypted for this request only, ADR-0035) handed to
    the injected factory. `AssistantNotConfigured` when any is missing."""
    key = assistant_key_for(account, secret)
    if key is None or account.assistant_provider is None or account.assistant_model is None:
        raise AssistantNotConfigured("Assistant Settings are not configured")
    return factory(
        provider=provider_spec(account.assistant_provider), model=account.assistant_model, key=key
    )


# --- The catalogue: what the prompt lists and the validator accepts --------


@dataclass(frozen=True)
class CatalogWallet:
    id: int
    name: str
    type: str


@dataclass(frozen=True)
class CatalogCategory:
    id: int
    name: str
    type: str


@dataclass(frozen=True)
class CatalogRecurring:
    kind: str  # "cost" | "income"
    id: int
    name: str
    amount: Decimal
    interval: str  # "1 months"


@dataclass(frozen=True)
class Catalog:
    """The names and ids the Account's Assistant may use: active Wallets,
    every Category, active Recurring definitions. Frozen things are left
    out on purpose: an id outside these lists is refused by the tools."""

    wallets: tuple[CatalogWallet, ...]
    categories: tuple[CatalogCategory, ...]
    recurring: tuple[CatalogRecurring, ...]

    def wallet(self, wallet_id: int) -> CatalogWallet | None:
        return next((w for w in self.wallets if w.id == wallet_id), None)

    def category(self, category_id: int) -> CatalogCategory | None:
        return next((c for c in self.categories if c.id == category_id), None)

    def recurring_definition(self, kind: str, definition_id: int) -> CatalogRecurring | None:
        return next((r for r in self.recurring if r.kind == kind and r.id == definition_id), None)


def load_catalog(session: Session, account_id: int) -> Catalog:
    wallets = session.scalars(
        select(Wallet)
        .where(Wallet.account_id == account_id, Wallet.frozen.is_(False))
        .order_by(Wallet.id)
    ).all()
    categories = session.scalars(
        select(Category).where(Category.account_id == account_id).order_by(Category.id)
    ).all()
    costs = session.scalars(
        select(RecurringCost)
        .where(RecurringCost.account_id == account_id, RecurringCost.frozen.is_(False))
        .order_by(RecurringCost.id)
    ).all()
    incomes = session.scalars(
        select(RecurringIncome)
        .where(RecurringIncome.account_id == account_id, RecurringIncome.frozen.is_(False))
        .order_by(RecurringIncome.id)
    ).all()
    return Catalog(
        wallets=tuple(CatalogWallet(w.id, w.name, w.type) for w in wallets),
        categories=tuple(CatalogCategory(c.id, c.name, c.type) for c in categories),
        recurring=tuple(
            [
                CatalogRecurring(
                    "cost", r.id, r.name, r.amount, f"{r.interval_value} {r.interval_unit}"
                )
                for r in costs
            ]
            + [
                CatalogRecurring(
                    "income", r.id, r.name, r.amount, f"{r.interval_value} {r.interval_unit}"
                )
                for r in incomes
            ]
        ),
    )


# --- The system prompt -------------------------------------------------------


def today_in_rome() -> str:
    return datetime.now(ROME).date().isoformat()


def _prompt_line(**fields: object) -> str:
    return " ".join(f"{key}={value}" for key, value in fields.items())


def build_system_prompt(*, locale: str, today: str, catalog: Catalog) -> str:
    """The prompt rebuilt each turn (ADR-0035): the date, the Locale, the
    catalogue and the rules agreed in #122, lifted from the prototype."""
    language = "Italian" if locale == "it" else "English"
    wallets = "\n".join(_prompt_line(id=w.id, name=w.name, type=w.type) for w in catalog.wallets)
    categories = "\n".join(
        _prompt_line(id=c.id, name=c.name, type=c.type) for c in catalog.categories
    )
    recurring = "\n".join(
        _prompt_line(kind=r.kind, id=r.id, name=r.name, amount=r.amount, interval=r.interval)
        for r in catalog.recurring
    )
    return f"""You are the Assistant of Budjetame, a personal finance app. The user tells you about money movements, in Italian or English, by voice or typing. Your only job is to turn each movement into a Draft Transaction through the tools, then confirm in writing.

Today is {today} (Europe/Rome). The user's language is {language}: always answer in {language}, in one short line per Draft, no greetings, no markdown.

The user's wallets (use these ids):
{wallets or "(none)"}

The user's categories (a category can only go on a transaction of its type):
{categories or "(none)"}

The user's active recurring costs and incomes:
{recurring or "(none)"}

Rules:
- A Draft has: type (expense, income, transfer), amount, date, wallet (expense/income) or source and destination wallets (transfer), category (expense/income only, never transfer), an optional recurring link, an optional description.
- Create a Draft as soon as you caught at least an amount or a description of a movement. Never block a Draft on missing fields: leave what you do not know null. If the sentence contains no money movement at all, create nothing and say so briefly.
- One sentence may contain several movements: one Draft each.
- Defaults: date today unless the user says otherwise (relative dates count from today); type expense when money leaves the user; wallet null unless the user names one.
- Resolve wallet, category and recurring names against the lists above; never use an id that is not listed. Pick the closest existing name when confident. If a name matches more than one existing thing, still create the Draft with that field null, then ask one short question to pick. If nothing fits, leave the field null and do not ask.
- Never invent wallets, categories or recurring definitions; you cannot create them.
- Money moving between two of the user's wallets, or between the user and a contact wallet, is a transfer. A contact wallet (type contact) is a person: "Marco paid me back 20" is a transfer from Marco to the user's wallet; "I lent Marco 50" is a transfer to Marco.
- Paying a recurring cost (e.g. rent) is an expense linked to that recurring cost, with its amount when the user gives none. Receiving a recurring income (e.g. salary) is an income linked to that recurring income.
- Corrections ("no, it was 35", "the lunch was 14") update the matching Draft of this conversation; "forget it", "lascia stare", "scrap that" discard it. Never touch Drafts you did not create in this conversation.
- Keep the description short: what the user said the movement was (shop, thing), in the user's words.
- Your written reply lists each Draft you created or changed as one line: type, amount, date, wallet, category, link; mark missing fields as missing."""


# --- The tools ----------------------------------------------------------------


def _nullable(json_type: str, description: str) -> dict[str, Any]:
    return {"type": [json_type, "null"], "description": description}


# Every field required and nullable (strict schemas): a strict model must
# name what it does not know, a lax one gets the missing keys filled by
# `normalize_tool_input`.
_DRAFT_FIELD_SCHEMAS: dict[str, dict[str, Any]] = {
    "type": {
        "type": ["string", "null"],
        "enum": [*_DRAFT_TYPES, None],
        "description": "Transaction type",
    },
    "amount": _nullable("number", "Amount in EUR, positive"),
    "date": _nullable("string", "YYYY-MM-DD"),
    "wallet_id": _nullable("integer", "Wallet id for expense/income"),
    "source_wallet_id": _nullable("integer", "Source wallet id for transfer"),
    "destination_wallet_id": _nullable("integer", "Destination wallet id for transfer"),
    "category_id": _nullable("integer", "Category id for expense/income"),
    "recurring_cost_id": _nullable("integer", "Recurring cost id this expense pays"),
    "recurring_income_id": _nullable("integer", "Recurring income id this income receives"),
    "description": _nullable("string", "Short free text"),
}


def _object_schema(properties: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": properties,
        "required": list(properties),
        "additionalProperties": False,
    }


LIST_TOOL = "list_draft_transactions"
CREATE_TOOL = "create_draft_transaction"
UPDATE_TOOL = "update_draft_transaction"
DISCARD_TOOL = "discard_draft_transaction"

TOOLS: tuple[ToolSpec, ...] = (
    ToolSpec(
        name=LIST_TOOL,
        description="The Draft Transactions of this conversation.",
        input_schema=_object_schema({}),
    ),
    ToolSpec(
        name=CREATE_TOOL,
        description=(
            "Create one Draft Transaction. Every field you do not know is JSON null "
            '(never the string "None"). Expense/income: wallet_id and category_id; '
            "transfer: source_wallet_id and destination_wallet_id, no category. A "
            "recurring link only when the user is paying/receiving that definition."
        ),
        input_schema=_object_schema(_DRAFT_FIELD_SCHEMAS),
    ),
    ToolSpec(
        name=UPDATE_TOOL,
        description=(
            "Change fields of a Draft of this conversation. Null leaves a field unchanged; "
            "changing the type drops the fields the new type does not carry."
        ),
        input_schema=_object_schema(
            {"id": {"type": "integer", "description": "Draft id"}, **_DRAFT_FIELD_SCHEMAS}
        ),
    ),
    ToolSpec(
        name=DISCARD_TOOL,
        description="Remove a Draft of this conversation.",
        input_schema=_object_schema({"id": {"type": "integer", "description": "Draft id"}}),
    ),
)


# --- Tool-input hygiene --------------------------------------------------------


def _is_nullish(value: object) -> bool:
    return value is None or (isinstance(value, str) and _NULLISH.match(value.strip()) is not None)


def _as_id(value: object) -> object:
    """A numeric string becomes an int; 0 becomes null (ids start at 1: a
    zero is a model's way of saying "none"). Anything else is left for the
    validator to name."""
    if isinstance(value, str) and value.strip().isdigit():
        value = int(value.strip())
    if isinstance(value, bool):
        return value
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    if value == 0:
        return None
    return value


def normalize_tool_input(raw: dict[str, Any]) -> dict[str, Any]:
    """The draft fields of a tool input, cleaned before validation: absent
    keys and nullish strings become null, numeric strings become numbers
    for ids and the amount (`1,20` accepted), id 0 becomes null, `type` is
    lowercased. Only the Draft fields: `id` is handled by the caller."""
    out: dict[str, Any] = {}
    for name in draft_service.DRAFT_FIELDS:
        value = raw.get(name)
        out[name] = None if _is_nullish(value) else value
    if isinstance(out["amount"], str):
        out["amount"] = out["amount"].strip().replace(",", ".")
    for name in _ID_FIELDS:
        out[name] = _as_id(out[name])
    if out["type"] is not None:
        out["type"] = str(out["type"]).strip().lower()
    if out["description"] is not None and not isinstance(out["description"], str):
        out["description"] = str(out["description"])
    return out


# --- Validation: the contradictions, each naming what to leave null -------------


def _parse_amount(value: object) -> Decimal:
    try:
        amount = Decimal(str(value))
    except InvalidOperation:
        raise ToolError(f"amount {value!r} is not a number; send a positive number or null") from None
    if not amount.is_finite() or amount <= 0:
        raise ToolError("amount must be a positive number; leave it null if unknown")
    return amount.quantize(Decimal("0.01"))


def _parse_day(value: object) -> str:
    if not isinstance(value, str) or _DAY.match(value) is None:
        raise ToolError(f"date {value!r} must be YYYY-MM-DD; leave it null if unknown")
    try:
        DateObj.fromisoformat(value)
    except ValueError:
        raise ToolError(f"date {value!r} is not a calendar day; leave it null if unknown") from None
    return value


def _require_int(name: str, value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ToolError(f"{name} {value!r} is not an integer id; use a listed id or null")
    return value


def validate_draft(
    catalog: Catalog, draft: dict[str, Any], *, listed_ids: Sequence[str] = _ID_FIELDS
) -> dict[str, Any]:
    """The Draft fields checked against the catalogue and each other, in the
    stored types (Decimal amount, "YYYY-MM-DD" day, ints). Every message
    names the field to leave null, so the model can repair the input in one
    step instead of filling junk (#122). `listed_ids` are the id fields that
    must be in the prompt's lists: all of them for a create, only the ones
    the patch names for an update (a Wallet frozen since the Draft was
    created must not block a correction of its amount). Raises `ToolError`."""
    out = dict(draft)
    listed = set(listed_ids)
    kind = out["type"]
    if kind is not None and kind not in _DRAFT_TYPES:
        raise ToolError(f"type {kind!r} must be one of expense, income, transfer, or null")
    if out["amount"] is not None:
        out["amount"] = _parse_amount(out["amount"])
    if out["date"] is not None:
        out["date"] = _parse_day(out["date"])
    if out["description"] is not None:
        out["description"] = out["description"].strip()[:_MAX_DESCRIPTION] or None
    for name in _ID_FIELDS:
        if out[name] is not None:
            out[name] = _require_int(name, out[name])

    for name in ("wallet_id", "source_wallet_id", "destination_wallet_id"):
        if name in listed and out[name] is not None and catalog.wallet(out[name]) is None:
            raise ToolError(
                f"{name} {out[name]} is not one of the user's active wallets listed in the "
                f"prompt; use a listed id or leave {name} null"
            )
    category = None
    if out["category_id"] is not None:
        category = catalog.category(out["category_id"])
        if category is None and "category_id" in listed:
            raise ToolError(
                f"category_id {out['category_id']} is not one of the user's categories listed "
                "in the prompt; use a listed id or leave category_id null"
            )
    if "recurring_cost_id" in listed and out["recurring_cost_id"] is not None and (
        catalog.recurring_definition("cost", out["recurring_cost_id"]) is None
    ):
        raise ToolError(
            f"recurring_cost_id {out['recurring_cost_id']} is not one of the user's active "
            "recurring costs listed in the prompt; use a listed id or leave recurring_cost_id null"
        )
    if "recurring_income_id" in listed and out["recurring_income_id"] is not None and (
        catalog.recurring_definition("income", out["recurring_income_id"]) is None
    ):
        raise ToolError(
            f"recurring_income_id {out['recurring_income_id']} is not one of the user's active "
            "recurring incomes listed in the prompt; use a listed id or leave "
            "recurring_income_id null"
        )

    if kind in ("expense", "income"):
        if out["source_wallet_id"] is not None or out["destination_wallet_id"] is not None:
            raise ToolError(
                f"an {kind} has wallet_id only; leave source_wallet_id and "
                "destination_wallet_id null"
            )
        if category is not None and category.type != kind:
            raise ToolError(
                f'category "{category.name}" is {category.type}-only and cannot go on an '
                f"{kind}; pick an {kind} category or leave category_id null"
            )
    if kind == "transfer":
        if out["wallet_id"] is not None:
            raise ToolError(
                "a transfer has source_wallet_id and destination_wallet_id; leave wallet_id null"
            )
        if out["category_id"] is not None:
            raise ToolError("a transfer never carries a category; leave category_id null")
    if kind == "income" and out["recurring_cost_id"] is not None:
        raise ToolError("an income cannot pay a recurring cost; leave recurring_cost_id null")
    if kind == "expense" and out["recurring_income_id"] is not None:
        raise ToolError(
            "an expense cannot receive a recurring income; leave recurring_income_id null"
        )
    if out["recurring_cost_id"] is not None and out["recurring_income_id"] is not None:
        raise ToolError(
            "a draft links to at most one recurring definition; leave recurring_cost_id or "
            "recurring_income_id null"
        )
    if out["source_wallet_id"] is not None and out["source_wallet_id"] == out["destination_wallet_id"]:
        raise ToolError(
            "source_wallet_id and destination_wallet_id must differ; leave one null if unknown"
        )
    return out


# --- The conversation: which Drafts this transcript may change -----------------


def draft_ids_in_transcript(transcript: Sequence[Message]) -> set[int]:
    """The Drafts the open conversation created, read off the transcript:
    the `id` of every successful `create_draft_transaction` result. The
    transcript is the client's, so a forged id can only ever name one of
    the Account's own Drafts (ownership is checked at use)."""
    calls: dict[str, str] = {}
    ids: set[int] = set()
    for message in transcript:
        for block in message.content:
            if isinstance(block, ToolCallBlock):
                calls[block.id] = block.name
            elif isinstance(block, ToolResultBlock) and not block.is_error:
                if calls.get(block.tool_call_id) != CREATE_TOOL:
                    continue
                try:
                    payload = json.loads(block.content)
                except ValueError:
                    continue
                if isinstance(payload, dict) and isinstance(payload.get("id"), int):
                    ids.add(payload["id"])
    return ids


def _draft_payload(draft: DraftTransaction) -> dict[str, Any]:
    """A Draft as the model reads it back: the wire fields, ids only (the
    prompt holds the names)."""
    return {
        "id": draft.id,
        "type": draft.type,
        "amount": str(draft.amount) if draft.amount is not None else None,
        "date": draft.date.isoformat() if draft.date is not None else None,
        "wallet_id": draft.wallet_id,
        "source_wallet_id": draft.source_wallet_id,
        "destination_wallet_id": draft.destination_wallet_id,
        "category_id": draft.category_id,
        "recurring_cost_id": draft.recurring_cost_id,
        "recurring_income_id": draft.recurring_income_id,
        "description": draft.description,
    }


def _fields_outside(draft_type: str) -> tuple[str, ...]:
    """The Draft fields a type never carries: what an update that switches
    to it must drop."""
    if draft_type == "transfer":
        return ("wallet_id", "category_id", "recurring_cost_id", "recurring_income_id")
    if draft_type == "income":
        return ("source_wallet_id", "destination_wallet_id", "recurring_cost_id")
    if draft_type == "expense":
        return ("source_wallet_id", "destination_wallet_id", "recurring_income_id")
    return ()


@contextmanager
def _ids_must_be_listed() -> Iterator[None]:
    """The Draft service's ownership check (ADR-0003) as a tool error: the
    catalogue already filtered the ids, so this only ever fires on a race."""
    try:
        yield
    except NotOwned:
        raise ToolError("one of the ids is not the user's; use only ids listed in the prompt") from None


@dataclass
class AccountTools:
    """The four tools bound to one Account and one conversation. Each call
    returns the JSON-able result or raises `ToolError`."""

    session: Session
    account_id: int
    catalog: Catalog
    conversation_ids: set[int] = field(default_factory=set)

    def call(self, name: str, raw_input: dict[str, Any]) -> Any:
        if name == LIST_TOOL:
            return self._list()
        if name == CREATE_TOOL:
            return self._create(raw_input)
        if name == UPDATE_TOOL:
            return self._update(raw_input)
        if name == DISCARD_TOOL:
            return self._discard(raw_input)
        raise ToolError(f"unknown tool {name!r}; the tools are {', '.join(t.name for t in TOOLS)}")

    def _list(self) -> list[dict[str, Any]]:
        return [
            _draft_payload(draft)
            for draft in draft_service.list_drafts(self.session, self.account_id)
            if draft.id in self.conversation_ids
        ]

    def _create(self, raw_input: dict[str, Any]) -> dict[str, Any]:
        fields = validate_draft(self.catalog, normalize_tool_input(raw_input))
        with _ids_must_be_listed():
            draft = draft_service.create_draft(self.session, self.account_id, **fields)
        self.conversation_ids.add(draft.id)
        return _draft_payload(draft)

    def _conversation_draft(self, raw_input: dict[str, Any], verb: str) -> DraftTransaction:
        raw_id = raw_input.get("id")
        draft_id = None if _is_nullish(raw_id) else _as_id(raw_id)
        if draft_id is None:
            raise ToolError("id is required: the id of a Draft of this conversation")
        draft_id = _require_int("id", draft_id)
        if draft_id not in self.conversation_ids:
            raise ToolError(
                f"Draft {draft_id} is not part of this conversation; it can only be {verb} "
                "from the Transactions tab"
            )
        draft = self.session.get(DraftTransaction, draft_id)
        if draft is None or draft.account_id != self.account_id:
            raise ToolError(f"Draft {draft_id} no longer exists; it was discarded or approved")
        return draft

    def _update(self, raw_input: dict[str, Any]) -> dict[str, Any]:
        """Null leaves a field unchanged, so a change of type also drops the
        fields the new type never carries (a Wallet on a Draft turned
        transfer, the legs on one turned expense): the model has no way to
        null them itself, and keeping them would make the merged Draft a
        contradiction it could never repair."""
        draft = self._conversation_draft(raw_input, "changed")
        patch = {
            name: value
            for name, value in normalize_tool_input(raw_input).items()
            if value is not None
        }
        stored = _draft_payload(draft)
        new_type = patch.get("type")
        if new_type is not None and new_type != stored["type"]:
            for name in _fields_outside(new_type):
                if stored[name] is not None and name not in patch:
                    patch[name] = None
        merged = validate_draft(
            self.catalog,
            {**stored, **patch},
            listed_ids=[name for name in _ID_FIELDS if patch.get(name) is not None],
        )
        changes = {name: merged[name] for name in patch}
        with _ids_must_be_listed():
            draft = draft_service.update_draft(
                self.session, self.account_id, draft, changes=changes
            )
        return _draft_payload(draft)

    def _discard(self, raw_input: dict[str, Any]) -> dict[str, Any]:
        draft = self._conversation_draft(raw_input, "discarded")
        draft_service.delete_draft(self.session, draft)
        self.conversation_ids.discard(draft.id)
        return {"discarded": draft.id}


# --- The turn -------------------------------------------------------------------


@dataclass(frozen=True)
class TurnResult:
    """What a turn hands back: the written reply and the messages appended
    to the transcript this turn (the user message first), so the client's
    next transcript is the one it sent plus this tail."""

    reply: str
    transcript_tail: list[Message]
    steps: int


def _tool_result(call: ToolCallBlock, tools: AccountTools) -> ToolResultBlock:
    try:
        result = tools.call(call.name, call.input)
    except ToolError as error:
        return ToolResultBlock(tool_call_id=call.id, content=str(error), is_error=True)
    return ToolResultBlock(tool_call_id=call.id, content=json.dumps(result, ensure_ascii=False))


def run_turn(
    session: Session,
    account: Account,
    *,
    model: AssistantModel,
    transcript: Sequence[Message],
    text: str,
    bounds: AssistantBounds,
    clock: Clock,
) -> TurnResult:
    """One user turn through the loop: the prompt is rebuilt, the user text
    appended, the model asked until it stops calling tools, the step cap
    asks it to answer, or a bound or a provider failure ends the turn with
    a server-written reply (module docstring). Every tool call gets a
    result (an error one when the tool refused) and every server reply is
    an assistant text message, so the transcript the client gets back is
    always well-formed for the next turn."""
    catalog = load_catalog(session, account.id)
    locale = account.language
    system = build_system_prompt(locale=locale, today=today_in_rome(), catalog=catalog)
    tools = AccountTools(
        session=session,
        account_id=account.id,
        catalog=catalog,
        conversation_ids=draft_ids_in_transcript(transcript),
    )
    messages: list[Message] = list(transcript)
    tail: list[Message] = []

    def append(message: Message) -> None:
        messages.append(message)
        tail.append(message)

    def server_reply(key: str, **values: object) -> TurnResult:
        """End the turn with a server-written assistant message."""
        text = reply_text(locale, key, **values)
        append(Message(role="assistant", content=[TextBlock(text=text)]))
        return TurnResult(reply=text, transcript_tail=tail, steps=steps)

    append(Message(role="user", content=[TextBlock(text=text)]))
    deadline = clock.monotonic() + bounds.turn_seconds
    retried = False
    steps = 0
    reply: AssistantReply
    while True:
        tools_allowed = steps < bounds.max_tool_steps
        try:
            reply = model.complete(
                system=system,
                tools=TOOLS,
                messages=messages,
                tool_choice="auto" if tools_allowed else "none",
            )
        except AssistantKeyRejected:
            return server_reply("key_rejected")
        except AssistantProviderTimeout:
            return server_reply("gave_up", seconds=whole_seconds(bounds.turn_seconds))
        except AssistantProviderBusy as error:
            delay = error.retry_after_seconds
            if delay is None:
                delay = bounds.retry_default_seconds
            if retried or delay > deadline - clock.monotonic():
                return server_reply("busy", seconds=whole_seconds(delay))
            # Holds this request's worker thread for the delay: bounded by
            # the turn budget and the turns per hour, fine for one instance.
            clock.sleep(delay)
            retried = True
            continue
        append(Message(role="assistant", content=list(reply.content)))
        calls = reply.tool_calls
        if not calls:
            if steps == 0 and not _has_tool_calls(transcript):
                # Replace the text of a model that never drove a tool: the
                # tail keeps one assistant message, so roles still alternate.
                tail.pop()
                messages.pop()
                return server_reply("cannot_drive")
            break
        if not tools_allowed:
            # The model ignored "no more tools": answer the calls with an
            # error so the transcript stays well-formed, and stop here.
            append(
                Message(
                    role="user",
                    content=[
                        ToolResultBlock(
                            tool_call_id=call.id,
                            content="The tool-step limit of this turn is reached; answer the user now",
                            is_error=True,
                        )
                        for call in calls
                    ],
                )
            )
            break
        steps += 1
        append(Message(role="user", content=[_tool_result(call, tools) for call in calls]))
        if clock.monotonic() >= deadline:
            # The tools ran (Drafts are Drafts), but no further model call:
            # the turn is over budget and says so instead of answering.
            return server_reply("gave_up", seconds=whole_seconds(bounds.turn_seconds))
    return TurnResult(reply=reply.text, transcript_tail=tail, steps=steps)


def _has_tool_calls(transcript: Sequence[Message]) -> bool:
    return any(
        isinstance(block, ToolCallBlock)
        for message in transcript
        if message.role == "assistant"
        for block in message.content
    )

