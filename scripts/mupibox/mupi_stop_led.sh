#!/bin/sh
#
# Das Knopflicht abschalten: led_control.py und mupi_start_led.sh beenden.
# Haengt als ExecStop an mupi_powerled.service.
#
# ── WARUM HIER GEWARTET WIRD (08.08.2026) ──────────────────────────────────
#
# `kill` schickt nur das Signal und kommt sofort zurueck. `systemctl restart`
# faehrt danach SOFORT wieder hoch — und dann greift der neue led_control.py
# nach GPIO13, waehrend der alte ihn noch haelt:
#
#     lgpio.error: 'GPIO not allocated'
#
# Der neue Prozess stirbt an dieser Stelle weg, der Dienst steht danach auf
# "active (running)", und das Knopflicht ist trotzdem tot. Von aussen sieht
# alles in Ordnung aus. Genau so ist es beim Einspielen der Schirm-Aenderung
# passiert: nach `systemctl restart mupi_powerled` lief nur noch die Shell,
# kein led_control.py mehr. Ein zweiter Neustart half — was die Sache noch
# unangenehmer macht, weil sie dadurch wie ein Zufall aussieht.
#
# Deshalb wird jetzt gewartet, bis der Pin wirklich frei ist.
#
# ── UND WARUM NICHT `pkill -f` ─────────────────────────────────────────────
#
# `pkill -f mupi_start_led.sh` trifft jeden Prozess, in dessen Befehlszeile
# der Name vorkommt — auch die Shell, die dieses Skript gerade aufgerufen hat,
# etwa bei einem Aufruf ueber ssh. Deshalb wird ueber die PID gegangen, und
# die eigene sowie die des Aufrufers sind ausgenommen.

# Alle PIDs zu einem Muster, ohne uns selbst und ohne den Aufrufer.
pids_zu() {
	ps -eo pid=,args= \
		| grep "$1" \
		| grep -v grep \
		| awk -v selbst="$$" -v eltern="${PPID:-0}" \
		       '$1 != selbst && $1 != eltern { print $1 }'
}

beenden() {
	pids=$(pids_zu "$1")
	[ -z "${pids}" ] && return 0

	# shellcheck disable=SC2086
	kill ${pids} 2>/dev/null

	# Bis zu 5 Sekunden auf ein sauberes Ende warten. led_control.py gibt den
	# GPIO in seinem Aufraeumteil zurueck; wer ihm die Zeit nicht laesst,
	# sperrt den naechsten Start aus.
	i=0
	while [ ${i} -lt 50 ]; do
		pids=$(pids_zu "$1")
		[ -z "${pids}" ] && return 0
		sleep 0.1
		i=$((i + 1))
	done

	# Wer dann noch steht, geht hart — und bekommt einen Augenblick, damit
	# der Kernel den Pin wieder freigibt.
	# shellcheck disable=SC2086
	kill -9 ${pids} 2>/dev/null
	sleep 0.3
	return 0
}

# Erst das Licht, dann die Schleife darueber: umgekehrt wuerde die Schleife
# den Leser noch einmal neu starten.
beenden 'led_control'
beenden 'mupi_start_led.sh'

exit 0
