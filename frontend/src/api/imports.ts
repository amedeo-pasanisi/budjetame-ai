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
