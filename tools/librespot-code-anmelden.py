#!/usr/bin/env python3
"""librespot anmelden OHNE Spotify-App und OHNE Tunnel — nur ein Code.

══ WOZU ═══════════════════════════════════════════════════════════════════
Betreiber, 11.08.2026: „gibt es nicht ein weg ohne den app" und davor „koennen
wir das anmelden nicht ueber den schritt mit dem qr loesen".

Beides ist berechtigt, und beides ging bisher nicht:

  * Der QR-Weg meldet die WEB-API an (Blaettern, Cover, Steuern). Er benutzt
    die selbst angelegte Client-ID aus dem Dashboard — und ein Token daraus
    weist Spotify am Connect-Netz ab (INVALID_CREDENTIALS, am Geraet gemessen).
  * Die Uebergabe aus der Spotify-App braucht die App. Im librespot-Projekt
    steht dazu ausdruecklich: „There is no working example for adding the user
    through the zeroconf endpoint without a previous connect operation using
    one of the official Spotify apps."
  * librespots eigener OAuth-Weg (--enable-oauth) laesst Spotify auf
    `http://127.0.0.1:5588/login` zurueckleiten — also auf das Geraet, das den
    Browser aufhat. Vom Handy aus fuehrt das ins Leere; deshalb der SSH-Tunnel
    in tools/librespot-anmelden.py.

══ WARUM ES OHNE TUNNEL GEHT ══════════════════════════════════════════════
Die Rueckleitung TRAEGT NUR EINEN CODE in der Adresszeile:

    http://127.0.0.1:5588/login?code=AQD…&state=…

Dass dort niemand horcht, ist gleichgueltig — der Code steht trotzdem im
Browser. Und der Tausch Code→Token ist ein POST an Spotify, den JEDER machen
kann, der den zugehoerigen PKCE-Pruefwert hat. Spotify prueft beim Tausch nur,
dass dieselbe `redirect_uri` mitgeschickt wird; ob dort ein Server stand, wird
nicht nachgesehen.

Also erzeugt dieses Werkzeug den Pruefwert SELBST, statt ihn librespot zu
ueberlassen. Dann ist der Browser des Handys nur noch ein Bote.

    Schritt 1   python3 tools/librespot-code-anmelden.py --start
                → Adresse (und QR) fuers Handy
    Schritt 2   am Handy oeffnen, bestaetigen; die Seite laeuft ins Leere
                → die Adresse aus der Adresszeile kopieren
    Schritt 3   python3 tools/librespot-code-anmelden.py --code '<Adresse>'
                → Token holen, librespot damit einmal anmelden, fertig

DIE CLIENT-ID IST SPOTIFYS EIGENE (65b708073fc0480ea92a077233ca87bd) — genau
die, die librespot bei --enable-oauth benutzt. Sie wird hier NICHT irgendwo
eingetragen und ersetzt auch nichts: die Client-ID der Box bleibt fuer die
Web-API zustaendig. Es sind zwei Zugaenge, und das bleiben sie.

══ WAS DAMIT AUS DEM QR-SCHRITT WERDEN KANN ═══════════════════════════════
Dieses Werkzeug ist der Beweis, dass der Weg traegt. Traegt er, gehoert er in
die Verwaltung: die Box zeigt den QR, das Handy bestaetigt, und die Seite auf
der Box nimmt die zurueckgeleitete Adresse als EINZIGES Feld entgegen — ohne
Tunnel, ohne App, ohne Dashboard.

══ WAS ANGEFASST WIRD ═════════════════════════════════════════════════════
    * Nur bei --code: librespot.service wird kurz angehalten und wieder
      gestartet, credentials.json wird vorher beiseitegelegt.
    * Die Konfiguration der Box wird NICHT veraendert — kein accessToken,
      kein refreshToken, keine Client-ID.
    * Kein Neustart der Box, nichts an WLAN oder Bluetooth.

Der Token wird auf der BOX getauscht und bleibt dort; dieses Werkzeug schickt
nur den Code hin.
"""
import argparse
import base64
import hashlib
import json
import os
import secrets
import subprocess
import sys
import time
import urllib.parse

# Spotifys eigener Client — derselbe, den `librespot --enable-oauth` nimmt
# (am 11.08.2026 aus seiner Ausgabe abgelesen, nicht geraten).
CLIENT = '65b708073fc0480ea92a077233ca87bd'
RUECKWEG = 'http://127.0.0.1:5588/login'
# librespot fordert diese Rechte an; `streaming` ist das entscheidende.
RECHTE = 'streaming user-read-email user-read-private app-remote-control ' \
         'user-modify-playback-state user-read-playback-state'
MERK = os.path.expanduser('~/.cache/mixpibox-librespot-pkce.json')
SSH = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10']


def roh64(b):
    return base64.urlsafe_b64encode(b).decode().rstrip('=')


