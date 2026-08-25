"""Google sign-in (issue #81): a verifier seam at the auth boundary. The
endpoint depends on the `GoogleVerifier` protocol; tests inject a fake, and
production uses `GoogleIdTokenVerifier`, which delegates signature, issuer,
and audience checks to google-auth's verify_oauth2_token (Google's own
machinery, cached certs included)."""

from dataclasses import dataclass
from typing import Protocol

import google.auth.exceptions
import google.oauth2.id_token
from google.auth.transport import requests as google_auth_requests


@dataclass(frozen=True)
class GoogleIdentity:
    """A verified Google sign-in: the email and whether Google confirmed it
    (`email_verified`)."""

    email: str
    email_verified: bool


class GoogleVerifier(Protocol):
    """Verifies a Google ID token into an identity, or None when invalid."""

    def verify(self, id_token: str) -> GoogleIdentity | None: ...


class GoogleIdTokenVerifier:
    """The real verifier: google-auth checks the token's signature against
    Google's certs, its audience against our client id, and its issuer.
    Returns None for any invalid token (expired, forged, wrong audience)."""

    def __init__(self, client_id: str) -> None:
        self._client_id = client_id

    def verify(self, id_token: str) -> GoogleIdentity | None:
        if self._client_id == "":
            return None
        try:
            info = google.oauth2.id_token.verify_oauth2_token(
                id_token, google_auth_requests.Request(), audience=self._client_id
            )
        except (ValueError, google.auth.exceptions.GoogleAuthError):
            return None
        return GoogleIdentity(
            email=info.get("email", ""),
            email_verified=bool(info.get("email_verified", False)),
        )
