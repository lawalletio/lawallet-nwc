'use client'

import { useMemo, useState } from 'react'
import { KeyRound, ShieldAlert, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { QrDisplay } from '@/components/wallet/shared/qr-display'
import { useUsers } from '@/lib/client/hooks/use-users'
import {
  useGenerateDeviceToken,
  type GenerateDeviceTokenResult,
} from '@/lib/client/hooks/use-device-tokens'
import { Permission } from '@/lib/auth/permissions'
import { truncateNpub } from '@/lib/client/format'

/** Human labels for each grantable permission. */
const PERMISSION_LABELS: Record<Permission, string> = {
  [Permission.SETTINGS_READ]: 'Read settings',
  [Permission.SETTINGS_WRITE]: 'Write settings',
  [Permission.USERS_READ]: 'Read users',
  [Permission.USERS_WRITE]: 'Write users',
  [Permission.USERS_MANAGE_ROLES]: 'Manage user roles',
  [Permission.CARDS_READ]: 'Read cards',
  [Permission.CARDS_WRITE]: 'Write & pair cards',
  [Permission.CARD_DESIGNS_READ]: 'Read card designs',
  [Permission.CARD_DESIGNS_WRITE]: 'Write card designs',
  [Permission.ADDRESSES_READ]: 'Read lightning addresses',
  [Permission.ADDRESSES_WRITE]: 'Write lightning addresses',
  [Permission.NTAGS_READ]: 'Read NTAG424 keys',
  [Permission.NTAGS_WRITE]: 'Write NTAG424 keys',
  [Permission.ACTIVITY_READ]: 'Read activity log',
}

/** Permissions grouped by resource for a readable checklist. */
const PERMISSION_GROUPS: { label: string; permissions: Permission[] }[] = [
  {
    label: 'Cards',
    permissions: [
      Permission.CARDS_READ,
      Permission.CARDS_WRITE,
      Permission.NTAGS_READ,
      Permission.NTAGS_WRITE,
    ],
  },
  {
    label: 'Card designs',
    permissions: [Permission.CARD_DESIGNS_READ, Permission.CARD_DESIGNS_WRITE],
  },
  {
    label: 'Lightning addresses',
    permissions: [Permission.ADDRESSES_READ, Permission.ADDRESSES_WRITE],
  },
  {
    label: 'Users',
    permissions: [
      Permission.USERS_READ,
      Permission.USERS_WRITE,
      Permission.USERS_MANAGE_ROLES,
    ],
  },
  {
    label: 'Platform',
    permissions: [
      Permission.SETTINGS_READ,
      Permission.SETTINGS_WRITE,
      Permission.ACTIVITY_READ,
    ],
  },
]

/** Everything `card-installer` / `simple-card-manager` need to provision cards. */
const CARD_PROVISIONING_PRESET: Permission[] = [
  Permission.CARDS_READ,
  Permission.CARDS_WRITE,
  Permission.CARD_DESIGNS_READ,
  Permission.CARD_DESIGNS_WRITE,
  Permission.NTAGS_READ,
  Permission.NTAGS_WRITE,
  Permission.ADDRESSES_READ,
]

const EXPIRY_PRESETS: { value: string; label: string }[] = [
  { value: '1h', label: '1 hour' },
  { value: '8h', label: '8 hours' },
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: 'custom', label: 'Custom…' },
]

