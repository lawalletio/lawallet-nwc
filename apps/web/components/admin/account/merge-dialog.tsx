'use client'

import { useState } from 'react'
import { CheckCircle2, Fingerprint, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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
import { useNostrProfile } from '@/lib/client/nostr-profile'
import { publishProfile, type ProfileFields } from '@/lib/client/nostr-publish'
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
import { npubInitials, truncateNpub } from '@/lib/client/format'
import { cn } from '@/lib/utils'
import type {
  AccountLinkVerifyResponse,
  AccountMergePreviewResponse,
  AccountMergeResponse
} from '@/lib/validation/schemas'

type MergeSide = AccountMergePreviewResponse['survivor']

type Step = 'prove' | 'preview' | 'resolve' | 'review' | 'done'

type ProfileSide = 'survivor' | 'absorbed'

interface MergeResolutions {
  primaryAddressUsername?: string
  defaultWalletId?: string
}

const ACCOUNT_PATH = '/api/account'

const STEP_NUMBER: Record<Exclude<Step, 'done'>, number> = {
  prove: 1,
  preview: 2,
  resolve: 3,
  review: 4
}

interface MergeDialogProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  /** Pre-select the proof tab (default 'nostr'). */
  initialTab?: 'nostr' | 'passkey'
  /** Optional banner shown above the tabs (e.g. duplicate-passkey hint). */
  hint?: string
}

/**
 * What the resolve step actually has to ask, derived from the preview.
 * Sections only render for real conflicts — a field where the two sides
 * agree (or one side has nothing) is a survivor-wins no-op, not a question.
 */
interface MergeConflicts {
  pictureConflict: boolean
  nameConflict: boolean
  profileShown: boolean
  addressConflict: boolean
  walletConflict: boolean
  survivorDefaultWallet: MergeSide['wallets'][number] | null
  absorbedDefaultWallet: MergeSide['wallets'][number] | null
  relaysShown: boolean
  relayUnionCount: number
  survivorDisplayName: string | undefined
  absorbedDisplayName: string | undefined
}

function computeConflicts(preview: AccountMergePreviewResponse): MergeConflicts {
  const s = preview.survivor
  const a = preview.absorbed
  const survivorDisplayName = s.profile?.displayName ?? s.profile?.name
  const absorbedDisplayName = a.profile?.displayName ?? a.profile?.name
  const pictureConflict = Boolean(
    s.profile?.picture && a.profile?.picture && s.profile.picture !== a.profile.picture
  )
  const nameConflict = Boolean(
    survivorDisplayName &&
      absorbedDisplayName &&
      survivorDisplayName !== absorbedDisplayName
  )
  const survivorDefaultWallet = s.wallets.find(w => w.isDefault) ?? null
  const absorbedDefaultWallet = a.wallets.find(w => w.isDefault) ?? null
  return {
    pictureConflict,
    nameConflict,
    profileShown: Boolean(s.profile && a.profile && (pictureConflict || nameConflict)),
    addressConflict: s.primaryAddress !== null && a.primaryAddress !== null,
    walletConflict: survivorDefaultWallet !== null && absorbedDefaultWallet !== null,
    survivorDefaultWallet,
    absorbedDefaultWallet,
    relaysShown: s.relays.length > 0 || a.relays.length > 0,
    relayUnionCount: new Set([...s.relays, ...a.relays]).size,
    survivorDisplayName,
    absorbedDisplayName
  }
}

/**
 * Link-or-merge wizard for the Account Settings page.
 *
 * prove → preview → resolve → review → done. Step 1 proves control of
 * another key/account (Nostr signature or a passkey assertion). Unowned
 * keys link directly; owned ones return a merge ticket, and the wizard
 * walks a read-only preview, per-conflict decisions (main identity,
 * profile fields, primary address, default wallet), a review summary, and
 * the destructive commit. Relay lists are always unioned server-side;
 * profile choices are applied client-side after the merge via a kind-0
 * publish signed by the chosen main key. All WebAuthn ceremonies run
 * inside click handlers so Safari's transient-activation rules hold.
 */
