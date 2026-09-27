#!/usr/bin/env python3
"""Was passiert mit den vier Ecken der Telefonkachel?

══ WOZU ═══════════════════════════════════════════════════════════════════
Behauptung (10.08.2026): „Die Kachel hat keinen Alphakanal — die runden Ecken
sind weisses Pixel, kein Loch." Daraus wurde gefolgert, das schlage bei 16,
32 und 48 px als vier weisse Ecken durch.

Dieses Werkzeug misst dreierlei, statt zu folgern:

  1. TRAEGT DIE QUELLE WIRKLICH KEIN ALPHA und weisse Ecken?
  2. WOHIN GEHT SIE UEBERHAUPT? Nur nach mixpi-kachel.png (180 px,
     apple-touch-icon) — 16/32/48 kommen aus favicon.svg. Das prueft es,
     indem es die drei Reitersymbole selbst auf weisse Ecken absucht.
  3. UEBERLEBT DAS WEISS DIE MASKE, die ein Telefon ueber jedes
     Startbildschirm-Symbol legt? iOS schneidet apple-touch-icon zu einer
     Superellipse. Gerechnet wird mit BEIDEN gaengigen Naeherungen:
       * Superellipse n=5 ueber die volle Kantenlaenge
       * Rechteck mit runden Ecken, Radius 22,37 % der Kante (Apple-Raster)
     Sie treffen sich auf der Diagonale bei ~110,7 von 90 — deshalb ist das
     Ergebnis nicht von der Wahl der Naeherung abhaengig.

══ AUFRUF ═════════════════════════════════════════════════════════════════
    python3 tools/kachel-ecken.py
"""
import pathlib
import sys

from PIL import Image

WURZEL = pathlib.Path(__file__).resolve().parent.parent
QUELLE = WURZEL / 'NewDesign/bilder/quellen/Meshy_AI_mixpi-favicon.png'
KACHEL = WURZEL / 'NewDesign/bilder/mixpi-kachel.png'
REITER = [WURZEL / f'NewDesign/bilder/favicon-{g}.png' for g in (16, 32, 48)]

# „Nahezu weiss" — dieselbe Schwelle, mit der die Behauptung gemessen wurde.
WEISS = 245


def hell(px):
    return all(k >= WEISS for k in px[:3])


def alpha_frei(px):
    """Deckt das Pixel? Bei RGB gibt es kein Alpha, also immer ja."""
    return len(px) < 4 or px[3] > 8


# ── 1. DIE QUELLE ─────────────────────────────────────────────────────────
def quelle_messen():
    b = Image.open(QUELLE)
    print(f'QUELLE {QUELLE.name}')
    print(f'  Modus {b.mode}   Groesse {b.size}')
    print(f'  transparency-Angabe: {"ja" if "transparency" in b.info else "nein"}')
    p = b.convert('RGBA')
    w, h = p.size
    for x, y in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        print(f'  Eckpixel ({x},{y}) = {p.getpixel((x, y))}')
    return p


# ── 2. DER RADIUS DER LILA KACHEL ─────────────────────────────────────────
def radius_messen(p):
    """Wie weit reicht das Weiss auf der Diagonale hinein?

    Es laeuft von (0,0) schraeg nach innen und sucht das erste Pixel, das
    nicht mehr nahezu weiss ist. Das ist der Punkt, an dem die lila Flaeche
    beginnt — auf allen vier Diagonalen gemessen und gemittelt.
    """
    w, h = p.size
    ecken = ((0, 0, 1, 1), (w - 1, 0, -1, 1), (0, h - 1, 1, -1), (w - 1, h - 1, -1, -1))
    wege = []
    for x0, y0, dx, dy in ecken:
        i = 0
        while i < w // 2 and hell(p.getpixel((x0 + dx * i, y0 + dy * i))):
            i += 1
        wege.append(i)
    return wege


# ── 3. DIE TELEFONMASKE ───────────────────────────────────────────────────
def in_superellipse(x, y, seite, n=5.0):
    a = seite / 2.0
    u, v = (x + 0.5 - a) / a, (y + 0.5 - a) / a
    return abs(u) ** n + abs(v) ** n <= 1.0


def in_rundrechteck(x, y, seite, anteil=0.2237):
    r = seite * anteil
    px, py = x + 0.5, y + 0.5
    cx = min(max(px, r), seite - r)
    cy = min(max(py, r), seite - r)
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r


