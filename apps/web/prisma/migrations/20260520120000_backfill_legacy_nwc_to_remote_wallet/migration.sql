-- Backfill every remaining legacy NWC connection into RemoteWallet so that
-- RemoteWallet is the single source of truth for wallets. The
-- 20260514120000 migration already copied NWCConnection rows forward (id
-- reuse); this covers:
--   1. The legacy single-URI `User.nwc` field (never migrated).
--   2. Any NWCConnection that — defensively — lacks a matching RemoteWallet.
--
-- Both inserts are guarded by NOT EXISTS so re-running is a no-op and we
-- never duplicate a connection that's already represented.

-- 1. NWCConnection → RemoteWallet (defensive; 20260514120000 reused ids, so
--    this only fires for rows that somehow weren't copied). Names are made
--    unique per user with a short hash of the connection string so they
--    can't collide with the (userId, name) unique index.
INSERT INTO "RemoteWallet" ("id", "userId", "name", "type", "config", "status", "isDefault", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  nc."userId",
  'NWC Wallet · ' || substr(md5(nc."connectionString"), 1, 6),
  'NWC'::"RemoteWalletType",
  jsonb_build_object('connectionString', nc."connectionString", 'mode', nc."mode"::text),
  'ACTIVE'::"RemoteWalletStatus",
  -- Become the default only if the user has no default wallet yet.
  (NOT EXISTS (SELECT 1 FROM "RemoteWallet" d WHERE d."userId" = nc."userId" AND d."isDefault" = true))
    AND nc."isPrimary",
  nc."createdAt",
  now()
FROM "NWCConnection" nc
WHERE NOT EXISTS (
  SELECT 1 FROM "RemoteWallet" rw
  WHERE rw."userId" = nc."userId"
    AND rw."config"->>'connectionString' = nc."connectionString"
);

-- 2. Legacy `User.nwc` → RemoteWallet. This single all-purpose URI was used
--    for both receiving (LUD-16) and card sending, so it maps to
--    SEND_RECEIVE.
INSERT INTO "RemoteWallet" ("id", "userId", "name", "type", "config", "status", "isDefault", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  u."id",
  'NWC Wallet · ' || substr(md5(u."nwc"), 1, 6),
  'NWC'::"RemoteWalletType",
  jsonb_build_object('connectionString', u."nwc", 'mode', 'SEND_RECEIVE'),
  'ACTIVE'::"RemoteWalletStatus",
  -- Only the user's primary if they don't already have one (e.g. from a
  -- wallet they added through the UI). Otherwise it's a non-default row.
  NOT EXISTS (SELECT 1 FROM "RemoteWallet" d WHERE d."userId" = u."id" AND d."isDefault" = true),
  COALESCE(u."nwcUpdatedAt", now()),
  now()
FROM "User" u
WHERE u."nwc" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "RemoteWallet" rw
    WHERE rw."userId" = u."id"
      AND rw."config"->>'connectionString' = u."nwc"
  );
