#!/usr/bin/env python3
"""Bleibt der Schreibknopf zu, wenn KEIN Schreibwerkzeug da ist?

WARUM DAS GEMESSEN WIRD: `_seite_karte` sperrt den Knopf ausdruecklich, wenn
`schreibweg()` weder rpi-imager noch xz findet (sdstart.py, `if not werkzeug`).
Zwei Sekunden spaeter laeuft aber der Kartensuchtakt durch und ruft
`_karte_zeigen`, und das setzt `sperren(self.karte is None)` — ohne zu wissen,
dass gerade gesperrt WURDE. Die Frage ist also nicht, ob der Aufbau richtig
sperrt (das tut er), sondern ob die Sperre den ersten Takt ueberlebt.

Gemessen wird an der echten Oberflaeche unter Xvfb, mit zwei ausgetauschten
Stuecken:
  * `schreibweg()` meldet „nichts da"   — der Fall, um den es geht.
  * `karten_finden()` meldet GENAU EINE Karte auf einem Pfad, den es nicht
    gibt — damit `_karten_gesetzt` sie selbst setzt und ein Versehen trotzdem
    nichts trifft.

Aufruf:  xvfb-run -a python3 tools/kartenknopf-ohne-werkzeug-probe.py
Rueckgabe: 0 = Sperre haelt, 1 = Sperre faellt.
"""
import os
import sys

HIER = os.path.dirname(os.path.abspath(__file__))
STEUER = os.path.join(os.path.dirname(HIER), 'remote-step-installer', 'controller')
sys.path.insert(0, STEUER)

import geraete                                              # noqa: E402
import sdstart                                              # noqa: E402

ATTRAPPE = [{'pfad': '/dev/GIBTESNICHT', 'name': 'attrappe',
             'modell': 'SanDisk Ultra (Attrappe)', 'groesse': '32G',
             'wechselbar': True}]

# Kein rpi-imager, kein xz — genau der Zustand, den `_seite_karte` abfangen will.
sdstart.schreibweg = lambda: (None, ('Es fehlt sowohl rpi-imager als auch xz. '
                                     'So lässt sich keine Karte schreiben.'),
                              'rpi-imager')
geraete.karten_finden = lambda *a, **k: list(ATTRAPPE)

befund = {}


def messen():
    f = sdstart.Fenster(board='RPi5', trocken=True)
    f.update()
    f._seite_karte()
    f.update()
    befund['beim_aufbau'] = f.knopf.an

    def spaeter():
        befund['nach_dem_takt'] = f.knopf.an
        befund['karte'] = f.karte
        f.destroy()

    # TAKT_MS + Luft: der erste Kartenlauf startet 200 ms nach dem Fenster,
    # der naechste 2000 ms spaeter. Wer zu frueh misst, misst den Aufbau.
    f.after(int(sdstart.Fenster.TAKT_MS) + 1200, spaeter)
    f.mainloop()


def main():
    messen()
    auf = befund.get('beim_aufbau')
    nach = befund.get('nach_dem_takt')
    print(f"Schreibwerkzeug:   keines (schreibweg() -> None)")
    print(f"Karten gefunden:   1  ({ATTRAPPE[0]['pfad']})")
    print(f"self.karte danach: {befund.get('karte')}")
    print(f"Knopf beim Aufbau:      {'SCHARF' if auf else 'gesperrt'}")
    print(f"Knopf nach dem Takt:    {'SCHARF' if nach else 'gesperrt'}")
    if auf is False and nach is True:
        print('BEFUND: die Sperre faellt — der Takt macht den Knopf wieder scharf.')
        return 1
    if auf is False and nach is False:
        print('BEFUND: die Sperre haelt.')
        return 0
    print('BEFUND: unerwartet — schon der Aufbau war nicht gesperrt.')
    return 2


if __name__ == '__main__':
    sys.exit(main())
