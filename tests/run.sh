#!/bin/sh
# Mods have no package.json, so node can't import their .js as modules:
# copy each mod's pure files (everything but main.js) to tests/build as .mjs.
set -e
cd "$(dirname "$0")/.."
rm -rf tests/build
for f in mods/*/*.js; do
  [ "$(basename "$f")" = main.js ] && continue
  mod=$(basename "$(dirname "$f")")
  mkdir -p "tests/build/$mod"
  cp "$f" "tests/build/$mod/$(basename "$f" .js).mjs"
done
node --test tests/*.test.mjs
