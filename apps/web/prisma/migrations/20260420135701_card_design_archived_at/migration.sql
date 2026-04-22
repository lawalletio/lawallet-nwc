-- Add `archivedAt` to CardDesign so designs can be soft-archived (hidden
-- from the default "Active" tab without removing them). NULL = active,
-- non-null timestamp = archived at that moment.
ALTER TABLE "CardDesign" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- Composite-ish index on the archive flag so the list route can filter
-- `WHERE archivedAt IS NULL` (or NOT NULL) without a seq scan once the
-- design catalogue grows.
CREATE INDEX "CardDesign_archivedAt_idx" ON "CardDesign"("archivedAt");
