#!/usr/bin/env python3
"""Misst, ob eine Kachel echte Loecher (Alpha) oder weisse Pixel in den Ecken hat.

Aufruf:
    python3 tools/kachel-ecken-messen.py [BILD ...]

Ohne Argument wird NewDesign/bilder/quellen/Meshy_AI_mixpi-favicon.png gemessen.

Gibt aus:
  * PIL-Modus, Groesse, ob eine transparency-Angabe im info-Wörterbuch steht
  * die vier Eckpixel
  * die Zahl nahezu weisser Pixel in den vier Zwickeln (mehrere Schwellen)
  * dieselbe Zahl fuer das ganze Bild (damit man sieht, ob "weiss" nur in
    den Ecken vorkommt oder auch mitten in der Figur)
  * die Zahlen nach dem Herunterrechnen auf 16/32/48 Pixel
"""

import sys
from pathlib import Path

from PIL import Image

WURZEL = Path(__file__).resolve().parent.parent
STANDARD = WURZEL / "NewDesign/bilder/quellen/Meshy_AI_mixpi-favicon.png"
ZWICKEL = 200
SCHWELLEN = (250, 245, 240, 230)


def nahezu_weiss(bild, schwelle):
    """Menge der Koordinaten, deren R,G,B alle >= schwelle sind."""
    treffer = set()
    b = bild.convert("RGB")
    breite, hoehe = b.size
    px = b.load()
    for y in range(hoehe):
        for x in range(breite):
            r, g, bl = px[x, y]
            if r >= schwelle and g >= schwelle and bl >= schwelle:
                treffer.add((x, y))
    return treffer


def in_zwickeln(treffer, breite, hoehe, kante):
    """Nur die Treffer in den vier Quadraten der Groesse kante x kante."""
    zaehler = 0
    for x, y in treffer:
        links = x < kante
        rechts = x >= breite - kante
        oben = y < kante
        unten = y >= hoehe - kante
        if (links or rechts) and (oben or unten):
            zaehler += 1
    return zaehler


def messen(pfad):
    bild = Image.open(pfad)
    breite, hoehe = bild.size
    gesamt = breite * hoehe
    print(f"=== {pfad}")
    print(f"  Modus: {bild.mode}   Groesse: {breite}x{hoehe}")
    print(f"  info-Schluessel: {sorted(bild.info.keys())}")
    print(f"  'transparency' im info: {'transparency' in bild.info}")
    hat_alpha = bild.mode in ("RGBA", "LA", "PA") or "transparency" in bild.info
    print(f"  Alphakanal vorhanden: {hat_alpha}")
    if bild.mode in ("RGBA", "LA"):
        alpha = bild.getchannel("A")
        werte = alpha.getextrema()
        print(f"  Alpha-Spanne: {werte}")
        durchsichtig = sum(1 for a in alpha.getdata() if a < 255)
        print(f"  Pixel mit Alpha < 255: {durchsichtig} ({durchsichtig/gesamt:.2%})")

    rgb = bild.convert("RGB")
    px = rgb.load()
    print(f"  Eckpixel (0,0)={px[0,0]}  ({breite-1},0)={px[breite-1,0]}  "
          f"(0,{hoehe-1})={px[0,hoehe-1]}  ({breite-1},{hoehe-1})={px[breite-1,hoehe-1]}")

    for schwelle in SCHWELLEN:
        treffer = nahezu_weiss(rgb, schwelle)
        zwickel = in_zwickeln(treffer, breite, hoehe, ZWICKEL)
        print(f"  Schwelle >={schwelle}: ganzes Bild {len(treffer)} "
              f"({len(treffer)/gesamt:.2%}) | in den vier {ZWICKEL}x{ZWICKEL}-Zwickeln "
              f"{zwickel} ({zwickel/gesamt:.2%} der Kachel, "
              f"{zwickel/(4*ZWICKEL*ZWICKEL):.1%} der Zwickelflaeche)")

    # Entscheidend: sitzt das Weiss NUR in den Ecken, oder ist es ein
    # umlaufender weisser Rahmen? Kantenmitten und Randstreifen nachsehen.
    print(f"  Kantenmitten: oben {px[breite//2,0]}  unten {px[breite//2,hoehe-1]}  "
          f"links {px[0,hoehe//2]}  rechts {px[breite-1,hoehe//2]}")
    streifen = 8
    ausserhalb = sum(
        1
        for y in range(hoehe)
        for x in range(breite)
        if (x < streifen or x >= breite - streifen
            or y < streifen or y >= hoehe - streifen)
        and not ((x < ZWICKEL or x >= breite - ZWICKEL)
                 and (y < ZWICKEL or y >= hoehe - ZWICKEL))
        and all(v >= 247 for v in px[x, y])
    )
    print(f"  nahezu weiss im {streifen}px-Randstreifen AUSSERHALB der vier "
          f"Zwickel: {ausserhalb}  (0 = die Kachel laeuft an den Kantenmitten "
          f"bis an den Rand, das Weiss sind wirklich nur die vier Ecken)")

    for kante in (16, 32, 48):
        klein = rgb.resize((kante, kante), Image.LANCZOS)
        kpx = klein.load()
        for schwelle in (250, 240):
            zaehler = sum(
                1
                for y in range(kante)
                for x in range(kante)
                if all(k >= schwelle for k in kpx[x, y])
            )
            print(f"  herunter auf {kante}x{kante} (Schwelle >={schwelle}): "
                  f"{zaehler} von {kante*kante} Pixeln nahezu weiss")
    print()


def main():
    ziele = [Path(a) for a in sys.argv[1:]] or [STANDARD]
    for ziel in ziele:
        if not ziel.is_absolute():
            ziel = WURZEL / ziel
        messen(ziel)


if __name__ == "__main__":
    main()
