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
import { Settings, AlertTriangle } from 'lucide-react'

export function AdminWrapper({ children }: { children: React.ReactNode }) {
  const { signer } = useAPI()
  const { settings } = useSettings()
  const pathname = usePathname()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const isSystemEnabled = settings?.enabled === 'true'
  const isOnSettingsPage = pathname === '/admin/settings'

  // If not authenticated, only show login dialog
  if (!signer) {
    return <Login />
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
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="ml-4 border-amber-300 text-amber-700 hover:bg-amber-100"
                >
                  <Link href="/admin/settings">
                    <Settings className="h-4 w-4 mr-2" />
                    Go to Settings
                  </Link>
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {children}
        </main>
      </div>
    </div>
  )
}
