'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  ArrowLeft,
  QrCode,
  Trash2,
  Download,
  Copy,
  Check,
  User,
  Nfc
} from 'lucide-react'
import Link from 'next/link'
import { CardService } from '@/services/card-service'
import { formatDate } from '@/lib/utils'
import { QRCodeSVG } from 'qrcode.react'
import { useSettings } from '@/hooks/use-settings'

export default function CardPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const router = useRouter()
  const [showQRDialog, setShowQRDialog] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const { settings } = useSettings()

  const { id } = React.use(params)
  const card = CardService.get(id)

  if (!card) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" asChild>
            <Link href="/admin/cards">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Cards
            </Link>
          </Button>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <h1 className="text-2xl font-bold text-foreground">
              Card Not Found
            </h1>
            <p className="text-muted-foreground">
              The requested card could not be found.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const handleCopy = async (text: string, type: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(type)
    setTimeout(() => setCopied(null), 2000)
  }

  const handleRemoveCard = () => {
    console.log('Remove card:', card.id)
    setShowDeleteDialog(false)
    router.push('/admin/cards')
  }

  const generateQRPattern = () => {
    const size = 21
    const pattern = []
    for (let i = 0; i < size * size; i++) {
      pattern.push(Math.random() > 0.5)
    }
    return pattern
  }

  const qrUrl = `${settings.domain}/wallet/activate/${card.otc}`
  const status = card.ntag424
    ? card.lastUsedAt
      ? 'active'
      : 'paired'
    : 'unpaired'

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-green-100 text-green-800">Active</Badge>
      case 'paired':
        return <Badge className="bg-blue-100 text-blue-800">Paired</Badge>
      default:
        return <Badge variant="secondary">Unpaired</Badge>
    }
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="icon"
              asChild
              className="h-9 w-9 bg-transparent"
            >
              <Link href="/admin/cards">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {card.title}
              </h1>
              <p className="text-muted-foreground">
                Card details and management
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowQRDialog(true)}>
              <QrCode className="h-4 w-4 mr-2" />
              Print QR
            </Button>
            <Button
              variant="destructive"
              onClick={() => setShowDeleteDialog(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
          </div>
        </div>

        <div className="grid gap-6 grid-cols-1 lg:grid-cols-3">
          <div className="lg:col-span-1 space-y-6">
            <Card>
              <CardContent className="p-4">
                <div className="aspect-[856/540] bg-gradient-to-br from-primary to-blue-400 rounded-md flex items-center justify-center text-primary-foreground font-bold text-lg mb-4 shadow-inner">
                  {card.username}
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Status</span>
                    {getStatusBadge(status)}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Created</span>
                    <span className="text-foreground">
                      {formatDate(card.createdAt)}
                    </span>
                  </div>
                  {card.lastUsedAt && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Last Used</span>
                      <span className="text-foreground">
                        {formatDate(card.lastUsedAt)}
                      </span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5 text-primary" />
                  Basic Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                  <div>
                    <label className="font-medium text-muted-foreground">
                      Card ID
                    </label>
                    <p className="font-mono text-foreground">{card.id}</p>
                  </div>
                  <div>
                    <label className="font-medium text-muted-foreground">
                      Card Title
                    </label>
                    <p className="text-foreground">{card.title}</p>
                  </div>
                </div>
                {card.pubkey && (
                  <div>
                    <label className="font-medium text-muted-foreground">
                      Public Key
                    </label>
                    <p className="font-mono text-foreground break-all">
                      {card.pubkey}
                    </p>
                  </div>
                )}
                {card.otc && (
                  <div>
                    <label className="font-medium text-muted-foreground">
                      OTC
                    </label>
                    <p className="font-mono text-foreground">{card.otc}</p>
                  </div>
                )}
                <div>
                  <label className="font-medium text-muted-foreground">
                    Created At
                  </label>
                  <p className="font-mono text-foreground">
                    {formatDate(card.createdAt)}
                  </p>
                </div>
                {card.lastUsedAt && (
                  <div>
                    <label className="font-medium text-muted-foreground">
                      Last Used At
                    </label>
                    <p className="font-mono text-foreground">
                      {formatDate(card.lastUsedAt)}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {card.ntag424 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Nfc className="h-5 w-5 text-primary" />
                    NTAG424 Chip Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm font-mono">
                  <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                    <div>
                      <label className="font-medium text-muted-foreground">
                        Chip ID (CID)
                      </label>
                      <p className="text-foreground">{card.ntag424.cid}</p>
                    </div>
                    <div>
                      <label className="font-medium text-muted-foreground">
                        Counter
                      </label>
                      <p className="text-foreground">{card.ntag424.ctr}</p>
                    </div>
                  </div>
                  {['k0', 'k1', 'k2', 'k3', 'k4'].map(key => (
                    <div key={key}>
                      <label className="font-medium text-muted-foreground">
                        Key {key.toUpperCase()}
                      </label>
                      <div className="flex items-center gap-2">
                        <p className="text-foreground break-all">
                          {formatDate(
                            card.ntag424![key as keyof typeof card.ntag424]
                          )}
                        </p>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() =>
                            handleCopy(
                              card.ntag424![
                                key as keyof typeof card.ntag424
                              ] as string,
                              key
                            )
                          }
                        >
                          {copied === key ? (
                            <Check className="h-3 w-3 text-green-600" />
                          ) : (
                            <Copy className="h-3 w-3 text-muted-foreground" />
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      <Dialog open={showQRDialog} onOpenChange={setShowQRDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5" />
              Card QR Code
            </DialogTitle>
            <DialogDescription>
              Scan this with a Phone to activate the card
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex justify-center p-4 bg-muted rounded-md">
              <div className="w-64 h-64 bg-white rounded-lg p-2 shadow-md border">
                <QRCodeSVG value={qrUrl} size={240} level="H" />
              </div>
            </div>
            <div className="text-center space-y-1">
              <p className="text-sm font-medium text-foreground">
                Card ID: {card.id}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 bg-transparent"
                onClick={() => handleCopy(qrUrl, 'qr')}
              >
                {copied === 'qr' ? (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-2" />
                    Copy URL
                  </>
                )}
              </Button>
              <Button className="flex-1">
                <Download className="h-4 w-4 mr-2" />
                Download QR
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
    </>
  )
}
