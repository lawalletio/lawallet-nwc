// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/tests/mocks/server'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ isTest: true, isDevelopment: false }))
}))

import { cloudflareDns, vercelDns } from '@/lib/integrations/dns-provider'

const FQDN = 'alice.user._bitcoin-payment.example.com'
const VALUE = 'bitcoin:?sp=sp1qexample'

describe('vercelDns', () => {
  const VC = 'https://api.vercel.com'
  const dns = vercelDns({ token: 't', zone: 'example.com', teamId: 'team_1' })

  it('creates a record named relative to the zone when none exists', async () => {
    let body: unknown
    let url = ''
    server.use(
      http.get(`${VC}/v4/domains/example.com/records`, () =>
        HttpResponse.json({ records: [], pagination: { next: null } })
      ),
      http.post(`${VC}/v2/domains/example.com/records`, async ({ request }) => {
        url = request.url
        body = await request.json()
        return HttpResponse.json({ uid: 'rec_1' })
      })
    )
    await dns.setTxt(FQDN, VALUE)
    expect(url).toContain('teamId=team_1')
    expect(body).toEqual({
      name: 'alice.user._bitcoin-payment',
      type: 'TXT',
      value: VALUE,
      ttl: 300
    })
  })

  it('patches an existing record found on a later page', async () => {
    let patched = ''
    server.use(
      http.get(`${VC}/v4/domains/example.com/records`, ({ request }) =>
        new URL(request.url).searchParams.get('until')
          ? HttpResponse.json({
              records: [
                {
                  id: 'rec_9',
                  name: 'alice.user._bitcoin-payment',
                  type: 'TXT'
                }
              ],
              pagination: { next: null }
            })
          : HttpResponse.json({
              records: [{ id: 'x', name: 'www', type: 'CNAME' }],
              pagination: { next: 123 }
            })
      ),
      http.patch(`${VC}/v1/domains/records/:id`, ({ params }) => {
        patched = params.id as string
        return HttpResponse.json({})
      })
    )
    await dns.setTxt(FQDN, VALUE)
    expect(patched).toBe('rec_9')
  })

  it('rejects names outside the zone', async () => {
    await expect(
      dns.setTxt('alice.user._bitcoin-payment.other.org', VALUE)
    ).rejects.toThrow(/not inside the zone/)
  })

  it('surfaces API errors', async () => {
    server.use(
      http.get(`${VC}/v4/domains/example.com/records`, () =>
        HttpResponse.json(
          { error: { message: 'Not authorized' } },
          { status: 403 }
        )
      )
    )
    await expect(dns.deleteTxt(FQDN)).rejects.toThrow('Vercel: Not authorized')
  })

  it('falls back to the HTTP status when the error body is not JSON', async () => {
    server.use(
      http.get(
        `${VC}/v4/domains/example.com/records`,
        () => new HttpResponse('nope', { status: 502 })
      )
    )
    await expect(dns.test()).rejects.toThrow('Vercel: HTTP 502')
  })

  it('deletes an existing record (no team id → no query string)', async () => {
    const solo = vercelDns({ token: 't', zone: 'Example.com' })
    let deleted = ''
    server.use(
      http.get(`${VC}/v4/domains/example.com/records`, ({ request }) => {
        expect(new URL(request.url).searchParams.has('teamId')).toBe(false)
        return HttpResponse.json({
          records: [
            { id: 'rec_2', name: 'alice.user._bitcoin-payment', type: 'TXT' }
          ],
          pagination: { next: null }
        })
      }),
      http.delete(
        `${VC}/v2/domains/example.com/records/:id`,
        ({ request, params }) => {
          deleted = `${params.id}${new URL(request.url).search}`
          return HttpResponse.json({})
        }
      )
    )
    await solo.deleteTxt(FQDN)
    expect(deleted).toBe('rec_2')
  })

  it('skips the delete when no record exists', async () => {
    server.use(
      http.get(`${VC}/v4/domains/example.com/records`, () =>
        HttpResponse.json({ records: [], pagination: { next: null } })
      )
    )
    await expect(dns.deleteTxt(FQDN)).resolves.toBeUndefined()
  })

  it('test() warns that Vercel has no DNSSEC', async () => {
    server.use(
      http.get(`${VC}/v4/domains/example.com/records`, () =>
        HttpResponse.json({ records: [], pagination: { next: null } })
      )
    )
    expect(await dns.test()).toMatch(/does not sign zones with DNSSEC/)
  })
})

describe('cloudflareDns', () => {
  const CF = 'https://api.cloudflare.com/client/v4/zones/z1'
  const dns = cloudflareDns({ token: 't', zoneId: 'z1' })

  it('creates a quoted TXT record when none exists', async () => {
    let body: unknown
    let auth = ''
    server.use(
      http.get(`${CF}/dns_records`, ({ request }) => {
        auth = request.headers.get('authorization') ?? ''
        expect(new URL(request.url).searchParams.get('name')).toBe(FQDN)
        return HttpResponse.json({ success: true, result: [] })
      }),
      http.post(`${CF}/dns_records`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ success: true, result: {} })
      })
    )
    await dns.setTxt(FQDN, VALUE)
    expect(auth).toBe('Bearer t')
    expect(body).toEqual({
      type: 'TXT',
      name: FQDN,
      content: `"${VALUE}"`,
      ttl: 300
    })
  })

  it('updates in place and deletes by id', async () => {
    const calls: string[] = []
    server.use(
      http.get(`${CF}/dns_records`, () =>
        HttpResponse.json({ success: true, result: [{ id: 'r1' }] })
      ),
      http.put(`${CF}/dns_records/r1`, () => {
        calls.push('put')
        return HttpResponse.json({ success: true })
      }),
      http.delete(`${CF}/dns_records/r1`, () => {
        calls.push('delete')
        return HttpResponse.json({ success: true })
      })
    )
    await dns.setTxt(FQDN, VALUE)
    await dns.deleteTxt(FQDN)
    expect(calls).toEqual(['put', 'delete'])
  })

  it('test() reports the DNSSEC status', async () => {
    server.use(
      http.get(`${CF}/dnssec`, () =>
        HttpResponse.json({ success: true, result: { status: 'disabled' } })
      )
    )
    expect(await dns.test()).toMatch(/DNSSEC is disabled/)
  })

  it.each([
    [{ status: 'active' }, /DNSSEC is active/],
    [undefined, /DNSSEC is unknown/]
  ])('test() reports DNSSEC %j', async (result, expected) => {
    server.use(
      http.get(`${CF}/dnssec`, () =>
        HttpResponse.json({ success: true, result })
      )
    )
    expect(await dns.test()).toMatch(expected)
  })

  it('surfaces errors[] from a success:false body', async () => {
    server.use(
      http.get(`${CF}/dns_records`, () =>
        HttpResponse.json({
          success: false,
          errors: [{ message: 'Invalid zone' }]
        })
      )
    )
    await expect(dns.deleteTxt(FQDN)).rejects.toThrow(
      'Cloudflare: Invalid zone'
    )
  })
})
