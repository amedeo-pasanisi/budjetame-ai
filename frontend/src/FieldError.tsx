/** The Field Error render helper (ADR-0029). Lives apart from the shared
 * validation module (`validation.ts`) so component modules stay separate
 * from pure ones for Fast Refresh. */
import type { FieldErrors } from './validation'
import { fieldErrorId } from './validation'

/** Shows one field's message inline beneath it, derived from the same id
 * `fieldErrorProps` wires `aria-describedby` to, so a screen reader reads
 * the message with its field. Renders nothing when the field is fine — a
 * valid form carries no error text anywhere. Errors update only on the next
 * Save attempt (ADR-0029); this helper never clears while typing, the
 * form's state does. */
export function FieldError({
  field,
  errors,
}: {
  field: string
  errors: FieldErrors
}) {
  const message = errors[field]
  if (message === undefined) return null
  return (
    <p id={fieldErrorId(field)} role="alert" className="mt-1 text-sm text-red-600">
      {message}
    </p>
  )
}