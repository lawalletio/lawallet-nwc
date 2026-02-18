'use client'

export const FundedBanner = () => {
  return (
    <div className="relative z-50 w-full py-2 bg-gradient-to-r from-transparent via-orange-950/30 to-transparent border-b border-orange-500/10">
      <a
        href="https://opensats.org/blog/fifteenth-wave-of-bitcoin-grants#lawallet"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-2.5 group"
      >
        <img
          src="/logos/opensats.svg"
          alt="OpenSats"
          className="h-4 w-auto opacity-70 group-hover:opacity-100 transition-opacity duration-300"
        />
        <span className="text-[11px] font-medium tracking-wide text-white/40 group-hover:text-white/70 transition-colors duration-300">
          Funded by{' '}
          <span className="text-orange-400/70 group-hover:text-orange-400 transition-colors duration-300 font-semibold">
            OpenSats
          </span>
        </span>
      </a>
    </div>
  )
}
