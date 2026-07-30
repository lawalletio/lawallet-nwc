-- A holder may have at most one MASTER card (their account-recovery card).
-- Unpaired inventory cards (userId IS NULL) are exempt so bulk provisioning
-- can stamp many; the claim/activation paths demote the claimer's previous
-- master when a MASTER card changes hands.

-- Backfill: nothing writes MASTER on a paired card today, but a hand-seeded or
-- restored database could hold duplicates. Keep the newest per holder.
UPDATE "Card" SET "kind" = 'SIMPLE'
WHERE "kind" = 'MASTER'
  AND "userId" IS NOT NULL
  AND "id" NOT IN (
    SELECT DISTINCT ON ("userId") "id"
    FROM "Card"
    WHERE "kind" = 'MASTER' AND "userId" IS NOT NULL
    ORDER BY "userId", "createdAt" DESC, "id" DESC
  );

-- Prisma cannot express partial unique indexes, so raw SQL (same pattern as
-- LightningAddress_userId_primary_unique / NostrIdentity_userId_primary_unique).
CREATE UNIQUE INDEX "Card_userId_master_unique"
  ON "Card"("userId")
  WHERE "kind" = 'MASTER' AND "userId" IS NOT NULL;
