"""Assistant Settings endpoints (ADR-0035, issue #126): set/replace, remove
and status for the Account's provider, Assistant Key and model.

The key goes in through PUT and never comes back: every response is the
status shape (`configured`, `provider`, `model`, `last4`). The rule error
(an empty key) is a 422 whose detail is the message, like every other
resource. The body is validated by hand in the handler rather than as a
typed parameter: FastAPI's own 422 echoes the offending `input` — for a
missing `provider` that is the whole body, key included — so the handler
reports the errors without it.
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.auth import get_current_account
from app.deps import get_assistant_key_secret, get_session
from app.models import Account
from app.schemas import AssistantSettingsIn, AssistantSettingsOut
from app.services.assistant_settings import (
    AssistantSettingsRuleError,
    assistant_settings_status,
    remove_assistant_settings,
    set_assistant_settings,
)

router = APIRouter(prefix="/assistant/settings", tags=["assistant"])


@router.get("", response_model=AssistantSettingsOut)
def get_status(
    account: Account = Depends(get_current_account),
    secret: str = Depends(get_assistant_key_secret),
) -> AssistantSettingsOut:
    """Whether the Account's Assistant is configured, on which provider and
    model, and the last four characters of its key — nothing more. A key
    stored under another secret reads as not configured."""
    return AssistantSettingsOut.model_validate(assistant_settings_status(account, secret))


async def _parse_settings(request: Request) -> AssistantSettingsIn:
    """The PUT body as `AssistantSettingsIn`, or a 422 whose errors carry
    the location and message but never the input (which holds the key)."""
    try:
        body = await request.json()
    except ValueError as error:
        raise HTTPException(status_code=422, detail="Malformed JSON body") from error
    try:
        return AssistantSettingsIn.model_validate(body)
    except ValidationError as error:
        errors: list[dict[str, Any]] = [
            {"loc": list(e["loc"]), "msg": e["msg"], "type": e["type"]} for e in error.errors()
        ]
        raise HTTPException(status_code=422, detail=errors) from error


@router.put("", response_model=AssistantSettingsOut)
async def set_or_replace(
    request: Request,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
    secret: str = Depends(get_assistant_key_secret),
) -> AssistantSettingsOut:
    """Set or replace the provider, the key and the model in one call — one
    setting per Account. No model means the provider's default, so switching
    provider resets it."""
    payload = await _parse_settings(request)
    try:
        result = set_assistant_settings(
            session,
            account,
            provider=payload.provider,
            key=payload.key,
            model=payload.model,
            secret=secret,
        )
    except AssistantSettingsRuleError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return AssistantSettingsOut.model_validate(result)


@router.delete("", status_code=204)
def remove(
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> Response:
    """Remove the Assistant Settings: provider, key and model together. The
    Account then has no Assistant (ADR-0035)."""
    remove_assistant_settings(session, account)
    return Response(status_code=204)
