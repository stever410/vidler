#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTPUT_DIR="${1:-$ROOT_DIR/release-assets}"
VERSION="$(node -p "JSON.parse(require('fs').readFileSync('package.json','utf8')).version")"
STAGING_DIR="$(mktemp -d)"
PKG_ROOT="$STAGING_DIR/pkgroot"
APP_DIR="$PKG_ROOT/usr/local/lib/vidler"

cleanup() {
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

mkdir -p "$OUTPUT_DIR" "$APP_DIR" "$PKG_ROOT/usr/local/bin"

cp -R "$ROOT_DIR/dist" "$APP_DIR/dist"
cp "$ROOT_DIR/package.json" "$ROOT_DIR/README.md" "$APP_DIR/"

pushd "$APP_DIR" >/dev/null
npm install --omit=dev --no-audit --no-fund
popd >/dev/null

cat >"$PKG_ROOT/usr/local/bin/vidler" <<'EOF'
#!/usr/bin/env sh
if ! command -v node >/dev/null 2>&1; then
  echo "VIDLER requires Node.js 24+ (node not found)." >&2
  exit 1
fi
NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 24 ]; then
  echo "VIDLER requires Node.js 24+ (found: $(node -v))." >&2
  exit 1
fi
exec /usr/bin/env node /usr/local/lib/vidler/dist/cli.js "$@"
EOF
chmod 0755 "$PKG_ROOT/usr/local/bin/vidler"

pkgbuild \
  --identifier "com.vidler.cli" \
  --version "$VERSION" \
  --root "$PKG_ROOT" \
  --install-location "/" \
  "$OUTPUT_DIR/vidler-macOS.pkg"
