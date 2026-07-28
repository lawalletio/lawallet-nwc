import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  NWC_WEBHOOK_MAX_SKEW_MS,
  NWC_WEBHOOK_SIGNATURE_HEADER,
  NWC_WEBHOOK_SIGNATURE_PREFIX,
  NWC_WEBHOOK_TIMESTAMP_HEADER
} from '@/lib/validation/schemas'
import { getListenerConfig } from '@/lib/listener-config'
import { AuthenticationError, NotFoundError } from '@/types/server/errors'

export async function readAuthenticatedListenerBody(
  request: Request
): Promise<string> {
  const listener = await getListenerConfig()
  const secret = listener.webhookSecret ?? listener.secret
  if (!listener.enabled || !secret) throw new NotFoundError('Not found')

  const timestamp = request.headers.get(NWC_WEBHOOK_TIMESTAMP_HEADER)
  const signature = request.headers.get(NWC_WEBHOOK_SIGNATURE_HEADER)
  if (!timestamp || !signature) {
    throw new AuthenticationError('Missing listener signature')
  }
  const timestampNumber = Number(timestamp)
  if (
    !Number.isFinite(timestampNumber) ||
    Math.abs(Date.now() - timestampNumber) > NWC_WEBHOOK_MAX_SKEW_MS
  ) {
    throw new AuthenticationError('Listener timestamp outside accepted window')
  }
  const raw = await request.text()
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${raw}`)
    .digest('hex')
  const presented = signature.startsWith(NWC_WEBHOOK_SIGNATURE_PREFIX)
    ? signature.slice(NWC_WEBHOOK_SIGNATURE_PREFIX.length)
    : signature
  const a = Buffer.from(expected)
  const b = Buffer.from(presented.trim().toLowerCase())
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AuthenticationError('Invalid listener signature')
  }
  return raw
}
