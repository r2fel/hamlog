#!/bin/bash
# Double-click this file in Finder to open R2FEL-LOG as its own app window
# (no browser tab). Close the app window to stop it — this Terminal window
# can stay open or be closed either way.

cd "$(dirname "$0")" || exit 1

clear
echo "==============================="
echo "   R2FEL-LOG Dev — проверка правок"
echo "==============================="
echo

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed."
  echo "Download it from https://nodejs.org (the LTS version), then run this again."
  echo
  read -r -p "Press Enter to close..."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "First run — installing components, this takes a minute..."
  echo
  npm install || {
    echo
    echo "Install failed. Check your internet connection and try again."
    read -r -p "Press Enter to close..."
    exit 1
  }
  echo
fi

# Free the port if a previous run of this development copy is still holding
# it. 4174, not 4173: 4173 belongs to the installed R2FEL-LOG, which must be
# left running (see electron-main.js).
PORT_IN_USE=$(lsof -ti:4174 2>/dev/null)
if [ -n "$PORT_IN_USE" ]; then
  echo "Stopping a previous session still running..."
  kill $PORT_IN_USE 2>/dev/null
  sleep 1
fi

echo "Starting the app window..."
echo

npm run electron

echo
read -r -p "App closed. Press Enter to close..."
