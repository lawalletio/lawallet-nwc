'use client'

import { use, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { QrCode, Trash2 } from 'lucide-react'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { DesignImage } from '@/components/admin/design-image'
import { BoltcardQrDialog } from '@/components/admin/boltcard-qr-dialog'
import { PermissionGuard } from '@/components/admin/permission-guard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Permission } from '@/lib/auth/permissions'
import { useCard, useCardMutations } from '@/lib/client/hooks/use-cards'

export default function CardDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const { data: card, loading } = useCard(id)
  const { deleteCard, loading: deleteLoading } = useCardMutations()
  const [qrOpen, setQrOpen] = useState(false)

  async function handleDelete() {
    try {
      await deleteCard(id)
      toast.success('Card deleted')
      router.push('/admin/cards')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete card')
    }
  }

  const isPaired = !!card?.lightningAddress
  const isUsed = card?.ntag424 ? card.ntag424.ctr > 0 : false

  return (
    <div className="flex flex-col">
      <AdminTopbar
        title="Single Card"
        type="subpage"
        onBack={() => router.push('/admin/cards')}
        actions={
          <PermissionGuard permission={Permission.CARDS_WRITE}>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={deleteLoading}
                >
                  <Trash2 className="mr-2 size-4" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this card?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone. The card and its
                    associated NTAG424 keys will be permanently removed.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete}>
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </PermissionGuard>
        }
      />

      <BoltcardQrDialog
        cardId={id}
        open={qrOpen}
        onOpenChange={setQrOpen}
      />

      <div className="p-6 flex flex-col gap-6">
        {loading ? (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-40 w-full rounded-lg" />
            <Skeleton className="h-40 w-full rounded-lg" />
          </div>
        ) : !card ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Card not found</p>
          </div>
        ) : (
          <>
            {/* Card Info */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Card Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Design preview — skeleton → fade-in via the shared
                    `DesignImage`. Rendered only when the card has an
                    associated design so unassigned cards don't show a
                    permanent "No image" block. */}
                {card.design && (
                  <DesignImage
                    src={card.design.image}
                    alt={card.design.description || 'Card design'}
                    className="max-w-sm"
                  />
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <InfoField label="Card ID" value={card.id} mono />
                  <InfoField label="Design" value={card.design?.description || 'None'} />
                  <InfoField
                    label="Status"
                    value={
                      <div className="flex gap-1.5">
                        <Badge variant={isPaired ? 'default' : 'secondary'}>
                          {isPaired ? 'Paired' : 'Unpaired'}
                        </Badge>
                        {isUsed && <Badge variant="outline">Used</Badge>}
                      </div>
                    }
                  />
                  <InfoField
                    label="User"
                    value={card.lightningAddress?.username || 'Not paired'}
                  />
                  <InfoField label="Created" value={new Date(card.createdAt).toLocaleString()} />
                  <InfoField label="Updated" value={new Date(card.updatedAt).toLocaleString()} />
                </div>
              </CardContent>
            </Card>

            {/* NTAG424 Keys (collapsible, sensitive). The BoltCard QR
                belongs here rather than on the topbar — it's the
                hardware-programming affordance paired directly with the
                keys it would write. */}
            {card.ntag424 && (
              <Collapsible>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-2">
                    <CardTitle className="text-base">NTAG424 Keys</CardTitle>
                    <div className="flex items-center gap-2">
                      <PermissionGuard permission={Permission.CARDS_WRITE}>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setQrOpen(true)}
                        >
                          <QrCode className="mr-2 size-4" />
                          BoltCard QR
                        </Button>
                      </PermissionGuard>
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm">
                          Show/Hide
                        </Button>
                      </CollapsibleTrigger>
                    </div>
                  </CardHeader>
                  <CollapsibleContent>
                    <CardContent className="space-y-4">
                      <Separator />
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <InfoField label="K0" value={card.ntag424.k0} mono />
                        <InfoField label="K1" value={card.ntag424.k1} mono />
                        <InfoField label="K2" value={card.ntag424.k2} mono />
                        <InfoField label="K3" value={card.ntag424.k3} mono />
                        <InfoField label="K4" value={card.ntag424.k4} mono />
                        <InfoField label="Counter" value={String(card.ntag424.ctr)} />
                        {card.ntag424.otc && (
                          <InfoField label="OTC" value={card.ntag424.otc} mono />
                        )}
                      </div>
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function InfoField({
  label,
  value,
  mono,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className={mono ? 'font-mono text-sm break-all' : 'text-sm'}>
        {value}
      </div>
    </div>
  )
}
