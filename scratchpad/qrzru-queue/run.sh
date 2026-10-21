#!/bin/bash
# usage: run.sh <server file> — two lookups, the first one meets a QRZ.RU timeout
SRV="$1"; PORT=4183; D=$(mktemp -d)
QSO_DATA_DIR="$D" PORT=$PORT QRZRU_USERNAME=test QRZRU_PASSWORD=test \
  node -r ./scratchpad/qrzru-queue/fakefetch.js "$SRV" >"$D/log.txt" 2>&1 &
PID=$!
for i in $(seq 1 30); do curl -s -o /dev/null localhost:$PORT/api/config && break; sleep 0.5; done
for cs in R3RBF R3RBF; do
  curl -s -X POST localhost:$PORT/api/lookup -H 'Content-Type: application/json' -d "{\"callsign\":\"$cs\"}" --max-time 30 \
   | python3 -c "import sys,json; d=json.load(sys.stdin); print('  ', {k:d.get(k) for k in ('source','name','error','primaryError')})"
done
kill $PID 2>/dev/null; rm -rf "$D"
