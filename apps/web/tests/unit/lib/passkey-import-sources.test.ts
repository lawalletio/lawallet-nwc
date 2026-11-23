import { describe, expect, it } from 'vitest'
import { passkeyImportSourcesSchema } from '@/lib/passkey-import-sources'

describe('configured passkey sources', () => {
  const sources = Array.from({ length: 8 }, (_, i) => ({
    label: `App ${i}`,
    rpId: `app${i}.example`
  }))
  it('does not impose the ROR origin-label limit on the client source directory', () => {
    expect(passkeyImportSourcesSchema.parse(sources)).toHaveLength(8)
  })
  it('still refuses duplicate RP IDs', () => {
    expect(
      passkeyImportSourcesSchema.safeParse([...sources, sources[0]]).success
    ).toBe(false)
  })
})
