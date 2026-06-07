'use client'

import { useMemo, useState } from 'react'
import { Check, ChevronsUpDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { useUsers, type AdminUser } from '@/lib/client/hooks/use-users'
import { useNostrProfiles } from '@/lib/client/nostr-profile'
import { truncateNpub, npubInitials, toNpub } from '@/lib/client/format'
import { Role } from '@/lib/auth/permissions'

const ROLE_VARIANT: Record<Role, 'default' | 'secondary' | 'outline'> = {
  ADMIN: 'default',
  OPERATOR: 'secondary',
  VIEWER: 'secondary',
  USER: 'outline',
}

/**
 * One selectable user row. Mirrors the requested `UserSelector` field
 * contract (npub, name, role, avatarUrl) plus the ids needed to select and
 * search a row.
 */
interface UserOption {
  id: string
  pubkey: string
  npub: string
  name: string | null
  role: Role
  avatarUrl: string | null
  address: string | null
}

export interface UserSelectorProps {
  /** Selected user id (`''` when nothing is chosen). */
  value: string
  /** Called with the selected user's id. */
  onValueChange: (userId: string) => void
  disabled?: boolean
  placeholder?: string
  /** Override the user list; defaults to the admin `GET /api/users` list. */
  users?: AdminUser[]
}

/**
 * Searchable user picker. Lists every user with their Nostr avatar + name,
 * role badge, and truncated npub; type to filter by name, npub, address, or
 * role. Avatars/names come from the shared {@link useNostrProfiles} cache, so
 * they paint instantly from cache and revalidate in the background.
 */
export function UserSelector({
  value,
  onValueChange,
  disabled,
  placeholder = 'Select a user',
  users: usersProp,
}: UserSelectorProps) {
  const { data: fetchedUsers, loading: usersLoading } = useUsers()
  const users = useMemo(
    () => usersProp ?? fetchedUsers ?? [],
    [usersProp, fetchedUsers],
  )
  const { profiles } = useNostrProfiles(users.map(u => u.pubkey))
  const [open, setOpen] = useState(false)

  const options = useMemo<UserOption[]>(
    () =>
      users.map(u => {
        const profile = profiles[u.pubkey]
        return {
          id: u.id,
          pubkey: u.pubkey,
          npub: toNpub(u.pubkey),
          name: profile?.displayName || profile?.name || null,
          role: u.role,
          avatarUrl: profile?.picture ?? null,
          address: u.primaryAddress,
        }
      }),
    [users, profiles],
  )

  const selected = options.find(o => o.id === value) ?? null
  const isDisabled = disabled || (!usersProp && usersLoading)

  return (
    <div className="relative w-full">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={isDisabled}
            className={cn(
              'h-auto min-h-10 w-full justify-start font-normal',
              selected ? 'pr-14' : 'pr-9',
            )}
          >
            {selected ? (
              <UserRowContent option={selected} />
            ) : (
              <span className="text-muted-foreground">
                {usersLoading && !usersProp ? 'Loading users…' : placeholder}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] p-0"
          align="start"
        >
          <Command
            filter={(itemValue, search) =>
              itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
            }
          >
            <CommandInput placeholder="Search users…" />
            <CommandList>
              <CommandEmpty>No users found.</CommandEmpty>
              <CommandGroup>
                {options.map(option => (
                  <CommandItem
                    key={option.id}
                    // Searchable text + a unique suffix so same-name users don't collide.
                    value={[
                      option.name,
                      option.npub,
                      option.address,
                      option.role,
                      option.id,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onSelect={() => {
                      onValueChange(option.id)
                      setOpen(false)
                    }}
                    className="gap-2"
                  >
                    <UserRowContent option={option} />
                    <Check
                      className={cn(
                        'ml-auto size-4 shrink-0',
                        option.id === value ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/*
        Trailing icons overlaid on the trigger. The container is
        `pointer-events-none` so clicks on the chevron fall through to the
        trigger (opening the popover); the clear button re-enables pointer
        events so it can intercept its own click without nesting a <button>
        inside the trigger <button>.
      */}
      <div className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
        {selected && !isDisabled && (
          <button
            type="button"
            aria-label="Clear selection"
            onClick={e => {
              e.stopPropagation()
              onValueChange('')
            }}
            className="pointer-events-auto rounded-sm p-0.5 text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <X className="size-4" />
          </button>
        )}
        <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
      </div>
    </div>
  )
}

/** Avatar + name/npub + role badge — shared by the trigger and each row. */
function UserRowContent({ option }: { option: UserOption }) {
  const label = option.name || truncateNpub(option.pubkey)
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Avatar className="size-6 shrink-0">
        {option.avatarUrl && <AvatarImage src={option.avatarUrl} alt={label} />}
        <AvatarFallback className="text-[10px]">
          {npubInitials(option.pubkey)}
        </AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-col items-start">
        <span className="truncate text-sm font-medium leading-tight">
          {label}
        </span>
        <span className="truncate font-mono text-[10px] leading-tight text-muted-foreground">
          {option.address ? `${option.address} · ` : ''}
          {truncateNpub(option.pubkey)}
        </span>
      </div>
      <Badge
        variant={ROLE_VARIANT[option.role]}
        className="ml-1 shrink-0 text-[10px]"
      >
        {option.role}
      </Badge>
    </div>
  )
}
