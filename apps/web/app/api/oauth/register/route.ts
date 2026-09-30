import { NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { validateBody } from '@/lib/validation/middleware'
import { oauthClientRegistrationSchema } from '@/lib/validation/schemas'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { NO_STORE_HEADERS, withOAuthErrors } from '@/lib/oauth/protocol'
import {
  pruneStaleOAuthRecords,
  registerClient,
  registrationErrorCode
} from '@/lib/oauth/clients'

export const dynamic = 'force-dynamic'

/**
 * `POST /api/oauth/register` — RFC 7591 dynamic client registration for MCP
 * hosts (Claude, ChatGPT, Cursor, …). Every client is public: no secret,
 * PKCE required, whatever the request asks for.
 */
export const POST = withErrorHandling(
  withOAuthErrors(async (request: Request) => {
    await checkRequestLimits(request, 'json')
    // Per-IP, and hosted clients (Claude, ChatGPT) register for all their
    // users from a handful of addresses — roomier than the `auth` preset.
    await rateLimit(request, { bucket: 'oauthRegister', maxRequests: 30 })

    const body = await validateBody(request, oauthClientRegistrationSchema)
    await pruneStaleOAuthRecords()
    const client = await registerClient(body)

    return NextResponse.json(client, {
      status: 201,
      headers: NO_STORE_HEADERS
    })
  }, registrationErrorCode)
)
