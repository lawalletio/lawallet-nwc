-- Accounts can link several verified emails (EmailIdentity), replacing the
-- single User.email column. Existing emails are carried over before the
-- column is dropped. EmailLoginToken.linkUserId marks "link to my account"
-- tokens so they can never be used to sign in (and vice versa).

-- CreateTable
CREATE TABLE "EmailIdentity" (
    "email" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailIdentity_pkey" PRIMARY KEY ("email")
);

-- CreateIndex
CREATE INDEX "EmailIdentity_userId_idx" ON "EmailIdentity"("userId");

-- AddForeignKey
ALTER TABLE "EmailIdentity" ADD CONSTRAINT "EmailIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill from the old single-email column
INSERT INTO "EmailIdentity" ("email", "userId", "createdAt")
SELECT "email", "id", CURRENT_TIMESTAMP FROM "User" WHERE "email" IS NOT NULL;

-- DropIndex
DROP INDEX "User_email_key";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "email";

-- AlterTable
ALTER TABLE "EmailLoginToken" ADD COLUMN     "linkUserId" TEXT;
