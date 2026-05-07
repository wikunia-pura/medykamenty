#!/bin/bash
# Cutis Production Planner — script that unblocks the app after dragging it to /Applications.
# macOS marks downloaded files with the "com.apple.quarantine" attribute, which
# prevents an app that is not Apple-notarized from launching. This script removes
# the attribute.
#
# Usage: after copying "Cutis Production Planner.app" to /Applications, double-click this file.
# If macOS blocks the script, right-click → Open → Open.

set -e

APP_NAME="Cutis Production Planner.app"

APP_PATHS=(
  "/Applications/$APP_NAME"
  "$HOME/Applications/$APP_NAME"
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
  echo "Could not find $APP_NAME in /Applications or ~/Applications."
  echo "First drag \"$APP_NAME\" to the Applications folder, then run this script."
  echo ""
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi

echo ""
echo "Unblocking: $FOUND"
xattr -cr "$FOUND"
echo ""
echo "Done. You can now launch Cutis Production Planner."
echo ""
read -n 1 -s -r -p "Press any key to close..."
