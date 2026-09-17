#!/bin/bash
# Double-click this file in Finder to start the QSO log.
# Close the Terminal window (or press Ctrl+C) to stop it.

cd "$(dirname "$0")" || exit 1

clear
echo "==============================="
echo "        R2FEL-LOG"
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

# QRZ login is entered right in the app on first run (or skipped there to
# use the log offline) — no .env file is required to start the server.

# Free the port if a previous run is still holding it.
PORT_IN_USE=$(lsof -ti:4173 2>/dev/null)
if [ -n "$PORT_IN_USE" ]; then
  echo "Stopping a previous session still running..."
  kill $PORT_IN_USE 2>/dev/null
  sleep 1
fi

# Open the browser shortly after the server comes up.
( sleep 2; open "http://localhost:4173" ) &

echo "Starting... the browser will open by itself."
echo "Leave this window open while you use the log."
echo "To stop: close this window, or press Ctrl+C."
echo
echo "-------------------------------"
echo

npm start

echo
read -r -p "Server stopped. Press Enter to close..."
