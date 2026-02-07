'use client'

import React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Check, Zap, ArrowRight } from 'lucide-react'
import { useScrollAnimation } from './hooks'

export const WaitlistSection = () => {
  const { ref, isVisible } = useScrollAnimation()
  const [email, setEmail] = React.useState('')
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [isSuccess, setIsSuccess] = React.useState(false)
  const [error, setError] = React.useState('')

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault()
    setError('')
    setIsSubmitting(true)

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!email || !emailRegex.test(email)) {
      setError('Please enter a valid email address')
      setIsSubmitting(false)
      return
    }

    try {
      const response = await fetch('/api/waitlist/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })
      const data = await response.json()
      if (data.success) {
        setIsSuccess(true)
        setEmail('')
      } else {
        setError(data.error || 'Subscription failed. Please try again.')
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const resetForm = () => {
    setIsSuccess(false)
    setError('')
    setEmail('')
  }

  if (isSuccess) {
    return (
      <section id="waitlist-section" className="py-20 sm:py-28">
        <div ref={ref} className="max-w-md mx-auto px-4 text-center">
          <div
            className={`rounded-2xl border border-lw-teal/20 bg-lw-teal/5 p-8 backdrop-blur-sm transition-all duration-1000 ${
              isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
            }`}
          >
            <div className="w-14 h-14 bg-lw-teal rounded-full flex items-center justify-center mx-auto mb-5">
              <Check className="h-7 w-7 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-3">You&apos;re in!</h2>
            <p className="text-white/40 mb-6 text-sm">
              We&apos;ll notify you when LaWallet NWC is ready for your community.
            </p>
            <Button
              onClick={resetForm}
              variant="outline"
              size="sm"
              className="border-white/10 text-white/50 hover:bg-white/5 hover:text-white bg-transparent"
            >
              Add another email
            </Button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section id="waitlist-section" className="py-20 sm:py-28">
      <div ref={ref} className="max-w-2xl mx-auto px-4 text-center">
        <Zap
          className={`h-8 w-8 text-lw-gold/40 mx-auto mb-6 transition-all duration-700 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}
        />
        <h2
          className={`text-3xl sm:text-5xl font-bold text-white tracking-tight transition-all duration-1000 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          Give your community
          <br />
          <span className="text-gradient-gold">Lightning addresses</span>
        </h2>
        <p
          className={`mt-4 text-white/30 max-w-md mx-auto transition-all duration-1000 delay-200 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          Get early access. Be the first to deploy Lightning + Nostr for your community or company.
        </p>
        <form
          onSubmit={handleSubmit}
          className={`mt-8 max-w-md mx-auto transition-all duration-1000 delay-400 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          <div className="relative">
            <Input
              type="email"
              placeholder="you@yourdomain.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isSubmitting}
              className={`h-14 pl-5 pr-32 rounded-full bg-white/[0.04] border-white/[0.08] focus:ring-2 focus:ring-lw-gold/30 focus:border-lw-gold/30 text-white placeholder:text-white/20 font-mono text-sm transition-all duration-300 ${
                error ? 'border-lw-coral/40 focus:ring-lw-coral/30' : ''
              } ${isSubmitting ? 'opacity-50' : ''}`}
              aria-label="Email for waitlist"
            />
            <Button
              type="submit"
              disabled={isSubmitting || !email}
              className="absolute top-1.5 right-1.5 h-11 rounded-full px-6 bg-lw-gold hover:bg-lw-gold/90 text-black font-semibold transition-all duration-300 shadow-md shadow-lw-gold/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <div className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-black border-t-transparent" />
                  <span>Joining</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  Join <ArrowRight className="h-3.5 w-3.5" />
                </div>
              )}
            </Button>
          </div>
          {error && (
            <p className="mt-3 text-lw-coral text-xs font-mono animate-fade-in">{error}</p>
          )}
        </form>
      </div>
    </section>
  )
}
