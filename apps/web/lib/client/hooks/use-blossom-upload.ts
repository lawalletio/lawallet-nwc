'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createUploadAuth, encodeAuthorizationHeader } from 'blossom-client-sdk'
import type { BlobDescriptor } from 'blossom-client-sdk'
import { useAuth } from '@/components/admin/auth-context'
import { useSettings } from '@/lib/client/hooks/use-settings'
import { toBlossomSigner } from '@/lib/client/blossom-signer'

export interface BlossomUploadResult {
  /** Absolute URL returned by the first successful server. */
  url: string
  /** SHA-256 hex digest of the uploaded blob. */
  sha256: string
  /** Full blob descriptor from the first successful server. */
  descriptor: BlobDescriptor
}

interface UploadState {
  progress: number
  uploading: boolean
  error: Error | null
}

function parseServers(raw: string | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    }
  } catch {
    // ignore
  }
  return []
}

/**
 * PUT the blob to `<server>/upload` with the given Authorization header,
 * reporting progress via `onProgress(loaded, total)`. Resolves with the parsed
 * JSON `BlobDescriptor` body on 2xx, rejects on network/HTTP errors or abort.
 */
function putViaXhr(
  url: string,
  blob: Blob,
  authHeader: string,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<BlobDescriptor> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Authorization', authHeader)
    if (blob.type) xhr.setRequestHeader('Content-Type', blob.type)
    xhr.responseType = 'text'

    const abort = () => xhr.abort()
    if (signal) {
      if (signal.aborted) {
        reject(new DOMException('Upload aborted', 'AbortError'))
        return
      }
      signal.addEventListener('abort', abort)
    }

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total)
    }
    xhr.onload = () => {
      signal?.removeEventListener('abort', abort)
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const body = JSON.parse(xhr.responseText) as BlobDescriptor
          resolve(body)
        } catch (err) {
          reject(new Error(`Invalid JSON from ${url}: ${(err as Error).message}`))
        }
      } else {
        const reason = xhr.getResponseHeader('X-Reason') || xhr.responseText || xhr.statusText
        reject(new Error(`${url} → ${xhr.status} ${reason}`))
      }
    }
    xhr.onerror = () => {
      signal?.removeEventListener('abort', abort)
      reject(new Error(`Network error uploading to ${url}`))
    }
    xhr.onabort = () => {
      signal?.removeEventListener('abort', abort)
      reject(new DOMException('Upload aborted', 'AbortError'))
    }

    xhr.send(blob)
  })
}

/**
 * Upload a file to every configured Blossom server in parallel, reporting
 * aggregate progress. Uses `blossom-client-sdk` to build the BUD-02 auth event
 * (reused across all servers) and raw XHR for the PUT so we get upload
 * progress events that `fetch` does not expose.
 *
 * Requirements:
 *   - `settings.blossom_servers` must contain at least one URL.
 *   - `useAuth().signer` must be available (i.e. the user has an active Nostr
 *     signer; nsec/bunker logins don't survive reloads).
 */
export function useBlossomUpload() {
  const { data: settings } = useSettings()
  const { signer } = useAuth()

  const [state, setState] = useState<UploadState>({
    progress: 0,
    uploading: false,
    error: null,
  })

  const abortRef = useRef<AbortController | null>(null)

  const servers = useMemo(() => parseServers(settings?.blossom_servers), [settings?.blossom_servers])

  // Abort any in-flight upload when the component unmounts.
  useEffect(() => () => abortRef.current?.abort(), [])

  const upload = useCallback(
    async (file: File): Promise<BlossomUploadResult> => {
      if (!signer) {
        throw new Error('Sign in again to upload media (signer unavailable)')
      }
      if (servers.length === 0) {
        throw new Error('No Blossom servers configured. Add one in Infrastructure settings.')
      }

      // Cancel any prior upload still running.
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setState({ progress: 0, uploading: true, error: null })

      try {
        // Unified adapter: works identically for nsec, NIP-07 extension, and
        // NIP-46 bunker — all three implement the nostrify `NostrSigner`
        // interface. The helper validates the returned event's shape at
        // runtime so a broken signer fails loudly instead of silently
        // producing an invalid auth header.
        const signFn = toBlossomSigner(signer)

        // Create a single BUD-02 auth event; reuse across all target servers.
        const authEvent = await createUploadAuth(signFn, file, {
          message: `Upload ${file.name}`,
        })
        const authHeader = encodeAuthorizationHeader(authEvent)

        // Track per-server progress so aggregate reflects real bandwidth.
        const loaded = new Array(servers.length).fill(0)
        const totals = new Array(servers.length).fill(file.size)

        const results = await Promise.allSettled(
          servers.map((server, i) => {
            const url = `${server.replace(/\/+$/, '')}/upload`
            return putViaXhr(
              url,
              file,
              authHeader,
              (l, t) => {
                loaded[i] = l
                totals[i] = t || file.size
                const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0)
                const pct = Math.min(100, Math.round((100 * sum(loaded)) / Math.max(1, sum(totals))))
                setState((s) => (s.uploading ? { ...s, progress: pct } : s))
              },
              controller.signal,
            )
          }),
        )

        const successes = results.filter(
          (r): r is PromiseFulfilledResult<BlobDescriptor> => r.status === 'fulfilled',
        )
        const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')

        if (successes.length === 0) {
          const msg = failures.map((f) => (f.reason as Error)?.message || String(f.reason)).join('; ')
          throw new Error(`All Blossom servers failed: ${msg}`)
        }

        if (failures.length > 0) {
          // eslint-disable-next-line no-console
          console.warn(
            '[blossom] partial upload failure on',
            failures.length,
            'of',
            servers.length,
            'servers:',
            failures.map((f) => (f.reason as Error)?.message),
          )
        }

        const descriptor = successes[0].value
        setState({ progress: 100, uploading: false, error: null })
        abortRef.current = null

        return { url: descriptor.url, sha256: descriptor.sha256, descriptor }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        setState({ progress: 0, uploading: false, error })
        abortRef.current = null
        throw error
      }
    },
    [signer, servers],
  )

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setState({ progress: 0, uploading: false, error: null })
  }, [])

  return {
    upload,
    progress: state.progress,
    uploading: state.uploading,
    error: state.error,
    reset,
    /** True when the Settings have at least one Blossom server configured. */
    hasServers: servers.length > 0,
  }
}
