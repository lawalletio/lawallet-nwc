import type React from 'react'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'
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
      <body
        className={`flex flex-col min-h-[100dvh] bg-black ${inter.className} select-none`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <SettingsProvider>{children}</SettingsProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
