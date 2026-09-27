#!/usr/bin/env python3
r"""KOMMENTAR-ENDPUNKTE — begruendet ein Kommentar mit einer Route, die es nicht gibt?

WARUM ES DAS GIBT (25.08.2026): `tools/endpunkt-zitate-pruefen.py` stellt seit
dem 23.08. die Gegenfrage zu `api-doku-deckung.sh` — nicht "kommt jede Route in
der Doku vor?", sondern "gibt es jede Route, auf die die Doku zeigt?". Ihre
Quellenliste heisst `DOKUS` und fuehrt drei Dateien: die zwei Handbuecher und
`plugins/README.md`.

Das ist dieselbe Falle, die der Lauf 34058e8e einen Tag vorher an
`doku-pfade-pruefen.py` gemessen hat (dort hiess die Liste `HANDBUECHER` und
`BACKLOG.md` fehlte): EINE WACHE HEISST NACH DEM, WAS IHR AUTOR IM KOPF HATTE.
Und in diesem Baum steht die dichteste Prosa ueber Endpunkte nicht in den
Handbuechern, sondern in den KOMMENTAREN — Aufsaetze von zwanzig Zeilen, die
begruenden, warum etwas so und nicht anders gebaut ist. 90 verschiedene
`/api/…`-Zitate liegen in `.ts`-Dateien; keine Wache hat je eines davon gegen
den Router gehalten.

── DER FUND BEIM ERSTEN LAUF ──────────────────────────────────────────────
`src/backend-api/src/server.ts:8799` begruendet, warum die ARD NICHT ihr
eigenes Suchformular in der Verwaltung bekommt:

    `/api/ard/suche` gibt es schon und liefert je Treffer einen fertigen
    `vorschlag`; daraus liesse sich in der Verwaltung eine zweite Suchmaske
    bauen …

Die Route ist ersatzlos gefallen — 700 Zeilen tiefer, bei
`/api/ard/sammlungen`, steht es sogar aufgeschrieben ("die alten Kernrouten
/kategorien, /kategorie/:id, /sammlung/:id, /suche und /kinder sind ersatzlos
gefallen"). Zwei Stellen derselben Datei, die eine im Praesens ueber eine
Route, die die andere begraebt.

Das ist der teure Fall, weil die ENTSCHEIDUNG haelt und nur ihr BELEG tot ist:
wer den Abschnitt liest, greppt den Namen, findet nichts — und haelt entweder
die Regel fuer unbelegt oder baut die zweite Suchmaske doch.

── WAS ABSICHTLICH NICHT GEPRUEFT WIRD ────────────────────────────────────
1. NUR KOMMENTARE, kein Code. Ein `/api/…` in einer Zeichenkette ist ein
   AUFRUF; zeigt der ins Leere, ist das ein Fehler und keine Doku-Luecke —
   andere Zustaendigkeit, andere Wache.
2. NUR ZITATE IN RUECKWAERTS-ANFUEHRUNGSZEICHEN. Ein Endpunkt ohne Backticks
   im Fliesstext ist meist ein Namensteil ("die /api/-Pfade"); die
   Schwesterwache verwirft solche Satzreste hinterher, hier faellt derselbe
   Fall vorne weg und spart die Sonderregel.
3. HISTORISCHE SAETZE. Ein Kommentar darf ueber eine tote Route reden, wenn er
   sie als tot AUSWEIST. Der Marker steht klein geschrieben in derselben oder
   einer der 6 vorigen Zeilen — dieselbe Fassung wie in
   `tools/doku-widerruf-probe.sh`, damit nicht zwei Konventionen nebeneinander
   herlaufen. Wer eine Route entfernt und ihre Erwaehnung stehen laesst, traegt
   den Marker ein.

── DIE ROUTEN KOMMEN PER IMPORT, NICHT PER KOPIE ──────────────────────────
`routen()`, `deckt()` und `probestring()` werden aus
`endpunkt-zitate-pruefen.py` eingebunden. Der Grund ist gemessen: jene Wache
hat vier Fallen hinter sich (Platzhalter auf beiden Seiten, Praefix-Zitate,
Prosa-Abbruch, und die teuerste — `app.all(/regex/)` fuer die
Plugin-Durchreiche). Wer sie abschreibt, erbt ihre Blindheit von heute und
bekommt ihre Verbesserungen von morgen nicht mit.

EINE ERWEITERUNG WAR NOETIG: die Schwesterwache liest `<schluessel>` nur in
ASCII. Im Baum steht `<schlüssel>`, und ihr Zitat brach am Umlaut ab
(`/api/werke/<schl`) — sie meldete daraufhin zwei richtige BACKLOG-Zeilen rot.
Hier ist die Zeichenklasse um Nicht-ASCII erweitert. (Der Befund gilt dort
genauso; er ist in derselben Runde mitkorrigiert.)

Aufruf aus dem Wurzelverzeichnis:  python3 tools/kommentar-endpunkte-pruefen.py
Optional: Dateien/Ordner als Argumente (fuer die Gegenprobe).
Rueckgabe: 0 = jedes Zitat hat eine Route, 1 = mindestens eins zeigt ins Leere.
"""

import importlib.util
import os
import re
import sys

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Die Schwesterwache heisst mit Bindestrichen und ist so kein Modulname.
_spec = importlib.util.spec_from_file_location(
    'endpunkt_zitate', os.path.join(WURZEL, 'tools', 'endpunkt-zitate-pruefen.py'))
_schwester = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_schwester)

BAEUME = ['src', 'plugins']

