#!/bin/bash
# DER HELFER AM ECHTEN GERAET — laeuft er, sieht er die Leitung, gibt er sie wieder her?
#
#     tools/taster-wache-am-geraet.sh [adresse]      # Vorgabe 192.168.178.169
#
# WOZU: `tools/ausschalter-sandkasten.py` prueft die LOGIK von off_trigger.sh
# mit einem nachgestellten Taster. Was es NICHT pruefen kann, ist, ob der
# Unterbau auf der Box ueberhaupt traegt — genau daran ist die alte Fassung
# gescheitert (sie rief `gpioget`/`gpiomon` aus libgpiod 1.x, die es dort nicht
# gibt). Ein Sandkasten, in dem alles gruen ist, waehrend am Geraet nichts
# funktioniert, ist die teuerste Sorte Pruefung.
#
# WAS ES NICHT KANN: den Knopf DRUECKEN. Dazu muesste jemand davorstehen.
# Dieses Werkzeug prueft alles bis dahin — beanspruchen, lesen, melden,
# freigeben, und dass jeder Fehlerfall LAUT ist. Der Druck selbst bleibt offen
# und wird auch so ausgewiesen.
#
# ES SCHALTET NICHTS AB und fasst keinen Dienst an. Es beansprucht GPIO17 fuer
# ein paar Sekunden und gibt die Leitung nachweislich wieder her.
#
# ── WARUM ES EIN SKRIPT AUF DER BOX ABLEGT UND NICHT `ssh box "…"` RUFT ────
# Weil `ps | grep taster_wache` und `pkill -f taster_wache` in einem
# `ssh box "…"` die EIGENE Befehlszeile treffen: sie enthaelt das Suchmuster.
# Zweimal in dieser Nacht hat das die SSH-Sitzung erschossen statt den Helfer
# (Rueckgabe 255, keine Ausgabe). Ein abgelegtes Skript hat das Muster nicht in
# seiner Befehlszeile stehen.

set -u

ADRESSE="${1:-192.168.178.169}"
BENUTZER="${MUPI_USER:-dietpi}"
WURZEL="$(cd "$(dirname "$0")/.." && pwd)"
HELFER="${WURZEL}/scripts/OnOffShim/taster_wache.py"

[ -r "${HELFER}" ] || { echo "FEHLT: ${HELFER}" >&2; exit 2; }

echo "── ${BENUTZER}@${ADRESSE} ────────────────────────────────────────"

scp -q "${HELFER}" "${BENUTZER}@${ADRESSE}:/tmp/taster_wache.py" || {
    echo "nicht erreichbar" >&2; exit 1; }

# Das Probenskript wird HIER erzeugt und dort abgelegt. Die Anfuehrungszeichen
# um 'PROBE' sind wichtig: ohne sie ersetzte die lokale Shell die Variablen,
# und `$P` waere leer angekommen.
cat > /tmp/taster-probe.sh <<'PROBE'
#!/bin/bash
set -u
LEITUNG="${1:-17}"
STAND=/run/mupibox/taster.zustand
W=/tmp/taster_wache.py

# ══ DEN DIENST ZUERST ANHALTEN — UND AM ENDE WIEDER HINSTELLEN ═════════════
#
# HIER STAND NUR DAS `kill -9` UNTEN, und das war zu wenig. Es trifft JEDEN
# `taster_wache.py` — also auch den, der zu einem LAUFENDEN
# `mupi_offtrigger.service` gehoert. Der Dienst merkt den Tod seines Helfers
# erst beim Ablauf seiner Lauschfrist; bis dahin heisst er „active (running)"
# und bewacht nichts.
#
# AM GERAET GEMESSEN (Box .169, 08.08.2026, mit der damaligen Frist von 60 s):
# Helfer geschossen -> bemerkt nach 60 s, wieder da nach 63 s. In dieser
# Minute war der Ausschalter der Box TOT, und zwar nachdem ein PRUEFWERKZEUG
# vorbeigekommen war.
#
# UND ES HAT DIE MESSUNG DANEBEN VERDORBEN: `tools/ausschalter-am-geraet.sh`,
# direkt danach gelaufen, meldete „GPIO17 hat keinen Besitzer - er behauptet
# zu wachen und tut es nicht" — 3 ROT, die nichts mit dem Skript zu tun hatten,
# sondern mit diesem Aufraeumen. Beim zweiten Lauf war alles gruen. Ein
# Werkzeug, das mal rot und mal gruen sagt, ohne dass sich am Gemessenen etwas
# aendert, ist schlimmer als keins.
VORHER_DIENST=$(systemctl is-active mupi_offtrigger 2>/dev/null || true)
if [ "$VORHER_DIENST" = active ]; then
    echo "   (mupi_offtrigger lief - wird fuer die Dauer der Probe angehalten)"
    sudo systemctl stop mupi_offtrigger
