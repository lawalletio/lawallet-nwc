import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Check, Copy, QrCode } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'

type LightningAddressQRDialogProps = {
  lightningAddress: string
}

export function LightningAddressQRDialog({
  lightningAddress
}: LightningAddressQRDialogProps) {
  const [showQRCode, setShowQRCode] = useState(false)
  const [copied, setCopied] = useState(false)

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog open={showQRCode} onOpenChange={setShowQRCode}>
      <DialogTrigger asChild>
        <QrCode className="size-5 text-white cursor-pointer hover:text-orange-300" />
      </DialogTrigger>
      <DialogContent className="flex flex-col items-center justify-center gap-10 bg-gray-100 w-[365px]">
        <DialogHeader>
          <DialogTitle>Lightning Address QR Code</DialogTitle>
        </DialogHeader>
        <QRCodeSVG
          value={lightningAddress || ''}
          size={240}
          level="H"
          className=""
        />
        <span
          className="cursor-pointer flex items-center gap-2"
          style={{
            fontSize: `${45 - lightningAddress.length * 0.9}px`
          }}
          onClick={() => copyToClipboard(lightningAddress)}
        >
          {lightningAddress}

          {copied ? (
            <Check className="size-4 text-green-500 cursor-pointer hover:text-green-600" />
          ) : (
            <Copy className="size-4 text-black cursor-pointer hover:text-orange-300" />
          )}
        </span>
      </DialogContent>
    </Dialog>
  )
}
