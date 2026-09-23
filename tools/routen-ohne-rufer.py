#!/usr/bin/env python3
"""ROUTEN OHNE RUFER — entsteht gerade wieder eine Schnittstelle ohne Klienten?

WARUM ES DAS GIBT (19.09.2026, AUDIT-2026-09-19 Rang 7)
Sieben Routen sind an diesem Tag gefallen, weil sie NIEMAND rief: `/api/addwlan`,
`/api/logs`, `/api/telegram/screen`, `/api/albumstop`, `/api/delete`,
`/api/sonos`, `/api/screen/off` — rund zweihundert Zeilen, darunter ein Weg, der
ungeprueft in die WLAN-Konfiguration der Box schrieb und vor dem Anmeldetor lag.
Keine davon ist ueber Nacht tot geworden. Sie starben, als ihr Klient ging (die
alte Oberflaeche mit E118, der PHP-Admin mit E47) — und niemand hat es gemerkt,
weil nichts danach fragt. Genau das ist die Luecke: ein Endpunkt, dessen letzter
Aufrufer verschwindet, wird nicht rot. Er wird still.

Dieselbe Sorte Fund steht seit dem 06.09.2026 im Backlog (Rang 9/13, „14 Routen
ohne jeden Aufrufer") und ist dreizehn Tage liegen geblieben. Ein Befund, der
sich ueber mehrere Laeufe wiederholt, ist kein Befund mehr, sondern ein
Ablauffehler — die Wache stand hinter dem Ereignis. Hier steht sie davor.

── WAS SIE FRAGT ──────────────────────────────────────────────────────────
Fuer jede registrierte `/api/...`-Route: ruft sie im Baum irgendjemand, der
KEIN Test ist? Ein Test ist kein Klient. Er beweist, dass die Route tut, was
sie soll, nicht dass sie jemand braucht — alle sieben Gefallenen von heute
waren teilweise getestet, eine sogar mit einer eigenen Sicherheits-Spec.

── WAS AUSDRUECKLICH NICHT ALS RUFER ZAEHLT ───────────────────────────────
  * KOMMENTARE. `// hier stand frueher /api/xyz` ist eine Erzaehlung, kein
    Aufruf. Hausregel `kommentar-und-kompilat-sind-keine-gegenstelle`: wer
    Kommentare mitzaehlt, wird gruen und zwar auf die gefaehrlichste Art —
    ausgerechnet die gut dokumentierte Leiche sieht dann lebendig aus. Sechs
    der sieben Gefallenen haetten so ueberlebt.
  * `src/deploy/`. Das ist das KOMPILAT des Servers, nicht seine Gegenstelle.
  * `llmwiki/`, `*.md`, `*.html`. Prosa ueber frueheren Zustand. Ob die DOKU
    auf eine Route zeigt, die es nicht gibt, ist die Gegenrichtung und die
    Zustaendigkeit von `tools/endpunkt-zitate-pruefen.py`.
  * `node_modules/`.

── UND WAS SIE BEWUSST NICHT KANN ─────────────────────────────────────────
DER BAUM BEWEIST NUR, DASS *WIR* DIE ROUTE NICHT RUFEN. Nicht, dass niemand
sie ruft. Ein Fremdclient im Netz (ein Handy mit altem Buendel, ein Skript auf
einem anderen Rechner, eine Hausautomatik) steht in keiner Datei hier. Deshalb
ist diese Wache eine WARNLAMPE und kein Loeschbefehl: `--geraet` fragt
zusaetzlich die laufende Box, und erst beide Haelften zusammen tragen eine
Entscheidung. Genau diese Vorbedingung hat den Rang seit dem 06.09. blockiert
(BACKLOG: „vorher am Geraet auf Fremdclients pruefen", E47-Erbe).

── DIE RATSCHE ────────────────────────────────────────────────────────────
`BEKANNT` unten haelt die Routen, die HEUTE ohne Rufer im Baum sind und aus
GENANNTEM Grund stehen bleiben. Rot wird die Wache, wenn eine NEUE dazukommt.
Eine Ausnahmeliste ohne Gruende ist in drei Wochen eine Muellhalde; deshalb
steht hinter jedem Eintrag, warum er dasteht, und die Wache prueft das auch:
ein Eintrag ohne Grund ist selbst ein Fehler.

Bekommt eine Route aus BEKANNT wieder einen Rufer, sagt die Wache das — sie
gehoert dann aus der Liste heraus, sonst deckt die Liste beim naechsten Mal
etwas zu.

    python3 tools/routen-ohne-rufer.py
    python3 tools/routen-ohne-rufer.py --alle        # auch die mit Rufer
    python3 tools/routen-ohne-rufer.py --geraet dietpi@192.168.178.62
    python3 tools/routen-ohne-rufer.py --neu-eintragen   # Vorlage fuer BEKANNT

Rueckgabe: 0 = keine NEUE Route ohne Rufer, 1 = mindestens eine, 2 = die
Erkennung selbst ist kaputt (keine Route gefunden).
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QUELLE = os.path.join(WURZEL, 'src', 'backend-api', 'src')

# Dieselbe Erkennung wie in `tools/endpunkt-zitate-pruefen.py`, und aus
# demselben Grund so weit: `sicherung.ts` haengt fuenf Wege an einen Router
# namens `r`. Wer hier `(?:app|router)` schreibt, uebersieht die ganze
# Sicherungsflaeche.
VERB = r'[A-Za-z_$][\w$]*\.(?:get|post|put|delete|patch|all)\('
ROUTE = re.compile(VERB + r"""\s*['"`](/[^'"`]*)""")

