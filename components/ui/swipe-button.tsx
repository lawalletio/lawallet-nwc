// @figma https://www.figma.com/design/jcjT53BBQ4wx94XwpbEZXl?node-id=3177-6875
'use client'

import * as React from 'react'
import { ChevronsRight, Loader2, Check } from 'lucide-react'

import { cn } from '@/lib/utils'

type SwipeState = 'idle' | 'swiping' | 'loading' | 'done'

interface SwipeButtonProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: string
  activeLabel?: string
  loadingLabel?: string
  onConfirm?: () => void | Promise<void>
  disabled?: boolean
}

const SwipeButton = React.forwardRef<HTMLDivElement, SwipeButtonProps>(
  (
    {
      className,
      label = 'Swipe to Confirm',
      activeLabel = 'Zap it',
      loadingLabel = 'Pending',
      onConfirm,
      disabled = false,
      ...props
    },
    ref
  ) => {
    const [state, setState] = React.useState<SwipeState>('idle')
    const [position, setPosition] = React.useState(0)
    const isDragging = React.useRef(false)

    const containerRef = React.useRef<HTMLDivElement>(null)
    const startXRef = React.useRef(0)
    const containerWidthRef = React.useRef(0)

    const thumbWidth = 52

    const getContainerWidth = () => {
      if (containerRef.current) {
        containerWidthRef.current = containerRef.current.offsetWidth
      }
    }

    const handleDragStart = React.useCallback(
      (clientX: number) => {
        if (disabled || state === 'loading' || state === 'done') return
        startXRef.current = clientX - position
        getContainerWidth()
        isDragging.current = true
        setState('swiping')
      },
      [disabled, state, position]
    )

    const handleDragMove = React.useCallback(
      (clientX: number) => {
        if (!isDragging.current || state !== 'swiping') return
        const delta = clientX - startXRef.current
        const maxPosition = containerWidthRef.current - thumbWidth
        const clampedPosition = Math.max(0, Math.min(delta, maxPosition))
        setPosition(clampedPosition)
      },
      [state]
    )

    const handleDragEnd = React.useCallback(async () => {
      if (!isDragging.current || state !== 'swiping') return
      isDragging.current = false

      const maxPosition = containerWidthRef.current - thumbWidth
      const threshold = maxPosition * 0.7

      if (position >= threshold) {
        setPosition(containerWidthRef.current - thumbWidth)
        setState('loading')
        try {
          await onConfirm?.()
        } finally {
          setState('done')
        }
      } else {
        setPosition(0)
        setState('idle')
      }
    }, [state, position, onConfirm])

    // Touch events
    const handleTouchStart = React.useCallback(
      (e: React.TouchEvent) => {
        handleDragStart(e.touches[0].clientX)
      },
      [handleDragStart]
    )

    const handleTouchMove = React.useCallback(
      (e: React.TouchEvent) => {
        e.preventDefault()
        handleDragMove(e.touches[0].clientX)
      },
      [handleDragMove]
    )

    const handleTouchEnd = React.useCallback(() => {
      handleDragEnd()
    }, [handleDragEnd])

    // Mouse events
    const handleMouseDown = React.useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault()
        handleDragStart(e.clientX)
      },
      [handleDragStart]
    )

    React.useEffect(() => {
      const handleMouseMove = (e: MouseEvent) => {
        handleDragMove(e.clientX)
      }
      const handleMouseUp = () => {
        handleDragEnd()
      }

      if (isDragging.current || state === 'swiping') {
        window.addEventListener('mousemove', handleMouseMove)
        window.addEventListener('mouseup', handleMouseUp)
      }

      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }, [state, handleDragMove, handleDragEnd])

    const progress = containerWidthRef.current
      ? position / (containerWidthRef.current - thumbWidth)
      : 0

    const displayLabel = React.useMemo(() => {
      switch (state) {
        case 'idle':
          return label
        case 'swiping':
          return activeLabel
        case 'loading':
          return loadingLabel
        case 'done':
          return loadingLabel
        default:
          return label
      }
    }, [state, label, activeLabel, loadingLabel])

    const ThumbIcon = React.useMemo(() => {
      switch (state) {
        case 'loading':
          return <Loader2 className="size-5 animate-spin text-neutral-900" />
        case 'done':
          return <Check className="size-5 text-neutral-900" />
        default:
          return <ChevronsRight className="size-5 text-neutral-900" />
      }
    }, [state])

    return (
      <div
        ref={ref}
        className={cn(
          'relative h-[52px] rounded-full border border-border overflow-hidden select-none touch-none',
          disabled && 'opacity-50 cursor-not-allowed',
          className
        )}
        {...props}
      >
        {/* Background */}
        <div
          className={cn(
            'absolute inset-0 transition-colors duration-200',
            state === 'done' ? 'bg-green-900/30' : 'bg-secondary'
          )}
        />

        {/* Progress fill */}
        <div
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-neutral-600 to-neutral-400 transition-none"
          style={{
            width: `${position + thumbWidth}px`,
            opacity: state === 'swiping' ? 0.3 : 0
          }}
        />

        {/* Shimmer animation for idle state */}
        {state === 'idle' && (
          <div className="absolute inset-0 overflow-hidden">
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_2.5s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
          </div>
        )}

        {/* Center text */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span
            className={cn(
              'text-sm font-semibold transition-opacity duration-200',
              state === 'swiping'
                ? 'text-foreground'
                : 'text-muted-foreground'
            )}
            style={{
              opacity: state === 'swiping' ? 1 - progress * 0.5 : 1
            }}
          >
            {displayLabel}
          </span>
        </div>

        {/* Draggable thumb */}
        <div
          ref={containerRef}
          className="absolute inset-0"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div
            className={cn(
              'absolute top-0.5 left-0.5 h-[calc(100%-4px)] w-[48px] flex items-center justify-center rounded-full cursor-grab active:cursor-grabbing',
              'bg-gradient-to-b from-neutral-400 to-neutral-100 border border-neutral-700 shadow-md',
              state !== 'swiping' && 'transition-all duration-300',
              state === 'done' && 'bg-gradient-to-b from-green-400 to-green-300'
            )}
            style={{ transform: `translateX(${position}px)` }}
            onMouseDown={handleMouseDown}
          >
            {ThumbIcon}
          </div>
        </div>
      </div>
    )
  }
)
SwipeButton.displayName = 'SwipeButton'

export { SwipeButton }
export type { SwipeButtonProps, SwipeState }
