-- DropIndex
DROP INDEX "ActivityLog_reqId_idx";

-- DropIndex
DROP INDEX "Invoice_purpose_status_idx";

-- DropIndex
DROP INDEX "Invoice_status_idx";

-- DropIndex
DROP INDEX "NostrProfileImageCache_remoteUrl_idx";

-- DropIndex
DROP INDEX "PluginRecord_pluginId_kind_idx";

-- DropIndex
DROP INDEX "RemoteWallet_type_idx";

-- DropIndex
DROP INDEX "RemoteWallet_userId_idx";

-- DropIndex
DROP INDEX "RemoteWalletForwardDestination_revisionId_idx";

-- DropIndex
DROP INDEX "Settings_name_idx";

-- CreateIndex
CREATE INDEX "Card_otc_idx" ON "Card"("otc");

-- CreateIndex
CREATE INDEX "Card_designId_idx" ON "Card"("designId");

-- CreateIndex
CREATE INDEX "ProxyPayment_status_createdAt_idx" ON "ProxyPayment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RemoteWalletForwardLeg_destination_status_idx" ON "RemoteWalletForwardLeg"("destination", "status");

-- CreateIndex
CREATE INDEX "RemoteWalletForwardReceipt_actionId_status_nextRetryAt_idx" ON "RemoteWalletForwardReceipt"("actionId", "status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "RemoteWalletForwardReceipt_revisionId_idx" ON "RemoteWalletForwardReceipt"("revisionId");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- Prisma cannot express partial indexes, so raw SQL (same pattern as
-- Card_userId_master_unique). Both sweeps only ever touch a tiny slice of
-- Invoice.
--
-- "status" is a key column, not part of the predicate: Prisma filters enums as
-- `"status" = CAST($1::text AS "InvoiceStatus")`, and that text->enum cast is
-- STABLE, so the planner can never prove `WHERE "status" = 'PENDING'` from the
-- query and would ignore the index. Only the IS [NOT] NULL terms, which Prisma
-- renders literally, go in the predicate.

-- lib/nostr/zap-settlement.ts findDueZapInvoices: PENDING zap invoices with a
-- minting wallet, filtered on "expiresAt" > now - grace.
CREATE INDEX "Invoice_zap_settlement_due_idx"
  ON "Invoice"("status", "expiresAt")
  WHERE "zapRequestJson" IS NOT NULL
    AND "remoteWalletId" IS NOT NULL;

-- lib/nostr/zap-receipts.ts reconcileInvoiceZapReceipts: PAID zaps whose
-- receipt is not yet published, oldest "paidAt" first.
CREATE INDEX "Invoice_zap_receipt_pending_idx"
  ON "Invoice"("status", "paidAt")
  WHERE "zapReceiptEventId" IS NULL
    AND "zapRequest" IS NOT NULL;
