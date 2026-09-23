#!/usr/bin/env bash
# Spielt der Jellyfin-Weiterreicher wirklich? (BACKLOG E15/S2)
#
# WARUM DIESE PROBE SEIN MUSS: Der Weiterreicher ist mit einem Attrappen-
# Jellyfin geprueft (jellyfin-strom.integration.spec.ts). Eine Attrappe luegt
# aber durch Weglassen — sie sagt nichts darueber, ob ein ECHTER Jellyfin
# dieselben Kopfzeilen schickt und ob ein ECHTER Abspieler die Laenge findet
# und springen kann. Und genau daran haengt das Fortsetzen an der gemerkten
# Stelle: verschluckt der Weg die Bereichsabrufe, spielt die Box weiter und ist
# STILL kaputt.
#
# WIE OHNE AUSROLLEN: Das Hintergrundstueck laeuft HIER, auf dem
# Entwicklungsrechner, mit einer Kopie der Medienliste der Box. Die Box selbst
# wird nur GELESEN (/api/data). Der Jellyfin-Server ist der echte.
#
#   tools/jellyfin-weiterreicher-probe.sh [BOX] [PORT]
#
# Braucht: curl, ffprobe (mpv benutzt dieselbe libav-Familie), npx tsx.

set -u
BOX="${1:-192.168.178.169}"
BOXPORT="${2:-8200}"
PROBEPORT="${MUPI_PROBE_PORT:-18200}"
WURZEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARBEIT="$(mktemp -d)"
SERVERPID=""

aufraeumen() {
  [ -n "$SERVERPID" ] && kill "$SERVERPID" 2>/dev/null
  rm -rf "$ARBEIT"
}
trap aufraeumen EXIT

echo "Jellyfin-Weiterreicher — Probe gegen den ECHTEN Jellyfin (Box nur gelesen)"
echo

# ── 1. Medienliste der Box holen ────────────────────────────────────────────
if ! curl -sf --max-time 20 "http://$BOX:$BOXPORT/api/data" -o "$ARBEIT/active_data.json"; then
  echo "  ABBRUCH: /api/data der Box nicht lesbar (http://$BOX:$BOXPORT)"
  exit 1
fi
cp "$ARBEIT/active_data.json" "$ARBEIT/data.json"

