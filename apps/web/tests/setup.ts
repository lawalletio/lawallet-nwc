import '@testing-library/jest-dom/vitest'
// Register IndexedDB polyfills on `globalThis` so cache modules backed
// by IDB run unchanged under happy-dom (which doesn't ship its own IDB).
// Side-effect import — must run before any test or module under test
// references `indexedDB`.
import 'fake-indexeddb/auto'
import { beforeAll, afterAll, afterEach } from 'vitest'
import { server } from './mocks/server'

// Start MSW server before all tests
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'warn' })
})

// Reset handlers after each test
afterEach(() => {
  server.resetHandlers()
})

// Close MSW server after all tests
afterAll(() => {
  server.close()
})
