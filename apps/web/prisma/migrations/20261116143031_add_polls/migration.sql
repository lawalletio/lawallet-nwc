-- CreateEnum
CREATE TYPE "PollType" AS ENUM ('RANKING', 'SINGLE_CHOICE');

-- CreateEnum
CREATE TYPE "PollStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "Poll" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "PollType" NOT NULL,
    "options" JSONB NOT NULL,
    "allowCustom" BOOLEAN NOT NULL DEFAULT false,
    "updatable" BOOLEAN NOT NULL DEFAULT true,
    "status" "PollStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Poll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollResponse" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "choices" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PollResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Poll_slug_key" ON "Poll"("slug");

-- CreateIndex
CREATE INDEX "PollResponse_userId_idx" ON "PollResponse"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PollResponse_pollId_userId_key" ON "PollResponse"("pollId", "userId");

-- AddForeignKey
ALTER TABLE "PollResponse" ADD CONSTRAINT "PollResponse_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollResponse" ADD CONSTRAINT "PollResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the first poll: which rails users want USDT on.
INSERT INTO "Poll" ("id", "slug", "title", "description", "type", "options", "allowCustom", "updatable", "status", "createdAt", "updatedAt")
VALUES (
  'poll_usdt_tech',
  'usdt-tech',
  'USDT tech',
  'Rank the rails you want USDT on.',
  'RANKING',
  '[{"id":"tron","label":"Tron"},{"id":"polygon","label":"Polygon"},{"id":"liquid","label":"Liquid"},{"id":"taproot-assets","label":"Taproot Assets (Taro)"},{"id":"rgb","label":"RGB"}]'::jsonb,
  true,
  true,
  'OPEN',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT DO NOTHING;
