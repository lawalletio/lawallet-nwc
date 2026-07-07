'use client'

import { type ReactNode, useEffect, useState } from 'react'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'

/**
 * Full-step busy state. Determinate phases (import) drive a real `<Progress>`;
 * network-bound phases (analyze/generate) show an indeterminate shimmer. The
 * status line cycles through `statuses` and is announced via `aria-live`.
 */
export function ProgressScreen({
  title,
  statuses,
  mode,
  value,
  icon,
}: {
  title: string
  statuses: string[]
  mode: 'indeterminate' | 'determinate'
  value?: number
  icon?: ReactNode
}) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (statuses.length <= 1) return
    const id = setInterval(() => setIndex(i => (i + 1) % statuses.length), 1400)
    return () => clearInterval(id)
  }, [statuses.length])

  return (
    <div className="flex flex-col items-center gap-6 py-16 text-center animate-in fade-in duration-300">
      <div className="text-primary">{icon ?? <Spinner size={24} />}</div>
      <h2 className="text-lg font-semibold">{title}</h2>

      {mode === 'determinate' ? (
        <Progress
          value={value ?? 0}
          className="w-64"
          aria-label={`${title} progress`}
        />
      ) : (
        <>
          <div className="relative h-1 w-64 overflow-hidden rounded-full bg-muted motion-reduce:hidden">
            <div className="absolute inset-y-0 w-1/3 rounded-full bg-gradient-to-r from-transparent via-primary to-transparent animate-progress-indeterminate" />
          </div>
          <div className="hidden motion-reduce:block">
            <Spinner size={16} />
          </div>
        </>
      )}

      <p aria-live="polite" className="h-5 text-sm text-muted-foreground">
        <span key={index} className="inline-block animate-in fade-in duration-300">
          {statuses[index]}
        </span>
      </p>
    </div>
  )
}
