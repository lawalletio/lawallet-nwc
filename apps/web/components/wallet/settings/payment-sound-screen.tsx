'use client'

import { Check, ChevronLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { NavTabbar } from '@/components/wallet/shared/nav-tabbar'
import { useT } from '@/lib/client/i18n'
import {
  PAYMENT_SOUND_IDS,
  playPaymentSuccessSound,
  setPaymentSound,
  usePaymentSound,
  type PaymentSoundId
} from '@/lib/client/payment-sound'
import { cn } from '@/lib/utils'

export function PaymentSoundScreen() {
  const router = useRouter()
  const selected = usePaymentSound()
  const t = useT()
  const s = t.settings.paymentSoundScreen

  function choose(id: PaymentSoundId) {
    setPaymentSound(id)
    playPaymentSuccessSound(id)
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
          {t.settings.paymentSound}
        </h1>
        <span aria-hidden />
      </header>

      <main className="flex flex-1 flex-col gap-2 px-4 pt-4">
        <h2 className="text-sm font-medium text-muted-foreground">
          {s.successful}
        </h2>
        <div
          role="radiogroup"
          aria-label={s.radioLabel}
          className="flex flex-col overflow-hidden rounded-2xl bg-card"
        >
          {PAYMENT_SOUND_IDS.map((id, index) => {
            const checked = id === selected
            const sound = s.sounds[id]
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => choose(id)}
                className={cn(
                  'flex min-h-14 items-center justify-between gap-3 px-4 py-2 text-left transition-[background-color,transform] duration-200 ease-out hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 active:scale-[0.985] active:bg-accent/90 active:duration-75',
                  index < PAYMENT_SOUND_IDS.length - 1 &&
                    'border-b border-border/40'
                )}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="text-base font-medium text-foreground">
                    {sound.label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {sound.description}
                  </span>
                </span>
                {checked ? (
                  <Check className="size-5 shrink-0 text-foreground" />
                ) : null}
              </button>
            )
          })}
        </div>
      </main>
      <NavTabbar />
    </div>
  )
}
