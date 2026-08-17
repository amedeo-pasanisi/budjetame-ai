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

  const confirm = async () => {
    if (draft === null || draft.preview === null) return
    const rows: ImportRowInput[] = []
    for (const row of draft.preview.rows) {
      if (!draft.selected.has(row.row)) continue
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

  return { draft, open, pickFile, readFile, toggle, confirm, pickAgain, cancel, done }
}
