'use client'

import React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog'
import { Check, Zap } from 'lucide-react'

export const DemoModal = ({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  demoType: 'admin' | 'wallet'
}) => {
  const [contact, setContact] = React.useState('')
  const [submitted, setSubmitted] = React.useState(false)

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault()
    if (!contact.trim()) return
    try {
      await fetch('/api/waitlist/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: contact, source: 'demo' })
      })
    } catch {
      // silent fail
    }
    setSubmitted(true)
  }

  const handleClose = (value: boolean) => {
    onOpenChange(value)
    if (!value) {
      setTimeout(() => {
        setContact('')
        setSubmitted(false)
      }, 300)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-lw-dark/95 backdrop-blur-xl border-white/[0.08] text-white max-w-md rounded-2xl overflow-hidden p-0">
        {/* Top gradient accent */}
        <div className="h-1 w-full bg-gradient-to-r from-lw-gold via-nwc-purple to-lw-teal" />

        <div className="relative px-8 pt-8 pb-8">
          {/* Background glow */}
          <div className="absolute -top-10 left-1/2 -translate-x-1/2 w-40 h-40 bg-nwc-purple/10 blur-[80px] rounded-full pointer-events-none" />

          <DialogHeader className="text-center sm:text-center relative">
            {/* Nostr ostrich */}
            <div className="mx-auto mb-4 w-16 h-16 rounded-2xl bg-gradient-to-br from-nwc-purple/20 to-nwc-purple/5 border border-nwc-purple/20 flex items-center justify-center">
              <img src="/logos/nostr-ostrich.svg" alt="Nostr" className="w-10 h-10" />
            </div>
            <DialogTitle className="text-2xl font-bold text-white text-center tracking-tight">
              Be the first to try it out
            </DialogTitle>
            <DialogDescription className="text-white/40 text-center mt-2 text-sm leading-relaxed">
              We&apos;re building something special. Drop your email or Nostr address and get early access.
            </DialogDescription>
          </DialogHeader>

          {submitted ? (
            <div className="text-center py-6 mt-4">
              <div className="w-14 h-14 rounded-full bg-lw-teal/10 border border-lw-teal/20 flex items-center justify-center mx-auto mb-4">
                <Check className="h-7 w-7 text-lw-teal" />
              </div>
              <p className="text-base font-semibold text-white mb-1">You&apos;re in!</p>
              <p className="text-sm text-white/30">We&apos;ll reach out soon.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 mt-6">
              <div className="relative">
                <Input
                  type="text"
                  placeholder="Email, npub or NIP-05..."
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  className="h-13 pl-4 pr-4 rounded-xl bg-white/[0.05] border-white/[0.08] text-white placeholder:text-white/20 font-mono text-sm focus:ring-2 focus:ring-nwc-purple/30 focus:border-nwc-purple/30 transition-all duration-300"
                />
              </div>
              <Button
                type="submit"
                disabled={!contact.trim()}
                className="w-full h-12 rounded-xl font-semibold transition-all duration-300 shadow-lg bg-gradient-to-r from-lw-gold to-lw-gold/90 text-black shadow-lw-gold/10 hover:shadow-lw-gold/20 hover:from-lw-gold hover:to-lw-gold disabled:from-white/[0.06] disabled:to-white/[0.06] disabled:text-white/20 disabled:shadow-none disabled:cursor-not-allowed"
              >
                Count me in
                <Zap className="ml-2 h-4 w-4" />
              </Button>
              <p className="text-center text-[11px] text-white/15 font-mono">
                Nostr-friendly. We respect your sovereignty.
              </p>
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
