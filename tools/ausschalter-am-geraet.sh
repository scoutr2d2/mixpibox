#!/bin/bash
# DER GANZE AUSSCHALTER AM ECHTEN GERAET — aufbauen, messen, WIEDER ABBAUEN.
#
#     tools/ausschalter-am-geraet.sh [adresse]
#
# WOZU: `tools/ausschalter-sandkasten.py` misst die Logik, und
# `tools/taster-wache-am-geraet.sh` misst den Helfer allein. Was beide NICHT
# messen, ist das Ganze auf der echten Box: die Unit startet, das Skript findet
# den Helfer, der Helfer bekommt die Leitung, und `systemctl status` sagt die
# WAHRHEIT darueber.
#
# ══ ES BAUT ALLES WIEDER AB ══════════════════════════════════════════════
# Die Box steht im Wohnzimmer eines Kindes. Sie hat heute KEINEN Ausschalter
# (nachgesehen: kein /usr/local/bin/mupibox/off_trigger.sh, keine Unit,
# postboot.d leer bis auf readme.txt), und so gibt dieses Werkzeug sie auch
# wieder zurueck. Der Betreiber bekommt den Ausschalter ueber
# `update/start_mupibox_update.sh`, wenn er das naechste Mal aktualisiert —
# das ist der Weg, der geprueft gehoert, nicht eine von Hand hingelegte Datei,
# die niemand mehr findet.
#
# EINEN DIENST ZURUECKZULASSEN, DER DIE BOX AUSSCHALTEN KANN und dessen
# Auslöser nie ein Mensch gedrueckt hat, waere die falsche Sorte Mut.
#
# ══ WAS ES NICHT KANN ════════════════════════════════════════════════════
# DEN KNOPF DRUECKEN. Dazu muesste jemand am Geraet stehen. Von hier aus liesse
# sich die Leitung nur nach Masse ziehen, indem man sie als AUSGANG treibt —
# gegen die Beschaltung, die dort einen Hochzieher hat. Das waere ein
# Kurzschluss und wird nicht gemacht. Der Bericht weist diese Luecke aus,
# statt sie zu verschweigen.

set -u
ADRESSE="${1:-192.168.178.169}"
BENUTZER="${MUPI_USER:-dietpi}"
WURZEL="$(cd "$(dirname "$0")/.." && pwd)"

for d in scripts/OnOffShim/off_trigger.sh scripts/OnOffShim/taster_wache.py \
         config/services/mupi_offtrigger.service; do
    [ -r "${WURZEL}/$d" ] || { echo "FEHLT: ${WURZEL}/$d" >&2; exit 2; }
done

echo "── ${BENUTZER}@${ADRESSE} ────────────────────────────────────────"
scp -q "${WURZEL}/scripts/OnOffShim/off_trigger.sh" \
       "${WURZEL}/scripts/OnOffShim/taster_wache.py" \
       "${WURZEL}/config/services/mupi_offtrigger.service" \
       "${BENUTZER}@${ADRESSE}:/tmp/" || { echo "nicht erreichbar" >&2; exit 1; }

cat > /tmp/ausschalter-probe.sh <<'PROBE'
#!/bin/bash
set -u
gut=0; schlecht=0
sagt() { if [ "$1" = ja ]; then echo "  OK   $2"; gut=$((gut+1)); else echo "  ROT  $2"; schlecht=$((schlecht+1)); fi; }

# ── 0. DER ZUSTAND VORHER, damit er nachher wiederhergestellt werden kann ──
VORHER_UNIT=nein;   [ -e /etc/systemd/system/mupi_offtrigger.service ] && VORHER_UNIT=ja
VORHER_SKRIPT=nein; [ -e /usr/local/bin/mupibox/off_trigger.sh ] && VORHER_SKRIPT=ja
VORHER_AN=$(systemctl is-enabled mupi_offtrigger 2>&1)
echo "0) Zustand VORHER: Unit=${VORHER_UNIT} Skript=${VORHER_SKRIPT} enabled=${VORHER_AN}"
echo

