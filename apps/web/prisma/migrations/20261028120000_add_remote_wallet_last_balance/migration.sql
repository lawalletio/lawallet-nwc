-- Last observed balance. Automatic archival refuses to tombstone a wallet whose
-- last reading was above a few sats.
ALTER TABLE "RemoteWallet" ADD COLUMN     "lastBalanceAt" TIMESTAMP(3),
ADD COLUMN     "lastBalanceSats" INTEGER;

-- Balance readings are written on every balance poll. They must not wake the
-- listener's `remote_wallet_changed` reconcile, so UPDATEs that only touch the
-- balance columns (or updatedAt) no longer notify. INSERT/DELETE are unchanged.
DROP TRIGGER IF EXISTS remote_wallet_changed_trigger ON "RemoteWallet";
CREATE TRIGGER remote_wallet_changed_trigger
  AFTER INSERT OR DELETE ON "RemoteWallet"
  FOR EACH ROW EXECUTE FUNCTION notify_remote_wallet_changed();

DROP TRIGGER IF EXISTS remote_wallet_updated_trigger ON "RemoteWallet";
CREATE TRIGGER remote_wallet_updated_trigger
  AFTER UPDATE ON "RemoteWallet"
  FOR EACH ROW
  WHEN (
    (to_jsonb(OLD) - 'lastBalanceSats' - 'lastBalanceAt' - 'updatedAt')
      IS DISTINCT FROM
    (to_jsonb(NEW) - 'lastBalanceSats' - 'lastBalanceAt' - 'updatedAt')
  )
  EXECUTE FUNCTION notify_remote_wallet_changed();
