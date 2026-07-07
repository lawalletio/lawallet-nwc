import { createHash } from 'node:crypto'

/** Hex SHA-256 of a byte buffer — used for per-table integrity checks. */
export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function utf8Encode(text: string): Uint8Array {
  return encoder.encode(text)
}

export function utf8Decode(bytes: Uint8Array): string {
  return decoder.decode(bytes)
}

/**
 * Serializes rows to newline-delimited JSON. `JSON.stringify` renders `Date`
 * values as ISO-8601 strings and embeds Json columns natively, so this is a
 * faithful, line-diffable dump. A table with no rows yields an empty string.
 */
export function toNdjson(rows: unknown[]): string {
  return rows.map(row => JSON.stringify(row)).join('\n')
}

/** Parses newline-delimited JSON back into an array of raw objects. */
export function fromNdjson(text: string): unknown[] {
  const out: unknown[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    out.push(JSON.parse(line))
  }
  return out
}

/**
 * Canonical JSON with recursively sorted keys and `Date`→ISO normalization, so
 * two rows compare equal regardless of key order or Date-vs-string form. Used
 * to detect "identical" rows during analyze.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value))
}

function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(normalize)
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(obj).sort()) sorted[key] = normalize(obj[key])
    return sorted
  }
  return value
}

/** True when two rows are field-for-field identical after normalization. */
export function rowsEqual(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b)
}

/** Plaintext warning shipped inside every archive as `README.txt`. */
export const BACKUP_README = `LaWallet NWC — Backup Archive
=================================

This archive is a full or partial export of a LaWallet NWC instance.

⚠  SENSITIVE DATA
This archive may contain SECRETS in plaintext, including:
  • Remote wallet connection details (NWC URIs, LND macaroons) — RemoteWallet.config
  • NTAG424 card key material (k0..k4) — Ntag424
  • One-time card programming tokens — Card.writeToken / Card.otc
  • Alby NWC URIs — AlbySubAccount.nwcUri
  • Lightning invoice preimages — Invoice.preimage

Treat this file like a password vault:
  • Store it encrypted and offline.
  • Never commit it to version control or share it over insecure channels.
  • If you exported WITHOUT a password, anyone with this file has these secrets.

Layout
  manifest.json          Metadata: schema version, app version, table counts + checksums.
  tables/<name>.ndjson   One JSON record per line, one file per table.

Restore this archive from the admin dashboard:
  Settings ▸ Backup & Restore ▸ Restore Backup
`
