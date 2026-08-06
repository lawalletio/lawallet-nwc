-- Carry an unused routing reserve forward as pending balance instead of
-- silently retaining it in the source wallet.
ALTER TABLE "RemoteWalletForwardLeg"
  ADD COLUMN "residual" BOOLEAN NOT NULL DEFAULT false;
