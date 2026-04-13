'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'
import type { ThemeProviderProps } from 'next-themes'
import { AuthProvider } from '@/components/admin/auth-context'
import { NostrProfileProvider } from '@/lib/client/nostr-profile'
import { ThemeProvider } from '@/lib/client/theme-context'
import { Toaster } from '@/components/ui/sonner'

export function Providers({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider {...props}>
      <ThemeProvider>
        <AuthProvider>
          <NostrProfileProvider>
            {children}
            <Toaster />
          </NostrProfileProvider>
        </AuthProvider>
      </ThemeProvider>
    </NextThemesProvider>
  )
}