abbauen() {
    echo
    echo "── ABBAU ────────────────────────────────────────────────────"
    sudo systemctl stop mupi_offtrigger 2>/dev/null
    if [ "$VORHER_AN" = enabled ]; then sudo systemctl enable mupi_offtrigger 2>/dev/null
    else sudo systemctl disable mupi_offtrigger 2>/dev/null; fi
    [ "$VORHER_UNIT" = nein ] && sudo rm -f /etc/systemd/system/mupi_offtrigger.service
    [ "$VORHER_SKRIPT" = nein ] && sudo rm -f /usr/local/bin/mupibox/off_trigger.sh \
                                             /usr/local/bin/mupibox/taster_wache.py
    sudo systemctl daemon-reload
    sudo rm -rf /run/mupibox
    sleep 1
    n_unit=nein;   [ -e /etc/systemd/system/mupi_offtrigger.service ] && n_unit=ja
    n_skript=nein; [ -e /usr/local/bin/mupibox/off_trigger.sh ] && n_skript=ja
    n_an=$(systemctl is-enabled mupi_offtrigger 2>&1)
    echo "   Zustand NACHHER: Unit=${n_unit} Skript=${n_skript} enabled=${n_an}"
    if [ "$n_unit" = "$VORHER_UNIT" ] && [ "$n_skript" = "$VORHER_SKRIPT" ] && [ "$n_an" = "$VORHER_AN" ]; then
        echo "  OK   die Box steht wieder genau so da wie vorher"
    else
        echo "  ROT  DIE BOX STEHT NICHT WIE VORHER - VON HAND NACHSEHEN"
        schlecht=$((schlecht+1))
    fi
    echo "   GPIO17: $(sudo cat /sys/kernel/debug/gpio | grep -E 'GPIO17 ')"
    echo "   LED-Dienst: $(systemctl is-active mupi_powerled)"
    echo
    echo "── ${gut} OK, ${schlecht} ROT ──────────────────────────────"
}
trap abbauen EXIT

# ── 1. AUFBAU, so wie der Update-Weg es tun wird ──────────────────────────
echo "1) Aufbau (wie update/start_mupibox_update.sh es tut)"
sudo mkdir -p /usr/local/bin/mupibox
sudo cp /tmp/off_trigger.sh /tmp/taster_wache.py /usr/local/bin/mupibox/
sudo chmod 775 /usr/local/bin/mupibox/off_trigger.sh /usr/local/bin/mupibox/taster_wache.py
sudo cp /tmp/mupi_offtrigger.service /etc/systemd/system/
sudo rm -f /var/lib/dietpi/postboot.d/off_trigger.sh
sudo systemctl daemon-reload
sudo rm -f /tmp/shutdown_control.log
sudo systemctl start mupi_offtrigger
sleep 4

# ── 2. LAEUFT ER, UND SAGT systemctl DIE WAHRHEIT? ────────────────────────
echo
echo "2) Der Dienst"
zustand=$(systemctl is-active mupi_offtrigger)
neustarts=$(systemctl show -p NRestarts --value mupi_offtrigger)
echo "   is-active=${zustand}  NRestarts=${neustarts}"
[ "$zustand" = active ] && sagt ja "der Dienst laeuft" || sagt nein "der Dienst laeuft nicht (${zustand})"
[ "${neustarts:-0}" = 0 ] && sagt ja "keine Neustarts - er ist nicht in einer Schleife" \
                          || sagt nein "${neustarts} Neustarts - er kommt nicht durch"

echo
echo "3) Das Protokoll"
sudo cat /tmp/shutdown_control.log 2>/dev/null | sed 's/^/   /'
if sudo grep -q "guard ready" /tmp/shutdown_control.log 2>/dev/null; then
    sagt ja "das Skript meldet 'guard ready' - der Helfer hat die Leitung"
else
    sagt nein "kein 'guard ready' im Protokoll"
