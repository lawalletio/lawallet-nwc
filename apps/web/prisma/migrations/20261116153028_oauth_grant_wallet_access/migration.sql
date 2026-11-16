-- AlterTable
ALTER TABLE "OAuthGrant" ADD COLUMN     "allWallets" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "walletIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
