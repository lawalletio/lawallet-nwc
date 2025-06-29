'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Search, ArrowLeft, Nfc, QrCode, Check } from 'lucide-react'
import Link from 'next/link'
import { CardDesignService } from '@/services/card-design-service'

type Step = 'design' | 'nfc' | 'qr'

export default function NewCardPage() {
  const router = useRouter()
  const [currentStep, setCurrentStep] = useState<Step>('design')
  const [selectedDesign, setSelectedDesign] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [qrToken, setQrToken] = useState('')
  const [showQRDialog, setShowQRDialog] = useState(false)
  const [isWritingCard, setIsWritingCard] = useState(false)

  const designs = CardDesignService.list()

  const filteredDesigns = designs.filter(design =>
    design.description.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const handleDesignSelect = (designId: string) => {
    setSelectedDesign(designId)
    setCurrentStep('nfc')
  }

  const handleNFCTap = () => {
    // Generate pairing token
    const token = Math.random().toString(36).substr(2, 12)
    setQrToken(token)

    // In a real implementation, this would create the card via API
    console.log('Creating card with design:', selectedDesign)

    setCurrentStep('qr')
    setShowQRDialog(true)
  }

  const handleCardWritten = async () => {
    setIsWritingCard(true)

    // Mock loading for 2 seconds
    await new Promise(resolve => setTimeout(resolve, 2000))

    setShowQRDialog(false)
    setIsWritingCard(false)

    // Navigate to cards list since we can't get the specific card ID
    router.push('/admin/cards')
  }

  // Generate QR code pattern as SVG
  const generateQRPattern = () => {
    const size = 21
    const pattern = []
    for (let i = 0; i < size * size; i++) {
      pattern.push(Math.random() > 0.5)
    }
    return pattern
  }

  const qrPattern = generateQRPattern()

  if (currentStep === 'design') {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="text-gray-600 hover:text-gray-900"
          >
            <Link href="/admin/cards">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Cards
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">
              Create New Card
            </h1>
            <p className="text-gray-600">
              Choose a design for your new BoltCard
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search designs..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-8 border-gray-200 focus:border-purple-500 focus:ring-purple-500 bg-white"
            />
          </div>
        </div>

        {filteredDesigns.length === 0 ? (
          <Card className="border-gray-100 shadow-sm bg-white">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Search className="h-12 w-12 text-gray-400 mb-4" />
              <h3 className="text-lg font-semibold mb-2 text-gray-900">
                No designs found
              </h3>
              <p className="text-gray-500 text-center">
                No designs match your search criteria.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredDesigns.map(design => (
              <Card
                key={design.id}
                className="hover:shadow-lg transition-all duration-300 border-gray-100 bg-white cursor-pointer hover:scale-105"
                onClick={() => handleDesignSelect(design.id)}
              >
                <CardContent className="p-4">
                  <div className="aspect-[856/540] bg-gray-100 rounded-lg overflow-hidden mb-3">
                    <img
                      src={design.imageUrl || '/placeholder.svg'}
                      alt={design.description}
                      className="w-full h-full object-cover"
                      onError={e => {
                        const target = e.target as HTMLImageElement
                        target.src =
                          '/placeholder.svg?height=540&width=856&text=Design+Preview'
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <h3 className="font-semibold text-gray-900 text-sm">
                      {design.description}
                    </h3>
                    <p className="text-xs text-gray-500">ID: {design.id}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (currentStep === 'nfc') {
    // Find the selected design object
    const design = designs.find(d => d.id === selectedDesign)
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">
              Tap Your Card
            </h1>
            <p className="text-gray-600">
              Place your NFC card on the reader to write the configuration
            </p>
          </div>
        </div>

        {/* Show selected design preview */}
        {design && (
          <div className="max-w-md mx-auto mb-6">
            <Card className="border-gray-100 shadow bg-white">
              <CardContent className="flex flex-col items-center p-4">
                <div className="aspect-[856/540] w-full bg-gray-100 rounded-lg overflow-hidden mb-3">
                  <img
                    src={design.imageUrl || '/placeholder.svg'}
                    alt={design.description}
                    className="w-full h-full object-cover"
                    onError={e => {
                      const target = e.target as HTMLImageElement
                      target.src =
                        '/placeholder.svg?height=540&width=856&text=Design+Preview'
                    }}
                  />
                </div>
                <div className="space-y-2 text-center">
                  <h3 className="font-semibold text-gray-900 text-sm">
                    {design.description}
                  </h3>
                  <p className="text-xs text-gray-500">ID: {design.id}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        <div className="max-w-md mx-auto">
          <Card className="border-gray-100 shadow-lg bg-white">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <div className="relative mb-6">
                <div className="w-24 h-24 bg-purple-100 rounded-full flex items-center justify-center">
                  <Nfc className="h-12 w-12 text-purple-600" />
                </div>
                <div className="absolute -top-2 -right-2 w-6 h-6 bg-purple-600 rounded-full flex items-center justify-center animate-pulse">
                  <div className="w-2 h-2 bg-white rounded-full"></div>
                </div>
              </div>

              <h3 className="text-xl font-semibold mb-2 text-gray-900">
                Ready to Write
              </h3>
              <p className="text-gray-500 text-center mb-6">
                Place your NTAG424 card on the NFC reader and tap the button
                below
              </p>

              <Button
                onClick={handleNFCTap}
                className="bg-purple-600 hover:bg-purple-700 text-white border-0 px-8 py-3"
                size="lg"
              >
                <Nfc className="h-5 w-5 mr-2" />
                Tap Card Now
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="text-gray-600 hover:text-gray-900"
          >
            <Link href="/admin/cards">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Cards
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">
              Card Created!
            </h1>
            <p className="text-gray-600">
              Your card has been successfully configured
            </p>
          </div>
        </div>
      </div>

      <Dialog open={showQRDialog} onOpenChange={setShowQRDialog}>
        <DialogContent className="sm:max-w-md bg-white max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-gray-900 flex items-center gap-2">
              <QrCode className="h-5 w-5" />
              Setup QR Code
            </DialogTitle>
            <DialogDescription className="text-gray-600">
              Scan this QR code with BoltCard NFC Card Creator
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex justify-center">
              <div className="w-48 h-48 bg-white rounded-lg p-4 shadow-lg border border-gray-100">
                <svg viewBox="0 0 21 21" className="w-full h-full">
                  {qrPattern.map((filled, index) => {
                    const x = index % 21
                    const y = Math.floor(index / 21)
                    return (
                      <rect
                        key={index}
                        x={x}
                        y={y}
                        width="1"
                        height="1"
                        fill={filled ? '#000000' : '#ffffff'}
                      />
                    )
                  })}
                </svg>
              </div>
            </div>

            <div className="text-center space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-left">
                <h4 className="text-sm font-medium text-blue-900 mb-3">
                  Setup Steps:
                </h4>
                <ol className="space-y-2 text-sm text-blue-800">
                  <li className="flex items-start gap-2">
                    <span className="flex-shrink-0 w-5 h-5 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">
                      1
                    </span>
                    <span>Scan this QR code with the BoltCard app</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex-shrink-0 w-5 h-5 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">
                      2
                    </span>
                    <span>Hold the card near your NFC reader</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex-shrink-0 w-5 h-5 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">
                      3
                    </span>
                    <span>
                      Click &quot;Card Written&quot; in this dialog when
                      complete
                    </span>
                  </li>
                </ol>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 border-gray-300 text-gray-700 hover:bg-gray-50 bg-white"
                onClick={() => setShowQRDialog(false)}
              >
                Close
              </Button>
              <Button
                className="flex-1 bg-green-600 hover:bg-green-700 text-white border-0"
                onClick={handleCardWritten}
                disabled={isWritingCard}
              >
                {isWritingCard ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2" />
                    Writing Card...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Card Written
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
