#!/bin/bash
# Pulls the raw material behind public/nissan-contacts.html out of the
# nissan-ma mailbox, via the portal's OWN digest endpoints.
#
# Why this route instead of the Gmail API directly: the Gmail refresh tokens
# live in the admin account's Drive appDataFolder and are unlocked by
# GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET / DRIVE_ADMIN_REFRESH_TOKEN,
# which only exist in the Vercel environment - never in a local .env. So the
# deployed app is the only thing that can reach the mailbox, and
# x-digest-secret is how a script authenticates to it.
#
#   ./fetch-emails.sh                      # default window: 2026-03 .. today
#   ./fetch-emails.sh 2026-01 2026-08      # explicit YYYY-MM range
#
# Output lands in ./out/ (gitignored - the bodies contain customer names,
# phone numbers, plates and VINs, so they must never be committed).

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$HERE/../.."
OUT="$HERE/out"
ACCOUNT="${ACCOUNT:-nissan-ma@muze.co.th}"
BASE="${BASE:-https://muze-ops-portal.vercel.app}"

SECRET=$(grep '^DIGEST_SECRET=' "$REPO_ROOT/.env" | cut -d= -f2-)
if [ -z "$SECRET" ]; then
  echo "DIGEST_SECRET not found in $REPO_ROOT/.env" >&2
  exit 1
fi

FROM_MONTH="${1:-2026-03}"
TO_MONTH="${2:-$(date +%Y-%m)}"

mkdir -p "$OUT/bodies"

# --- 1. message lists, one request per month -------------------------------
# /api/digest/range runs a live Gmail query and answers in a few seconds for a
# month; a half-year in one call risks the serverless timeout, so chunk it.
month="$FROM_MONTH"
while [ "$month" \< "$TO_MONTH" ] || [ "$month" = "$TO_MONTH" ]; do
  first="$month-01"
  last=$(date -j -v1d -v+1m -v-1d -f "%Y-%m-%d" "$first" "+%Y-%m-%d" 2>/dev/null \
         || date -d "$first +1 month -1 day" "+%Y-%m-%d")
  dest="$OUT/range_$month.json"
  if [ ! -s "$dest" ]; then
    echo "range  $month ($first .. $last)"
    curl -sS -m 300 -H "x-digest-secret: $SECRET" \
      "$BASE/api/digest/range?account=$ACCOUNT&from=$first&to=$last" -o "$dest"
  fi
  month=$(date -j -v+1m -f "%Y-%m-%d" "$first" "+%Y-%m" 2>/dev/null \
          || date -d "$first +1 month" "+%Y-%m")
done

# --- 2. collect message ids -------------------------------------------------
python3 - "$OUT" <<'PY'
import glob, json, os, sys
out = sys.argv[1]
ids = []
for f in sorted(glob.glob(os.path.join(out, 'range_*.json'))):
    for acc in json.load(open(f)).get('counts', {}).values():
        ids += [e['msgId'] for e in acc['emails']]
ids = list(dict.fromkeys(ids))
open(os.path.join(out, 'msgids.txt'), 'w').write('\n'.join(ids))
print(f'{len(ids)} messages')
PY

# --- 3. full bodies ---------------------------------------------------------
# The list endpoint strips "<addr>" out of the From header, so the addresses,
# job titles and phone numbers only exist inside the bodies - every reply
# quotes the whole From/To/Cc block plus the sender's signature.
n=0
while read -r ID; do
  [ -z "$ID" ] && continue
  DEST="$OUT/bodies/$ID.json"
  [ -s "$DEST" ] && continue
  curl -s -m 90 -H "x-digest-secret: $SECRET" \
    "$BASE/api/digest/email-body?account=$ACCOUNT&msgId=$ID" -o "$DEST" &
  n=$((n + 1))
  if [ $((n % 8)) -eq 0 ]; then wait; fi
done < "$OUT/msgids.txt"
wait

echo "bodies: $(ls "$OUT/bodies" | wc -l | tr -d ' ') files in $OUT/bodies"
echo "next:   python3 $HERE/extract-contacts.py"
