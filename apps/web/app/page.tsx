'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { LandingNavbar } from '@/components/landing/landing-navbar'
import { HeroSection } from '@/components/landing/hero-section'
import { FeaturesSection } from '@/components/landing/features-section'
import { ShowcaseSection } from '@/components/landing/showcase-section'
import { CtaSection } from '@/components/landing/cta-section'
import { Footer } from '@/components/landing/footer'
import { ClaimDialog } from '@/components/landing/claim-dialog'
import { LoginModal } from '@/components/admin/login-modal'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/components/admin/auth-context'
import { buildPublicHost } from '@/lib/public-url-utils'

export default function HomePage() {
  const router = useRouter()
  const { status } = useAuth()
  const [claimOpen, setClaimOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [redirecting, setRedirecting] = useState(false)
  const [domain, setDomain] = useState('')
  const [loading, setLoading] = useState(true)
  const [hasRoot, setHasRoot] = useState<boolean | null>(null)

  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        setDomain(
          buildPublicHost(data.domain, data.subdomain ?? data.endpoint) ||
            window.location.hostname
        )
      })
      .catch(() => {
        setDomain(window.location.hostname)
      })
      .finally(() => setLoading(false))

    fetch('/api/setup/status')
      .then(res => res.json())
      .then(data => setHasRoot(Boolean(data?.hasRoot)))
      .catch(() => setHasRoot(true))
  }, [])

  // Once a login attempt initiated from this page completes, send the
  // user to /admin where the SetupWizard takes over for first-time setup.
  useEffect(() => {
    if (loginOpen && status === 'authenticated') {
      setRedirecting(true)
      setLoginOpen(false)
      router.push('/admin')
    }
  }, [loginOpen, status, router])

  // hasRoot starts as null while loading; treat unknown as "installed"
  // so we don't flash "Setup now" before the check completes.
  const setupNeeded = hasRoot === false
  const openLogin = () => setLoginOpen(true)
  const openClaim = () => setClaimOpen(true)

  return (
    <main className="min-h-screen bg-background text-foreground">
      <LandingNavbar setupNeeded={setupNeeded} onLoginClick={openLogin} />
      <HeroSection
        onClaim={openClaim}
        onSetup={openLogin}
        setupNeeded={setupNeeded}
        domain={domain}
        loading={loading}
      />
      <FeaturesSection />
      <ShowcaseSection />
      <CtaSection
        onClaim={openClaim}
        onSetup={openLogin}
        setupNeeded={setupNeeded}
      />
      <Footer />

      <ClaimDialog open={claimOpen} onOpenChange={setClaimOpen} domain={domain} />
      <LoginModal
        open={loginOpen}
        onOpenChange={setLoginOpen}
        onSuccess={() => {
          setRedirecting(true)
          setLoginOpen(false)
          router.push('/admin')
        }}
      />

      {redirecting && (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-background/95 backdrop-blur-sm">
          <Spinner size={32} />
          <p className="text-sm text-muted-foreground">Accessing Dashboard…</p>
        </div>
      )}
    </main>
  )
}
