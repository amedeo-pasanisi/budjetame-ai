import { type ChangeEvent } from 'react'

export type EntitySelectOption = { id: number; label: string }

/** The sentinel option's value: picking it opens the entity's create modal
 * instead of selecting anything. Never a real value — the wrapper reverts
 * the select and calls `onAdd`. Exported so tests can pick the sentinel by
 * value, the way a user picks it by its label. */
export const SENTINEL_VALUE = '__add__'

type EntitySelectProps = {
  id: string
  label: string
  value: number | ''
  onChange: (value: number | '') => void
  options: EntitySelectOption[]
  /** The entity's singular name for the sentinel's label, e.g. "category"
   * renders "＋ Add category…". */
  entity: string
  /** Opens the entity's create modal, hosted by the screen. Picking the
   * sentinel never changes the field's value: the select reverts to what it
   * showed, and the new entity's id is set here only when the inner modal
   * saves (via the screen's auto-select). */
  onAdd: () => void
  required?: boolean
}

/** The shared entity select wrapper (ADR-0013): every entity dropdown in the
 * forms (Category, Wallet, Recurring Cost, Recurring Income) renders its
 * options plus a trailing "＋ Add {entity}…" sentinel, so an entity that
 * does not exist yet can be created inline without abandoning the form.
 * The sentinel always sits last — after None for optional fields, after the
 * empty-state placeholders — and the wrapper never lets it become the
 * field's value. One component for all ten instances, so the sentinel
 * behavior cannot drift. */
export function EntitySelect({
  id,
  label,
  value,
  onChange,
  options,
  entity,
  onAdd,
  required = false,
}: EntitySelectProps) {
  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    if (event.target.value === SENTINEL_VALUE) {
      // Revert on the DOM node directly: the field's value does not change,
      // so React would not re-render the select and the sentinel pick would
      // stay visible.
      event.target.value = value === '' ? '' : String(value)
      onAdd()
      return
    }
    onChange(event.target.value === '' ? '' : Number(event.target.value))
  }

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <select
        id={id}
        required={required}
        value={value === '' ? '' : String(value)}
        onChange={handleChange}
        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
      >
        {!required && <option value="">None</option>}
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
        <option value={SENTINEL_VALUE}>＋ Add {entity}…</option>
      </select>
    </div>
  )
}
