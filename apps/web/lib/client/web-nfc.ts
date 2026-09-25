/**
 * Web NFC feature detection. Chrome for Android is the only browser that
 * ships `NDEFReader` today, so the type is not in `lib.dom`. The surface here
 * is the slice both the admin card scanner and the wallet BoltCard reader use.
 */

export type NDEFReadingEvent = Event & {
  serialNumber?: string
  message?: NDEFMessageLike
}

export interface NDEFRecordLike {
  recordType: string
  mediaType?: string
  encoding?: string
  data?: BufferSource | null
}

export interface NDEFMessageLike {
  records: readonly NDEFRecordLike[]
}

export interface NDEFReaderLike {
  scan(opts?: { signal?: AbortSignal }): Promise<void>
  addEventListener(
    type: 'reading',
    listener: (event: NDEFReadingEvent) => void
  ): void
  addEventListener(type: 'readingerror', listener: (event: Event) => void): void
  removeEventListener(type: string, listener: EventListener): void
}

export interface NDEFReaderConstructor {
  new (): NDEFReaderLike
}

export function getNDEFReader(): NDEFReaderConstructor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { NDEFReader?: NDEFReaderConstructor }
  return w.NDEFReader ?? null
}

export function isWebNfcSupported(): boolean {
  return getNDEFReader() !== null
}

export type NfcPermissionState = 'granted' | 'denied' | 'prompt'

/** `navigator.permissions` for `"nfc"` is not implemented everywhere. */
export async function readNfcPermission(): Promise<NfcPermissionState | null> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) {
    return null
  }
  try {
    const status = await navigator.permissions.query({
      name: 'nfc' as PermissionName
    })
    if (
      status.state === 'granted' ||
      status.state === 'denied' ||
      status.state === 'prompt'
    ) {
      return status.state
    }
    return null
  } catch {
    return null
  }
}

export function isNfcAbortError(err: unknown): boolean {
  return errorName(err) === 'AbortError'
}

/**
 * Maps a failed `NDEFReader.scan()` to a UI phase. A missing user gesture and
 * a hard permission denial are both `NotAllowedError`; the Permissions API
 * state separates them when the browser exposes it.
 */
export function classifyNfcStartError(
  err: unknown,
  permission: NfcPermissionState | null
): 'aborted' | 'needs-permission' | 'denied' | 'unsupported' | 'error' {
  if (isNfcAbortError(err)) return 'aborted'
  const name = errorName(err)
  if (name === 'NotSupportedError') return 'unsupported'
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return permission === 'denied' ? 'denied' : 'needs-permission'
  }
  return 'error'
}

function errorName(err: unknown): string {
  if (!err || typeof err !== 'object' || !('name' in err)) return ''
  return String(err.name)
}
