-- CreateTable
CREATE TABLE "NwcConnection" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "walletPubkey" TEXT NOT NULL,
    "clientPubkey" TEXT NOT NULL,
    "clientSecret" TEXT NOT NULL,
    "relays" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "ownerUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NwcConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "nwcConnectionId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "eventKinds" INTEGER[] DEFAULT ARRAY[23196, 23197]::INTEGER[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NostrTriggerAdmin" (
    "id" TEXT NOT NULL,
    "pubkey" TEXT NOT NULL,
    "label" TEXT,
    "addedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NostrTriggerAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "actor" TEXT,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "payload" JSONB,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZapReceiptLedger" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "bolt11" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "zapRequest" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "relays" TEXT[],

    CONSTRAINT "ZapReceiptLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NwcConnection_walletPubkey_idx" ON "NwcConnection"("walletPubkey");

-- CreateIndex
CREATE INDEX "NwcConnection_ownerUserId_idx" ON "NwcConnection"("ownerUserId");

-- CreateIndex
CREATE INDEX "NwcConnection_enabled_idx" ON "NwcConnection"("enabled");

-- CreateIndex
CREATE INDEX "WebhookEndpoint_nwcConnectionId_idx" ON "WebhookEndpoint"("nwcConnectionId");

-- CreateIndex
CREATE UNIQUE INDEX "NostrTriggerAdmin_pubkey_key" ON "NostrTriggerAdmin"("pubkey");

-- CreateIndex
CREATE INDEX "AuditEvent_ts_idx" ON "AuditEvent"("ts");

-- CreateIndex
CREATE INDEX "AuditEvent_actor_idx" ON "AuditEvent"("actor");

-- CreateIndex
CREATE INDEX "AuditEvent_action_idx" ON "AuditEvent"("action");

-- CreateIndex
CREATE UNIQUE INDEX "ZapReceiptLedger_eventId_key" ON "ZapReceiptLedger"("eventId");

-- CreateIndex
CREATE INDEX "ZapReceiptLedger_recipient_idx" ON "ZapReceiptLedger"("recipient");

-- AddForeignKey
ALTER TABLE "NwcConnection" ADD CONSTRAINT "NwcConnection_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_nwcConnectionId_fkey" FOREIGN KEY ("nwcConnectionId") REFERENCES "NwcConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
