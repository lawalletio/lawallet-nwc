'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, CheckCircle2, Clock, ShieldX, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/components/admin/auth-context'
import { Card3D } from '@/components/activate/card-3d'
import { InlineAuth } from '@/components/activate/inline-auth'
import { ActivationSuccess } from '@/components/activate/activation-success'

interface ActivationPreview {
  tokenId: string
  qrKind: 'ONE_TIME' | 'FOREVER'
  status: 'PENDING' | 'CLAIMED' | 'REVOKED' | 'EXPIRED'
  card: {
    id: string
    title?: string
    kind: string
    design: { id: string; imageUrl: string; description: string }
  }
}

type ClaimState = 'idle' | 'claiming' | 'success' | 'error'

export function ActivateClient({ tokenId }: { tokenId: string }) {
  const router = useRouter()
  const { status, apiClient } = useAuth()

  const [preview, setPreview] = useState<ActivationPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const [claimState, setClaimState] = useState<ClaimState>('idle')
  const [claimError, setClaimError] = useState<string | null>(null)
  const [claimedCard, setClaimedCard] = useState<ActivationPreview['card'] | null>(null)
  const [autoActivate, setAutoActivate] = useState(false)

  // Public preview — no auth required. Surfaces claimed/expired via `status`.
  const loadPreview = useCallback(async () => {
    setPreviewError(null)
    try {
      const res = await fetch(`/api/activation-tokens/${tokenId}`)
      if (!res.ok) {
        throw new Error(
          res.status === 404
            ? 'This activation link is invalid.'
            : 'Could not load this card.'
        )
      }
      setPreview(await res.json())
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : 'Could not load this card.')
    }
  }, [tokenId])

  useEffect(() => {
    loadPreview()
  }, [loadPreview])

  const claim = useCallback(async () => {
    setClaimState('claiming')
    setClaimError(null)
    try {
      const res = (await apiClient.post(`/api/activation-tokens/${tokenId}/claim`, {
        remoteWalletId: null
      })) as { card?: ActivationPreview['card'] }
      setClaimedCard(res?.card ?? null)
      setClaimState('success')
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : 'Activation failed.')
      setClaimState('error')
    }
  }, [apiClient, tokenId])

  const phase = useMemo(() => {
    if (previewError) return 'error' as const
    if (!preview) return 'loading' as const
    if (preview.status !== 'PENDING') return 'unavailable' as const
    if (preview.qrKind !== 'ONE_TIME') return 'unsupported' as const
    return 'ready' as const
  }, [preview, previewError])

  // After an inline login completes, auto-fire the claim so the user flows
  // straight from "register" into the activation animation.
  useEffect(() => {
    if (autoActivate && status === 'authenticated' && phase === 'ready' && claimState === 'idle') {
      setAutoActivate(false)
      claim()
    }
  }, [autoActivate, status, phase, claimState, claim])

  const design = (claimedCard ?? preview?.card)?.design
  const title = (claimedCard ?? preview?.card)?.title

  return (
    <Shell>
      {phase === 'loading' && <LoadingView />}
      {phase === 'error' && (
        <StatusView
          icon={<AlertCircle className="size-7 text-destructive" />}
          heading="Something went wrong"
          body={previewError ?? ''}
          action={<Button variant="secondary" onClick={loadPreview}>Try again</Button>}
        />
      )}
      {phase === 'unavailable' && preview && (
        <UnavailableView status={preview.status} onWallet={() => router.push('/wallet')} />
      )}
      {phase === 'unsupported' && (
        <StatusView
          icon={<ShieldX className="size-7 text-muted-foreground" />}
          heading="Not supported yet"
          body="This card uses an activation type that isn't available yet."
        />
      )}

      {phase === 'ready' &&
        (claimState === 'success' ? (
          <ActivationSuccess imageUrl={design?.imageUrl} title={title} />
        ) : (
          <div className="flex flex-1 flex-col">
            <header className="pb-2 pt-6 text-center">
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                Activate your card
              </p>
              {title && (
                <h1 className="mt-1 text-xl font-semibold text-foreground">{title}</h1>
              )}
            </header>

            {/* Card centered in the space above the fixed action bar. */}
            <div className="flex flex-1 items-center justify-center pb-44">
              <Card3D imageUrl={design?.imageUrl} title={title} />
            </div>

            {/* Action bar pinned to the bottom of the screen — centered to the
                wallet column, safe-area aware, and capped so a tall connect
                form scrolls inside it on small screens. */}
            <div className="fixed inset-x-0 bottom-0 z-30">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background via-background to-transparent"
              />
              <div
                className="relative mx-auto max-h-[85dvh] w-full max-w-md overflow-y-auto px-5 pt-10"
                style={{
                  paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))'
                }}
              >
                {claimState === 'claiming' ? (
                  <div className="flex flex-col items-center gap-2 py-4 text-center">
                    <Spinner size={24} />
                    <p className="text-sm text-muted-foreground">Activating your card…</p>
                  </div>
                ) : status === 'loading' ? (
                  <div className="flex justify-center py-4">
                    <Spinner size={24} />
                  </div>
                ) : status === 'authenticated' ? (
                  <div className="space-y-3">
                    <Button
                      variant="theme"
                      className="h-14 w-full text-base font-semibold"
                      onClick={claim}
                    >
                      <Zap className="size-5" />
                      Activate
                    </Button>
                    {claimState === 'error' && (
                      <ClaimError message={claimError} onWallet={() => router.push('/wallet')} />
                    )}
                  </div>
                ) : (
                  <InlineAuth onAuthStart={() => setAutoActivate(true)} />
                )}
              </div>
            </div>
          </div>
        ))}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-background">
      {/* Ambient backdrop — driven by the community's configured theme color
          (--primary, set from settings by ThemeProvider) so the activate flow
          matches whatever brand the wallet uses, instead of a fixed teal. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="animate-float absolute -left-24 -top-24 size-72 rounded-full blur-3xl"
          style={{ background: 'radial-gradient(circle, hsl(var(--primary) / 0.18), transparent 70%)' }}
        />
        <div
          className="animate-float absolute -bottom-24 -right-16 size-72 rounded-full blur-3xl"
          style={{
            background: 'radial-gradient(circle, hsl(var(--primary) / 0.12), transparent 70%)',
            animationDelay: '2s'
          }}
        />
      </div>
      <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col px-5">
        {children}
      </div>
    </div>
  )
}

function LoadingView() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6">
      <div className="h-[189px] w-[300px] animate-pulse rounded-2xl border border-border bg-card" />
      <Spinner size={24} />
    </div>
  )
}

function StatusView({
  icon,
  heading,
  body,
  action
}: {
  icon: React.ReactNode
  heading: string
  body: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <div className="grid size-14 place-items-center rounded-full bg-card">{icon}</div>
      <h1 className="text-xl font-semibold text-foreground">{heading}</h1>
      <p className="max-w-xs text-sm text-muted-foreground">{body}</p>
      {action && <div className="pt-2">{action}</div>}
    </div>
  )
}

function UnavailableView({
  status,
  onWallet
}: {
  status: ActivationPreview['status']
  onWallet: () => void
}) {
  const map = {
    CLAIMED: {
      icon: <CheckCircle2 className="size-7 text-primary" />,
      heading: 'Already activated',
      body: 'This card has already been linked to a wallet.'
    },
    EXPIRED: {
      icon: <Clock className="size-7 text-lw-gold" />,
      heading: 'Activation expired',
      body: 'This activation link is no longer valid. Ask the issuer for a fresh QR.'
    },
    REVOKED: {
      icon: <ShieldX className="size-7 text-destructive" />,
      heading: 'Link revoked',
      body: 'This activation link has been revoked. Ask the issuer for a fresh QR.'
    },
    PENDING: { icon: null, heading: '', body: '' }
  }[status]

  return (
    <StatusView
      icon={map.icon}
      heading={map.heading}
      body={map.body}
      action={
        status === 'CLAIMED' ? (
          <Button variant="secondary" onClick={onWallet}>
            Open wallet
          </Button>
        ) : undefined
      }
    />
  )
}

function ClaimError({
  message,
  onWallet
}: {
  message: string | null
  onWallet: () => void
}) {
  const alreadyClaimed = !!message && /claim/i.test(message)
  return (
    <div className="space-y-2 text-center">
      <p className="text-sm text-destructive">{message ?? 'Activation failed.'}</p>
      {alreadyClaimed && (
        <Button variant="secondary" className="w-full" onClick={onWallet}>
          Open wallet
        </Button>
      )}
    </div>
  )
}
