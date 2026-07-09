-- The primary RemoteWallet is now derived from the account's primary
-- LightningAddress direct wallet binding. Keep RemoteWallet.isDefault as a
-- synchronized compatibility/display flag.

-- Legacy primary addresses in DEFAULT_NWC used the old default wallet
-- indirectly. Convert them to explicit CUSTOM_NWC links when such a wallet
-- exists, so the link becomes the source of truth.
UPDATE "LightningAddress" la
SET
  "mode" = 'CUSTOM_NWC'::"LightningAddressMode",
  "remoteWalletId" = rw."id",
  "redirect" = NULL
FROM "RemoteWallet" rw
WHERE
  la."userId" = rw."userId"
  AND la."isPrimary" = true
  AND la."mode" = 'DEFAULT_NWC'::"LightningAddressMode"
  AND rw."isDefault" = true;

-- A primary DEFAULT_NWC address without an old default wallet was already
-- unconfigured. Make that explicit and non-circular.
UPDATE "LightningAddress" la
SET
  "mode" = 'IDLE'::"LightningAddressMode",
  "remoteWalletId" = NULL,
  "redirect" = NULL
WHERE
  la."isPrimary" = true
  AND la."mode" = 'DEFAULT_NWC'::"LightningAddressMode"
  AND NOT EXISTS (
    SELECT 1
    FROM "RemoteWallet" rw
    WHERE rw."userId" = la."userId" AND rw."isDefault" = true
  );

-- Rebuild the compatibility flag entirely from primary CUSTOM_NWC links.
UPDATE "RemoteWallet"
SET "isDefault" = false
WHERE "isDefault" = true;

UPDATE "RemoteWallet" rw
SET "isDefault" = true
FROM "LightningAddress" la
WHERE
  la."userId" = rw."userId"
  AND la."isPrimary" = true
  AND la."mode" = 'CUSTOM_NWC'::"LightningAddressMode"
  AND la."remoteWalletId" = rw."id"
  AND rw."status" NOT IN ('REVOKED'::"RemoteWalletStatus", 'DEAD'::"RemoteWalletStatus");
