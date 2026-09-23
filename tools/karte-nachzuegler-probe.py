#!/usr/bin/env python3
"""Nachmessen: Was passiert, wenn eine ZWEITE Karte DAZU kommt?

WOZU: `tools/karte-mehrfachleser-nachstellen.py` misst den Fall, in dem von
Anfang an mehrere Traeger stecken — da bleibt der Knopf zu. Diese Probe misst
die andere Reihenfolge, und die ist die haeufigere am Schreibtisch:

    1. Ein USB-Stick steckt schon (Sicherung, Musik, was auch immer).
    2. `_karten_gesetzt` sieht GENAU EINEN Traeger und setzt ihn selbsttaetig
       (sdstart.py:761-762) — niemand hat das bestaetigt.
    3. Der Kartenleser kommt DAZU. Jetzt sind es mehrere.

Die Frage: Wird die selbsttaetig gesetzte Wahl dann verworfen? Zeile 765 sagt
`elif self.karte not in self.karten:` — verworfen wird nur, was VERSCHWUNDEN
ist. Der Stick ist aber noch da.

Die Probe BEHAUPTET NICHTS, sie liest ab: `self.karte`, den Zustand des roten
Knopfes und BEIDE Meldungszeilen — und zwar zum selben Zeitpunkt, damit
sichtbar wird, ob Text und Knopf dasselbe sagen.

Es wird nichts geladen und nichts geschrieben: `karten_finden` ist ersetzt,
alle Pfade zeigen ins Leere, das Fenster laeuft im Trockenmodus, und `_fragen`
wird nur AUSGELESEN, nicht ausgefuehrt (unter Xvfb laeuft kein
Fenstermanager — Modaldialoge beweisen dort nichts, siehe sdstart.py:830 ff.).

AUFRUF
    xvfb-run -a python3 tools/karte-nachzuegler-probe.py

DREI TEILE, und der dritte ist die Gegenprobe:
    1. NACHZUEGLER  — erst der Stick allein, dann der Leser dazu.
    2. VON ANFANG AN — alle drei gleich zu Beginn (so misst die andere Probe).
    3. WEGGEZOGEN   — der gewaehlte Stick verschwindet: dann MUSS 765 greifen.
Ohne 2 und 3 koennte Teil 1 auch nur beweisen, dass die Attrappe nicht greift.
"""
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, 'remote-step-installer', 'controller'))

import geraete                      # noqa: E402
import sdstart                      # noqa: E402

STICK = {'pfad': '/dev/PROBE-stick', 'name': 'PROBE-stick', 'modell': 'Kingston DataTraveler',
         'groesse': '64G', 'wechselbar': True, 'bus': 'usb'}
LESER_A = {'pfad': '/dev/PROBE-a', 'name': 'PROBE-a', 'modell': 'MassStorageClass',
           'groesse': '29,7G', 'wechselbar': True, 'bus': 'usb'}
LESER_B = {'pfad': '/dev/PROBE-b', 'name': 'PROBE-b', 'modell': 'MassStorageClass',
           'groesse': '0B', 'wechselbar': True, 'bus': 'usb'}

# Was `karten_finden` gerade liefert. Wird waehrend des Laufs umgestellt —
# genau das ist das Einstecken.
ANGESTECKT = [STICK]


def _messen(f):
    """Alles zum SELBEN Zeitpunkt ablesen — sonst vergleicht man Zeitpunkte."""
    return {
        'gross': f.l_karte.cget('text'),
        'klein': f.l_wo.cget('text'),
        'karte': (f.karte or {}).get('pfad'),
        'knopf_an': f.knopf.an,
        'karten': [k['pfad'] for k in f.karten],
    }


def _zeigen(titel, m):
    print(f"\n── {titel} ".ljust(74, '─'))
    print(f"  gefunden:       {m['karten']}")
    print(f"  Meldung gross:  {m['gross']!r}")
    print(f"  Meldung klein:  {m['klein']!r}")
    print(f"  Ziel des roten Knopfes: {m['karte']}")
    print(f"  Knopf klickbar: {m['knopf_an']}")


def lauf(start, dann):
    """Fenster aufziehen, Kartenseite aufschlagen, dann umstecken. -> zwei Messungen."""
    global ANGESTECKT
    ANGESTECKT = list(start)
    geraete.karten_finden = lambda *a, **k: (list(ANGESTECKT), [])
    # Der Schreibweg darf die Messung nicht faerben: fehlte `dd`, waere der
    # Knopf AUCH gesperrt — und zwar aus einem ganz anderen Grund.
    sdstart.schreibweg = lambda: ('dd', 'Probe — es wird nichts geschrieben.', None)

    f = sdstart.Fenster(trocken=True)
    raus = {}
    takt = sdstart.Fenster.TAKT_MS

    def umstecken():
        global ANGESTECKT
        raus['vorher'] = _messen(f)
        ANGESTECKT = list(dann)

    def fertig():
        raus['nachher'] = _messen(f)
        f.destroy()

    f.after(600, f._seite_karte)
    f.after(600 + 3 * takt, umstecken)
    f.after(600 + 7 * takt, fertig)
    f.mainloop()
    return raus


