import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getConfig } from '@/lib/config'
import { withErrorHandling } from '@/types/server/error-handler'
import { InternalServerError, ValidationError } from '@/types/server/errors'
import { logger } from '@/lib/logger'

const waitlistSchema = z.object({
  email: z.string().email('Email must be a valid email address'),
  name: z.string().min(1).optional()
})

export const POST = withErrorHandling(async (req: NextRequest) => {
  // Use non-strict mode since this route only needs optional Sendy configuration
  // and doesn't require DATABASE_URL to check if Sendy is enabled
  const config = getConfig(false)
  logger.info('POST request received')
  const payload = await req.json()
  const parsedPayload = waitlistSchema.safeParse(payload)
  if (!parsedPayload.success) {
    logger.error({ errors: parsedPayload.error.errors }, 'Invalid waitlist payload')
    throw new ValidationError(
      'Invalid request body',
      parsedPayload.error.errors
    )
  }
  const { email, name } = parsedPayload.data
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
