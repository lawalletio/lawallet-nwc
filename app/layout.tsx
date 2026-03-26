import type React from 'react'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { Providers } from './providers'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'LaWallet NWC',
  description: 'Lightning Addresses for Everyone',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`min-h-dvh bg-background ${inter.className}`}>
        <Providers
          attribute="class"
          forcedTheme="dark"
          disableTransitionOnChange
        >
          {children}
        </Providers>
      </body>
    </html>
  )
}
