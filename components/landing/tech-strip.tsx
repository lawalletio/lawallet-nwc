'use client'

export const TechStrip = () => {
  const items = [
    'Lightning Address', 'Nostr Identity', 'NWC', 'BoltCard', 'NIP-05', 'NIP-98',
    'NIP-46', 'Lightning Network','LUD-21', 'Vercel', 'Netlify', 'Docker', 'Umbrel', 'Start9',
    'Nostr Identity', 'BoltCard', 'NIP-05', 'LUD-16', 'LUD-21', 'NIP-57 Zaps'
  ]

  return (
    <div className="relative py-6 overflow-hidden border-y border-white/[0.04]">
      <div className="animate-marquee marquee-track flex gap-8 whitespace-nowrap">
        {items.map((item, i) => (
          <span
            key={i}
            className="text-sm font-mono text-white/15 flex items-center gap-2"
          >
            <span className="text-lw-gold/30">&#x26A1;</span>
            {item}
          </span>
        ))}
      </div>
    </div>
  )
}
