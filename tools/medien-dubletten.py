#!/usr/bin/env python3
"""library-Dubletten in data.json finden — und auf Wunsch die TOTEN entfernen.

══ WOZU (12.09.2026, "konkret team karacho klappt es nicht") ═══════════════

Zwei library-Eintraege desselben Albums ergeben IDENTISCHE Ersatzschluessel
(`lokal:t:<interpret>|<titel>`), und verschmelzeWerke weist mehrdeutige
Zuordnungen ausdruecklich ab (llmwiki
[medienschluessel-kollision-gleiche-playlistid]). Ergebnis am Geraet: DREI
Kacheln fuer ein Album, der laufende Rahmen sitzt an der Fassung, die
wirklich spielt — und die Kachel daneben sieht "kaputt" aus (llmwiki
[duplikat-eintraege-lassen-den-rahmen-kaputt-wirken]). Bei "Mission Erde"
lagen die Dubletten in ZWEI Kategorien (audiobook UND music), obwohl der
Ordner nur unter audiobook/ existiert — die music-Fassungen waren tote
Kacheln.

══ DIE ENTSCHEIDUNGSREGEL: DER ORDNER IST DER BEWEIS ═══════════════════════

Ein library-Eintrag zeigt auf `<medien>/<category>/<artist>/<title>`. Je
Dublettengruppe gilt:

  * genau EIN Eintrag hat einen Ordner  -> die anderen sind tote Kacheln,
    sie duerfen weg (`--wirklich`).
  * MEHRERE haben einen Ordner          -> die VOLLSTAENDIGERE Fassung
    gewinnt: gezaehlt werden die Audiodateien des Ordners abzueglich derer,
    die "(unvollstaendig" im Namen tragen (der Mitschnitt markiert
    abgebrochene Aufnahmen genau so). Die Verlierer verlieren nur ihren
    EINTRAG — kein Ordner wird angefasst. Diese Stufe hat der Betreiber am
    12.09.2026 ausdruecklich freigegeben ("Eintraege bereinigen, Ordner
    behalten"); das Muster dahinter: der Mitschnitt legte je nach
    Kategorie des Spotify-Eintrags mal unter audiobook/, mal unter music/
    ab, und die lueckenhafte alte Ablage blieb als zweite Kachel stehen.
    Bei GLEICHSTAND wird weiter gemeldet statt entschieden. Zeigen zwei
    Eintraege auf DENSELBEN Ordner, ist der zweite schlicht redundant und
    faellt.
  * KEINER hat einen Ordner             -> alles tote Kacheln; auch das wird
    nur GEMELDET (vielleicht ist bloss die Platte nicht gemountet, und ein
    Loeschlauf in dem Zustand risse die halbe Bibliothek mit).

Und AUSSCHLIESSLICH exakte Schluessel-Dubletten: zwei Alben, die sich nur
aehneln, sind keine Gruppe. Entfernt wird nie mehr, als die Meldung vorher
gezeigt hat.

══ WIE GESCHRIEBEN WIRD — WIE medienAendern IM SERVER ══════════════════════

Auf der Box, per SSH: erst der Lock (/tmp/.data.lock — denselben respektiert
der Server UND check_network.sh), dann `.bak`-Sicherung, dann daneben
schreiben und atomar umbenennen. `active_data.json` wird NICHT angefasst:
die erzeugt check_network.sh im Takt selbst aus data.json.

══ AUFRUF ═══════════════════════════════════════════════════════════════════

    python3 tools/medien-dubletten.py --box dietpi@192.168.178.62            # nur ansehen
    python3 tools/medien-dubletten.py --box dietpi@192.168.178.62 --wirklich # tote entfernen

Rueckgabe: 0 = keine Dubletten (oder alle entfernt), 1 = Dubletten offen,
2 = Umgebung/SSH.
"""

import argparse
import json
import subprocess
import sys
import unicodedata

DATA = '/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config/data.json'
MEDIEN = '/home/dietpi/MuPiBox/media'
LOCK = '/tmp/.data.lock'


