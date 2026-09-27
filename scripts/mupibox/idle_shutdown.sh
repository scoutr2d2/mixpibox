#!/bin/bash
#
# Ausschalten bei Nichtstun — und was „Nichtstun" hier wirklich heisst.
#
# ══ DER BEFUND, DER DIESE DATEI UMGESCHRIEBEN HAT ═══════════════════════════
#
# Das Feld in der Verwaltung heisst „Ausschalten nach … Minuten NICHTSTUN"
# (src/backend-api/src/konfiguration.ts, id `ausschaltenNach`, erlaubt 0…1440).
# Gezaehlt wurde hier aber etwas anderes: die EINZIGE Quelle des Zaehlers war
#
#     [[ $(head -n1 /tmp/playerstate) != "play" ]]
#
# also „es laeuft gerade keine Wiedergabe". Das Skript nannte weder DISPLAY
# noch /dev/input noch sonst irgendetwas, das ein Mensch anfassen kann.
#
# Damit war „Nichtstun" = „spielt nicht ab", und daraus folgten zwei Faelle,
# die niemand gewollt haben kann:
#
#   1. WER TIPPT, WIRD TROTZDEM ABGESCHALTET. Ein Kind blaettert durch die
#      Kacheln und sucht ein Hoerspiel; solange es noch keins ausgewaehlt hat,
#      laeuft nichts — und der Zaehler laeuft mit. Bei „1 Minute" ist die Box
#      nach 60 Sekunden Suchen aus, mitten im Antippen.
#
#   2. EINE MINUTE NACH JEDEM EINSCHALTEN AUS. Der Zaehler faengt beim Start
#      des Dienstes bei 0 an, und beim Start laeuft nie etwas. Der Dienst
#      haengt an `basic.target`, also lange bevor irgendjemand einen
#      Bildschirm sieht (an der Box gemessen: `graphical.target` nach 8,6 s,
#      der Kiosk noch spaeter). Bei „1 Minute" schaltet sich die Box also
#      wieder ab, bevor sie brauchbar war — und beim naechsten Einschalten von
#      vorn.
#
# ZURUECK AM GERAET GIBT ES NICHTS. Das Feld steht in KEINER Oberflaeche der
# Box selbst (nachgesehen in src/frontend-box/src und NewDesign/app.js: nur das
# Typmodell nennt es). Wer es auf 1 stellt, kann es nur noch von einem zweiten
# Geraet aus zuruecknehmen — im Wettlauf mit einem Zaehler, der bereits laeuft,
# waehrend die Box hochfaehrt.
#
# ══ WAS SICH GEAENDERT HAT ══════════════════════════════════════════════════
#
#   (a) BERUEHRUNG ZAEHLT MIT. Der Zaehler wird auch zurueckgesetzt, wenn
#       jemand das Geraet angefasst hat — Touchscreen, Einschaltknopf,
#       Fernbedienung, Tastatur. Damit heisst „Nichtstun" endlich das, was am
#       Feld steht.
#   (b) STARTKARENZ. In den ersten Sekunden nach dem Start des Dienstes wird
#       nicht gezaehlt. Vorher konnte die Frist ablaufen, bevor ein Mensch
#       ueberhaupt etwas zum Antippen vor sich hatte.
#
# WAS SICH AUSDRUECKLICH NICHT GEAENDERT HAT: die eingestellte Zahl. Wer
# 5 Minuten einstellt, bekommt 5 Minuten. Es gibt hier KEINE Untergrenze und
# kein Verbot — die 1 ist erlaubt und tut jetzt genau das, was danebensteht.
#
# ══ DIE RICHTUNG DES MOEGLICHEN FEHLERS ═════════════════════════════════════
#
# Das ist der Grund, warum diese Aenderung vertretbar ist, obwohl sie auf einem
# laufenden Geraet Hand an die Abschaltung legt. Wenn die Beruehrungserkennung
# NICHT funktioniert, verhaelt sich die Box exakt wie vorher (nur Wiedergabe
# zaehlt). Wenn sie ZU VIEL erkennt (ein Geraet, das von allein Ereignisse
# schickt), schaltet die Box gar nicht mehr von allein ab. Sie kann durch
# diese Aenderung also nie FRUEHER ausgehen als bisher — nur spaeter oder
# gleich. Ein Fehler hier nimmt niemandem eine Geschichte weg.
#
# ══ WARUM /dev/input UND NICHT DER X-SERVER ═════════════════════════════════
#
# Der naheliegende Weg waere die Leerlaufzeit des X-Servers (das ist die Zahl,
# aus der auch die Bildschirmabschaltung entsteht: `Option "BlankTime"` in
# scripts/mupibox/setting_update.sh). Die liest man mit `xprintidle` oder
# `xssstate`. AN DER BOX NACHGESEHEN (07.08.2026, .169, nur lesend): beide sind
# NICHT installiert, `xset` allein gibt keine Leerlaufzeit her, und `evtest`
# fehlt ebenfalls. Ein neues Paket waere ein Eingriff in den Ausrollweg und
# haette diese Datei von einer Installation abhaengig gemacht, die auf
# bestehenden Boxen fehlt.
#
# /dev/input braucht dagegen nichts ausser dem Kernel. Der Dienst laeuft als
# root (mupi_idle_shutdown.service nennt keinen `User=`), darf die Geraete also
# lesen. GEMESSEN AN DER BOX, welche es dort gibt:
#
#     event0  pwr_button             (Einschaltknopf)
#     event1  vc4-hdmi-0             (CEC-Fernbedienung)
#     event2  vc4-hdmi-0 HDMI Jack   -> uebersprungen, siehe unten
#     event3  vc4-hdmi-1             (CEC-Fernbedienung)
#     event4  vc4-hdmi-1 HDMI Jack   -> uebersprungen
#     event5  MuPiBox Touch Bridge   (der Finger des Kindes)
#
# Die beiden „HDMI Jack" melden nur, ob ein Kabel steckt (EV_SW). Ein
# eingestecktes Kabel ist kein Mensch. Deshalb werden nur Geraete beobachtet,
# die Tasten, absolute oder relative Bewegung koennen (`capabilities/key`,
# `abs`, `rel` nicht durchweg 0) — der Filter wirft die beiden Buchsen heraus
# und behaelt Knopf, Fernbedienung und Touch.
#
# NOCH AM GERAET NACHZUMESSEN, BEVOR DAS AUSGEROLLT WIRD: dass das Mitlesen dem
# X-Server nichts wegnimmt. Nach Bauart des Kernels bekommt jeder, der ein
# evdev-Geraet oeffnet, seinen EIGENEN Ringpuffer — Lesen entzieht anderen
# Lesern also nichts. Das ist hier NICHT am Geraet nachgeprueft worden (auf der
# Box lief ein Hoerspiel und es wurde nur gelesen). Probe: Dienst laufen
# lassen, auf dem Bildschirm tippen, und sehen, ob die Oberflaeche weiterhin
# reagiert.
#
# ══ WIE MAN DAS HIER PRUEFT ═════════════════════════════════════════════════
#
#     bash tools/leerlauf-uhr-nachspielen.sh
#
# Das Werkzeug LIEST DIESE DATEI und ruft ihre Funktionen auf — es baut sie
# nicht nach. Deshalb stehen alle Pfade und Zeiten in Variablen mit `:=`: die
# Probe schiebt eine Attrappe unter, das Skript selbst bleibt unveraendert.
set -u

