'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X as XIcon, AtSign, Zap, ArrowLeft } from 'lucide-react'
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

  function handleLoginSuccess() {
    router.push(`/admin/addresses/register?username=${encodeURIComponent(username)}`)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          // Reset the base panel: glassy near-black, no opaque bg, hairline border, generous round.
          'group/claim overflow-hidden border-0 bg-transparent p-0 shadow-none sm:max-w-md sm:rounded-[28px]',
          // Kill the default close button's offset clash — we keep it, just style its frame below.
          '[&>button]:right-5 [&>button]:top-5 [&>button]:z-30 [&>button]:rounded-full [&>button]:p-1.5 [&>button]:opacity-50 [&>button]:transition [&>button]:hover:opacity-90 [&>button]:hover:bg-white/5 [&>button]:outline-none [&>button]:focus:ring-0 [&>button]:focus-visible:ring-2 [&>button]:focus-visible:ring-white/40 [&>button]:focus-visible:ring-offset-0'
        )}
      >
        {/* ── Liquid-glass shell ───────────────────────────────────────────── */}
        <div className="claim-glass relative isolate overflow-hidden rounded-[28px] border border-white/10 px-7 pb-7 pt-9">
          {/* Single focused spotlight from the top — the one accent. */}
          <div aria-hidden className="claim-spotlight pointer-events-none absolute -top-24 left-1/2 -z-10 h-64 w-[140%] -translate-x-1/2" />
          {/* Soft theme bloom anchored to the medallion. */}
          <div aria-hidden className="claim-bloom pointer-events-none absolute -top-10 left-1/2 -z-10 size-56 -translate-x-1/2 rounded-full" />
          {/* Hairline top inner highlight. */}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />

          {/* Header medallion — glassy circle with a theme glow. */}
          <div className="claim-stagger flex justify-center" style={{ animationDelay: '40ms' }}>
            <div className="claim-medallion relative flex size-16 items-center justify-center rounded-2xl border border-white/10">
              <div aria-hidden className="claim-medallion-glow absolute inset-0 -z-10 rounded-2xl" />
              {step === 'username' ? (
                <AtSign className="size-7 text-white/90" strokeWidth={2.25} />
              ) : (
                <Zap
                  className="size-7"
                  strokeWidth={2.25}
                  style={{ color: 'var(--theme-400)' }}
                  fill="var(--theme-400)"
                />
              )}
            </div>
          </div>

          {/* Step 1: Username */}
          {step === 'username' && (
            <>
              <DialogHeader className="claim-stagger mt-6 space-y-2 text-center sm:text-center" style={{ animationDelay: '110ms' }}>
                <DialogTitle className="text-balance text-2xl font-semibold tracking-tight text-white">
                  Claim your Lightning Address
                </DialogTitle>
                <DialogDescription className="mx-auto max-w-[19rem] text-balance text-sm leading-relaxed text-white/45">
                  Pick a name. It becomes your address for getting paid anywhere over Lightning.
                </DialogDescription>
              </DialogHeader>

              <div className="mt-8 space-y-4">
                <div className="claim-stagger space-y-2" style={{ animationDelay: '180ms' }}>
                  <InputGroup className="h-14 rounded-2xl border-white/10 bg-white/[0.03] shadow-none backdrop-blur-sm transition-colors focus-within:border-white/20 focus-within:ring-0 focus-within:ring-offset-0">
                    <Input
                      placeholder="satoshi"
                      value={username}
                      onChange={(e) => handleUsernameChange(e.target.value)}
                      className={cn(
                        'h-full border-0 bg-transparent px-5 text-lg font-medium tracking-tight text-white shadow-none placeholder:text-white/25 focus-visible:ring-0 focus-visible:ring-offset-0',
                        usernameError && 'text-destructive'
                      )}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      onKeyDown={(e) => e.key === 'Enter' && handleContinue()}
                    />
                    <InputGroupText
                      position="suffix"
                      className="h-full max-w-[55%] border-l-0 bg-transparent pr-5 text-base font-medium text-white/40"
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate">
                          <span
                            className="mr-px align-baseline text-2xl font-semibold leading-none"
                            style={{ color: 'var(--theme-400)' }}
                          >
                            @
                          </span>
                          {displayDomain}
                        </span>
                        {username.length > 0 && (
                          checking ? (
                            <Spinner size={12} className="shrink-0 text-white/40" />
                          ) : available === true ? (
                            <span className="claim-pop flex size-4 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: 'color-mix(in srgb, var(--theme-400) 22%, transparent)' }}>
                              <Check className="size-3" style={{ color: 'var(--theme-400)' }} strokeWidth={3} />
                            </span>
                          ) : available === false ? (
                            <span className="claim-pop flex size-4 shrink-0 items-center justify-center rounded-full bg-destructive/20">
                              <XIcon className="size-3 text-destructive" strokeWidth={3} />
                            </span>
                          ) : null
                        )}
                      </span>
                    </InputGroupText>
                  </InputGroup>
                  {usernameError && (
                    <p className="px-1 text-xs font-medium text-destructive">{usernameError}</p>
                  )}
                </div>

                <Button
                  variant="theme"
                  className="claim-stagger h-14 w-full rounded-2xl text-base font-semibold shadow-[0_8px_30px_-12px_color-mix(in_srgb,var(--theme-400)_70%,transparent)] transition-transform active:scale-[0.985]"
                  style={{ animationDelay: '250ms' }}
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
              <DialogHeader className="claim-stagger mt-6 space-y-2 text-center sm:text-center" style={{ animationDelay: '110ms' }}>
                <DialogTitle className="text-balance text-2xl font-semibold tracking-tight text-white">
                  <span className="text-white">{username}</span>
                  <span className="text-white/35">@{displayDomain}</span>
                </DialogTitle>
                <DialogDescription className="mx-auto max-w-[19rem] text-balance text-sm leading-relaxed text-white/45">
                  Connect your Nostr identity to lock in this address.
                </DialogDescription>
              </DialogHeader>

              <div className="claim-stagger mt-7" style={{ animationDelay: '180ms' }}>
                <NostrConnectForm
                  onSuccess={handleLoginSuccess}
                  submitLabel="Login & Claim"
                  loadingLabel="Connecting..."
                />
              </div>

              <div className="claim-stagger mt-4 flex justify-center" style={{ animationDelay: '250ms' }}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 rounded-full text-white/50 hover:bg-white/5 hover:text-white"
                  onClick={() => setStep('username')}
                >
                  <ArrowLeft className="size-3.5" />
                  Back
                </Button>
              </div>
            </>
          )}
        </div>

        <style jsx>{`
          /* ── Spotlight Mono: minimal near-black liquid glass ─────────────── */
          .claim-glass {
            background:
              linear-gradient(
                180deg,
                color-mix(in srgb, var(--theme-400) 6%, transparent) 0%,
                transparent 38%
              ),
              rgba(10, 10, 11, 0.72);
            backdrop-filter: blur(28px) saturate(150%);
            -webkit-backdrop-filter: blur(28px) saturate(150%);
            box-shadow:
              0 1px 0 0 rgba(255, 255, 255, 0.08) inset,
              0 -1px 0 0 rgba(0, 0, 0, 0.4) inset,
              0 40px 80px -24px rgba(0, 0, 0, 0.7),
              0 0 0 1px rgba(0, 0, 0, 0.4);
          }

          /* The one focused accent: a single soft spotlight cone from the top. */
          .claim-spotlight {
            background: radial-gradient(
              60% 100% at 50% 0%,
              color-mix(in srgb, var(--theme-400) 38%, transparent) 0%,
              color-mix(in srgb, var(--theme-400) 12%, transparent) 34%,
              transparent 70%
            );
            filter: blur(8px);
            opacity: 0.9;
          }

          .claim-bloom {
            background: radial-gradient(
              circle at center,
              color-mix(in srgb, var(--theme-400) 30%, transparent) 0%,
              transparent 62%
            );
            filter: blur(26px);
            animation: claim-bloom-pulse 6s ease-in-out infinite;
          }

          .claim-medallion {
            background:
              linear-gradient(
                160deg,
                rgba(255, 255, 255, 0.1) 0%,
                rgba(255, 255, 255, 0.02) 50%,
                rgba(255, 255, 255, 0) 100%
              ),
              rgba(255, 255, 255, 0.03);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            box-shadow:
              0 1px 0 0 rgba(255, 255, 255, 0.18) inset,
              0 8px 24px -8px rgba(0, 0, 0, 0.6);
            animation: claim-float 5.5s ease-in-out infinite;
          }

          .claim-medallion-glow {
            background: radial-gradient(
              circle at 50% 38%,
              color-mix(in srgb, var(--theme-400) 55%, transparent) 0%,
              transparent 70%
            );
            filter: blur(14px);
            animation: claim-glow 4s ease-in-out infinite;
          }

          /* Staggered entrance for inner content. */
          .claim-stagger {
            opacity: 0;
            animation: claim-rise 0.55s cubic-bezier(0.22, 1, 0.36, 1) both;
          }

          /* Availability indicator pop-in. */
          .claim-pop {
            animation: claim-pop 0.32s cubic-bezier(0.34, 1.56, 0.64, 1) both;
          }

          @keyframes claim-rise {
            from {
              opacity: 0;
              transform: translateY(10px);
              filter: blur(2px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
              filter: blur(0);
            }
          }

          @keyframes claim-pop {
            from {
              opacity: 0;
              transform: scale(0.4);
            }
            to {
              opacity: 1;
              transform: scale(1);
            }
          }

          @keyframes claim-float {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-5px); }
          }

          @keyframes claim-glow {
            0%, 100% { opacity: 0.55; transform: scale(1); }
            50% { opacity: 0.9; transform: scale(1.12); }
          }

          @keyframes claim-bloom-pulse {
            0%, 100% { opacity: 0.55; transform: translateX(-50%) scale(1); }
            50% { opacity: 0.85; transform: translateX(-50%) scale(1.08); }
          }

          @media (prefers-reduced-motion: reduce) {
            .claim-stagger,
            .claim-pop {
              opacity: 1;
              animation: none;
              transform: none;
              filter: none;
            }
            .claim-medallion,
            .claim-medallion-glow,
            .claim-bloom {
              animation: none;
            }
          }
        `}</style>
      </DialogContent>
    </Dialog>
  )
}