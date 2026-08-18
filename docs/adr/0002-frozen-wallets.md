# Deleted wallets are frozen, not editable

Deleting a Wallet (allowed only at balance €0) hides it from the UI but keeps it and its Transactions in the database; neither the wallet nor its transactions can be changed afterwards. Freezing prevents a retroactive edit to a deleted wallet's history from making its balance nonzero, which would silently change Net Worth through a wallet that was supposed to be gone (US 6.1 sums "all wallets, including deleted ones"). "Deleted" therefore means "archived".

---

*Amended (issue #48):* unfreezing was added as an explicit user action, restoring a Frozen Wallet to active. The rationale above still holds — freezing remains the only archive path; the write-lock stands until the user chooses to unfreeze.
