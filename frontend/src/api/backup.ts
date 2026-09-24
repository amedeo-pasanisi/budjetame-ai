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