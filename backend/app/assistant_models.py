"""`GET /assistant/models` (ADR-0035, issues #122 and #127): the models of
the Account's configured provider, or of the provider named in the query,
for the Settings picker.

A listing may need a key before one is saved (Gemini lists only with a
key), so the client can send the key it is about to save in the
`X-Assistant-Key` header. A header rather than the query string: uvicorn's
access log prints the path and the query, never a header. No key is logged
or echoed; which key reaches the provider is the service's rule.

Errors are never 500s. No settings, or no key where the listing needs one,
is a 409 — the status #122 fixes for the Assistant without its settings;
a provider rejecting the key is a 422 whose detail points at the key in
Settings, like every rule error; a catalogue that cannot be read is a 502.
"""

from fastapi import APIRouter, Depends, Header, HTTPException, Query

from app.assistant_catalogue import (
    CatalogueFetcher,
    CatalogueKeyRejected,
    CatalogueUnavailable,
)
from app.auth import get_current_account
from app.deps import get_assistant_key_secret, get_catalogue_fetcher
from app.models import Account, AssistantProvider
from app.schemas import AssistantModelOut, AssistantModelsOut
from app.services.assistant_models import (
    AssistantModelsKeyRequired,
    AssistantModelsNoSettings,
    list_assistant_models,
)

router = APIRouter(prefix="/assistant", tags=["assistant"])


@router.get("/models", response_model=AssistantModelsOut)
def list_models(
    provider: AssistantProvider | None = Query(default=None),
    key_header: str | None = Header(default=None, alias="X-Assistant-Key"),
    account: Account = Depends(get_current_account),
    secret: str = Depends(get_assistant_key_secret),
    fetcher: CatalogueFetcher = Depends(get_catalogue_fetcher),
) -> AssistantModelsOut:
    """The picker's list. Without `provider` the Account's configured one
    is listed (409 when there is none)."""
    try:
        listed, models = list_assistant_models(
            account, provider=provider, sent_key=key_header, secret=secret, fetcher=fetcher
        )
    except (AssistantModelsNoSettings, AssistantModelsKeyRequired) as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except CatalogueKeyRejected as error:
        raise HTTPException(
            status_code=422,
            detail="The provider rejected the Assistant Key: check the key in Settings",
        ) from error
    except CatalogueUnavailable as error:
        raise HTTPException(
            status_code=502,
            detail="The provider's model list is unavailable right now: type a model id or try again later",
        ) from error
    return AssistantModelsOut(
        provider=listed, models=[AssistantModelOut.model_validate(m) for m in models]
    )
