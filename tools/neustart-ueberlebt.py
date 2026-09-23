#!/usr/bin/env python3
"""UEBERLEBT DER ZUSTAND DER BOX EINEN NEUSTART? Aufnehmen, neu starten, vergleichen.

WOZU
Der Sandkasten kann alles ausser dem einen: er kann die Box nicht ausschalten.
Jede Einstellung, die nur im Arbeitsspeicher steht, im `/tmp` liegt oder beim
Start aus einer zweiten Quelle ueberschrieben wird, sieht bis zum Neustart
richtig aus. Danach nicht mehr — und gemerkt wird es am naechsten Morgen von
einem Kind, nicht von einem Test.

GEMESSEN am 08.08.2026: `displayBrightness` steht auf 20, und
`/sys/class/backlight/*/brightness` stand auf 51 (= 20 % von 255). Ob diese
Zahl aus der Konfiguration stammt oder nur zufaellig noch vom letzten
Verstellen dort steht, kann man NUR am Neustart sehen.

WIE
    python3 tools/neustart-ueberlebt.py --aufnehmen  vorher.json
    # ... Box neu starten und warten, bis sie wieder antwortet ...
    python3 tools/neustart-ueberlebt.py --vergleichen vorher.json

DAS WERKZEUG STARTET NICHTS NEU. Der Neustart bleibt Handarbeit, und zwar
mit Absicht: diese Box steht im Wohnzimmer eines Kindes. Ein Werkzeug, das
`reboot` in sich traegt, wird irgendwann versehentlich aufgerufen.

NUR LESEND. Es liest Konfiguration, Dienstzustand und ein paar Werte aus
`/sys` und `/tmp` — und schreibt ausschliesslich die Aufnahmedatei HIER,
nie auf der Box.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys

BOX_VORGABE = "dietpi@192.168.178.169"

# Die Dienste, deren Zustand nach einem Neustart derselbe sein MUSS.
DIENSTE = [
    "mupibox-server",
    "mupibox-player",
    "mupi_powerled",
    "mupi_hat",
    "mupi_hat_control",
    "mupi_change_checker",
    "mupi_check_internet",
    "mupi_check_monitor",
    "mupibox-touch-bridge",
    "mupi_idle_shutdown",
    "mupi_mqtt",
]

# Werte aus der Konfiguration, die ein Mensch eingestellt hat. Ein Neustart
# darf an keinem davon etwas aendern.
GESTELLT = [
    ".mupibox.oberflaeche",
    ".mupibox.theme",
    ".mupibox.einstellungssperre",
    ".mupibox.displayBrightness",
    ".mupibox.maxVolume",
    ".mupibox.startVolume",
    ".mupibox.resume",
    ".timeout.pressDelay",
    ".timeout.idleDisplayOff",
    ".timeout.idlePiShutdown",
    ".shim.ledBrightnessMax",
    ".shim.ledBrightnessMin",
    ".shim.ledEnabled",
]


def am_geraet(box: str, befehl: str) -> str:
    fertig = subprocess.run(
        ["ssh", "-o", "ConnectTimeout=10", box, befehl],
        capture_output=True,
        text=True,
    )
    return fertig.stdout.strip()


def aufnehmen(box: str) -> dict:
    """Den Zustand der Box in eine Aufnahme giessen."""
    stand: dict = {"dienste": {}, "gestellt": {}, "geraet": {}}

    zeilen = am_geraet(
        box,
        "; ".join(
            f'printf "%s %s %s\\n" {d} $(systemctl is-active {d} 2>/dev/null) '
            f"$(systemctl is-enabled {d} 2>/dev/null)"
            for d in DIENSTE
        ),
    )
    for zeile in zeilen.splitlines():
        teile = zeile.split()
        if len(teile) == 3:
            stand["dienste"][teile[0]] = {"aktiv": teile[1], "start": teile[2]}

    # Alle gestellten Werte in EINEM jq-Aufruf — sonst sind es 13 SSH-Runden.
    ausdruck = ", ".join(f'"{p}": ({p} | tostring)' for p in GESTELLT)
    roh = am_geraet(box, f"jq -c '{{{ausdruck}}}' /etc/mupibox/mupiboxconfig.json")
    try:
        stand["gestellt"] = json.loads(roh)
    except json.JSONDecodeError:
        stand["gestellt"] = {"FEHLER": roh}

    # Was nur am Geraet steht und einen Neustart ueberstehen muss.
    stand["geraet"]["schirm_helligkeit"] = am_geraet(
        box, "cat /sys/class/backlight/*/brightness 2>/dev/null"
    )
    stand["geraet"]["schirm_max"] = am_geraet(
        box, "cat /sys/class/backlight/*/max_brightness 2>/dev/null"
    )
    stand["geraet"]["led_dim_mode"] = am_geraet(
        box, "jq -r .led_dim_mode /tmp/.power_led 2>/dev/null"
    )
    stand["geraet"]["monitor"] = am_geraet(
        box,
        "jq -r .monitor /home/dietpi/.mupibox/Sonos-Kids-Controller-master/"
        "server/config/monitor.json 2>/dev/null",
    )
    stand["geraet"]["profil_aktiv"] = am_geraet(
        box,
        "jq -r .aktiv /home/dietpi/.mupibox/Sonos-Kids-Controller-master/"
        "server/config/profile.json 2>/dev/null",
    )
    stand["geraet"]["fehlerhafte_dienste"] = am_geraet(
        box, "systemctl list-units --state=failed --plain --no-legend --no-pager | awk '{print $1}'"
    )
    return stand


def vergleichen(vorher: dict, nachher: dict) -> list[str]:
    """Jeden Unterschied benennen. Leere Liste heisst: alles wie vorher."""
    abweichungen: list[str] = []

    for dienst in sorted(set(vorher["dienste"]) | set(nachher["dienste"])):
        a = vorher["dienste"].get(dienst)
        b = nachher["dienste"].get(dienst)
        if a != b:
            abweichungen.append(f"DIENST {dienst}: vorher {a} -> nachher {b}")

    for schluessel in sorted(set(vorher["gestellt"]) | set(nachher["gestellt"])):
        a = vorher["gestellt"].get(schluessel)
        b = nachher["gestellt"].get(schluessel)
        if a != b:
            abweichungen.append(f"GESTELLT {schluessel}: vorher {a!r} -> nachher {b!r}")

    for schluessel in sorted(set(vorher["geraet"]) | set(nachher["geraet"])):
        a = vorher["geraet"].get(schluessel)
        b = nachher["geraet"].get(schluessel)
        if a != b:
            abweichungen.append(f"GERAET {schluessel}: vorher {a!r} -> nachher {b!r}")

    return abweichungen


def main() -> int:
    zerleger = argparse.ArgumentParser(description=__doc__)
    zerleger.add_argument("--box", default=BOX_VORGABE)
    zerleger.add_argument("--aufnehmen", metavar="DATEI")
    zerleger.add_argument("--vergleichen", metavar="DATEI")
    wahl = zerleger.parse_args()

    if wahl.aufnehmen:
        stand = aufnehmen(wahl.box)
        with open(wahl.aufnehmen, "w", encoding="utf-8") as datei:
            json.dump(stand, datei, indent=1, ensure_ascii=False)
        print(json.dumps(stand, indent=1, ensure_ascii=False))
        print(f"\nAufgenommen nach {wahl.aufnehmen}.")
        return 0

    if wahl.vergleichen:
        with open(wahl.vergleichen, encoding="utf-8") as datei:
            vorher = json.load(datei)
        nachher = aufnehmen(wahl.box)
        abweichungen = vergleichen(vorher, nachher)
        if not abweichungen:
            print("Kein Unterschied. Der Zustand hat den Neustart ueberlebt.")
            return 0
        print(f"{len(abweichungen)} Abweichung(en) nach dem Neustart:\n")
        for satz in abweichungen:
            print(f"  {satz}")
        return 1

    zerleger.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
