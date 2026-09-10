-- Give zap invoices a poll schedule so NIP-57 no longer depends on the wallet
-- implementing NIP-47 notifications.
--
-- Settlement of a LUD-16 invoice was only ever written by the listener's
-- `payment_received` webhook (or a payer polling LUD-21 verify). `notifications`
-- is optional in NIP-47, so a wallet that doesn't emit them left the invoice
-- PENDING forever and its kind:9735 receipt unpublished, even though the
-- address advertised `allowsNostr`. The sweep in `lib/nostr/zap-settlement.ts`
-- polls `lookup_invoice` for those instead.
--
-- `settlementNextPollAt` is both the due marker and the claim: an `updateMany`
-- guarded on `<= now` is atomic under Postgres row locking (the predicate is
-- re-evaluated after the row lock is taken), so concurrent sweeps can't poll
-- the same invoice twice without a separate lease column.
ALTER TABLE "Invoice" ADD COLUMN     "settlementNextPollAt" TIMESTAMP(3),
ADD COLUMN     "settlementPollAttempts" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Invoice_status_settlementNextPollAt_idx" ON "Invoice"("status", "settlementNextPollAt");
