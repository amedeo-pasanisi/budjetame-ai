"""The fixed provider table of the Assistant (ADR-0035, issues #126, #127).

Adding a provider that speaks the OpenAI chat-completions shape is one row
here — never a user-entered URL: the server only ever sends an Account's
Assistant Key to a host this table names. Anthropic has no `base_url`: its
adapter (issue #128) is native.

The row also says how the provider's models are listed for the Settings
picker (issue #127): from `fixed_models` when there is no listing endpoint
we use, else through `{base_url}/models` in one of two shapes, with or
without the key. The rules per shape live in
`app.services.assistant_models`; this table only names which apply.
"""

import enum
from dataclasses import dataclass

from app.models import AssistantProvider


@dataclass(frozen=True)
class CatalogueModel:
    """One model of the picker: the id the Assistant Settings store, a
    label for the list, and whether the provider prices it at zero."""

    id: str
    label: str
    free: bool = False


class CatalogueShape(str, enum.Enum):
    """How a provider's `/models` listing is read (issue #127)."""

    # OpenRouter's public catalogue: `supported_parameters` and `pricing`
    # per entry, so the list can be kept to tool-capable models and the
    # free ones flagged.
    OPENROUTER = "openrouter"
    # The plain OpenAI `/models` shape: ids only, as Gemini's compatible
    # endpoint lists them.
    OPENAI = "openai"


@dataclass(frozen=True)
class ProviderSpec:
    id: AssistantProvider
    label: str
    # The model used when the Account sets no model, or switches provider.
    default_model: str
    # The OpenAI-compatible base URL, or None for the native Anthropic adapter.
    base_url: str | None
    # The picker's list when the provider is not listed through the network
    # (Anthropic): the current ids, in the order the picker shows them.
    fixed_models: tuple[CatalogueModel, ...] = ()
    # The shape of `{base_url}/models`, None when `fixed_models` is the list.
    catalogue_shape: CatalogueShape | None = None
    # Whether the listing needs the Assistant Key (Gemini) or is public.
    catalogue_needs_key: bool = False


PROVIDERS: dict[AssistantProvider, ProviderSpec] = {
    AssistantProvider.ANTHROPIC: ProviderSpec(
        id=AssistantProvider.ANTHROPIC,
        label="Anthropic",
        default_model="claude-opus-5-5",
        base_url=None,
        fixed_models=(
            CatalogueModel(id="claude-opus-5-5", label="Claude Opus 5.5"),
            CatalogueModel(id="claude-sonnet-5-5", label="Claude Sonnet 5.5"),
            CatalogueModel(id="claude-haiku-5-5", label="Claude Haiku 5.5"),
        ),
    ),
    AssistantProvider.OPENROUTER: ProviderSpec(
        id=AssistantProvider.OPENROUTER,
        label="OpenRouter",
        default_model="nvidia/nemotron-nano-9b-v2:free",
        base_url="https://openrouter.ai/api/v1",
        catalogue_shape=CatalogueShape.OPENROUTER,
    ),
    AssistantProvider.GEMINI: ProviderSpec(
        id=AssistantProvider.GEMINI,
        label="Google Gemini",
        default_model="gemini-4-hydrogen",
        base_url="https://generativelanguage.googleapis.com/v1beta/openai",
        catalogue_shape=CatalogueShape.OPENAI,
        catalogue_needs_key=True,
    ),
}


def provider_spec(provider: AssistantProvider | str) -> ProviderSpec:
    """The table row for a provider id; KeyError for one outside the list
    (the wire schema already rejects those with a 422)."""
    return PROVIDERS[AssistantProvider(provider)]
