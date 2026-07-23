-- PRF clean break: passkey identities are now derived CLIENT-SIDE from the
-- WebAuthn PRF extension. Credentials registered under the old server-custody
-- scheme cannot authenticate in the new model (their accounts' keys were
-- random, not PRF-derived), so they are removed outright. ManagedNostrKey
-- rows are intentionally retained (dormant; future bot accounts) — an
-- already-exported nsec remains the only way into a legacy passkey account.
DELETE FROM "PasskeyCredential";

-- AlterTable
ALTER TABLE "PasskeyCredential" ADD COLUMN     "pubkey" TEXT;
