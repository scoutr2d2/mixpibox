#!/usr/bin/env python3
"""Wo sitzt ein Canvas-Bild wirklich? — Nachmessen statt vermuten.

HINTERGRUND
-----------
controller/sdstart.py:346 haengt jedes Seitenbild so auf:

    cv = tk.Canvas(eltern, width=b, height=h, ...)
    cv.create_image(b / 2, h / 2, image=bild)      # anchor=center (Vorgabe)

Die Behauptung: bei UNGERADER Bildhoehe rutscht das Bild eine Zeile nach
unten, und die unterste Bildzeile faellt aus der Leinwand.

WIE HIER GEMESSEN WIRD
----------------------
NICHT ueber ein Bildschirmfoto. `cv.bbox(id)` fragt Tk selbst, wohin es das
Bild gerechnet hat — das ist genau die Ausgabe von ComputeImageBbox() in
tkCanvImg.c, also generischer Tk-Code, der auf X11, Windows und macOS
derselbe ist. Ein Fenstermanager, Xvfb oder ein Bildschirmfoto kommen dabei
nicht vor und koennen das Ergebnis also auch nicht faerben.

Zusaetzlich wird die reine Rechnung nachgebaut (`erwartet_c`), damit man sieht,
ob Tk sich so verhaelt wie der C-Code es beschreibt.

AUFRUF
------
    python3 tools/canvas-bildsitz.py                  # alle sdstart-*.png
    python3 tools/canvas-bildsitz.py --kunst          # dazu Kunstbilder 1..24
    python3 tools/canvas-bildsitz.py DATEI [DATEI...]

Braucht einen Schirm; ohne einen:  xvfb-run -a python3 tools/canvas-bildsitz.py
"""
import argparse
import pathlib
import sys
import tkinter as tk

HIER = pathlib.Path(__file__).resolve().parent
DATEIEN = HIER.parent / 'dateien'


def erwartet_c(mitte: float, groesse: int) -> int:
    """Was tkCanvImg.c ComputeImageBbox() rechnet — nachgebaut.

        x = (int) (imgPtr->x + ((imgPtr->x >= 0) ? 0.5 : -0.5));   // runden
        ...
        case TK_ANCHOR_CENTER:  x -= width/2;                      // C-Ganzzahl!

    Erst wird die MITTE auf eine ganze Zahl gerundet, dann die halbe Groesse
    GANZZAHLIG abgezogen. Bei gerader Groesse heben sich beide auf, bei
    ungerader nicht.
    """
    m = int(mitte + (0.5 if mitte >= 0 else -0.5))
    return m - groesse // 2


def messen(wurzel: tk.Tk, weg: pathlib.Path) -> dict:
    bild = tk.PhotoImage(master=wurzel, file=str(weg))
    b, h = bild.width(), bild.height()

    # Genau der Aufbau aus sdstart.py bild_setzen()
    cv = tk.Canvas(wurzel, width=b, height=h, highlightthickness=0)
    kennung = cv.create_image(b / 2, h / 2, image=bild)
    cv.pack()
    wurzel.update_idletasks()

    x1, y1, x2, y2 = cv.bbox(kennung)
    cv.destroy()

    return {
        'datei': weg.name,
        'breite': b, 'hoehe': h,
        'oben': y1, 'links': x1,
        'oben_erwartet': erwartet_c(h / 2, h),
        'links_erwartet': erwartet_c(b / 2, b),
        # Wieviele Zeilen des Bildes liegen unterhalb der Leinwandkante?
        # Leinwand ist 0..h-1; das Bild belegt y1 .. y1+h-1.
        'abgeschnitten_unten': max(0, (y1 + h) - h),
        'abgeschnitten_rechts': max(0, (x1 + b) - b),
    }


def hauptsache(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('dateien', nargs='*', type=pathlib.Path)
    p.add_argument('--kunst', action='store_true',
                   help='auch kuenstliche Bilder der Hoehe 1..24 pruefen')
    a = p.parse_args(argv)

    try:
        wurzel = tk.Tk()
    except tk.TclError as e:
        print(f'Kein Schirm: {e}\nMit  xvfb-run -a  starten.', file=sys.stderr)
        return 2
    wurzel.withdraw()

    wege = a.dateien or sorted(DATEIEN.glob('sdstart-*.png'))
    print(f'{"Datei":<26}{"Groesse":>11}{"oben":>6}{"soll":>6}'
          f'{"links":>7}{"soll":>6}   Urteil')
    print('─' * 78)
    schief = 0
    for w in wege:
        try:
            m = messen(wurzel, w)
        except tk.TclError as e:
            print(f'{w.name:<26} nicht lesbar: {e}')
            continue
        gut = m['oben'] == 0 and m['links'] == 0
        if not gut:
            schief += 1
        urteil = 'sitzt' if gut else (
            f"VERSCHOBEN — {m['abgeschnitten_unten']} Zeile(n) unten, "
            f"{m['abgeschnitten_rechts']} Spalte(n) rechts weg")
        stimmt = '' if (m['oben'] == m['oben_erwartet']
                        and m['links'] == m['links_erwartet']) else '  (!= C-Rechnung)'
        print(f"{m['datei']:<26}{m['breite']:>5}x{m['hoehe']:<5}"
              f"{m['oben']:>6}{m['oben_erwartet']:>6}"
              f"{m['links']:>7}{m['links_erwartet']:>6}   {urteil}{stimmt}")

    if a.kunst:
        print()
        print('Kuenstliche Bilder — nur die Hoehe verstellt (Breite 8):')
        for h in range(1, 25):
            bild = tk.PhotoImage(master=wurzel, width=8, height=h)
            cv = tk.Canvas(wurzel, width=8, height=h, highlightthickness=0)
            k = cv.create_image(8 / 2, h / 2, image=bild)
            cv.pack()
            wurzel.update_idletasks()
            y1 = cv.bbox(k)[1]
            cv.destroy()
            print(f'  Hoehe {h:>3} ({"ungerade" if h % 2 else "gerade  "}): '
                  f'oben={y1}  {"verschoben" if y1 else "sitzt"}')

    wurzel.destroy()
    print()
    print(f'{schief} von {len(wege)} Bildern sitzen nicht auf der Leinwand.')
    return 1 if schief else 0


if __name__ == '__main__':
    raise SystemExit(hauptsache())
