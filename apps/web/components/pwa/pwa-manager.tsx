'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Download, Share, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Chrome fires `beforeinstallprompt` with this non-standard event shape.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'lawallet:pwa-install-dismissed'

const INSTALLED_DISPLAY_MODES = [
  'standalone',
  'fullscreen',
  'minimal-ui',
  'window-controls-overlay'
] as const

function isInstalledDisplayMode(): boolean {
  if (typeof window === 'undefined') return false
  if (
    (window.navigator as Navigator & { standalone?: boolean }).standalone ===
    true
  ) {
    return true
  }
  return INSTALLED_DISPLAY_MODES.some(
    mode => window.matchMedia(`(display-mode: ${mode})`).matches
  )
}

// Module-level so a remount (or a later `beforeinstallprompt`) still honors a
// dismiss/install from this page load when localStorage is blocked.
let dismissedThisSession = false

function wasInstallDismissed(): boolean {
  if (dismissedThisSession) return true
  try {
    return localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

function rememberInstallDismissed(): void {
  dismissedThisSession = true
  try {
    localStorage.setItem(DISMISS_KEY, '1')
  } catch {
    // Private mode can throw; the in-memory flag still covers this session.
  }
}

/** @internal test-only — resets the session flag between cases. */
export function resetPwaInstallDismissalForTests(): void {
  dismissedThisSession = false
}

function shouldHideInstallPrompt(): boolean {
  return isInstalledDisplayMode() || wasInstallDismissed()
}

/**
 * iPhone, iPod, iPad, and iPadOS (which reports as MacIntel with touch).
 * Those browsers never fire `beforeinstallprompt`, so the wallet shows a
 * Share-sheet hint instead of a native install button.
 */
export function isIosInstallTarget(nav: {
  userAgent: string
  platform?: string
  maxTouchPoints?: number
}): boolean {
  if (/iPad|iPhone|iPod/.test(nav.userAgent)) return true
  return nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1
}

/**
 * Registers the service worker and renders a dismissible "Install app" prompt.
 *
 * Mounted inside the authenticated wallet layout so registration is scoped to
 * wallet sessions and the prompt only reaches signed-in users. The banner is
 * rendered on the wallet home only, above the tab bar, so it never covers the
 * address-claim or send/receive actions. Chrome/Android use
 * `beforeinstallprompt`. iOS never fires that event, so those browsers get a
 * dismissible Share-sheet hint instead. One dismissal (or an install) keeps
 * it quiet on this device.
 */
export function PwaManager() {
  const pathname = usePathname()
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null
  )
  const [iosHint, setIosHint] = useState(false)
  const [visible, setVisible] = useState(false)

  // Register the service worker.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    if (process.env.NODE_ENV !== 'production') return
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Registration failures are non-fatal — the app works without offline
        // support. Swallow so we never surface a scary console error to users.
      })
    }
    if (document.readyState === 'complete') register()
    else {
      window.addEventListener('load', register)
      return () => window.removeEventListener('load', register)
    }
  }, [])

  // Capture the install prompt.
  useEffect(() => {
    const hide = () => {
      setVisible(false)
      setDeferred(null)
      setIosHint(false)
    }

    // Running inside the installed app: never prompt, and remember so a later
    // visit in a regular browser tab also stays quiet.
    if (shouldHideInstallPrompt()) {
      if (isInstalledDisplayMode()) rememberInstallDismissed()
      return
    }

    if (isIosInstallTarget(window.navigator)) {
      setIosHint(true)
      setVisible(true)
    }

    const onPrompt = (e: Event) => {
      // Chrome can re-fire this after we hide, and after a successful install.
      if (shouldHideInstallPrompt()) return
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
      setVisible(true)
    }
    const onInstalled = () => {
      rememberInstallDismissed()
      hide()
    }
    const onDisplayModeChange = () => {
      if (!isInstalledDisplayMode()) return
      rememberInstallDismissed()
      hide()
    }

    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)

    const mediaQueries = INSTALLED_DISPLAY_MODES.map(mode =>
      window.matchMedia(`(display-mode: ${mode})`)
    )
    for (const mq of mediaQueries) {
      mq.addEventListener('change', onDisplayModeChange)
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
      for (const mq of mediaQueries) {
        mq.removeEventListener('change', onDisplayModeChange)
      }
    }
  }, [])

  const install = async () => {
    if (!deferred) return
    try {
      await deferred.prompt()
      const { outcome } = await deferred.userChoice
      if (outcome === 'accepted') rememberInstallDismissed()
    } finally {
      setVisible(false)
      setDeferred(null)
    }
  }

  const dismiss = () => {
    rememberInstallDismissed()
    setVisible(false)
  }

  // Captured during claim-username (or any other route) and shown once the
  // user reaches home, so the nudge does not cover that screen's CTA.
  if (!visible || pathname !== '/wallet') return null
  if (!deferred && !iosHint) return null

  const native = deferred != null

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4"
      style={{ bottom: 'calc(7.5rem + env(safe-area-inset-bottom))' }}
    >
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-lg">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          {native ? (
            <Download className="size-5 text-foreground" />
          ) : (
            <Share className="size-5 text-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-tight">
            {native ? 'Install the wallet' : 'Add to your Home Screen'}
          </p>
          <p className="text-xs text-muted-foreground">
            {native
              ? 'Add it to your home screen for quick access.'
              : 'Tap Share, then Add to Home Screen. You can keep using the wallet either way.'}
          </p>
        </div>
        {native && (
          <Button size="sm" onClick={install}>
            Install
          </Button>
        )}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}
