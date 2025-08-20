import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Nfc } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNfc } from 'use-nfc-hook'
import { generateHexGroups } from '@/lib/utils'

interface NFCTapCardProps {
  onTap: (uid: string) => void
}

export function NFCTapCard({ onTap }: NFCTapCardProps) {
  const [log, setLog] = useState<string>('')
  const [isNfcEnabled, setIsNfcEnabled] = useState(false)

  const { read, abortReadCtrl } = useNfc()

  useEffect(() => {
    if (!isNfcEnabled) {
      return
    }
    read().then(event => {
      onTap(event.serialNumber)
      setLog(event.serialNumber)
    })

    // return () => {
    //   abortReadCtrl()
    // }
  }, [read, isNfcEnabled, abortReadCtrl, onTap])

  return (
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
          {isNfcEnabled ? 'Scanning...' : 'Ready to Scan NFC Card'}
        </h3>
        <p className="text-gray-500 text-center mb-6">
          {isNfcEnabled ? (
            <span className="inline-flex items-center">
              <svg
                className="animate-spin -ml-1 mr-3 h-5 w-5 text-purple-600"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              Scanning for NFC card...
            </span>
          ) : (
            'Place your NTAG424 card on the NFC reader and tap the button below'
          )}
        </p>

        <p className="text-gray-500 text-center mb-6">{log}</p>

        {!isNfcEnabled && (
          <Button
            onClick={() => setIsNfcEnabled(true)}
            className="bg-purple-600 hover:bg-purple-700 text-white border-0 px-8 py-3"
            size="lg"
          >
            <Nfc className="h-5 w-5 mr-2" />
            Scan Blank NFC Card
          </Button>
        )}

        <Button
          onClick={() => onTap(generateHexGroups(7))}
          className="bg-purple-600 hover:bg-purple-700 text-white border-0 px-8 py-3"
          size="lg"
        >
          <Nfc className="h-5 w-5 mr-2" />
          Simulate NFC Card Scan
        </Button>
      </CardContent>
    </Card>
  )
}
