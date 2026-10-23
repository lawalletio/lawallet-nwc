'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  LifeBuoy,
  ShieldX,
  Zap
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/components/admin/auth-context'
import { Card3D } from '@/components/activate/card-3d'
import { InlineAuth } from '@/components/activate/inline-auth'
import { ActivationSuccess } from '@/components/activate/activation-success'
import {
  RecoverMergeDialog,
  type RecoverySide
} from '@/components/activate/recover-merge-dialog'
import {
  RecoveredDialog,
  type RecoveredAccount
} from '@/components/activate/recovered-dialog'
import { rememberGrantedActivationBonus } from '@/lib/client/activation-bonus-notice'
import {
  clearPendingActivation,
  rememberPendingActivation
} from '@/lib/client/pending-activation'
import { ApiClientError } from '@/lib/client/api-client'
import { invalidateApiPath } from '@/lib/client/hooks/use-api'
import { useT } from '@/lib/client/i18n'

/** `ConflictError.details.reason` from the claim when a merge needs consent. */
const RECOVERY_MERGE_REQUIRED = 'RECOVERY_MERGE_REQUIRED'

/** Wallet reads a recovery changes wholesale — refetch them on the way in. */
const RECOVERY_INVALIDATES = [
  '/api/users/me',
  '/api/wallet/addresses',
  '/api/wallet/cards',
  '/api/remote-wallets'
]

interface RecoveryCheck {
  sameAccount: boolean
  mergeRequired: boolean
  existing: RecoverySide
  incoming: RecoverySide
}

interface ActivationPreview {
  tokenId: string
  qrKind: 'ONE_TIME' | 'FOREVER'
  /** RECOVER: a card-manager recovery QR that moves the card's whole account. */
  purpose?: 'ACTIVATE' | 'RECOVER'
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
  const t = useT().activate

  const [preview, setPreview] = useState<ActivationPreview | null>(null)
  const [previewError, setPreviewError] = useState<
    'invalidLink' | 'loadFailed' | null
  >(null)

  const [claimState, setClaimState] = useState<ClaimState>('idle')
  const [claimError, setClaimError] = useState<string | null>(null)
  const [claimedCard, setClaimedCard] = useState<
    ActivationPreview['card'] | null
  >(null)
  const [autoActivate, setAutoActivate] = useState(false)
  const [nextPath, setNextPath] = useState('/wallet')
  const [claimAddress, setClaimAddress] = useState(false)
  const [bonusSats, setBonusSats] = useState<number | null>(null)
  const [mergeCheck, setMergeCheck] = useState<RecoveryCheck | null>(null)
  const [recovery, setRecovery] = useState<RecoveredAccount | null>(null)
  const isRecover = preview?.purpose === 'RECOVER'

  // Public preview — no auth required. Surfaces claimed/expired via `status`.
  const loadPreview = useCallback(async () => {
    setPreviewError(null)
    try {
      const res = await fetch(`/api/activation-tokens/${tokenId}`)
      if (!res.ok) {
        setPreviewError(res.status === 404 ? 'invalidLink' : 'loadFailed')
        return
      }
      setPreview(await res.json())
    } catch {
      setPreviewError('loadFailed')
    }
  }, [tokenId])

  useEffect(() => {
    loadPreview()
  }, [loadPreview])

