#!/usr/bin/env python3
"""Zwei Wissenspakete abgleichen — und Eintraege VERBATIM herueberholen.

══ WOZU ═══════════════════════════════════════════════════════════════════
Es gibt das Wissenspaket ZWEIMAL auf dieser Maschine, und beide Kopien haengen
am selben Remote (git.local:3000/achim/llmwiki_mupibox.git):

  * llmwiki/pack.yaml            — IM Box-Repo versioniert. Das ist die
                                   fuehrende Kopie: sie wird nach
                                   ~/.rsi/wiki/mupibox/ gespiegelt, und NUR
                                   dort sieht `rsi diagnose` sie.
  * ~/Downloads/llmwiki_mupibox/ — ein echter Klon des Wiki-Remotes. Einzelne
                                   Sitzungen haben HIER committet.

WIE DIE DRIFT ENTSTEHT: Der Zwischenspeicher ~/.rsi/wiki/mupibox/ ist selbst
ein Klon, steht git-seitig aber auf einem alten Commit — seine pack.yaml wird
per Kopie ueberschrieben, nicht per commit+pull. Wer in den Klon schreibt,
schreibt damit an der fuehrenden Kopie vorbei. Am 20.08.2026 standen so drei
Eintraege im Klon, die nie beim Leser ankamen, und fuenfzehn im Box-Pack, die
der Klon nicht hatte.

WARUM NICHT EINFACH yaml.safe_dump: Das Paket ist 2 MB mit ueber 640
Eintraegen und lebt von Faltblöcken, Reihenfolge und gewachsener Einrueckung.
safe_dump schreibt die ganze Datei neu und macht aus jedem Diff eine
Generalueberholung. Dieses Werkzeug schneidet den ROHTEXT eines Eintrags heraus
und haengt ihn als Text an — die Datei bleibt sonst Zeile fuer Zeile gleich.

══ DIE DRITTE STUFE ═══════════════════════════════════════════════════════
Der Paarvergleich sieht nur die beiden Kopien auf DIESEM Rechner. Am
20.08.2026 meldete er „NUR in der Quelle (0)" — alles gut — waehrend
origin/main auf v205/659 Eintraegen stand und der Baum auf v214/693: 34
Commits Rueckstand. Wer per `wiki.py fetch` holt, bekommt die FERNKOPIE, nicht
den Baum. Deshalb berichtet dieses Werkzeug jetzt zuerst alle drei Stufen
(Baum -> Spiegel -> origin) und erst danach den Paarvergleich. Ein gruener
Paarvergleich ist eine Aussage ueber zwei Stufen, nicht ueber die Strecke bis
zum Leser. Siehe Wiki-Eintrag nachziehen-endet-erst-an-der-fernkopie.

══ AUFRUF ═════════════════════════════════════════════════════════════════
    python3 tools/pack-abgleich.py                    # Stufen + berichten
    python3 tools/pack-abgleich.py --nur-stufen       # nur die drei Stufen
    python3 tools/pack-abgleich.py --holen id1 id2    # verbatim uebernehmen
    python3 tools/pack-abgleich.py --von A --nach B   # andere Paare
"""
import argparse
import pathlib
import re
import subprocess
import sys

WURZEL = pathlib.Path(__file__).resolve().parent.parent
BOX = WURZEL / 'llmwiki' / 'pack.yaml'
KLON = pathlib.Path.home() / 'Downloads' / 'llmwiki_mupibox' / 'pack.yaml'
SPIEGEL = pathlib.Path.home() / '.rsi' / 'wiki' / 'mupibox' / 'pack.yaml'
FERN = 'origin/main'
IM_REPO = 'llmwiki/pack.yaml'

# Ein Eintrag beginnt bei 2 Leerzeichen + "- ". Die id kann in der ERSTEN
# Zeile stehen (`- id: x`) oder weiter unten im Block (`- kind: falle` /
# `    id: x`) — beide Bauarten kommen im Paket vor.
BEGINN = re.compile(r'^  - ')
ID_ZEILE = re.compile(r'^(?:  - |    )id:\s*(\S+)\s*$')


