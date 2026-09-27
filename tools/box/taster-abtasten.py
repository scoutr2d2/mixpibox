#!/usr/bin/env python3
"""Was meldet die Taster-Wache, waehrend jemand den Knopf haelt?

    python3 taster-abtasten.py            # 10 s lang abtasten
    python3 taster-abtasten.py --sek 6

Muss AUF DER BOX laufen. Es fasst nichts an — es liest nur die Zustandsdatei,
die `taster_wache.py` schreibt.

══ WOFUER ════════════════════════════════════════════════════════════════

Betreiber, 20.08.2026: „die zeit die ich einstelle hat keinen effekt". Die
Kette vom Knopf bis zum Abschalten hat vier Glieder:

    Knopf -> GPIO17 -> taster_wache.py -> /run/mupibox/taster.zustand
                                              -> off_trigger.sh

`off_trigger.sh` protokolliert nur, was es aus der DATEI liest. Meldet es
„Button released after 1766 ms", waehrend jemand vier Sekunden gehalten hat,
steht damit noch nicht fest, WO es verlorengeht: an der Mechanik, am GPIO, in
der Wache oder in der Auswertung. Dieses Werkzeug schneidet die Kette an der
Datei auf und beantwortet genau ein Glied davon.

══ DIE ZAHL, AUF DIE ES ANKOMMT ══════════════════════════════════════════

Nicht „war gedrueckt: ja/nein", sondern die LAENGSTE ZUSAMMENHAENGENDE
Strecke, auf der die Wache „gedrueckt" meldet. Denn genau daran scheitert die
Abschaltung: `off_trigger.sh` bricht beim ERSTEN „losgelassen" ab. Eine
Meldung, die alle zwei Sekunden kurz auf „losgelassen" springt, macht jede
eingestellte Frist ueber zwei Sekunden unerreichbar — und dann bleibt nur noch
der harte 6-Sekunden-Riegel des MuPiHAT, der von der Einstellung nichts weiss.

══ VORSICHT ══════════════════════════════════════════════════════════════

NICHT LAENGER ALS ETWA VIER SEKUNDEN HALTEN. Das MuPiHAT nimmt bei rund sechs
Sekunden den Strom hart weg, unabhaengig von jeder Software.
"""
import argparse
import pathlib
import sys
import time

DATEI = pathlib.Path('/run/mupibox/taster.zustand')
TAKT_S = 0.01


def stand_lesen():
    """0 = gedrueckt, 1 = losgelassen, None = nicht lesbar."""
    try:
        roh = DATEI.read_text(errors='replace').strip()
    except OSError:
        return None
    return roh if roh in ('0', '1') else None


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--sek', type=float, default=10.0, help='Messdauer (Vorgabe 10)')
    a = p.parse_args()

    if not DATEI.exists():
        sys.exit('%s gibt es nicht — laeuft taster_wache.py?' % DATEI)

    print('Ich taste %.0f s lang ab, %.0f mal je Sekunde.' % (a.sek, 1 / TAKT_S))
    print('JETZT den Knopf druecken und halten — aber HOECHSTENS ~4 Sekunden.')
    print('(Bei ~6 s nimmt das MuPiHAT den Strom hart weg.)\n')
    print('  %7s  %-12s %s' % ('sek', 'Wache sagt', 'Dauer der vorigen Strecke'))

    beginn = time.monotonic()
    letzter = None
    seit = beginn
    strecken = []
    unlesbar = 0

    while time.monotonic() - beginn < a.sek:
        jetzt = stand_lesen()
        if jetzt is None:
            unlesbar += 1
        if jetzt != letzter:
            t = time.monotonic()
            if letzter is not None:
                dauer = t - seit
                strecken.append((letzter, dauer))
                print('  %7.2f  %-12s %.0f ms' % (t - beginn, benennen(jetzt), dauer * 1000))
            else:
                print('  %7.2f  %-12s —' % (t - beginn, benennen(jetzt)))
            letzter, seit = jetzt, t
        time.sleep(TAKT_S)

    if letzter is not None:
        strecken.append((letzter, time.monotonic() - seit))

    print('\n══ BEFUND ══════════════════════════════════════════════════')
    gedrueckt = [d for s, d in strecken if s == '0']
    if not gedrueckt:
        print('Die Wache hat in diesem Fenster NIE „gedrueckt" gemeldet.')
        print('Entweder wurde nicht gedrueckt, oder es kommt gar nicht an.')
    else:
        print('Strecken „gedrueckt": %d' % len(gedrueckt))
        print('LAENGSTE zusammenhaengende: %.0f ms' % (max(gedrueckt) * 1000))
        if len(gedrueckt) > 1:
            print()
            print('MEHR ALS EINE — die Meldung ist waehrend des Haltens')
            print('zwischendurch auf „losgelassen" gesprungen. off_trigger.sh')
            print('bricht beim ERSTEN „losgelassen" ab; jede eingestellte Frist')
            print('oberhalb der laengsten Strecke ist damit unerreichbar.')
        print()
        print('Eine eingestellte Haltedauer wirkt nur, wenn sie UNTER der')
        print('laengsten Strecke liegt — und unter den 6 s des MuPiHAT.')
    if unlesbar:
        print('\n%d Proben waren nicht lesbar (Datei kurz weg?).' % unlesbar)
    return 0


def benennen(x):
    return {'0': 'gedrueckt', '1': 'losgelassen'}.get(x, 'unlesbar')


if __name__ == '__main__':
    sys.exit(main())
