import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  replace: vi.fn(),
  refetch: vi.fn(),
  integrations: [] as unknown[]
}))

vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError }
}))

vi.mock('@/lib/client/hooks/use-api', () => ({
  useMutation: () => ({ mutate: mocks.mutate, loading: false }),
  useApi: () => ({
    data: { secretsEncrypted: true, integrations: mocks.integrations },
    loading: false,
    refetch: mocks.refetch
  })
}))

vi.mock('@/components/admin/auth-context', () => ({
  useAuth: () => ({ status: 'authenticated', isAuthorized: () => true })
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace })
}))

vi.mock('@/components/admin/admin-topbar', () => ({
  AdminTopbar: ({ title }: { title: string }) => <h1>{title}</h1>
}))

import {
  IntegrationCard,
  integrationStatus,
  type IntegrationState
} from '@/components/admin/integrations/integration-card'
import { BRAND_ICONS } from '@/components/admin/integrations/brand-icons'
import IntegrationsPage from '@/app/admin/integrations/page'
import { INTEGRATIONS, INTEGRATION_IDS } from '@/lib/integrations/catalog'

function state(
  id: keyof typeof INTEGRATIONS,
  over: Partial<IntegrationState> = {}
): IntegrationState {
  return {
    ...INTEGRATIONS[id],
    enabled: false,
    configured: false,
    values: {},
    secretsConfigured: {},
    ...over
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mutate.mockResolvedValue({ ok: true })
})

describe('integrationStatus', () => {
  it('maps enabled/configured/test to one status', () => {
    expect(integrationStatus({ enabled: false, configured: false })).toBe(
      'not_set_up'
    )
    expect(integrationStatus({ enabled: false, configured: true })).toBe(
      'configured'
    )
    expect(integrationStatus({ enabled: true, configured: true })).toBe(
      'enabled'
    )
    expect(integrationStatus({ enabled: true, configured: false })).toBe(
      'incomplete'
    )
    expect(
      integrationStatus(
        { enabled: true, configured: true },
        { ok: false, detail: 'x' }
      )
    ).toBe('error')
  })
})

describe('BRAND_ICONS', () => {
  it('has an icon for every catalog integration', () => {
    for (const id of INTEGRATION_IDS) expect(BRAND_ICONS[id]).toBeTypeOf('function')
  })
})

describe('IntegrationCard', () => {
  it('shows a Set up button and opens the config dialog', async () => {
    const user = userEvent.setup()
    render(<IntegrationCard integration={state('cloudflare_dns')} onSaved={vi.fn()} />)

    expect(screen.getByText('Not set up')).toBeInTheDocument()
    expect(screen.queryByLabelText(/API token/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Set up Cloudflare DNS' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText(/API token/)).toHaveValue('')
    expect(within(dialog).getByLabelText(/Zone ID/)).toBeInTheDocument()
    // Can't enable before the required fields are saved.
    expect(within(dialog).getByRole('switch', { name: 'Enabled' })).toBeDisabled()
  })

  it('saves the draft config with PUT and keeps secrets write-only', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    render(
      <IntegrationCard
        integration={state('vercel_dns', {
          configured: true,
          values: { vercel_dns_team_id: 'team_1', vercel_dns_zone: '' },
          secretsConfigured: { vercel_dns_token: true }
        })}
        onSaved={onSaved}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Configure Vercel DNS' }))
    const dialog = await screen.findByRole('dialog')
    const token = within(dialog).getByLabelText(/API token/)
    // A stored secret is never echoed back, only flagged.
    expect(token).toHaveValue('')
    expect(token).toHaveAttribute('placeholder', expect.stringMatching(/saved/))

    const save = within(dialog).getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    await user.type(within(dialog).getByLabelText(/Zone domain/), 'example.com')
    await user.click(save)

    expect(mocks.mutate).toHaveBeenCalledWith('put', '/api/integrations/vercel_dns', {
      config: {
        vercel_dns_token: '',
        vercel_dns_team_id: 'team_1',
        vercel_dns_zone: 'example.com'
      }
    })
    expect(onSaved).toHaveBeenCalled()
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Vercel DNS saved')
    // The dialog stays open after saving.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('toggles enabled with PUT', async () => {
    const user = userEvent.setup()
    render(
      <IntegrationCard
        integration={state('alias', { configured: true })}
        onSaved={vi.fn()}
      />
    )
    await user.click(screen.getByRole('button', { name: /Configure Gorilla/ }))
    await user.click(await screen.findByRole('switch', { name: 'Enabled' }))
    expect(mocks.mutate).toHaveBeenCalledWith('put', '/api/integrations/alias', {
      enabled: true
    })
  })

  it('runs the connection test and flags a failure on the card', async () => {
    const user = userEvent.setup()
    mocks.mutate.mockResolvedValueOnce({ ok: false, detail: 'Bad token' })
    render(
      <IntegrationCard
        integration={state('wapu', {
          enabled: true,
          configured: true,
          secretsConfigured: { wapu_api_key: true }
        })}
        onSaved={vi.fn()}
      />
    )
    expect(screen.getByText('Enabled')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Configure Wapu' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Test connection' }))

    expect(mocks.mutate).toHaveBeenCalledWith('post', '/api/integrations/wapu/test')
    expect(within(dialog).getByRole('status')).toHaveTextContent('Bad token')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('Connection failed')).toBeInTheDocument()
  })
})

describe('IntegrationsPage search', () => {
  beforeEach(() => {
    mocks.integrations = INTEGRATION_IDS.map(id => state(id))
  })

  it('filters by name, description and kind, with an empty state', async () => {
    const user = userEvent.setup()
    render(<IntegrationsPage />)
    const search = screen.getByRole('searchbox', { name: 'Search integrations' })
    const titles = () =>
      screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)

    expect(titles()).toHaveLength(INTEGRATION_IDS.length)

    await user.type(search, 'dns')
    expect(titles()).toEqual(['Vercel DNS', 'Cloudflare DNS'])

    await user.clear(search)
    await user.type(search, 'cash-out')
    expect(titles()).toEqual(['Bull Bitcoin', 'Wapu'])

    await user.clear(search)
    await user.type(search, 'CBU')
    expect(titles()).toContain('Gorilla API (alias lookup)')

    await user.clear(search)
    await user.type(search, 'nothing-matches')
    expect(screen.getByText(/No integrations match/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(titles()).toHaveLength(INTEGRATION_IDS.length)
  })
})
