-- CreateEnum
CREATE TYPE "CardActivationBonusKind" AS ENUM ('FREE_ADDRESS', 'SATS');

-- CreateEnum
CREATE TYPE "CardActivationBonusStatus" AS ENUM ('RESERVED', 'REDEEMED');

-- CreateTable
CREATE TABLE "CardActivationBonus" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "CardActivationBonusKind" NOT NULL,
    "status" "CardActivationBonusStatus" NOT NULL DEFAULT 'RESERVED',
    "amountSats" INTEGER,
    "sourceWalletId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardActivationBonus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CardActivationBonus_cardId_kind_key" ON "CardActivationBonus"("cardId", "kind");

-- CreateIndex
CREATE INDEX "CardActivationBonus_userId_kind_idx" ON "CardActivationBonus"("userId", "kind");

-- CreateIndex
CREATE INDEX "CardActivationBonus_status_idx" ON "CardActivationBonus"("status");

-- AddForeignKey
ALTER TABLE "CardActivationBonus" ADD CONSTRAINT "CardActivationBonus_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardActivationBonus" ADD CONSTRAINT "CardActivationBonus_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
