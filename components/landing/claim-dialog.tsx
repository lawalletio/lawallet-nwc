'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X as XIcon } from 'lucide-react'
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
import { NostrConnectForm } from '@/components/shared/nostr-connect-form'
import { cn } from '@/lib/utils'

interface ClaimDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  domain: string
}

export function ClaimDialog({ open, onOpenChange, domain }: ClaimDialogProps) {
  const router = useRouter()

  const [step, setStep] = useState<'username' | 'connect'>('username')
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

  // After login succeeds, redirect to dashboard with claim param
  function handleLoginSuccess() {
    router.push(`/admin?claim=${encodeURIComponent(username)}`)
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

      </DialogContent>
    </Dialog>
  )
}
