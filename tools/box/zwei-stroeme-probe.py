#!/usr/bin/env python3
"""Tragen ZWEI Bluetooth-Tonstroeme gleichzeitig? — gemessen (E72).

    python3 zwei-stroeme-probe.py                 # 120 s messen
    python3 zwei-stroeme-probe.py --sek 300
    python3 zwei-stroeme-probe.py --nur-einer     # Vergleichslauf mit EINEM

Muss AUF DER BOX laufen. Beide Lautsprecher muessen eingeschaltet und
verbunden sein — das Werkzeug verbindet sie NICHT selbst (dazu spaeter mehr).

══ DIE FRAGE ══════════════════════════════════════════════════════════════

Betreiber, 20.08.2026: „ob man nicht 2 kinder mit einer box mit 2 parallelen
ausgaben ueber 2 bluetooth geraete bzw senken bedienen kann". Die Hardware
liegt da: zwei gepaarte Lautsprecher, zwei Funkbausteine (einer im SoC, einer
per USB). Ob es TRAEGT, steht in keinem Datenblatt.

Zwei A2DP-Stroeme passen rechnerisch in die Bandbreite (SBC rund 330 kbit/s
je Strom, EDR traegt praktisch ueber 2 Mbit/s). Rechnerisch ist aber nicht
gemessen: was kippt, ist die FUNKZEIT — und auf dem SoC-Baustein teilt sie
sich zusaetzlich mit dem WLAN. Genau diese Koexistenz hat am 20.08. die
Verbindung gekippt (E68).

══ WARUM EIN TESTTON UND KEIN SPOTIFY ═════════════════════════════════════

Die Frage lautet „traegt der Bluetooth-Stapel zwei Stroeme", nicht „traegt
Spotify das". Ein selbst erzeugter Ton isoliert die Variable: kein Netz, kein
Konto, keine Paarung, kein zweiter Zugang noetig. Scheitert es MIT Testton,
braucht man Spotify gar nicht erst zu fragen.

══ WAS GEMESSEN WIRD, UND WARUM GERADE DAS ════════════════════════════════

  * AUSSETZER JE STROM (`pw-top`, Spalte ERR). Das ist die Zahl, um die es
    geht — ein Kind hoert einen Aussetzer, es hoert keine Prozentzahl.
  * DAS WLAN DANEBEN. Nach E68 gehoert es dazu: ein Aufbau, der zwei Stroeme
    traegt und dabei das Netz kostet, hat die Frage nicht beantwortet,
    sondern verschoben.
  * WELCHER STROM AUF WELCHEM FUNKBAUSTEIN liegt. Wenn nur die verteilte
    Fassung traegt, ist der USB-Baustein Voraussetzung und nicht Bequem-
    lichkeit — dann muss die Strom-Verwaltung wissen, welcher Baustein
    welchen Strom bedient.

UEBER ZEIT, NICHT EINMAL: Ein Anlauf sieht aus wie ein Zustand (llmwiki:
einmal-hinsehen-ist-keine-messung). Aussetzer kommen ausserdem in Buendeln —
eine Momentaufnahme trifft entweder keins oder nur eins.

DER VERGLEICHSLAUF GEHOERT DAZU. `--nur-einer` misst dasselbe mit EINEM Strom.
Ohne ihn weiss man nicht, ob die gezaehlten Aussetzer am zweiten Strom liegen
oder ob diese Box auch mit einem welche hat.
"""
import argparse
import json
import math
import os
import re
import struct
import subprocess
import sys
import time
import wave

TON_DATEI = '/tmp/zwei-stroeme-ton.wav'
TAKT_S = 2.0
# Die Laenge des Testtons. Die Fehlstart-Erkennung unten misst dagegen —
# beide muessen dieselbe Zahl kennen, sonst prueft sie gegen eine Erfindung.
TON_SEK = 30


