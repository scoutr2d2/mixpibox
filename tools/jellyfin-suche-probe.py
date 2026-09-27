#!/usr/bin/env python3
"""Misst, ob die Box einen Jellyfin-Server im Netz von selbst findet.

══ WOZU ═══════════════════════════════════════════════════════════════════
Betreiber, 10.08.2026: „dann der magic code / quick connect bei jellyfin ist
weg hab mir überlegt ob man nicht eine autodiscovery für den jellyfin server
machen kann."

Der magische Code war nicht weg — er meldete nur ehrlich:

    "Es ist kein Jellyfin-Server eingetragen. Trage ihn zuerst ein —
     ohne Adresse gibt es niemanden zu fragen."

`jellyfin.server` stand auf `""`, weil eine frisch geschriebene Karte die
Konfiguration nicht mitbringt. Die Adresse ist also die Wurzel und nicht das
Beiwerk: ohne sie hilft auch die schoenste Schnellverbindung nicht.

══ WIE GESUCHT WIRD ═══════════════════════════════════════════════════════
Jellyfins eigener Weg, kein Trick: ein UDP-Rundruf auf Port 7359 mit dem Text
„who is JellyfinServer?". Jeder Server im selben Netz antwortet mit JSON —
Name, Id, Address. Kein Abklappern von 254 Adressen, keine Minuten Wartezeit.

    $ python3 tools/jellyfin-suche-probe.py
    $ python3 tools/jellyfin-suche-probe.py --box 192.168.178.57

Ohne `--box` ruft dieses Werkzeug SELBST ins Netz (von diesem Rechner aus).
Mit `--box` fragt es den Endpunkt auf der Box — und das ist die Messung, auf
die es ankommt: der Browser kann kein UDP, die Suche gehoert auf die Box.

══ WAS EIN LEERES ERGEBNIS BEDEUTET, UND WAS NICHT ════════════════════════
Rundrufe ueberqueren KEINE Router. Ein Jellyfin hinter einem VPN, in einem
anderen VLAN oder ueber eine Fritzbox-Gastnetz-Grenze antwortet nicht. „Nichts
gefunden" heisst deshalb „nicht in diesem Netzsegment" — nicht „gibt es
nicht". Deshalb bleibt das Feld zum Eintippen stehen, und deshalb sagt dieses
Werkzeug den Unterschied ausdruecklich an.

══ DIE GEGENPROBE GEHOERT AUF DIE BOX, NICHT AUF DEN ARBEITSRECHNER ═══════
Am 11.08.2026 gemessen: der Arbeitsrechner (192.168.178.65) nimmt UEBERHAUPT
KEIN UDP von anderen Rechnern an — auch kein Unicast. Eigene Pakete an die
eigene Adresse kommen an, Pakete der Box nicht. Dort steht also eine
Firewall.

Damit ist der Arbeitsrechner als Ziel einer Gegenprobe untauglich: „nichts
gefunden" haette dort IMMER gestanden, egal wie gut die Suche ist. Genau so
sah es zuerst auch aus — und die falsche Schlussfolgerung waere gewesen, den
Endpunkt zu reparieren, der in Ordnung war.

`--gegenprobe` stellt das Schein-Jellyfin deshalb AUF DER BOX auf, per SSH.
Dort kommt der eigene Rundruf an, und der Beweis ist echt:

    $ python3 tools/jellyfin-suche-probe.py --gegenprobe dietpi@192.168.178.57

Rueckgabe: 0 wenn die Suche lief (auch ohne Fund), 1 wenn sie nicht lief.
"""
import argparse
import json
import socket
import sys
import urllib.error
import urllib.request

FRAGE = b'who is JellyfinServer?'
PORT = 7359
FRIST = 3.0


def selbst_suchen(frist=FRIST):
    """Von diesem Rechner aus rufen. Gibt (server, fehler) zurueck."""
    gefunden = {}
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        s.settimeout(0.5)
        s.sendto(FRAGE, ('255.255.255.255', PORT))
    except OSError as e:
        return [], f'der Rundruf ging nicht raus: {e}'

    import time
    ende = time.monotonic() + frist
    while time.monotonic() < ende:
        try:
            rohdaten, herkunft = s.recvfrom(4096)
        except socket.timeout:
            continue
        except OSError:
            break
        try:
            d = json.loads(rohdaten.decode('utf-8', 'replace'))
        except ValueError:
            # Was kein JSON ist, ist kein Jellyfin. Auf Port 7359 liegt in
            # manchen Netzen anderes Zeug — das ist kein Fehler, nur nichts.
            continue
        adresse = str(d.get('Address') or '').strip()
        if adresse and adresse not in gefunden:
            gefunden[adresse] = {
                'name': str(d.get('Name') or 'Jellyfin').strip(),
                'adresse': adresse,
                'id': str(d.get('Id') or '').strip(),
                'von': herkunft[0],
            }
    s.close()
    return list(gefunden.values()), ''


