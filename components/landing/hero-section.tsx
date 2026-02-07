'use client'

import React from 'react'
import { Button } from '@/components/ui/button'
import { ArrowRight, PanelTopDashed, Wallet, Zap, Hash, Radio, Nfc } from 'lucide-react'
import { useScrollAnimation } from './hooks'
import { DomainShowcase } from './domain-showcase'
import { DemoModal } from './demo-modal'

export const HeroSection = () => {
  const { ref, isVisible } = useScrollAnimation()
  const [demoModal, setDemoModal] = React.useState<{ open: boolean; type: 'admin' | 'wallet' }>({ open: false, type: 'admin' })

  return (
    <section className="relative pt-16 pb-8 sm:pt-28 sm:pb-16 overflow-hidden">
      <div ref={ref} className="max-w-5xl mx-auto px-4 text-center relative z-10">
        {/* Protocol badges */}
        <div
          className={`flex flex-wrap justify-center gap-2 mb-8 transition-all duration-700 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}
        >
          {([
            { label: 'Lightning', icon: Zap },
            { label: 'Nostr', icon: Hash },
            { label: 'NWC', icon: Radio },
            { label: 'BoltCard', icon: Nfc },
          ] as const).map(({ label, icon: Icon }) => (
            <span
              key={label}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono border border-lw-gold/20 text-lw-gold/70 bg-lw-gold/5"
            >
              <Icon className="h-3 w-3" />
              {label}
            </span>
          ))}
        </div>

        {/* Main headline */}
        <h1
          className={`text-5xl sm:text-7xl md:text-8xl font-black tracking-tight leading-[0.9] transition-all duration-1000 delay-200 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'
          }`}
        >
          <span className="text-gradient-gold">Lightning addresses</span>
          <br />
          <span className="text-white">for everyone.</span>
        </h1>

        {/* Subheadline */}
        <p
          className={`mt-8 max-w-2xl mx-auto text-lg sm:text-xl text-white/50 leading-relaxed font-light transition-all duration-1000 delay-400 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          The open-source{' '}
          <span className="text-lw-gold font-medium">Lightning + Nostr CRM</span>{' '}
          for communities and companies.
          <br className="hidden sm:block" />
          Connect your domain. Deploy in minutes. Your users get{' '}
          <span className="text-lw-teal font-medium">addresses, wallets, and identity</span> — instantly.
        </p>

        {/* Animated domain example */}
        <DomainShowcase isVisible={isVisible} />

        {/* CTA Buttons */}
        <div
          className={`mt-8 flex flex-col sm:flex-row gap-3 justify-center items-center transition-all duration-1000 delay-600 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          <Button
            size="lg"
            className="group px-8 py-5 rounded-full bg-lw-gold hover:bg-lw-gold/90 text-black font-semibold transition-all duration-300 shadow-lg shadow-lw-gold/20 hover:shadow-lw-gold/30 hover:scale-105"
            onClick={() =>
              document.getElementById('waitlist-section')?.scrollIntoView({ behavior: 'smooth' })
            }
          >
            Get Early Access
            <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
          </Button>
          <div className="flex gap-3">
              <Button
                size="lg"
                variant="outline"
                className="px-6 py-5 rounded-full bg-transparent border-white/10 text-white/70 hover:text-white hover:bg-white/5 hover:border-lw-teal/30 transition-all duration-300"
                onClick={() => setDemoModal({ open: true, type: 'admin' })}
              >
                <PanelTopDashed className="mr-2 h-4 w-4" />
                Admin Demo
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="px-6 py-5 rounded-full bg-transparent border-white/10 text-white/70 hover:text-white hover:bg-white/5 hover:border-lw-gold/30 transition-all duration-300"
                onClick={() => setDemoModal({ open: true, type: 'wallet' })}
              >
                <Wallet className="mr-2 h-4 w-4" />
                Wallet Demo
              </Button>
          </div>
        </div>

        <DemoModal
          open={demoModal.open}
          onOpenChange={(open) => setDemoModal((prev) => ({ ...prev, open }))}
          demoType={demoModal.type}
        />
      </div>
    </section>
  )
}
