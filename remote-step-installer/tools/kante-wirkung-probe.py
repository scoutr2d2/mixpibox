"""Hat `kante` in bild_setzen() noch eine Wirkung — oder ist der Parameter tot?

WOZU: Die Behauptung lautet, `kante` sei an allen sieben `bild_setzen`-Aufrufen
wirkungslos, seit Zeile 345 die Leinwand nach dem PNG bemisst. Das stimmt fuer
den Fall, dass das PNG DA IST. bild_setzen hat aber zwei Aeste, und der zweite
(Zeile 351/352, der gemalte MixPi-Kopf) bemisst sich AUSSCHLIESSLICH nach
`kante`. Wer den Parameter fuer tot erklaert, muss zeigen, dass dieser zweite
Ast nie laeuft.

Dieses Werkzeug ruft das ECHTE `bild_setzen` unter Xvfb auf und misst die
Leinwand in DREI Lagen:

  A  Bilder da            — so wie auf diesem Rechner
  B  dateien/ ohne PNG    — Auslieferung ohne Bilderordner
  C  PhotoImage wirft     — Tk ohne PNG-Unterstuetzung (Tk 8.5, altes macOS)

Laeuft in B oder C die Leinwand mit `kante` mit, ist der Parameter nicht tot,
sondern nur im haeufigsten Fall unbeteiligt.

AUFRUF
    xvfb-run -a python3 remote-step-installer/tools/kante-wirkung-probe.py
"""
import os
import re
import shutil
import sys
import tempfile
import tkinter as tk

HIER = os.path.dirname(os.path.abspath(__file__))
STEUER = os.path.join(os.path.dirname(HIER), 'controller')
sys.path.insert(0, STEUER)


def aufrufe():
    """name -> kante, so wie sdstart.py `bild_setzen` ruft."""
    quelle = open(os.path.join(STEUER, 'sdstart.py'), encoding='utf-8').read()
    return re.findall(r"bild_setzen\([^,]+,\s*'(\w+)',\s*(\d+)\)", quelle)


def messen(sd, name, kante):
    """Leinwand-Mass, das das ECHTE bild_setzen aufmacht."""
    wurzel = tk.Tk()
    wurzel.withdraw()
    try:
        cv = sd.bild_setzen(wurzel, name, kante)
        cv.update_idletasks()
        return int(cv['width']), int(cv['height']), len(cv.find_all())
    finally:
        wurzel.destroy()


def main():
    if not os.environ.get('DISPLAY'):
        print('Kein DISPLAY - bitte mit `xvfb-run -a` starten.')
        return 1
    import sdstart as sd

    paare = aufrufe()
    echt = sd.DATEIEN
    leer = tempfile.mkdtemp(prefix='kante-leer-')
    print(f'{"Seite":<12}{"kante":>6} | {"A Bilder da":>14} | '
          f'{"B ohne PNG":>14} | {"C Tk ohne PNG":>16}')
    print('-' * 72)

    urteil = {'a_wirkt': 0, 'b_wirkt': 0, 'c_wirkt': 0}
    for name, k in paare:
        k = int(k)
        a = messen(sd, name, k)

        sd.DATEIEN = leer                      # Lage B: kein Bilderordner
        b = messen(sd, name, k)
        sd.DATEIEN = echt

        orig = tk.PhotoImage                   # Lage C: Tk kennt kein PNG
        def platzt(*_a, **_kw):
            raise tk.TclError("couldn't recognize data in image file")
        tk.PhotoImage = platzt
        try:
            c = messen(sd, name, k)
        finally:
            tk.PhotoImage = orig

        def zeig(m):
            w, h, n = m
            return f'{w}x{h}' + ('*' if w == k and h == k else '')

        urteil['a_wirkt'] += (a[0] == k and a[1] == k)
        urteil['b_wirkt'] += (b[0] == k and b[1] == k)
        urteil['c_wirkt'] += (c[0] == k and c[1] == k)
        print(f'{name:<12}{k:>6} | {zeig(a):>14} | {zeig(b):>14} | {zeig(c):>16}'
              f'   (Formen A/B/C: {a[2]}/{b[2]}/{c[2]})')

    shutil.rmtree(leer, ignore_errors=True)
    n = len(paare)
    print('-' * 72)
    print(f'* = Leinwand ist genau kante x kante, `kante` wirkt also.')
    print(f'A Bilder da   : kante wirkt an {urteil["a_wirkt"]}/{n} Aufrufen')
    print(f'B ohne PNG    : kante wirkt an {urteil["b_wirkt"]}/{n} Aufrufen')
    print(f'C Tk ohne PNG : kante wirkt an {urteil["c_wirkt"]}/{n} Aufrufen')
    return 0


if __name__ == '__main__':
    sys.exit(main())
