'use client'

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface StepperStep {
  key: string
  label: string
}

/**
 * Segmented step indicator with an animated connector line that fills as the
 * wizard advances. Labels hide on small screens (dots only).
 */
export function WizardStepper({
  steps,
  currentIndex,
}: {
  steps: StepperStep[]
  currentIndex: number
}) {
  const clamped = Math.max(0, Math.min(currentIndex, steps.length - 1))
  const pct = steps.length > 1 ? (clamped / (steps.length - 1)) * 100 : 0

  return (
    <div className="w-full" aria-hidden={false}>
      <div className="relative flex items-center justify-between">
        <div className="absolute inset-x-0 top-4 h-0.5 -translate-y-1/2 bg-muted" aria-hidden />
        <div
          className="absolute left-0 top-4 h-0.5 -translate-y-1/2 bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
          aria-hidden
        />
        {steps.map((step, index) => {
          const done = index < currentIndex
          const active = index === currentIndex
          return (
            <div key={step.key} className="relative z-10 flex flex-col items-center gap-2">
              <div
                className={cn(
                  'flex size-8 items-center justify-center rounded-full border-2 bg-background text-xs font-semibold transition-colors',
                  done && 'border-primary bg-primary text-primary-foreground',
                  active && 'border-primary text-primary animate-pulse-glow motion-reduce:animate-none',
                  !done && !active && 'border-muted text-muted-foreground',
                )}
              >
                {done ? (
                  <Check className="size-4 animate-in zoom-in-50 duration-300 motion-reduce:animate-none" />
                ) : (
                  index + 1
                )}
              </div>
              <span
                className={cn(
                  'hidden text-xs font-medium sm:block',
                  active ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {step.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
