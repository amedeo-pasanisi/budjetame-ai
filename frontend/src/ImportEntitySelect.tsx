import { type ChangeEvent } from 'react'
import { useIntl } from 'react-intl'

import { SENTINEL_VALUE } from './EntitySelect'

export type ImportEntityOption = { name: string; label: string }

type ImportEntitySelectProps = {
  id: string
  label: string
  value: string
  onChange: (name: string) => void
  options: ImportEntityOption[]
  entity: string
  onAdd: (prefillName: string) => void
  required?: boolean
  errorProps?: { 'aria-invalid'?: true; 'aria-describedby'?: string }
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
  errorProps,
}: ImportEntitySelectProps) {
  const { formatMessage } = useIntl()
  const trimmed = value.trim()
  const resolved = options.find(
    (option) => option.name.toLowerCase() === trimmed.toLowerCase(),
  )
  const pending = resolved === undefined && trimmed !== ''
  const displayed = resolved !== undefined ? resolved.name : pending ? value : ''

  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    if (event.target.value === SENTINEL_VALUE) {
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
        {...errorProps}
        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
      >
        {!required && <option value="">{formatMessage({ id: 'importEntitySelect.none' })}</option>}
        {pending && <option value={value}>{formatMessage({ id: 'importEntitySelect.doesNotExist' }, { name: trimmed })}</option>}
        {options.map((option) => (
          <option key={option.name} value={option.name}>
            {option.label}
          </option>
        ))}
        <option value={SENTINEL_VALUE}>{formatMessage({ id: 'importEntitySelect.add' }, { entity })}</option>
      </select>
    </div>
  )
}