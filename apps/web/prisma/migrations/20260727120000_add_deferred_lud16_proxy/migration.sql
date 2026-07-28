ALTER TYPE "LightningAddressMode" ADD VALUE IF NOT EXISTS 'PROXY_ALIAS';

CREATE TYPE "ProxyPaymentStatus" AS ENUM (
  'PENDING_INBOUND',
  'READY_TO_FORWARD',
  'FORWARDING',
  'RECEIPT_PENDING',
  'BLOCKED',
  'COMPLETED',
  'EXPIRED'
);

CREATE TYPE "ProxyForwardAttemptStatus" AS ENUM (
  'PENDING',
  'UNKNOWN',
  'REJECTED',
  'SUCCEEDED',
  'EXPIRED'
);

ALTER TABLE "Invoice" ADD COLUMN "amountMsats" BIGINT;

CREATE TABLE "ProxyServiceConfig" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "feeBps" INTEGER NOT NULL DEFAULT 50,
  "walletId" TEXT NOT NULL DEFAULT '__lawallet_proxy__',
  "nwcCiphertext" BYTEA,
  "receiptNsecCiphertext" BYTEA,
  "receiptPubkey" TEXT,
  "capabilities" JSONB,
  "balanceMsats" BIGINT,
  "lastProbeAt" TIMESTAMP(3),
  "lastProbeError" TEXT,
  "lastListenerSeenAt" TIMESTAMP(3),
  "lastCronAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProxyServiceConfig_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProxyServiceConfig_feeBps_check" CHECK ("feeBps" BETWEEN 0 AND 1000)
);

CREATE UNIQUE INDEX "ProxyServiceConfig_walletId_key"
  ON "ProxyServiceConfig"("walletId");

CREATE TABLE "ProxyInvoiceIntent" (
  "id" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "destination" TEXT NOT NULL,
  "blockedHosts" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "feeBps" INTEGER NOT NULL,
  "grossAmountMsats" BIGINT NOT NULL,
  "serviceFeeMsats" BIGINT NOT NULL,
  "destinationAmountMsats" BIGINT NOT NULL,
  "comment" TEXT,
  "zapRequest" JSONB,
  "zapRequestJson" TEXT,
  "descriptionHash" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProxyInvoiceIntent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProxyInvoiceIntent_feeBps_check" CHECK ("feeBps" BETWEEN 0 AND 1000),
  CONSTRAINT "ProxyInvoiceIntent_amounts_check" CHECK (
    "grossAmountMsats" > 0
    AND "serviceFeeMsats" >= 0
    AND "destinationAmountMsats" > 0
    AND "grossAmountMsats" = "serviceFeeMsats" + "destinationAmountMsats"
  )
);

CREATE INDEX "ProxyInvoiceIntent_expiresAt_idx"
  ON "ProxyInvoiceIntent"("expiresAt");

CREATE TABLE "ProxyPayment" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "destination" TEXT NOT NULL,
  "blockedHosts" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "destinationMetadata" JSONB,
  "feeBps" INTEGER NOT NULL,
  "grossAmountMsats" BIGINT NOT NULL,
  "serviceFeeMsats" BIGINT NOT NULL,
  "destinationAmountMsats" BIGINT NOT NULL,
  "forwardedAmountMsats" BIGINT,
  "routingFeeMsats" BIGINT,
  "comment" TEXT,
  "zapRequest" JSONB,
  "zapRequestJson" TEXT,
  "status" "ProxyPaymentStatus" NOT NULL DEFAULT 'PENDING_INBOUND',
  "sourcePaidAt" TIMESTAMP(3),
  "sourcePreimage" TEXT,
  "forwardedAt" TIMESTAMP(3),
  "receiptEventId" TEXT,
  "receiptPublishedAt" TIMESTAMP(3),
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "nextRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT,
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProxyPayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProxyPayment_feeBps_check" CHECK ("feeBps" BETWEEN 0 AND 1000),
  CONSTRAINT "ProxyPayment_amounts_check" CHECK (
    "grossAmountMsats" > 0
    AND "serviceFeeMsats" >= 0
    AND "destinationAmountMsats" > 0
    AND "grossAmountMsats" = "serviceFeeMsats" + "destinationAmountMsats"
  )
);

