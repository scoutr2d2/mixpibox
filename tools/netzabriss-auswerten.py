#!/usr/bin/env python3
"""Das Funkbild-Protokoll der Netzabriss-Sonde auswerten — Abrisse, Drossel, Muster.

══ WOFUER (30.08.2026) ═════════════════════════════════════════════════════
Die Box fiel den ganzen Tag im Minutentakt kurz aus dem Netz (SSH und
HTTP gleichermassen „No route to host"), waehrend die Sonde auf der Box
alle 5 s ihr Funkbild schrieb (/home/dietpi/netzabriss/sonde.log, eine
JSON-Zeile je Messung: t, wlan.verbunden, ping [ms], bt.senke,
strom.throttled [Pi-Drosselregister], vbat, last).

Diese Auswertung stellt die Fragen, die von Hand muehsam sind:
  1. ABRISSE: Wo klaffen Luecken in der t-Folge (Sonde kam nicht zum
     Schreiben = Box hing/stromlos), und wo scheiterte der Ping?
  2. DROSSEL: Wann stand das throttled-Register auf „gerade aktiv"
     (niedrige Bits) statt nur „war mal" (occurred-Bits 16+)?
  3. MUSTER: Haeufen sich Abrisse zu Zeiten hoher Last / aktiver
     Drossel / aktiver Bluetooth-Senke?

══ AUFRUF ══════════════════════════════════════════════════════════════════
    python3 tools/netzabriss-auswerten.py <sonde.log> [--seit HH:MM]

Rueckgabe: 0 (reine Auskunft).
"""

import json
import sys
import time
from collections import Counter


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    pfad = sys.argv[1]
    seit = 0.0
    if '--seit' in sys.argv:
        hhmm = sys.argv[sys.argv.index('--seit') + 1]
        h, m = hhmm.split(':')
        lokal = time.localtime()
        seit = time.mktime((lokal.tm_year, lokal.tm_mon, lokal.tm_mday,
                            int(h), int(m), 0, 0, 0, -1))

    zeilen = []
    kaputt = 0
    with open(pfad, encoding='utf-8') as f:
        for z in f:
            try:
                d = json.loads(z)
                if d.get('t', 0) >= seit:
                    zeilen.append(d)
            except json.JSONDecodeError:
                kaputt += 1
    if not zeilen:
        print('keine Zeilen im Fenster')
        return 0

    def uhr(t: float) -> str:
        return time.strftime('%H:%M:%S', time.localtime(t))

    print(f'{len(zeilen)} Messungen von {uhr(zeilen[0]["t"])} bis {uhr(zeilen[-1]["t"])}'
          + (f' ({kaputt} unlesbare Zeilen)' if kaputt else ''))

    # ── 1. Luecken in der t-Folge (Sonde schrieb nicht = Box weg/hing) ──
    luecken = []
    for a, b in zip(zeilen, zeilen[1:]):
        abstand = b['t'] - a['t']
        if abstand > 12:  # Takt ist 5 s; >12 s heisst mindestens eine Messung fehlt
            luecken.append((a['t'], abstand))
    print(f'\n── Luecken in der Messfolge (Box hing / stromlos / Sonde verdraengt) ──')
    print(f'{len(luecken)} Luecke(n) ueber 12 s')
    for t0, dauer in luecken[-15:]:
        print(f'  {uhr(t0)}  {dauer:6.0f} s still')

    # ── 2. Ping-Ausfaelle und -Spitzen ──
    ohne_ping = [z for z in zeilen if z.get('ping') in (None, False)]
    spitzen = [z for z in zeilen if isinstance(z.get('ping'), (int, float)) and z['ping'] > 100]
    print(f'\n── Ping ──')
    print(f'{len(ohne_ping)} Messungen ohne Antwort, {len(spitzen)} Spitzen ueber 100 ms')
    for z in spitzen[-8:]:
        print(f'  {uhr(z["t"])}  {z["ping"]:7.1f} ms  last={z.get("last")}')

    # ── 3. Drosselregister ──
    aktiv = [z for z in zeilen if int(str(z.get('strom', {}).get('throttled', '0')), 16) & 0xF]
    formen = Counter(str(z.get('strom', {}).get('throttled')) for z in zeilen)
    print(f'\n── Drossel (throttled-Register) ──')
    print(f'{len(aktiv)} Messungen mit GERADE aktiver Drossel/Unterspannung (Bits 0-3)')
    for wert, anzahl in formen.most_common(6):
        print(f'  {wert:>8}  {anzahl:5d}x')
    if aktiv:
        print('  zuletzt aktiv:', uhr(aktiv[-1]['t']), aktiv[-1]['strom']['throttled'])

    # ── 4. Muster: was war los, als es still wurde? ──
    print(f'\n── Muster um die Luecken (letzte Messung davor) ──')
    bt_dabei = 0
    drossel_dabei = 0
    hohe_last = 0
    for t0, _ in luecken:
        davor = next((z for z in reversed(zeilen) if z['t'] <= t0), None)
        if not davor:
            continue
        if davor.get('bt', {}).get('senke'):
            bt_dabei += 1
        if int(str(davor.get('strom', {}).get('throttled', '0')), 16) & 0xF:
            drossel_dabei += 1
        if (davor.get('last') or 0) > 2.5:
            hohe_last += 1
    if luecken:
        print(f'  Bluetooth-Senke an:   {bt_dabei}/{len(luecken)}')
        print(f'  Drossel gerade aktiv: {drossel_dabei}/{len(luecken)}')
        print(f'  Last ueber 2.5:       {hohe_last}/{len(luecken)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