fi
wiederherstellen() {
    if [ "$VORHER_DIENST" = active ]; then
        sudo systemctl start mupi_offtrigger
        echo "   (mupi_offtrigger wieder gestartet: $(systemctl is-active mupi_offtrigger))"
    fi
}
trap wiederherstellen EXIT

# Vorherige Laeufe wegraeumen — ueber die PID-Liste, nicht ueber pkill -f.
alte() { ps -eo pid,cmd | grep 'taster_wache' | grep -v grep | awk '{print $1}'; }
for p in $(alte); do sudo kill -9 "$p" 2>/dev/null; done
sleep 1
sudo rm -f "$STAND"

besitzer() { sudo cat /sys/kernel/debug/gpio | grep -E "GPIO${LEITUNG} " || echo "  (nicht gefunden)"; }
frei()     { ! sudo cat /sys/kernel/debug/gpio | grep -E "GPIO${LEITUNG} .*\|" >/dev/null; }

gut=0; schlecht=0
sagt() { if [ "$1" = ja ]; then echo "  OK   $2"; gut=$((gut+1)); else echo "  ROT  $2"; schlecht=$((schlecht+1)); fi; }

echo "1) Ausgangslage"
echo "   $(besitzer)"
if frei; then sagt ja "GPIO${LEITUNG} hat keinen Besitzer"; else sagt nein "GPIO${LEITUNG} ist schon belegt - die Probe misst dann etwas anderes"; fi

echo
echo "2) Ohne root muss er LAUT scheitern"
aus=$(timeout 5 python3 "$W" --leitung "$LEITUNG" --zustandsdatei /tmp/probe.zustand 2>&1); rc=$?
echo "   rc=$rc  $aus"
if [ "$rc" != 0 ] && [ -n "$aus" ]; then sagt ja "ohne Rechte: Fehlermeldung und rc=$rc"; else sagt nein "ohne Rechte still oder rc=0"; fi

echo
echo "3) Als root hochkommen"
sudo python3 "$W" --leitung "$LEITUNG" --zustandsdatei "$STAND" > /tmp/probe.roehre 2>/tmp/probe.fehler &
sleep 2
P=$(ps -eo pid,cmd | grep 'taster_wache' | grep -v grep | grep -v sudo | awk '{print $1}' | head -1)
roehre=$(cat /tmp/probe.roehre 2>/dev/null)
zustand=$(cat "$STAND" 2>/dev/null)
echo "   PID=$P  Roehre=[$roehre]  Zustandsdatei=[$zustand]"
echo "   $(besitzer)"
case "$roehre" in BEREIT\ [01]) sagt ja "meldet 'BEREIT <stand>' und spuelt sofort" ;; *) sagt nein "keine BEREIT-Meldung: [$roehre]" ;; esac
case "$zustand" in 0|1) sagt ja "Zustandsdatei traegt '$zustand'" ;; *) sagt nein "Zustandsdatei unbrauchbar: [$zustand]" ;; esac
if frei; then sagt nein "Leitung nicht beansprucht, obwohl er BEREIT meldet"; else sagt ja "Leitung ist beansprucht"; fi

