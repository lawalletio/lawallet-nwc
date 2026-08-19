-- Fold the legacy `subdomain` setting into `domain`, then drop it.
--
-- Before a01f3fd the public host was composed as `<subdomain>.<domain>`, and
-- `resolveAddressDomain` kept preferring that pair over `endpoint` — so an
-- instance carrying `subdomain=app` labelled its lightning addresses
-- `user@app.example.com`. Collapsing the prefix into `domain` leaves both the
-- address host and the public endpoint byte-identical once the back-compat
-- code is gone; dropping the row without this would silently re-label every
-- address on those instances.
--
-- A blank `subdomain`, or one with no `domain` to attach to, contributed
-- nothing to the resolved host already, so those rows are simply deleted.
UPDATE "Settings" AS d
SET
  value = btrim(lower(s.value)) || '.' || btrim(lower(d.value)),
  "updatedAt" = CURRENT_TIMESTAMP
FROM "Settings" AS s
WHERE
  d.name = 'domain'
  AND s.name = 'subdomain'
  AND btrim(s.value) <> ''
  AND btrim(d.value) <> '';

DELETE FROM "Settings" WHERE name = 'subdomain';
