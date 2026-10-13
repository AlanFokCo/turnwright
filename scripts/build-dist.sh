#!/usr/bin/env bash
# build-dist.sh — build npm distribution artifacts. Go cross-compiles the
# engine per platform; the TUI bundle is platform-independent.
#
# Usage: scripts/build-dist.sh [version]   (default: @turnwright/cli package.json)
#
# Output:
#   tui/packages/cli/dist/tui.js          bundled TUI (externals: opentui, react)
#   dist/npm/engine-<os>-<arch>/          per-platform engine packages
#                                         (arch uses node names: x64, arm64)
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
VERSION="${1:-$(node -p "require('$ROOT/tui/packages/cli/package.json').version")}"
DIST="$ROOT/dist/npm"
PLATFORMS="darwin/amd64 darwin/arm64 linux/amd64 linux/arm64" # windows: needs .exe handling in the launcher — later

command -v go >/dev/null || { echo "go not found"; exit 1; }
command -v bun >/dev/null || { echo "bun not found"; exit 1; }
command -v node >/dev/null || { echo "node not found"; exit 1; }

echo "== turnwright dist build v$VERSION =="
rm -rf "$DIST"
mkdir -p "$DIST" "$ROOT/tui/packages/cli/dist"

echo "-- TUI bundle"
bun build "$ROOT/tui/packages/tui/src/index.tsx" --target=bun \
  --outfile="$ROOT/tui/packages/cli/dist/tui.js" \
  --external @opentui/core --external @opentui/react --external react

for p in $PLATFORMS; do
  os=${p%/*}; arch=${p#*/}
  # npm cpu field + package names use node arch names (amd64 -> x64).
  node_arch=$arch; [ "$arch" = "amd64" ] && node_arch=x64
  dir="$DIST/engine-$os-$node_arch"
  echo "-- engine $os/$node_arch"
  mkdir -p "$dir/bin"
  (cd "$ROOT" && GOOS=$os GOARCH=$arch go build -trimpath \
    -ldflags "-s -w -X github.com/alanfokco/turnwright/internal/config.Version=$VERSION" \
    -o "$dir/bin/turnwright-engine" ./cmd/turnwright-engine)
  chmod +x "$dir/bin/turnwright-engine"
  cat > "$dir/package.json" <<JSON
{
  "name": "@turnwright/engine-$os-$node_arch",
  "version": "$VERSION",
  "description": "turnwright engine binary ($os/$node_arch)",
  "os": ["$os"],
  "cpu": ["$node_arch"],
  "files": ["bin"],
  "publishConfig": { "access": "public" }
}
JSON
done

echo "== done: $DIST + tui/packages/cli/dist/tui.js =="
ls -la "$DIST"
