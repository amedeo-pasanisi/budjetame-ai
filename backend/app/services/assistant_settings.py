"""Assistant Settings (ADR-0035, issue #126): the per-Account provider,
model and Assistant Key, with the key encrypted at rest.

The key is encrypted with AES-256-GCM under a key derived (SHA-256) from the
server's `assistant_key_secret`; the stored form is base64(nonce ||
ciphertext || tag). A fresh random nonce per write means replacing a key with
the same value still produces a different row. A row encrypted under another
secret — the secret was lost or rotated — fails authentication on decrypt
and reads as "no key": `assistant_key_for` returns None and the status
reports not configured, so the Account re-enters its key rather than hitting
an error.

Nothing in this module logs, and no function returns the key except
`assistant_key_for`, the one seam the turn endpoint (issue #128) decrypts
through for a single request.
"""

import base64
import hashlib
import os
from dataclasses import dataclass

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy.orm import Session

from app.assistant_providers import provider_spec
from app.models import Account, AssistantProvider

_NONCE_BYTES = 12


class AssistantSettingsRuleError(Exception):
    """A rule violation the handler maps to a 422 with the message as detail."""


def _aead(secret: str) -> AESGCM:
    return AESGCM(hashlib.sha256(secret.encode("utf-8")).digest())


def encrypt_key(key: str, secret: str) -> str:
    """The stored form of an Assistant Key under `secret`."""
    nonce = os.urandom(_NONCE_BYTES)
    ciphertext = _aead(secret).encrypt(nonce, key.encode("utf-8"), None)
    return base64.b64encode(nonce + ciphertext).decode("ascii")


def decrypt_key(stored: str, secret: str) -> str | None:
    """The Assistant Key behind a stored form, or None when `secret` is not
    the secret it was encrypted under (or the value is not a stored form)."""
    try:
        raw = base64.b64decode(stored, validate=True)
        nonce, ciphertext = raw[:_NONCE_BYTES], raw[_NONCE_BYTES:]
        return _aead(secret).decrypt(nonce, ciphertext, None).decode("utf-8")
    except (ValueError, InvalidTag):
        return None


def assistant_key_for(account: Account, secret: str) -> str | None:
    """The Account's Assistant Key for one request (issue #128 reads the
    provider, the model and this). None when no key is stored or the stored
    one was encrypted under another secret."""
    if account.assistant_key_encrypted is None:
        return None
    return decrypt_key(account.assistant_key_encrypted, secret)


@dataclass(frozen=True)
class AssistantSettingsStatus:
    """What the API reports about the settings: never the key itself."""

    configured: bool
    provider: str | None
    model: str | None
    last4: str | None


def assistant_settings_status(account: Account, secret: str) -> AssistantSettingsStatus:
    """`configured` means a key is stored *and* readable under `secret`;
    the provider and model are reported as stored either way, so an Account
    whose key became unreadable sees what it chose and re-enters only the key."""
    key = assistant_key_for(account, secret)
    return AssistantSettingsStatus(
        configured=key is not None,
        provider=account.assistant_provider,
        model=account.assistant_model,
        last4=key[-4:] if key is not None else None,
    )


def set_assistant_settings(
    session: Session,
    account: Account,
    *,
    provider: AssistantProvider,
    key: str,
    model: str | None,
    secret: str,
) -> AssistantSettingsStatus:
    """Set or replace the Account's Assistant Settings in one step: the
    provider, the key and the model. An empty model means the provider's
    default; switching provider therefore resets the model unless the call
    names one. The key is encrypted before it touches the session."""
    key = key.strip()
    if key == "":
        raise AssistantSettingsRuleError("The Assistant Key cannot be empty")
    model = (model or "").strip() or provider_spec(provider).default_model
    account.assistant_provider = provider.value
    account.assistant_model = model
    account.assistant_key_encrypted = encrypt_key(key, secret)
    session.commit()
    return assistant_settings_status(account, secret)


def remove_assistant_settings(session: Session, account: Account) -> None:
    """Clear the provider, the model and the key together. Idempotent."""
    account.assistant_provider = None
    account.assistant_model = None
    account.assistant_key_encrypted = None
    session.commit()
