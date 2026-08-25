# Single-user app, data scoped by account anyway

**Status**: superseded by ADR-0020 (multi-user with open registration).

The app has exactly one Account, seeded at setup; there is no registration path. Even so, every query is scoped by account id and the API returns 403 for foreign data (US 1.3). The scoping is cheap today and keeps a multi-user future open without building registration now. Do not remove it as "dead code".