: "${CONFIG:=/etc/mupibox/mupiboxconfig.json}"
: "${LOG:=/tmp/idle_shutdown.log}"
: "${PLAYERSTATE:=/tmp/playerstate}"
: "${JQ:=/usr/bin/jq}"

# Sekunden je Runde. War schon immer 10 — der Zaehler rechnet damit in Minuten.
: "${TAKT:=10}"

# STARTKARENZ — wie lange nach dem Start des Dienstes NICHT gezaehlt wird.
#
# 120 Sekunden, und zwar aus einer Messung, nicht aus dem Bauch: an der Box
# ist `graphical.target` nach 8,6 s erreicht, der Kiosk-Browser und die
# Oberflaeche brauchen danach noch. Der Dienst haengt aber an `basic.target`
# und laeuft damit deutlich frueher los als alles, was ein Mensch sehen kann.
# Beim kleinsten erlaubten Wert (1 Minute) waere die Frist abgelaufen, bevor
# die erste Kachel auf dem Schirm steht — die Box haette sich eine Minute nach
# JEDEM Einschalten wieder abgeschaltet, ohne dass jemand die Gelegenheit
# gehabt haette, sie durch Antippen am Leben zu halten.
#
# Bei allen groesseren Werten faellt die Karenz nicht auf: sie verlaengert die
# Zeit bis zum Abschalten nie ueber die Karenz hinaus, sondern schiebt nur den
# Beginn des Zaehlens.
: "${STARTKARENZ:=120}"

