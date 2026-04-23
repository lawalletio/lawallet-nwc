'use client'

import React, { createContext, useCallback, useContext, useEffect, useRef } from 'react'

type SaveHandler = () => Promise<void> | void
type ResetHandler = () => void

interface SettingsFormContextValue {
  /**
   * Register a save handler for a settings tab. Automatically unregisters
   * on unmount. The handler is called when the page-level "Save Changes"
   * button is clicked.
   */
  registerSaveHandler: (key: string, handler: SaveHandler) => void
  unregisterSaveHandler: (key: string) => void
  /**
   * Register a reset handler for a settings tab. Invoked when the page-level
   * "Cancel" button is clicked — the tab should restore its local state from
   * the currently stored settings.
   */
  registerResetHandler: (key: string, handler: ResetHandler) => void
  unregisterResetHandler: (key: string) => void
  markChanged: () => void
  /**
   * Tabs report their current validity state per-key. When any tab is invalid,
   * the page-level Save Changes button is disabled.
   */
  setInvalid: (key: string, invalid: boolean) => void
}

const SettingsFormContext = createContext<SettingsFormContextValue | null>(null)

export function SettingsFormProvider({
  children,
  onChange,
  onInvalidChange,
  registerRef,
  resetRef,
}: {
  children: React.ReactNode
  onChange: () => void
  /** Called whenever the aggregate invalid state changes. */
  onInvalidChange?: (isInvalid: boolean) => void
  /** Ref populated with a function that invokes all registered save handlers. */
  registerRef: React.MutableRefObject<(() => Promise<void>) | null>
  /** Ref populated with a function that invokes all registered reset handlers. */
  resetRef?: React.MutableRefObject<(() => void) | null>
}) {
  const handlers = useRef<Map<string, SaveHandler>>(new Map())
  const resetHandlers = useRef<Map<string, ResetHandler>>(new Map())
  const invalidMap = useRef<Map<string, boolean>>(new Map())

  const registerSaveHandler = useCallback((key: string, handler: SaveHandler) => {
    handlers.current.set(key, handler)
  }, [])

  const unregisterSaveHandler = useCallback((key: string) => {
    handlers.current.delete(key)
    if (invalidMap.current.delete(key)) {
      onInvalidChange?.(Array.from(invalidMap.current.values()).some(Boolean))
    }
  }, [onInvalidChange])

  const registerResetHandler = useCallback((key: string, handler: ResetHandler) => {
    resetHandlers.current.set(key, handler)
  }, [])

  const unregisterResetHandler = useCallback((key: string) => {
    resetHandlers.current.delete(key)
  }, [])

  const setInvalid = useCallback((key: string, invalid: boolean) => {
    const prev = invalidMap.current.get(key) ?? false
    if (prev === invalid) return
    invalidMap.current.set(key, invalid)
    onInvalidChange?.(Array.from(invalidMap.current.values()).some(Boolean))
  }, [onInvalidChange])

  // Expose a single function that runs all registered save handlers
  registerRef.current = async () => {
    await Promise.all(
      Array.from(handlers.current.values()).map(h => Promise.resolve(h()))
    )
  }

  // Expose a single function that runs all registered reset handlers synchronously
  if (resetRef) {
    resetRef.current = () => {
      resetHandlers.current.forEach(h => h())
    }
  }

  const value: SettingsFormContextValue = {
    registerSaveHandler,
    unregisterSaveHandler,
    registerResetHandler,
    unregisterResetHandler,
    markChanged: onChange,
    setInvalid,
  }

  return React.createElement(SettingsFormContext.Provider, { value }, children)
}

/**
 * Hook used by settings tabs to register their save/reset handlers and report
 * changes to the page-level Save Changes / Cancel buttons.
 */
export function useSettingsForm(
  key: string,
  handler: SaveHandler,
  reset?: ResetHandler
) {
  const ctx = useContext(SettingsFormContext)

  useEffect(() => {
    if (!ctx) return
    ctx.registerSaveHandler(key, handler)
    return () => ctx.unregisterSaveHandler(key)
  }, [ctx, key, handler])

  useEffect(() => {
    if (!ctx || !reset) return
    ctx.registerResetHandler(key, reset)
    return () => ctx.unregisterResetHandler(key)
  }, [ctx, key, reset])

  const markChanged = useCallback(() => {
    ctx?.markChanged()
  }, [ctx])

  const setInvalid = useCallback(
    (invalid: boolean) => {
      ctx?.setInvalid(key, invalid)
    },
    [ctx, key]
  )

  return { markChanged, setInvalid }
}
