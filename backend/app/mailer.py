"""The mailer seam (issue #83): password-reset emails go through the `Mailer`
protocol. Tests inject a fake; production uses `SmtpMailer` when SMTP is
configured, and `LoggingMailer` otherwise (dev posture — the email lands in
the server log so forgot-password keeps working on localhost)."""

import logging
import smtplib
from dataclasses import dataclass
from typing import Protocol

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class EmailMessage:
    to: str
    subject: str
    body: str


class Mailer(Protocol):
    """Sends an email. Implementations may deliver, log, or record."""

    def send(self, message: EmailMessage) -> None: ...


class SmtpMailer:
    """Sends plain-text email through a generic SMTP server (any provider:
    Gmail app passwords, Fastmail, Proton, ...)."""

    def __init__(
        self,
        host: str,
        port: int,
        user: str,
        password: str,
        sender: str,
        tls: bool,
    ) -> None:
        self._host = host
        self._port = port
        self._user = user
        self._password = password
        self._sender = sender
        self._tls = tls

    def send(self, message: EmailMessage) -> None:
        payload = (
            f"From: {self._sender}\r\n"
            f"To: {message.to}\r\n"
            f"Subject: {message.subject}\r\n"
            f"\r\n"
            f"{message.body}"
        )
        with smtplib.SMTP(self._host, self._port, timeout=10) as smtp:
            if self._tls:
                smtp.starttls()
            if self._user:
                smtp.login(self._user, self._password)
            smtp.sendmail(self._sender, [message.to], payload)


class LoggingMailer:
    """Dev fallback when no SMTP host is configured: the message is logged,
    never sent."""

    def send(self, message: EmailMessage) -> None:
        logger.warning(
            "DEV MAILER (no SMTP configured) — to=%s subject=%s\n%s",
            message.to,
            message.subject,
            message.body,
        )
