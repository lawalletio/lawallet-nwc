import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearApiCache } from '@/lib/client/hooks/use-api'
import { useSettings } from '@/lib/client/hooks/use-settings'

const authMock = vi.hoisted(() => {
  const getMock = vi.fn()
  return {
    getMock,
    authState: {
      status: 'authenticated' as
        | 'loading'
        | 'unauthenticated'
        | 'authenticated',
      pubkey: 'admin-pubkey' as string | null,
      role: 'ADMIN' as string | null,
      apiClient: { get: getMock }
    }
  }
})

vi.mock('@/components/admin/auth-context', () => ({
  useAuth: () => authMock.authState
}))

function SettingsReader({ id }: { id: string }) {
  const { data, loading } = useSettings()
  return (
    <div
      data-testid={id}
      data-domain={data?.domain ?? ''}
      data-loading={String(loading)}
    />
  )
}

function SettingsHarness({ showLate = false }: { showLate?: boolean }) {
  return (
    <>
      <SettingsReader id="settings-a" />
      <SettingsReader id="settings-b" />
      {showLate && <SettingsReader id="settings-late" />}
    </>
  )
}

describe('useApi request dedupe', () => {
  beforeEach(() => {
    clearApiCache()
    authMock.getMock.mockReset()
    authMock.authState.status = 'authenticated'
    authMock.authState.pubkey = 'admin-pubkey'
    authMock.authState.role = 'ADMIN'
  })

  afterEach(() => {
    clearApiCache()
  })

  it('shares a fresh authenticated settings response across admin consumers', async () => {
    authMock.getMock.mockResolvedValue({
      domain: 'admin.example',
      hasRoot: true
    })

    const view = render(<SettingsHarness />)

    await waitFor(() => {
      expect(screen.getByTestId('settings-a')).toHaveAttribute(
        'data-domain',
        'admin.example'
      )
      expect(screen.getByTestId('settings-b')).toHaveAttribute(
        'data-domain',
        'admin.example'
      )
    })

    expect(authMock.getMock).toHaveBeenCalledTimes(1)
    expect(authMock.getMock).toHaveBeenCalledWith('/api/settings')

    view.rerender(<SettingsHarness showLate />)

    await waitFor(() => {
      expect(screen.getByTestId('settings-late')).toHaveAttribute(
        'data-domain',
        'admin.example'
      )
      expect(screen.getByTestId('settings-late')).toHaveAttribute(
        'data-loading',
        'false'
      )
    })

    expect(authMock.getMock).toHaveBeenCalledTimes(1)
  })

  it('does not reuse anonymous settings after auth settles', async () => {
    authMock.getMock.mockImplementation(async () => {
      const statusAtCall = authMock.authState.status
      return {
        domain:
          statusAtCall === 'authenticated'
            ? 'admin.example'
            : 'public.example',
        hasRoot: true
      }
    })
    authMock.authState.status = 'unauthenticated'
    authMock.authState.pubkey = null
    authMock.authState.role = null

    const view = render(<SettingsReader id="settings" />)

    await waitFor(() => {
      expect(screen.getByTestId('settings')).toHaveAttribute(
        'data-domain',
        'public.example'
      )
    })
    expect(authMock.getMock).toHaveBeenCalledTimes(1)

    authMock.authState.status = 'authenticated'
    authMock.authState.pubkey = 'admin-pubkey'
    authMock.authState.role = 'ADMIN'
    view.rerender(<SettingsReader id="settings" />)

    await waitFor(() => {
      expect(screen.getByTestId('settings')).toHaveAttribute(
        'data-domain',
        'admin.example'
      )
    })

    expect(authMock.getMock).toHaveBeenCalledTimes(2)
  })
})