def box_fragen(box, port=8200):
    """Den Endpunkt auf der Box fragen — die Messung, die zaehlt."""
    weg = f'http://{box}:{port}/api/jellyfin/suchen'
    try:
        with urllib.request.urlopen(weg, timeout=15) as a:
            return json.loads(a.read().decode('utf-8')), ''
    except urllib.error.HTTPError as e:
        return None, f'HTTP {e.code} — den Endpunkt gibt es dort (noch) nicht'
    except Exception as e:
        return None, f'{type(e).__name__}: {e}'


def vorspielen(name='Schein-Jellyfin', adresse='http://192.168.178.9:8096', dauer=25):
    """Ein Jellyfin VORTAEUSCHEN — damit die Gegenprobe moeglich ist.

    ══ WOZU DAS NOETIG IST ═════════════════════════════════════════════════
    Eine Suche, die „nichts gefunden" meldet, beweist gar nichts: genau das
    wuerde auch ein Endpunkt melden, der den Rundruf nie abschickt, dessen
    Sockel sofort zufaellt oder der die Antwort verwirft. Am 11.08.2026 war
    kein Jellyfin im Netz — die erste Messung war also grundsaetzlich nicht
    unterscheidbar von einem kaputten Endpunkt.

    Dieser Modus horcht auf UDP 7359 und antwortet auf „who is JellyfinServer?"
    genau so, wie Jellyfin es tut. Findet die Box ihn, dann sucht sie wirklich.

        Fenster 1:  python3 tools/jellyfin-suche-probe.py --vorspielen
        Fenster 2:  python3 tools/jellyfin-suche-probe.py --box 192.168.178.57

    ES IST EIN PRUEFSTAND, KEIN SERVER. Die Adresse, die er nennt, fuehrt
    nirgendwohin — wer sie uebernimmt, hat eine Adresse ohne Jellyfin dahinter.
    Deshalb heisst er im Netz auch „Schein-Jellyfin" und nicht anders.
    """
    import time
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        s.bind(('', PORT))
    except OSError as e:
        print(f'  Port {PORT} laesst sich nicht belegen: {e}')
        print('  (Laeuft dort schon ein echtes Jellyfin? Dann braucht es diese Probe nicht.)')
        return 1
    s.settimeout(0.5)
    antwort = json.dumps({'Address': adresse, 'Id': '0' * 32, 'Name': name}).encode('utf-8')
    print(f'  Horcht auf UDP {PORT} und gibt sich als „{name}" aus ({adresse}).')
    print(f'  {dauer} Sekunden lang. Jetzt im anderen Fenster suchen lassen.\n')
    ende = time.monotonic() + dauer
    n = 0
    while time.monotonic() < ende:
        try:
            rohdaten, herkunft = s.recvfrom(2048)
        except socket.timeout:
            continue
        except OSError:
            break
        if FRAGE in rohdaten:
            s.sendto(antwort, herkunft)
            n += 1
            print(f'  gefragt von {herkunft[0]} — geantwortet ({n}.)')
    s.close()
    print(f'\n  {n} Anfrage(n) beantwortet.')
    if n == 0:
        print('  KEINE Anfrage kam an. Dann kommt der Rundruf der Box hier nicht')
        print('  an — anderes Netzsegment, WLAN-Isolation oder eine Firewall.')
    return 0 if n else 1


SCHEIN_AUF_BOX = """
import socket, json, time
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    s.bind(('', 7359))
except OSError as e:
    print('  PORT BELEGT: %s' % e); raise SystemExit(2)
s.settimeout(0.4)
antwort = json.dumps({'Address':'http://192.168.178.9:8096','Id':'0'*32,'Name':'Schein-Jellyfin'}).encode()
ende = time.monotonic() + 12
ziele = []
while time.monotonic() < ende:
    try:
        d, h = s.recvfrom(2048)
    except socket.timeout:
        continue
    if b'who is JellyfinServer?' in d:
        s.sendto(antwort, h); ziele.append(h[0])
s.close()
print('  RUNDRUFE-ANGEKOMMEN %d' % len(ziele))
"""


