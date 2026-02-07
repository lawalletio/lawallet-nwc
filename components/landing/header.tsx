'use client'

import React from 'react'
import { Button } from '@/components/ui/button'
import { GithubIcon } from 'lucide-react'

export const Header = () => {
  const [scrolled, setScrolled] = React.useState(false)

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
        <div className="flex items-center gap-4">
          <img src="/logos/lawallet.svg" alt="LaWallet" className="h-6 w-auto opacity-90" />
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
        </div>
      </div>
    </header>
  )
}
