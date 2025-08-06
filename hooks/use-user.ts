import { useState, useCallback } from 'react'

export interface CreateUserParams {
  pubkey: string
  otc?: string
}

export interface CreateUserResult {
  userId: string
  lightningAddress?: string
  nwcString?: string
}

export interface UseUserResult {
  createUser: (params: CreateUserParams) => Promise<CreateUserResult>
  isLoading: boolean
  error: string | null
}

export function useUser(): UseUserResult {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const createUser = useCallback(
    async ({ pubkey, otc }: CreateUserParams): Promise<CreateUserResult> => {
      setIsLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/user`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ otc, pubkey })
        })

        if (!response.ok) {
          const errorData = await response
            .json()
            .catch(() => ({ error: 'Failed to create user' }))
          throw new Error(errorData.error || 'Failed to create user')
        }

        const result = await response.json()
        return {
          userId: result.userId,
          lightningAddress: result.lightningAddress || undefined,
          nwcString: result.nwcString || undefined
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'An error occurred'
        setError(errorMessage)
        throw err
      } finally {
        setIsLoading(false)
      }
    },
    []
  )

  return {
    createUser,
    isLoading,
    error
  }
}
