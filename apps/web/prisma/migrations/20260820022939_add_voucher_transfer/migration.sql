-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "VoucherStatus" ADD VALUE 'TRANSFER_PENDING';
ALTER TYPE "VoucherStatus" ADD VALUE 'TRANSFERRED';

-- AlterTable
ALTER TABLE "Voucher" ADD COLUMN     "refreshUrl" TEXT,
ADD COLUMN     "transferredTo" TEXT;

-- CreateTable
CREATE TABLE "VoucherTransfer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "servicePubkey" TEXT NOT NULL,
    "oldNonce" TEXT NOT NULL,
    "newNonce" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "voucherId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "VoucherTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VoucherTransfer_userId_createdAt_idx" ON "VoucherTransfer"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherTransfer_servicePubkey_oldNonce_key" ON "VoucherTransfer"("servicePubkey", "oldNonce");

-- AddForeignKey
ALTER TABLE "VoucherTransfer" ADD CONSTRAINT "VoucherTransfer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
