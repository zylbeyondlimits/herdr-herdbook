#!/bin/sh
# Syncs the canonical drag engine (mods/herdbook-agents/drag.js) to sibling mods.
# Each Herdr mod folder is self-contained at runtime (no cross-mod relative imports).
set -e
cd "$(dirname "$0")/.."
src="mods/herdbook-agents/drag.js"
for dst in mods/herdbook-tabs/drag.js mods/herdbook-pane/drag.js mods/herdbook-spaces/drag.js; do
  cp "$src" "$dst"
done
