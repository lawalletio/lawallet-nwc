import { z } from 'zod'

/**
 * Other apps' relying parties a user may import a stored-mode passkey from,
 * once (`PASSKEY_IMPORT_SOURCES`). Each source's `/.well-known/webauthn`
 * must list this instance's origin, or the browser refuses the request.
 * Listing a source is a trust decision: after the user unlocks a passkey of
 * that RP, this instance receives its secret. Optional iframe signing keeps the
 * secret with the configured provider and does not use related-origin recovery.
 */
export const passkeyImportSourceSchema = z.object({
  /** Shown to the user when there is more than one source. */
  label: z.string().trim().min(1).max(64),
  format: z.enum(['npk', 'nosskey']).optional(),
  /** Optional provider signing, independent of importing private keys. */
  iframeUrl: z
    .string()
    .url()
    .refine(value => {
      const url = new URL(value)
      return url.protocol === 'https:' && !url.username && !url.password
    }, 'iframeUrl must use HTTPS')
    .optional(),
  /** The source's RP ID, a bare host name. */
  rpId: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/,
      'rpId must be a host name'
    ),
  /** Relays holding the source's kind 31778 records (and legacy 31777 records); defaults apply when omitted. */
  relays: z
    .array(z.string().regex(/^wss?:\/\/\S+$/, 'relays must be ws(s) URLs'))
    .max(8)
    .optional()
})

export type PasskeyImportSource = z.infer<typeof passkeyImportSourceSchema>

export const passkeyImportSourcesSchema = z
  .array(passkeyImportSourceSchema)
  .refine(
    sources => new Set(sources.map(s => s.rpId)).size === sources.length,
    'Each import source needs its own rpId'
  )

/** Parses the env value: a JSON array, empty or unset meaning no sources. */
export function parsePasskeyImportSources(raw: unknown): unknown {
  if (raw === undefined || raw === null) return []
  if (typeof raw !== 'string') return raw
  if (!raw.trim()) return []
  try {
    return JSON.parse(raw)
  } catch {
    return raw // fails validation with a readable error
  }
}
