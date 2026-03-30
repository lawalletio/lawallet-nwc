'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Check, X as XIcon } from 'lucide-react'
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
import { cn } from '@/lib/utils'

interface ClaimDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  domain: string
}

export function ClaimDialog({ open, onOpenChange, domain }: ClaimDialogProps) {
  const router = useRouter()
  const { apiClient } = useAuth()

  const [step, setStep] = useState<'username' | 'connect' | 'claiming' | 'success'>('username')
  const [username, setUsername] = useState('')
  const [usernameError, setUsernameError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [available, setAvailable] = useState<boolean | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const displayDomain = domain || 'domain.com'

  // Debounced availability check
  const checkAvailability = useCallback((name: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!name || name.length < 1 || !/^[a-z0-9]+$/.test(name)) {
      setAvailable(null)
      setChecking(false)
      return
    }

    setChecking(true)
    setAvailable(null)

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/lightning-addresses/check?username=${encodeURIComponent(name)}`)
        if (res.ok) {
          const data = await res.json()
          setAvailable(data.available)
          if (!data.available) {
            setUsernameError('This username is already taken')
          }
        }
      } catch {
        // Network error — don't block the user
      } finally {
        setChecking(false)
      }
    }, 400)
  }, [])

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  // Reset state when dialog closes
  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen)
    if (!nextOpen) {
      setTimeout(() => {
        setStep('username')
        setUsername('')
        setUsernameError(null)
        setAvailable(null)
        setChecking(false)
      }, 200)
    }
  }

  function handleUsernameChange(value: string) {
    const sanitized = value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16)
    setUsername(sanitized)
    setUsernameError(null)
    setAvailable(null)
    checkAvailability(sanitized)
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
    if (available === false) {
      setUsernameError('This username is already taken')
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
        setAvailable(false)
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
                    onChange={(e) => handleUsernameChange(e.target.value)}
                    className={cn(
                      'border-0 shadow-none focus-visible:ring-0',
                      usernameError && 'text-destructive'
                    )}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    onKeyDown={(e) => e.key === 'Enter' && handleContinue()}
                  />
                  <InputGroupText position="suffix">
                    <span className="flex items-center gap-1.5">
                      @{displayDomain}
                      {username.length > 0 && (
                        checking ? (
                          <Spinner size={12} className="text-muted-foreground" />
                        ) : available === true ? (
                          <Check className="size-3.5 text-green-500" />
                        ) : available === false ? (
                          <XIcon className="size-3.5 text-destructive" />
                        ) : null
                      )}
                    </span>
                  </InputGroupText>
                </InputGroup>
                {usernameError && (
                  <p className="text-xs text-destructive">{usernameError}</p>
                )}
              </div>

              <Button
                variant="theme"
                className="w-full"
                onClick={handleContinue}
                disabled={!username || checking || available === false}
              >
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
                {username}@{displayDomain}
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

        {/* Step 2.5: Claiming */}
        {step === 'claiming' && (
          <div className="flex flex-col items-center justify-center py-8 gap-4">
            <Spinner size={32} />
            <p className="text-sm text-muted-foreground">Claiming {username}@{displayDomain}...</p>
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
                {username}@{displayDomain}
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
