-- Persist NIP-57 lifecycle data for every LUD-16 invoice minted by a
-- RemoteWallet. These additions are nullable so historical invoices and
-- existing RemoteWallets remain fully compatible.
ALTER TABLE "Invoice"
  ADD COLUMN "remoteWalletId" TEXT,
  ADD COLUMN "zapRequest" JSONB,
  ADD COLUMN "zapRequestJson" TEXT,
  ADD COLUMN "zapReceipt" JSONB,
  ADD COLUMN "zapReceiptJson" TEXT,
  ADD COLUMN "zapReceiptEventId" TEXT,
  ADD COLUMN "zapReceiptPublishedAt" TIMESTAMP(3),
  ADD COLUMN "zapReceiptError" TEXT,
  ADD COLUMN "zapReceiptLeaseOwner" TEXT,
  ADD COLUMN "zapReceiptLeaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "zapReceiptNextRetryAt" TIMESTAMP(3);

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_remoteWalletId_fkey"
  FOREIGN KEY ("remoteWalletId") REFERENCES "RemoteWallet"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Invoice_remoteWalletId_idx" ON "Invoice"("remoteWalletId");
CREATE INDEX "Invoice_status_zapReceiptNextRetryAt_idx"
  ON "Invoice"("status", "zapReceiptNextRetryAt");
