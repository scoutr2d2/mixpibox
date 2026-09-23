#!/bin/sh
# librespot beim Arbeiten zuhoeren — und danach WIEDER STILLSTELLEN.
#
# WOZU: librespot laeuft auf der Box mit `-q`. Es sagt dann nichts, und
# genau das steht im Weg, wenn man wissen will, warum es einen Befehl NICHT
# ausfuehrt. Beim Spulen war das der Fall: rueckwaerts sprang es, vorwaerts
# passierte nichts — ohne eine Zeile im Protokoll (llmwiki
# spotify-vorwaerts-spulen-wirkungslos).
#
# DAS HEIKLE DARAN ist nicht das Zuhoeren, sondern das Zurueckstellen. Ein
# gespraechiger librespot auf einer Kinderbox schreibt Tag und Nacht ins
# Systemprotokoll und fuellt die SD-Karte. Wer das von Hand macht, vergisst
# es — deshalb raeumt dieses Werkzeug in einem `trap` auf, auch wenn es
# abgebrochen wird oder mittendrin scheitert.
#
# WIE: eine systemd-Ergaenzung (drop-in), die NUR die ExecStart-Zeile
# ueberschreibt. Die Unit der Box bleibt unangetastet; zum Zurueckstellen
# genuegt es, die Ergaenzung zu loeschen.
#
# WAS ES AENDERT (und zuruecknimmt):
#   * /etc/systemd/system/librespot.service.d/90-mitlesen.conf  (angelegt)
#   * librespot.service wird zweimal neu gestartet
# Die Wiedergabe bricht dabei ab. Auf einer Box, an der jemand hoert, ist das
# hoerbar — deshalb fragt es vorher nach, wenn es nicht mit --sofort laeuft.
#
# AUFRUF
#     tools/librespot-mitlesen.sh <box> "<probe-befehl>"
#     tools/librespot-mitlesen.sh 192.168.178.169 "seekpos:60000" --sofort
#
# Der Probe-Befehl geht an /player/current/<befehl> der Box.
set -eu

BOX="${1:-}"
PROBE="${2:-}"
SOFORT=""
NUR_ANMELDUNG=""
for a in "$@"; do
  [ "$a" = "--sofort" ] && SOFORT=1
  [ "$a" = "--nur-anmeldung" ] && NUR_ANMELDUNG=1
done

if [ -z "$BOX" ] || { [ -z "$PROBE" ] && [ -z "$NUR_ANMELDUNG" ]; }; then
  echo "Aufruf: $(basename "$0") <box> \"<probe-befehl>\" [--sofort]" >&2
  echo "   oder: $(basename "$0") <box> --nur-anmeldung [--sofort]" >&2
  echo "Beispiel: $(basename "$0") 192.168.178.169 \"seekpos:60000\"" >&2
  exit 2
fi

FERN="ssh -o BatchMode=yes -o ConnectTimeout=8 dietpi@${BOX}"
# Der Name faengt mit zz- an, und das ist kein Geschmack, sondern Pflicht:
# systemd liest Ergaenzungen in Namensreihenfolge, die spaetere gewinnt.
# Neben dieser liegt `nicht-blockieren.conf` — 'n' kommt nach '9', also
# ueberschrieb sie eine frueher '90-mitlesen.conf' genannte Datei stumm
# wieder mit -q. Das Werkzeug las dann brav das Protokoll eines Prozesses
# mit, den es nie gesprächig gemacht hatte.
ERGAENZUNG=/etc/systemd/system/librespot.service.d/zz-mitlesen.conf

aufraeumen() {
  echo ""
  echo "── Stillstellen (das passiert IMMER, auch bei Abbruch)"
  $FERN "sudo rm -f ${ERGAENZUNG} && sudo systemctl daemon-reload && sudo systemctl restart librespot.service" \
    && echo "   Ergaenzung entfernt, librespot laeuft wieder mit -q" \
    || echo "   ACHTUNG: Zurueckstellen misslungen — bitte pruefen: sudo rm -f ${ERGAENZUNG}"
}
trap aufraeumen EXIT INT TERM

if [ -z "$SOFORT" ]; then
  printf "librespot auf %s wird zweimal neu gestartet, die Wiedergabe bricht ab. Weiter? [j/N] " "$BOX"
  read -r antwort
  case "$antwort" in j|J|y|Y) ;; *) echo "abgebrochen"; exit 0 ;; esac
fi

echo "── Bisherige Startzeile:"
$FERN "systemctl cat librespot.service | grep -m1 '^ExecStart=/bin/bash'" | sed 's/^/   /'

echo "── Ergaenzung anlegen (ExecStart ohne -q, dafuer -v)"
# `ExecStart=` leer setzen ist bei systemd Pflicht, bevor eine zweite Zeile
# gilt — sonst haengt sie an die bestehende an und startet ZWEI librespot.
#
# Die Ergaenzung startet librespot SOFORT. Eine fruehere Fassung wartete hier
# erst bis zu 90 s auf eine Audio-Senke (aus einem Start-Skript uebernommen).
# Damit machte sich das Werkzeug selbst blind: Es beobachtete 90 s lang ein
# Protokoll von einem Prozess, den es selbst noch gar nicht gestartet hatte,
# und meldete "librespot sagt nichts". Wer beim Start zusieht, darf den Start
# nicht verzoegern.
$FERN "sudo mkdir -p $(dirname ${ERGAENZUNG}) && sudo tee ${ERGAENZUNG} >/dev/null <<'ENDE'
[Service]
# NUR ZUM MITLESEN, wird von tools/librespot-mitlesen.sh wieder entfernt.
ExecStart=
ExecStart=/bin/bash -c 'source /etc/librespot/env-librespot && exec /usr/bin/librespot -v'
ENDE
sudo systemctl daemon-reload && sudo systemctl restart librespot.service"

