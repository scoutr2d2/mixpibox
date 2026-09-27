#!/usr/bin/env python3
"""Prueft die Schritt-Auswahl nach Zielhardware (controller/hardware.py)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "controller"))
import hardware  # noqa: E402

fehler = 0


def pruefe(name, ist, soll):
    global fehler
    if ist == soll:
        print(f"  ok    {name}")
    else:
        fehler += 1
        print(f"  FEHLT {name}: ist {ist!r}, soll {soll!r}")


PI4 = {"model_id": "pi4", "codename": "trixie", "debian_major": 13, "arch": "aarch64"}
PI5 = {"model_id": "pi5", "codename": "trixie", "debian_major": 13, "arch": "aarch64"}

f4 = hardware.fakten(PI4)
f5 = hardware.fakten(PI5)

print("fakten")
pruefe("Pi 4 kennt sein Modell", "pi4" in f4, True)
# Der SoC ist oft die ehrlichere Frage: bcm2711 trifft Pi 4 UND CM4.
pruefe("Pi 4 kennt seinen SoC", "bcm2711" in f4, True)
pruefe("CM4 teilt den SoC des Pi 4",
       "bcm2711" in hardware.fakten({"model_id": "cm4"}), True)
pruefe("Pi 5 hat einen anderen SoC", "bcm2712" in f5 and "bcm2711" not in f5, True)
pruefe("Codename ist dabei", "trixie" in f4, True)
pruefe("Debian-Fassung ist dabei", "debian13" in f4, True)
pruefe("unbekanntes Modell erzeugt keine Marke",
       "unknown" in hardware.fakten({"model_id": "unknown"}), False)
pruefe("leere Umgebung ergibt leere Menge", hardware.fakten(None), set())

print("passt")
pruefe("ohne Bedingung laeuft alles", hardware.passt(None, f4), True)
pruefe("leere Bedingung laeuft auch", hardware.passt("", f4), True)
pruefe("einfaches Modell trifft", hardware.passt("pi4", f4), True)
pruefe("einfaches Modell trifft nicht", hardware.passt("pi4", f5), False)
pruefe("Liste trifft (Leerzeichen)", hardware.passt("pi4 pi5", f5), True)
pruefe("Liste trifft (Komma)", hardware.passt("pi4,pi5", f4), True)
pruefe("Verneinung schliesst aus", hardware.passt("!pi5", f5), False)
pruefe("Verneinung laesst durch", hardware.passt("!pi5", f4), True)
# Ein Verbot schlaegt ein Gebot - sonst waere "pi5 !trixie" sinnlos.
pruefe("Verbot schlaegt Gebot", hardware.passt("pi5 !trixie", f5), False)
pruefe("Gebot ohne greifendes Verbot", hardware.passt("pi5 !bookworm", f5), True)
pruefe("nach SoC statt Modell", hardware.passt("bcm2711", f4), True)
pruefe("nach Codename", hardware.passt("trixie", f4), True)

print("passt: Zweifelsfall")
# Lieber einen Schritt zu viel anbieten als eine Installation stillschweigend
# halbieren, weil die Erkennung nicht durchkam.
pruefe("unbekannte Umgebung laesst alles durch", hardware.passt("pi5", set()), True)
pruefe("nur Leerzeichen als Bedingung", hardware.passt("   ", f4), True)
pruefe("einzelnes Ausrufezeichen wird ignoriert", hardware.passt("!", f4), True)

print("auswerten")
schritte = [
    {"id": "immer"},
    {"id": "nur5", "when": "pi5"},
    {"id": "nur4", "when": "pi4"},
    {"id": "ausser5", "when": "!pi5"},
]
weg4 = hardware.auswerten(schritte, f4)
pruefe("auf dem Pi 4 faellt nur der Pi-5-Schritt weg", [i for i, _ in weg4], ["nur5"])
pruefe("die Bedingung wird mitgeliefert", weg4[0][1], "pi5")
weg5 = hardware.auswerten(schritte, f5)
pruefe("auf dem Pi 5 fallen zwei weg", [i for i, _ in weg5], ["nur4", "ausser5"])
pruefe("ohne Schritte kein Ergebnis", hardware.auswerten([], f4), [])
pruefe("ohne Schritte (None)", hardware.auswerten(None, f4), [])

print()
if fehler:
    print(f"{fehler} Pruefung(en) fehlgeschlagen")
    sys.exit(1)
print("alle Pruefungen bestanden")
