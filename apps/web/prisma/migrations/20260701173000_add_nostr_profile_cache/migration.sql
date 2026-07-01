-- Server-side cache for registered users' Nostr kind-0 metadata and
-- best-effort local image precache records.

CREATE TYPE "NostrProfileImageKind" AS ENUM ('AVATAR', 'COVER');

CREATE TABLE "NostrProfileCache" (
    "npub" TEXT NOT NULL,
    "pubkey" TEXT NOT NULL,
    "name" TEXT,
    "displayName" TEXT,
    "about" TEXT,
    "nip05" TEXT,
    "lud16" TEXT,
    "website" TEXT,
    "pictureUrl" TEXT,
    "bannerUrl" TEXT,
    "kind0CreatedAt" TIMESTAMP(3),
    "rawMetadata" JSONB,
    "fetchedAt" TIMESTAMP(3),
    "lastFetchAttemptAt" TIMESTAMP(3),
    "lastFetchError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NostrProfileCache_pkey" PRIMARY KEY ("npub")
);

CREATE TABLE "NostrProfileImageCache" (
    "npub" TEXT NOT NULL,
    "kind" "NostrProfileImageKind" NOT NULL,
    "remoteUrl" TEXT NOT NULL,
    "cachePath" TEXT,
    "contentType" TEXT,
    "byteSize" INTEGER,
    "sha256" TEXT,
    "cachedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NostrProfileImageCache_pkey" PRIMARY KEY ("npub","kind")
);

CREATE UNIQUE INDEX "NostrProfileCache_pubkey_key" ON "NostrProfileCache"("pubkey");
CREATE INDEX "NostrProfileCache_fetchedAt_idx" ON "NostrProfileCache"("fetchedAt");
CREATE INDEX "NostrProfileImageCache_remoteUrl_idx" ON "NostrProfileImageCache"("remoteUrl");
CREATE INDEX "NostrProfileImageCache_cachedAt_idx" ON "NostrProfileImageCache"("cachedAt");

ALTER TABLE "NostrProfileImageCache" ADD CONSTRAINT "NostrProfileImageCache_npub_fkey"
  FOREIGN KEY ("npub") REFERENCES "NostrProfileCache"("npub") ON DELETE CASCADE ON UPDATE CASCADE;
