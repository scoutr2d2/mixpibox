#!/bin/bash
# WARTUNGSMODUS VOM ARBEITSRECHNER AUS — an, aus, nachsehen.
#
# Der Sperr-Schirm der Box (NewDesign fragt GET /api/wartung im 10-s-Takt)
# laesst sich auch ohne die Verwaltung schalten — etwa aus einem Skript
# heraus, bevor tools/ausliefern.py die Oberflaeche tauscht.
#
# AUFRUF
#   tools/mixpi-wartung.sh an   [box]      Schirm drauf
#   tools/mixpi-wartung.sh aus  [box]      Schirm weg
#   tools/mixpi-wartung.sh      [box]      Zustand ansehen
#
# `box` ist Adresse[:Port]; ohne Angabe fragt tools/welche-box.sh.
# ACHTUNG Anmelde-Tor: ist die Verwaltungs-Anmeldung eingeschaltet, weist
# die Box das POST von aussen mit 401 ab — dann den Schalter in der
# Verwaltung (Aktualisierung -> Wartungsmodus) nehmen, der hat die Sitzung.

set -u
cd "$(dirname "$0")/.." || exit 1

BEFEHL="${1:-status}"
BOX="${2:-}"
if [ -z "${BOX}" ]; then
    if [ -x tools/welche-box.sh ]; then
        BOX="$(bash tools/welche-box.sh 2>/dev/null | head -1)"
    fi
fi
if [ -z "${BOX}" ]; then
    echo "Keine Box gefunden — Adresse angeben: $0 ${BEFEHL} 192.168.178.169" >&2
    exit 2
fi
case "${BOX}" in *:*) ;; *) BOX="${BOX}:8200" ;; esac

case "${BEFEHL}" in
    an)  curl -sf -X POST "http://${BOX}/api/wartung" -H 'Content-Type: application/json' -d '{"aktiv":true}'  && echo ;;
    aus) curl -sf -X POST "http://${BOX}/api/wartung" -H 'Content-Type: application/json' -d '{"aktiv":false}' && echo ;;
    status|*) curl -sf "http://${BOX}/api/wartung" && echo ;;
esac
rc=$?
if [ $rc -ne 0 ]; then
    echo "Box ${BOX} nicht erreichbar oder abgewiesen (401? -> Verwaltung nutzen)." >&2
fi
exit $rc
