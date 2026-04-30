'use client'

import React, { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupText } from '@/components/ui/input-group'
import { Card, CardContent } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useAuth } from '@/components/admin/auth-context'
import { useNostrProfile } from '@/lib/client/nostr-profile'
import { checkRootStatus, claimRootRole } from '@/lib/client/auth-api'
import { buildPublicHost } from '@/lib/public-url-utils'
import { truncateNpub } from '@/lib/client/format'
import { cn } from '@/lib/utils'

// Hostname only — no protocol, no path. Mirrors the validator used by
// the Infrastructure settings tab so onboarding rejects the same things
// the admin form rejects later (e.g. trailing slashes, schemes, IPs).
// Labels: 1–63 chars, letters/digits/hyphens, no leading/trailing hyphen.
// Total length 1–253 chars, ≥1 dot, TLD ≥2 letters.
const DOMAIN_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i

function isValidDomain(value: string): boolean {
  return DOMAIN_PATTERN.test(value.trim())
}

// Border + ring tokens applied when the input fails validation. tailwind-merge
// lets `border-destructive` win over the component's default `border-input`.
const INVALID_CLASSES =
  'border-destructive focus-visible:ring-destructive focus-within:ring-destructive'

type WizardStep =
  | 'idle'
  | 'confirm-root'
  | 'loading'
  | 'domain'
  | 'fetching'
  | 'confirm'
  | 'claiming'
  | 'hidden'

function deriveSubdomainFromUrl(url: string, domain: string): string {
  const raw = url.trim().toLowerCase()
  if (!raw) return ''
  let host: string
  try {
    host = new URL(raw.includes('://') ? raw : `https://${raw}`).host
  } catch {
    return ''
  }
  const cleanDomain = domain.trim().toLowerCase()
  if (!cleanDomain || host === cleanDomain) return ''
  if (host.endsWith(`.${cleanDomain}`)) {
    return host.slice(0, -cleanDomain.length - 1)
  }
  return ''
}

interface CommunityData {
  id: string
  title: string
  description?: string | null
  link?: string | null
  linkTwitter?: string | null
  linkEmail?: string | null
  npub?: string | null
  avatarImage?: string | null
  backgroundImage?: string | null
  country?: string | null
  city?: string | null
  domain?: string | null
}

