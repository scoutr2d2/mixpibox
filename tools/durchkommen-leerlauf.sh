#!/usr/bin/env bash
#
# KOMM TROTZDEM DURCH — die Leerlaufuhr unter Beschuss.
#
# `tools/leerlauf-uhr-nachspielen.sh` zeigt, dass die Beruehrung MITZAEHLT,
# wenn sie erkannt wird. Dieses Werkzeug stellt die andere Frage:
#
#     Was tut die Box, wenn die Beruehrung NICHT erkannt wird — und SAGT sie
#     das irgendwo?
#
# Die ganze Reparatur haengt an einer Voraussetzung: dass unter
# /sys/class/input Geraete stehen, die `menschlich` durchlaesst und die sich
# unter /dev/input oeffnen lassen. Trifft das nicht zu, verhaelt sich das
# Skript exakt wie die alte Fassung — die Box geht mitten im Hoerspiel aus.
# Das ist die Richtung, in der ein Fehler hier WEHTUT, und der Fehler waere
# unsichtbar: `lauschen_oeffnen` schreibt nur Geraete ins Protokoll, die es
# GEOEFFNET hat. Null Geraete heisst null Zeilen.
#
# Vier Lagen, an denen das eintritt, alle ohne Zutun eines Angreifers:
#   * ein anderes Board / ein anderer Kernel legt sysfs anders ab
#   * die Beruehrungsbruecke ist abgemeldet (der Dienst laesst sich abschalten)
#   * die Geraeteknoten sind nicht lesbar (Dienst mit `User=` statt als root)
#   * es gibt schlicht kein Eingabegeraet (Box ohne Schirm, nur Fernsteuerung)
#
# GEMESSEN WIRD AM ECHTEN SKRIPT. `MUPI_IDLE_NUR_FUNKTIONEN=1` haelt nur die
# Endlosschleife an; aufgerufen wird dessen eigene `runde()`. Attrappen sind
# nur: der Abschaltbefehl (ein `touch`, kein Ausschalten), die Konfiguration,
# die Zustandsdatei und die beiden Eingabe-Verzeichnisse — alles unter einem
# eigenen Sandkasten in $TMPDIR.
#
# ES WIRD NICHTS AUSGESCHALTET. Der Abschaltbefehl ist ersetzt; das Werkzeug
# kennt keine Adresse einer Box und fasst weder Ton noch Helligkeit an.
#
# AUFRUF:  bash tools/durchkommen-leerlauf.sh
# Rueckgabewert 0, wenn jede Aussage haelt.

set -u

HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKRIPT="${MUPI_IDLE_SKRIPT:-$HIER/../scripts/mupibox/idle_shutdown.sh}"

gruen=0
rot=0
melde() { # melde <ok0/1> <name> <text>
  if [ "$1" = 0 ]; then
    gruen=$((gruen + 1)); printf '  OK    %s — %s\n' "$2" "$3"
  else
    rot=$((rot + 1));    printf '  ROT   %s — %s\n' "$2" "$3"
  fi
}

