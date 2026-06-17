import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { authenticateSettingsWriteRequest } from '@/lib/settings-auth'
import { probeDomainRouting } from '@/lib/domain-onboarding'
import { eventBus } from '@/lib/events/event-bus'
import { withErrorHandling } from '@/types/server/error-handler'
import { ValidationError } from '@/types/server/errors'

const domainProbeBodySchema = z.object({
  domain: z.string().min(1),
  endpoint: z.string().optional(),
  apiGatewayEndpoint: z.string().optional(),
})

export const POST = withErrorHandling(async (request: NextRequest) => {
  await checkRequestLimits(request, 'json')
  await authenticateSettingsWriteRequest(request)

  const rawBody = await request.json().catch(() => null)
  const parsed = domainProbeBodySchema.safeParse(rawBody)
  if (!parsed.success) {
    throw new ValidationError('Invalid domain probe request', parsed.error.flatten())
  }

  const result = await probeDomainRouting(parsed.data)

  const domainVerified = result.checks.instance.state === 'pass'
  await prisma.settings.upsert({
    where: { name: 'domain_verified' },
    update: { value: domainVerified ? 'true' : 'false' },
    create: { name: 'domain_verified', value: domainVerified ? 'true' : 'false' },
  })
  eventBus.emit({ type: 'settings:updated', timestamp: Date.now() })

  return NextResponse.json(result)
})
