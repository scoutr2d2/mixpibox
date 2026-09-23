#!/bin/bash
#
# DIE ADAPTERWAHL ÜBER DEN NEUSTART RETTEN (MixPi, 21.08.2026).
#
# Gegenstueck zu /etc/mupibox/bt-adapter: dort steht, welcher Bluetooth-Baustein
# gilt, hier welcher Funkbaustein. Der Server schreibt die Datei, sobald ein
# Wechsel NACHWEISLICH stattgefunden hat; dieses Skript wendet sie beim Start an.
#
# ══ WARUM ES DAS BRAUCHT ════════════════════════════════════════════════════
#
# POST /api/wlan-adapter macht `ifdown` — und das haelt bis zum Neustart. In
# /etc/network/interfaces steht `allow-hotplug wlan0`, in interfaces.d/wlan1
# dasselbe fuer wlan1. Nach jedem Neustart kommen also BEIDE hoch.
#
# UND ZWEI SCHNITTSTELLEN IM SELBEN TEILNETZ SIND NICHT NUR UNSCHOEN. Am
# 21.08.2026 an der Box gemessen: die Box war unter der Adresse des Sticks
# zwar per Ping erreichbar, nahm dort aber KEINE TCP-Verbindung an. Ursache ist
# der ARP-Flux — `arp_ignore` steht ueberall auf 0, also beantwortet auch wlan0
# die Anfragen nach der Adresse von wlan1. Der Router schickt die Pakete dann
# an die falsche Karte, die Antwort geht ueber die andere hinaus, und die
# Gegenstelle verwirft sie. Ping uebersteht das, ein Handschlag nicht.
#
# ══ DIE REGEL, DIE HIER NICHT VERHANDELBAR IST ══════════════════════════════
#
# ES WIRD NIE DIE LETZTE FUNKTIONIERENDE SCHNITTSTELLE ABGESCHALTET. Steht in
# der Datei `extern`, ist aber kein wlan1 da (Stick abgezogen), passiert
# NICHTS. Eine Box, die sich beim Start selbst aussperrt, ist schlimmer als
# eine, die zwei Schnittstellen oben hat — an die erste kommt niemand mehr
# heran, um es zu richten.
#
# Ohne Datei passiert ebenfalls nichts. Kein Eintrag heisst „keine Wahl
# getroffen", nicht „nimm die Vorgabe".

# ZWEI NAEHTE FUER DEN TEST — und nur dafuer. Ein Skript, das echte
# Schnittstellen hinlegt, darf in einer Testsuite nichts anfassen; also muss
# der Pfad zur Wahldatei setzbar sein und die Wartezeit kurz. Beides hat
# Vorgabewerte, die im Betrieb gelten; wer nichts setzt, merkt nichts davon.
WAHL_DATEI="${MIXPI_WLAN_WAHL:-/etc/mupibox/mixpi-wlan-adapter}"
WARTEN="${MIXPI_WLAN_WARTEN:-45}"
# Dritte Naht: wo die DHCP-Mietvertraege liegen (im Test ein Wegwerfordner).
VERTRAGSORDNER="${MIXPI_WLAN_VERTRAGSORDNER:-/var/lib/dhcp}"
INTERN="wlan0"
EXTERN="wlan1"

sag() { echo "[mixpi-wlan-adapter] $*"; }

[ -r "${WAHL_DATEI}" ] || { sag "keine Wahl hinterlegt (${WAHL_DATEI}) - beide Schnittstellen bleiben, wie sie sind"; exit 0; }

WAHL=$(tr -d '[:space:]' < "${WAHL_DATEI}" | tr '[:upper:]' '[:lower:]')
case "${WAHL}" in
  intern) BEHALTEN="${INTERN}"; WEG="${EXTERN}" ;;
  extern) BEHALTEN="${EXTERN}"; WEG="${INTERN}" ;;
  *) sag "unbekannte Wahl '${WAHL}' - es wird nichts angefasst"; exit 0 ;;
esac

# WARTEN, BIS DIE GEWAEHLTE WIRKLICH TRAEGT. Beim Start laeuft DHCP noch;
# wer sofort die andere abschaltet, kappt womoeglich die einzige Verbindung.
# Bis zu ${WARTEN} s (Vorgabe 45), in Schritten - grosszuegig, und es kostet
# schneller geht.
for _ in $(seq 1 "${WARTEN}"); do
  if ip -br addr show "${BEHALTEN}" 2>/dev/null | grep -qE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+'; then
    break
  fi
  sleep 1
