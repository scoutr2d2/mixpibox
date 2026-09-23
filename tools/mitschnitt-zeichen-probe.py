#!/usr/bin/env python3
"""Tragen die Mitschnitt-Kacheln DIESELBEN ZEICHEN wie ihre Spotify-Quelle?

══ WOFUER (29.08.2026, Betreiberfrage) ═════════════════════════════════════
„noch zu pruefen ist ausserdem ob die aufnahmen die gleiche zeichen haben."
Die Mitschnitt-Flotte legt je aufgenommenem Spotify-Album eine lokale Kachel
an (plugins/mixpi-mitschnitt, kachelAnlegen). Ob die Verschmelzungs-Heuristik
das Paar zusammenhaelt, haengt an den ZEICHEN von Titel und Interpret — und
genau dort lauern Unterschiede, die kein Auge sieht:

  * ss statt scharfem s (die normal()-Falle, Wiki
    normal-macht-aus-scharfem-s-eine-luecke),
  * Unicode-Zerlegung (ein Umlaut als EIN Zeichen oder als Grundbuchstabe
    plus Trema — NFC gegen NFD, sieht identisch aus),
  * gebrochene Leerzeichen (NBSP, schmales NBSP) und Nullbreiten-Zeichen,
  * Anfuehrungs- und Strichvarianten (Apostroph vs. Hochkomma,
    Bindestrich vs. Gedankenstrich),
  * blosse Gross-/Kleinschreibung.

Die Probe holt /api/medien der Box, sucht zu jeder LOKALEN Zeile die
Spotify-Zeile desselben Werks (erst uebers Gruppenfeld, sonst ueber den
normalisierten Namen) und vergleicht die ROHEN Zeichen. Der Befund je Paar:

  ZEICHENGLEICH      nichts zu tun
  NUR-FORM           unsichtbare Differenz (Klasse wird genannt) — genau die
                     Sorte, die die Heuristik still zerlegt
  UMBENANNT          sichtbar verschieden (bewusste Umbenennung — kein
                     Fehler, aber der Grund, warum nur eine FESTGESCHRIEBENE
                     Zuordnung traegt)

══ AUFRUF ══════════════════════════════════════════════════════════════════
    python3 tools/mitschnitt-zeichen-probe.py                # mixpibox.local
    python3 tools/mitschnitt-zeichen-probe.py --box <host>
    python3 tools/mitschnitt-zeichen-probe.py --datei antwort.json  # offline

Rueckgabe: 0 = keine NUR-FORM-Paare, 1 = mindestens eines (die Sorte, die
man beheben will), 2 = Box nicht erreichbar.
"""

import json
import sys
import unicodedata
import urllib.request

UNSICHTBAR = {
    ' ': 'NBSP',
    ' ': 'schmales NBSP',
    '​': 'Nullbreite',
    '’': 'typogr. Apostroph',
    '–': 'Gedankenstrich',
    '—': 'langer Strich',
}


def normal(s: str) -> str:
    """Grob genug fuer die Paarung — bewusst NICHT die Server-Heuristik.

    NFKC macht NBSP-Varianten bereits zu Leerzeichen; uebrig bleiben die
    Nullbreite und die Zeichen-VARIANTEN (Apostroph, Striche, scharfes s).
    """
    s = unicodedata.normalize('NFKC', s or '').casefold()
    s = s.replace('​', '')
    s = s.replace('ß', 'ss').replace('’', "'").replace('–', '-').replace('—', '-')
    return ' '.join(s.split())


def klassen(a: str, b: str) -> list[str]:
    """Welche unsichtbaren Klassen unterscheiden a und b?"""
    funde = []
    if unicodedata.normalize('NFC', a) == unicodedata.normalize('NFC', b) and a != b:
        funde.append('NFC/NFD-Zerlegung')
    if a.casefold() == b.casefold() and unicodedata.normalize('NFC', a) != unicodedata.normalize('NFC', b):
        funde.append('Gross/Klein')
    if a.replace('ß', 'ss') == b.replace('ß', 'ss') and a != b:
        funde.append('scharfes s / ss')
    for z, name in UNSICHTBAR.items():
        if (z in a) != (z in b):
            funde.append(name)
    return funde


def erste_differenz(a: str, b: str) -> str:
    for i, (x, y) in enumerate(zip(a, b)):
        if x != y:
            return f'ab Stelle {i}: U+{ord(x):04X} gegen U+{ord(y):04X}'
    return f'Laenge {len(a)} gegen {len(b)}'


def holen(quelle: str) -> dict:
    if quelle.startswith('datei:'):
        with open(quelle[6:], encoding='utf-8') as f:
            return json.load(f)
    with urllib.request.urlopen(f'http://{quelle}:8200/api/medien', timeout=10) as a:
        return json.load(a)


def main() -> int:
    args = sys.argv[1:]
    quelle = 'mixpibox.local'
    if '--box' in args:
        quelle = args[args.index('--box') + 1]
    if '--datei' in args:
        quelle = 'datei:' + args[args.index('--datei') + 1]
    try:
        d = holen(quelle)
    except Exception as e:
        print(f'Box nicht erreichbar ({e})')
        return 2

    zeilen = d.get('eintraege') if isinstance(d, dict) else d
    zeilen = zeilen or []
    lokale = [z for z in zeilen if str(z.get('dienst') or '') in ('lokal', 'library')
              or str(z.get('type') or '') == 'library']
    spotify = [z for z in zeilen if str(z.get('dienst') or z.get('type') or '').startswith('spotify')]

    print(f'{len(zeilen)} Zeilen, davon {len(lokale)} lokal und {len(spotify)} spotify\n')
    nur_form = 0
    for lok in lokale:
        lt, li = str(lok.get('title') or ''), str(lok.get('artist') or '')
        partner = None
        gruppe = lok.get('gruppe')
        if gruppe:
            partner = next((s for s in spotify if s.get('gruppe') == gruppe), None)
        if partner is None:
            partner = next((s for s in spotify
                            if normal(str(s.get('title') or '')) == normal(lt)
                            and normal(str(s.get('artist') or '')) == normal(li)), None)
        if partner is None:
            continue
        st, si = str(partner.get('title') or ''), str(partner.get('artist') or '')
        for feld, a, b in (('titel', lt, st), ('interpret', li, si)):
            if a == b:
                continue
            kl = klassen(a, b)
            if kl:
                nur_form += 1
                print(f'NUR-FORM  {feld}: "{a}" gegen "{b}"')
                print(f'          Klassen: {", ".join(kl)} | {erste_differenz(a, b)}')
            else:
                print(f'UMBENANNT {feld}: "{a}" gegen "{b}"')
    if nur_form == 0:
        print('Keine unsichtbaren Zeichen-Differenzen zwischen lokalen Kacheln und ihren Spotify-Quellen.')
    return 1 if nur_form else 0


if __name__ == '__main__':
    sys.exit(main())
