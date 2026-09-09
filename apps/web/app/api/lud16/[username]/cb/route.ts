import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { ValidationError } from '@/types/server/errors'
import { lud16CallbackActionSchema } from '@/lib/validation/schemas'
import {
  PUBLIC_ACTION_CORS_HEADERS,
  publicActionOptions,
  withPublicActionCors
} from '@/lib/public-cors'
import pay from './actions/pay'
import voucher from './actions/voucher'

/**
 * The LUD-16 callback, dispatched by action.
 *
 * `GET` is LNURL-pay and always has been — the method is the primary
 * discriminator, so an ordinary payment never has to know actions exist.
 * `POST` carries everything else, keyed on `action` in the body, one handler
 * file each. Same layout as `app/api/cards/[id]/scan/cb/`.
 */
const actionHandlers = {
  voucher
} as const

type Ctx = { params: Promise<{ username: string }> }

export const OPTIONS = publicActionOptions

export const GET = withErrorHandling(
  withPublicActionCors(async (req: NextRequest, { params }: Ctx) => {
    const { username } = await params
    return pay(req, username.trim().toLowerCase())
  }),
  { headers: PUBLIC_ACTION_CORS_HEADERS }
)

export const POST = withErrorHandling(
  withPublicActionCors(async (req: NextRequest, { params }: Ctx) => {
    const { username } = await params

    // Read the action without consuming the body the handler needs. Cloning is
    // cheaper than threading a parsed object through every signature, and it
    // keeps each handler owning its own schema.
    let body: unknown
    try {
      body = await req.clone().json()
    } catch {
      throw new ValidationError('Body must be JSON')
    }
    const action = lud16CallbackActionSchema.safeParse(
      (body as { action?: unknown } | null)?.action
    )
    if (!action.success) {
      throw new ValidationError('Unsupported action')
    }

    return actionHandlers[action.data](req, username.trim().toLowerCase())
  }),
  { headers: PUBLIC_ACTION_CORS_HEADERS }
)
