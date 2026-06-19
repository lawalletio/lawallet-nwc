-- AlterEnum
ALTER TYPE "RemoteWalletStatus" ADD VALUE 'DEAD';

-- AlterTable
ALTER TABLE "RemoteWallet" ADD COLUMN     "diedAt" TIMESTAMP(3);
