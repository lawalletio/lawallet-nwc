-- Auto-archive for idle NWC wallets (issue #279).
--
-- The listener reports a wallet dead either because a probe confirmed silence
-- while its relays stayed up, or because it went more than 48h without a single
-- sign of life — including wallets that never completed NWC warmup, which emit
-- no notifications and could therefore never reach the archive path before.
-- Web owns the archive WRITE, so the archived state has to be persisted here.

-- Why a RemoteWallet was archived: 'unresponsive' | 'idle' | 'warmup_failed'.
-- NULL on rows archived before this migration (and on every live wallet).
ALTER TABLE "RemoteWallet" ADD COLUMN "diedReason" TEXT;

-- The LUD-16 proxy's own NWC wallet is not a RemoteWallet row, so it needs its
-- own archive state. NULL = live; a timestamp = archived (new intake disabled,
-- outstanding settlements still finish).
ALTER TABLE "ProxyServiceConfig" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "ProxyServiceConfig" ADD COLUMN "archivedReason" TEXT;
