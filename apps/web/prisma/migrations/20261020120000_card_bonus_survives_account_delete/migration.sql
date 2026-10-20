-- Account deletion (DELETE /api/account) must not erase a card's one-shot
-- activation bonus record, or the bonus re-arms for the card's next holder.
ALTER TABLE "CardActivationBonus" DROP CONSTRAINT "CardActivationBonus_userId_fkey";

ALTER TABLE "CardActivationBonus" ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE "CardActivationBonus" ADD CONSTRAINT "CardActivationBonus_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