# Ein Aufruf im Quelltext. `${...}` faellt spaeter auf einen Platzhalter
# zusammen, damit `` `/api/bild/${schluessel}` `` auf `/api/bild/:schluessel`
# passt.
AUFRUF = re.compile(r'/api/[\w/:<>{}$.-]+', re.UNICODE)

# DIE FALLE, DIE DIESE WACHE FAST WERTLOS GEMACHT HAETTE (gemessen beim Bau,
# 19.09.2026): die neue Oberflaeche schreibt das Praefix NIE aus. In
# `NewDesign/app.js` steht `const API = '/api'`, und danach heisst es
# `API + '/config'` oder `` `${API}/darstellung` ``. Der Text `/api/config`
# kommt in der Datei kein einziges Mal vor.
#
# Die erste Fassung dieser Wache meldete deshalb `/api/listen/:id/titel` und
# zwoelf weitere als rufer-los, obwohl die Oberflaeche sie bedient — und sie
# haette JEDE Route uebersehen, die NUR die Oberflaeche ruft. Eine Loeschliste
# mit dieser Blindheit haette die Box zerlegt. Also wird die Zusammensetzung
# mitgelesen; das Praefix kommt dann von hier.
AUFRUF_BASIS = re.compile(r"""(?:API\s*\+\s*['"`]|\$\{API\})(/[\w/:<>{}$.-]*)""", re.UNICODE)

# Dateien, in denen ein Rufer stehen KANN.
ENDUNGEN = ('.ts', '.tsx', '.js', '.mjs', '.mts', '.cjs', '.py', '.sh', '.yaml', '.yml', '.json', '.php')

# Verzeichnisse, die nie ein Rufer sind. Begruendung im Kopf.
AUS = ('src/deploy/', 'node_modules/', 'llmwiki/', 'dokumentation/', 'documentation/')

# Zeilenanfaenge, die einen Kommentar einleiten. Bewusst grob: lieber einen
# echten Rufer uebersehen (dann meldet die Wache zu VIEL, und das faellt auf)
# als einen Kommentar als Rufer zaehlen (dann meldet sie zu wenig, und das
# faellt nie auf).
KOMMENTAR = re.compile(r'^\s*(//|\*|/\*|#|--|<!--)')

