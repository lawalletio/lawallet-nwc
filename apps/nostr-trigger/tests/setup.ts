import { beforeEach } from 'vitest'
import { resetConfig } from '../src/config/index.js'
import { resetEnv } from '../src/config/env.js'
import { resetLogger } from '../src/logger.js'

// Test env defaults — individual tests can override.
process.env.NODE_ENV ??= 'test'
process.env.NT_MASTER_KEY ??= Buffer.alloc(32, 7).toString('base64')
process.env.NT_ADMIN_SECRET ??= 'test-admin-secret-at-least-sixteen-chars'
process.env.NT_SERVICE_NSEC ??=
  'nsec1wqcgudxsly0fz5gpkrp5jvzxlrwfgq7qyl07ndxj5stgz9gy7p6sf2m7p3'
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test'
process.env.REDIS_URL ??= 'redis://localhost:6379/15'
process.env.NT_CONTROL_RELAYS ??= ''
process.env.NT_ZAP_DEFAULT_RELAYS ??= ''

beforeEach(() => {
  resetConfig()
  resetEnv()
  resetLogger()
})
