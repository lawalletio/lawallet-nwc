'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/components/admin/auth-context'
import { ImageCropDialog } from '@/components/admin/image-crop-dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { useBlossomUpload } from '@/lib/client/hooks/use-blossom-upload'
import type { NostrProfile } from '@/lib/client/nostr-profile'
import { publishProfile } from '@/lib/client/nostr-publish'

interface EditProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  profile: NostrProfile | null
  pubkey: string
  onPublished: (next: NostrProfile) => void
}

// Target resolutions for cropped output. Nostr clients broadly treat
// profile banners as 3:1 (Twitter-style) and avatars as 1:1 squares; these
// numbers match widely-used defaults without making the upload huge.
const BANNER_OUTPUT = { width: 1500, height: 500, aspect: 3 }
const AVATAR_OUTPUT = { width: 512, height: 512, aspect: 1 }

type CropKind = 'banner' | 'avatar'

/**
 * Resolves once the browser has loaded the image at `url`, or rejects on
 * error / timeout. Used to hold the cropped-blob preview on screen until
 * the uploaded Blossom URL is actually decodable, avoiding a brief empty
 * flash when the remote GET is slower than the state update.
 */
function preloadImage(url: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      clearTimeout(timer)
      img.onload = null
      img.onerror = null
      ok ? resolve() : reject(new Error(`preload failed: ${url}`))
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    img.onload = () => finish(true)
    img.onerror = () => finish(false)
    img.src = url
  })
}

