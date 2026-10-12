import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Per-request AsyncLocalStorage frame, entered by `withRequestLogging`
 * (every `withErrorHandling` route). Lives outside `lib/logger.ts` so modules
 * that read it keep working when tests mock the logger.
 */
export const requestContext = new AsyncLocalStorage<{ reqId: string }>()

/**
 * The current request's frame object, or `undefined` outside a request. A
 * fresh object per request, so it works as a `WeakMap` key for
 * request-scoped memoization.
 */
export function getRequestScope(): object | undefined {
  return requestContext.getStore()
}
