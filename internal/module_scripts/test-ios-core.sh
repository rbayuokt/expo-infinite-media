#!/bin/sh
# Runs ios/Tests on macOS with plain xctest. The pure core has no UIKit or Expo imports.
set -e
cd "$(dirname "$0")/../../ios"
OUT="${TMPDIR:-/tmp}/CoreTests.xctest"
PLAT="$(xcrun --show-sdk-platform-path)"
rm -rf "$OUT" && mkdir -p "$OUT/Contents/MacOS"
xcrun swiftc -parse-as-library -emit-library -module-name CoreTests \
  -o "$OUT/Contents/MacOS/CoreTests" Core/*.swift Cache/RangeStore.swift Tests/*.swift \
  -F "$PLAT/Developer/Library/Frameworks" -I "$PLAT/Developer/usr/lib" -L "$PLAT/Developer/usr/lib" \
  -framework XCTest -Xlinker -rpath -Xlinker "$PLAT/Developer/Library/Frameworks" \
  -Xlinker -rpath -Xlinker "$PLAT/Developer/usr/lib"
xcrun xctest "$OUT"
