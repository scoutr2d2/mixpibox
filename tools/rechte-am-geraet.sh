#!/bin/bash
# WAS DER DIENST AUF DER BOX WIRKLICH DARF — nur lesend, nichts geschaltet.
#
#     tools/rechte-am-geraet.sh [adresse]
#
# ══ WARUM ES DAS (WIEDER) GIBT ═══════════════════════════════════════════
# Der Wiki-Eintrag `endpunkt-ohne-sudo-schaltet-nichts-und-sagt-ok` nennt als
# Nachmessung seit dem 07.08.2026 „tools/rechte-am-geraet.sh <adresse>". Am
# 23.08.2026 hat `tools/doku-pfade-pruefen.py` gemessen: die Datei gab es im
# ganzen Baum nicht. Der Eintrag beschrieb also einen Befund, den niemand
# nachvollziehen konnte — in genau demselben Eintrag, der schon eine
# Korrektur einer falschen „behoben in"-Zusage traegt.
#
# HIER NEU GEBAUT AUS DEN ZAHLEN, DIE IM EINTRAG STEHEN. Es misst genau die
# vier Dinge, aus denen dort der Schluss gezogen wurde:
#
#     mupibox-server.service   laeuft als dietpi (uid 1000)
#     sudo -n                  steht bereit: (ALL : ALL) NOPASSWD: ALL
#     /run/network             drwxr-xr-x root root — dietpi darf NICHT
#     ifdown als dietpi        failed to open lockfile … Permission denied
#
# ══ ES SCHALTET NICHTS ═══════════════════════════════════════════════════
# Die Box steht im Kinderzimmer und spielt womoeglich gerade. Ein `ifdown
# wlan0`, um zu sehen, ob es geht, nimmt ihr mitten im Hoerspiel das Netz.
# Deshalb wird die Rechtefrage OHNE Schaltvorgang beantwortet: der Schreibtest
# geht auf eine eigene Datei in /run/network (dieselbe Rechtefrage wie das
# Sperrfile von ifup/ifdown, ohne dessen Wirkung), und ifdown wird nur mit
# `--no-act` gerufen — das prueft die Rechte und tut nichts.
#
# ══ WARUM `sudo -n` UND SONST NICHTS ═════════════════════════════════════
# llmwiki `sudo-ohne-terminal-sperrt-das-konto`: ein sudo ohne Terminal fragt
# nach dem Passwort, scheitert, und faillock zaehlt mit. Jeder sudo-Aufruf
# hier traegt darum `-n`.
#
# Rueckgabe: 0 = gemessen, 1 = Box nicht erreichbar, 2 = Aufruf falsch.

set -u
ADRESSE="${1:-192.168.178.169}"
BENUTZER="${MUPI_USER:-dietpi}"
DIENST="${MUPI_DIENST:-mupibox-server.service}"

case "${1:-}" in
-h | --hilfe | --help)
    sed -n '2,40p' "$0"
    exit 2
    ;;
esac

ssh -o BatchMode=yes -o ConnectTimeout=5 "${BENUTZER}@${ADRESSE}" true 2>/dev/null || {
    echo "nicht erreichbar: ${BENUTZER}@${ADRESSE}" >&2
    exit 1
}

echo "── ${BENUTZER}@${ADRESSE} ─ nur lesend ──────────────────────────────"

# EINE Sitzung fuer alles: jede weitere kostet auf der Box rund eine Sekunde,
# und der Bericht soll ein Bild EINES Augenblicks sein, nicht sechs.
ssh -o BatchMode=yes "${BENUTZER}@${ADRESSE}" "DIENST='${DIENST}'" 'bash -s' <<'AUFDERBOX'
set -u

echo "── 1. Als wem laeuft der Dienst ──"
# Der User= aus der Unit UND die wirklich laufende Uid: eine Unit kann eine
# Zeile tragen, die seit dem letzten daemon-reload nicht mehr gilt.
systemctl cat "$DIENST" 2>/dev/null | grep -E '^(User|Group)=' || echo "  keine User=-Zeile (laeuft als root)"
haupt=$(systemctl show -p MainPID --value "$DIENST" 2>/dev/null)
if [ -n "${haupt:-}" ] && [ "$haupt" != "0" ]; then
    echo "  MainPID $haupt: $(ps -o user= -p "$haupt" 2>/dev/null) (uid $(awk '/^Uid:/{print $2}' "/proc/$haupt/status" 2>/dev/null))"
else
    echo "  laeuft gerade nicht — die User=-Zeile oben ist alles, was sich sagen laesst"
fi

echo "── 2. Steht sudo -n bereit ──"
if sudo -n -l >/tmp/.rechte-sudo 2>&1; then
    grep -E 'NOPASSWD|\(ALL' /tmp/.rechte-sudo | head -3
else
    echo "  NEIN: sudo -n scheitert — ein Endpunkt mit sudo schaltet hier nichts"
fi
rm -f /tmp/.rechte-sudo

echo "── 3. Wem gehoert /run/network ──"
ls -ld /run/network 2>/dev/null || echo "  /run/network gibt es nicht"

echo "── 4. Darf $(id -un) dort schreiben ──"
# NICHT auf ifstate selbst: das ist das Sperrfile von ifup/ifdown, und eine
# Datei, die wir dort anlegen, koennte deren Lauf stoeren. Eine eigene tut es
# — die Rechtefrage ist dieselbe.
if : >/run/network/.rechteprobe 2>/dev/null; then
    echo "  JA (unerwartet — dann liegt der Fehler nicht bei den Rechten)"
    rm -f /run/network/.rechteprobe
else
    echo "  NEIN: $(: >/run/network/.rechteprobe 2>&1 >/dev/null | head -1)"
fi

echo "── 5. ifdown ohne sudo, OHNE zu schalten (--no-act) ──"
if command -v ifdown >/dev/null 2>&1; then
    ifdown --no-act wlan0 2>&1 | head -2 || true
else
    echo "  ifdown gibt es nicht (NetworkManager-Box?)"
fi

echo "── 6. Dasselbe MIT sudo -n ──"
if command -v ifdown >/dev/null 2>&1; then
    sudo -n ifdown --no-act wlan0 2>&1 | head -2 || true
fi
AUFDERBOX

echo "───────────────────────────────────────────────────────────────────"
echo "Lesart: schlaegt 4 fehl und 6 nicht, MUSS jeder ifup/ifdown-Aufruf im"
echo "Dienst ueber 'sudo -n' laufen — und der Endpunkt muss das VOR seiner"
echo "Antwort pruefen, sonst meldet er ok und hat nichts getan."
