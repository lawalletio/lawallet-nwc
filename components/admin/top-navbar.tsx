"use client"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { User, LogOut, Settings, ChevronDown } from "lucide-react"
import { useAdmin } from "./admin-provider"

export function TopNavbar() {
  const { auth, setAuth } = useAdmin()

  const handleLogout = () => {
    setAuth(null)
  }

  const getMethodBadge = (method: string) => {
    switch (method) {
      case "nip07":
        return "Extension"
      case "nsec":
        return "Private Key"
      case "bunker":
        return "Bunker"
      default:
        return "Unknown"
    }
  }

  const getMethodColor = (method: string) => {
    switch (method) {
      case "nip07":
        return "bg-green-100 text-green-800"
      case "nsec":
        return "bg-blue-100 text-blue-800"
      case "bunker":
        return "bg-purple-100 text-purple-800"
      default:
        return "bg-gray-100 text-gray-800"
    }
  }

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4 bg-card w-full">
      <SidebarTrigger className="-ml-1 md:hidden bg-foreground text-background hover:bg-foreground/90" />
      <Separator orientation="vertical" className="mr-2 h-4 md:hidden" />

      {/* Logo and user info moved from sidebar */}
      <div className="flex items-center gap-3">
        <img src="/nwc-logo-black.png" alt="NWC Logo" className="h-8 w-auto" />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-foreground truncate">Admin Dashboard</h2>
          {auth && (
            <p className="text-xs text-muted-foreground truncate font-mono">
              {auth.pubkey.slice(0, 8)}...{auth.pubkey.slice(-8)}
            </p>
          )}
        </div>
      </div>

      <div className="flex-1" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="flex items-center gap-2 px-3 py-2 h-auto text-secondary-foreground">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center">
                <User className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="hidden sm:block text-left">
                <div className="text-sm font-medium text-foreground font-mono">
                  {auth?.pubkey.slice(0, 8)}...{auth?.pubkey.slice(-8)}
                </div>
                <div className="text-xs text-muted-foreground">
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-xs ${getMethodColor(auth?.method || "")}`}
                  >
                    {getMethodBadge(auth?.method || "")}
                  </span>
                </div>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </div>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 bg-popover border">
          <div className="px-3 py-2">
            <div className="text-sm font-medium text-foreground">Logged in as</div>
            <div className="text-xs text-muted-foreground font-mono break-all">{auth?.pubkey}</div>
            <div className="mt-1">
              <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${getMethodColor(auth?.method || "")}`}>
                {getMethodBadge(auth?.method || "")}
              </span>
            </div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="focus:bg-accent">
            <Settings className="h-4 w-4 mr-2" />
            Account Settings
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4 mr-2" />
            Logout
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
