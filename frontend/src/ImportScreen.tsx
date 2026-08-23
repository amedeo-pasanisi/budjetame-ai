import { useEffect, useState } from 'react'

import { formatEuros, type ImportPreview, type ImportRow } from './api'
import type { ImportDraftController } from './importDraft'
import { ImportRowModal } from './ImportRowModal'
import { descriptionText } from './transactions'

const TYPE_LABEL: Record<string, string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
}

/** Bulk import (T13): pick a .csv/.xlsx against the fixed template, see the
 * extracted rows validated — duplicates in yellow, problems in red — then
 * confirm; nothing reaches the database before that confirmation. The draft
 * itself lives in the app shell (useImportDraft, issue #43) so it survives
 * tab switches; this component only renders and drives it. */
export function ImportScreen({
  controller,
  onDone,
}: {
  controller: ImportDraftController
  onDone: () => void
}) {
  // Which Preview row the editor modal is open for (null: none). The modal
  // itself lives in this screen's state; the draft — and with it every edit
  // saved — lives in the app shell (issue #43).
  const [editingRowNumber, setEditingRowNumber] = useState<number | null>(null)
  const draft = controller.draft
  // The on-resume re-check (issue #76): a tab switch unmounts this screen,
  // so a fresh mount with a live Preview re-validates every problem row
  // against the Account's current Wallets and Categories — entities created
  // elsewhere while the draft was open flip the rows that waited on them.
  // A mount without a Preview (a fresh pick, or the done phase) re-checks
  // nothing.
  useEffect(() => {
    if (draft?.phase === 'preview') {
      void controller.recheckProblems()
    }
    // Mount-only: the resume, not every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (draft === null) return null
  const { phase, file, preview, selected, error, busy, imported, createdWithWarning, pickCount } =
    draft
  const editingRow =
    phase === 'preview' && preview !== null
      ? (preview.rows.find((row) => row.row === editingRowNumber) ?? null)
      : null

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">Import</h2>
        <button
          type="button"
          onClick={phase === 'done' ? onDone : controller.cancel}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600"
        >
          {phase === 'done' ? 'Back' : 'Cancel'}
        </button>
      </div>

      {phase === 'pick' && (
        <PickPhase
          key={pickCount}
          file={file}
          busy={busy}
          error={error}
          onFile={controller.pickFile}
          onRead={controller.readFile}
        />
      )}

      {phase === 'preview' && preview !== null && (
        <PreviewPhase
          preview={preview}
          selected={selected}
          busy={busy}
          error={error}
          onToggle={controller.toggle}
          onEdit={(row) => setEditingRowNumber(row.row)}
          onConfirm={controller.confirm}
          onPickAgain={controller.pickAgain}
        />
      )}

      {editingRow !== null && (
        <ImportRowModal
          row={editingRow}
          onSave={(input) => controller.saveRowEdit(editingRow.row, input)}
          onClose={() => setEditingRowNumber(null)}
        />
      )}

      {phase === 'done' && (
        <div className="mt-6 space-y-3">
          {createdWithWarning && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Imported — but the import made a Cash wallet negative.
            </p>
          )}
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <p className="text-sm font-medium text-emerald-800">
              Imported {imported} transaction{imported === 1 ? '' : 's'}.
            </p>
            <p className="mt-1 text-xs text-emerald-700">
              They are now in your history; balances and the dashboard reflect them.
            </p>
          </div>
        </div>
      )}
    </>
  )
}

function PickPhase({
  file,
  busy,
  error,
  onFile,
  onRead,
}: {
  file: File | null
  busy: boolean
  error: string | null
  onFile: (file: File | null) => void
  onRead: () => void
}) {
  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm text-slate-600">
        Upload a <span className="font-medium">.csv</span> or{' '}
        <span className="font-medium">.xlsx</span> file with the fixed template:
        one flat sheet, columns{' '}
        <span className="font-medium">
          date, type, amount, wallet, source wallet, destination wallet, category,
          description, location
        </span>
        . Nothing is written until you confirm the preview.
      </p>
      <input
        type="file"
        accept=".csv,.xlsx"
        onChange={(event) => onFile(event.target.files?.[0] ?? null)}
        className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
      />
      {file !== null && (
        <p className="text-xs text-slate-500">
          {file.name} · {Math.max(1, Math.round(file.size / 1024))} KB
        </p>
      )}
      {error !== null && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={file === null || busy}
        onClick={onRead}
        className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
      >
        {busy ? 'Reading file…' : 'Read and validate'}
      </button>
    </div>
  )
}

