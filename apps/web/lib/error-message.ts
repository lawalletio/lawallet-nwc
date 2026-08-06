/**
 * Unwrap a thrown value into a message safe to log or show. Non-Error throws
 * fall back to `fallback` when given, so callers can keep a domain-specific
 * wording instead of stringifying an object.
 */
export function errorMessage(error: unknown, fallback?: string): string {
  if (error instanceof Error) return error.message
  return fallback ?? String(error)
}
