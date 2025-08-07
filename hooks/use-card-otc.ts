import { useState, useEffect } from 'react'
import type { Card } from '@/types/card'
import { useAPI } from '@/providers/api'

interface UseCardOTCResult {
  isLoading: boolean
  card: Card | null
  error: string | null
  getByOTC: (otc: string) => Promise<Card | null>
}

export function useCardOTC(otc: string | null): UseCardOTCResult {
  const [isLoading, setIsLoading] = useState(false)
  const [card, setCard] = useState<Card | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { get } = useAPI()

  const fetchCard = async (otc: string): Promise<Card | null> => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await get<Card>(`/api/cards/otc/${otc}`)

      if (response.error) {
        if (response.status === 404) {
          throw new Error('Card not found')
        }
        throw new Error(response.error)
      }

      const cardData = response.data
      if (!cardData) {
        throw new Error('No card data received')
      }

      setCard(cardData)
      return {
        ...cardData,
        createdAt: new Date(cardData.createdAt),
        design: {
          ...cardData.design,
          createdAt: new Date(cardData.design.createdAt)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
      setCard(null)
    } finally {
      setIsLoading(false)
    }
    return null
  }

  useEffect(() => {
    if (!otc) {
      setCard(null)
      setError(null)
      return
    }

    fetchCard(otc)
  }, [otc])

  return { isLoading, card, error, getByOTC: fetchCard }
}
