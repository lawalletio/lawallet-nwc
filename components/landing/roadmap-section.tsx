'use client'

import { Shield, Code2, PanelTopDashed, Wallet, Zap, Globe, MessageSquare, Users } from 'lucide-react'
import { useScrollAnimation } from './hooks'

const roadmapItems = [
  {
    title: 'Infrastructure & Security',
    description: 'Testing, auth, RBAC, rate limiting, error handling, logging',
    status: 'completed' as const,
    icon: Shield
  },
  {
    title: 'SDK & React Hooks',
    description: 'TypeScript client SDK, React hooks, CI/CD pipeline',
    status: 'in_progress' as const,
    icon: Code2
  },
  {
    title: 'Admin Dashboard',
    description: 'User management, activity monitor, Nostr login (NIP-07/46)',
    status: 'planned' as const,
    icon: PanelTopDashed
  },
  {
    title: 'User Dashboard & NWC Proxy',
    description: 'Profile, address config, courtesy NWC wallet provisioning',
    status: 'planned' as const,
    icon: Wallet
  },
  {
    title: 'Payment Listener & Zaps',
    description: 'NWC relay monitoring, webhooks (LUD-22), NIP-57 zaps',
    status: 'planned' as const,
    icon: Zap
  },
  {
    title: 'Deploy Everywhere',
    description: 'Vercel, Docker, Umbrel, Start9 — full documentation',
    status: 'planned' as const,
    icon: Globe
  },
  {
    title: 'Nostr CRM & Communications',
    description: 'DMs, broadcasts, segmentation, Nostr-native messaging',
    status: 'planned' as const,
    icon: MessageSquare
  },
  {
    title: 'Plugins: Events, Badges, Commerce',
    description: 'Community event management, NIP-58 badges, merchant directory',
    status: 'planned' as const,
    icon: Users
  }
]

export const RoadmapSection = () => {
  const { ref, isVisible } = useScrollAnimation()

  return (
    <section id="roadmap" className="py-20 sm:py-28">
      <div ref={ref} className="max-w-4xl mx-auto px-4">
        <div className="text-center mb-16">
          <span
            className={`inline-block text-xs font-mono tracking-widest uppercase text-lw-coral mb-4 transition-all duration-700 ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
            }`}
          >
            {'// Roadmap'}
          </span>
          <h2
            className={`text-3xl sm:text-5xl font-bold text-white tracking-tight transition-all duration-1000 delay-100 ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
            }`}
          >
            What&apos;s <span className="text-gradient-gold">next</span>
          </h2>
          <p
            className={`mt-4 text-white/30 max-w-xl mx-auto transition-all duration-1000 delay-200 ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
            }`}
          >
            Funded by OpenSats. Built in public. Shipping monthly.
          </p>
        </div>

        <div className="relative">
          <div className="absolute left-6 top-0 bottom-0 w-px bg-gradient-to-b from-lw-teal/50 via-lw-gold/30 to-transparent" />

          <div className="space-y-6">
            {roadmapItems.map((item, index) => (
              <div
                key={item.title}
                className={`relative pl-16 transition-all duration-700 ${
                  isVisible ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-8'
                }`}
                style={{
                  transitionDelay: isVisible ? `${index * 100 + 300}ms` : '0ms'
                }}
              >
                <div
                  className={`absolute left-4 top-4 w-4 h-4 rounded-full border-2 ${
                    item.status === 'completed'
                      ? 'bg-lw-teal border-lw-teal shadow-lg shadow-lw-teal/30'
                      : item.status === 'in_progress'
                        ? 'bg-lw-dark border-lw-gold animate-pulse-glow'
                        : 'bg-lw-dark border-white/15'
                  }`}
                />

                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 hover:bg-white/[0.04] transition-all duration-300 group">
                  <div className="flex items-center gap-3 mb-1">
                    <item.icon className="h-4 w-4 text-white/30 group-hover:text-lw-gold transition-colors duration-300" />
                    <h3 className="text-base font-semibold text-white">{item.title}</h3>
                    <span
                      className={`ml-auto text-xs font-mono px-2.5 py-0.5 rounded-full ${
                        item.status === 'completed'
                          ? 'bg-lw-teal/10 text-lw-teal'
                          : item.status === 'in_progress'
                            ? 'bg-lw-gold/10 text-lw-gold'
                            : 'bg-white/5 text-white/25'
                      }`}
                    >
                      {item.status === 'completed'
                        ? 'shipped'
                        : item.status === 'in_progress'
                          ? 'building'
                          : 'planned'}
                    </span>
                  </div>
                  <p className="text-sm text-white/30 ml-7">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
