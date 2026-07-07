'use client'

import { useRef, useState } from 'react'
import { FileArchive, UploadCloud, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function isBackupFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return name.endsWith('.zip') || name.endsWith('.enc') || file.type === 'application/zip'
}

/** Drag-and-drop / picker restricted to `.zip` / `.zip.enc` archives. */
export function FileDropzone({
  file,
  onFile,
  disabled = false,
}: {
  file: File | null
  onFile: (file: File | null) => void
  disabled?: boolean
}) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function accept(candidate: File | undefined | null) {
    if (!candidate) return
    if (!isBackupFile(candidate)) {
      toast.error('Only .zip backup archives are accepted.')
      return
    }
    onFile(candidate)
  }

  if (file) {
    return (
      <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-4 animate-in fade-in zoom-in-95 duration-300">
        <FileArchive className="size-8 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{file.name}</p>
          <p className="text-xs text-muted-foreground">{humanSize(file.size)}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onFile(null)}
          disabled={disabled}
          aria-label="Remove file"
        >
          <X className="size-4" />
        </Button>
      </div>
    )
  }

  return (
    <div
      onDragOver={event => {
        event.preventDefault()
        if (!disabled) setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={event => {
        event.preventDefault()
        setDragging(false)
        if (disabled) return
        accept(event.dataTransfer.files?.[0])
      }}
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors',
        dragging ? 'border-primary bg-primary/10' : 'border-muted-foreground/25',
        disabled && 'pointer-events-none opacity-60',
      )}
    >
      <UploadCloud className={cn('size-10', dragging ? 'text-primary' : 'text-muted-foreground')} />
      <div>
        <p className="text-sm font-medium">Drag & drop your backup here</p>
        <p className="text-xs text-muted-foreground">.zip or .zip.enc, up to 100 MB</p>
      </div>
      <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={disabled}>
        Choose file
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".zip,.enc,application/zip"
        className="hidden"
        onChange={event => accept(event.target.files?.[0])}
      />
    </div>
  )
}
