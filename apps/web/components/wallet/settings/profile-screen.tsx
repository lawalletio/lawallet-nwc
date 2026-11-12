'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, ChevronLeft } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/components/admin/auth-context'
import { useBlossomUpload } from '@/lib/client/hooks/use-blossom-upload'
import { useNostrProfile } from '@/lib/client/nostr-profile'
import { publishProfile } from '@/lib/client/nostr-publish'
import { npubInitials } from '@/lib/client/format'
import { useT } from '@/lib/client/i18n'

/**
 * Wallet profile editor (kind-0). Where email-login signups land first, so
 * it greets profile-less users with a short setup prompt.
 */
export function ProfileScreen() {
  const router = useRouter()
  const t = useT()
  const p = t.settings.profileScreen
  const { pubkey, signer, requestSigner } = useAuth()
  const { profile, loading, updateProfile } = useNostrProfile(pubkey)
  const { upload, progress, uploading } = useBlossomUpload()

  const [name, setName] = useState('')
  const [about, setAbout] = useState('')
  const [picture, setPicture] = useState('')
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  // Hydrate once when the profile first resolves; later refetches must not
  // clobber what the user is typing.
  const hydrated = useRef(false)
  useEffect(() => {
    if (hydrated.current || loading) return
    hydrated.current = true
    setName(profile?.displayName || profile?.name || '')
    setAbout(profile?.about || '')
    setPicture(profile?.picture || '')
  }, [profile, loading])

  const isSetup = !loading && !(profile?.displayName || profile?.name)

  async function handleFile(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error(p.notImage)
      return
    }
    const preview = URL.createObjectURL(file)
    const previous = picture
    setPicture(preview)
    try {
      const { url } = await upload(file)
      setPicture(url)
    } catch (err) {
      setPicture(previous)
      toast.error(err instanceof Error ? err.message : p.uploadFailed)
    } finally {
      URL.revokeObjectURL(preview)
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      const activeSigner = signer ?? (await requestSigner())
      const trimmed = name.trim()
      const next = await publishProfile(activeSigner, profile, {
        displayName: trimmed || undefined,
        name: trimmed || profile?.name,
        about: about.trim(),
        picture: picture.trim() || undefined
      })
      updateProfile(next)
      toast.success(p.saved)
      router.replace(isSetup ? '/wallet' : '/wallet/settings')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : p.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col pb-32">
      <header className="sticky top-0 z-20 grid h-14 grid-cols-3 items-center bg-background/80 px-3 backdrop-blur-xl">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex h-9 w-fit items-center gap-1.5 rounded-full bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          <ChevronLeft className="size-4" />
          {t.common.back}
        </button>
        <h1 className="text-center text-base font-semibold text-foreground">
          {t.settings.profile}
        </h1>
        <span aria-hidden />
      </header>

      <main className="flex flex-1 flex-col gap-6 px-4 pt-6">
        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <Spinner size={24} />
          </div>
        ) : (
          <>
            {isSetup && (
              <div className="animate-fade-in space-y-1 text-center">
                <h2 className="text-xl font-semibold text-foreground">
                  {p.welcomeTitle}
                </h2>
                <p className="text-sm text-muted-foreground">{p.welcomeBody}</p>
              </div>
            )}

            <div className="animate-scale-in flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                aria-label={p.changePhoto}
                className="group relative size-28 overflow-hidden rounded-full ring-4 ring-primary/30 transition-shadow hover:ring-primary/60"
              >
                <Avatar className="size-full">
                  {picture && (
                    <AvatarImage src={picture} alt="" className="object-cover" />
                  )}
                  <AvatarFallback className="text-2xl">
                    {name.trim().slice(0, 2).toUpperCase() || npubInitials(pubkey)}
                  </AvatarFallback>
                </Avatar>
                <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition-all group-hover:bg-black/45 group-hover:opacity-100">
                  <Camera className="size-6" />
                </span>
                {uploading && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-xs font-semibold text-white tabular-nums">
                    {progress}%
                  </span>
                )}
              </button>
              <button
                type="button"
                className="text-sm font-medium text-primary"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? p.uploading(progress) : p.changePhoto}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => {
                  void handleFile(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </div>

            <div className="space-y-4 rounded-2xl bg-card p-4">
              <div className="space-y-1.5">
                <Label htmlFor="profile-name">{p.name}</Label>
                <Input
                  id="profile-name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={p.namePlaceholder}
                  maxLength={64}
                  autoComplete="nickname"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-about">{p.about}</Label>
                <Textarea
                  id="profile-about"
                  value={about}
                  onChange={e => setAbout(e.target.value)}
                  placeholder={p.aboutPlaceholder}
                  rows={3}
                  maxLength={500}
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Button
                variant="theme"
                className="h-12 w-full"
                onClick={handleSave}
                disabled={saving || uploading || !name.trim()}
              >
                {saving ? (
                  <>
                    <Spinner size={16} />
                    {p.saving}
                  </>
                ) : (
                  p.save
                )}
              </Button>
              {isSetup && (
                <Button
                  variant="ghost"
                  className="h-11 w-full"
                  onClick={() => router.replace('/wallet')}
                >
                  {p.skip}
                </Button>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