export function DeviceTokensTab() {
  const { data: users, loading: usersLoading } = useUsers()
  const { generate, loading: generating } = useGenerateDeviceToken()

  const [userId, setUserId] = useState('')
  const [permissions, setPermissions] = useState<Permission[]>(
    CARD_PROVISIONING_PRESET,
  )
  const [expiryPreset, setExpiryPreset] = useState('8h')
  const [customExpiry, setCustomExpiry] = useState('')
  const [result, setResult] = useState<GenerateDeviceTokenResult | null>(null)

  const selectedUser = useMemo(
    () => users?.find(u => u.id === userId) ?? null,
    [users, userId],
  )

  const expiresIn =
    expiryPreset === 'custom' ? customExpiry.trim() : expiryPreset

  const canGenerate =
    !!userId &&
    permissions.length > 0 &&
    (expiryPreset !== 'custom' || customExpiry.trim().length > 0) &&
    !generating

  function togglePermission(permission: Permission, checked: boolean) {
    setPermissions(prev =>
      checked
        ? prev.includes(permission)
          ? prev
          : [...prev, permission]
        : prev.filter(p => p !== permission),
    )
  }

  async function handleGenerate() {
    try {
      const res = await generate({ userId, permissions, expiresIn })
      setResult(res)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to generate device token',
      )
    }
  }

  function reset() {
    setResult(null)
  }

  // ── Result view: render the minted token as a QR ───────────────────────────
  if (result) {
    return (
      <div className="flex flex-col items-center gap-6 px-4 pt-10 pb-8 w-full max-w-[560px] mx-auto">
        <div className="text-center">
          <h3 className="text-lg font-semibold">Scan to sign in</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Open <span className="font-medium">card-installer</span> or{' '}
            <span className="font-medium">simple-card-manager</span> and scan
            this code. The token is also copyable below.
          </p>
        </div>

        <QrDisplay value={result.jwt} size={260} />

        <div className="w-full rounded-lg border bg-muted/40 p-4 text-sm">
          <dl className="grid grid-cols-[100px_1fr] gap-y-2">
            <dt className="text-muted-foreground">Acts as</dt>
            <dd className="font-medium break-all">
              {result.user.pubkey
                ? truncateNpub(result.user.pubkey)
                : result.user.id}{' '}
              <span className="text-muted-foreground">({result.user.role})</span>
            </dd>
            <dt className="text-muted-foreground">Expires in</dt>
            <dd className="font-medium">{String(result.expiresIn)}</dd>
            <dt className="text-muted-foreground">Scopes</dt>
            <dd className="flex flex-wrap gap-1">
              {result.scopes.map(s => (
                <span
                  key={s}
                  className="rounded bg-background px-1.5 py-0.5 text-xs font-mono border"
                >
                  {s}
                </span>
              ))}
            </dd>
          </dl>
        </div>

        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <ShieldAlert className="size-4 shrink-0 mt-0.5" />
          <p>
            Anyone holding this token can act as the selected user, with the
            scopes above, until it expires. It can&apos;t be revoked — keep it
            private and prefer short expirations.
          </p>
        </div>

        <Button variant="secondary" onClick={reset} className="w-full">
          <RotateCcw className="size-4" />
          Generate another
        </Button>
      </div>
    )
  }

  // ── Form view ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-8 px-4 pt-10 pb-8 w-full max-w-[1024px] mx-auto">
      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8">
        <div>
          <h3 className="text-sm font-semibold">Device Tokens</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Generate a scoped, stateless login token for the card apps
            (card-installer, simple-card-manager). Shown as a QR to scan.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="device-token-user">User</Label>
          <Select value={userId} onValueChange={setUserId} disabled={usersLoading}>
            <SelectTrigger id="device-token-user">
              <SelectValue
                placeholder={usersLoading ? 'Loading users…' : 'Select a user'}
              />
            </SelectTrigger>
            <SelectContent>
              {users?.map(u => (
                <SelectItem key={u.id} value={u.id}>
                  {u.primaryAddress
                    ? `${u.primaryAddress} · ${truncateNpub(u.pubkey)}`
                    : truncateNpub(u.pubkey)}{' '}
                  ({u.role})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            The device authenticates as this user. Role-gated actions still
            respect the user&apos;s role; the scopes below narrow what the token
            can do.
          </p>
        </div>
      </div>

      <Separator />

      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8">
        <div>
          <h3 className="text-sm font-semibold">Permissions</h3>
          <p className="text-sm text-muted-foreground mt-1">
            The token is limited to the scopes you tick. Must be a subset of your
            own permissions.
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPermissions(CARD_PROVISIONING_PRESET)}
            >
              Card provisioning
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setPermissions([])}
            >
              Clear
            </Button>
          </div>
        </div>
        <div className="space-y-5">
          {PERMISSION_GROUPS.map(group => (
            <div key={group.label} className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {group.label}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {group.permissions.map(permission => {
                  const id = `perm-${permission}`
                  return (
                    <label
                      key={permission}
                      htmlFor={id}
                      className="flex items-center gap-2 text-sm cursor-pointer select-none"
                    >
                      <Checkbox
                        id={id}
                        checked={permissions.includes(permission)}
                        onCheckedChange={checked =>
                          togglePermission(permission, checked === true)
                        }
                      />
                      {PERMISSION_LABELS[permission]}
                    </label>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <Separator />

      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8">
        <div>
          <h3 className="text-sm font-semibold">Expiration</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Tokens can&apos;t be revoked, so prefer short lifetimes. No maximum,
            but a longer lifetime is a longer-lived risk if the token leaks.
          </p>
        </div>
        <div className="space-y-3">
          <Select value={expiryPreset} onValueChange={setExpiryPreset}>
            <SelectTrigger id="device-token-expiry" className="sm:w-[240px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPIRY_PRESETS.map(p => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {expiryPreset === 'custom' && (
            <div className="space-y-1">
              <Input
                placeholder="e.g. 12h, 3d, 90m"
                value={customExpiry}
                onChange={e => setCustomExpiry(e.target.value)}
                className="sm:w-[240px]"
              />
              <p className="text-xs text-muted-foreground">
                A duration like <code>12h</code>, <code>3d</code>, or a number of
                seconds.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end">
        <Button variant="theme" disabled={!canGenerate} onClick={handleGenerate}>
          {generating ? (
            <>
              <Spinner size={16} className="mr-2" />
              Generating…
            </>
          ) : (
            <>
              <KeyRound className="size-4" />
              Generate token
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
