'use client'

import React from 'react'
import { Button } from '@/components/ui/button'
import { GithubIcon, Radio, Nfc, Zap, Hash, Key, MessageSquare, Mail, Shield, ExternalLink } from 'lucide-react'
import { useScrollAnimation } from './hooks'

const protocols = [
  { icon: Radio, name: 'NWC', label: 'NIP-47' },
  { icon: Nfc, name: 'BoltCard', label: 'NTAG424' },
  { icon: Zap, name: 'LUD-16', label: 'Lightning Address' },
  { icon: Zap, name: 'LUD-21', label: 'Verification' },
  { icon: Hash, name: 'NIP-05', label: 'Nostr Identity' },
  { icon: Key, name: 'NIP-46', label: 'Remote Signing' },
  { icon: MessageSquare, name: 'NIP-04', label: 'Encrypted DMs' },
  { icon: Mail, name: 'NIP-57', label: 'Zaps' },
  { icon: Shield, name: 'LUD-22', label: 'Webhooks' }
]

const techStack = [
  { name: 'TypeScript', logo: '/logos/typescript.svg' },
  { name: 'Next.js', logo: '/logos/nextjs.svg' },
  { name: 'React', logo: '/logos/react.svg' },
  { name: 'Tailwind CSS', logo: '/logos/tailwindcss.svg' },
  { name: 'Prisma', logo: '/logos/prisma.svg' },
  { name: 'PostgreSQL', logo: '/logos/postgresql.svg' },
]

export const OpenSourceSection = () => {
  const [activeTab, setActiveTab] = React.useState<'protocols' | 'stack'>('protocols')
  const { ref, isVisible } = useScrollAnimation()

  return (
    <section className="py-20 sm:py-28">
      <div ref={ref} className="max-w-5xl mx-auto px-4 text-center">
        <span
          className={`inline-block text-xs font-mono tracking-widest uppercase text-lw-teal mb-4 transition-all duration-700 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}
        >
          {'// Open Standards'}
        </span>
        <h2
          className={`text-3xl sm:text-5xl font-bold text-white tracking-tight mb-4 transition-all duration-1000 delay-100 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          100% open source.{' '}
          <span className="text-gradient-teal">FOREVER.</span>
        </h2>
        <p
          className={`text-white/30 max-w-xl mx-auto mb-12 transition-all duration-1000 delay-200 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          No vendor lock-in. No open-core tricks. No proprietary features behind a paywall. Everything is auditable.
        </p>

        <div
          className={`flex justify-center mb-10 transition-all duration-1000 delay-300 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          <div className="inline-flex rounded-full border border-white/[0.06] bg-white/[0.02] p-1">
            <button
              onClick={() => setActiveTab('protocols')}
              className={`px-5 py-2 rounded-full text-sm font-medium transition-all duration-300 ${
                activeTab === 'protocols'
                  ? 'bg-lw-gold text-black'
                  : 'text-white/40 hover:text-white/60'
              }`}
            >
              Protocols
            </button>
            <button
              onClick={() => setActiveTab('stack')}
              className={`px-5 py-2 rounded-full text-sm font-medium transition-all duration-300 ${
                activeTab === 'stack'
                  ? 'bg-lw-gold text-black'
                  : 'text-white/40 hover:text-white/60'
              }`}
            >
              Tech Stack
            </button>
          </div>
        </div>

        <div
          className={`transition-all duration-700 delay-400 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          {activeTab === 'protocols' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
              {protocols.map((proto) => (
                <div
                  key={proto.name}
                  className="group rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 hover:bg-white/[0.04] hover:border-lw-gold/20 transition-all duration-300"
                >
                  <proto.icon className="h-6 w-6 text-lw-gold/60 group-hover:text-lw-gold mx-auto mb-3 transition-colors duration-300" />
                  <p className="text-sm font-semibold text-white/80">{proto.name}</p>
                  <p className="text-xs text-white/25 font-mono mt-1">{proto.label}</p>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'stack' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
              {techStack.map((tech) => (
                <div
                  key={tech.name}
                  className="group rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 hover:bg-white/[0.04] hover:border-lw-teal/20 transition-all duration-300"
                >
                  <div className="w-10 h-10 rounded-lg bg-white/[0.05] flex items-center justify-center mx-auto mb-3">
                    <img src={tech.logo} alt={tech.name} className="h-6 w-6 object-contain" />
                  </div>
                  <p className="text-sm font-semibold text-white/80">{tech.name}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <p
          className={`mt-14 font-accent text-3xl sm:text-4xl text-lw-gold/80 transition-all duration-1000 delay-600 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          Interoperability or death.
        </p>

        <Button
          size="lg"
          className={`mt-8 rounded-full bg-white/5 text-white/70 border border-white/10 hover:bg-white/10 hover:border-lw-gold/20 hover:text-white transition-all duration-300 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
          style={{ transitionDelay: isVisible ? '700ms' : '0ms' }}
          asChild
        >
          <a
            href="https://github.com/lawalletio/lawallet-nwc"
            target="_blank"
            rel="noopener noreferrer"
          >
            <GithubIcon className="mr-2 h-4 w-4" /> View on GitHub
            <ExternalLink className="ml-2 h-3 w-3 opacity-50" />
          </a>
        </Button>
      </div>
    </section>
  )
}
