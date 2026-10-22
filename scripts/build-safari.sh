#!/usr/bin/env bash
# Build SpeedView for Safari (macOS) from source. See docs/SAFARI.md for details.
#
#   ./scripts/build-safari.sh          build the app into build/safari/
#   ./scripts/build-safari.sh --xcode  generate the Xcode project and open it instead
#                                      (use this to sign with your own Apple ID team)
set -euo pipefail

APP_NAME="SpeedView for Canvas"
BUNDLE_ID="io.github.mholgatem.speedview"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/build/safari"
OPEN_XCODE=false
[[ "${1:-}" == "--xcode" ]] && OPEN_XCODE=true

fail() { echo "error: $*" >&2; exit 1; }

[[ "$(uname)" == "Darwin" ]] || fail "Safari extensions can only be built on macOS."
command -v node >/dev/null || fail "Node.js is required (https://nodejs.org, version 20 or newer)."
command -v xcrun >/dev/null || fail "Xcode is required (install it from the Mac App Store)."
xcrun --find safari-web-extension-converter >/dev/null 2>&1 ||
  fail "safari-web-extension-converter not found. Install Xcode (not just the Command Line Tools) and run: sudo xcode-select -s /Applications/Xcode.app"

cd "$ROOT"
echo "==> Installing dependencies"
npm ci

echo "==> Building the web extension"
npm run build:safari

echo "==> Converting to a Safari app project"
rm -rf "$OUT"
xcrun safari-web-extension-converter "$ROOT/.output/safari-mv3" \
  --project-location "$OUT" \
  --app-name "$APP_NAME" \
  --bundle-identifier "$BUNDLE_ID" \
  --swift --macos-only --copy-resources \
  --no-open --no-prompt --force

PROJECT="$OUT/$APP_NAME/$APP_NAME.xcodeproj"
[[ -d "$PROJECT" ]] || fail "Expected Xcode project at $PROJECT"

if $OPEN_XCODE; then
  echo "==> Opening Xcode. Choose your team under Signing & Capabilities, then Product > Run."
  open "$PROJECT"
  exit 0
fi

echo "==> Building the app (signed to run locally)"
xcodebuild -project "$PROJECT" -scheme "$APP_NAME" -configuration Release \
  -derivedDataPath "$OUT/DerivedData" \
  CODE_SIGN_IDENTITY="-" CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM="" \
  build | tail -n 5

APP="$OUT/DerivedData/Build/Products/Release/$APP_NAME.app"
[[ -d "$APP" ]] || fail "Build finished but $APP was not found."
cp -R "$APP" "$OUT/"

cat <<EOF

Built: $OUT/$APP_NAME.app

Next steps:
  1. Safari > Settings > Advanced: turn on "Show features for web developers".
  2. Develop menu > "Allow Unsigned Extensions" (Safari turns this off each time it quits).
  3. Open "$OUT/$APP_NAME.app" once, then enable SpeedView in Safari > Settings > Extensions.
  4. Open the SpeedView settings and add your Canvas site.

To avoid repeating step 2 every launch, sign with your own Apple ID instead:
  ./scripts/build-safari.sh --xcode
EOF
