const STORAGE_KEY = 'lawallet:pending-activation'

/** An unclaimed card older than this is treated as abandoned. */
const TTL_MS = 60 * 60 * 1000

/**
 * Remembers the card a user opened from an activation QR, so leaving the
 * activate screen to log in or sign up brings them back to it instead of the
 * wallet home. localStorage (not session) because Android/iOS often open the
 * QR link in one tab and the user signs in from another.
 */
export function rememberPendingActivation(tokenId: string): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ tokenId, at: Date.now() })
    )
  } catch {
    // Storage blocked — the user can still rescan the QR.
  }
}

export function clearPendingActivation(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing stored.
  }
}

function readPendingActivation(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const { tokenId, at } = JSON.parse(raw) as {
      tokenId?: unknown
      at?: unknown
    }
    if (
      typeof tokenId !== 'string' ||
      typeof at !== 'number' ||
      Date.now() - at > TTL_MS
    ) {
      clearPendingActivation()
      return null
    }
    return tokenId
  } catch {
    return null
  }
}

/**
 * Where a wallet login/signup should land: back on the card being activated
 * when there is one, otherwise `fallback`.
 */
export function postAuthPath(fallback: string): string {
  const tokenId = readPendingActivation()
  return tokenId ? `/wallet/activate/${encodeURIComponent(tokenId)}` : fallback
}
