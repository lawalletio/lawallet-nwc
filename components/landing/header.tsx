'use client'

import React from 'react'
import { Button } from '@/components/ui/button'
import { GithubIcon, Zap } from 'lucide-react'
import { DemoModal } from './demo-modal'

export const Header = () => {
  const [scrolled, setScrolled] = React.useState(false)
  const [demoModal, setDemoModal] = React.useState(false)

  React.useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', handler, { passive: true })
    return () => window.removeEventListener('scroll', handler)
  }, [])

  return (
    <header
      className={`sticky top-0 z-50 py-3 px-4 backdrop-blur-xl border-b transition-all duration-500 animate-fade-in-down ${
        scrolled
          ? 'bg-lw-dark/80 border-lw-gold/10 shadow-lg shadow-lw-dark/50'
          : 'bg-transparent border-transparent'
      }`}
    >
      <div className="max-w-6xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img
            src="/logos/lawallet.svg"
            alt="LaWallet"
            className="h-6 w-auto opacity-90 cursor-pointer"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          />
          <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-widest border border-lw-coral/30 text-lw-coral bg-lw-coral/10 animate-pulse">
            pre-alpha
          </span>
        </div>
        <nav className="hidden md:flex items-center gap-6">
          <a href="#features" className="text-sm text-white/50 hover:text-lw-gold transition-colors duration-300">
            Features
          </a>
          <a href="#deploy" className="text-sm text-white/50 hover:text-lw-gold transition-colors duration-300">
            Deploy
          </a>
          <a href="#nfc-cards" className="text-sm text-white/50 hover:text-lw-gold transition-colors duration-300">
            NFC Cards
          </a>
          <a href="#roadmap" className="text-sm text-white/50 hover:text-lw-gold transition-colors duration-300">
            Roadmap
          </a>
        </nav>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="text-white/60 hover:text-white hover:bg-white/5 transition-all duration-300"
            asChild
          >
            <a
              href="https://github.com/lawalletio/lawallet-nwc"
              target="_blank"
              rel="noopener noreferrer"
            >
              <GithubIcon className="h-4 w-4 mr-1.5" />
              <span className="hidden sm:inline">GitHub</span>
            </a>
          </Button>
          <Button
            size="sm"
            className="rounded-full bg-lw-gold hover:bg-lw-gold/90 text-black font-semibold transition-all duration-300 shadow-md shadow-lw-gold/20 hover:shadow-lw-gold/30"
            onClick={() => setDemoModal(true)}
          >
            <Zap className="h-3.5 w-3.5 mr-1.5" />
            Get Early Access
          </Button>
        </div>
      </div>

      <DemoModal
        open={demoModal}
        onOpenChange={setDemoModal}
        demoType="admin"
      />
    </header>
  )
}
