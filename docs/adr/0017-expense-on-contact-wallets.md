# Expenses on Contact Wallets

Recording "someone paid for my consumption" (Chiara buys me an ice cream for €5, so I owe her €5) previously forced a fiction: because Contact Wallets could only move money via Transfers, the event needed two Transactions — a Transfer from the contact into a wallet, then an Expense out of it — describing a cash movement that never happened. We now allow an Expense whose Wallet is a Contact Wallet: one Transaction records the consumption on its day, moves the contact's balance toward zero or negative, and Net Worth reflects the debt immediately. The rule is deliberately asymmetric — Incomes on Contact Wallets stay forbidden: an Income on a contact would raise both the balance and Net Worth with no money movement and no real-world event behind it, because money coming in from a contact is always a Transfer (repayment) and a gift is an Income on the user's own Wallet. Repayment of the debt remains a Transfer and never changes Net Worth, and the signed balance (−€5.00) stays the only owe-direction indicator — no labels were added.

## Considered Options

- **Two-step Transfer + Expense (status quo)** — rejected as a fiction: no money moved between the user and the contact, and a full ice-cream lifecycle needed three Transactions.
- **Expense at repayment** — rejected: Net Worth overstates until repayment, the consumption lands in the wrong month, and the debt itself is never tracked.
- **Balance-sign restriction** (Expense on a Contact Wallet only when the balance is zero or negative) — rejected: a positive balance shrinking (Marco owes me €50, he buys me a coffee → €47) is the same real event reaching the same end state as the two-step, so a restriction would only force the fiction back.

## Consequences

- An Expense on a Contact Wallet is allowed whatever the balance sign: positive balances shrink, negative ones grow.
- The two-step path remains valid — it describes a different real event (the contact handed the user cash).
- The backend guard ("Contact Wallets only participate in Transfers") and the form's helper text must change; the Income picker still filters Contact Wallets out.
