-- CreateIndex
CREATE INDEX "Invoice_userId_paidAt_createdAt_idx" ON "Invoice"("userId", "paidAt" DESC, "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ProxyInvoiceIntent_userId_idx" ON "ProxyInvoiceIntent"("userId");

-- CreateIndex
CREATE INDEX "Swap_status_updatedAt_idx" ON "Swap"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "Voucher_merchantPubkey_idx" ON "Voucher"("merchantPubkey");

-- CreateIndex
CREATE INDEX "WebAuthnChallenge_userId_idx" ON "WebAuthnChallenge"("userId");

-- DropIndex (after its replacement exists, which leads with the same column)
DROP INDEX "Invoice_userId_idx";