def normal(s: str) -> str:
    """WORTGLEICH zu `normal()` in medien.ts — der Ersatzschluessel haengt daran."""
    s = unicodedata.normalize('NFKD', str(s or '').lower())
    s = ''.join(c for c in s if not unicodedata.combining(c))
    raus = []
    war_trenner = False
    for c in s:
        if c.isascii() and (c.isalnum()):
            raus.append(c)
            war_trenner = False
        else:
            if not war_trenner:
                raus.append(' ')
            war_trenner = True
    return ''.join(raus).strip()


def ssh(box: str, befehl: str, stdin: str | None = None) -> subprocess.CompletedProcess:
    # `stdin` statt Heredoc IN der Befehlszeile: eine ganze data.json als
    # Argument sprengt das Kommandozeilen-Limit (Errno 7, am 12.09.2026 beim
    # ersten --wirklich-Lauf passiert — VOR jedem Befehl auf der Box, es war
    # also nichts Halbes geschrieben).
    return subprocess.run(
        ['ssh', '-o', 'ConnectTimeout=8', '-o', 'BatchMode=yes', box, befehl],
        capture_output=True,
        text=True,
        timeout=60,
        input=stdin,
    )


def main() -> int:
    p = argparse.ArgumentParser(description='library-Dubletten in data.json finden und tote entfernen')
    p.add_argument('--box', required=True)
    p.add_argument('--wirklich', action='store_true', help='tote Dubletten entfernen (sonst nur ansehen)')
    a = p.parse_args()

    r = ssh(a.box, f'cat {DATA}')
    if r.returncode != 0:
        print(f'FEHLER: data.json nicht lesbar: {r.stderr.strip()[:120]}', file=sys.stderr)
        return 2
    liste = json.loads(r.stdout)

    # Gruppen nach dem Ersatzschluessel — nur library ohne eigene Kennung,
    # denn nur dort entsteht die Kollision.
    gruppen: dict[str, list[int]] = {}
    for i, e in enumerate(liste):
        if str(e.get('type') or '') != 'library':
            continue
        if e.get('id') or e.get('playlistid') or e.get('showid') or e.get('audiobookid') or e.get('spotify_url'):
            continue
        schluessel = f"lokal:t:{normal(e.get('artist'))}|{normal(e.get('title'))}"
        gruppen.setdefault(schluessel, []).append(i)

    dubletten = {s: idx for s, idx in gruppen.items() if len(idx) > 1}
    if not dubletten:
        print('keine library-Dubletten.')
        return 0

    # Je Eintrag der Gruppe: existiert der Ordner? EIN SSH-Aufruf fuer alle.
    pfade = []
    for idx in dubletten.values():
        for i in idx:
            e = liste[i]
            pfade.append(f"{MEDIEN}/{e.get('category')}/{e.get('artist')}/{e.get('title')}")
    # Je Pfad: "NEIN" oder "JA <audio> <unvollstaendig>" — eine Zeile, ein Aufruf.
    probe = (
        'for p in ' + ' '.join(f"'{p}'" for p in pfade) + '; do '
        'if [ -d "$p" ]; then '
        'n=$(ls "$p" 2>/dev/null | grep -vciE "\\.(jpg|jpeg|png|m3u)$"); '
        'u=$(ls "$p" 2>/dev/null | grep -c "(unvollstaendig"); '
        'echo "JA $n $u"; else echo "NEIN"; fi; done'
    )
    r = ssh(a.box, probe)
    if r.returncode != 0:
        print(f'FEHLER: Ordnerprobe scheiterte: {r.stderr.strip()[:120]}', file=sys.stderr)
        return 2
    da: list[tuple[bool, int, int]] = []
    for z in r.stdout.splitlines():
        t = z.strip().split()
        if t and t[0] == 'JA':
            da.append((True, int(t[1]), int(t[2])))
        else:
            da.append((False, 0, 0))

    weg: list[int] = []
    offen = 0
    lauf = 0
    for s, idx in dubletten.items():
        print(f'\n{s}  ({len(idx)} Eintraege)')
        mit_ordner: list[tuple[int, str, int]] = []
        for i in idx:
            e = liste[i]
            hat, audio, unvoll = da[lauf]
            lauf += 1
            pfad = f"{MEDIEN}/{e.get('category')}/{e.get('artist')}/{e.get('title')}"
            wert = audio - unvoll
            stand = f'JA ({audio} Audio, {unvoll} unvollstaendig, Wert {wert})' if hat else 'NEIN'
            print(f"  [{i}] category={str(e.get('category'))!r:12} title={str(e.get('title'))[:44]!r}  Ordner: {stand}")
            if hat:
                mit_ordner.append((i, pfad, wert))
        if len(mit_ordner) == 1:
            tote = [i for i in idx if i != mit_ordner[0][0]]
            weg.extend(tote)
            print(f'  -> {len(tote)} tote Kachel(n) entfernbar, [{mit_ordner[0][0]}] bleibt')
        elif len(mit_ordner) == 0:
            offen += 1
            print('  -> KEIN Ordner vorhanden — nichts wird automatisch entschieden (Platte gemountet?)')
        else:
            # Redundante Eintraege auf DENSELBEN Ordner: nur der erste zaehlt.
            gesehen: dict[str, int] = {}
            redundant: list[int] = []
            kandidaten: list[tuple[int, str, int]] = []
            for i, pfad, wert in mit_ordner:
                if pfad in gesehen:
                    redundant.append(i)
                else:
                    gesehen[pfad] = i
                    kandidaten.append((i, pfad, wert))
            beste = max(w for _, _, w in kandidaten)
            gewinner = [k for k in kandidaten if k[2] == beste]
            if len(gewinner) == 1:
                bleibt = gewinner[0][0]
                tote = [i for i in idx if i != bleibt]
                weg.extend(tote)
                print(f'  -> vollstaendigste Fassung [{bleibt}] bleibt, {len(tote)} Eintrag/Eintraege entfernbar (Ordner bleiben liegen)')
            elif redundant and len(kandidaten) == 1:
                weg.extend(redundant)
                print(f'  -> {len(redundant)} redundante(r) Eintrag/Eintraege auf denselben Ordner entfernbar, [{kandidaten[0][0]}] bleibt')
            else:
                offen += 1
                print(f'  -> Gleichstand ({beste}) zwischen {len(gewinner)} Fassungen — Mensch entscheidet')

    if not a.wirklich:
        print(f'\nPROBE: {len(weg)} tote Kachel(n) entfernbar, {offen} Gruppe(n) brauchen einen Menschen.')
        print('Entfernen mit --wirklich.')
        return 1

    if not weg:
        print(f'\nnichts automatisch entfernbar ({offen} offene Gruppe(n)).')
        return 1

    neu = [e for i, e in enumerate(liste) if i not in set(weg)]
    inhalt = json.dumps(neu, indent=4, ensure_ascii=False)
    schreib = (
        f'set -e; [ -e {LOCK} ] && {{ echo GESPERRT; exit 3; }}; '
        f'touch {LOCK}; '
        f'cp {DATA} {DATA}.bak; '
        f'cat > {DATA}.dubletten.tmp; '
        f'python3 -c "import json;json.load(open(\'{DATA}.dubletten.tmp\'))"; '
        f'mv {DATA}.dubletten.tmp {DATA}; '
        f'rm -f {LOCK}; echo FERTIG'
    )
    r = ssh(a.box, schreib, stdin=inhalt)
    if 'GESPERRT' in r.stdout:
        print('\nFEHLER: data.json ist gerade gesperrt (Server schreibt) — spaeter noch einmal.', file=sys.stderr)
        return 2
    if r.returncode != 0 or 'FERTIG' not in r.stdout:
        ssh(a.box, f'rm -f {LOCK} {DATA}.dubletten.tmp')
        print(f'\nFEHLER beim Schreiben: {r.stderr.strip()[:160]}', file=sys.stderr)
        return 2
    print(f'\n{len(weg)} tote Kachel(n) entfernt, Sicherung liegt unter data.json.bak.')
    print(f'{offen} Gruppe(n) bleiben offen.' if offen else 'Keine offenen Gruppen.')
    return 1 if offen else 0


if __name__ == '__main__':
    sys.exit(main())