CREATE UNIQUE INDEX "ProxyPayment_invoiceId_key" ON "ProxyPayment"("invoiceId");
CREATE INDEX "ProxyPayment_status_nextRetryAt_idx"
  ON "ProxyPayment"("status", "nextRetryAt");
CREATE INDEX "ProxyPayment_leaseExpiresAt_idx"
  ON "ProxyPayment"("leaseExpiresAt");
CREATE INDEX "ProxyPayment_username_createdAt_idx"
  ON "ProxyPayment"("username", "createdAt");

ALTER TABLE "ProxyPayment"
  ADD CONSTRAINT "ProxyPayment_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProxyForwardAttempt" (
  "id" TEXT NOT NULL,
  "proxyPaymentId" TEXT NOT NULL,
  "attemptNo" INTEGER NOT NULL,
  "bolt11" TEXT NOT NULL,
  "paymentHash" TEXT NOT NULL,
  "amountMsats" BIGINT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "requestId" TEXT NOT NULL,
  "status" "ProxyForwardAttemptStatus" NOT NULL DEFAULT 'PENDING',
  "preimage" TEXT,
  "routingFeeMsats" BIGINT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "ProxyForwardAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProxyForwardAttempt_requestId_key"
  ON "ProxyForwardAttempt"("requestId");
CREATE UNIQUE INDEX "ProxyForwardAttempt_proxyPaymentId_attemptNo_key"
  ON "ProxyForwardAttempt"("proxyPaymentId", "attemptNo");
CREATE INDEX "ProxyForwardAttempt_proxyPaymentId_createdAt_idx"
  ON "ProxyForwardAttempt"("proxyPaymentId", "createdAt");
CREATE INDEX "ProxyForwardAttempt_paymentHash_idx"
  ON "ProxyForwardAttempt"("paymentHash");
CREATE INDEX "ProxyForwardAttempt_status_updatedAt_idx"
  ON "ProxyForwardAttempt"("status", "updatedAt");

ALTER TABLE "ProxyForwardAttempt"
  ADD CONSTRAINT "ProxyForwardAttempt_proxyPaymentId_fkey"
  FOREIGN KEY ("proxyPaymentId") REFERENCES "ProxyPayment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- A destination could (accidentally or maliciously) return the same BOLT11
-- to two source payments. Retrying that invoice for its original source is
-- valid, but counting one Lightning settlement as forwarding two sources is
-- not. Serialize by payment hash, then reject cross-source ownership while
-- still permitting multiple retry rows for the same ProxyPayment.
CREATE OR REPLACE FUNCTION enforce_proxy_destination_invoice_owner()
RETURNS trigger AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."paymentHash", 0));
  IF EXISTS (
    SELECT 1
      FROM "ProxyForwardAttempt"
     WHERE "paymentHash" = NEW."paymentHash"
       AND "proxyPaymentId" <> NEW."proxyPaymentId"
  ) THEN
    RAISE EXCEPTION 'destination invoice is already owned by another proxy payment'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER proxy_destination_invoice_owner_trigger
  BEFORE INSERT OR UPDATE OF "paymentHash", "proxyPaymentId"
  ON "ProxyForwardAttempt"
  FOR EACH ROW EXECUTE FUNCTION enforce_proxy_destination_invoice_owner();

-- Wake the listener pool when the singleton proxy wallet is enabled, disabled,
-- or rotated. The payload uses walletId so the listener's targeted reconcile
-- can treat this system wallet exactly like a RemoteWallet.
CREATE OR REPLACE FUNCTION notify_proxy_wallet_changed() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'remote_wallet_changed',
    json_build_object(
      'id',
      COALESCE(NEW."walletId", OLD."walletId"),
      'op',
      TG_OP
    )::text
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER proxy_wallet_changed_trigger
  AFTER INSERT OR UPDATE OR DELETE ON "ProxyServiceConfig"
  FOR EACH ROW EXECUTE FUNCTION notify_proxy_wallet_changed();
