#!/usr/bin/env python3
"""EINEN Eintrag ans Wissenspaket anhaengen — als TEXT, und die Version mitzaehlen.

══ WARUM NICHT tools/wiki-eintragen.py ════════════════════════════════════
Das aeltere Werkzeug laedt das ganze Paket und schreibt es mit `safe_dump`
zurueck. Bei 2,5 MB und 783 Eintraegen formatiert das die GESAMTE Datei neu:
Blockskalare werden zu Anfuehrungszeichen-Zeilen, Umbrueche wandern, und der
Diff eines einzigen neuen Eintrags ist danach vierstellig. Wer den Lauf
gegenlesen will, sieht nichts mehr.

Deshalb haengt dieses Werkzeug den Eintrag WOERTLICH ans Dateiende und
aendert sonst genau eine Zeile: `version:`. Der Diff ist dann so gross wie
der Eintrag.

DIE VERSION MUSS MITZAEHLEN. Der Zwischenspeicher des Karteninstallers
vergleicht sie; ohne Erhoehung haelt er seinen alten Stand fuer aktuell.
Und DREI Prosadateien nennen Zahl und Fassung (`README.md`,
`dokumentation/mixpibox.md`, `dokumentation/benutzerhandbuch.html`) — gesucht
werden sie nicht ueber diese Liste, sondern ueber das Merkmal.
Alle werden nach dem Anhaengen SOFORT nachgezogen (`kopfzeile_nachziehen`,
ueber `tools/paket-angaben-nachziehen.py`) — von Hand ging das reihenweise
schief. `tools/doku-luecken-probe.sh` prueft es weiterhin, kann den Drift
aber nur einen Lauf zu spaet sehen; siehe den Wiki-Eintrag
`kopfzeilenzahl-driftet-weil-die-wache-vor-dem-anhaengen-laeuft`.

══ AUFRUF ═════════════════════════════════════════════════════════════════
    python3 tools/wiki-anhaengen.py eintrag.yaml     # anhaengen
    python3 tools/wiki-anhaengen.py eintrag.yaml -p  # nur pruefen

`eintrag.yaml` enthaelt EINEN Eintrag als Listenglied (beginnt mit `- id:`),
schon auf der Einrueckung, die unter `entries:` gilt — das sind ZWEI
Leerzeichen: `- id:` steht in Spalte 3.

Dieser Absatz behauptete am 31.08.2026 fuer einen halben Tag das Gegenteil
(„NULL Leerzeichen, Spalte 1") und war damit selbst die Falle, vor der er
warnte: Wer sich darauf verliess, bekam einen ParserError ueber 44.000 Zeilen
weiter unten um die Ohren. NACHGEMESSEN am selben Tag, am echten Paket:

    grep -c '^- id:'   -> 0          grep -c '^  - id:' -> 393

Die Datei ist die Wahrheit, nicht dieser Absatz — im Zweifel nachzaehlen,
BEIDE Formen, und der Zahl glauben, nicht dem Satz.
Geprueft wird vor dem Schreiben: laedt das Ergebnis als YAML, ist die `id`
neu, steht `kind` drin, und hat eine `signature` ihr `match`.
"""
import pathlib
import re
import sys

WURZEL = pathlib.Path(__file__).resolve().parent.parent
PACK = WURZEL / 'llmwiki' / 'pack.yaml'


