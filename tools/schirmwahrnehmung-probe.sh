#!/bin/bash
# Nimmt die Box beim Wort: sieht sie ueberhaupt, ob der Schirm an ist?
#
# WOZU ES DIESE DATEI GIBT
# Zwei Dauerlaeufer fragen jede Sekunde `vcgencmd display_power`:
#
#   get_monitor.sh     schreibt daraus monitor.json ("block inputs if the
#                      screen is blank")
#   mupi_start_led.sh  macht daraus led_dim_mode — das Knopflicht soll
#                      dunkler werden, wenn der Schirm ausgeht
#
# Auf dem Pi 5 gibt es diesen Befehl NICHT MEHR. Er antwortet zweizeilig:
#
#     vc_gencmd_read_response returned -1
#     error=1 error_msg="Command not registered"
#
# Beide Leser rechnen mit EINER Zeile der Form `display_power=1`. Was dann
# passiert, sieht man weder am Schirm noch in der Verwaltung — es passiert
# einfach nichts mehr, waehrend beide Schleifen munter weiterlaufen. Genau
# solche Fehler will diese Probe fangen: nicht „stuerzt ab", sondern
# „arbeitet unbemerkt ins Leere".
#
# Die Probe rechnet die beiden Auswertungen NACH — mit derselben Shell-Zeile,
# die in den Skripten steht. Sie fasst nichts an und braucht die Box nicht:
# ohne Argument nimmt sie die Pi-5-Antwort, mit --hier fragt sie das Geraet,
# auf dem sie laeuft.
#
# AUFRUF
#     tools/schirmwahrnehmung-probe.sh            # gegen die Pi-5-Antwort
#     tools/schirmwahrnehmung-probe.sh --hier     # gegen dieses Geraet
#     tools/schirmwahrnehmung-probe.sh --datei X  # gegen eine Mitschrift
#
# RUECKGABE: 0 beide Auswertungen tragen, 1 mindestens eine laeuft ins Leere.

set -u

PI5_ANTWORT='vc_gencmd_read_response returned -1
error=1 error_msg="Command not registered"'
PI4_ANTWORT='display_power=1'

quelle="Pi-5-Antwort (fest eingebaut)"
roh="${PI5_ANTWORT}"

case "${1:-}" in
	--hier)
		quelle="dieses Geraet"
		roh="$(vcgencmd display_power 2>&1)"
		;;
	--pi4)
		quelle="Pi-4-Antwort (fest eingebaut)"
		roh="${PI4_ANTWORT}"
		;;
	--datei)
		quelle="Datei ${2:-?}"
		roh="$(cat "${2:?--datei braucht einen Pfad}")"
		;;
	"") ;;
	*) echo "unbekannt: $1" >&2; exit 2 ;;
esac

echo "QUELLE: ${quelle}"
echo "ANTWORT:"
printf '    %s\n' "${roh}"
echo

fehler=0

# ---- 1) mupi_start_led.sh, Zeile 127/128 -----------------------------------
# displayState=`vcgencmd display_power | grep -o '.$'`
# if [ ${displayState} -eq 1 ] && ...
displayState=$(printf '%s\n' "${roh}" | grep -o '.$')
worte=$(printf '%s' "${displayState}" | wc -w)
echo "mupi_start_led.sh  ->  displayState = [${displayState//$'\n'/ }]  (${worte} Wort/Woerter)"

# Genau die Bedingung aus Zeile 128, mit abgefangener Fehlerausgabe.
klage=$( { [ ${displayState} -eq 1 ]; } 2>&1 )
if [ -n "${klage}" ]; then
	echo "    KLAGE der Shell: ${klage#*: }"
	echo "    FOLGE: der Test ist weder wahr noch falsch — er ist kaputt."
	echo "           Beide Zweige (hell/gedimmt) werden NIE betreten,"
	echo "           ledDim bleibt auf seinem Startwert 0 stehen."
	echo "           Das Knopflicht dimmt nie ab. Zweimal pro Sekunde"
	echo "           wandert diese Klage ins Journal."
	fehler=1
else
	echo "    Test traegt."
fi
echo

# ---- 2) get_monitor.sh ------------------------------------------------------
# MONITOR=$(sudo -H -u root bash -c "vcgencmd display_power")
# MONITOR=(${MONITOR##*=})
MONITOR="${roh}"
# shellcheck disable=SC2206
MONITOR=(${MONITOR##*=})
echo "get_monitor.sh     ->  MONITOR = [${MONITOR[0]:-}]"
POWER=-1
if [ "${MONITOR[0]:-}" == "-1" ]; then
	POWER=$(cat /sys/class/backlight/*/bl_power 2>/dev/null || echo "?")
	echo "    Rueckfallweg auf bl_power betreten -> POWER=${POWER}"
else
	echo "    Rueckfallweg auf bl_power NICHT betreten (MONITOR ist nicht \"-1\")"
fi

if [ "${MONITOR[0]:-}" == "0" ] || [ "${POWER}" == "4" ]; then
	echo "    schreibt monitor.json = Off"
elif [ "${MONITOR[0]:-}" == "1" ] || [ "${POWER}" == "0" ]; then
	echo "    schreibt monitor.json = On"
else
	echo "    schreibt GAR NICHTS."
	echo "    FOLGE: monitor.json friert auf dem letzten Wert ein. Der Server"
	echo "           liefert ihn ueber /api/monitor weiter aus, als waere er"
	echo "           von eben. Und jede Sekunde kostet das trotzdem ein"
	echo "           sudo + bash + vcgencmd — rund 86 000 Aufrufe am Tag,"
	echo "           die nichts bewirken ausser Eintraegen im Journal."
	fehler=1
fi
echo

if [ "${fehler}" -eq 0 ]; then
	echo "URTEIL: die Box sieht ihren Schirm."
else
	echo "URTEIL: die Box sieht ihren Schirm NICHT — beide Schleifen laufen ins Leere."
fi
exit "${fehler}"
