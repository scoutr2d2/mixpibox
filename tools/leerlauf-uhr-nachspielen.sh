#!/bin/bash
# Die Uhr von idle_shutdown.sh nachspielen — im echten 10-Sekunden-Takt.
#
# WAS DIESES WERKZEUG NICHT TUT: das Skript nachbauen. Es LAEDT
# scripts/mupibox/idle_shutdown.sh unveraendert (`MUPI_IDLE_NUR_FUNKTIONEN=1`
# haelt nur die Endlosschleife an) und ruft dessen eigene `runde()` auf. Ein
# Nachbau haette geprueft, wie ich das Skript VERSTEHE — nicht, was es TUT.
# Genau daran ist der Befund ja jahrelang vorbeigegangen.
#
# WAS UNTERGESCHOBEN WIRD, und warum das erlaubt ist: nur Pfade und der
# Abschaltbefehl. Alle stehen im Skript als `: "${NAME:=…}"`, sind also von
# aussen setzbar, ohne dass eine Zeile Logik anders laeuft. Der Abschaltbefehl
# MUSS ersetzt werden — ein Werkzeug, das zum Pruefen den Rechner ausschaltet,
# fuehrt niemand zweimal aus.
#
# DIE EINGABEGERAETE SIND FIFOS. Das Skript fragt sie mit `read -t 0` und leert
# sie mit `dd` — beides verhaelt sich bei einer FIFO wie bei /dev/input/eventN.
# Die Faehigkeiten (`capabilities/key|abs|rel`) liegen als Attrappen daneben,
# mit denselben Hex-Woertern, die an der Box gemessen wurden. So laesst sich
# auch pruefen, dass die beiden „HDMI Jack" (alles 0) ueberspringen werden.
#
#   Aufruf:  bash tools/leerlauf-uhr-nachspielen.sh
#   Rueckgabe 0, wenn alle Faelle stimmen.
set -u

WURZEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKRIPT="$WURZEL/scripts/mupibox/idle_shutdown.sh"

command -v jq >/dev/null 2>&1 || { echo "jq fehlt — ohne jq liest das Skript keine Konfiguration"; exit 2; }

GRUEN=0
ROT=0
sagen() { # sagen <erwartet> <bekommen> <was>
  if [ "$1" = "$2" ]; then
    GRUEN=$((GRUEN + 1)); printf '  ok    %s\n' "$3"
  else
    ROT=$((ROT + 1)); printf '  ROT   %s\n         erwartet: %s\n         bekommen: %s\n' "$3" "$1" "$2"
  fi
}

# ── Die Attrappe: eine Box in einem Verzeichnis ────────────────────────────
#
# Geraete genau wie an der Box .169 gemessen (07.08.2026):
#   pwr_button           key gesetzt        -> wird beobachtet
#   MuPiBox Touch Bridge key + abs gesetzt  -> wird beobachtet
#   HDMI Jack            alles 0            -> wird NICHT beobachtet
attrappe_bauen() {
  WERK="$(mktemp -d)"
  mkdir -p "$WERK/sys" "$WERK/dev"
  geraet() { # geraet <name> <key> <abs> <rel>
    mkdir -p "$WERK/sys/$1/device/capabilities"
    printf '%s\n' "$2" > "$WERK/sys/$1/device/capabilities/key"
    printf '%s\n' "$3" > "$WERK/sys/$1/device/capabilities/abs"
    printf '%s\n' "$4" > "$WERK/sys/$1/device/capabilities/rel"
    mkfifo "$WERK/dev/$1"
  }
  geraet event0 "10000000000000 0"      "0"                 "0"   # pwr_button
  geraet event2 "0"                     "0"                 "0"   # HDMI Jack
  geraet event5 "400 0 0 0 0 0"         "260800000000003"   "0"   # Touch Bridge

  # Ein Geraet, das erst SPAETER da ist. Auf der Box ist das der Normalfall:
  # mupi_idle_shutdown.service haengt an basic.target, die Touch-Bruecke
  # kommt spaeter. Die Faehigkeiten werden weggelegt und mitten im Durchlauf
  # hereingeschoben — der Geraeteknoten allein macht noch kein Geraet, denn
  # gesucht wird ueber sysfs.
  mkdir -p "$WERK/spaet"
  geraet event9 "400 0 0 0 0 0"         "260800000000003"   "0"   # spaete Bruecke
  mv "$WERK/sys/event9" "$WERK/spaet/event9"
  exec {SCHREIB9}<>"$WERK/dev/event9"

  # Die FIFOs offen halten (lesend UND schreibend), sonst blockiert das
  # `exec {fd}<` im Skript auf einen Schreiber, den es nie gaebe.
  exec {SCHREIB0}<>"$WERK/dev/event0"
  exec {SCHREIB2}<>"$WERK/dev/event2"
  exec {SCHREIB5}<>"$WERK/dev/event5"

  printf 'stop\n' > "$WERK/playerstate"
  : > "$WERK/log"
  : > "$WERK/abschaltung"

  # Ein Abschaltbefehl, der nur eine Zeile schreibt.
  cat > "$WERK/nicht-abschalten.sh" <<EOF
#!/bin/bash
echo "ABSCHALTUNG" >> "$WERK/abschaltung"
EOF
  chmod +x "$WERK/nicht-abschalten.sh"
}

