import { describe, expect, it } from 'vitest'
import { verifyBearer } from '../src/http/auth'

const SECRET = 'a-very-long-shared-secret-for-tests-0123456789'

describe('verifyBearer', () => {
  it('accepts the correct bearer token', () => {
    expect(verifyBearer(`Bearer ${SECRET}`, SECRET)).toBe(true)
  })

  it('rejects a wrong secret', () => {
    expect(verifyBearer('Bearer nope', SECRET)).toBe(false)
  })

  it('rejects a missing header', () => {
    expect(verifyBearer(undefined, SECRET)).toBe(false)
  })

  it('rejects a non-Bearer scheme', () => {
    expect(verifyBearer(`Basic ${SECRET}`, SECRET)).toBe(false)
  })

  it('rejects tokens of different length without throwing', () => {
    expect(verifyBearer(`Bearer ${SECRET}${SECRET}`, SECRET)).toBe(false)
    expect(verifyBearer('Bearer x', SECRET)).toBe(false)
  })

  it('rejects everything when the secret is empty', () => {
    expect(verifyBearer('Bearer ', '')).toBe(false)
  })
})
