#!/usr/bin/env python3
"""Raeumt den Nachlass der geloeschten Angular-Oberflaeche aus www/ — am Geraet.

ANLASS (05.09.2026, erste Auslieferung nach dem E118-Schnitt auf Box .62):
Der Tauscher uebernimmt beim Tausch alles, was im laufenden Baum liegt und im
Paket fehlt — das ist sein Nutzerdaten-Schutz (www/cover ueberlebt so). Auf
einer Bestandsbox uebernimmt er damit aber auch die KOMPLETTE alte
Angular-Oberflaeche zurueck: die Wurzel-index.html, ~330 chunk-*.js, die
styles, theme-data. Die Wurzel-index ist dabei nicht nur Ballast: express
liefert sie VOR dem Catch-all aus, und damit verdeckt sie den Redirect
/ -> /neu/ — die eine Oberflaeche waeren wieder zwei.

Dieses Werkzeug kennt den Nachlass BEIM NAMEN und raeumt NUR ihn. Alles, was
es nicht kennt, bleibt liegen und wird gemeldet — Loeschen nach Positivliste,
nicht nach "alles ausser". neu/ und cover/ fasst es nie an.

RUECKWEG: Der Tausch legt den Vor-Zustand als ….zurueck neben den
Betriebsordner; zusaetzlich laeuft vor jedem Tausch die Nutzerdaten-Sicherung.
Dieses Werkzeug loescht also nichts, was nicht doppelt gesichert waere —
trotzdem: erst ohne --wirklich laufen lassen und die Liste LESEN.

Aufruf am Geraet (hochladen per scp, dann):
    python3 mixpi-angular-nachlass.py [--wurzel PFAD] [--wirklich]
Ohne --wirklich wird nur gezeigt, was fiele (Probe). Exit 0 = gelaufen,
Exit 1 = Wurzel nicht gefunden oder nicht plausibel.
"""

import argparse
import fnmatch
import shutil
import sys
from pathlib import Path

VORGABE_WURZEL = "/home/dietpi/.mupibox/Sonos-Kids-Controller-master/www"

# Was die alte Angular-App an der www-Wurzel hinterlassen hat. NUR das faellt.
NACHLASS_DATEIEN = [
    "index.html",              # verdeckt den Redirect / -> /neu/
    "3rdpartylicenses.txt",
    "prerendered-routes.json",
    "active_theme.css",        # nur die alte index.html band sie ein
]
NACHLASS_MUSTER = [
    "chunk-*.js",
    "main-*.js",
    "polyfills-*.js",
    "styles-*.css",
    "styles-*.css.vor-*",      # Handstaende wie styles-….css.vor-leisten-ton
]
NACHLASS_ORDNER = [
    "browser",
    "assets",                  # SVGs/Icons der alten App; nichts Lebendiges
    "theme-data",              # Verteilung der 29 alten CSS-Themen
]

# Diese beiden sind der Grund, warum hier nicht einfach "rm -rf *" steht.
UNANTASTBAR = {"neu", "cover"}


def main() -> int:
    lauf = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    lauf.add_argument("--wurzel", default=VORGABE_WURZEL)
    lauf.add_argument("--wirklich", action="store_true",
                      help="ohne diesen Schalter wird nur gezeigt, was fiele")
    angaben = lauf.parse_args()

    wurzel = Path(angaben.wurzel)
    if not wurzel.is_dir():
        print(f"X {wurzel} ist kein Ordner — falsches Geraet oder falscher Pfad.")
        return 1
    if not (wurzel / "neu" / "index.html").is_file():
        # Plausibilitaet: Wer hier raeumt, muss die NEUE Oberflaeche schon
        # haben — sonst raeumte er die einzige weg, die es gibt.
        print(f"X {wurzel}/neu/index.html fehlt — hier ist nichts zu raeumen, "
              "erst ausliefern.")
        return 1

    faellt: list[Path] = []
    bleibt_unbekannt: list[str] = []
    for eintrag in sorted(wurzel.iterdir()):
        name = eintrag.name
        if name in UNANTASTBAR:
            continue
        if eintrag.is_dir():
            if name in NACHLASS_ORDNER:
                faellt.append(eintrag)
            else:
                bleibt_unbekannt.append(name + "/")
            continue
        if name in NACHLASS_DATEIEN or any(
                fnmatch.fnmatch(name, m) for m in NACHLASS_MUSTER):
            faellt.append(eintrag)
        else:
            bleibt_unbekannt.append(name)

    if not faellt:
        print("Nichts zu raeumen — die Wurzel ist schon sauber.")
    for eintrag in faellt:
        print(f"  faellt: {eintrag.name}{'/' if eintrag.is_dir() else ''}")
    for name in bleibt_unbekannt:
        print(f"  bleibt (kenne ich nicht, fasse ich nicht an): {name}")
    print(f"Bilanz: {len(faellt)} Eintraege fallen, "
          f"{len(bleibt_unbekannt)} unbekannte bleiben, "
          f"unantastbar: {', '.join(sorted(UNANTASTBAR))}.")

    if not angaben.wirklich:
        print("PROBE — nichts geloescht. Scharf mit --wirklich.")
        return 0

    for eintrag in faellt:
        if eintrag.is_dir():
            shutil.rmtree(eintrag)
        else:
            eintrag.unlink()
    print(f"Geraeumt: {len(faellt)} Eintraege sind weg.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
