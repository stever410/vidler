#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTPUT_DIR="${1:-$ROOT_DIR/release-assets}"
VERSION="$(node -p "JSON.parse(require('fs').readFileSync('package.json','utf8')).version")"
ARCH="$(dpkg --print-architecture)"
STAGING_DIR="$(mktemp -d)"
PKG_ROOT="$STAGING_DIR/pkgroot"
APP_DIR="$PKG_ROOT/opt/vidler"

cleanup() {
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

mkdir -p "$OUTPUT_DIR" "$APP_DIR" "$PKG_ROOT/usr/bin" "$PKG_ROOT/DEBIAN"

cp -R "$ROOT_DIR/dist" "$APP_DIR/dist"
cp "$ROOT_DIR/package.json" "$ROOT_DIR/README.md" "$APP_DIR/"

pushd "$APP_DIR" >/dev/null
npm install --omit=dev --no-audit --no-fund
popd >/dev/null

cat >"$PKG_ROOT/usr/bin/vidler" <<'EOF'
#!/usr/bin/env sh
exec /usr/bin/env node /opt/vidler/dist/cli.js "$@"
EOF
chmod 0755 "$PKG_ROOT/usr/bin/vidler"

cat >"$PKG_ROOT/DEBIAN/control" <<EOF
Package: vidler
Version: $VERSION
Section: utils
Priority: optional
Architecture: $ARCH
Depends: nodejs (>= 24)
Maintainer: Vidler
Description: VIDLER terminal downloader CLI
EOF

dpkg-deb --build "$PKG_ROOT" "$OUTPUT_DIR/vidler-Linux.deb"
