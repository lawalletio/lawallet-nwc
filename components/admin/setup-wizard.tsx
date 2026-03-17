'use client'

import React, { useState, useEffect } from 'react'
import { Shield, Check } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/components/admin/auth-context'
import { checkRootStatus, claimRootRole, exchangeNip98ForJwt, validateJwt } from '@/lib/client/auth-api'

type WizardState = 'checking' | 'needs-setup' | 'claiming' | 'done' | 'hidden'

export function SetupWizard() {
  const { status, signer, role, login, loginMethod } = useAuth()
  const [state, setState] = useState<WizardState>('checking')

  // Check root status after authentication
  useEffect(() => {
    async function check() {
      if (status !== 'authenticated' || !signer) {
        setState('hidden')
        return
      }

      // If user already has ADMIN role, skip the wizard
      if (role === 'ADMIN') {
        setState('hidden')
        return
      }

      try {
        const rootStatus = await checkRootStatus(signer)
        if (!rootStatus.hasRoot && rootStatus.canAssignRoot) {
          setState('needs-setup')
        } else {
          setState('hidden')
        }
      } catch {
        // If check fails, just hide the wizard
        setState('hidden')
      }
    }

    check()
  }, [status, signer, role])

  async function handleClaimRoot() {
    if (!signer || !loginMethod) return

    setState('claiming')
    try {
      await claimRootRole(signer)

      // Re-exchange NIP-98 for JWT to get updated role
      await login(signer, loginMethod)

      setState('done')
      toast.success('Root admin role claimed successfully!')

      // Auto-hide after a brief moment
      setTimeout(() => setState('hidden'), 2000)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to claim root role')
      setState('needs-setup')
    }
  }

  if (state === 'hidden' || state === 'checking') return null

  return (
    <Dialog open={state === 'needs-setup' || state === 'claiming' || state === 'done'}>
      <DialogContent
        className="sm:max-w-md"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-primary/10">
            {state === 'done' ? (
              <Check className="size-6 text-green-500" />
            ) : (
              <Shield className="size-6 text-primary" />
            )}
          </div>
          <DialogTitle className="text-center">
            {state === 'done' ? 'Setup Complete' : 'First-Time Setup'}
          </DialogTitle>
          <DialogDescription className="text-center">
            {state === 'done'
              ? 'You are now the root administrator of this LaWallet instance.'
              : 'No administrator has been configured yet. As the first user to connect, you can claim the root admin role to manage this instance.'}
          </DialogDescription>
        </DialogHeader>

        {state !== 'done' && (
          <DialogFooter className="sm:justify-center">
            <Button
              onClick={handleClaimRoot}
              disabled={state === 'claiming'}
              className="w-full sm:w-auto"
            >
              {state === 'claiming' ? (
                <>
                  <Spinner size={16} className="mr-2" />
                  Claiming...
                </>
              ) : (
                <>
                  <Shield className="mr-2 size-4" />
                  Claim Root Role
                </>
              )}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
