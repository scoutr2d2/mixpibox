#!/bin/bash
# DER ECHTE DRUCK, MITGESCHRIEBEN — die Luecke, die die anderen offen lassen.
#
#     tools/taster-druck-mitschnitt.sh [adresse] [sekunden] [leitung]
#     tools/taster-druck-mitschnitt.sh 192.168.178.79 120
#
# WOZU: `tools/taster-wache-am-geraet.sh` prueft den Helfer und schreibt in
# seinen eigenen Kopf: „WAS ES NICHT KANN: den Knopf DRUECKEN. Dazu muesste
# jemand davorstehen." Genau dieser Fall ist hier gemeint — ein Mensch steht
# davor, und dieses Werkzeug schreibt mit, WAS die Leitung dabei tut und WIE
# LANGE. Am Ende steht je Druck eine Dauer in Millisekunden.
#
# ══ ES SCHALTET NICHTS ═══════════════════════════════════════════════════
# Es startet NUR `taster_wache.py` (liest die Leitung, meldet Flanken) und
# NICHT `off_trigger.sh` (das faehrt herunter). Die Box bleibt an. Nach Ablauf
# der Frist wird der Helfer ueber seine PID beendet und die Leitung ist wieder
# frei — nachgewiesen ueber /sys/kernel/debug/gpio.
#
# ══ WAS DER MENSCH AM GERAET WISSEN MUSS ═════════════════════════════════
# KURZ DRUECKEN, 1 bis 3 Sekunden. NICHT sechs. Der Taster an J1 nimmt laut
# MuPiHAT-Datenblatt ab 6 Sekunden HART den Strom weg, in Hardware, an jeder
# Software vorbei — auch an dieser. Ein 6-Sekunden-Druck beendet die Messung,
# indem er das Geraet abschaltet, und der Mitschnitt bricht mittendrin ab.
#
# ══ WARUM ES EIN SKRIPT ABLEGT UND NICHT `ssh box "…"` RUFT ══════════════
# Dieselbe Falle wie bei `tools/taster-wache-am-geraet.sh`: `ps | grep
# taster_wache` und ein Toeten per Muster treffen in einem `ssh box "…"` die
# EIGENE Befehlszeile, weil das Muster darin steht. Ein abgelegtes Skript hat
# es nicht — und hier wird ohnehin ueber die PID beendet, nicht ueber ein
# Muster.
#
# ══ ES HAELT DEN LAUFENDEN AUSSCHALTER AN — UND STELLT IHN ZURUECK ═══════
# Liefe `mupi_offtrigger` bereits, haelte er die Leitung, und dieser
# Mitschnitt bekaeme sie nicht. Er wird deshalb fuer die Dauer angehalten und
# am Ende wieder gestartet — auch wenn zwischendrin etwas schiefgeht.

set -u

ADRESSE="${1:-192.168.178.79}"
FRIST="${2:-120}"
LEITUNG="${3:-17}"
BENUTZER="${MUPI_USER:-dietpi}"
WURZEL="$(cd "$(dirname "$0")/.." && pwd)"
HELFER="${WURZEL}/scripts/OnOffShim/taster_wache.py"

[ -r "${HELFER}" ] || { echo "FEHLT: ${HELFER}" >&2; exit 2; }

echo "── ${BENUTZER}@${ADRESSE}, Leitung ${LEITUNG}, ${FRIST} s ──────────"

scp -q "${HELFER}" "${BENUTZER}@${ADRESSE}:/tmp/taster_wache.py" || {
    echo "nicht erreichbar" >&2; exit 1; }

# Das Probenskript wird HIER erzeugt und DORT abgelegt. Die Anfuehrungszeichen
# um 'PROBE' sind noetig: ohne sie ersetzte die lokale Shell die Variablen.
cat > /tmp/taster-druck-probe.sh <<'PROBE'
#!/bin/bash
set -u
LEITUNG="${1:-17}"
FRIST="${2:-120}"
MITSCHNITT=/tmp/taster-druck.roh
W=/tmp/taster_wache.py

# ── Den laufenden Ausschalter anhalten, falls es ihn gibt ──────────────────
VORHER=$(systemctl is-active mupi_offtrigger 2>/dev/null || true)
if [ "$VORHER" = active ]; then
    echo "   (mupi_offtrigger lief — fuer die Messung angehalten)"
    sudo -n systemctl stop mupi_offtrigger
fi
zurueck() {
    [ -n "${PID:-}" ] && sudo -n kill "$PID" 2>/dev/null
    sleep 0.3
    [ -n "${PID:-}" ] && sudo -n kill -9 "$PID" 2>/dev/null
    if [ "$VORHER" = active ]; then
        sudo -n systemctl start mupi_offtrigger
        echo "   (mupi_offtrigger wieder gestartet: $(systemctl is-active mupi_offtrigger))"
    fi
}
trap zurueck EXIT

