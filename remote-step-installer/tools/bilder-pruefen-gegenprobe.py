#!/usr/bin/env python3
"""GEGENPROBE ZU `sdstart-bilder.py --pruefen` — sieht der Waechter weg?

══ WOZU ═══════════════════════════════════════════════════════════════════
`sdstart-bilder.py --pruefen` ist der EINZIGE Waechter darueber, ob die
ausgelieferten Bilder in remote-step-installer/dateien/ noch zu ihren Quellen
in NewDesign/bilder/quellen/ passen. Der Rauchtest (tests/sdstart_smoke.py)
prueft die Bilder nicht — nachgesehen am 10.08.2026, dort steht kein
einziger Bildpfad.

Ein Waechter, der nur „gruen" sagen kann, ist keiner. Also wird er hier
ABSICHTLICH KAPUTTGEMACHT und nachgesehen, ob er das merkt:

  Fall 0  nichts angefasst          -> muss GRUEN sein  (sonst ist der Baum
                                        schon schief und alles andere wertlos)
  Fall 1  eine Bildquelle fehlt     -> muss ROT sein
  Fall 2  Zielgroesse veraendert    -> muss ROT sein  (beweist: der Vergleich
                                        FUNKTIONIERT, ein Gruen anderswo ist
                                        also eine echte Aussage, kein Defekt
                                        der Versuchsanordnung)
  Fall 3  Symbolquelle fehlt        -> muss ROT sein
  Fall 4  Freistellen misslingt     -> muss ROT sein  (der Windows-Fall: dort
                                        heisst das Programm nicht `python3`)

„ROT" heisst: Rueckgabewert != 0, also `sys.exit(1)` im Aufruf.

══ WIE ═══════════════════════════════════════════════════════════════════
Es wird NICHTS im Arbeitsbaum umbenannt oder geloescht. Die Faelle werden
im Speicher gestellt (BILDER-Tabelle, SYMBOL_QUELLE, WURZEL) und danach
zurueckgesetzt. Der Baum ist nach dem Lauf Byte fuer Byte der von vorher —
`git status` bleibt sauber.

══ AUFRUF ════════════════════════════════════════════════════════════════
    python3 remote-step-installer/tools/bilder-pruefen-gegenprobe.py

Dauert rund eine Minute: drei der fuenf Faelle bauen alle acht Bilder neu.
"""
import contextlib
import importlib.util
import io
import pathlib
import sys
import tempfile

HIER = pathlib.Path(__file__).resolve().parent
ZIEL_WERKZEUG = HIER / 'sdstart-bilder.py'


def modul_laden():
    """sdstart-bilder.py als Modul laden — der Bindestrich verbietet `import`."""
    spec = importlib.util.spec_from_file_location('sdstart_bilder', ZIEL_WERKZEUG)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def lauf(mod, stellen=None):
    """pruefen() einmal laufen lassen, Ausgabe einfangen, danach aufraeumen.

    `stellen` bekommt das Modul und darf daran drehen; was es zurueckgibt, ist
    die Funktion, die den Zustand wieder herstellt.
    """
    zurueck = stellen(mod) if stellen else (lambda: None)
    puffer = io.StringIO()
    try:
        with contextlib.redirect_stdout(puffer):
            rc = mod.pruefen()
    finally:
        zurueck()
    return rc, puffer.getvalue()


# ── die fuenf Faelle ────────────────────────────────────────────────────────

def fall_quelle_fehlt(mod):
    alt = dict(mod.BILDER)
    datei, breite = mod.BILDER['lauf']
    mod.BILDER['lauf'] = (datei.replace('.png', 'X.png'), breite)
    def zurueck():
        mod.BILDER.clear()
        mod.BILDER.update(alt)
    return zurueck


def fall_groesse_anders(mod):
    alt = dict(mod.BILDER)
    datei, breite = mod.BILDER['lauf']
    mod.BILDER['lauf'] = (datei, breite - 30)
    def zurueck():
        mod.BILDER.clear()
        mod.BILDER.update(alt)
    return zurueck


def fall_symbol_fehlt(mod):
    alt = mod.SYMBOL_QUELLE
    mod.SYMBOL_QUELLE = alt.replace('.png', 'X.png')
    def zurueck():
        mod.SYMBOL_QUELLE = alt
    return zurueck


def fall_freistellen_kaputt(mod):
    """Der Windows-/macOS-Fall: `bilder-freistellen.py` ist nicht erreichbar.

    WURZEL wird auf ein leeres Verzeichnis gebogen. QUELLEN und ZIEL sind
    beim Laden des Moduls schon berechnet und bleiben daher richtig — nur der
    Pfad zum Freistell-Werkzeug (in bauen() zur Laufzeit gebildet) geht ins
    Leere, genau wie auf einem Rechner ohne `python3` im Pfad.
    """
    alt = mod.WURZEL
    halter = tempfile.TemporaryDirectory()
    mod.WURZEL = pathlib.Path(halter.name)
    def zurueck():
        mod.WURZEL = alt
        halter.cleanup()
    return zurueck


FAELLE = [
    ('0  nichts angefasst',            None,                    False),
    ('1  Bildquelle fehlt',            fall_quelle_fehlt,       True),
    ('2  Zielgroesse veraendert',      fall_groesse_anders,     True),
    ('3  Symbolquelle fehlt',          fall_symbol_fehlt,       True),
    ('4  Freistellen misslingt',       fall_freistellen_kaputt, True),
]


def main() -> int:
    mod = modul_laden()
    print(f'Werkzeug: {ZIEL_WERKZEUG}')
    print(f'Vergleicht gegen: {mod.ZIEL}\n')

    schlecht = 0
    for titel, stellen, soll_rot in FAELLE:
        rc, text = lauf(mod, stellen)
        letzte = [z for z in text.strip().splitlines() if z.strip()][-1]
        fehlt = [z.strip() for z in text.splitlines() if 'FEHLT' in z]
        geprueft = len([z for z in text.splitlines()
                        if z.startswith('ok    sdstart') or z.startswith('NEIN')])
        ist_rot = rc != 0

        stimmt = ist_rot == soll_rot
        schlecht += 0 if stimmt else 1
        marke = 'WIE ERWARTET' if stimmt else '>>> SIEHT WEG <<<'
        print(f'── Fall {titel}')
        print(f'   erwartet: {"ROT" if soll_rot else "GRUEN"}   '
              f'bekommen: {"ROT" if ist_rot else "GRUEN"} (rc={rc}, '
              f'Aufruf endet mit {1 if rc else 0})   {marke}')
        for z in fehlt:
            print(f'   Warnung im Text: {z}')
        print(f'   verglichene Dateien: {geprueft}')
        print(f'   letzte Zeile: {letzte!r}\n')

    print('═' * 74)
    if schlecht:
        print(f'{schlecht} Fall/Faelle: der Waechter meldet GRUEN, obwohl etwas fehlt.')
    else:
        print('Alle Faelle wie erwartet — der Waechter merkt jeden Schaden.')
    return schlecht


if __name__ == '__main__':
    sys.exit(1 if main() else 0)
