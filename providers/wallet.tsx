'use client'

import type React from 'react'
import { createContext, useContext, useEffect, useState } from 'react'
import type { WalletContextType, WalletState } from '@/types/wallet'
import { nwc } from '@getalby/sdk'
import { toast } from '@/hooks/use-toast'
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { useAPI } from '@/providers/api'
import { decode } from 'bolt11'
import { bech32 } from 'bech32'

const decodeLnurl = (text: string): string | null => {
  const lowered = text.toLowerCase()
  if (lowered.startsWith('lnurl1')) {
    try {
      const decoded = bech32.decode(lowered)
      return Buffer.from(bech32.fromWords(decoded.words)).toString('utf8')
    } catch {
      return null
    }
  }
  if (/^https?:\/\//i.test(text)) {
    return text
  }
  return null
}

export const WalletContext = createContext<WalletContextType | undefined>(
  undefined
)

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [walletState, setWalletState] = useState<WalletState>({
    lightningAddress: null,
    nwcUri: null,
    balance: 0
  })

  const [nwcObject, setNwcObject] = useState<nwc.NWCClient | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isHydrated, setIsHydrated] = useState(false)
  const { userId, get, put, logout: logoutApi } = useAPI()

  const refreshBalance = async (notification?: any) => {
    if (notification) {
      const { type, amount } = notification.notification
      toast({
        title: type === 'incoming' ? 'Received' : 'Paid',
        variant: type === 'incoming' ? 'default' : 'destructive',
        description: (
          <span className="flex items-center gap-2">
            {type === 'incoming' ? (
              <ArrowDownLeft className="w-4 h-4 text-green-600" />
            ) : (
              <ArrowUpRight className="w-4 h-4 text-red-600" />
            )}
            {type === 'incoming' ? '+' : '-'}
            {amount / 1000} sats
          </span>
        )
      })
    }

    try {
      const balance = await nwcObject?.getBalance()
      console.info('balance:', balance)
      setWalletState(prev => ({ ...prev, balance: balance?.balance ?? 0 }))
      setIsConnected(true)
    } catch {
      setIsConnected(false)
    }
  }

  useEffect(() => {
    if (!walletState.nwcUri) {
      setNwcObject(null)
      nwcObject?.close()
      return
    }

    const nwcClient = new nwc.NWCClient({
      nostrWalletConnectUrl: walletState.nwcUri
    })
    setNwcObject(nwcClient)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletState.nwcUri])

  useEffect(() => {
    if (nwcObject) {
      nwcObject.subscribeNotifications(refreshBalance)
      refreshBalance()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nwcObject])

  // Load wallet data from localStorage on mount
  useEffect(() => {
    const savedWallet = localStorage.getItem('wallet')
    if (savedWallet) {
      try {
        const parsed = JSON.parse(savedWallet)
        setWalletState(prev => ({
          ...prev,
          lightningAddress: parsed.lightningAddress || null,
          nwcUri: parsed.nwcUri || null,
          balance: parsed.balance || 0
        }))
      } catch (error) {
        console.error('Failed to parse saved wallet data:', error)
      }
    }
    setIsHydrated(true)
  }, [])

  // Save wallet data to localStorage whenever it changes
  useEffect(() => {
    // Only save to localStorage after hydration is complete to avoid overwriting during initial load
    if (isHydrated) {
      const existingData = localStorage.getItem('wallet')
      let walletData = {}
      if (existingData) {
        try {
          walletData = JSON.parse(existingData)
        } catch (e) {
          console.error('Failed to parse existing wallet data:', e)
        }
      }
      localStorage.setItem(
        'wallet',
        JSON.stringify({
          ...walletData,
          lightningAddress: walletState.lightningAddress,
          nwcUri: walletState.nwcUri,
          balance: walletState.balance
        })
      )
    }
  }, [walletState, isHydrated])

  const setLightningAddress = async (username: string) => {
    if (!userId) {
      setWalletState(prev => ({
        ...prev,
        lightningAddress: username
      }))
      return
    }

    try {
      const { data, error } = await put(
        `/api/users/${userId}/lightning-address`,
        {
          username
        }
      )

      if (error) {
        throw new Error(error)
      }

      setWalletState(prev => ({
        ...prev,
        lightningAddress: data.lightningAddress
      }))

      return data
    } catch (error) {
      console.error('Error setting lightning address:', error)
      throw error
    }
  }

  const setNwcUri = async (nwcUri: string) => {
    if (!userId) {
      setWalletState(prev => ({ ...prev, nwcUri }))
      return
    }

    try {
      const { data, error } = await put(`/api/users/${userId}/nwc`, {
        nwcUri
      })

      if (error) {
        throw new Error(error)
      }

      setWalletState(prev => ({ ...prev, nwcUri: data.nwcUri }))

      return data
    } catch (error) {
      console.error('Error setting NWC URI:', error)
      throw error
    }
  }

  const getWalletData = async () => {
    const { data, error } = await get(`/api/users/wallet`)
    if (error) {
      throw new Error(error)
    }
    return data
  }

const payInvoice = async (invoice: string, amount: number) => {
  if (!nwcObject) throw new Error('NWC no conectado. Configura tu conexión NWC en ajustes y vuelve a intentar.')
  const decoded = decode(invoice)
  if (!decoded.satoshis || decoded.satoshis === 0) {
    await nwcObject.payInvoice({ invoice, amount: amount * 1000 })
  } else {
    await nwcObject.payInvoice({ invoice })
  }
}

const payLightningAddress = async (username: string, domain: string, amount: number, card?: any) => {
  if (!nwcObject) throw new Error('NWC no conectado. Configura tu conexión NWC en ajustes y vuelve a intentar.')
  const response = await fetch(`https://${domain}/.well-known/lnurlp/${username}`)
  if (!response.ok) throw new Error('No se pudo resolver la lightning address. Verifica que el dominio y username sean correctos.')
  const lnurlData = await response.json()
  let callbackUrl = `${lnurlData.callback}?amount=${amount * 1000}`
  if (card?.message && lnurlData.commentAllowed) callbackUrl += `&comment=${encodeURIComponent(card.message)}`
  const callbackResponse = await fetch(callbackUrl)
  if (!callbackResponse.ok) throw new Error('Error al solicitar invoice. Verifica la cantidad y vuelve a intentar.')
  const invoiceData = await callbackResponse.json()
  await nwcObject.payInvoice({ invoice: invoiceData.pr })
}

const payLnurl = async (lnurlRaw: string, amount: number, card?: any) => {
  if (!nwcObject) throw new Error('NWC no conectado.')

  const url = decodeLnurl(lnurlRaw)
  if (!url) throw new Error('LNURL inválido (formato no reconocido).')

  const res = await fetch(url)
  if (!res.ok) throw new Error('Error al contactar el servicio LNURL.')

  const data = await res.json()
  if (data.tag !== 'payRequest') throw new Error('Este LNURL no es para pagos.')

  const msats = amount * 1000
  if (msats < data.minSendable || msats > data.maxSendable) {
    throw new Error(`Monto fuera del rango: ${data.minSendable/1000} - ${data.maxSendable/1000} sats`)
  }

  const params = new URLSearchParams({ amount: msats.toString() })
  if (card?.message && data.commentAllowed > 0) {
    params.set('comment', card.message.slice(0, data.commentAllowed))
  }

  const callbackRes = await fetch(`${data.callback}?${params}`)
  if (!callbackRes.ok) throw new Error('Error generando invoice desde LNURL.')

  const { pr } = await callbackRes.json()
  if (!pr) throw new Error('No se recibió invoice.')

  await nwcObject.payInvoice({ invoice: pr })
}

const payKeysend = async (pubkey: string, amount: number) => {
  if (!nwcObject) throw new Error('NWC no conectado. Configura tu conexión NWC en ajustes y vuelve a intentar.')
  if (!/^[0-9a-fA-F]{64}$/.test(pubkey)) {
    throw new Error('Pubkey inválida para keysend. Debe ser una cadena hex de 64 caracteres (0-9, a-f, A-F). Verifica la pubkey y vuelve a intentar.')
  }
  await nwcObject.payKeysend({
    pubkey,
    amount: amount * 1000
  })
}

const sendPayment = async (amount: number, to: string, card?: any): Promise<{ success: boolean; error?: string }> => {
  if (!nwcObject) return { success: false, error: 'NWC no conectado. Configura tu conexión NWC en ajustes y vuelve a intentar.' }
  if (!to) return { success: false, error: 'Proporciona una invoice o lightning address válida.' }
  try {
    if (to.startsWith('lnbc') || to.startsWith('lntb')) {
      await payInvoice(to, amount)
    } else if (to.includes('@')) {
      const [username, domain] = to.split('@')
      await payLightningAddress(username, domain, amount, card)
    } else if (to.startsWith('lnurl') || (to.startsWith('https://') && to.includes('lnurl'))) {
      await payLnurl(to, amount, card)
    } else {
      await payKeysend(to, amount)
    }
    return { success: true }
  } catch (error: any) {
    return { success: false, error: `Error al enviar sats: ${error.message}. Verifica los datos e intenta de nuevo.` }
  }
}

  const logout = () => {
    setWalletState({
      lightningAddress: null,
      nwcUri: null,
      balance: 0
    })
    localStorage.removeItem('wallet')
    logoutApi()
  }

  const contextValue: WalletContextType = {
    ...walletState,
    getWalletData,
    setLightningAddress,
    setNwcUri,
    logout,
    isConnected,
    isHydrated,
    sendPayment
  }

  return (
    <WalletContext.Provider value={contextValue}>
      {children}
    </WalletContext.Provider>
  )
}
