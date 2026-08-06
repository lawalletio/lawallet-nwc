-- Removes the DEFAULT_NWC address mode, which routed an address through
-- "whatever wallet the owner's primary address happens to point at". Addresses
-- now always name their wallet explicitly.
--
-- Order matters: the rows must stop using the value before Postgres will let
-- it be dropped from the type.

-- 1. Bind each DEFAULT_NWC address to the wallet it resolves to today, so
--    payments keep landing in the same place.
UPDATE "LightningAddress" AS a
   SET "mode" = 'CUSTOM_NWC',
       "remoteWalletId" = p."remoteWalletId"
  FROM "LightningAddress" AS p
  JOIN "RemoteWallet" AS w ON w."id" = p."remoteWalletId"
 WHERE a."mode" = 'DEFAULT_NWC'
   AND p."userId" = a."userId"
   AND p."isPrimary" = TRUE
   AND w."status" = 'ACTIVE';

-- 2. Anything still on the old mode has no active wallet to bind. Disable it
--    rather than leave it advertising a wallet that isn't there.
UPDATE "LightningAddress"
   SET "mode" = 'IDLE',
       "remoteWalletId" = NULL
 WHERE "mode" = 'DEFAULT_NWC';

-- 3. Recreate the enum without the value (Postgres cannot drop one in place).
ALTER TYPE "LightningAddressMode" RENAME TO "LightningAddressMode_old";
CREATE TYPE "LightningAddressMode" AS ENUM ('IDLE', 'ALIAS', 'PROXY_ALIAS', 'CUSTOM_NWC');
ALTER TABLE "LightningAddress" ALTER COLUMN "mode" DROP DEFAULT;
ALTER TABLE "LightningAddress"
  ALTER COLUMN "mode" TYPE "LightningAddressMode"
  USING ("mode"::text::"LightningAddressMode");
ALTER TABLE "LightningAddress" ALTER COLUMN "mode" SET DEFAULT 'IDLE';
DROP TYPE "LightningAddressMode_old";
