'use client'

import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface CtaSectionProps {
  onClaim: () => void
}

export function CtaSection({ onClaim }: CtaSectionProps) {
  return (
    <section className="relative max-w-3xl mx-auto text-center px-4 py-28">
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full blur-3xl opacity-[0.06]"
          style={{ background: 'radial-gradient(circle, var(--theme-400), transparent 70%)' }}
        />
      </div>

      <div className="relative z-10 space-y-6">
        <h2 className="text-4xl md:text-5xl font-black tracking-tight">
          Ready to get started?
        </h2>
        <p className="text-lg text-muted-foreground max-w-md mx-auto">
          Deploy your own Lightning Address server in minutes.
        </p>
        <Button
          variant="theme"
          className="px-8 h-12 text-base"
          onClick={onClaim}
        >
          Claim your address
          <ArrowRight className="size-4 ml-1" />
        </Button>
      </div>
    </section>
  )
}
