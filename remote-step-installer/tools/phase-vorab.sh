#!/bin/sh
# DIE PHASE FESTLEGEN, BEVOR DER SCHIRM SIE BRAUCHT.
#
# WOZU: Die Phasendatei liegt in /run — nach JEDEM Neustart ist sie weg.
# `mixpibox-einrichtung.service` startet den Schirm aber unabhaengig vom
# Vorstart (nur `After=mupibox-boot-splash.service`). Findet der Schirm keine
# Auskunft, zeigt er seinen Grundzustand: die Einrichtungsseite mit QR-Code.
# Am Geraet als kurzes Aufblitzen zu sehen, bei jedem Boot aufs Neue — "es
# wird immer noch kurz der qr screen angezeigt ... und auch nach dem
# neustart" (09.08.2026). Der Schirm hat dabei nichts falsch gemacht; ihm
# fehlte die Auskunft.
#
# Sie steht schon fest, bevor irgendetwas laeuft: DietPis Stufendatei sagt,
# ob noch das Grundsystem gebaut wird (0 oder 1) oder ob danach unser
# eigener Lauf drankommt (2).
#
# NICHTS SCHREIBEN, WENN SCHON ETWAS DASTEHT: laeuft der Vorstart bereits und
# hat eine genauere Phase gemeldet, waere ein Ueberschreiben ein Rueckschritt.
#
# ALS SKRIPT UND NICHT ALS ExecStartPre-EINZEILER: in einer systemd-Unit
# expandiert systemd selbst `$f` und `$(...)`, ein literales Dollar muesste
# `$$` heissen — eine Schleife wird so unlesbar und beim naechsten Anfassen
# falsch.
# Die beiden Pfade sind ueberschreibbar, damit dieses Skript PRUEFBAR ist —
# sonst muesste ein Test nach /run und /boot schreiben und liefe nur als
# root. Im Betrieb setzt sie niemand.
set -u
ORDNER=${MIXPI_PHASE_ORDNER:-/run/mixpibox-einrichtung}
STUFEN=${MIXPI_STUFEN:-"/boot/dietpi/.install_stage /boot/firmware/dietpi/.install_stage"}
mkdir -p "$ORDNER" 2>/dev/null || exit 0
[ -s "$ORDNER/phase" ] && exit 0

STUFE=""
for f in $STUFEN; do
    [ -f "$f" ] || continue
    STUFE=$(tr -dc "0-9-" < "$f" 2>/dev/null)
    break
done

# OHNE STUFENDATEI NICHTS BEHAUPTEN. Dann ist es kein DietPi in der
# Erstinstallation, und der Schirm darf seinen Grundzustand zeigen — das ist
# genau der Fall, in dem der QR-Code richtig ist (Einrichtung ohne Netz).
[ -n "$STUFE" ] || exit 0

if [ "$STUFE" = "2" ]; then
    echo vorbereitung > "$ORDNER/phase"
else
    echo grundsystem > "$ORDNER/phase"
fi
exit 0
