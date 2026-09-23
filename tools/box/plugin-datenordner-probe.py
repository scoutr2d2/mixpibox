#!/usr/bin/env python3
r"""Kommt `kontext.datenOrdner` beim Plugin WIRKLICH an? — am Geraet gemessen.

    python3 plugin-datenordner-probe.py --box dietpi@192.168.178.57
    python3 plugin-datenordner-probe.py --box … --kennung mupibox-podcast

Laeuft vom Arbeitsrechner. Braucht SSH zur Box und die Backend-API auf 8200.

══ WOZU ═══════════════════════════════════════════════════════════════════

Der Plugin-Wirt legt je Kennung einen Datenordner an und reicht ihn als
`kontext.datenOrdner` herein. Dass der ORDNER da ist, sieht man mit `ls`.
Dass er beim Plugin ANKOMMT, sieht man damit nicht.

UND DAS IST DIE FALLE: Ein Plugin, das ohne Datenordner arbeitet, verhaelt
sich nach aussen genau wie eines mit leerem Datenordner. Beide melden „nichts
vorgemerkt". Wer das als Beleg nimmt, hat einmal hingesehen und nichts
gemessen — der haeufigste Selbstbetrug in diesem Projekt.

DIE PROBE MACHT DEN UNTERSCHIED SICHTBAR: Sie legt eine erkennbare Liste in
den Datenordner und fragt dann das Befinden ab. Zeigt es die Probe, ist die
Naht dicht. Zeigt es sie nicht, ist `datenOrdner` leer angekommen — egal wie
gut der Ordner aussieht.

══ WAS SIE ANFASST ════════════════════════════════════════════════════════

Genau eine Datei: `<datenOrdner>/liste.json`. Eine VORHANDENE wird vorher
gesichert und danach zurueckgestellt — auch wenn die Probe scheitert. Ohne
diese Sicherung waere der Erfolg der Probe zugleich der Schaden: die echte
Liste weiss, was schon aufgenommen wurde, und ohne sie naehme die Box alles
ein zweites Mal auf.
"""
import argparse
import json
import subprocess
import sys
import urllib.error
import urllib.request

VORGABE_BOX = 'dietpi@192.168.178.57'
APP = '/home/dietpi/.mupibox/Sonos-Kids-Controller-master'
DATEN = APP + '/server/config/plugin-daten'

# Erkennbar und offensichtlich kuenstlich — falls doch einmal eine liegen
# bleibt, sieht man ihr an, woher sie kommt.
PROBE_URI = 'spotify:track:0000000000PROBE0000000'
PROBE_TITEL = 'PROBE-DATENORDNER-BITTE-LOESCHEN'


def ssh(box, befehl, sek=20):
    """(rc, ausgabe) — Ausgabe IMMER, auch bei Abbruch."""
    try:
        p = subprocess.run(['ssh', '-o', 'ConnectTimeout=8', '-o', 'BatchMode=yes', box, befehl],
                           capture_output=True, text=True, timeout=sek)
        return p.returncode, (p.stdout + p.stderr).strip()
    except subprocess.TimeoutExpired as e:
        teile = [x.decode('utf-8', 'replace') if isinstance(x, bytes) else (x or '')
                 for x in (e.stdout, e.stderr)]
        return 124, '\n'.join(t for t in teile if t).strip() or '(Zeitueberschreitung)'
    except OSError as e:
        return 127, str(e)


def befinden(adresse, kennung, sek=15):
    ziel = 'http://%s:8200/api/plugins/%s/befinden' % (adresse, kennung)
    try:
        with urllib.request.urlopen(ziel, timeout=sek) as a:
            return json.loads(a.read().decode('utf-8', 'replace'))
    except (urllib.error.URLError, OSError, ValueError) as e:
        return {'ok': False, 'text': 'nicht erreichbar: %s' % e}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--box', default=VORGABE_BOX)
    p.add_argument('--kennung', default='mixpi-mitschnitt')
    a = p.parse_args()
    adresse = a.box.split('@')[-1]
    ordner = '%s/%s' % (DATEN, a.kennung)
    datei = ordner + '/liste.json'
    sicher = datei + '.probe-sicherung'

    print('Kommt der Datenordner beim Plugin an? — %s auf %s\n' % (a.kennung, adresse))

    rc, _ = ssh(a.box, 'test -d %s' % ordner)
    if rc != 0:
        sys.exit('Kein Datenordner unter %s — der Wirt hat ihn nicht angelegt.' % ordner)
    print('  Ordner da:      %s' % ordner)

    vorher = befinden(adresse, a.kennung)
    print('  Befinden vorher: %s' % str(vorher.get('text'))[:100])

    # SICHERN, BEVOR ETWAS HINGELEGT WIRD. Der Erfolg der Probe waere sonst
    # zugleich der Schaden.
    rc, aus = ssh(a.box, 'if [ -f %s ]; then cp -p %s %s && echo GESICHERT; else echo KEINE; fi' % (datei, datei, sicher))
    if rc != 0:
        sys.exit('Sichern ging nicht: %s' % aus)
    gab_es = 'GESICHERT' in aus
    print('  Vorhandene Liste: %s' % ('gesichert' if gab_es else 'keine da'))

    probe = json.dumps({'eintraege': [{
        'uri': PROBE_URI, 'titel': PROBE_TITEL, 'interpret': 'Probe',
        'album': 'Probe', 'albumInterpret': 'Probe', 'nummer': 1,
        'zustand': 'offen', 'herkunft': 'hand', 'vorrang': False,
        'versuche': 0, 'grund': '',
    }]}, ensure_ascii=False)

    fehler = None
    try:
        rc, aus = ssh(a.box, "cat > %s <<'PROBEENDE'\n%s\nPROBEENDE" % (datei, probe))
        if rc != 0:
            fehler = 'Schreiben ging nicht: %s' % aus
        else:
            nachher = befinden(adresse, a.kennung)
            text = str(nachher.get('text') or '')
            print('  Befinden nachher: %s' % text[:120])
            print()
            if PROBE_TITEL in text or 'vorgemerkt' in text:
                print('  ✔ DIE NAHT IST DICHT. Das Plugin liest aus dem Datenordner.')
            else:
                print('  ✘ DIE PROBE KOMMT NICHT AN.')
                print('    Der Ordner ist da, das Plugin sieht ihn aber nicht. Zu pruefen:')
                print('    - reicht plugin-wirt.ts `datenOrdner` in workerData?')
                print('    - setzt plugin-laufwerk.ts es auf den Kontext?')
                print('    - merkt sich das Plugin es aus `kontext`?')
                fehler = 'Probe nicht sichtbar'
    finally:
        # ZURUECKSTELLEN IN JEDEM FALL — auch nach einem Abbruch oben.
        if gab_es:
            rc, aus = ssh(a.box, 'mv -f %s %s && echo ZURUECK' % (sicher, datei))
            print('\n  Liste zurueckgestellt: %s' % ('ja' if 'ZURUECK' in aus else 'NEIN — %s' % aus))
        else:
            rc, aus = ssh(a.box, 'rm -f %s && echo WEG' % datei)
            print('\n  Probe entfernt: %s' % ('ja' if 'WEG' in aus else 'NEIN — %s' % aus))
        rest = befinden(adresse, a.kennung)
        print('  Befinden danach: %s' % str(rest.get('text'))[:100])

    return 1 if fehler else 0


if __name__ == '__main__':
    sys.exit(main())
