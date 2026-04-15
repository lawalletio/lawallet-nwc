'use client'

import React, { createContext, useCallback, useContext, useEffect, useRef } from 'react'

type SaveHandler = () => Promise<void> | void

interface SettingsFormContextValue {
  /**
   * Register a save handler for a settings tab. Automatically unregisters
   * on unmount. The handler is called when the page-level "Save Changes"
   * button is clicked.
   */
  registerSaveHandler: (key: string, handler: SaveHandler) => void
  unregisterSaveHandler: (key: string) => void
  markChanged: () => void
}

const SettingsFormContext = createContext<SettingsFormContextValue | null>(null)

export function SettingsFormProvider({
  children,
  onChange,
  registerRef,
}: {
  children: React.ReactNode
  onChange: () => void
  /** Ref populated with a function that invokes all registered handlers. */
  registerRef: React.MutableRefObject<(() => Promise<void>) | null>
}) {
  const handlers = useRef<Map<string, SaveHandler>>(new Map())

  const registerSaveHandler = useCallback((key: string, handler: SaveHandler) => {
    handlers.current.set(key, handler)
  }, [])

  const unregisterSaveHandler = useCallback((key: string) => {
    handlers.current.delete(key)
  }, [])

  // Expose a single function that runs all registered handlers
  registerRef.current = async () => {
    await Promise.all(
      Array.from(handlers.current.values()).map(h => Promise.resolve(h()))
    )
  }

  const value: SettingsFormContextValue = {
    registerSaveHandler,
    unregisterSaveHandler,
    markChanged: onChange,
  }

  return React.createElement(SettingsFormContext.Provider, { value }, children)
}

/**
 * Hook used by settings tabs to register their save handler and report
 * changes to the page-level Save Changes button.
 */
export function useSettingsForm(key: string, handler: SaveHandler) {
  const ctx = useContext(SettingsFormContext)

  useEffect(() => {
    if (!ctx) return
    ctx.registerSaveHandler(key, handler)
    return () => ctx.unregisterSaveHandler(key)
  }, [ctx, key, handler])

  const markChanged = useCallback(() => {
    ctx?.markChanged()
  }, [ctx])

  return { markChanged }
}
