'use client'

import * as React from 'react'
import Image from 'next/image'
import { Skeleton } from '@/components/ui/skeleton'
import { useBrandLogotypes } from '@/lib/client/hooks/use-brand'
import { cn } from '@/lib/utils'

/**
 * Renders the community's configured logotype (from `/api/settings`) with a
 * skeleton while that fetch is in flight. Centralising the skeleton here
 * means every brand-bearing surface (admin topbar, sidebar, login page,
 * landing nav, wallet shell) can't accidentally flash the static LaWallet
 * fallback for communities that *do* have a custom logo uploaded.
 *
 * Props mirror the relevant subset of next/image: caller supplies the
 * container dimensions (width/height) used for both the skeleton and the
 * image. Any extra className is forwarded to the image (useful for things
 * like `h-6 w-auto` that Next.js warns about unless the aspect-ratio is
 * managed by the caller).
 */
export interface BrandLogotypeProps {
  width: number
  height: number
  alt?: string
  className?: string
  priority?: boolean
}

export function BrandLogotype({
  width,
  height,
  alt = 'LaWallet',
  className,
  priority,
}: BrandLogotypeProps) {
  const { logotype, loading } = useBrandLogotypes()

  if (loading) {
    return (
      <Skeleton
        style={{ width, height }}
        aria-label="Loading brand logo"
      />
    )
  }

  return (
    <Image
      src={logotype}
      alt={alt}
      width={width}
      height={height}
      unoptimized
      priority={priority}
      className={cn(className)}
    />
  )
}
