-- Poll voter dismissal moves from one response to the user (all polls).

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "pollsDismissedAt" TIMESTAMP(3);

-- Carry existing per-poll dismissals over to their users.
UPDATE "User" u
SET "pollsDismissedAt" = d."dismissedAt"
FROM (
  SELECT "userId", MIN("dismissedAt") AS "dismissedAt"
  FROM "PollResponse"
  WHERE "dismissedAt" IS NOT NULL
  GROUP BY "userId"
) d
WHERE u."id" = d."userId";

-- AlterTable
ALTER TABLE "PollResponse" DROP COLUMN "dismissedAt";
