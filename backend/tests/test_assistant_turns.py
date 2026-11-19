"""The Assistant turn (ADR-0035, issues #122/#128): `POST /assistant/turns`
driven over the HTTP seam with the model call replaced by the scripted fake.
The loop, the four Draft tools, the input hygiene, the validation and the
Draft writes all run for real against the test database; no test touches
the network.
"""

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime
from itertools import count
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from httpx import ASGITransport, AsyncClient

from app.assistant_bounds import AssistantBounds
from app.assistant_seam import (
    AssistantKeyRejected,
    AssistantProviderBusy,
    AssistantProviderTimeout,
    AssistantReply,
    AssistantSeamError,
    FakeClock,
    ScriptedAssistantModel,
    Slow,
    TextBlock,
    ToolCallBlock,
)
from app.main import create_app
from conftest import SEED_EMAIL, SEED_PASSWORD

_UNIQUE = count(1)

KEY = "sk-assistant-turns-test-key-4c1d9e"


def _name(prefix: str) -> str:
    return f"Turn {prefix} {next(_UNIQUE)}"


@asynccontextmanager
async def _scripted_app(
    database_url: str, *, bounds: AssistantBounds | None = None
) -> AsyncIterator[tuple[AsyncClient, ScriptedAssistantModel]]:
    """The app with the provider seam replaced by one scripted fake and the
    turn clock by a `FakeClock` the fake shares (`fake.clock`), so a test
    scripts the replies, spends the turn budget and reads the waits without
    sleeping. `bounds` overrides the settings' bounds (issue #129)."""
    clock = FakeClock()
    fake = ScriptedAssistantModel(clock=clock)
    app = create_app(
        database_url,
        seed_email=SEED_EMAIL,
        seed_password=SEED_PASSWORD,
        assistant_model_factory=lambda *, provider, model, key: fake,
        assistant_clock=clock,
        assistant_bounds=bounds,
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as async_client:
        yield async_client, fake
    app.state.engine.dispose()


@pytest.fixture
async def turn_client(database_url: str) -> AsyncIterator[tuple[AsyncClient, ScriptedAssistantModel]]:
    """The scripted app under the default bounds, handed to the test so each
    case scripts the fake's replies and reads what the loop sent it."""
    async with _scripted_app(database_url) as pair:
        yield pair


async def _login(client: AsyncClient) -> str:
    """A fresh Account per test: the turn tests create Wallets, Categories
    and Drafts and change the Locale, and other files assume the shared
    seed Account untouched."""
    response = await client.post(
        "/auth/register",
        json={"email": f"turn-{next(_UNIQUE)}@example.com", "password": "hunter2-hunter2"},
    )
    assert response.status_code in (200, 201), response.text
    return response.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _configure(client: AsyncClient, token: str, provider: str = "anthropic") -> None:
    response = await client.put(
        "/assistant/settings", json={"provider": provider, "key": KEY}, headers=_auth(token)
    )
    assert response.status_code == 200, response.text


async def _create_wallet(client: AsyncClient, token: str, name: str, type: str = "checking") -> int:
    response = await client.post(
        "/wallets",
        json={"name": name, "type": type, "opening_balance": "0.00"},
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _create_category(client: AsyncClient, token: str, name: str, type: str = "expense") -> int:
    response = await client.post(
        "/categories",
        json={"name": name, "type": type, "color": "#ef4444"},
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _create_recurring(client: AsyncClient, token: str, kind: str, name: str) -> int:
    response = await client.post(
        f"/recurring-{kind}s",
        json={"name": name, "amount": "800.00", "interval_value": 1, "interval_unit": "months"},
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _create_frozen_wallet(client: AsyncClient, token: str, name: str) -> int:
    wallet_id = await _create_wallet(client, token, name)
    response = await client.post(f"/wallets/{wallet_id}/freeze", headers=_auth(token))
    assert response.status_code == 200, response.text
    return wallet_id


async def _create_frozen_cost(client: AsyncClient, token: str, name: str) -> int:
    cost_id = await _create_recurring(client, token, "cost", name)
    response = await client.post(f"/recurring-costs/{cost_id}/freeze", headers=_auth(token))
    assert response.status_code == 200, response.text
    return cost_id


async def _set_language(client: AsyncClient, token: str, language: str) -> None:
    response = await client.put(
        "/auth/me/language", json={"language": language}, headers=_auth(token)
    )
    assert response.status_code == 204, response.text


async def _list_drafts(client: AsyncClient, token: str) -> list[dict[str, Any]]:
    response = await client.get("/draft-transactions", headers=_auth(token))
    assert response.status_code == 200, response.text
    return response.json()


async def _turn(
    client: AsyncClient, token: str, text: str, transcript: list[dict[str, Any]] | None = None
) -> dict[str, Any]:
    response = await client.post(
        "/assistant/turns",
        json={"transcript": transcript or [], "text": text},
        headers=_auth(token),
    )
    assert response.status_code == 200, response.text
    return response.json()


def _tool_call(name: str, input: dict[str, Any], call_id: str = "call-1") -> AssistantReply:
    return AssistantReply(
        content=[ToolCallBlock(id=call_id, name=name, input=input)], stop_reason="tool_use"
    )


def _say(text: str) -> AssistantReply:
    return AssistantReply(content=[TextBlock(text=text)], stop_reason="end_turn")


def _draft_input(**fields: Any) -> dict[str, Any]:
    """A complete create/update input — every field present, null unless
    given — the shape a strict model sends."""
    base: dict[str, Any] = {
        "type": None,
        "amount": None,
        "date": None,
        "wallet_id": None,
        "source_wallet_id": None,
        "destination_wallet_id": None,
        "category_id": None,
        "recurring_cost_id": None,
        "recurring_income_id": None,
        "description": None,
    }
    return {**base, **fields}


def _tool_results(fake: ScriptedAssistantModel, call_index: int) -> list[dict[str, Any]]:
    """The tool results the loop sent back in the messages of the fake's
    `call_index`-th call: the last user message's blocks."""
    messages = fake.calls[call_index].messages
    return [block.model_dump() for block in messages[-1].content]


def _today_in_rome() -> str:
    return datetime.now(ZoneInfo("Europe/Rome")).date().isoformat()


# --- Settings gate ----------------------------------------------------------


async def test_turn_answers_409_without_assistant_settings(
    turn_client: tuple[AsyncClient, ScriptedAssistantModel],
) -> None:
    client, fake = turn_client
    token = await _login(client)  # a new Account: no Assistant Settings yet

    response = await client.post(
        "/assistant/turns", json={"transcript": [], "text": "30 euro"}, headers=_auth(token)
    )

    assert response.status_code == 409, response.text
    assert fake.calls == []


# --- One turn creates a Draft -----------------------------------------------


async def test_turn_creates_the_draft_and_returns_reply_and_tail(
    turn_client: tuple[AsyncClient, ScriptedAssistantModel],
) -> None:
    client, fake = turn_client
    token = await _login(client)
    await _configure(client, token)
    wallet_id = await _create_wallet(client, token, _name("Carta"))
    category_id = await _create_category(client, token, _name("Cibo"))
    fake.script(
        _tool_call(
            "create_draft_transaction",
            _draft_input(
                type="expense",
                amount=30,
                date="2026-11-18",
                wallet_id=wallet_id,
                category_id=category_id,
                description="Esselunga",
            ),
        ),
        _say("Spesa 30,00 € 18/11 Carta / Cibo: Esselunga"),
    )

    result = await _turn(client, token, "ho speso 30 euro all'Esselunga con la carta, cibo")

    assert result["reply"] == "Spesa 30,00 € 18/11 Carta / Cibo: Esselunga"
    drafts = [d for d in await _list_drafts(client, token) if d["wallet_id"] == wallet_id]
    assert len(drafts) == 1
    draft = drafts[0]
    assert draft["type"] == "expense"
    assert draft["amount"] == "30.00"
    assert draft["date"] == "2026-11-18"
    assert draft["category_id"] == category_id
    assert draft["description"] == "Esselunga"
    # The tail: the user message, the tool call, its result, the final reply.
    tail = result["transcript_tail"]
    assert [m["role"] for m in tail] == ["user", "assistant", "user", "assistant"]
    assert tail[0]["content"] == [
        {"type": "text", "text": "ho speso 30 euro all'Esselunga con la carta, cibo"}
    ]
    assert tail[1]["content"][0]["type"] == "tool_call"
    tool_result = tail[2]["content"][0]
    assert tool_result["type"] == "tool_result"
    assert tool_result["tool_call_id"] == "call-1"
    assert tool_result["is_error"] is False
    assert json.loads(tool_result["content"])["id"] == draft["id"]
    assert tail[3]["content"] == [{"type": "text", "text": "Spesa 30,00 € 18/11 Carta / Cibo: Esselunga"}]
    # The fake saw the loop feed the result back before the final reply.
    assert len(fake.calls) == 2
    assert _tool_results(fake, 1)[0]["tool_call_id"] == "call-1"


# --- The conversation: update and discard only this transcript's Drafts ------


async def _create_turn(
    client: AsyncClient, fake: ScriptedAssistantModel, token: str, **fields: Any
) -> tuple[int, list[dict[str, Any]]]:
    """A first turn that creates one Draft; returns its id and the
    transcript the client now holds."""
    fake.script(_tool_call("create_draft_transaction", _draft_input(**fields)), _say("ok"))
    result = await _turn(client, token, "trenta euro")
    draft_id = json.loads(result["transcript_tail"][2]["content"][0]["content"])["id"]
    return draft_id, result["transcript_tail"]


async def test_second_turn_updates_the_draft_of_the_transcript(
    turn_client: tuple[AsyncClient, ScriptedAssistantModel],
) -> None:
    client, fake = turn_client
    token = await _login(client)
    await _configure(client, token)
    wallet_id = await _create_wallet(client, token, _name("Update wallet"))
    draft_id, transcript = await _create_turn(
        client, fake, token, type="expense", amount=30, wallet_id=wallet_id, description="pranzo"
    )

    fake.script(
        _tool_call("update_draft_transaction", {"id": draft_id, **_draft_input(amount=35)}, "c2"),
        _say("Spesa 35,00"),
    )
    result = await _turn(client, token, "no, erano 35", transcript)

    assert result["reply"] == "Spesa 35,00"
    drafts = {d["id"]: d for d in await _list_drafts(client, token)}
    assert drafts[draft_id]["amount"] == "35.00"
    # Null left the other fields unchanged.
    assert drafts[draft_id]["wallet_id"] == wallet_id
    assert drafts[draft_id]["description"] == "pranzo"
    assert drafts[draft_id]["type"] == "expense"
    # The fake saw the whole conversation: the old transcript then this turn.
    assert len(fake.calls[-1].messages) == len(transcript) + 3


async def test_second_turn_discards_the_draft_of_the_transcript(
    turn_client: tuple[AsyncClient, ScriptedAssistantModel],
) -> None:
    client, fake = turn_client
    token = await _login(client)
    await _configure(client, token)
    draft_id, transcript = await _create_turn(client, fake, token, amount=30, description="x")

    fake.script(_tool_call("discard_draft_transaction", {"id": draft_id}, "c2"), _say("Tolto."))
    result = await _turn(client, token, "lascia stare", transcript)

    assert result["reply"] == "Tolto."
    assert draft_id not in {d["id"] for d in await _list_drafts(client, token)}
    assert json.loads(result["transcript_tail"][2]["content"][0]["content"]) == {
        "discarded": draft_id
    }


async def test_update_and_discard_refuse_a_draft_outside_the_transcript(
    turn_client: tuple[AsyncClient, ScriptedAssistantModel],
) -> None:
    client, fake = turn_client
    token = await _login(client)
    await _configure(client, token)
    # A Draft from an earlier (closed) conversation: created, transcript gone.
    draft_id, _ = await _create_turn(client, fake, token, amount=12, description="older")

    fake.script(
        _tool_call("update_draft_transaction", {"id": draft_id, **_draft_input(amount=99)}, "u1"),
        _tool_call("discard_draft_transaction", {"id": draft_id}, "d1"),
        _say("Non posso."),
    )
    result = await _turn(client, token, "cambia quella di prima", transcript=[])

    assert result["reply"] == "Non posso."
    update_result = result["transcript_tail"][2]["content"][0]
    discard_result = result["transcript_tail"][4]["content"][0]
    assert update_result["is_error"] is True
    assert "Transactions tab" in update_result["content"]
    assert discard_result["is_error"] is True
    assert "Transactions tab" in discard_result["content"]
    drafts = {d["id"]: d for d in await _list_drafts(client, token)}
    assert drafts[draft_id]["amount"] == "12.00"


async def test_list_tool_returns_only_the_conversation_drafts(
    turn_client: tuple[AsyncClient, ScriptedAssistantModel],
) -> None:
    client, fake = turn_client
    token = await _login(client)
    await _configure(client, token)
    older_id, _ = await _create_turn(client, fake, token, amount=1, description="older")
    mine_id, transcript = await _create_turn(client, fake, token, amount=2, description="mine")

    fake.script(_tool_call("list_draft_transactions", {}, "l1"), _say("Una bozza."))
    result = await _turn(client, token, "cosa ho?", transcript)

    listed = json.loads(result["transcript_tail"][2]["content"][0]["content"])
    assert [d["id"] for d in listed] == [mine_id]
    assert older_id != mine_id


# --- Hygiene and contradictions ------------------------------------------------


async def _tool_outcome(
    client: AsyncClient, fake: ScriptedAssistantModel, token: str, raw_input: dict[str, Any]
) -> dict[str, Any]:
    """One create call with `raw_input` as the model sent it; the tool
    result block the loop sent back."""
    fake.script(_tool_call("create_draft_transaction", raw_input, "h1"), _say("."))
    result = await _turn(client, token, "...")
    block: dict[str, Any] = result["transcript_tail"][2]["content"][0]
    return block


async def test_hygiene_coerces_strings_before_validation(
    turn_client: tuple[AsyncClient, ScriptedAssistantModel],
) -> None:
    client, fake = turn_client
    token = await _login(client)
    await _configure(client, token)
    wallet_id = await _create_wallet(client, token, _name("Hygiene wallet"))
    category_id = await _create_category(client, token, _name("Hygiene cat"))

    # A lax model: ids as strings, "None" for null, "1,20" for the amount,
    # an uppercase type, 0 for "no category", and the description key absent.
    outcome = await _tool_outcome(
        client,
        fake,
        token,
        {
            "type": "Expense",
            "amount": "1,20",
            "date": "None",
            "wallet_id": str(wallet_id),
            "source_wallet_id": "",
            "destination_wallet_id": "null",
            "category_id": 0,
            "recurring_cost_id": "n/a",
            "recurring_income_id": "nil",
        },
    )

    assert outcome["is_error"] is False, outcome
    draft = {d["id"]: d for d in await _list_drafts(client, token)}[
        json.loads(outcome["content"])["id"]
    ]
    assert draft["type"] == "expense"
    assert draft["amount"] == "1.20"
    assert draft["date"] is None
    assert draft["wallet_id"] == wallet_id
    assert draft["category_id"] is None
    assert draft["description"] is None
    assert category_id not in {d["category_id"] for d in await _list_drafts(client, token)}


@pytest.mark.parametrize(
    ("fields", "expected"),
    [
        (
            {"type": "expense", "source_wallet_id": "SRC"},
            "leave source_wallet_id and destination_wallet_id null",
        ),
        (
            {"type": "income", "destination_wallet_id": "DST"},
            "leave source_wallet_id and destination_wallet_id null",
        ),
        ({"type": "transfer", "wallet_id": "SRC"}, "leave wallet_id null"),
        ({"type": "transfer", "category_id": "EXPENSE_CAT"}, "leave category_id null"),
        ({"type": "income", "category_id": "EXPENSE_CAT"}, "leave category_id null"),
        ({"type": "income", "recurring_cost_id": "COST"}, "leave recurring_cost_id null"),
        ({"type": "expense", "recurring_income_id": "INCOME"}, "leave recurring_income_id null"),
        (
            {"recurring_cost_id": "COST", "recurring_income_id": "INCOME"},
            "at most one recurring definition",
        ),
        (
            {"type": "transfer", "source_wallet_id": "SRC", "destination_wallet_id": "SRC"},
            "source_wallet_id and destination_wallet_id must differ",
        ),
        ({"amount": 0}, "amount must be a positive number"),
        ({"amount": -5}, "amount must be a positive number"),
        ({"wallet_id": "FROZEN"}, "leave wallet_id null"),
        ({"wallet_id": 999999}, "leave wallet_id null"),
        ({"category_id": 999999}, "leave category_id null"),
        ({"recurring_cost_id": "FROZEN_COST"}, "leave recurring_cost_id null"),
        ({"recurring_income_id": 999999}, "leave recurring_income_id null"),
    ],
)
async def test_contradictions_are_refused_naming_what_to_leave_null(
    turn_client: tuple[AsyncClient, ScriptedAssistantModel],
    fields: dict[str, Any],
    expected: str,
) -> None:
    client, fake = turn_client
    token = await _login(client)
    await _configure(client, token)
    ids = {
        "SRC": await _create_wallet(client, token, _name("Src")),
        "DST": await _create_wallet(client, token, _name("Dst")),
        "EXPENSE_CAT": await _create_category(client, token, _name("Exp cat")),
        "COST": await _create_recurring(client, token, "cost", _name("Cost")),
        "INCOME": await _create_recurring(client, token, "income", _name("Income")),
    }
    ids["FROZEN"] = await _create_frozen_wallet(client, token, _name("Frozen"))
    ids["FROZEN_COST"] = await _create_frozen_cost(client, token, _name("Frozen cost"))
    raw = {k: ids.get(v, v) if isinstance(v, str) else v for k, v in fields.items()}
    before = {d["id"] for d in await _list_drafts(client, token)}

    outcome = await _tool_outcome(client, fake, token, _draft_input(**raw))

    assert outcome["is_error"] is True, outcome
    assert expected in outcome["content"], outcome["content"]
    assert {d["id"] for d in await _list_drafts(client, token)} == before


async def test_a_tool_error_is_answered_and_the_loop_continues(
    turn_client: tuple[AsyncClient, ScriptedAssistantModel],
) -> None:
    client, fake = turn_client
    token = await _login(client)
    await _configure(client, token)

    fake.script(
        _tool_call("create_draft_transaction", _draft_input(type="transfer", wallet_id=1), "e1"),
        _tool_call("create_draft_transaction", _draft_input(type="transfer", amount=5), "e2"),
        _say("Fatto."),
    )
    result = await _turn(client, token, "sposta 5")

    assert result["reply"] == "Fatto."
    assert len(fake.calls) == 3
    assert _tool_results(fake, 1)[0]["is_error"] is True
    assert _tool_results(fake, 2)[0]["is_error"] is False


# --- The prompt --------------------------------------------------------------------


async def test_system_prompt_carries_date_locale_and_active_names_only(
    turn_client: tuple[AsyncClient, ScriptedAssistantModel],
) -> None:
    client, fake = turn_client
    token = await _login(client)
    await _configure(client, token)
    await _set_language(client, token, "it")
    active_wallet = await _create_wallet(client, token, _name("Prompt active"), "cash")
    frozen_wallet = await _create_frozen_wallet(client, token, _name("Prompt frozen"))
    category = await _create_category(client, token, _name("Prompt cat"), "income")
    cost = await _create_recurring(client, token, "cost", _name("Prompt cost"))
    await _create_frozen_cost(client, token, _name("Prompt frozen cost"))
    income = await _create_recurring(client, token, "income", _name("Prompt income"))
    # A Transaction that must never reach the prompt.
    response = await client.post(
        "/transactions",
        json={
            "type": "expense",
            "amount": "77.77",
            "date": "2026-01-02",
            "wallet_id": active_wallet,
            "description": "NEVER-IN-PROMPT",
        },
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text

    fake.script(_say("Nessun movimento."))
    await _turn(client, token, "ciao")

    system = fake.calls[0].system
    assert f"Today is {_today_in_rome()} (Europe/Rome)" in system
    assert "The user's language is Italian" in system
    assert f"id={active_wallet} name=Turn Prompt active" in system
    assert "type=cash" in system
    assert f"id={frozen_wallet} " not in system
    assert "Prompt frozen" not in system
    assert f"id={category} name=Turn Prompt cat" in system
    assert "type=income" in system
    assert f"kind=cost id={cost} name=Turn Prompt cost" in system
    assert "amount=800.00 interval=1 months" in system
    assert f"kind=income id={income} name=Turn Prompt income" in system
    assert "NEVER-IN-PROMPT" not in system
    assert "77.77" not in system
    assert [t.name for t in fake.calls[0].tools] == [
        "list_draft_transactions",
        "create_draft_transaction",
        "update_draft_transaction",
        "discard_draft_transaction",
    ]
    assert fake.calls[0].tool_choice == "auto"


async def test_english_locale_asks_for_english(
    turn_client: tuple[AsyncClient, ScriptedAssistantModel],
) -> None:
    client, fake = turn_client
    token = await _login(client)
    await _configure(client, token)
    _, transcript = await _create_turn(client, fake, token, amount=30)
    fake.script(_say("No money movement heard."))

    result = await _turn(client, token, "hello", transcript)

    assert result["reply"] == "No money movement heard."
    assert "The user's language is English" in fake.calls[-1].system


# --- The step cap -----------------------------------------------------------------


async def test_step_cap_asks_for_a_final_answer_without_tools(
    turn_client: tuple[AsyncClient, ScriptedAssistantModel],
) -> None:
    client, fake = turn_client
    token = await _login(client)
    await _configure(client, token)
    before = {d["id"] for d in await _list_drafts(client, token)}
    fake.script(
        *[
            _tool_call("create_draft_transaction", _draft_input(amount=i + 1), f"s{i}")
            for i in range(8)
        ],
        # The ninth call must come with tool_choice "none"; this reply obeys.
        _say("Otto bozze."),
    )

    result = await _turn(client, token, "tanti")

    assert result["reply"] == "Otto bozze."
    assert len(fake.calls) == 9
    assert [c.tool_choice for c in fake.calls] == ["auto"] * 8 + ["none"]
    assert len({d["id"] for d in await _list_drafts(client, token)} - before) == 8


async def test_step_cap_refuses_tool_calls_the_model_still_sends(
    turn_client: tuple[AsyncClient, ScriptedAssistantModel],
) -> None:
    client, fake = turn_client
    token = await _login(client)
    await _configure(client, token)
    before = {d["id"] for d in await _list_drafts(client, token)}
    fake.script(
        *[
            _tool_call("create_draft_transaction", _draft_input(amount=i + 1), f"s{i}")
            for i in range(9)
        ],
    )

    result = await _turn(client, token, "tanti")

    assert len(fake.calls) == 9
    assert len({d["id"] for d in await _list_drafts(client, token)} - before) == 8
    last_result = result["transcript_tail"][-1]["content"][0]
    assert last_result["type"] == "tool_result"
    assert last_result["tool_call_id"] == "s8"
    assert last_result["is_error"] is True
    assert result["reply"] == ""


async def test_update_changing_the_type_drops_the_old_shape(
    turn_client: tuple[AsyncClient, ScriptedAssistantModel],
) -> None:
    client, fake = turn_client
    token = await _login(client)
    await _configure(client, token)
    wallet_id = await _create_wallet(client, token, _name("Switch wallet"))
    contact_id = await _create_wallet(client, token, _name("Switch Marco"), "contact")
    category_id = await _create_category(client, token, _name("Switch cat"))
    draft_id, transcript = await _create_turn(
        client, fake, token, type="expense", amount=50, wallet_id=wallet_id, category_id=category_id
    )

    # "No, I lent it to Marco": the expense becomes a transfer; the model
    # cannot null wallet_id and category_id itself (null means unchanged).
    fake.script(
        _tool_call(
            "update_draft_transaction",
            {
                "id": draft_id,
                **_draft_input(
                    type="transfer", source_wallet_id=wallet_id, destination_wallet_id=contact_id
                ),
            },
            "t1",
        ),
        _say("Trasferimento 50,00"),
    )
    result = await _turn(client, token, "no, li ho prestati a Marco", transcript)

    outcome = result["transcript_tail"][2]["content"][0]
    assert outcome["is_error"] is False, outcome
    draft = {d["id"]: d for d in await _list_drafts(client, token)}[draft_id]
    assert draft["type"] == "transfer"
    assert draft["source_wallet_id"] == wallet_id
    assert draft["destination_wallet_id"] == contact_id
    assert draft["wallet_id"] is None
    assert draft["category_id"] is None
    assert draft["amount"] == "50.00"


async def test_update_corrects_a_draft_whose_wallet_was_frozen_since(
    turn_client: tuple[AsyncClient, ScriptedAssistantModel],
) -> None:
    client, fake = turn_client
    token = await _login(client)
    await _configure(client, token)
    wallet_id = await _create_wallet(client, token, _name("Since frozen"))
    draft_id, transcript = await _create_turn(
        client, fake, token, type="expense", amount=30, wallet_id=wallet_id
    )
    response = await client.post(f"/wallets/{wallet_id}/freeze", headers=_auth(token))
    assert response.status_code == 200, response.text

    # The stored wallet is no longer in the prompt's list, but the model
    # only corrects the amount: the correction must go through.
    fake.script(
        _tool_call("update_draft_transaction", {"id": draft_id, **_draft_input(amount=35)}, "f1"),
        _tool_call(
            "update_draft_transaction", {"id": draft_id, **_draft_input(wallet_id=wallet_id)}, "f2"
        ),
        _say("Spesa 35,00"),
    )
    result = await _turn(client, token, "no, erano 35", transcript)

    amount_outcome = result["transcript_tail"][2]["content"][0]
    wallet_outcome = result["transcript_tail"][4]["content"][0]
    assert amount_outcome["is_error"] is False, amount_outcome
    # Naming the frozen wallet again is still refused: it is not listed.
    assert wallet_outcome["is_error"] is True
    assert "leave wallet_id null" in wallet_outcome["content"]
    draft = {d["id"]: d for d in await _list_drafts(client, token)}[draft_id]
    assert draft["amount"] == "35.00"
    assert draft["wallet_id"] == wallet_id


async def test_update_with_a_nullish_id_is_refused_as_missing(
    turn_client: tuple[AsyncClient, ScriptedAssistantModel],
) -> None:
    client, fake = turn_client
    token = await _login(client)
    await _configure(client, token)

    fake.script(
        _tool_call("update_draft_transaction", {"id": "None", **_draft_input(amount=5)}, "n1"),
        _say("?"),
    )
    result = await _turn(client, token, "cambia")

    outcome = result["transcript_tail"][2]["content"][0]
    assert outcome["is_error"] is True
    assert "id is required" in outcome["content"]


# --- Provider failures (issue #129) -----------------------------------------------


def _clock(fake: ScriptedAssistantModel) -> FakeClock:
    assert fake.clock is not None
    return fake.clock


async def test_a_rejected_key_yields_the_settings_reply_and_no_retry(
    turn_client: tuple[AsyncClient, ScriptedAssistantModel],
) -> None:
    client, fake = turn_client
    token = await _login(client)
    await _configure(client, token)
    before = {d["id"] for d in await _list_drafts(client, token)}
    fake.script(AssistantKeyRejected(), _say("never reached"))

    result = await _turn(client, token, "trenta euro")

    assert result["reply"] == (
        "The provider rejected the Assistant Key: check it in Assistant Settings."
    )
    assert len(fake.calls) == 1
    assert _clock(fake).sleeps == []
    # The tail stays well-formed: the user message, then the reply as an
    # assistant message, so the client can carry it into the next turn.
    assert [m["role"] for m in result["transcript_tail"]] == ["user", "assistant"]
    assert result["transcript_tail"][1]["content"] == [{"type": "text", "text": result["reply"]}]
    assert {d["id"] for d in await _list_drafts(client, token)} == before


async def test_an_untyped_seam_error_is_still_a_502(
    turn_client: tuple[AsyncClient, ScriptedAssistantModel],
) -> None:
    client, fake = turn_client
    token = await _login(client)
    await _configure(client, token)
    fake.script(AssistantSeamError("connection reset"))

    response = await client.post(
        "/assistant/turns", json={"transcript": [], "text": "x"}, headers=_auth(token)
    )

    assert response.status_code == 502, response.text
    assert len(fake.calls) == 1


async def test_a_busy_provider_is_retried_once_after_its_announced_delay(
    turn_client: tuple[AsyncClient, ScriptedAssistantModel],
) -> None:
    client, fake = turn_client
    token = await _login(client)
    await _configure(client, token)
    before = {d["id"] for d in await _list_drafts(client, token)}
    fake.script(
        AssistantProviderBusy(retry_after_seconds=2.5),
        _tool_call("create_draft_transaction", _draft_input(amount=30)),
        _say("Spesa 30,00"),
    )

    result = await _turn(client, token, "trenta euro")

    assert result["reply"] == "Spesa 30,00"
    assert len(fake.calls) == 3
    assert _clock(fake).sleeps == [2.5]
    # The retry re-asks the same conversation.
    assert fake.calls[1].messages == fake.calls[0].messages
    assert len({d["id"] for d in await _list_drafts(client, token)} - before) == 1


async def test_a_busy_provider_with_a_delay_beyond_the_budget_names_the_seconds(
    turn_client: tuple[AsyncClient, ScriptedAssistantModel],
) -> None:
    client, fake = turn_client
    token = await _login(client)
    await _configure(client, token)
    fake.script(AssistantProviderBusy(retry_after_seconds=42.2), _say("never reached"))

    result = await _turn(client, token, "trenta euro")

    assert result["reply"] == "The provider is busy, try again in 43 s."
    assert len(fake.calls) == 1
    assert _clock(fake).sleeps == []
    assert [m["role"] for m in result["transcript_tail"]] == ["user", "assistant"]


async def test_a_busy_provider_that_announced_no_delay_waits_the_default(
    turn_client: tuple[AsyncClient, ScriptedAssistantModel],
) -> None:
    client, fake = turn_client
    token = await _login(client)
    await _configure(client, token)
    fake.script(AssistantProviderBusy(), _say("ok"))

    await _turn(client, token, "x")

    assert _clock(fake).sleeps == [5.0]
    assert len(fake.calls) == 2


async def test_a_busy_provider_is_retried_only_once_per_turn(
    turn_client: tuple[AsyncClient, ScriptedAssistantModel],
) -> None:
    client, fake = turn_client
    token = await _login(client)
    await _configure(client, token)
    fake.script(
        AssistantProviderBusy(retry_after_seconds=1),
        _tool_call("create_draft_transaction", _draft_input(amount=30)),
        AssistantProviderBusy(retry_after_seconds=1),
        _say("never reached"),
    )

    result = await _turn(client, token, "trenta euro")

    assert result["reply"] == "The provider is busy, try again in 1 s."
    assert len(fake.calls) == 3
    assert _clock(fake).sleeps == [1]
    roles = [m["role"] for m in result["transcript_tail"]]
    assert roles == ["user", "assistant", "user", "assistant"]


async def test_the_delay_must_fit_the_remaining_budget_not_the_whole_one(
    turn_client: tuple[AsyncClient, ScriptedAssistantModel],
) -> None:
    client, fake = turn_client
    token = await _login(client)
    await _configure(client, token)
    # 20 s spent on the first call; a 15 s delay would end past the 30 s budget.
    fake.script(
        Slow(20, _tool_call("create_draft_transaction", _draft_input(amount=30))),
        AssistantProviderBusy(retry_after_seconds=15),
        _say("never reached"),
    )

    result = await _turn(client, token, "trenta euro")

    assert result["reply"] == "The provider is busy, try again in 15 s."
    assert len(fake.calls) == 2
    assert _clock(fake).sleeps == []


# --- The turn budget ----------------------------------------------------------------


async def test_a_turn_over_budget_yields_the_gave_up_reply_without_another_call(
    turn_client: tuple[AsyncClient, ScriptedAssistantModel],
) -> None:
    client, fake = turn_client
    token = await _login(client)
    await _configure(client, token)
    before = {d["id"] for d in await _list_drafts(client, token)}
    fake.script(
        Slow(31, _tool_call("create_draft_transaction", _draft_input(amount=30))),
        _say("never reached"),
    )

    result = await _turn(client, token, "trenta euro")

    assert result["reply"] == "The Assistant gave up on this turn: it took longer than 30 s."
    assert len(fake.calls) == 1
    tail = result["transcript_tail"]
    assert [m["role"] for m in tail] == ["user", "assistant", "user", "assistant"]
    assert tail[2]["content"][0]["type"] == "tool_result"
    assert tail[3]["content"] == [{"type": "text", "text": result["reply"]}]
    # The tool had already run: the Draft stays, as a Draft.
    assert len({d["id"] for d in await _list_drafts(client, token)} - before) == 1


async def test_an_adapter_timeout_yields_the_gave_up_reply(
    turn_client: tuple[AsyncClient, ScriptedAssistantModel],
) -> None:
    client, fake = turn_client
    token = await _login(client)
    await _configure(client, token)
    fake.script(
        _tool_call("create_draft_transaction", _draft_input(amount=30)),
        AssistantProviderTimeout(),
        _say("never reached"),
    )

    result = await _turn(client, token, "trenta euro")

    assert result["reply"] == "The Assistant gave up on this turn: it took longer than 30 s."
    assert len(fake.calls) == 2
    assert [m["role"] for m in result["transcript_tail"]] == ["user", "assistant", "user", "assistant"]


async def test_a_slow_final_answer_is_still_returned(
    turn_client: tuple[AsyncClient, ScriptedAssistantModel],
) -> None:
    client, fake = turn_client
    token = await _login(client)
    await _configure(client, token)
    fake.script(
        _tool_call("create_draft_transaction", _draft_input(amount=30)),
        Slow(40, _say("Spesa 30,00")),
    )

    result = await _turn(client, token, "trenta euro")

    assert result["reply"] == "Spesa 30,00"
    assert len(fake.calls) == 2


# --- A model that never calls a tool ---------------------------------------------


async def test_a_model_that_never_calls_a_tool_cannot_drive_the_assistant(
    turn_client: tuple[AsyncClient, ScriptedAssistantModel],
) -> None:
    client, fake = turn_client
    token = await _login(client)
    await _configure(client, token)
    before = {d["id"] for d in await _list_drafts(client, token)}
    fake.script(_say("I cannot create transactions, but here is a tip: ..."))

    result = await _turn(client, token, "trenta euro all'Esselunga")

    assert result["reply"] == (
        "No Draft was written: this model answered without using the Assistant's tools. "
        "If you named a money movement, this model cannot drive the Assistant: pick "
        "another one in Assistant Settings."
    )
    assert len(fake.calls) == 1
    assert result["transcript_tail"] == [
        {"role": "user", "content": [{"type": "text", "text": "trenta euro all'Esselunga"}]},
        {"role": "assistant", "content": [{"type": "text", "text": result["reply"]}]},
    ]
    assert {d["id"] for d in await _list_drafts(client, token)} == before


async def test_a_text_only_answer_passes_through_once_the_conversation_used_a_tool(
    turn_client: tuple[AsyncClient, ScriptedAssistantModel],
) -> None:
    client, fake = turn_client
    token = await _login(client)
    await _configure(client, token)
    _, transcript = await _create_turn(client, fake, token, amount=30)
    fake.script(_say("No money movement heard."))

    result = await _turn(client, token, "thanks!", transcript)

    assert result["reply"] == "No money movement heard."


# --- Turns per hour -------------------------------------------------------------------


async def test_the_31st_turn_in_an_hour_answers_429_and_another_account_is_unaffected(
    turn_client: tuple[AsyncClient, ScriptedAssistantModel],
) -> None:
    client, fake = turn_client
    token = await _login(client)
    await _configure(client, token)
    for _ in range(30):
        fake.script(_tool_call("create_draft_transaction", _draft_input(amount=1)), _say("ok"))
        await _turn(client, token, "uno")
    calls_before = len(fake.calls)

    response = await client.post(
        "/assistant/turns", json={"transcript": [], "text": "uno"}, headers=_auth(token)
    )

    assert response.status_code == 429, response.text
    assert response.headers["Retry-After"] == "3600"
    assert response.json()["detail"] == (
        "The Assistant's limit of 30 turns per hour is reached, try again in 3600 s."
    )
    assert len(fake.calls) == calls_before

    other = await _login(client)
    await _configure(client, other)
    fake.script(_tool_call("create_draft_transaction", _draft_input(amount=1)), _say("ok"))
    assert (await _turn(client, other, "uno"))["reply"] == "ok"

    # An hour later the window has slid and the first Account turns again.
    _clock(fake).advance(3600)
    fake.script(_tool_call("create_draft_transaction", _draft_input(amount=1)), _say("ok"))
    assert (await _turn(client, token, "uno"))["reply"] == "ok"


async def test_a_turn_that_ran_and_failed_still_counts(
    turn_client: tuple[AsyncClient, ScriptedAssistantModel],
) -> None:
    client, fake = turn_client
    token = await _login(client)
    await _configure(client, token)
    for i in range(29):
        fake.script(_tool_call("create_draft_transaction", _draft_input(amount=1)), _say("ok"))
        await _turn(client, token, "uno")
    fake.script(AssistantKeyRejected())
    await _turn(client, token, "uno")  # the 30th: a turn, even though it failed

    response = await client.post(
        "/assistant/turns", json={"transcript": [], "text": "uno"}, headers=_auth(token)
    )

    assert response.status_code == 429, response.text


async def test_a_refused_turn_is_not_counted(database_url: str) -> None:
    bounds = AssistantBounds(
        turns_per_hour=2, max_tool_steps=8, turn_seconds=30, retry_default_seconds=5
    )
    async with _scripted_app(database_url, bounds=bounds) as (client, fake):
        token = await _login(client)
        await _configure(client, token)
        fake.script(AssistantKeyRejected())
        await _turn(client, token, "uno")  # t=0
        _clock(fake).advance(100)
        fake.script(AssistantKeyRejected())
        await _turn(client, token, "due")  # t=100
        refused = await client.post(
            "/assistant/turns", json={"transcript": [], "text": "tre"}, headers=_auth(token)
        )
        assert refused.status_code == 429, refused.text
        assert refused.headers["Retry-After"] == "3500"

        # At t=3600 only the first turn has aged out: one slot is free. Had
        # the refused attempt been recorded at t=100, there would be none.
        _clock(fake).advance(3500)
        fake.script(AssistantKeyRejected())
        await _turn(client, token, "quattro")
        again = await client.post(
            "/assistant/turns", json={"transcript": [], "text": "cinque"}, headers=_auth(token)
        )
        assert again.status_code == 429, again.text


# --- Bounds are configurable -----------------------------------------------------------


async def test_bounds_come_from_the_app_factory(database_url: str) -> None:
    bounds = AssistantBounds(
        turns_per_hour=2, max_tool_steps=3, turn_seconds=10, retry_default_seconds=1
    )
    async with _scripted_app(database_url, bounds=bounds) as (client, fake):
        token = await _login(client)
        await _configure(client, token)

        # Three tool steps, then the model is asked for a final answer.
        fake.script(
            *[
                _tool_call("create_draft_transaction", _draft_input(amount=i + 1), f"b{i}")
                for i in range(3)
            ],
            _say("Tre bozze."),
        )
        result = await _turn(client, token, "tante")
        assert result["reply"] == "Tre bozze."
        assert [c.tool_choice for c in fake.calls] == ["auto"] * 3 + ["none"]

        # The default retry delay and the turn budget are the app's too.
        fake.script(
            AssistantProviderBusy(),
            Slow(11, _tool_call("create_draft_transaction", _draft_input(amount=9))),
        )
        result = await _turn(client, token, "nove")
        assert _clock(fake).sleeps == [1]
        assert result["reply"] == "The Assistant gave up on this turn: it took longer than 10 s."

        # Two turns per hour: the third is refused.
        response = await client.post(
            "/assistant/turns", json={"transcript": [], "text": "x"}, headers=_auth(token)
        )
        assert response.status_code == 429, response.text


# --- Replies in the Locale -------------------------------------------------------------


async def test_server_replies_are_italian_for_an_italian_account(
    turn_client: tuple[AsyncClient, ScriptedAssistantModel],
) -> None:
    client, fake = turn_client
    token = await _login(client)
    await _configure(client, token)
    await _set_language(client, token, "it")

    fake.script(AssistantKeyRejected())
    assert (await _turn(client, token, "x"))["reply"] == (
        "Il provider ha rifiutato la chiave dell'Assistente: controllala nelle "
        "Impostazioni dell'Assistente."
    )

    fake.script(AssistantProviderBusy(retry_after_seconds=60))
    assert (await _turn(client, token, "x"))["reply"] == (
        "Il provider è occupato, riprova tra 60 s."
    )

    fake.script(Slow(31, _tool_call("create_draft_transaction", _draft_input(amount=1))))
    assert (await _turn(client, token, "x"))["reply"] == (
        "L'Assistente ha rinunciato a questo turno: ha superato i 30 s."
    )

    fake.script(_say("Non posso."))
    assert (await _turn(client, token, "x"))["reply"] == (
        "Nessuna bozza scritta: questo modello ha risposto senza usare gli strumenti "
        "dell'Assistente. Se hai nominato un movimento di denaro, questo modello non può "
        "guidare l'Assistente: scegline un altro nelle Impostazioni dell'Assistente."
    )

    for _ in range(26):
        fake.script(AssistantKeyRejected())
        await _turn(client, token, "x")
    response = await client.post(
        "/assistant/turns", json={"transcript": [], "text": "x"}, headers=_auth(token)
    )
    assert response.status_code == 429, response.text
    # The slow turn above moved the clock, so the wait is a little under an hour.
    assert response.json()["detail"] == (
        "Il limite dell'Assistente di 30 turni all'ora è stato raggiunto, "
        f"riprova tra {response.headers['Retry-After']} s."
    )
    assert 3500 < int(response.headers["Retry-After"]) <= 3600
