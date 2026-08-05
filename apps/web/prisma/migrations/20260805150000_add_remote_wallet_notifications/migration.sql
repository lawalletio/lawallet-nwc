CREATE TYPE "RemoteWalletNotificationChannel" AS ENUM ('WEBHOOK', 'NOSTR');
CREATE TYPE "RemoteWalletNotificationAction" AS ENUM ('RECEIVED', 'FORWARDED');
CREATE TYPE "RemoteWalletNotificationDeliveryStatus" AS ENUM (
  'READY', 'PENDING', 'UNKNOWN', 'REJECTED', 'SUCCEEDED', 'EXPIRED'
);
CREATE TYPE "RemoteWalletNotificationAttemptStatus" AS ENUM (
  'PENDING', 'UNKNOWN', 'REJECTED', 'SUCCEEDED', 'EXPIRED'
);

CREATE TABLE "RemoteWalletNotification" (
  "id" TEXT NOT NULL,
  "remoteWalletId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "channel" "RemoteWalletNotificationChannel" NOT NULL,
  "action" "RemoteWalletNotificationAction" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "pausedAt" TIMESTAMP(3),
  "webhookUrl" TEXT,
  "nostrKind" INTEGER,
  "nostrRecipient" TEXT,
  "nostrRelays" JSONB,
  "nostrContent" TEXT,
  "nip44" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RemoteWalletNotification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RemoteWalletNotification_channel_config_check" CHECK (
    (
      "channel" = 'WEBHOOK'::"RemoteWalletNotificationChannel"
      AND "webhookUrl" IS NOT NULL
      AND "nostrKind" IS NULL
      AND "nostrRecipient" IS NULL
      AND "nostrRelays" IS NULL
    ) OR (
      "channel" = 'NOSTR'::"RemoteWalletNotificationChannel"
      AND "webhookUrl" IS NULL
      AND "nostrKind" IS NOT NULL
      AND "nostrRecipient" IS NOT NULL
      AND "nostrRelays" IS NOT NULL
    )
  ),
  CONSTRAINT "RemoteWalletNotification_nostr_kind_check" CHECK (
    "nostrKind" IS NULL OR "nostrKind" BETWEEN 0 AND 2147483647
  )
);

CREATE INDEX "RemoteWalletNotification_remoteWalletId_createdAt_idx"
  ON "RemoteWalletNotification"("remoteWalletId", "createdAt");
CREATE INDEX "RemoteWalletNotification_remoteWalletId_action_enabled_idx"
  ON "RemoteWalletNotification"("remoteWalletId", "action", "enabled");

CREATE TABLE "RemoteWalletNotificationDelivery" (
  "id" TEXT NOT NULL,
  "notificationId" TEXT NOT NULL,
  "walletId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "action" "RemoteWalletNotificationAction" NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "RemoteWalletNotificationDeliveryStatus" NOT NULL DEFAULT 'READY',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "nextRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RemoteWalletNotificationDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RemoteWalletNotificationDelivery_attempt_count_check"
    CHECK ("attemptCount" >= 0)
);

CREATE UNIQUE INDEX "RemoteWalletNotificationDelivery_notificationId_eventKey_key"
  ON "RemoteWalletNotificationDelivery"("notificationId", "eventKey");
CREATE INDEX "RemoteWalletNotificationDelivery_walletId_createdAt_idx"
  ON "RemoteWalletNotificationDelivery"("walletId", "createdAt");
CREATE INDEX "RemoteWalletNotificationDelivery_userId_createdAt_idx"
  ON "RemoteWalletNotificationDelivery"("userId", "createdAt");
CREATE INDEX "RemoteWalletNotificationDelivery_status_nextRetryAt_idx"
  ON "RemoteWalletNotificationDelivery"("status", "nextRetryAt");
CREATE INDEX "RemoteWalletNotificationDelivery_leaseExpiresAt_idx"
  ON "RemoteWalletNotificationDelivery"("leaseExpiresAt");

CREATE TABLE "RemoteWalletNotificationAttempt" (
  "id" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "attemptNo" INTEGER NOT NULL,
  "requestId" TEXT NOT NULL,
  "status" "RemoteWalletNotificationAttemptStatus" NOT NULL DEFAULT 'PENDING',
  "responseStatus" INTEGER,
  "responseBody" TEXT,
  "nostrEventId" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "RemoteWalletNotificationAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RemoteWalletNotificationAttempt_number_check"
    CHECK ("attemptNo" > 0)
);

CREATE UNIQUE INDEX "RemoteWalletNotificationAttempt_requestId_key"
  ON "RemoteWalletNotificationAttempt"("requestId");
CREATE UNIQUE INDEX "RemoteWalletNotificationAttempt_deliveryId_attemptNo_key"
  ON "RemoteWalletNotificationAttempt"("deliveryId", "attemptNo");
CREATE INDEX "RemoteWalletNotificationAttempt_deliveryId_createdAt_idx"
  ON "RemoteWalletNotificationAttempt"("deliveryId", "createdAt");
CREATE INDEX "RemoteWalletNotificationAttempt_status_createdAt_idx"
  ON "RemoteWalletNotificationAttempt"("status", "createdAt");

ALTER TABLE "RemoteWalletNotification"
  ADD CONSTRAINT "RemoteWalletNotification_remoteWalletId_fkey"
  FOREIGN KEY ("remoteWalletId") REFERENCES "RemoteWallet"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RemoteWalletNotificationDelivery"
  ADD CONSTRAINT "RemoteWalletNotificationDelivery_notificationId_fkey"
  FOREIGN KEY ("notificationId") REFERENCES "RemoteWalletNotification"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RemoteWalletNotificationDelivery"
  ADD CONSTRAINT "RemoteWalletNotificationDelivery_walletId_fkey"
  FOREIGN KEY ("walletId") REFERENCES "RemoteWallet"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RemoteWalletNotificationDelivery"
  ADD CONSTRAINT "RemoteWalletNotificationDelivery_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RemoteWalletNotificationAttempt"
  ADD CONSTRAINT "RemoteWalletNotificationAttempt_deliveryId_fkey"
  FOREIGN KEY ("deliveryId") REFERENCES "RemoteWalletNotificationDelivery"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
