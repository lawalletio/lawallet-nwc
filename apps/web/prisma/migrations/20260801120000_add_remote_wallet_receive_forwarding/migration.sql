CREATE TYPE "RemoteWalletReceiveActionType" AS ENUM ('FORWARD');

CREATE TYPE "RemoteWalletForwardReceiptStatus" AS ENUM (
  'RECEIVED', 'FORWARDING', 'PARTIAL', 'BLOCKED', 'COMPLETED', 'RETAINED'
);

CREATE TYPE "RemoteWalletForwardLegStatus" AS ENUM (
  'READY', 'PENDING', 'UNKNOWN', 'REJECTED', 'SUCCEEDED', 'EXPIRED', 'SUPERSEDED'
);

CREATE TYPE "RemoteWalletForwardAttemptStatus" AS ENUM (
  'PENDING', 'UNKNOWN', 'REJECTED', 'SUCCEEDED', 'EXPIRED'
);

CREATE TABLE "RemoteWalletReceiveAction" (
  "id" TEXT NOT NULL,
  "remoteWalletId" TEXT NOT NULL,
  "type" "RemoteWalletReceiveActionType" NOT NULL DEFAULT 'FORWARD',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "enabledAt" TIMESTAMP(3),
  "pausedAt" TIMESTAMP(3),
  "currentRevisionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RemoteWalletReceiveAction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RemoteWalletReceiveAction_enabled_revision_check"
    CHECK (NOT "enabled" OR "currentRevisionId" IS NOT NULL)
);

CREATE UNIQUE INDEX "RemoteWalletReceiveAction_remoteWalletId_key"
  ON "RemoteWalletReceiveAction"("remoteWalletId");
CREATE UNIQUE INDEX "RemoteWalletReceiveAction_currentRevisionId_key"
  ON "RemoteWalletReceiveAction"("currentRevisionId");
CREATE INDEX "RemoteWalletReceiveAction_enabled_enabledAt_idx"
  ON "RemoteWalletReceiveAction"("enabled", "enabledAt");

CREATE TABLE "RemoteWalletReceiveActionRevision" (
  "id" TEXT NOT NULL,
  "actionId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "feeBps" INTEGER NOT NULL DEFAULT 50,
  "baseFeeMsats" BIGINT NOT NULL DEFAULT 1000,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RemoteWalletReceiveActionRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RemoteWalletReceiveActionRevision_fee_check"
    CHECK ("feeBps" BETWEEN 0 AND 1000 AND "baseFeeMsats" >= 0)
);

CREATE UNIQUE INDEX "RemoteWalletReceiveActionRevision_actionId_revision_key"
  ON "RemoteWalletReceiveActionRevision"("actionId", "revision");
CREATE INDEX "RemoteWalletReceiveActionRevision_actionId_createdAt_idx"
  ON "RemoteWalletReceiveActionRevision"("actionId", "createdAt");

CREATE TABLE "RemoteWalletForwardDestination" (
  "id" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "address" TEXT NOT NULL,
  "allocationBps" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RemoteWalletForwardDestination_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RemoteWalletForwardDestination_allocation_check"
    CHECK ("position" >= 0 AND "allocationBps" BETWEEN 1 AND 10000)
);

CREATE UNIQUE INDEX "RemoteWalletForwardDestination_revisionId_position_key"
  ON "RemoteWalletForwardDestination"("revisionId", "position");
CREATE UNIQUE INDEX "RemoteWalletForwardDestination_revisionId_address_key"
  ON "RemoteWalletForwardDestination"("revisionId", "address");
CREATE INDEX "RemoteWalletForwardDestination_revisionId_idx"
  ON "RemoteWalletForwardDestination"("revisionId");

CREATE TABLE "RemoteWalletForwardReceipt" (
  "id" TEXT NOT NULL,
  "actionId" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "walletId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "sourcePaymentHash" TEXT NOT NULL,
  "sourceInvoice" TEXT,
  "grossAmountMsats" BIGINT NOT NULL,
  "retainedFeeMsats" BIGINT NOT NULL,
  "targetAmountMsats" BIGINT NOT NULL,
  "forwardedAmountMsats" BIGINT NOT NULL DEFAULT 0,
  "routingFeeMsats" BIGINT NOT NULL DEFAULT 0,
  "shortfallMsats" BIGINT NOT NULL DEFAULT 0,
  "configRevision" INTEGER NOT NULL,
  "status" "RemoteWalletForwardReceiptStatus" NOT NULL DEFAULT 'RECEIVED',
  "recovered" BOOLEAN NOT NULL DEFAULT false,
  "sourceSettledAt" TIMESTAMP(3) NOT NULL,
  "lastError" TEXT,
  "nextRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RemoteWalletForwardReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RemoteWalletForwardReceipt_amounts_check" CHECK (
    "grossAmountMsats" >= 0
    AND "retainedFeeMsats" >= 0
    AND "targetAmountMsats" >= 0
    AND "grossAmountMsats" = "retainedFeeMsats" + "targetAmountMsats"
    AND "forwardedAmountMsats" >= 0
    AND "forwardedAmountMsats" <= "targetAmountMsats"
    AND "routingFeeMsats" >= 0
    AND "shortfallMsats" >= 0
  )
);