# Wo die Eingabegeraete stehen. Zwei Variablen, weil die Faehigkeiten in sysfs
# stehen und die Geraeteknoten in /dev — die Probe braucht beide getrennt.
: "${EINGABE_SYS:=/sys/class/input}"
: "${EINGABE_DEV:=/dev/input}"

# Der Abschaltbefehl. AUSDRUECKLICH ALS VARIABLE, damit die Probe ihn ersetzen
# kann — ein Werkzeug, das zum Pruefen den Rechner ausschaltet, wird kein
# zweites Mal ausgefuehrt.
: "${ABSCHALT_BEFEHL:=sudo /usr/local/bin/mupibox/shutdown.sh}"

# ── Zustand ────────────────────────────────────────────────────────────────
# `zaehler`  Runden ohne Wiedergabe UND ohne Beruehrung
# `runden`   Runden seit dem Start des Dienstes (fuer die Startkarenz)
zaehler=0
runden=0
declare -A LAUSCHER=()   # Geraetepfad -> offener Dateideskriptor
declare -A GEMELDET=()   # Geraetepfad -> steht schon im Protokoll
# 1 = es steht schon im Protokoll, dass GAR NICHTS beobachtet wird. Siehe die
# Begruendung in `lauschen_oeffnen`; hier steht es nur, damit `set -u` nicht
# ueber den ersten Vergleich faellt.
BLIND=0

# Alle so viele Runden werden die Deskriptoren neu geoeffnet (siehe
# `lauschen_auffrischen`). 30 Runden a 10 s = 5 Minuten.
: "${AUFFRISCHUNG:=30}"

protokoll() {
  echo "$(date +'%d/%m/%Y %H:%M:%S')  # $*" >> "${LOG}"
}

# ── Die eingestellte Frist in Minuten ──────────────────────────────────────
#
# 0 heisst „nie von allein ausschalten" und ist auch der Rueckfall, wenn die
# Konfiguration nicht lesbar ist. RICHTUNG: eine Box, deren Konfiguration
# gerade nicht zu lesen ist, schaltet sich NICHT ab. Frueher stand hier ein
# nacktes `(( $max_idle_time > 0 ))`; bei leerem oder `null`-Ergebnis von jq
# war das ein Syntaxfehler in jeder Runde.
hoechstdauer() {
  local m=''
  if [ -x "$JQ" ] && [ -r "$CONFIG" ]; then
    m="$("$JQ" -r '.timeout.idlePiShutdown // empty' "$CONFIG" 2>/dev/null)"
  fi
  m="${m%%.*}"
  case "$m" in ''|*[!0-9]*) m=0 ;; esac
  echo "$m"
}

spielt() {
  [ "$(head -n1 "$PLAYERSTATE" 2>/dev/null)" = "play" ]
}

# ── Welche Geraete zaehlen als „ein Mensch war da" ─────────────────────────
#
# Ein Geraet zaehlt, wenn es Tasten, absolute oder relative Bewegung kann. Die
# Faehigkeiten stehen in sysfs als Hex-Woerter; sind alle davon 0, kann das
# Geraet nichts, was ein Finger ausloest. Genau daran fallen die beiden
# „HDMI Jack" heraus, die nur „Kabel steckt / steckt nicht" melden.
menschlich() {
  local d="$1" f wert
  for f in key abs rel; do
    wert="$(cat "$d/device/capabilities/$f" 2>/dev/null)"
    # Leerzeichen und Nullen weg — bleibt etwas uebrig, ist ein Bit gesetzt.
    wert="${wert//[ 0]/}"
    [ -n "$wert" ] && return 0
  done
  return 1
}

eingabegeraete() {
  local d n
  for d in "$EINGABE_SYS"/event*; do
    [ -e "$d" ] || continue
    n="$(basename "$d")"
    [ -r "$EINGABE_DEV/$n" ] || continue
    menschlich "$d" && echo "$EINGABE_DEV/$n"
  done
}

