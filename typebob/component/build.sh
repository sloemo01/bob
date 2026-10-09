#!/usr/bin/env bash
# Rebuild the packed typebob component.
#
# src/ here is the source of truth for the shipped component (engine, Stage,
# Typebob, data.json, styles). This bundles dist/ with the component's own
# vite. Run after any change inside src/.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -x node_modules/.bin/vite ]; then
  echo "vite not found — run: (cd typebob/component && npm install)" >&2
  exit 1
fi

node_modules/.bin/vite build

echo "component ready: dist/ rebuilt"
