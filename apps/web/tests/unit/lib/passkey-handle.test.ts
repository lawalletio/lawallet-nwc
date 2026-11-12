import { describe, it, expect } from 'vitest'
import {
  classifyPasskeyHandle,
  createDerivedHandle,
  createStoredHandle,
  isLaWalletHandle,
  storedHandleAuthor
} from '@/lib/passkey-handle'
import { derivePrfNsecHex, PRF_SALT_HEX } from '@/lib/client/passkey-prf'
// Verbatim copy of the proposal's passkey-key-mode-vectors.json.
import vectors from './passkey-key-mode-vectors.json'

const hex = (value: string | null) =>
  value === null ? null : new Uint8Array(Buffer.from(value, 'hex'))

// LaWallet derives from these and refuses every other vector.
const LAWALLET = [
  'tagged derived, parameter set 0x02',
  'untagged UUID text handle',
  'no handle returned'
]

describe.each(vectors.handles)(
  '$description',
  ({ description, handle, expect: want }) => {
    it('classifies like the vector', () => {
      const stored = want as { author?: string; legacy?: string }
      expect(classifyPasskeyHandle(hex(handle))).toEqual(
        want.mode === 'derived'
          ? { mode: 'derived', parameterSet: want.parameter_set }
          : want.mode === 'stored'
            ? {
                mode: 'stored',
                ...(stored.author ? { author: stored.author } : {}),
                ...(stored.legacy ? { legacy: stored.legacy } : {}),
                ...(stored.legacy === 'raw-pubkey'
                  ? { confirmRecord: true }
                  : {})
              }
            : { mode: want.mode }
      )
    })

    it(LAWALLET.includes(description) ? 'is LaWallet' : 'is refused', () => {
      expect(isLaWalletHandle(hex(handle))).toBe(LAWALLET.includes(description))
    })
  }
)

it('createDerivedHandle mints a random tagged 0x02 handle', () => {
  const a = createDerivedHandle()
  expect(Buffer.from(a).toString('hex')).toMatch(/^4e504b010102[0-9a-f]{32}$/)
  expect(a).not.toEqual(createDerivedHandle())
})

it('parameter set 0x02 is the frozen LaWallet derivation', async () => {
  const set = vectors.derived_parameter_sets.find(s => s.parameter_set === 2)!
  expect(set.prf_input).toBe(PRF_SALT_HEX)
  expect(await derivePrfNsecHex(hex(set.prf_output)!)).toBe(set.secret_key)
})

it('createStoredHandle names the author and classifies back to it', () => {
  const author = vectors.handles.find(h => h.description === 'tagged stored')!
  const handle = createStoredHandle(author.expect.author!)
  expect(Buffer.from(handle).toString('hex')).toBe(author.handle)
  expect(storedHandleAuthor(handle)).toBe(author.expect.author)
  expect(() => createStoredHandle('xyz')).toThrow()
})

it('only tagged stored handles have a stored author', () => {
  for (const { description, handle } of vectors.handles) {
    expect(storedHandleAuthor(hex(handle)) !== null).toBe(
      description === 'tagged stored'
    )
  }
})
