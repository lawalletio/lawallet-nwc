'use client'

import type React from 'react'
import { useState } from 'react'

import { Login } from './login'
import { AdminSidebar } from './admin-sidebar'
import { TopNavbar } from './top-navbar'
import { useAPI } from '@/providers/api'

export function AdminWrapper({ children }: { children: React.ReactNode }) {
  const { signer } = useAPI()
  const [sidebarOpen, setSidebarOpen] = useState(false)

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
        <main className="flex-1 p-4 lg:ml-0">{children}</main>
      </div>
    </div>
  )
}
