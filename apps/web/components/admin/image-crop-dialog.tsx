'use client'

import { useEffect, useRef, useState } from 'react'
import ReactCrop, {
  centerCrop,
  makeAspectCrop,
  type Crop,
  type PixelCrop,
} from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface ImageCropDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Data URL or blob URL of the source image (uncropped). */
  image: string | null
  /**
   * Enforced aspect ratio (width / height). Nostr banners are typically
   * 3:1 and avatars are 1:1 — the caller picks via the `kind` prop so the
   * UI also picks an appropriate output size + circular preview.
   */
  aspect: number
  /** Output pixel dimensions the crop is rescaled to before encoding. */
  outputWidth: number
  outputHeight: number
  /** "avatar" renders a circular crop preview; "banner" stays rectangular. */
  kind: 'avatar' | 'banner'
  onCropped: (blob: Blob) => void
  title?: string
  description?: string
}

/**
 * Modal that crops a user-supplied image to a fixed aspect ratio and emits
 * the result as a JPEG blob. Uses react-image-crop for the interactive
 * selector and a detached canvas for the final encode — the canvas lets us
 * produce a predictable output size regardless of the source resolution.
 */
export function ImageCropDialog({
  open,
  onOpenChange,
  image,
  aspect,
  outputWidth,
  outputHeight,
  kind,
  onCropped,
  title,
  description,
}: ImageCropDialogProps) {
  const [crop, setCrop] = useState<Crop | undefined>()
  const [completed, setCompleted] = useState<PixelCrop | undefined>()
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [busy, setBusy] = useState(false)

  // Reset selection whenever a new source image appears.
  useEffect(() => {
    if (!open) return
    setCrop(undefined)
    setCompleted(undefined)
  }, [open, image])

  function handleImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const { naturalWidth, naturalHeight } = e.currentTarget
    // Seed the selection with a centered aspect-locked crop covering 90% of
    // the shorter dimension, so first-time users see the full intended
    // framing without dragging anything.
    const initial = centerCrop(
      makeAspectCrop({ unit: '%', width: 90 }, aspect, naturalWidth, naturalHeight),
      naturalWidth,
      naturalHeight,
    )
    setCrop(initial)
  }

  async function handleSave() {
    const img = imgRef.current
    if (!img || !completed || completed.width === 0 || completed.height === 0) return
    setBusy(true)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = outputWidth
      canvas.height = outputHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas unsupported in this browser')

      // Map the display-space crop rectangle back to the natural image
      // pixel coordinates so the output isn't blurry when the image is
      // rendered larger or smaller than its source.
      const scaleX = img.naturalWidth / img.width
      const scaleY = img.naturalHeight / img.height

      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(
        img,
        completed.x * scaleX,
        completed.y * scaleY,
        completed.width * scaleX,
        completed.height * scaleY,
        0,
        0,
        outputWidth,
        outputHeight,
      )

      const blob: Blob = await new Promise((resolve, reject) => {
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Canvas encode failed'))), 'image/jpeg', 0.9)
      })
      onCropped(blob)
      onOpenChange(false)
    } catch (err) {
      console.error('crop encode', err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title ?? 'Crop image'}</DialogTitle>
          <DialogDescription>
            {description ??
              `Drag the corners to frame the image. It will be saved at ${outputWidth}×${outputHeight}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto rounded-md bg-muted/30 p-2">
          {image && (
            <ReactCrop
              crop={crop}
              onChange={c => setCrop(c)}
              onComplete={c => setCompleted(c)}
              aspect={aspect}
              circularCrop={kind === 'avatar'}
              keepSelection
              className="mx-auto max-h-[60vh]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                src={image}
                alt=""
                onLoad={handleImageLoad}
                className="max-h-[60vh] w-auto"
              />
            </ReactCrop>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={busy || !completed}>
            {busy ? 'Saving…' : 'Use image'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
