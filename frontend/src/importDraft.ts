/** The Import Draft (issue #43): the unconfirmed import state — picked file,
 * parsed rows, and row selections — lifted out of the Transactions screen
 * into the app shell so it survives tab switches. The only discard paths are
 * Cancel, picking another file, and a successful import (then Back); a page
 * reload loses the draft because it lives in memory only, never persisted.
 */

import { useState } from 'react'

import {
  TOKEN_KEY,
  confirmImport,
  previewImport,
  revalidateImportRows,
  validateImportRow,
  type ImportPreview,
  type ImportRow,
  type ImportRowInput,
} from './api'

export type ImportPhase = 'pick' | 'preview' | 'done'

export type ImportDraft = {
  phase: ImportPhase
  file: File | null
  preview: ImportPreview | null
  selected: Set<number>
  error: string | null
  busy: boolean
  imported: number
  // True when any created Transaction carries the Cash negative-Balance
  // warning: the import succeeded but a Cash Wallet went negative
  // (CONTEXT.md).
  createdWithWarning: boolean
  // Bumped whenever the picker resets so the <input type="file"> remounts
  // with an empty value instead of showing the previous selection.
  pickCount: number
}

/** The one handle the shell and screens use for the draft: the current state
 * (null while no import is in progress) plus the actions that move it. */
export type ImportDraftController = {
  draft: ImportDraft | null
  open: () => void
  pickFile: (file: File | null) => void
  readFile: () => Promise<void>
  toggle: (row: ImportRow) => void
  /** Verification (issue #46): re-validate one edited row and flip its
   * status in place — auto-selecting it when it becomes ready, deselecting
   * it when it stops being ready. Throws when the call itself fails; the
   * draft stays untouched then. */
  saveRowEdit: (rowNumber: number, input: ImportRowInput) => Promise<void>
  /** Batch Revalidation (issue #76): re-validate every problem row against
   * the Account's current Wallets and Categories in one call and apply the
   * flips — Ready rows auto-selected, Duplicates unselectable, remaining
   * Problems narrowed. Ready, Duplicate, and hand-verified rows are
   * untouched; a failed call surfaces as the draft's error, leaving the
   * rows as they were. */
  recheckProblems: () => Promise<void>
  confirm: () => Promise<void>
  pickAgain: () => void
  cancel: () => void
  done: () => void
}

const freshDraft = (): ImportDraft => ({
  phase: 'pick',
  file: null,
  preview: null,
  selected: new Set(),
  error: null,
  busy: false,
  imported: 0,
  createdWithWarning: false,
  pickCount: 0,
})

/** A draft row as an ImportRowInput for the wire, or null when it has no
 * sendable identity (no type, date, or amount). The draft rows are the live
 * edited values, so this is what confirm and the row editor's `earlier_rows`
 * both send. */
function rowInput(row: ImportRow): ImportRowInput | null {
  if (row.type !== 'expense' && row.type !== 'income' && row.type !== 'transfer') {
    return null
  }
  if (row.date === null || row.amount === null) {
    return null
  }
  return {
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
  }
}

