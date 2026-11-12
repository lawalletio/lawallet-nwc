import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticateSettingsWriteRequest } from '@/lib/settings-auth'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { validateBody } from '@/lib/validation/middleware'
import {
  emailTestRequestSchema,
  type EmailTestResponse
} from '@/lib/validation/schemas'
import { sendEmail } from '@/lib/email/send'

/**
 * "Send test email" for Settings → Infrastructure → Email. Sends the `test`
 * template through the chosen provider using the STORED config. Always 200
 * with an ok/error shape — delivery outcomes are results, not server errors.
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  await checkRequestLimits(request, 'json')
  await authenticateSettingsWriteRequest(request)
  await rateLimit(request, RateLimitPresets.sensitive)

  const { provider, to } = await validateBody(request, emailTestRequestSchema)

  try {
    await sendEmail({ to, template: 'test', provider, request })
    return NextResponse.json({ ok: true } satisfies EmailTestResponse)
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to send email'
    } satisfies EmailTestResponse)
  }
})
