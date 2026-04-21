-- Notify `nostr-trigger` in real time when NwcConnection rows change.
-- Payload is intentionally minimal (id + enabled + op) — the listener
-- re-queries the full row via Prisma. Keeps payloads well under the
-- 8 KB pg_notify limit and keeps encrypted secrets out of NOTIFY.

CREATE OR REPLACE FUNCTION notify_nwc_connection_change()
RETURNS trigger AS $$
DECLARE
  rec_id text;
  rec_enabled boolean;
  payload json;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    rec_id := OLD.id;
    rec_enabled := OLD.enabled;
  ELSE
    rec_id := NEW.id;
    rec_enabled := NEW.enabled;
  END IF;

  payload := json_build_object(
    'op', TG_OP,
    'id', rec_id,
    'enabled', rec_enabled
  );

  PERFORM pg_notify('nwc_connection_change', payload::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS nwc_connection_change_trigger ON "NwcConnection";

CREATE TRIGGER nwc_connection_change_trigger
AFTER INSERT OR UPDATE OR DELETE ON "NwcConnection"
FOR EACH ROW
EXECUTE FUNCTION notify_nwc_connection_change();
