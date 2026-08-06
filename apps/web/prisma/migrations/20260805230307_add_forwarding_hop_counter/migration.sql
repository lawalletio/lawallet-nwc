-- CreateTable
CREATE TABLE "ForwardingHop" (
    "id" TEXT NOT NULL,
    "paymentHash" TEXT NOT NULL,
    "depth" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForwardingHop_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ForwardingHop_paymentHash_key" ON "ForwardingHop"("paymentHash");

-- CreateIndex
CREATE INDEX "ForwardingHop_createdAt_idx" ON "ForwardingHop"("createdAt");
