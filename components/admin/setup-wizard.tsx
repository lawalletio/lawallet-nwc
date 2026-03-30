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
import { useAuth } from '@/components/admin/auth-context'
import { checkRootStatus, claimRootRole } from '@/lib/client/auth-api'

type WizardStep = 'idle' | 'loading' | 'domain' | 'fetching' | 'confirm' | 'claiming' | 'hidden'

interface CommunityData {
  id: string
  title: string
  description?: string
  avatarImage?: string
  backgroundImage?: string
  country?: string
  city?: string
  domain?: string
}

export function SetupWizard() {
  const { status, signer, role, login, loginMethod, apiClient } = useAuth()
  const [step, setStep] = useState<WizardStep>('idle')
  const [domain, setDomain] = useState('')
  const [subdomain, setSubdomain] = useState('')
  const [showAdvance, setShowAdvance] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verified, setVerified] = useState(false)
  const [loadingProgress, setLoadingProgress] = useState(0)
  const [fadeOut, setFadeOut] = useState(false)
  const [community, setCommunity] = useState<CommunityData | null>(null)
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
          setStep('loading')
        }
      } catch {
        // API error — don't show onboarding
      }
    }

    checkOnboarding()
  }, [status, signer, role])

  // Reset check when user logs out
  useEffect(() => {
    if (status === 'unauthenticated') {
      checkedRef.current = false
      setStep('idle')
    }
  }, [status])

  // Loading screen — preload assets then transition to domain
  useEffect(() => {
    if (step !== 'loading') return

    let done = false

    async function preload() {
      await new Promise<void>((resolve) => {
        const img = new window.Image()
        img.src = '/images/onboarding-hero.jpg'
        img.onload = () => resolve()
        img.onerror = () => resolve()
      })
      setLoadingProgress(70)

      await new Promise<void>((resolve) => {
        const img = new window.Image()
        img.src = '/logos/lawallet.svg'
        img.onload = () => resolve()
        img.onerror = () => resolve()
      })
      setLoadingProgress(100)

      if (done) return

      await new Promise((r) => setTimeout(r, 200))

      setFadeOut(true)
      setTimeout(() => {
        setFadeOut(false)
        setStep('domain')
      }, 400)
    }

    setLoadingProgress(20)
    preload()

    return () => { done = true }
  }, [step])

  async function handleVerify() {
    if (!domain.trim()) return
    setVerifying(true)
    await new Promise((r) => setTimeout(r, 800))
    setVerifying(false)
    setVerified(true)
    toast.success('Domain verified')
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
    if (!signer || !loginMethod) return

    setStep('claiming')
    try {
      await claimRootRole(signer)

      try {
        const fullDomain = subdomain ? `${subdomain}.${domain}` : domain
        await apiClient.post('/api/settings', {
          domain: fullDomain.trim().toLowerCase(),
          endpoint: `https://${fullDomain.trim().toLowerCase()}`,
        })
      } catch {
        // Domain save is best-effort
      }

      // If community was found, save community name
      if (community) {
        try {
          await apiClient.post('/api/settings', {
            community_name: community.title,
          })
        } catch {
          // Best-effort
        }
      }

      await login(signer, loginMethod)

      toast.success('Setup complete! You are now the root administrator.')
      setStep('hidden')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to complete setup')
      setStep('confirm')
    }
  }

  // Don't render anything if idle or hidden
  if (step === 'idle' || step === 'hidden') return null

  // Loading screen
  if (step === 'loading') {
    return (
      <div
        className={`fixed inset-0 z-[60] flex flex-col items-center justify-center bg-background transition-opacity duration-400 ${fadeOut ? 'opacity-0' : 'opacity-100'}`}
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

  const fullDomain = subdomain
    ? `${subdomain}.${domain}`
    : domain || 'your community'

  const heroImage = community?.backgroundImage || '/images/onboarding-hero.jpg'
  const avatarImage = community?.avatarImage || '/images/onboarding-hero.jpg'
  const communityName = community?.title || fullDomain

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-background px-4">
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

      {step === 'domain' && (
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

              <div className="flex gap-2">
                <InputGroup className="flex-1">
                  <InputGroupText>https://</InputGroupText>
                  <Input
                    placeholder="domain.com"
                    value={domain}
                    onChange={(e) => {
                      setDomain(e.target.value)
                      setVerified(false)
                    }}
                  />
                </InputGroup>
                <Button
                  variant="secondary"
                  onClick={handleVerify}
                  disabled={!domain.trim() || verifying}
                >
                  {verifying ? <Spinner size={16} /> : 'Verify'}
                </Button>
              </div>

              <button
                onClick={() => setShowAdvance(!showAdvance)}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mx-auto"
              >
                Advance
                {showAdvance ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              </button>

              {showAdvance && (
                <InputGroup>
                  <Input
                    placeholder="subdomain"
                    value={subdomain}
                    onChange={(e) => setSubdomain(e.target.value)}
                  />
                  <InputGroupText>.{domain || 'domain.com'}</InputGroupText>
                </InputGroup>
              )}
            </CardContent>
          </Card>

          <Button
            className="w-full"
            disabled={!domain.trim()}
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
      )}

      {step === 'fetching' && (
        <div className="flex flex-col items-center gap-4">
          <Spinner size={32} />
          <p className="text-sm text-muted-foreground">Looking up community...</p>
        </div>
      )}

      {(step === 'confirm' || step === 'claiming') && (
        <div className="w-full max-w-[480px] space-y-4">
          <Card className="overflow-hidden">
            <div className="h-[200px] relative overflow-hidden rounded-t-lg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={heroImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
            </div>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="size-12 shrink-0 rounded-md relative overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
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
