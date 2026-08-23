import { type ChangeEvent } from 'react'

import { SENTINEL_VALUE } from './EntitySelect'

export type ImportEntityOption = { name: string; label: string }

type ImportEntitySelectProps = {
  id: string
  label: string
  /** The field's current value: an entity *name* ('' for None on optional
   * fields). The row editor stores names, not ids — the backend re-resolves
   * them — so this select keys its options by name. */
  value: string
  onChange: (name: string) => void
  options: ImportEntityOption[]
  /** The entity's singular name for the sentinel's label, e.g. "wallet"
   * renders "＋ Add wallet…". */
  entity: string
  /** Opens the entity's create modal, hosted by the screen, prefilled with
   * the field's current name when it does not resolve to an existing option
   * (the missing name from the file) and '' otherwise. */
  onAdd: (prefillName: string) => void
  required?: boolean
}

/** The row editor's entity select (issue #77): like the shared EntitySelect
 * (ADR-0013) — the sentinel always last, revert-on-pick (the sentinel is
 * never a value), the create modal opened by the screen — but name-based:
 * the editor's fields hold the names the draft stores and the import
 * re-resolves, not ids. A current name that case-insensitively matches an
 * option renders as that option (the resolved entity); a name that matches
 * nothing renders as a "doesn't exist yet" option holding the raw name, so
 * the file's value stays visible and the sentinel opens the create modal
 * prefilled with it. */
export function ImportEntitySelect({
  id,
  label,
  value,
  onChange,
  options,
  entity,
  onAdd,
  required = false,
}: ImportEntitySelectProps) {
  const trimmed = value.trim()
  const resolved = options.find(
    (option) => option.name.toLowerCase() === trimmed.toLowerCase(),
  )
  // The pending option exists exactly while the field's value does not
  // resolve: the file's name, kept as the current value.
  const pending = resolved === undefined && trimmed !== ''
  // What the select shows as current: the resolved entity's canonical name
  // (the file may have spelled it differently), the raw name while pending,
  // or '' for None.
  const displayed = resolved !== undefined ? resolved.name : pending ? value : ''

  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    if (event.target.value === SENTINEL_VALUE) {
      // Revert on the DOM node directly: the field's value does not change,
      // so React would not re-render the select and the sentinel pick would
      // stay visible (ADR-0013).
      event.target.value = displayed
      onAdd(pending ? trimmed : '')
      return
    }
    onChange(event.target.value)
  }

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <select
        id={id}
        required={required}
        value={displayed}
        onChange={handleChange}
        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
      >
        {!required && <option value="">None</option>}
        {pending && <option value={value}>{trimmed} (doesn&apos;t exist yet)</option>}
        {options.map((option) => (
          <option key={option.name} value={option.name}>
            {option.label}
          </option>
        ))}
        <option value={SENTINEL_VALUE}>＋ Add {entity}…</option>
      </select>
    </div>
  )
}
