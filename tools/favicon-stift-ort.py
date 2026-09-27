#!/usr/bin/env python3
"""Sitzt der ueberlebende Treffer DA, WO DER STIFT IST? — die Ortsfrage.

══ WOZU ═══════════════════════════════════════════════════════════════════
tools/favicon-vergleich.py meldet fuer die Kachel bei 16 px `stifte 1/6`.
tools/favicon-stift-herkunft.py prueft das mit einem Kasten je Stiftfarbe.
Fuer stahlblau ist dieser Kasten aber 818x777 gross — er umfasst fast die
ganze Kachel, weil die gedaempfte Blaugrau-Farbe ueberall in der Schattierung
vorkommt. Ein Kasten dieser Groesse kann nicht mehr zwischen „im Stift" und
„irgendwo im Bild" unterscheiden, und die Gegenprobe, die ihn uebermalt,
loescht das halbe Bild mit.

Dieses Werkzeug stellt deshalb die Frage, die der Kasten nicht beantwortet:
Der eine Treffer bei 16 px — liegt er auf dem echten Stift, oder woanders?

══ WAS GEMESSEN WIRD ══════════════════════════════════════════════════════
  1. Wo sitzt der echte dritte Stift in der 1024er-Quelle? Gesucht wird er
     NUR im Haarband (dort stehen die anderen fuenf), als groesster
     zusammenhaengender Klumpen naher Punkte — nicht als Kasten.
  2. Der 16er-Gewinner: sein Ort, und WIE VIELE Punkte seines eigenen
     64x64-Quellblocks wirklich nahe an der Stiftfarbe liegen. Null heisst:
     der 16er-Wert ist ein Mischprodukt, kein heruntergerechneter Stift.
  3. Was steht an dem 16er-Punkt, der den ECHTEN Stift ueberdeckt?
  4. Wie nah kommt jede Stiftfarbe den Toenen, die die Kachel von sich aus
     hat — der Abstand zur Schwelle 60 sagt, wie faelschbar sie ist.

AENDERT NICHTS im Baum.

══ AUFRUF ═════════════════════════════════════════════════════════════════
    python3 tools/favicon-stift-ort.py
"""
import math
import pathlib

WURZEL = pathlib.Path(__file__).resolve().parent.parent
KACHEL = WURZEL / 'NewDesign/bilder/quellen/Meshy_AI_mixpi-favicon.png'

STIFTE = (('blau', (0x00, 0xAC, 0xFD)), ('gruen', (0x11, 0xDE, 0x47)),
          ('stahlblau', (0x43, 0x71, 0x9A)), ('gelb', (0xFE, 0xEE, 0x04)),
          ('pink', (0xFD, 0x34, 0xA2)), ('orange', (0xFF, 0x70, 0x01)))
SCHWELLE = 60.0
HAARBAND = (240, 480)   # y-Bereich, in dem die fuenf klaren Stifte liegen