export function useImportDraft(): ImportDraftController {
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  const [draft, setDraft] = useState<ImportDraft | null>(null)

  const open = () => {
    setDraft(freshDraft())
  }

  const pickFile = (file: File | null) => {
    setDraft((current) =>
      current === null ? current : { ...current, file, error: null },
    )
  }

  const readFile = async () => {
    if (draft === null) return
    const file = draft.file
    if (file === null) return
    setDraft({ ...draft, busy: true, error: null })
    try {
      const preview = await previewImport(token, file)
      // Every ready row starts selected (issue #17).
      setDraft((current) =>
        current === null
          ? current
          : {
              ...current,
              preview,
              selected: new Set(
                preview.rows
                  .filter((row) => row.status === 'ok')
                  .map((row) => row.row),
              ),
              phase: 'preview',
              busy: false,
            },
      )
    } catch (cause) {
      setDraft((current) =>
        current === null
          ? current
          : {
              ...current,
              busy: false,
              error:
                cause instanceof Error ? cause.message : 'Could not read the file.',
            },
      )
    }
  }

  const toggle = (row: ImportRow) => {
    setDraft((current) => {
      if (current === null) return current
      const next = new Set(current.selected)
      if (next.has(row.row)) {
        next.delete(row.row)
      } else {
        next.add(row.row)
      }
      return { ...current, selected: next }
    })
  }

  const saveRowEdit = async (rowNumber: number, input: ImportRowInput) => {
    if (draft === null || draft.preview === null) {
      return
    }
    // The in-file half of the Duplicate check (CONTEXT.md): the draft's
    // rows that precede this one, with their edits applied. Rows without a
    // sendable identity contribute no key, exactly as in the Preview.
    const earlierRows = draft.preview.rows
      .filter((row) => row.row < rowNumber)
      .map(rowInput)
      .filter((input): input is ImportRowInput => input !== null)
    const verdict = await validateImportRow(token, input, earlierRows)
    setDraft((current) => {
      if (current === null || current.preview === null) {
        return current
      }
      const next = new Set(current.selected)
      // A row that flips to ready joins the selection; one that stops being
      // ready leaves it (issue #46).
      if (verdict.status === 'ok') {
        next.add(rowNumber)
      } else {
        next.delete(rowNumber)
      }
      return {
        ...current,
        preview: {
          ...current.preview,
          rows: current.preview.rows.map((row) =>
            row.row === rowNumber
              ? {
                  row: row.row,
                  status: verdict.status,
                  error: verdict.error ?? null,
                  type: input.type,
                  date: input.date,
                  amount: input.amount,
                  wallet: input.wallet,
                  source_wallet: input.source_wallet,
                  destination_wallet: input.destination_wallet,
                  category: input.category,
                  description: input.description,
                  latitude: input.latitude,
                  longitude: input.longitude,
                }
              : row,
          ),
        },
        selected: next,
      }
    })
  }

  const recheckProblems = async () => {
    if (draft === null || draft.preview === null || draft.busy) return
    // One batch call (issue #76): every sendable draft row travels as the
    // in-file Duplicate context, and the problem rows are the targets.
    // Rows without a sendable identity (parse errors) cannot be
    // re-validated and keep their message.
    const rows: ImportRowInput[] = []
    const targets: number[] = []
    for (const row of draft.preview.rows) {
      const input = rowInput(row)
      if (input === null) continue
      rows.push(input)
      if (row.status === 'error') targets.push(row.row)
    }
    if (targets.length === 0) return
    try {
      const verdicts = await revalidateImportRows(token, rows, targets)
      setDraft((current) => {
        if (
          current === null ||
          current.preview === null ||
          current.phase !== 'preview'
        ) {
          return current
        }
        const verdictByRow = new Map(
          verdicts.map((verdict) => [verdict.row, verdict]),
        )
        const next = new Set(current.selected)
        const updated = current.preview.rows.map((row) => {
          const verdict = verdictByRow.get(row.row)
          if (verdict === undefined) return row
          // A row that flips to ready joins the selection; anything else
          // leaves it (a problem row is never selected anyway).
          if (verdict.status === 'ok') {
            next.add(row.row)
          } else {
            next.delete(row.row)
          }
          return { ...row, status: verdict.status, error: verdict.error ?? null }
        })
        return {
          ...current,
          preview: { ...current.preview, rows: updated },
          selected: next,
        }
      })
    } catch (cause) {
      setDraft((current) =>
        current === null
          ? current
          : {
              ...current,
              error:
                cause instanceof Error
                  ? cause.message
                  : 'Could not re-validate the rows.',
            },
      )
    }
  }

  const confirm = async () => {
    if (draft === null || draft.preview === null) return
    const rows: ImportRowInput[] = []
    for (const row of draft.preview.rows) {
      if (!draft.selected.has(row.row)) continue
      const input = rowInput(row)
      if (input !== null) rows.push(input)
    }
    setDraft({ ...draft, busy: true, error: null })
    try {
      const created = await confirmImport(token, rows)
      setDraft((current) =>
        current === null
          ? current
          : {
              ...current,
              busy: false,
              imported: created.length,
              createdWithWarning: created.some((transaction) => transaction.warning),
              phase: 'done',
            },
      )
    } catch (cause) {
      setDraft((current) =>
        current === null
          ? current
          : {
              ...current,
              busy: false,
              error:
                cause instanceof Error ? cause.message : 'Could not confirm the import.',
            },
      )
    }
  }

  const pickAgain = () => {
    setDraft((current) =>
      current === null
        ? current
        : {
            ...current,
            phase: 'pick',
            file: null,
            preview: null,
            selected: new Set(),
            error: null,
            pickCount: current.pickCount + 1,
          },
    )
  }

  const cancel = () => {
    setDraft(null)
  }

  const done = () => {
    setDraft(null)
  }

  return {
    draft,
    open,
    pickFile,
    readFile,
    toggle,
    saveRowEdit,
    recheckProblems,
    confirm,
    pickAgain,
    cancel,
    done,
  }
}
