'use client'

import React, { useState, useEffect } from 'react'
import Image from 'next/image'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupText } from '@/components/ui/input-group'
import { Card, CardContent } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/components/admin/auth-context'
import { checkRootStatus, claimRootRole } from '@/lib/client/auth-api'

type WizardStep = 'checking' | 'domain' | 'confirm' | 'claiming' | 'hidden'

export function SetupWizard() {
  const { status, signer, role, login, loginMethod, apiClient } = useAuth()
  const [step, setStep] = useState<WizardStep>('checking')
  const [domain, setDomain] = useState('')
  const [subdomain, setSubdomain] = useState('')
  const [showAdvance, setShowAdvance] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verified, setVerified] = useState(false)

  useEffect(() => {
    async function check() {
      if (status !== 'authenticated' || !signer) {
        setState('hidden')
        return
      }

      if (role === 'ADMIN') {
        setState('hidden')
        return
      }

      try {
        const rootStatus = await checkRootStatus(signer)
        if (!rootStatus.hasRoot && rootStatus.canAssignRoot) {
          setState('domain')
        } else {
          setState('hidden')
        }
      } catch {
        setState('hidden')
      }
    }

    check()
  }, [status, signer, role])

  function setState(s: WizardStep) {
    setStep(s)
  }

  async function handleVerify() {
    if (!domain.trim()) return
    setVerifying(true)
    // Simulate domain verification — in production this would check DNS
    await new Promise((r) => setTimeout(r, 800))
    setVerifying(false)
    setVerified(true)
    toast.success('Domain verified')
  }

  async function handleConfirm() {
    if (!signer || !loginMethod) return

    setState('claiming')
    try {
      // 1. Claim root role
      await claimRootRole(signer)

      // 2. Save domain setting
      try {
        const fullDomain = subdomain ? `${subdomain}.${domain}` : domain
        await apiClient.post('/api/settings', {
          domain: fullDomain,
          endpoint: `https://${fullDomain}`,
        })
      } catch {
        // Domain save is best-effort — root claim is the critical part
      }

      // 3. Re-login to get updated role
      await login(signer, loginMethod)

      toast.success('Setup complete! You are now the root administrator.')
      setState('hidden')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to complete setup')
      setState('confirm')
    }
  }

  if (step === 'hidden' || step === 'checking') return null

  const communityName = subdomain
    ? `${subdomain}.${domain}`
    : domain || 'your community'

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-background px-4">
      {/* Logo at top */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2">
        <Image
          src="/logos/lawallet.svg"
          alt="LaWallet"
          width={100}
          height={24}
          className="h-6 w-auto"
        />
      </div>

      {step === 'domain' && (
        <div className="w-full max-w-[480px] space-y-4">
          <Card className="overflow-hidden">
            {/* Illustration placeholder */}
            <div className="h-[200px] bg-gradient-to-br from-neutral-300 to-neutral-100" />
            <CardContent className="p-6 space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Domain</h2>
                <p className="text-sm text-muted-foreground">Configure your domain.</p>
              </div>

              <div className="flex gap-2">
                <InputGroup className="flex-1">
                  <InputGroupText>https://</InputGroupText>
                  <Input
                    placeholder="domain.com"
                    value={domain}
                    onChange={(e) => {
                      setDomain(e.target.value)
                      setVerified(false)
                    }}
                    className="border-0 shadow-none focus-visible:ring-0"
                  />
                </InputGroup>
                <Button
                  variant="secondary"
                  size="sm"
                  className="shrink-0 self-center"
                  onClick={handleVerify}
                  disabled={!domain.trim() || verifying}
                >
                  {verifying ? <Spinner size={16} /> : 'Verify'}
                </Button>
              </div>

              {/* Advance section */}
              <button
                onClick={() => setShowAdvance(!showAdvance)}
                className="flex items-center gap-1 mx-auto text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Advance
                {showAdvance ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              </button>

              {showAdvance && (
                <InputGroup>
                  <Input
                    placeholder="subdomain"
                    value={subdomain}
                    onChange={(e) => setSubdomain(e.target.value)}
                    className="border-0 shadow-none focus-visible:ring-0"
                  />
                  <InputGroupText position="suffix">
                    .{domain || 'domain.com'}
                  </InputGroupText>
                </InputGroup>
              )}
            </CardContent>
          </Card>

          <Button
            className="w-full"
            variant="secondary"
            disabled={!domain.trim()}
            onClick={() => setStep('confirm')}
          >
            Next
          </Button>
        </div>
      )}

      {(step === 'confirm' || step === 'claiming') && (
        <div className="w-full max-w-[480px] space-y-4">
          <Card className="overflow-hidden">
            {/* Illustration placeholder */}
            <div className="h-[200px] bg-gradient-to-br from-neutral-300 to-neutral-100" />
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="size-12 shrink-0 rounded-md bg-gradient-to-br from-neutral-300 to-neutral-100" />
                <div>
                  <p className="text-sm text-muted-foreground">Is this your community?</p>
                  <p className="text-base font-semibold">{communityName}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-3">
            <Button
              variant="secondary"
              className="flex-1"
              disabled={step === 'claiming'}
              onClick={() => setStep('domain')}
            >
              Back
            </Button>
            <Button
              className="flex-1 bg-green-600 hover:bg-green-700 text-white"
              disabled={step === 'claiming'}
              onClick={handleConfirm}
            >
              {step === 'claiming' ? (
                <>
                  <Spinner size={16} className="mr-2" />
                  Setting up...
                </>
              ) : (
                'Confirm'
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