def klumpen(im, soll, ybereich=None):
    """Groesster zusammenhaengender Fleck naher Punkte — Ort und Groesse."""
    px = im.load()
    w, h = im.size
    y0, y1 = ybereich or (0, h)
    nah = [[math.dist(px[x, y], soll) < SCHWELLE for x in range(w)] for y in range(y0, y1)]
    gesehen = [[False] * w for _ in range(y1 - y0)]
    best = (0, None)
    for j in range(y1 - y0):
        for i in range(w):
            if not nah[j][i] or gesehen[j][i]:
                continue
            stapel, teil = [(i, j)], []
            gesehen[j][i] = True
            while stapel:
                a, b = stapel.pop()
                teil.append((a, b))
                for da, db in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    u, v = a + da, b + db
                    if 0 <= u < w and 0 <= v < y1 - y0 and nah[v][u] and not gesehen[v][u]:
                        gesehen[v][u] = True
                        stapel.append((u, v))
            if len(teil) > best[0]:
                xs = [a for a, _ in teil]
                ys = [b + y0 for _, b in teil]
                best = (len(teil), (min(xs), min(ys), max(xs), max(ys),
                                    sum(xs) // len(xs), sum(ys) // len(ys)))
    return best


def block_naehe(im, soll, x, y, seite):
    px = im.load()
    n, bester = 0, 1e9
    for v in range(y, y + seite):
        for u in range(x, x + seite):
            d = math.dist(px[u, v], soll)
            bester = min(bester, d)
            if d < SCHWELLE:
                n += 1
    return n, bester


def main():
    from PIL import Image
    roh = Image.open(KACHEL).convert('RGB')
    w, h = roh.size
    grund = roh.load()[int(w * 0.06), h // 2]
    klein = roh.resize((16, 16), Image.LANCZOS)
    kpx = klein.load()
    seite = w // 16

    print(f'Quelle {KACHEL.relative_to(WURZEL)} {w}x{h}  Kachelgrund {grund}\n')

    print('═══ 1. Der groesste Klumpen je Stiftfarbe IM HAARBAND ' + '═' * 20)
    klumpen_ort = {}
    for name, soll in STIFTE:
        n, k = klumpen(roh, soll, HAARBAND)
        if not n:
            print(f'  {name:10s} kein Klumpen im Haarband')
            continue
        x0, y0, x1, y1, mx, my = k
        klumpen_ort[name] = (mx, my)
        print(f'  {name:10s} {n:6d} px  x {x0:4d}..{x1:4d}  y {y0:4d}..{y1:4d}'
              f'   Mitte ({mx:4d},{my:4d})  → 16er-Punkt ({mx//seite},{my//seite})')

    print('\n═══ 2. Der eine Ueberlebende bei 16 px ' + '═' * 34)
    for name, soll in STIFTE:
        d, x, y = min(((math.dist(kpx[a, b], soll), a, b)
                       for b in range(16) for a in range(16)))
        if d >= SCHWELLE:
            continue
        n, bester = block_naehe(roh, soll, x * seite, y * seite, seite)
        print(f'  {name} trifft mit Abstand {d:.2f} am 16er-Punkt ({x},{y}) = {kpx[x, y]}')
        print(f'    Sein Quellblock x {x*seite}..{x*seite+seite-1} y {y*seite}..{y*seite+seite-1}:')
        print(f'      {n} von {seite*seite} Punkten naeher als {SCHWELLE:.0f}'
              f' — naechster Punkt dort {bester:.2f}')
        if name in klumpen_ort:
            mx, my = klumpen_ort[name]
            sx, sy = mx // seite, my // seite
            ds = math.dist(kpx[sx, sy], soll)
            print(f'    Der ECHTE Stift liegt bei ({mx},{my}) = 16er-Punkt ({sx},{sy}),'
                  f' dort {kpx[sx, sy]} Abstand {ds:.2f}'
                  f' → {"trifft" if ds < SCHWELLE else "VERFEHLT"}')
            print(f'    Gewinner ({x},{y}) und echter Stift ({sx},{sy}): '
                  + ('DERSELBE Punkt' if (x, y) == (sx, sy)
                     else f'{math.dist((x, y), (sx, sy)):.1f} Punkte auseinander'))

    print('\n═══ 3. Faelschbarkeit: Abstand zu Toenen, die die Kachel selbst hat ' + '═' * 5)
    toene = [(f'Grund*{t:.2f}', tuple(round(k * t) for k in grund))
             for t in (0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0)]
    toene += [(f'Grund+Weiss {t:.0%}', tuple(round(k + (255 - k) * t) for k in grund))
              for t in (0.2, 0.4, 0.6, 0.8)]
    for name, soll in STIFTE:
        d, wie = min((math.dist(t, soll), n) for n, t in toene)
        print(f'  {name:10s} naechster reiner Kachelton {d:6.1f} ({wie})'
              f'  → {d - SCHWELLE:+6.1f} zur Schwelle')


if __name__ == '__main__':
    main()
