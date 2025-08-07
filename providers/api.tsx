'use client'

import React, { createContext, useContext, useCallback } from 'react'

interface APIResponse<T = any> {
  data?: T
  error?: string
  status: number
}

interface APIContextType {
  get: <T = any>(url: string) => Promise<APIResponse<T>>
  post: <T = any>(url: string, data?: any) => Promise<APIResponse<T>>
  put: <T = any>(url: string, data?: any) => Promise<APIResponse<T>>
  delete: <T = any>(url: string) => Promise<APIResponse<T>>
}

const APIContext = createContext<APIContextType | undefined>(undefined)

export function APIProvider({ children }: { children: React.ReactNode }) {
  const makeRequest = useCallback(
    async <T = any,>(
      url: string,
      options: RequestInit = {}
    ): Promise<APIResponse<T>> => {
      try {
        const response = await fetch(url, {
          headers: {
            'Content-Type': 'application/json',
            ...options.headers
          },
          ...options
        })

        const responseData = await response.json().catch(() => null)

        if (!response.ok) {
          return {
            error:
              responseData?.error ||
              `HTTP ${response.status}: ${response.statusText}`,
            status: response.status
          }
        }

        return {
          data: responseData,
          status: response.status
        }
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : 'Network error',
          status: 0
        }
      }
    },
    []
  )

  const get = useCallback(
    <T = any,>(url: string): Promise<APIResponse<T>> => {
      return makeRequest<T>(url, { method: 'GET' })
    },
    [makeRequest]
  )

  const post = useCallback(
    <T = any,>(url: string, data?: any): Promise<APIResponse<T>> => {
      return makeRequest<T>(url, {
        method: 'POST',
        body: data ? JSON.stringify(data) : undefined
      })
    },
    [makeRequest]
  )

  const put = useCallback(
    <T = any,>(url: string, data?: any): Promise<APIResponse<T>> => {
      return makeRequest<T>(url, {
        method: 'PUT',
        body: data ? JSON.stringify(data) : undefined
      })
    },
    [makeRequest]
  )

  const deleteRequest = useCallback(
    <T = any,>(url: string): Promise<APIResponse<T>> => {
      return makeRequest<T>(url, { method: 'DELETE' })
    },
    [makeRequest]
  )

  const contextValue: APIContextType = {
    get,
    post,
    put,
    delete: deleteRequest
  }

  return (
    <APIContext.Provider value={contextValue}>{children}</APIContext.Provider>
  )
}

export function useAPI() {
  const context = useContext(APIContext)
  if (context === undefined) {
    throw new Error('useAPI must be used within an APIProvider')
  }
  return context
}