CREATE UNIQUE INDEX "RemoteWalletForwardReceipt_eventKey_key"
  ON "RemoteWalletForwardReceipt"("eventKey");
CREATE UNIQUE INDEX "RemoteWalletForwardReceipt_walletId_sourcePaymentHash_key"
  ON "RemoteWalletForwardReceipt"("walletId", "sourcePaymentHash");
CREATE INDEX "RemoteWalletForwardReceipt_userId_createdAt_idx"
  ON "RemoteWalletForwardReceipt"("userId", "createdAt");
CREATE INDEX "RemoteWalletForwardReceipt_walletId_createdAt_idx"
  ON "RemoteWalletForwardReceipt"("walletId", "createdAt");
CREATE INDEX "RemoteWalletForwardReceipt_status_nextRetryAt_idx"
  ON "RemoteWalletForwardReceipt"("status", "nextRetryAt");
CREATE INDEX "RemoteWalletForwardReceipt_leaseExpiresAt_idx"
  ON "RemoteWalletForwardReceipt"("leaseExpiresAt");

CREATE TABLE "RemoteWalletForwardLeg" (
  "id" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "destination" TEXT NOT NULL,
  "allocationBps" INTEGER NOT NULL,
  "requestedAmountMsats" BIGINT NOT NULL,
  "forwardedAmountMsats" BIGINT,
  "routingFeeMsats" BIGINT,
  "destinationShortfallMsats" BIGINT NOT NULL DEFAULT 0,
  "status" "RemoteWalletForwardLegStatus" NOT NULL DEFAULT 'READY',
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "nextRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT,
  "supersededAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RemoteWalletForwardLeg_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RemoteWalletForwardLeg_amounts_check" CHECK (
    "position" >= 0
    AND "allocationBps" BETWEEN 1 AND 10000
    AND "requestedAmountMsats" > 0
    AND ("forwardedAmountMsats" IS NULL OR "forwardedAmountMsats" > 0)
    AND ("routingFeeMsats" IS NULL OR "routingFeeMsats" >= 0)
    AND "destinationShortfallMsats" >= 0
    AND "retryCount" >= 0
  )
);

CREATE UNIQUE INDEX "RemoteWalletForwardLeg_receiptId_position_key"
  ON "RemoteWalletForwardLeg"("receiptId", "position");
CREATE INDEX "RemoteWalletForwardLeg_receiptId_status_idx"
  ON "RemoteWalletForwardLeg"("receiptId", "status");
CREATE INDEX "RemoteWalletForwardLeg_status_nextRetryAt_idx"
  ON "RemoteWalletForwardLeg"("status", "nextRetryAt");

CREATE TABLE "RemoteWalletForwardAttempt" (
  "id" TEXT NOT NULL,
  "legId" TEXT NOT NULL,
  "attemptNo" INTEGER NOT NULL,
  "bolt11" TEXT NOT NULL,
  "paymentHash" TEXT NOT NULL,
  "amountMsats" BIGINT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "requestId" TEXT NOT NULL,
  "status" "RemoteWalletForwardAttemptStatus" NOT NULL DEFAULT 'PENDING',
  "preimage" TEXT,
  "routingFeeMsats" BIGINT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "RemoteWalletForwardAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RemoteWalletForwardAttempt_amounts_check" CHECK (
    "attemptNo" > 0 AND "amountMsats" > 0
    AND ("routingFeeMsats" IS NULL OR "routingFeeMsats" >= 0)
  )
);

CREATE UNIQUE INDEX "RemoteWalletForwardAttempt_requestId_key"
  ON "RemoteWalletForwardAttempt"("requestId");
CREATE UNIQUE INDEX "RemoteWalletForwardAttempt_legId_attemptNo_key"
  ON "RemoteWalletForwardAttempt"("legId", "attemptNo");
CREATE INDEX "RemoteWalletForwardAttempt_legId_createdAt_idx"
  ON "RemoteWalletForwardAttempt"("legId", "createdAt");
CREATE INDEX "RemoteWalletForwardAttempt_paymentHash_idx"
  ON "RemoteWalletForwardAttempt"("paymentHash");
CREATE INDEX "RemoteWalletForwardAttempt_status_updatedAt_idx"
  ON "RemoteWalletForwardAttempt"("status", "updatedAt");

