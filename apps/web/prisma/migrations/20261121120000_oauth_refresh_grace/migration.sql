-- AlterTable
ALTER TABLE "OAuthGrant" ADD COLUMN     "previousRefreshGraceEndsAt" TIMESTAMP(3),
ADD COLUMN     "previousRefreshTokenHash" TEXT,
ADD COLUMN     "rotationKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "OAuthGrant_previousRefreshTokenHash_key" ON "OAuthGrant"("previousRefreshTokenHash");
