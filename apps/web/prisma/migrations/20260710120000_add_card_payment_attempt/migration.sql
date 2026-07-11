-- Durable, idempotent BoltCard payment attempts. The row is created in the
-- same atomic operation that claims a SUN counter, before any external NWC
-- request is dispatched.

-- CreateEnum
CREATE TYPE "CardPaymentTransport" AS ENUM ('DIRECT', 'LISTENER');

-- CreateEnum
CREATE TYPE "CardPaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'REJECTED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "CardPaymentAttempt" (
    "id"              TEXT NOT NULL,
    "requestId"       TEXT NOT NULL,
    "cardId"          TEXT NOT NULL,
    "counter"         INTEGER NOT NULL,
    "walletId"        TEXT NOT NULL,
    "paymentHash"     TEXT NOT NULL,
    "bolt11"          TEXT NOT NULL,
    "amountMsats"     INTEGER NOT NULL,
    "transport"       "CardPaymentTransport" NOT NULL,
    "status"          "CardPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "preimage"        TEXT,
    "feesPaidMsats"   INTEGER,
    "errorCode"       TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt"      TIMESTAMP(3),

    CONSTRAINT "CardPaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CardPaymentAttempt_requestId_key"
  ON "CardPaymentAttempt"("requestId");
CREATE UNIQUE INDEX "CardPaymentAttempt_cardId_counter_key"
  ON "CardPaymentAttempt"("cardId", "counter");
CREATE UNIQUE INDEX "CardPaymentAttempt_walletId_paymentHash_key"
  ON "CardPaymentAttempt"("walletId", "paymentHash");
CREATE INDEX "CardPaymentAttempt_cardId_createdAt_idx"
  ON "CardPaymentAttempt"("cardId", "createdAt");
CREATE INDEX "CardPaymentAttempt_status_updatedAt_idx"
  ON "CardPaymentAttempt"("status", "updatedAt");

-- Partial unique index: a card cannot start another payment while an earlier
-- attempt has an ambiguous or in-flight result. Exact callback retries attach
-- to the existing attempt via requestId/(cardId, counter) instead.
CREATE UNIQUE INDEX "CardPaymentAttempt_one_unresolved_per_card"
  ON "CardPaymentAttempt"("cardId")
  WHERE "status" IN ('PENDING', 'UNKNOWN');

-- AddForeignKey
ALTER TABLE "CardPaymentAttempt"
  ADD CONSTRAINT "CardPaymentAttempt_cardId_fkey"
  FOREIGN KEY ("cardId") REFERENCES "Card"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
