'use client'

import { useState } from 'react'
import { MailCheck } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface InviteUserDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function InviteUserDialog({ open, onOpenChange }: InviteUserDialogProps) {
  const [value, setValue] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  function handleClose() {
    onOpenChange(false)
    // Reset after animation
    setTimeout(() => {
      setValue('')
      setSent(false)
    }, 200)
  }

  async function handleSend() {
    if (!value.trim()) return
    setLoading(true)
    // TODO: connect to invitation API when available
    await new Promise((r) => setTimeout(r, 500))
    setLoading(false)
    setSent(true)
    toast.success('Invitation sent')
  }

  if (sent) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[400px]">
          <div className="flex flex-col items-center gap-3 text-center py-2">
            <div className="flex size-10 items-center justify-center rounded-md bg-muted">
              <MailCheck className="size-5 text-muted-foreground" />
            </div>
            <DialogTitle className="text-lg font-semibold">
              Invitation successfully send!
            </DialogTitle>
            <DialogDescription>
              The invitation link has been successfully generated and delivered.
            </DialogDescription>
            <Button variant="secondary" className="w-full mt-2" onClick={handleClose}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <div className="flex flex-col items-center gap-3 text-center py-2">
          <div className="flex size-10 items-center justify-center rounded-md bg-muted">
            <MailCheck className="size-5 text-muted-foreground" />
          </div>
          <DialogTitle className="text-lg font-semibold">
            Generate an invitation
          </DialogTitle>
          <DialogDescription>
            Create a secure invitation link to onboard a new member into your community.
          </DialogDescription>
          <Input
            placeholder="Email, npub or NIP-05..."
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-1"
          />
          <div className="flex gap-3 w-full mt-1">
            <Button variant="secondary" className="flex-1" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button className="flex-1" disabled={!value.trim() || loading} onClick={handleSend}>
              {loading ? 'Sending...' : 'Send'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
