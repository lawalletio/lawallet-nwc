import { useId } from 'react'
import { cn } from '@/lib/utils'

/** [points, lightness %] — faceted head/neck/shoulders lit from the top-left. */
const HEAD: [string, number][] = [
  ['32,12 23,16 32,26', 82],
  ['32,12 41,16 32,26', 74],
  ['23,16 20,26 32,26', 76],
  ['41,16 44,26 32,26', 64],
  ['20,26 24,36 32,26', 68],
  ['44,26 40,36 32,26', 56],
  ['24,36 32,41 32,26', 62],
  ['40,36 32,41 32,26', 52]
]
const NECK: [string, number][] = [
  ['27,38 32,41 32,47 26,45', 50],
  ['37,38 32,41 32,47 38,45', 42]
]
const SHOULDERS: [string, number][] = [
  ['8,64 15,51 26,45 32,64', 60],
  ['26,45 32,47 32,64', 54],
  ['38,45 32,47 32,64', 47],
  ['56,64 49,51 38,45 32,64', 40]
]

/**
 * Placeholder person for any avatar without a picture: a low-poly face whose
 * tint is derived from `hue`, so different identities stay distinguishable.
 * Pure SVG — scales to any avatar size.
 */
export function LowPolyAvatar({
  hue = 210,
  className
}: {
  hue?: number
  className?: string
}) {
  const facet = (l: number) => `hsl(${hue} 32% ${l}%)`
  // Unique per instance: a shared id breaks when the first copy is hidden.
  const id = `lpa-bg-${useId().replace(/:/g, '')}`
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden
      data-avatar-placeholder=""
      className={cn('size-full', className)}
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={`hsl(${hue} 45% 30%)`} />
          <stop offset="1" stopColor={`hsl(${(hue + 30) % 360} 50% 14%)`} />
        </linearGradient>
      </defs>
      <rect width="64" height="64" fill={`url(#${id})`} />
      {[...SHOULDERS, ...NECK, ...HEAD].map(([points, l]) => (
        <polygon
          key={points}
          points={points}
          fill={facet(l)}
          stroke={facet(l)}
          strokeWidth="0.4"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  )
}
