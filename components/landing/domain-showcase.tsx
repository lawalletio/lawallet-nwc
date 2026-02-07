'use client'

import React from 'react'
import { Zap } from 'lucide-react'

const lnDomains = [
  'walletofsatoshi.com', 'getalby.com', 'lawallet.ar', 'strike.me', 'primal.net',
  'blink.sv', 'stacker.news', 'coinos.io',
  'ln.tips', 'bitrefill.me',
]

export const DomainShowcase = ({ isVisible }: { isVisible: boolean }) => {
  const [currentIndex, setCurrentIndex] = React.useState(0)
  const [isAnimating, setIsAnimating] = React.useState(false)

  React.useEffect(() => {
    const interval = setInterval(() => {
      setIsAnimating(true)
      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % lnDomains.length)
        setIsAnimating(false)
      }, 400)
    }, 1800)
    return () => clearInterval(interval)
  }, [])

  return (
    <div
      className={`mt-12 transition-all duration-1000 delay-700 ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
      }`}
    >
      <div className="inline-flex items-center gap-4 px-8 sm:px-10 py-5 sm:py-6 rounded-2xl bg-white/[0.04] border border-white/[0.08] backdrop-blur-sm shadow-lg shadow-black/10">
        <Zap className="h-5 w-5 sm:h-6 sm:w-6 text-lw-gold/50 shrink-0" />
        <span className="font-mono text-lg sm:text-xl md:text-2xl lg:text-3xl text-white/50 inline-flex items-baseline tracking-tight">
          <span className="text-lw-gold font-semibold">alice</span>
          <span className="text-white/20 mx-0.5">@</span>
          {/* Grid overlay: invisible text sizes the cell, visible text animates on top */}
          <span className="relative inline-grid overflow-hidden" style={{ height: '1.2em', lineHeight: '1.2em', verticalAlign: 'baseline' }}>
            {/* Invisible sizer — determines the width via normal flow */}
            <span className="invisible col-start-1 row-start-1 whitespace-nowrap text-lw-teal font-medium" style={{ lineHeight: '1.2em', transition: 'all 300ms ease-in-out' }}>
              {lnDomains[currentIndex]}
            </span>
            {/* Visible animated text */}
            <span
              className="col-start-1 row-start-1 whitespace-nowrap text-lw-teal font-medium"
              style={{
                lineHeight: '1.2em',
                transition: 'transform 400ms ease-in-out, opacity 400ms ease-in-out',
                transform: isAnimating ? 'translateY(-100%)' : 'translateY(0)',
                opacity: isAnimating ? 0 : 1,
              }}
            >
              {lnDomains[currentIndex]}
            </span>
          </span>
        </span>
        <Zap className="h-5 w-5 sm:h-6 sm:w-6 text-lw-gold/50 shrink-0" />
      </div>
    </div>
  )
}