# Offenhalten statt jedes Mal neu oeffnen: nur ein offener Deskriptor sieht,
# was ZWISCHEN zwei Runden passiert ist. Wer erst in der Runde oeffnet, sieht
# nur, was genau in diesem Augenblick anliegt — und das ist bei einem Tippen
# so gut wie nie.
lauschen_oeffnen() {
  local g fd
  while read -r g; do
    [ -n "${LAUSCHER[$g]:-}" ] && continue
    if exec {fd}<"$g" 2>/dev/null; then
      LAUSCHER["$g"]=$fd
      # Nur beim ERSTEN Mal ins Protokoll — sonst schriebe das Auffrischen
      # unten alle fuenf Minuten dieselben Zeilen in eine Datei unter /tmp.
      if [ -z "${GEMELDET[$g]:-}" ]; then
        GEMELDET["$g"]=1
        protokoll "EINGABE WIRD BEOBACHTET: $g"
      fi
    fi
  done < <(eingabegeraete)

  # ── DIE BLINDHEIT MUSS SICH MELDEN ────────────────────────────────────────
  #
  # Gemessen mit tools/durchkommen-leerlauf.sh: findet diese Schleife KEIN
  # Geraet, verhaelt sich das Skript exakt wie die Fassung vor dem 07.08.2026
  # — die Beruehrung zaehlt nicht mit, und die Box geht mitten im Hoerspiel
  # aus. Das ist fuer sich richtig (die eingestellte Zahl gilt weiter, und
  # frueher als eingestellt geht sie nie), aber es war UNSICHTBAR: `GEMELDET`
  # oben schreibt nur Geraete ins Protokoll, die geoeffnet WURDEN. Null
  # Geraete hiessen null Zeilen, und das Protokoll sah aus wie ein gesunder
  # Lauf. Wer der Ursache nachginge, faende genau nichts.
  #
  # Drei Lagen fuehren dahin, keine davon braucht einen Angreifer: ein Board,
  # das sysfs anders ablegt; eine abgemeldete Beruehrungsbruecke (der Dienst
  # laesst sich abschalten); Geraeteknoten, die dieser Prozess nicht lesen
  # darf (heute laeuft er als root — ein spaeteres `User=` in der Einheit
  # nimmt ihm das, ohne dass hier irgendetwas auffiele).
  #
  # NUR EINE ZEILE, KEIN VERHALTEN. Diese Meldung aendert weder Zaehler noch
  # Frist noch Richtung — die Box schaltet danach zu genau derselben Sekunde
  # ab wie vorher. Sie macht den Ausfall nur sichtbar.
  #
  # Gemeldet wird beim UEBERGANG, nicht in jeder Runde: der Aufruf steht in
  # der Schleife (alle 10 s), eine Zeile je Runde liefe /tmp voll.
  if [ "${#LAUSCHER[@]}" -eq 0 ]; then
    if [ "$BLIND" = 0 ]; then
      BLIND=1
      protokoll "KEIN EINGABEGERAET WIRD BEOBACHTET - die Beruehrung zaehlt NICHT mit."
      protokoll "  Gesucht in ${EINGABE_SYS}/event* (Faehigkeiten key/abs/rel != 0), geoeffnet unter ${EINGABE_DEV}/."
      protokoll "  Die Box schaltet weiter nach der eingestellten Zahl ab - aber ein Tippen haelt sie nicht mehr wach."
    fi
  elif [ "$BLIND" != 0 ]; then
    BLIND=0
    protokoll "EINGABE WIRD WIEDER BEOBACHTET (${#LAUSCHER[@]} Geraet(e))"
  fi
}

# GEGEN DAS STILLE ERBLINDEN. Wird ein Geraet abgemeldet und unter demselben
# Namen neu angemeldet (Neustart der Touch-Bruecke, ein wiederkehrender
# USB-Knopf), zeigt der alte Deskriptor ins Leere. `read -t 0` meldet darauf
# genau dasselbe wie „niemand hat etwas angefasst" — die Erkennung waere tot,
# ohne dass es irgendwo auffiele, und die Box schaltete wieder mitten im
# Tippen ab. Das ist die einzige Richtung, in der ein Fehler hier WEHTUT,
# also wird von Zeit zu Zeit alles neu geoeffnet. Der Preis ist eine Handvoll
# Ereignisse, die im Augenblick des Neuoeffnens verlorengehen — schlimmstenfalls
# eine Runde von 10 Sekunden.
lauschen_auffrischen() {
  local g fd
  for g in "${!LAUSCHER[@]}"; do
    fd="${LAUSCHER[$g]}"
    exec {fd}<&-
  done
  LAUSCHER=()
}

