'use client'

import React from 'react'
import { KeyRound } from 'lucide-react'
import type { NostrSigner } from '@nostrify/nostrify'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { NostrConnectForm } from '@/components/shared/nostr-connect-form'
import type {
  LoginMethod,
  SignerCredentials,
} from '@/components/admin/auth-context'

/**
 * Narrow dialog that re-obtains a NostrSigner without triggering a full
 * NIP-98 → JWT re-exchange. Used by `AuthProvider.requestSigner` whenever
 * an in-session action needs to sign a Nostr event (e.g. Blossom BUD-02
 * uploads) but the signer was dropped because the user logged in with a
 * non-rehydratable method (nsec / bunker) and then reloaded.
 *
 * Reuses the same nsec / bunker input forms as the login page via
 * `NostrConnectForm`'s `handleSigner` override — we just stash the signer
 * in state instead of exchanging a fresh JWT. The extension option is
 * hidden because an extension-backed signer would already have been
 * rehydrated automatically on mount.
 */
export function SignerUnlockDialog({
  open,
  onCancel,
  onUnlock,
}: {
  open: boolean
  onCancel: () => void
  onUnlock: (
    signer: NostrSigner,
    method: LoginMethod,
    credentials?: SignerCredentials,
  ) => void
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next) onCancel()
      }}
    >
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader className="items-center text-center">
          <div className="mb-2 flex size-10 items-center justify-center rounded-md bg-muted">
            <KeyRound className="size-5 text-muted-foreground" aria-hidden />
          </div>
          <DialogTitle>Unlock signer</DialogTitle>
          <DialogDescription>
            This action needs to sign a Nostr event. Re-enter your key (or
            reconnect your bunker) — your session stays logged in.
          </DialogDescription>
        </DialogHeader>

        <NostrConnectForm
          submitLabel="Unlock"
          loadingLabel="Unlocking…"
          showExtension={false}
          handleSigner={async (signer, method, credentials) => {
            onUnlock(signer, method, credentials)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
