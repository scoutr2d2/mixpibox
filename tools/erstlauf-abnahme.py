#!/usr/bin/env python3
"""Nimmt eine FRISCH aufgesetzte Box ab — gegen alles, was heute repariert wurde.

══ WOZU ═══════════════════════════════════════════════════════════════════
Betreiber, 11.08.2026: „nur durch einen frischen lauf finden wir die lücken."

Das stimmt — aber nur, wenn danach jemand systematisch nachsieht. Nach einem
Lauf ist man mit dem beschaeftigt, was auffaellt; was still fehlt, faellt
gerade nicht auf. Genau so ist heute librespot-konto.py durchgerutscht: der
Waechter rief es seit Wochen, es lag auf keiner Karte, und niemandem fiel
etwas auf, weil ein Waechter, der nur neu startet, auch aussieht wie ein
Waechter.

Dieses Werkzeug prueft eine frische Box gegen JEDEN Befund dieses Tages. Es
aendert NICHTS — es liest, misst und zaehlt.

    python3 tools/erstlauf-abnahme.py --box dietpi@192.168.178.57

══ WAS ES NICHT KANN, und das gehoert vorweg ══════════════════════════════
Es kann nicht pruefen, ob die beiden ANMELDUNGEN geglueckt sind — die
brauchen einen Menschen am Geraet. Es prueft, ob alles bereitliegt, damit sie
gelingen KOENNEN, und sagt danach, was noch von Hand zu tun ist.

Rueckgabe: 0 wenn alles Pruefbare steht, 2 wenn die Box gar nicht antwortet,
sonst die Zahl der Abweichungen.
"""
import argparse
import json
import subprocess
import sys
import urllib.error
import urllib.request

SSH = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10']
ergebnis = []


def chk(gruppe, name, gut, hinweis=''):
    ergebnis.append((gruppe, name, bool(gut), hinweis))


def zahl(text):
    """Die erste Zahl aus einer Ausgabe — oder -1.

    WARUM DAS NOETIG IST: `grep -c` gibt bei null Treffern „0" aus UND endet
    mit Rueckgabewert 1. Ein angehaengtes `|| echo 0` schreibt dann eine
    ZWEITE Null, und die Ausgabe lautet „0\n0". Ein Vergleich gegen „0"
    schlaegt fehl — und meldet einen Mangel, den es nicht gibt. Genau so
    behauptete dieses Werkzeug am 11.08.2026 zweimal, die Token-Falle sei
    zurueck, waehrend die Datei tadellos war.
    """
    for z in (text or '').split():
        try:
            return int(z)
        except ValueError:
            continue
    return -1


def auf_box(box, befehl, zeit=45):
    try:
        r = subprocess.run(SSH + [box, befehl], capture_output=True, text=True, timeout=zeit)
        return r.stdout.strip()
    except Exception:
        return ''


