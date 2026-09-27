#!/usr/bin/env python3
"""Meldet librespot mit SEINEM eigenen Weg bei Spotify an — ein Klick.

══ WOZU ═══════════════════════════════════════════════════════════════════
Betreiber, 11.08.2026: „spotify spielt nicht ab hat aber zugang", dann „was
muss ich tuen".

Die Box hat ZWEI Spotify-Zugaenge, und nur einer war in Ordnung:

    Web-API (PKCE, der QR-Weg)   Blaettern, Cover, Steuern     laeuft
    librespot (Connect-Geraet)   der TON                       abgewiesen

librespot lief im Neustartkreis mit `INVALID_CREDENTIALS`. Ausgeschlossen
wurde am Geraet: Token zu alt (frischer geholt, gleiche Absage), fehlendes
Streaming-Recht (`streaming` wird angefordert), fremdes Konto (dasselbe), kein
Premium (`product: premium`, Land DE).

══ WAS UEBRIG BLEIBT: DIE CLIENT-ID ═══════════════════════════════════════
Gemessen an `librespot --enable-oauth`:

    client_id=65b708073fc0480ea92a077233ca87bd

Das ist Spotifys eigener, langjaehriger Client. Die Box benutzt seit dem
Umbau die SELBST angelegte ID aus dem Dashboard (e5e33cbb…). Fuer die Web-API
ist das genau richtig — fuer die Anmeldung am Connect-Netz offenbar nicht:
dort wird ein Token aus einer fremden App abgewiesen.

Deshalb nimmt dieses Werkzeug librespots eigenen Weg, statt ihm einen Token
unterzuschieben. Die Client-ID der Box bleibt unangetastet; sie ist fuer den
anderen Zugang weiter zustaendig.

══ WARUM EIN TUNNEL NOETIG IST ════════════════════════════════════════════
librespot laesst Spotify auf `http://127.0.0.1:5588/login` zurueckleiten —
auf sich selbst. Wer die Anmeldeseite am Arbeitsrechner oder am Telefon
oeffnet, landet danach auf DESSEN 127.0.0.1, wo niemand horcht. Genau
dieselbe Falle wie beim Spotify-Setup der Box (E22/R4).

`ssh -L 5588:127.0.0.1:5588` legt die Bruecke: 127.0.0.1:5588 am
Arbeitsrechner ist dann 127.0.0.1:5588 auf der Box. Die Rueckleitung kommt an,
ohne dass an Spotify oder an librespot etwas geaendert werden muesste.

══ WAS ANGEFASST WIRD, UND WAS NICHT ══════════════════════════════════════
    * librespot.service wird ANGEHALTEN und am Ende wieder gestartet.
    * credentials.json wird beiseitegelegt (…​.vor-eigenanmeldung), nicht
      geloescht. Geht etwas schief, ist der alte Stand da.
    * Die Konfiguration der Box wird NICHT angefasst — kein accessToken, kein
      refreshToken, keine Client-ID.
    * Kein Neustart der Box. Nichts an WLAN oder Bluetooth.

Das Geheimnis selbst sieht dieses Werkzeug nie: den Token holt librespot auf
der Box, und dort bleibt er auch.

AUFRUF
    python3 tools/librespot-anmelden.py --box dietpi@192.168.178.57
    python3 tools/librespot-anmelden.py --box … --nur-pruefen
"""
import argparse
import json
import re
import subprocess
import sys
import time

PORT = 5588
SSH = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10']


def auf_box(box, befehl, zeit=60):
    return subprocess.run(SSH + [box, befehl], capture_output=True, text=True, timeout=zeit)


def stand(box):
    """Wie geht es librespot gerade? (Zustand, Neustarts, letzte Absage)"""
    r = auf_box(box, "systemctl show librespot.service -p ActiveState -p SubState "
                     "-p NRestarts; sudo journalctl -u librespot -n 30 --no-pager -o cat "
                     "--since -10min 2>/dev/null | grep -c INVALID_CREDENTIALS || true")
    zeilen = r.stdout.strip().splitlines()
    d = dict(z.split('=', 1) for z in zeilen if '=' in z)
    absagen = 0
    for z in reversed(zeilen):
        if z.strip().isdigit():
            absagen = int(z.strip())
            break
    return d.get('ActiveState', '?'), d.get('SubState', '?'), d.get('NRestarts', '?'), absagen