def starten():
    pruefwert = roh64(secrets.token_bytes(64))
    zustand = roh64(secrets.token_bytes(16))
    frage = roh64(hashlib.sha256(pruefwert.encode()).digest())
    os.makedirs(os.path.dirname(MERK), exist_ok=True)
    # 0600: der Pruefwert ist fuer die Dauer des Vorgangs so gut wie ein
    # halber Schluessel — wer ihn und den Code hat, bekommt den Token.
    with open(MERK, 'w') as f:
        json.dump({'pruefwert': pruefwert, 'zustand': zustand, 'zeit': int(time.time())}, f)
    os.chmod(MERK, 0o600)

    url = 'https://accounts.spotify.com/authorize?' + urllib.parse.urlencode({
        'response_type': 'code', 'client_id': CLIENT, 'redirect_uri': RUECKWEG,
        'scope': RECHTE, 'code_challenge_method': 'S256',
        'code_challenge': frage, 'state': zustand,
    })
    print('══ Schritt 1 von 2 ══\n')
    print('  Diese Adresse am HANDY oeffnen und bei Spotify bestaetigen:\n')
    print('  ' + url + '\n')
    print('  Danach laeuft die Seite ins Leere ("Seite nicht erreichbar") —')
    print('  DAS IST RICHTIG SO. Der Code steht in der Adresszeile.\n')
    print('  Die GANZE Adresse aus der Adresszeile kopieren und einsetzen:\n')
    print("    python3 tools/librespot-code-anmelden.py --box <box> --code '<Adresse>'")
    return 0


def code_holen(eingabe, zustand_soll):
    """Aus einer eingefuegten Adresse (oder einem blanken Code) den Code ziehen.

    BEIDES ZULASSEN, weil beides vorkommt: manche Browser lassen die ganze
    Adresse kopieren, andere zeigen nur eine Fehlerseite und man tippt den
    Code ab. Ein Werkzeug, das nur eine Form annimmt, schickt jemanden zurueck
    ans Handy, der schon alles richtig gemacht hat.
    """
    eingabe = eingabe.strip().strip('\'"')
    if 'code=' not in eingabe:
        return eingabe, ''
    teile = urllib.parse.parse_qs(urllib.parse.urlparse(eingabe).query)
    code = (teile.get('code') or [''])[0]
    zustand = (teile.get('state') or [''])[0]
    if zustand and zustand_soll and zustand != zustand_soll:
        return '', 'der Zustandswert passt nicht — stammt die Adresse aus einem aelteren Anlauf?'
    return code, ''


def auf_box(box, befehl, zeit=90, eingabe=None):
    return subprocess.run(SSH + [box, befehl], capture_output=True, text=True,
                          timeout=zeit, input=eingabe)


