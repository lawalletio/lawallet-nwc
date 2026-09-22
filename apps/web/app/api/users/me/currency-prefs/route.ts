import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { requireUserId } from '@/lib/auth/account'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { validateBody } from '@/lib/validation/middleware'
import { updateUserCurrencyPrefsSchema } from '@/lib/validation/schemas'

export const dynamic = 'force-dynamic'

export const PUT = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')
  const userId = await requireUserId(request)
  const { currencyPrefs } = await validateBody(
    request,
    updateUserCurrencyPrefsSchema
  )

  await prisma.user.update({
    where: { id: userId },
    data: { currencyPrefs }
  })

  return NextResponse.json({ currencyPrefs })
})
