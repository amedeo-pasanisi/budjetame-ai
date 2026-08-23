/** Import resource: upload / validate / confirm against the fixed template
 * (T13, issue #17). Import errors surface the backend's detail (e.g. "Unknown
 * wallet 'X'"), which is why these calls set `readDetail`. */

import { request } from './transport'
import type { Transaction } from './transactions'

export type ImportRowStatus = 'ok' | 'error' | 'duplicate'

export type ImportRow = {
  row: number
  status: ImportRowStatus
  type: string | null
  date: string | null
  amount: string | null
  wallet: string | null
  source_wallet: string | null
  destination_wallet: string | null
  category: string | null
  description: string | null
  latitude: string | null
  longitude: string | null
  error: string | null
}

export type ImportPreview = {
  rows: ImportRow[]
  ok_count: number
  error_count: number
  duplicate_count: number
}

/** A row the user kept, echoed back for confirmation: names, not ids — the
 * backend re-resolves them and re-runs every rule before writing anything. */
export type ImportRowInput = {
  row?: number
  type: 'expense' | 'income' | 'transfer'
  date: string
  amount: string
  wallet: string | null
  source_wallet: string | null
  destination_wallet: string | null
  category: string | null
  description: string | null
  latitude: string | null
  longitude: string | null
}

export async function previewImport(token: string, file: File): Promise<ImportPreview> {
  const form = new FormData()
  form.append('file', file, file.name)
  const response = await request('/import/preview', {
    method: 'POST',
    token,
    formData: form,
    readDetail: true,
    errorMessage: 'Could not read the file',
  })
  return (await response.json()) as ImportPreview
}

/** The fresh verdict for one edited row (issue #44): `status` speaks the
 * Preview's vocabulary — ok (Ready in the UI), duplicate, or error — and
 * `error` carries the message for an error row. */
export type ImportRowValidation = {
  status: ImportRowStatus
  error: string | null
}

/** Re-validate one edited row during Verification (issue #44/#46): the
 * row's Wallet/Category names are re-resolved against the Account, every
 * CONTEXT.md rule re-run, and the Duplicate check applied with the final
 * key. `earlierRows` is the draft's rows that precede it in the file — the
 * in-file Duplicate context — with their edits applied. Nothing is
 * written. */
export async function validateImportRow(
  token: string,
  row: ImportRowInput,
  earlierRows: ImportRowInput[],
): Promise<ImportRowValidation> {
  const response = await request('/import/validate-row', {
    method: 'POST',
    token,
    json: { row, earlier_rows: earlierRows },
    readDetail: true,
    errorMessage: 'Could not validate the row',
  })
  return (await response.json()) as ImportRowValidation
}

/** The fresh verdict for one target row of a batch Revalidation (issue
 * #76): `row` echoes the target's row number so the client can map each
 * verdict back to its draft row; `status` and `error` speak the Preview's
 * vocabulary, exactly like the single-row re-validation. */
export type ImportRowRevalidation = {
  row: number
  status: ImportRowStatus
  error: string | null
}

/** Batch Revalidation (issue #76): the draft's rows (with the user's edits
 * applied) plus the target row numbers in, every target's fresh verdict out
 * — one call through the same pipeline as the single-row re-validation,
 * including the in-file Duplicate context from preceding rows. Nothing is
 * written. */
export async function revalidateImportRows(
  token: string,
  rows: ImportRowInput[],
  targets: number[],
): Promise<ImportRowRevalidation[]> {
  const response = await request('/import/revalidate-rows', {
    method: 'POST',
    token,
    json: { rows, targets },
    readDetail: true,
    errorMessage: 'Could not re-validate the rows',
  })
  return (await response.json()) as ImportRowRevalidation[]
}

export async function confirmImport(
  token: string,
  rows: ImportRowInput[],
): Promise<Transaction[]> {
  const response = await request('/import/confirm', {
    method: 'POST',
    token,
    json: { rows },
    readDetail: true,
    errorMessage: 'Could not confirm the import',
  })
  return (await response.json()) as Transaction[]
}