  const claim = useCallback(async () => {
    setClaimState('claiming')
    setClaimError(null)
    try {
      const res = (await apiClient.post(
        `/api/activation-tokens/${tokenId}/claim`,
        {
          remoteWalletId: null
        }
      )) as {
        card?: ActivationPreview['card']
        needsLightningAddress?: boolean
        bonuses?: {
          freeLightningAddress?: boolean
          sats?: { granted?: boolean; amountSats?: number }
        }
      }
      clearPendingActivation()
      setClaimedCard(res?.card ?? null)
      setBonusSats(rememberGrantedActivationBonus(res?.bonuses))
      if (res?.needsLightningAddress) {
        const bonus = res.bonuses?.freeLightningAddress ? '&bonus=1' : ''
        setNextPath(`/wallet/claim-username?from=activate${bonus}`)
        setClaimAddress(true)
      } else {
        setNextPath('/wallet')
        setClaimAddress(false)
      }
      setClaimState('success')
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : null)
      setClaimState('error')
    }
  }, [apiClient, tokenId])

  // RECOVER: pre-flight first so an account that already has data is asked
  // before anything merges; the card's own owner just lands in the wallet.
  const recover = useCallback(
    async (confirmMerge = false) => {
      setClaimState('claiming')
      setClaimError(null)
      try {
        if (!confirmMerge) {
          const check = await apiClient.get<RecoveryCheck>(
            `/api/activation-tokens/${tokenId}/recovery-check`
          )
          if (check.mergeRequired) {
            setMergeCheck(check)
            setClaimState('idle')
            return
          }
        }
        const res = (await apiClient.post(
          `/api/activation-tokens/${tokenId}/claim`,
          { remoteWalletId: null, confirmMerge }
        )) as {
          outcome?: 'recovered' | 'same-account'
          recovery?: RecoveredAccount
          needsLightningAddress?: boolean
        }
        clearPendingActivation()
        for (const path of RECOVERY_INVALIDATES) invalidateApiPath(path)
        if (res.outcome === 'same-account' || !res.recovery) {
          router.replace('/wallet')
          return
        }
        setMergeCheck(null)
        setRecovery(res.recovery)
        setClaimAddress(!!res.needsLightningAddress)
        setNextPath(
          res.needsLightningAddress
            ? '/wallet/claim-username?from=activate'
            : '/wallet'
        )
        setClaimState('success')
      } catch (err) {
        // A merge became necessary between the pre-flight and the claim.
        if (
          err instanceof ApiClientError &&
          (err.details as { reason?: string } | undefined)?.reason ===
            RECOVERY_MERGE_REQUIRED
        ) {
          const check = await apiClient
            .get<RecoveryCheck>(
              `/api/activation-tokens/${tokenId}/recovery-check`
            )
            .catch(() => null)
          if (check) {
            setMergeCheck(check)
            setClaimState('idle')
            return
          }
        }
        setClaimError(err instanceof Error ? err.message : null)
        setClaimState('error')
      }
    },
    [apiClient, tokenId, router]
  )

  const phase = useMemo(() => {
    if (previewError) return 'error' as const
    if (!preview) return 'loading' as const
    if (preview.status !== 'PENDING') return 'unavailable' as const
    if (preview.qrKind !== 'ONE_TIME') return 'unsupported' as const
    return 'ready' as const
  }, [preview, previewError])

  // Remember a claimable card so leaving to log in / sign up comes back here;
  // forget it once it can no longer be claimed.
  useEffect(() => {
    if (phase === 'ready' && claimState !== 'success') {
      rememberPendingActivation(tokenId)
    } else if (phase === 'unavailable' || phase === 'unsupported') {
      clearPendingActivation()
    }
  }, [phase, claimState, tokenId])

  // After an inline login completes, auto-fire the claim so the user flows
  // straight from "register" into the activation animation.
  useEffect(() => {
    if (
      autoActivate &&
      status === 'authenticated' &&
      phase === 'ready' &&
      claimState === 'idle'
    ) {
      setAutoActivate(false)
      if (isRecover) void recover()
      else claim()
    }
  }, [autoActivate, status, phase, claimState, claim, recover, isRecover])

  const design = (claimedCard ?? preview?.card)?.design
  const title = (claimedCard ?? preview?.card)?.title
  const copy = isRecover
    ? {
        eyebrow: t.recover.eyebrow,
        action: t.recover.action,
        working: t.recover.recovering
      }
    : { eyebrow: t.eyebrow, action: t.activate, working: t.activating }

  return (
    <Shell>
      {phase === 'loading' && <LoadingView />}
      {phase === 'error' && (
        <StatusView
          icon={<AlertCircle className="size-7 text-destructive" />}
          heading={t.error.title}
          body={previewError ? t.error[previewError] : ''}
          action={
            <Button variant="secondary" onClick={loadPreview}>
              {t.error.tryAgain}
            </Button>
          }
        />
      )}
      {phase === 'unavailable' && preview && (
        <UnavailableView
          status={preview.status}
          onWallet={() => router.push('/wallet')}
        />
      )}
      {phase === 'unsupported' && (
        <StatusView
          icon={<ShieldX className="size-7 text-muted-foreground" />}
          heading={t.unsupported.title}
          body={t.unsupported.body}
        />
      )}

      {phase === 'ready' &&
        (claimState === 'success' && recovery ? (
          <div className="flex flex-1 items-center justify-center">
            <Card3D imageUrl={design?.imageUrl} title={title} />
            <RecoveredDialog
              open
              recovery={recovery}
              claimAddress={claimAddress}
              onContinue={() => router.replace(nextPath)}
            />
          </div>
        ) : claimState === 'success' ? (
          <ActivationSuccess
            imageUrl={design?.imageUrl}
            title={title}
            nextPath={nextPath}
            claimAddress={claimAddress}
            bonusSats={bonusSats}
          />
        ) : (
          <div className="flex flex-1 flex-col">
            <header className="pb-2 pt-6 text-center">
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                {copy.eyebrow}
              </p>
              {title && (
                <h1 className="mt-1 text-xl font-semibold text-foreground">
                  {title}
                </h1>
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
                className="pointer-events-none absolute inset-0 bg-linear-to-t from-background via-background to-transparent"
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
                    <p className="text-sm text-muted-foreground">
                      {copy.working}
                    </p>
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
                      onClick={() => (isRecover ? void recover() : claim())}
                    >
                      {isRecover ? (
                        <LifeBuoy className="size-5" />
                      ) : (
                        <Zap className="size-5" />
                      )}
                      {copy.action}
                    </Button>
                    {claimState === 'error' && (
                      <ClaimError
                        message={claimError}
                        fallback={isRecover ? t.recover.failed : t.failed}
                        onWallet={() => router.push('/wallet')}
                      />
                    )}
                  </div>
                ) : (
                  <InlineAuth
                    intent={isRecover ? 'recover' : 'activate'}
                    onAuthStart={() => setAutoActivate(true)}
                  />
                )}
              </div>
            </div>
            {mergeCheck && (
              <RecoverMergeDialog
                open
                existing={mergeCheck.existing}
                incoming={mergeCheck.incoming}
                onConfirm={() => {
                  setMergeCheck(null)
                  void recover(true)
                }}
                onCancel={() => setMergeCheck(null)}
              />
            )}
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
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div
          className="animate-float absolute -left-24 -top-24 size-72 rounded-full blur-3xl"
          style={{
            background:
              'radial-gradient(circle, hsl(var(--primary) / 0.18), transparent 70%)'
          }}
        />
        <div
          className="animate-float absolute -bottom-24 -right-16 size-72 rounded-full blur-3xl"
          style={{
            background:
              'radial-gradient(circle, hsl(var(--primary) / 0.12), transparent 70%)',
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
      <div className="grid size-14 place-items-center rounded-full bg-card">
        {icon}
      </div>
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
  const t = useT().activate
  const map = {
    CLAIMED: {
      icon: <CheckCircle2 className="size-7 text-primary" />,
      heading: t.claimed.title,
      body: t.claimed.body
    },
    EXPIRED: {
      icon: <Clock className="size-7 text-lw-gold" />,
      heading: t.expired.title,
      body: t.expired.body
    },
    REVOKED: {
      icon: <ShieldX className="size-7 text-destructive" />,
      heading: t.revoked.title,
      body: t.revoked.body
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
            {t.openWallet}
          </Button>
        ) : undefined
      }
    />
  )
}

function ClaimError({
  message,
  fallback,
  onWallet
}: {
  message: string | null
  /** Shown when the rejection carried no message. */
  fallback: string
  onWallet: () => void
}) {
  const t = useT().activate
  const alreadyClaimed = !!message && /claim/i.test(message)
  return (
    <div className="space-y-2 text-center">
      <p className="text-sm text-destructive">{message ?? fallback}</p>
      {alreadyClaimed && (
        <Button variant="secondary" className="w-full" onClick={onWallet}>
          {t.openWallet}
        </Button>
      )}
    </div>
  )
}
