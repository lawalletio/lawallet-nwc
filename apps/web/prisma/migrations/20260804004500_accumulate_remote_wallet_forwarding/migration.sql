ALTER TABLE "RemoteWalletForwardLeg"
ADD COLUMN "batchAnchorId" TEXT;

CREATE INDEX "RemoteWalletForwardLeg_batchAnchorId_status_idx"
ON "RemoteWalletForwardLeg"("batchAnchorId", "status");

ALTER TABLE "RemoteWalletForwardLeg"
ADD CONSTRAINT "RemoteWalletForwardLeg_batchAnchorId_fkey"
FOREIGN KEY ("batchAnchorId")
REFERENCES "RemoteWalletForwardLeg"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