def einloesen(box, eingabe):
    try:
        with open(MERK) as f:
            merk = json.load(f)
    except Exception:
        print('  FEHLER  Es liegt kein offener Anlauf vor. Erst --start aufrufen.')
        return 1
    if time.time() - merk.get('zeit', 0) > 900:
        print('  FEHLER  Der Anlauf ist aelter als 15 Minuten — Spotify laesst den')
        print('          Code dann nicht mehr eintauschen. Bitte --start neu.')
        return 1

    code, klage = code_holen(eingabe, merk.get('zustand', ''))
    if klage:
        print('  FEHLER  ' + klage)
        return 1
    if not code:
        print('  FEHLER  In der Eingabe steckt kein Code.')
        return 1

    r = auf_box(box, "sudo jq -r '.spotify.cachepath' /etc/mupibox/mupiboxconfig.json; "
                     "sudo jq -r '.mupibox.host' /etc/mupibox/mupiboxconfig.json")
    teile = [z.strip() for z in r.stdout.strip().splitlines() if z.strip()]
    if len(teile) < 2:
        print('  FEHLER  cachepath/host nicht lesbar — ist das die richtige Box?')
        return 1
    cache, name = teile[0], teile[1]

    # ══ DER TAUSCH PASSIERT AUF DER BOX ═══════════════════════════════════
    # Der Token ist ein Geheimnis. Er koennte hier getauscht und dann
    # hinuebergeschickt werden — dann laege er aber einmal auf dem
    # Arbeitsrechner, in einer Prozessliste und womoeglich in einer History.
    # Auf der Box entsteht er, auf der Box bleibt er.
    print('══ Schritt 2 von 2 ══\n')
    print('  Code auf der Box gegen einen Token tauschen …')
    tausch = f'''
import json, urllib.parse, urllib.request, sys
d = json.load(sys.stdin)
p = urllib.parse.urlencode({{
    'grant_type': 'authorization_code', 'code': d['code'],
    'redirect_uri': {RUECKWEG!r}, 'client_id': {CLIENT!r},
    'code_verifier': d['pruefwert'],
}}).encode()
try:
    with urllib.request.urlopen(urllib.request.Request(
            'https://accounts.spotify.com/api/token', data=p,
            headers={{'Content-Type': 'application/x-www-form-urlencoded'}}), timeout=25) as a:
        t = json.load(a)
except urllib.error.HTTPError as e:
    print('FEHLER ' + e.read().decode('utf-8', 'replace')[:300]); raise SystemExit(1)
if not t.get('access_token'):
    print('FEHLER kein access_token in der Antwort'); raise SystemExit(1)
open('/tmp/.librespot-token', 'w').write(t['access_token'])
import os; os.chmod('/tmp/.librespot-token', 0o600)
print('TOKEN-DA %d Zeichen' % len(t['access_token']))
'''
    r = auf_box(box, 'python3 -c ' + repr_sicher(tausch), zeit=90,
                eingabe=json.dumps({'code': code, 'pruefwert': merk['pruefwert']}))
    if 'TOKEN-DA' not in r.stdout:
        print('  FEHLER  Der Tausch misslang:')
        print('  ' + (r.stdout + r.stderr).strip()[:400])
        auf_box(box, 'rm -f /tmp/.librespot-token')
        return 1
    print('  ' + [z for z in r.stdout.splitlines() if 'TOKEN-DA' in z][0]
          .replace('TOKEN-DA', 'Token erhalten,'))

    # ══ EINMAL ANMELDEN, DANN LEBT credentials.json VON SELBST ════════════
    print('\n  librespot meldet sich einmal mit diesem Token an …')
    auf_box(box, 'sudo systemctl stop librespot.service')
    auf_box(box, f'[ -f {cache}/credentials.json ] && sudo mv -f {cache}/credentials.json '
                 f'{cache}/credentials.json.vor-codeanmeldung; true')
    lauf = (f'LIBRESPOT_ACCESS_TOKEN=$(cat /tmp/.librespot-token) '
            f'timeout 45 /usr/bin/librespot --cache {cache} --name {name!r} '
            f'--backend pipe > /tmp/.codeanmeldung.log 2>&1; '
            f'shred -u /tmp/.librespot-token 2>/dev/null || rm -f /tmp/.librespot-token; '
            f'grep -iE "denied|error|invalid" /tmp/.codeanmeldung.log | head -3; '
            f'[ -f {cache}/credentials.json ] && echo ANGEMELDET || echo NICHTS; '
            f'rm -f /tmp/.codeanmeldung.log')
    r = auf_box(box, lauf, zeit=120)
    for z in r.stdout.splitlines():
        if z.strip() and 'ANGEMELDET' not in z and 'NICHTS' not in z:
            print('    ' + z.strip()[:150])

    geschafft = 'ANGEMELDET' in r.stdout
    auf_box(box, 'sudo systemctl start librespot.service')
    if not geschafft:
        print('\n  ✗ Es entstand keine Anmeldung. Der alte Stand ist zurueck.')
        print('    Dann nimmt Spotify auch den eigenen Client nicht an, und die')
        print('    Ursache liegt woanders als bei der Client-ID.')
        return 1

    print('\n  Anmeldung angelegt. Dienst laeuft wieder — 60 s nachmessen …')
    for wart, wie in ((25, 'nach 25 s'), (35, 'nach 60 s')):
        time.sleep(wart)
        r = auf_box(box, 'systemctl show librespot.service -p ActiveState '
                         '-p SubState -p NRestarts', zeit=30)
        d = dict(z.split('=', 1) for z in r.stdout.split() if '=' in z)
        print(f'    {wie}: {d.get("ActiveState")}/{d.get("SubState")}, '
              f'{d.get("NRestarts")} Neustarts')
    gut = d.get('ActiveState') == 'active' and d.get('NRestarts') == '0'
    print('\n  ' + ('✓ librespot laeuft stabil und ist angemeldet. Die Box sollte '
                    'jetzt in Spotify stehen.' if gut else
                    '✗ Es startet weiter neu — sudo journalctl -u librespot -n 40'))
    return 0 if gut else 1


def repr_sicher(text):
    """Python-Quelltext so einpacken, dass die entfernte Shell ihn nicht anfasst."""
    return "'" + text.replace("'", "'\\''") + "'"


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument('--box', default='dietpi@192.168.178.57')
    p.add_argument('--start', action='store_true', help='Schritt 1: Adresse fuers Handy')
    p.add_argument('--code', help='Schritt 2: die zurueckgeleitete Adresse (oder nur der Code)')
    a = p.parse_args()
    box = a.box if '@' in a.box else 'dietpi@' + a.box
    if a.start:
        return starten()
    if a.code:
        return einloesen(box, a.code)
    p.print_help()
    return 2


if __name__ == '__main__':
    sys.exit(main())