# ── Hat jemand die Box angefasst? ──────────────────────────────────────────
#
# `read -t 0` fragt nur, OB etwas anliegt, ohne zu lesen. Liegt etwas an, wird
# der Puffer geleert (sonst meldete er in jeder folgenden Runde weiter „da war
# was"). Rueckgabe 0 = angefasst.
#
# WICHTIG: das hier laeuft in JEDER Runde, auch waehrend der Wiedergabe. Sonst
# stauten sich die Ereignisse waehrend eines Hoerspiels an und die erste Runde
# nach dem Ende meldete eine Beruehrung, die Stunden zurueckliegt.
beruehrt() {
  local g fd ergebnis=1
  for g in "${!LAUSCHER[@]}"; do
    fd="${LAUSCHER[$g]}"
    if read -r -t 0 -u "$fd" 2>/dev/null; then
      dd bs=4096 count=1 status=none <&"$fd" >/dev/null 2>&1
      ergebnis=0
    fi
  done
  return $ergebnis
}

abschalten() {
  local minuten="$1"
  local TELEGRAM TELEGRAM_CHATID TELEGRAM_TOKEN
  TELEGRAM=$("$JQ" -r .telegram.active "${CONFIG}" 2>/dev/null)
  TELEGRAM_CHATID=$("$JQ" -r .telegram.chatId "${CONFIG}" 2>/dev/null)
  TELEGRAM_TOKEN=$("$JQ" -r .telegram.token "${CONFIG}" 2>/dev/null)
  if [ "${TELEGRAM}" ] && [ ${#TELEGRAM_CHATID} -ge 1 ] && [ ${#TELEGRAM_TOKEN} -ge 1 ]; then
    /usr/bin/python3 /usr/local/bin/mupibox/telegram_send_message.py "MuPiBox is to long idle"
  fi
  protokoll "MAX IDLE TIME REACHED (${minuten} min ohne Wiedergabe UND ohne Beruehrung) - SHUTDOWN NOW"
  # Absichtlich ohne Anfuehrungszeichen: das ist eine Befehlszeile, kein Pfad.
  ${ABSCHALT_BEFEHL}
}

# ── Eine Runde ─────────────────────────────────────────────────────────────
#
# Gibt 0 zurueck, wenn abgeschaltet wurde — daran haengt die Probe.
runde() {
  local max minuten eingabe=1
  runden=$((runden + 1))
  max="$(hoechstdauer)"

  if [ "$max" -le 0 ]; then
    zaehler=0
    return 1
  fi

  if [ "$AUFFRISCHUNG" -gt 0 ] && [ $((runden % AUFFRISCHUNG)) -eq 0 ]; then
    lauschen_auffrischen
  fi
  lauschen_oeffnen
  # Immer leeren, auch wenn die Antwort gleich verworfen wird (siehe oben).
  beruehrt && eingabe=0

  if [ $((runden * TAKT)) -lt "$STARTKARENZ" ]; then
    # Die Box faehrt noch hoch. Wer jetzt nichts tut, tut nichts, WEIL es noch
    # nichts zu tun gibt.
    zaehler=0
    protokoll "STARTKARENZ - NOCH KEIN ZAEHLEN (${STARTKARENZ}s)"
    return 1
  fi

  if spielt; then
    zaehler=0
    protokoll "CURRENT IDLE TIME = 0 (Wiedergabe laeuft)"
    return 1
  fi
  if [ $eingabe -eq 0 ]; then
    zaehler=0
    protokoll "CURRENT IDLE TIME = 0 (jemand hat die Box angefasst)"
    return 1
  fi

  zaehler=$((zaehler + 1))
  minuten=$((zaehler * TAKT / 60))
  protokoll "CURRENT IDLE TIME = ${minuten}"
  if [ "$minuten" -ge "$max" ]; then
    abschalten "$minuten"
    return 0
  fi
  return 1
}

hauptschleife() {
  touch "${PLAYERSTATE}"
  chown dietpi:dietpi "${PLAYERSTATE}" 2>/dev/null
  touch "${LOG}"
  protokoll "SERVICE STARTED"
  while true; do
    sleep "$TAKT"
    runde
  done
}

# Nur Funktionen laden, nicht loslaufen — dafuer ist die Probe da. systemd
# setzt diese Variable nicht, dort startet also die Schleife wie bisher.
if [ "${MUPI_IDLE_NUR_FUNKTIONEN:-0}" != "1" ]; then
  hauptschleife
fi
