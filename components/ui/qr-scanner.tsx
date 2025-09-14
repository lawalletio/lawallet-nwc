'use client'

import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library'
import { Button } from './button'
import { Dialog, DialogContent } from './dialog'
import { Camera, X, AlertCircle } from 'lucide-react'

interface QRScannerProps {
  onScan: (result: string) => void
  onError?: (error: string) => void
  children?: React.ReactNode
}

export function QRScanner({ onScan, onError, children }: QRScannerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const [isInitializing, setIsInitializing] = useState(false)
  const [error, setError] = useState<string>('')
  const [hasPermission, setHasPermission] = useState<boolean | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const readerRef = useRef<BrowserMultiFormatReader | null>(null)

  useEffect(() => {
    return () => {
      if (readerRef.current) {
        readerRef.current.reset()
        readerRef.current = null
      }
    }
  }, [])

  const checkCameraPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      })
      stream.getTracks().forEach(track => track.stop())
      setHasPermission(true)
      return true
    } catch (err) {
      console.error('Camera permission denied:', err)
      setHasPermission(false)
      setError('Camera permission is required to scan QR codes')
      return false
    }
  }

  const startScanning = async () => {
    if (!videoRef.current) return

    try {
      setIsInitializing(true)
      setIsScanning(false)
      setError('')

      // Check camera permission first
      const hasPermission = await checkCameraPermission()
      if (!hasPermission) {
        setIsInitializing(false)
        return
      }

      // Initialize reader if not exists
      if (!readerRef.current) {
        readerRef.current = new BrowserMultiFormatReader()
      }

      const videoDevices = await navigator.mediaDevices.enumerateDevices()
      const cameras = videoDevices.filter(
        device => device.kind === 'videoinput'
      )

      if (cameras.length === 0) {
        throw new Error('No camera devices found')
      }

      // Prefer back/rear camera for mobile devices
      const selectedDevice =
        cameras.find(
          (device: MediaDeviceInfo) =>
            device.label.toLowerCase().includes('back') ||
            device.label.toLowerCase().includes('rear') ||
            device.label.toLowerCase().includes('environment')
        ) || cameras[0]

      setIsInitializing(false)
      setIsScanning(true)

      readerRef.current.decodeFromVideoDevice(
        selectedDevice.deviceId,
        videoRef.current,
        (result, error) => {
          if (result) {
            const text = result.getText()
            onScan(text)
            handleClose()
          }
          // Only log non-NotFoundException errors to avoid spam
          if (error && !(error instanceof NotFoundException)) {
            console.warn('QR Scanner decode error:', error)
          }
        }
      )
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to start camera'
      setError(errorMessage)
      onError?.(errorMessage)
      setIsInitializing(false)
      setIsScanning(false)
    }
  }

  const handleClose = () => {
    if (readerRef.current) {
      readerRef.current.reset()
    }
    setIsScanning(false)
    setIsInitializing(false)
    setError('')
    setHasPermission(null)
    setIsOpen(false)
  }

  const handleOpen = () => {
    setIsOpen(true)
    // Start scanning after dialog opens with a small delay
    setTimeout(startScanning, 300)
  }

  return (
    <>
      {children ? (
        <div onClick={handleOpen} className="cursor-pointer">
          {children}
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleOpen}
          className="flex items-center gap-2"
        >
          <Camera className="h-4 w-4" />
          Scan QR
        </Button>
      )}

      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="max-w-none w-screen h-screen p-0 m-0 bg-black">
          {/* Header */}
          <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between p-4 bg-black/50">
            <h2 className="text-white text-lg font-semibold">Scan QR Code</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClose}
              className="h-8 w-8 p-0 text-white hover:bg-white/20"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Video container */}
          <div className="relative w-full h-full">
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              playsInline
              muted
              autoPlay
            />

            {/* Scanning overlay */}
            {isScanning && (
              <div className="absolute inset-0">
                {/* Dark overlay with transparent center */}
                <div className="absolute inset-0 bg-black/50">
                  <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-[100%]">
                    <div className="w-64 h-64 border-2 border-white rounded-lg relative">
                      {/* Corner indicators */}
                      <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-primary rounded-tl-lg"></div>
                      <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-primary rounded-tr-lg"></div>
                      <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-primary rounded-bl-lg"></div>
                      <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-primary rounded-br-lg"></div>

                      {/* Scanning line animation */}
                      <div className="absolute inset-x-0 top-0 h-0.5 bg-primary animate-pulse"></div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Loading state */}
            {(isInitializing || (!isScanning && !error)) && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                <div className="text-white text-center">
                  <Camera className="h-16 w-16 mx-auto mb-4 animate-pulse" />
                  <p className="text-lg">
                    {isInitializing
                      ? 'Initializing camera...'
                      : 'Starting camera...'}
                  </p>
                </div>
              </div>
            )}

            {/* Error state */}
            {error && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                <div className="text-white text-center max-w-sm mx-4">
                  <AlertCircle className="h-16 w-16 mx-auto mb-4 text-destructive" />
                  <p className="text-lg mb-4">Camera Error</p>
                  <p className="text-sm mb-6 text-gray-300">{error}</p>
                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      onClick={handleClose}
                      className="flex-1 bg-white/10 border-white/20 text-white hover:bg-white/20"
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={startScanning}
                      className="flex-1"
                      disabled={isInitializing}
                    >
                      Try Again
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Bottom instructions */}
          {isScanning && (
            <div className="absolute bottom-0 left-0 right-0 p-6 bg-black/50">
              <p className="text-white text-center text-sm">
                Position the QR code within the frame to scan
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
