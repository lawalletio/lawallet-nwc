'use client'

import type React from 'react'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { Login } from './login'
import { AdminSidebar } from './admin-sidebar'
import { TopNavbar } from './top-navbar'
import { useAPI } from '@/providers/api'
import { useSettings } from '@/hooks/use-settings'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Settings, AlertTriangle, Shield, Copy, Check } from 'lucide-react'

export function AdminWrapper({ children }: { children: React.ReactNode }) {
  const { signer, publicKey, post } = useAPI()
  const { settings, isLoading } = useSettings()
  const pathname = usePathname()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showActivateModal, setShowActivateModal] = useState(false)
  const [activationStep, setActivationStep] = useState<
    'explain' | 'confirm' | 'loading' | 'success' | 'error'
  >('explain')
  const [error, setError] = useState<string | null>(null)
  const [pubkeyCopied, setPubkeyCopied] = useState(false)

  const isSystemEnabled = settings?.enabled === 'true'
  const isOnSettingsPage = pathname === '/admin/settings'

  // If not authenticated, only show login dialog
  if (!signer) {
    return <Login />
  }

  if (isLoading) {
    return <div>Loading...</div>
  }

  const handleActivateSystem = async () => {
    setActivationStep('loading')
    setError(null)

    try {
      const response = await post('/api/root/assign')

      if (response.error) {
        setError(response.error)
        setActivationStep('error')
      } else {
        setActivationStep('success')
        // Optionally refresh settings or redirect
        setTimeout(() => {
          setShowActivateModal(false)
          setActivationStep('explain')
        }, 2000)
      }
    } catch (err) {
      setError('Failed to assign admin role')
      setActivationStep('error')
    }
  }

  const copyPubkey = async () => {
    if (publicKey) {
      await navigator.clipboard.writeText(publicKey)
      setPubkeyCopied(true)
      setTimeout(() => setPubkeyCopied(false), 2000)
    }
  }

  const renderModalContent = () => {
    switch (activationStep) {
      case 'explain':
        return (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-blue-600" />
                Activate System
              </DialogTitle>
              <DialogDescription className="space-y-3">
                <p>
                  To activate the LaWallet NWC system, you need to assign your
                  current public key as an admin.
                </p>
                <p className="text-sm text-muted-foreground">
                  This will give you administrative privileges to manage the
                  system, users, and settings.
                </p>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-sm font-medium text-blue-800 mb-2">
                    What happens next:
                  </p>
                  <ul className="text-sm text-blue-700 space-y-1">
                    <li>• Your public key will be registered as an admin</li>
                    <li>• You&apos;ll have full access to admin features</li>
                    <li>• You can manage system settings and other users</li>
                  </ul>
                </div>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowActivateModal(false)}
              >
                Cancel
              </Button>
              <Button onClick={() => setActivationStep('confirm')}>
                Continue
              </Button>
            </DialogFooter>
          </>
        )

      case 'confirm':
        return (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-blue-600" />
                Confirm Admin Assignment
              </DialogTitle>
              <DialogDescription className="space-y-3">
                <p>Your public key will be assigned admin privileges:</p>
                <div className="bg-gray-50 border rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <code className="text-sm font-mono text-gray-800 truncate mr-2">
                      {publicKey}
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={copyPubkey}
                      className="flex-shrink-0"
                    >
                      {pubkeyCopied ? (
                        <Check className="h-4 w-4 text-green-600" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
                <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded p-2">
                  ⚠️ Make sure you have secure access to this key. Admin
                  privileges cannot be easily revoked.
                </p>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setActivationStep('explain')}
              >
                Back
              </Button>
              <Button onClick={handleActivateSystem}>Assign Admin Role</Button>
            </DialogFooter>
          </>
        )

      case 'loading':
        return (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-blue-600" />
                Assigning Admin Role...
              </DialogTitle>
              <DialogDescription>
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
                <p className="text-center text-sm text-muted-foreground">
                  Please wait while we assign admin privileges to your account.
                </p>
              </DialogDescription>
            </DialogHeader>
          </>
        )

      case 'success':
        return (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Check className="h-5 w-5 text-green-600" />
                Admin Role Assigned!
              </DialogTitle>
              <DialogDescription>
                <div className="text-center py-4">
                  <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                    <Check className="h-8 w-8 text-green-600" />
                  </div>
                  <p>
                    You now have admin privileges for the LaWallet NWC system.
                  </p>
                  <p className="text-sm text-muted-foreground mt-2">
                    You can now configure system settings and manage users.
                  </p>
                </div>
              </DialogDescription>
            </DialogHeader>
          </>
        )

      case 'error':
        return (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-600" />
                Assignment Failed
              </DialogTitle>
              <DialogDescription>
                <div className="text-center py-4">
                  <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
                    <AlertTriangle className="h-8 w-8 text-red-600" />
                  </div>
                  <p className="text-red-600 mb-2">{error}</p>
                  <p className="text-sm text-muted-foreground">
                    Please try again or contact support if the problem persists.
                  </p>
                </div>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowActivateModal(false)}
              >
                Cancel
              </Button>
              <Button onClick={() => setActivationStep('explain')}>
                Try Again
              </Button>
            </DialogFooter>
          </>
        )

      default:
        return null
    }
  }

  // If authenticated, show full admin interface with navbar on top
  return (
    <div className="min-h-screen bg-gray-50">
      <TopNavbar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />
      <div className="flex">
        <AdminSidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />

        <main className="flex-1 p-4 lg:ml-0">
          {/* System Disabled Alert */}
          {!isSystemEnabled && !isOnSettingsPage && (
            <Alert className="mb-6 border-amber-200 bg-amber-50 flex items-center justify-between">
              <AlertDescription className="flex justify-between w-full">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <strong className="text-amber-800">System Disabled:</strong>
                  <span className="text-amber-700 ml-2">
                    The LaWallet NWC system is currently disabled. Please
                    configure and enable it in settings.
                  </span>
                </div>
                <div className="flex gap-2">
                  {!settings.root && (
                    <Dialog
                      open={showActivateModal}
                      onOpenChange={setShowActivateModal}
                    >
                      <DialogTrigger asChild>
                        <Button
                          variant="default"
                          size="sm"
                          className="bg-blue-600 hover:bg-blue-700 text-white"
                        >
                          <Shield className="h-4 w-4 mr-2" />
                          Activate
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-[900px] w-auto">
                        {renderModalContent()}
                      </DialogContent>
                    </Dialog>
                  )}

                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="border-amber-300 text-amber-700 hover:bg-amber-100"
                  >
                    <Link href="/admin/settings">
                      <Settings className="h-4 w-4 mr-2" />
                      Settings
                    </Link>
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {children}
        </main>
      </div>
    </div>
  )
}
