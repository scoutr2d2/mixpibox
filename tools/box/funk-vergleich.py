#!/usr/bin/env python3
r"""Welcher Funkweg ist an DIESEM Platz der bessere? — beide Adapter horchen lassen.

    python3 funk-vergleich.py --box dietpi@192.168.178.57
    python3 funk-vergleich.py --box … --anwerfen        # schlafende Adapter kurz wecken

Laeuft vom Arbeitsrechner. Rein messend: es wird KEINE Verbindung umgestellt,
kein Netz eingetragen, keine Datei geaendert.

══ WOZU ═══════════════════════════════════════════════════════════════════

Eine Box mit zwei Funkbausteinen (eingebaut + USB-Stick) hat zwei Antennen an
zwei Stellen im Gehaeuse. Welche besser hoert, entscheidet nicht das Datenblatt,
sondern der PLATZ — und der aendert sich, sobald die Box umzieht.

DIE ZAHL VERFAELLT. Am 20.08.2026 stand im Wiki, 2,4 GHz bringe an diesem Ort
-53 dBm und sei deshalb dem 5-GHz-Band vorzuziehen. Wenige Stunden spaeter
waren es -70 dBm, waehrend 5 GHz -66 dBm lieferte — die Box hatte sich bewegt,
und die alte Empfehlung haette die Lage VERSCHLECHTERT.

Deshalb misst dieses Werkzeug jedes Mal neu, statt eine Zahl zu erinnern.

══ WAS ES TUT ═════════════════════════════════════════════════════════════

  * findet alle Funkschnittstellen samt Treiber und Stromspar-Einstellung
  * laesst jede EINZELN eine Umschau halten und legt die Ergebnisse
    nebeneinander — dieselben Sender, von zwei Antennen gehoert
  * sagt je Sender, welcher Adapter ihn besser hoert und um wie viel

══ DER PEGEL IST NUR DIE HALBE ANTWORT ════════════════════════════════════

DIESES WERKZEUG MISST, WER BESSER HOERT — NICHT, WER BESSER TRAEGT.

Und die zweite Frage ist schwerer, als sie aussieht. Am 20.08.2026 wurde hier
zweimal falsch geantwortet:

  1. VOM ARBEITSRECHNER BEIDE ADRESSEN ANGEPINGT. Bei zwei Schnittstellen im
     SELBEN Teilnetz kommt der Ping ueber die eine herein, die ANTWORT geht
     aber ueber die VORGABEROUTE hinaus — also ueber die andere. Gemessen wird
     der Rueckweg, nicht die gemeinte Strecke. Das Ergebnis war um 180 Grad
     verdreht.

     RICHTIG geht es nur AUF der Box, mit erzwungener Bindung:
         ping -I wlan0 -c20 <router>
         ping -I wlan1 -c20 <router>

  2. ZU KURZ GEMESSEN. Auch die richtige Messung kippte zehn Minuten spaeter:
     erst 50 % Verlust auf wlan0 und 0 % auf wlan1, dann 0 % gegen 10 %. In
     einer schwankenden Umgebung traegt eine Kurzmessung nichts.

ALSO: Ein guter Pegel ist ein Grund, den Wechsel zu PRUEFEN — nie einer, ihn
zu vollziehen. Die Pruefung gehoert auf die Box, an beide Schnittstellen
gebunden, und ueber Stunden statt ueber Sekunden.

══ WAS ES AUSDRUECKLICH NICHT TUT ═════════════════════════════════════════

Es stellt nichts um. Der Adapter, an dem die aktuelle Verbindung haengt, wird
ERKANNT UND IN RUHE GELASSEN — wer die Leitung kappt, auf der er sitzt, kommt
nicht mehr an die Box.

Mit `--anwerfen` wird ein schlafender Adapter kurz hochgefahren, um horchen zu
koennen, und danach wieder hingelegt, wie er lag. Auch das aendert keine
Verbindung: eine Schnittstelle ohne Netzzuordnung verbindet sich nicht von
selbst.
"""
import argparse
import re
import subprocess
import sys

VORGABE_BOX = 'dietpi@192.168.178.57'
IW = '/usr/sbin/iw'  # nicht im PATH einer nicht-interaktiven Shell


