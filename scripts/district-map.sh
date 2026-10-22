#!/usr/bin/env bash
# Extract an offline basemap for one district from the daily Protomaps build and upload it as a tiles pack.
# Usage: scripts/district-map.sh <district_code> <min_lng,min_lat,max_lng,max_lat> [api_url]
# Needs the pmtiles CLI (github.com/protomaps/go-pmtiles) on PATH and ADMIN_TOKEN in the environment.
set -euo pipefail

district="$1"
bbox="$2"
api="${3:-http://127.0.0.1:4000}"
build="$(date -u -d yesterday +%Y%m%d).pmtiles"
out="$(mktemp -d)/${district}.pmtiles"

pmtiles extract "https://build.protomaps.com/${build}" "$out" --bbox="$bbox" --maxzoom=15
curl -sf -H "x-admin-token: ${ADMIN_TOKEN:?set ADMIN_TOKEN}" -F kind=tiles -F "district_code=${district}" -F "file=@${out}" "${api}/admin/content/packs"
echo