def anhaengen(quelle, trocken=False):
    import yaml
    roh = PACK.read_text(encoding='utf-8')
    neu_text = quelle.read_text(encoding='utf-8').rstrip('\n') + '\n'

    alt = yaml.safe_load(roh)
    version = int(alt['version'])
    ids_vorher = {e.get('id') for e in alt['entries']}

    ergebnis = roh.rstrip('\n') + '\n' + neu_text
    # DIE ZAHL SCHREIBEN, OHNE DIE SCHREIBWEISE ZU RATEN. Bis zum 31.08.2026
    # stand hier nur der Ersatz von `version: "431"` — mit Anfuehrungszeichen.
    # Als eine Sitzung die Zeile unquotiert zurueckliess (`version: 432`), traf
    # das Muster nicht mehr: `str.replace` ohne Treffer wirft nicht, es gibt
    # den Text unveraendert zurueck. Zwei Eintraege wanderten danach unter
    # DERSELBEN Fassung ins Paket, und die Ausgabe meldete trotzdem eine Zahl —
    # sie las die alte wieder aus. Der Zwischenspeicher des Karteninstallers
    # vergleicht genau diese Fassung und haelt seinen Stand fuer aktuell.
    # Jetzt: beide Schreibweisen treffen, und der Erfolg wird NACHGEMESSEN.
    ergebnis, ersetzt = re.subn(rf'^version:\s*"?{version}"?\s*$',
                                f'version: "{version + 1}"', ergebnis, count=1,
                                flags=re.M)
    if ersetzt != 1:
        raise SystemExit(f'  ABBRUCH: die Zeile `version: {version}` war nicht zu finden — '
                         'ohne Erhoehung haelt der Zwischenspeicher seinen alten Stand fuer aktuell')

    # ERST PRUEFEN, DANN SCHREIBEN. Eine kaputte Einrueckung macht das ganze
    # Paket unlesbar — und das faellt sonst erst auf, wenn `rsi diagnose`
    # nichts mehr findet.
    paket = yaml.safe_load(ergebnis)
    dazu = [e for e in paket['entries'] if e.get('id') not in ids_vorher]
    if len(dazu) != 1:
        raise SystemExit(f'  ABBRUCH: {len(dazu)} neue Eintraege statt genau einem')
    e = dazu[0]
    if not e.get('kind'):
        raise SystemExit(f"  ABBRUCH: {e['id']} hat kein `kind` — kein Filter findet ihn")
    if e['kind'] == 'signature' and not e.get('match'):
        raise SystemExit(f"  ABBRUCH: {e['id']} ist `signature` ohne `match` — kann nie ausloesen")

    if not trocken:
        PACK.write_text(ergebnis, encoding='utf-8')
    return e['id'], len(paket['entries']), int(paket['version'])


def kopfzeile_nachziehen():
    """Zieht die Umfangsangabe in der Doku nach — SOFORT nach dem Anhaengen.

    Von Hand ging das reihenweise schief: am 27.08. schob jeder von neun
    Commits die Zahl um genau eins weiter, und die Wache in
    `tools/doku-luecken-probe.sh` meldete den Drift trotzdem in jedem Lauf.
    Sie kann ihn naemlich nur EINEN LAUF ZU SPAET sehen — sie laeuft, bevor
    der Lauf seinen eigenen Eintrag anhaengt. Wer hier anhaengt, macht die
    Kopfzeile ungueltig; also richtet er sie auch hier.
    """
    import subprocess
    werkzeug = WURZEL / 'tools' / 'paket-angaben-nachziehen.py'
    if not werkzeug.exists():
        print('  WARNUNG: tools/paket-angaben-nachziehen.py fehlt — Kopfzeile NICHT gerichtet')
        return
    fertig = subprocess.run([sys.executable, str(werkzeug)],
                            capture_output=True, text=True)
    for zeile in fertig.stdout.splitlines():
        print(f'  {zeile}')
    if fertig.returncode != 0:
        print(f'  WARNUNG: Kopfzeile nicht gerichtet (Ausgang {fertig.returncode}) '
              f'— von Hand nachsehen')


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('-')]
    trocken = '-p' in sys.argv[1:] or '--pruefen' in sys.argv[1:]
    if len(args) != 1:
        raise SystemExit(__doc__)
    kennung, anzahl, version = anhaengen(pathlib.Path(args[0]), trocken=trocken)
    wort = 'waere' if trocken else 'ist'
    print(f'  {kennung} {wort} drin — {anzahl} Eintraege, Fassung {version}')
    if not trocken:
        kopfzeile_nachziehen()
