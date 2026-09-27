#!/usr/bin/env python3
"""Was heisst auf DIESER Box „blaettern"? — aus dem Verlauf abgelesen (E73).

    python3 blaettern-messen.py                    # alle Profile
    python3 blaettern-messen.py --profil kalea

Muss dort laufen, wo die Verlaufsdateien liegen (auf der Box unter
`server/config/profile/<name>/verlauf.json`).

══ WOZU ═══════════════════════════════════════════════════════════════════

E73 will beim Titelwechsel entscheiden: aufzeichnen, verwerfen — oder gar
nichts tun, weil das Kind gerade BLAETTERT. Betreiber, 20.08.2026: „wenn man
schnell springt waere ein wechsel jedesmal fatal."

Die Regel dahinter ist einfach: wer springt, hoert nicht — und was niemand
hoert, muss auch nicht aufgezeichnet werden. Offen ist nur die Zahl: ab wann
gilt ein Wechsel als Blaettern?

DIESE ZAHL GEHOERT NICHT GERATEN. Die Box schreibt seit Wochen mit, wie ihre
Kinder sie bedienen — je Titel `beginn`, `ende` und `sekunden`. Wer stattdessen
„unter 10 Sekunden ist Blaettern" in den Code schreibt, hat eine Zahl erfunden
und wird sie nie wieder anfassen.

══ WAS ES ZEIGT ═══════════════════════════════════════════════════════════

  * die VERTEILUNG der Hoerdauern — wo liegt der natuerliche Bruch zwischen
    „angehoert und weggetippt" und „wirklich gehoert"?
  * REIHEN kurzer Titel hintereinander. Ein einzelner kurzer Titel ist ein
    Versehen; fuenf hintereinander sind ein Kind, das sucht.
  * je Schwelle: wie viele Titel faellen darunter, und wie viele REIHEN
    entstehen. Daran laesst sich ablesen, welche Schwelle das Verhalten trifft
    statt es zu zerschneiden.

══ WAS ES NICHT TUT ═══════════════════════════════════════════════════════

Es waehlt die Schwelle nicht aus. Es legt die Verteilung hin; die Entscheidung
gehoert einem Menschen, der seine Kinder kennt.
"""
import argparse
import collections
import json
import pathlib
import sys

VORGABE = '/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config'


def eintraege_lesen(datei):
    """Die Liste aus einer verlauf.json — egal ob Liste oder Umschlag."""
    try:
        d = json.loads(pathlib.Path(datei).read_text(encoding='utf-8', errors='replace'))
    except (OSError, json.JSONDecodeError):
        return []
    if isinstance(d, list):
        roh = d
    elif isinstance(d, dict):
        roh = d.get('eintraege') or next((v for v in d.values() if isinstance(v, list)), [])
    else:
        return []
    aus = []
    for e in roh:
        if not isinstance(e, dict):
            continue
        s = e.get('sekunden')
        if not isinstance(s, (int, float)) or s < 0:
            continue
        aus.append({
            'sek': float(s),
            'beginn': e.get('beginn') or 0,
            'titel': str(e.get('titel') or '?'),
            'dienst': str(e.get('dienst') or '?'),
        })
    # NACH BEGINN SORTIERT, nicht nach Dateireihenfolge: die Reihen unten
    # haengen an der zeitlichen Abfolge, und eine Datei kann anders sortiert
    # sein, als sie geschrieben wurde.
    return sorted(aus, key=lambda x: x['beginn'])


def reihen(liste, schwelle):
    """Wie viele Titel hintereinander lagen unter der Schwelle?"""
    laengen, lauf = [], 0
    for e in liste:
        if e['sek'] < schwelle:
            lauf += 1
        else:
            if lauf:
                laengen.append(lauf)
            lauf = 0
    if lauf:
        laengen.append(lauf)
    return laengen


def balken(n, groesste, breite=34):
    return '█' * max(1, round(n / groesste * breite)) if n else ''


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--ordner', default=VORGABE)
    p.add_argument('--profil', help='nur dieses Profil')
    a = p.parse_args()

    wurzel = pathlib.Path(a.ordner) / 'profile'
    if not wurzel.is_dir():
        sys.exit('kein Profilordner unter %s' % wurzel)

    alle = []
    print('Was heisst hier „blaettern"? — aus dem Verlauf\n')
    for ordner in sorted(wurzel.iterdir()):
        if a.profil and ordner.name != a.profil:
            continue
        e = eintraege_lesen(ordner / 'verlauf.json')
        if not e:
            continue
        print('  %-10s %4d Titel' % (ordner.name, len(e)))
        alle += e

    if not alle:
        sys.exit('\nKein Verlauf gefunden — dann gibt es hier nichts zu messen.')

    print('\n══ VERTEILUNG DER HOERDAUERN (%d Titel) ══' % len(alle))
    faecher = [(0, 5), (5, 10), (10, 20), (20, 30), (30, 60), (60, 120), (120, 300), (300, 10**9)]
    zaehler = collections.Counter()
    for e in alle:
        for u, o in faecher:
            if u <= e['sek'] < o:
                zaehler[(u, o)] += 1
                break
    groesste = max(zaehler.values()) if zaehler else 1
    for u, o in faecher:
        n = zaehler[(u, o)]
        name = '%d–%d s' % (u, o) if o < 10**9 else 'ab %d s' % u
        print('  %-10s %4d  %5.1f %%  %s' % (name, n, n / len(alle) * 100, balken(n, groesste)))

    print('\n══ JE SCHWELLE: was faellt darunter, und welche REIHEN entstehen ══')
    print('  %-9s %6s %7s   %s' % ('Schwelle', 'Titel', 'Anteil', 'Reihen (Laenge x Anzahl)'))
    for s in (5, 10, 15, 20, 30, 45, 60):
        drunter = sum(1 for e in alle if e['sek'] < s)
        r = reihen(alle, s)
        lang = collections.Counter(x for x in r if x >= 2)
        text = ', '.join('%dx%d' % (l, n) for l, n in sorted(lang.items())) or '(keine Reihe ab 2)'
        print('  < %-7s %6d %6.1f %%   %s' % ('%d s' % s, drunter, drunter / len(alle) * 100, text))

    print('\n══ DIE LAENGSTEN REIHEN (Schwelle 20 s) ══')
    r = reihen(alle, 20)
    if r:
        print('  laengste Reihe: %d Titel hintereinander unter 20 s' % max(r))
        print('  Reihen ab 3:    %d' % sum(1 for x in r if x >= 3))
    else:
        print('  keine')

    print()
    print('DIE SCHWELLE WAEHLT DIESES WERKZEUG NICHT. Es zeigt, wo der Bruch')
    print('liegt — die Entscheidung gehoert jemandem, der die Kinder kennt.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
