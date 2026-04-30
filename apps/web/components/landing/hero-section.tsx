'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Image from 'next/image'
import { Zap, Hash, Radio, CreditCard, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface HeroSectionProps {
  onClaim: () => void
  onSetup: () => void
  setupNeeded: boolean
  domain: string
  loading: boolean
}

const badges = [
  { icon: Zap, label: 'Lightning' },
  { icon: Hash, label: 'Nostr' },
  { icon: Radio, label: 'NWC' },
  { icon: CreditCard, label: 'BoltCard' },
]

const usernames = ['user', 'agent', 'bot', 'member', 'volunteer', 'friend', 'father', 'brother']
const SCRAMBLE_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789!@#$%&*'

const techItems = [
  'Lightning Network',
  'LNURL',
  'Nostr',
  'NWC',
  'BoltCard',
  'NTAG424',
  'NIP-05',
  'NIP-57',
  'NIP-98',
  'NIP-47',
  'WebLN',
  'LND',
  'PostgreSQL',
  'Next.js',
]

function useScrambleText(words: string[], interval = 3000) {
  const [display, setDisplay] = useState(words[0])
  const indexRef = useRef(0)

  useEffect(() => {
    const timer = setInterval(() => {
      indexRef.current = (indexRef.current + 1) % words.length
      const target = words[indexRef.current]
      const maxLen = Math.max(display.length, target.length)
      let iteration = 0
      const totalSteps = maxLen + 6

      const scramble = setInterval(() => {
        const result = target.split('').map((char, i) => {
          if (i < iteration - 3) return char
          return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)]
        })

        // Trim or pad to animate length transition
        const currentLen = Math.round(
          display.length + (target.length - display.length) * (iteration / totalSteps)
        )
        setDisplay(result.slice(0, Math.max(currentLen, 1)).join(''))

        iteration++
        if (iteration > totalSteps) {
          setDisplay(target)
          clearInterval(scramble)
        }
      }, 35)
    }, interval)

    return () => clearInterval(timer)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return display
}

export function HeroSection({ onClaim, onSetup, setupNeeded, domain, loading }: HeroSectionProps) {
  const scrambledUser = useScrambleText(usernames, 3000)
  const displayDomain = domain || 'domain.com'

  return (
    <section className="relative flex min-h-[90vh] items-center justify-center px-4 pt-16 overflow-hidden">
      {/* Double gradient background */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 80% 60% at 50% 0%, var(--theme-200) 0%, transparent 60%),
            radial-gradient(ellipse 60% 50% at 80% 100%, var(--theme-400) 0%, transparent 50%)
          `,
          opacity: 0.08,
        }}
      />

      {/* Grid pattern overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: `linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
          color: 'var(--theme-400)',
        }}
      />

      {/* Background @ symbol */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden select-none">
        <span
          className="text-[30rem] md:text-[50rem] font-black leading-none opacity-[0.02]"
          style={{
            background: `linear-gradient(180deg, var(--theme-400) 0%, transparent 80%)`,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          @
        </span>
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center gap-8 max-w-3xl mx-auto text-center">
        {/* Badge pills */}
        <div className="flex items-center gap-3 justify-center flex-wrap">
          {badges.map((b) => (
            <span
              key={b.label}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/10 text-sm text-muted-foreground"
            >
              <b.icon className="size-3.5" />
              {b.label}
            </span>
          ))}
        </div>

        {/* Headline */}
        <h1 className="text-6xl md:text-8xl lg:text-[96px] font-black tracking-[-0.025em] leading-none">
          <span
            style={{
              background: 'linear-gradient(180deg, #ffffff 0%, #a3a3a3 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Lightning Addresses
          </span>
          <br />
          <span
            style={{
              background: `linear-gradient(135deg, var(--theme-400), var(--theme-200), var(--theme-400))`,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            for Everyone.
          </span>
        </h1>

        {/* Subtitle */}
        <p className="text-lg md:text-xl text-muted-foreground max-w-xl leading-relaxed">
          Get your own{' '}
          <span className="font-mono font-semibold" style={{ color: 'var(--theme-400)' }}>
            your-name@{displayDomain}
          </span>.
          <br />
          Setup a{' '}
          <span style={{ color: 'var(--theme-400)' }}>lightning web wallet</span>{' '}
          and spend with{' '}
          <span style={{ color: 'var(--theme-400)' }}>nfc cards</span>.
        </p>

        {/* Address display */}
        <div className="relative rounded-2xl border border-white/[0.08] bg-[rgba(10,10,15,0.6)] px-8 py-4 backdrop-blur-sm">
          <div
            className="pointer-events-none absolute inset-0 rounded-2xl"
            style={{
              background: `linear-gradient(135deg, rgba(var(--theme-400), 0.05), transparent 60%)`,
            }}
          />
          <span className="relative z-10 font-mono text-xl md:text-2xl tracking-wide text-muted-foreground">
            <span style={{ color: 'var(--theme-400)' }}>&#9889;</span>
            {' '}<span className="text-foreground">{scrambledUser}</span>@{displayDomain}{' '}
            <span style={{ color: 'var(--theme-400)' }}>&#9889;</span>
          </span>
        </div>

        {/* CTA */}
        <Button
          variant="theme"
          className="px-8 h-12 text-base"
          onClick={setupNeeded ? onSetup : onClaim}
          disabled={loading}
        >
          {setupNeeded ? 'Setup now' : 'Get Started'}
          <ArrowRight className="size-4 ml-1" />
        </Button>
      </div>

      {/* Tech marquee */}
      <div className="absolute bottom-0 left-0 right-0 w-full overflow-hidden border-y border-white/[0.06] py-3">
        <div className="flex marquee-scroll whitespace-nowrap gap-8 text-xs font-mono text-muted-foreground/50">
          {[...techItems, ...techItems].map((item, i) => (
            <span key={i} className="flex items-center gap-2">
              <Zap className="size-3" style={{ color: 'var(--theme-400)' }} />
              {item}
            </span>
          ))}
        </div>
      </div>

      <style jsx>{`
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .marquee-scroll {
          animation: marquee 30s linear infinite;
        }
      `}</style>
    </section>
  )
}
