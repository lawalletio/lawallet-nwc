import type { Metadata } from 'next'
import { ActivateClient } from '@/components/activate/activate-client'

export const metadata: Metadata = {
  title: 'Activate your card',
  robots: { index: false, follow: false }
}

/**
 * `/wallet/activate/[id]` — the wallet-side landing for an activation QR
 * (`qrPayload = <host>/wallet/activate/<tokenId>`). Renders the claim flow: a
 * 3D card preview, inline connect/register for new users, and the activation
 * success animation. All interactive logic lives in the client component; this
 * server wrapper just unwraps the route param.
 *
 * It sits directly under `app/wallet/` rather than the `(app)`/`(auth)` route
 * groups so it stays reachable in either auth state — the client renders the
 * connect/register branch when no wallet is present and the claim + animation
 * once one is.
 */
export default async function ActivatePage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <ActivateClient tokenId={id} />
}
