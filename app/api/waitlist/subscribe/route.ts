import { NextRequest, NextResponse } from 'next/server'
import { getConfig } from '@/lib/config'
import { withErrorHandling } from '@/types/server/error-handler'
import { InternalServerError, ValidationError } from '@/types/server/errors'
import { logger } from '@/lib/logger'
import { waitlistSchema } from '@/lib/validation/schemas'
import { validateBody } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { randomUUID } from 'crypto'

const TALLY_RESPOND_URL = 'https://tally.so/api/forms'

// Cache the email field blockGroupUuid so we only look it up once
let cachedEmailFieldUuid: string | null = null

async function getEmailFieldUuid(apiKey: string, formId: string): Promise<string> {
  if (cachedEmailFieldUuid) return cachedEmailFieldUuid

  const url = `https://api.tally.so/forms/${formId}/questions`
  logger.info({ url }, 'Fetching Tally form questions')

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` }
  })

  if (!res.ok) {
    const body = await res.text()
    logger.error({ status: res.status, body, url }, 'Failed to fetch Tally form questions')
    throw new InternalServerError(`Failed to fetch Tally form questions (${res.status})`)
  }

  const data = await res.json()
  const questions = data.questions ?? data

  const emailQ = Array.isArray(questions)
    ? questions.find((q: { type: string }) => q.type === 'INPUT_EMAIL')
    : null

  if (!emailQ) {
    throw new InternalServerError('No INPUT_EMAIL question found in Tally form')
  }

  // The field's blockGroupUuid is used as the key in the responses object
  const field = emailQ.fields?.[0]
  cachedEmailFieldUuid = field?.blockGroupUuid ?? field?.uuid ?? emailQ.id

  if (!cachedEmailFieldUuid) {
    logger.error({ emailQ: JSON.stringify(emailQ) }, 'Could not extract field UUID from question')
    throw new InternalServerError('Could not extract field UUID from Tally email question')
  }

  logger.info({ fieldUuid: cachedEmailFieldUuid }, 'Cached email field UUID')
  return cachedEmailFieldUuid
}

export const POST = withErrorHandling(async (req: NextRequest) => {
  await checkRequestLimits(req, 'json')
  const config = getConfig(false)
  const { email } = await validateBody(req, waitlistSchema)
  logger.info({ email }, 'Waitlist subscription request')

  if (!config.tally.enabled) {
    const missingKeys = [
      !config.tally.apiKey ? 'TALLY_API_KEY' : null,
      !config.tally.formId ? 'TALLY_FORM_ID' : null
    ].filter((key): key is string => Boolean(key))
    logger.error({ missingKeys }, 'Tally configuration missing')
    throw new InternalServerError(
      `Missing Tally configuration: ${missingKeys.join(', ')}`,
      { details: { missingKeys } }
    )
  }

  const fieldUuid = await getEmailFieldUuid(config.tally.apiKey!, config.tally.formId!)

  // Submit via Tally's public form respond endpoint (same as their JS widget uses)
  const respondUrl = `${TALLY_RESPOND_URL}/${config.tally.formId}/respond`
  const payload = {
    sessionUuid: randomUUID(),
    respondentUuid: randomUUID(),
    responses: { [fieldUuid]: email },
    captchas: {},
    isCompleted: true
  }

  logger.info({ email, formId: config.tally.formId }, 'Sending submission to Tally')

  const tallyRes = await fetch(respondUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })

  const responseText = await tallyRes.text()

  if (tallyRes.ok) {
    logger.info({ email, response: responseText }, 'Waitlist subscription successful')
    return NextResponse.json({ success: true })
  }

  logger.error(
    { result: responseText, status: tallyRes.status, url: respondUrl },
    'Waitlist subscription failed'
  )
  throw new ValidationError('Subscription failed.', { result: responseText })
})
