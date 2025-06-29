import type React from 'react'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'
import { WalletProvider } from '@/providers/wallet'
import { SettingsProvider } from '@/providers/settings'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'BoltCard + NWC Landing',
  description: 'BoltCard and Nostr Wallet Connect integration platform',
  generator: 'v0.dev'
}

export default function RootLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <SettingsProvider>
            <WalletProvider>{children}</WalletProvider>
          </SettingsProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
