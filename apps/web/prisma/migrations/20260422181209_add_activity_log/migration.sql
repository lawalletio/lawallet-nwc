-- CreateEnum
CREATE TYPE "ActivityCategory" AS ENUM ('USER', 'ADDRESS', 'NWC', 'INVOICE', 'CARD', 'SERVER');

-- CreateEnum
CREATE TYPE "ActivityLevel" AS ENUM ('INFO', 'WARN', 'ERROR');

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "category" "ActivityCategory" NOT NULL,
    "level" "ActivityLevel" NOT NULL DEFAULT 'INFO',
    "event" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "reqId" TEXT,
    "userId" TEXT,
    "metadata" JSONB,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_category_createdAt_idx" ON "ActivityLog"("category", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_level_createdAt_idx" ON "ActivityLog"("level", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_userId_createdAt_idx" ON "ActivityLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_reqId_idx" ON "ActivityLog"("reqId");

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
