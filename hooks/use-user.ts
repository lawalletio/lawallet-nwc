import { useState, useCallback } from 'react'
import { useAPI } from '@/providers/api'

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
  const { post } = useAPI()

  const createUser = useCallback(
    async ({ pubkey, otc }: CreateUserParams): Promise<CreateUserResult> => {
      setIsLoading(true)
      setError(null)

      try {
        const response = await post<CreateUserResult>(`/api/user`, {
          otc,
          pubkey
        })

        if (response.error) {
          throw new Error(response.error)
        }

        const result = response.data
        if (!result) {
          throw new Error('No user data received')
        }

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
    [post]
  )

  return {
    createUser,
    isLoading,
    error
  }
}
