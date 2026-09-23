#!/usr/bin/env python3
"""Nachmessen: Was passiert, wenn eine ZWEITE Karte NACHTRAEGLICH dazukommt?

WOZU
Behauptet wurde (auswahl-sackgasse): Steckt erst eine Karte und kommt dann
eine zweite dazu, bleibt der rote Knopf SCHARF — waehrend darueber steht
„N Wechseldatentraeger gefunden · Zieh alle ab ausser der einen".
Grund laut Behauptung: `sdstart.py:765  elif self.karte not in self.karten:`
verwirft die alte Wahl nur, wenn sie VERSCHWUNDEN ist.

Und gefragt wurde, ob der VORSCHLAG gefahrlos ist, jenes `elif` zu einem
`else` zu machen (bei mehr als einer Karte IMMER `self.karte = None`).

Diese Probe behauptet nichts, sie misst an der laufenden Oberflaeche:
  Teil 1  die Reihenfolge des Betreibers: erst eine, dann zwei.
  Teil 2  dieselbe Reihenfolge mit dem Vorschlag als Patch.
  Teil 3  die Faelle, die der Patch treffen koennte:
          * eine echte Karte, die kurz nach dem Stecken 0 B meldet,
          * der Mehrfachleser, dessen zweiter Schacht sich SPAETER meldet
            (LUN-Abtastung ist nicht gleichzeitig),
          * Flattern: zwei Traeger und wieder einer.
  Teil 4  der Riegel im Lauf: was macht `_lauf()`, wenn `self.karte`
          zwischen Klick und Schreiben auf None faellt? (Mit Attrappen
          statt Netz — es wird nichts geladen und nichts geschrieben.)

Es wird NICHTS geschrieben: Trockenlauf, Pfade zeigen ins Leere, alle
Netz- und Schreibwege sind ersetzt.

AUFRUF
    xvfb-run -a python3 tools/kartenwahl-nachzuegler-probe.py
Ende 0 = die Behauptung hat sich bestaetigt.
"""
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, 'remote-step-installer', 'controller'))

import sdstart                                                # noqa: E402
import sdprep                                                 # noqa: E402

# Ein Stick und ein Mehrfachleser — Pfade, die es nicht gibt.
STICK = {'pfad': '/dev/PROBE-stick', 'name': 'PROBE-stick', 'modell': 'USB-Stick',
         'groesse': '16G', 'wechselbar': True, 'bus': 'usb'}
KARTE = {'pfad': '/dev/PROBE-karte', 'name': 'PROBE-karte', 'modell': 'MassStorageClass',
         'groesse': '238,3G', 'wechselbar': True, 'bus': 'usb'}
SCHACHT = {'pfad': '/dev/PROBE-leer', 'name': 'PROBE-leer', 'modell': 'MassStorageClass',
           'groesse': '0B', 'wechselbar': True, 'bus': 'usb'}

fehler = []


def gepatchtes_gesetzt(self, liste):
    """Der VORSCHLAG: bei mehr als einer Karte IMMER keine Wahl.

    Wortgleich mit `_karten_gesetzt`, nur ohne die Bedingung am `elif`.
    """
    self.karten = liste or []
    if len(self.karten) == 1:
        self.karte = self.karten[0]
    else:
        self.karte = None
    self._karte_zeigen()
    if len(self.karten) > 1 and hasattr(self, 'l_wo') and self.l_wo.winfo_exists():
        self.l_karte.configure(text=f'{len(self.karten)} Wechseldatenträger gefunden')
        self.l_wo.configure(text='Zieh alle ab außer der einen — geraten wird hier nicht.')


def bild(f):
    return (f.l_karte.cget('text'), f.l_wo.cget('text'),
            (f.karte or {}).get('pfad'), f.knopf.an)


def zeigen(marke, f):
    gross, klein, ziel, an = bild(f)
    print(f'  {marke}')
    print(f'      gross : {gross!r}')
    print(f'      klein : {klein!r}')
    print(f'      Ziel des roten Knopfes: {ziel}')
    print(f'      Knopf klickbar        : {an}')
    return gross, klein, ziel, an


