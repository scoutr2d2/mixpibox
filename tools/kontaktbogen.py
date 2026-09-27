#!/usr/bin/env python3
"""Viele Bilder auf EINEM Blatt, nummeriert — zum Beurteilen statt Einzelaufrufen.

WOZU: Als 26 Maskottchen-Bilder zu sichten waren, hiess die Alternative: 26 Mal
einzeln oeffnen. Das kostet nicht nur Zeit, es macht das Vergleichen unmoeglich -
und genau darum geht es beim Sichten. Erst nebeneinander sieht man, dass zwei
Bilder dasselbe zeigen.

ZWEI GRUENDE FUER DEN DUNKLEN GRUND (Vorgabe): Freigestellte Bilder werden auf
Weiss beurteilt und sehen dort immer gut aus - ein stehengebliebener heller Saum
faellt erst auf dunklem Grund auf. Und die Box selbst traegt ueberwiegend dunkle
Themen; so sieht man sie, wie das Kind sie sieht.

WAS ES NICHT TUT
    * Es aendert die Bilder nicht. Es legt ein Blatt daneben.
    * Es beurteilt nicht. Es ordnet nur an, damit jemand beurteilen kann.

AUFRUF
    tools/kontaktbogen.py NewDesign/bilder/ --ziel /tmp/bogen.png
    tools/kontaktbogen.py ordner/ --ziel /tmp/bogen.png --spalten 6 --kachel 200
    tools/kontaktbogen.py ordner/ --ziel /tmp/bogen.png --grund hell
"""

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit("Es fehlt: python3 -m pip install pillow")

GRUENDE = {"dunkel": (24, 24, 32), "hell": (245, 245, 245), "karo": None}


def karogrund(groesse: tuple, feld: int = 16) -> Image.Image:
    """Schachbrett - zeigt Transparenz UND Saum zugleich."""
    b, h = groesse
    bild = Image.new("RGB", groesse, (255, 255, 255))
    z = ImageDraw.Draw(bild)
    for y in range(0, h, feld):
        for x in range(0, b, feld):
            if (x // feld + y // feld) % 2:
                z.rectangle([x, y, x + feld, y + feld], fill=(214, 214, 214))
    return bild


def schrift(groesse: int):
    for name in ("DejaVuSans.ttf", "LiberationSans-Regular.ttf", "Arial.ttf"):
        try:
            return ImageFont.truetype(name, groesse)
        except OSError:
            continue
    return ImageFont.load_default()


def main() -> int:
    p = argparse.ArgumentParser(description="Kontaktbogen aus vielen Bildern (aendert nichts)")
    p.add_argument("pfad", type=Path)
    p.add_argument("--ziel", type=Path, required=True)
    p.add_argument("--spalten", type=int, default=6)
    p.add_argument("--kachel", type=int, default=200)
    p.add_argument("--grund", choices=list(GRUENDE), default="dunkel")
    a = p.parse_args()

    dateien = sorted(f for f in a.pfad.iterdir() if f.suffix.lower() in (".png", ".webp", ".jpg", ".jpeg")) \
        if a.pfad.is_dir() else [a.pfad]
    if not dateien:
        print("Keine Bilder gefunden.", file=sys.stderr)
        return 1

    k = a.kachel
    beschriftung = 22
    zellhoehe = k + beschriftung
    spalten = a.spalten
    zeilen = (len(dateien) + spalten - 1) // spalten
    masse = (spalten * k, zeilen * zellhoehe)

    blatt = karogrund(masse) if a.grund == "karo" else Image.new("RGB", masse, GRUENDE[a.grund])
    dunkel = a.grund == "dunkel"
    z = ImageDraw.Draw(blatt)
    f = schrift(14)

    for i, datei in enumerate(dateien):
        sp, ze = i % spalten, i // spalten
        x, y = sp * k, ze * zellhoehe
        try:
            bild = Image.open(datei).convert("RGBA")
        except Exception:  # noqa: BLE001
            z.text((x + 6, y + 6), f"{i + 1}: kaputt", fill=(255, 80, 80), font=f)
            continue
        bild.thumbnail((k - 8, k - 8), Image.Resampling.LANCZOS)
        blatt.paste(bild, (x + (k - bild.width) // 2, y + (k - bild.height) // 2), bild)

        # Die NUMMER ist der Zweck des Blattes: ohne sie kann niemand sagen,
        # welches Bild gemeint ist. Sie steht auf einem Balken, damit sie auf
        # jedem Grund lesbar bleibt.
        z.rectangle([x, y + k, x + k, y + zellhoehe], fill=(0, 0, 0) if dunkel else (255, 255, 255))
        z.text((x + 5, y + k + 3), f"{i + 1:>2}  {datei.stem[-22:]}",
               fill=(230, 230, 230) if dunkel else (30, 30, 30), font=f)
        z.rectangle([x, y, x + k - 1, y + zellhoehe - 1], outline=(70, 70, 80) if dunkel else (200, 200, 200))

    a.ziel.parent.mkdir(parents=True, exist_ok=True)
    blatt.save(a.ziel, "PNG", optimize=True)
    print(f"{len(dateien)} Bilder → {a.ziel}  ({masse[0]}x{masse[1]}, {a.ziel.stat().st_size / 1024:.0f} kB)")
    for i, d in enumerate(dateien):
        print(f"  {i + 1:>2}  {d.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
