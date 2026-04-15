'use client'

import { useState, useEffect } from 'react'
import { LandingNavbar } from '@/components/landing/landing-navbar'
import { HeroSection } from '@/components/landing/hero-section'
import { FeaturesSection } from '@/components/landing/features-section'
import { ShowcaseSection } from '@/components/landing/showcase-section'
import { CtaSection } from '@/components/landing/cta-section'
import { Footer } from '@/components/landing/footer'
import { ClaimDialog } from '@/components/landing/claim-dialog'
import { buildPublicHost } from '@/lib/public-url-utils'

export default function HomePage() {
  const [claimOpen, setClaimOpen] = useState(false)
  const [domain, setDomain] = useState('')
  const [loading, setLoading] = useState(true)

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
  }, [])

  return (
    <main className="min-h-screen bg-background text-foreground">
      <LandingNavbar />
      <HeroSection onClaim={() => setClaimOpen(true)} domain={domain} loading={loading} />
      <FeaturesSection />
      <ShowcaseSection />
      <CtaSection onClaim={() => setClaimOpen(true)} />
      <Footer />
      <ClaimDialog open={claimOpen} onOpenChange={setClaimOpen} domain={domain} />
    </main>
  )
}
