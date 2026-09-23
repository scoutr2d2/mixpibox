#!/usr/bin/env python3
"""Nachmessen: Was steht auf der Kartenseite in der ERSTEN Sekunde?

WOZU: Am 10.08.2026 meldete der Assistent auf dem Arbeitsrechner „2
Wechseldatentraeger gefunden" (zwei LUNs desselben SABRENT-Lesers, siehe
remote-step-installer/tests/leerer_schacht_probe.py). Behauptet wurde, dass
beim AUFSCHLAGEN der Seite trotzdem erst „Keine SD-Karte gefunden." steht —
weil `_seite_karte` nur `_karte_zeigen()` ruft und die Mehrfach-Meldung
ausschliesslich in `_karten_gesetzt` gesetzt wird, das im Takt von TAKT_MS
laeuft.

Diese Probe baut die Seite mit gefaelschten Geraeten auf und schreibt mit,
welcher Text WANN im Fenster steht. Sie behauptet nichts, sie protokolliert.
Es wird nichts geladen und nichts geschrieben: `karten_finden` ist ersetzt,
die Pfade zeigen ins Leere, und das Fenster laeuft im Trockenmodus.

AUFRUF
    xvfb-run -a python3 tools/kartenseite-erste-meldung.py
    xvfb-run -a python3 tools/kartenseite-erste-meldung.py --eine   # Gegenprobe
"""
import os
import sys
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, 'remote-step-installer', 'controller'))

import geraete                      # noqa: E402
import sdstart                      # noqa: E402

# Zwei Funde wie auf dem Arbeitsrechner — der zweite ist der LEERE Schacht.
ZWEI = [{'pfad': '/dev/PROBE-a', 'name': 'PROBE-a', 'modell': 'MassStorageClass',
         'groesse': '238,3G', 'wechselbar': True, 'bus': 'usb'},
        {'pfad': '/dev/PROBE-b', 'name': 'PROBE-b', 'modell': 'MassStorageClass',
         'groesse': '0B', 'wechselbar': True, 'bus': 'usb'}]


def main(argv):
    liste = ZWEI[:1] if '--eine' in argv else ZWEI
    geraete.karten_finden = lambda *a, **k: (list(liste), [])
    sdstart.schreibweg = lambda: ('dd', 'Probe — es wird nichts geschrieben.', None)

    f = sdstart.Fenster(trocken=True)
    protokoll = []
    start = [0.0]

    def notieren(wann):
        protokoll.append((wann, (time.monotonic() - start[0]) * 1000,
                          f.l_karte.cget('text'), f.l_wo.cget('text'),
                          'zu' if not f.knopf.an else 'offen'))

    def seite_aufschlagen():
        # Erst JETZT — die Suche ist mindestens einmal durchgelaufen, genau wie
        # beim Menschen, der sich vorher durch WLAN und Name geklickt hat.
        start[0] = time.monotonic()
        f._seite_karte()
        notieren('beim Aufbau')

    f.after(3000, seite_aufschlagen)
    for ms, wann in ((3100, 'nach 0,1 s'), (3600, 'nach 0,6 s'),
                     (4200, 'nach 1,2 s'), (5400, 'nach 2,4 s')):
        f.after(ms, lambda w=wann: notieren(w))
    f.after(5800, f.destroy)
    f.mainloop()

    print(f"gefundene Geraete: {len(liste)}   TAKT_MS={sdstart.Fenster.TAKT_MS}")
    for wann, ms, gross, klein, knopf in protokoll:
        print(f"  {wann:>12s} (+{ms:6.0f} ms)  {gross!r}\n"
              f"{'':>26s}  {klein!r}   Knopf: {knopf}")
    texte = {p[2] for p in protokoll}
    if 'Keine SD-Karte gefunden.' in texte and len(texte) > 1:
        print("\nERGEBNIS: Die Seite zeigt zuerst 'Keine SD-Karte gefunden.' und "
              "springt erst spaeter auf die richtige Meldung.")
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
