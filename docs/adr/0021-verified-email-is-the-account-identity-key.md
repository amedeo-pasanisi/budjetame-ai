# Verified email is the Account's identity key

A Google sign-in whose verified email matches an existing password Account enters that Account — the email is the single identity key, and password and Google are two doors into the same data. Keying identity on Google's `sub` instead would silently fork one person into two Accounts when they register with email and later click Google; blocking the Google sign-in protected the database but locked the user out of Google sign-in forever. Linking is safe because Google has already verified ownership of the email — the same proof a password reset relies on.

**Status**: accepted.
