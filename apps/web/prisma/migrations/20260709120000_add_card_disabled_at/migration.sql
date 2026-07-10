-- AlterTable: reversible owner-controlled card pause state.
ALTER TABLE "Card" ADD COLUMN     "disabledAt" TIMESTAMP(3);