def main():
    fehler = 0

    # ── 1. NACHZUEGLER ──────────────────────────────────────────────────────
    r = lauf([STICK], [STICK, LESER_A, LESER_B])
    print("═══ TEIL 1: erst der Stick allein, dann der Leser dazu ═══")
    _zeigen('vorher — nur der Stick', r['vorher'])
    _zeigen('nachher — Leser dazugesteckt', r['nachher'])
    n = r['nachher']
    widerspruch = (n['knopf_an'] and n['karte'] is not None
                   and 'gefunden' in n['gross'] and 'Zieh alle ab' in n['klein'])
    print("\n  BEFUND: " + ("Der Text sagt „nichts gewaehlt“, der Knopf zielt trotzdem "
                            f"auf {n['karte']} und ist offen."
                            if widerspruch else
                            "Text und Knopf sagen dasselbe."))
    fehler += 1 if widerspruch else 0

    # ── 2. VON ANFANG AN ────────────────────────────────────────────────────
    r2 = lauf([STICK, LESER_A, LESER_B], [STICK, LESER_A, LESER_B])
    print("\n\n═══ TEIL 2 (Gegenprobe): alle drei von Anfang an ═══")
    _zeigen('nachher', r2['nachher'])
    n2 = r2['nachher']
    print("\n  BEFUND: " + ("Knopf zu, keine Karte gewaehlt — hier greift 765."
                            if not n2['knopf_an'] and n2['karte'] is None else
                            "AUCH HIER offen — dann liegt es nicht an der Reihenfolge."))

    # ── 3. WEGGEZOGEN ───────────────────────────────────────────────────────
    r3 = lauf([STICK], [LESER_A, LESER_B])
    print("\n\n═══ TEIL 3 (Gegenprobe): der gewaehlte Stick wird abgezogen ═══")
    _zeigen('nachher', r3['nachher'])
    n3 = r3['nachher']
    print("\n  BEFUND: " + ("Wahl verworfen, Knopf zu — 765 greift, wenn die Karte WEG ist."
                            if not n3['knopf_an'] and n3['karte'] is None else
                            "FEHLER: selbst die verschwundene Wahl bleibt stehen."))

    # ── 4. WOHIN FUEHRT DER KLICK? ──────────────────────────────────────────
    # Ein offener Knopf ist nur dann schlimm, wenn der Klick auch ankommt.
    # Hier wird der Knopf WIRKLICH geklickt (`Knopf._klick`, dieselbe Naht wie
    # der Mauszeiger) und danach abgelesen, WAS in der Rueckfrage steht.
    # Der rote Knopf IN der Rueckfrage wird nicht angeruehrt.
    r4 = klick_lauf([STICK], [STICK, LESER_A, LESER_B])
    print("\n\n═══ TEIL 4: der Klick auf den offenen Knopf ═══")
    print(f"  Klick kam an (Rueckfrage offen): {r4['dialog_da']}")
    for zeile in r4['dialog_text']:
        print(f"    {zeile!r}")

    return 1 if fehler else 0


def klick_lauf(start, dann):
    """Wie `lauf`, aber am Ende wird der Knopf geklickt und die Rueckfrage gelesen."""
    global ANGESTECKT
    ANGESTECKT = list(start)
    geraete.karten_finden = lambda *a, **k: (list(ANGESTECKT), [])
    sdstart.schreibweg = lambda: ('dd', 'Probe — es wird nichts geschrieben.', None)

    import tkinter as tk
    f = sdstart.Fenster(trocken=True)
    raus = {'dialog_da': False, 'dialog_text': []}
    takt = sdstart.Fenster.TAKT_MS

    def umstecken():
        global ANGESTECKT
        ANGESTECKT = list(dann)

    def klicken():
        f.knopf._klick(None)          # genau der Weg des Mauszeigers

    def lesen():
        for w in f.winfo_children():
            if isinstance(w, tk.Toplevel):
                raus['dialog_da'] = True
                raus['dialog_text'] = [t for _, _, _, t, _ in _baum_texte(w) if t]
                try:
                    w.grab_release()
                except tk.TclError:
                    pass
                w.destroy()
        f.destroy()

    f.after(600, f._seite_karte)
    f.after(600 + 3 * takt, umstecken)
    f.after(600 + 7 * takt, klicken)
    f.after(600 + 9 * takt, lesen)
    f.mainloop()
    return raus


def _baum_texte(w, tiefe=0, raus=None):
    raus = [] if raus is None else raus
    try:
        t = w.cget('text')
    except Exception:                                        # noqa: BLE001
        t = ''
    raus.append((tiefe, w.winfo_class(), type(w).__name__, str(t or ''), None))
    for k in w.winfo_children():
        _baum_texte(k, tiefe + 1, raus)
    return raus


if __name__ == '__main__':
    sys.exit(main())
