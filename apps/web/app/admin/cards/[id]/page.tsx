'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { QrCode, Ticket, Trash2 } from 'lucide-react'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { Card3D } from '@/components/activate/card-3d'
import { BoltcardQrDialog } from '@/components/admin/boltcard-qr-dialog'
import { CardActivationDialog } from '@/components/admin/card-activation-dialog'
import { CardWipeDialog } from '@/components/admin/card-wipe-dialog'
import { PermissionGuard } from '@/components/admin/permission-guard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Permission } from '@/lib/auth/permissions'
import { useCard, useCardMutations } from '@/lib/client/hooks/use-cards'
import { invalidateApiPath } from '@/lib/client/hooks/use-api'
import { truncateNpub } from '@/lib/client/format'
import { trackEvent } from '@/lib/analytics/gtag'
import { AnalyticsEvent } from '@/lib/analytics/events'

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
  const [activationOpen, setActivationOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  async function handleDelete() {
    try {
      await deleteCard(id)
      trackEvent(AnalyticsEvent.CARD_DELETED)
      toast.success('Card deleted')
      // Drop the cached list/counts so /admin/cards mounts on fresh data
      // instead of painting the just-deleted card for a frame. The SSE
      // `cards:updated` event refetches any *already-open* list tab; this
      // covers the navigate-back-after-delete path the redirect takes.
      invalidateApiPath('/api/cards')
      invalidateApiPath('/api/cards/counts')
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
        title={card?.design?.description || 'Single Card'}
        type="subpage"
        onBack={() => router.push('/admin/cards')}
      />

      <BoltcardQrDialog
        cardId={id}
        open={qrOpen}
        onOpenChange={setQrOpen}
      />

      <CardActivationDialog
        cardId={id}
        open={activationOpen}
        onOpenChange={setActivationOpen}
      />

      {/* Delete flow. When the card has an NTAG424, surface the BoltCard reset
          QR first so the operator can wipe (and thereby unpair) the physical
          card before the record is gone. Keys are fetched from /wipe on demand,
          not carried in the card data. */}
      {card?.ntag424 ? (
        <CardWipeDialog
          cardId={id}
          uid={card.ntag424.cid}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          onConfirmDelete={handleDelete}
          deleting={deleteLoading}
        />
      ) : (
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this card?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. The card will be permanently
                removed.
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
      )}

      <div className="px-4 py-6 sm:px-6 flex flex-col gap-6">
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
                {/* Design preview — a floating 3D card (perspective + bob +
                    sway, always front-facing) reused from the activation flow.
                    Rendered only when the card has an associated design so
                    unassigned cards don't show an empty stage. */}
                {card.design && (
                  <div className="flex justify-center py-4">
                    <Card3D imageUrl={card.design.image} />
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <InfoField label="Card ID" value={card.id} mono />
                  <InfoField
                    label="Design"
                    value={
                      card.design ? (
                        <Link
                          href={`/admin/card-designs/${card.design.id}`}
                          className="text-primary hover:underline"
                        >
                          {card.design.description || 'Untitled'}
                        </Link>
                      ) : (
                        'None'
                      )
                    }
                  />
                  <InfoField
                    label="Status"
                    value={
                      <div className="flex gap-1.5">
                        <Badge
                          variant={
                            card?.blocked
                              ? 'destructive'
                              : isPaired
                                ? 'default'
                                : 'secondary'
                          }
                        >
                          {card?.blocked
                            ? 'Blocked'
                            : isPaired
                              ? 'Paired'
                              : 'Unpaired'}
                        </Badge>
                        {isUsed && <Badge variant="outline">Used</Badge>}
                      </div>
                    }
                  />
                  <InfoField
                    label="User"
                    value={
                      card.lightningAddress
                        ? card.lightningAddress.username ||
                          truncateNpub(card.lightningAddress.pubkey)
                        : 'Not paired'
                    }
                  />
                  <InfoField label="Created" value={new Date(card.createdAt).toLocaleString()} />
                  <InfoField label="Updated" value={new Date(card.updatedAt).toLocaleString()} />
                </div>
              </CardContent>
            </Card>

            {/* Activation. Mints a one-time activation link/QR the cardholder
                scans to claim the card. Operator-only; unavailable once the
                card is blocked (the mint route 409s). */}
            <PermissionGuard permission={Permission.CARDS_WRITE}>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <CardTitle className="text-base">Activation</CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={card.blocked}
                    onClick={() => setActivationOpen(true)}
                  >
                    <Ticket className="mr-2 size-4" />
                    Activation URL
                  </Button>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">
                    {card.blocked
                      ? 'This card is blocked and can no longer be activated.'
                      : 'Generate a one-time link or QR. The cardholder scans it with their wallet to claim this card and link it to their account.'}
                  </p>
                </CardContent>
              </Card>
            </PermissionGuard>

            {/* Card chip (NTAG424). Keys are never shown here — they only ever
                leave the server when the card is (re)programmed or reset, via
                the BoltCard QR (`/write`) or the Delete → Reset flow (`/wipe`),
                both of which unpair the card. */}
            {card.ntag424 && (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <CardTitle className="text-base">Card chip (NTAG424)</CardTitle>
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
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <InfoField label="UID" value={card.ntag424.cid} mono />
                    <InfoField label="Counter" value={String(card.ntag424.ctr)} />
                    {card.ntag424.otc && (
                      <InfoField label="OTC" value={card.ntag424.otc} mono />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Keys are never displayed. Programming the card (BoltCard QR)
                    or resetting it (Delete → Reset) exports the keys and unpairs
                    the card from its user.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Danger zone — destructive, irreversible actions, isolated at the
                bottom of the page behind a destructive-tinted card and a confirm
                dialog (the BoltCard reset flow for chipped cards). */}
            <PermissionGuard permission={Permission.CARDS_WRITE}>
              <Card className="border-destructive/50">
                <CardHeader>
                  <CardTitle className="text-base text-destructive">
                    Danger zone
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-muted-foreground">
                    Permanently delete this card. This action cannot be undone.
                    {card.ntag424 &&
                      ' Reset the physical card first to export its keys and unpair it from its user.'}
                  </p>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={deleteLoading}
                    onClick={() => setDeleteOpen(true)}
                    className="shrink-0"
                  >
                    <Trash2 className="mr-2 size-4" />
                    Delete card
                  </Button>
                </CardContent>
              </Card>
            </PermissionGuard>
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
