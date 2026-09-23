#!/usr/bin/env python3
r"""ENDPUNKT-ZITATE — gibt es die Route, auf die die Doku den Leser schickt?

WARUM ES DAS GIBT (23.08.2026): `tools/api-doku-deckung.sh` zaehlt 195 Routen
aus dem Backend und fragt fuer jede, ob sie irgendwo in der Doku vorkommt. Das
ist die Richtung CODE -> DOKU. Die GEGENRICHTUNG hat keine Wache gepruefft:
steht in der Doku ein `/api/…`, das es im Backend gar nicht (mehr) gibt?

`tools/doku-pfade-pruefen.py` stellt genau diese Frage — aber nur fuer DATEIEN.
Ein Endpunkt ist kein Pfad im Baum; er faellt durch beide Netze.

── DER FUND BEIM ERSTEN LAUF ──────────────────────────────────────────────
plugins/README.md schrieb im Abschnitt "Ohne Rueckfall auf einen Kern-Weg":

    Der Grund steht bei `/api/ard/inhalt` in `server.ts`

Diese Route gibt es nicht und gab es nie unter dem Namen — `grep -rn
"ard/inhalt" src/` liefert null Treffer. Gemeint ist
`/api/werke/:schluessel/inhalt` (server.ts ab 10635), wo der ARD-Zweig seit
E78 `pluginInhalt('mixpi-ardsounds', …)` ruft.

Das ist der teure Fall: der Satz erklaert, WARUM es keinen zweiten Weg mehr
gibt. Wer das nachlesen will, greppt den zitierten Namen, findet nichts — und
haelt entweder den Abschnitt fuer veraltet oder die Regel fuer unbelegt. Eine
Wache, die nur zaehlt, ob genug Endpunkte genannt werden, sieht darin sogar
einen Treffer mehr.

── WAS ABSICHTLICH NICHT GEPRUEFT WIRD ────────────────────────────────────
`llmwiki/pack.yaml` steht NICHT in der Quellenliste, obwohl
`api-doku-deckung.sh` es mitliest. Das Paket ist zu grossen Teilen PROSA UEBER
FRUEHERE ZUSTAENDE ("bis E78 lag das unter …") und fuehrt bewusste
Nicht-Beispiele (`/api/gibtesnicht`, `/api/xyz` als Muster fuer 404-Tests).
Eine Wache, die das anmahnt, meldet auf Dauer rot und wird zu Recht ignoriert
— dieselbe Falle wie beim Benutzerhandbuch und den `RECHTE`.
Widerrufene Aussagen im Paket sind die Zustaendigkeit von
`tools/doku-widerruf-probe.sh`.

`BACKLOG.md` steht aus DEMSELBEN Grund nicht in der Liste, und diese Zeile
steht hier, damit der naechste Lauf es nicht ein zweites Mal misst
(25.08.2026): die Datei ist ein PROTOKOLL. Ihre Tabellen halten fest, was an
einem Tag gebaut wurde ("E38/S7 … `GET /api/ard/kategorien` | FERTIG"); dass
die Route ein Vierteljahr spaeter ins Plugin gewandert ist, macht die Zeile
nicht falsch. Dazu drei bewusste Nicht-Beispiele (`/api/quatsch` als
404-Gegenprobe) und Vorschlaege, die noch keiner sind. Gemessen: 10 Meldungen,
null davon eine Luecke. Was `BACKLOG.md` an ECHTEN Pfaden fuehrt, prueft
`tools/doku-pfade-pruefen.py` seit dem 25.08.2026 mit.

── DIE VIERTE FALLE WAR DIE TEUERSTE: NICHT JEDE ROUTE IST EIN TEXT ───────
Die erste Fassung las Routen wie `api-doku-deckung.sh`: als Zeichenkette im
`app.get('/api/…')`. Damit meldete sie `/api/plugins/<kennung>/http/` an fuenf
Stellen als tot — die Route steht in server.ts:2559 und ist ein REGULAERER
AUSDRUCK (`app.all(/^\/api\/plugins\/([a-z][a-z0-9-]{2,63})\/http\/(.*)$/)`),
weil das Reststueck frei ist. Fuenf Falschmeldungen auf zwei echte Funde: eine
Wache, die den Durchreicheweg des ganzen Plugin-Systems nicht kennt, faerbt
lieber richtige Doku rot. Regex-Routen werden darum eingesammelt und ein
Zitat gegen sie PROBIERT — Platzhalter zu einem plausiblen Wert eingesetzt.
(Dieselbe Blindheit hat `api-doku-deckung.sh` bis heute; sie faellt dort nur
nicht auf, weil sie in jener Richtung nur zu WENIG einfordert.)

── DIE DREI FALLEN, DIE BEIM BAUEN GEMESSEN WURDEN ────────────────────────
1. PLATZHALTER AUF BEIDEN SEITEN. Express schreibt `:schluessel`, die
   Handbuecher schreiben `<s>`, `{kennung}` oder ein Beispiel
   (`mupibox-wled`). Beide Seiten werden zu `[^/]+` aufgeweitet, sonst meldet
   die Probe Luecken, die keine sind.
2. PRAEFIX-ZITATE. `/api/plugins/mupibox-podcast/` benennt einen NAMENSRAUM,
   keine Route ("dein Plugin bekommt die Route …"). Ein Zitat, das auf `/`
   endet, gilt darum als erfuellt, sobald irgendeine Route damit beginnt.
3. PROSA-ABBRUCH. "die `/api/`-Pfade" liefert beim blossen Regex-Greifen
   `/api/-Pfade`. Zitate, deren erstes Segment nicht mit einem Buchstaben oder
   einer Ziffer beginnt, sind Satzreste und werden verworfen.

Aufruf aus dem Wurzelverzeichnis:  python3 tools/endpunkt-zitate-pruefen.py
Optional: weitere Dateien als Argumente (fuer die Gegenprobe).
Rueckgabe: 0 = jedes Zitat hat eine Route, 1 = mindestens eins zeigt ins Leere.
"""

