/**
 * The LUD-12 comment a payer attached when requesting the invoice.
 *
 * It is written into `Invoice.metadata.comment` by the LUD-16 callback rather
 * than a column, and is kept separate from `Invoice.description` — the
 * description is the memo we generate ("Payment to @alice"), while this is the
 * payer's own words and is what should be shown as such.
 *
 * https://github.com/lnurl/luds/blob/luds/12.md
 */
export function invoiceComment(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null
  const value = (metadata as Record<string, unknown>).comment
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
