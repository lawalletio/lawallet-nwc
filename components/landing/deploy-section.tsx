'use client'

import { Terminal, ExternalLink } from 'lucide-react'
import { useScrollAnimation } from './hooks'

const deployOptions = [
  {
    logo: '/logos/vercel.svg',
    title: 'Vercel',
    time: '8 min',
    description: 'One-click deploy. Perfect for communities that want to be live instantly.',
    deployUrl: 'https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Flawalletio%2Flawallet-nwc&project-name=lawallet-nwc&repository-name=lawallet-nwc&demo-title=lawallet%20nwc&integration-ids=oac_3sK3gnG06emjIEVL09jjntDD'
  },
  {
    logo: '/logos/docker.svg',
    title: 'Docker',
    time: '5 min',
    description: 'Compose file included. Run on any VPS or server you control.',
    command: 'docker compose up -d'
  },
  {
    logo: '/logos/umbrel.svg',
    title: 'Your Node',
    time: '3 min',
    description: 'Umbrel, Start9, or bare metal. Full sovereignty on your own hardware.',
    command: 'lawallet-nwc start'
  }
]

export const DeploySection = () => {
  const { ref, isVisible } = useScrollAnimation()

  return (
    <section id="deploy" className="py-20 sm:py-28">
      <div ref={ref} className="max-w-5xl mx-auto px-4">
        <div className="text-center mb-16">
          <span
            className={`inline-block text-xs font-mono tracking-widest uppercase text-lw-gold mb-4 transition-all duration-700 ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
            }`}
          >
            {'// Deploy'}
          </span>
          <h2
            className={`text-3xl sm:text-5xl font-bold text-white tracking-tight transition-all duration-1000 delay-100 ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
            }`}
          >
            Connect your domain.
            <br />
            <span className="text-gradient-gold">Be live in minutes.</span>
          </h2>
          <p
            className={`mt-4 text-white/30 max-w-xl mx-auto transition-all duration-1000 delay-200 ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
            }`}
          >
            Choose your deployment path. From instant cloud to full sovereignty.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {deployOptions.map((option, index) => (
            <div
              key={option.title}
              className={`glow-card group rounded-2xl bg-white/[0.02] border border-white/[0.06] p-6 hover:bg-white/[0.04] transition-all duration-500 hover:-translate-y-1 ${
                isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
              }`}
              style={{
                transitionDelay: isVisible ? `${index * 150 + 200}ms` : '0ms'
              }}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="w-10 h-10 rounded-lg bg-lw-gold/10 flex items-center justify-center">
                  <img src={option.logo} alt={`${option.title} logo`} className="h-5 w-auto opacity-80 group-hover:opacity-100 transition-opacity duration-300" />
                </div>
                <span className="text-xs font-mono text-lw-teal bg-lw-teal/10 px-2.5 py-1 rounded-full">
                  ~{option.time}
                </span>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">{option.title}</h3>
              <p className="text-sm text-white/40 leading-relaxed mb-4">{option.description}</p>
              {option.command && <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.04] font-mono text-xs text-white/30">
                <Terminal className="h-3 w-3 text-lw-teal flex-shrink-0" />
                <span className="text-lw-teal">$</span> {option.command}
              </div>}
              {option.deployUrl && (
                <a
                  href={option.deployUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 flex items-center justify-center gap-2 w-full h-10 rounded-xl font-semibold text-sm transition-all duration-300 bg-white text-black hover:bg-white/90 shadow-lg shadow-white/5 hover:shadow-white/10"
                >
                  <img src={option.logo} alt="" className="h-4 w-auto" />
                  Deploy on Vercel
                  <ExternalLink className="h-3.5 w-3.5 opacity-50" />
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
