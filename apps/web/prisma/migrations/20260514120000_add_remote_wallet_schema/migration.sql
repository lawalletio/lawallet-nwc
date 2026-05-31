-- Add the generic RemoteWallet model that future drivers (LND / CLN / BTCPay)
-- plug into. Existing NWCConnection rows are copied forward as type=NWC so the
-- new tables can come online before the old code paths are removed in #234.

-- CreateEnum
CREATE TYPE "RemoteWalletType" AS ENUM ('NWC', 'LND', 'CLN', 'BTCPAY');

-- CreateEnum
CREATE TYPE "RemoteWalletStatus" AS ENUM ('ACTIVE', 'DISABLED', 'REVOKED');

-- CreateTable
CREATE TABLE "RemoteWallet" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "type"      "RemoteWalletType" NOT NULL,
    "config"    JSONB NOT NULL,
    "status"    "RemoteWalletStatus" NOT NULL DEFAULT 'ACTIVE',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RemoteWallet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RemoteWallet_userId_name_key" ON "RemoteWallet"("userId", "name");
CREATE INDEX "RemoteWallet_userId_idx" ON "RemoteWallet"("userId");
CREATE INDEX "RemoteWallet_type_idx" ON "RemoteWallet"("type");
CREATE INDEX "RemoteWallet_status_idx" ON "RemoteWallet"("status");

-- Partial unique index: at most one default wallet per user.
CREATE UNIQUE INDEX "RemoteWallet_userId_default_unique"
  ON "RemoteWallet" ("userId") WHERE "isDefault" = true;

-- AddForeignKey
ALTER TABLE "RemoteWallet" ADD CONSTRAINT "RemoteWallet_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data migration: every existing NWCConnection row becomes a RemoteWallet with
-- type=NWC. We reuse NWCConnection.id as RemoteWallet.id so the LightningAddress
-- backfill below is a direct column copy. Names are generated as "NWC Wallet"
-- (singletons) or "NWC Wallet N" (ordered by createdAt) so they're unique per
-- user; users can rename later.
INSERT INTO "RemoteWallet" ("id", "userId", "name", "type", "config", "status", "isDefault", "createdAt", "updatedAt")
SELECT
    nwc."id",
    nwc."userId",
    CASE
        WHEN COUNT(*) OVER (PARTITION BY nwc."userId") = 1 THEN 'NWC Wallet'
        ELSE 'NWC Wallet ' || ROW_NUMBER() OVER (PARTITION BY nwc."userId" ORDER BY nwc."createdAt", nwc."id")
    END,
    'NWC'::"RemoteWalletType",
    jsonb_build_object(
        'connectionString', nwc."connectionString",
        'mode', nwc."mode"::text
    ),
    'ACTIVE'::"RemoteWalletStatus",
    nwc."isPrimary",
    nwc."createdAt",
    nwc."updatedAt"
FROM "NWCConnection" nwc;

-- AlterTable: add nullable remoteWalletId to LightningAddress and Card.
ALTER TABLE "LightningAddress" ADD COLUMN "remoteWalletId" TEXT;
ALTER TABLE "Card" ADD COLUMN "remoteWalletId" TEXT;

-- Backfill: LightningAddress rows that pointed at an NWCConnection now also
-- point at the corresponding RemoteWallet (same id thanks to the INSERT above).
-- Cards had no prior NWC link so there's nothing to backfill there.
UPDATE "LightningAddress"
SET "remoteWalletId" = "nwcConnectionId"
WHERE "nwcConnectionId" IS NOT NULL;

-- CreateIndex
CREATE INDEX "LightningAddress_remoteWalletId_idx" ON "LightningAddress"("remoteWalletId");
CREATE INDEX "Card_remoteWalletId_idx" ON "Card"("remoteWalletId");

-- AddForeignKey
ALTER TABLE "LightningAddress" ADD CONSTRAINT "LightningAddress_remoteWalletId_fkey"
  FOREIGN KEY ("remoteWalletId") REFERENCES "RemoteWallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Card" ADD CONSTRAINT "Card_remoteWalletId_fkey"
  FOREIGN KEY ("remoteWalletId") REFERENCES "RemoteWallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
