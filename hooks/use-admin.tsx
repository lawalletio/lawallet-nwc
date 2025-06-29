import { AdminContext } from '@/providers/admin-provider'
import { useContext } from 'react'

export function useAdmin() {
  const context = useContext(AdminContext)
  if (!context) {
    throw new Error('useAdmin must be used within AdminProvider')
  }
  return context
}
