import { describe, it, expect, beforeEach } from 'vitest'
import { resetConfig, getConfig } from '../../src/config/index.js'
import { resetEnv } from '../../src/config/env.js'

describe('config.security.dangerouslyFree', () => {
  beforeEach(() => {
    resetConfig()
    resetEnv()
  })

  it('defaults to false and requires NT_ADMIN_SECRET', () => {
    delete process.env.DANGEROUSLY_FREE
    process.env.NT_ADMIN_SECRET = 'x'.repeat(32)
    expect(getConfig().security.dangerouslyFree).toBe(false)
  })

  it('accepts DANGEROUSLY_FREE=true and lets NT_ADMIN_SECRET be unset', () => {
    process.env.DANGEROUSLY_FREE = 'true'
    delete process.env.NT_ADMIN_SECRET
    const config = getConfig()
    expect(config.security.dangerouslyFree).toBe(true)
    expect(config.http.adminSecret).toBeUndefined()
  })

  it('throws when DANGEROUSLY_FREE=false and NT_ADMIN_SECRET is missing', () => {
    process.env.DANGEROUSLY_FREE = 'false'
    delete process.env.NT_ADMIN_SECRET
    expect(() => getConfig()).toThrow(/NT_ADMIN_SECRET is required/)
  })

  it('treats any non-"true" value as false', () => {
    process.env.DANGEROUSLY_FREE = 'yes'
    process.env.NT_ADMIN_SECRET = 'x'.repeat(32)
    expect(getConfig().security.dangerouslyFree).toBe(false)
  })
})
