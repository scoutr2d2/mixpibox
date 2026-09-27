#!/usr/bin/env python3
"""NEWDESIGN-KOPIEREN — der EINE Kopierschritt der neuen Oberflaeche.

══ WARUM ES DAS GIBT (E118/1b, 05.09.2026) ═════════════════════════════════

Bis heute kam NewDesign/ als Angular-Asset auf die Box: eine Kopierregel in
`src/frontend-box/angular.json` nahm es beim Bau der ALTEN Oberflaeche mit
nach `www/neu/`. Damit hing die Auslieferung der neuen Oberflaeche am Bau
der alten — genau der, die geloescht werden soll (E118: eine Oberflaeche,
keine Doppelwartung). Wer die alte App entfernt haette, haette der neuen
still den Ausrollweg genommen.

Seit E118/1b kopiert dieses Werkzeug. ZWEI Wege rufen es:

    src/deploy.sh          der Zip-Weg  (bin/nodejs/deploy.zip)
    tools/ausliefern.py    der Direkt-Weg zur Box

Beide holen die Ausschlussliste HIER. Vorher stand sie in angular.json, und
die Wache `tools/newdesign-mitlieferung-deckung.py` las sie dort; jetzt
liest sie AUSSEN_VOR aus dieser Datei (per importlib, nicht per Textsuche)
— eine Liste, zwei Rufer, eine Wache. Wer ein Muster aendert, aendert es
fuer alle drei.

══ WAS DRAUSSEN BLEIBT ═════════════════════════════════════════════════════

Werkstatt, nicht Laufzeit — die Sortenbegruendung steht in der Wache:
Messseiten und die Standalone-Fassung sind zweite Seiten neben der einen
Box-Seite, *.md ist Text fuer Menschen, bilder/quellen/ sind die Vorlagen
der Maskottchen (117 PNG, aus denen tools/maskottchen-bauen.py die
Laufzeit-Bilder erzeugt).

`spotify-anmeldung.html` bleibt DRIN: sie ist seit E118/1a die zweite
LAUFZEIT-Seite (server.ts liefert sie unter /spotify aus).

Aufruf:
    python3 tools/newdesign-kopieren.py ZIEL      # NewDesign/ -> ZIEL, frisch
    python3 tools/newdesign-kopieren.py --liste   # nur die Muster zeigen

Das Ziel wird vorher GELOESCHT (frischer Stand statt Altlasten). Rueckgabe
0 = kopiert und Kernstuecke da; 1 = etwas fehlt oder ging schief.
"""

from __future__ import annotations

import re
import shutil
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
QUELLE = WURZEL / "NewDesign"

# Die EINE Ausschlussliste (glob: `**` laeuft ueber Verzeichnisse, `*` bleibt
# im Namen — dieselbe Deutung wie frueher in angular.json/minimatch).
AUSSEN_VOR = [
    "MixPiBox-standalone.html",
    "wellen-messseite.html",
    "**/*.md",
    "bilder/quellen/**",
    # DIESELBE SORTE WIE `bilder/quellen/**`, nur eine Zeile spaeter gefunden
    # (AUDIT-2026-09-06 Rang 10): `Progressbar/Vorlage/` (2 MB) und
    # `Tastatur/Vorlage/` (5 MB) sind die EINGABE von
    # tools/vorlagen-freistellen.py (dort Z. 148: `BASIS / ordner /
    # "Vorlage"`) — die Laufzeit nimmt nur das freigestellte Ergebnis
    # daneben. 7 MB je SD-Karte fuer Bilder, die auf der Box niemand oeffnet.
    "Progressbar/Vorlage/**",
    "Tastatur/Vorlage/**",
]

# Was nach dem Kopieren DA sein muss — die Kernstuecke der einen Seite. Ein
# Kopierlauf, der still ein leeres Ziel hinterlaesst, faellt sonst erst an
# der Box auf.
KERNSTUECKE = ["index.html", "app.js", "app.css", "spotify-anmeldung.html", "spotify-anmeldung-logik.mjs"]


def muster_regex(muster: str) -> re.Pattern:
    """Glob als Regex ueber den relativen Pfad — dieselbe Deutung wie in der
    Wache (newdesign-mitlieferung-deckung.py), damit beide dasselbe meinen."""
    teile = []
    rest = muster
    while rest:
        if rest.startswith("**/"):
            teile.append("(?:[^/]+/)*")
            rest = rest[3:]
        elif rest.startswith("**"):
            teile.append(".*")
            rest = rest[2:]
        elif rest.startswith("*"):
            teile.append("[^/]*")
            rest = rest[1:]
        elif rest.startswith("?"):
            teile.append("[^/]")
            rest = rest[1:]
        else:
            teile.append(re.escape(rest[0]))
            rest = rest[1:]
    return re.compile("^" + "".join(teile) + "$")


def ausgeschlossen(rel: str, muster: list[re.Pattern]) -> bool:
    return any(m.match(rel) for m in muster)


def kopieren(ziel: Path, quelle: Path = QUELLE) -> list[str]:
    """NewDesign/ frisch nach `ziel` kopieren. Gibt die Liste der relativen
    Pfade zurueck, die KOPIERT wurden (fuer Proben und Protokolle)."""
    muster = [muster_regex(m) for m in AUSSEN_VOR]
    if ziel.exists():
        shutil.rmtree(ziel)
    kopiert: list[str] = []
    for pfad in sorted(quelle.rglob("*")):
        if not pfad.is_file():
            continue
        rel = pfad.relative_to(quelle).as_posix()
        if ausgeschlossen(rel, muster):
            continue
        nach = ziel / rel
        nach.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(pfad, nach)
        kopiert.append(rel)
    return kopiert


def main() -> int:
    if "--liste" in sys.argv:
        for m in AUSSEN_VOR:
            print(m)
        return 0
    if len(sys.argv) != 2:
        print("Aufruf: python3 tools/newdesign-kopieren.py ZIEL  (oder --liste)")
        return 1
    if not QUELLE.is_dir():
        print(f"FEHLER: {QUELLE} fehlt.")
        return 1
    ziel = Path(sys.argv[1]).resolve()
    # Ein Ziel INNERHALB der Quelle kopierte sich selbst ins Unendliche.
    if ziel == QUELLE or QUELLE in ziel.parents:
        print(f"FEHLER: Ziel {ziel} liegt in der Quelle.")
        return 1
    kopiert = kopieren(ziel)
    fehlt = [k for k in KERNSTUECKE if not (ziel / k).is_file()]
    if fehlt:
        print(f"FEHLER: nach dem Kopieren fehlen Kernstuecke: {', '.join(fehlt)}")
        return 1
    print(f"NewDesign: {len(kopiert)} Dateien nach {ziel}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