# Wonach hier gesucht wird, ist wichtiger als es aussieht: Die erste Fassung
# hielt nach IRGENDEINEM '"name"' in der Antwort Ausschau. Steht ein Handy im
# Netz, meldet Spotify das mit — und das Werkzeug meldete "bereit", obwohl die
# Box selbst gar nicht angemeldet war. Gesucht wird deshalb ihr eigener Name.
EIGENER=$($FERN "grep -o -- '--name [^ ]*' /etc/librespot/env-librespot 2>/dev/null | head -1 | cut -d' ' -f2 | tr -d \"'\\\"\"" 2>/dev/null || true)
[ -n "$EIGENER" ] || EIGENER=$($FERN "jq -r '.mupibox.host // empty' /etc/mupibox/mupiboxconfig.json 2>/dev/null" 2>/dev/null || true)
[ -n "$EIGENER" ] || EIGENER="MuPiBox"
echo "── Warten, bis \"${EIGENER}\" wieder bei Spotify angemeldet ist"

WARTE_RUNDEN=30
[ -n "$NUR_ANMELDUNG" ] && WARTE_RUNDEN=45
i=0
ANGEMELDET=""
while [ "$i" -lt "$WARTE_RUNDEN" ]; do
  i=$((i + 1))
  if $FERN "curl -s -m 4 http://localhost:8200/api/spotify/web/me/player/devices" 2>/dev/null \
      | grep -qF "\"${EIGENER}\""; then
    ANGEMELDET=1
    break
  fi
  sleep 2
done
if [ -n "$ANGEMELDET" ]; then
  echo "   nach $((i * 2)) s angemeldet"
else
  echo "   nach $((i * 2)) s IMMER NOCH NICHT angemeldet"
fi

if [ -n "$NUR_ANMELDUNG" ]; then
  echo ""
  echo "══ WAS LIBRESPOT BEIM ANMELDEN SAGT:"
  # Ohne -q redet librespot beim Start ueber genau das, was hier fehlschlaegt:
  # Anmeldung, Verbindung zum Zugangsserver, Registrierung als Connect-Geraet.
  $FERN "sudo journalctl -u librespot.service --since '-3 min' --no-pager \
         | grep -viE 'telegram|telepot|Traceback|File \\\"' | tail -60" | sed 's/^/   /'
  exit 0
fi

echo "── Etwas starten — und WARTEN, bis wirklich etwas laeuft"
#
# Der erste Anlauf schickte den Probe-Befehl acht Sekunden nach dem Start.
# Das war zu frueh: `progress_ms` war noch `None`, die Wiedergabe also noch
# gar nicht angelaufen. Ein Sprung, der ins Nichts geht, weil noch nichts da
# ist, beweist nichts ueber das Springen.
$FERN "python3 - <<'PY'
import json, time, urllib.request
def hol(p, frist=10):
    with urllib.request.urlopen(f'http://localhost:8200{p}', timeout=frist) as r: return r.status
def stand():
    try:
        d = json.load(urllib.request.urlopen('http://localhost:5005/state', timeout=8))
        return d.get('progress_ms'), (d.get('item') or {}).get('duration_ms')
    except Exception:
        return None, None

# DEN START WIEDERHOLEN, nicht nur einmal schicken.
#
# Nach einem Neustart von librespot ist das Geraet bei Spotify zwar wieder
# gelistet, aber nicht unbedingt das AKTIVE. Der erste Startbefehl geht dann
# ins Leere. Beim ersten Anlauf dieses Werkzeugs brach die Probe genau
# deshalb ab ('ES LAEUFT NICHTS') — der Fehler lag nicht an der Box, sondern
# daran, dass hier nur einmal geklopft wurde.
start = '/player/current/spotify/now/spotify:playlist:2QqQXuDKNR8HK1cFxf0NhW:6:0'
for versuch in range(4):
    hol(start, 15)
    for _ in range(12):
        p, d = stand()
        if p and p > 3000 and d:
            break
        time.sleep(1)
    p, d = stand()
    if p and p > 3000 and d:
        break
    print(f'   (Startversuch {versuch + 1} ohne Wirkung, nochmal)')
p, d = stand()
print(f'   vorher:   {p} ms von {d} ms')
if not p or p <= 3000:
    print('   ES LAEUFT NICHTS — die Probe waere sinnlos, Abbruch')
    raise SystemExit(0)

open('/tmp/mitlesen-marke', 'w').write(str(int(time.time())))
hol('/player/current/${PROBE}', 15)
time.sleep(5)
p2, _ = stand()
print(f'   danach:   {p2} ms')
print(f'   Sprung:   {(p2 or 0) - p:+d} ms   (5 s Wartezeit sind ~+5000 ohne Sprung)')
hol('/player/current/pause')
PY"

echo ""
echo "══ WAS LIBRESPOT DAZU SAGT (ab dem Probe-Befehl):"
$FERN "test -r /tmp/mitlesen-marke || { echo '   (keine Probe gelaufen — nichts mitzulesen)'; exit 0; }; sudo journalctl -u librespot.service --since \"@\$(cat /tmp/mitlesen-marke)\" --no-pager | grep -viE 'telegram|telepot|Traceback|File \\\"' | tail -40; rm -f /tmp/mitlesen-marke" \
  | sed 's/^/   /'
