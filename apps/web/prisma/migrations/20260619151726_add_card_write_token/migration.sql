-- AlterTable: one-time, replay-protected BoltCard programming token.
ALTER TABLE "Card" ADD COLUMN     "writeToken" TEXT,
ADD COLUMN     "writeTokenExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Card_writeToken_key" ON "Card"("writeToken");
