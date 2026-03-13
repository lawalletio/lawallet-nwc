import type React from 'react'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Admin Dashboard - LaWallet',
  description: 'Manage your BoltCard + NWC system',
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