def vom_netz(adresse, weg, zeit=20):
    try:
        with urllib.request.urlopen(f'http://{adresse}:8200{weg}', timeout=zeit) as a:
            return json.loads(a.read().decode('utf-8'))
    except Exception:
        return None


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument('--box', required=True, help='z. B. dietpi@192.168.178.57')
    a = p.parse_args()
    box = a.box if '@' in a.box else 'dietpi@' + a.box
    adresse = box.split('@')[1]

    print(f'Nehme {adresse} ab — nichts wird veraendert.\n')

    # ══ ZUERST: ANTWORTET DIE BOX UEBERHAUPT? ══════════════════════════════
    #
    # Diese Sperre entstand aus einem Fehlschlag dieses Werkzeugs selbst
    # (11.08.2026): Beim ersten Probelauf meldete es 15 von 18 Pruefungen als
    # NEIN — librespot fehle, die Endpunkte fehlten, die Oberflaeche sei alt.
    # Nichts davon stimmte. Die Box war schlicht ausgeschaltet.
    #
    # `auf_box()` gibt bei einem Fehler eine leere Zeichenkette zurueck, und
    # eine leere Antwort sieht aus wie „nicht gefunden". Damit zog das Werkzeug
    # ZWEI Zustaende zu einem zusammen — „fehlt" und „nicht erreichbar" —, und
    # das ist derselbe Fehler, den es aufdecken soll. Ein Abnahmewerkzeug, das
    # eine tote Box als kaputte Installation meldet, schickt jemanden stundenlang
    # das Falsche reparieren.
    #
    # Deshalb: erst die Verbindung, dann alles andere. Und ein eigener
    # Rueckgabewert (2), damit auch ein Skript den Unterschied sieht.
    lebt = auf_box(box, 'echo LEBT', zeit=20)
    if 'LEBT' not in lebt:
        print(f'  ✗ {box} antwortet nicht auf SSH.')
        print('    Es wird NICHTS geprueft — sonst stuende hier eine Liste von')
        print('    Maengeln, die alle nur „die Box ist aus" bedeuten.')
        print()
        print('    Faehrt sie noch hoch? Hat DHCP ihr eine neue Adresse gegeben?')
        print('    (Am 11.08. wanderte sie an einem Tag von .77 ueber .78 auf .57.)')
        return 2

    if vom_netz(adresse, '/api/spotify/ton') is None and vom_netz(adresse, '/api/dienste') is None:
        # SSH GEHT, HTTP NICHT — das ist ein ECHTER Befund und keine tote Box:
        # der Server laeuft nicht. Deshalb hier keine Sperre, nur eine
        # Vorwarnung, damit die Endpunkt-Zeilen richtig gelesen werden.
        print('  ! Die Box antwortet per SSH, aber ihr Server nicht (Port 8200).')
        print('    Die Endpunkt-Pruefungen unten sagen deshalb nichts ueber den')
        print('    ausgelieferten Stand — sie sagen nur, dass nichts laeuft.')
        print()

    # ══ 1. WAS DAS REZEPT AUSROLLEN MUSS ═══════════════════════════════════
    # Jede dieser Dateien fehlte schon einmal, und jedes Fehlen sah aus wie
    # etwas anderes.
    dateien = {
        '/usr/bin/librespot': 'ohne das Programm ist die Box in Spotify nie ein Geraet',
        '/usr/local/bin/mupibox/librespot-waechter.sh': 'der Waechter selbst',
        '/usr/local/bin/mupibox/librespot-konto.py': 'FEHLTE BIS 11.08. AUF JEDER KARTE — '
                                                     'ohne sie ist der Waechter nur ein Neustartknopf',
        '/etc/librespot/env-librespot': 'die Umgebung des Dienstes',
        '/opt/mupibox-tools/mupibox-standwache.py': 'ohne sie stellt eine Auslieferung keine Frist',
    }
    da = auf_box(box, 'for f in ' + ' '.join(dateien) + '; do [ -e "$f" ] && echo "JA $f" || echo "NEIN $f"; done')
    for pfad, wozu in dateien.items():
        chk('Dateien', pfad.split('/')[-1], f'JA {pfad}' in da, wozu)

    # ══ 2. DIE TOKEN-FALLE ═════════════════════════════════════════════════
    # Bis 11.08. schob env-librespot librespot den accessToken der Box unter.
    # Eine gescheiterte Token-Anmeldung BEENDET den Prozess; mit Restart=always
    # ergab das einen Neustartkreis, in dem die Box unsichtbar ist.
    # NUR ZEILEN OHNE FUEHRENDES „#". Der erste Entwurf zaehlte jede Zeile mit
    # `LIBRESPOT_ACCESS_TOKEN=` — und die reparierte Vorlage ZITIERT die alte
    # Falle in einem Kommentar, damit nachvollziehbar bleibt, was dort stand.
    # Das Werkzeug meldete deshalb am 11.08.2026 Alarm fuer genau die Datei,
    # die in Ordnung war. Eine Textsuche, die Kommentare mitzaehlt, prueft
    # nicht den Code, sondern seine Erzaehlung.
    env = auf_box(box, 'sudo grep -c "^[^#]*LIBRESPOT_ACCESS_TOKEN=" '
                       '/etc/librespot/env-librespot 2>/dev/null || echo 0')
    chk('librespot', 'kein Zugangstoken in env-librespot', zahl(env) == 0,
        'die alte "Ansaat" ist zurueck — sie erzeugt den Neustartkreis')

    stand = auf_box(box, 'systemctl show librespot.service -p ActiveState -p SubState -p NRestarts')
    d = dict(z.split('=', 1) for z in stand.split() if '=' in z)
    chk('librespot', 'Dienst laeuft', d.get('ActiveState') == 'active', f'ist {d.get("ActiveState")}')
    # NRestarts IST DAS MASS, nicht ActiveState: mitten im Kreis stand der
    # Dienst am 11.08. auf active/running — der Lauf war zwanzig Sekunden alt
    # und schon verloren.
    try:
        n = int(d.get('NRestarts', '0'))
    except ValueError:
        n = -1
    chk('librespot', 'kein Neustartkreis', 0 <= n <= 2, f'NRestarts={d.get("NRestarts")}')

    absagen = auf_box(box, 'sudo journalctl -u librespot --since "-15min" --no-pager -o cat 2>/dev/null '
                           '| grep -c INVALID_CREDENTIALS || true')
    chk('librespot', 'keine Absagen von Spotify', zahl(absagen) <= 0,
        f'{zahl(absagen)} Absagen in 15 min — das Konto kommt nicht herein')

    # ══ 3. DIE ENDPUNKTE, DIE HEUTE ENTSTANDEN SIND ════════════════════════
    ton = vom_netz(adresse, '/api/spotify/ton')
    chk('Endpunkte', 'GET /api/spotify/ton', ton is not None,
        'die Karte trug einen alten Server — deploy.zip war beim Schreiben veraltet')
    such = vom_netz(adresse, '/api/jellyfin/suchen', zeit=25)
    chk('Endpunkte', 'GET /api/jellyfin/suchen', such is not None and 'server' in (such or {}),
        'die Jellyfin-Suche fehlt')
    pruef = vom_netz(adresse, '/api/jellyfin/adresse-pruefen?eingabe=' + adresse + ':8200')
    chk('Endpunkte', 'GET /api/jellyfin/adresse-pruefen', pruef is not None,
        'das Ergaenzen von http:// fehlt')
    if pruef is not None:
        # GEGENPROBE IM VORBEIGEHEN: Die Box selbst ist KEIN Jellyfin. Meldet
        # der Endpunkt sie als erreichbar, fehlt die Pruefung auf Version+Id,
        # und die Verwaltung wuerde eine Adresse eintragen, hinter der nie
        # Musik liegt.
        chk('Endpunkte', 'Adresspruefung erkennt Nicht-Jellyfin',
            pruef.get('erreichbar') is False,
            'sie haelt die eigene Box fuer einen Jellyfin')

    # ══ 4. WAS DIE OBERFLAECHE MITBRINGEN MUSS ═════════════════════════════
    # Am 11.08. war deploy.zip einen Tag alt, und die Karte haette den Stand
    # von gestern installiert. Geprueft wird deshalb an SICHTBAREN Spuren im
    # ausgelieferten Bau — interne Namen ueberleben das Buendeln nicht.
    spuren = {
        'www/neu/app.js': ['tonAnmelden', 'QuickConnect', 'Im Netz suchen', 'jfAdresseSpeichern'],
    }
    for datei, worte in spuren.items():
        pfad = f'/home/dietpi/.mupibox/Sonos-Kids-Controller-master/{datei}'
        for w in worte:
            n = auf_box(box, f'grep -c {w!r} {pfad} 2>/dev/null || echo 0')
            chk('Oberflaeche', f'{datei}: {w}', zahl(n) > 0,
                'die Karte trug einen aelteren Bau')

    # ══ 5. DAS STARTBILD ═══════════════════════════════════════════════════
    splash = auf_box(box, 'grep -c "offen + \\" ...\\"" /usr/local/bin/mupibox/mupibox-boot-splash.py 2>/dev/null || echo 0')
    chk('Startbild', 'kein U+2026 hinter den Schritten', zahl(splash) > 0,
        'dann steht wieder hinter jedem Schritt ein Fragezeichen')
    bild = auf_box(box, 'for f in /usr/local/bin/mupibox/mixpi-hoert.png '
                        '/opt/mixpibox-einrichtung/mixpi-hoert.png '
                        '/boot/firmware/einrichtung/mixpi-hoert.png; do [ -f "$f" ] && echo DA; done')
    chk('Startbild', 'MixPi-Bild liegt an einem der drei Orte', 'DA' in bild,
        'dann malt es den gezeichneten Kopf')

    # ══ 6. WAS EINE FRISCHE KARTE ERWARTUNGSGEMAESS NICHT HAT ══════════════
    # Kein Fehler — aber es soll dastehen, damit niemand danach sucht.
    konf = auf_box(box, "sudo jq -r '[(.spotify.clientId // \"\"), (.jellyfin.server // \"\"), "
                        "(.spotify.refreshToken // \"\")] | map(if . == \"\" then \"leer\" else \"gesetzt\" end) "
                        "| @tsv' /etc/mupibox/mupiboxconfig.json 2>/dev/null")
    creds = auf_box(box, '[ -s /home/dietpi/.cache/spotify/credentials.json ] && echo JA || echo NEIN')

    print('══ Gemessen ══\n')
    schlecht = 0
    letzte = ''
    for gruppe, name, gut, hinweis in ergebnis:
        if gruppe != letzte:
            print(f'  ── {gruppe} ──')
            letzte = gruppe
        print(f'    {"ok  " if gut else "NEIN"} {name}' + (f'   — {hinweis}' if not gut and hinweis else ''))
        schlecht += 0 if gut else 1

    print('\n══ Was noch von Hand kommt (kein Fehler) ══')
    if konf:
        teile = konf.split('\t')
        namen = ['spotify.clientId', 'jellyfin.server', 'spotify.refreshToken']
        for nm, w in zip(namen, teile + ['?'] * 3):
            print(f'    {nm:<22} {w}')
    print(f'    {"librespot-Anmeldung":<22} {"da" if creds == "JA" else "fehlt"}')
    print()
    print('    Spotify:  QR am Handy (Client-ID) — dann AM GERAET unter')
    print('              Dienste → Spotify meldet die Box den Ton selbst an.')
    print('    Jellyfin: Serveradresse eintippen (ohne http://), dann QuickConnect.')

    print(f'\n{len(ergebnis)} Pruefungen, {schlecht} Abweichung(en)')
    return schlecht


if __name__ == '__main__':
    sys.exit(min(main(), 250))
