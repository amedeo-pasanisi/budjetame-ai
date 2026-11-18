"""The fixed provider table of the Assistant (ADR-0035, issue #126).

Adding a provider that speaks the OpenAI chat-completions shape is one row
here — never a user-entered URL: the server only ever sends an Account's
Assistant Key to a host this table names. Anthropic has no `base_url`: its
adapter (issue #128) is native.
"""

from dataclasses import dataclass

from app.models import AssistantProvider


@dataclass(frozen=True)
class ProviderSpec:
    id: AssistantProvider
    label: str
    # The model used when the Account sets no model, or switches provider.
    default_model: str
    # The OpenAI-compatible base URL, or None for the native Anthropic adapter.
    base_url: str | None


PROVIDERS: dict[AssistantProvider, ProviderSpec] = {
    AssistantProvider.ANTHROPIC: ProviderSpec(
        id=AssistantProvider.ANTHROPIC,
        label="Anthropic",
        default_model="claude-opus-5-5",
        base_url=None,
    ),
    AssistantProvider.OPENROUTER: ProviderSpec(
        id=AssistantProvider.OPENROUTER,
        label="OpenRouter",
        default_model="nvidia/nemotron-nano-9b-v2:free",
        base_url="https://openrouter.ai/api/v1",
    ),
    AssistantProvider.GEMINI: ProviderSpec(
        id=AssistantProvider.GEMINI,
        label="Google Gemini",
        default_model="gemini-4-hydrogen",
        base_url="https://generativelanguage.googleapis.com/v1beta/openai",
    ),
}


def provider_spec(provider: AssistantProvider | str) -> ProviderSpec:
    """The table row for a provider id; KeyError for one outside the list
    (the wire schema already rejects those with a 422)."""
    return PROVIDERS[AssistantProvider(provider)]
