"""The Assistant model catalogue (ADR-0035, issues #122 and #127): the
models an Account can pick for a provider, as the picker shows them.

The provider table says how each provider lists (`fixed_models`, or a
`catalogue_shape` through `{base_url}/models`, with or without the key);
the rules per shape live here, above the raw `CatalogueFetcher` seam, so
the HTTP tests run them for real on scripted payloads:

- OpenRouter's shape: the public catalogue (no key), kept to the entries
  whose `supported_parameters` contain `tools` — the one capability the app
  vets (ADR-0035) — with `free` set when the prompt and completion prices
  are both zero.
- The plain OpenAI shape (Gemini): the models the key can list, ids with
  the leading `models/` stripped so they match what the chat endpoint
  expects. No prices are published there, so nothing is flagged free.

Listings from the network are sorted by label, case-insensitively: a
picker over a few hundred OpenRouter rows is unusable in catalogue order.

Which key goes to the listing is a rule of this module too: the key the
client sends for a listing before Save, else the Account's stored key only
when it belongs to the requested provider — a key is never sent to a
provider it was not entered for.
"""

from collections.abc import Callable
from decimal import Decimal, InvalidOperation
from typing import Any

from app.assistant_catalogue import CatalogueFetcher
from app.assistant_providers import CatalogueModel, CatalogueShape, provider_spec
from app.models import Account, AssistantProvider
from app.services.assistant_settings import assistant_key_for


class AssistantModelsNoSettings(Exception):
    """No provider was asked for and the Account has none configured: the
    handler maps it to a 409, as #122 fixes for the Assistant without
    settings."""


class AssistantModelsKeyRequired(Exception):
    """The provider lists models only with a key, and none is at hand: the
    handler maps it to a 409 with the message as detail."""


def list_assistant_models(
    account: Account,
    *,
    provider: AssistantProvider | None,
    sent_key: str | None,
    secret: str,
    fetcher: CatalogueFetcher,
) -> tuple[AssistantProvider, list[CatalogueModel]]:
    """The picker's list for `provider`, or for the Account's configured
    one when None. `sent_key` is a key the client sends for a listing
    before saving it; it wins over the stored key. Raises the fetcher's
    `CatalogueKeyRejected` / `CatalogueUnavailable` untouched."""
    if provider is None:
        if account.assistant_provider is None:
            raise AssistantModelsNoSettings("No Assistant Settings: choose a provider first")
        provider = AssistantProvider(account.assistant_provider)
    key = (sent_key or "").strip() or None
    if key is None and account.assistant_provider == provider.value:
        key = assistant_key_for(account, secret)

    spec = provider_spec(provider)
    if spec.catalogue_shape is None or spec.base_url is None:
        return provider, list(spec.fixed_models)
    if spec.catalogue_needs_key and key is None:
        raise AssistantModelsKeyRequired(
            f"{spec.label} lists its models with a key: enter the Assistant Key first"
        )
    entries = fetcher.fetch_models(spec.base_url, key if spec.catalogue_needs_key else None)
    parse = _PARSERS[spec.catalogue_shape]
    models = [m for m in (parse(e) for e in entries) if m is not None]
    return provider, sorted(models, key=lambda m: m.label.casefold())


def _openrouter_model(entry: dict[str, Any]) -> CatalogueModel | None:
    """One catalogue entry as a picker model, or None when it has no id or
    cannot call tools. A missing or unparsable price is not free."""
    model_id = entry.get("id")
    parameters = entry.get("supported_parameters")
    if not isinstance(model_id, str) or model_id == "":
        return None
    if not isinstance(parameters, list) or "tools" not in parameters:
        return None
    name = entry.get("name")
    label = name if isinstance(name, str) and name != "" else model_id
    pricing = entry.get("pricing")
    free = (
        isinstance(pricing, dict)
        and _is_zero(pricing.get("prompt"))
        and _is_zero(pricing.get("completion"))
    )
    return CatalogueModel(id=model_id, label=label, free=free)


def _is_zero(price: Any) -> bool:
    if isinstance(price, bool) or price is None:
        return False
    try:
        return Decimal(str(price)) == 0
    except InvalidOperation:
        return False


def _openai_model(entry: dict[str, Any]) -> CatalogueModel | None:
    """One `/models` entry as a picker model: the id without its `models/`
    prefix, doubling as the label. None without an id."""
    model_id = entry.get("id")
    if not isinstance(model_id, str) or model_id == "":
        return None
    model_id = model_id.removeprefix("models/")
    return CatalogueModel(id=model_id, label=model_id, free=False)


_PARSERS: dict[CatalogueShape, Callable[[dict[str, Any]], CatalogueModel | None]] = {
    CatalogueShape.OPENROUTER: _openrouter_model,
    CatalogueShape.OPENAI: _openai_model,
}
