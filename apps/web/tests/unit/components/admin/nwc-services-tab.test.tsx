import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/lib/client/hooks/use-settings', () => ({
  useSettings: vi.fn(),
}))

const saveSettingMock = vi.hoisted(() => vi.fn())
vi.mock('@/components/admin/settings/auto-save-controls', async importOriginal => {
  const actual =
    await importOriginal<
      typeof import('@/components/admin/settings/auto-save-controls')
    >()
  return {
    ...actual,
    useSettingSaver: () => saveSettingMock,
  }
})

const apiPostMock = vi.hoisted(() => vi.fn())
vi.mock('@/components/admin/auth-context', () => ({
  useAuth: () => ({ apiClient: { post: apiPostMock } }),
}))

import { NwcServicesTab } from '@/components/admin/settings/nwc-services-tab'
import { useSettings } from '@/lib/client/hooks/use-settings'

const baseSettings = {
  listener_enabled: 'false',
  listener_url: '',
  listener_auth_secret: '',
  listener_url_source: 'none',
  listener_secret_source: 'none',
  listener_url_effective: '',
}

function mockSettings(overrides: Record<string, string> = {}) {
  vi.mocked(useSettings).mockReturnValue({
    data: { ...baseSettings, ...overrides },
    loading: false,
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  saveSettingMock.mockResolvedValue(undefined)
})

describe('NwcServicesTab', () => {
  it('toggling ON while unconfigured shows the hint and does not persist', async () => {
    mockSettings()
    render(<NwcServicesTab />)

    await userEvent.click(screen.getByRole('switch'))

    expect(
      screen.getByText(/add a listener url and shared secret/i)
    ).toBeTruthy()
    expect(saveSettingMock).not.toHaveBeenCalled()
  })

  it('shows the env-provisioned guidance and badges when both values come from env', () => {
    mockSettings({
      listener_enabled: 'true',
      listener_url_source: 'env',
      listener_secret_source: 'env',
      listener_url_effective: 'http://listener:4100',
    })
    render(<NwcServicesTab />)

    expect(screen.getByText(/provisioned via environment/i)).toBeTruthy()
    expect(screen.getAllByText('from environment').length).toBe(2)
    // Toggle reflects the effective (env-auto) state.
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
  })

  it('shows the serverless guidance when nothing is provisioned', () => {
    mockSettings()
    render(<NwcServicesTab />)
    expect(screen.getByText(/running on vercel or netlify/i)).toBeTruthy()
  })

  it('Generate fills a ≥32-char secret and persists the unit', async () => {
    mockSettings()
    render(<NwcServicesTab />)

    await userEvent.click(screen.getByRole('button', { name: /generate/i }))

    await waitFor(() => expect(saveSettingMock).toHaveBeenCalled())
    const patch = saveSettingMock.mock.calls[0][0] as Record<string, string>
    expect(patch.listener_auth_secret.length).toBeGreaterThanOrEqual(32)
    // Still disabled: no URL yet, so the unit persists enabled='false'.
    expect(patch.listener_enabled).toBe('false')
  })

  it('renders probe success details', async () => {
    mockSettings({
      listener_url_effective: 'http://listener:4100',
      listener_url_source: 'env',
      listener_secret_source: 'env',
    })
    apiPostMock.mockResolvedValue({
      ok: true,
      uptimeSeconds: 3600,
      connections: 4,
      relays: 2,
    })
    render(<NwcServicesTab />)

    await userEvent.click(
      screen.getByRole('button', { name: /test connection/i })
    )

    await waitFor(() => expect(screen.getByText(/listener reachable/i)).toBeTruthy())
    expect(apiPostMock).toHaveBeenCalledWith('/api/settings/listener-probe', {
      url: 'http://listener:4100',
    })
    expect(screen.getByText(/4 nwc connections/i)).toBeTruthy()
  })

  it('opens the deploy guide modal with the env checklist and docs link', async () => {
    mockSettings()
    render(<NwcServicesTab />)

    await userEvent.click(
      screen.getByRole('button', { name: /how to deploy the listener/i })
    )

    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('Deploying the NWC Listener')
    expect(dialog.textContent).toContain('DATABASE_URL')
    expect(dialog.textContent).toContain('LISTENER_AUTH_SECRET')
    expect(dialog.textContent).toContain('WEB_ORIGIN')
    const guideLink = screen.getByRole('link', { name: /open the full guide/i })
    expect(guideLink.getAttribute('href')).toBe(
      'https://docs.lawallet.io/docs/deploy/listener-setup'
    )
  })

  it('renders a probe failure inline', async () => {
    mockSettings({
      listener_url_effective: 'http://listener:4100',
      listener_url_source: 'env',
      listener_secret_source: 'env',
    })
    apiPostMock.mockResolvedValue({
      ok: false,
      code: 'unauthorized',
      error: 'Listener rejected the shared secret',
    })
    render(<NwcServicesTab />)

    await userEvent.click(
      screen.getByRole('button', { name: /test connection/i })
    )

    await waitFor(() =>
      expect(screen.getByText(/rejected the shared secret/i)).toBeTruthy()
    )
  })
})
