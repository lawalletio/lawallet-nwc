"use client"

import { CreditCard, Palette, Zap, Settings, Home, X } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useAdmin } from "./admin-provider"
import { Button } from "@/components/ui/button"
import { useEffect } from "react"

const menuItems = [
  { title: "Dashboard", url: "/admin", icon: Home },
  { title: "Cards", url: "/admin/cards", icon: CreditCard },
  { title: "Designs", url: "/admin/designs", icon: Palette },
  { title: "Lightning Addresses", url: "/admin/addresses", icon: Zap },
  { title: "Settings", url: "/admin/settings", icon: Settings },
]

interface AdminSidebarProps {
  isOpen: boolean
  onClose: () => void
}

export function AdminSidebar({ isOpen, onClose }: AdminSidebarProps) {
  const pathname = usePathname()
  const { auth } = useAdmin()

  // Close sidebar when route changes on mobile
  useEffect(() => {
    onClose()
  }, [pathname, onClose])

  // Prevent body scroll when mobile sidebar is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = "unset"
    }

    return () => {
      document.body.style.overflow = "unset"
    }
  }, [isOpen])

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={onClose} />}

      {/* Sidebar */}
      <nav
        className={`
        fixed lg:static inset-y-0 left-0 z-50 w-64 
        border-r bg-card min-h-[calc(100vh-4rem)] p-4
        transform transition-transform duration-200 ease-in-out
        lg:transform-none lg:translate-x-0
        ${isOpen ? "translate-x-0" : "-translate-x-full"}
        mt-16 lg:mt-0
      `}
      >
        {/* Mobile close button */}
        <div className="flex justify-end mb-4 lg:hidden">
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-1">
          {menuItems.map((item) => (
            <Link
              key={item.title}
              href={item.url}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground ${
                pathname === item.url ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground"
              }`}
            >
              <item.icon className="h-4 w-4" />
              <span>{item.title}</span>
            </Link>
          ))}
        </div>
      </nav>
    </>
  )
}
