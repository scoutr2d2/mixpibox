#!/usr/bin/env python3
"""Der eine Stift, den die Kachel bei 16 px behaelt — ist er der Stift?

══ WOZU ═══════════════════════════════════════════════════════════════════
tools/favicon-vergleich.py meldet fuer die Kachel bei 16 px `stifte 1/6`
(uebrig: stahlblau). Diese Zahl sagt NICHT, ob der ueberlebende Treffer der
heruntergerechnete Stift ist oder ein Mischton, der zufaellig innerhalb der
Schwelle 60 liegt. Genau das entscheidet aber, wie man die Zahl liest:
„ein Stift haelt durch" ist eine andere Auskunft als „einer der sechs
Sollwerte ist faelschbar".

══ WIE ES GEPRUEFT WIRD — UND WARUM SO ════════════════════════════════════
  1. ORT. Fuer jede Stiftfarbe wird der beste Punkt in jeder Groesse gesucht
     und sein Ort in Einheitskoordinaten gemeldet. Wandert der Gewinner beim
     Herunterrechnen weg vom Stift, ist er nicht der Stift.

  2. QUELLBLOCK. Jeder 16er-Punkt deckt 64x64 Punkte der 1024er-Quelle. Wenn
     unter dem Gewinner KEIN EINZIGER Quellpunkt die Stiftfarbe traegt, kann
     er nicht aus ihr entstanden sein.

  3. GEGENPROBE. Der echte Stift wird entfernt und neu gemessen. Entfernt
     wird er als ZUSAMMENHAENGENDER KLUMPEN (Flutfuellung ab seinem Ort),
     nicht als Farbmaske ueber das ganze Bild und nicht als Kasten: Stahlblau
     ist ein gedaempfter Ton, der auch in der Schattierung der lila Kachel
     vorkommt — eine Maske ueber alle nahen Punkte oder ein Kasten um sie
     herum wuerde halb Kachel mit loeschen und die Gegenprobe wertlos machen.
     Uebermalt wird mit der Nachbarfarbe direkt neben dem Klumpen, damit kein
     geratener Grundton eine neue Kante erfindet.

     Bleibt die Zahl nach dem Entfernen gleich, misst sie den Stift nicht.

AENDERT NICHTS im Baum. Es liest die Quelle und rechnet.

══ AUFRUF ═════════════════════════════════════════════════════════════════
    python3 tools/favicon-stift-herkunft.py            # alles
    python3 tools/favicon-stift-herkunft.py 1024 32 16 # nur diese Groessen
"""
import math
import pathlib
import sys
from collections import deque

WURZEL = pathlib.Path(__file__).resolve().parent.parent
KACHEL = WURZEL / 'NewDesign/bilder/quellen/Meshy_AI_mixpi-favicon.png'

# Dieselben sechs Sollfarben und dieselbe Schwelle wie in favicon-vergleich.py.
# Stehen sie dort einmal anders, gehoeren sie hier mitgezogen.
STIFTE = (('blau', (0x00, 0xAC, 0xFD)), ('gruen', (0x11, 0xDE, 0x47)),
          ('stahlblau', (0x43, 0x71, 0x9A)), ('gelb', (0xFE, 0xEE, 0x04)),
          ('pink', (0xFD, 0x34, 0xA2)), ('orange', (0xFF, 0x70, 0x01)))
SCHWELLE = 60.0

# Ein Punkt IM stahlblauen Stift der 1024er-Quelle, von Hand nachgesehen
# (Farbe dort (61,110,158), 7,8 von der Sollfarbe entfernt).
STIFT_ORT = (526, 259)


def quelle():
    from PIL import Image
    return Image.open(KACHEL).convert('RGB')


def klein(im, g):
    from PIL import Image
    return im if im.size[0] == g else im.resize((g, g), Image.LANCZOS)


