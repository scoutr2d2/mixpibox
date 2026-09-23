#!/usr/bin/env python3
"""Wirkt `kante` in bild_setzen() noch — an jedem der sieben Aufrufe?

Ruft das ECHTE `bild_setzen` aus controller/sdstart.py (nichts nachgebaut) fuer
jeden Seitennamen auf, der im Programm vorkommt, und liest die Leinwandmasse
zurueck. Dann die GEGENPROBE: derselbe Aufruf mit einer absichtlich anderen
Kante. Aendert sich die Leinwand dabei nicht, ist `kante` an dieser Stelle tot.

Braucht keinen Schirm: laeuft unter Xvfb.
    xvfb-run -a python3 tools/bild-passt-in-leinwand-probe.py
"""
import os
import re
import sys

HIER = os.path.dirname(os.path.abspath(__file__))
WURZEL = os.path.dirname(HIER)
QUELLE = os.path.join(WURZEL, 'controller', 'sdstart.py')
sys.path.insert(0, os.path.join(WURZEL, 'controller'))

import tkinter as tk                                    # noqa: E402
import sdstart                                          # noqa: E402


def aufrufe_lesen():
    """Die echten Aufrufstellen aus der Datei ziehen — nicht abgetippt."""
    muster = re.compile(r"bild_setzen\(\s*self\.mitte\s*,\s*'([a-z]+)'\s*,\s*(\d+)\s*\)")
    gefunden = []
    with open(QUELLE, encoding='utf-8') as f:
        for nr, zeile in enumerate(f, 1):
            m = muster.search(zeile)
            if m:
                gefunden.append((nr, m.group(1), int(m.group(2))))
    return gefunden


def main():
    wurzel = tk.Tk()
    wurzel.withdraw()

    aufrufe = aufrufe_lesen()
    print(f'{len(aufrufe)} Aufrufe in {QUELLE}\n')
    print(f'{"Zeile":>6}  {"Name":<11} {"Datei":<10} {"kante":>6}  '
          f'{"Leinwand":<10} {"Gegenprobe":<10}  Urteil')
    print('-' * 78)

    tot = 0
    for nr, name, kante in aufrufe:
        weg = sdstart.seitenbild(name)
        cv = sdstart.bild_setzen(wurzel, name, kante)
        gemessen = (int(cv['width']), int(cv['height']))
        # GEGENPROBE: dieselbe Stelle mit deutlich anderer Kante.
        andere = kante + 137
        cv2 = sdstart.bild_setzen(wurzel, name, andere)
        gegen = (int(cv2['width']), int(cv2['height']))
        wirkt = gemessen != gegen
        if not wirkt:
            tot += 1
        print(f'{nr:>6}  {name:<11} {"da" if weg else "FEHLT":<10} {kante:>6}  '
              f'{gemessen[0]}x{gemessen[1]:<6} {gegen[0]}x{gegen[1]:<6}  '
              f'{"wirkt" if wirkt else "WIRKUNGSLOS"}')

    print('-' * 78)
    print(f'{tot} von {len(aufrufe)} Aufrufen ignorieren `kante` vollstaendig.')

    # Und der Rueckfall: gibt es GAR KEIN Bild, muss `kante` wieder greifen.
    print('\nRueckfall (Name ohne Bilddatei):')
    for k in (200, 337):
        cv = sdstart.bild_setzen(wurzel, 'gibtesnicht', k)
        print(f'  kante={k:<4} Leinwand {int(cv["width"])}x{int(cv["height"])}')


if __name__ == '__main__':
    main()
