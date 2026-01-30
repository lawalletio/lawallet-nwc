import { NextRequest, NextResponse } from 'next/server'
import { getConfig } from '@/lib/config'
import { withErrorHandling } from '@/types/server/error-handler'
import { InternalServerError, ValidationError } from '@/types/server/errors'
import { logger } from '@/lib/logger'
import { waitlistSchema } from '@/lib/validation/schemas'
import { validateBody } from '@/lib/validation/middleware'

export const POST = withErrorHandling(async (req: NextRequest) => {
  // Use non-strict mode since this route only needs optional Sendy configuration
  // and doesn't require DATABASE_URL to check if Sendy is enabled
  const config = getConfig(false)
  logger.info('POST request received')
  const { email, name } = await validateBody(req, waitlistSchema)
  logger.info({ email }, 'Waitlist subscription request')

  if (!config.sendy.enabled) {
    const missingKeys = [
      !config.sendy.url ? 'SENDY_URL' : null,
      !config.sendy.listId ? 'SENDY_LIST_ID' : null,
      !config.sendy.apiKey ? 'SENDY_API_KEY' : null
    ].filter((key): key is string => Boolean(key))
    const missingMessage =
      missingKeys.length > 0
        ? `Missing Sendy configuration: ${missingKeys.join(', ')}`
        : 'Sendy configuration missing'
    logger.error({ missingKeys }, 'Sendy configuration missing')
    throw new InternalServerError(missingMessage, { details: { missingKeys } })
  }

  const formData = new URLSearchParams()
  formData.append('email', email)
  formData.append('api_key', config.sendy.apiKey!)
  formData.append('list', config.sendy.listId!)
  formData.append('boolean', 'true')
  if (name) formData.append('name', name)

  logger.info({ email, listId: config.sendy.listId }, 'Sending request to Sendy')
  const sendyRes = await fetch(`${config.sendy.url}/subscribe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: formData.toString()
  })
  const result = await sendyRes.text()
  logger.debug({ result, status: sendyRes.status }, 'Sendy response received')

  if (result === '1') {
    logger.info({ email }, 'Waitlist subscription successful')
    return NextResponse.json({ success: true })
  }

  logger.error({ result, status: sendyRes.status }, 'Waitlist subscription failed')
  throw new ValidationError('Subscription failed.', { result })
})
