import type React from "react"
import type { Metadata } from "next"
import { AdminProvider } from "@/components/admin/admin-provider"
import { AdminWrapper } from "@/components/admin/admin-wrapper"

export const metadata: Metadata = {
  title: "Admin Dashboard - BoltCard + NWC",
  description: "Manage your BoltCard + NWC system",
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="light min-h-screen bg-background">
      <AdminProvider>
        <AdminWrapper>{children}</AdminWrapper>
      </AdminProvider>
    </div>
  )
}