done

if ! ip -br addr show "${BEHALTEN}" 2>/dev/null | grep -qE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+'; then
  # DIE WICHTIGSTE STELLE DIESES SKRIPTS. Gewaehlt, aber traegt nicht - dann
  # wird NICHTS abgeschaltet, und seit dem ifup-Riegel (E131/C1) kommt die
  # RETTUNG dazu: der Riegel hat die andere Karte beim Boot unten gelassen;
  # wenn die gewaehlte binnen Frist keine Adresse bekam, muss die verriegelte
  # jetzt doch hoch, sonst steht die Box ohne jede Verbindung da. `ifup`
  # direkt laeuft nicht ueber ifup@ und damit nicht durch den Riegel.
  sag "GEWAEHLT WAR ${BEHALTEN} (${WAHL}), aber die Schnittstelle hat keine Adresse - es wird NICHTS abgeschaltet"
  if ! ip -br addr show "${WEG}" 2>/dev/null | grep -qE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+'; then
    sag "RETTUNG: ${WEG} wird hochgefahren, damit die Box erreichbar bleibt"
    ifup "${WEG}" 2>&1 || sag "ACHTUNG: ifup ${WEG} scheiterte - Box womoeglich nur noch am Geraet erreichbar"
  fi
  exit 0
fi

if ! ip -br link show "${WEG}" >/dev/null 2>&1; then
  sag "${WEG} gibt es nicht - nichts zu tun"
  exit 0
fi

sag "Wahl '${WAHL}': ${BEHALTEN} traegt, ${WEG} wird hingelegt"
ifdown "${WEG}" 2>&1 || ip link set "${WEG}" down 2>&1

# ── DIE VORGABEROUTE MUSS DANACH NEU GESETZT WERDEN ──────────────────────
#
# HIER STAND EIN HENNE-EI-FEHLER, und er hat der Box das Internet gekostet:
#
#     ip route replace default via "$(ip route | awk '/^default/ {print $3}')" … 2>/dev/null || true
#
# Das TOR wurde aus der VORHANDENEN Vorgaberoute gelesen — die `ifdown`
# eine Zeile darueber gerade entfernt hatte. Also war die Ersetzung leer, der
# Befehl unvollstaendig, und `2>/dev/null || true` hat es verschluckt.
# Ergebnis am Geraet: die Box erreichte den Router (gleiches Teilnetz), aber
# alles dahinter meldete "Network is unreachable" — mit einer Fehlermeldung,
# die niemand je zu sehen bekam.
#
# DAS TOR KOMMT JETZT AUS DEM DHCP-MIETVERTRAG der behaltenen Schnittstelle.
# Dort steht es unabhaengig davon, welche Routen gerade existieren. Erst wenn
# es das nicht gibt, wird eine noch vorhandene Vorgaberoute befragt.
tor=""
vertrag="${VERTRAGSORDNER}/dhclient.${BEHALTEN}.leases"
[ -r "${vertrag}" ] && tor=$(awk '/option routers/ {gsub(/[;]/,"",$3); t=$3} END {print t}' "${vertrag}")
[ -n "${tor}" ] || tor=$(ip route | awk '/^default/ {print $3; exit}')

if [ -n "${tor}" ]; then
    # DER RUECKGABEWERT ENTSCHEIDET, DIE MELDUNG ERKLAERT. Beides wird
    # gebraucht: ohne den Wert merkt niemand den Fehler, ohne die Meldung
    # weiss niemand, woran es lag. `2>&1` in die Variable statt nach
    # /dev/null - genau der Unterschied, der den Umschalter ein halbes Jahr
    # lang unsichtbar kaputt gehalten hat.
    if meldung=$(ip route replace default via "${tor}" dev "${BEHALTEN}" 2>&1); then
        sag "Vorgaberoute steht: via ${tor} dev ${BEHALTEN}"
    else
        sag "ACHTUNG: Vorgaberoute liess sich nicht setzen (via ${tor} dev ${BEHALTEN}) - die Box hat kein Internet: ${meldung}"
    fi
else
    sag "ACHTUNG: kein Tor gefunden (weder in ${vertrag} noch in der Routentabelle) - die Box hat kein Internet"
fi

sag "fertig - $(ip -br addr show ${BEHALTEN} | tr -s ' ')"
