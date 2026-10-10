#!/usr/bin/env bash
#
# Deploy web-daw to Fly.io. Build args (the public VITE_* client config) come from fly.toml [build.args],
# so this just runs `fly deploy`. It is wrapped in a retry loop because some networks intermittently fail
# to resolve api.fly.io ("no such host"); each attempt flushes the DNS cache and re-primes the lookup, so
# the deploy pushes through on the first good resolution instead of failing outright. Only that error is
# retried: any other failure is the same on every attempt, so it stops at the first one.
#
# Usage: yarn deploy   (or: bash scripts/deploy.sh)
set -uo pipefail

APP=web-daw
ATTEMPTS=8
# flyctl talks to several hosts; the DNS flake can hit any of them.
FLY_HOSTS="api.fly.io api.machines.dev registry.fly.io"
# Force flyctl (Go) to use the system (cgo/getaddrinfo) resolver so it shares the macOS DNS cache we
# flush + prime below, instead of its pure-Go resolver that queries the flaky nameserver directly.
export GODEBUG=netdns=cgo

for attempt in $(seq 1 "$ATTEMPTS"); do
  echo "=== deploy attempt ${attempt}/${ATTEMPTS} ($(date +%H:%M:%S)) ==="
  # Clear any cached negative DNS results and warm a fresh lookup of each Fly host before trying.
  dscacheutil -flushcache 2>/dev/null || true
  for host in $FLY_HOSTS; do nslookup "$host" >/dev/null 2>&1 || true; done

  # tee so the output still streams live, while a copy is kept to tell a DNS flake from a real failure.
  log=$(mktemp)
  fly deploy -a "$APP" 2>&1 | tee "$log"
  status=${PIPESTATUS[0]}
  if [ "$status" -eq 0 ]; then
    rm -f "$log"
    echo "=== deploy succeeded (attempt ${attempt}) ==="
    exit 0
  fi

  # Only the DNS flake is worth another go. Anything else (not logged in, a build error, a failed
  # health check) fails the same way every time, so stop and show it rather than retrying.
  if ! grep -q "no such host" "$log"; then
    rm -f "$log"
    echo "=== deploy failed (not a DNS lookup error, so not retrying) ==="
    exit "$status"
  fi
  rm -f "$log"

  echo "=== attempt ${attempt} failed to resolve a Fly host; retrying in 4s ==="
  sleep 4
done

echo "=== deploy failed after ${ATTEMPTS} attempts, every one on a DNS lookup ==="
echo "Fix DNS: flush the cache and add a reliable resolver (System Settings -> Network -> DNS -> 1.1.1.1, 8.8.8.8), then retry."
exit 1