import os
import re
import sys

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QUELLE = os.path.join(WURZEL, 'src', 'backend-api', 'src')

DOKUS = [
    'dokumentation/mixpibox.md',
    'dokumentation/benutzerhandbuch.html',
    'plugins/README.md',
]

# FUENFTE FALLE, 25.08.2026: `(?:app|router)` war zu eng. `sicherung.ts` haengt
# fuenf Wege an einen Router namens `r` — die ganze Sicherungs-/Ruecksicherungs-
# Flaeche war fuer diese Wache und fuer `api-doku-deckung.sh` unsichtbar.
# Jeder Empfaenger zaehlt jetzt; der verlangte Schraegstrich haelt `map.get('x')`
# draussen. Und die Suche laeuft ueber den ganzen Dateitext statt zeilenweise,
# weil `/api/sicherung/pruefen` hinter der offenen Klammer auf eigener Zeile steht.
VERB = r'[A-Za-z_$][\w$]*\.(?:get|post|put|delete|patch|all)\('
ROUTE = re.compile(VERB + r"""\s*['"`](/[^'"`]*)""")
ROUTE_REGEX = re.compile(VERB + r'\s*/(\^.*?)/[gimsuy]*\s*,')
# `\w` mit UNICODE: im Baum steht `<schlüssel>`, und eine ASCII-Klasse brach das
# Zitat am Umlaut ab (`/api/werke/<schl`) — zwei BACKLOG-Zeilen wurden dadurch
# rot gemeldet, obwohl ihre Route existiert.
ZITAT = re.compile(r'/api/[\w/:<>{}.-]+', re.UNICODE)

# Was fuer einen Platzhalter eingesetzt wird, wenn ein Zitat gegen eine
# Regex-Route probiert wird. Muss durch `[a-z][a-z0-9-]{2,63}` passen —
# ein `x` taete es nicht, die Kennungsregel verlangt mindestens drei Zeichen.
PROBEWERT = 'beispiel'


def routen():
    """Express-Routen des Backends: Zeichenketten UND regulaere Ausdruecke."""
    texte, regexe = set(), set()
    for name in sorted(os.listdir(QUELLE)):
        if not name.endswith('.ts') or name.endswith('.spec.ts'):
            continue
        with open(os.path.join(QUELLE, name), encoding='utf-8', errors='replace') as f:
            text = f.read()
        for m in ROUTE.finditer(text):
            if m.group(1).startswith('/api/'):
                texte.add(m.group(1))
        for m in ROUTE_REGEX.finditer(text):
            try:
                regexe.add(re.compile(m.group(1)))
            except re.error:
                pass  # JS-Eigenheit ohne Python-Entsprechung — lieber still
    return sorted(texte), sorted(regexe, key=lambda r: r.pattern)


