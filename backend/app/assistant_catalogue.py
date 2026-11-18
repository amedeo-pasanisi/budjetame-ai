"""The catalogue seam of the Assistant (ADR-0035, issues #122 and #127):
one HTTP call, "GET `{base_url}/models` with an optional bearer key, give
me the `data` array", behind a protocol the app factory injects like the
mailer and the Google verifier. Production uses `HttpCatalogueFetcher`;
tests inject a scripted fake, so no test touches the network.

The seam is deliberately raw: it returns the provider's entries as sent,
and the rules that turn them into the picker's list (OpenRouter's `tools`
filter and free flag, Gemini's `models/` prefix) live above it in
`app.services.assistant_models`, where the HTTP tests exercise them.

The key passes through here and nowhere else: nothing in this module logs
it, and the errors it raises carry the URL and the status, never a header.
The adapters of the turn endpoint (issues #130 and #131) may follow the same
conventions: httpx, a bearer header, a short timeout, upstream failures
mapped to typed exceptions rather than surfacing as 500s.
"""

from typing import Any, Protocol

import httpx

_TIMEOUT_SECONDS = 10.0


class CatalogueKeyRejected(Exception):
    """The provider refused the Assistant Key while listing its models."""


class CatalogueUnavailable(Exception):
    """The provider's catalogue could not be read: unreachable, an error
    status, or a body that is not the expected `{"data": [...]}`."""


class CatalogueFetcher(Protocol):
    """`GET {base_url}/models` as the provider's raw `data` entries."""

    def fetch_models(self, base_url: str, key: str | None) -> list[dict[str, Any]]:
        """The entries of the provider's `/models` listing. `key` is sent as
        a bearer token when given (Gemini lists only with one; OpenRouter's
        catalogue is public). Raises `CatalogueKeyRejected` when the provider
        refuses the key and `CatalogueUnavailable` for every other failure."""
        ...


class HttpCatalogueFetcher:
    """The real fetcher: one synchronous httpx GET with a short timeout
    (the handler runs in FastAPI's threadpool, so it never blocks the loop).

    A 401 or 403 is a rejected key. Gemini's OpenAI-compatible endpoint
    answers an invalid key with a 400 whose body names the API key, so a
    400 mentioning one counts as rejected too; any other error status, a
    network failure or an unexpected body is "unavailable"."""

    def __init__(self, timeout_seconds: float = _TIMEOUT_SECONDS) -> None:
        self._timeout = timeout_seconds

    def fetch_models(self, base_url: str, key: str | None) -> list[dict[str, Any]]:
        url = f"{base_url}/models"
        headers = {"Authorization": f"Bearer {key}"} if key else {}
        try:
            response = httpx.get(url, headers=headers, timeout=self._timeout)
        except httpx.HTTPError as error:
            raise CatalogueUnavailable(f"could not reach {url}") from error
        if response.status_code in (401, 403):
            raise CatalogueKeyRejected()
        if response.status_code == 400 and "api key" in response.text.lower():
            raise CatalogueKeyRejected()
        if response.status_code >= 400:
            raise CatalogueUnavailable(f"{url} answered {response.status_code}")
        try:
            body = response.json()
        except ValueError as error:
            raise CatalogueUnavailable(f"{url} answered with a body that is not JSON") from error
        data = body.get("data") if isinstance(body, dict) else None
        if not isinstance(data, list):
            raise CatalogueUnavailable(f"{url} answered without a data array")
        return [entry for entry in data if isinstance(entry, dict)]
