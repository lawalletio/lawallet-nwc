'use client'

import { useRef, useCallback } from 'react'
import { Zap, Wallet, CreditCard, Bell, Webhook, Ticket } from 'lucide-react'

const features = [
  { icon: Zap, title: 'Lightning Address' },
  { icon: Wallet, title: 'Built-in Wallet' },
  { icon: CreditCard, title: 'NFC Cards' },
  { icon: Bell, title: 'Notifications' },
  { icon: Webhook, title: 'Webhooks' },
  { icon: Ticket, title: 'Memberships' },
]

function FeatureCard({ icon: Icon, title }: { icon: typeof Zap; title: string }) {
  const cardRef = useRef<HTMLDivElement>(null)
  const glowRef = useRef<HTMLDivElement>(null)

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!cardRef.current || !glowRef.current) return
    const rect = cardRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    glowRef.current.style.opacity = '1'
    glowRef.current.style.background = `radial-gradient(400px circle at ${x}px ${y}px, var(--theme-400), transparent 50%)`
  }, [])

  const handleMouseLeave = useCallback(() => {
    if (!glowRef.current) return
    glowRef.current.style.opacity = '0'
  }, [])

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="group relative overflow-hidden rounded-2xl bg-[rgba(10,10,15,0.8)] border border-white/[0.06] p-6 flex flex-col justify-between min-h-[200px] transition-colors hover:border-white/[0.12]"
    >
      {/* Mouse-tracking glow */}
      <div
        ref={glowRef}
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300"
        style={{ mixBlendMode: 'soft-light' }}
      />

      {/* Static ambient glow */}
      <div
        className="pointer-events-none absolute -top-20 -left-20 w-[250px] h-[250px] rounded-full opacity-[0.08] blur-3xl transition-opacity group-hover:opacity-[0.15]"
        style={{ background: `radial-gradient(circle, var(--theme-400), transparent 70%)` }}
      />

      <Icon className="size-10 relative z-10" style={{ color: 'var(--theme-400)' }} />
      <h3 className="text-base font-semibold relative z-10">{title}</h3>
    </div>
  )
}

export function FeaturesSection() {
  return (
    <section className="max-w-5xl mx-auto px-4 py-24">
      <h2 className="text-3xl md:text-4xl font-bold text-center mb-16">
        What you get
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {features.map((feature) => (
          <FeatureCard key={feature.title} icon={feature.icon} title={feature.title} />
        ))}
      </div>
    </section>
  )
}
