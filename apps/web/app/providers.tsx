'use client'

import { AuthProvider } from '@/components/admin/auth-context'
import { SSEProvider } from '@/lib/client/hooks/use-sse'
import { NostrProfileProvider } from '@/lib/client/nostr-profile'
import { ThemeProvider } from '@/lib/client/theme-context'
import { Toaster } from '@/components/ui/sonner'
import { GoogleAnalytics } from '@/components/analytics/google-analytics'

type ProvidersProps = {
  children: React.ReactNode
  [legacyThemeProp: string]: unknown
}

export function Providers({ children }: ProvidersProps) {
  return (
    <AuthProvider>
      <SSEProvider>
        <ThemeProvider>
          <NostrProfileProvider>
            {children}
            <Toaster />
            <GoogleAnalytics />
          </NostrProfileProvider>
        </ThemeProvider>
      </SSEProvider>
    </AuthProvider>
  )
}
