'use client'

import { useMutation } from '@/lib/client/hooks/use-api'
import type { Permission, Role } from '@/lib/auth/permissions'

/** Request body for `POST /api/auth/qr-jwt/generate`. */
export interface GenerateDeviceTokenInput {
  /** DB id of the user the device token will act as. */
  userId: string
  /** Permission scopes to grant — a subset of the admin's own RBAC. */
  permissions: Permission[]
  /** `ms`-style duration (`8h`, `7d`) or a number-of-seconds string. */
  expiresIn: string
}

/** Response from a successful device-token generation. */
export interface GenerateDeviceTokenResult {
  /** The signed JWT — render as a QR and/or copy to the clipboard. */
  jwt: string
  /** Effective expiry the server applied (unit string or seconds). */
  expiresIn: string | number
  /** The scopes baked into the token (validated + de-duped server-side). */
  scopes: Permission[]
  /** Platform base URL baked into the token (e.g. `https://app.example.com`). */
  apiUrl: string
  /** Identity the token authenticates as. */
  user: { id: string; pubkey: string; role: Role }
}

/**
 * Mints a stateless device token (B.0) for the QR-login flow. Admin-only — the
 * endpoint rejects non-admins and any scope the caller doesn't hold.
 */
export function useGenerateDeviceToken() {
  const { mutate, loading, error } = useMutation<
    GenerateDeviceTokenInput,
    GenerateDeviceTokenResult
  >()
  return {
    generate: (input: GenerateDeviceTokenInput) =>
      mutate('post', '/api/auth/qr-jwt/generate', input),
    loading,
    error,
  }
}
