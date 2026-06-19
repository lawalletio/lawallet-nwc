-- AlterTable: mark a card "blocked" once its reset (wipe) keys are exported.
ALTER TABLE "Card" ADD COLUMN     "blockedAt" TIMESTAMP(3);
