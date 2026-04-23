'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Check, X as XIcon, Copy, Zap, ArrowLeft, RefreshCw, CheckCircle2 } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { InputGroup, InputGroupText } from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { useAuth } from '@/components/admin/auth-context'
import { useSettings } from '@/lib/client/hooks/use-settings'
import { pollVerifyUrl } from '@/lib/client/lnurl'
import { buildPublicHost } from '@/lib/public-url-utils'

type Step = 'username' | 'payment' | 'claiming' | 'success'

interface InvoiceData {
  id: string
  bolt11: string
  paymentHash: string
  amountSats: number
  verify?: string
  expiresAt: string
}

export interface RegisterAddressFlowProps {
  /**
   * Pre-fill a username. When provided, the flow auto-advances to
   * invoice generation on mount (skipping the username-picker step).
   */
  initialUsername?: string
  /**
   * Called once the address is successfully claimed.
   * Receives the full `username@domain` string.
   */
  onSuccess?: (address: string) => void
  /**
   * Label for the "go home" button on the success card.
   */
  successCtaLabel?: string
  /**
   * Callback for the success CTA. Defaults to calling `onSuccess` again
   * so callers can wire up a router.push.
   */
  onSuccessCta?: (address: string) => void
}

export function RegisterAddressFlow({
  initialUsername,
  onSuccess,
  successCtaLabel = 'Continue',
  onSuccessCta,
}: RegisterAddressFlowProps) {
  const { apiClient } = useAuth()
  const { data: settings } = useSettings()

  const [step, setStep] = useState<Step>('username')
  const [username, setUsername] = useState(initialUsername ?? '')
  const [usernameError, setUsernameError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [available, setAvailable] = useState<boolean | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Payment state
  const [invoice, setInvoice] = useState<InvoiceData | null>(null)
  const [invoiceLoading, setInvoiceLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [paymentStatus, setPaymentStatus] = useState<'waiting' | 'detected' | 'timeout'>('waiting')
  const abortRef = useRef<AbortController | null>(null)

  // Success state
  const [claimedAddress, setClaimedAddress] = useState<string | null>(null)

  const domain =
    buildPublicHost(settings?.domain, settings?.subdomain ?? settings?.endpoint) ||
    'domain.com'

  // ─── Username check ─────────────────────────────────────────────────

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
        const res = await fetch(
          `/api/lightning-addresses/check?username=${encodeURIComponent(name)}`
        )
        if (res.ok) {
          const data = await res.json()
          setAvailable(data.available)
          if (!data.available) {
            setUsernameError('This username is already taken')
          }
        }
      } catch {
        // Network error — don't block
      } finally {
        setChecking(false)
      }
    }, 400)
  }, [])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  function handleUsernameChange(value: string) {
    const sanitized = value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16)
    setUsername(sanitized)
    setUsernameError(null)
    setAvailable(null)
    checkAvailability(sanitized)
  }

  // ─── Invoice generation ─────────────────────────────────────────────

  const generateInvoice = useCallback(
    async (nameOverride?: string) => {
      const name = (nameOverride ?? username).trim()
      if (!name) return
      setInvoiceLoading(true)
      setPaymentStatus('waiting')
      setInvoice(null)

      // Cancel any existing polling
      abortRef.current?.abort()

      try {
        const result = await apiClient.post<InvoiceData | { free: true }>(
          '/api/invoices',
          { purpose: 'registration', metadata: { username: name } }
        )

        if ('free' in result && result.free) {
          // Free registration — go straight to claim
          await claimAddressFree(name)
          return
        }

        const invoiceData = result as InvoiceData
        setInvoice(invoiceData)
        setStep('payment')

        // Start polling if verify URL available (server guarantees it when paid)
        if (invoiceData.verify) {
          startPolling(invoiceData, name)
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Failed to generate invoice'
        toast.error(msg)
        setStep('username')
        setUsernameError(msg)
      } finally {
        setInvoiceLoading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apiClient, username, domain]
  )

  // Auto-advance when the flow is launched with an initialUsername
  const autoGeneratedRef = useRef(false)
  useEffect(() => {
    if (!initialUsername || autoGeneratedRef.current) return
    autoGeneratedRef.current = true
    generateInvoice(initialUsername)
  }, [initialUsername, generateInvoice])

  function handleContinue() {
    if (!username || username.length < 1) {
      setUsernameError('Username is required')
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
    generateInvoice()
  }

  function startPolling(invoiceData: InvoiceData, name: string) {
    const controller = new AbortController()
    abortRef.current = controller

    pollVerifyUrl(invoiceData.verify!, { signal: controller.signal })
      .then(async result => {
        if (result.settled && result.preimage) {
          setPaymentStatus('detected')
          try {
            const claimResult = await apiClient.post<{
              success: boolean
              lightningAddress?: string
            }>(`/api/invoices/${invoiceData.id}/claim`, {
              preimage: result.preimage,
            })
            if (claimResult.success) {
              const address = claimResult.lightningAddress ?? `${name}@${domain}`
              setClaimedAddress(address)
              setStep('success')
              onSuccess?.(address)
            }
          } catch (error) {
            const msg = error instanceof Error ? error.message : 'Failed to claim address'
            toast.error(msg)
            if (msg.includes('taken')) {
              setStep('username')
              setUsernameError('Username was taken while you were paying')
            }
          }
        }
      })
      .catch(err => {
        if (err.message !== 'Polling aborted') {
          setPaymentStatus('timeout')
        }
      })
  }

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  // ─── Claim address (free path) ──────────────────────────────────────

  async function claimAddressFree(name: string) {
    setStep('claiming')
    try {
      const me = await apiClient.get<{ userId: string }>('/api/users/me')
      await apiClient.put(`/api/users/${me.userId}/lightning-address`, { username: name })
      const address = `${name}@${domain}`
      setClaimedAddress(address)
      setStep('success')
      onSuccess?.(address)
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to claim address'
      toast.error(msg)
      if (msg.includes('409') || msg.includes('taken') || msg.includes('already')) {
        setStep('username')
        setUsernameError('This username is already taken')
      } else {
        setStep('username')
      }
    }
  }

  // ─── Copy invoice ───────────────────────────────────────────────────

  function handleCopy() {
    if (!invoice?.bolt11) return
    const text = invoice.bolt11
    function onCopied() {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(onCopied, () => {
        fallbackCopy(text)
        onCopied()
      })
    } else {
      fallbackCopy(text)
      onCopied()
    }
  }

  function fallbackCopy(text: string) {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }

  // ─── Render ─────────────────────────────────────────────────────────

  return (
    <div className="flex flex-1 items-start justify-center p-6 pt-12">
      <div className="w-full max-w-[480px] space-y-4">

        {/* ── Step 1: Username ──────────────────────────── */}
        {step === 'username' && (
          <>
            <Card>
              <CardContent className="p-6 space-y-4">
                <div>
                  <h2 className="text-lg font-semibold">Choose your username</h2>
                  <p className="text-sm text-muted-foreground">
                    Pick a username for your lightning address.
                  </p>
                </div>

                <div className="space-y-2">
                  <InputGroup>
                    <Input
                      placeholder="satoshi"
                      value={username}
                      onChange={e => handleUsernameChange(e.target.value)}
                      className={cn(
                        'border-0 shadow-none focus-visible:ring-0',
                        usernameError && 'text-destructive'
                      )}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      onKeyDown={e => e.key === 'Enter' && handleContinue()}
                    />
                    <InputGroupText position="suffix">
                      <span className="flex items-center gap-1.5">
                        @{domain}
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
              </CardContent>
            </Card>

            <Button
              variant="theme"
              className="w-full"
              onClick={handleContinue}
              disabled={!username || checking || available === false || invoiceLoading}
            >
              {invoiceLoading ? (
                <>
                  <Spinner size={16} className="mr-2" />
                  Generating invoice...
                </>
              ) : (
                'Continue'
              )}
            </Button>
          </>
        )}

        {/* ── Step 2: Payment ──────────────────────────── */}
        {step === 'payment' && invoice && (
          <>
            <Card>
              <CardContent className="p-6 space-y-5">
                <div className="text-center">
                  <h2 className="text-lg font-semibold">
                    Pay {invoice.amountSats} sats
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Scan the QR code or copy the invoice to complete payment for{' '}
                    <span className="font-medium text-foreground">
                      {username}@{domain}
                    </span>
                  </p>
                </div>

                <div className="flex flex-col items-center gap-3">
                  <div className="rounded-lg bg-white p-3">
                    <QRCodeSVG value={invoice.bolt11} size={200} />
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCopy}
                    className="text-xs"
                  >
                    <Copy className="mr-1.5 size-3.5" />
                    {copied ? 'Copied!' : 'Copy Invoice'}
                  </Button>
                </div>

                {paymentStatus === 'waiting' && (
                  <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                    <Spinner size={12} />
                    {invoice.verify
                      ? 'Waiting for payment...'
                      : 'Pay the invoice and wait for confirmation...'}
                  </div>
                )}

                {paymentStatus === 'detected' && (
                  <div className="flex items-center justify-center gap-2 text-xs text-green-500">
                    <Check className="size-3.5" />
                    Payment detected! Claiming address...
                  </div>
                )}

                {paymentStatus === 'timeout' && (
                  <div className="flex flex-col items-center gap-2">
                    <p className="text-xs text-muted-foreground">
                      Payment verification timed out.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => generateInvoice()}
                    >
                      <RefreshCw className="mr-1.5 size-3.5" />
                      Generate New Invoice
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <Button
              variant="secondary"
              className="w-full"
              onClick={() => {
                abortRef.current?.abort()
                setStep('username')
              }}
            >
              <ArrowLeft className="mr-2 size-4" />
              Back
            </Button>
          </>
        )}

        {/* ── Step: Claiming ───────────────────────────── */}
        {step === 'claiming' && (
          <div className="flex flex-col items-center gap-4 py-12">
            <Spinner size={32} />
            <p className="text-sm text-muted-foreground">Claiming your address...</p>
          </div>
        )}

        {/* ── Step 3: Success ──────────────────────────── */}
        {step === 'success' && (
          <>
            <Card>
              <CardContent className="p-6 space-y-4">
                <div className="flex flex-col items-center gap-4 py-4">
                  <div className="flex size-16 items-center justify-center rounded-full bg-green-500/10">
                    <CheckCircle2 className="size-8 text-green-500" />
                  </div>
                  <div className="text-center space-y-1">
                    <h2 className="text-lg font-semibold">Address registered!</h2>
                    <p className="text-sm text-muted-foreground">
                      Your lightning address is now active.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg bg-muted px-4 py-2.5">
                    <Zap className="size-4 text-yellow-500" />
                    <span className="text-sm font-medium">
                      {claimedAddress}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Button
              variant="theme"
              className="w-full"
              onClick={() => claimedAddress && onSuccessCta?.(claimedAddress)}
            >
              {successCtaLabel}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
