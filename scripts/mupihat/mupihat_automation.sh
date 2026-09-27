#!/bin/bash

SOUND_FILE="/home/dietpi/MuPiBox/sysmedia/sound/low.wav"
JSON_FILE="/tmp/mupihat.json"
BATTERY_LOW="/home/dietpi/MuPiBox/sysmedia/images/battery_low.jpg"
CONFIG="/etc/mupibox/mupiboxconfig.json"

play_sound() {
    mplayer -nolirc "$SOUND_FILE" > /dev/null
}

# ══ AUF EINEN GUELTIGEN WERT WARTEN, NICHT EINMAL RATEN (E52, 20.08.2026) ══
#
# HIER STAND `sleep 30` UND EINE EINZIGE PRUEFUNG — und das konnte die
# Tiefentlade-Abschaltung STILL abschalten:
#
#   * 30 s nach dem Start steht in /tmp/mupihat.json womoeglich noch der
#     Startwert `[]` (tmpfiles legt sie an, mupihat.py fuellt sie erst).
#   * `jq -r '.BatteryConnected'` liefert dann nichts Brauchbares.
#   * `[ "" -eq 1 ]` ist in bash ein FEHLER, kein `false` — der Test bricht
#     ab, der else-Zweig meldet "No Battery connected, service stopped"
#     und beendet mit 0.
#   * `Restart=on-abort` in der Unit greift bei einem SAUBEREN Ende nicht.
#
# Ergebnis: kein Warnton, kein Herunterfahren bei leerem Akku — bis zum
# naechsten Neustart, und nichts meldet es. Genau deshalb wird jetzt
# GEWARTET, bis ein gueltiger Wert dasteht, und mit ZEICHENKETTEN
# verglichen: `[ "$X" = "1" ]` vertraegt Leerstring und `[]` klaglos.
#
# ZEHN MINUTEN GEDULD: der Dienst startet mit dem System, und auf einer
# kalten Box kommen Kiosk, Netz und Ton gleichzeitig hoch. Wer hier nach
# einer halben Minute aufgibt, verliert die Abschaltung fuer den ganzen Tag.
BAT_CONNECTED=""
for _ in $(seq 1 60); do
	if [ -f "${JSON_FILE}" ]; then
		BAT_CONNECTED=$(jq -r '.BatteryConnected // empty' "${JSON_FILE}" 2>/dev/null)
	fi
	case "${BAT_CONNECTED}" in
		0|1) break ;;
	esac
	sleep 10
done

if [ "${BAT_CONNECTED}" = "1" ]; then
	while true; do
		if [ -f ${JSON_FILE} ]; then
			VBUS=$(jq -r '.Vbus' ${JSON_FILE})
            if [ "$VBUS" -le 1000 ]; then
				STATE=$(jq -r '.Bat_Stat' ${JSON_FILE})
				if [ "${STATE}" = "LOW" ]; then
					play_sound
					echo "Battery state low"
				elif [ "${STATE}" = "SHUTDOWN" ]; then
					echo "Battery state to low - shutdown initiated"
					/usr/local/bin/mupibox/./mupi_shutdown.sh ${BATTERY_LOW}
					poweroff
				fi
			fi
		fi
		sleep 60
	done
else
	echo "No Battery connected, service stopped"
fi