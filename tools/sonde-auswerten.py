#!/usr/bin/env python3
"""Die Netzabriss-Sonde auswerten — Wechsel, Neustarts, Kernmeldungen.

    python3 sonde-auswerten.py <sonde.log> [weitere.log ...]
    python3 sonde-auswerten.py --ab 2026-08-20T15:00 sonde.log

Die Sonde (tools/box/netzabriss-sonde.py, als Dienst auf der Box) schreibt je
Takt eine JSON-Zeile. Nach ein paar Tagen sind das zwei Megabyte, und die Frage
ist nie „was steht drin", sondern „WANN hat sich etwas geaendert".

══ WARUM DIESES WERKZEUG UND KEIN tail ════════════════════════════════════

`tail` zeigt den Schluss. Der Schluss einer Sonde, die durchgehend
`verbunden: false` meldet, sieht in jeder Zeile gleich aus — und beantwortet
gerade NICHT die Frage, wann es zuletzt anders war. Genau daran haengt die
Diagnose: ein Abriss hat einen Zeitpunkt, ein Dauerzustand hat einen Beginn.

ES ZEIGT NUR WECHSEL. Tausend gleiche Zeilen sind eine Information, nicht
tausend. Ausgegeben wird deshalb je Zustandswechsel eine Zeile, dazu jeder
Neustart der Sonde (die Box war aus oder wurde neu gestartet) und jede
Kernmeldung, die die Sonde mitgeschnitten hat.

DIE ZEIT KOMMT AUS DER DATEI, nicht von der Uhr dieses Rechners. Die Box hat
keine batteriegepufferte Uhr; sie stellt sie beim Start aus dem Netz. Faellt
das Netz aus, kann die Zeit springen — deshalb wird sie so gezeigt, wie sie
dasteht, und Spruenge werden BENANNT statt geglaettet.
"""
import argparse
import datetime
import json
import pathlib
import sys


def zeit(t):
    try:
        return datetime.datetime.fromtimestamp(float(t)).strftime('%d.%m. %H:%M:%S')
    except (TypeError, ValueError, OSError):
        return '?'


def zustand(z):
    """Der Zustand, auf den es ankommt — als vergleichbares Tupel."""
    wlan = (z.get('wlan') or {}).get('verbunden')
    ping = z.get('ping')
    senke = (z.get('bt') or {}).get('senke')
    return (bool(wlan), ping is not None, bool(senke))


def beschriften(z):
    w, p, s = z
    return 'WLAN %-5s  Ping %-5s  BT-Senke %s' % (
        'ja' if w else 'NEIN',
        'ja' if p else 'nein',
        'ja' if s else 'nein',
    )


def main():
    p = argparse.ArgumentParser()
    p.add_argument('dateien', nargs='+', type=pathlib.Path)
    p.add_argument('--ab', help='nur ab diesem Zeitpunkt, z. B. 2026-08-20T15:00')
    a = p.parse_args()

    ab = None
    if a.ab:
        try:
            ab = datetime.datetime.fromisoformat(a.ab).timestamp()
        except ValueError:
            sys.exit('--ab versteht nur ISO-Zeit, z. B. 2026-08-20T15:00')

    letzter = None
    seit = None
    zeilen = 0
    krumm = 0
    letzte_verbindung = None
    erste_zeit = None
    letzte_zeit = None

    for datei in a.dateien:
        if not datei.exists():
            sys.exit('fehlt: %s' % datei)
        with datei.open(encoding='utf-8', errors='replace') as f:
            for roh in f:
                roh = roh.strip()
                if not roh:
                    continue
                try:
                    z = json.loads(roh)
                except json.JSONDecodeError:
                    # EINE ABGESCHNITTENE ZEILE IST NORMAL: die Sonde kann
                    # mitten im Schreiben gestorben sein (Stromverlust, Karte
                    # gezogen). Gezaehlt, nicht verschwiegen.
                    krumm += 1
                    continue
                zeilen += 1
                t = z.get('t')
                if ab is not None and isinstance(t, (int, float)) and t < ab:
                    continue
                if erste_zeit is None:
                    erste_zeit = t
                letzte_zeit = t

                if z.get('start'):
                    print('%s  ── SONDE GESTARTET (Gateway %s)' % (zeit(t), z.get('gw', '?')))
                    letzter = None  # nach einem Neustart gilt nichts von vorher

                jetzt = zustand(z)
                if jetzt != letzter:
                    dauer = ''
                    if letzter is not None and seit is not None:
                        dauer = '   (vorher %s lang)' % kurz(t - seit)
                    print('%s  %s%s' % (zeit(t), beschriften(jetzt), dauer))
                    letzter = jetzt
                    seit = t
                if jetzt[0]:
                    letzte_verbindung = t

                for k in z.get('kern') or []:
                    print('%s      KERN  %s' % (zeit(t), k))

    print()
    print('%d Zeilen gelesen%s' % (zeilen, ', %d abgeschnitten' % krumm if krumm else ''))
    if erste_zeit and letzte_zeit:
        print('Zeitraum: %s bis %s' % (zeit(erste_zeit), zeit(letzte_zeit)))
    if letzte_verbindung:
        print('ZULETZT VERBUNDEN: %s' % zeit(letzte_verbindung))
    else:
        print('ZULETZT VERBUNDEN: in diesem Ausschnitt NIE — der Abriss begann davor.')


def kurz(sekunden):
    try:
        s = int(sekunden)
    except (TypeError, ValueError):
        return '?'
    if s < 90:
        return '%d s' % s
    if s < 5400:
        return '%d min' % (s // 60)
    return '%.1f h' % (s / 3600)


if __name__ == '__main__':
    main()
