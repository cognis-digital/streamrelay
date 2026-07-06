#!/usr/bin/env sh
# Build streamrelay and expose the `streamrelay` command on your PATH.
# Requires Node.js >= 20. ffmpeg is the only external RUNTIME requirement.
set -eu

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "== node version =="
node --version

echo "== install deps (dev only; zero runtime deps) =="
npm install

echo "== build =="
npm run build

echo "== link CLI onto PATH =="
if npm link; then
  echo "OK: run 'streamrelay --help' to get started."
else
  echo "npm link failed (permissions?). You can still run: node \"$ROOT/dist/cli.js\" --help"
  exit 1
fi

echo
echo "Checking ffmpeg (the only external runtime requirement):"
streamrelay doctor || echo "  (install ffmpeg to actually start relays — see README)"