konfig_schreiben() { # konfig_schreiben <minuten>
  cat > "$WERK/config.json" <<EOF
{ "timeout": { "idlePiShutdown": "$1", "idleDisplayOff": "10" },
  "telegram": { "active": false, "chatId": "", "token": "" } }
EOF
}

# Ein Ereignis, wie es ein Finger ausloest: ein evdev-Satz ist 24 Byte gross.
tippen() { head -c 24 /dev/zero >&"$1"; }

# ── Ein Durchlauf ──────────────────────────────────────────────────────────
#
# Laeuft in einer SUBSHELL, damit der Zustand des Skripts (`zaehler`, `runden`,
# die offenen Deskriptoren) zwischen den Faellen nicht ueberlebt — auf der Box
# ist jeder Fall ein frisch gestarteter Dienst.
#
# `$1` Runden, `$2` Bash-Ausdruck, der je Runde ausgewertet wird (darf tippen,
# den Spielzustand aendern …). Gibt die Rundennummer der Abschaltung aus oder
# "nie".
durchlauf() { # durchlauf <runden> <karenz> <je-runde-befehl>
  local n="$1" karenz="$2" befehl="$3"
  (
    export MUPI_IDLE_NUR_FUNKTIONEN=1
    export CONFIG="$WERK/config.json"
    export LOG="$WERK/log"
    export PLAYERSTATE="$WERK/playerstate"
    export EINGABE_SYS="$WERK/sys"
    export EINGABE_DEV="$WERK/dev"
    export ABSCHALT_BEFEHL="$WERK/nicht-abschalten.sh"
    export STARTKARENZ="$karenz"
    export TAKT=10
    # shellcheck disable=SC1090
    . "$SKRIPT"
    local i
    for ((i = 1; i <= n; i++)); do
      eval "$befehl"
      if runde; then echo "$i"; exit 0; fi
    done
    echo "nie"
  )
}

attrappe_bauen
trap 'rm -rf "$WERK"' EXIT

echo "Die Uhr von idle_shutdown.sh — 10-Sekunden-Takt, Startkarenz 120 s"
echo

# ══ 0. EINE WAHRHEIT, NICHT ZWEI ═══════════════════════════════════════════
#
# Die Verwaltung schreibt dem Betreiber die Startkarenz in ihren Satz („…
# beginnt diese Frist erst 120 Sekunden spaeter"). Sie kann kein Shell-Skript
# lesen, also steht die Zahl dort noch einmal. Laufen die beiden auseinander,
# verspricht die Verwaltung etwas, das die Box nicht tut.
imSkript="$(sed -n 's/^: "\${STARTKARENZ:=\([0-9]\+\)}".*/\1/p' "$SKRIPT")"
imSatz="$(sed -n 's/^export const STARTKARENZ_SEKUNDEN = \([0-9]\+\).*/\1/p' \
  "$WURZEL/src/frontend-admin/src/app/feld-folgen.ts")"
sagen "$imSkript" "$imSatz" "Startkarenz im Skript (${imSkript}s) = Startkarenz im Satz der Verwaltung"


# ══ 1. Die Rechnung selbst ist unveraendert ════════════════════════════════
#
# GEGENPROBE ZUERST: mit ausgeschalteter Karenz und ohne Beruehrung muss genau
# das herauskommen, was das alte Skript tat — 6 Runden a 10 s = 1 Minute.
# Damit ist belegt, dass an der Zeitrechnung NICHTS gedreht wurde; die beiden
# neuen Bedingungen sind Zusatz, kein Umbau.
konfig_schreiben 1
sagen "6" "$(durchlauf 60 0 ':')" "1 Minute, ohne Karenz, niemand da -> aus nach 6 Runden (= wie bisher)"
konfig_schreiben 5
sagen "30" "$(durchlauf 200 0 ':')" "5 Minuten, ohne Karenz, niemand da -> aus nach 30 Runden"

