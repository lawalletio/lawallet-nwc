'use client'

import { useState } from 'react'
import { CheckCircle2, Fingerprint, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { NostrConnectForm } from '@/components/shared/nostr-connect-form'
import { useAuth } from '@/components/admin/auth-context'
import { useAccount } from '@/lib/client/hooks/use-account'
import { invalidateApiPath } from '@/lib/client/hooks/use-api'
import {
  commitMerge,
  fetchMergePreview,
  proveNostrKey,
  provePasskeyAccount
} from '@/lib/client/account-api'
import {
  isPasskeySupported,
  translatePasskeyError
} from '@/lib/client/passkey-api'
import { truncateNpub } from '@/lib/client/format'
import { cn } from '@/lib/utils'
import type {
  AccountLinkVerifyResponse,
  AccountMergePreviewResponse,
  AccountMergeResponse
} from '@/lib/validation/schemas'

type MergeSide = AccountMergePreviewResponse['survivor']

type Step = 'prove' | 'preview' | 'done'

const ACCOUNT_PATH = '/api/account'

/**
 * Link-or-merge flow for the Account Settings page.
 *
 * Step 1 proves control of another key/account (Nostr signature or a
 * passkey assertion). If the key was unowned it links directly; otherwise
 * the server hands back a merge ticket and step 2 shows a side-by-side
 * dry-run preview before the destructive commit. All WebAuthn ceremonies
 * run inside click handlers so Safari's transient-activation rules hold.
 */
export function MergeDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const { jwt, refreshSession } = useAuth()
  const { refetch } = useAccount()

  const [step, setStep] = useState<Step>('prove')
  const [ticket, setTicket] = useState<string | null>(null)
  const [preview, setPreview] = useState<AccountMergePreviewResponse | null>(null)
  const [mainPubkey, setMainPubkey] = useState('')
  const [proving, setProving] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [result, setResult] = useState<AccountMergeResponse | null>(null)
  const [passkeySupported] = useState(() => isPasskeySupported())

  function handleOpenChange(next: boolean) {
    if (!next) {
      setStep('prove')
      setTicket(null)
      setPreview(null)
      setMainPubkey('')
      setProving(false)
      setCommitting(false)
      setResult(null)
    }
    onOpenChange(next)
  }

  async function refreshAccount() {
    // Wakes every mounted /api/account consumer (the screen behind the
    // dialog included), then awaits our own instance so callers can rely
    // on fresh data being committed.
    invalidateApiPath(ACCOUNT_PATH)
    await refetch()
  }

  async function handleProofResult(res: AccountLinkVerifyResponse) {
    if (res.linked) {
      toast.success('Key linked to your account')
      await refreshAccount()
      handleOpenChange(false)
      return
    }

    if (!res.mergeTicket || !jwt) {
      throw new Error('Proof accepted but no merge ticket was returned')
    }

    const mergePreview = await fetchMergePreview(jwt, res.mergeTicket)
    setTicket(res.mergeTicket)
    setPreview(mergePreview)
    setMainPubkey(
      mergePreview.survivor.identities.find(i => i.isPrimary)?.pubkey ??
        mergePreview.survivor.primaryPubkey
    )
    setStep('preview')
  }

  async function handlePasskeyProve() {
    if (!jwt) return
    setProving(true)
    try {
      // Ceremony + proof stay inside the click handler (Safari transient
      // activation) — do not move the assertion into an effect.
      const res = await provePasskeyAccount(jwt)
      await handleProofResult(res)
    } catch (err) {
      const passkeyError = translatePasskeyError(err)
      // A dismissed Face ID / Touch ID prompt is not an error worth showing.
      if (passkeyError.kind !== 'cancelled') {
        toast.error(passkeyError.message)
      }
    } finally {
      setProving(false)
    }
  }

  async function handleCommit() {
    if (!jwt || !ticket || !mainPubkey || !preview || preview.blocked) return
    setCommitting(true)
    try {
      const res = await commitMerge(jwt, ticket, mainPubkey)
      setResult(res)
      // The merged token may present a different primary — re-mint it, but
      // a refresh failure is non-fatal (the old token still authenticates).
      await refreshSession().catch(() => false)
      await refreshAccount()
      setStep('done')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Merge failed')
    } finally {
      setCommitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          'max-h-[90vh] overflow-y-auto',
          step === 'preview' ? 'sm:max-w-2xl' : 'sm:max-w-md'
        )}
      >
        {step === 'prove' && (
          <>
            <DialogHeader>
              <DialogTitle>Link or merge an account</DialogTitle>
              <DialogDescription>
                Prove you control the other key — sign with it, or use one of
                its passkeys. Unowned keys link instantly; keys that belong to
                another account start a merge.
              </DialogDescription>
            </DialogHeader>

            <Tabs defaultValue="nostr" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="nostr">
                  <KeyRound className="mr-1.5 size-3.5" />
                  Nostr key
                </TabsTrigger>
                <TabsTrigger value="passkey">
                  <Fingerprint className="mr-1.5 size-3.5" />
                  Passkey
                </TabsTrigger>
              </TabsList>

              <TabsContent value="nostr" className="pt-2">
                <NostrConnectForm
                  submitLabel="Prove ownership"
                  loadingLabel="Proving…"
                  handleSigner={async signer => {
                    if (!jwt) throw new Error('Not authenticated')
                    const res = await proveNostrKey(jwt, signer)
                    await handleProofResult(res)
                  }}
                />
              </TabsContent>

              <TabsContent value="passkey" className="pt-2">
                <div className="flex flex-col gap-4 pt-2">
                  <p className="text-sm text-muted-foreground">
                    Use a passkey that belongs to the other account. Your
                    device will prompt for Face ID, Touch ID, or your screen
                    lock.
                  </p>
                  <Button
                    type="button"
                    className="h-11 w-full"
                    onClick={() => void handlePasskeyProve()}
                    disabled={proving || !passkeySupported}
                  >
                    {proving ? (
                      <Spinner size={16} />
                    ) : (
                      <Fingerprint className="size-4" />
                    )}
                    {proving ? 'Waiting for your device…' : 'Prove with passkey'}
                  </Button>
                  {!passkeySupported && (
                    <p className="text-xs text-muted-foreground">
                      Passkeys are not supported in this browser.
                    </p>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </>
        )}

        {step === 'preview' && preview && (
          <>
            <DialogHeader>
              <DialogTitle>Merge accounts</DialogTitle>
              <DialogDescription>
                That key belongs to another account. Review what would move
                before merging it into this one.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <MergeSideCard title="This account" side={preview.survivor} />
                <MergeSideCard title="Incoming account" side={preview.absorbed} />
              </div>

              {preview.collisions.map((collision, i) => (
                <Alert
                  key={`${collision.kind}-${i}`}
                  variant={preview.blocked ? 'destructive' : 'default'}
                >
                  <AlertDescription>{collision.detail}</AlertDescription>
                </Alert>
              ))}

              {preview.blocked ? (
                <Alert variant="destructive">
                  <AlertTitle>Merge blocked</AlertTitle>
                  <AlertDescription>
                    The other account&apos;s secret key is held by the server
                    and has never been exported. Sign in to that account and
                    export its key first — merging now would destroy it.
                  </AlertDescription>
                </Alert>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label>Main public identity after the merge</Label>
                    <RadioGroup
                      value={mainPubkey}
                      onValueChange={setMainPubkey}
                      className="gap-1.5"
                    >
                      {[
                        ...preview.survivor.identities,
                        ...preview.absorbed.identities
                      ].map(identity => {
                        const isCurrentPrimary =
                          identity.pubkey === preview.survivor.primaryPubkey
                        return (
                          <Label
                            key={identity.pubkey}
                            htmlFor={`main-${identity.pubkey}`}
                            className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 font-normal transition-colors hover:bg-accent/40 has-[button[data-state=checked]]:border-primary"
                          >
                            <RadioGroupItem
                              value={identity.pubkey}
                              id={`main-${identity.pubkey}`}
                            />
                            <span className="min-w-0">
                              <span className="block truncate font-mono text-sm">
                                {truncateNpub(identity.pubkey)}
                              </span>
                              <span className="block text-xs text-muted-foreground">
                                {identity.label ?? 'No label'}
                                {isCurrentPrimary && ' · current primary'}
                              </span>
                            </span>
                          </Label>
                        )
                      })}
                    </RadioGroup>
                  </div>

                  <Alert variant="destructive">
                    <AlertDescription>
                      This permanently merges the other account into this one
                      and deletes it. This cannot be undone.
                    </AlertDescription>
                  </Alert>
                </>
              )}
            </div>

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setStep('prove')
                  setTicket(null)
                  setPreview(null)
                  setMainPubkey('')
                }}
                disabled={committing}
              >
                Back
              </Button>
              {preview.blocked ? (
                <Button type="button" variant="destructive" disabled>
                  Merge blocked
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => void handleCommit()}
                  disabled={committing || !mainPubkey}
                >
                  {committing ? <Spinner size={16} /> : null}
                  {committing ? 'Merging…' : 'Merge accounts'}
                </Button>
              )}
            </DialogFooter>
          </>
        )}

        {step === 'done' && result && (
          <>
            <DialogHeader className="items-center text-center">
              <CheckCircle2 className="mb-2 size-10 text-primary" />
              <DialogTitle>Accounts merged</DialogTitle>
              <DialogDescription>
                Everything from the other account now belongs to this one.
              </DialogDescription>
            </DialogHeader>

            <ul className="mx-auto space-y-1 text-sm text-muted-foreground">
              <li>{countLabel(result.movedIdentities, 'identity', 'identities')} moved</li>
              <li>{countLabel(result.movedPasskeys, 'passkey', 'passkeys')} moved</li>
              <li>
                {countLabel(result.movedAddresses, 'lightning address', 'lightning addresses')}{' '}
                moved
              </li>
              <li>{countLabel(result.movedWallets, 'wallet', 'wallets')} moved</li>
            </ul>

            <DialogFooter>
              <Button
                type="button"
                className="w-full"
                onClick={() => handleOpenChange(false)}
              >
                Close
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`
}

/** One side of the merge preview: identity chips + a compact resource tally. */
function MergeSideCard({ title, side }: { title: string; side: MergeSide }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription className="font-mono text-xs">
          {truncateNpub(side.primaryPubkey)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            {countLabel(side.identities.length, 'identity', 'identities')}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {side.identities.map(identity => (
              <Badge
                key={identity.pubkey}
                variant="outline"
                className="font-mono font-normal"
              >
                {truncateNpub(identity.pubkey, 4)}
              </Badge>
            ))}
          </div>
        </div>

        <ul className="space-y-1 text-muted-foreground">
          {side.lightningAddresses.length > 0 && (
            <li className="break-words">
              Addresses: {side.lightningAddresses.join(', ')}
            </li>
          )}
          <li>
            {countLabel(side.remoteWallets, 'wallet', 'wallets')} ·{' '}
            {countLabel(side.cards, 'card', 'cards')} ·{' '}
            {countLabel(side.passkeys, 'passkey', 'passkeys')}
          </li>
          <li>
            {countLabel(side.cardDesigns, 'design', 'designs')} ·{' '}
            {countLabel(side.invoices, 'invoice', 'invoices')}
          </li>
        </ul>

        {(side.hasAlbySubAccount || side.hasManagedKey) && (
          <div className="flex flex-wrap gap-1">
            {side.hasAlbySubAccount && (
              <Badge variant="secondary">Alby sub-account</Badge>
            )}
            {side.hasManagedKey && (
              <Badge variant="secondary">
                {side.managedKeyExported
                  ? 'Custodied key (exported)'
                  : 'Custodied key'}
              </Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
