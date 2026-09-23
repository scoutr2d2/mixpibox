#!/usr/bin/env python3
"""GEGENPROBE zur Behauptung „bei ungerader Bildhoehe faellt die unterste
Bildzeile aus der Leinwand" (controller/sdstart.py:346).

WARUM NOCH EIN WERKZEUG, es gibt doch tools/bild-sitz-pruefen.py?
Weil das andere Tk selbst nach dem Kasten fragt (`canvas.bbox`) — und damit
DIESELBE Rechnung befragt, die angeblich falsch ist. Ein Kasten ist aber noch
kein Bildpunkt: er sagt, wo Tk das Bild HINRECHNET, nicht was am Schirm
ankommt. Deshalb misst dieses Werkzeug den ECHTEN Schirm:

  1. Es ruft das ECHTE `bild_setzen()` aus controller/sdstart.py auf — mit den
     Kantenwerten, die im Programm wirklich an dieser Stelle stehen.
  2. Es packt die Leinwand allein in ein Fenster, laesst Tk zeichnen und
     fotografiert genau den Bereich der Leinwand (ImageMagick `import`).
  3. Es rechnet das Foto Zeile fuer Zeile gegen das PNG — einmal deckungsgleich
     und einmal um eine Zeile versetzt. Welche Rechnung besser passt, sagt, ob
     das Bild verrutscht ist.
  4. GEGENPROBE: Dasselbe fuer die Bilder mit GERADER Hoehe. Waere die Messung
     selbst schief (Fensterrahmen, Foto um eins daneben), muessten die genauso
     verrutscht aussehen. Tun sie es nicht, misst die Methode richtig.

    xvfb-run -a python3 tools/leinwand-unterste-zeile-gegenprobe.py
"""
import os
import re
import subprocess
import sys

HIER = os.path.dirname(os.path.abspath(__file__))
WURZEL = os.path.dirname(HIER)
QUELLE = os.path.join(WURZEL, 'controller', 'sdstart.py')
sys.path.insert(0, os.path.join(WURZEL, 'controller'))

import tkinter as tk                                     # noqa: E402

import sdstart                                           # noqa: E402

try:
    from PIL import Image
except ImportError:
    sys.exit('Pillow fehlt — nur zum MESSEN noetig, nicht fuer den Installer.')

GRUND = (0xFF, 0xF7, 0xEC)


def aufrufe():
    """(zeile, name, kante) aus der echten Datei — nichts abgetippt."""
    muster = re.compile(r"bild_setzen\(\s*self\.mitte\s*,\s*'([a-z]+)'\s*,\s*(\d+)\s*\)")
    raus = []
    with open(QUELLE, encoding='utf-8') as f:
        for nr, z in enumerate(f, 1):
            m = muster.search(z)
            if m:
                raus.append((nr, m.group(1), int(m.group(2))))
    return raus


def auf_grund(px):
    """Das PNG auf den Hausgrund legen — so sieht die Leinwand es auch."""
    flach = Image.new('RGB', px.size, GRUND)
    px = px.convert('RGBA')
    flach.paste(px, (0, 0), px)
    return flach


def abstand(a, b):
    """Summe der Farbabstaende zweier gleich grosser Bilder."""
    pa, pb = a.load(), b.load()
    s = 0
    for y in range(a.size[1]):
        for x in range(a.size[0]):
            ra, ga, ba = pa[x, y][:3]
            rb, gb, bb = pb[x, y][:3]
            s += abs(ra - rb) + abs(ga - gb) + abs(ba - bb)
    return s


def zeile_voll(bild, y):
    """Wie viele Punkte dieser Zeile sind NICHT Hausgrund?"""
    px = bild.load()
    n = 0
    for x in range(bild.size[0]):
        r, g, b = px[x, y][:3]
        if abs(r - GRUND[0]) + abs(g - GRUND[1]) + abs(b - GRUND[2]) > 24:
            n += 1
    return n


def foto(fenster, cv, weg):
    """Genau den Bereich der Leinwand fotografieren."""
    fenster.update_idletasks()
    fenster.update()
    x = cv.winfo_rootx()
    y = cv.winfo_rooty()
    b = cv.winfo_width()
    h = cv.winfo_height()
    subprocess.run(['import', '-window', 'root', '-crop', f'{b}x{h}+{x}+{y}',
                    '+repage', weg], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return Image.open(weg).convert('RGB'), (b, h)


def main():
    raus = os.environ.get('MESSORDNER', '/tmp/leinwand-messung')
    os.makedirs(raus, exist_ok=True)
    schief = []
    print(f'{"Zeile":>6}  {"Name":<11}{"PNG BxH":>11}{"Leinwand":>11}'
          f'{"deckend":>11}{"1 Zeile tiefer":>16}  Urteil')
    print('-' * 92)
    for nr, name, kante in aufrufe():
        weg = sdstart.seitenbild(name)
        if not weg:
            print(f'{nr:>6}  {name:<11}  KEIN BILD — Rueckfall, nicht betroffen')
            continue
        png = auf_grund(Image.open(weg))
        pb, ph = png.size

        w = tk.Tk()
        w.configure(bg='#000000')
        cv = sdstart.bild_setzen(w, name, kante)
        cv.pack()
        w.geometry(f'{pb + 40}x{ph + 40}+10+10')
        schirm, (lb, lh) = foto(w, cv, os.path.join(raus, f'{name}.png'))

        # Deckend: Schirmzeile y gegen PNG-Zeile y.
        gleich = min(ph, lh)
        d0 = abstand(png.crop((0, 0, pb, gleich)), schirm.crop((0, 0, pb, gleich)))
        # Versetzt: Schirmzeile y+1 gegen PNG-Zeile y.
        d1 = abstand(png.crop((0, 0, pb, gleich - 1)),
                     schirm.crop((0, 1, pb, gleich)))
        urteil = 'sitzt' if d0 <= d1 else 'UM 1 ZEILE TIEFER'
        if d0 > d1:
            schief.append((name, ph, zeile_voll(png, ph - 1)))
        print(f'{nr:>6}  {name:<11}{f"{pb}x{ph}":>11}{f"{lb}x{lh}":>11}'
              f'{d0:>11}{d1:>16}  {urteil}'
              f'{"  (Hoehe ungerade)" if ph % 2 else "  (Hoehe gerade)"}')
        w.destroy()

    print('-' * 92)
    if not schief:
        print('Kein Bild sitzt verschoben — die Behauptung waere widerlegt.')
        return 0
    print('Verschoben, also faellt die unterste PNG-Zeile aus der Leinwand:')
    for name, h, voll in schief:
        print(f'  {name:<11} Hoehe {h:>4} (ungerade)  '
              f'unterste Zeile: {voll} Punkte mit Inhalt')
    print(f'\nFotos zum Nachsehen: {raus}')
    return 1


if __name__ == '__main__':
    sys.exit(main())
