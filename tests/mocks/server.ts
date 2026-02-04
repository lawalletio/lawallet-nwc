import { setupServer } from 'msw/node'
import { handlers } from './handlers'

// MSW server for tests
export const server = setupServer(...handlers)
