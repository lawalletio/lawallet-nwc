import type {
  LightningAddressMode,
  RemoteWalletStatus,
  RemoteWalletType
} from '@/lib/generated/prisma'
import { prisma } from '@/lib/prisma'

export interface TapCardWallet {
  id: string
  type: RemoteWalletType
  config: unknown
  status: RemoteWalletStatus
}

/** What a card tap (`/scan` and `/scan/cb`) reads: auth keys + both wallet routes. */
export interface TapCard {
  id: string
  blockedAt: Date | null
  disabledAt: Date | null
  ntag424Cid: string | null
  ntag424: { cid: string; k1: string; k2: string; ctr: number } | null
  remoteWallet: TapCardWallet | null
  user: {
    cardBalanceShared: boolean
    lightningAddresses: Array<{
      mode: LightningAddressMode
      remoteWalletId: string | null
      remoteWallet: TapCardWallet | null
    }>
  } | null
}

interface TapCardRow {
  id: string
  userId: string | null
  cardBalanceShared: boolean | null
  blockedAt: Date | null
  disabledAt: Date | null
  ntag424Cid: string | null
  ntagCid: string | null
  k1: string | null
  k2: string | null
  ctr: number | null
  cardWalletId: string | null
  cardWalletType: RemoteWalletType | null
  cardWalletConfig: unknown
  cardWalletStatus: RemoteWalletStatus | null
  addressMode: LightningAddressMode | null
  addressWalletId: string | null
  primaryWalletId: string | null
  primaryWalletType: RemoteWalletType | null
  primaryWalletConfig: unknown
  primaryWalletStatus: RemoteWalletStatus | null
}

/**
 * Loads a tapped card in ONE round-trip.
 *
 * The equivalent nested Prisma `select` (card → ntag/wallet → user → primary
 * address → wallet) runs as 5–6 statements over 4 sequential round-trips, and
 * every tap does this read twice (scan, then callback) on the payment path.
 * Shape matches that select, so callers are unchanged.
 */
export async function loadTapCard(cardId: string): Promise<TapCard | null> {
  const [row] = await prisma.$queryRaw<TapCardRow[]>`
    SELECT
      c."id", c."userId", c."blockedAt", c."disabledAt", c."ntag424Cid",
      u."cardBalanceShared",
      n."cid" AS "ntagCid", n."k1", n."k2", n."ctr",
      cw."id" AS "cardWalletId", cw."type"::text AS "cardWalletType",
      cw."config" AS "cardWalletConfig", cw."status"::text AS "cardWalletStatus",
      la."mode"::text AS "addressMode", la."remoteWalletId" AS "addressWalletId",
      pw."id" AS "primaryWalletId", pw."type"::text AS "primaryWalletType",
      pw."config" AS "primaryWalletConfig", pw."status"::text AS "primaryWalletStatus"
    FROM "Card" AS c
    LEFT JOIN "User" AS u ON u."id" = c."userId"
    LEFT JOIN "Ntag424" AS n ON n."cid" = c."ntag424Cid"
    LEFT JOIN "RemoteWallet" AS cw ON cw."id" = c."remoteWalletId"
    LEFT JOIN LATERAL (
      SELECT l."mode", l."remoteWalletId"
      FROM "LightningAddress" AS l
      WHERE l."userId" = c."userId" AND l."isPrimary"
      LIMIT 1
    ) AS la ON TRUE
    LEFT JOIN "RemoteWallet" AS pw ON pw."id" = la."remoteWalletId"
    WHERE c."id" = ${cardId}
  `
  if (!row) return null

  return {
    id: row.id,
    blockedAt: row.blockedAt,
    disabledAt: row.disabledAt,
    ntag424Cid: row.ntag424Cid,
    ntag424:
      row.ntagCid === null
        ? null
        : { cid: row.ntagCid, k1: row.k1!, k2: row.k2!, ctr: row.ctr! },
    remoteWallet: wallet(
      row.cardWalletId,
      row.cardWalletType,
      row.cardWalletConfig,
      row.cardWalletStatus
    ),
    user:
      row.userId === null
        ? null
        : {
            cardBalanceShared: row.cardBalanceShared!,
            lightningAddresses:
              row.addressMode === null
                ? []
                : [
                    {
                      mode: row.addressMode,
                      remoteWalletId: row.addressWalletId,
                      remoteWallet: wallet(
                        row.primaryWalletId,
                        row.primaryWalletType,
                        row.primaryWalletConfig,
                        row.primaryWalletStatus
                      )
                    }
                  ]
          }
  }
}

function wallet(
  id: string | null,
  type: RemoteWalletType | null,
  config: unknown,
  status: RemoteWalletStatus | null
): TapCardWallet | null {
  return id === null ? null : { id, type: type!, config, status: status! }
}
