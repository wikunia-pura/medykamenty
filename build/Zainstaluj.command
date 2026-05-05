#!/bin/bash
# Cutis — script that unblocks the app after dragging it to /Applications.
# macOS marks downloaded files with the "com.apple.quarantine" attribute, which
# prevents an app that is not Apple-notarized from launching. This script removes
# the attribute.
#
# Usage: after copying Cutis.app to /Applications, double-click this file.
# If macOS blocks the script, right-click → Open → Open.

set -e

APP_PATHS=(
  "/Applications/Cutis.app"
  "$HOME/Applications/Cutis.app"
)

FOUND=""
for p in "${APP_PATHS[@]}"; do
  if [ -d "$p" ]; then
    FOUND="$p"
    break
  fi
done

if [ -z "$FOUND" ]; then
  echo ""
  echo "Could not find Cutis.app in /Applications or ~/Applications."
  echo "First drag Cutis to the Applications folder, then run this script."
  echo ""
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi

echo ""
echo "Unblocking: $FOUND"
xattr -cr "$FOUND"
echo ""
echo "Done. You can now launch Cutis."
echo ""
read -n 1 -s -r -p "Press any key to close..."
