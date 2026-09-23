/** The shared validation layer (ADR-0029): the tolerant Amount Input parser,
 * the FieldErrors type and the aria wiring for Field Errors. Every entity
 * form consumes this module instead of re-implementing any of it — the
 * umbrella (issue #101) splits into six per-form validators that all build
 * on the pieces here. The Field Error render helper lives in the sibling
 * `FieldError.tsx` (component modules stay separate for Fast Refresh).
 */

/**
 * The message for one invalid form field, keyed by the field's control id,
 * so a form can mail the right message to the right field. A form's
 * `validate()` returns one of these; the Field Error render helper displays
 * it beneath its field. Server rejections (duplicate names, merge
 * collisions) are not Field Errors — they keep the form-level error banner.
 */
export type FieldErrors = Record<string, string>

/**
 * The id of a field's error element, `${field}-error`. The Field Error
 * render helper gives the message this id, and `fieldErrorProps` points the
 * field's `aria-describedby` at it — the two halves can never drift because
 * both derive the id the same way.
 */
export function fieldErrorId(field: string): string {
  return `${field}-error`
}

/**
 * The aria wiring for one field, spread onto its control: `aria-invalid`
 * and `aria-describedby` pointing at the field's error element — but only
 * when the field has an error, so a valid form carries no error aria at
 * all.
 */
export function fieldErrorProps(
  field: string,
  errors: FieldErrors,
): { 'aria-invalid'?: true; 'aria-describedby'?: string } {
  if (errors[field] === undefined) return {}
  return { 'aria-invalid': true, 'aria-describedby': fieldErrorId(field) }
}

/**
 * Parse a user-typed money amount per the Amount Input contract (ADR-0029)
 * — the last `.` or `,` is the decimal point, earlier ones are thousands
 * groupings, and a lone separator followed by exactly three digits is a
 * thousands grouping. So `17.5`, `17,5`, `2,002.01`, `1.000.420,45`,
 * `1.000` and `1.000,00` all parse. Surrounding whitespace is trimmed; a
 * finite positive number is returned, or null for anything invalid (empty,
 * letters, signs, malformed groupings, non-positive values). Display,
 * storage and export stay US-canonical — the parser only changes what is
 * accepted.
 */
export function parseAmount(text: string): number | null {
  const value = text.trim()
  if (value === '') return null
  // Digits and the two separators only — letters, signs, exponents, spaces
  // are never an amount.
  if (!/^[0-9.,]+$/.test(value)) return null

  const separators = value.match(/[.,]/g) ?? []
  if (separators.length === 0) {
    return positiveOrNull(Number(value))
  }

  const lastSeparator = Math.max(value.lastIndexOf('.'), value.lastIndexOf(','))
  const integerPart = value.slice(0, lastSeparator)
  const fractionalPart = value.slice(lastSeparator + 1)

  // A lone separator with exactly three digits after it is a thousands
  // grouping (1.000 → 1000, 2,500 → 2500), never a three-decimal fraction:
  // no realistic money amount has three decimals.
  if (separators.length === 1 && fractionalPart.length === 3) {
    return positiveOrNull(Number(integerPart + fractionalPart))
  }

  // Otherwise the last separator is the decimal point and every earlier
  // separator is a thousands grouping, which must sit between groups of
  // exactly three digits (2,002.01 → 2002.01, 1.000.420,45 → 1000420.45).
  // The integer part may also be a plain ungrouped number of any length
  // (2100.00 → 2100) — nothing about the Amount Input contract requires a
  // thousands separator, and no realistic typer adds one to a four-digit
  // sum. A malformed integer part — 1.2.3, an empty integer part before a
  // decimal comma — is not an amount.
  if (!/^(\d{1,3}([.,]\d{3})*|\d{4,})$/.test(integerPart)) return null

  return positiveOrNull(Number(`${integerPart.replace(/[.,]/g, '')}.${fractionalPart}`))
}

/** Amounts are the parser's only product: finite and positive, so consumers
 * never see zero, negative, or overflow values. */
function positiveOrNull(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null
}