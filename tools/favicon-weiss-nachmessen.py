#!/usr/bin/env python3
"""Ist das Weiss der Leinwand wirklich das Weiss des Gesichts? — nachmessen.

WOZU: Zur Kachel NewDesign/bilder/quellen/Meshy_AI_mixpi-favicon.png steht die
Behauptung im Raum, ihr Leinwandweiss und ihr Gesichtsweiss laegen so dicht
beieinander, dass ein „Weiss zu Alpha" die Figur durchloechert. Als Beleg sind
ZWEI EINZELPIXEL genannt: Ecke (2,2) und Gesicht (512,700). Zwei Pixel sind
kein Beleg fuer eine Flaeche — deshalb hier vier Gegenproben.

WAS GEMESSEN WIRD
  1. Die zwei genannten Pixel im Original nachgeschlagen (stimmt der Beleg?)
     und dazu die Umgebung, damit ein Ausreisser auffiele.
  2. Steht (512,696)/(512,700) ueberhaupt IM Gesicht? Belegt ueber die Farbe
     ringsum: Gesicht heisst weiss, umschlossen von dunkler Kontur, auf
     lila Kachelgrund.
  3. Haengt das Gesichtsweiss mit dem Leinwandweiss ZUSAMMEN? Eine Flut vom
     Bildrand her mit der Toleranz aus bilder-freistellen.py sagt das. Nur
     wenn es zusammenhaengt, trifft ein naives „Weiss zu Alpha" es direkt.
  4. Der ECHTE Weg im Baum: tools/bilder-freistellen.py auf die Kachel
     loslassen und danach zaehlen, wie viele Pixel im Gesicht durchsichtig
     geworden sind. Das ist der einzige Test, der ueber die Behauptung
     entscheidet — alles davor ist Vorarbeit.

AUFRUF
    python3 tools/favicon-weiss-nachmessen.py
"""
import pathlib
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

WURZEL = pathlib.Path(__file__).resolve().parent.parent
KACHEL = WURZEL / 'NewDesign/bilder/quellen/Meshy_AI_mixpi-favicon.png'

# aus tools/bilder-freistellen.py
TOLERANZ = 28
NAH_GENUG = 3.0


def block(px, x, y, r=3):
    """Median eines (2r+1)-Quadrats — ein Ausreisser kippt ihn nicht."""
    w, h = px.shape[1], px.shape[0]
    aus = px[max(0, y - r):min(h, y + r + 1), max(0, x - r):min(w, x + r + 1)]
    return tuple(int(v) for v in np.median(aus.reshape(-1, 3), axis=0))


