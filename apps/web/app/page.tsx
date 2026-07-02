'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { LandingNavbar } from '@/components/landing/landing-navbar'
import { HeroSection } from '@/components/landing/hero-section'
import { FeaturesSection } from '@/components/landing/features-section'
import { ShowcaseSection } from '@/components/landing/showcase-section'
import { CtaSection } from '@/components/landing/cta-section'
import { DomainCta } from '@/components/landing/domain-cta'
import { Footer } from '@/components/landing/footer'
import { ClaimDialog } from '@/components/landing/claim-dialog'
import { LoginModal } from '@/components/admin/login-modal'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/components/admin/auth-context'
import { useSettings } from '@/lib/client/hooks/use-settings'

export default function HomePage() {
  const router = useRouter()
  const { status } = useAuth()
  const { data: settings, loading: settingsLoading } = useSettings()
  const [claimOpen, setClaimOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [redirecting, setRedirecting] = useState(false)
  const [browserHostname, setBrowserHostname] = useState('')

  useEffect(() => {
    setBrowserHostname(window.location.hostname)
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

  const domain = settings?.domain || browserHostname
  const loading = status === 'loading' || settingsLoading
  // Treat unknown as "installed" while settings load so we do not flash
  // "Setup now" before the first shared settings request resolves.
  const setupNeeded = settings?.hasRoot === false
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
      <ShowcaseSection />
      <FeaturesSection />
      <CtaSection
        onClaim={openClaim}
        onSetup={openLogin}
        setupNeeded={setupNeeded}
      />
      <DomainCta />
      <Footer />

      <ClaimDialog
        open={claimOpen}
        onOpenChange={setClaimOpen}
        domain={domain}
      />
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
