#!/bin/bash
# Der Boden unter `mupibox.maxVolume` — am echten Skript geprueft.
#
# WAS GEPRUEFT WIRD, sind zwei Sackgassen derselben Bauart:
#
#   maxVolume = 0  -> die Verwaltung bietet diese 0 ausdruecklich an
#                     (konfiguration.ts, `maxLautstaerke`, min: 0). Sie hiess
#                     bis zum 07.08.2026 in mupi-lautstaerke.sh „unbrauchbar,
#                     nimm 100". Wer die Box still haben wollte, bekam die
#                     lauteste. Am Ohr des Kindes.
#   maxVolume = 1  -> eine Box, die praktisch stumm ist, obwohl sie laeuft. Das
#                     Feld steht in KEINER Oberflaeche der Box selbst; zurueck
#                     kommt man nur von einem zweiten Geraet aus.
#
# WIE GEPRUEFT WIRD: das echte scripts/mupibox/mupi-lautstaerke.sh wird
# AUSGEFUEHRT, nicht nachgebaut. Zwei Wege:
#
#   `grenze`  fragt `hoechstwert()` direkt — braucht nur eine Konfiguration.
#   `set N`   geht den ganzen Weg bis zum Tonstapel. Damit dabei NIEMALS die
#             Lautstaerke dieser Maschine verstellt wird, liegt ein
#             Attrappen-`wpctl` in einem eigenen Verzeichnis GANZ VORNE im
#             PATH; es schreibt nur mit, womit es aufgerufen wurde. Bevor
#             irgendetwas laeuft, wird geprueft, dass `command -v wpctl`
#             wirklich dort landet — sonst bricht die Probe ab.
#
#   Aufruf:  bash tools/lautstaerke-boden-probe.sh
set -u

WURZEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKRIPT="$WURZEL/scripts/mupibox/mupi-lautstaerke.sh"

command -v jq >/dev/null 2>&1 || { echo "jq fehlt"; exit 2; }

WERK="$(mktemp -d)"
trap 'rm -rf "$WERK"' EXIT
mkdir -p "$WERK/attrappen"

# ── Der Tonstapel, der nichts tut ──────────────────────────────────────────
cat > "$WERK/attrappen/wpctl" <<EOF
#!/bin/bash
[ "\$1" = "status" ] && exit 0
echo "\$*" >> "$WERK/gesetzt"
exit 0
EOF
# amixer ebenfalls stilllegen, damit auch der ALSA-Zweig oder ein vergessener
# Aufruf nie an der echten Karte landet.
for w in amixer; do
  printf '#!/bin/bash\necho "%s $*" >> "%s"\nexit 0\n' "$w" "$WERK/gesetzt" > "$WERK/attrappen/$w"
done

# ── pw-dump UND pactl: STILLLEGEN, ABER ANTWORTEN ─────────────────────────
#
# Seit dem 23.08.2026 zieht `setze` vor dem Setzen alle nicht-regelnden Senken
# auf Einheit (`einheit_nachziehen`, Befund „Lautstaerke stark gedeckelt").
# Dafuer fragt es `pw-dump` und `pactl get-default-sink`.
#
# `pw-dump` WAR HIER NICHT STILLGELEGT, und das war ein Loch: auf einem
# Entwicklerrechner MIT PipeWire haette die Probe die Senken DIESER MASCHINE
# aufgezaehlt und je nach deren Lautstaerken unterschiedlich viele Zeilen
# erzeugt — eine Probe, deren Ergebnis vom Schreibtisch abhaengt, auf dem sie
# laeuft. Eine leere Liste macht sie wieder ortsunabhaengig.
#
# `pactl` schreibt NICHT mehr mit: Zeile 78 vergleicht das GANZE Protokoll,
# und `get-default-sink` ist ein LESEN. Was gelesen wurde, gehoert nicht in
# eine Liste dessen, was gesetzt wurde — sonst faerbt jede neue Abfrage im
# Skript diese Probe rot, ohne dass sich am Verhalten etwas geaendert haette.
# Setzende pactl-Aufrufe wuerden weiterhin auffallen: sie landen im `*)`-Zweig.
printf '#!/bin/bash\necho "[]"\nexit 0\n' > "$WERK/attrappen/pw-dump"
cat > "$WERK/attrappen/pactl" <<EOF
#!/bin/bash
case "\$1" in
  get-default-sink) echo "attrappen-senke"; exit 0 ;;
  *) echo "pactl \$*" >> "$WERK/gesetzt"; exit 0 ;;
