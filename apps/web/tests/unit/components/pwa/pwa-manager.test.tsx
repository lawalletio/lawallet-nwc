import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const pathnameRef = vi.hoisted(() => ({ current: '/wallet' }))

vi.mock('next/navigation', () => ({
  usePathname: () => pathnameRef.current
}))

import {
  PwaManager,
  isIosInstallTarget,
  resetPwaInstallDismissalForTests
} from '@/components/pwa/pwa-manager'

const DISMISS_KEY = 'lawallet:pwa-install-dismissed'

type DisplayMode =
  | 'browser'
  | 'standalone'
  | 'fullscreen'
  | 'minimal-ui'
  | 'window-controls-overlay'

let currentDisplayMode: DisplayMode = 'browser'
const mediaListeners = new Map<string, Set<(ev: Event) => void>>()

function mockMatchMedia() {
  window.matchMedia = vi.fn((query: string) => {
    const mode = INSTALLED_MODES.find(m => query.includes(`display-mode: ${m}`))
    const mq = {
      matches: mode ? currentDisplayMode === mode : false,
      media: query,
      onchange: null,
      addEventListener: (type: string, listener: (ev: Event) => void) => {
        if (type !== 'change') return
        const set = mediaListeners.get(query) ?? new Set()
        set.add(listener)
        mediaListeners.set(query, set)
      },
      removeEventListener: (type: string, listener: (ev: Event) => void) => {
        mediaListeners.get(query)?.delete(listener)
      },
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }
    return mq as unknown as MediaQueryList
  })
}

const INSTALLED_MODES: DisplayMode[] = [
  'standalone',
  'fullscreen',
  'minimal-ui',
  'window-controls-overlay'
]

function fireBeforeInstallPrompt(
  outcome: 'accepted' | 'dismissed' = 'accepted'
) {
  const event = new Event('beforeinstallprompt', { cancelable: true })
  const prompt = vi.fn().mockResolvedValue(undefined)
  Object.assign(event, {
    prompt,
    userChoice: Promise.resolve({ outcome })
  })
  window.dispatchEvent(event)
  return { event, prompt }
}

