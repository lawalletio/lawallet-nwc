-- Drop the legacy NWC schema now that RemoteWallet is the single source of
-- truth. Every legacy connection was copied into RemoteWallet by the
-- 20260520120000 backfill, so these drops are safe.

-- LightningAddress → NWCConnection link
ALTER TABLE "LightningAddress" DROP CONSTRAINT IF EXISTS "LightningAddress_nwcConnectionId_fkey";
DROP INDEX IF EXISTS "LightningAddress_nwcConnectionId_idx";
ALTER TABLE "LightningAddress" DROP COLUMN IF EXISTS "nwcConnectionId";

-- The NWCConnection table itself
DROP TABLE IF EXISTS "NWCConnection";

-- Legacy single-URI columns on User
ALTER TABLE "User" DROP COLUMN IF EXISTS "nwc";
ALTER TABLE "User" DROP COLUMN IF EXISTS "nwcUpdatedAt";

-- The NwcMode enum was only used by NWCConnection.mode
DROP TYPE IF EXISTS "NwcMode";