def bloecke(pfad):
    """Rohtext je Eintrag: {id: [zeilen]} — Reihenfolge bleibt erhalten."""
    zeilen = pfad.read_text(encoding='utf-8').splitlines(keepends=True)
    gefunden, aktuell, kopf = {}, [], None
    for z in zeilen:
        if BEGINN.match(z):
            if kopf:
                gefunden[kopf] = aktuell
            aktuell, kopf = [z], None
        elif aktuell:
            aktuell.append(z)
        if aktuell and kopf is None:
            t = ID_ZEILE.match(z)
            if t:
                kopf = t.group(1)
    if kopf:
        gefunden[kopf] = aktuell
    return gefunden


def fassung(pfad):
    for z in pfad.read_text(encoding='utf-8').splitlines()[:5]:
        if z.startswith('version:'):
            return z.split(':', 1)[1].strip().strip('"')
    return '?'


def verweisziele(zeilen):
    """Alle ids, auf die dieser Block per related/siehe zeigt."""
    ziele = []
    for z in zeilen:
        t = re.match(r'^\s*(?:related|siehe):\s*\[(.*)\]\s*$', z)
        if t:
            ziele += [s.strip().strip('"\'') for s in t.group(1).split(',') if s.strip()]
    return ziele


def teile_besprochene(ids, ziel_pfad):
    """(offen, besprochen) — wen das Ziel im Fliesstext nennt, ist kein Befund.

    WOZU: Zwei ids aus dem stillgelegten Klon stehen seit dem 22.08.2026
    dauerhaft unter „NUR in der Quelle", und das Ziel-Paket haelt in
    stillgelegtes-repo-… ausdruecklich fest, dass sie NICHT geholt werden
    duerfen: ihre gueltige Fassung steht dort laengst unter anderen ids. Ein
    Lauf, der sie trotzdem wie frischen Verlust meldet, kostet jede Stunde
    dieselbe Untersuchung und verdeckt den naechsten echten Fund
    ([[wiederkehrender-befund-ist-ablauffehler]], [[dauerrote-wache-ist-keine]]).

    Das Merkmal ist die SORTE, nicht eine Liste im Skript: gefragt wird, ob das
    Ziel-Paket ueber die id REDET. Taucht im Klon je ein wirklich neuer Eintrag
    auf, ueber den hier niemand geschrieben hat, steht er weiterhin oben unter
    „NUR in der Quelle" — die Wache wird also nicht stumpf, nur leiser
    ([[wortzahl-ist-kein-ausschluss-ueber-den-gegenstand]]).
    """
    if not ids:
        return [], []
    text = ziel_pfad.read_text(encoding='utf-8')
    offen, besprochen = [], []
    for i in ids:
        # Wortgrenze: sonst gilt eine kurze id als besprochen, nur weil eine
        # laengere id sie als Teilstueck enthaelt.
        (besprochen if re.search(r'(?<![\w-])%s(?![\w-])' % re.escape(i), text)
         else offen).append(i)
    return offen, besprochen


def fassung_aus_text(text):
    for z in text.splitlines()[:5]:
        if z.startswith('version:'):
            return z.split(':', 1)[1].strip().strip('"')
    return '?'


