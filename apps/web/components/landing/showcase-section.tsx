'use client'

import { ConnectionMapMock } from '@/components/landing/mockups/connection-map-mock'
import { WalletHomeMock } from '@/components/landing/mockups/wallet-home-mock'

export function ShowcaseSection() {
  return (
    <section className="relative mx-auto max-w-6xl px-4 py-28">
      <div className="mb-16 text-center">
        <span
          className="mb-4 inline-block text-xs font-semibold uppercase tracking-[0.22em]"
          style={{ color: 'var(--theme-400)' }}
        >
          One platform
        </span>
        <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-5xl">
          All in one solution
        </h2>
        <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
          Wire Lightning Addresses, remote wallets and NFC cards together from
          the admin canvas — Easily Receive and Pay organically.
        </p>
      </div>

      <div className="relative flex flex-col items-center justify-center gap-10 lg:flex-row lg:items-center lg:gap-0">
        {/* Ambient theme glow behind the mockups */}
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 h-[460px] w-[680px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
          style={{
            background:
              'radial-gradient(circle, color-mix(in srgb, var(--theme-400) 18%, transparent), transparent 70%)',
          }}
        />

        {/* Desktop — connection map */}
        <div
          className="relative w-full max-w-3xl overflow-hidden rounded-2xl border border-white/[0.08] bg-[rgba(10,10,15,0.85)] shadow-2xl"
          style={{
            boxShadow:
              '0 40px 80px -40px color-mix(in srgb, var(--theme-400) 30%, transparent), 0 24px 48px -24px rgba(0,0,0,0.8)',
          }}
        >
          {/* Browser chrome */}
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
            <div className="flex gap-1.5">
              <div className="size-3 rounded-full bg-white/10" />
              <div className="size-3 rounded-full bg-white/10" />
              <div className="size-3 rounded-full bg-white/10" />
            </div>
            <div className="flex flex-1 items-center justify-center">
              <span className="rounded-md bg-white/[0.04] px-3 py-1 font-mono text-xs text-muted-foreground">
                app.lawallet.io/admin/connections
              </span>
            </div>
          </div>
          <div className="aspect-[16/10]">
            <ConnectionMapMock />
          </div>
        </div>

        {/* Mobile — wallet front, overlapping the desktop frame */}
        <div
          className="relative w-[244px] shrink-0 overflow-hidden rounded-[2.25rem] border-[5px] border-[#15151c] bg-[#0a0a0f] shadow-2xl lg:-ml-20 lg:-mt-16"
          style={{
            boxShadow:
              '0 30px 60px -24px color-mix(in srgb, var(--theme-400) 28%, transparent), 0 20px 40px -20px rgba(0,0,0,0.85)',
          }}
        >
          {/* Status notch */}
          <div className="flex justify-center bg-[#0a0a0f] pb-1 pt-2">
            <div className="h-4 w-16 rounded-full bg-[#15151c]" />
          </div>
          <div className="aspect-[9/18]">
            <WalletHomeMock />
          </div>
        </div>
      </div>
    </section>
  )
}
