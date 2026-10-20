#!/usr/bin/env bash
# Authorization test for the crm-share Edge Function.
# Run from a machine that can reach Supabase. Needs the project's publishable (anon) key.
#   SUPABASE_URL=https://<project>.supabase.co SUPABASE_ANON_KEY=<publishable key> ./scripts/test-crm-share-auth.sh
# Expected: both requests are rejected with HTTP 401 and no message is sent.
set -u
: "${SUPABASE_URL:?set SUPABASE_URL}"; : "${SUPABASE_ANON_KEY:?set SUPABASE_ANON_KEY}"
BODY='{"kind":"property","id":1,"mode":"full","recipient_user_id":1}'
URL="$SUPABASE_URL/functions/v1/crm-share"
fail=0; notrun=0
run() {
  local name="$1"; shift
  code=$(curl -s -o /tmp/crm_share_resp.txt -w "%{http_code}" -X POST "$URL" -H "apikey: $SUPABASE_ANON_KEY" -H "Content-Type: application/json" "$@" -d "$BODY")
  if [ "$code" = "401" ]; then echo "PASS $name -> $code"
  elif [ "$code" = "000" ]; then echo "NOT RUN $name -> no connection to $SUPABASE_URL"; notrun=1
  else echo "FAIL $name -> $code"; fail=1; fi
  rm -f /tmp/crm_share_resp.txt
}
run "no Authorization header"
run "forged bearer token" -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIwMDAifQ.forged"
if [ $fail = 1 ]; then echo "AUTH CHECKS FAILED"; elif [ $notrun = 1 ]; then echo "AUTH CHECKS NOT RUN (no network access from this machine)"; else echo "ALL AUTH CHECKS PASSED"; fi
exit $fail
