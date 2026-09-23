#!/usr/bin/env bash
# Wie lange ist data.json waehrend eines Schreibvorgangs UNVOLLSTAENDIG?
#
# WARUM DIE FRAGE ZAEHLT
# `mupibox-sicherung.py` liest data.json mit einem schlichten open()/read().
# Es fragt keine Sperre und haelt keine. Ob das je etwas kostet, haengt
# einzig daran, WIE LANGE die Datei auf der Platte unvollstaendig ist.
#
# Zwei Wege, dieselbe Datei zu schreiben, stehen im Server nebeneinander:
#   medienAendern / darstellungSchreiben   tmp -> rename   (nie halb sichtbar)
#   POST /api/add   (server.ts ~7930)      fs.writeFile    (sehr wohl halb)
#
# Gemessen wird mit node und der ECHTEN Groesse, gegen eine Wegwerf-Datei
# unter /tmp. Die echte data.json wird nur GELESEN (fuer ihre Groesse).
#
# AUFRUF:  data-json-schreibfenster.sh [box] [laeufe]
set -u
BOX="${1:-dietpi@192.168.178.169}"
LAEUFE="${2:-4000}"

FERN=/tmp/schreibfenster
ssh -o ConnectTimeout=10 "${BOX}" "mkdir -p ${FERN}"

# ── Der Leser: liest so schnell er kann und zaehlt die halben Fassungen.
cat > /tmp/schreibfenster-leser.py <<'PY'
import json, sys, time
ziel, fertig = sys.argv[1], sys.argv[1] + ".fertig"
import os
ganz = halb = leer = 0
t0 = time.time()
while not os.path.exists(fertig) and time.time() - t0 < 120:
    try:
        with open(ziel, "rb") as f:
            roh = f.read()
    except OSError:
        continue
    if not roh:
        leer += 1
        continue
    try:
        json.loads(roh.decode())
        ganz += 1
    except (ValueError, UnicodeDecodeError):
        halb += 1
n = ganz + halb + leer
print(f"  Leseversuche      {n}")
print(f"  vollstaendig      {ganz}")
print(f"  LEER (0 Bytes)    {leer}")
print(f"  HALB (kaputt)     {halb}")
if n:
    print(f"  unbrauchbar       {100.0 * (halb + leer) / n:.2f} % aller Leseversuche")
PY

# ── Der Schreiber: GENAU das, was jsonfile.writeFile tut.
cat > /tmp/schreibfenster-schreiber.js <<'JS'
const fs = require('fs')
// argv[2]/argv[3] — NICHT `node datei.js -- ziel n` aufrufen: dann steht in
// argv[2] das `--` und der Lauf stirbt an ENOENT, waehrend der Leser
// seelenruhig „0 % unbrauchbar" meldet. Ein gruener Befund aus einem Lauf,
// der gar nicht stattgefunden hat, ist das Teuerste an dieser ganzen Messung.
const ziel = process.argv[2]
const n = Number(process.argv[3])
const daten = JSON.parse(fs.readFileSync(ziel, 'utf8'))
const text = JSON.stringify(daten, null, 4)
let i = 0
const t0 = process.hrtime.bigint()
// fs.writeFile auf die ZIELDATEI: beim Oeffnen wird sie auf 0 gekuerzt und
// erst danach gefuellt. Kein tmp, kein rename.
const runde = () => {
  if (i++ >= n) {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6
    console.log(`  ${n} Schreibvorgaenge in ${ms.toFixed(0)} ms ` +
                `(${(ms / n).toFixed(3)} ms je Schreibvorgang, ${text.length} B)`)
    fs.writeFileSync(ziel + '.fertig', '1')
    return
  }
  fs.writeFile(ziel, text, (e) => { if (e) throw e; runde() })
}
runde()
JS

scp -q /tmp/schreibfenster-leser.py /tmp/schreibfenster-schreiber.js "${BOX}:${FERN}/"

ssh -o ConnectTimeout=10 "${BOX}" "LAEUFE=${LAEUFE} FERN=${FERN} bash -s" <<'REMOTE'
set -u
ECHT=/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config/data.json
GROESSE=$(stat -c%s "${ECHT}")
ZIEL=${FERN}/data.json
rm -f "${ZIEL}" "${ZIEL}.fertig"
echo "echte data.json: ${GROESSE} B — dieselbe Groesse wird nachgestellt"

python3 -c "
import json, sys
n = ${GROESSE}
liste, i = [], 0
while len(json.dumps(liste, indent=4)) < n:
    liste.append({'artist': f'Interpret {i}', 'title': f'Titel {i}',
                  'cover': '../assets/images/cover.png', 'type': 'spotify'})
    i += 1
open('${ZIEL}','w').write(json.dumps(liste, indent=4))
"
echo "nachgestellt:    $(stat -c%s ${ZIEL}) B"

python3 "${FERN}/schreibfenster-leser.py" "${ZIEL}" &
LESER=$!
sleep 0.3
node "${FERN}/schreibfenster-schreiber.js" "${ZIEL}" "${LAEUFE}"
wait ${LESER}
rm -f "${ZIEL}" "${ZIEL}.fertig"
REMOTE
