#!/usr/bin/env sh
# Demo 3: full session lifecycle against an isolated state dir.
#
# If ffmpeg is present it relays a 5-second testsrc pattern to a local HLS
# playlist and then stops it. If ffmpeg is absent it still exercises the
# control plane (start/status/logs/stop) using a short-lived stand-in process,
# proving liveness detection and state persistence. Exits 0 either way.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="node $ROOT/dist/cli.js"
TMP="$(mktemp -d 2>/dev/null || echo "${TMPDIR:-/tmp}/sr-demo3-$$")"
mkdir -p "$TMP/out"
STATE="$TMP/state.json"
trap 'rm -rf "$TMP"' EXIT

if command -v ffmpeg >/dev/null 2>&1; then
  echo "== ffmpeg present: relaying a 5s testsrc pattern to HLS =="
  cat > "$TMP/relay.json" <<EOF
{
  "name": "demo-testsrc",
  "input": { "url": "-", "kind": "testsrc", "lavfi": "testsrc=size=640x360:rate=15:duration=5" },
  "outputs": [
    { "name": "hls", "url": "$TMP/out/stream.m3u8", "kind": "hls",
      "videoCodec": "libx264", "videoBitrateKbps": 800, "preset": "ultrafast",
      "audioCodec": "aac", "audioBitrateKbps": 96 }
  ]
}
EOF
else
  echo "== ffmpeg absent: exercising the control plane with a stand-in process =="
  cat > "$TMP/relay.json" <<EOF
{
  "name": "demo-testsrc",
  "ffmpegPath": "node",
  "input": { "url": "rtmp://localhost/live" },
  "outputs": [ { "name": "o", "url": "rtmp://dst/app/k" } ]
}
EOF
fi

$CLI validate "$TMP/relay.json"
$CLI start demo-testsrc --config "$TMP/relay.json" --state "$STATE"
echo "== status =="
$CLI status --state "$STATE"
echo "== status --json =="
$CLI status --json --state "$STATE" | head -5
echo "== logs =="
$CLI logs demo-testsrc --lines 5 --state "$STATE" || true
echo "== stop =="
$CLI stop demo-testsrc --state "$STATE"
$CLI status --state "$STATE"

echo
echo "Demo 3 OK"
