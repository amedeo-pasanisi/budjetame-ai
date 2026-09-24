/** Backup resource (issue #112): download the Account's complete data
 * as a multi-sheet backup workbook. */

import { request } from './transport'

export type BackupFile = {
  blob: Blob
  filename: string
}

function exportFilename(disposition: string | null): string {
  const match = disposition?.match(/filename="([^"]+)"/)
  return match?.[1] ?? 'budjetame-backup.xlsx'
}

/** Download the Account's complete backup workbook (issue #112). The caller
 * triggers the browser download; the filename comes from Content-Disposition. */
export async function exportBackup(token: string): Promise<BackupFile> {
  const response = await request('/backup/export', {
    token,
    errorMessage: 'Could not export backup',
  })
  return {
    blob: await response.blob(),
    filename: exportFilename(response.headers.get('content-disposition')),
  }
}

/** Restore the Account's data from an uploaded backup workbook (issue #115).
 * Returns the response JSON (status, optional warning). */
export async function restoreBackup(
  token: string,
  file: Blob,
): Promise<{ status: string; warning?: string }> {
  const formData = new FormData()
  formData.append('file', file, 'budjetame-backup.xlsx')
  const response = await request('/backup/restore', {
    method: 'POST',
    token,
    formData,
    errorMessage: 'Could not restore backup',
    readDetail: true,
  })
  const data = await response.json() as { status: string; warning?: string }
  return data
}