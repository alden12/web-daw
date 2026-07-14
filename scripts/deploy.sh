#!/usr/bin/env bash
#
# Deploy web-daw to Fly.io. Build args (the public VITE_* client config) come from fly.toml [build.args],
# so this just runs `fly deploy`. It is wrapped in a retry loop because some networks intermittently fail
# to resolve api.fly.io ("no such host"); each attempt flushes the DNS cache and re-primes the lookup, so
# the deploy pushes through on the first good resolution instead of failing outright.
#
# Usage: yarn deploy   (or: bash scripts/deploy.sh)
set -uo pipefail

APP=web-daw
ATTEMPTS=8

for attempt in $(seq 1 "$ATTEMPTS"); do
  echo "=== deploy attempt ${attempt}/${ATTEMPTS} ($(date +%H:%M:%S)) ==="
  # Clear any cached negative DNS result and warm a fresh lookup before trying.
  dscacheutil -flushcache 2>/dev/null || true
  nslookup api.fly.io >/dev/null 2>&1 || true

  if fly deploy -a "$APP"; then
    echo "=== deploy succeeded (attempt ${attempt}) ==="
    exit 0
  fi

  echo "=== attempt ${attempt} failed; retrying in 4s ==="
  sleep 4
done

echo "=== deploy failed after ${ATTEMPTS} attempts ==="
echo "If every attempt failed on 'lookup api.fly.io: no such host', fix DNS: flush the cache and add a"
echo "reliable resolver (System Settings -> Network -> DNS -> 1.1.1.1, 8.8.8.8), then retry."
exit 1
