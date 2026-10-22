import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll } from 'vitest'

// happy-dom 21 sends real CORS preflights for the cross-origin, signed SDK
// calls (the instance lives on another origin than the test page). Answer
// them permissively so each test only has to mock the actual request.
export const server = setupServer(
  http.options(
    '*',
    () =>
      new HttpResponse(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': '*',
          'access-control-allow-headers': '*'
        }
      })
  )
)

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