def main():
    roh = Image.open(KACHEL).convert('RGB')
    a = np.asarray(roh).astype(np.int16)
    h, w = a.shape[:2]
    print(f'Kachel {KACHEL.name}  {w}x{h}  Modus {Image.open(KACHEL).mode}')

    print('\n=== 1. Die zwei genannten Pixel nachgeschlagen ===')
    for name, (x, y) in (('Ecke   ', (2, 2)),
                         ('Gesicht', (512, 700)),
                         ('Gesicht', (512, int(h * 0.68)))):
        p = tuple(int(v) for v in a[y, x])
        print(f'  {name} ({x:4d},{y:4d})  Pixel {p}   Median 7x7 {block(a, x, y)}')
    e = a[2, 2].astype(float)
    for y in (700, int(h * 0.68)):
        g = a[y, 512].astype(float)
        print(f'  Abstand Ecke(2,2) <-> Gesicht(512,{y})  {float(np.linalg.norm(e - g)):.1f}')

    print('\n=== 2. Steht der Punkt im Gesicht? Schnitt quer durch ===')
    y = int(h * 0.68)
    for x in range(0, w, 64):
        p = tuple(int(v) for v in a[y, x])
        art = 'lila' if p[2] > p[1] + 40 else ('dunkel' if max(p) < 90 else 'hell')
        print(f'    x={x:4d}  {p}  {art}')

    print('\n=== 3. Haengt Gesichtsweiss mit Leinwandweiss zusammen? ===')
    ecken = np.concatenate([a[:25, :25].reshape(-1, 3), a[:25, -25:].reshape(-1, 3),
                            a[-25:, :25].reshape(-1, 3), a[-25:, -25:].reshape(-1, 3)])
    grund = np.median(ecken, axis=0)
    passt = np.sqrt(((a.astype(np.float32) - grund) ** 2).sum(axis=2)) < TOLERANZ
    print(f'  Grundfarbe aus den Ecken {tuple(int(v) for v in grund)}, Toleranz {TOLERANZ}')
    print(f'  Pixel, die als "Hintergrundfarbe" gelten: {passt.mean():.1%} des Bildes')
    print(f'  Gesichtspunkt (512,{y}) gilt als Hintergrundfarbe: {bool(passt[y, 512])}')

    # Flut vom Rand her (einfach, ueber eine Warteschlange auf Abschnitten)
    marke = np.zeros(passt.shape, dtype=bool)
    stapel = [(0, x) for x in range(w) if passt[0, x]]
    stapel += [(h - 1, x) for x in range(w) if passt[h - 1, x]]
    stapel += [(yy, 0) for yy in range(h) if passt[yy, 0]]
    stapel += [(yy, w - 1) for yy in range(h) if passt[yy, w - 1]]
    while stapel:
        yy, xx = stapel.pop()
        if marke[yy, xx] or not passt[yy, xx]:
            continue
        li = xx
        while li > 0 and passt[yy, li - 1] and not marke[yy, li - 1]:
            li -= 1
        re = xx
        while re < w - 1 and passt[yy, re + 1] and not marke[yy, re + 1]:
            re += 1
        marke[yy, li:re + 1] = True
        for ny in (yy - 1, yy + 1):
            if not (0 <= ny < h):
                continue
            z = passt[ny, li:re + 1] & ~marke[ny, li:re + 1]
            st = np.flatnonzero(z)
            if st.size == 0:
                continue
            br = np.flatnonzero(np.diff(st) > 1)
            for s in np.concatenate(([st[0]], st[br + 1])):
                stapel.append((ny, li + int(s)))
    print(f'  Vom Rand geflutet: {marke.mean():.1%} des Bildes')
    print(f'  Gesichtspunkt vom Rand erreichbar: {bool(marke[y, 512])}'
          '   <- False heisst: die lila Kachel schuetzt das Gesicht')

    # eingeschlossene Taschen: passt, aber nicht vom Rand erreicht
    grau = np.asarray(roh.convert('L')).astype(np.float32)
    grund_wert = float(np.median(grau[marke])) if marke.any() else float(grund.mean())
    innen = passt & ~marke
    print(f'  Eingeschlossen (passt, aber nicht vom Rand): {innen.mean():.1%}')
    if innen.any():
        m = float(np.median(grau[innen]))
        print(f'  Median dieser eingeschlossenen Flaeche {m:.1f}, '
              f'Grund draussen {grund_wert:.1f}, Abstand {abs(m - grund_wert):.1f}'
              f'   NAH_GENUG={NAH_GENUG} -> '
              f'{"WIRD MIT GETILGT" if abs(m - grund_wert) <= NAH_GENUG else "bleibt stehen"}')

    print('\n=== 4. Der echte Weg: tools/bilder-freistellen.py auf die Kachel ===')
    with tempfile.TemporaryDirectory() as t:
        r = subprocess.run([sys.executable, str(WURZEL / 'tools/bilder-freistellen.py'),
                            str(KACHEL), '--ziel', t, '--groessen', '1024'],
                           capture_output=True, text=True)
        print('  ' + '\n  '.join((r.stdout + r.stderr).strip().splitlines()[-12:]))
        raus = sorted(pathlib.Path(t).rglob('*.png'))
        for f in raus:
            b = Image.open(f).convert('RGBA')
            al = np.asarray(b)[:, :, 3]
            print(f'  {f.name}  {b.size}  durchsichtig {float((al == 0).mean()):.1%}')
            # das Gesicht sitzt bei ~68% Hoehe in der Mitte; nach dem Zuschnitt
            # verschiebt es sich, deshalb wird der ganze Innenbereich gezaehlt
            bh, bw = al.shape
            kern = al[int(bh * .25):int(bh * .90), int(bw * .25):int(bw * .75)]
            print(f'    Loecher im Kern (mittlere 50%x65%): '
                  f'{float((kern == 0).mean()):.1%} durchsichtig')
            probe = Image.new('RGB', b.size, (0, 0, 0))
            probe.paste(b, (0, 0), b)
            ziel = WURZEL / 'tools' / f'.weissprobe-{f.stem}.png'
            probe.save(ziel)
            print(f'    Gegenprobe auf Schwarz: {ziel}')


if __name__ == '__main__':
    main()
