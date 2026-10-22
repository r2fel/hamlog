#!/bin/bash
# Checks that TQSL is only ever given ASCII: a Cyrillic Station Location is lent under an alias, the ADIF goes
# to an ASCII folder, and station_data comes back byte for byte. Usage: run.sh [path-to-node-or-electron-as-node]
# For Electron as node (Windows 7/8 engine): ELECTRON_RUN_AS_NODE=1 run.sh /path/to/Electron
set -e
NODE="${1:-node}"
PROJECT="$(cd "$(dirname "$0")/../.." && pwd)"
T=$(mktemp -d)
mkdir -p "$T/data" "$T/pub" "$T/тест"
cat > "$T/data/station_data" <<'XML'
<StationDataFile>
  <StationData name="Дом">
    <CALL>R2ST</CALL>
    <DXCC>54</DXCC>
  </StationData>
</StationDataFile>
XML
cp "$T/data/station_data" "$T/original"
cat > "$T/fake-tqsl" <<'SH'
#!/bin/bash
{ printf 'ARGS:'; for a in "$@"; do printf ' [%s]' "$a"; done; echo; cat "$TQSLDIR/station_data"; } > "$(dirname "$0")/record.txt"
echo "Final Status: Success(0)"
SH
chmod +x "$T/fake-tqsl"
cd "$PROJECT"
(TQSLDIR="$T/data" TQSL_PATH="$T/fake-tqsl" R2FEL_TQSL_ASCII=1 TMPDIR="$T/тест" PUBLIC="$T/pub" PORT=4198 QSO_DATA_DIR="$T/app" "$NODE" server.js > "$T/server.log" 2>&1 &)
sleep 3
OUT=$(curl -s -X POST localhost:4198/api/lotw/upload -H 'Content-Type: application/json' -d '{"location":"Дом","adif":"<CALL:5>R2ST <EOR>"}')
pkill -f "server.js" || true
echo "answer: $OUT"
ARGS=$(head -1 "$T/record.txt"); echo "$ARGS"
if echo "$ARGS" | LC_ALL=C grep -q '[^[:print:][:space:]]'; then echo "FAIL: non-ASCII reached TQSL"; exit 1; fi
grep -q 'R2FELHamLog-' "$T/record.txt" || { echo "FAIL: no alias during the run"; exit 1; }
cmp "$T/data/station_data" "$T/original" && echo "OK: station_data restored byte for byte"
rm -rf "$T"