def ssh(box, befehl, sek=90):
    """(rc, ausgabe) — Ausgabe IMMER, auch bei Abbruch."""
    try:
        p = subprocess.run(['ssh', '-o', 'ConnectTimeout=8', '-o', 'BatchMode=yes', box, befehl],
                           capture_output=True, text=True, timeout=sek)
        return p.returncode, (p.stdout + p.stderr)
    except subprocess.TimeoutExpired as e:
        teile = [x.decode('utf-8', 'replace') if isinstance(x, bytes) else (x or '')
                 for x in (e.stdout, e.stderr)]
        return 124, '\n'.join(t for t in teile if t)
    except OSError as e:
        return 127, str(e)


def hartnaeckig(box, befehl, versuche=8, sek=90):
    """Die Box faellt beim Messen gern kurz weg. Also mehrmals klopfen."""
    for i in range(versuche):
        rc, aus = ssh(box, 'echo BEGINN; ' + befehl, sek)
        if 'BEGINN' in aus:
            return rc, aus.split('BEGINN', 1)[1]
        print('  (Versuch %d ohne Antwort)' % (i + 1), file=sys.stderr)
    return 1, ''


def scan_lesen(text):
    """{bssid: (ssid, freq, signal)} aus der Ausgabe von `iw … scan`."""
    aus, mac, freq, sig = {}, None, None, None
    for z in text.splitlines():
        m = re.match(r'BSS ([0-9a-f:]{17})', z.strip())
        if m:
            mac, freq, sig = m.group(1), None, None
            continue
        s = z.strip()
        if s.startswith('freq:'):
            try:
                freq = float(s.split(':', 1)[1])
            except ValueError:
                freq = None
        elif s.startswith('signal:'):
            m2 = re.search(r'(-?\d+(?:\.\d+)?)', s)
            sig = float(m2.group(1)) if m2 else None
        elif s.startswith('SSID:') and mac:
            name = s.split(':', 1)[1].strip()
            if sig is not None:
                aus[mac] = (name or '(ohne Namen)', freq, sig)
    return aus


def band(freq):
    if not freq:
        return '?'
    return '2,4 GHz' if freq < 3000 else '5 GHz'


