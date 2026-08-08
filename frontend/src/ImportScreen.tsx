import { useState } from 'react'

import {
  TOKEN_KEY,
  confirmImport,
  formatEuros,
  previewImport,
  type ImportPreview,
  type ImportRow,
  type ImportRowInput,
} from './api'

type Phase = 'pick' | 'preview' | 'done'

const TYPE_LABEL: Record<string, string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
}

/** Bulk import (T13): pick a .csv/.xlsx against the fixed template, see the
 * extracted rows validated — duplicates in yellow, problems in red — then
 * confirm; nothing reaches the database before that confirmation. */
export function ImportScreen({
  onDone,
  onBack,
}: {
  onDone: () => void
  onBack: () => void
}) {
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  const [phase, setPhase] = useState<Phase>('pick')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [imported, setImported] = useState(0)
  // True when any created Transaction carries the Cash negative-Balance warning:
  // the import succeeded but a Cash Wallet went negative (CONTEXT.md).
  const [createdWithWarning, setCreatedWithWarning] = useState(false)
  // Bumped whenever the picker is reset so the <input type="file"> remounts
  // with an empty value instead of showing the previous selection.
  const [pickCount, setPickCount] = useState(0)

  const handleReadFile = async () => {
    if (file === null) return
    setBusy(true)
    setError(null)
    try {
      const result = await previewImport(token, file)
      setPreview(result)
      setSelected(
        new Set(
          result.rows
            .filter((row) => row.status === 'ok')
            .map((row) => row.row),
        ),
      )
      setPhase('preview')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read the file.')
    } finally {
      setBusy(false)
    }
  }

  const toggle = (row: ImportRow) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(row.row)) {
        next.delete(row.row)
      } else {
        next.add(row.row)
      }
      return next
    })
  }

  const handleConfirm = async () => {
    if (preview === null) return
    const rows: ImportRowInput[] = []
    for (const row of preview.rows) {
      if (!selected.has(row.row)) continue
      if (row.type !== 'expense' && row.type !== 'income' && row.type !== 'transfer') {
        continue
      }
      if (row.date === null || row.amount === null) continue
      rows.push({
        row: row.row,
        type: row.type,
        date: row.date,
        amount: row.amount,
        wallet: row.wallet,
        source_wallet: row.source_wallet,
        destination_wallet: row.destination_wallet,
        category: row.category,
        description: row.description,
        latitude: row.latitude,
        longitude: row.longitude,
      })
    }
    setBusy(true)
    setError(null)
    try {
      const created = await confirmImport(token, rows)
      setImported(created.length)
      setCreatedWithWarning(created.some((transaction) => transaction.warning))
      setPhase('done')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not confirm the import.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">Import</h2>
        <button
          type="button"
          onClick={phase === 'done' ? onDone : onBack}
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
          onFile={(next) => {
            setFile(next)
            setError(null)
          }}
          onRead={handleReadFile}
        />
      )}

      {phase === 'preview' && preview !== null && (
        <PreviewPhase
          preview={preview}
          selected={selected}
          busy={busy}
          error={error}
          onToggle={toggle}
          onConfirm={handleConfirm}
          onPickAgain={() => {
            setFile(null)
            setPickCount((count) => count + 1)
            setPreview(null)
            setError(null)
            setPhase('pick')
          }}
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
  onConfirm,
  onPickAgain,
}: {
  preview: ImportPreview
  selected: Set<number>
  busy: boolean
  error: string | null
  onToggle: (row: ImportRow) => void
  onConfirm: () => void
  onPickAgain: () => void
}) {
  const ready = preview.rows.filter((row) => row.status === 'ok').length
  const duplicates = preview.rows.filter((row) => row.status === 'duplicate').length
  const problems = preview.rows.filter((row) => row.status === 'error').length
  const confirmable = selected.size
  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm text-slate-600">
        <span className="font-medium text-emerald-700">{ready} ready</span>
        {duplicates > 0 && (
          <>
            {' · '}
            <span className="font-medium text-amber-700">{duplicates} duplicate</span>
          </>
        )}
        {problems > 0 && (
          <>
            {' · '}
            <span className="font-medium text-red-700">{problems} problem</span>
          </>
        )}
        {' — duplicates are skipped; check the rows below, then confirm.'}
      </p>

      {error !== null && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {preview.rows.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
          No data rows found in this file.
        </p>
      ) : (
        <ul className="space-y-2">
          {preview.rows.map((row) => (
            <li key={row.row}>
              <ImportRowCard row={row} selected={selected.has(row.row)} onToggle={onToggle} />
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onPickAgain}
          className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-600"
        >
          Pick another file
        </button>
        <button
          type="button"
          disabled={confirmable === 0 || busy}
          onClick={onConfirm}
          className="flex-1 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
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

function ImportRowCard({
  row,
  selected,
  onToggle,
}: {
  row: ImportRow
  selected: boolean
  onToggle: (row: ImportRow) => void
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
  return (
    <label
      className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-left shadow-sm ${
        checkable ? 'cursor-pointer' : 'cursor-default'
      } ${palette}`}
    >
      <input
        type="checkbox"
        checked={checkable && selected}
        disabled={!checkable}
        onChange={() => onToggle(row)}
        className="mt-1 h-4 w-4 shrink-0 accent-indigo-600"
      />
      <span className="min-w-0 flex-1">
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
        <span className="mt-0.5 block text-sm font-semibold text-slate-900">
          {row.amount !== null ? formatEuros(row.amount) : '—'}
        </span>
        <span className="block truncate text-xs text-slate-500">
          {walletLabel}
          {row.category !== null && row.category !== '' ? ` · ${row.category}` : ''}
          {row.description !== null && row.description !== ''
            ? ` · ${row.description}`
            : ''}
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
      </span>
    </label>
  )
}
