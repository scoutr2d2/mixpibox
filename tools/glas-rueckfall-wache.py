#!/usr/bin/env python3
"""GLAS-RUECKFALL-WACHE — steht in einem `@supports not (backdrop-filter …)`
nur, was dort hingehoert?

WARUM (27.09.2026): Der Rueckfall der Lautstaerke (eefd1b54, 08.08.2026) hatte
seine schliessende Klammer verloren. Alles bis zur naechsten ueberzaehligen
Klammer lag damit INNERHALB des Blocks — darunter die Regel „grosser Player
aus Glas" samt ihrem eigenen Rueckfall. Ein `@supports not (backdrop-filter)`
greift nur auf Geraeten OHNE Weichzeichner; auf der Box (Chromium, Cog) war
der grosse Player aus Glas damit sieben Wochen wirkungslos, ohne dass ein
Test rot wurde. Gefunden beim Bau des Schalters „Glas-Effekte aus".

DIE REGEL: In einem solchen Rueckfall-Block steht NIE ein Weichzeichner (er
ist genau der Fall, in dem es keinen gibt) und NIE ein weiteres @supports.
Beides ist das Zeichen, dass eine Klammer fehlt. Dazu die Klammerbilanz der
ganzen Datei.

AUFRUF
    python3 tools/glas-rueckfall-wache.py                 # NewDesign/app.css
    python3 tools/glas-rueckfall-wache.py DATEI.css
Rueckgabe: 0 = sauber, 1 = Befund.
"""
import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
datei = Path(sys.argv[1]) if len(sys.argv) > 1 else WURZEL / "NewDesign" / "app.css"
text = datei.read_text(encoding="utf-8")
# Kommentare laengentreu leeren — Zeilennummern bleiben stimmig.
ohne = re.sub(r"/\*.*?\*/", lambda m: re.sub(r"[^\n]", " ", m.group(0)), text, flags=re.S)

befunde = []
tiefe = 0
for i, c in enumerate(ohne):
    if c == "{":
        tiefe += 1
    elif c == "}":
        tiefe -= 1
        if tiefe < 0:
            befunde.append(f"Zeile {ohne[:i].count(chr(10)) + 1}: schliessende Klammer ohne oeffnende")
            tiefe = 0
if tiefe:
    befunde.append(f"Klammerbilanz {tiefe} am Dateiende — es fehlen schliessende Klammern")

for m in re.finditer(r"@supports\s+not\s*\(\s*\(\s*backdrop-filter", ohne):
    anfang = ohne.index("{", m.end())
    t = 0
    for j in range(anfang, len(ohne)):
        if ohne[j] == "{":
            t += 1
        elif ohne[j] == "}":
            t -= 1
            if t == 0:
                break
    innen = ohne[anfang + 1 : j]
    zeile = ohne[: m.start()].count("\n") + 1
    if re.search(r"backdrop-filter\s*:\s*(?!none)", innen):
        befunde.append(f"Zeile {zeile}: Rueckfall ohne Weichzeichner enthaelt einen Weichzeichner — fehlt eine Klammer?")
    if "@supports" in innen:
        befunde.append(f"Zeile {zeile}: Rueckfall enthaelt ein weiteres @supports — fehlt eine Klammer?")

name = datei.relative_to(WURZEL) if datei.is_relative_to(WURZEL) else datei
if befunde:
    print(f"Glas-Rueckfall-Wache: {len(befunde)} Befund(e) in {name}")
    for b in befunde:
        print(f"  {b}")
    sys.exit(1)
print(f"Glas-Rueckfall-Wache: {name} sauber.")
