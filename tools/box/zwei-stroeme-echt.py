#!/usr/bin/env python3
"""VOLLGAS: zwei echte Spotify-Stroeme auf zwei Lautsprechern (E72).

    python3 zwei-stroeme-echt.py spotify:track:AAA spotify:track:BBB
    python3 zwei-stroeme-echt.py --sek 120 spotify:track:AAA spotify:track:BBB

Muss AUF DER BOX laufen. Beide Lautsprecher eingeschaltet und verbunden.

══ WAS DAS HIER IST — UND WAS ES NICHT IST ════════════════════════════════

`zwei-stroeme-probe.py` misst mit einem TESTTON, ob der Bluetooth-Stapel zwei
A2DP-Stroeme traegt. Das ist die Frage nach der FUNKZEIT.

Dieses Werkzeug ist die Frage danach: traegt die ganze Kette? Zwei
Soloist-Instanzen, zwei Spotify-Konten, zwei Tonziele — gleichzeitig. Es kann
Dinge zeigen, die der Testton nicht kann: dass ein Konto dem anderen die
Wiedergabe wegnimmt, dass eine Instanz die andere aus dem Netz draengt, dass
das Entschluesseln zweier Stroeme die CPU nicht traegt.

ES SPIELT ECHTE MUSIK UEBER ECHTE LAUTSPRECHER. Beide werden hoerbar. Wer das
neben einem schlafenden Kind startet, hat sich das selbst zuzuschreiben.

══ DIE VORPRUEFUNG, DIE NICHT UEBERSPRUNGEN WIRD ══════════════════════════

ZWEI STROEME MIT DEMSELBEN KONTO SIND KEIN PARALLELBETRIEB, sondern eine
Uebernahme: der zweite nimmt dem ersten die Wiedergabe weg. Am 20.08.2026 ist
das zweimal passiert, obwohl zwei VERSCHIEDENE spak_-Schluessel eingetragen
waren — der Schluessel traegt das Konto nicht (llmwiki:
spak-schluessel-traegt-das-konto-nicht).

Dieses Werkzeug liest deshalb VORHER, mit welchem Konto jede Instanz
angemeldet ist, und faengt gar nicht erst an, wenn es dasselbe ist. Die
Zeile `logged in as …` im Protokoll der Instanz ist die einzige Quelle, die
das weiss — nicht der Rueckgabewert, nicht die Ordnerliste.

══ WORAN MAN ERKENNT, DASS ES GESCHEITERT IST ═════════════════════════════

Nicht an einem Fehler. Ein Konto, das dem anderen die Wiedergabe wegnimmt,
meldet keinen Fehler — die Musik hoert einfach auf. Deshalb wird der Zustand
BEIDER Senken ueber die Zeit mitgeschrieben: faellt eine auf SUSPENDED,
waehrend die andere spielt, ist das der Befund.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time

CONFIG = '/etc/mupibox/mupiboxconfig.json'
SOLOIST = '/usr/local/bin/soloist'
DATEN_1 = '/var/lib/soloist'
DATEN_2 = os.path.expanduser('~/.local/share/soloist-mitschnitt')
TAKT_S = 2.0
URI_MUSTER = re.compile(r'^spotify:track:[A-Za-z0-9]+$')


def laufen(befehl, frist=12):
    """Befehl ausfuehren — UND BEI ZEITUEBERSCHREITUNG DAS BEHALTEN, WAS SCHON DA WAR.

    DER ERSTE ENTWURF WARF ES WEG. `TimeoutExpired` traegt die bis dahin
    gelesene Ausgabe in `.stdout`/`.stderr`; wer nur `str(e)` zurueckgibt,
    verliert sie. Genau daran scheiterte die Kontopruefung: Soloist laeuft ohne
    `-s`/`-p` durch bis zur Frist, und die Zeile `logged in as …` stand in der
    Ausgabe, die dabei verlorenging. Ergebnis: „(unbekannt)" fuer ein Konto,
    das sauber angemeldet war.

    Es ist heute die dritte Stelle dieser Art (vorher: stderr nach /dev/null,
    und ein Zaehler, der seine Zeilen aussortierte). Wer misst, darf die
    Ausgabe nicht wegwerfen, auch nicht die halbe.
    """
    def text(x):
        if x is None:
            return ''
        return x if isinstance(x, str) else x.decode('utf-8', 'replace')

    try:
        f = subprocess.run(befehl, capture_output=True, text=True, timeout=frist)
        return f.returncode, f.stdout, f.stderr
    except subprocess.TimeoutExpired as e:
        return -1, text(e.stdout), text(e.stderr)
    except FileNotFoundError as e:
        return -1, '', str(e)


def konfig(pfad, vorgabe=''):
    code, aus, _ = laufen(['jq', '-r', '%s // ""' % pfad, CONFIG])
    return aus.strip() if code == 0 and aus.strip() else vorgabe


def konto_von_strom1():
    """Mit welchem Konto ist der Dienst angemeldet? Aus SEINEM Journal."""
    code, aus, _ = laufen(['sudo', 'journalctl', '-u', 'soloist', '-n', '400', '--no-pager'])
    treffer = re.findall(r'logged in as (\S+)', aus or '')
    return treffer[-1] if treffer else None


def konto_von_strom2(schluessel):
    """Strom 2 kurz starten und die Anmeldezeile lesen. Er spielt dabei nichts."""
    code, aus, fehler = laufen(
        [SOLOIST, '-n', 'Kontopruefung', '-k', schluessel, '-D', DATEN_2], frist=16)
    treffer = re.findall(r'logged in as (\S+)', (aus or '') + (fehler or ''))
    return treffer[-1] if treffer else None


def bt_senken():
    code, aus, _ = laufen(['pactl', '-f', 'json', 'list', 'sinks'])
    try:
        roh = json.loads(aus)
    except (json.JSONDecodeError, TypeError):
        return []
    gefunden = []
    for s in roh:
        if not (s.get('name') or '').startswith('bluez_output'):
            continue
        p = s.get('properties') or {}
        mac = p.get('api.bluez5.address') or '?'
        gefunden.append({'name': s['name'], 'mac': mac, 'zustand': s.get('state', '?')})
    return gefunden


def senkenzustand():
    return {s['name']: s['zustand'] for s in bt_senken()}


def wlan():
    for k in ('/usr/sbin/iw', '/sbin/iw'):
        if os.path.exists(k):
            code, aus, _ = laufen([k, 'dev', 'wlan0', 'link'], frist=6)
            if code == 0 and 'Not connected' not in (aus or ''):
                m = re.search(r'signal:\s*(-?\d+)', aus)
                return int(m.group(1)) if m else None
            return None
    return None


def main():
    p = argparse.ArgumentParser()
    p.add_argument('uris', nargs='*', help='zwei spotify:track:… — einer je Strom')
    p.add_argument('--sek', type=float, default=90.0)
    p.add_argument('--vorpruefung', action='store_true',
                   help='nur die Konten pruefen, nichts abspielen')
    a = p.parse_args()

    uris = [u for u in a.uris if URI_MUSTER.match(u)]
    if len(uris) < 2 and not a.vorpruefung:
        sys.exit('Es braucht ZWEI Titel-Adressen (spotify:track:…) — einen je Strom.')

    schluessel2 = konfig('.spotify.soloistApiKeyMitschnitt')
    if not schluessel2:
        sys.exit('kein .spotify.soloistApiKeyMitschnitt in %s' % CONFIG)

    senken = bt_senken()
    print('Zwei echte Stroeme — Vollgas\n')
    print('Bluetooth-Ziele: %d' % len(senken))
    for s in senken:
        print('   %-38s %s  %s' % (s['name'][:38], s['mac'], s['zustand']))
    if len(senken) < 2:
        sys.exit('\nEs braucht ZWEI verbundene Lautsprecher. Beide einschalten.')

    print('\n══ VORPRUEFUNG: verschiedene Konten? ══')
    k1 = konto_von_strom1()
    k2 = konto_von_strom2(schluessel2)
    print('   Strom 1: %s' % (k1 or '(unbekannt)'))
    print('   Strom 2: %s' % (k2 or '(unbekannt)'))
    if not k1 or not k2:
        sys.exit('\nEin Konto liess sich nicht ablesen — ohne das waere der Lauf nicht zu deuten.')
    if k1 == k2:
        sys.exit(
            '\nBEIDE STROEME HAENGEN AM SELBEN KONTO.\n'
            'Das ist kein Parallelbetrieb, sondern eine Uebernahme: der zweite\n'
            'nimmt dem ersten die Wiedergabe weg. Erst trennen (je Strom einzeln\n'
            'paaren), dann messen.')
    print('   -> verschieden, Parallelbetrieb moeglich')
    if a.vorpruefung:
        print('\nNur Vorpruefung — es wurde nichts abgespielt.')
        return 0

    ziel1, ziel2 = senken[0]['name'], senken[1]['name']
    print('\n   Strom 1 -> %s' % ziel1)
    print('   Strom 2 -> %s' % ziel2)
    print('\nBEIDE LAUTSPRECHER WERDEN GLEICH HOERBAR.\n')

    vorher_w = wlan()
    # Strom 2: eigener Prozess, ein Titel, festes Tonziel, dann Schluss.
    kind = subprocess.Popen(
        [SOLOIST, '-n', konfig('.spotify.soloistNameMitschnitt') or (konfig('.mupibox.host', 'MuPiBox') + ' Stream 2'),
         '-k', schluessel2, '-D', DATEN_2, '-d', ziel2, '-i', '60', '-s', uris[1]],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    # Strom 1: ueber seine eigene Steuerung.
    laufen(['sudo', SOLOIST, 'ctl', 'play', uris[0], '-D', DATEN_1], frist=15)
    time.sleep(3)
    # Strom 1 auf sein Ziel legen — der Dienst folgt sonst der Standardsenke.
    code, aus, _ = laufen(['pactl', 'list', 'short', 'sink-inputs'])
    for z in (aus or '').splitlines():
        nr = z.split('\t')[0] if '\t' in z else z.split()[0] if z.split() else ''
        if nr.isdigit():
            laufen(['pactl', 'move-sink-input', nr, ziel1], frist=6)

    print('  %6s  %-10s %-10s %-8s %s' % ('sek', 'Strom 1', 'Strom 2', 'WLAN', 'Anmerkung'))
    beginn = time.monotonic()
    letzte = None
    beide_liefen = 0
    proben = 0
    try:
        while time.monotonic() - beginn < a.sek:
            time.sleep(TAKT_S)
            proben += 1
            z = senkenzustand()
            z1, z2 = z.get(ziel1, '?'), z.get(ziel2, '?')
            if z1 == 'RUNNING' and z2 == 'RUNNING':
                beide_liefen += 1
            w = wlan()
            schl = (z1, z2, kind.poll() is not None)
            if schl != letzte:
                anm = 'Strom 2 beendet' if kind.poll() is not None else ''
                print('  %6.0f  %-10s %-10s %-8s %s' % (
                    time.monotonic() - beginn, z1, z2,
                    ('%d dBm' % w) if w is not None else '?', anm))
                letzte = schl
    finally:
        if kind.poll() is None:
            kind.terminate()
        laufen(['sudo', SOLOIST, 'ctl', 'pause', '-D', DATEN_1], frist=10)

    nachher_k1 = konto_von_strom1()
    print('\n══ BEFUND ══════════════════════════════════════════════════')
    anteil = (beide_liefen / proben * 100) if proben else 0
    print('BEIDE gleichzeitig am Spielen: %.0f %% der Proben (%d von %d)' % (anteil, beide_liefen, proben))
    if anteil < 20:
        print('   >>> Das ist zu wenig fuer einen Beleg. Entweder hat einer der')
        print('   >>> Stroeme nicht gespielt, oder sie haben sich abgeloest.')
    print('Strom 1 nach dem Lauf angemeldet als: %s%s' % (
        nachher_k1 or '(unbekannt)',
        '   ← UNVERAENDERT' if nachher_k1 == k1 else '   ← GEWECHSELT, das waere ein Befund'))
    if vorher_w is not None:
        n = wlan()
        print('WLAN: %s -> %s dBm' % (vorher_w, n if n is not None else '?'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
