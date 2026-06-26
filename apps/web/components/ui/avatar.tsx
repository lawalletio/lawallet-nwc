// @figma https://www.figma.com/design/jcjT53BBQ4wx94XwpbEZXl?node-id=3030-584
'use client'

import * as React from 'react'
import * as AvatarPrimitive from '@radix-ui/react-avatar'

import { cn } from '@/lib/utils'

const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn(
      'relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full',
      className
    )}
    {...props}
  />
))
Avatar.displayName = AvatarPrimitive.Root.displayName

const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image
    ref={ref}
    className={cn('aspect-square h-full w-full', className)}
    {...props}
  />
))
AvatarImage.displayName = AvatarPrimitive.Image.displayName

/**
 * Deterministic hue (0–359) from the monogram letters, so the same identity
 * always gets the same color — like a stable colored-initials avatar.
 */
function hueFromString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) % 360
  }
  return hash
}

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, children, style, ...props }, ref) => {
  // No avatar → a per-identity diagonal gradient (two related hues for depth)
  // instead of a flat grey, with crisp monogram letters on top.
  const seed = typeof children === 'string' ? children : ''
  const hue = hueFromString(seed)
  const gradient = `linear-gradient(135deg, hsl(${hue} 68% 52%), hsl(${(hue + 42) % 360} 70% 38%))`
  return (
    <AvatarPrimitive.Fallback
      ref={ref}
      className={cn(
        // `select-none` keeps the initials non-selectable — they're decorative,
        // not content. Letters: bold, slightly tracked, white with a soft
        // shadow so they read on any hue.
        'flex h-full w-full items-center justify-center rounded-full select-none font-semibold uppercase tracking-wide text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.35)]',
        className
      )}
      style={{ backgroundImage: gradient, ...style }}
      {...props}
    >
      {children}
    </AvatarPrimitive.Fallback>
  )
})
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName

export { Avatar, AvatarImage, AvatarFallback }
