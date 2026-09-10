-- Drop the unused Alby Hub integration. Courtesy wallets are provisioned via
-- LNCurl + RemoteWallet; the dedicated AlbySubAccount table, User.albyEnabled
-- flag, and leftover Settings keys are no longer read.

ALTER TABLE "AlbySubAccount" DROP CONSTRAINT IF EXISTS "AlbySubAccount_userId_fkey";
DROP INDEX IF EXISTS "AlbySubAccount_userId_key";
DROP TABLE IF EXISTS "AlbySubAccount";

ALTER TABLE "User" DROP COLUMN IF EXISTS "albyEnabled";

DELETE FROM "Settings"
WHERE "name" IN ('alby_api_url', 'alby_bearer_token', 'alby_auto_generate');
