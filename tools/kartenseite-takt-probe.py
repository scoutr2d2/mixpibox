#!/usr/bin/env python3
"""Misst, was der 2-Sekunden-Suchtakt auf der Kartenseite WIRKLICH anfasst.

WOZU
Es steht die Behauptung im Raum, der Suchtakt (`Fenster.TAKT_MS = 2000`)
ueberschreibe „Text und Zustand" der Kartenseite und eine Auswahl-Oberflaeche
an dieser Stelle werde „ueberschrieben oder fresse den Klick". Der erste Teil
laesst sich am Quelltext ablesen, der zweite nicht — ob ein Widget einen Takt
ueberlebt und ob eine Auswahl zurueckgesetzt wird, sagt nur der Lauf.

Also wird eine Auswahl-Oberflaeche GENAU DORT eingehaengt, wo sie hingehoerte
(in denselben Rahmen wie `l_karte`/`l_wo`), die Lage des Betreibers vom
10.08.2026 nachgestellt (ein Kartenleser, zwei LUNs -> zwei Eintraege) und
mehrere Takte lang gemessen.

NICHTS WIRD GESCHRIEBEN: `geraete.karten_finden` ist ersetzt, das Fenster
laeuft mit `trocken=True`, und die erfundenen Pfade zeigen ins Leere.

AUFRUF
    xvfb-run -a python3 tools/kartenseite-takt-probe.py
"""
import os
import sys
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, 'remote-step-installer', 'controller'))

import tkinter as tk                                            # noqa: E402
import geraete                                                  # noqa: E402
import sdprep                                                   # noqa: E402

# Die Lage des Betreibers: EIN Sabrent-Leser, zwei Schaechte (LUN 0 und 1).
ZWEI = [
    {'pfad': '/dev/PROBE-sda', 'name': 'sda', 'groesse': '238,3G',
     'modell': 'MassStorageClass', 'wechselbar': True, 'bus': 'usb'},
    {'pfad': '/dev/PROBE-sdb', 'name': 'sdb', 'groesse': '0B',
     'modell': 'MassStorageClass', 'wechselbar': True, 'bus': 'usb'},
]
geraete.karten_finden = lambda: (list(ZWEI), [])
sdprep.wifi_active = lambda: 'Heimnetz'
sdprep.wifi_secret = lambda ssid: 'egal'
sdprep.fetch_index = lambda: (_ for _ in ()).throw(AssertionError('Netz!'))
sdprep.download = lambda *a, **k: (_ for _ in ()).throw(AssertionError('Download!'))

import sdstart                                                  # noqa: E402

befund = []


def sag(name, wert, zusatz=''):
    befund.append((name, wert, zusatz))


def takte(f, sekunden):
    """Die Ereignisschleife echt laufen lassen — `after` braucht Zeit, nicht update_idletasks."""
    ende = time.time() + sekunden
    while time.time() < ende:
        f.update()
        time.sleep(0.01)


def main():
    f = sdstart.Fenster(board='RPi5', trocken=True, board_gesetzt=True)
    f.withdraw()
    f._seite_karte()
    f.update()

    rahmen = f.l_karte.master          # derselbe Rahmen, in dem die Texte stehen

    # ── Eine Auswahl-Oberflaeche GENAU DORT, wo sie hingehoerte ─────────────
    wahl = tk.StringVar(value='')
    knoepfe = [tk.Radiobutton(rahmen, text=k['pfad'], variable=wahl, value=k['pfad'])
               for k in ZWEI]
    for r in knoepfe:
        r.pack(anchor='w')
    geklickt = []
    probe_knopf = tk.Button(rahmen, text='Probe', command=lambda: geklickt.append(1))
    probe_knopf.pack(anchor='w')
    f.update()

    # Erster Takt: bekommt die Seite ueberhaupt zwei Karten gemeldet?
    takte(f, 3.0)
    sag('der Takt meldet zwei Karten', len(f.karten) == 2, repr(len(f.karten)))
    sag('Text wird vom Takt gesetzt',
        'Wechseldatenträger gefunden' in f.l_karte.cget('text'), f.l_karte.cget('text'))

    # ── A: ueberlebt die Auswahl-Oberflaeche die Takte? ─────────────────────
    takte(f, 5.0)
    sag('A Radiobuttons existieren nach ~4 Takten noch',
        all(r.winfo_exists() for r in knoepfe))
    sag('A der Probeknopf existiert noch', bool(probe_knopf.winfo_exists()))

    # ── B: frisst der Takt den Klick / die Auswahl? ─────────────────────────
    knoepfe[0].invoke()                 # „Klick" auf den ersten Eintrag
    f.karte = ZWEI[0]                   # was eine Auswahl-Oberflaeche tun wuerde
    f._karte_zeigen()
    vor = wahl.get()
    takte(f, 5.0)
    sag('B die Radio-Auswahl ueberlebt die Takte', wahl.get() == vor == '/dev/PROBE-sda',
        f'vor={vor!r} nach={wahl.get()!r}')
    sag('B self.karte bleibt gesetzt', f.karte is not None and
        f.karte.get('pfad') == '/dev/PROBE-sda', repr(f.karte))
    sag('B der Knopf „Karte schreiben" bleibt offen', f.knopf.an is True, repr(f.knopf.an))

    probe_knopf.invoke()
    takte(f, 2.5)
    probe_knopf.invoke()
    sag('B Klicks kommen an (2x invoke)', len(geklickt) == 2, repr(len(geklickt)))

    # ── C: was der Takt TATSAECHLICH ueberschreibt ──────────────────────────
    f.l_karte.configure(text='MEINE AUSWAHL')
    f.l_wo.configure(text='meine zeile')
    marke_frei = tk.Label(rahmen, text='MEINE MARKE')
    marke_frei.pack(anchor='w')
    takte(f, 5.0)
    sag('C l_karte wird ueberschrieben', f.l_karte.cget('text') != 'MEINE AUSWAHL',
        f.l_karte.cget('text'))
    sag('C ein FREMDES Label bleibt unberuehrt',
        marke_frei.winfo_exists() and marke_frei.cget('text') == 'MEINE MARKE')

    # ── D: baut der Takt die Seite neu auf? ────────────────────────────────
    kinder_vor = [str(w) for w in f.mitte.winfo_children()]
    takte(f, 5.0)
    sag('D die Seite wird NICHT neu aufgebaut',
        [str(w) for w in f.mitte.winfo_children()] == kinder_vor)

    f.destroy()


try:
    main()
except Exception as e:                                          # noqa: BLE001
    sag('der Lauf kommt durch', False, f'{type(e).__name__}: {e}')

schlecht = 0
for name, gut, zusatz in befund:
    print(f'  {"ja  " if gut else "NEIN"} {name}' + (f'   — {zusatz}' if zusatz else ''))
    schlecht += 0 if gut else 1
print(f'\n  {len(befund) - schlecht} von {len(befund)} wie erwartet')
sys.exit(0)
