-- CreateEnum
CREATE TYPE "RemoteWalletCustody" AS ENUM ('BOTH', 'BACKEND', 'LOCAL');

-- AlterTable: every existing wallet keeps today's behaviour (BOTH).
ALTER TABLE "RemoteWallet" ADD COLUMN "custody" "RemoteWalletCustody" NOT NULL DEFAULT 'BOTH';
