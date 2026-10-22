#!/usr/bin/env bash
# Installs the pmtiles CLI the API runs to cut district maps (Maps page, "Make the map") into apps/api/bin.
set -euo pipefail

version=1.31.2
case "$(uname -m)" in
  x86_64) arch=x86_64 sum=3ed7dbf4ec2e6dfe5e25b6f70d1ffc932729f93c86db353bf514dd71010a312f ;;
  aarch64 | arm64) arch=arm64 sum=f8bd47e7ea866863489cad588fbaf2f31f42e5821f7a03f009b3769f05801cb1 ;;
  *) echo "unsupported machine: $(uname -m)" >&2; exit 1 ;;
esac

bin="$(cd "$(dirname "$0")/.." && pwd)/apps/api/bin"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -sfL -o "$tmp/pmtiles.tar.gz" "https://github.com/protomaps/go-pmtiles/releases/download/v${version}/go-pmtiles_${version}_Linux_${arch}.tar.gz"
echo "$sum  $tmp/pmtiles.tar.gz" | sha256sum -c --quiet
tar -xzf "$tmp/pmtiles.tar.gz" -C "$tmp" pmtiles
mkdir -p "$bin"
install -m 0755 "$tmp/pmtiles" "$bin/pmtiles"
"$bin/pmtiles" version