export function MergeDialog({
  open,
  onOpenChange,
  initialTab = 'nostr',
  hint
}: MergeDialogProps) {
  const { jwt, refreshSession, requestSigner } = useAuth()
  const { refetch } = useAccount()

  const [step, setStep] = useState<Step>('prove')
  const [ticket, setTicket] = useState<string | null>(null)
  const [preview, setPreview] = useState<AccountMergePreviewResponse | null>(null)
  const [mainPubkey, setMainPubkey] = useState('')
  const [profileSource, setProfileSource] = useState<{
    picture: ProfileSide
    displayName: ProfileSide
  }>({ picture: 'survivor', displayName: 'survivor' })
  const [addressChoice, setAddressChoice] = useState('')
  const [walletChoice, setWalletChoice] = useState('')
  const [proving, setProving] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [publishingProfile, setPublishingProfile] = useState(false)
  const [result, setResult] = useState<AccountMergeResponse | null>(null)
  const [passkeySupported] = useState(() => isPasskeySupported())

  // Current kind-0 of the chosen main identity — the base the profile patch
  // merges over, and the cache entry to seed after a successful publish.
  const { profile: mainProfile, updateProfile } = useNostrProfile(
    mainPubkey || null
  )

  const conflicts = preview ? computeConflicts(preview) : null

  function handleOpenChange(next: boolean) {
    if (!next) {
      setStep('prove')
      setTicket(null)
      setPreview(null)
      setMainPubkey('')
      setProfileSource({ picture: 'survivor', displayName: 'survivor' })
      setAddressChoice('')
      setWalletChoice('')
      setProving(false)
      setCommitting(false)
      setPublishingProfile(false)
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
    const nextConflicts = computeConflicts(mergePreview)
    setTicket(res.mergeTicket)
    setPreview(mergePreview)
    // Survivor-wins defaults for every decision the resolve step offers.
    setMainPubkey(
      mergePreview.survivor.identities.find(i => i.isPrimary)?.pubkey ??
        mergePreview.survivor.primaryPubkey
    )
    setProfileSource({ picture: 'survivor', displayName: 'survivor' })
    setAddressChoice(mergePreview.survivor.primaryAddress ?? '')
    setWalletChoice(nextConflicts.survivorDefaultWallet?.id ?? '')
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

  /** Chosen value for a profile field, resolved against the preview sides. */
  function chosenProfileValue(
    field: 'picture' | 'displayName'
  ): string | undefined {
    if (!preview) return undefined
    const side =
      profileSource[field] === 'survivor' ? preview.survivor : preview.absorbed
    if (field === 'picture') return side.profile?.picture
    return side.profile?.displayName ?? side.profile?.name
  }

  /**
   * Post-merge kind-0 publish of the chosen profile fields, signed by the
   * chosen main key. Best-effort by design: a failure (or a signer for a
   * different key) must never break the completed merge — toast and move on.
   */
  async function publishProfileChoice() {
    if (!conflicts?.profileShown) return

    const current = mainProfile ?? null
    const patch: ProfileFields = {}
    if (conflicts.pictureConflict) {
      const picture = chosenProfileValue('picture')
      if (picture !== undefined && picture !== current?.picture) {
        patch.picture = picture
      }
    }
    if (conflicts.nameConflict) {
      const displayName = chosenProfileValue('displayName')
      if (
        displayName !== undefined &&
        displayName !== (current?.displayName ?? current?.name)
      ) {
        patch.displayName = displayName
      }
    }
    if (Object.keys(patch).length === 0) return

    setPublishingProfile(true)
    try {
      const signer = await requestSigner()
      const signerPubkey = await signer.getPublicKey()
      if (signerPubkey !== mainPubkey) {
        toast.info(
          'Profile choice not published — sign in with the main key to publish it'
        )
        return
      }
      const published = await publishProfile(signer, current, patch)
      updateProfile(published)
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Could not publish the profile update'
      )
    } finally {
      setPublishingProfile(false)
    }
  }

  async function handleCommit() {
    if (!jwt || !ticket || !mainPubkey || !preview || preview.blocked) return
    setCommitting(true)
    try {
      // Only answer the questions the resolve step actually asked —
      // omitted keys fall back to survivor-wins server-side.
      const resolutions: MergeResolutions = {}
      if (conflicts?.addressConflict && addressChoice) {
        resolutions.primaryAddressUsername = addressChoice
      }
      if (conflicts?.walletConflict && walletChoice) {
        resolutions.defaultWalletId = walletChoice
      }

      const res = await commitMerge(
        jwt,
        ticket,
        mainPubkey,
        Object.keys(resolutions).length > 0 ? resolutions : undefined
      )
      setResult(res)
      // The merged token may present a different primary — re-mint it, but
      // a refresh failure is non-fatal (the old token still authenticates).
      await refreshSession().catch(() => false)
      await refreshAccount()
      setStep('done')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Merge failed')
      setCommitting(false)
      return
    }
    setCommitting(false)
    // Profile application runs after the merge is already durable, still
    // inside the same click-handler chain; the done step shows a small
    // "Publishing profile…" state while it runs.
    await publishProfileChoice()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          'max-h-[90vh] overflow-y-auto',
          step === 'preview' || step === 'resolve'
            ? 'sm:max-w-2xl'
            : 'sm:max-w-md'
        )}
      >
        {step !== 'done' && (
          <p className="text-xs font-medium text-muted-foreground">
            Step {STEP_NUMBER[step]} of 4
          </p>
        )}

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

            {hint && (
              <Alert>
                <AlertDescription>{hint}</AlertDescription>
              </Alert>
            )}

            <Tabs defaultValue={initialTab} className="w-full">
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

              {preview.blocked && (
                <Alert variant="destructive">
                  <AlertTitle>Merge blocked</AlertTitle>
                  <AlertDescription>
                    The other account&apos;s secret key is held by the server
                    and has never been exported. Sign in to that account and
                    export its key first — merging now would destroy it.
                  </AlertDescription>
                </Alert>
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
              >
                Back
              </Button>
              {preview.blocked ? (
                <Button type="button" variant="destructive" disabled>
                  Merge blocked
                </Button>
              ) : (
                <Button type="button" onClick={() => setStep('resolve')}>
                  Continue
                </Button>
              )}
            </DialogFooter>
          </>
        )}

        {step === 'resolve' && preview && conflicts && (
          <>
            <DialogHeader>
              <DialogTitle>Resolve conflicts</DialogTitle>
              <DialogDescription>
                Both accounts bring their own settings — pick what the merged
                account should keep.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6">
              <ResolveSection
                title="Main public identity"
                description="How the platform presents you after the merge."
              >
                <RadioGroup
                  aria-label="Main public identity"
                  value={mainPubkey}
                  onValueChange={setMainPubkey}
                  className="gap-1.5"
                >
                  {[
                    ...preview.survivor.identities,
                    ...preview.absorbed.identities
                  ].map(identity => (
                    <RadioRow
                      key={identity.pubkey}
                      id={`main-${identity.pubkey}`}
                      value={identity.pubkey}
                      label={
                        <span className="font-mono">
                          {truncateNpub(identity.pubkey)}
                        </span>
                      }
                      hint={
                        (identity.label ?? 'No label') +
                        (identity.pubkey === preview.survivor.primaryPubkey
                          ? ' · current primary'
                          : '')
                      }
                    />
                  ))}
                </RadioGroup>
              </ResolveSection>

              {conflicts.profileShown && (
                <ResolveSection
                  title="Profile"
                  description="The two identities publish different profiles — pick per field."
                >
                  {conflicts.pictureConflict && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-muted-foreground">
                        Avatar
                      </p>
                      <RadioGroup
                        aria-label="Avatar"
                        value={profileSource.picture}
                        onValueChange={v =>
                          setProfileSource(prev => ({
                            ...prev,
                            picture: v as ProfileSide
                          }))
                        }
                        className="grid grid-cols-2 gap-2"
                      >
                        <AvatarChoice
                          id="avatar-survivor"
                          value="survivor"
                          picture={preview.survivor.profile?.picture}
                          fallbackPubkey={preview.survivor.primaryPubkey}
                          caption="This account"
                        />
                        <AvatarChoice
                          id="avatar-absorbed"
                          value="absorbed"
                          picture={preview.absorbed.profile?.picture}
                          fallbackPubkey={preview.absorbed.primaryPubkey}
                          caption="Other account"
                        />
                      </RadioGroup>
                    </div>
                  )}

                  {conflicts.nameConflict && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-muted-foreground">
                        Display name
                      </p>
                      <RadioGroup
                        aria-label="Display name"
                        value={profileSource.displayName}
                        onValueChange={v =>
                          setProfileSource(prev => ({
                            ...prev,
                            displayName: v as ProfileSide
                          }))
                        }
                        className="gap-1.5"
                      >
                        <RadioRow
                          id="name-survivor"
                          value="survivor"
                          label={conflicts.survivorDisplayName}
                          hint="This account"
                        />
                        <RadioRow
                          id="name-absorbed"
                          value="absorbed"
                          label={conflicts.absorbedDisplayName}
                          hint="Other account"
                        />
                      </RadioGroup>
                    </div>
                  )}
                </ResolveSection>
              )}

              {conflicts.addressConflict && (
                <ResolveSection
                  title="Primary lightning address"
                  description="Both accounts have a primary address — only one can stay primary."
                >
                  <RadioGroup
                    aria-label="Primary lightning address"
                    value={addressChoice}
                    onValueChange={setAddressChoice}
                    className="gap-1.5"
                  >
                    <RadioRow
                      id="address-survivor"
                      value={preview.survivor.primaryAddress!}
                      label={preview.survivor.primaryAddress}
                      hint="This account"
                    />
                    <RadioRow
                      id="address-absorbed"
                      value={preview.absorbed.primaryAddress!}
                      label={preview.absorbed.primaryAddress}
                      hint="Other account"
                    />
                  </RadioGroup>
                </ResolveSection>
              )}

              {conflicts.walletConflict && (
                <ResolveSection
                  title="Default wallet"
                  description="Both accounts have a default wallet — pick the one new payments route through."
                >
                  <RadioGroup
                    aria-label="Default wallet"
                    value={walletChoice}
                    onValueChange={setWalletChoice}
                    className="gap-1.5"
                  >
                    <RadioRow
                      id="wallet-survivor"
                      value={conflicts.survivorDefaultWallet!.id}
                      label={conflicts.survivorDefaultWallet!.name}
                      hint="This account"
                    />
                    <RadioRow
                      id="wallet-absorbed"
                      value={conflicts.absorbedDefaultWallet!.id}
                      label={conflicts.absorbedDefaultWallet!.name}
                      hint="Other account"
                    />
                  </RadioGroup>
                </ResolveSection>
              )}

              {conflicts.relaysShown && (
                <Alert>
                  <AlertDescription>
                    Relay lists will be merged — {conflicts.relayUnionCount}{' '}
                    {conflicts.relayUnionCount === 1 ? 'relay' : 'relays'} after
                    the merge.
                  </AlertDescription>
                </Alert>
              )}
            </div>

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep('preview')}
              >
                Back
              </Button>
              <Button
                type="button"
                onClick={() => setStep('review')}
                disabled={!mainPubkey}
              >
                Continue
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'review' && preview && conflicts && (
          <>
            <DialogHeader>
              <DialogTitle>Review &amp; merge</DialogTitle>
              <DialogDescription>
                One last look at your decisions before the merge.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="flex flex-col rounded-md border px-3">
                <ReviewRow
                  label="Main identity"
                  value={
                    <span className="font-mono">{truncateNpub(mainPubkey)}</span>
                  }
                />
                {conflicts.profileShown && conflicts.pictureConflict && (
                  <ReviewRow
                    label="Avatar"
                    value={
                      <span className="flex items-center justify-end gap-2">
                        <Avatar className="size-5">
                          {chosenProfileValue('picture') ? (
                            <AvatarImage
                              src={chosenProfileValue('picture')}
                              alt=""
                            />
                          ) : null}
                          <AvatarFallback>
                            {npubInitials(mainPubkey)}
                          </AvatarFallback>
                        </Avatar>
                        {profileSource.picture === 'survivor'
                          ? 'From this account'
                          : 'From the other account'}
                      </span>
                    }
                  />
                )}
                {conflicts.profileShown && conflicts.nameConflict && (
                  <ReviewRow
                    label="Display name"
                    value={`${chosenProfileValue('displayName')} (${
                      profileSource.displayName === 'survivor'
                        ? 'from this account'
                        : 'from the other account'
                    })`}
                  />
                )}
                {conflicts.addressConflict && (
                  <ReviewRow label="Primary address" value={addressChoice} />
                )}
                {conflicts.walletConflict && (
                  <ReviewRow
                    label="Default wallet"
                    value={
                      [
                        conflicts.survivorDefaultWallet,
                        conflicts.absorbedDefaultWallet
                      ].find(w => w?.id === walletChoice)?.name ?? walletChoice
                    }
                  />
                )}
                {conflicts.relaysShown && (
                  <ReviewRow
                    label="Relays"
                    value={`Merged (${conflicts.relayUnionCount} total)`}
                  />
                )}
              </div>

              <p className="text-sm text-muted-foreground">
                Moving from the other account:{' '}
                {countLabel(
                  preview.absorbed.identities.length,
                  'identity',
                  'identities'
                )}
                , {countLabel(preview.absorbed.passkeys, 'passkey', 'passkeys')},{' '}
                {countLabel(
                  preview.absorbed.lightningAddresses.length,
                  'lightning address',
                  'lightning addresses'
                )}
                ,{' '}
                {countLabel(preview.absorbed.remoteWallets, 'wallet', 'wallets')}.
              </p>

              <Alert variant="destructive">
                <AlertDescription>
                  This permanently merges the other account into this one and
                  deletes it. This cannot be undone.
                </AlertDescription>
              </Alert>
            </div>

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep('resolve')}
                disabled={committing}
              >
                Back
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void handleCommit()}
                disabled={committing}
              >
                {committing ? <Spinner size={16} /> : null}
                {committing ? 'Merging…' : 'Merge accounts'}
              </Button>
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
              <li>
                {countLabel(result.movedIdentities, 'identity', 'identities')}{' '}
                moved
              </li>
              <li>{countLabel(result.movedPasskeys, 'passkey', 'passkeys')} moved</li>
              <li>
                {countLabel(
                  result.movedAddresses,
                  'lightning address',
                  'lightning addresses'
                )}{' '}
                moved
              </li>
              <li>{countLabel(result.movedWallets, 'wallet', 'wallets')} moved</li>
              {result.mergedRelays > 0 && (
                <li>
                  {countLabel(result.mergedRelays, 'relay', 'relays')} in the
                  merged relay list
                </li>
              )}
            </ul>

            {publishingProfile && (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Spinner size={16} />
                Publishing profile…
              </div>
            )}

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

