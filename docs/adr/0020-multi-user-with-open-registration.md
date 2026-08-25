# Multi-user with open registration

The app was single-user by design (ADR-0003): one seeded Account, no registration path. It now serves many Accounts — open email+password registration plus Google sign-in (which auto-provisions an Account on first sign-in), password reset via SMTP, and self-service Account deletion. Fresh Accounts start empty, and the seeded dev Account remains as an ordinary one among many. ADR-0003's scoping discipline is vindicated rather than discarded: every query was already scoped by account id with 403s for foreign data, so per-user isolation was already enforced — only the registration surface was missing.

**Status**: accepted. Supersedes ADR-0003.
