'use client'

import { ArrowUpRight, Zap } from 'lucide-react'

/**
 * Slim closing band that points operators to lawallet.io to spin up their own
 * Lightning domain / community instance. Theme-driven, opens in a new tab.
 */
export function DomainCta() {
  return (
    <section className="mx-auto max-w-3xl px-4 pb-24 pt-4 text-center">
      <a
        href="https://lawallet.io"
        target="_blank"
        rel="noopener noreferrer"
        className="group inline-flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full border border-white/10 bg-white/[0.03] px-5 py-2.5 text-sm text-muted-foreground backdrop-blur-sm transition-colors hover:border-white/20 hover:text-foreground"
      >
        <Zap className="size-4 shrink-0" style={{ color: 'var(--theme-400)' }} />
        <span>Create your own Lightning domain with</span>
        <span className="font-semibold" style={{ color: 'var(--theme-400)' }}>
          lawallet.io
        </span>
        <ArrowUpRight className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </a>
    </section>
  )
}
