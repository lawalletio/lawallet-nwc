import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render } from '@testing-library/react'

const settings = vi.hoisted(() => ({
  data: null as { gtag_id?: string } | null
}))

vi.mock('@/lib/client/hooks/use-settings', () => ({
  useSettings: () => ({ data: settings.data })
}))
vi.mock('next/script', () => ({
  default: ({ src }: { src: string }) => <script data-src={src} />
}))
vi.mock('@/components/analytics/route-change-tracker', () => ({
  RouteChangeTracker: () => null
}))

import { GoogleAnalytics } from '@/components/analytics/google-analytics'

beforeEach(() => {
  delete window.gtag
  delete window.dataLayer
})

afterEach(() => {
  cleanup()
})

describe('GoogleAnalytics', () => {
  it('is a no-op while no gtag_id is set', () => {
    settings.data = { gtag_id: '' }
    const { container } = render(<GoogleAnalytics />)
    expect(container.innerHTML).toBe('')
    expect(window.gtag).toBeUndefined()
  })

  it('loads gtag.js from the client-side settings in anonymous mode', () => {
    settings.data = { gtag_id: 'G-ABC123' }
    const { container } = render(<GoogleAnalytics />)

    expect(container.querySelector('script')?.dataset.src).toBe(
      'https://www.googletagmanager.com/gtag/js?id=G-ABC123'
    )
    const queued = (window.dataLayer ?? []).map(a =>
      Array.from(a as IArguments)
    )
    expect(queued[1]).toEqual([
      'config',
      'G-ABC123',
      expect.objectContaining({ anonymize_ip: true, send_page_view: false })
    ])
  })

  it('refuses an ID that is not a Google tag ID', () => {
    settings.data = { gtag_id: "G-1');alert(1);//" }
    const { container } = render(<GoogleAnalytics />)
    expect(container.innerHTML).toBe('')
    expect(window.gtag).toBeUndefined()
  })
})