# Die erste Jellyfin-Kennung samt Server und Schluessel — aus der Coveradresse,
# genau wie der Server sie liest (jellyfinZugangAusListe).
lies() { python3 -c "
import json,re,sys
d=json.load(open('$ARBEIT/active_data.json'))
for e in d:
    c=str(e.get('cover') or '')
    m=re.search(r'^(https?://[^/]+)/Items/([0-9a-fA-F]{32})/Images/Primary\?api_key=([^&]+)', c)
    if m and str(e.get('type','')).startswith('jellyfin'):
        print(m.group($1)); break
"; }
JFSERVER="$(lies 1)"
JFITEM="$(lies 2)"
JFKEY="$(lies 3)"

if [ -z "${JFITEM:-}" ]; then
  echo "  ABBRUCH: kein Jellyfin-Eintrag in der Medienliste — nichts zu messen."
  exit 1
fi
echo "  Jellyfin: $JFSERVER, Album $JFITEM"

# Ein ALBUM ist kein Titel. Der erste Titel des Albums wird bei Jellyfin selbst
# erfragt — mit dem Schluessel, den die Box ohnehin herausgibt.
JFTITEL="$(curl -sf --max-time 20 \
  "$JFSERVER/Items?ParentId=$JFITEM&IncludeItemTypes=Audio&Recursive=true&SortBy=ParentIndexNumber,IndexNumber,SortName" \
  -H "X-Emby-Token: $JFKEY" | python3 -c "
import json,sys
try: print((json.load(sys.stdin).get('Items') or [{}])[0].get('Id',''))
except Exception: print('')
")"
if [ -z "$JFTITEL" ]; then
  echo "  ABBRUCH: kein Titel im Album $JFITEM (Jellyfin nicht erreichbar?)"
  exit 1
fi
echo "  erster Titel: $JFTITEL"
echo

# ── 2. Das Hintergrundstueck HIER starten ───────────────────────────────────
cd "$WURZEL/src/backend-api" || exit 1
# NODE_ENV=development, und beides mit Grund:
#   * NICHT `test` — in dieser Betriebsart horcht der Server absichtlich auf gar
#     keinem Port (`testServe`), und genau den braucht die Probe.
#   * NICHT leer — dann gilt `productionServe`, und der liefert die gebaute
#     Oberflaeche aus `__dirname/www` aus, das es hier weder gibt noch geben
#     muss (und `__dirname` gibt es im ESM-Lauf ohnehin nicht).
MUPIBOX_CONFIG_DIR="$ARBEIT" MUPIBOX_HTTP_PORT="$PROBEPORT" MUPIBOX_HTTPS_PORT=18443 \
  NODE_ENV=development npx tsx src/server.ts >"$ARBEIT/server.log" 2>&1 &
SERVERPID=$!
for _ in $(seq 1 40); do
  curl -sf --max-time 2 "http://127.0.0.1:$PROBEPORT/api/data" -o /dev/null && break
  sleep 0.5
done
if ! curl -sf --max-time 2 "http://127.0.0.1:$PROBEPORT/api/data" -o /dev/null; then
  echo "  ABBRUCH: der Probeserver kam nicht hoch:"; tail -20 "$ARBEIT/server.log"; exit 1
fi

DIREKT="$JFSERVER/Audio/$JFTITEL/stream?static=true&api_key=$JFKEY"
UEBER="http://127.0.0.1:$PROBEPORT/api/jellyfin/strom/$JFTITEL"

# ── 3. Kopfzeilen: Laenge und Sprungfaehigkeit ──────────────────────────────
kopf() { curl -s -o /dev/null -D - --max-time 30 -r 0-1023 "$1" 2>/dev/null | tr -d '\r'; }
for name in DIREKT UEBER; do
  eval "adresse=\$$name"
  antwort="$(kopf "$adresse")"
  status="$(printf '%s' "$antwort" | head -1 | awk '{print $2}')"
  typ="$(printf '%s' "$antwort" | grep -i '^content-type:' | head -1 | cut -d' ' -f2-)"
  bereich="$(printf '%s' "$antwort" | grep -i '^content-range:' | head -1 | cut -d' ' -f2-)"
  printf '  %-7s Bereichsabruf %s  Typ %-16s Bereich %s\n' "$name" "${status:-?}" "${typ:-?}" "${bereich:-FEHLT}"
done
echo

# ── 4. Der eigentliche Beweis: findet ein Abspieler die Laenge? ─────────────
# ffprobe gehoert zur selben libav-Familie wie mpv. Findet es die Dauer, kann
# mpv sie auch — und damit gibt es „endet um" und einen Sprung an eine Stelle.
dauer() { ffprobe -v error -show_entries format=duration -of csv=p=0 -- "$1" 2>/dev/null | head -1; }
DD="$(dauer "$DIREKT")"
DU="$(dauer "$UEBER")"
printf '  Dauer direkt ueber Jellyfin : %s s\n' "${DD:-NICHT GEFUNDEN}"
printf '  Dauer ueber den Weiterreicher: %s s\n' "${DU:-NICHT GEFUNDEN}"
echo

# ── 4b. Das COVER ueber die Box (E15/S1) ────────────────────────────────────
# Derselbe Zugang, derselbe Gedanke: die Box holt das Bild und schickt den
# Schluessel als Kopfzeile. Geprueft wird, dass wirklich ein BILD herauskommt —
# ein 200 mit einer HTML-Fehlerseite saehe sonst wie Erfolg aus.
BILD="http://127.0.0.1:$PROBEPORT/api/bild/jellyfin/$JFITEM"
btyp="$(curl -s -o /dev/null -D - --max-time 30 "$BILD" | tr -d '\r' | grep -i '^content-type:' | head -1 | cut -d' ' -f2-)"
bgroesse="$(curl -s --max-time 30 "$BILD" | wc -c)"
printf '  Cover ueber die Box: Typ %-14s %s Byte\n' "${btyp:-?}" "$bgroesse"
echo

# ── 5. Springen: dieselben Bytes an derselben Stelle? ───────────────────────
sd="$(curl -s --max-time 30 -r 200000-200063 "$DIREKT" | sha256sum | cut -c1-16)"
su="$(curl -s --max-time 30 -r 200000-200063 "$UEBER" | sha256sum | cut -c1-16)"
printf '  Sprung auf Byte 200000: direkt %s / ueber die Box %s  ->  %s\n' \
  "$sd" "$su" "$([ "$sd" = "$su" ] && [ -n "$sd" ] && echo GLEICH || echo VERSCHIEDEN)"
echo

if [ -n "$DU" ] && [ "$sd" = "$su" ] && [ -n "$sd" ] && [ "${btyp#image/}" != "$btyp" ]; then
  echo "  URTEIL: Der Weiterreicher traegt — Laenge da, Sprung stimmt, Cover kommt,"
  echo "          und kein api_key in der Adresse."
else
  echo "  URTEIL: TRAEGT NICHT. Den Umbau der Abspielbefehle zurueckstellen."
  tail -20 "$ARBEIT/server.log"
  exit 1
fi