function PreviewPhase({
  preview,
  selected,
  busy,
  error,
  onToggle,
  onEdit,
  onConfirm,
  onPickAgain,
}: {
  preview: ImportPreview
  selected: Set<number>
  busy: boolean
  error: string | null
  onToggle: (row: ImportRow) => void
  onEdit: (row: ImportRow) => void
  onConfirm: () => void
  onPickAgain: () => void
}) {
  const ready = preview.rows.filter((row) => row.status === 'ok').length
  const duplicates = preview.rows.filter((row) => row.status === 'duplicate').length
  const problems = preview.rows.filter((row) => row.status === 'error').length
  const confirmable = selected.size
  return (
    <div className="mt-4 space-y-3">
      {error !== null && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onPickAgain}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600"
        >
          Pick another file
        </button>
      </div>

      {preview.rows.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
          No data rows found in this file.
        </p>
      ) : (
        <ul className="space-y-2">
          {preview.rows.map((row) => (
            <li key={row.row}>
              <ImportRowCard
                row={row}
                selected={selected.has(row.row)}
                onToggle={onToggle}
                onEdit={onEdit}
              />
            </li>
          ))}
        </ul>
      )}

      {/* The confirm bar (issue #42): sticky above the fixed tab nav
       * (bottom-12 clears it), so a long row list scrolls under it while
       * the counts and the Import button stay visible. */}
      <div className="sticky bottom-12 z-10 flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-lg">
        <p className="min-w-0 text-xs font-medium text-slate-600">
          <span className="text-emerald-700">{ready} ready</span>
          {' · '}
          <span className="text-amber-700">
            {duplicates} duplicate{duplicates === 1 ? '' : 's'}
          </span>
          {' · '}
          <span className="text-red-700">
            {problems} problem{problems === 1 ? '' : 's'}
          </span>
        </p>
        <button
          type="button"
          disabled={confirmable === 0 || busy}
          onClick={onConfirm}
          className="shrink-0 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy
            ? 'Importing…'
            : confirmable === 0
              ? 'Nothing to import'
              : `Import ${confirmable} row${confirmable === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  )
}

/** One Preview row: a checkbox toggles the selection of ready rows, and
 * tapping the card opens the Verification editor (issue #46) for any row —
 * ready, duplicate, or problem. */
function ImportRowCard({
  row,
  selected,
  onToggle,
  onEdit,
}: {
  row: ImportRow
  selected: boolean
  onToggle: (row: ImportRow) => void
  onEdit: (row: ImportRow) => void
}) {
  const checkable = row.status === 'ok'
  const palette =
    row.status === 'ok'
      ? 'border-emerald-200 bg-white'
      : row.status === 'duplicate'
        ? 'border-amber-300 bg-amber-50'
        : 'border-red-200 bg-red-50'
  const badge =
    row.status === 'ok'
      ? 'text-emerald-700'
      : row.status === 'duplicate'
        ? 'text-amber-800'
        : 'text-red-700'
  const type = TYPE_LABEL[row.type ?? ''] ?? ''
  const walletLabel =
    row.type === 'transfer' && row.source_wallet !== null && row.destination_wallet !== null
      ? `${row.source_wallet} → ${row.destination_wallet}`
      : (row.wallet ?? '')
  const location =
    row.latitude !== null && row.longitude !== null
      ? ` 📍 ${row.latitude}, ${row.longitude}`
      : ''
  const description = descriptionText(row.description)
  return (
    <div
      className={`flex items-start gap-3 rounded-2xl border px-4 py-3 shadow-sm ${palette}`}
    >
      <input
        type="checkbox"
        aria-label={`Select row ${row.row}`}
        checked={checkable && selected}
        disabled={!checkable}
        onChange={() => onToggle(row)}
        className={`mt-1 h-4 w-4 shrink-0 accent-indigo-600 ${
          checkable ? 'cursor-pointer' : ''
        }`}
      />
      <button
        type="button"
        aria-label={`Edit row ${row.row}`}
        onClick={() => onEdit(row)}
        className="min-w-0 flex-1 text-left"
      >
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium text-slate-900">
            {row.date ?? '—'} · {type || '—'}
          </span>
          <span className={`shrink-0 text-xs font-medium ${badge}`}>
            {row.status === 'ok'
              ? 'Ready'
              : row.status === 'duplicate'
                ? 'Duplicate'
                : 'Problem'}
          </span>
        </span>
        {description !== null && (
          <span className="mt-0.5 block truncate text-sm font-medium text-slate-900">
            {description}
          </span>
        )}
        <span className="mt-0.5 block text-sm font-semibold text-slate-900">
          {row.amount !== null ? formatEuros(row.amount) : '—'}
        </span>
        <span className="block truncate text-xs text-slate-500">
          {walletLabel}
          {row.category !== null && row.category !== '' ? ` · ${row.category}` : ''}
          {location}
        </span>
        {row.status === 'error' && row.error !== null && (
          <span className="mt-1 block text-xs text-red-700">{row.error}</span>
        )}
        {row.status === 'duplicate' && (
          <span className="mt-1 block text-xs text-amber-800">
            Already in the database or repeated in this file — this row will be skipped.
          </span>
        )}
      </button>
    </div>
  )
}