def laufen(befehl, frist=10):
    try:
        f = subprocess.run(befehl, capture_output=True, text=True, timeout=frist)
        return f.returncode, f.stdout, f.stderr
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        return -1, '', str(e)


def ton_erzeugen(sekunden=TON_SEK, hz=440):
    """Ein Sinuston als WAV — ohne jede Abhaengigkeit.

    LEISE (ein Zehntel Vollaussteuerung): Das hier laeuft ueber echte
    Lautsprecher in einem Wohnraum, womoeglich neben einem schlafenden Kind.
    Fuer die Messung ist der Pegel gleichgueltig — fuer den Raum nicht.
    """
    rate = 44100
    with wave.open(TON_DATEI, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(rate)
        rahmen = bytearray()
        for i in range(rate * sekunden):
            wert = int(3276 * math.sin(2 * math.pi * hz * i / rate))
            rahmen += struct.pack('<hh', wert, wert)
        w.writeframes(bytes(rahmen))
    return TON_DATEI


def bt_senken():
    """Die Bluetooth-Tonziele — als Liste von dicts, nie als Text zum Zaehlen."""
    code, aus, _ = laufen(['pactl', '-f', 'json', 'list', 'sinks'], frist=10)
    if code != 0:
        return []
    try:
        roh = json.loads(aus)
    except json.JSONDecodeError:
        return []
    gefunden = []
    for s in roh:
        name = s.get('name') or ''
        if not name.startswith('bluez_output'):
            continue
        eigen = s.get('properties') or {}
        # `(null)` IST EIN WERT, DER VORHANDEN AUSSIEHT UND KEINER IST. PulseAudios
        # JSON liefert die Zeichenkette wortwoertlich; ein `or`-Rueckfall greift
        # deshalb NICHT, denn ein nichtleerer String ist wahr. Am Geraet gemessen
        # (20.08.2026): device.description, device.alias und description tragen
        # alle drei '(null)'.
        def echt(*schluessel):
            for k in schluessel:
                v = eigen.get(k) or s.get(k)
                if isinstance(v, str) and v.strip() and v != '(null)':
                    return v
            return ''

        # DIE MAC AUS bluez5.address, NICHT aus dem Namen: der Name traegt sie
        # zwar auch, aber in einer Schreibweise, die sich mit der Zaehlnummer
        # am Ende aendern kann.
        mac = echt('api.bluez5.address') or (
            ':'.join(name.split('.')[1].split('_')[:6]) if '.' in name else '?')
        gefunden.append({
            'name': name,
            'geraet': echt('device.description', 'node.description', 'device.alias', 'node.nick') or mac,
            'mac': mac.upper(),
            'zustand': s.get('state', '?'),
        })
    return gefunden


def baustein_je_mac():
    """Welcher Funkbaustein haelt welche Verbindung? {mac: hciN}."""
    karte = {}
    code, aus, _ = laufen(['hciconfig'], frist=6)
    bausteine = re.findall(r'^(hci\d+):', aus, re.M)
    for hci in bausteine:
        code, aus2, _ = laufen(['hcitool', '-i', hci, 'con'], frist=6)
        for m in re.finditer(r'([0-9A-F]{2}(?::[0-9A-F]{2}){5})', aus2 or ''):
            karte[m.group(1).upper()] = hci
    return karte


def iw_finden():
    """Der volle Pfad zu `iw` — es liegt in /usr/sbin und damit NICHT im PATH
    einer nicht-anmeldenden Sitzung.

    BLIND `iw` AUFZURUFEN WAERE HIER TEUER: der Aufruf schlaegt fehl, die
    Funktion meldet „nicht verbunden", und die Messung haette das WLAN
    durchgehend als weg ausgewiesen — ein stiller Falschbefund an genau der
    Stelle, die nach E68 mitgemessen werden soll.
    """
    for k in ('/usr/sbin/iw', '/sbin/iw', 'iw'):
        code, _, _ = laufen([k, '--version'], frist=4)
        if code == 0:
            return k
    return None


IW = None


def wlan_jetzt():
    global IW
    if IW is None:
        IW = iw_finden() or ''
    if not IW:
        return {'verbunden': None, 'signal': None, 'freq': None}
    code, aus, _ = laufen([IW, 'dev', 'wlan0', 'link'], frist=6)
    if code != 0 or 'Not connected' in (aus or ''):
        return {'verbunden': False, 'signal': None, 'freq': None}
    def hol(muster):
        m = re.search(muster, aus)
        return float(m.group(1)) if m else None
    return {'verbunden': True, 'signal': hol(r'signal:\s*(-?\d+)'), 'freq': hol(r'freq:\s*(\d+)')}


def fehler_je_knoten():
    """Aussetzer je Tonknoten aus `pw-top`. {knoten-id: ERR}.

    ══ WARUM UEBER DIE ID UND NICHT UEBER DEN NAMEN ═══════════════════════

    Die Spalten sind:  S  ID  QUANT  RATE  WAIT  BUSY  W/Q  B/Q  ERR  FORMAT  NAME

    FORMAT IST MAL LEER UND MAL DREI FELDER BREIT. Am Geraet gezaehlt
    (20.08.2026): 23 Zeilen mit 10 Feldern, zwei mit 11, zwei mit 13, eine mit
    14. Der erste Entwurf verlangte mindestens 11 und warf damit GENAU DIE
    ZEILEN WEG, um die es geht — er las null Knoten, und der Bericht meldete
    beide Male „AUSSETZER: keine".

    DAS IST DIE SCHLIMMSTE SORTE FEHLER: ein Zaehler, der immer null liefert,
    sieht aus wie ein Ergebnis. Zwei Laeufe bestaetigten sich gegenseitig, und
    beide waren leer. Aufgefallen ist es erst bei der Frage „kann dieses
    Werkzeug ueberhaupt einen Aussetzer sehen?" — die gehoert VOR den ersten
    Lauf, nicht nach dem zweiten.

    Die ID steht immer an derselben Stelle und ist innerhalb eines Laufs
    eindeutig. Den Namen holt `namen_je_id()` getrennt.
    """
    code, aus, _ = laufen(['pw-top', '-b', '-n', '1'], frist=12)
    if code != 0:
        return {}
    zaehler = {}
    for z in (aus or '').splitlines():
        teile = z.split()
        if len(teile) < 9 or not teile[1].isdigit():
            continue
        try:
            zaehler[teile[1]] = int(teile[8])
        except ValueError:
            continue
    return zaehler


def namen_je_id():
    """{knoten-id: Name} — getrennt geholt, weil pw-top den Namen nicht
    verlaesslich abtrennbar ausgibt."""
    karte = {}
    for z in (laufen(['pw-top', '-b', '-n', '1'], frist=12)[1] or '').splitlines():
        teile = z.split()
        if len(teile) < 9 or not teile[1].isdigit():
            continue
        # Der Name ist der Rest hinter ERR, ohne die FORMAT-Felder. Statt sie
        # zu zaehlen: alles nehmen, was NICHT nach Format aussieht.
        rest = [w for w in teile[9:] if not re.fullmatch(r'[SFU]\d*[A-Z]*|[0-9]+|\+', w)]
        karte[teile[1]] = ' '.join(rest) or teile[1]
    return karte


def last():
    try:
        return os.getloadavg()[0]
    except OSError:
        return 0.0


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--sek', type=float, default=120.0)
    p.add_argument('--nur-einer', action='store_true', help='Vergleichslauf mit EINEM Strom')
    a = p.parse_args()

    senken = bt_senken()
    print('Zwei Bluetooth-Stroeme — gemessen\n')
    print('Gefundene Bluetooth-Ziele: %d' % len(senken))
    karte = baustein_je_mac()
    for s in senken:
        print('  %-22s %-18s %s  (Baustein %s)' % (s['geraet'][:22], s['mac'], s['zustand'], karte.get(s['mac'], '?')))

    noetig = 1 if a.nur_einer else 2
    if len(senken) < noetig:
        sys.exit(
            '\nEs braucht %d verbundene(s) Bluetooth-Ziel(e), gefunden: %d.\n'
            'Beide Lautsprecher einschalten und verbinden lassen, dann noch einmal.\n'
            'Dieses Werkzeug verbindet BEWUSST nicht selbst: ein Messwerkzeug, das\n'
            'den Zustand herstellt, den es messen soll, misst am Ende sich selbst.'
            % (noetig, len(senken)))

    ziele = senken[:noetig]
    if len(set(karte.get(s['mac']) for s in ziele)) == 1 and noetig == 2:
        print('\nHINWEIS: Beide Ziele haengen am SELBEN Funkbaustein (%s).' % karte.get(ziele[0]['mac']))
        print('Das ist der schwierigere Fall — sie teilen sich die Funkzeit, und auf')
        print('dem SoC-Baustein zusaetzlich mit dem WLAN. Traegt er, traegt die')
        print('verteilte Fassung erst recht.')

    print('\nErzeuge den Testton …')
    ton = ton_erzeugen()

    vorher_w = wlan_jetzt()
    vorher_f = fehler_je_knoten()
    laeufe = []
    for s in ziele:
        laeufe.append(subprocess.Popen(
            ['pw-play', '--target', s['name'], ton],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
    print('%d Strom/Stroeme gestartet. Messe %.0f s.\n' % (len(laeufe), a.sek))
    print('  %6s  %-7s %-8s %s' % ('sek', 'WLAN', 'Last', 'Aussetzer je Strom (neu seit Beginn)'))

    beginn = time.monotonic()
    ton_begonnen = beginn
    fehlstarts = 0
    letzte_zeile = None
    # WIE OFT WAR JEDE SENKE WIRKLICH AM SPIELEN?
    #
    # OHNE DIESE ZAHL IST DER GANZE LAUF NICHT ZU DEUTEN. „Aussetzer: keine"
    # heisst entweder „alles lief perfekt" oder „es lief ueberhaupt nichts",
    # und beides sieht im Bericht gleich aus. Am 20.08.2026 hat genau diese
    # Zweideutigkeit zu einem Fehlalarm gefuehrt: SUSPENDED in einer
    # Momentaufnahme wurde fuer einen Ausfall gehalten — es war die Luecke
    # zwischen zwei Tondurchgaengen. Der Betreiber hatte den Ton gehoert.
    #
    # Dieselbe Lehre wie im llmwiki unter headless-messen-misst-den-absturz-mit:
    # eine Messzahl ohne Beweis, dass der gemessene Vorgang stattfand, ist
    # keine Messung.
    spielte = {s['name']: 0 for s in ziele}
    proben = 0
    try:
        while time.monotonic() - beginn < a.sek:
            time.sleep(TAKT_S)
            if all(l.poll() is not None for l in laeufe):
                # DER TON IST ZU ENDE — von vorn, damit die Messung weiterlaeuft.
                #
                # ABER NICHT BLIND. Scheitert `pw-play` sofort (Lautsprecher
                # aus, Ziel weg), waere das hier eine Schleife, die 90-mal
                # nichts startet — und der Bericht meldete am Ende „AUSSETZER:
                # keine". Wahr und voellig irrefuehrend: es lief ja nie Ton.
                #
                # DER TON DAUERT 30 s. Endet ein Durchgang deutlich frueher,
                # ist das kein Ende, sondern ein Fehlstart.
                gedauert = time.monotonic() - ton_begonnen
                if gedauert < TON_SEK * 0.5:
                    fehlstarts += 1
                else:
                    fehlstarts = 0
                if fehlstarts >= 2:
                    print('\n  ABBRUCH: der Ton endet nach %.1f s statt %d s, zweimal in Folge.' % (gedauert, TON_SEK))
                    print('  Es kommt kein Ton heraus — die Messung waere ohne Gegenstand.')
                    print('  Sind beide Lautsprecher wirklich EINGESCHALTET?')
                    for l in laeufe:
                        _, fehler = l.communicate() if l.stderr else (None, None)
                    break
                ton_begonnen = time.monotonic()
                laeufe = [subprocess.Popen(['pw-play', '--target', s['name'], ton],
                                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                          for s in ziele]
            proben += 1
            for s in bt_senken():
                if s['name'] in spielte and s['zustand'] == 'RUNNING':
                    spielte[s['name']] += 1
            w = wlan_jetzt()
            f = fehler_je_knoten()
            neu = {k: v - vorher_f.get(k, 0) for k, v in f.items() if v - vorher_f.get(k, 0) > 0}
            zeile = (w['verbunden'], tuple(sorted(neu.items())))
            if zeile != letzte_zeile:
                print('  %6.0f  %-7s %-8.2f %s' % (
                    time.monotonic() - beginn,
                    ('%d dBm' % w['signal']) if w['verbunden'] and w['signal'] is not None
                    else ('?' if w['verbunden'] is None else 'WEG'),
                    last(),
                    ', '.join('%s: %d' % (k[:26], v) for k, v in sorted(neu.items())) or 'keine'))
                letzte_zeile = zeile
    finally:
        for l in laeufe:
            if l.poll() is None:
                l.terminate()
        try:
            os.unlink(ton)
        except OSError:
            pass

    nachher_w = wlan_jetzt()
    nachher_f = fehler_je_knoten()
    print('\n══ BEFUND ══════════════════════════════════════════════════')
    print('LIEF UEBERHAUPT TON? (Anteil der Proben mit RUNNING)')
    tot = []
    for s in ziele:
        anteil = (spielte[s['name']] / proben * 100) if proben else 0
        print('   %-30s %3.0f %%' % (s['geraet'][:30], anteil))
        if anteil < 5:
            tot.append(s['geraet'])
    if tot:
        print()
        print('   >>> DIESER LAUF IST OHNE GEGENSTAND: %s hat nie gespielt.' % ', '.join(tot))
        print('   >>> Alles Weitere unten waere eine Zahl ueber einen Vorgang,')
        print('   >>> der nicht stattgefunden hat. Lautsprecher pruefen.')
    print()
    gesamt = {k: v - vorher_f.get(k, 0) for k, v in nachher_f.items() if v - vorher_f.get(k, 0) > 0}
    if gesamt:
        print('AUSSETZER in %.0f s:' % a.sek)
        for k, v in sorted(gesamt.items(), key=lambda x: -x[1]):
            print('   %-30s %d' % (k[:30], v))
    else:
        print('AUSSETZER: keine.')
    print()
    if vorher_w['verbunden'] and not nachher_w['verbunden']:
        print('WLAN: es ist waehrend der Messung WEGGEFALLEN — das ist ein Befund,')
        print('      auch wenn der Ton durchlief (E68).')
    elif vorher_w['signal'] is not None and nachher_w['signal'] is not None:
        d = nachher_w['signal'] - vorher_w['signal']
        print('WLAN: %d -> %d dBm (%+d)' % (vorher_w['signal'], nachher_w['signal'], d))
        if d <= -6:
            print('      MEHR ALS 6 dB SCHLECHTER — das ist keine Schwankung mehr.')
    print()
    print('Der Vergleichslauf fehlt noch, wenn er nicht schon gemacht wurde:')
    print('  python3 zwei-stroeme-probe.py --nur-einer --sek %.0f' % a.sek)
    print('Ohne ihn ist unbekannt, ob diese Box auch mit EINEM Strom Aussetzer hat.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
