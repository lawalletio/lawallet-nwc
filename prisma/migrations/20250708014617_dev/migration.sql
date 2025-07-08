-- CreateTable
CREATE TABLE "CardDesign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "imageUrl" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pubkey" TEXT
);

-- CreateTable
CREATE TABLE "Ntag424" (
    "cid" TEXT NOT NULL PRIMARY KEY,
    "k0" TEXT NOT NULL,
    "k1" TEXT NOT NULL,
    "k2" TEXT NOT NULL,
    "k3" TEXT NOT NULL,
    "k4" TEXT NOT NULL,
    "ctr" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pubkey" TEXT
);

-- CreateTable
CREATE TABLE "LightningAddress" (
    "username" TEXT NOT NULL PRIMARY KEY,
    "pubkey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nwc" TEXT
);

-- CreateTable
CREATE TABLE "Card" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "designId" TEXT NOT NULL,
    "ntag424Cid" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "title" TEXT,
    "lastUsedAt" DATETIME,
    "pubkey" TEXT,
    "username" TEXT,
    CONSTRAINT "Card_designId_fkey" FOREIGN KEY ("designId") REFERENCES "CardDesign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Card_ntag424Cid_fkey" FOREIGN KEY ("ntag424Cid") REFERENCES "Ntag424" ("cid") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CardDesign_pubkey_idx" ON "CardDesign"("pubkey");

-- CreateIndex
CREATE INDEX "Ntag424_pubkey_idx" ON "Ntag424"("pubkey");

-- CreateIndex
CREATE INDEX "LightningAddress_pubkey_idx" ON "LightningAddress"("pubkey");

-- CreateIndex
CREATE UNIQUE INDEX "Card_ntag424Cid_key" ON "Card"("ntag424Cid");

-- CreateIndex
CREATE INDEX "Card_pubkey_idx" ON "Card"("pubkey");
