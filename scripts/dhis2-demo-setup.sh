#!/usr/bin/env bash
# Loads the Laafia CHPS tracker programme (docs/demo/dhis2-laafia-program.json) onto the DHIS2 server in apps/api/.env.
# For the public DHIS2 demo server, which resets now and then: run it again before a demo. Safe to re-run.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
env_of() { grep -m1 "^$1=" "$root/apps/api/.env" | cut -d= -f2-; }
base="$(env_of DHIS2_BASE_URL)"
[ -n "$base" ] || { echo "set DHIS2_BASE_URL in apps/api/.env" >&2; exit 1; }

curl -sS -u "$(env_of DHIS2_USERNAME):$(env_of DHIS2_PASSWORD)" -H 'Content-Type: application/json' \
  -X POST "$base/api/metadata?importStrategy=CREATE_AND_UPDATE&atomicMode=ALL" \
  --data-binary @"$root/docs/demo/dhis2-laafia-program.json" |
  node -e 'const r = JSON.parse(require("fs").readFileSync(0, "utf8")); console.log(r.status, JSON.stringify(r.stats ?? r.response?.stats)); if (r.status === "ERROR") process.exit(1)'
