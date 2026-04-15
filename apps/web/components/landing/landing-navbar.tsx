'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { LoginModal } from '@/components/admin/login-modal'
import { useAuth } from '@/components/admin/auth-context'
import { useNostrProfile } from '@/lib/client/nostr-profile'

export function LandingNavbar() {
  const router = useRouter()
  const { status, pubkey } = useAuth()
  const { profile } = useNostrProfile(pubkey)
  const [loginOpen, setLoginOpen] = useState(false)

  const isAuthenticated = status === 'authenticated'
  const displayName = profile?.displayName || profile?.name || null
  const avatarFallback = (
    profile?.name?.[0] ||
    profile?.displayName?.[0] ||
    pubkey?.slice(0, 2) ||
    '?'
  ).toUpperCase()

  return (
    <>
      <nav className="sticky top-0 z-40 w-full border-b border-border/40 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <Image
              src="/logos/lawallet.svg"
              alt="LaWallet"
              width={110}
              height={26}
              className="h-6 w-auto"
              priority
            />
          </div>

          <div className="flex items-center gap-3">
            {status === 'loading' ? (
              <div className="size-8 rounded-full bg-muted/40 animate-pulse" />
            ) : isAuthenticated ? (
              <>
                <div className="hidden sm:flex items-center gap-2 pr-1">
                  <Avatar className="size-8">
                    {profile?.picture && (
                      <AvatarImage src={profile.picture} alt={displayName ?? 'User'} />
                    )}
                    <AvatarFallback className="text-xs">{avatarFallback}</AvatarFallback>
                  </Avatar>
                  {displayName && (
                    <span className="text-sm font-medium text-foreground max-w-[160px] truncate">
                      {displayName}
                    </span>
                  )}
                </div>
                <Button
                  variant="theme"
                  size="sm"
                  onClick={() => router.push('/admin')}
                >
                  Dashboard
                </Button>
              </>
            ) : (
              <Button
                variant="theme"
                size="sm"
                onClick={() => setLoginOpen(true)}
              >
                Login
              </Button>
            )}
          </div>
        </div>
      </nav>

      <LoginModal
        open={loginOpen}
        onOpenChange={setLoginOpen}
        onSuccess={() => {
          setLoginOpen(false)
        }}
      />
    </>
  )
}
