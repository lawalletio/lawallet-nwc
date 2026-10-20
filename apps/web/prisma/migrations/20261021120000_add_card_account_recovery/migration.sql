-- Card-based account recovery: a RECOVER activation token moves the card
-- holder's whole account onto the claimer. The owner can opt out per account.

-- CreateEnum
CREATE TYPE "CardActivationPurpose" AS ENUM ('ACTIVATE', 'RECOVER');

-- AlterTable
ALTER TABLE "CardActivationToken" ADD COLUMN "purpose" "CardActivationPurpose" NOT NULL DEFAULT 'ACTIVATE',
ADD COLUMN "recoverFromUserId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "cardRecoveryEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "AccountRecovery" (
    "id" TEXT NOT NULL,
    "fromUserId" TEXT,
    "toUserId" TEXT,
    "cardId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "mergedIntoExisting" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "noticeDismissedAt" TIMESTAMP(3),

    CONSTRAINT "AccountRecovery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountRecovery_fromUserId_noticeDismissedAt_idx" ON "AccountRecovery"("fromUserId", "noticeDismissedAt");

-- CreateIndex
CREATE INDEX "AccountRecovery_toUserId_idx" ON "AccountRecovery"("toUserId");

-- AddForeignKey
ALTER TABLE "AccountRecovery" ADD CONSTRAINT "AccountRecovery_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountRecovery" ADD CONSTRAINT "AccountRecovery_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
