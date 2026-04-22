'use client'

import React, { useEffect, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * Design image with a pulsing skeleton underlay until the browser reports
 * the image has finished loading. Blossom URLs are external and can take a
 * beat, so a static `bg-muted` looked broken on slow connections. Falls
 * back to a "No image" / "Failed to load" state for missing or erroring
 * sources.
 *
 * Extracted from the cards page so the Create Card dialog's design preview
 * can reuse the exact same loading behaviour — any tweak stays in sync.
 */
export function DesignImage({
  src,
  alt,
  className,
}: {
  src: string | null
  alt: string
  className?: string
}) {
  const [loaded, setLoaded] = useState(false)
  const [errored, setErrored] = useState(false)

  // New src → reset load state so the skeleton reappears (e.g. when the
  // selected design changes, or a design's image is replaced).
  useEffect(() => {
    setLoaded(false)
    setErrored(false)
  }, [src])

  if (!src) {
    return (
      <div
        className={cn(
          'aspect-video rounded-md bg-muted flex items-center justify-center',
          className,
        )}
      >
        <span className="text-sm text-muted-foreground">No image</span>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'relative aspect-video overflow-hidden rounded-md bg-muted',
        className,
      )}
    >
      {!loaded && !errored && (
        <Skeleton className="absolute inset-0 size-full rounded-md" />
      )}
      {errored ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm text-muted-foreground">
            Failed to load image
          </span>
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          onLoad={() => setLoaded(true)}
          onError={() => setErrored(true)}
          className={cn(
            'size-full object-cover transition-opacity duration-200',
            loaded ? 'opacity-100' : 'opacity-0',
          )}
        />
      )}
    </div>
  )
}
