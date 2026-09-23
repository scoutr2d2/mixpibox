#!/usr/bin/env bash
# Wartungs-Schirm der Box schalten — das Tuch ueber den Kinderknoepfen.
#
# WOZU (05.09.2026)
# Waehrend Messungen drueckten die Tester zweimal mitten in eine Probe —
# der Betreiber: „die kinder druecken draufrum das kann verfaelschen".
#
# ES GIBT DEN SCHIRM SCHON (29.08.2026): das NewDesign pollt GET /api/wartung
# im 10-s-Takt und legt bei { aktiv: true } einen Sperr-Schirm ueber alles.
# Die Wahrheit dahinter ist die DATEI /tmp/.mixpi-wartung — der POST-Weg
# steht hinter dem Anmelde-Tor, die Datei nicht. Wer per SSH auf der Box ist,
# hat das Wartungsrecht ohnehin; dieses Werkzeug schreibt deshalb die Datei.
# /tmp raeumt beim Neustart auf: eine vergessene Wartung sperrt nie dauerhaft.
#
# WIRKUNG BRAUCHT EINEN TAKT: der Kiosk fragt alle 10 s nach. Wer direkt nach
# „an" misst, misst noch OHNE Schirm — deshalb wartet „an" den Takt ab.
#
# Aufruf:
#   tools/wartung.sh <benutzer@box> an        # schaltet an und WARTET ~11 s
#   tools/wartung.sh <benutzer@box> an sofort # schaltet an, wartet nicht
#   tools/wartung.sh <benutzer@box> aus
#   tools/wartung.sh <benutzer@box> status
set -u

BOX="${1:-}"
WAS="${2:-status}"
EXTRA="${3:-}"
[ -z "$BOX" ] && { echo "Aufruf: $0 <benutzer@box> an|aus|status [sofort]" >&2; exit 2; }

lauf() { ssh -o ConnectTimeout=8 -o BatchMode=yes "$BOX" "$1" 2>/dev/null; }

case "$WAS" in
  an)
    lauf 'printf "{\"seit\":\"%s\"}" "$(date -Is)" > /tmp/.mixpi-wartung'
    echo "Schirm bestellt."
    if [ "$EXTRA" != "sofort" ]; then
      echo "Warte auf den Kiosk-Takt (10 s) …"
      sleep 11
    fi
    lauf 'curl -s -m 8 http://localhost:8200/api/wartung'; echo
    ;;
  aus)
    lauf 'rm -f /tmp/.mixpi-wartung'
    lauf 'curl -s -m 8 http://localhost:8200/api/wartung'; echo
    ;;
  status)
    lauf 'curl -s -m 8 http://localhost:8200/api/wartung'; echo
    ;;
  *)
    echo "unbekannt: $WAS (an|aus|status)" >&2
    exit 2
    ;;
esac
