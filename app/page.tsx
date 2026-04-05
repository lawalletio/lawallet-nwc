import { redirect } from 'next/navigation'

const DEFAULT_LANDING_URL = 'https://lawallet.io'

export default function HomePage() {
  const landingUrl = process.env.NEXT_PUBLIC_LAWALLET_LANDING_URL?.trim() || DEFAULT_LANDING_URL

  redirect(landingUrl)
}