def fenster_bauen(patch=False):
    # Der Schreibweg darf die Messung nicht faerben: fehlte `dd`, waere der
    # Knopf AUCH gesperrt — und zwar aus einem ganz anderen Grund.
    sdstart.schreibweg = lambda: ('dd', 'Probe — es wird nichts geschrieben.', None)
    f = sdstart.Fenster(board='RPi5', trocken=True, probe=True)
    f.withdraw()                     # nichts aufziehen, kein grab_set noetig
    if patch:
        f._karten_gesetzt = gepatchtes_gesetzt.__get__(f, type(f))
    f._seite_karte()
    f.update()
    return f


def folge(f, schritte):
    raus = []
    for marke, liste in schritte:
        f._karten_gesetzt(list(liste))
        f.update()
        raus.append(zeigen(marke, f))
    return raus


def main():
    # ── Teil 1: heute, ohne Patch ───────────────────────────────────────────
    print('TEIL 1 — HEUTE: erst eine Karte, dann kommt eine zweite dazu')
    f = fenster_bauen()
    _, zwei = folge(f, [('nur die Karte           ', [KARTE]),
                        ('Stick kommt dazu        ', [KARTE, STICK])])
    f.destroy()
    gross, klein, ziel, an = zwei
    if not (an and ziel == KARTE['pfad'] and 'gefunden' in gross):
        fehler.append('Der Knopf ist NICHT scharf, waehrend die Sammelmeldung steht '
                      '— die Behauptung traegt nicht.')

    print('\nTEIL 1b — HEUTE: der Mehrfachleser, dessen leerer Schacht NACHKOMMT')
    f = fenster_bauen()
    _, spaet = folge(f, [('nur der Schacht mit Karte', [KARTE]),
                         ('leerer Schacht meldet sich', [KARTE, SCHACHT])])
    f.destroy()
    if spaet[3]:
        print('      ==> Heute bleibt der Weg offen, und das Ziel ist die RICHTIGE Karte.')

    # ── Teil 2: mit dem Vorschlag ───────────────────────────────────────────
    print('\nTEIL 2 — MIT DEM VORSCHLAG (elif -> else): dieselbe Reihenfolge')
    f = fenster_bauen(patch=True)
    _, zwei_p = folge(f, [('nur die Karte           ', [KARTE]),
                          ('Stick kommt dazu        ', [KARTE, STICK])])
    print('  und derselbe Mehrfachleser:')
    spaet_p = folge(f, [('leerer Schacht statt Stick', [KARTE, SCHACHT])])[0]
    f.destroy()
    if zwei_p[3] or zwei_p[2] is not None:
        fehler.append('Der Vorschlag sperrt den Knopf NICHT — Patch greift nicht.')

    # ── Teil 3: was der Patch sonst noch trifft ─────────────────────────────
    print('\nTEIL 3 — die Faelle, die ein Umbau treffen koennte (mit Patch)')
    f = fenster_bauen(patch=True)
    print('  3a  EINE echte Karte, die erst 0 B meldet und dann waechst:')
    a = folge(f, [('frisch gesteckt (0 B)   ', [dict(KARTE, groesse='0B', modell='')]),
                  ('Sekunden spaeter (32 G) ', [dict(KARTE, groesse='32G',
                                                     modell='SanDisk Ultra')])])
    if not (a[0][3] and a[1][3]):
        fehler.append('Der Patch trifft die EINZELNE Karte — das waere ein Rueckschritt.')
    else:
        print('      ==> unveraendert: eine Karte bleibt gewaehlt, auch beim Wachsen.')

    print('  3b  Flattern: zwei Traeger, dann wieder einer:')
    b = folge(f, [('zwei                    ', [KARTE, STICK]),
                  ('Stick wieder ab         ', [KARTE])])
    if not b[1][3]:
        fehler.append('Nach dem Abziehen geht der Knopf NICHT wieder auf.')
    else:
        print('      ==> der Knopf kommt zurueck, sobald einer uebrig ist.')

    print('  3c  Mehrfachleser: gibt es einen Ausweg auf der Seite?')
    f._karten_gesetzt([KARTE, SCHACHT])
    f.update()
    klickbar = []

    def sammeln(w):
        if w.bind('<Button-1>'):
            t = ''
            if isinstance(w, sdstart.Knopf):
                try:
                    t = str(w.itemcget(w._text, 'text'))
                except Exception:                            # noqa: BLE001
                    t = '?'
            klickbar.append(t or w.winfo_class())
        for k in w.winfo_children():
            sammeln(k)
    sammeln(f.mitte)
    print(f'      klickbare Dinge auf der Seite: {klickbar or "keine"}')
    print(f'      davon Rueckweg/Auswahl       : '
          f'{[t for t in klickbar if "urück" in t or "urueck" in t] or "keine"}')
    f.destroy()

    # ── Teil 4: faellt die Wahl zwischen Klick und Schreiben weg? ───────────
    print('\nTEIL 4 — die Wahl faellt WAEHREND der Rueckfrage weg (mit Patch)')
    f = fenster_bauen(patch=True)
    f._karten_gesetzt([KARTE])
    f.update()
    print(f'      vor der Rueckfrage: Ziel {f.karte["pfad"]}, Knopf {f.knopf.an}')
    # Der Sucher laeuft waehrend der Rueckfrage weiter (`after` haengt nicht am
    # Griff des Dialogs) — jetzt meldet sich der zweite Schacht.
    f._karten_gesetzt([KARTE, SCHACHT])
    f.update()
    print(f'      waehrend der Rueckfrage: self.karte = {f.karte}')

    # Was macht `_lauf()` damit? Netz und Schreiben durch Attrappen ersetzt.
    f.probe = False                  # damit `_lauf` NICHT in die Attrappe geht
    f.trocken = True
    gemeldet = []
    sdprep.fetch_index = lambda *a, **k: [{'file': 'x.img.xz', 'url': 'nirgends',
                                           'codename': 'Trixie'}]
    sdprep.select = lambda *a, **k: [{'file': 'x.img.xz', 'url': 'nirgends',
                                      'codename': 'Trixie'}]
    sdprep.fetch_sha256 = lambda *a, **k: None
    sdprep.download = lambda *a, **k: None
    sdprep.image_size = lambda *a, **k: 1
    sdprep.write_image = lambda *a, **k: gemeldet.append(a) or 0
    os.makedirs = lambda *a, **k: None
    os.path.isfile = lambda *a, **k: True
    f._sagen = lambda t: gemeldet.append(('log', str(t)))
    f._phase = lambda *a, **k: None
    schaden = None
    try:
        f._lauf()
    except Exception as e:                                   # noqa: BLE001
        schaden = f'{type(e).__name__}: {e}'
    print(f'      _lauf() mit self.karte=None -> {schaden or "kein Fehler"}')
    if schaden:
        print('      ==> `k = self.karte` (sdstart.py:889) hat KEINEN Riegel gegen None;')
        print('          der Fehler faellt erst beim Schreiben an, nach dem Laden.')
    # GEGENPROBE: Mit gueltiger Karte darf derselbe Weg NICHT stolpern —
    # sonst maesse die Probe nur, dass die Attrappen nicht passen.
    f.karte = dict(KARTE)
    gegen = None
    try:
        f._lauf()
    except Exception as e:                                   # noqa: BLE001
        gegen = f'{type(e).__name__}: {e}'
    print(f'      Gegenprobe mit gueltiger Karte -> {gegen or "kein Fehler"}')
    print(f'      an write_image uebergeben: '
          f'{[a[1] for a in gemeldet if isinstance(a, tuple) and len(a) > 1 and a[0] != "log"]}')
    if gegen:
        fehler.append('Auch MIT Karte stolpert `_lauf` — die Attrappen taugen nicht.')
    f.destroy()

    print('')
    if fehler:
        for z in fehler:
            print('WIDERSPRUCH: ' + z)
        return 1
    print('Die Behauptung hat sich an der laufenden Oberflaeche bestaetigt.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
