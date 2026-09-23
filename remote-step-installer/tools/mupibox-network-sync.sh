#!/bin/bash
# Netzdaten fuer die MuPiBox-Oberflaeche bereitstellen - ATOMAR und SELBSTHEILEND.
#
# Zwei Fallen im Fork, beide am Geraet belegt:
#
# 1) get_network.sh/check_network.sh schreiben /tmp/network.json per
#    `cat <<< $(jq ...) > datei` rund ein Dutzend Mal HINTEREINANDER neu; dabei
#    ist die Datei jedes Mal kurz LEER. Das Backend liest sie im 5-Sekunden-Takt
#    und bekam staendig "Unexpected end of JSON input". Folge weit ueber ein
#    haessliches Log hinaus: die Oberflaeche wertet /api/network aus, hielt sich
#    fuer OFFLINE - und laedt dann das Spotify-SDK GAR NICHT ERST
#    ("loadSDKScript: Device is offline"). Kein SDK, keine Wiedergabe.
#    Deshalb: nur eine VOLLSTAENDIGE Datei uebernehmen und per mv unteilbar
#    einsetzen, statt das Backend direkt in die flatternde Datei lesen zu lassen.
#
# 2) Ist /tmp/network.json einmal leer/ungueltig, scheitert JEDES weitere jq und
#    schreibt wieder Leere - der Defekt haelt sich selbst am Leben. Der Fork legt
#    die Datei nur an, wenn sie FEHLT (und in get_network.sh fehlt an der Stelle
#    sogar das >: `sudo echo -n "[]" ${NETWORKCONFIG}` schreibt ins Leere).
#    Deshalb vorher auf gueltiges JSON pruefen und notfalls mit {} neu anlegen.
SRC=/tmp/network.json
DST=/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config/network.json

if ! jq -e . "$SRC" >/dev/null 2>&1; then
  printf '{}' > "$SRC"
  chown dietpi:dietpi "$SRC" 2>/dev/null
  chmod 666 "$SRC" 2>/dev/null
fi

/usr/local/bin/mupibox/get_network.sh >/dev/null 2>&1

jq -e . "$SRC" >/dev/null 2>&1 || exit 0        # unvollstaendig -> alte Fassung behalten
install -m 644 -o dietpi -g dietpi "$SRC" "$DST.neu" && mv -f "$DST.neu" "$DST"
