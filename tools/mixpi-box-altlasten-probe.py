#!/usr/bin/env python3
"""Zeugen fuer tools/mixpi-box-altlasten.py — ohne Box, ohne SSH.

WOZU: die eine Stelle mit einem URTEIL in diesem Werkzeug ist `falsche_kopie()`
— sie entscheidet, ob eine Datei faellt. Der gefaehrliche Fall (der Player hat
gar keine eigene Kopie mehr, also ist die daneben womoeglich die einzige) laesst
sich an der laufenden Box nicht herstellen, ohne genau den Schaden anzurichten,
gegen den die Pruefung gebaut ist. Also wird die Box nachgestellt.

    python3 tools/mixpi-box-altlasten-probe.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

# Der Dateiname traegt Bindestriche, also geht kein `import`. Laden wie eine
# Datei, nicht wie ein Modul.
import importlib.util

_pfad = Path(__file__).resolve().parent / "mixpi-box-altlasten.py"
_spec = importlib.util.spec_from_file_location("mixpi_box_altlasten", _pfad)
altlasten = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(altlasten)


class Antwort:
    def __init__(self, stdout: str = "", rc: int = 0):
        self.stdout = stdout
        self.stderr = ""
        self.returncode = rc


class BoxAttrappe:
    """Eine Box, die auf `test -f`/`md5sum` nach einer vorgegebenen Dateiliste
    antwortet. Kein SSH, kein Netz."""

    def __init__(self, dateien: dict[str, str]):
        self.dateien = dateien      # Pfad -> Pruefsumme
        self.befehle: list[str] = []

    def lauf(self, befehl: str, frist: int = 30) -> Antwort:
        self.befehle.append(befehl)
        if befehl.startswith("md5sum"):
            aus = []
            for teil in befehl.split()[1:]:
                p = teil.strip("'\"")
                if p in self.dateien:
                    aus.append(f"{self.dateien[p]}  {p}")
            return Antwort("\n".join(aus))
        # Die zusammengesetzte `test -f … && echo X; test -f … && echo Y`-Form
        aus = []
        for stueck in befehl.split(";"):
            stueck = stueck.strip()
            if not stueck.startswith("test -f"):
                continue
            pfad = stueck.split("test -f", 1)[1].split("&&")[0].strip().strip("'\"")
            marke = stueck.split("echo", 1)[1].strip() if "echo" in stueck else ""
            if pfad in self.dateien:
                aus.append(marke)
        return Antwort("\n".join(aus))


APP = altlasten.APPDIR + "/spotify-control.js"
PLAY = altlasten.PLAYERDIR + "/spotify-control.js"

FEHLER = 0


def pruefe(name: str, bedingung: bool, hinweis: str = "") -> None:
    global FEHLER
    if bedingung:
        print(f"  ok    {name}")
    else:
        FEHLER += 1
        print(f"  FEHLT {name}{('  — ' + hinweis) if hinweis else ''}")


print("── falsche_kopie() ──")

# 1. Beide da, verschiedener Inhalt: faellt, und die Begruendung sagt es.
box = BoxAttrappe({APP: "aaa", PLAY: "bbb"})
faellt, warum = altlasten.falsche_kopie(box)
pruefe("beide da, verschieden -> faellt", faellt)
pruefe("… und nennt den Unterschied", "ANDEREM Inhalt" in warum, warum)

# 2. Beide da, gleicher Inhalt: faellt ebenfalls (sie ist trotzdem die Falle),
#    aber der Bericht darf nicht luegen und einen Unterschied behaupten.
box = BoxAttrappe({APP: "aaa", PLAY: "aaa"})
faellt, warum = altlasten.falsche_kopie(box)
pruefe("beide da, gleich -> faellt", faellt)
pruefe("… und behauptet KEINEN Unterschied", "ANDEREM" not in warum, warum)

# 3. DER GEFAEHRLICHE FALL: der Player hat keine eigene Kopie. Dann ist die
#    daneben womoeglich die einzige — sie darf NICHT fallen.
box = BoxAttrappe({APP: "aaa"})
faellt, warum = altlasten.falsche_kopie(box)
pruefe("Player-Kopie fehlt -> faellt NICHT", not faellt,
       "das Werkzeug wuerde der Box ihre einzige Fassung nehmen")
pruefe("… und sagt HALT", "HALT" in warum, warum)
pruefe("… und fasst nichts an (kein md5sum gerufen)",
       not any(b.startswith("md5sum") for b in box.befehle))

# 4. Gar keine Kopie daneben: nichts zu tun, kein Laerm.
box = BoxAttrappe({PLAY: "bbb"})
faellt, warum = altlasten.falsche_kopie(box)
pruefe("nichts daneben -> faellt NICHT", not faellt)
pruefe("… und meldet es ruhig", "nichts zu tun" in warum, warum)

print("\n── Positivliste ──")

# Die Muster duerfen die Rueckwege NICHT fassen. Das ist keine Frage des
# Geschmacks: ein geloeschtes .zurueck nimmt der naechsten Auslieferung ihr Netz.
import fnmatch

RUECKWEGE = ["server.js.zurueck", "www.zurueck", "www-admin.zurueck",
             "herkunft.json.zurueck", "plugin-laufwerk.js.zurueck",
             "spotify-control.js.zurueck"]
alle_muster = [m for musterliste in altlasten.RAEUMBAR.values() for m in musterliste]
for r in RUECKWEGE:
    treffer = [m for m in alle_muster if fnmatch.fnmatch(r, m)]
    pruefe(f"{r} wird von keinem Muster gefasst", not treffer, f"gefasst von {treffer}")

# Und die Gegenrichtung — eine Positivliste, die nichts faengt, ist auch falsch.
SOLL_FALLEN = ["server.js.vor-ausrollen-2026-09-04b", "server.js.vor-rebase-2026-09-04",
               "spotify-control.js.vor-irgendwas", "server.js.alt", "server.js.kaputt"]
for s in SOLL_FALLEN:
    treffer = [m for m in alle_muster if fnmatch.fnmatch(s, m)]
    pruefe(f"{s} wird gefasst", bool(treffer))

# Der Grenzfall, um dessentwillen das Muster einen Bindestrich verlangt.
for harmlos in ["server.js.vorlage", "config.json.vorgemerkt"]:
    treffer = [m for m in alle_muster if fnmatch.fnmatch(harmlos, m)]
    pruefe(f"{harmlos} wird NICHT gefasst", not treffer, f"gefasst von {treffer}")

print()
if FEHLER:
    print(f"{FEHLER} Zeuge(n) schlagen an.")
    sys.exit(1)
print("Alle Zeugen halten.")
