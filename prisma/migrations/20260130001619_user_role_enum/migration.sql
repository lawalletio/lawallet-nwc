-- CreateEnum
CREATE TYPE "public"."UserRole" AS ENUM ('ADMIN', 'OPERATOR', 'VIEWER', 'USER');

-- Migrate existing data: normalize string values before converting
UPDATE "public"."User" SET "role" = 'ADMIN' WHERE "role" = 'root';
UPDATE "public"."User" SET "role" = 'ADMIN' WHERE "role" = 'admin';
UPDATE "public"."User" SET "role" = 'OPERATOR' WHERE "role" = 'operator';
UPDATE "public"."User" SET "role" = 'VIEWER' WHERE "role" = 'viewer';
UPDATE "public"."User" SET "role" = 'USER' WHERE "role" = 'user';
UPDATE "public"."User" SET "role" = 'USER' WHERE "role" IS NULL OR "role" NOT IN ('ADMIN', 'OPERATOR', 'VIEWER', 'USER');

-- AlterTable: convert column type using the migrated values
ALTER TABLE "public"."User"
  ALTER COLUMN "role" SET DEFAULT 'USER',
  ALTER COLUMN "role" SET NOT NULL,
  ALTER COLUMN "role" TYPE "public"."UserRole" USING "role"::"public"."UserRole";

-- CreateIndex
CREATE INDEX "User_role_idx" ON "public"."User"("role");