def in_eckzwickel(x, y, seite, r_anteil):
    """Liegt das Pixel im Eckzwickel der Kachel — also AUSSERHALB ihrer
    eigenen runden Ecke? Nur dort steht ueberhaupt das strittige Weiss;
    das helle Gesicht der Figur in der Mitte ist ebenfalls „nahezu weiss"
    und wuerde jede Zaehlung ueber das ganze Bild unbrauchbar machen."""
    r = seite * r_anteil
    px, py = x + 0.5, y + 0.5
    cx = min(max(px, r), seite - r)
    cy = min(max(py, r), seite - r)
    return (px - cx) ** 2 + (py - cy) ** 2 > r * r


def maske_pruefen(r_anteil):
    k = Image.open(KACHEL).convert('RGBA')
    seite = k.size[0]
    print(f'\nERGEBNIS {KACHEL.name}  Modus {Image.open(KACHEL).mode}  {k.size}')
    zwickel = zwickel_weiss = 0
    ueberlebt_se = ueberlebt_rr = 0
    ausserhalb_se = 0
    for y in range(seite):
        for x in range(seite):
            if not in_superellipse(x, y, seite):
                ausserhalb_se += 1
            if not in_eckzwickel(x, y, seite, r_anteil):
                continue
            zwickel += 1
            if not hell(k.getpixel((x, y))):
                continue
            zwickel_weiss += 1
            if in_superellipse(x, y, seite):
                ueberlebt_se += 1
            if in_rundrechteck(x, y, seite):
                ueberlebt_rr += 1
    print(f'  eigener Eckradius der Kachel: {100.0 * r_anteil:.1f} % der Kante '
          f'= {seite * r_anteil:.1f} px')
    print(f'  Pixel im Eckzwickel: {zwickel}, davon nahezu weiss: {zwickel_weiss}')
    print(f'  Die Telefonmaske entfernt ueberhaupt {ausserhalb_se} Pixel '
          f'({100.0 * ausserhalb_se / (seite * seite):.2f} % der Kachel).')
    print(f'  WEISSE ZWICKELPIXEL, DIE DIE MASKE UEBERLEBEN:')
    print(f'    Superellipse n=5:            {ueberlebt_se}')
    print(f'    Rundrechteck r=22,37 %:      {ueberlebt_rr}')
    return zwickel_weiss, ueberlebt_se, ueberlebt_rr


# ── 4. DIE REITERSYMBOLE — kommen sie ueberhaupt von hier? ────────────────
def reiter_pruefen():
    print('\nREITERSYMBOLE (laut favicon-bauen.py aus favicon.svg, NICHT aus der Kachel)')
    for weg in REITER:
        b = Image.open(weg)
        p = b.convert('RGBA')
        w, h = p.size
        weisse = sum(1 for y in range(h) for x in range(w)
                     if alpha_frei(p.getpixel((x, y))) and hell(p.getpixel((x, y))))
        durchsichtig = sum(1 for y in range(h) for x in range(w)
                           if p.getpixel((x, y))[3] < 8)
        ecken = [p.getpixel(t) for t in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1))]
        print(f'  {weg.name:16} Modus {b.mode:5} {w}x{h}  '
              f'deckend-weisse Pixel {weisse}   voellig durchsichtige {durchsichtig}')
        print(f'                   Eckpixel {ecken}')


if __name__ == '__main__':
    p = quelle_messen()
    wege = radius_messen(p)
    # Auf der Diagonale ist die runde Ecke weiss, solange t < r*(1-1/sqrt(2))
    # = 0,2929*r. Aus der gemessenen Weglaenge folgt also der Radius.
    schnitt = sum(wege) / len(wege)
    r_anteil = (schnitt / 0.29289) / p.size[0]
    print(f'  Weiss auf der Diagonale (Schritte ab Ecke): {wege}')
    print(f'  -> eigener Eckradius der Quelle: {schnitt / 0.29289:.0f} px '
          f'von {p.size[0]} = {100.0 * r_anteil:.1f} % der Kante')
    print(f'  -> die Telefonmaske schneidet mit rund 22,4 % — sie greift also '
          f'{"TIEFER" if r_anteil < 0.2237 else "weniger tief"} als die Kachel selbst.')
    maske_pruefen(r_anteil)
    reiter_pruefen()
    sys.exit(0)
