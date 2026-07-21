-- CreateTable
CREATE TABLE "NostrIdentity" (
    "pubkey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NostrIdentity_pkey" PRIMARY KEY ("pubkey")
);

-- CreateIndex
CREATE INDEX "NostrIdentity_userId_idx" ON "NostrIdentity"("userId");

-- AddForeignKey
ALTER TABLE "NostrIdentity" ADD CONSTRAINT "NostrIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most one primary identity per account. Prisma cannot express partial
-- unique indexes, so raw SQL (same pattern as LightningAddress_userId_primary_unique).
CREATE UNIQUE INDEX "NostrIdentity_userId_primary_unique"
  ON "NostrIdentity"("userId")
  WHERE "isPrimary" = true;

-- Backfill: every existing account's pubkey becomes its primary identity.
-- NOT EXISTS keeps the statement idempotent/re-runnable.
INSERT INTO "NostrIdentity" ("pubkey", "userId", "isPrimary", "createdAt")
SELECT u."pubkey", u."id", true, u."createdAt"
FROM "User" u
WHERE NOT EXISTS (
  SELECT 1 FROM "NostrIdentity" ni WHERE ni."pubkey" = u."pubkey"
);