def gegenprobe(box, port=8200):
    """Beweisen, dass die Suche wirklich sucht — mit einem Schein-Jellyfin.

    Es laeuft AUF DER BOX (siehe Kopftext: der Arbeitsrechner blockt UDP).
    Zwei Dinge werden dabei nachgewiesen, nicht eins:

      1. Der Rundruf geht raus und die Antwort kommt an — die Suche findet.
      2. Es kommen ZWEI Rundrufe an (255.255.255.255 und das eigene Netz),
         und trotzdem steht EIN Server in der Antwort. Also entdoppelt der
         Endpunkt nach Adresse, wie es ein Server mit zwei Netzkarten
         erzwingen wuerde.

    ES WIRD NICHTS AUF DER BOX VERAENDERT: ein Python-Prozess in /tmp, der
    sich nach zwoelf Sekunden selbst beendet, und die Datei wird geloescht.
    """
    import subprocess

    if '@' not in box:
        box = 'dietpi@' + box
    skript = (
        "cat > /tmp/.schein-jf-probe.py <<'PYEOF'\n" + SCHEIN_AUF_BOX + "PYEOF\n"
        "python3 /tmp/.schein-jf-probe.py > /tmp/.schein-jf-probe.log 2>&1 &\n"
        "sleep 2\n"
        "echo ANTWORT; curl -s --max-time 12 http://127.0.0.1:%d/api/jellyfin/suchen; echo\n"
        "wait; cat /tmp/.schein-jf-probe.log\n"
        "rm -f /tmp/.schein-jf-probe.py /tmp/.schein-jf-probe.log\n" % port
    )
    print(f'Gegenprobe auf {box}: ein Schein-Jellyfin antwortet auf den Rundruf.\n')
    try:
        r = subprocess.run(
            ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', box, 'bash -s'],
            input=skript, capture_output=True, text=True, timeout=90)
    except subprocess.TimeoutExpired:
        print('  FEHLER  die Box hat nicht innerhalb von 90 s geantwortet')
        return 1
    if r.returncode != 0 and 'ANTWORT' not in r.stdout:
        print(f'  FEHLER  SSH rc={r.returncode}: {(r.stderr or "").strip()[:160]}')
        return 1

    rohdaten = r.stdout
    antwort, rundrufe = '', -1
    for zeile in rohdaten.splitlines():
        if zeile.startswith('{'):
            antwort = zeile
        if 'RUNDRUFE-ANGEKOMMEN' in zeile:
            rundrufe = int(zeile.split()[-1])
        if 'PORT BELEGT' in zeile:
            print('  Auf der Box horcht schon jemand auf 7359.')
            print('  Laeuft dort ein echtes Jellyfin? Dann braucht es keine Probe.')
            return 1

    try:
        d = json.loads(antwort)
    except ValueError:
        print('  FEHLER  der Endpunkt hat nicht mit JSON geantwortet:')
        print('  ' + (antwort or rohdaten.strip())[:200])
        return 1

    server = d.get('server') or []
    gut = 0
    for name, bedingung, hinweis in (
        ('die Suche findet das Schein-Jellyfin',
         any(s.get('name') == 'Schein-Jellyfin' for s in server),
         'der Rundruf ging nicht raus, oder die Antwort wurde verworfen'),
        ('der Rundruf erreicht mehr als ein Ziel',
         rundrufe >= 2,
         f'nur {rundrufe} Rundruf(e) kamen an — dann sucht die Box nur in EINEM Netz'),
        ('mehrfache Antworten werden entdoppelt',
         rundrufe >= 2 and len(server) == 1,
         f'{rundrufe} Rundrufe, aber {len(server)} Eintraege — ein Server stuende doppelt in der Liste'),
    ):
        print(f'  {"ok  " if bedingung else "NEIN"} {name}' + ('' if bedingung else f'   — {hinweis}'))
        gut += 1 if bedingung else 0

    print(f'\n  {gut} von 3 nachgewiesen.')
    return 0 if gut == 3 else 1