describe('PwaManager', () => {
  beforeEach(() => {
    currentDisplayMode = 'browser'
    pathnameRef.current = '/wallet'
    mediaListeners.clear()
    localStorage.clear()
    resetPwaInstallDismissalForTests()
    mockMatchMedia()
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
    })
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: 'Linux'
    })
    Object.defineProperty(window.navigator, 'maxTouchPoints', {
      configurable: true,
      value: 0
    })
    Object.defineProperty(window.navigator, 'standalone', {
      configurable: true,
      value: undefined
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the install banner when the browser fires beforeinstallprompt', async () => {
    render(<PwaManager />)
    act(() => {
      fireBeforeInstallPrompt()
    })
    expect(await screen.findByText('Install the wallet')).toBeTruthy()
  })

  it('does not show the banner when already running as an installed PWA', () => {
    currentDisplayMode = 'standalone'
    render(<PwaManager />)
    act(() => {
      fireBeforeInstallPrompt()
    })
    expect(screen.queryByText('Install the wallet')).toBeNull()
    expect(localStorage.getItem(DISMISS_KEY)).toBe('1')
  })

  it('does not show the banner after the user previously dismissed it', () => {
    localStorage.setItem(DISMISS_KEY, '1')
    render(<PwaManager />)
    act(() => {
      fireBeforeInstallPrompt()
    })
    expect(screen.queryByText('Install the wallet')).toBeNull()
  })

  it('persists dismissal when the user closes the banner', async () => {
    const user = userEvent.setup()
    render(<PwaManager />)
    act(() => {
      fireBeforeInstallPrompt()
    })
    await screen.findByText('Install the wallet')
    await user.click(screen.getByLabelText('Dismiss install prompt'))
    expect(screen.queryByText('Install the wallet')).toBeNull()
    expect(localStorage.getItem(DISMISS_KEY)).toBe('1')

    act(() => {
      fireBeforeInstallPrompt()
    })
    expect(screen.queryByText('Install the wallet')).toBeNull()
  })

  it('hides and remembers the install after the user accepts the native prompt', async () => {
    const user = userEvent.setup()
    render(<PwaManager />)
    let prompt = vi.fn()
    act(() => {
      prompt = fireBeforeInstallPrompt('accepted').prompt
    })
    await screen.findByText('Install the wallet')
    await user.click(screen.getByRole('button', { name: 'Install' }))
    await waitFor(() => {
      expect(prompt).toHaveBeenCalled()
      expect(screen.queryByText('Install the wallet')).toBeNull()
      expect(localStorage.getItem(DISMISS_KEY)).toBe('1')
    })

    act(() => {
      fireBeforeInstallPrompt()
    })
    expect(screen.queryByText('Install the wallet')).toBeNull()
  })

  it('does not persist when the user cancels the native install prompt', async () => {
    const user = userEvent.setup()
    render(<PwaManager />)
    act(() => {
      fireBeforeInstallPrompt('dismissed')
    })
    await screen.findByText('Install the wallet')
    await user.click(screen.getByRole('button', { name: 'Install' }))
    await waitFor(() => {
      expect(screen.queryByText('Install the wallet')).toBeNull()
    })
    expect(localStorage.getItem(DISMISS_KEY)).toBeNull()
  })

  it('hides and remembers the install when the browser fires appinstalled', async () => {
    render(<PwaManager />)
    act(() => {
      fireBeforeInstallPrompt()
    })
    await screen.findByText('Install the wallet')
    act(() => {
      window.dispatchEvent(new Event('appinstalled'))
    })
    expect(screen.queryByText('Install the wallet')).toBeNull()
    expect(localStorage.getItem(DISMISS_KEY)).toBe('1')
  })

  it('hides when display-mode switches to standalone after the banner is shown', async () => {
    render(<PwaManager />)
    act(() => {
      fireBeforeInstallPrompt()
    })
    await screen.findByText('Install the wallet')

    currentDisplayMode = 'standalone'
    act(() => {
      const listeners = mediaListeners.get('(display-mode: standalone)')
      listeners?.forEach(listener => listener(new Event('change')))
    })
    expect(screen.queryByText('Install the wallet')).toBeNull()
    expect(localStorage.getItem(DISMISS_KEY)).toBe('1')
  })

  it('keeps the banner hidden this session when localStorage is blocked', async () => {
    const user = userEvent.setup()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('quota')
    })
    render(<PwaManager />)
    act(() => {
      fireBeforeInstallPrompt()
    })
    await screen.findByText('Install the wallet')
    await user.click(screen.getByLabelText('Dismiss install prompt'))
    expect(screen.queryByText('Install the wallet')).toBeNull()

    act(() => {
      fireBeforeInstallPrompt()
    })
    expect(screen.queryByText('Install the wallet')).toBeNull()
  })

  it('holds the banner until the user reaches the wallet home', async () => {
    pathnameRef.current = '/wallet/claim-username'
    const { rerender } = render(<PwaManager />)
    act(() => {
      fireBeforeInstallPrompt()
    })
    expect(screen.queryByText('Install the wallet')).toBeNull()

    pathnameRef.current = '/wallet'
    rerender(<PwaManager />)
    expect(await screen.findByText('Install the wallet')).toBeTruthy()
  })

  it('shows a Home Screen hint on iOS instead of a native install button', async () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
    })
    render(<PwaManager />)
    expect(await screen.findByText('Add to your Home Screen')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
    expect(screen.getByText(/Tap Share, then Add to Home Screen/)).toBeTruthy()
  })

  it('does not show the iOS hint after a previous dismissal', () => {
    localStorage.setItem(DISMISS_KEY, '1')
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'
    })
    render(<PwaManager />)
    expect(screen.queryByText('Add to your Home Screen')).toBeNull()
  })
})

describe('isIosInstallTarget', () => {
  it('treats iPadOS desktop UA as an install target', () => {
    expect(
      isIosInstallTarget({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',
        platform: 'MacIntel',
        maxTouchPoints: 5
      })
    ).toBe(true)
    expect(
      isIosInstallTarget({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',
        platform: 'MacIntel',
        maxTouchPoints: 0
      })
    ).toBe(false)
  })
})
