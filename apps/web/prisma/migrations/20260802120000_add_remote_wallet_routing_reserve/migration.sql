ALTER TABLE "RemoteWalletReceiveAction"
  ADD COLUMN "leaseOwner" TEXT,
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

CREATE INDEX "RemoteWalletReceiveAction_leaseExpiresAt_idx"
  ON "RemoteWalletReceiveAction"("leaseExpiresAt");

ALTER TABLE "RemoteWalletForwardReceipt"
  ADD COLUMN "routingReserveMsats" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "unusedRoutingReserveMsats" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "routingFeeOverageMsats" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "RemoteWalletForwardLeg"
  ADD COLUMN "routingReserveMsats" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "unusedRoutingReserveMsats" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "routingFeeOverageMsats" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "RemoteWalletForwardAttempt"
  ADD COLUMN "routingReserveMsats" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "RemoteWalletForwardReceipt"
  ADD CONSTRAINT "RemoteWalletForwardReceipt_routing_reserve_check" CHECK (
    "routingReserveMsats" >= 0
    AND "unusedRoutingReserveMsats" >= 0
    AND "unusedRoutingReserveMsats" <= "routingReserveMsats"
    AND "routingFeeOverageMsats" >= 0
  );

ALTER TABLE "RemoteWalletForwardLeg"
  ADD CONSTRAINT "RemoteWalletForwardLeg_routing_reserve_check" CHECK (
    "routingReserveMsats" >= 0
    AND "routingReserveMsats" <= "requestedAmountMsats"
    AND "unusedRoutingReserveMsats" >= 0
    AND "unusedRoutingReserveMsats" <= "routingReserveMsats"
    AND "routingFeeOverageMsats" >= 0
  );

ALTER TABLE "RemoteWalletForwardAttempt"
  ADD CONSTRAINT "RemoteWalletForwardAttempt_routing_reserve_check" CHECK (
    "routingReserveMsats" >= 0
  );