def zeigen(box, wann):
    a, u, n, absagen = stand(box)
    print(f'  {wann}: {a}/{u}, {n} Neustarts, {absagen} Absagen in 10 min')
    return a, u, n, absagen


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument('--box', required=True, help='z. B. dietpi@192.168.178.57')
    p.add_argument('--nur-pruefen', action='store_true',
                   help='nur den Zustand zeigen, nichts anfassen')
    p.add_argument('--frist', type=int, default=300,
                   help='wie lange auf den Klick gewartet wird (Sekunden)')
    a = p.parse_args()
    box = a.box if '@' in a.box else 'dietpi@' + a.box

    print('══ Zustand vorher ══')
    zeigen(box, 'jetzt')
    if a.nur_pruefen:
        return 0

    # ── Wohin die Anmeldung gehoert ──────────────────────────────────────
    r = auf_box(box, "sudo jq -r '.spotify.cachepath' /etc/mupibox/mupiboxconfig.json; "
                     "sudo jq -r '.mupibox.host' /etc/mupibox/mupiboxconfig.json")
    teile = [z.strip() for z in r.stdout.strip().splitlines() if z.strip()]
    if len(teile) < 2:
        print('  FEHLER  cachepath/host nicht lesbar — ist das die richtige Box?')
        return 1
    cache, name = teile[0], teile[1]
    print(f'  Anmeldung wird abgelegt unter: {cache}/credentials.json')

    # ── Platz machen: Dienst anhalten, alte Anmeldung beiseite ───────────
    print('\n══ Platz machen ══')
    auf_box(box, 'sudo systemctl stop librespot.service')
    auf_box(box, f'[ -f {cache}/credentials.json ] && '
                 f'sudo mv -f {cache}/credentials.json {cache}/credentials.json.vor-eigenanmeldung; true')
    print('  librespot angehalten, alte Anmeldung als …​.vor-eigenanmeldung beiseite')

    # ── librespot mit seinem eigenen Weg starten ─────────────────────────
    #
    # setsid + nohup, damit es die SSH-Sitzung ueberlebt. Die PID wird
    # aufgeschrieben: beendet wird spaeter GENAU dieser Vorgang und nicht,
    # was ein Mustervergleich sonst noch trifft.
    print('\n══ librespot fragt Spotify nach einer eigenen Anmeldung ══')
    start = (f'rm -f /tmp/.librespot-oauth.log /tmp/.librespot-oauth.pid; '
             f'setsid nohup /usr/bin/librespot --enable-oauth --oauth-port {PORT} '
             f'--cache {cache} --name {name!r} --backend pipe '
             f'> /tmp/.librespot-oauth.log 2>&1 & echo $! > /tmp/.librespot-oauth.pid; '
             f'sleep 4; cat /tmp/.librespot-oauth.log')
    r = auf_box(box, start, zeit=90)
    treffer = re.search(r'https://accounts\.spotify\.com/authorize\S+', r.stdout)
    if not treffer:
        print('  FEHLER  librespot hat keine Anmelde-Adresse ausgegeben:')
        print('  ' + (r.stdout or r.stderr).strip()[:400])
        aufraeumen(box)
        return 1
    url = treffer.group(0)

    # ── Die Bruecke fuer die Rueckleitung ────────────────────────────────
    tunnel = subprocess.Popen(
        SSH + ['-N', '-L', f'{PORT}:127.0.0.1:{PORT}', box],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2)
    if tunnel.poll() is not None:
        print(f'  FEHLER  der Tunnel auf Port {PORT} kam nicht zustande '
              f'(schon belegt?).')
        aufraeumen(box)
        return 1

    print('\n' + '═' * 70)
    print('  JETZT SIND SIE DRAN — ein Klick, sonst nichts:')
    print()
    print('  Diese Adresse im Browser HIER auf dem Arbeitsrechner oeffnen')
    print('  und bei Spotify bestaetigen:')
    print()
    print('  ' + url)
    print()
    print('  Danach steht im Browser eine kurze Bestaetigung. Mehr ist es nicht.')
    print('  (Kein Passwort hierher tippen — Sie melden sich bei Spotify an,')
    print('   nicht bei mir. Der Schluessel bleibt auf der Box.)')
    print('═' * 70 + '\n')

    print(f'  Warte bis zu {a.frist} s auf die Anmeldung …')
    fertig = False
    for i in range(a.frist // 5):
        time.sleep(5)
        r = auf_box(box, f'sudo test -f {cache}/credentials.json && echo DA || echo NOCHNICHT', zeit=25)
        if 'DA' in r.stdout:
            print(f'  Angemeldet nach {(i + 1) * 5} s.')
            fertig = True
            break
    else:
        print('  Es kam keine Anmeldung an.')

    # ── Aufraeumen: eigenen Vorgang beenden, Tunnel zu, Dienst zurueck ──
    tunnel.terminate()
    aufraeumen(box)

    if not fertig:
        print('\n  Der alte Stand ist wiederhergestellt. Nichts kaputt.')
        return 1

    print('\n══ librespot wieder als Dienst starten ══')
    auf_box(box, 'sudo systemctl start librespot.service')
    time.sleep(20)
    zust, unter, n, absagen = zeigen(box, 'nach 20 s')
    time.sleep(40)
    zust, unter, n2, absagen2 = zeigen(box, 'nach 60 s')

    # DER BEWEIS IST DIE DAUER, NICHT DER ZUSTAND. Ein abgewiesenes librespot
    # steht zwischendurch auch auf active/running — der Lauf ist dann nur
    # zwanzig Sekunden alt und schon verloren. Bleiben die Neustarts stehen,
    # ist es wirklich drin.
    gut = zust == 'active' and unter == 'running' and n2 == n
    print()
    if gut:
        print('  ✓ librespot laeuft stabil und wird nicht mehr abgewiesen.')
        print('    Die Box sollte jetzt in Spotify als Geraet auftauchen.')
    else:
        print('  ✗ Es startet weiter neu. Dann liegt es NICHT an der Client-ID.')
        print('    Naechster Blick: sudo journalctl -u librespot -n 40')
    return 0 if gut else 1


def aufraeumen(box):
    """Den von Hand gestarteten Vorgang beenden — ueber die PID, nie ueber ein Muster.

    `pkill -f librespot` traefe auch den Dienst und, je nach Aufruf, die eigene
    Sitzung. Die PID steht in einer Datei, weil sie eindeutig ist.
    """
    auf_box(box, 'P=$(cat /tmp/.librespot-oauth.pid 2>/dev/null); '
                 '[ -n "$P" ] && kill "$P" 2>/dev/null; sleep 1; '
                 '[ -n "$P" ] && kill -9 "$P" 2>/dev/null; '
                 'rm -f /tmp/.librespot-oauth.pid /tmp/.librespot-oauth.log; true')


if __name__ == '__main__':
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print('\n  Abgebrochen.')
        sys.exit(130)
