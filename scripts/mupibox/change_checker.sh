#!/bin/bash
#
# Check for changes in MuPiBox Media directory
#
# Das hier ist der Grund, warum data_clean.sh OHNE JEDE BEDIENUNG laufen kann:
# aendert sich die Aenderungszeit eines Medienordners — Dateien hineinkopiert,
# USB angesteckt, Freigabe kurz weg —, startet dieser Dienst
# m3u_generator.sh. Niemand druckt dafuer einen Knopf. Was dort passiert,
# steht in scripts/mupibox/data_clean.sh.

CONFIG="${MUPI_CONFIG:-/etc/mupibox/mupiboxconfig.json}"
MEDIA="${MUPI_MEDIA:-/home/dietpi/MuPiBox/media}"
SKRIPTE="${MUPI_SKRIPTE:-/usr/local/bin/mupibox}"

CHECK_TIMER=$(/usr/bin/jq -r .mupibox.mediaCheckTimer "${CONFIG}" 2>/dev/null)
# Fehlt der Schluessel (conf_update hat ihn schon einmal verloren) oder steht
# etwas anderes als eine Zahl darin, dann ist `sleep` sofort fertig — und aus
# der Wache wird eine Schleife, die die Karte durchgehend abfragt. Deshalb ein
# Rueckfall statt eines Fehlers.
case "${CHECK_TIMER}" in
  ''|*[!0-9]*) CHECK_TIMER=300 ;;
esac
[ "${CHECK_TIMER}" -lt 1 ] && CHECK_TIMER=300

while true
do
  for dir in "${MEDIA}/"* ; do
    # Gibt es die Medienablage gerade nicht, passt das Muster auf sich selbst.
    # Ohne diese Zeile rechnet die naechste mit einem leeren `stat` weiter.
    [ -d "${dir}" ] || continue
    difference=$(($(date +%s) - $(stat -c %Z "${dir}") - ${CHECK_TIMER}))
        if ((${difference} < 1))
        then
          "${SKRIPTE}/m3u_generator.sh" &
          break
        fi
  done
  sleep ${CHECK_TIMER}
done