# ── BEKANNT ────────────────────────────────────────────────────────────────
# Route -> Grund, warum sie ohne Rufer IM BAUM dasteht und bleiben darf.
# Eingefroren am 19.09.2026, nach dem Fall der sieben Routen aus
# AUDIT-2026-09-19 Rang 7 und MIT dem Gegencheck an Box .62 (nur lesend).
#
# DIE ERSTE GRUPPE IST DER GRUND, WARUM ES DIESE WACHE UEBERHAUPT MIT ZWEI
# HAELFTEN GIBT. Fuenf dieser Wege ruft im Baum niemand — und auf der Box
# ruft sie das AUSGELIEFERTE Verwaltungsbuendel (`www-admin/chunk-*.js`), das
# aus einem Stand gebaut ist, den es hier nicht mehr gibt: `bluetooth` kommt
# in `src/frontend-admin/src/` kein einziges Mal vor, im Buendel auf der Box
# steht `/api/bluetooth/${encodeURIComponent(...)}`. Wer nur den Baum fragt,
# haelt diese fuenf fuer tot und nimmt einem Geraet im Haus die Bedienung weg.
# Das ist das E47-Erbe in einer Zeile.
BEKANNT: dict[str, str] = {
    # ── mit gemessenem Rufer AUF DER BOX (19.09.2026, .62) ────────────────
    '/api/bluetooth/:mac/:aktion':
        'www-admin auf der Box ruft /api/bluetooth/${encodeURIComponent(...)}; '
        'im Baum gibt es diese Seite nicht mehr (19.09.2026 gemessen)',
    '/api/listen/:id/album':
        'www-admin auf der Box ruft /api/listen/${encodeURIComponent(...)} (19.09.2026 gemessen)',
    '/api/listen/:id/titel':
        'www-admin auf der Box ruft /api/listen/${encodeURIComponent(...)} (19.09.2026 gemessen)',
    '/api/listen/:id/titel/:pos':
        'www-admin auf der Box ruft /api/listen/${encodeURIComponent(...)} (19.09.2026 gemessen)',
    '/api/plugins/:kennung/aktion/:aktion':
        'www-admin auf der Box ruft /api/plugins/${this.kennung()}/aktion (19.09.2026 gemessen)',

    # ── ohne Rufer, auch auf der Box nicht — aber NICHT dieser Rang ───────
    # Diese acht sind der Rest der „14 Routen ohne jeden Aufrufer" aus
    # AUDIT-2026-09-06 Rang 9/13. Rang 7 vom 19.09. hat genau die sieben
    # gefaellt, die dort namentlich standen und begruendet waren. Wer die
    # acht hier faellt, misst sie vorher EINZELN — eine Zeile „stand mit auf
    # einer Liste" ist keine Begruendung fuers Loeschen.
    '/api/eingabegeraete/profile':
        'ohne Rufer, auch auf der Box keiner (19.09.2026 gemessen) — Rest von AUDIT-2026-09-06 Rang 9, unbewertet',
    '/api/spotify/artist/:artistId/albums':
        'ohne Rufer, auch auf der Box keiner (19.09.2026 gemessen) — Spotify-Durchreiche, eigener Rang',
    '/api/spotify/playlist/:playlistId/tracks':
        'ohne Rufer, auch auf der Box keiner (19.09.2026 gemessen) — Spotify-Durchreiche, eigener Rang',
    '/api/spotify/quelle':
        'ohne Rufer, auch auf der Box keiner (19.09.2026 gemessen) — Spotify-Durchreiche, eigener Rang',
    '/api/spotify/show/:showId/episodes':
        'ohne Rufer, auch auf der Box keiner (19.09.2026 gemessen) — Spotify-Durchreiche, eigener Rang',
    '/api/spotify/validate':
        'ohne Rufer, auch auf der Box keiner (19.09.2026 gemessen) — Spotify-Durchreiche, eigener Rang',
    '/api/spotify/warteschlange':
        'nur von der eigenen Spec gerufen, auf der Box keiner (19.09.2026 gemessen) — eigener Rang',
    '/api/stroeme/belegung':
        'ohne Rufer, auch auf der Box keiner (19.09.2026 gemessen) — E112-Vorgriff, im Backlog gebucht',
    '/api/werke/:schluessel/download':
        'ohne Rufer; auf der Box ruft www/neu nur /api/werke/<s>/inhalt (19.09.2026 gemessen) — eigener Rang',
}

# ── Geraetehaelfte ─────────────────────────────────────────────────────────
# Wo auf der Box ein Fremdrufer stehen koennte. Die ausgelieferten Buendel
# stehen MIT ihren `.zurueck`-Ruecklagen darin: ein Handy im Haus kann ein
# altes Buendel im Cache haben, und genau dann ist die Ruecklage die ehrlichste
# Auskunft darueber, was dieses Buendel rief.
GERAETE_ORTE = [
    '/usr/local/bin',
    '/opt',
    '/etc',
    '/var/spool/cron',
    '/root',
    '/srv',
    '/var/www',
    '/home/dietpi/.mupibox',
]
# Der Server selbst ist kein Fremdrufer — sein Kompilat enthaelt jede Route.
GERAETE_EIGEN = ('server.js', 'server.js.zurueck', 'plugin-laufwerk.js')


