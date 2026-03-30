'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupText } from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import { NostrConnectForm } from '@/components/shared/nostr-connect-form'
import { useAuth } from '@/components/admin/auth-context'

interface ClaimDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  domain: string
}

export function ClaimDialog({ open, onOpenChange, domain }: ClaimDialogProps) {
  const router = useRouter()
  const { status, apiClient } = useAuth()

  const [step, setStep] = useState<'username' | 'connect' | 'claiming' | 'success'>('username')
  const [username, setUsername] = useState('')
  const [usernameError, setUsernameError] = useState<string | null>(null)

  // Reset state when dialog closes
  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen)
    if (!nextOpen) {
      setTimeout(() => {
        setStep('username')
        setUsername('')
        setUsernameError(null)
      }, 200)
    }
  }

  // Validate username and proceed
  function handleContinue() {
    if (!username || username.length < 1) {
      setUsernameError('Username is required')
      return
    }
    if (username.length > 16) {
      setUsernameError('Username must be 16 characters or less')
      return
    }
    if (!/^[a-z0-9]+$/.test(username)) {
      setUsernameError('Only lowercase letters and numbers allowed')
      return
    }
    setUsernameError(null)
    setStep('connect')
  }

  // After login succeeds, claim the address
  async function handleLoginSuccess() {
    setStep('claiming')

    // Small delay to ensure auth state propagation
    await new Promise((r) => setTimeout(r, 200))

    try {
      const me = await apiClient.get<{ id: string }>('/api/users/me')
      await apiClient.put(`/api/users/${me.id}/lightning-address`, { username })
      setStep('success')
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      if (msg.includes('409') || msg.includes('already')) {
        setUsernameError('This username is already taken. Try another one.')
        setStep('username')
      } else {
        toast.error(msg || 'Failed to claim address')
        setStep('connect')
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Step 1: Username */}
        {step === 'username' && (
          <>
            <DialogHeader>
              <DialogTitle>Claim your Lightning Address</DialogTitle>
              <DialogDescription>Choose a username for your address</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <InputGroup>
                  <Input
                    placeholder="satoshi"
                    value={username}
                    onChange={(e) => {
                      const sanitized = e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9]/g, '')
                        .slice(0, 16)
                      setUsername(sanitized)
                      setUsernameError(null)
                    }}
                    className="border-0 shadow-none focus-visible:ring-0"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    onKeyDown={(e) => e.key === 'Enter' && handleContinue()}
                  />
                  <InputGroupText position="suffix">@{domain || 'domain.com'}</InputGroupText>
                </InputGroup>
                {usernameError && (
                  <p className="text-xs text-destructive">{usernameError}</p>
                )}
              </div>

              <Button variant="theme" className="w-full" onClick={handleContinue}>
                Continue
              </Button>
            </div>
          </>
        )}

        {/* Step 2: Connect with Nostr */}
        {step === 'connect' && (
          <>
            <DialogHeader>
              <DialogTitle>
                {username}@{domain || 'domain.com'}
              </DialogTitle>
              <DialogDescription>
                Connect your identity to claim this address
              </DialogDescription>
            </DialogHeader>

            <NostrConnectForm
              onSuccess={handleLoginSuccess}
              submitLabel="Login & Claim"
              loadingLabel="Connecting..."
            />

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setStep('username')}
            >
              Back
            </Button>
          </>
        )}

        {/* Step 2.5: Claiming (after login, before address claim completes) */}
        {step === 'claiming' && (
          <div className="flex flex-col items-center justify-center py-8 gap-4">
            <Spinner size={32} />
            <p className="text-sm text-muted-foreground">Claiming {username}@{domain || 'domain.com'}...</p>
          </div>
        )}

        {/* Step 3: Success */}
        {step === 'success' && (
          <>
            <DialogHeader>
              <div className="flex size-16 items-center justify-center rounded-full bg-green-500/10 mx-auto mb-4">
                <CheckCircle2 className="size-8 text-green-500" />
              </div>
              <DialogTitle className="text-center">You&apos;re all set!</DialogTitle>
              <DialogDescription className="text-center">
                Your Lightning Address is ready
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <p
                className="text-lg font-semibold text-center"
                style={{ color: 'var(--theme-400)' }}
              >
                {username}@{domain || 'domain.com'}
              </p>

              <Button
                variant="theme"
                className="w-full"
                onClick={() => router.push('/admin')}
              >
                Go to Dashboard
              </Button>
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => handleOpenChange(false)}
              >
                Close
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
