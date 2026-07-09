#!/usr/bin/env sh
# Demo 2: scaffold each profile, validate it round-trips, and run doctor.
# Needs no ffmpeg (doctor reports absence cleanly). Exits 0 on success.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="node $ROOT/dist/cli.js"
TMP="$(mktemp -d 2>/dev/null || echo "${TMPDIR:-/tmp}/sr-demo2-$$")"
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT

for profile in multicast transcode srt testsrc; do
  echo "== scaffold profile: $profile =="
  out="$TMP/$profile.json"
  $CLI new "$profile-relay" --profile "$profile" --out "$out"
  $CLI validate "$out"
done

echo
echo "== doctor (ffmpeg is optional; NOT FOUND is a clean, expected result here) =="
# doctor exits 1 when ffmpeg is absent — that's informational, not a demo failure.
$CLI doctor || true

echo
echo "Demo 2 OK"