def verfolgte_dateien() -> list[str]:
    """Nur was git kennt. Ein unverfolgter Entwurf ist kein Rufer."""
    p = subprocess.run(['git', '-C', WURZEL, 'ls-files'], capture_output=True, text=True)
    if p.returncode != 0:
        print('FEHLER: git ls-files ging nicht — laeuft das aus dem Baum?', file=sys.stderr)
        sys.exit(2)
    raus = []
    for rel in p.stdout.splitlines():
        if not rel.endswith(ENDUNGEN):
            continue
        if any(rel.startswith(a) or f'/{a}' in rel for a in AUS):
            continue
        raus.append(rel)
    return raus


def routen() -> dict[str, str]:
    """Registrierte /api-Routen -> Datei, in der sie haengen."""
    raus: dict[str, str] = {}
    for name in sorted(os.listdir(QUELLE)):
        if not name.endswith('.ts') or name.endswith('.spec.ts'):
            continue
        pfad = os.path.join(QUELLE, name)
        with open(pfad, encoding='utf-8', errors='replace') as f:
            text = f.read()
        for m in ROUTE.finditer(text):
            weg = m.group(1)
            if weg.startswith('/api/'):
                raus.setdefault(weg, f'src/backend-api/src/{name}')
    return raus


def platzhalter(stueck: str) -> bool:
    """`:x`, `<x>`, `{x}` und `${x}` meinen alle dasselbe: hier steht ein Wert."""
    return (
        stueck.startswith(':')
        or (stueck.startswith('<') and stueck.endswith('>'))
        or (stueck.startswith('{') and stueck.endswith('}'))
        or ('${' in stueck)
    )


def benennt_etwas(aufruf: str) -> bool:
    """Nennt dieser Text ueberhaupt eine bestimmte Route?

    DER FUND DER EIGENEN GEGENPROBE (19.09.2026). Die erste Fassung hat eine
    absichtlich eingebaute Route ohne Rufer NICHT gemeldet — sie hielt sie fuer
    gerufen, und zwar von dieser Zeile in `tools/fehlerbehandler-leck-schau.mjs`:

        `/api/${'a'.repeat(6000)}`

    Das ist eine Fuzz-Adresse fuer eine Fehlerprobe. Weil `${...}` als
    Platzhalter gilt, passte sie auf JEDE einsegmentige `/api/x`-Route — und
    die Wache war gruen, obwohl die Sabotage im Baum stand. Eine Wache, die
    bei absichtlichem Schaden gruen bleibt, ist keine; genau dafuer ist die
    Gegenprobe da.

    Die Regel dagegen ist die einzige, die ohne Ausnahmeliste auskommt: das
    ERSTE Stueck hinter `/api` muss feststehen. Ein Aufruf, der schon dort
    einen Platzhalter hat, benennt keine Route, sondern alle.
    """
    stuecke = [s for s in aufruf.strip('/').split('/') if s]
    return len(stuecke) >= 2 and not platzhalter(stuecke[1])


def passt(aufruf: str, route: str) -> bool:
    """Meint dieser Aufruf diese Route? Platzhalter zaehlen auf BEIDEN Seiten."""
    if not benennt_etwas(aufruf):
        return False
    a = [s for s in aufruf.strip('/').split('/') if s]
    r = [s for s in route.strip('/').split('/') if s]
    if len(a) != len(r):
        return False
    return all(x == y or platzhalter(x) or platzhalter(y) for x, y in zip(a, r))


def klasse(rel: str) -> str:
    """Welche Sorte Rufer ist das? Ein Test ist kein Klient."""
    if rel.endswith('.spec.ts') or rel.endswith('.spec.mjs') or rel.endswith('.test.mjs'):
        return 'spec'
    if rel.startswith('NewDesign/') or rel.startswith('src/frontend-'):
        return 'oberflaeche'
    if rel.startswith('tools/'):
        return 'werkzeug'
    if rel.startswith('remote-step-installer/'):
        return 'rezept'
    if rel.startswith('src/backend-'):
        return 'backend'
    if rel.startswith('plugins/'):
        return 'plugin'
    return 'box'


