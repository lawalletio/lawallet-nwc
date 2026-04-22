'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/components/admin/auth-context'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { NostrProfile } from '@/lib/client/nostr-profile'
import { publishProfile } from '@/lib/client/nostr-publish'

interface EditProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  profile: NostrProfile | null
  pubkey: string
  onPublished: (next: NostrProfile) => void
}

export function EditProfileDialog({
  open,
  onOpenChange,
  profile,
  pubkey,
  onPublished,
}: EditProfileDialogProps) {
  const { signer, requestSigner } = useAuth()

  const [displayName, setDisplayName] = useState('')
  const [about, setAbout] = useState('')
  const [picture, setPicture] = useState('')
  const [banner, setBanner] = useState('')
  const [saving, setSaving] = useState(false)

  // Reset the form state each time the dialog opens so a cancelled edit
  // doesn't carry over to the next open. Do the reset on `open` transition,
  // not on every profile change, because touching the form while a
  // background refetch lands would otherwise clobber unsaved input.
  useEffect(() => {
    if (!open) return
    setDisplayName(profile?.displayName || profile?.name || '')
    setAbout(profile?.about || '')
    setPicture(profile?.picture || '')
    setBanner(profile?.banner || '')
  }, [open, profile])

  const fallback = (profile?.name || profile?.displayName || pubkey.slice(0, 2) || 'U')
    .slice(0, 2)
    .toUpperCase()

  async function handleSave() {
    setSaving(true)
    try {
      const activeSigner = signer ?? (await requestSigner())
      // NIP-01 kind-0 convention: `name` is the short username, `display_name`
      // is the longer human label. Keep `name` in sync with displayName when
      // the caller only edits one field, but let the source of truth stay on
      // display_name so zap clients/etc pick up the edit.
      const next = await publishProfile(activeSigner, profile, {
        displayName: displayName.trim() || undefined,
        name: displayName.trim() || profile?.name,
        about: about.trim(),
        picture: picture.trim() || undefined,
        banner: banner.trim() || undefined,
      })
      onPublished(next)
      toast.success('Profile published')
      onOpenChange(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not publish profile'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>Edit profile</DialogTitle>
          <DialogDescription>
            Publishes a signed kind-0 event to the default relays. It may
            take a few seconds for other clients to see the changes.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          {/* Live cover preview + avatar overlap — mirrors the profile page
              layout so users can see the composition before publishing. */}
          <div
            className="relative h-28 w-full bg-gradient-to-br from-primary/30 via-primary/10 to-muted sm:h-36"
            style={
              banner
                ? {
                    backgroundImage: `url("${banner}")`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }
                : undefined
            }
          />
          <div className="relative px-6 pb-6">
            <Avatar className="absolute -top-10 left-6 size-20 ring-4 ring-card">
              {picture && <AvatarImage src={picture} alt={displayName} />}
              <AvatarFallback className="text-lg">{fallback}</AvatarFallback>
            </Avatar>

            <div className="space-y-4 pt-12">
              <div className="space-y-1.5">
                <Label htmlFor="profile-name">Username</Label>
                <Input
                  id="profile-name"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  placeholder="e.g. satoshi"
                  maxLength={64}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="profile-about">About</Label>
                <Textarea
                  id="profile-about"
                  value={about}
                  onChange={e => setAbout(e.target.value)}
                  placeholder="Tell the network about yourself"
                  rows={3}
                  maxLength={500}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="profile-picture">Avatar URL</Label>
                <Input
                  id="profile-picture"
                  value={picture}
                  onChange={e => setPicture(e.target.value)}
                  placeholder="https://…/avatar.png"
                  inputMode="url"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="profile-banner">Cover URL</Label>
                <Input
                  id="profile-banner"
                  value={banner}
                  onChange={e => setBanner(e.target.value)}
                  placeholder="https://…/cover.jpg"
                  inputMode="url"
                />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="border-t px-6 py-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Publishing…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
