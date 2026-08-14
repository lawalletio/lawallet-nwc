import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { useInstanceInfo } from '../src'
import { ENDPOINT, StubEventSource, renderWithProvider } from './helpers'
import { server } from './setup'

function Branding() {
  const { settings, loading } = useInstanceInfo()
  if (loading) return <span>loading…</span>
  return <h1>{settings?.community_name ?? 'unknown'}</h1>
}

describe('LaWalletProvider', () => {
  beforeEach(() => StubEventSource.reset())

  it('fetches public instance settings automatically', async () => {
    server.use(
      http.get(`${ENDPOINT}/api/settings`, ({ request }) => {
        expect(request.headers.get('authorization')).toBeNull()
        return HttpResponse.json({
          domain: 'instance.test',
          community_name: 'La Comunidad'
        })
      })
    )

    renderWithProvider(<Branding />)

    expect(screen.getByText('loading…')).toBeDefined()
    await waitFor(() => expect(screen.getByText('La Comunidad')).toBeDefined())
  })

  it('surfaces settings fetch failures as an error, not a crash', async () => {
    server.use(
      http.get(`${ENDPOINT}/api/settings`, () =>
        HttpResponse.json({ error: { message: 'down' } }, { status: 503 })
      )
    )

    function ErrorProbe() {
      const { error, loading } = useInstanceInfo()
      if (loading) return <span>loading…</span>
      return <span>{error ? 'errored' : 'fine'}</span>
    }

    renderWithProvider(<ErrorProbe />)
    await waitFor(() => expect(screen.getByText('errored')).toBeDefined())
  })

  it('does not open an SSE stream while unauthenticated', async () => {
    server.use(
      http.get(`${ENDPOINT}/api/settings`, () => HttpResponse.json({}))
    )

    renderWithProvider(<Branding />)
    await waitFor(() => expect(screen.queryByText('loading…')).toBeNull())
    expect(StubEventSource.instances).toHaveLength(0)
  })
})
