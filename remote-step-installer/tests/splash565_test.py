#!/usr/bin/env python3
"""Prueft das NATIVE Zeichnen des Startbilds fuer 16- und 32-bpp-Schirme.

Der Pi 4 faehrt seinen Framebuffer mit 16 bpp hoch, der Pi 5 mit 32. Gezeichnet
wird direkt im jeweiligen Format - es gibt KEINE Umrechnung mehr, weder eine
schnelle noch eine langsame.
"""
import importlib.util
import os
import sys

HIER = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    "splash", os.path.join(HIER, "..", "tools", "mupibox-boot-splash.py"))
splash = importlib.util.module_from_spec(spec)
spec.loader.exec_module(splash)

fehler = 0


def pruefe(name, ist, soll):
    global fehler
    if ist == soll:
        print(f"  ok    {name}")
    else:
        fehler += 1
        print(f"  FEHLT {name}: ist {ist!r}, soll {soll!r}")


def wort(zwei):
    return zwei[0] | (zwei[1] << 8)


print("punkt: 32 bpp (Pi 5) — BGRA wie eh und je")
pruefe("Weiss", splash.punkt(255, 255, 255, 32), bytes((255, 255, 255, 0)))
pruefe("reines Rot liegt an dritter Stelle", splash.punkt(255, 0, 0, 32), bytes((0, 0, 255, 0)))
pruefe("vier Bytes je Punkt", len(splash.punkt(1, 2, 3, 32)), 4)

print("punkt: 16 bpp (Pi 4) — RGB565")
pruefe("zwei Bytes je Punkt", len(splash.punkt(1, 2, 3, 16)), 2)
pruefe("Schwarz", wort(splash.punkt(0, 0, 0, 16)), 0x0000)
pruefe("Weiss", wort(splash.punkt(255, 255, 255, 16)), 0xFFFF)
pruefe("reines Rot", wort(splash.punkt(255, 0, 0, 16)), 0xF800)
pruefe("reines Gruen", wort(splash.punkt(0, 255, 0, 16)), 0x07E0)
pruefe("reines Blau", wort(splash.punkt(0, 0, 255, 16)), 0x001F)
# Gruen bekommt SECHS Bit - ein Fehler hier faellt sonst nur als leichter
# Farbstich auf, den niemand einem Bitmuster zuordnet.
pruefe("Gruen hat 6 Bit", splash.punkt(0, 4, 0, 16) != splash.punkt(0, 0, 0, 16), True)

print("hintergrund: zurueckgelesen fuer das Mischen")
for bpp in (16, 32):
    for farbe in ((0, 0, 0), (255, 255, 255), (0x00, 0x12, 0x33)):
        zurueck = splash.hintergrund(splash.punkt(*farbe, bpp), bpp)
        # Bei 32 exakt, bei 16 GROEBER (5 bzw. 6 Bit) - das ist kein Fehler,
        # sondern das, was auf so einem Schirm wirklich steht.
        grenze = 0 if bpp == 32 else 8
        passt = all(abs(a - b) <= grenze for a, b in zip(zurueck, farbe))
        pruefe(f"{bpp} bpp: {farbe} kommt zurueck (±{grenze})", passt, True)

print("Rundlauf: Extremwerte bleiben Extremwerte")
pruefe("16 bpp: Schwarz bleibt Schwarz", splash.hintergrund(splash.punkt(0, 0, 0, 16), 16), (0, 0, 0))
pruefe("16 bpp: Weiss bleibt Weiss",
       splash.hintergrund(splash.punkt(255, 255, 255, 16), 16), (255, 255, 255))

print("Flaeche: das Muster wird nur WIEDERHOLT, nicht gerechnet")
# Genau das war der Gewinn: frueher lief jeder Bildpunkt durch eine Schleife.
for bpp in (16, 32):
    px = splash.punkt(0x00, 0x12, 0x33, bpp)
    flaeche = px * 100
    pruefe(f"{bpp} bpp: 100 Punkte = {len(px)*100} Byte", len(flaeche), (bpp // 8) * 100)

print()
if fehler:
    print(f"{fehler} Pruefung(en) fehlgeschlagen")
    sys.exit(1)
print("alle Pruefungen bestanden")