# ══ 2. „Eine Minute nach jedem Einschalten aus" ════════════════════════════
#
# Mit Karenz beginnt das Zaehlen erst in der Runde, in der 120 s VOLL sind —
# das ist Runde 12 (11*10 = 110 < 120, 12*10 = 120 nicht mehr). Von dort bis
# zur vollen Minute sind es 6 Runden, macht Runde 17 statt Runde 6. In diesen
# ersten knapp drei Minuten hat ein Mensch die Gelegenheit, die Box durch
# Antippen am Leben zu halten. Die er vorher nicht hatte.
konfig_schreiben 1
sagen "17" "$(durchlauf 60 120 ':')" "1 Minute MIT Karenz -> aus in Runde 17 (Zaehlen ab Runde 12, dann 6)"

# ══ 3. DER EIGENTLICHE BEFUND: wer tippt, wird nicht mehr abgeschaltet ═════
sagen "nie" "$(durchlauf 200 120 "tippen $SCHREIB5")" \
  "1 Minute, jemand tippt auf dem Schirm -> Box bleibt an (200 Runden = 33 min)"
sagen "nie" "$(durchlauf 200 120 "tippen $SCHREIB0")" \
  "1 Minute, jemand drueckt den Einschaltknopf -> Box bleibt an"

# Tippen hoert auf: dann schaltet sie ab wie bestellt — 6 Runden spaeter.
sagen "56" "$(durchlauf 200 120 '[ $i -le 50 ] && tippen '"$SCHREIB5"' || :')" \
  "1 Minute, Tippen endet in Runde 50 -> aus in Runde 56 (genau die bestellte Minute)"

# Ein Geraet, das erst nach dem Dienst auftaucht, wird trotzdem gefunden — und
# es wird weiter gefunden, nachdem `lauschen_auffrischen` alle Deskriptoren
# alle 30 Runden neu oeffnet. Dieser Fall laeuft ueber 200 Runden und damit
# ueber sechs Auffrischungen: bliebe die Erkennung dabei blind, schaltete die
# Box ab und der Fall waere rot.
#
# 5 Minuten Frist, damit die Box das Auftauchen in Runde 20 ueberhaupt erlebt —
# bei 1 Minute waere sie in Runde 17 schon aus, und der Fall pruefte nichts.
konfig_schreiben 5
sagen "nie" "$(durchlauf 200 120 '[ $i -eq 20 ] && mv '"$WERK"'/spaet/event9 '"$WERK"'/sys/event9; [ $i -ge 21 ] && tippen '"$SCHREIB9"' || :')" \
  "Touch-Bruecke taucht erst in Runde 20 auf -> wird gefunden und bleibt gefunden"
mv "$WERK/sys/event9" "$WERK/spaet/event9"
konfig_schreiben 1

# ══ 4. Was NICHT als Mensch zaehlt ═════════════════════════════════════════
#
# Die HDMI-Buchse meldet nur, ob ein Kabel steckt. Wuerde sie mitzaehlen,
# koennte ein wackelndes Kabel die Abschaltung dauerhaft verhindern.
sagen "17" "$(durchlauf 60 120 "tippen $SCHREIB2")" \
  "HDMI-Buchse (kann keine Taste) wird nicht beobachtet -> aus wie ohne sie"

# ══ 5. Wiedergabe zaehlt weiter wie bisher ═════════════════════════════════
printf 'play\n' > "$WERK/playerstate"
sagen "nie" "$(durchlauf 200 120 ':')" "Wiedergabe laeuft -> Box bleibt an"
sagen "55" "$(durchlauf 200 120 '[ $i -eq 50 ] && printf "stop\n" > '"$WERK"'/playerstate || :')" \
  "Wiedergabe endet VOR Runde 50 -> aus in Runde 55 (Runde 50 zaehlt schon mit)"
printf 'stop\n' > "$WERK/playerstate"

# ══ 6. Die Faelle, in denen gar nicht abgeschaltet wird ════════════════════
konfig_schreiben 0
sagen "nie" "$(durchlauf 300 120 ':')" "0 Minuten = nie von allein ausschalten"

cat > "$WERK/config.json" <<'EOF'
{ "timeout": { "idleDisplayOff": "10" } }
EOF
sagen "nie" "$(durchlauf 300 0 ':')" "Schluessel fehlt -> nicht abschalten (nicht: sofort abschalten)"

printf 'kaputt {' > "$WERK/config.json"
sagen "nie" "$(durchlauf 300 0 ':')" "Konfiguration unlesbar -> nicht abschalten"

echo
echo "gruen: $GRUEN   rot: $ROT"
[ "$ROT" -eq 0 ]
