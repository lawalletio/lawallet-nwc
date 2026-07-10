'use client'

import { Toaster } from '@/components/ui/sonner'

export default function ComponentPreviewLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {children}
      <Toaster />
    </div>
  )
}