GEZIELT_AUF_BOX = """
import socket, json, urllib.request, time, sys
ZIEL = sys.argv[1] if len(sys.argv) > 1 else ''
PORT = sys.argv[2] if len(sys.argv) > 2 else '8096'
print('HTTP-ANFANG')
try:
    with urllib.request.urlopen('http://%s:%s/System/Info/Public' % (ZIEL, PORT), timeout=10) as a:
        d = json.load(a)
    print('HTTP-OK %s|%s' % (d.get('ServerName'), d.get('Version')))
except Exception as e:
    print('HTTP-NEIN %s: %s' % (type(e).__name__, e))
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.settimeout(6)
try:
    s.sendto(b'who is JellyfinServer?', (ZIEL, 7359))
    d, h = s.recvfrom(4096)
    print('UDP-OK %d' % len(d))
except socket.timeout:
    print('UDP-STILL')
except Exception as e:
    print('UDP-FEHLER %s' % type(e).__name__)
s.close()
"""


def gezielt(adresse, port='8096', box=None):
    """Einen BEKANNTEN Server fragen: laeuft er, und meldet er sich auf 7359?

    ══ WOZU DIESE UNTERSCHEIDUNG ALLES ENTSCHEIDET ═════════════════════════
    Betreiber, 11.08.2026: „nochmal zu jellyfin http://192.168.178.199:8899 ist
    die adresse warum findet der discovery service sie nicht."

    Ein Rundruf, der nichts findet, hat drei moegliche Ursachen, und sie
    verlangen drei verschiedene Antworten:

      1. Die Suche ist kaputt          -> reparieren
      2. Der Rundruf kommt nicht hin   -> Netzsegment, Router, Firewall
      3. Der Server antwortet gar nicht -> bei IHM ist etwas aus

    Eine GEZIELTE Anfrage an denselben Port trennt 3 von 1 und 2: Jellyfin
    beantwortet auch Unicast auf 7359. Kommt darauf nichts, liegt es nicht am
    Rundruf und nicht an uns.

    ══ WAS AM 11.08.2026 HERAUSKAM ════════════════════════════════════════
        HTTP  ✓ Jellyfin 10.10.3, ServerName „06dbb2b8f464"
        UDP   ✗ still, auch gezielt

    Der ServerName ist eine Docker-Container-Kennung (zwoelf Hex-Zeichen, so
    vergibt Docker Hostnamen), der Port 8899 statt 8096 eine Portabbildung.
    Der Discovery-Port liegt also nicht nach aussen: in einem Bridge-Netz
    braucht es `-p 7359:7359/udp`, und selbst dann erreicht ein Rundruf den
    Container nicht zuverlaessig — dafuer waere `network_mode: host` noetig.

    DIE SUCHE IST NICHT SCHULD, und das darf ein Werkzeug auch sagen. Wer hier
    weiter an der Box repariert, repariert das Falsche.

    VON DER BOX AUS MESSEN, nicht vom Arbeitsrechner: der verwirft eingehendes
    UDP (siehe Kopftext). Eine stille Antwort waere dort bedeutungslos.
    """
    import subprocess

    if box:
        if '@' not in box:
            box = 'dietpi@' + box
        print(f'Frage {adresse}:{port} von der Box {box.split("@")[1]} aus …\n')
        r = subprocess.run(
            ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', box,
             f'python3 - {adresse} {port}'],
            input=GEZIELT_AUF_BOX, capture_output=True, text=True, timeout=90)
        roh = r.stdout
    else:
        print(f'Frage {adresse}:{port} von DIESEM Rechner aus …')
        print('  ACHTUNG: blockt er eingehendes UDP, ist die UDP-Zeile wertlos.')
        print('  Mit --box misst die Box selbst.\n')
        import tempfile
        with tempfile.NamedTemporaryFile('w', suffix='.py', delete=False) as f:
            f.write(GEZIELT_AUF_BOX)
            weg = f.name
        r = subprocess.run(['python3', weg, adresse, port],
                           capture_output=True, text=True, timeout=90)
        os.unlink(weg)
        roh = r.stdout

    http_gut = udp_gut = False
    name = fassung = ''
    for z in roh.splitlines():
        if z.startswith('HTTP-OK'):
            http_gut = True
            teil = z[8:].split('|')
            name, fassung = (teil + ['', ''])[:2]
        elif z.startswith('HTTP-NEIN'):
            print(f'  ✗ Auf {adresse}:{port} antwortet kein Jellyfin — {z[10:][:80]}')
        elif z == 'UDP-OK' or z.startswith('UDP-OK'):
            udp_gut = True
        elif z == 'UDP-STILL':
            pass

    if http_gut:
        print(f'  ✓ Jellyfin {fassung} laeuft dort  (ServerName: {name})')
    print('  ' + ('✓ und es meldet sich auf UDP 7359'
                  if udp_gut else '✗ aber auf UDP 7359 bleibt es still'))

    if http_gut and not udp_gut:
        print()
        print('  DAMIT IST DIE SUCHE ENTLASTET. Der Server antwortet nicht einmal')
        print('  auf eine gezielte Anfrage — es liegt nicht am Rundruf und nicht')
        print('  an der Box.')
        # Zwoelf Hex-Zeichen als Name: so vergibt Docker Hostnamen.
        docker = len(name) == 12 and all(c in '0123456789abcdef' for c in name.lower())
        if docker or port not in ('8096', '8920'):
            print()
            print('  VERMUTLICH EIN CONTAINER:')
            if docker:
                print(f'    Der Name „{name}" ist eine Docker-Container-Kennung.')
            if port not in ('8096', '8920'):
                print(f'    Port {port} statt 8096 deutet auf eine Portabbildung.')
            print('    In einem Bridge-Netz fehlt UDP 7359 nach aussen. Abhilfe:')
            print('      -p 7359:7359/udp   — oder besser network_mode: host,')
            print('    denn ein Rundruf erreicht einen Bridge-Container ohnehin')
            print('    nicht zuverlaessig.')
        else:
            print()
            print('  Sonst: in Jellyfin unter Netzwerk die automatische')
            print('  Erkennung einschalten, oder eine Firewall laesst UDP 7359 nicht durch.')
        print()
        print(f'  SO ODER SO GEHT ES VON HAND: In der Verwaltung unter')
        print(f'  Dienste -> Jellyfin -> Serveradresse  http://{adresse}:{port} eintragen.')
    return 0 if http_gut else 1


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument('--box', help='Adresse der Box; ohne dies sucht dieser Rechner selbst')
    p.add_argument('--port', type=int, default=8200)
    p.add_argument('--vorspielen', action='store_true',
                   help='ein Jellyfin vortaeuschen — die Gegenprobe zur Suche')
    p.add_argument('--dauer', type=int, default=25)
    p.add_argument('--gezielt', metavar='ADRESSE',
                   help='einen bekannten Server direkt fragen — trennt "Suche kaputt" '
                        'von "Server antwortet nicht"')
    p.add_argument('--jfport', type=int, default=8096,
                   help='Port des Jellyfin (Vorgabe 8096)')
    p.add_argument('--gegenprobe', metavar='BOX',
                   help='Schein-Jellyfin AUF DER BOX aufstellen und die Suche beweisen')
    a = p.parse_args()

    if a.gezielt:
        return gezielt(a.gezielt, str(a.jfport), a.box)

    if a.gegenprobe:
        return gegenprobe(a.gegenprobe, a.port)

    if a.vorspielen:
        return vorspielen(dauer=a.dauer)

    if a.box:
        print(f'Frage die Box {a.box}:{a.port} — sie ruft ins Netz …\n')
        d, fehler = box_fragen(a.box, a.port)
        if d is None:
            print(f'  FEHLER  {fehler}')
            return 1
        server = d.get('server') or []
        hinweis = d.get('hinweis') or ''
    else:
        print('Rufe von DIESEM Rechner ins Netz (die Box kann anderswo stehen) …\n')
        server, fehler = selbst_suchen()
        if fehler:
            print(f'  FEHLER  {fehler}')
            return 1
        hinweis = ''

    if not server:
        print('  Es hat sich kein Jellyfin gemeldet.')
        print('  Das heisst NICHT, dass es keinen gibt: Rundrufe kommen nicht')
        print('  ueber Router. VPN, anderes VLAN, Gastnetz — alles unsichtbar.')
        if hinweis:
            print(f'\n  Die Box sagt: {hinweis}')
        return 0

    print(f'  {len(server)} Server gemeldet:\n')
    for i, s in enumerate(server, 1):
        print(f'  {i}. {s.get("name", "?")}')
        print(f'     {s.get("adresse", "?")}')
        if s.get('id'):
            print(f'     Kennung {s["id"][:16]}…')
        if s.get('von'):
            print(f'     geantwortet von {s["von"]}')
    print('\n  In der Verwaltung: Dienste → Jellyfin → Serveradresse → Im Netz suchen.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
