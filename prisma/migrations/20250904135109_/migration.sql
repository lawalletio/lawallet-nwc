-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pubkey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nwc" TEXT,
    "albyEnabled" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "CardDesign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "imageUrl" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    CONSTRAINT "CardDesign_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
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
    "userId" TEXT,
    CONSTRAINT "Ntag424_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LightningAddress" (
    "username" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LightningAddress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Card" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "designId" TEXT NOT NULL,
    "ntag424Cid" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "title" TEXT,
    "lastUsedAt" DATETIME,
    "userId" TEXT,
    "username" TEXT,
    "otc" TEXT,
    CONSTRAINT "Card_designId_fkey" FOREIGN KEY ("designId") REFERENCES "CardDesign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Card_ntag424Cid_fkey" FOREIGN KEY ("ntag424Cid") REFERENCES "Ntag424" ("cid") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Card_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AlbySubAccount" (
    "appId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "username" TEXT,
    "nwcUri" TEXT NOT NULL,
    "nostrPubkey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AlbySubAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_pubkey_key" ON "User"("pubkey");

-- CreateIndex
CREATE INDEX "CardDesign_userId_idx" ON "CardDesign"("userId");

-- CreateIndex
CREATE INDEX "Ntag424_userId_idx" ON "Ntag424"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LightningAddress_userId_key" ON "LightningAddress"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Card_ntag424Cid_key" ON "Card"("ntag424Cid");

-- CreateIndex
CREATE INDEX "Card_userId_idx" ON "Card"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AlbySubAccount_userId_key" ON "AlbySubAccount"("userId");
