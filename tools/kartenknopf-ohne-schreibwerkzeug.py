#!/usr/bin/env python3
"""Nachmessen: Haelt die Sperre „kein Schreibwerkzeug" den naechsten Suchtakt aus?

WOZU: `_seite_karte` sperrt den roten Knopf zuletzt, wenn weder rpi-imager noch
xz+dd da sind (sdstart.py, „OHNE SCHREIBWERKZEUG WIRD NICHT ANGEBOTEN ZU
SCHREIBEN"). Der Kartensucher laeuft danach aber weiter, und `_karte_zeigen`
setzt bei JEDEM Takt `self.knopf.sperren(self.karte is None)` — ohne das
Werkzeug noch einmal zu fragen.

Die Frage ist also nicht, ob die Sperre GESETZT wird, sondern ob sie den
ersten Takt UEBERLEBT. Diese Probe behauptet nichts, sie liest den Knopf zu
zwei Zeitpunkten ab: direkt nach dem Aufbau der Seite und nach drei Takten.

Das ist die Vorbedingung fuer jede Pruefung der Art „nach dem Waehlen ist der
Knopf offen": Solange der Knopfzustand nicht sagt, was er zu sagen behauptet,
misst so eine Pruefung etwas anderes als sie meint.

Es wird nichts geladen und nichts geschrieben: `karten_finden` ist ersetzt,
der Pfad zeigt ins Leere, das Fenster laeuft im Trockenmodus.

AUFRUF
    xvfb-run -a python3 tools/kartenknopf-ohne-schreibwerkzeug.py
    xvfb-run -a python3 tools/kartenknopf-ohne-schreibwerkzeug.py --mit-werkzeug
        (Gegenprobe: MIT Werkzeug muss der Knopf nach den Takten offen sein —
         sonst beweist der Hauptlauf nur, dass die Attrappe nicht greift.)
    xvfb-run -a python3 tools/kartenknopf-ohne-schreibwerkzeug.py --wahl-haelt
        (Zweite Frage, fuer JEDE kuenftige Auswahl: `self.karte not in
         self.karten` (sdstart.py:765) vergleicht GANZE Wortverzeichnisse.
         Aendert sich am selben Geraet ein einziges Feld — und die Groesse
         aendert sich, wenn eine frisch gesteckte Karte erst 0 B meldet und
         dann ihre echte Groesse —, ist die getroffene Wahl „nicht mehr in der
         Liste" und faellt weg. Diese Probe setzt eine Wahl und laesst danach
         nur die Groesse umspringen.)
"""
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, 'remote-step-installer', 'controller'))

import geraete                      # noqa: E402
import sdstart                      # noqa: E402

EINE = [{'pfad': '/dev/PROBE-a', 'name': 'PROBE-a', 'modell': 'MassStorageClass',
         'groesse': '29,7G', 'wechselbar': True, 'bus': 'usb'}]


def wahl_haelt():
    """Eine gesetzte Wahl, danach springt am SELBEN Geraet nur die Groesse um."""
    frueh = {'pfad': '/dev/PROBE-b', 'name': 'PROBE-b', 'modell': 'MassStorageClass',
             'groesse': '0B', 'wechselbar': True, 'bus': 'usb'}
    spaet = dict(frueh, groesse='29,7G')       # dieselbe Karte, jetzt erkannt
    andere = {'pfad': '/dev/PROBE-a', 'name': 'PROBE-a', 'modell': 'Kingston',
              'groesse': '64G', 'wechselbar': True, 'bus': 'usb'}
    stand = [[andere, frueh]]

    geraete.karten_finden = lambda *a, **k: (list(stand[0]), [])
    sdstart.schreibweg = lambda: ('dd', 'Probe.', None)

    f = sdstart.Fenster(trocken=True)
    raus = {}
    takt = sdstart.Fenster.TAKT_MS

    def waehlen():
        f._seite_karte()
        # So wuerde eine Auswahl es tun: sie setzt genau das Verzeichnis, das
        # in der Liste steht.
        f.karte = frueh
        f._karte_zeigen()
        raus['vorher'] = ((f.karte or {}).get('pfad'), f.knopf.an)
        stand[0] = [andere, spaet]             # nur die Groesse aendert sich

    def spaeter():
        raus['nachher'] = ((f.karte or {}).get('pfad'), f.knopf.an)
        raus['gross'] = f.l_karte.cget('text')
        f.destroy()

    f.after(600, waehlen)
    f.after(600 + 3 * takt, spaeter)
    f.mainloop()

    print("Zwei Traeger; die gewaehlte Karte meldet erst 0 B, dann 29,7G.")
    print(f"  nach dem Waehlen:   Ziel={raus['vorher'][0]}, Knopf klickbar={raus['vorher'][1]}")
    print(f"  nach der Groesse:   Ziel={raus['nachher'][0]}, Knopf klickbar={raus['nachher'][1]}")
    print(f"  Meldung:            {raus['gross']!r}")
    haelt = raus['nachher'][0] == '/dev/PROBE-b'
    print("\nERGEBNIS: " + ("Die Wahl haelt die Groessenaenderung aus."
                            if haelt else
                            "Die Wahl faellt weg, sobald sich EIN Feld aendert — der "
                            "Vergleich in Zeile 765 geht ueber das ganze Verzeichnis."))
    return 0 if haelt else 1


def main(argv):
    if '--wahl-haelt' in argv:
        return wahl_haelt()
    mit = '--mit-werkzeug' in argv
    geraete.karten_finden = lambda *a, **k: (list(EINE), [])
    sdstart.schreibweg = (lambda: ('dd', 'Probe.', None)) if mit else \
        (lambda: (None, 'Es fehlt sowohl rpi-imager als auch xz.', 'rpi-imager'))

    f = sdstart.Fenster(trocken=True)
    raus = {}
    takt = sdstart.Fenster.TAKT_MS

    def sofort():
        f._seite_karte()
        f.update_idletasks()
        raus['sofort'] = (f.knopf.an, (f.karte or {}).get('pfad'))

    def spaeter():
        raus['spaeter'] = (f.knopf.an, (f.karte or {}).get('pfad'))
        f.destroy()

    f.after(600, sofort)
    f.after(600 + 3 * takt, spaeter)
    f.mainloop()

    print(f"Schreibwerkzeug vorgegaukelt: {'ja (dd)' if mit else 'NEIN'}")
    print(f"  direkt nach dem Seitenaufbau: Knopf klickbar={raus['sofort'][0]}, "
          f"Ziel={raus['sofort'][1]}")
    print(f"  nach drei Suchtakten:         Knopf klickbar={raus['spaeter'][0]}, "
          f"Ziel={raus['spaeter'][1]}")

    if mit:
        gut = raus['spaeter'][0]
        print("\nGEGENPROBE: " + ("Mit Werkzeug ist der Knopf offen — die Attrappe greift."
                                  if gut else "FEHLER: auch mit Werkzeug bleibt er zu."))
        return 0 if gut else 1
    haelt = not raus['spaeter'][0]
    print("\nERGEBNIS: " + ("Die Sperre haelt." if haelt else
                            "Die Sperre faellt beim naechsten Takt — der Knopf ist offen, "
                            "obwohl kein Schreibwerkzeug da ist."))
    return 0 if haelt else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
