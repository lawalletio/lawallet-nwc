'use client'

import type React from 'react'
import { createContext, useContext, useState, useEffect } from 'react'

interface NostrAuth {
  pubkey: string
  method: 'nip07' | 'nsec' | 'bunker'
  connected: boolean
}

interface Card {
  id: string
  name: string
  design: string
  lightningAddress: string
  nwc: string | null
  status: 'unpaired' | 'paired' | 'active' | 'revoked'
  createdAt: Date
  uid?: string
}

interface Design {
  id: string
  name: string
  description: string
  imageUrl: string
  isDefault: boolean
}

interface LightningAddress {
  id: string
  address: string
  label: string
  isDefault: boolean
}

interface AdminContextType {
  auth: NostrAuth | null
  cards: Card[]
  designs: Design[]
  lightningAddresses: LightningAddress[]
  domain: string
  setAuth: (auth: NostrAuth | null) => void
  addCard: (card: Omit<Card, 'id' | 'createdAt'>) => void
  updateCard: (id: string, updates: Partial<Card>) => void
  deleteCard: (id: string) => void
  addDesign: (design: Omit<Design, 'id'>) => void
  deleteDesign: (id: string) => void
  addLightningAddress: (address: Omit<LightningAddress, 'id'>) => void
  deleteLightningAddress: (id: string) => void
  setDomain: (domain: string) => void
}

const AdminContext = createContext<AdminContextType | null>(null)

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<NostrAuth | null>(null)
  const [cards, setCards] = useState<Card[]>([])
  const [designs, setDesigns] = useState<Design[]>([
    {
      id: '1',
      name: 'Default Purple',
      description: 'Purple gradient design',
      imageUrl: '/placeholder.svg?height=540&width=856&text=Purple+Card',
      isDefault: true
    }
  ])
  const [lightningAddresses, setLightningAddresses] = useState<
    LightningAddress[]
  >([])
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

  const addCard = (card: Omit<Card, 'id' | 'createdAt'>) => {
    const newCard: Card = {
      ...card,
      id: Math.random().toString(36).substr(2, 9),
      createdAt: new Date()
    }
    setCards(prev => [...prev, newCard])
  }

  const updateCard = (id: string, updates: Partial<Card>) => {
    setCards(prev =>
      prev.map(card => (card.id === id ? { ...card, ...updates } : card))
    )
  }

  const deleteCard = (id: string) => {
    setCards(prev => prev.filter(card => card.id !== id))
  }

  const addDesign = (design: Omit<Design, 'id'>) => {
    const newDesign: Design = {
      ...design,
      id: Math.random().toString(36).substr(2, 9)
    }
    setDesigns(prev => [...prev, newDesign])
  }

  const deleteDesign = (id: string) => {
    setDesigns(prev => prev.filter(design => design.id !== id))
  }

  const addLightningAddress = (address: Omit<LightningAddress, 'id'>) => {
    const newAddress: LightningAddress = {
      ...address,
      id: Math.random().toString(36).substr(2, 9)
    }
    setLightningAddresses(prev => [...prev, newAddress])
  }

  const deleteLightningAddress = (id: string) => {
    setLightningAddresses(prev => prev.filter(addr => addr.id !== id))
  }

  return (
    <AdminContext.Provider
      value={{
        auth,
        cards,
        designs,
        lightningAddresses,
        domain,
        setAuth,
        addCard,
        updateCard,
        deleteCard,
        addDesign,
        deleteDesign,
        addLightningAddress,
        deleteLightningAddress,
        setDomain
      }}
    >
      {children}
    </AdminContext.Provider>
  )
}

export function useAdmin() {
  const context = useContext(AdminContext)
  if (!context) {
    throw new Error('useAdmin must be used within AdminProvider')
  }
  return context
}
