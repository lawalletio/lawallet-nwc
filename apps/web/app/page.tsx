'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { LandingNavbar } from '@/components/landing/landing-navbar'
import { HeroSection } from '@/components/landing/hero-section'
import { FeaturesSection } from '@/components/landing/features-section'
import { ShowcaseSection } from '@/components/landing/showcase-section'
import { CtaSection } from '@/components/landing/cta-section'
import { DomainCta } from '@/components/landing/domain-cta'
import { Footer } from '@/components/landing/footer'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/components/admin/auth-context'
import { useSettings } from '@/lib/client/hooks/use-settings'
import { Role } from '@/lib/auth/permissions'

// Both dialogs are opened on demand: keep them (and the signer/passkey code
// behind the login modal) out of the landing page's first-load JS.
const ClaimDialog = dynamic(
  () => import('@/components/landing/claim-dialog').then(m => m.ClaimDialog),
  { ssr: false }
)
const LoginModal = dynamic(
  () => import('@/components/admin/login-modal').then(m => m.LoginModal),
  { ssr: false }
)

export default function HomePage() {
  const router = useRouter()
  const { status, role } = useAuth()
  const { data: settings, loading: settingsLoading } = useSettings()
  const [claimOpen, setClaimOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [redirecting, setRedirecting] = useState(false)
  // Mount each dialog on first open and keep it mounted, so its chunk only
  // loads when needed and later closes still animate out.
  const [claimMounted, setClaimMounted] = useState(false)
  const [loginMounted, setLoginMounted] = useState(false)
  const [browserHostname, setBrowserHostname] = useState('')

  useEffect(() => {
    setBrowserHostname(window.location.hostname)
  }, [])

  const domain = settings?.domain || browserHostname
  const loading = status === 'loading' || settingsLoading
  // Treat unknown as "installed" while settings load so we do not flash
  // "Setup now" before the first shared settings request resolves.
  const setupNeeded = settings?.hasRoot === false
  // Plain members belong in the wallet; only operators (and the first-time
  // setup wizard) go to the dashboard.
  const homePath = setupNeeded || role !== Role.USER ? '/admin' : '/wallet'

  // Once a login attempt initiated from this page completes, send the user
  // to their home (the SetupWizard under /admin handles first-time setup).
  useEffect(() => {
    if (loginOpen && status === 'authenticated') {
      setRedirecting(true)
      setLoginOpen(false)
      router.push(homePath)
    }
  }, [loginOpen, status, router, homePath])
  const openLogin = () => {
    setLoginMounted(true)
    setLoginOpen(true)
  }
  const openClaim = () => {
    setClaimMounted(true)
    setClaimOpen(true)
  }

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

      {claimMounted && (
        <ClaimDialog
          open={claimOpen}
          onOpenChange={setClaimOpen}
          domain={domain}
        />
      )}
      {loginMounted && (
        <LoginModal
          open={loginOpen}
          onOpenChange={setLoginOpen}
          onSuccess={() => {
            setRedirecting(true)
            setLoginOpen(false)
            router.push(homePath)
          }}
        />
      )}

      {redirecting && (
        <div className="fixed inset-0 z-60 flex flex-col items-center justify-center gap-4 bg-background/95 backdrop-blur-xs">
          <Spinner size={32} />
          <p className="text-sm text-muted-foreground">
            {homePath === '/wallet'
              ? 'Opening wallet…'
              : 'Accessing Dashboard…'}
          </p>
        </div>
      )}
    </main>
  )
}