function ResolveSection({
  title,
  description,
  children
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  )
}

/** A bordered, clickable radio row: main label + a small side hint. */
function RadioRow({
  id,
  value,
  label,
  hint
}: {
  id: string
  value: string
  label: React.ReactNode
  hint?: string
}) {
  return (
    <Label
      htmlFor={id}
      className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 font-normal transition-colors hover:bg-accent/40"
    >
      <RadioGroupItem value={value} id={id} />
      <span className="min-w-0">
        <span className="block truncate text-sm">{label}</span>
        {hint && (
          <span className="block text-xs text-muted-foreground">{hint}</span>
        )}
      </span>
    </Label>
  )
}

/** Selectable avatar card for the profile-picture choice. */
function AvatarChoice({
  id,
  value,
  picture,
  fallbackPubkey,
  caption
}: {
  id: string
  value: ProfileSide
  picture: string | undefined
  fallbackPubkey: string
  caption: string
}) {
  return (
    <Label
      htmlFor={id}
      className="flex cursor-pointer flex-col items-center gap-2 rounded-md border p-3 font-normal transition-colors hover:bg-accent/40"
    >
      <Avatar className="size-12">
        {picture ? <AvatarImage src={picture} alt="" /> : null}
        <AvatarFallback>{npubInitials(fallbackPubkey)}</AvatarFallback>
      </Avatar>
      <span className="flex items-center gap-2 text-xs">
        <RadioGroupItem value={value} id={id} />
        {caption}
      </span>
    </Label>
  )
}

/** One line of the review summary: decision label + chosen value. */
function ReviewRow({
  label,
  value
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/40 py-2.5 text-sm last:border-b-0">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right font-medium">{value}</span>
    </div>
  )
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
