#!/usr/bin/env python3
"""Aus den Vorlagen die benannten Maskottchen-Bilder erzeugen.

WOZU: Die Zuordnung "welche Vorlage wird welcher Zustand" ist eine
ENTSCHEIDUNG und steht deshalb in NewDesign/maskottchen.json. Die Bilder daraus
von Hand zu schneiden hiesse, diese Entscheidung ein zweites Mal zu treffen -
und beim naechsten Nachliefern einer Vorlage ein drittes Mal. Hier ist es ein
Befehl.

DIE VORLAGEN LIEGEN AUSSERHALB DES BAUS: `bilder/quellen/` ist in
`src/frontend-box/angular.json` von der Kopie nach `www/neu` ausgenommen. Sonst
landeten 27 MB Vorlagen auf der SD-Karte, obwohl 600 kB gebraucht werden - die
neue Oberflaeche wurde muehsam von 4,1 MB auf 300 kB gebracht.

WAS ES NICHT TUT
    * Es entscheidet nichts. Steht in maskottchen.json keine `quelle`, wird der
      Zustand uebersprungen und gemeldet - nicht geraten.
    * Es ruehrt die Vorlagen nicht an.

AUFRUF
    tools/maskottchen-bauen.py                  # alles erzeugen
    tools/maskottchen-bauen.py --pruefen        # nur sagen, was fehlt
    tools/maskottchen-bauen.py --figuren        # die Sammlung als waehlbare
                                                # Figuren erzeugen
    tools/maskottchen-bauen.py --sammlung       # dasselbe, alter Name

DIE SAMMLUNG HAT SEIT DEM 05.08.2026 EIN ZIEL. Sie lag als `bilder/sammlung/`
daneben, mit dem Vermerk in maskottchen.json: "Vorschlag: das Kind waehlt sein
Begruessungsbild selbst. Bis es diese Auswahl gibt, bleiben sie unerzeugt."
Diese Auswahl gibt es jetzt - das Zeichen oben links in der neuen Oberflaeche.
Sie liest `NewDesign/bilder/figuren/` (`FIGUR_ORDNER` in profile.ts), und
genau dorthin schreibt dieser Lauf. Ein Ordner weniger, und die beiden Enden,
die das Wissenspaket schon benannt hat, haengen zusammen.
ERZEUGT WIRD WEITER NUR AUF ZURUF: wer den Schalter nicht setzt, bekommt
nichts. Welche Vorlage ein Kind sein darf, ist eine Entscheidung des
Betreibers.
"""

import argparse
import importlib.util
import json
import sys
from pathlib import Path

HIER = Path(__file__).resolve().parent
WURZEL = HIER.parent
KARTE = WURZEL / "NewDesign" / "maskottchen.json"


def freisteller():
    """Das Nachbarwerkzeug laden - sein Dateiname enthaelt einen Bindestrich
    und ist deshalb nicht direkt importierbar."""
    pfad = HIER / "bilder-freistellen.py"
    spec = importlib.util.spec_from_file_location("freistellen", pfad)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


def main() -> int:
    p = argparse.ArgumentParser(description="Maskottchen-Bilder aus den Vorlagen erzeugen")
    p.add_argument("--pruefen", action="store_true", help="nichts schreiben, nur berichten")
    p.add_argument(
        "--figuren",
        "--sammlung",
        dest="figuren",
        action="store_true",
        help="die Sammlung als waehlbare Figuren nach bilder/figuren/ erzeugen (sonst uebersprungen)",
    )
    p.add_argument("--karte", type=Path, default=KARTE)
    a = p.parse_args()

    karte = json.loads(a.karte.read_text())
    basis = a.karte.parent
    ziel = basis / karte["ordner"]
    quellen = basis / karte["quellordner"]
    fs = freisteller()

    fehlt, gebaut = [], []
    for name, z in karte["zustaende"].items():
        if not z.get("quelle"):
            fehlt.append((name, z["datei"], z.get("regel", "")))
            continue
        q = quellen / z["quelle"]
        if not q.exists():
            fehlt.append((name, z["datei"], f"Vorlage nicht da: {q.name}"))
            continue
        if a.pruefen:
            gebaut.append((name, z["datei"], z["px"], None))
            continue
        bild, bericht = fs.freistellen(q, fs.TOLERANZ)
        bild = fs.zuschneiden(bild, fs.RAND_ANTEIL)
        px = int(z.get("px", 256))
        bild.resize((px, px), fs.Image.Resampling.LANCZOS).save(ziel / z["datei"], "PNG", optimize=True)
        gebaut.append((name, z["datei"], px, (ziel / z["datei"]).stat().st_size / 1024))

    print(f"{'Zustand':<12} {'Datei':<24} {'px':>5} {'kB':>6}")
    print("─" * 52)
    gesamt = 0.0
    for name, datei, px, kb in gebaut:
        gesamt += kb or 0
        print(f"{name:<12} {datei:<24} {px:>5} {(f'{kb:.0f}' if kb else '—'):>6}")
    if fehlt:
        print(f"\n── Fehlt ({len(fehlt)})")
        for name, datei, grund in fehlt:
            print(f"  {name} ({datei}): {grund or 'keine Vorlage hinterlegt'}")

    if a.figuren and not a.pruefen:
        sam = karte.get("_sammlung", {}).get("kandidaten", [])
        # DAS ZIEL STEHT IN DER KARTE, nicht hier: `figurenordner`. Sonst
        # stuende der Pfad zweimal da - hier und in profile.ts - und liefe
        # beim naechsten Anfassen auseinander.
        ordner = basis / karte.get("figurenordner", "bilder/figuren/")
        ordner.mkdir(parents=True, exist_ok=True)
        gemacht = 0
        for k in sam:
            q = quellen / k["quelle"]
            if not q.exists():
                continue
            bild, _ = fs.freistellen(q, fs.TOLERANZ)
            bild = fs.zuschneiden(bild, fs.RAND_ANTEIL)
            # KLEIN, NUR a-z0-9 UND BINDESTRICH, ENDUNG .png - das ist
            # `FIGUR_MUSTER` aus profile.ts. Was hier durchfaellt, taucht in
            # der Auswahl nicht auf, sondern nur unter `uebergangen` in
            # GET /api/figuren. Deshalb wird hier gesaeubert und nicht
            # gehofft.
            kurz = k["zeigt"].split(" - ")[0].strip().lower()[:28]
            kurz = "".join(c if c.isascii() and (c.isalnum() or c == "-") else "-" for c in kurz)
            kurz = "-".join(t for t in kurz.split("-") if t)
            if not kurz:
                continue
            bild.resize((256, 256), fs.Image.Resampling.LANCZOS).save(ordner / f"mixpi-{kurz}.png", "PNG", optimize=True)
            gemacht += 1
        print(f"\nFiguren: {gemacht} Bilder in {ordner}")

    if gesamt:
        print(f"\nZusammen {gesamt:.0f} kB fuer {len(gebaut)} Zustaende.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
