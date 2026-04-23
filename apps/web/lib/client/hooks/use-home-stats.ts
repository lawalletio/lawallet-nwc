'use client'

import { useAddressCounts } from '@/lib/client/hooks/use-addresses'

export function useTotalUsers() {
  return useAddressCounts()
}

export interface RecentOnboarding {
  identity: string
  method: 'Web' | 'Card'
  timestamp: string
}

export function useRecentOnboarding() {
  return { data: [] as RecentOnboarding[], loading: false, error: null }
}

export interface RecentTransaction {
  source: 'App' | 'Card' | 'Address'
  identity: string
  method: 'Inbound' | 'Outbound'
  amount: number
  timestamp: string
}

export function useRecentTransactions() {
  return { data: [] as RecentTransaction[], loading: false, error: null }
}

export function useSystemStatus() {
  return {
    data: { status: 'OK', lastIncident: 'No recent incidents' },
    loading: false,
    error: null,
  }
}

export function useVolume() {
  return { data: { total: 0 }, loading: false, error: null }
}
