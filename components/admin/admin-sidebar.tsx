"use client"

import { CreditCard, Palette, Zap, Settings, Home } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { useAdmin } from "./admin-provider"

const menuItems = [
  { title: "Dashboard", url: "/admin", icon: Home },
  { title: "Cards", url: "/admin/cards", icon: CreditCard },
  { title: "Designs", url: "/admin/designs", icon: Palette },
  { title: "Lightning Addresses", url: "/admin/addresses", icon: Zap },
  { title: "Settings", url: "/admin/settings", icon: Settings },
]

export function AdminSidebar() {
  const pathname = usePathname()
  const { auth } = useAdmin()

  return (
    <Sidebar className="border-r bg-card">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === item.url}
                    className="text-muted-foreground hover:text-foreground hover:bg-accent data-[active=true]:bg-primary/10 data-[active=true]:text-primary data-[active=true]:font-semibold"
                  >
                    <Link href={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
