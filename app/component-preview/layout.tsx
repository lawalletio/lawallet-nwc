'use client'

import { useEffect } from 'react'
import { useTheme } from 'next-themes'
import { Toaster } from '@/components/ui/sonner'

function ForceDarkTheme() {
  const { setTheme } = useTheme()
  useEffect(() => {
    setTheme('dark')
  }, [setTheme])
  return null
}

export default function ComponentPreviewLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <ForceDarkTheme />
      {children}
      <Toaster />
    </div>
  )
}