def rufer(dateien: list[str], alle: dict[str, str]) -> dict[str, dict[str, list[str]]]:
    """route -> klasse -> ['datei:zeile', ...]"""
    raus: dict[str, dict[str, list[str]]] = {w: {} for w in alle}
    for rel in dateien:
        registriert = rel in set(alle.values())
        k = klasse(rel)
        try:
            with open(os.path.join(WURZEL, rel), encoding='utf-8', errors='replace') as f:
                zeilen = f.readlines()
        except OSError:
            continue
        for nr, zeile in enumerate(zeilen, 1):
            if KOMMENTAR.match(zeile):
                continue
            # Die Registrierung selbst ist kein Aufruf.
            if registriert and ROUTE.search(zeile):
                continue
            wege = [m.group(0) for m in AUFRUF.finditer(zeile)]
            wege += ['/api' + m.group(1) for m in AUFRUF_BASIS.finditer(zeile)]
            for w in wege:
                # Eine Abfrage ist kein Teil des Weges: `/api/werke?x=1`.
                roh = w.split('?')[0].rstrip('.,;:)`"\'-')
                for weg in alle:
                    if passt(roh, weg):
                        raus[weg].setdefault(k, []).append(f'{rel}:{nr}')
    return raus


def suchwort(weg: str) -> str:
    """Das statische Praefix einer Route — bis zum ersten Platzhalter."""
    teile = []
    for s in weg.strip('/').split('/'):
        if s.startswith(':'):
            break
        teile.append(s)
    return '/' + '/'.join(teile) + ('/' if len(teile) < len(weg.strip('/').split('/')) else '')


