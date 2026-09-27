#!/bin/bash
#
# DER RIEGEL VOR ifup@ — die abgewaehlte Funkkarte gar nicht erst hochfahren
# (MixPi, E131/C1, 06.09.2026).
#
# ══ WOZU ═══════════════════════════════════════════════════════════════════
#
# Bisher kamen nach jedem Neustart BEIDE Karten hoch, und der Dienst
# mixpi-wlan-adapter legte die abgewaehlte NACH network-online wieder hin.
# Das kostete doppelt: ifup@wlan0 wartete volle DHCP-Runden auf einer Karte,
# die gleich darauf faellt (~8 s Boot), und bis zum Hinlegen beantworteten
# BEIDE Karten ARP-Anfragen im selben Teilnetz — das ARP-Flux-Fenster, in dem
# die Box Ping annahm, aber keinen TCP-Handschlag (gemessen 21.08.2026, siehe
# Kopf von mixpi-wlan-adapter.sh).
#
# Dieses Skript haengt als ExecStartPre in einem Drop-in an ifup@.service
# (scripts/systemd/ifup-mixpi-wlan-riegel.conf). Rueckgabe 1 heisst: diese
# Schnittstelle wird NICHT hochgefahren. Rueckgabe 0 heisst: durchlassen.
#
# ══ DIE REGEL, DIE HIER NICHT VERHANDELBAR IST ══════════════════════════════
#
# ES WIRD NIE DIE LETZTE MOEGLICHE VERBINDUNG VERRIEGELT. Deshalb ist JEDER
# unklare Fall ein Durchlassen (exit 0): keine Wahl-Datei, unlesbarer Inhalt,
# fremde Schnittstelle (eth0), fehlendes Argument — und vor allem: die
# GEWAEHLTE Karte ist als Geraet gar nicht da (Stick gezogen). Verriegelt
# wird ausschliesslich, wenn die Wahl klar ist UND die gewaehlte Karte
# physisch existiert. Ob sie dann auch TRAEGT, prueft der Rettungszweig in
# mixpi-wlan-adapter.sh: kommt sie binnen Frist nicht hoch, faehrt er die
# verriegelte doch noch hoch (ifup direkt — das laeuft nicht ueber ifup@ und
# damit nicht durch diesen Riegel).
#
# ══ NAEHTE FUER DEN TEST ════════════════════════════════════════════════════
#
# Dieselben wie beim Nachbarn mixpi-wlan-adapter.sh: Pfade setzbar, Vorgaben
# gelten im Betrieb. NETZKLASSE zeigt im Test auf einen Wegwerfordner mit
# angelegten Geraete-Attrappen.
WAHL_DATEI="${MIXPI_WLAN_WAHL:-/etc/mupibox/mixpi-wlan-adapter}"
NETZKLASSE="${MIXPI_WLAN_NETZKLASSE:-/sys/class/net}"
# Wie lange auf das ERSCHEINEN der gewaehlten Karte gewartet wird (Sekunden).
# Beim ersten Geraetelauf (06.09.2026, Boot 10:17) kam der Riegel zu frueh:
# ifup@wlan0 startet, BEVOR der USB-Stick enumeriert ist (PID 1320 vs.
# USB-Probe Sekunden spaeter) - /sys/class/net/wlan1 fehlte, die
# Sicherheitsregel liess wlan0 korrekt durch, und der Riegel lief ins Leere.
# Deshalb: fehlt die Gewaehlte NOCH, wird kurz gewartet. Taucht sie auf,
# wird verriegelt; sonst gilt weiter die Sicherheitsregel. Der Preis faellt
# nur im Stick-gezogen-Fall an (dann wartet wlan0 diese Sekunden extra).
STICK_WARTEN="${MIXPI_WLAN_STICK_WARTEN:-10}"
INTERN="wlan0"
EXTERN="wlan1"

sag() { echo "[mixpi-wlan-riegel] $*"; }

SCHNITTSTELLE="$1"
[ -n "${SCHNITTSTELLE}" ] || exit 0

# Nur die zwei bekannten Funkkarten werden ueberhaupt geregelt — eth0,
# Bruecken, alles Fremde geht immer durch.
case "${SCHNITTSTELLE}" in
  "${INTERN}" | "${EXTERN}") ;;
  *) exit 0 ;;
esac

[ -r "${WAHL_DATEI}" ] || exit 0

WAHL=$(tr -d '[:space:]' < "${WAHL_DATEI}" | tr '[:upper:]' '[:lower:]')
case "${WAHL}" in
  intern) BEHALTEN="${INTERN}" ;;
  extern) BEHALTEN="${EXTERN}" ;;
  *) exit 0 ;;
esac

# Die gewaehlte Karte selbst geht immer durch.
[ "${SCHNITTSTELLE}" = "${BEHALTEN}" ] && exit 0

# Die GEWAEHLTE muss als Geraet DA sein — sonst darf die andere hoch
# (Stick gezogen: wlan0 traegt, wie es die Sicherheitsregel verlangt).
# ERST KURZ WARTEN: beim Boot startet ifup@wlan0, bevor der USB-Stick
# enumeriert ist (Begruendung an STICK_WARTEN oben).
if [ ! -e "${NETZKLASSE}/${BEHALTEN}" ]; then
  for _ in $(seq 1 "${STICK_WARTEN}"); do
    sleep 1
    [ -e "${NETZKLASSE}/${BEHALTEN}" ] && break
  done
fi
if [ ! -e "${NETZKLASSE}/${BEHALTEN}" ]; then
  sag "Wahl '${WAHL}', aber ${BEHALTEN} fehlt als Geraet (auch nach ${STICK_WARTEN} s) - ${SCHNITTSTELLE} darf hoch"
  exit 0
fi

sag "Wahl '${WAHL}': ${SCHNITTSTELLE} bleibt unten (${BEHALTEN} ist da und uebernimmt)"
exit 1
