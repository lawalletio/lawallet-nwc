'use client'

import { type ReactNode, useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BrandLogotype } from '@/components/ui/brand-logotype'
import { WizardStepper, type StepperStep } from '@/components/admin/backup/wizard-stepper'

/**
 * Full-screen overlay chrome shared by both wizards: brand + close button, the
 * step indicator, and a scrollable content column. Moves focus to the content
 * on each step change and wires Escape-to-close (guarded while busy).
 */
export function WizardShell({
  steps,
  currentIndex,
  onClose,
  closeDisabled = false,
  children,
}: {
  steps: StepperStep[]
  currentIndex: number
  onClose: () => void
  closeDisabled?: boolean
  children: ReactNode
}) {
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    contentRef.current?.focus()
  }, [currentIndex])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !closeDisabled) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeDisabled, onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background animate-in fade-in duration-300"
      role="dialog"
      aria-modal="true"
    >
      <header className="flex items-center justify-between border-b px-4 py-3 sm:px-6">
        <BrandLogotype width={100} height={24} className="h-6 w-auto" />
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          disabled={closeDisabled}
          aria-label="Close"
        >
          <X className="size-4" />
        </Button>
      </header>

      <div className="mx-auto w-full max-w-2xl px-6 pt-8 sm:pt-10">
        <WizardStepper steps={steps} currentIndex={currentIndex} />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div
          ref={contentRef}
          tabIndex={-1}
          className="mx-auto w-full max-w-2xl px-4 pb-28 pt-8 outline-none sm:px-6 sm:pb-32"
        >
          {children}
        </div>
      </div>
    </div>
  )
}
