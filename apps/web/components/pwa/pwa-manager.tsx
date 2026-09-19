'use client'

import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'
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

function wasInstallDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

function rememberInstallDismissed(): void {
  try {
    localStorage.setItem(DISMISS_KEY, '1')
  } catch {
    // Private mode can throw; hiding in memory still covers this session.
  }
}

function shouldHideInstallPrompt(): boolean {
  return isInstalledDisplayMode() || wasInstallDismissed()
}

/**
 * Registers the service worker and renders a dismissible "Install app" prompt.
 *
 * Mounted inside the authenticated wallet layout so registration is scoped to
 * wallet sessions and the prompt only reaches signed-in users. The install
 * banner shows once the browser fires `beforeinstallprompt`, unless the user
 * already installed the app or dismissed the banner before.
 */
export function PwaManager() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null
  )
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
    }

    // Running inside the installed app: never prompt, and remember so a later
    // visit in a regular browser tab also stays quiet.
    if (shouldHideInstallPrompt()) {
      if (isInstalledDisplayMode()) rememberInstallDismissed()
      return
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

  if (!visible) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center p-4">
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-lg">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Download className="size-5 text-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-tight">
            Install the wallet
          </p>
          <p className="truncate text-xs text-muted-foreground">
            Add it to your home screen for quick access.
          </p>
        </div>
        <Button size="sm" onClick={install}>
          Install
        </Button>
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