# Ein Zitat in Rueckwaerts-Anfuehrungszeichen. `\w` statt der ASCII-Klasse der
# Schwesterwache: `<schlüssel>` bricht sonst am Umlaut ab.
ZITAT = re.compile(r'`(/api/[\w/:<>{}.-]+)`', re.UNICODE)

# Zeilenkommentar `//` und Rumpfzeile eines Blockkommentars `*`. Ein `//`
# INNERHALB einer Zeichenkette (`'http://…'`) faengt der Test auf das
# vorangehende `:` ab — im Baum kommt sonst kein `://` in Code vor.
KOMMENTAR = re.compile(r'(?:^\s*\*|//)')

# Dieselben Marker wie in tools/doku-widerruf-probe.sh, klein geschrieben.
MARKER = ('gefallen', 'entfallen', 'entfernt', 'gestrichen', 'abgeloest',
          'ueberholt', 'überholt', 'widerlegt', 'frueher', 'früher',
          'gab es', 'hiess', 'hieß', 'bis e', 'seit e', 'historisch',
          'nicht mehr', 'ersatzlos', 'umbenannt', 'wanderte', 'gewandert')
RUECKSCHAU = 6
# UND ZWEI ZEILEN NACH VORN — der Unterschied zur Vorlage, gemessen am ersten
# Fund: die Korrektur von `streaming.ts:173` lautet "die damaligen Kernrouten
# `/api/ard/suche` und `/api/ard/kinder` (mit E77 ersatzlos gefallen …)", und
# der Marker landet beim Umbruch auf der Zeile DARUNTER. Ein Kommentar bricht
# mitten im Satz um, eine Handbuchzeile (die Vorlage) selten. Zwei Zeilen, nicht
# der ganze Block: ein Aufsatz von zwanzig Zeilen wuerde sonst jedes Zitat
# darin weisswaschen.
VORSCHAU = 2


def kommentarzitate(datei):
    """Jedes `/api/…` aus einer Kommentarzeile, mit Zeilennummer und Umfeld."""
    with open(datei, encoding='utf-8', errors='replace') as f:
        zeilen = f.readlines()
    treffer = []
    for nr, zeile in enumerate(zeilen, 1):
        m = KOMMENTAR.search(zeile)
        if not m:
            continue
        if m.group(0) == '//' and m.start() > 0 and zeile[m.start() - 1] == ':':
            continue  # `http://…` in einer Zeichenkette, kein Kommentar
        for z in ZITAT.finditer(zeile[m.start():]):
            umfeld = ''.join(
                zeilen[max(0, nr - 1 - RUECKSCHAU):nr + VORSCHAU]).lower()
            treffer.append((nr, z.group(1), umfeld))
    return treffer


def dateien(ziele):
    """Alle .ts unter den Zielen; Testdateien zaehlen mit, ihre Kommentare auch."""
    raus = []
    for ziel in ziele:
        pfad = ziel if os.path.isabs(ziel) else os.path.join(WURZEL, ziel)
        if os.path.isfile(pfad):
            raus.append(pfad)
            continue
        for wurzel, ordner, namen in os.walk(pfad):
            ordner[:] = [o for o in ordner if o not in ('node_modules', 'dist', '.git', 'www')]
            raus += [os.path.join(wurzel, n) for n in namen if n.endswith('.ts')]
    return sorted(raus)


def main():
    texte, regexe = _schwester.routen()
    if not texte:
        print('  WARNUNG: keine Route gefunden — hat sich die Schreibweise geaendert?')
        return 2

    ziele = sys.argv[1:] or BAEUME
    fehl, geprueft = [], 0
    for pfad in dateien(ziele):
        for nr, zitat, umfeld in kommentarzitate(pfad):
            geprueft += 1
            praefix = zitat.endswith('/')
            gesucht = zitat.rstrip('/')
            if any(_schwester.deckt(gesucht, r, praefix) for r in texte):
                continue
            # NAMENSRAUM OHNE SCHRAEGSTRICH. Die Schwesterwache kennt
            # `/api/plugins/podcast/` als Praefix; im Kommentar steht dieselbe
            # Sache OHNE Schlussstrich ("fuer COVER ist das laengst gebaut
            # (`/api/bild`)", "holt `/api/interpret` die Alben gar nicht
            # erst"). Gemeint ist die Familie, nicht ein Weg. Der Preis ist
            # benannt: verschwindet ein Elternweg und bleiben die Kinder, faellt
            # das hier nicht auf — dafuer ist `api-doku-deckung.sh` zustaendig,
            # die von der anderen Seite zaehlt.
            if any(r.startswith(gesucht + '/') for r in texte):
                continue
            probe = _schwester.probestring(gesucht, praefix)
            if any(r.match(probe) for r in regexe):
                continue
            if any(mk in umfeld for mk in MARKER):
                continue  # als vergangen ausgewiesen
            rel = os.path.relpath(pfad, WURZEL)
            fehl.append((rel, nr, zitat, _schwester.naechste(gesucht, texte)))

    print('── Kommentare, die mit einer Route begruenden, die es nicht gibt ──')
    for rel, nr, zitat, nah in fehl:
        hinweis = f'  — gemeint sein duerfte `{nah}`' if nah else ''
        print(f'  ZEIGT INS LEERE: {zitat}  ({rel}:{nr}){hinweis}')
    print()
    print(f'{geprueft - len(fehl)} von {geprueft} Kommentar-Zitaten haben eine '
          f'Route, {len(fehl)} zeigen ins Leere.')
    return 1 if fehl else 0


if __name__ == '__main__':
    sys.exit(main())