def _git(*args):
    """git im Box-Baum; None statt Ausnahme, wenn es nicht geht (kein Remote,
    kein Netz, kein Repo). Die Stufenschau darf nie der Grund sein, dass der
    Abgleich gar nicht laeuft."""
    try:
        r = subprocess.run(('git', '-C', str(WURZEL)) + args,
                           capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None
    return r.stdout if r.returncode == 0 else None


def stufen():
    """Die drei Stufen bis zum Leser, jede mit Fassung und Eintragszahl.

    Gezaehlt wird ueber dieselben Bloecke wie beim Paarvergleich, damit die
    Zahlen vergleichbar sind — NICHT ueber yaml.safe_load (2 MB je Aufruf).
    """
    print('DIE DREI STUFEN BIS ZUM LESER')
    for name, text in (
        ('Baum    ' + IM_REPO, BOX.read_text(encoding='utf-8') if BOX.exists() else None),
        ('Spiegel ~/.rsi/wiki/mupibox', SPIEGEL.read_text(encoding='utf-8') if SPIEGEL.exists() else None),
        ('Fern    ' + FERN, _git('show', '%s:%s' % (FERN, IM_REPO))),
    ):
        if text is None:
            print('  %-32s  nicht lesbar' % name)
            continue
        n = sum(1 for z in text.splitlines() if BEGINN.match(z + '\n'))
        print('  %-32s  Fassung %-5s %d Eintraege' % (name, fassung_aus_text(text), n))

    rueckstand = _git('rev-list', '--count', '%s..HEAD' % FERN)
    if rueckstand is not None and rueckstand.strip().isdigit():
        n = int(rueckstand.strip())
        if n:
            print('\n  ACHTUNG: %d Commit(s) sind NICHT auf %s.' % (n, FERN))
            print('           Wer per `wiki.py fetch` holt, bekommt die Fernkopie.')
            print('           Pushen entscheidet der Betreiber — hier nur gemeldet.')
        else:
            print('\n  Fernkopie ist auf demselben Stand wie der Baum.')
    print()


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--von', type=pathlib.Path, default=KLON)
    p.add_argument('--nach', type=pathlib.Path, default=BOX)
    p.add_argument('--holen', nargs='+', metavar='ID')
    p.add_argument('--nur-stufen', action='store_true',
                   help='nur die drei Stufen zeigen, keinen Paarvergleich')
    a = p.parse_args()

    stufen()
    if a.nur_stufen:
        return

    for f in (a.von, a.nach):
        if not f.exists():
            sys.exit('fehlt: %s' % f)

    quelle, ziel = bloecke(a.von), bloecke(a.nach)
    print('von : %s  (Fassung %s, %d Eintraege)' % (a.von, fassung(a.von), len(quelle)))
    print('nach: %s  (Fassung %s, %d Eintraege)' % (a.nach, fassung(a.nach), len(ziel)))
    print()

    nur_quelle = [i for i in quelle if i not in ziel]
    nur_ziel = [i for i in ziel if i not in quelle]
    offen, besprochen = teile_besprochene(nur_quelle, a.nach)
    print('NUR in der Quelle (%d) — kommen beim Leser nicht an:' % len(offen))
    for i in offen:
        print('    ', i)
    if besprochen:
        print('BESPROCHEN (%d) — fehlen als Eintrag, aber das Ziel redet ueber sie:'
              % len(besprochen))
        for i in besprochen:
            print('    ', i)
        print('    -> KEIN Befund im Sinne von "geht verloren". Vor dem Holen im')
        print('       Ziel nachlesen, WARUM dort ueber sie geredet wird — meist')
        print('       steht die gueltige Fassung unter anderer id schon da.')
    print('NUR im Ziel (%d):' % len(nur_ziel))
    for i in nur_ziel:
        print('    ', i)

    if not a.holen:
        print('\n(nur berichtet — zum Uebernehmen: --holen <id> ...)')
        return

    print()
    text, uebernommen = [], []
    for i in a.holen:
        if i not in quelle:
            sys.exit('nicht in der Quelle: %s' % i)
        if i in ziel:
            sys.exit('steht im Ziel schon: %s' % i)
        tot = [z for z in verweisziele(quelle[i]) if z not in ziel and z not in a.holen]
        if tot:
            print('  ACHTUNG %s zeigt ins Leere auf: %s' % (i, ', '.join(tot)))
            print('          -> vor dem Uebernehmen im Quelltext berichtigen.')
            sys.exit('abgebrochen, damit kein toter Verweis entsteht.')
        text += ['\n'] + quelle[i]
        uebernommen.append(i)

    with a.nach.open('a', encoding='utf-8') as f:
        f.write(''.join(text))

    alt = fassung(a.nach)
    neu = str(int(alt) + 1) if alt.isdigit() else alt
    inhalt = a.nach.read_text(encoding='utf-8')
    a.nach.write_text(inhalt.replace('version: "%s"' % alt, 'version: "%s"' % neu, 1), encoding='utf-8')

    print('uebernommen: %s' % ', '.join(uebernommen))
    print('Fassung %s -> %s' % (alt, neu))
    print('\nJETZT NOCH: python3 tools/wiki-schau.py   (Verweise pruefen)')
    print('UND:        das Paket nach ~/.rsi/wiki/mupibox/ spiegeln —')
    print('            sonst sieht `rsi diagnose` den Nachtrag nicht.')


if __name__ == '__main__':
    main()
