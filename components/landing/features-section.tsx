'use client'

import { Zap, Users, Radio, Nfc, Cloud, Code2 } from 'lucide-react'
import { useScrollAnimation } from './hooks'

const features = [
  {
    icon: Zap,
    title: 'Lightning Addresses',
    description:
      'Give every user a lightning address on your domain. alice@yourdomain.com — receive payments, zaps, and tips instantly.',
    color: 'lw-gold'
  },
  {
    icon: Users,
    title: 'Nostr-Native CRM',
    description:
      'Manage your community with user profiles, activity tracking, segmentation, and Nostr-powered communication built in.',
    color: 'nwc-purple'
  },
  {
    icon: Radio,
    title: 'NWC Integration',
    description:
      'Progressive self-custody. Users start with zero friction, then connect their own NWC wallet when ready. Sovereignty is a journey.',
    color: 'lw-teal'
  },
  {
    icon: Nfc,
    title: 'BoltCard / NFC',
    description:
      'Program NTAG424 cards as BoltCards. Tap any compatible POS to pay with Lightning — physical cards for your community.',
    color: 'lw-coral'
  },
  {
    icon: Cloud,
    title: 'Deploy Anywhere',
    description:
      'One-click deploy on Vercel. Docker for your server. Umbrel or Start9 for your node. Your infrastructure, your choice.',
    color: 'lw-gold'
  },
  {
    icon: Code2,
    title: 'Open Source, FOREVER',
    description:
      'MIT licensed. No open-core tricks. No proprietary features behind a paywall. Fork it, hack it, deploy it. The community owns this.',
    color: 'lw-teal'
  }
]

const colorMap: Record<string, string> = {
  'lw-gold': 'text-lw-gold',
  'nwc-purple': 'text-nwc-purple',
  'lw-teal': 'text-lw-teal',
  'lw-coral': 'text-lw-coral'
}

const bgColorMap: Record<string, string> = {
  'lw-gold': 'bg-lw-gold/10',
  'nwc-purple': 'bg-nwc-purple/10',
  'lw-teal': 'bg-lw-teal/10',
  'lw-coral': 'bg-lw-coral/10'
}

const gradientBgMap: Record<string, string> = {
  'lw-gold': 'bg-gradient-to-br from-lw-gold/15 via-lw-gold/5 to-lw-dark',
  'nwc-purple': 'bg-gradient-to-br from-nwc-purple/15 via-nwc-purple/5 to-lw-dark',
  'lw-teal': 'bg-gradient-to-br from-lw-teal/15 via-lw-teal/5 to-lw-dark',
  'lw-coral': 'bg-gradient-to-br from-lw-coral/15 via-lw-coral/5 to-lw-dark'
}

export const FeaturesSection = () => {
  const { ref, isVisible } = useScrollAnimation()

  return (
    <section id="features" className="py-20 sm:py-28">
      <div ref={ref} className="max-w-6xl mx-auto px-4">
        <div className="text-center mb-16">
          <span
            className={`inline-block text-xs font-mono tracking-widest uppercase text-lw-teal mb-4 transition-all duration-700 ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
            }`}
          >
            {'// Features'}
          </span>
          <h2
            className={`text-3xl sm:text-5xl font-bold text-white tracking-tight transition-all duration-1000 delay-100 ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
            }`}
          >
            A CRM with <span className="text-gradient-lightning">Lightning</span> and <span className="text-gradient-nostr">Nostr</span>
            <br />
            <span className="text-gradient-gold">built in, not bolted on</span>
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((feature, index) => (
            <div
              key={feature.title}
              className={`glow-card group relative overflow-hidden rounded-2xl border border-white/[0.06] transition-all duration-500 hover:-translate-y-1 ${
                isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
              }`}
              style={{
                transitionDelay: isVisible ? `${index * 100 + 200}ms` : '0ms'
              }}
            >
              {/* Full-card gradient background */}
              <div className={`absolute inset-0 ${gradientBgMap[feature.color]}`} />
              <div className="absolute inset-0 bg-gradient-to-t from-lw-dark via-lw-dark/50 to-transparent" />

              {/* Large icon visual */}
              <div className="relative flex items-center justify-center pt-12 pb-8">
                <div
                  className={`absolute w-28 h-28 rounded-full ${bgColorMap[feature.color]} blur-2xl opacity-40 group-hover:opacity-60 transition-opacity duration-500`}
                />
                <feature.icon
                  className={`relative h-16 w-16 ${colorMap[feature.color]} opacity-30 group-hover:opacity-60 group-hover:scale-110 transition-all duration-500`}
                />
              </div>

              {/* Content at bottom */}
              <div className="relative px-6 pb-6">
                <h3 className="text-lg font-semibold text-white">{feature.title}</h3>
                <p className="text-sm text-white/40 leading-relaxed overflow-hidden transition-all duration-300 mt-2 md:max-h-0 md:opacity-0 md:mt-0 md:group-hover:max-h-28 md:group-hover:opacity-100 md:group-hover:mt-2">
                  {feature.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
