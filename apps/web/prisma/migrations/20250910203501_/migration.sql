-- CreateTable
CREATE TABLE "public"."Settings" (
    "name" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE INDEX "Settings_name_idx" ON "public"."Settings"("name");
