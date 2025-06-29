'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAdmin } from '@/components/admin/admin-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  Plus,
  Search,
  MoreHorizontal,
  Eye,
  QrCode,
  LinkIcon,
  Trash2,
  Nfc
} from 'lucide-react'
import Link from 'next/link'
import { CardService } from '@/services/card-service'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useIsMobile } from '@/components/ui/use-mobile'

export default function CardsPage() {
  const router = useRouter()
  const { auth } = useAdmin()
  const [searchTerm, setSearchTerm] = useState('')
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [cardToDelete, setCardToDelete] = useState<string | null>(null)
  const isMobile = useIsMobile()

  if (!auth) return null

  const cards = CardService.list()
  const filteredCards = cards.filter(
    card =>
      card.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      card.pubkey?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const handleDeleteCard = (cardId: string) => {
    setCardToDelete(cardId)
    setShowDeleteDialog(true)
  }

  const handleRemoveCard = () => {
    if (cardToDelete) {
      console.log('Remove card:', cardToDelete)
      setShowDeleteDialog(false)
      setCardToDelete(null)
    }
  }

  const generateQRPattern = () => {
    const size = 21
    const pattern = []
    for (let i = 0; i < size * size; i++) {
      pattern.push(Math.random() > 0.5)
    }
    return pattern
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Cards
          </h1>
          <p className="text-muted-foreground">
            Manage your BoltCard payment cards
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/cards/new">
            <Plus className="h-4 w-4 mr-2" />
            Create Card
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Cards
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {CardService.count()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Paired Cards
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {CardService.getPairedCards().length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Cards
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {CardService.getUsedCards().length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Unpaired Cards
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {CardService.getUnpairedCards().length}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search cards by title or pubkey..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      {filteredCards.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Nfc className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2 text-foreground">
              No cards found
            </h3>
            <p className="text-muted-foreground mb-4">
              {searchTerm
                ? 'No cards match your search criteria.'
                : "You haven't created any cards yet."}
            </p>
            {!searchTerm && (
              <Button asChild>
                <Link href="/admin/cards/new">
                  <Plus className="h-4 w-4 mr-2" />
                  Create Your First Card
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-6 py-3 text-left font-medium text-muted-foreground">
                    Card
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-muted-foreground">
                    Pubkey
                  </th>
                  {!isMobile && (
                    <th className="px-6 py-3 text-left font-medium text-muted-foreground">
                      Last Used
                    </th>
                  )}
                  <th className="px-6 py-3 text-right font-medium text-muted-foreground">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredCards.map(card => (
                  <tr
                    key={card.id}
                    className="hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => router.push(`/admin/cards/card/${card.id}`)}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-8 bg-gradient-to-br from-primary/80 to-primary/50 rounded flex items-center justify-center flex-shrink-0">
                          <span className="text-primary-foreground text-xs font-bold">
                            {card.username?.charAt(0) || 'C'}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-foreground truncate">
                            {card.username || ''}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge
                              variant={card.ntag424 ? 'default' : 'secondary'}
                              className={
                                card.ntag424 ? 'bg-blue-100 text-blue-800' : ''
                              }
                            >
                              {card.ntag424 ? 'Paired' : 'Unpaired'}
                            </Badge>
                            {!isMobile && (
                              <span className="text-xs text-muted-foreground">
                                {card.createdAt.toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 font-mono text-foreground">
                      {card.pubkey ? (
                        `${card.pubkey.slice(0, 8)}...${card.pubkey.slice(-8)}`
                      ) : (
                        <span className="text-muted-foreground italic">
                          Not linked
                        </span>
                      )}
                    </td>
                    {!isMobile && (
                      <td className="px-6 py-4 text-foreground">
                        {card.lastUsedAt ? (
                          card.lastUsedAt.toLocaleDateString()
                        ) : (
                          <span className="text-muted-foreground italic">
                            Never
                          </span>
                        )}
                      </td>
                    )}
                    <td className="px-6 py-4 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={e => e.stopPropagation()}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={e => {
                              e.stopPropagation()
                              router.push(`/admin/cards/card/${card.id}`)
                            }}
                          >
                            <Eye className="h-4 w-4 mr-2" />
                            Show Card
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <QrCode className="h-4 w-4 mr-2" />
                            Reprint QR
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <LinkIcon className="h-4 w-4 mr-2" />
                            Pair Card
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={e => {
                              e.stopPropagation()
                              handleDeleteCard(card.id)
                            }}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5" />
              Remove Card
            </DialogTitle>
            <DialogDescription>
              Scan this QR code with BoltCard NFC Card Creator to reset the
              card.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex justify-center p-4 bg-muted rounded-md">
              <div className="w-48 h-48 bg-white rounded-lg p-2 shadow-md border">
                <svg viewBox="0 0 21 21" className="w-full h-full">
                  <rect width="21" height="21" fill="white" />
                  {generateQRPattern().map(
                    (f, i) =>
                      f && (
                        <rect
                          key={i}
                          x={i % 21}
                          y={Math.floor(i / 21)}
                          width="1"
                          height="1"
                          fill="black"
                        />
                      )
                  )}
                </svg>
              </div>
            </div>
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 text-left">
              <h4 className="font-medium text-destructive mb-3">
                Reset Steps:
              </h4>
              <ol className="space-y-2 text-sm text-destructive/80">
                {[
                  'Open BoltCard NFC Card Creator',
                  'Open Reset Keys tab',
                  'Scan this QR code',
                  'Hold card in the NFC reader until it finishes',
                  "Click on 'Remove it' button in this modal"
                ].map((step, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="flex-shrink-0 w-5 h-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center text-xs font-bold mt-px">
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 bg-transparent"
                onClick={() => setShowDeleteDialog(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={handleRemoveCard}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Remove it
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