def platzhalter(stueck):
    """`:x`, `<x>` und `{x}` meinen dasselbe: hier steht ein Wert."""
    return (stueck.startswith(':')
            or (stueck.startswith('<') and stueck.endswith('>'))
            or (stueck.startswith('{') and stueck.endswith('}')))


def deckt(zitat, route, praefix):
    """Passt das Zitat auf die Route? Platzhalter zaehlen auf BEIDEN Seiten.

    `praefix=True`: das Zitat benennt einen Namensraum (`…/podcast/`) und ist
    erfuellt, sobald eine laengere Route damit anfaengt.
    """
    z = [s for s in zitat.strip('/').split('/') if s]
    r = [s for s in route.strip('/').split('/') if s]
    if praefix:
        if len(r) <= len(z):
            return False
    elif len(r) != len(z):
        return False
    return all(a == b or platzhalter(a) or platzhalter(b) for a, b in zip(z, r))


def probestring(zitat, praefix):
    """Das Zitat mit eingesetzten Werten — so, wie ein Aufruf aussaehe."""
    teile = [PROBEWERT if platzhalter(s) else s for s in zitat.strip('/').split('/') if s]
    if praefix:
        teile.append(PROBEWERT)
    return '/' + '/'.join(teile)


def zitate(datei):
    """Jedes /api/…-Zitat mit Zeilennummer, Satzreste verworfen."""
    treffer = []
    with open(datei, encoding='utf-8', errors='replace') as f:
        for nr, zeile in enumerate(f, 1):
            for m in ZITAT.finditer(zeile):
                roh = m.group(0).rstrip('.,;:)`"\'-')
                rest = roh[len('/api/'):]
                if not rest or not rest[0].isalnum():
                    continue  # "die /api/-Pfade" — Satzrest, keine Route
                treffer.append((nr, roh))
    return treffer


def naechste(zitat, alle):
    """Die Route mit der laengsten gemeinsamen Segmentfolge — als Fingerzeig."""
    z = zitat.strip('/').split('/')
    bester, laenge = None, 0
    for r in alle:
        s = r.strip('/').split('/')
        n = 0
        while n < min(len(z), len(s)) and (z[n] == s[n] or s[n].startswith(':')):
            n += 1
        if n > laenge:
            bester, laenge = r, n
    return bester if laenge >= 2 else None


def main():
    texte, regexe = routen()
    if not texte:
        print('  WARNUNG: keine Route gefunden — hat sich die Schreibweise geaendert?')
        return 2

    dateien = DOKUS + sys.argv[1:]
    fehl = []
    geprueft = 0
    for rel in dateien:
        pfad = rel if os.path.isabs(rel) else os.path.join(WURZEL, rel)
        if not os.path.exists(pfad):
            print(f'  WARNUNG: {rel} nicht gefunden — ist die Doku umgezogen?')
            return 2
        for nr, zitat in zitate(pfad):
            geprueft += 1
            praefix = zitat.endswith('/')
            gesucht = zitat.rstrip('/')
            if any(deckt(gesucht, r, praefix) for r in texte):
                continue
            probe = probestring(gesucht, praefix)
            if any(r.match(probe) for r in regexe):
                continue
            fehl.append((rel, nr, zitat, naechste(gesucht, texte)))

    print('── Endpunkte, auf die die Doku zeigt und die es nicht gibt ──')
    for rel, nr, zitat, nah in fehl:
        hinweis = f'  — gemeint sein duerfte `{nah}`' if nah else ''
        print(f'  ZEIGT INS LEERE: {zitat}  ({rel}:{nr}){hinweis}')
    print()
    print(f'{geprueft - len(fehl)} von {geprueft} Zitaten haben eine Route, '
          f'{len(fehl)} zeigen ins Leere.')
    return 1 if fehl else 0


if __name__ == '__main__':
    sys.exit(main())
