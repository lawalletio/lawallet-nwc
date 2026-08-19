'use client'

import React from 'react'
import { Settings2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Spinner } from '@/components/ui/spinner'
import {
  useVoucherMutations,
  useVoucherSettings,
  type VoucherSettings
} from '@/lib/client/hooks/use-vouchers'

/**
 * Who may deposit vouchers to this account.
 *
 * Every deposit is NIP-98 signed regardless of the setting — this narrows
 * *which* signers are accepted, it does not turn authentication on or off.
 */
export function VoucherSettingsDialog() {
  const [open, setOpen] = React.useState(false)
  const { data, refetch } = useVoucherSettings()
  const { saveVoucherSettings, savingSettings } = useVoucherMutations()

  const [policy, setPolicy] =
    React.useState<VoucherSettings['policy']>('ANYONE')
  const [senders, setSenders] = React.useState<string[]>([])
  const [draft, setDraft] = React.useState('')

  // Re-seed the form from the server every time the dialog opens, so a
  // cancelled edit never lingers into the next one.
  React.useEffect(() => {
    if (!open || !data) return
    setPolicy(data.policy)
    setSenders(data.allowlist.map(entry => entry.npub))
    setDraft('')
  }, [open, data])

  function addDraft() {
    const value = draft.trim()
    if (!value || senders.includes(value)) {
      setDraft('')
      return
    }
    setSenders(current => [...current, value])
    setDraft('')
  }

  async function handleSave() {
    // A sender typed but not yet added is clearly meant to be included —
    // dropping it silently on save is the surprising behaviour.
    const pending = draft.trim()
    const allowlist =
      pending && !senders.includes(pending) ? [...senders, pending] : senders

    try {
      await saveVoucherSettings({ policy, allowlist })
      toast.success('Deposit settings saved')
      refetch()
      setOpen(false)
    } catch (error) {
      const details = (error as { details?: { unresolved?: string[] } })
        ?.details?.unresolved
      toast.error(
        details?.length
          ? `Couldn’t resolve: ${details.join(', ')}`
          : error instanceof Error
            ? error.message
            : 'Could not save settings'
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Settings2 data-icon="inline-start" />
          Deposit settings
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Voucher deposits</DialogTitle>
          <DialogDescription>
            Services must sign every deposit with Nostr (NIP-98). Choose whose
            signatures you accept.
          </DialogDescription>
        </DialogHeader>

        <RadioGroup
          value={policy}
          onValueChange={value => setPolicy(value as VoucherSettings['policy'])}
          className="gap-3"
        >
          <OptionRow
            value="ANYONE"
            title="Anyone"
            hint="Any service that signs a valid request can send you vouchers."
          />
          <OptionRow
            value="ALLOWLIST"
            title="Only these services"
            hint="Everything else is refused."
          />
        </RadioGroup>

        {policy === 'ALLOWLIST' ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="voucher-sender">Allowed senders</Label>
            <div className="flex gap-2">
              <Input
                id="voucher-sender"
                value={draft}
                onChange={event => setDraft(event.target.value)}
                onKeyDown={event => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  addDraft()
                }}
                placeholder="npub1… or name@domain.com"
              />
              <Button type="button" variant="secondary" onClick={addDraft}>
                Add
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              npub, hex pubkey, or NIP-05. NIP-05 names are resolved once when
              you save.
            </p>

            {senders.length === 0 ? (
              <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                No senders yet — nobody can deposit vouchers to you.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {senders.map(sender => (
                  <li
                    key={sender}
                    className="flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-1.5"
                  >
                    <span className="truncate font-mono text-xs">
                      {abbreviate(sender)}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${sender}`}
                      onClick={() =>
                        setSenders(current =>
                          current.filter(item => item !== sender)
                        )
                      }
                    >
                      <X className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={savingSettings}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={savingSettings}>
            {savingSettings ? <Spinner data-icon="inline-start" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Shorten a long key for display. Works on the entry as typed (npub, hex, or
 * NIP-05) rather than on a decoded pubkey, so an unsaved draft renders the
 * same way a saved one does.
 */
function abbreviate(entry: string): string {
  if (entry.length <= 24 || entry.includes('@')) return entry
  return `${entry.slice(0, 14)}…${entry.slice(-6)}`
}

function OptionRow({
  value,
  title,
  hint
}: {
  value: string
  title: string
  hint: string
}) {
  return (
    <Label
      htmlFor={`policy-${value}`}
      className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-[:checked]:border-primary"
    >
      <RadioGroupItem value={value} id={`policy-${value}`} className="mt-0.5" />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        <span className="text-sm font-normal text-muted-foreground">
          {hint}
        </span>
      </span>
    </Label>
  )
}
