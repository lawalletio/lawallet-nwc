import { useState, useEffect } from 'react'
import type { Card } from '@/types/card'
import { useAPI } from '@/providers/api'

interface UseCardsResult {
  cards: Card[]
  isLoading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export function useCards(userId: string | null): UseCardsResult {
  const [cards, setCards] = useState<Card[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { get } = useAPI()

  const fetchCards = async () => {
    if (!userId) {
      setCards([])
      setError(null)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const response = await get<Card[]>(`/api/cards/user/${userId}`)

      if (response.error) {
        if (response.status === 404) {
          throw new Error('User not found')
        }
        throw new Error(response.error)
      }

      const cardsData = response.data || []

      // Transform dates to Date objects
      const transformedCards = cardsData.map(card => ({
        ...card,
        createdAt: new Date(card.createdAt),
        lastUsedAt: card.lastUsedAt ? new Date(card.lastUsedAt) : undefined,
        design: {
          ...card.design,
          createdAt: new Date(card.design.createdAt)
        }
      }))

      setCards(transformedCards)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
      setCards([])
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchCards()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  return {
    cards,
    isLoading,
    error,
    refetch: fetchCards
  }
}