// Strip protocol + an optional list of leading host paths so the value
// fits the `prefix + handle` shape the BrandingTab social fields expect
// (e.g. "https://twitter.com/foo" -> "foo" given prefix "twitter.com/").
function stripUrlPrefix(url: string | null | undefined, ...prefixes: string[]): string {
  if (!url) return ''
  let s = url.trim().replace(/^https?:\/\//i, '')
  for (const p of prefixes) {
    if (s.toLowerCase().startsWith(p.toLowerCase())) {
      s = s.slice(p.length)
      break
    }
  }
  return s.replace(/\/+$/, '')
}

function buildCommunitySettings(c: CommunityData): Record<string, string> {
  const out: Record<string, string> = {
    is_community: 'true',
    community_id: c.id,
    community_name: c.title,
  }
  if (c.avatarImage) {
    out.logotype_url = c.avatarImage
    out.isotypo_url = c.avatarImage
  }
  if (c.backgroundImage) out.hero_image_url = c.backgroundImage
  if (c.linkTwitter) out.social_twitter = stripUrlPrefix(c.linkTwitter, 'twitter.com/', 'x.com/')
  if (c.link) out.social_website = stripUrlPrefix(c.link)
  if (c.linkEmail) out.social_email = c.linkEmail.trim()
  if (c.npub) out.social_nostr = c.npub.trim()
  return out
}

export function SetupWizard() {
  const { status, signer, pubkey, role, login, loginMethod, logout, apiClient } = useAuth()
  const { profile, loading: profileLoading } = useNostrProfile(pubkey)
  const [step, setStep] = useState<WizardStep>('idle')
  const [domain, setDomain] = useState('')
  const [endpointUrl, setEndpointUrl] = useState('')
  const [showAdvance, setShowAdvance] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verified, setVerified] = useState(false)
  const [loadingProgress, setLoadingProgress] = useState(0)
  const [fadeOut, setFadeOut] = useState(false)
  const [community, setCommunity] = useState<CommunityData | null>(null)
  const [claimingRoot, setClaimingRoot] = useState(false)
  const checkedRef = useRef(false)

  // When auth becomes ready, check if onboarding is needed
  useEffect(() => {
    if (status !== 'authenticated' || !signer || checkedRef.current) return
    if (role === 'ADMIN') return

    checkedRef.current = true

    async function checkOnboarding() {
      try {
        const rootStatus = await checkRootStatus(signer!)
        if (!rootStatus.hasRoot && rootStatus.canAssignRoot) {
          // Show the "is this you?" confirmation first; the actual claim
          // fires after the user confirms. The rest of the wizard runs
          // as ADMIN (settings POST needs SETTINGS_WRITE).
          setStep('confirm-root')
        }
      } catch {
        // API error — don't show onboarding
      }
    }

    checkOnboarding()
  }, [status, signer, role])

  // Reset check when user logs out
  useEffect(() => {
    if (status !== 'unauthenticated') return

    checkedRef.current = false
    const timeout = setTimeout(() => setStep('idle'), 0)
    return () => clearTimeout(timeout)
  }, [status])

  async function handleConfirmRoot() {
    if (!signer) return
    setClaimingRoot(true)
    try {
      await claimRootRole(signer)
      // Refresh the JWT so the in-memory role reflects the DB change
      // (settings POST needs ADMIN). Skip if loginMethod is gone — rare,
      // but the next reload will re-exchange anyway.
      if (loginMethod) await login(signer, loginMethod)
      setStep('loading')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to claim root role')
    } finally {
      setClaimingRoot(false)
    }
  }

  function handleSwitchAccount() {
    // logout() clears the JWT/signer; the unauthenticated useEffect
    // resets the wizard to 'idle' and AdminLayoutShell shows the
    // login screen so the user can pick a different account.
    logout()
  }

  // Loading screen — preload assets then transition to domain
  useEffect(() => {
    if (step !== 'loading') return

    let done = false
    const initialProgressTimer = setTimeout(() => {
      if (!done) setLoadingProgress(20)
    }, 0)
    let fadeTimer: ReturnType<typeof setTimeout> | null = null

    async function preload() {
      await new Promise<void>((resolve) => {
        const img = new window.Image()
        img.src = '/images/onboarding-hero.jpg'
        img.onload = () => resolve()
        img.onerror = () => resolve()
      })
      if (done) return
      setLoadingProgress(70)

      await new Promise<void>((resolve) => {
        const img = new window.Image()
        img.src = '/logos/lawallet.svg'
        img.onload = () => resolve()
        img.onerror = () => resolve()
      })
      if (done) return
      setLoadingProgress(100)

      await new Promise((r) => setTimeout(r, 200))
      if (done) return

      setFadeOut(true)
      fadeTimer = setTimeout(() => {
        setFadeOut(false)
        setStep('domain')
      }, 400)
    }

    preload()

    return () => {
      done = true
      clearTimeout(initialProgressTimer)
      if (fadeTimer) clearTimeout(fadeTimer)
    }
  }, [step])

  async function handleVerify() {
    const cleanDomain = domain.trim().toLowerCase()
    if (!cleanDomain) return
    setVerifying(true)
    setVerified(false)
    try {
      const issueRes = await fetch('/api/setup/verify', { method: 'POST' })
      if (!issueRes.ok) throw new Error('Failed to issue token')
      const { token } = (await issueRes.json()) as { token: string }

      const scheme = cleanDomain.startsWith('localhost') || cleanDomain.startsWith('127.') ? 'http' : 'https'
      const probeRes = await fetch(`${scheme}://${cleanDomain}/.well-known/verify`, {
        cache: 'no-store',
      })
      if (!probeRes.ok) throw new Error(`Got HTTP ${probeRes.status} from ${cleanDomain}`)
      const probeToken = (await probeRes.text()).trim()

      if (probeToken !== token) {
        throw new Error(`${cleanDomain} does not point to this instance`)
      }

      setVerified(true)
      toast.success(`${cleanDomain} verified`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setVerifying(false)
    }
  }

  async function handleNext() {
    if (!domain.trim()) return

    const cleanDomain = domain.trim().toLowerCase()
    setStep('fetching')
    setCommunity(null)

    try {
      const res = await fetch('https://veintiuno.lat/api/communities')
      if (res.ok) {
        const communities: CommunityData[] = await res.json()
        const match = communities.find(
          (c) => c.domain === cleanDomain || c.domain === `www.${cleanDomain}`
        )
        if (match) {
          setCommunity(match)
          // Preload community images
          if (match.backgroundImage) {
            const img = new window.Image()
            img.src = match.backgroundImage
          }
          if (match.avatarImage) {
            const img = new window.Image()
            img.src = match.avatarImage
          }
          setStep('confirm')
          return
        }
      }
    } catch {
      // Network error — skip community lookup
    }

    // No community found — finish setup directly
    await finishSetup()
  }

  async function finishSetup() {
    if (!signer) return

    setStep('claiming')
    try {
      // Root role + JWT refresh already happened in handleConfirmRoot;
      // by the time we reach finishSetup the user is ADMIN. All that's
      // left is persisting the chosen domain/community and importing
      // related assets.
      const cleanDomain = domain.trim().toLowerCase()
      const cleanSubdomain = deriveSubdomainFromUrl(endpointUrl, cleanDomain)
      await apiClient.post('/api/settings', {
        domain: cleanDomain,
        endpoint: cleanSubdomain,
        ...(community ? buildCommunitySettings(community) : {}),
      })

      // Auto-import card designs when a community matched. The endpoint
      // reads is_community + community_id from settings (just saved above)
      // and pulls matching designs from veintiuno.lat. Failure here is
      // non-fatal — the admin can re-run from /admin/designs later.
      if (community) {
        try {
          await apiClient.post('/api/card-designs/import', {})
        } catch (err) {
          console.warn('Card design import failed', err)
        }
      }

      toast.success('Setup complete! You are now the root administrator.')
      setStep('hidden')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to complete setup')
      setStep('confirm')
    }
  }

  // Don't render anything if idle or hidden
  if (step === 'idle' || step === 'hidden') return null

  // First-login confirmation: show the user's Nostr identity and ask them
  // to confirm they want to become root, with a Switch button to log out
  // and try a different account.
  if (step === 'confirm-root') {
    const displayName =
      profile?.displayName ||
      profile?.name ||
      (pubkey ? truncateNpub(pubkey) : 'Unknown')
    const avatarFallback = (
      profile?.name?.[0] ||
      profile?.displayName?.[0] ||
      pubkey?.slice(0, 2) ||
      '??'
    ).toUpperCase()

    return (
      <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-background px-4 animate-in fade-in duration-500">
        <div className="absolute top-6 left-1/2 -translate-x-1/2">
          <Image
            src="/logos/lawallet.svg"
            alt="LaWallet"
            width={100}
            height={24}
            className="h-6 w-auto"
            priority
          />
        </div>

        <div className="w-full max-w-[420px] animate-in fade-in slide-in-from-bottom-4 duration-500">
          <Card className="overflow-hidden">
            <CardContent className="flex flex-col items-center gap-5 p-8 text-center">
              <div className="relative">
                <Avatar className="size-20 transition-opacity duration-500" style={{ opacity: profileLoading ? 0.5 : 1 }}>
                  {profile?.picture && (
                    <AvatarImage src={profile.picture} alt={displayName} />
                  )}
                  <AvatarFallback className="text-xl">{avatarFallback}</AvatarFallback>
                </Avatar>
                {profileLoading && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Spinner size={24} />
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  Set up as root admin
                </p>
                <p className="text-xl font-semibold">{displayName}</p>
                {profile?.nip05 && (
                  <p className="text-xs text-muted-foreground">{profile.nip05}</p>
                )}
              </div>

              <p className="text-sm text-muted-foreground leading-relaxed">
                You&apos;re about to become the root administrator of this LaWallet
                instance. Continue if this is the right account.
              </p>
            </CardContent>
          </Card>

          <div className="mt-4 flex gap-3">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={handleSwitchAccount}
              disabled={claimingRoot}
            >
              Switch
            </Button>
            <Button
              variant="theme"
              className="flex-1"
              onClick={handleConfirmRoot}
              disabled={claimingRoot}
            >
              {claimingRoot ? (
                <>
                  <Spinner size={16} className="mr-2" />
                  Claiming…
                </>
              ) : (
                'Confirm'
              )}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // Loading screen
  if (step === 'loading') {
    return (
      <div
        className={`fixed inset-0 z-[60] flex flex-col items-center justify-center bg-background transition-opacity duration-400 animate-in fade-in ${fadeOut ? 'opacity-0' : 'opacity-100'}`}
      >
        <Image
          src="/logos/lawallet.svg"
          alt="LaWallet"
          width={140}
          height={32}
          className="h-8 w-auto mb-8"
          priority
        />
        <div className="w-48 h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-100 ease-out"
            style={{
              width: `${loadingProgress}%`,
              background: 'linear-gradient(90deg, #3d8a68, #55b68c)',
            }}
          />
        </div>
      </div>
    )
  }

  // Community lookup — same full-screen treatment as the loading step so
  // the transition from the domain form is a clean fade instead of the
  // form vanishing while a small spinner pops in mid-page.
  if (step === 'fetching') {
    return (
      <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-background animate-in fade-in duration-300">
        <Image
          src="/logos/lawallet.svg"
          alt="LaWallet"
          width={140}
          height={32}
          className="h-8 w-auto mb-8"
          priority
        />
        <Spinner size={24} />
        <p className="mt-4 text-sm text-muted-foreground">Looking up community…</p>
      </div>
    )
  }

  const fullDomain =
    buildPublicHost(domain, deriveSubdomainFromUrl(endpointUrl, domain)) ||
    domain ||
    'your community'

  const heroImage = community?.backgroundImage || '/images/onboarding-hero.jpg'
  const avatarImage = community?.avatarImage || '/images/onboarding-hero.jpg'
  const communityName = community?.title || fullDomain

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-background px-4 animate-in fade-in duration-300">
      {/* Logo at top */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2">
        <Image
          src="/logos/lawallet.svg"
          alt="LaWallet"
          width={100}
          height={24}
          className="h-6 w-auto"
        />
      </div>

      {step === 'domain' && (() => {
        const domainInvalid = domain.trim() !== '' && !isValidDomain(domain)
        return (
        <div className="w-full max-w-[480px] space-y-4">
          <Card className="overflow-hidden">
            <div className="h-[200px] relative overflow-hidden rounded-t-lg">
              <Image src="/images/onboarding-hero.jpg" alt="" fill className="object-cover" />
            </div>
            <CardContent className="p-6 space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Domain</h2>
                <p className="text-sm text-muted-foreground">Configure your domain.</p>
              </div>

              <div className="space-y-1">
                <div className="flex gap-2">
                  <InputGroup className={cn('flex-1', domainInvalid && INVALID_CLASSES)}>
                    <InputGroupText>username@</InputGroupText>
                    <Input
                      placeholder="domain.com"
                      value={domain}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      inputMode="url"
                      aria-invalid={domainInvalid || undefined}
                      onChange={(e) => {
                        // Force lowercase on input so the value the user
                        // sees matches what we save (DNS is
                        // case-insensitive, but Settings stores literal
                        // strings — keep it consistent).
                        setDomain(e.target.value.toLowerCase())
                        setVerified(false)
                      }}
                    />
                  </InputGroup>
                  <Button
                    variant="secondary"
                    onClick={handleVerify}
                    disabled={!domain.trim() || domainInvalid || verifying}
                  >
                    {verifying ? <Spinner size={16} /> : 'Verify'}
                  </Button>
                </div>
                {domainInvalid && (
                  <p className="text-xs text-destructive">
                    Enter a valid domain (e.g. example.com) — no protocol or path.
                  </p>
                )}
              </div>

              <button
                onClick={() => {
                  const next = !showAdvance
                  setShowAdvance(next)
                  if (next && !endpointUrl && typeof window !== 'undefined') {
                    setEndpointUrl(window.location.origin)
                  }
                }}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mx-auto"
              >
                Advance
                {showAdvance ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              </button>

              {showAdvance && (
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Endpoint URL</label>
                  <Input
                    type="url"
                    placeholder="https://admin.domain.com"
                    value={endpointUrl}
                    onChange={(e) => setEndpointUrl(e.target.value)}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          <Button
            className="w-full"
            disabled={!domain.trim() || domainInvalid}
            onClick={handleNext}
          >
            Next
          </Button>

          {verified && (
            <p className="text-center text-sm text-green-500 flex items-center justify-center gap-1">
              <span>✓</span> Domain verified
            </p>
          )}
        </div>
        )
      })()}

      {(step === 'confirm' || step === 'claiming') && (
        <div className="w-full max-w-[480px] space-y-4">
          <Card className="overflow-hidden">
            <div className="h-[200px] relative overflow-hidden rounded-t-lg">
              <img src={heroImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
            </div>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="size-12 shrink-0 rounded-md relative overflow-hidden">
                  <img src={avatarImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Is this your community?</p>
                  <p className="text-base font-semibold">{communityName}</p>
                  {community?.city && community?.country && (
                    <p className="text-xs text-muted-foreground">{community.city}, {community.country}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-3">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => {
                setCommunity(null)
                setStep('domain')
              }}
              disabled={step === 'claiming'}
            >
              Back
            </Button>
            <Button
              variant="theme"
              className="flex-1"
              onClick={finishSetup}
              disabled={step === 'claiming'}
            >
              {step === 'claiming' ? (
                <>
                  <Spinner size={16} className="mr-2" />
                  Setting up...
                </>
              ) : (
                'Confirm'
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
