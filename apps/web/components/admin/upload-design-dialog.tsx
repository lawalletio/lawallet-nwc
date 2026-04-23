'use client'

import React, { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { ImageIcon, UploadCloud, Upload } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { useBlossomUpload } from '@/lib/client/hooks/use-blossom-upload'
import { useDesignMutations } from '@/lib/client/hooks/use-designs'
import { cn } from '@/lib/utils'

const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

function validateImageFile(file: File) {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    toast.error('Only JPG, PNG or WebP files are accepted.')
    return false
  }
  if (file.size > MAX_FILE_SIZE) {
    toast.error('File must be smaller than 2MB.')
    return false
  }
  return true
}

/**
 * Modal that lets the admin upload a new card design. Mirrors the Figma
 * spec (node 3092:2947): a centred icon header, a Name input, and a
 * drag-and-drop area that falls back to a file-picker button. The image
 * goes to Blossom (using the existing `useBlossomUpload` pipeline) and
 * the resulting URL is persisted via `POST /api/card-designs`.
 */
export function UploadDesignDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: () => void
}) {
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const upload = useBlossomUpload()
  const { createDesign, creating } = useDesignMutations()
  const submitting = upload.uploading || creating

  // Revoke any object URL we created for the preview when unmounting or
  // swapping files; otherwise the browser leaks it for the session.
  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  function reset() {
    setName('')
    setFile(null)
    if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setDragging(false)
    upload.reset()
  }

  function handleOpenChange(next: boolean) {
    if (!next && submitting) return // block close while an upload is in flight
    if (!next) reset()
    onOpenChange(next)
  }

  function pickFile(next: File | null) {
    if (!next || !validateImageFile(next)) return
    if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl)
    setFile(next)
    setPreviewUrl(URL.createObjectURL(next))
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.files?.[0] ?? null
    // Reset the input so picking the same file again re-fires onChange.
    e.target.value = ''
    pickFile(next)
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
    const next = e.dataTransfer.files?.[0] ?? null
    pickFile(next)
  }

  async function handleSubmit() {
    if (!name.trim()) {
      toast.error('Design name is required')
      return
    }
    if (!file) {
      toast.error('Please select a design image')
      return
    }
    try {
      const { url } = await upload.upload(file)
      await createDesign({ description: name.trim(), imageUrl: url })
      toast.success('Design uploaded')
      onCreated?.()
      handleOpenChange(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed'
      if (message !== 'Upload aborted') toast.error(message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader className="items-center text-center">
          <div className="mb-2 flex size-10 items-center justify-center rounded-md bg-muted">
            <ImageIcon className="size-5 text-muted-foreground" aria-hidden />
          </div>
          <DialogTitle className="text-2xl">Upload design</DialogTitle>
          <DialogDescription>
            Upload a custom design to personalize your BoltCard. This design
            will be used for printing and visual identification.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="design-name">Name</Label>
            <Input
              id="design-name"
              placeholder="Design Name"
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Card Image</Label>
            <div
              onDragOver={e => {
                e.preventDefault()
                if (!dragging) setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              className={cn(
                'relative flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-6 py-10 text-center transition-colors',
                dragging && 'border-primary bg-primary/10',
                submitting && 'pointer-events-none opacity-80',
              )}
            >
              {previewUrl ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="relative h-28 w-48 overflow-hidden rounded-md bg-background">
                    <Image
                      src={previewUrl}
                      alt={name || 'Design preview'}
                      fill
                      unoptimized
                      className="object-contain"
                    />
                  </div>
                  <p className="max-w-[18rem] truncate text-xs text-muted-foreground">
                    {file?.name}
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex size-10 items-center justify-center rounded-md bg-background">
                    <UploadCloud
                      className="size-5 text-muted-foreground"
                      aria-hidden
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium">
                      Drag and drop your design to upload
                    </p>
                    <p className="text-xs text-muted-foreground">
                      JPG, PNG or WebP. Max size 2mb.
                    </p>
                  </div>
                </>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.webp"
                className="hidden"
                onChange={handleFileInput}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={submitting}
              >
                <Upload className="mr-2 size-4" />
                {previewUrl ? 'Replace' : 'Upload'}
              </Button>

              {upload.uploading && (
                <Progress
                  value={upload.progress}
                  className="absolute bottom-0 left-0 right-0 h-1 rounded-none"
                />
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            variant="theme"
            onClick={handleSubmit}
            disabled={submitting || !name.trim() || !file}
          >
            {submitting ? (
              <>
                <Spinner size={16} className="mr-2" />
                {upload.uploading
                  ? `Uploading… ${upload.progress}%`
                  : 'Saving…'}
              </>
            ) : (
              'Upload'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