def urteil(d):
    """dBm einordnen — grobe, aber ehrliche Stufen."""
    if d >= -60:
        return 'gut'
    if d >= -67:
        return 'brauchbar'
    if d >= -73:
        return 'knapp'
    return 'zu schwach'


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--box', default=VORGABE_BOX)
    p.add_argument('--anwerfen', action='store_true',
                   help='schlafende Adapter kurz wecken (und danach wieder hinlegen)')
    p.add_argument('--nur', help='nur Sender, deren Name das enthaelt')
    a = p.parse_args()

    print('Funkvergleich auf %s\n' % a.box.split('@')[-1])

    rc, aus = hartnaeckig(a.box, (
        'echo "--LAGE--"; ip -br addr | grep -v "^lo"; '
        'echo "--WEG--"; ip route get 1.1.1.1 2>/dev/null; '
        'echo "--DEV--"; %s dev 2>/dev/null; '
        'echo "--TREIBER--"; for i in /sys/class/net/wl*; do '
        '  n=$(basename $i); '
        '  echo "$n $(basename $(readlink $i/device/driver 2>/dev/null) 2>/dev/null) '
        '$(%s dev $n get power_save 2>/dev/null | tr -d "\\n")"; done'
    ) % (IW, IW))
    if not aus:
        sys.exit('Box antwortet nicht.')

    teil = dict(re.findall(r'--(\w+)--\n(.*?)(?=\n--\w+--|\Z)', aus, re.S))
    schnitt = re.findall(r'^(wl\w+)\s+(\S+)', teil.get('LAGE', ''), re.M)
    traegt = None
    m = re.search(r'dev (wl\w+)', teil.get('WEG', ''))
    if m:
        traegt = m.group(1)

    print('══ DIE ADAPTER ══════════════════════════════════════════════════')
    treiber = {}
    for zeile in teil.get('TREIBER', '').strip().splitlines():
        t = zeile.split()
        if t:
            treiber[t[0]] = (t[1] if len(t) > 1 else '?', ' '.join(t[2:]) or '?')
    for name, zustand in schnitt:
        tr, ps = treiber.get(name, ('?', '?'))
        marke = '  ← traegt die Verbindung' if name == traegt else ''
        print('  %-7s %-6s %-14s %s%s' % (name, zustand, tr, ps, marke))
    if not traegt:
        print('\n  (Welche Schnittstelle die Verbindung traegt, war nicht zu erkennen —')
        print('   dann wird VORSICHTSHALBER keine angefasst.)')

    ergebnisse = {}
    for name, zustand in schnitt:
        schlaeft = zustand.upper() != 'UP'
        if schlaeft and not a.anwerfen:
            print('\n  %s schlaeft — mit --anwerfen wird es kurz geweckt.' % name)
            continue
        print('\n── Umschau mit %s%s' % (name, ' (kurz geweckt)' if schlaeft else ''))
        befehl = ''
        if schlaeft:
            # NIE den Traeger anfassen. Er schlaeft ohnehin nicht, aber die
            # Regel gehoert in den Code und nicht in den Kopf.
            if name == traegt:
                print('  uebersprungen: daran haengt die Verbindung.')
                continue
            befehl += 'sudo -n ip link set %s up; sleep 2; ' % name
        befehl += 'sudo -n %s dev %s scan 2>&1' % (IW, name)
        if schlaeft:
            befehl += '; sudo -n ip link set %s down' % name
        rc, roh = hartnaeckig(a.box, befehl, sek=120)
        gefunden = scan_lesen(roh)
        if not gefunden:
            kurz = ' / '.join(z.strip() for z in roh.strip().splitlines()[:2])
            print('  nichts gehoert. %s' % (kurz or '(keine Ausgabe)'))
            continue
        ergebnisse[name] = gefunden
        print('  %d Sender gehoert' % len(gefunden))

    if len(ergebnisse) < 1:
        sys.exit('\nKeine Umschau zustande gekommen.')

    print('\n══ WER HOERT WEN BESSER ═════════════════════════════════════════')
    namen = list(ergebnisse)
    alle = sorted({b for g in ergebnisse.values() for b in g},
                  key=lambda b: -max(g[b][2] for g in ergebnisse.values() if b in g))
    kopf = '  %-18s %-22s %-8s' % ('Sender', 'Name', 'Band')
    print(kopf + ''.join('%10s' % n for n in namen) + '   Urteil')
    for b in alle:
        eintrag = next(g[b] for g in ergebnisse.values() if b in g)
        ssid, freq, _ = eintrag
        if a.nur and a.nur.lower() not in ssid.lower():
            continue
        zeile = '  %-18s %-22s %-8s' % (b, ssid[:22], band(freq))
        beste = None
        for n in namen:
            w = ergebnisse[n].get(b)
            zeile += '%10s' % ('%.0f' % w[2] if w else '—')
            if w and (beste is None or w[2] > beste[1]):
                beste = (n, w[2])
        print(zeile + '   %s' % (urteil(beste[1]) if beste else '?'))

    if len(namen) > 1:
        print('\n══ WAS DAS HEISST ═══════════════════════════════════════════════')
        for b in alle:
            eintrag = next(g[b] for g in ergebnisse.values() if b in g)
            if a.nur and a.nur.lower() not in eintrag[0].lower():
                continue
            werte = [(n, ergebnisse[n][b][2]) for n in namen if b in ergebnisse[n]]
            if len(werte) < 2:
                continue
            werte.sort(key=lambda x: -x[1])
            d = werte[0][1] - werte[1][1]
            if d >= 5:
                print('  %s (%s): %s hoert %.0f dB besser als %s.'
                      % (eintrag[0], band(eintrag[1]), werte[0][0], d, werte[1][0]))
        print('\n  UNTER 5 dB UNTERSCHIED IST KEINE ENTSCHEIDUNG — das schwankt')
        print('  zwischen zwei Umschauen am selben Platz.')

    print('\nEs wurde nichts umgestellt. Der Wechsel ist ein eigener Schritt —')
    print('und ein guter Pegel ist ein Grund, ihn zu PRUEFEN, nicht ihn zu vollziehen.')
    print('DIE PRUEFUNG GEHOERT AUF DIE BOX, an die Schnittstelle gebunden:')
    print('    ping -I <schnittstelle> -c20 <router>')
    print('Von aussen beide Adressen anzupingen misst den RUECKWEG — bei zwei')
    print('Schnittstellen im selben Teilnetz kommt dabei das Gegenteil heraus.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
