'use client'

import { useState } from 'react'
import {
  Radio,
  Nfc,
  Zap,
  Hash,
  Key,
  MessageSquare,
  Mail,
  Shield,
  Github,
  ExternalLink,
} from 'lucide-react'

const protocols = [
  { icon: Radio, name: 'NWC', label: 'NIP-47' },
  { icon: Nfc, name: 'BoltCard', label: 'NTAG424' },
  { icon: Zap, name: 'LUD-16', label: 'Lightning Address' },
  { icon: Zap, name: 'LUD-21', label: 'Verification' },
  { icon: Hash, name: 'NIP-05', label: 'Nostr Identity' },
  { icon: Key, name: 'NIP-46', label: 'Remote Signing' },
  { icon: MessageSquare, name: 'NIP-04', label: 'Encrypted DMs' },
  { icon: Mail, name: 'NIP-57', label: 'Zaps' },
  { icon: Shield, name: 'LUD-22', label: 'Webhooks' },
]

const techStack = [
  { name: 'TypeScript', logo: '/logos/typescript.svg' },
  { name: 'Next.js', logo: '/logos/nextjs.svg' },
  { name: 'React', logo: '/logos/react.svg' },
  { name: 'Tailwind CSS', logo: '/logos/tailwindcss.svg' },
  { name: 'Prisma', logo: '/logos/prisma.svg' },
  { name: 'PostgreSQL', logo: '/logos/postgresql.svg' },
]

const gradientRed: React.CSSProperties = {
  background: 'linear-gradient(135deg, #f87171, #ef4444, #dc2626)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
}

const gradientTeal: React.CSSProperties = {
  background: 'linear-gradient(135deg, #26a69a, #4db6ac, #80cbc4)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
}

export function OpenStandardsSection() {
  const [activeTab, setActiveTab] = useState<'protocols' | 'stack'>('protocols')

  return (
    <section className='py-20 sm:py-28'>
      <div className='max-w-5xl mx-auto px-4 text-center'>
        <span className='inline-block text-xs font-mono tracking-widest uppercase text-[#26A69A] mb-4'>
          {'// Open Standards'}
        </span>
        <h2 className='text-3xl sm:text-5xl font-bold text-fd-foreground tracking-tight mb-4'>
          Interoperability or <span style={gradientRed}>DEATH.</span>
        </h2>
        <p className='text-fd-muted-foreground max-w-xl mx-auto mb-12'>
          Tech is selected to match the ecosystem standards. No vendor lock-in.
          No open-core tricks. No proprietary features behind a paywall.
        </p>

        <div className='flex justify-center mb-10'>
          <div className='inline-flex rounded-full border border-fd-border bg-fd-card/40 p-1'>
            <button
              onClick={() => setActiveTab('protocols')}
              className={`px-5 py-2 rounded-full text-sm font-medium transition-all duration-300 ${
                activeTab === 'protocols'
                  ? 'bg-[#F5A623] text-black'
                  : 'text-fd-muted-foreground hover:text-fd-foreground'
              }`}
            >
              Protocols
            </button>
            <button
              onClick={() => setActiveTab('stack')}
              className={`px-5 py-2 rounded-full text-sm font-medium transition-all duration-300 ${
                activeTab === 'stack'
                  ? 'bg-[#F5A623] text-black'
                  : 'text-fd-muted-foreground hover:text-fd-foreground'
              }`}
            >
              Tech Stack
            </button>
          </div>
        </div>

        {activeTab === 'protocols' && (
          <div className='grid grid-cols-2 sm:grid-cols-3 gap-4 max-w-2xl mx-auto'>
            {protocols.map(proto => (
              <div
                key={proto.name}
                className='group rounded-xl border border-fd-border bg-fd-card/40 p-5 hover:bg-fd-card/80 hover:border-[#F5A623]/30 transition-all duration-300'
              >
                <proto.icon className='h-6 w-6 text-[#F5A623]/70 group-hover:text-[#F5A623] mx-auto mb-3 transition-colors duration-300' />
                <p className='text-sm font-semibold text-fd-foreground'>
                  {proto.name}
                </p>
                <p className='text-xs text-fd-muted-foreground font-mono mt-1'>
                  {proto.label}
                </p>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'stack' && (
          <div className='grid grid-cols-2 sm:grid-cols-3 gap-4 max-w-2xl mx-auto'>
            {techStack.map(tech => (
              <div
                key={tech.name}
                className='group rounded-xl border border-fd-border bg-fd-card/40 p-5 hover:bg-fd-card/80 hover:border-[#26A69A]/30 transition-all duration-300'
              >
                <div className='w-10 h-10 rounded-lg bg-fd-card flex items-center justify-center mx-auto mb-3'>
                  <img
                    src={tech.logo}
                    alt={tech.name}
                    className='h-6 w-6 object-contain'
                  />
                </div>
                <p className='text-sm font-semibold text-fd-foreground'>
                  {tech.name}
                </p>
              </div>
            ))}
          </div>
        )}

        <p className='mt-14 text-3xl sm:text-4xl font-bold tracking-tight text-fd-foreground'>
          OPEN SOURCE, <span style={gradientTeal}>FOREVER.</span>
        </p>

        <a
          href='https://github.com/lawalletio/lawallet-nwc'
          target='_blank'
          rel='noopener noreferrer'
          className='inline-flex items-center gap-2 mt-8 px-6 py-3 rounded-full bg-fd-card/60 text-fd-foreground border border-fd-border hover:bg-fd-card hover:border-[#F5A623]/30 transition-all duration-300 text-sm font-medium'
        >
          <Github className='h-4 w-4' />
          View on GitHub
          <ExternalLink className='h-3 w-3 opacity-50' />
        </a>
      </div>
    </section>
  )
}
