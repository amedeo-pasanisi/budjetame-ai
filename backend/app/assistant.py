"""The Assistant turn endpoint (ADR-0035, issues #122/#128):
`POST /assistant/turns`, stateless, running the tool loop server-side
through the provider seam with the Account's provider, model and Assistant
Key. The clients (the web modal, issue #132; the Android app) are thin chat
screens that carry the transcript.

Request body::

    {
      "transcript": [<message>, ...],   // as last received, [] for a new conversation
      "text": "ho speso 30 euro all'Esselunga con la carta"
    }

Response body::

    {
      "reply": "Spesa 30,00 € oggi Carta / Cibo: Esselunga",
      "transcript_tail": [<message>, ...]
    }

A message is ``{"role": "user" | "assistant", "content": [<block>, ...]}``
with three block shapes:

- ``{"type": "text", "text": "..."}``
- ``{"type": "tool_call", "id": "...", "name": "create_draft_transaction",
  "input": {...}}`` (assistant only)
- ``{"type": "tool_result", "tool_call_id": "...", "content": "...",
  "is_error": false}`` (user only; the content is the tool's JSON, or the
  rule message when ``is_error`` is true)

The tail begins with the user message built from ``text`` and holds every
message appended this turn, so the next request's ``transcript`` is the
previous one followed by the tail, unchanged. The client never builds a
message itself; it renders the text blocks and may show the tool blocks as
activity. A new conversation is an empty transcript: only the Drafts whose
creation the transcript records can be updated or discarded by the model.

Statuses: 401 without a session; 409 without Assistant Settings (the
clients hide the Assistant); 422 for a malformed body; 501 when no adapter
exists for the Account's provider yet; 502 when the provider could not
answer (issue #129 turns the typed provider failures into replies).
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.assistant_seam import (
    AssistantAdapterMissing,
    AssistantModelFactory,
    AssistantSeamError,
)
from app.auth import get_current_account
from app.deps import get_assistant_key_secret, get_assistant_model_factory, get_session
from app.models import Account
from app.schemas import AssistantTurnIn, AssistantTurnOut
from app.services.assistant import AssistantNotConfigured, model_for_account, run_turn

router = APIRouter(prefix="/assistant/turns", tags=["assistant"])


@router.post("", response_model=AssistantTurnOut)
def turn(
    payload: AssistantTurnIn,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
    secret: str = Depends(get_assistant_key_secret),
    factory: AssistantModelFactory = Depends(get_assistant_model_factory),
) -> AssistantTurnOut:
    """One user turn: the written reply and the transcript tail."""
    try:
        model = model_for_account(account, secret=secret, factory=factory)
    except AssistantNotConfigured as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except AssistantAdapterMissing as error:
        raise HTTPException(status_code=501, detail=str(error)) from error
    try:
        result = run_turn(
            session, account, model=model, transcript=payload.transcript, text=payload.text
        )
    except AssistantSeamError as error:
        raise HTTPException(status_code=502, detail=f"Assistant provider error: {error}") from error
    return AssistantTurnOut(reply=result.reply, transcript_tail=result.transcript_tail)
