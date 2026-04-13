'use client'

import Image from 'next/image'

export function Footer() {
  return (
    <footer className="max-w-5xl mx-auto px-4 py-8 border-t border-white/[0.06]">
      <div className="flex items-center justify-between">
        <Image
          src="/logos/lawallet.svg"
          alt="LaWallet"
          width={100}
          height={24}
          className="h-5 w-auto opacity-50"
        />
        <span className="text-xs text-muted-foreground">Powered by LaWallet</span>
      </div>
    </footer>
  )
}
