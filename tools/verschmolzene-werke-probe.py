#!/usr/bin/env python3
"""Sind die verschmolzenen Werke der Box IN ORDNUNG — jedes einmal durchgeklopft.

══ WOFUER (29.08.2026, Betreiberfrage) ═════════════════════════════════════
„sind die fusionierten titel in ordnung?" Eine verschmolzene Kachel ist erst
dann in Ordnung, wenn ihre drei Auskuenfte tragen: das WERK selbst (steht in
/api/werke), sein BILD (/api/bild/<schluessel>) und sein INHALT
(/api/werke/<schluessel>/inhalt — die Titel-/Folgenliste, aus der die
Warteschlange entsteht). Der Science-Cops-Fall hat gezeigt, dass genau die
dritte Auskunft am Fuehrer-Dienst sterben kann (Spotify-404 bei einem
Hoerbuch), waehrend die zweite Quelle laengst liefern wuerde.

Die Probe fragt fuer JEDES Werk mit mehr als einer Quelle alle drei
Auskuenfte ab — den Inhalt einmal ueber den Gruppen-Schluessel (so ruft die
Folgen-Lane) und einmal je uebriger Quelle mit verschmelzen=1&quelle=
(so weicht der Abspielweg aus). So sieht man beides: was heute bricht und
ob der Rueckweg truege.

══ AUFRUF ══════════════════════════════════════════════════════════════════
    python3 tools/verschmolzene-werke-probe.py                # mixpibox.local
    python3 tools/verschmolzene-werke-probe.py --box <host>

Rueckgabe: 0 = jede Auskunft jedes Werks traegt (direkt oder ueber eine
Quelle), 1 = mindestens ein Werk ohne tragende Auskunft, 2 = Box weg.
"""

import json
import sys
import urllib.parse
import urllib.request

FRIST = 20


def hol(box: str, pfad: str):
    anfrage = urllib.request.Request(f'http://{box}:8200{pfad}')
    try:
        with urllib.request.urlopen(anfrage, timeout=FRIST) as a:
            rumpf = a.read()
            return a.status, a.headers.get_content_type(), rumpf
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get_content_type() if e.headers else '', e.read()
    except Exception as e:
        return 0, '', str(e).encode()


def main() -> int:
    args = sys.argv[1:]
    box = args[args.index('--box') + 1] if '--box' in args else 'mixpibox.local'

    status, _, rumpf = hol(box, '/api/werke?verschmelzen=1')
    if status != 200:
        print(f'Box nicht erreichbar ({status}: {rumpf[:80]!r})')
        return 2
    werke = json.loads(rumpf)
    werke = werke if isinstance(werke, list) else werke.get('werke', [])
    mehrquellig = [w for w in werke if len(w.get('quellen') or []) > 1]
    print(f'{len(werke)} Werke, davon {len(mehrquellig)} mit mehr als einer Quelle\n')

    kaputt = 0
    for w in mehrquellig:
        s = str(w.get('schluessel'))
        enc = urllib.parse.quote(s, safe='')
        bild_status, bild_typ, _ = hol(box, f'/api/bild/{enc}')
        bild = 'ok' if bild_status == 200 and bild_typ.startswith('image/') else f'FEHLT ({bild_status})'

        st, _, rumpf = hol(box, f'/api/werke/{enc}/inhalt')
        try:
            anzahl = len((json.loads(rumpf) or {}).get('titel') or []) if st == 200 else 0
        except Exception:
            anzahl = 0
        direkt = f'{anzahl} Titel' if st == 200 else f'FEHLT ({st}: {rumpf[:60].decode(errors="replace")})'

        wege = []
        if st != 200:
            for q in w.get('quellen') or []:
                d = str(q.get('dienst'))
                st2, _, rumpf2 = hol(box, f'/api/werke/{enc}/inhalt?verschmelzen=1&quelle={urllib.parse.quote(d)}')
                try:
                    n2 = len((json.loads(rumpf2) or {}).get('titel') or []) if st2 == 200 else 0
                except Exception:
                    n2 = 0
                wege.append(f'{d}:{"%d Titel" % n2 if st2 == 200 else "FEHLT (%s)" % st2}')

        traegt = st == 200 or any('Titel' in weg for weg in wege)
        if not traegt or bild.startswith('FEHLT'):
            kaputt += 1
        marke = 'OK  ' if traegt and bild == 'ok' else 'WEH '
        quellen = '+'.join(str(q.get('dienst')) for q in (w.get('quellen') or []))
        print(f'{marke} {str(w.get("titel"))[:44]:44} [{quellen}] bild={bild} inhalt={direkt}'
              + (f' ausweich={" ".join(wege)}' if wege else ''))

    if kaputt == 0:
        print('\nJede Auskunft jedes mehrquelligen Werks traegt.')
    else:
        print(f'\n{kaputt} Werk(e) mit toter Auskunft.')
    return 1 if kaputt else 0


if __name__ == '__main__':
    sys.exit(main())
