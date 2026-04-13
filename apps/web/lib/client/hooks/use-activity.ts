'use client'

export type ActivityCategory = 'USER' | 'ADDRESS' | 'NWC' | 'INVOICE' | 'CARD' | 'SERVER'

export interface ActivityLog {
  id: string
  timestamp: string
  category: ActivityCategory
  message: string
}

export function useActivity() {
  return { data: [] as ActivityLog[], loading: false, error: null }
}
