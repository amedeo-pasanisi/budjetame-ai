"""The provider seam's helpers for the adapters (ADR-0035, issue #129): how
the delay a provider announces on a 429/503 is read from a `Retry-After`
header or a Gemini-shaped `retryDelay` body, and the typed errors' shape.
The turn loop's handling of these errors is tested through HTTP in
`test_assistant_turns.py`; the adapters (issues #130/#131) only map.
"""

from datetime import datetime, timedelta, timezone
from email.utils import format_datetime

import pytest

from app.assistant_seam import (
    AssistantKeyRejected,
    AssistantProviderBusy,
    AssistantProviderTimeout,
    AssistantSeamError,
    retry_after_from_header,
    retry_delay_from_body,
    whole_seconds,
)


@pytest.mark.parametrize(
    ("value", "seconds"),
    [
        (None, None),
        ("", None),
        ("12", 12.0),
        (" 7 ", 7.0),
        ("soon", None),
    ],
)
def test_retry_after_header_in_seconds(value: str | None, seconds: float | None) -> None:
    assert retry_after_from_header(value) == seconds


def test_retry_after_header_as_http_date() -> None:
    later = datetime.now(timezone.utc) + timedelta(seconds=90)
    seconds = retry_after_from_header(format_datetime(later, usegmt=True))
    assert seconds is not None
    assert 85 <= seconds <= 90

    earlier = datetime.now(timezone.utc) - timedelta(seconds=90)
    assert retry_after_from_header(format_datetime(earlier, usegmt=True)) == 0.0


@pytest.mark.parametrize(
    ("body", "seconds"),
    [
        (None, None),
        ({}, None),
        ({"error": {"message": "quota"}}, None),
        ({"retryDelay": "12.5s"}, 12.5),
        ({"error": {"retryDelay": "800ms"}}, 0.8),
        (
            {
                "error": {
                    "code": 429,
                    "details": [
                        {"@type": "type.googleapis.com/google.rpc.ErrorInfo"},
                        {"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "33s"},
                    ],
                }
            },
            33.0,
        ),
        ({"retryDelay": 4}, 4.0),
        ({"retryDelay": "later"}, None),
    ],
)
def test_retry_delay_from_body(body: dict[str, object] | None, seconds: float | None) -> None:
    assert retry_delay_from_body(body) == seconds


def test_whole_seconds_rounds_up_to_at_least_one() -> None:
    assert whole_seconds(0.0) == 1
    assert whole_seconds(0.2) == 1
    assert whole_seconds(12.0) == 12
    assert whole_seconds(12.01) == 13


def test_typed_errors_are_seam_errors_with_their_delay() -> None:
    busy = AssistantProviderBusy("429 from the provider", retry_after_seconds=12.5)
    assert isinstance(busy, AssistantSeamError)
    assert busy.retry_after_seconds == 12.5
    assert AssistantProviderBusy().retry_after_seconds is None
    assert isinstance(AssistantKeyRejected(), AssistantSeamError)
    assert "key" in str(AssistantKeyRejected()).lower()
    assert isinstance(AssistantProviderTimeout(), AssistantSeamError)
