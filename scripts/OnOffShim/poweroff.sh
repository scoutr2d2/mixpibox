#!/bin/bash
#
# DER STROM-SCHNITT NACH DEM HALT — Phase 2 des Ausschaltknopfs.
#
# systemd ruft dieses Skript als system-shutdown-Haken ganz zuletzt auf, mit
# "poweroff", "reboot" oder "halt" als $1. Zu diesem Zeitpunkt steht das
# System bereits, die Dateisysteme sind nur noch lesbar — genau der Moment,
# in dem die Platine den Strom wegnehmen darf.
#
# ══ WARUM NICHT DAS OVERLAY (gpio-poweroff) ════════════════════════════════
#
# Es waere der kuerzere Weg (eine Zeile in config.txt, autosetup.sh sieht sie
# sogar vor) — aber sein eigener Hilfetext warnt:
#
#     "Using this overlay interferes with the normal power-down sequence,
#      preventing the kernel from resetting the SoC (a necessary step in a
#      normal power-off or reboot)."
#
# Auf einem Pi 5 mit eigenem PMIC ist das kein theoretisches Risiko: bricht
# der Neustart, kommt man nur noch stromlos an die Box. Dieser Haken dagegen
# laeuft NACH allem und greift in keine Kernel-Sequenz ein. Scheitert er,
# bleibt die Box an — der Zustand von vorher, ohne neuen Schaden.
#
# ══ WARUM PYTHON UND NICHT gpioset ═════════════════════════════════════════
#
# Hier stand bis 16.08.2026 `gpioset gpiochip0 27=1`. Am Geraet gemessen:
# libgpiod fehlt auf dieser Box, und das Paket in Debian 13 ist Fassung 2.x
# MIT ANDERER AUFRUFFORM. Beide Zeilen liefen also ins Leere — der Grund,
# aus dem der Knopf jahrelang nur den harten 6-s-Schnitt der Platine kannte.
# `taster_wache.py` geht denselben Weg ueber python3-lgpio; damit treibt
# `led_control.py` auf dieser Box gerade das Licht im Knopf.
#
# ══ DIE FALLE, DIE HIER FAST JEDER STELLT ══════════════════════════════════
#
# Eine GPIO-Leitung gehoert dem Prozess, der sie haelt. ENDET das Programm,
# gibt der Kernel sie frei und sie faellt in ihren Ruhezustand zurueck. Wer
# also nur setzt und sich beendet, schaltet die Leitung fuer Mikrosekunden —
# viel zu kurz, als dass die Platine reagieren koennte. Deshalb HAELT der
# Helfer unten die Leitungen und schlaeft; der Strom verschwindet unter ihm.
#
# Aufruf zum Pruefen OHNE zu schneiden (die Box laeuft weiter):
#     sudo /usr/lib/systemd/system-shutdown/poweroff.sh --probe

CONFIG="/etc/mupibox/mupiboxconfig.json"
LOG="/run/mupi-poweroff.log"

# ── Die Pins kommen aus der Konfiguration, mit Rueckfall ───────────────────
# Im Abschaltmoment kann jq fehlen oder /etc schon nicht mehr lesbar sein.
# Ein Rueckfall ist hier keine Bequemlichkeit: ohne ihn schneidet niemand.
POWEROFF_PIN=4
CUT_PIN=27
if [ -r "${CONFIG}" ] && command -v jq >/dev/null 2>&1; then
    p=$(jq -r '.shim.poweroffPin // empty' "${CONFIG}" 2>/dev/null)
    c=$(jq -r '.shim.cutPin // empty' "${CONFIG}" 2>/dev/null)
    case "${p}" in ''|*[!0-9]*) : ;; *) POWEROFF_PIN="${p}" ;; esac
    case "${c}" in ''|*[!0-9]*) : ;; *) CUT_PIN="${c}" ;; esac
fi

PROBE=0
[ "${1:-}" = "--probe" ] && PROBE=1

# systemd gibt "poweroff", "reboot" oder "halt". BEI REBOOT DARF NICHTS
# GESCHNITTEN WERDEN — sonst startet die Box nach jedem Neustart nicht mehr,
# sondern bleibt dunkel, und niemand faende den Grund.
if [ "${PROBE}" -eq 0 ] && [ "${1:-}" != "poweroff" ]; then
    exit 0
fi

echo "$(date) - poweroff-Haken: $1 (probe=${PROBE}), Pins: cut=${CUT_PIN} off=${POWEROFF_PIN}" >> "${LOG}" 2>/dev/null

/usr/bin/python3 - "${CUT_PIN}" "${POWEROFF_PIN}" "${PROBE}" <<'PYEOF' >> "${LOG}" 2>&1
import sys
import time

cut, aus, probe = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])

try:
    import lgpio
except Exception as f:
    print(f"lgpio fehlt: {f} - der Strom bleibt an, das System steht trotzdem sauber")
    sys.exit(1)

try:
    h = lgpio.gpiochip_open(0)          # pinctrl-rp1, die 40-Pin-Leiste
except Exception as f:
    print(f"gpiochip0 nicht zu oeffnen: {f}")
    sys.exit(1)

if probe:
    # ══ TROCKENPROBE - UND SIE DARF NICHTS TREIBEN ═════════════════════════
    #
    # HIER STAND `gpio_claim_output(h, pin, 0)`, UND DAS HAT AM 16.08.2026 DIE
    # LAUFENDE BOX HART AUSGESCHALTET. Der Grund ist beim Hinsehen offensicht-
    # lich und war es beim Schreiben nicht: `claim_output(..., 0)` LEGT DIE
    # LEITUNG AUF NULL - und Null auf dem poweroffPin IST das Abschaltsignal
    # (active_low). Die "Probe" hat also genau das getan, was sie pruefen
    # sollte, mitten im Betrieb, ohne Herunterfahren.
    #
    # Eine Probe, die den Ernstfall AUSLOEST, ist keine Probe. Sie meldet
    # jetzt als EINGANG an: das belegt die Leitung genauso (und beantwortet
    # damit "gehoert sie jemand anderem?"), treibt sie aber nicht.
    for pin in (cut, aus):
        try:
            lgpio.gpio_claim_input(h, pin)
            stand = lgpio.gpio_read(h, pin)
            lgpio.gpio_free(h, pin)
            print(f"  GPIO{pin}: frei, liegt gerade auf {stand} (nicht getrieben)")
        except Exception as f:
            print(f"  GPIO{pin}: NICHT verfuegbar - {f}")
    lgpio.gpiochip_close(h)
    sys.exit(0)

try:
    # Dieselbe Reihenfolge wie die alten gpioset-Zeilen: erst der Schnitt,
    # dann das Signal an den Shim.
    lgpio.gpio_claim_output(h, cut, 1)
    lgpio.gpio_claim_output(h, aus, 0)
    print(f"gesetzt: GPIO{cut}=1, GPIO{aus}=0 - halte die Leitungen")
    # HALTEN, NICHT BEENDEN (siehe der Kopf dieser Datei). Zehn Sekunden sind
    # reichlich; kommt der Strom nicht weg, faellt das System ohnehin nur in
    # den Zustand, den es ohne dieses Skript auch haette.
    time.sleep(10)
    print("nach 10 s noch am Leben - die Platine hat nicht geschnitten")
except Exception as f:
    print(f"Schnitt fehlgeschlagen: {f}")
    sys.exit(1)
PYEOF

exit 0