SAND="$(mktemp -d "${TMPDIR:-/tmp}/mupi-durchkommen-leerlauf-XXXXXX")"
trap 'rm -rf "$SAND"' EXIT
case "$SAND" in
  "${TMPDIR:-/tmp}"/*) ;;
  *) echo "Sandkasten liegt nicht im Temp-Verzeichnis: $SAND" >&2; exit 1 ;;
esac

# ── Ein Lauf: n Runden gegen eine gegebene Eingabelage ──────────────────────
#
# Gibt aus:  <abgeschaltet 0/1> <runden bis dahin>
# und legt das Protokoll unter $SAND/log ab.
lauf() {
  local minuten="$1" sys="$2" dev="$3" runden_max="$4" karenz="${5:-0}"
  local d="$SAND/lauf"
  rm -rf "$d"; mkdir -p "$d"
  printf '{"timeout":{"idlePiShutdown":%s}}' "$minuten" > "$d/config.json"
  : > "$d/playerstate"          # leer = spielt NICHT
  : > "$d/log"
  : > "$d/AUSGESCHALTET.marke"; rm -f "$d/AUSGESCHALTET.marke"

  # Die Runden laufen in einer eigenen Shell, damit der Zustand des Skripts
  # (zaehler, runden, LAUSCHER) sauber bei 0 anfaengt.
  env -i \
    PATH="$PATH" HOME="$HOME" \
    MUPI_IDLE_NUR_FUNKTIONEN=1 \
    CONFIG="$d/config.json" \
    LOG="$d/log" \
    PLAYERSTATE="$d/playerstate" \
    JQ="$(command -v jq)" \
    TAKT=10 \
    STARTKARENZ="$karenz" \
    EINGABE_SYS="$sys" \
    EINGABE_DEV="$dev" \
    ABSCHALT_BEFEHL="touch $d/AUSGESCHALTET.marke" \
    bash -c '
      . "$0"
      for ((i=0; i<'"$runden_max"'; i++)); do
        if runde; then echo "AUS $((i+1))"; exit 0; fi
      done
      echo "AN $((i))"
    ' "$SKRIPT"
}

# Ein Eingabegeraet bauen, das `menschlich` durchlaesst: key-Faehigkeit != 0.
geraet_bauen() { # geraet_bauen <sys> <dev> <name> <lesbar 0/1>
  local sys="$1" dev="$2" n="$3" lesbar="$4"
  mkdir -p "$sys/$n/device/capabilities" "$dev"
  echo '120013 0 0 0' > "$sys/$n/device/capabilities/key"
  echo '0'            > "$sys/$n/device/capabilities/abs"
  echo '0'            > "$sys/$n/device/capabilities/rel"
  # EINE LEERE GEWOEHNLICHE DATEI, KEIN FIFO. Auf einem FIFO ohne Schreiber
  # blockiert `exec {fd}<…` — das echte evdev-Geraet ist ein Zeichengeraet und
  # blockiert nie. Eine leere Datei bildet beides richtig ab: sie laesst sich
  # sofort oeffnen, und `read -t 0` meldet darauf „nichts da", also genau das,
  # was hier gebraucht wird (niemand fasst die Box an).
  rm -f "$dev/$n"; : > "$dev/$n"
  [ "$lesbar" = 0 ] && chmod 000 "$dev/$n"
  return 0
}

echo "KOMM TROTZDEM DURCH — Leerlaufuhr, Sandkasten $SAND"
echo

# ── 1. DIE GEGENPROBE: mit einem erkannten Geraet steht es im Protokoll ─────
sys="$SAND/sys-gut"; dev="$SAND/dev-gut"; mkdir -p "$sys" "$dev"
geraet_bauen "$sys" "$dev" event0 1
erg="$(lauf 1 "$sys" "$dev" 12 0)"
log="$(cat "$SAND/lauf/log")"
if echo "$log" | grep -q 'EINGABE WIRD BEOBACHTET'; then
  melde 0 'GEGENPROBE: ein erkanntes Geraet steht im Protokoll' \
    "$(echo "$log" | grep -m1 'EINGABE WIRD BEOBACHTET' | sed 's/.*# //')"
else
  melde 1 'GEGENPROBE: ein erkanntes Geraet steht im Protokoll' 'keine solche Zeile'
fi

# ── 2. KEIN EINZIGES GERAET — was tut die Box, und was sagt sie? ────────────
sys="$SAND/sys-leer"; dev="$SAND/dev-leer"; mkdir -p "$sys" "$dev"
erg="$(lauf 1 "$sys" "$dev" 12 0)"
log="$(cat "$SAND/lauf/log")"
aus="${erg%% *}"
melde $([ "$aus" = AUS ] && echo 0 || echo 1) \
  'ohne Eingabegeraet schaltet die Box wie eingestellt ab' \
  "$erg (das ist gewollt — die eingestellte Zahl gilt)"

# HIER IST DIE FRAGE. Die Abschaltung ist richtig; das SCHWEIGEN ist es nicht.
if echo "$log" | grep -qiE 'KEIN EINGABEGERAET|blind|nicht beobachtet'; then
  melde 0 'das Protokoll sagt, dass NICHTS beobachtet wird' \
    "$(echo "$log" | grep -m1 -iE 'KEIN EINGABEGERAET|blind|nicht beobachtet' | sed 's/.*# //')"
else
  melde 1 'das Protokoll sagt, dass NICHTS beobachtet wird' \
    'SCHWEIGEN — die Beruehrungserkennung ist tot und keine Zeile erwaehnt es; das Protokoll sieht aus wie ein gesunder Lauf'
fi

# ── 3. GERAETE DA, ABER NICHT LESBAR — dieselbe Blindheit ───────────────────
if [ "$(id -u)" = 0 ]; then
  echo '  UEBERSPRUNGEN  „nicht lesbar" ist als root nicht herstellbar'
else
  sys="$SAND/sys-zu"; dev="$SAND/dev-zu"; mkdir -p "$sys" "$dev"
  geraet_bauen "$sys" "$dev" event0 0
  erg="$(lauf 1 "$sys" "$dev" 12 0)"
  log="$(cat "$SAND/lauf/log")"
  if echo "$log" | grep -qiE 'KEIN EINGABEGERAET|nicht lesbar|blind'; then
    melde 0 'unlesbare Geraeteknoten stehen im Protokoll' \
      "$(echo "$log" | grep -m1 -iE 'KEIN EINGABEGERAET|nicht lesbar|blind' | sed 's/.*# //')"
  else
    melde 1 'unlesbare Geraeteknoten stehen im Protokoll' \
      'SCHWEIGEN — 1 Geraet vorhanden, 0 beobachtet, keine Zeile darueber'
  fi
  chmod 644 "$dev/event0" 2>/dev/null
fi

# ── 4. GERAET DA, ABER NICHTS DAVON IST „MENSCHLICH" ───────────────────────
# Das ist der „HDMI Jack"-Fall: ein Geraet, das nur „Kabel steckt" meldet.
# Wenn es das EINZIGE ist, ist die Erkennung ebenfalls blind.
sys="$SAND/sys-hdmi"; dev="$SAND/dev-hdmi"; mkdir -p "$sys/event0/device/capabilities" "$dev"
for f in key abs rel; do echo '0' > "$sys/event0/device/capabilities/$f"; done
: > "$dev/event0"
erg="$(lauf 1 "$sys" "$dev" 12 0)"
log="$(cat "$SAND/lauf/log")"
if echo "$log" | grep -qiE 'KEIN EINGABEGERAET|blind|nicht beobachtet'; then
  melde 0 'nur „HDMI-Jack"-artige Geraete stehen im Protokoll' \
    "$(echo "$log" | grep -m1 -iE 'KEIN EINGABEGERAET|blind|nicht beobachtet' | sed 's/.*# //')"
else
  melde 1 'nur „HDMI-Jack"-artige Geraete stehen im Protokoll' \
    'SCHWEIGEN — 1 Geraet vorhanden, keines menschlich, keine Zeile darueber'
fi

# ── 5. DIE RICHTUNG BLEIBT: nie FRUEHER als eingestellt ─────────────────────
# Egal wie blind die Erkennung ist, sie darf die Box nie frueher ausschalten
# als die alte Fassung. 1 Minute = 6 Runden a 10 s.
sys="$SAND/sys-leer"; dev="$SAND/dev-leer"
erg="$(lauf 1 "$sys" "$dev" 12 0)"
runden="${erg##* }"
melde $([ "$runden" -ge 6 ] && echo 0 || echo 1) \
  'blind heisst nie FRUEHER als die eingestellte Zahl' \
  "abgeschaltet nach $runden Runden a 10 s (mindestens 6 = 1 Minute)"

# ── 6. UND DIE KARENZ HAELT AUCH BLIND ──────────────────────────────────────
erg="$(lauf 1 "$sys" "$dev" 12 120)"
melde $([ "${erg%% *}" = AN ] && echo 0 || echo 1) \
  'die Startkarenz haelt auch ohne Eingabegeraet' \
  "$erg (120 s Karenz, 12 Runden a 10 s — darf nicht abschalten)"

# ── 7. DIE MELDUNG DARF NICHT SPAMMEN ───────────────────────────────────────
# Der Aufruf steht in der Schleife (alle 10 s). Eine Zeile je Runde liefe die
# Datei unter /tmp voll — und /tmp ist auf dieser Box tmpfs, also RAM.
sys="$SAND/sys-leer"; dev="$SAND/dev-leer"
# 1440 min statt 0: bei 0 kehrt `runde` zurueck, BEVOR ueberhaupt gelauscht
# wird (`max -le 0`) — dann laeuft dieser Fall ins Leere, ohne etwas zu messen.
erg="$(lauf 1440 "$sys" "$dev" 40 0)"
n="$(grep -c 'KEIN EINGABEGERAET' "$SAND/lauf/log")"
n="${n:-0}"
melde $([ "$n" -le 1 ] && echo 0 || echo 1) \
  'die Blind-Meldung steht EINMAL da, nicht in jeder Runde' \
  "$n Zeilen in 40 Runden"

# ── 8. UND SIE NIMMT SICH ZURUECK, WENN EIN GERAET AUFTAUCHT ────────────────
# Das ist der Normalfall an der Box: der Dienst haengt an basic.target, die
# Beruehrungsbruecke kommt spaeter. Ohne diesen Zweig stuende die
# Schreckensmeldung bei JEDEM Hochfahren im Protokoll und waere nach einer
# Woche Rauschen, das niemand mehr liest.
d="$SAND/spaet"; rm -rf "$d"; mkdir -p "$d/sys" "$d/dev" "$d/lauf"
printf '{"timeout":{"idlePiShutdown":1440}}' > "$d/config.json"
: > "$d/playerstate"; : > "$d/log"
env -i PATH="$PATH" HOME="$HOME" MUPI_IDLE_NUR_FUNKTIONEN=1 \
  CONFIG="$d/config.json" LOG="$d/log" PLAYERSTATE="$d/playerstate" \
  JQ="$(command -v jq)" TAKT=10 STARTKARENZ=0 \
  EINGABE_SYS="$d/sys" EINGABE_DEV="$d/dev" ABSCHALT_BEFEHL="true" \
  bash -c '
    . "$0"
    runde; runde; runde                 # noch nichts da -> blind
    mkdir -p "$1/sys/event0/device/capabilities"
    printf "120013 0 0 0\n" > "$1/sys/event0/device/capabilities/key"
    printf "0\n" > "$1/sys/event0/device/capabilities/abs"
    printf "0\n" > "$1/sys/event0/device/capabilities/rel"
    : > "$1/dev/event0"
    runde; runde                        # jetzt da -> muss sich zuruecknehmen
  ' "$SKRIPT" "$d" >/dev/null 2>&1
if grep -q 'KEIN EINGABEGERAET' "$d/log" && grep -q 'WIEDER BEOBACHTET' "$d/log"; then
  melde 0 'taucht ein Geraet spaeter auf, nimmt sich die Meldung zurueck' \
    "$(grep -m1 'WIEDER BEOBACHTET' "$d/log" | sed 's/.*# //')"
else
  melde 1 'taucht ein Geraet spaeter auf, nimmt sich die Meldung zurueck' \
    "Protokoll: $(tr '\n' '|' < "$d/log" | sed 's/[0-9/:]\{8,\}//g')"
fi

echo
echo "$gruen gruen, $rot rot"
[ "$rot" = 0 ]
