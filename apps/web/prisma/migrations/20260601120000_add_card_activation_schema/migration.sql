-- Card activation tokens (Month-5 theme B). Adds the SIMPLE/MASTER card kind
-- and the CardActivationToken model backing scannable activation QRs. Only the
-- ONE_TIME (ownership-transfer) path is wired in the app this round; the FOREVER
-- value is reserved for the deferred MASTER account-share feature.

-- CreateEnum
CREATE TYPE "CardKind" AS ENUM ('SIMPLE', 'MASTER');

-- CreateEnum
CREATE TYPE "ActivationQrKind" AS ENUM ('ONE_TIME', 'FOREVER');

-- CreateEnum
CREATE TYPE "ActivationTokenStatus" AS ENUM ('PENDING', 'CLAIMED', 'REVOKED', 'EXPIRED');

-- AlterTable: every existing card defaults to SIMPLE.
ALTER TABLE "Card" ADD COLUMN "kind" "CardKind" NOT NULL DEFAULT 'SIMPLE';

-- CreateTable
CREATE TABLE "CardActivationToken" (
    "id"              TEXT NOT NULL,
    "cardId"          TEXT NOT NULL,
    "qrKind"          "ActivationQrKind" NOT NULL DEFAULT 'ONE_TIME',
    "status"          "ActivationTokenStatus" NOT NULL DEFAULT 'PENDING',
    "qrPayload"       TEXT NOT NULL,
    "issuedByUserId"  TEXT,
    "expiresAt"       TIMESTAMP(3),
    "claimedAt"       TIMESTAMP(3),
    "claimedByUserId" TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardActivationToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CardActivationToken_cardId_idx" ON "CardActivationToken"("cardId");
CREATE INDEX "CardActivationToken_status_idx" ON "CardActivationToken"("status");

-- Partial unique index: at most one ACTIVE (PENDING) token per (cardId, qrKind).
-- Minting a new token of the same kind REVOKEs the prior one in the same
-- transaction, so this constraint also guards against concurrent mints.
CREATE UNIQUE INDEX "CardActivationToken_one_active_per_kind"
  ON "CardActivationToken" ("cardId", "qrKind") WHERE "status" = 'PENDING';

-- AddForeignKey
ALTER TABLE "CardActivationToken" ADD CONSTRAINT "CardActivationToken_cardId_fkey"
  FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;
