import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import type { DomainProbeResult } from '@/lib/domain-onboarding'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    maintenance: { enabled: false },
    requestLimits: { maxBodySize: 1048576, maxJsonSize: 1048576 },
  })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn,
}))

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn(),
}))

vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn(),
}))

vi.mock('@/lib/settings-auth', () => ({
  authenticateSettingsWriteRequest: vi.fn(),
}))

vi.mock('@/lib/domain-onboarding', () => ({
  probeDomainRouting: vi.fn(),
}))

vi.mock('@/lib/events/event-bus', () => ({
  eventBus: { emit: vi.fn() },
}))

import { POST } from '@/app/api/settings/domain-probe/route'
import { authenticateSettingsWriteRequest } from '@/lib/settings-auth'
import { probeDomainRouting } from '@/lib/domain-onboarding'

function probeResult({
  status,
  instanceState = status === 'ready' ? 'pass' : 'fail',
  lnurlState = status === 'ready' ? 'pass' : 'fail',
  nip05State = status === 'ready' ? 'pass' : 'fail',
}: {
  status: DomainProbeResult['status']
  instanceState?: 'pass' | 'fail'
  lnurlState?: 'pass' | 'fail' | 'skip'
  nip05State?: 'pass' | 'fail' | 'skip'
}): DomainProbeResult {
  return {
    domain: 'example.com',
    endpoint: 'https://gateway.example.com',
    direct: false,
    status,
    checks: {
      instance: {
        state: instanceState,
        label: 'LaWallet',
        url: 'https://example.com/.well-known/lawallet.json',
        detail:
          instanceState === 'pass'
            ? 'Discovery routes to this LaWallet instance.'
            : 'Discovery is not routed to this LaWallet instance.',
      },
      lnurl: {
        state: lnurlState,
        label: 'LNURL',
        url: 'https://example.com/.well-known/lnurlp/lawalletverify',
        detail:
          lnurlState === 'pass'
            ? 'Discovery reaches this instance.'
            : 'No Lightning Address user found yet.',
      },
      nip05: {
        state: nip05State,
        label: 'NIP-05',
        url: '',
        detail:
          nip05State === 'pass'
            ? 'Nostr discovery is reachable.'
            : 'No Lightning Address user found yet.',
      },
    },
    platform: {
      kind: 'unknown',
      label: 'Unknown',
      confidence: 'low',
      evidence: [],
    },
    instructions: {
      title: 'Route .well-known',
      summary: 'Route discovery to this instance.',
      snippet: '',
      tip: '',
    },
    instructionOptions: [],
  }
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  vi.mocked(authenticateSettingsWriteRequest).mockResolvedValue('a'.repeat(64))
  vi.mocked(prismaMock.settings.upsert).mockResolvedValue({} as any)
})

describe('POST /api/settings/domain-probe', () => {
  it('marks the domain verified when the probe result is ready', async () => {
    vi.mocked(probeDomainRouting).mockResolvedValue(probeResult({ status: 'ready' }))

    const req = createNextRequest('/api/settings/domain-probe', {
      method: 'POST',
      body: { domain: 'example.com', endpoint: 'https://gateway.example.com' },
    })
    const res = await POST(req)

    await assertResponse(res, 200)
    expect(probeDomainRouting).toHaveBeenCalledWith({
      domain: 'example.com',
      endpoint: 'https://gateway.example.com',
    })
    expect(prismaMock.lightningAddress.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.settings.upsert).toHaveBeenCalledWith({
      where: { name: 'domain_verified' },
      update: { value: 'true' },
      create: { name: 'domain_verified', value: 'true' },
    })
  })

  it('marks the domain unverified when the instance probe fails', async () => {
    vi.mocked(probeDomainRouting).mockResolvedValue(probeResult({ status: 'rewrite-needed' }))

    const req = createNextRequest('/api/settings/domain-probe', {
      method: 'POST',
      body: { domain: 'example.com', endpoint: 'https://gateway.example.com' },
    })
    const res = await POST(req)

    await assertResponse(res, 200)
    expect(prismaMock.settings.upsert).toHaveBeenCalledWith({
      where: { name: 'domain_verified' },
      update: { value: 'false' },
      create: { name: 'domain_verified', value: 'false' },
    })
  })

  it('keeps the domain unverified when only the instance probe passes', async () => {
    vi.mocked(probeDomainRouting).mockResolvedValue(
      probeResult({
        status: 'rewrite-needed',
        instanceState: 'pass',
        lnurlState: 'fail',
        nip05State: 'pass',
      }),
    )

    const req = createNextRequest('/api/settings/domain-probe', {
      method: 'POST',
      body: { domain: 'example.com', endpoint: 'https://gateway.example.com' },
    })
    const res = await POST(req)

    await assertResponse(res, 200)
    expect(prismaMock.settings.upsert).toHaveBeenCalledWith({
      where: { name: 'domain_verified' },
      update: { value: 'false' },
      create: { name: 'domain_verified', value: 'false' },
    })
  })
})
