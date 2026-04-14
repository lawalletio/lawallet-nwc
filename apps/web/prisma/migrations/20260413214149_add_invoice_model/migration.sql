-- CreateEnum
CREATE TYPE "InvoicePurpose" AS ENUM ('REGISTRATION');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED');

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "bolt11" TEXT NOT NULL,
    "paymentHash" TEXT NOT NULL,
    "amountSats" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "purpose" "InvoicePurpose" NOT NULL,
    "metadata" JSONB,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "preimage" TEXT,
    "userId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_paymentHash_key" ON "Invoice"("paymentHash");

-- CreateIndex
CREATE INDEX "Invoice_userId_idx" ON "Invoice"("userId");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "Invoice_purpose_status_idx" ON "Invoice"("purpose", "status");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