echo
echo "4) Kostet das Lesen des Zustands wirklich nichts? (1000x mit dem eingebauten read)"
T0=$(date +%s%N); for i in $(seq 1000); do read -r _z < "$STAND"; done; T1=$(date +%s%N)
us=$(( (T1-T0)/1000000 ))
echo "   1000 Lesevorgaenge in ${us} ms"
if [ "$us" -lt 200 ]; then sagt ja "ein Blick auf den Taster kostet unter 0,2 ms"; else sagt nein "${us} ms fuer 1000 Blicke - zu teuer fuer einen 40-ms-Takt"; fi

echo
echo "5) Auf SIGTERM aufhoeren - und die Leitung hergeben"
T0=$(date +%s%N); sudo kill -TERM "$P" 2>/dev/null
for i in $(seq 60); do sleep 0.1; ps -p "$P" >/dev/null 2>&1 || break; done
T1=$(date +%s%N); ms=$(( (T1-T0)/1000000 ))
if ps -p "$P" >/dev/null 2>&1; then
    sagt nein "nach 6 s noch da - systemd muesste hart schiessen"
    sudo kill -9 "$P"; sleep 1
else
    sagt ja "beendet nach ${ms} ms"
fi
sleep 1
echo "   $(besitzer)"
if frei; then sagt ja "Leitung wieder frei"; else sagt nein "Leitung bleibt beansprucht - der naechste Start faende sie belegt"; fi
if [ -e "$STAND" ]; then sagt nein "Zustandsdatei bleibt liegen - ein alter Stand luegt den naechsten Lauf an"; else sagt ja "Zustandsdatei aufgeraeumt"; fi

echo
echo "6) Fehlerfaelle muessen laut sein"
pruef_laut() {
    local name="$1"; shift
    local a rc
    a=$(sudo timeout 5 python3 "$W" "$@" --zustandsdatei /tmp/probe.zustand 2>&1); rc=$?
    if [ "$rc" != 0 ] && [ -n "$a" ]; then sagt ja "$name -> rc=$rc, ${a:0:70}…"; else sagt nein "$name -> rc=$rc, Ausgabe [$a]"; fi
}
pruef_laut "unsinniger Chip"          --chip quatsch --leitung "$LEITUNG"
pruef_laut "Chip ohne diese Leitung"  --chip gpiochip14 --leitung 17
pruef_laut "belegte Leitung 13 (LED)" --leitung 13

echo
echo "7) Der Rueckfall auf RPi.GPIO"
sudo timeout 3 python3 "$W" --weg rpi --leitung "$LEITUNG" --zustandsdatei /tmp/probe.zustand > /tmp/probe2.roehre 2>&1
r=$(grep -c BEREIT /tmp/probe2.roehre)
if [ "$r" -ge 1 ]; then sagt ja "auch ueber RPi.GPIO kommt er hoch"; else sagt nein "ueber RPi.GPIO nicht: $(cat /tmp/probe2.roehre)"; fi
sleep 1
if frei; then sagt ja "und gibt die Leitung auch dort wieder her"; else sagt nein "RPi.GPIO-Weg laesst die Leitung belegt"; fi

echo
echo "── UNGEPRUEFT ─────────────────────────────────────────────────"
echo "  Ein ECHTER DRUCK. Dazu muss jemand am Geraet auf den Knopf fassen;"
echo "  von hier aus laesst sich die Leitung nicht nach Masse ziehen, ohne"
echo "  sie als Ausgang zu treiben - und das waere ein Kurzschluss gegen die"
echo "  Beschaltung. Gemessen ist: die Leitung liegt auf 1, auch gegen einen"
echo "  inneren Herunterzieher; dort sitzt also ein aeusserer Hochzieher, so"
echo "  wie ein Taster gegen Masse ihn braucht."
echo
echo "── ${gut} OK, ${schlecht} ROT ─────────────────────────────────"
[ "$schlecht" = 0 ]
PROBE

scp -q /tmp/taster-probe.sh "${BENUTZER}@${ADRESSE}:/tmp/taster-probe.sh"
ssh -o BatchMode=yes "${BENUTZER}@${ADRESSE}" "bash /tmp/taster-probe.sh 17"