esac
EOF
chmod +x "$WERK/attrappen"/*
: > "$WERK/gesetzt"

PFAD="$WERK/attrappen:/usr/bin:/bin"
gefunden="$(PATH="$PFAD" command -v wpctl)"
if [ "$gefunden" != "$WERK/attrappen/wpctl" ]; then
  echo "ABBRUCH: wpctl waere das echte gewesen ($gefunden) — nichts ausgefuehrt."
  exit 2
fi

GRUEN=0; ROT=0
sagen() { # sagen <erwartet> <bekommen> <was>
  if [ "$1" = "$2" ]; then GRUEN=$((GRUEN+1)); printf '  ok    %s\n' "$3"
  else ROT=$((ROT+1)); printf '  ROT   %s\n         erwartet: %s\n         bekommen: %s\n' "$3" "$1" "$2"; fi
}

konfig() { # konfig <maxVolume-roh>   — roh, damit auch Unsinn hineinpasst
  printf '{ "mupibox": { "startVolume": "40", "maxVolume": %s } }\n' "$1" > "$WERK/config.json"
}

grenze() { # grenze [boden]
  MUPI_CONFIG="$WERK/config.json" MUPI_MAXVOL_BODEN="${1:-}" PATH="$PFAD" \
    bash "$SKRIPT" grenze
}

setzen() { # setzen <wunsch> -> was beim Tonstapel ankam
  : > "$WERK/gesetzt"
  MUPI_CONFIG="$WERK/config.json" PATH="$PFAD" bash "$SKRIPT" set "$1" >/dev/null 2>&1
  tr -d '\n' < "$WERK/gesetzt"
}

echo "Der Boden unter maxVolume — am echten mupi-lautstaerke.sh"
echo

# ══ 0. EINE WAHRHEIT, NICHT ZWEI ═══════════════════════════════════════════
#
# Die Verwaltung schreibt dem Betreiber hin, ab wann die Box nicht mehr leiser
# regelt. Diese Zahl steht dort noch einmal (feld-folgen.ts, LAUTSTAERKE_BODEN)
# — sie MUSS, denn die Oberflaeche kann kein Shell-Skript lesen. Laufen die
# beiden auseinander, verspricht die Verwaltung etwas, das am Geraet nicht
# gilt. Das ist genau die Sorte Luege, um die es in diesem ganzen Lauf geht,
# also wird sie hier festgenagelt.
imSkript="$(sed -n 's/^BODEN="\${MUPI_MAXVOL_BODEN:-\([0-9]\+\)}".*/\1/p' "$SKRIPT")"
imSatz="$(sed -n 's/^export const LAUTSTAERKE_BODEN = \([0-9]\+\).*/\1/p' \
  "$WURZEL/src/frontend-admin/src/app/feld-folgen.ts")"
sagen "$imSkript" "$imSatz" "Boden im Skript ($imSkript) = Boden im Satz der Verwaltung"


# ══ 1. Die Sackgasse, die in die LAUTE Richtung zeigte ═════════════════════
konfig '"0"'
sagen "10" "$(grenze)" "maxVolume 0 -> Boden 10 (vorher: 100, also volle Lautstaerke)"
konfig '"1"'
sagen "10" "$(grenze)" "maxVolume 1 -> Boden 10 (Box bleibt hoerbar)"
konfig '"-5"'
sagen "10" "$(grenze)" "maxVolume -5 -> Boden 10 (vorher: „keine Zahl\" -> 100)"

# ══ 2. Was sich NICHT aendern durfte ═══════════════════════════════════════
konfig '"55"'
sagen "55" "$(grenze)" "maxVolume 55 bleibt 55"
konfig '"10"'
sagen "10" "$(grenze)" "maxVolume 10 — genau auf dem Boden, bleibt 10"
konfig '"100"'
sagen "100" "$(grenze)" "maxVolume 100 bleibt 100"
konfig '"140"'
sagen "100" "$(grenze)" "maxVolume 140 -> 100"
konfig '"40.7"'
sagen "40" "$(grenze)" "maxVolume 40.7 -> 40 (wie bisher abgeschnitten)"

# Unbrauchbar heisst weiter 100. Eine Box, deren Konfiguration sich nicht lesen
# laesst, darf nicht ploetzlich leise sein — das war schon die Regel und bleibt.
konfig 'null'
sagen "100" "$(grenze)" "maxVolume fehlt/null -> 100 (unveraendert)"
konfig '"abc"'
sagen "100" "$(grenze)" "maxVolume „abc\" -> 100 (unveraendert)"
printf 'kaputt {' > "$WERK/config.json"
sagen "100" "$(grenze)" "Konfiguration unlesbar -> 100 (unveraendert)"

# ══ 3. Es ist SEINE Box: der Boden laesst sich senken ══════════════════════
konfig '"1"'
sagen "1" "$(grenze 1)" "MUPI_MAXVOL_BODEN=1 -> die 1 gilt wieder"

# ══ 4. Der ganze Weg, nicht nur die Rechnung ═══════════════════════════════
#
# Beweist, dass `klemme()` denselben Boden benutzt — die Grenze sitzt im
# Flaschenhals, durch den alle Aufrufer muessen, nicht in einem Eingabefeld.
konfig '"1"'
sagen "set-volume @DEFAULT_AUDIO_SINK@ 10%" "$(setzen 100)" \
  "set 100 bei maxVolume 1 -> beim Tonstapel kommt 10 % an"
konfig '"55"'
sagen "set-volume @DEFAULT_AUDIO_SINK@ 55%" "$(setzen 100)" \
  "set 100 bei maxVolume 55 -> 55 % (unveraendert)"
sagen "set-volume @DEFAULT_AUDIO_SINK@ 30%" "$(setzen 30)" \
  "set 30 bei maxVolume 55 -> 30 % (unveraendert)"
sagen "" "$(setzen null)" \
  "set null -> gar nichts angefasst (unveraendert)"

echo
echo "gruen: $GRUEN   rot: $ROT"
[ "$ROT" -eq 0 ]
