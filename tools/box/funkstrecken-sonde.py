#!/usr/bin/env python3
r"""Welche Funkstrecke traegt wirklich? — ueber Stunden, auf der Box, je Schnittstelle.

Auf der Box:
    python3 funkstrecken-sonde.py                     # einmal messen und ausgeben
    python3 funkstrecken-sonde.py --dauerlauf         # bis zum Abbruch, schreibt mit
    python3 funkstrecken-sonde.py --auswerten         # was bisher zusammenkam

Vom Arbeitsrechner:
    python3 funkstrecken-sonde.py --einrichten --box dietpi@…   # als Dienst stellen
    python3 funkstrecken-sonde.py --abbauen    --box dietpi@…   # wieder wegnehmen

══ WOZU ═══════════════════════════════════════════════════════════════════

„Welcher Adapter ist besser" laesst sich an dieser Box nicht in Sekunden
beantworten. Am 20.08.2026 ergaben zwei richtige Messungen im Abstand von zehn
Minuten das GEGENTEIL voneinander:

    22:4x   wlan0  50 % Verlust      wlan1   0 %
    23:1x   wlan0   0 % Verlust      wlan1  10 %

Wer daraus eine Empfehlung ableitet, liest Rauschen. Die Frage ist erst ueber
Stunden zu beantworten — und dann auch richtig.

══ ZWEI DINGE, DIE MAN LEICHT FALSCH MACHT ════════════════════════════════

1. VON AUSSEN MESSEN GEHT NICHT. Bei zwei Schnittstellen im selben Teilnetz
   kommt ein Ping ueber die eine herein und die ANTWORT ueber die
   VORGABEROUTE hinaus — also ueber die andere. Gemessen wird der Rueckweg.
   Deshalb laeuft diese Sonde AUF der Box und bindet mit `ping -I` an die
   Schnittstelle, hin und zurueck.

2. DER PEGEL IST NICHT DER DURCHSATZ. Beides wird deshalb je Runde
   festgehalten: Empfangspegel UND tatsaechlicher Verlust. Erst die
   Gegenueberstellung ueber viele Runden zeigt, ob der bessere Empfang auch
   der bessere Weg ist.

══ WO ES SCHREIBT ═════════════════════════════════════════════════════════

`/home/dietpi/funkstrecken.jsonl` — unter /home und NICHT im App-Ordner:
eine Auslieferung tauscht dort Baeume aus, und die Messung waere weg. Eine
Zeile je Schnittstelle und Runde, damit ein Abbruch nichts kostet.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time

MITSCHRIFT = '/home/dietpi/funkstrecken.jsonl'
DIENST = 'funkstrecken-sonde'
AUF_BOX = '/home/dietpi/funkstrecken-sonde.py'
IW = '/usr/sbin/iw'


def laufen(befehl, sek=40):
    """(rc, ausgabe) — Ausgabe IMMER, auch bei Abbruch."""
    try:
        p = subprocess.run(befehl, shell=True, capture_output=True, text=True, timeout=sek)
        return p.returncode, (p.stdout + p.stderr)
    except subprocess.TimeoutExpired as e:
        teile = [x.decode('utf-8', 'replace') if isinstance(x, bytes) else (x or '')
                 for x in (e.stdout, e.stderr)]
        return 124, '\n'.join(t for t in teile if t)
    except OSError as e:
        return 127, str(e)


def schnittstellen():
    aus = []
    for n in sorted(os.listdir('/sys/class/net')):
        if not n.startswith('wl'):
            continue
        try:
            zustand = open('/sys/class/net/%s/operstate' % n).read().strip()
        except OSError:
            zustand = '?'
        aus.append((n, zustand))
    return aus


def tor():
    rc, t = laufen('ip route | grep "^default" | head -1')
    m = re.search(r'via (\d+\.\d+\.\d+\.\d+)', t)
    return m.group(1) if m else '192.168.178.1'


def funklage(name):
    rc, t = laufen('%s dev %s link 2>/dev/null' % (IW, name), 10)
    ssid = re.search(r'SSID:\s*(.+)', t)
    freq = re.search(r'freq:\s*([\d.]+)', t)
    sig = re.search(r'signal:\s*(-?\d+)', t)
    return {
        'ssid': ssid.group(1).strip() if ssid else None,
        'freq': float(freq.group(1)) if freq else None,
        'dbm': int(sig.group(1)) if sig else None,
    }


def strecke_messen(name, ziel, pakete=20):
    """Verlust und Laufzeit — an die Schnittstelle gebunden, hin UND zurueck."""
    rc, t = laufen('ping -I %s -c%d -W2 -i0.3 -q %s' % (name, pakete, ziel), 60)
    verlust = re.search(r'(\d+(?:\.\d+)?)% packet loss', t)
    zeiten = re.search(r'= ([\d.]+)/([\d.]+)/([\d.]+)/([\d.]+)', t)
    return {
        'verlust': float(verlust.group(1)) if verlust else 100.0,
        'ms_min': float(zeiten.group(1)) if zeiten else None,
        'ms_mittel': float(zeiten.group(2)) if zeiten else None,
        'ms_max': float(zeiten.group(3)) if zeiten else None,
        'pakete': pakete,
    }


def runde(ziel, pakete):
    aus = []
    for name, zustand in schnittstellen():
        if zustand.lower() != 'up':
            aus.append({'zeit': time.time(), 'wo': name, 'zustand': zustand, 'verlust': None})
            continue
        e = {'zeit': time.time(), 'wo': name, 'zustand': zustand}
        e.update(funklage(name))
        e.update(strecke_messen(name, ziel, pakete))
        aus.append(e)
    return aus


def schreiben(zeilen, datei):
    # Anhaengen und sofort leeren: ein Abbruch kostet hoechstens die letzte Runde.
    with open(datei, 'a', encoding='utf-8') as f:
        for z in zeilen:
            f.write(json.dumps(z, ensure_ascii=False) + '\n')
        f.flush()
        os.fsync(f.fileno())


def zeigen(zeilen):
    for z in zeilen:
        if z.get('verlust') is None:
            print('  %-7s %s' % (z['wo'], z.get('zustand', '?')))
            continue
        print('  %-7s %5.1f %% Verlust  %6s ms  %5s dBm  %-22s %s'
              % (z['wo'], z['verlust'],
                 ('%.0f' % z['ms_mittel']) if z.get('ms_mittel') else '—',
                 z.get('dbm') if z.get('dbm') is not None else '—',
                 (z.get('ssid') or '—')[:22],
                 ('%.0f' % z['freq']) if z.get('freq') else ''))


def auswerten(datei):
    try:
        roh = [json.loads(z) for z in open(datei, encoding='utf-8') if z.strip()]
    except OSError:
        sys.exit('Keine Mitschrift unter %s' % datei)
    if not roh:
        sys.exit('Mitschrift ist leer.')
    je = {}
    for z in roh:
        if z.get('verlust') is None:
            continue
        je.setdefault(z['wo'], []).append(z)
    if not je:
        sys.exit('Nur Zeilen ohne Messwert — lief eine Schnittstelle ueberhaupt?')

    von, bis = min(z['zeit'] for z in roh), max(z['zeit'] for z in roh)
    stunden = (bis - von) / 3600
    print('%d Runden ueber %.1f h\n' % (max(len(v) for v in je.values()), stunden))

    print('══ JE SCHNITTSTELLE ═════════════════════════════════════════════')
    print('  %-7s %8s %9s %9s %9s %8s' % ('', 'Runden', 'Verlust⌀', 'Verlust>10%', 'ms⌀', 'dBm⌀'))
    for name in sorted(je):
        v = je[name]
        verluste = [x['verlust'] for x in v]
        zeiten = [x['ms_mittel'] for x in v if x.get('ms_mittel')]
        pegel = [x['dbm'] for x in v if x.get('dbm') is not None]
        schlecht = sum(1 for x in verluste if x > 10)
        print('  %-7s %8d %8.1f%% %8d/%-3d %9s %8s'
              % (name, len(v), sum(verluste) / len(verluste), schlecht, len(v),
                 ('%.0f' % (sum(zeiten) / len(zeiten))) if zeiten else '—',
                 ('%.0f' % (sum(pegel) / len(pegel))) if pegel else '—'))

    if len(je) > 1:
        print('\n══ DIREKTER VERGLEICH (nur Runden, in denen BEIDE gemessen haben) ══')
        namen = sorted(je)
        nach_zeit = {}
        for name in namen:
            for x in je[name]:
                nach_zeit.setdefault(round(x['zeit'] / 60), {})[name] = x
        paare = [d for d in nach_zeit.values() if len(d) == len(namen)]
        if not paare:
            print('  keine gemeinsamen Runden')
        else:
            siege = {n: 0 for n in namen}
            for d in paare:
                bester = min(namen, key=lambda n: d[n]['verlust'])
                if len({d[n]['verlust'] for n in namen}) > 1:
                    siege[bester] += 1
            print('  %d gemeinsame Runden' % len(paare))
            for n in namen:
                print('    %-7s war %d mal die bessere Strecke' % (n, siege[n]))
            print()
            for n in namen:
                v = [d[n]['verlust'] for d in paare]
                print('    %-7s Verlust im Mittel %.1f %%, schlechteste Runde %.0f %%'
                      % (n, sum(v) / len(v), max(v)))

            # ══ DIE LAUFZEIT GEHOERT INS URTEIL (21.08.2026) ═══════════════
            #
            # Die erste Fassung sammelte `ms_mittel` je Runde und liess es
            # dann liegen: gewertet wurde allein der Verlust. Nach 9,5 Stunden
            # standen 7,6 % gegen 5,5 % Verlust — kein Unterschied — und
            # DANEBEN 195 ms gegen 5 ms. Faktor 39, und das Werkzeug schwieg
            # dazu.
            #
            # EIN MESSWERKZEUG, DAS EINE ZAHL ERHEBT UND BEIM URTEIL WEGLAESST,
            # ist schlimmer als eines, das sie nie erhoben hat: der Wert steht
            # in der Tabelle und wirkt dadurch beruecksichtigt.
            #
            # Warum die Laufzeit hier mehr wiegt als der Verlust: verlorene
            # Pakete holt TCP zurueck, das kostet Bandbreite. Eine Umlaufzeit
            # von 195 ms im eigenen LAN kostet JEDE Anfrage — sie ist der
            # Grund, warum eine Verbindung sich „zaeh" anfuehlt und warum
            # Handreichungen ins Zeitlimit laufen.
            print()
            zeiten = {}
            for n in namen:
                w = [d[n]['ms_mittel'] for d in paare if d[n].get('ms_mittel')]
                if w:
                    zeiten[n] = sum(w) / len(w)
                    print('    %-7s Laufzeit im Mittel %.0f ms' % (n, zeiten[n]))
            if len(zeiten) > 1:
                gereiht = sorted(zeiten.items(), key=lambda x: x[1])
                schnell, langsam = gereiht[0], gereiht[-1]
                if langsam[1] > 3 * max(schnell[1], 1):
                    print('\n    ► %s ist %.0f mal schneller als %s.' %
                          (schnell[0], langsam[1] / max(schnell[1], 1), langsam[0]))
                    print('      DAS WIEGT SCHWERER ALS DER VERLUST OBEN. Verlorene Pakete')
                    print('      holt TCP zurueck; eine hohe Umlaufzeit kostet JEDE Anfrage.')

    print('\nDIE ENTSCHEIDUNG TRIFFT DIESES WERKZEUG NICHT. Es legt hin, was war.')
    print('Beim VERLUST ist unter ein paar Prozentpunkten keine Strecke besser —')
    print('so viel schwankt diese Umgebung von selbst. Bei der LAUFZEIT ist ein')
    print('Vielfaches dagegen ein echter Unterschied und kein Rauschen.')


EINHEIT = '''[Unit]
Description=Funkstrecken-Sonde (welcher Adapter traegt wirklich?)
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 %s --dauerlauf
Restart=always
RestartSec=20
User=root

[Install]
WantedBy=multi-user.target
''' % AUF_BOX


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--dauerlauf', action='store_true')
    p.add_argument('--auswerten', action='store_true')
    p.add_argument('--einrichten', action='store_true', help='vom Arbeitsrechner: als Dienst stellen')
    p.add_argument('--abbauen', action='store_true', help='vom Arbeitsrechner: Dienst wegnehmen')
    p.add_argument('--box', default='dietpi@192.168.178.57')
    p.add_argument('--takt', type=int, default=60, help='Sekunden zwischen den Runden')
    p.add_argument('--pakete', type=int, default=20)
    p.add_argument('--datei', default=MITSCHRIFT)
    a = p.parse_args()

    if a.einrichten or a.abbauen:
        hier = os.path.abspath(__file__)
        if a.abbauen:
            rc, t = laufen('ssh %s "sudo -n systemctl disable --now %s 2>&1; '
                           'sudo -n rm -f /etc/systemd/system/%s.service %s; '
                           'sudo -n systemctl daemon-reload; echo WEG"'
                           % (a.box, DIENST, DIENST, AUF_BOX), 60)
            print(t.strip() or '(keine Ausgabe)')
            print('Die Mitschrift bleibt liegen: %s' % a.datei)
            return 0
        rc, t = laufen('scp -q %s %s:%s' % (hier, a.box, AUF_BOX), 60)
        if rc != 0:
            sys.exit('Hochladen ging nicht: %s' % t)
        einheit = EINHEIT.replace('\n', '\\n').replace('"', '\\"')
        rc, t = laufen(
            'ssh %s "printf \'%s\' | sudo -n tee /etc/systemd/system/%s.service >/dev/null && '
            'sudo -n systemctl daemon-reload && sudo -n systemctl enable --now %s && '
            'sleep 3 && systemctl is-active %s"' % (a.box, einheit, DIENST, DIENST, DIENST), 90)
        print(t.strip() or '(keine Ausgabe)')
        print('\nMisst ab jetzt alle %d s. Auswerten:' % a.takt)
        print('    ssh %s "python3 %s --auswerten"' % (a.box, AUF_BOX))
        return 0

    if a.auswerten:
        auswerten(a.datei)
        return 0

    ziel = tor()
    if not a.dauerlauf:
        print('Eine Runde gegen %s\n' % ziel)
        zeigen(runde(ziel, a.pakete))
        return 0

    while True:
        try:
            z = runde(ziel, a.pakete)
            schreiben(z, a.datei)
        except Exception as f:  # eine Sonde, die stirbt, misst nichts
            try:
                schreiben([{'zeit': time.time(), 'wo': '?', 'fehler': str(f), 'verlust': None}], a.datei)
            except OSError:
                pass
        time.sleep(max(10, a.takt))


if __name__ == '__main__':
    sys.exit(main())
