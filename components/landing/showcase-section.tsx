'use client'

import { Monitor, Smartphone } from 'lucide-react'

export function ShowcaseSection() {
  return (
    <section className="max-w-5xl mx-auto px-4 py-24">
      <div className="text-center mb-16">
        <h2 className="text-3xl md:text-4xl font-bold mb-3">See it in action</h2>
        <p className="text-muted-foreground text-lg">
          A complete platform for managing Lightning Addresses and payments.
        </p>
      </div>

      <div className="relative flex flex-col lg:flex-row items-center justify-center gap-8 lg:gap-0">
        {/* Ambient glow behind mockups */}
        <div
          className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full blur-3xl opacity-[0.08]"
          style={{ background: 'radial-gradient(circle, var(--theme-400), transparent 70%)' }}
        />

        {/* Browser frame mockup */}
        <div className="relative w-full max-w-3xl rounded-2xl border border-white/[0.06] bg-[rgba(10,10,15,0.8)] overflow-hidden shadow-2xl">
          {/* Browser chrome */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
            <div className="flex gap-1.5">
              <div className="size-3 rounded-full bg-white/10" />
              <div className="size-3 rounded-full bg-white/10" />
              <div className="size-3 rounded-full bg-white/10" />
            </div>
            <div className="flex-1 rounded-md bg-white/[0.04] px-3 py-1 text-xs text-muted-foreground font-mono">
              admin.community.com
            </div>
          </div>
          {/* Dashboard placeholder */}
          <div className="aspect-[16/10] bg-black/40 flex items-center justify-center text-muted-foreground text-sm">
            <div className="text-center space-y-2">
              <Monitor className="size-12 mx-auto text-muted-foreground/30" />
              <p className="text-muted-foreground/50">Admin Dashboard</p>
            </div>
          </div>
        </div>

        {/* Phone frame mockup */}
        <div className="relative w-[260px] shrink-0 rounded-[2.5rem] border-[3px] border-white/[0.06] bg-[rgba(10,10,15,0.8)] overflow-hidden shadow-2xl lg:-ml-16 lg:-mt-12">
          {/* Notch */}
          <div className="flex justify-center pt-2 pb-1 bg-black/40">
            <div className="w-20 h-5 bg-white/[0.06] rounded-full" />
          </div>
          {/* Mobile placeholder */}
          <div className="aspect-[9/18] bg-black/40 flex items-center justify-center text-muted-foreground text-sm">
            <div className="text-center space-y-2">
              <Smartphone className="size-10 mx-auto text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground/50">Mobile Wallet</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
