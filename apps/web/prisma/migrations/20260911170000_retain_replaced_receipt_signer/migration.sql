-- Let startup replace an unusable NIP-57 receipt signer without ever
-- destroying the displaced one.
--
-- `getZapReceiptCapability()` is the only gate on `allowsNostr` /
-- `nostrPubkey` in the LUD-16 payRequest, and it goes false whenever
-- `receiptNsecCiphertext` won't decrypt. One unreadable blob therefore turns
-- zaps off for EVERY NWC wallet on the instance, and nothing recovers the key
-- itself, so the repair has to be a fresh key.
--
-- Replacing was previously gated on another NWC credential proving the active
-- secret, purely so a misconfigured NWC_VAULT_SECRET couldn't overwrite a key
-- the correct secret could still open. Retaining the displaced ciphertext
-- removes that trade-off: the replacement can be unconditional (zaps always
-- recover) because the original is still there to restore if the real secret
-- comes back.
ALTER TABLE "ProxyServiceConfig" ADD COLUMN     "receiptNsecRetiredCiphertext" BYTEA,
ADD COLUMN     "receiptPubkeyRetired" TEXT,
ADD COLUMN     "receiptSignerReplacedAt" TIMESTAMP(3);
