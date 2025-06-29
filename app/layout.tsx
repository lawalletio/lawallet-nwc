import type React from 'react'
import type { Metadata } from 'next'
import { Alex_Brush } from 'next/font/google'
import { GeistSans } from 'geist/font/sans'
import './globals.css'
import { cn } from '@/lib/utils'

const alexBrush = Alex_Brush({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-alex-brush',
  display: 'swap'
})

export const metadata: Metadata = {
  title: 'BoltCard + NWC',
  description: 'A self-custodial Lightning payment card that anyone can issue.',
  generator: 'v0.dev'
}

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={cn('light', alexBrush.variable)}>
      <body className={cn('font-sans antialiased', GeistSans.variable)}>
        {children}
      </body>
    </html>
  )
}
