'use client'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { User, LogOut, Settings, ChevronDown, Menu } from 'lucide-react'
import { LoginMethod, useAPI } from '@/providers/api'

interface TopNavbarProps {
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
}

export function TopNavbar({ sidebarOpen, setSidebarOpen }: TopNavbarProps) {
  const { signer, npub, logout, loginMethod } = useAPI()

  const handleLogout = () => {
    logout()
  }

  const getMethodBadge = (method: LoginMethod | null) => {
    switch (method) {
      case 'nip07':
        return 'Extension'
      case 'nsec':
        return 'Private Key'
      case 'bunker':
        return 'Bunker'
      default:
        return 'Unknown'
    }
  }

  const getMethodColor = (method: LoginMethod | null) => {
    switch (method) {
      case 'nip07':
        return 'bg-green-100 text-green-800'
      case 'nsec':
        return 'bg-blue-100 text-blue-800'
      case 'bunker':
        return 'bg-purple-100 text-purple-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4 bg-card w-full">
      {/* Mobile menu button */}
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden bg-white text-gray-900 hover:bg-gray-100"
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        <Menu className="h-4 w-4" />
      </Button>

      {/* Logo and user info */}
      <div className="flex items-center gap-3">
        <img src="/nwc-logo-black.png" alt="NWC Logo" className="h-8 w-auto" />
        <div className="min-w-0 flex-1 hidden sm:block">
          <h2 className="text-base font-semibold text-foreground truncate">
            Admin Dashboard
          </h2>
          {signer && npub && (
            <p className="text-xs text-muted-foreground truncate font-mono">
              {npub.slice(0, 8)}...{npub.slice(-8)}
            </p>
          )}
        </div>
      </div>

      <div className="flex-1" />

      {/* User dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="flex items-center gap-2 px-3 py-2 h-auto text-secondary-foreground"
          >
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center">
                <User className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="hidden md:block text-left">
                {npub && (
                  <div className="text-sm font-medium text-foreground font-mono">
                    {npub.slice(0, 8)}...{npub.slice(-8)}
                  </div>
                )}
                <div className="text-xs text-muted-foreground">
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-xs ${getMethodColor(loginMethod)}`}
                  >
                    {getMethodBadge(loginMethod)}
                  </span>
                </div>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground hidden sm:block" />
            </div>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 bg-popover border">
          <div className="px-3 py-2">
            <div className="text-sm font-medium text-foreground">
              Logged in as
            </div>
            <div className="text-xs text-muted-foreground font-mono break-all">
              {npub}
            </div>
            <div className="mt-1">
              <span
                className={`inline-block px-2 py-0.5 rounded-full text-xs ${getMethodColor(loginMethod)}`}
              >
                {getMethodBadge(loginMethod)}
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