# ── Der Chip. Auf dem Pi 4 ist gpiochip0 = pinctrl-bcm2711, auf dem Pi 5
#    heisst derselbe Name einen anderen Baustein. Deshalb wird der Chip
#    gesucht, der die Leitung als GPIO fuehrt, statt einen zu raten.
CHIP=gpiochip0
echo "   Chip: ${CHIP}, Leitung: ${LEITUNG}"

rm -f "$MITSCHNITT"
# stdbuf, damit die Zeilen SOFORT kommen und nicht erst am Ende im Block.
sudo -n stdbuf -oL python3 "$W" --chip "$CHIP" --leitung "$LEITUNG" \
     --zustandsdatei /run/mupibox/taster.mitschnitt \
     > "$MITSCHNITT" 2>&1 &
PID=$!

sleep 2
if ! kill -0 "$PID" 2>/dev/null; then
    echo "   ROT: die Wache ist nicht hochgekommen:"
    sed 's/^/        /' "$MITSCHNITT"
    exit 1
fi
head -1 "$MITSCHNITT" | sed 's/^/   /'

# ── Beleg, dass die Leitung jetzt WIRKLICH beansprucht ist ────────────────
sudo -n grep -E "gpio-${LEITUNG} " /sys/kernel/debug/gpio 2>/dev/null | sed 's/^/   /'

echo "   ══ JETZT DRUECKEN — kurz, 1 bis 3 s. NICHT sechs. ══"
echo "   (Mitschnitt laeuft ${FRIST} s)"

# Zeitstempel je Zeile: die Wache selbst meldet nur FLANKE/LOS ohne Uhrzeit.
# awk mit systime() waere sekundengenau — zu grob fuer eine Druckdauer.
# Deshalb wird hier in Millisekunden gestempelt, waehrend gelesen wird.
ENDE=$(( $(date +%s) + FRIST ))
GESTEMPELT=/tmp/taster-druck.stempel
: > "$GESTEMPELT"
tail -f -n +1 "$MITSCHNITT" 2>/dev/null | while IFS= read -r zeile; do
    echo "$(date +%s%3N) ${zeile}" >> "$GESTEMPELT"
done &
LESER=$!

while [ "$(date +%s)" -lt "$ENDE" ]; do
    sleep 1
    kill -0 "$PID" 2>/dev/null || { echo "   ROT: die Wache ist mittendrin gestorben."; break; }
done
kill "$LESER" 2>/dev/null

echo
echo "── WAS DIE LEITUNG GETAN HAT ────────────────────────────────────"
if [ ! -s "$GESTEMPELT" ]; then
    echo "   (nichts mitgeschrieben)"
else
    awk '
    {
        stempel = $1; wort = $2
        if (wort == "BEREIT") { printf "   %s  Ruhestand %s\n", strftime("%H:%M:%S", stempel/1000), $3 }
        else if (wort == "FLANKE") { ab = stempel; n++ }
        else if (wort == "LOS" && ab > 0) {
            dauer = stempel - ab
            printf "   %s  DRUCK %d — %d ms (%.2f s)%s\n", strftime("%H:%M:%S", ab/1000), n, dauer, dauer/1000, \
                   (dauer >= 2000 ? "   >= 2 s: haette sauber heruntergefahren" : "   < 2 s: zu kurz zum Abschalten")
            ab = 0
        }
    }
    END {
        if (ab > 0) printf "   ... ein Druck ohne Loslassen (die Messung endete waehrenddessen)\n"
        if (n == 0) printf "   KEINE EINZIGE FLANKE. Der Knopf wurde nicht gedrueckt — oder er\n   erreicht diese Leitung nicht.\n"
        else printf "\n   %d Druck/Druecke gesehen. Der Taster MELDET SICH auf dieser Leitung.\n", n
    }' "$GESTEMPELT"
fi

echo
echo "── Leitung wieder frei? ─────────────────────────────────────────"
zurueck; trap - EXIT
sleep 0.5
if sudo -n grep -E "gpio-${LEITUNG} " /sys/kernel/debug/gpio 2>/dev/null | grep -q "|"; then
    echo "   ROT: sie hat noch einen Besitzer:"
    sudo -n grep -E "gpio-${LEITUNG} " /sys/kernel/debug/gpio | sed 's/^/        /'
else
    echo "   OK   kein Besitzer mehr — so wie vorher."
fi
rm -f /run/mupibox/taster.mitschnitt 2>/dev/null
PROBE

scp -q /tmp/taster-druck-probe.sh "${BENUTZER}@${ADRESSE}:/tmp/" || exit 1
# shellcheck disable=SC2029  # die Ersetzung ist hier gewollt und lokal
ssh -o ConnectTimeout=6 "${BENUTZER}@${ADRESSE}" \
    "chmod +x /tmp/taster-druck-probe.sh && /tmp/taster-druck-probe.sh ${LEITUNG} ${FRIST}"
RC=$?

ssh -o ConnectTimeout=6 "${BENUTZER}@${ADRESSE}" \
    "rm -f /tmp/taster-druck-probe.sh /tmp/taster_wache.py /tmp/taster-druck.roh /tmp/taster-druck.stempel" 2>/dev/null
exit $RC
