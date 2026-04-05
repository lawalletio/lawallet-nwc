'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useAuth } from '@/components/admin/auth-context'
import { useNostrProfile } from '@/lib/client/nostr-profile'
import { HeroSection } from '@/components/landing/hero-section'
import { FeaturesSection } from '@/components/landing/features-section'
import { ShowcaseSection } from '@/components/landing/showcase-section'
import { CtaSection } from '@/components/landing/cta-section'
import { Footer } from '@/components/landing/footer'
import { ClaimDialog } from '@/components/landing/claim-dialog'

export default function LandingPage() {
  const { status, pubkey } = useAuth()
  const { profile } = useNostrProfile(pubkey)
  const router = useRouter()
  const [domain, setDomain] = useState('')
  const [domainLoading, setDomainLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.domain) setDomain(data.domain)
      })
      .catch(() => {})
      .finally(() => setDomainLoading(false))
  }, [])

  function handleClaim() {
    if (status === 'authenticated') {
      router.push('/admin')
    } else {
      setDialogOpen(true)
    }
  }

  return (
    <div className="min-h-dvh bg-black relative overflow-hidden">
      {/* Double spot gradient background */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background: `
            radial-gradient(ellipse 80% 50% at 20% 0%, var(--theme-200) 0%, transparent 50%),
            radial-gradient(ellipse 60% 40% at 80% 100%, var(--theme-400) 0%, transparent 50%)
          `,
          opacity: 0.35,
        }}
      />

      {/* Polygon thin stripe pattern */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          color: 'var(--theme-400)',
          backgroundImage: `
            linear-gradient(30deg, currentColor 1px, transparent 1px),
            linear-gradient(150deg, currentColor 1px, transparent 1px),
            linear-gradient(270deg, currentColor 1px, transparent 1px)
          `,
          backgroundSize: '80px 140px',
          opacity: 0.12,
        }}
      />

      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 h-16 border-b border-white/[0.06] bg-black/60 backdrop-blur-md">
        <Image
          src="/logos/lawallet.svg"
          alt="LaWallet"
          width={120}
          height={28}
          className="h-7 w-auto"
        />
        {status === 'authenticated' ? (
          <div className="flex items-center gap-3">
            <Button
              variant="theme"
              size="sm"
              className=""
              onClick={() => router.push('/admin')}
            >
              Dashboard
              <ArrowRight className="size-3.5 ml-1" />
            </Button>
            <Avatar className="size-8 cursor-pointer" onClick={() => router.push('/admin')}>
              {profile?.picture && <AvatarImage src={profile.picture} alt={profile?.name || ''} />}
              <AvatarFallback className="text-xs bg-muted">
                {(profile?.name?.[0] || pubkey?.slice(0, 2) || '??').toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </div>
        ) : (
          <Button
            variant="theme"
            size="sm"
            className=""
            onClick={() => router.push('/admin')}
          >
            Login
          </Button>
        )}
      </nav>

      <HeroSection onClaim={handleClaim} domain={domain} loading={domainLoading} />
      <FeaturesSection />
      <ShowcaseSection />
      <CtaSection onClaim={handleClaim} />
      <Footer />
      <ClaimDialog open={dialogOpen} onOpenChange={setDialogOpen} domain={domain} />
    </div>
  )
}
