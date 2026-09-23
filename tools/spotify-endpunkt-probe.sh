#!/bin/sh
# Fuettert tools/spotify-endpunkt-probe.py per ssh in eine Box.
#
# WOZU: herausfinden, ob Spotify einen Web-API-Pfad fuer DIESE Anwendung noch
# beantwortet — unabhaengig davon, ob die Durchreiche ihn durchlaesst. Ein 400
# "Pfad nicht vorgesehen" der Box ist kein Urteil ueber Spotify.
#
# WAS ES AENDERT: nichts. Es laeuft mit sudo, weil
# /etc/mupibox/mupiboxconfig.json nur root lesen darf; geschrieben wird nichts,
# und der Token verlaesst die Box nicht.
#
# AUFRUF
#     tools/spotify-endpunkt-probe.sh 192.168.178.169 \
#         'artists/352PojxBglNK0F7TBbCWJm/top-tracks?market=DE'
#
# Rueckgabe: 0 = alle Pfade 200, 1 = mindestens einer nicht.
set -eu

BOX="${1:-}"
if [ -z "$BOX" ]; then
  echo "Aufruf: $(basename "$0") <box> <pfad> [<pfad> ...]" >&2
  exit 2
fi
shift

HIER=$(dirname "$0")
# Die Pfade tragen Fragezeichen und kaufmaennische Und — einfach anfuegen
# reichte die Shell der Box zum Ausfuehren. Deshalb einzeln in Hochkommas.
ARGS=''
for p in "$@"; do
  ARGS="$ARGS '$(printf '%s' "$p" | sed "s/'/'\\\\''/g")'"
done

# shellcheck disable=SC2029  # ARGS ist absichtlich hier zusammengebaut
exec ssh -o BatchMode=yes -o ConnectTimeout=8 "dietpi@${BOX}" "sudo python3 - $ARGS" \
  < "${HIER}/spotify-endpunkt-probe.py"