fi
if sudo grep -qE "ERROR" /tmp/shutdown_control.log 2>/dev/null; then
    sagt nein "es stehen ERROR-Zeilen im Protokoll"
else
    sagt ja "keine ERROR-Zeile im Protokoll"
fi

echo
echo "4) Sieht er die Leitung WIRKLICH?"
echo "   $(sudo cat /sys/kernel/debug/gpio | grep -E 'GPIO17 ')"
if sudo cat /sys/kernel/debug/gpio | grep -E 'GPIO17 ' | grep -q '|'; then
    sagt ja "GPIO17 ist beansprucht - der Waechter sitzt wirklich darauf"
else
    sagt nein "GPIO17 hat keinen Besitzer - er behauptet zu wachen und tut es nicht"
fi
stand=$(sudo cat /run/mupibox/taster.zustand 2>/dev/null)
echo "   Zustandsdatei: [${stand}]"
[ "$stand" = 1 ] && sagt ja "der Taster liest 1 (losgelassen) - genau richtig, es drueckt niemand" \
                 || sagt nein "der Taster liest [${stand}] - erwartet 1"

echo
echo "5) Und der LED-Dienst? (er haelt GPIO13 als PWM)"
echo "   $(sudo cat /sys/kernel/debug/gpio | grep -E 'GPIO13 ')"
[ "$(systemctl is-active mupi_powerled)" = active ] \
    && sagt ja "mupi_powerled laeuft unbeirrt weiter" \
    || sagt nein "mupi_powerled ist gestoert"

echo
echo "6) Laesst er sich sauber anhalten? (systemd wartet hoechstens 10 s)"
T0=$(date +%s%N); sudo systemctl stop mupi_offtrigger; T1=$(date +%s%N)
ms=$(( (T1-T0)/1000000 ))
echo "   stop dauerte ${ms} ms"
[ "$ms" -lt 3000 ] && sagt ja "unter 3 s - systemd muss nicht hart schiessen" \
                   || sagt nein "${ms} ms - das laeuft in TimeoutStopSec"
sleep 1
if sudo cat /sys/kernel/debug/gpio | grep -E 'GPIO17 ' | grep -q '|'; then
    sagt nein "GPIO17 bleibt nach dem Stoppen beansprucht"
else
    sagt ja "GPIO17 ist nach dem Stoppen wieder frei"
fi

echo
echo "7) Zweimal hintereinander starten (der Test auf haengengebliebene Leitungen)"
sudo systemctl start mupi_offtrigger; sleep 3
z1=$(systemctl is-active mupi_offtrigger)
sudo systemctl restart mupi_offtrigger; sleep 3
z2=$(systemctl is-active mupi_offtrigger)
n2=$(systemctl show -p NRestarts --value mupi_offtrigger)
echo "   nach start=${z1}, nach restart=${z2}, NRestarts=${n2}"
[ "$z2" = active ] && sagt ja "auch der zweite Start bekommt die Leitung" \
                   || sagt nein "der zweite Start scheitert - die Leitung blieb haengen"

echo
echo "── UNGEPRUEFT, UND ZWAR EHRLICH ─────────────────────────────"
echo "  EIN ECHTER DRUCK AUF DEN KNOPF. Niemand steht an der Box, und von"
echo "  hier aus laesst sich die Leitung nicht nach Masse ziehen, ohne sie"
echo "  als Ausgang gegen den aeusseren Hochzieher zu treiben. Gemessen ist"
echo "  alles bis dahin: der Waechter sitzt auf GPIO17, liest den Ruhestand"
echo "  richtig und meldet ihn. Ob am anderen Ende der Leitung wirklich ein"
echo "  Taster haengt, sagt nur ein Finger."
PROBE

scp -q /tmp/ausschalter-probe.sh "${BENUTZER}@${ADRESSE}:/tmp/ausschalter-probe.sh"
ssh -o BatchMode=yes "${BENUTZER}@${ADRESSE}" "bash /tmp/ausschalter-probe.sh"
