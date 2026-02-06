import type React from 'react'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'LaWallet NWC — Lightning Addresses for Everyone',
  description:
    'The open-source Lightning + Nostr CRM for communities and companies. Connect your domain, deploy in minutes, give your users lightning addresses, wallets, and identity.',
  generator: 'v0.dev'
}

export default function RootLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning={true}> 
      <body
        className={`flex flex-col min-h-[100dvh] bg-black ${inter.className} select-none`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
