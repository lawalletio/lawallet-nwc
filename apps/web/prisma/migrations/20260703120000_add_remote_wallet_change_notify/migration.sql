-- Feeds the NWC listener service (apps/listener): it LISTENs on
-- 'remote_wallet_changed' and reconciles its relay-pool subscriptions to the
-- ACTIVE NWC RemoteWallet set. Fires for every row change regardless of type
-- (the listener filters) — a WHEN type-guard breaks on INSERT/DELETE and
-- misses type flips. NOTIFY is delivered on COMMIT, so the listener never
-- sees an uncommitted row id.
CREATE OR REPLACE FUNCTION notify_remote_wallet_changed() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'remote_wallet_changed',
    json_build_object('id', COALESCE(NEW."id", OLD."id"), 'op', TG_OP)::text
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS remote_wallet_changed_trigger ON "RemoteWallet";
CREATE TRIGGER remote_wallet_changed_trigger
  AFTER INSERT OR UPDATE OR DELETE ON "RemoteWallet"
  FOR EACH ROW EXECUTE FUNCTION notify_remote_wallet_changed();