export function EditProfileDialog({
  open,
  onOpenChange,
  profile,
  pubkey,
  onPublished,
}: EditProfileDialogProps) {
  const { signer, requestSigner } = useAuth()
  const { upload, progress: uploadProgress, hasServers } = useBlossomUpload()

  const [displayName, setDisplayName] = useState('')
  const [about, setAbout] = useState('')
  const [picture, setPicture] = useState('')
  const [banner, setBanner] = useState('')
  const [saving, setSaving] = useState(false)
  // Track which image is currently uploading so the progress overlay
  // only shows on the one the user is actually replacing (not both).
  const [uploadingKind, setUploadingKind] = useState<CropKind | null>(null)
  // Composite 0–100 for the overlay: the PUT to Blossom drives 0→75 and
  // the preload of the remote URL fills the rest. Keeping it as its own
  // state (rather than deriving from `uploadProgress` on every render)
  // lets us tick smoothly through the preload phase even though the
  // upload hook stops reporting once the PUT resolves.
  const [phaseProgress, setPhaseProgress] = useState(0)

  // Crop pipeline state. `sourceImage` is the data URL from the file
  // picker; `cropKind` tells the modal which aspect ratio + output size
  // to enforce and which field to fill on success.
  const [sourceImage, setSourceImage] = useState<string | null>(null)
  const [cropKind, setCropKind] = useState<CropKind | null>(null)

  const coverInputRef = useRef<HTMLInputElement | null>(null)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)

  // Whenever the upload hook reports progress, scale it into the 0–75 band
  // so the bar *completes* the upload phase at 75% and has room to tick up
  // to 100% during the image preload.
  useEffect(() => {
    if (uploadingKind === null) return
    setPhaseProgress(prev => {
      const scaled = Math.round(uploadProgress * 0.75)
      // Monotonic — don't let an outdated hook tick undo what the preload
      // phase has already advanced the bar to.
      return scaled > prev && prev < 75 ? scaled : prev
    })
  }, [uploadProgress, uploadingKind])

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

  function openPicker(kind: CropKind) {
    if (!hasServers) {
      toast.error('No Blossom servers configured. Add one in Infrastructure settings.')
      return
    }
    const input = kind === 'banner' ? coverInputRef.current : avatarInputRef.current
    input?.click()
  }

  function handleFileSelected(kind: CropKind, file: File | null | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Please pick an image file')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setSourceImage(typeof reader.result === 'string' ? reader.result : null)
      setCropKind(kind)
    }
    reader.onerror = () => toast.error('Could not read file')
    reader.readAsDataURL(file)
  }

  async function handleCropped(blob: Blob) {
    const kind = cropKind
    setCropKind(null)
    setSourceImage(null)
    if (!kind) return
    // Optimistically swap the displayed image to the freshly-cropped blob
    // so the user sees the new composition immediately instead of staring
    // at the old image while the upload runs.
    const objectUrl = URL.createObjectURL(blob)
    if (kind === 'banner') setBanner(objectUrl)
    else setPicture(objectUrl)
    setUploadingKind(kind)
    setPhaseProgress(0)
    let preloadTimer: ReturnType<typeof setInterval> | null = null
    try {
      const filename = `${kind}-${Date.now()}.jpg`
      const file = new File([blob], filename, { type: 'image/jpeg' })
      const { url } = await upload(file)

      // Upload phase done — pin the bar at 75 so the preload phase starts
      // from a stable anchor regardless of where the hook's last tick landed.
      setPhaseProgress(75)

      // Ease from 75 → ~97 over the preload window. We can't drive a real
      // download-progress value without hand-rolling a fetch+ReadableStream
      // (and the returned blob would still need to be re-decoded), so we
      // approximate with a linear tick that the transition smooths into
      // something that feels like a progress bar rather than a jump.
      preloadTimer = setInterval(() => {
        setPhaseProgress(p => (p < 97 ? Math.min(97, p + 2) : p))
      }, 80)

      // Preload the remote image before swapping the src and revoking the
      // blob URL — otherwise the <img>/background would briefly flash empty
      // while the network fetch races the state update. Keep a timeout so
      // a Blossom server that serves the 2xx response but stalls on the
      // GET doesn't strand us on the blob forever.
      await preloadImage(url, 8000).catch(() => {
        // Preload failed or timed out — swap anyway; the image tag's own
        // loader will take over and the user at worst sees a blank frame.
      })

      if (preloadTimer) {
        clearInterval(preloadTimer)
        preloadTimer = null
      }
      setPhaseProgress(100)

      if (kind === 'banner') setBanner(url)
      else setPicture(url)
      toast.success(kind === 'banner' ? 'Cover uploaded' : 'Avatar uploaded')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      toast.error(msg)
    } finally {
      if (preloadTimer) clearInterval(preloadTimer)
      // Let the 100% frame paint for a beat so users see the bar hit the
      // end before the overlay disappears — 250ms is long enough to read,
      // short enough not to feel like lag.
      setTimeout(() => {
        setUploadingKind(null)
        setPhaseProgress(0)
      }, 250)
      // Revoke only after the swap has been applied so React has already
      // painted the new remote URL. A microtask is enough to guarantee
      // the commit has run.
      queueMicrotask(() => URL.revokeObjectURL(objectUrl))
    }
  }

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
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>Edit profile</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto">
            {/* Cover preview with click-to-upload overlay. The whole area
                is a button so any click in the 3:1 band triggers the picker,
                and the hover overlay hints at it without adding chrome. */}
            <button
              type="button"
              onClick={() => openPicker('banner')}
              aria-label="Change cover image"
              className="group relative block h-28 w-full bg-gradient-to-br from-primary/30 via-primary/10 to-muted sm:h-36"
              style={
                banner
                  ? {
                      backgroundImage: `url("${banner}")`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }
                  : undefined
              }
            >
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all duration-200 group-hover:bg-black/50 group-hover:opacity-100 group-focus-visible:bg-black/50 group-focus-visible:opacity-100">
                <span className="flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white">
                  <Camera className="size-4" />
                  Change cover
                </span>
              </span>

              {/* Upload progress overlay — fades in while the banner is
                  being PUT to Blossom so the user has a clear signal the
                  new image is on its way rather than staring at the
                  freshly-cropped blob with no feedback. */}
              {uploadingKind === 'banner' && (
                <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/55 opacity-100 transition-opacity duration-200 animate-in fade-in">
                  <span className="text-xs font-medium text-white">
                    {phaseProgress < 75
                      ? `Uploading cover… ${phaseProgress}%`
                      : phaseProgress < 100
                        ? `Finalizing… ${phaseProgress}%`
                        : `Ready ${phaseProgress}%`}
                  </span>
                  <Progress value={phaseProgress} className="h-1.5 w-2/3 bg-white/20" />
                </span>
              )}
            </button>
            <input
              ref={coverInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => {
                handleFileSelected('banner', e.target.files?.[0])
                // Reset the input so selecting the same file twice still fires change.
                e.target.value = ''
              }}
            />

            <div className="relative px-6 pb-6">
              {/* Avatar with click-to-upload overlay, mirroring the cover. */}
              <button
                type="button"
                onClick={() => openPicker('avatar')}
                aria-label="Change avatar"
                className="group absolute -top-10 left-6 size-20 overflow-hidden rounded-full ring-4 ring-card"
              >
                <Avatar className="size-full">
                  {picture && <AvatarImage src={picture} alt={displayName} />}
                  <AvatarFallback className="text-lg">{fallback}</AvatarFallback>
                </Avatar>
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all duration-200 group-hover:bg-black/50 group-hover:opacity-100 group-focus-visible:bg-black/50 group-focus-visible:opacity-100">
                  <Camera className="size-5 text-white" />
                </span>

                {/* Circular progress overlay mirroring the banner's
                    treatment so both upload paths give the same affordance. */}
                {uploadingKind === 'avatar' && (
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/55 animate-in fade-in">
                    <span className="text-[10px] font-semibold text-white tabular-nums">
                      {phaseProgress}%
                    </span>
                  </span>
                )}
              </button>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => {
                  handleFileSelected('avatar', e.target.files?.[0])
                  e.target.value = ''
                }}
              />

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
              disabled={saving || uploadingKind !== null}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || uploadingKind !== null}>
              {saving ? 'Publishing…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImageCropDialog
        open={!!sourceImage && !!cropKind}
        onOpenChange={o => {
          if (!o) {
            setSourceImage(null)
            setCropKind(null)
          }
        }}
        image={sourceImage}
        aspect={cropKind === 'avatar' ? AVATAR_OUTPUT.aspect : BANNER_OUTPUT.aspect}
        outputWidth={cropKind === 'avatar' ? AVATAR_OUTPUT.width : BANNER_OUTPUT.width}
        outputHeight={cropKind === 'avatar' ? AVATAR_OUTPUT.height : BANNER_OUTPUT.height}
        kind={cropKind ?? 'banner'}
        title={cropKind === 'avatar' ? 'Crop avatar' : 'Crop cover'}
        description={
          cropKind === 'avatar'
            ? 'Saved at 512×512. The visible area is circular.'
            : 'Saved at 1500×500 (3:1).'
        }
        onCropped={handleCropped}
      />
    </>
  )
}
