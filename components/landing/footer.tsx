'use client'

export const Footer = () => (
  <footer className="py-10 border-t border-white/[0.04]">
    <div className="max-w-6xl mx-auto px-4">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <img src="/logos/lawallet.svg" alt="LaWallet" className="h-5 w-auto opacity-40" />
        </div>

        <div className="flex items-center gap-6 text-xs text-white/20 font-mono">
          <a
            href="https://github.com/lawalletio/lawallet-nwc"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-lw-gold transition-colors duration-300"
          >
            GitHub
          </a>
          <a
            href="https://nwc.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-lw-gold transition-colors duration-300"
          >
            NWC
          </a>
          <a
            href="https://lawallet.ar"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-lw-gold transition-colors duration-300"
          >
            LaWallet
          </a>
          <a
            href="https://opensats.org"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-lw-gold transition-colors duration-300"
          >
            OpenSats
          </a>
        </div>

        <p className="text-xs text-white/15 font-mono">
          &copy; {new Date().getFullYear()} LaWallet — Open source, forever.
        </p>
      </div>
    </div>
  </footer>
)
