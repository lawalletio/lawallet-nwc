'use client'

import { useCallback } from 'react'
import { useAuth } from '@/components/admin/auth-context'
import type {
  BackupAnalyzeResponse,
  BackupCategory,
  BackupImportRequest,
  BackupImportResult,
} from '@/lib/client/backup-types'

/** Error carrying the server-side `code` so callers can branch (password flow). */
export class BackupRequestError extends Error {
  code?: string
  status: number
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'BackupRequestError'
    this.status = status
    this.code = code
  }
}

async function toError(res: Response): Promise<BackupRequestError> {
  const body = (await res.json().catch(() => null)) as
    | { error?: { message?: string; code?: string } }
    | null
  return new BackupRequestError(
    res.status,
    body?.error?.message ?? `Request failed (${res.status})`,
    body?.error?.code,
  )
}

function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback
  const match = /filename\*?=(?:UTF-8'')?"?([^"';]+)"?/i.exec(header)
  return match?.[1] ? decodeURIComponent(match[1]) : fallback
}

/** Triggers a browser download of a Blob via a transient anchor. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Revoke after the click has been processed.
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export interface ExportedBackup {
  blob: Blob
  filename: string
}

export interface UseBackup {
  exportBackup: (categories: BackupCategory[], password?: string) => Promise<ExportedBackup>
  analyzeBackup: (file: File, password?: string) => Promise<BackupAnalyzeResponse>
  importBackup: (
    file: File,
    resolution: BackupImportRequest,
    password?: string,
    onProgress?: (percent: number) => void,
  ) => Promise<BackupImportResult>
}

/**
 * Raw-fetch backup client. The shared `apiClient` is JSON-only (no blob
 * download, no multipart), so this hook talks to the endpoints directly while
 * reusing the same bearer token from {@link useAuth}.
 */
export function useBackup(): UseBackup {
  const { jwt } = useAuth()

  const exportBackup = useCallback(
    async (categories: BackupCategory[], password?: string): Promise<ExportedBackup> => {
      const res = await fetch('/api/admin/backup/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
        },
        body: JSON.stringify({
          categories,
          ...(password ? { password } : {}),
        }),
      })
      if (!res.ok) throw await toError(res)
      const filename = filenameFromDisposition(
        res.headers.get('content-disposition'),
        'lawallet-backup.zip',
      )
      const blob = await res.blob()
      return { blob, filename }
    },
    [jwt],
  )

  const analyzeBackup = useCallback(
    async (file: File, password?: string): Promise<BackupAnalyzeResponse> => {
      const form = new FormData()
      form.append('file', file)
      if (password) form.append('password', password)
      // No explicit Content-Type — the browser sets the multipart boundary.
      const res = await fetch('/api/admin/backup/analyze', {
        method: 'POST',
        headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
        body: form,
      })
      if (!res.ok) throw await toError(res)
      return (await res.json()) as BackupAnalyzeResponse
    },
    [jwt],
  )

  const importBackup = useCallback(
    (
      file: File,
      resolution: BackupImportRequest,
      password?: string,
      onProgress?: (percent: number) => void,
    ): Promise<BackupImportResult> => {
      const form = new FormData()
      form.append('file', file)
      form.append('resolution', JSON.stringify(resolution))
      if (password) form.append('password', password)

      // XHR (not fetch) so we get a real upload-progress signal for large files.
      return new Promise<BackupImportResult>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', '/api/admin/backup/import')
        if (jwt) xhr.setRequestHeader('Authorization', `Bearer ${jwt}`)
        xhr.upload.onprogress = event => {
          if (event.lengthComputable && onProgress) {
            onProgress(Math.round((event.loaded / event.total) * 100))
          }
        }
        xhr.onload = () => {
          let parsed: unknown = null
          try {
            parsed = JSON.parse(xhr.responseText)
          } catch {
            /* handled below */
          }
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(parsed as BackupImportResult)
          } else {
            const err = (parsed as { error?: { message?: string; code?: string } } | null)?.error
            reject(
              new BackupRequestError(
                xhr.status,
                err?.message ?? `Request failed (${xhr.status})`,
                err?.code,
              ),
            )
          }
        }
        xhr.onerror = () => reject(new BackupRequestError(0, 'Network error during import'))
        xhr.send(form)
      })
    },
    [jwt],
  )

  return { exportBackup, analyzeBackup, importBackup }
}
