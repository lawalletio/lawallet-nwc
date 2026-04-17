-- CreateEnum
CREATE TYPE "LightningAddressMode" AS ENUM ('IDLE', 'ALIAS', 'CUSTOM_NWC', 'DEFAULT_NWC');

-- CreateEnum
CREATE TYPE "NwcMode" AS ENUM ('RECEIVE', 'SEND_RECEIVE');

-- DropForeignKey
ALTER TABLE "LightningAddress" DROP CONSTRAINT "LightningAddress_userId_fkey";

-- DropIndex (one-address-per-user is no longer enforced)
DROP INDEX "LightningAddress_userId_key";

-- AlterTable: add new columns. updatedAt is backfilled from createdAt for
-- existing rows so the NOT NULL constraint can apply, then DEFAULT is dropped.
ALTER TABLE "LightningAddress"
  ADD COLUMN "isPrimary"       BOOLEAN              NOT NULL DEFAULT false,
  ADD COLUMN "mode"            "LightningAddressMode" NOT NULL DEFAULT 'DEFAULT_NWC',
  ADD COLUMN "nwcConnectionId" TEXT,
  ADD COLUMN "redirect"        TEXT,
  ADD COLUMN "updatedAt"       TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "LightningAddress" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- Backfill: each existing user's single address becomes their primary.
UPDATE "LightningAddress" SET "isPrimary" = true;

-- CreateTable
CREATE TABLE "NWCConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionString" TEXT NOT NULL,
    "mode" "NwcMode" NOT NULL DEFAULT 'RECEIVE',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NWCConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NWCConnection_userId_idx" ON "NWCConnection"("userId");

-- CreateIndex
CREATE INDEX "LightningAddress_userId_idx" ON "LightningAddress"("userId");

-- CreateIndex
CREATE INDEX "LightningAddress_nwcConnectionId_idx" ON "LightningAddress"("nwcConnectionId");

-- Partial unique indexes: at most one primary per user, on each table.
CREATE UNIQUE INDEX "LightningAddress_userId_primary_unique"
  ON "LightningAddress" ("userId") WHERE "isPrimary" = true;
CREATE UNIQUE INDEX "NWCConnection_userId_primary_unique"
  ON "NWCConnection" ("userId") WHERE "isPrimary" = true;

-- AddForeignKey
ALTER TABLE "LightningAddress" ADD CONSTRAINT "LightningAddress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LightningAddress" ADD CONSTRAINT "LightningAddress_nwcConnectionId_fkey" FOREIGN KEY ("nwcConnectionId") REFERENCES "NWCConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NWCConnection" ADD CONSTRAINT "NWCConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
