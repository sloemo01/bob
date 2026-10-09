#!/usr/bin/env bash
# Rebuild the packed component.
#
# app/src is the source of truth — this syncs the component copy from it and
# re-bundles dist/ with the app's vite. Run after any change inside app/src
# that the component should carry (engine, Stage, Bob, data.json).
set -euo pipefail
cd "$(dirname "$0")"

APP=../app
VITE="$APP/node_modules/.bin/vite"

if [ ! -x "$VITE" ]; then
  echo "vite not found at $VITE — run: (cd $APP && npm install)" >&2
  exit 1
fi

cp "$APP/src/components/Bob.jsx" "$APP/src/components/Stage.jsx" src/components/
cp "$APP/src/engine/clock.js" "$APP/src/engine/morph.js" "$APP/src/engine/geom.js" src/engine/
cp "$APP/src/data.json" src/

"$VITE" build

echo "component ready: src/ synced from app/src, dist/ rebuilt"
