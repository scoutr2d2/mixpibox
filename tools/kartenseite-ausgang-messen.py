#!/usr/bin/env python3
"""Nachmessen: Welche HANDLUNGEN bietet die Kartenseite — und fuehrt eine zurueck?

WOZU: Behauptet wurde, auf der Kartenseite (`_seite_karte`) fehle der
Zurueck-Knopf, den WLAN- und Namensseite haben, und daraus folge eine
Sackgasse (Backlog #61): steht der Schreibknopf gesperrt da, gebe es auf der
Seite keine einzige Handlung mehr.

Diese Probe behauptet nichts, sie zaehlt. Sie baut jede Seite auf, listet
JEDEN Knopf mit seinem Zustand (offen/zu) und nennt am Ende, wie viele
Handlungen pro Seite uebrig bleiben. Zusaetzlich wird der Takt mitgefahren:
`_karten_suchen` laeuft weiter, waehrend die Seite steht — was dort passiert,
gehoert zur Antwort auf die Frage „kommt man zurueck?".

Es wird nichts geladen und nichts geschrieben: `karten_finden` ist ersetzt,
die Pfade zeigen ins Leere, das Fenster laeuft im Trockenmodus.

AUFRUF
    xvfb-run -a python3 tools/kartenseite-ausgang-messen.py
"""
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, 'remote-step-installer', 'controller'))

import geraete                      # noqa: E402
import sdstart                      # noqa: E402

EINE = [{'pfad': '/dev/PROBE-a', 'name': 'PROBE-a', 'modell': 'SanDisk (Probe)',
         'groesse': '32G', 'wechselbar': True, 'bus': 'usb'}]
# Zwei Funde wie auf dem Arbeitsrechner — zwei LUNs DESSELBEN Lesers.
ZWEI = [{'pfad': '/dev/PROBE-a', 'name': 'PROBE-a', 'modell': 'MassStorageClass',
         'groesse': '238,3G', 'wechselbar': True, 'bus': 'usb'},
        {'pfad': '/dev/PROBE-b', 'name': 'PROBE-b', 'modell': 'MassStorageClass',
         'groesse': '0B', 'wechselbar': True, 'bus': 'usb'}]


def knoepfe(widget, gefunden=None):
    """Jeden Knopf im Baum einsammeln — mit Beschriftung und Zustand."""
    gefunden = [] if gefunden is None else gefunden
    for kind in widget.winfo_children():
        if isinstance(kind, sdstart.Knopf):
            gefunden.append((kind.itemcget(kind._text, 'text'), bool(kind.an)))
        knoepfe(kind, gefunden)
    return gefunden


def zeigen(f, titel):
    liste = knoepfe(f.mitte)
    offen = [t for t, an in liste if an]
    print(f"  {titel}")
    for t, an in liste:
        print(f"      {'offen' if an else '  ZU '}  {t!r}")
    if not liste:
        print("      (kein einziger Knopf)")
    print(f"      -> Handlungen moeglich: {len(offen)}  {offen}")
    return liste


def lauf(name, liste, weg, board_gesetzt=False):
    geraete.karten_finden = lambda *a, **k: (list(liste), [])
    sdstart.schreibweg = lambda: weg
    f = sdstart.Fenster(trocken=True, board_gesetzt=board_gesetzt)
    ergebnis = {}

    def messen():
        f._seite_karte()
        ergebnis['beim Aufbau'] = zeigen(f, 'Kartenseite, direkt nach dem Aufbau:')

    def spaeter():
        # NACH ZWEI TAKTEN — die Kartensuche ist mindestens einmal
        # durchgelaufen. Wer nur beim Aufbau misst, misst nicht das, was der
        # Mensch nach drei Sekunden vor sich hat.
        ergebnis['nach 2 Takten'] = zeigen(f, 'dieselbe Seite, +5 s (Takt lief):')

    print(f"\n══ {name} ══════════════════════════════════════════")
    f.after(2500, messen)
    f.after(7500, spaeter)
    f.after(8200, f.destroy)
    f.mainloop()
    return ergebnis


def vergleichsseiten():
    """Zum Vergleich: Was bietet jede ANDERE Seite?"""
    geraete.karten_finden = lambda *a, **k: (list(EINE), [])
    sdstart.schreibweg = lambda: ('dd', 'Probe.', None)
    f = sdstart.Fenster(trocken=True)
    print("\n══ Alle Seiten im Vergleich ═══════════════════════════")

    def alles():
        for titel, bauen in (('Seite 0 Willkommen', f._seite_willkommen),
                             ('Seite 1 Welcher Pi', f._seite_board),
                             ('Seite 2 WLAN', f._seite_wlan),
                             ('Seite 3 Name/Passwort', f._seite_name),
                             ('Seite 4 Karte', f._seite_karte)):
            bauen()
            f.update_idletasks()
            liste = knoepfe(f.mitte)
            zurueck = [t for t, _ in liste if 'Zurück' in t or 'Zurueck' in t]
            print(f"  {titel:<24s} Knoepfe={[t for t, _ in liste]}  "
                  f"Zurueck={'JA' if zurueck else 'NEIN'}")
        f.destroy()

    f.after(2500, alles)
    f.mainloop()


def main():
    # Auf dem Hauptfenster selbst: gibt es eine Tastatur-Naht (Escape o.ae.),
    # die die Seite verlassen wuerde? Ein Ausgang muss nicht sichtbar sein.
    geraete.karten_finden = lambda *a, **k: ([], [])
    sdstart.schreibweg = lambda: ('dd', 'Probe.', None)
    probe = sdstart.Fenster(trocken=True)
    probe.update_idletasks()
    print("Bindungen am Hauptfenster:", probe.bind() or '(keine)')
    print("Menueleiste:", probe.cget('menu') or '(keine)')
    probe.destroy()

    vergleichsseiten()
    lauf('EINE Karte, Schreibwerkzeug da', EINE, ('dd', 'Probe.', None))
    lauf('ZWEI Traeger (LUN-Fall), Schreibwerkzeug da', ZWEI, ('dd', 'Probe.', None))
    lauf('EINE Karte, KEIN Schreibwerkzeug, Paketbefehl bekannt',
         EINE, (None, 'Es fehlt sowohl rpi-imager als auch xz.', 'rpi-imager'))
    lauf('ZWEI Traeger UND kein Schreibwerkzeug',
         ZWEI, (None, 'Es fehlt sowohl rpi-imager als auch xz.', 'rpi-imager'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
