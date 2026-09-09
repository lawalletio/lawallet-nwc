-- CreateEnum
CREATE TYPE "VoucherStatus" AS ENUM ('MINTED', 'CLAIMED', 'EXPIRED', 'VOIDED');

-- CreateEnum
CREATE TYPE "VoucherDepositPolicy" AS ENUM ('ANYONE', 'ALLOWLIST');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "voucherDepositPolicy" "VoucherDepositPolicy" NOT NULL DEFAULT 'ANYONE',
ADD COLUMN     "voucherSenderAllowlist" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "Voucher" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "couponId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "merchantPubkey" TEXT NOT NULL,
    "servicePubkey" TEXT NOT NULL,
    "claimUrl" TEXT NOT NULL,
    "mintUrl" TEXT,
    "metadata" JSONB,
    "voucherEvent" JSONB,
    "status" "VoucherStatus" NOT NULL DEFAULT 'MINTED',
    "expiresAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "statusCheckedAt" TIMESTAMP(3),
    "depositedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Voucher_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Voucher_userId_status_idx" ON "Voucher"("userId", "status");

-- CreateIndex
CREATE INDEX "Voucher_userId_createdAt_idx" ON "Voucher"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Voucher_servicePubkey_nonce_key" ON "Voucher"("servicePubkey", "nonce");

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
