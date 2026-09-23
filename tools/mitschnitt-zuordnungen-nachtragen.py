#!/usr/bin/env python3
"""Bestands-Kacheln des Mitschnitts ihrer Spotify-Quelle FESTSCHREIBEN.

══ WOFUER (29.08.2026, E93-Abschluss) ══════════════════════════════════════
Seit heute schreibt der Mitschnitt beim Anlegen jeder neuen Kachel die
Verschmelzungs-Zuordnung zu seiner Spotify-Quelle fest (W2). Die
BESTANDS-Kacheln entstanden davor — ihre Paare haelt nur die Heuristik, und
die zerbricht an Umbenennungen und an der Dateinamen-Bereinigung
(`_` statt `:` und `/`, gemessen mit tools/mitschnitt-zeichen-probe.py).

Dieses Werkzeug holt /api/medien der Box, paart jede lokale Kachel mit
ihrer Spotify-Zeile und schreibt die Zuordnung ueber den Endpunkt
POST /api/verschmelzung/festschreiben fest. Der Endpunkt ist idempotent
und respektiert `getrennt` — ein zweiter Lauf aendert nichts, eine bewusst
getrennte Zuordnung wird nicht wiederbelebt.

Gepaart wird konservativ, in dieser Reihenfolge:
  1. gleiche `gruppe` (die Anzeige haelt sie schon zusammen),
  2. gleicher normalisierter Name, wobei `_` der lokalen Kachel als
     Platzhalter fuer die im Dateinamen verbotenen Zeichen gilt.
Alles andere bleibt liegen und wird genannt — lieber ein ungepaartes Werk
als eine falsche Ehe.

══ AUFRUF ══════════════════════════════════════════════════════════════════
    python3 tools/mitschnitt-zuordnungen-nachtragen.py --probe   # nur zeigen
    python3 tools/mitschnitt-zuordnungen-nachtragen.py           # festschreiben
    …                                          --box <host>      # Vorgabe mixpibox.local

Rueckgabe: 0 = alles festgeschrieben (oder nichts zu tun), 1 = mindestens
ein Fehlschlag beim Festschreiben, 2 = Box nicht erreichbar.
"""

import json
import sys
import unicodedata
import urllib.request


def normal(s: str, lokal: bool = False) -> str:
    s = unicodedata.normalize('NFKC', s or '').casefold()
    s = s.replace('ß', 'ss').replace('’', "'").replace('–', '-').replace('—', '-')
    if lokal:
        # `_` steht in Mitschnitt-Namen fuer ein im Dateinamen verbotenes
        # Zeichen — fuer den Vergleich zaehlt es wie dessen Luecke.
        s = s.replace('_', ' ')
    s = s.replace(':', ' ').replace('/', ' ')
    return ' '.join(s.split())


def main() -> int:
    args = sys.argv[1:]
    box = args[args.index('--box') + 1] if '--box' in args else 'mixpibox.local'
    probe = '--probe' in args

    try:
        with urllib.request.urlopen(f'http://{box}:8200/api/medien', timeout=10) as a:
            d = json.load(a)
    except Exception as e:
        print(f'Box nicht erreichbar ({e})')
        return 2

    zeilen = d.get('eintraege') if isinstance(d, dict) else d
    zeilen = zeilen or []
    lokale = [z for z in zeilen if str(z.get('dienst') or '') in ('lokal', 'library')
              or str(z.get('type') or '') == 'library']
    spotify = [z for z in zeilen if str(z.get('dienst') or z.get('type') or '').startswith('spotify')]
    print(f'{len(zeilen)} Zeilen, {len(lokale)} lokal, {len(spotify)} spotify')

    fehl = 0
    paare = 0
    for lok in lokale:
        partner = None
        if lok.get('gruppe'):
            partner = next((s for s in spotify if s.get('gruppe') == lok.get('gruppe')), None)
        if partner is None:
            ln = (normal(str(lok.get('title') or ''), lokal=True),
                  normal(str(lok.get('artist') or ''), lokal=True))
            kandidaten = [s for s in spotify
                          if (normal(str(s.get('title') or '')), normal(str(s.get('artist') or ''))) == ln]
            if len(kandidaten) == 1:
                partner = kandidaten[0]
            elif len(kandidaten) > 1:
                print(f'MEHRDEUTIG, bleibt liegen: "{lok.get("title")}" ({len(kandidaten)} Spotify-Kandidaten)')
                continue
        if partner is None:
            continue
        paare += 1
        sk, lk = str(partner.get('schluessel')), str(lok.get('schluessel'))
        if probe:
            print(f'WUERDE festschreiben: {sk}  <->  {lk}  ("{partner.get("title")}")')
            continue
        rumpf = json.dumps({'schluessel': sk, 'auch': lk}).encode()
        anfrage = urllib.request.Request(
            f'http://{box}:8200/api/verschmelzung/festschreiben',
            data=rumpf, headers={'Content-Type': 'application/json'}, method='POST')
        try:
            with urllib.request.urlopen(anfrage, timeout=10) as a:
                antwort = json.load(a)
            print(f'festgeschrieben: {sk} <-> {lk} ({antwort if isinstance(antwort, str) else "ok"})')
        except Exception as e:
            fehl += 1
            print(f'FEHLGESCHLAGEN: {sk} <-> {lk}: {e}')

    print(f'\n{paare} Paar(e) {"gefunden" if probe else "bearbeitet"}, {fehl} Fehlschlag/-schlaege.')
    return 1 if fehl else 0


if __name__ == '__main__':
    sys.exit(main())
