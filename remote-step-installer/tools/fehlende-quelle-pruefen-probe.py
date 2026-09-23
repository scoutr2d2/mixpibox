#!/usr/bin/env python3
"""Was macht `sdstart-bilder.py --pruefen`, wenn eine QUELLE FEHLT?

WOZU: Die Behauptung „die alte Quelle hat null Verweise, und
dateien/sdstart-lauf.png wird beim Bauen ueberschrieben, es bleibt also KEIN
Rest liegen" haengt an einer Annahme: dass das Bauen JEDES Bild neu schreibt.
In bauen() steht aber bei fehlender Quelle ein `continue` — die Zieldatei wird
dann NICHT angefasst, der alte Stand bleibt stehen.

Die Frage ist, ob die Pruefung das MELDET. pruefen() laeuft ueber
`neu.iterdir()` — also nur ueber das, was gerade gebaut WURDE. Ein
uebersprungenes Bild taucht dort nie auf.

AUFRUF:
    python3 remote-step-installer/tools/fehlende-quelle-pruefen-probe.py

Es wird NICHTS im Baum veraendert: gebaut wird in ein temporaeres
Verzeichnis, und die Rolle von `dateien/` uebernimmt eine Kopie.
"""
import importlib.util
import pathlib
import shutil
import sys
import tempfile

HIER = pathlib.Path(__file__).resolve().parent
BILDERWERK = HIER / 'sdstart-bilder.py'


def laden():
    spec = importlib.util.spec_from_file_location('sdstart_bilder', BILDERWERK)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main() -> int:
    mod = laden()
    with tempfile.TemporaryDirectory() as t:
        ziel = pathlib.Path(t) / 'dateien'
        ziel.mkdir()

        # NUR ZWEI BILDER, damit die Probe in Sekunden laeuft statt in Minuten.
        klein = {k: mod.BILDER[k] for k in ('lauf', 'geglueckt')}
        mod.BILDER = klein
        mod.SYMBOL_QUELLE = '__gibtesnicht__.png'   # Symbolbau ueberspringen
        mod.ZIEL = ziel

        print('== Schritt 1: normal bauen (beide Quellen da) ==')
        for name, wie in mod.bauen(ziel).items():
            print(f'  {name:26} {wie}')
        alt = (ziel / 'sdstart-lauf.png').read_bytes()
        print(f'  sdstart-lauf.png ist jetzt {len(alt)} Bytes gross')

        print('\n== Schritt 2: die Quelle von "lauf" verschwindet ==')
        mod.BILDER = dict(klein)
        mod.BILDER['lauf'] = ('__weggeraeumt__.png', 230)

        # Damit der „Rest" sichtbar wird: die Zieldatei mit etwas anderem
        # ueberschreiben, das ein FRUEHERER Bau hinterlassen haette.
        rest = (ziel / 'sdstart-geglueckt.png').read_bytes()
        (ziel / 'sdstart-lauf.png').write_bytes(rest)
        print('  sdstart-lauf.png traegt jetzt absichtlich den falschen Inhalt'
              f' ({len(rest)} Bytes)')

        print('\n  -- bauen() --')
        mod.bauen(ziel)
        jetzt = (ziel / 'sdstart-lauf.png').read_bytes()
        blieb = jetzt == rest
        print(f'  Zieldatei nach dem Bau: {len(jetzt)} Bytes — '
              + ('DER FALSCHE STAND BLIEB LIEGEN' if blieb
                 else 'wurde ueberschrieben'))

        print('\n  -- pruefen() --')
        ausgang = mod.pruefen()
        print(f'\n  pruefen() meldet {ausgang} Abweichung(en);'
              f' Rueckgabe des Werkzeugs waere Ende {1 if ausgang else 0}')

        print('\n== ERGEBNIS ==')
        if blieb and ausgang == 0:
            print('  Ein Rest BLEIBT liegen, und die Pruefung sagt trotzdem ok.')
            return 0
        print('  Erwartung nicht eingetreten — Code genauer ansehen.')
        return 1


if __name__ == '__main__':
    sys.exit(main())
