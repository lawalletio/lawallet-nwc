import { NSecSigner } from '@nostrify/nostrify'
import { nip98, NostrEvent } from 'nostr-tools'
import { getToken } from 'nostr-tools/nip98'

export interface Nip98ValidationResult {
  pubkey: string
  event: NostrEvent
}

/**
 * Generates an absolute URL considering the browser URL context
 * @param url - The URL to make absolute (can be relative or absolute)
 * @param baseUrl - Optional base URL (defaults to window.location.origin if in browser)
 * @returns string - The absolute URL
 */
export function generateAbsoluteUrl(url: string, baseUrl?: string): string {
  // If the URL is already absolute, return it as is
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url
  }

  // Determine the base URL
  let base: string
  if (baseUrl) {
    base = baseUrl
  } else if (typeof window !== 'undefined') {
    // In browser environment, use current origin
    base = window.location.origin
  } else {
    // In server environment, you might want to use an environment variable
    // or throw an error if baseUrl is required
    throw new Error('baseUrl is required in server environment')
  }

  // Ensure base URL always ends with a slash
  if (!base.endsWith('/')) {
    base += '/'
  }

  // If URL starts with a slash, it's an absolute path
  if (url.startsWith('/')) {
    return base + url.substring(1)
  }

  // Otherwise, it's a relative path
  return base + url
}

export function bodyToPayload(body: any): Record<string, any> | undefined {
  let payload: Record<string, any> | undefined
  if (body) {
    if (typeof body === 'string') {
      try {
        payload = JSON.parse(body)
      } catch {
        // If it's not JSON, use as string
        payload = { body }
      }
    } else if (body instanceof FormData) {
      // Convert FormData to object
      const formDataObj: Record<string, any> = {}
      for (const [key, value] of body.entries()) {
        formDataObj[key] = value
      }
      payload = formDataObj
    } else if (body instanceof URLSearchParams) {
      // Convert URLSearchParams to object
      const paramsObj: Record<string, any> = {}
      for (const [key, value] of body.entries()) {
        paramsObj[key] = value
      }
      payload = paramsObj
    } else {
      // For other body types, use as is
      payload = body as Record<string, any>
    }
  }
  return payload
}

/**
 * Creates a NIP-98 authorization token for HTTP requests
 * @param requestInit - The RequestInit object containing method, body, and URL
 * @param signer - Object with signEvent method to sign the NIP-98 event
 * @param url - The absolute URL for the request
 * @returns Promise<string> - The Authorization header value (e.g., "Nostr <base64-event>")
 */
export async function createNip98Token(
  url: string,
  requestInit: RequestInit,
  signer: NSecSigner
): Promise<string> {
  // Create the NIP-98 event using nostr-tools helper
  const method = requestInit.method || 'GET'

  // Get the request body for payload hash calculation
  const payload = bodyToPayload(requestInit.body)

  // Create the NIP-98 authorization token using nostr-tools
  const authHeader = await getToken(
    generateAbsoluteUrl(url),
    method,
    signer.signEvent.bind(signer),
    true, // includePayloadHash
    payload
  )

  return authHeader
}

/**
 * Validates a NIP-98 authentication token
 * @param request - The Request object containing the authorization header
 * @param timeDelta - The time difference in seconds for event timestamp validation
 * @returns Promise<Nip98ValidationResult> - The validated event data
 */
export async function validateNip98(
  request: Request,
  timeDelta: number = 60
): Promise<Nip98ValidationResult> {
  const authHeader = request.headers.get('authorization')

  if (!authHeader) {
    throw new Error('Authorization header is required')
  }

  if (!authHeader.startsWith('Nostr ')) {
    throw new Error('Authorization header must start with "Nostr "')
  }

  const base64Event = authHeader.substring(6) // Remove "Nostr " prefix

  if (!base64Event) {
    throw new Error('Event data is required')
  }

  let event: NostrEvent
  try {
    const eventData = atob(base64Event)
    event = JSON.parse(eventData)
  } catch (error) {
    console.error('Failed to parse event:', error)
    throw new Error('Invalid event format')
  }

  // Validate the event using nostr-tools nip98 functions
  // Handle tunnel scenarios by reconstructing the URL from headers
  const host =
    request.headers.get('x-forwarded-host') ||
    request.headers.get('host') ||
    'localhost:3000'
  const protocol =
    request.headers.get('x-forwarded-proto') ||
    (request.url.startsWith('https') ? 'https' : 'http')

  // Reconstruct the URL using the public host and protocol
  const originalUrl = new URL(request.url)
  const publicUrl = new URL(
    originalUrl.pathname + originalUrl.search,
    `${protocol}://${host}`
  )

  const method = request.method

  try {
    const requestBody = await request.clone().text()

    const isValid = await nip98.validateEvent(
      event,
      publicUrl.toString(),
      method,
      requestBody
    )

    if (!isValid) {
      throw new Error('Event validation failed')
    }
  } catch (error) {
    console.error('Event validation error:', error)
    throw new Error(
      `Event validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }

  // Check if created_at is within reasonable time window (default 60 seconds)
  const now = Math.floor(Date.now() / 1000)
  const eventTime = event.created_at
  const timeDiff = Math.abs(now - eventTime)

  if (timeDiff > timeDelta) {
    throw new Error(
      `Event timestamp is too old or too new (must be within ${timeDelta} seconds)`
    )
  }

  const result = {
    pubkey: event.pubkey,
    event: event
  }
  return result
}
