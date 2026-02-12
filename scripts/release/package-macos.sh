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
exec /usr/bin/env node /usr/local/lib/vidler/dist/cli.js "$@"
EOF
chmod 0755 "$PKG_ROOT/usr/local/bin/vidler"

pkgbuild \
  --identifier "com.vidler.cli" \
  --version "$VERSION" \
  --root "$PKG_ROOT" \
  --install-location "/" \
  "$OUTPUT_DIR/vidler-macOS.pkg"
