import { ActivityDetailScreen } from '@/components/wallet/activity/activity-detail-screen'

export const metadata = { title: 'Transaction - LaWallet' }

export default async function ActivityDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ paymentHash: string }>
  searchParams: Promise<{ from?: string | string[] }>
}) {
  const { paymentHash } = await params
  const query = await searchParams
  const from = Array.isArray(query.from) ? query.from[0] : query.from

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ActivityDetailScreen paymentHash={paymentHash} from={from} />
    </div>
  )
}
