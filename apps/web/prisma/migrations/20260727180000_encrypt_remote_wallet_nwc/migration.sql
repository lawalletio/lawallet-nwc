-- The connection-string rewrite itself is performed by the mandatory
-- application startup migration. PostgreSQL migrations intentionally never
-- receive NWC_VAULT_SECRET. The timestamp makes completion observable and
-- lets rolling deployments distinguish legacy rows from encrypted writes.
ALTER TABLE "RemoteWallet"
ADD COLUMN "nwcConfigEncryptedAt" TIMESTAMP(3);

COMMENT ON COLUMN "RemoteWallet"."nwcConfigEncryptedAt" IS
'Set by the application after config.connectionString is encrypted with NWC_VAULT_SECRET';
