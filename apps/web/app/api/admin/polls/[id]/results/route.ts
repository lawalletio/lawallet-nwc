import { NextResponse } from 'next/server'
import { nip19 } from 'nostr-tools'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticateWithRole } from '@/lib/auth/unified-auth'
import { Role } from '@/lib/auth/permissions'
import { validateParams } from '@/lib/validation/middleware'
import { idParam, type PollOption } from '@/lib/validation/schemas'
import { NotFoundError } from '@/types/server/errors'
import { resolveAddressDomain } from '@/lib/public-url'
import { aggregateResults } from '@/lib/polls'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/admin/polls/{id}/results — tallies plus every voter's answer. */
export const GET = withErrorHandling(
  async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
    await authenticateWithRole(request, Role.ADMIN)
    const { id } = validateParams(await ctx.params, idParam)

    // ponytail: loads every response; paginate voters if polls reach ~10k answers.
    const [poll, domain] = await Promise.all([
      prisma.poll.findUnique({
        where: { id },
        include: {
          responses: {
            select: {
              userId: true,
              choices: true,
              updatedAt: true,
              user: {
                select: {
                  pubkey: true,
                  pollsDismissedAt: true,
                  lightningAddresses: {
                    where: { isPrimary: true },
                    take: 1,
                    select: { username: true }
                  }
                }
              }
            }
          }
        }
      }),
      resolveAddressDomain(request)
    ])
    if (!poll) throw new NotFoundError('Poll not found')

    return NextResponse.json(
      aggregateResults(
        { ...poll, options: poll.options as PollOption[] },
        poll.responses.map(r => {
          const username = r.user.lightningAddresses[0]?.username
          return {
            userId: r.userId,
            choices: r.choices,
            updatedAt: r.updatedAt,
            npub: nip19.npubEncode(r.user.pubkey),
            lightningAddress: username ? `${username}@${domain}` : null,
            dismissed: !!r.user.pollsDismissedAt
          }
        })
      )
    )
  }
)
