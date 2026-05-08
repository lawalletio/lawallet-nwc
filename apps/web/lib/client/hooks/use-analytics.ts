'use client'

import { useCallback } from 'react'
import { trackEvent, type EventParams } from '@/lib/analytics/gtag'
import { AnalyticsEvent, type AnalyticsEventName } from '@/lib/analytics/events'

export { AnalyticsEvent }
export type { AnalyticsEventName, EventParams }

/**
 * Convenience hook over `trackEvent` so call sites don't have to import
 * the helper directly. The returned `trackEvent` is referentially stable.
 */
export function useAnalytics() {
  const track = useCallback((name: AnalyticsEventName, params?: EventParams) => {
    trackEvent(name, params)
  }, [])

  return { trackEvent: track }
}
