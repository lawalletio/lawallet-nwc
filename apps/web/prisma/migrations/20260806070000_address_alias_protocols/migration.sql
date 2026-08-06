-- Protocols an ALIAS target was found to support, captured when the redirect
-- was saved. Nullable: existing aliases have not been probed yet and report
-- "unknown" until their redirect is saved again.
ALTER TABLE "LightningAddress" ADD COLUMN "aliasProtocols" JSONB;
