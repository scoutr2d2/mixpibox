#!/bin/bash
#
# Sleep timer script; sleeptimer in seconds

sleeptimer=$1
currtime=0
sec2sleep=1

echo ${sleeptimer} > /tmp/.time2sleep

while (( ${sleeptimer} >= ${currtime} )); do
	sleep ${sec2sleep}
	currtime=$((${currtime}+${sec2sleep}))
	resttime=$((${sleeptimer}-${currtime}))
	echo ${resttime} > /tmp/.time2sleep
done

# Ueber die volle Shutdown-Strecke, nicht ins nackte poweroff: shutdown.sh
# stoppt mupi_startstop, dessen ExecStop mupi_shutdown.sh faehrt — Wiedergabe
# pausieren, Abschalt-Klang, Splash, WLED, Telegram. Der Einschlaf-Timer der
# Kinder war die einzige Endstufe, die daran vorbeiging.
/usr/local/bin/mupibox/shutdown.sh
