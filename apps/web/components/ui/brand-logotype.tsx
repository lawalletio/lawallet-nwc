'use client'

import * as React from 'react'
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
 * Props mirror the legacy next/image callsites: `width`/`height` size the
 * skeleton and cap the rendered image. We render a plain `<img>` because the
 * actual source is an external Blossom URL — next/image's optimizer is
 * bypassed anyway (we were passing `unoptimized`) and its aspect-ratio check
 * fires a console warning when the declared props don't match the uploaded
 * asset's real ratio. A plain `<img>` with `object-contain` sizes correctly
 * regardless of the underlying PNG's dimensions.
 */
export interface BrandLogotypeProps {
  width: number
  height: number
  alt?: string
  className?: string
  /** Retained for API parity with prior call-sites; no-op with a plain img. */
  priority?: boolean
}

export function BrandLogotype({
  width,
  height,
  alt = 'LaWallet',
  className,
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
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logotype}
      alt={alt}
      style={{ maxWidth: width, maxHeight: height }}
      className={cn('object-contain', className)}
    />
  )
}
