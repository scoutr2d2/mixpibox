#!/usr/bin/env python3
"""Nachmessen: Kommt man von der Kartenseite weiter, wenn ZWEI Traeger stecken?

WOZU: Am 10.08.2026 steckte der Betreiber seinen SABRENT-Mehrfachleser ein.
Der Leser meldet zwei Blockgeraete (zwei LUNs an derselben USB-Adresse,
`remote-step-installer/tests/leerer_schacht_probe.py`): sda mit der Karte und
sdb, den LEEREN zweiten Schacht mit 0 Byte. Die Oberflaeche meldete daraufhin
„2 Wechseldatentraeger gefunden" und „Zieh alle ab ausser der einen".

Behauptet wurde: An dieser Stelle ist der Assistent ZU ENDE — es gibt kein
Widget, mit dem man eine der beiden Karten waehlen koennte, und `self.karte`
bleibt None, also bleibt der Knopf gesperrt.

Diese Probe BEHAUPTET NICHTS, sie zaehlt nach:
  * jedes Widget der Kartenseite, mit Klasse und Text,
  * welche davon ueberhaupt auf <Button-1> hoeren (also klickbar sind),
  * ob ein Auswahl-Widget dabei ist (Radiobutton/Listbox/Combobox/…),
  * was `self.karte` und der Knopf nach mehreren Suchtakten sagen.

Es wird nichts geladen und nichts geschrieben: `karten_finden` ist ersetzt,
die Pfade zeigen ins Leere, das Fenster laeuft im Trockenmodus.

AUFRUF
    xvfb-run -a python3 tools/karte-mehrfachleser-nachstellen.py
    xvfb-run -a python3 tools/karte-mehrfachleser-nachstellen.py --eine
        (Gegenprobe: EIN Traeger — dann MUSS der Knopf offen sein. Ohne die
         Gegenprobe koennte die Messung auch nur beweisen, dass die Attrappe
         nicht greift.)
"""
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, 'remote-step-installer', 'controller'))

import tkinter as tk                # noqa: E402
import geraete                      # noqa: E402
import sdstart                      # noqa: E402

# Genau der Fund vom Arbeitsrechner — der zweite ist der LEERE Schacht.
ZWEI = [{'pfad': '/dev/PROBE-a', 'name': 'PROBE-a', 'modell': 'MassStorageClass',
         'groesse': '238,3G', 'wechselbar': True, 'bus': 'usb'},
        {'pfad': '/dev/PROBE-b', 'name': 'PROBE-b', 'modell': 'MassStorageClass',
         'groesse': '0B', 'wechselbar': True, 'bus': 'usb'}]

AUSWAHLKLASSEN = ('Radiobutton', 'Listbox', 'Combobox', 'Menubutton',
                  'Checkbutton', 'OptionMenu', 'Spinbox', 'Treeview')


def _text(w):
    """Was steht auf dem Widget? Knoepfe sind Canvas — dort im Text-Item."""
    try:
        t = w.cget('text')
        if t:
            return str(t)
    except tk.TclError:
        pass
    if isinstance(w, sdstart.Knopf):
        try:
            return str(w.itemcget(w._text, 'text'))
        except Exception:                                    # noqa: BLE001
            return '?'
    return ''


def _baum(w, tiefe=0, raus=None):
    raus = [] if raus is None else raus
    raus.append((tiefe, w.winfo_class(), type(w).__name__, _text(w),
                 bool(w.bind('<Button-1>'))))
    for k in w.winfo_children():
        _baum(k, tiefe + 1, raus)
    return raus


def main(argv):
    liste = ZWEI[:1] if '--eine' in argv else ZWEI
    geraete.karten_finden = lambda *a, **k: (list(liste), [])
    # Der Schreibweg darf die Messung nicht faerben: fehlte `dd`, waere der
    # Knopf AUCH gesperrt — und zwar aus einem ganz anderen Grund.
    sdstart.schreibweg = lambda: ('dd', 'Probe — es wird nichts geschrieben.', None)

    f = sdstart.Fenster(trocken=True)
    ergebnis = {}

    def messen():
        ergebnis['baum'] = _baum(f.mitte)
        ergebnis['karte'] = f.karte
        ergebnis['karten'] = list(f.karten)
        ergebnis['knopf_an'] = f.knopf.an
        ergebnis['gross'] = f.l_karte.cget('text')
        ergebnis['klein'] = f.l_wo.cget('text')
        # Haengt am Fenster selbst etwas, das eine Karte setzen koennte?
        ergebnis['fenster_bindungen'] = [b for b in f.bind()] + [b for b in f.bind_all()]
        f.destroy()

    # Erst die Seite aufschlagen, dann mehrere Takte laufen lassen — genau wie
    # beim Menschen, der davorsitzt und wartet, dass sich etwas ruehrt.
    f.after(1200, f._seite_karte)
    f.after(1200 + 3 * sdstart.Fenster.TAKT_MS, messen)
    f.mainloop()

    print(f"Traeger im Angebot: {len(liste)}")
    print("\nWIDGETS AUF DER KARTENSEITE")
    for tiefe, klasse, py, text, klickbar in ergebnis['baum']:
        marke = ' <- klickbar' if klickbar else ''
        print(f"  {'  ' * tiefe}{klasse:<10s} ({py}) {text!r}{marke}")

    klickbar = [t for _, _, _, t, k in ergebnis['baum'] if k]
    auswahl = [k for _, k, _, _, _ in ergebnis['baum'] if k in AUSWAHLKLASSEN]
    print(f"\nklickbare Dinge auf der Seite: {klickbar or 'keine'}")
    print(f"Auswahl-Widgets auf der Seite: {auswahl or 'keine'}")
    print(f"Bindungen am Fenster selbst:   {ergebnis['fenster_bindungen'] or 'keine'}")
    print(f"\nMeldung gross: {ergebnis['gross']!r}")
    print(f"Meldung klein: {ergebnis['klein']!r}")
    print(f"gefundene Karten: {[k['pfad'] for k in ergebnis['karten']]}")
    print(f"gewaehlte Karte:  {ergebnis['karte']}")
    print(f"Knopf klickbar:   {ergebnis['knopf_an']}")

    if len(liste) > 1:
        zu = (ergebnis['karte'] is None and not ergebnis['knopf_an']
              and not auswahl)
        print("\nERGEBNIS: " + ("Sackgasse — keine Auswahl, Knopf zu, keine Karte gewaehlt."
                                if zu else "KEINE Sackgasse — es gibt einen Weg weiter."))
        return 0 if zu else 1
    offen = ergebnis['karte'] is not None and ergebnis['knopf_an']
    print("\nGEGENPROBE: " + ("Bei EINER Karte ist der Knopf offen — die Attrappe greift."
                              if offen else "FEHLER: auch bei EINER Karte bleibt der Knopf zu."))
    return 0 if offen else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
