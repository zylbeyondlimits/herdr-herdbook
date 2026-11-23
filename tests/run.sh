#!/bin/sh
# Mods have no package.json, so node can't import their .js as modules:
# verify drag.js copies stay byte-for-byte in sync, then copy pure .js files to tests/build as .mjs.
set -e
cd "$(dirname "$0")/.."

canon="mods/herdbook-agents/drag.js"
for copy in mods/herdbook-tabs/drag.js mods/herdbook-pane/drag.js mods/herdbook-spaces/drag.js; do
  if ! cmp -s "$canon" "$copy"; then
    echo "error: $copy drifted from $canon (run ./scripts/sync-drag.sh)" >&2
    exit 1
  fi
done

rm -rf tests/build
for f in mods/*/*.js; do
  [ "$(basename "$f")" = main.js ] && continue
  mod=$(basename "$(dirname "$f")")
  mkdir -p "tests/build/$mod"
  cp "$f" "tests/build/$mod/$(basename "$f" .js).mjs"
done
node --test tests/*.test.mjs
