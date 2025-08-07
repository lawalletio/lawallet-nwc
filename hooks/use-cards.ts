import { useState, useEffect } from 'react'
import type { Card } from '@/types/card'

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

  const fetchCards = async () => {
    if (!userId) {
      setCards([])
      setError(null)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/cards/user/${userId}`)

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('User not found')
        }
        throw new Error('Failed to fetch cards')
      }

      const cardsData: Card[] = await response.json()

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
