-- CreateTable
CREATE TABLE "PluginRecord" (
    "id" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PluginRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PluginRecord_pluginId_kind_idx" ON "PluginRecord"("pluginId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "PluginRecord_pluginId_kind_key_key" ON "PluginRecord"("pluginId", "kind", "key");
