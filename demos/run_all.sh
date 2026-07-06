#!/usr/bin/env sh
# Run every demo in order. Builds first if dist/ is missing. Exits non-zero if
# any demo fails, so it drops straight into CI as a smoke test.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -f "$ROOT/dist/cli.js" ]; then
  echo "== building (dist/ missing) =="
  (cd "$ROOT" && npm run build)
fi

for demo in "$ROOT"/demos/[0-9]*.sh; do
  echo
  echo "########## $(basename "$demo") ##########"
  sh "$demo"
done

echo
echo "ALL DEMOS OK"
