#!/usr/bin/env python3
"""Steht das Loch auch in den AUSGELIEFERTEN Dateien? Nachsehen statt schliessen.

══ WOZU ═══════════════════════════════════════════════════════════════════
tools/kachel-weiss-loecher.py hat gezeigt: schickt man
Meshy_AI_mixpi-favicon.png durch tools/bilder-freistellen.py, steht danach ein
Loch von rund 24 % der Flaeche genau dort, wo das Gesicht war.

Das ist eine Aussage ueber eine RECHNUNG. Die Frage danach ist eine andere:
Kommt diese Rechnung im Bau ueberhaupt vor? Zwei Werkzeuge bauen aus der
Kachel etwas Ausgeliefertes:

    tools/favicon-bauen.py                        -> NewDesign/bilder/mixpi-kachel.png
    remote-step-installer/tools/sdstart-bilder.py -> dateien/sdstart-symbol.png/.ico

Dieses Werkzeug BAUT BEIDE in einen Wegwerfordner und sieht im Ergebnis nach,
ob an der Stelle des Gesichts Weiss/Deckung steht oder ein Loch.

Es fasst den Baum nicht an: gebaut wird nach tempfile, und die
ausgelieferten Dateien werden nur GELESEN.

AUFRUF
    python3 tools/kachel-symbol-loch-nachsehen.py
"""
import pathlib
import sys
import tempfile

WURZEL = pathlib.Path(__file__).resolve().parent.parent
INSTALLER = WURZEL / 'remote-step-installer'

# Dieselbe relative Stelle wie in favicon-vergleich.py: Mitte waagerecht,
# 68 % der Hoehe — das Gesicht.
GESICHT_REL = (0.5, 0.68)


def am_gesicht(pfad):
    """Farbe und Deckung an der Gesichtsstelle einer fertigen Datei."""
    from PIL import Image
    b = Image.open(pfad)
    rgba = b.convert('RGBA')
    w, h = rgba.size
    x, y = int(w * GESICHT_REL[0]), int(h * GESICHT_REL[1])
    p = rgba.load()[x, y]
    # Wieviel der Flaeche ist ueberhaupt durchsichtig? Ein Loch faellt hier auf.
    alpha = rgba.split()[3]
    frei = sum(1 for v in alpha.getdata() if v == 0) / (w * h)
    return {
        'datei': pfad, 'modus': b.mode, 'groesse': (w, h),
        'ort': (x, y), 'pixel': p, 'durchsichtig': frei,
    }


def zeigen(titel, pfad):
    if not pathlib.Path(pfad).is_file():
        print(f'  {titel:34s} FEHLT ({pfad})')
        return
    m = am_gesicht(pfad)
    loch = 'LOCH' if m['pixel'][3] == 0 else 'deckend'
    print(f'  {titel:34s} {m["groesse"][0]}x{m["groesse"][1]} {m["modus"]:4s}'
          f'  Gesicht{m["ort"]} = {m["pixel"]}  {loch}'
          f'  · durchsichtig {m["durchsichtig"]:.1%}')


def main():
    print('═══ Die Dateien, die heute im Baum liegen ' + '═' * 34)
    zeigen('NewDesign/bilder/mixpi-kachel.png', WURZEL / 'NewDesign/bilder/mixpi-kachel.png')
    zeigen('dateien/sdstart-symbol.png', INSTALLER / 'dateien/sdstart-symbol.png')
    zeigen('dateien/sdstart-symbol.ico', INSTALLER / 'dateien/sdstart-symbol.ico')

    print('\n═══ Frisch gebaut aus der Kachel (Wegwerfordner) ' + '═' * 27)
    sys.path.insert(0, str(WURZEL / 'tools'))
    sys.path.insert(0, str(INSTALLER / 'tools'))
    import importlib.util

    for name, weg, ziele in (
        ('favicon-bauen', WURZEL / 'tools/favicon-bauen.py', ['mixpi-kachel.png']),
        ('sdstart-bilder', INSTALLER / 'tools/sdstart-bilder.py',
         ['sdstart-symbol.png', 'sdstart-symbol.ico']),
    ):
        spec = importlib.util.spec_from_file_location(name.replace('-', '_'), weg)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        with tempfile.TemporaryDirectory() as t:
            ordner = pathlib.Path(t)
            try:
                mod.bauen(ordner)
            except SystemExit as e:
                print(f'  {name}: bauen brach ab — {e}')
                continue
            for z in ziele:
                zeigen(f'{name} -> {z}', ordner / z)
    return 0


if __name__ == '__main__':
    sys.exit(main())