def bester(im, soll):
    """Bester Punkt, sein Ort in Einheitskoordinaten, seine Farbe, Zahl der Treffer."""
    px = im.load()
    w, h = im.size
    best, ort, farbe, n = 1e9, (0, 0), None, 0
    for y in range(h):
        for x in range(w):
            d = math.dist(px[x, y], soll)
            if d < SCHWELLE:
                n += 1
            if d < best:
                best, ort, farbe = d, (x, y), px[x, y]
    return best, ort, farbe, n


def klumpen_um(im, ort, soll):
    """Der zusammenhaengende Fleck naher Punkte ab `ort` — der Stift, nicht das Bild."""
    px = im.load()
    w, h = im.size
    gesehen = {ort}
    q = deque([ort])
    raus = []
    while q:
        x, y = q.popleft()
        raus.append((x, y))
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            u, v = x + dx, y + dy
            if 0 <= u < w and 0 <= v < h and (u, v) not in gesehen \
                    and math.dist(px[u, v], soll) < SCHWELLE:
                gesehen.add((u, v))
                q.append((u, v))
    return raus


def ohne_klumpen(im, fleck):
    """Den Fleck mit der Farbe direkt links daneben uebermalen."""
    o = im.copy()
    p = o.load()
    xs = [a for a, _ in fleck]
    ys = [b for _, b in fleck]
    nachbar = im.load()[max(0, min(xs) - 3), (min(ys) + max(ys)) // 2]
    for x, y in fleck:
        p[x, y] = nachbar
    return o, nachbar, (min(xs), min(ys), max(xs), max(ys))


def main():
    groessen = [int(a) for a in sys.argv[1:]] or [1024, 64, 32, 16]
    src = quelle()
    w, _ = src.size

    for g in groessen:
        im = klein(src, g)
        print(f'\n═══ Kachel bei {g} px ' + '═' * 46)
        for name, soll in STIFTE:
            d, (x, y), farbe, n = bester(im, soll)
            print(f'  {name:10s} {"DA " if d < SCHWELLE else "weg"} abstand {d:6.1f}'
                  f'  bei ({x/g:.3f},{y/g:.3f})  farbe {farbe}  treffer {n}')

    print('\n═══ Gegenprobe: derselbe Ton OHNE den stahlblauen Stift ' + '═' * 12)
    soll = dict(STIFTE)['stahlblau']
    fleck = klumpen_um(src, STIFT_ORT, soll)
    weg, nachbar, kasten = ohne_klumpen(src, fleck)
    print(f'  Stift-Klumpen ab {STIFT_ORT}: {len(fleck)} Punkte, Kasten '
          f'{kasten[2]-kasten[0]+1}x{kasten[3]-kasten[1]+1} bei ({kasten[0]},{kasten[1]}) — '
          'ein Stift, nicht das halbe Bild')
    print(f'  uebermalt mit der Nachbarfarbe {nachbar}')
    for titel, bild in (('mit Stift ', src), ('OHNE Stift', weg)):
        d, (x, y), farbe, n = bester(klein(bild, 16), soll)
        print(f'  {titel}  stahlblau {"DA " if d < SCHWELLE else "weg"} abstand {d:5.1f}'
              f'  Gewinner ({x},{y}) {farbe}  treffer {n}')

    print('\n  Was liegt unter den beiden entscheidenden 16er-Punkten:')
    p = src.load()
    k16 = klein(src, 16).load()
    b16 = klein(weg, 16).load()
    blk = w // 16
    for (x, y), was in ((bester(klein(src, 16), soll)[1], 'gemeldeter Gewinner'),
                        (( STIFT_ORT[0] * 16 // w, STIFT_ORT[1] * 16 // w), 'deckt den ECHTEN Stift')):
        n = sum(1 for v in range(y * blk, (y + 1) * blk) for u in range(x * blk, (x + 1) * blk)
                if math.dist(p[u, v], soll) < SCHWELLE)
        print(f'    ({x},{y}) {was:22s} {n:5d} von {blk*blk} Quellpunkten sind stahlblau'
              f'   —  mit Stift {k16[x, y]} d{math.dist(k16[x, y], soll):.1f}'
              f'  /  ohne Stift {b16[x, y]} d{math.dist(b16[x, y], soll):.1f}')


if __name__ == '__main__':
    main()
