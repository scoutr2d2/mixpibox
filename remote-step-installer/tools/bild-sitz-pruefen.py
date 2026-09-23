#!/usr/bin/env python3
"""Sitzt das Seitenbild buendig in seiner Leinwand?

`bild_setzen()` in controller/sdstart.py baut die Leinwand genau so gross wie
das Bild und setzt es mit `create_image(b/2, h/2, ...)` — Anker MITTE.

Tk rechnet die obere linke Ecke in tkCanvImg.c/ComputeImageBbox so:
    y = (int)(mitte + 0.5)          # KAUFMAENNISCH gerundet, in double
    y -= hoehe / 2                  # GANZZAHLIG geteilt, in int
Bei ungerader Hoehe gehen die beiden Rechnungen auseinander: aus 117 wird
round(58.5) = 59 minus 117/2 = 58, also y = 1. Das Bild rutscht eine Zeile nach
unten, die unterste Bildzeile faellt aus der Leinwand, oben bleibt eine leere.

Dieses Werkzeug fragt Tk selbst nach dem Kasten (`canvas.bbox`) — das ist
dieselbe Rechnung, die auch das Malen benutzt. Kein Bildschirmfoto noetig.

    xvfb-run -a python3 tools/bild-sitz-pruefen.py
"""
import glob
import os
import struct
import sys
import tkinter as tk

HIER = os.path.dirname(os.path.abspath(__file__))
DATEIEN = os.path.join(os.path.dirname(HIER), 'dateien')


def masse(weg):
    with open(weg, 'rb') as f:
        kopf = f.read(24)
    return struct.unpack('>II', kopf[16:24])


def main():
    wurzel = tk.Tk()
    wurzel.withdraw()
    schief = 0
    print(f'{"Bild":<28}{"BxH":>10}{"Kasten y":>12}{"Urteil":>28}')
    for weg in sorted(glob.glob(os.path.join(DATEIEN, 'sdstart-*.png'))):
        b, h = masse(weg)
        bild = tk.PhotoImage(file=weg)
        cv = tk.Canvas(wurzel, width=b, height=h, highlightthickness=0)
        stueck = cv.create_image(b / 2, h / 2, image=bild)
        x0, y0, x1, y1 = cv.bbox(stueck)
        # bbox liefert einen Rand von 1 px mit; der Anfang zaehlt.
        oben = y0
        links = x0
        urteil = 'sitzt'
        if oben != 0 or links != 0:
            urteil = f'VERSCHOBEN um {links},{oben}'
            schief += 1
        print(f'{os.path.basename(weg):<28}{f"{b}x{h}":>10}{f"{y0}..{y1}":>12}{urteil:>28}')
        cv.destroy()
        del bild
    print()
    print(f'{schief} von den geprueften Bildern sitzen nicht buendig.')
    return 1 if schief else 0


if __name__ == '__main__':
    sys.exit(main())
