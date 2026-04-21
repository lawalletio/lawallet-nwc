-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "pubkey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nwc" TEXT,
    "albyEnabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CardDesign" (
    "id" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,

    CONSTRAINT "CardDesign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Ntag424" (
    "cid" TEXT NOT NULL,
    "k0" TEXT NOT NULL,
    "k1" TEXT NOT NULL,
    "k2" TEXT NOT NULL,
    "k3" TEXT NOT NULL,
    "k4" TEXT NOT NULL,
    "ctr" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,

    CONSTRAINT "Ntag424_pkey" PRIMARY KEY ("cid")
);

-- CreateTable
CREATE TABLE "public"."LightningAddress" (
    "username" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LightningAddress_pkey" PRIMARY KEY ("username")
);

-- CreateTable
CREATE TABLE "public"."Card" (
    "id" TEXT NOT NULL,
    "designId" TEXT NOT NULL,
    "ntag424Cid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "title" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "userId" TEXT,
    "username" TEXT,
    "otc" TEXT,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AlbySubAccount" (
    "appId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT,
    "nwcUri" TEXT NOT NULL,
    "nostrPubkey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlbySubAccount_pkey" PRIMARY KEY ("appId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_pubkey_key" ON "public"."User"("pubkey");

-- CreateIndex
CREATE INDEX "CardDesign_userId_idx" ON "public"."CardDesign"("userId");

-- CreateIndex
CREATE INDEX "Ntag424_userId_idx" ON "public"."Ntag424"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LightningAddress_userId_key" ON "public"."LightningAddress"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Card_ntag424Cid_key" ON "public"."Card"("ntag424Cid");

-- CreateIndex
CREATE INDEX "Card_userId_idx" ON "public"."Card"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AlbySubAccount_userId_key" ON "public"."AlbySubAccount"("userId");

-- AddForeignKey
ALTER TABLE "public"."CardDesign" ADD CONSTRAINT "CardDesign_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Ntag424" ADD CONSTRAINT "Ntag424_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LightningAddress" ADD CONSTRAINT "LightningAddress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Card" ADD CONSTRAINT "Card_designId_fkey" FOREIGN KEY ("designId") REFERENCES "public"."CardDesign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Card" ADD CONSTRAINT "Card_ntag424Cid_fkey" FOREIGN KEY ("ntag424Cid") REFERENCES "public"."Ntag424"("cid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Card" ADD CONSTRAINT "Card_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AlbySubAccount" ADD CONSTRAINT "AlbySubAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