ALTER TABLE "RemoteWalletReceiveAction"
  ADD CONSTRAINT "RemoteWalletReceiveAction_remoteWalletId_fkey"
  FOREIGN KEY ("remoteWalletId") REFERENCES "RemoteWallet"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RemoteWalletReceiveActionRevision"
  ADD CONSTRAINT "RemoteWalletReceiveActionRevision_actionId_fkey"
  FOREIGN KEY ("actionId") REFERENCES "RemoteWalletReceiveAction"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RemoteWalletReceiveAction"
  ADD CONSTRAINT "RemoteWalletReceiveAction_currentRevisionId_fkey"
  FOREIGN KEY ("currentRevisionId") REFERENCES "RemoteWalletReceiveActionRevision"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RemoteWalletForwardDestination"
  ADD CONSTRAINT "RemoteWalletForwardDestination_revisionId_fkey"
  FOREIGN KEY ("revisionId") REFERENCES "RemoteWalletReceiveActionRevision"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RemoteWalletForwardReceipt"
  ADD CONSTRAINT "RemoteWalletForwardReceipt_actionId_fkey"
  FOREIGN KEY ("actionId") REFERENCES "RemoteWalletReceiveAction"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RemoteWalletForwardReceipt"
  ADD CONSTRAINT "RemoteWalletForwardReceipt_revisionId_fkey"
  FOREIGN KEY ("revisionId") REFERENCES "RemoteWalletReceiveActionRevision"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RemoteWalletForwardReceipt"
  ADD CONSTRAINT "RemoteWalletForwardReceipt_walletId_fkey"
  FOREIGN KEY ("walletId") REFERENCES "RemoteWallet"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RemoteWalletForwardReceipt"
  ADD CONSTRAINT "RemoteWalletForwardReceipt_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RemoteWalletForwardLeg"
  ADD CONSTRAINT "RemoteWalletForwardLeg_receiptId_fkey"
  FOREIGN KEY ("receiptId") REFERENCES "RemoteWalletForwardReceipt"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RemoteWalletForwardAttempt"
  ADD CONSTRAINT "RemoteWalletForwardAttempt_legId_fkey"
  FOREIGN KEY ("legId") REFERENCES "RemoteWalletForwardLeg"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Application validation gives fast feedback; this deferred constraint is
-- the final guard that every committed immutable revision allocates 100%.
CREATE OR REPLACE FUNCTION enforce_remote_wallet_forward_allocation_total()
RETURNS trigger AS $$
DECLARE
  revision_id text;
BEGIN
  revision_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."revisionId" ELSE NEW."revisionId" END;
  IF EXISTS (
    SELECT 1 FROM "RemoteWalletReceiveActionRevision" WHERE "id" = revision_id
  ) AND (
    SELECT COALESCE(SUM("allocationBps"), 0)
      FROM "RemoteWalletForwardDestination"
     WHERE "revisionId" = revision_id
  ) <> 10000 THEN
    RAISE EXCEPTION 'forwarding destination allocations must total 10000 bps'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."revisionId" <> NEW."revisionId"
     AND EXISTS (
       SELECT 1 FROM "RemoteWalletReceiveActionRevision" WHERE "id" = OLD."revisionId"
     ) AND (
       SELECT COALESCE(SUM("allocationBps"), 0)
         FROM "RemoteWalletForwardDestination"
        WHERE "revisionId" = OLD."revisionId"
     ) <> 10000 THEN
    RAISE EXCEPTION 'forwarding destination allocations must total 10000 bps'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER remote_wallet_forward_allocation_total_trigger
  AFTER INSERT OR UPDATE OR DELETE ON "RemoteWalletForwardDestination"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_remote_wallet_forward_allocation_total();

-- The same Lightning invoice must never satisfy two forwarding obligations,
-- including one from each proxy engine. Serialize ownership by payment hash.
CREATE OR REPLACE FUNCTION enforce_proxy_destination_invoice_owner()
RETURNS trigger AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."paymentHash", 0));
  IF EXISTS (
    SELECT 1 FROM "ProxyForwardAttempt"
     WHERE "paymentHash" = NEW."paymentHash"
       AND "proxyPaymentId" <> NEW."proxyPaymentId"
  ) OR EXISTS (
    SELECT 1 FROM "RemoteWalletForwardAttempt"
     WHERE "paymentHash" = NEW."paymentHash"
  ) THEN
    RAISE EXCEPTION 'destination invoice is already owned by another forwarding operation'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION enforce_remote_wallet_destination_invoice_owner()
RETURNS trigger AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."paymentHash", 0));
  IF EXISTS (
    SELECT 1 FROM "RemoteWalletForwardAttempt" a
     WHERE a."paymentHash" = NEW."paymentHash"
       AND a."legId" <> NEW."legId"
  ) OR EXISTS (
    SELECT 1 FROM "ProxyForwardAttempt"
     WHERE "paymentHash" = NEW."paymentHash"
  ) THEN
    RAISE EXCEPTION 'destination invoice is already owned by another forwarding operation'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER remote_wallet_destination_invoice_owner_trigger
  BEFORE INSERT OR UPDATE OF "paymentHash", "legId"
  ON "RemoteWalletForwardAttempt"
  FOR EACH ROW EXECUTE FUNCTION enforce_remote_wallet_destination_invoice_owner();
