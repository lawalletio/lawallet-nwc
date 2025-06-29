"use client"

import type React from "react"

import { useAdmin } from "./admin-provider"
import { Login } from "./login"
import { AdminSidebar } from "./admin-sidebar"
import { TopNavbar } from "./top-navbar"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"

export function AdminWrapper({ children }: { children: React.ReactNode }) {
  const { auth } = useAdmin()

  // If not authenticated, only show login dialog
  if (!auth) {
    return <Login />
  }

  // If authenticated, show full admin interface
  return (
    <SidebarProvider>
      <AdminSidebar />
      <SidebarInset>
        <TopNavbar />
        <div className="flex flex-1 flex-col gap-4 p-4 bg-gray-50 min-h-screen">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
