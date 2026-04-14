'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'
import type { ThemeProviderProps } from 'next-themes'
import { AuthProvider } from '@/components/admin/auth-context'
import { SSEProvider } from '@/lib/client/hooks/use-sse'
import { NostrProfileProvider } from '@/lib/client/nostr-profile'
import { ThemeProvider } from '@/lib/client/theme-context'
import { Toaster } from '@/components/ui/sonner'

export function Providers({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider {...props}>
      <ThemeProvider>
        <AuthProvider>
          <SSEProvider>
            <NostrProfileProvider>
              {children}
              <Toaster />
            </NostrProfileProvider>
          </SSEProvider>
        </AuthProvider>
      </ThemeProvider>
    </NextThemesProvider>
  )
}
