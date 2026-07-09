#!/usr/bin/env sh
# Demo 1: validate every example config and print the ffmpeg plan for each.
# Needs no ffmpeg, no network. Exits 0 on success.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="node $ROOT/dist/cli.js"

echo "== streamrelay version =="
$CLI --version

for cfg in "$ROOT"/examples/*.json; do
  echo
  echo "== validate $(basename "$cfg") =="
  $CLI validate "$cfg"
  echo "== plan (human) =="
  $CLI plan "$cfg"
  echo "== plan (shell) =="
  $CLI plan "$cfg" --shell
done

echo
echo "Demo 1 OK"
