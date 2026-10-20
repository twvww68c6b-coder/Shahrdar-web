#!/usr/bin/env bash
# Local-only check on a throwaway PostgreSQL. Never run against production.
# Needs: PSQL (psql binary), PGHOST/PGPORT/PGUSER (local superuser cluster), SCHEMA_SQL (mirror with users/properties/clients).
# Proves: an owner who did not create a record can save it after migration 20261020000500, and a user who is
# neither owner nor creator is still blocked. Exits non-zero on any mismatch.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; repo="$(cd "$here/.." && pwd)"
: "${PSQL:?set PSQL}"; : "${PGHOST:?set PGHOST}"; : "${PGPORT:?set PGPORT}"; : "${PGUSER:?set PGUSER}"; : "${SCHEMA_SQL:?set SCHEMA_SQL}"
export PGHOST PGPORT PGUSER
BEFORE_DB=t_owner_before
AFTER_DB=t_owner_after
for db in "$BEFORE_DB" "$AFTER_DB"; do
  "$PSQL" -d postgres -q -c "drop database if exists $db" -c "create database $db"
done

"$PSQL" -d "$BEFORE_DB" -q -v ON_ERROR_STOP=1 -f "$SCHEMA_SQL" -f "$here/local-rls-owner-update-setup.sql"
out_before=$("$PSQL" -d "$BEFORE_DB" -q -t -A -f "$here/local-rls-owner-update-checks.sql")
echo "$out_before"
echo "$out_before" | grep -q "^OWNER-NOT-CREATOR update|ERROR" || { echo "UNEXPECTED: owner-not-creator should fail before the fix"; exit 1; }

"$PSQL" -d "$AFTER_DB" -q -v ON_ERROR_STOP=1 -f "$SCHEMA_SQL" -f "$here/local-rls-owner-update-setup.sql"
"$PSQL" -d "$AFTER_DB" -q -v ON_ERROR_STOP=1 -f "$repo/supabase/migrations/20261020000500_owner_update_policy.sql"
out_after=$("$PSQL" -d "$AFTER_DB" -q -t -A -f "$here/local-rls-owner-update-checks.sql")
echo "$out_after"
echo "$out_after" | grep -q "^OWNER-NOT-CREATOR update|rows=1" || { echo "FAIL: owner-not-creator not allowed after fix"; exit 1; }
echo "$out_after" | grep -q "^NON-OWNER NON-CREATOR.*|rows=0" || { echo "FAIL: non-owner not blocked"; exit 1; }
echo "ALL LOCAL OWNER-UPDATE CHECKS PASSED"
