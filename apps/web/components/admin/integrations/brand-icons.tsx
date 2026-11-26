import type { ReactElement, SVGProps } from 'react'
import type { IntegrationId } from '@lawallet-nwc/shared'

type IconProps = SVGProps<SVGSVGElement>

/**
 * Brand marks for the integrations catalog. They render on a white tile
 * (see `IntegrationIcon`), so brand colours are fixed and read the same in
 * every theme. A `Record` over `IntegrationId`: adding an integration without
 * an icon is a compile error.
 *
 * Sources: Vercel + Cloudflare from Simple Icons (CC0); Bull Bitcoin traced
 * from the logo in `lib/integrations/assets/bullbitcoin-logo.ts`; Wapu after
 * its app icon; Gorilla API has no published mark, so it gets a simple one.
 */
export const BRAND_ICONS: Record<
  IntegrationId,
  (p: IconProps) => ReactElement
> = {
  bullbitcoin: p => (
    <svg viewBox="0 0 141 119" {...p}>
      <path
        fill="#B7000B"
        d="M25.4 1.6 18.6 30 46 38 53.6 27 69 32.6V78.6L15 69.6 30 57 1.6 35.6ZM115.2 1.6 122 30 94.6 38 87 27 71.6 32.6V78.6L125.6 69.6 110.6 57 139 35.6ZM39.4 74 69 88V117L54 109 52 98 40 84ZM101.2 74 71.6 88V117L86.6 109 88.6 98 100.6 84Z"
      />
    </svg>
  ),
  wapu: p => (
    <svg viewBox="0 0 24 24" {...p}>
      <path
        fill="#FF4DB8"
        stroke="#0F211B"
        strokeWidth="1.5"
        strokeLinejoin="round"
        d="M1.8 4h4.6l1.9 9.2L10.5 4h3l2.2 9.2L17.6 4h4.6l-4 16h-4.4L12 12.6 10.2 20H5.8Z"
      />
    </svg>
  ),
  alias: p => (
    <svg viewBox="0 0 24 24" {...p}>
      <path
        fill="#1F2937"
        d="M12 2.5c-4.6 0-8 3.2-8 7.8 0 1.2.2 2.3.6 3.3-.9.5-1.6 1.5-1.6 2.7C3 18 4.4 19.4 6.1 19.4c.4 0 .8-.1 1.1-.2C8.6 20.8 10.2 21.5 12 21.5s3.4-.7 4.8-2.3c.3.1.7.2 1.1.2 1.7 0 3.1-1.4 3.1-3.1 0-1.2-.7-2.2-1.6-2.7.4-1 .6-2.1.6-3.3 0-4.6-3.4-7.8-8-7.8Z"
      />
      <path
        fill="#9CA3AF"
        d="M12 9.6c-1.1-.9-4.3-1-4.9.7-.4 1.1.2 2 .3 2.9.1 1.3-1 2.5-.4 4.1.7 1.9 3 2.7 5 2.7s4.3-.8 5-2.7c.6-1.6-.5-2.8-.4-4.1.1-.9.7-1.8.3-2.9-.6-1.7-3.8-1.6-4.9-.7Z"
      />
      <circle cx="9.6" cy="11.6" r="1" fill="#1F2937" />
      <circle cx="14.4" cy="11.6" r="1" fill="#1F2937" />
      <path
        fill="#1F2937"
        d="M10.6 15.1c0-.5.6-.8 1.4-.8s1.4.3 1.4.8-.6.8-1.4.8-1.4-.3-1.4-.8Z"
      />
    </svg>
  ),
  vercel_dns: p => (
    <svg viewBox="0 0 24 24" {...p}>
      <path fill="#000" d="m12 1.608 12 20.784H0Z" />
    </svg>
  ),
  cloudflare_dns: p => (
    <svg viewBox="0 0 24 24" {...p}>
      <path
        fill="#F38020"
        d="M16.5088 16.8447c.1475-.5068.0908-.9707-.1553-1.3154-.2246-.3164-.6045-.499-1.0615-.5205l-8.6592-.1123a.1559.1559 0 0 1-.1333-.0713c-.0283-.042-.0351-.0986-.021-.1553.0278-.084.1123-.1484.2036-.1562l8.7359-.1123c1.0351-.0489 2.1601-.8868 2.5537-1.9136l.499-1.3013c.0215-.0561.0293-.1128.0147-.168-.5625-2.5463-2.835-4.4453-5.5499-4.4453-2.5039 0-4.6284 1.6177-5.3876 3.8614-.4927-.3658-1.1187-.5625-1.794-.499-1.2026.119-2.1665 1.083-2.2861 2.2856-.0283.31-.0069.6128.0635.894C1.5683 13.171 0 14.7754 0 16.752c0 .1748.0142.3515.0352.5273.0141.083.0844.1475.1689.1475h15.9814c.0909 0 .1758-.0645.2032-.1553l.12-.4268zm2.7568-5.5634c-.0771 0-.1611 0-.2383.0112-.0566 0-.1054.0415-.127.0976l-.3378 1.1744c-.1475.5068-.0918.9707.1543 1.3164.2256.3164.6055.498 1.0625.5195l1.8437.1133c.0557 0 .1055.0263.1329.0703.0283.043.0351.1074.0214.1562-.0283.084-.1132.1485-.204.1553l-1.921.1123c-1.041.0488-2.1582.8867-2.5527 1.914l-.1406.3585c-.0283.0713.0215.1416.0986.1416h6.5977c.0771 0 .1474-.0489.169-.126.1122-.4082.1757-.837.1757-1.2803 0-2.6025-2.125-4.727-4.7344-4.727"
      />
    </svg>
  )
}

/** The brand mark on a white rounded tile. Decorative: names sit next to it. */
export function IntegrationIcon({
  id,
  className
}: {
  id: IntegrationId
  className?: string
}) {
  const Icon = BRAND_ICONS[id]
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-black/10 ${className ?? 'size-11 p-2'}`}
    >
      <Icon aria-hidden focusable="false" className="size-full" />
    </div>
  )
}
