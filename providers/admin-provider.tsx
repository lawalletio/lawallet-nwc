'use client'

import type React from 'react'
import { createContext, useContext, useState, useEffect } from 'react'

export interface NostrAuth {
  pubkey: string
  method: 'nip07' | 'nsec' | 'bunker'
  connected: boolean
}

export interface AdminContextType {
  auth: NostrAuth | null
  domain: string
  setAuth: (auth: NostrAuth | null) => void
  setDomain: (domain: string) => void
}

export const AdminContext = createContext<AdminContextType | null>(null)

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<NostrAuth | null>(null)
  const [domain, setDomain] = useState('')

  // Load auth from localStorage on mount
  useEffect(() => {
    const savedAuth = localStorage.getItem('admin-auth')
    if (savedAuth) {
      setAuth(JSON.parse(savedAuth))
    }
  }, [])

  // Save auth to localStorage when it changes
  useEffect(() => {
    if (auth) {
      localStorage.setItem('admin-auth', JSON.stringify(auth))
    } else {
      localStorage.removeItem('admin-auth')
    }
  }, [auth])

  return (
    <AdminContext.Provider
      value={{
        auth,
        domain,
        setAuth,
        setDomain
      }}
    >
      {children}
    </AdminContext.Provider>
  )
}