def geraet_fragen(box: str, wege: list[str]) -> dict[str, list[str]] | None:
    """Wer auf der BOX nennt diese Wege? NUR LESEND, nur `grep -rl`.

    `None` heisst NICHT GEMESSEN. Das ist der Unterschied, auf den es hier
    ankommt: „nichts gefunden" und „gar nicht hingesehen" sehen im Bericht
    sonst gleich aus, und der zweite Fall traegt keine Loeschentscheidung.
    Beim Bau ist genau das passiert — `grep -rl … /root` endet als dietpi mit
    2 (keine Leserechte), die Wache hielt die Box fuer unerreichbar und
    schrieb trotzdem vierzehnmal „keine Stelle auf der Box" hin.
    """
    if not wege:
        return {}
    # WONACH AUF DER BOX GESUCHT WIRD. Ein Rufer schreibt `/api/listen/5/titel`,
    # nicht `/api/listen/:id/titel` — die Route woertlich zu suchen findet auf
    # einem Geraet grundsaetzlich nichts und waere eine Messung, die immer
    # „sauber" sagt. Gesucht wird darum das STATISCHE Praefix bis zum ersten
    # Platzhalter. Das trifft womoeglich auch eine Nachbarroute; der Fehler
    # geht dann in die sichere Richtung (wir loeschen nicht).
    orte = ' '.join(f"'{o}'" for o in GERAETE_ORTE)
    # `|| true` je Zeile: ein `grep` ohne Treffer endet mit 1, eines ohne
    # Leserecht mit 2. Beides ist kein Fehler DIESER Messung.
    befehl = '\n'.join(
        f"echo '##{w}'; grep -rl -F -- '{suchwort(w)}' {orte} 2>/dev/null || true" for w in wege
    )
    try:
        p = subprocess.run(
            ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', box, befehl],
            capture_output=True,
            text=True,
            timeout=600,
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        print(f'  NICHT GEMESSEN: ssh ging nicht ({e}).')
        return None
    marken = [z for z in p.stdout.splitlines() if z.startswith('##')]
    if len(marken) != len(wege):
        print(f'  NICHT GEMESSEN: die Box hat {len(marken)} von {len(wege)} Fragen beantwortet '
              f'(Ausgang {p.returncode}). {p.stderr.strip()[:160]}')
        return None
    raus: dict[str, list[str]] = {}
    jetzt = None
    for z in p.stdout.splitlines():
        if z.startswith('##'):
            jetzt = z[2:]
            raus[jetzt] = []
        elif jetzt is not None and z.strip():
            if os.path.basename(z.strip()) in GERAETE_EIGEN:
                continue
            raus[jetzt].append(z.strip())
    return raus


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--alle', action='store_true', help='auch die Routen MIT Rufer auflisten')
    ap.add_argument('--geraet', metavar='ZIEL', help='zusaetzlich die laufende Box fragen (ssh, nur lesend)')
    ap.add_argument('--neu-eintragen', action='store_true', help='Vorlage fuer BEKANNT ausgeben')
    a = ap.parse_args()

    for weg, grund in BEKANNT.items():
        if not grund.strip():
            print(f'  FEHLER: {weg} steht ohne Grund in BEKANNT — das ist keine Ausnahme, das ist ein Loch.')
            return 1

    alle = routen()
    if not alle:
        print('  WARNUNG: keine Route gefunden — hat sich die Schreibweise geaendert?')
        return 2

    gefunden = rufer(verfolgte_dateien(), alle)

    ohne, nur_spec, neu, geheilt = [], [], [], []
    for weg in sorted(alle):
        klassen = {k: v for k, v in gefunden[weg].items() if v}
        echte = {k: v for k, v in klassen.items() if k != 'spec'}
        if echte:
            if weg in BEKANNT:
                geheilt.append((weg, sorted(echte)))
            continue
        ohne.append(weg)
        if 'spec' in klassen:
            nur_spec.append(weg)
        if weg not in BEKANNT:
            neu.append(weg)

    if a.neu_eintragen:
        for weg in neu:
            print(f"    '{weg}': '',  # GRUND EINTRAGEN")
        return 0

    print(f'{len(alle)} registrierte /api-Routen, {len(ohne)} davon ohne Rufer im Baum '
          f'({len(nur_spec)} nur von der eigenen Spec gerufen).')
    print(f'  bekannt und begruendet   {len(ohne) - len(neu):3d}')
    print(f'  NEU OHNE RUFER           {len(neu):3d}')

    if a.alle:
        print('\n── mit Rufer ──')
        for weg in sorted(alle):
            k = {x: y for x, y in gefunden[weg].items() if y and x != 'spec'}
            if k:
                print(f'  {weg}  <- {", ".join(sorted(k))}')

    # Die bekannten IMMER mitdrucken. Eine Ausnahmeliste, die man nicht sieht,
    # ist in drei Wochen eine Muellhalde — und die zweite Gruppe darin ist
    # offene Arbeit, kein erledigter Fall.
    if ohne:
        print('\n── bekannt und begruendet ──')
        for weg in ohne:
            if weg in BEKANNT:
                print(f'  {weg}\n      {BEKANNT[weg]}')

    if geheilt:
        print('\n── hat wieder einen Rufer: gehoert aus BEKANNT heraus ──')
        for weg, k in geheilt:
            print(f'  {weg}  <- {", ".join(k)}')

    if neu:
        print('\n── NEU OHNE RUFER ──')
        for weg in neu:
            zusatz = '  (nur eigene Spec)' if weg in nur_spec else ''
            print(f'  {weg}   [{alle[weg]}]{zusatz}')

    if a.geraet:
        fragen = neu or ohne
        print(f'\n── Gegencheck am Geraet ({a.geraet}, nur lesend) ──')
        print('  Der Baum beweist nur, dass WIR nicht rufen. Hier steht, wer auf der Box es koennte.')
        treffer = geraet_fragen(a.geraet, fragen)
        if treffer is None:
            print('  Die Geraetehaelfte fehlt. Keine Loeschentscheidung auf dieser Grundlage.')
        else:
            for weg in fragen:
                stellen = treffer.get(weg, [])
                wort = suchwort(weg)
                wie = f' (gesucht: {wort})' if wort.rstrip("/") != weg.rstrip("/") else ''
                if stellen:
                    print(f'  FREMDRUFER MOEGLICH: {weg}{wie}')
                    for s in stellen:
                        print(f'      {s}')
                else:
                    print(f'  keine Stelle auf der Box: {weg}{wie}')

    if neu:
        print('\nEine Route ohne Rufer ist noch kein Loeschbefehl — erst mit dem')
        print('Geraete-Gegencheck (--geraet) zusammen. Bleibt sie absichtlich, gehoert')
        print('sie MIT GRUND nach BEKANNT in dieser Datei.')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
