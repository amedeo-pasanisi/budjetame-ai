# Form validation is submit-and-validate with inline field errors, hand-rolled without a form library

The multi-field forms (Transaction, Recurring Cost/Income, Category, Wallet, Import row) disabled their Save button until a per-form boolean expression (`canSave`/`hasAmount`/`!name.trim()`) flipped true — so a user with one wrong field (e.g. an Italian-locale browser swallowing `17.5` typed into a `type="number"` amount field) got no explanation why Save was dead. We replaced the disabled-until-valid pattern with **submit-and-validate**: Save is always clickable and, on a failed validation, reveals a Field Error inline under each wrong field and submits nothing.

**The policy, agreed at grilling:**

- **Save is disabled only for in-flight work** — `submitting`, and per-form busy flags (GPS locating, Places lookup, occurrence toggles) — never for validation. Validation no longer lives in the button's `disabled` prop.
- **Two error kinds stay separate.** Field Errors (client-side, computable instantly) render inline beneath their field. Server rejections (duplicate name, merge collisions, rule errors like a no-longer-qualifying Transfer link) keep the existing form-level error banner — a validation layer cannot know them without an HTTP round-trip.
- **Field Errors update only on the next Save attempt** (no live re-validation while typing, no on-blur): an error stays under a field until Save is clicked again and the form passes.
- **Frozen/read-only and auth forms are untouched.** LoginForm and ResetPassword keep their behavior; Recurring forms' frozen-mode rendering is unchanged; ImportRowModal is in scope.
- **The silent Contact-wallet reset becomes a Field Error.** Switching an Expense on a Contact Wallet to Income no longer silently swaps the wallet to the first spendable one (`useEffect` reset); the picker keeps the selection and shows "Incomes can't be recorded on contact wallets." under the Wallet field.
- **`noValidate` on every entity form, money fields become `<input type="text" inputMode="decimal">`.** The root cause of the original bug was the *browser* parsing `type="number"` in the OS locale (Italian comma) — the browser silently dropped the typed dot, and the form never learned about it. Taking parsing away from the browser is the actual fix; `noValidate` stops the browser's own bubbles from fighting the inline errors.

**Money entry tolerance (the `17.5`/`17,5` fix):** amounts parse with **last-separator-wins**: the final `,` or `.` is the decimal point, earlier ones are thousands groupings; a lone separator with exactly three digits after it is a thousands grouping. So `17.5`, `17,5`, `2,002.01` (`2002.01`), `1.000.420,45` (`1,000,420.45`), `1.000` (`1,000`), and `1.000,00` (`1,000.00`) all parse. Display, storage, and export stay US-canonical (`1,000,420.45`) until i18n adds per-locale display — the tolerant parser is kept as-is then, since it already understands both styles.

**Implementation: zero new dependencies.** No zod, no React Hook Form. Each of the six forms gets a small pure `validate()` function returning `Record<field, string>` (a declared `FieldError` type), and the forms share a tiny `<FieldError>` render helper wired with `aria-invalid`/`aria-describedby`. The validation logic is plain TypeScript predicates (`> 0`, `≥ 1`, `source !== destination`, `name.trim() !== ''`, date present) — none of zod's nesting/union powers are exercised at this scale, and the interesting parts (server errors, merge offers, freeze confirmations, the type cascade) live outside any validation library anyway.

## Considered Options

- **Keep disabled-until-valid, add a "why" hint** — rejected: the 17.5 case proved the button itself is the puzzle; a user can't discover a reason for a disabled control, and the browser-owned parsing made even a message impossible to align with what the user sees.
- **Validate live (on-change/on-blur) with inline errors** — rejected: live errors on untouched forms feel hostile; agreed to reveal errors only on a Save attempt, refresh only on the next.
- **zod / React Hook Form + zodResolver** — rejected: adds the project's first non-UI dependencies to re-implement the same six `canSave` predicates, forces `Controller` wrappers around custom controls (`EntitySelect`'s "＋ Add" sentinels, MapPicker), and would rewrite the existing per-form `.test.tsx` suites. The hand-rolled layer is ~50 lines.
- **Strict US input (reject `17,5`, `1.000.420,45`)** — rejected: it rejects the very comma-decimal habit that started this ticket (the reporter types Italian-style); tolerance costs nothing to display/storage/exports, which stay US.
- **Read a lone separator as always-decimal** — rejected: `1.000` would parse to 1.00 instead of 1,000; no realistic money amount has three decimals, so a lone separator with exactly three trailing digits is treated as grouping.

## Consequences

- All six entity forms change their Save-button `disabled` to in-flight-only and render per-field errors; the existing `.test.tsx` suites rename/extend their "button disabled when X" assertions to "Save reveals 'X' under the field".
- Money inputs become text fields with `inputMode="decimal"`; their `min`/`step`/`required` attributes lose meaning (validation is ours now), kept only as a11y hints. WalletForm's Opening balance inherits the tolerant parser.
- The TransactionForm Expense→Income Contact-wallet `useEffect` reset is deleted; the Wallet field gains the "Incomes can't be recorded on contact wallets." Field Error (the Expense/Income wallet filtering at ADR-0017 is unchanged — the rule is enforced at Save, not by swapping).
- Future i18n only changes how amounts are *displayed* and which keyboard hint is shown; the parser already accepts both separators.