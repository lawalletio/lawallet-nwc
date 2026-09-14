import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getEnv, resetEnv } from '../src/env.js'

/**
 * The four values an operator genuinely has to supply. Everything else must
 * boot on its default — an existing deploy upgrading into a release that adds
 * a tunable never learns it exists.
 */
const REQUIRED = {
  DATABASE_URL: 'postgresql://lawallet:pw@localhost:5432/lawallet',
  LISTENER_AUTH_SECRET: 'a'.repeat(32),
  WEB_ORIGIN: 'https://wallet.example.com',
  NWC_VAULT_SECRET: 'b'.repeat(32)
}

const OPTIONAL_KEYS = [
  'NODE_ENV',
  'LISTENER_PORT',
  'LISTENER_REQUEST_AUTH_SECRET',
  'PROXY_RECONCILE_INTERVAL_MS',
  'ZAP_SETTLE_INTERVAL_MS',
  'LOG_LEVEL',
  'LOG_PRETTY',
  'RECONCILE_INTERVAL_MS',
  'NWC_REQUEST_TIMEOUT_MS',
  'WEBHOOK_MAX_ATTEMPTS',
  'EVENT_RETENTION_DAYS',
  'CATCHUP_ENABLED',
  'CATCHUP_MAX_WINDOW_HOURS',
  'CATCHUP_OVERLAP_SECONDS',
  'CATCHUP_INTERVAL_MS',
  'DEAD_WALLET_DETECTION_ENABLED',
  'DEAD_THRESHOLD_HOURS',
  'DEAD_PROBE_INTERVAL_MS',
  'DEAD_PROBE_TIMEOUT_MS',
  'DEAD_CONFIRMATION_PROBES',
  'WALLET_ARCHIVE_IDLE_HOURS',
  'WALLET_ARCHIVE_RETRY_MS',
  'SENTRY_DSN',
  'SENTRY_ENVIRONMENT',
  'SENTRY_RELEASE'
]

const snapshot = { ...process.env }

function bareEnvironment(extra: Record<string, string> = {}): void {
  for (const key of [...OPTIONAL_KEYS, ...Object.keys(REQUIRED)]) {
    delete process.env[key]
  }
  Object.assign(process.env, REQUIRED, extra)
}

describe('listener env', () => {
  beforeEach(() => {
    resetEnv()
  })

  afterEach(() => {
    resetEnv()
    for (const key of Object.keys(process.env)) {
      if (!(key in snapshot)) delete process.env[key]
    }
    Object.assign(process.env, snapshot)
  })

  it('boots with zero optional variables set', () => {
    bareEnvironment()

    const env = getEnv()

    expect(env.WALLET_ARCHIVE_IDLE_HOURS).toBe(48)
    expect(env.WALLET_ARCHIVE_RETRY_MS).toBe(6 * 60 * 60 * 1000)
    expect(env.DEAD_WALLET_DETECTION_ENABLED).toBe(true)
    expect(env.DEAD_THRESHOLD_HOURS).toBe(4)
  })

  it.each(OPTIONAL_KEYS)(
    'falls back to the default when %s is set but empty',
    key => {
      bareEnvironment({ [key]: '' })

      expect(() => getEnv()).not.toThrow()
    }
  )

  it('keeps the archive window and retry on their product defaults when blank', () => {
    bareEnvironment({
      WALLET_ARCHIVE_IDLE_HOURS: '',
      WALLET_ARCHIVE_RETRY_MS: '   '
    })

    const env = getEnv()

    expect(env.WALLET_ARCHIVE_IDLE_HOURS).toBe(48)
    expect(env.WALLET_ARCHIVE_RETRY_MS).toBe(6 * 60 * 60 * 1000)
  })

  it('still honours explicit overrides', () => {
    bareEnvironment({
      WALLET_ARCHIVE_IDLE_HOURS: '72',
      WALLET_ARCHIVE_RETRY_MS: '3600000'
    })

    const env = getEnv()

    expect(env.WALLET_ARCHIVE_IDLE_HOURS).toBe(72)
    expect(env.WALLET_ARCHIVE_RETRY_MS).toBe(3600000)
  })

  it('still rejects a nonsense override rather than silently defaulting', () => {
    bareEnvironment({ WALLET_ARCHIVE_IDLE_HOURS: 'soon' })

    expect(() => getEnv()).toThrow(/WALLET_ARCHIVE_IDLE_HOURS/)
  })
})
