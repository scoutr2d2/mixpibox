#!/usr/bin/env python3
r"""Soloist mit einem Spotify-Konto koppeln — und nachlesen, WELCHES es wurde.

    python3 soloist-koppeln.py --box dietpi@192.168.178.57
    python3 soloist-koppeln.py --box … --wer          # nur fragen, nichts anfassen
    python3 soloist-koppeln.py --box … --zurueck      # letzte Sitzung wiederherstellen

Laeuft vom Arbeitsrechner. Braucht SSH und `sudo -n` auf der Box.

══ WAS KOPPELN HIER HEISST ════════════════════════════════════════════════

NICHT den Schluessel eintragen. Der `spak_`-Schluessel ist die
Entwickler-Registrierung und traegt KEIN Konto — am 20.08.2026 an dieser Box
gemessen: zwei verschiedene Schluessel, zweimal gepaart, beide Male dasselbe
Konto. WELCHES Konto sich anmeldet, entscheidet allein das Geraet, das sich
per Spotify Connect verbindet.

Koppeln heisst deshalb: die alte Sitzung beiseite, Soloist starten, und dann
IN DER SPOTIFY-APP die Box als Ausgabegeraet antippen. Der Rest passiert von
selbst.

══ WARUM NICHT UEBER DEN DIENST ═══════════════════════════════════════════

Weil man dann nicht sieht, was er sagt. Der Dienst schreibt hier praktisch
nichts ins Journal; die entscheidenden zwei Zeilen —

    waiting for login — connect to "…" from your Spotify app
    logged in as 31nncq3ce5ijscgkegeoxf23pssm

— stehen nur in seiner eigenen Ausgabe. Deshalb wird er zum Koppeln kurz
angehalten und Soloist im Vordergrund gefahren, mit DEMSELBEN Datenordner.
Danach uebernimmt der Dienst die frisch gekoppelte Sitzung.

══ DIE SITZUNG WIRD NIE GELOESCHT ═════════════════════════════════════════

Sie wird VERSCHOBEN, mit Zeitstempel. Der Erfolg dieses Werkzeugs waere sonst
zugleich der Schaden: schlaegt das Koppeln fehl, stuende die Box ohne die
alte UND ohne eine neue Anmeldung da — und niemand kaeme mehr an Spotify.
`--zurueck` holt die letzte wieder.

══ DER SCHLUESSEL WIRD NIE AUSGEGEBEN ═════════════════════════════════════

Er steht auf dieser Box in der Befehlszeile und damit in `ps` (bekannte Grenze,
siehe soloist-start.sh). Dieses Werkzeug liest ihn auf der Box und gibt ihn
nirgends aus — jede Ausgabe laeuft durch einen Filter.
"""
import argparse
import re
import subprocess
import sys
import time

VORGABE_BOX = 'dietpi@192.168.178.57'
CONFIG = '/etc/mupibox/mupiboxconfig.json'
DIENST = 'soloist'


# ══ JEDER STROM HAT SEINEN EIGENEN ORDNER (22.08.2026) ═══════════════════════
#
# HIER STANDEN ZWEI FESTE PFADE: `/var/lib/soloist` und `/var/cache/soloist` —
# die Ordner DES DIENSTES. Das Werkzeug koppelte damit IMMER dorthin, egal
# welcher Strom gemeint war. Am 20.08. wurde so „Strom 2" mit einem zweiten
# Spotify-Konto gekoppelt und dabei die Sitzung des Dienstes ueberschrieben
# (Schritt 2 loescht `settings/`).
#
# GEMERKT HAT ES NIEMAND, bis der Dienst am 22.08. um 01:33 neu anlief: er
# laeuft mit dem Schluessel von Strom 1, fand aber die Anmeldung von Konto 2 —
# und kam mit `logged in: no` hoch. Die Box war stumm, und in der Spotify-App
# stand sie nicht mehr zur Wahl.
#
# UND DER SCHLUESSEL WAR DERSELBE FEHLER: gelesen wurde stets
# `.spotify.soloistApiKey`, also der von Strom 1. „Strom 2 koppeln" hiess in
# Wahrheit „Konto 2 mit Strom-1-Schluessel in den Dienst-Ordner schreiben".
#
# Die Ordnerwahl folgt jetzt derselben Regel wie im Plugin und in stroeme.ts:
# Strom 1 gehoert dem Dienst, ab Strom 2 gibt es eigene Ordner.
def daten_ordner(nr):
    return '/var/lib/soloist' if nr == 1 else '/var/lib/mixpi-strom-%d' % nr


def cache_ordner(nr):
    return '/var/cache/soloist' if nr == 1 else '/var/cache/mixpi-strom-%d' % nr


def schluessel_ausdruck(nr):
    """Der jq-Ausdruck fuer den Schluessel DIESES Stroms.

    Strom 1 darf auf `soloistApiKey` zurueckfallen — das ist die Box von
    heute, die noch gar keine Stroeme eingetragen hat.
    """
    if nr == 1:
        return '.spotify.stroeme[]? | select(.nr == 1) | .schluessel'
    return '.spotify.stroeme[]? | select(.nr == %d) | .schluessel' % nr


def sauber(text):
    """Kein Schluessel verlaesst dieses Werkzeug."""
    return re.sub(r'spak_[A-Za-z0-9]+', 'spak_<verborgen>', text or '')


def ssh(box, befehl, sek=30):
    """(rc, ausgabe) — Ausgabe IMMER, auch bei Abbruch."""
    try:
        p = subprocess.run(['ssh', '-o', 'ConnectTimeout=8', '-o', 'BatchMode=yes', box, befehl],
                           capture_output=True, text=True, timeout=sek)
        return p.returncode, sauber(p.stdout + p.stderr)
    except subprocess.TimeoutExpired as e:
        teile = [x.decode('utf-8', 'replace') if isinstance(x, bytes) else (x or '')
                 for x in (e.stdout, e.stderr)]
        return 124, sauber('\n'.join(t for t in teile if t))
    except OSError as e:
        return 127, str(e)


def hartnaeckig(box, befehl, versuche=6, sek=30):
    """Diese Box faellt beim Arbeiten weg. Also mehrmals klopfen."""
    for i in range(versuche):
        rc, aus = ssh(box, 'echo BEGINN; ' + befehl, sek)
        if 'BEGINN' in aus:
            return rc, aus.split('BEGINN', 1)[1]
        print('  (Versuch %d ohne Antwort)' % (i + 1), file=sys.stderr)
        time.sleep(4)
    return 1, ''


def wer(box, daten):
    """Welches Konto haengt gerade dran? — aus den Sitzungsdateien gelesen.

    DER ORDNER KOMMT HEREIN und steht nicht mehr als Modulwert fest: seit
    `--strom` gibt es je Strom einen eigenen. Beim Umbau am 22.08.2026 blieb
    hier zunaechst ein Zugriff auf den alten globalen Wert stehen — das Werkzeug
    starb mit `NameError`, bevor es irgendetwas anfasste.
    """
    rc, aus = hartnaeckig(box, (
        'echo "--DIENST--"; systemctl is-active %s; '
        'echo "--LAEUFT--"; pgrep -c -x soloist || true; '
        'echo "--KONTEN--"; sudo -n ls -1 %s/settings/Users 2>/dev/null || echo "(keine)"; '
        'echo "--GROESSE--"; sudo -n du -sh %s 2>/dev/null'
    ) % (DIENST, daten, daten))
    return aus


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--box', default=VORGABE_BOX)
    p.add_argument('--wer', action='store_true', help='nur nachsehen, nichts anfassen')
    p.add_argument('--zurueck', action='store_true', help='letzte beiseitegelegte Sitzung zurueckholen')
    p.add_argument('--wartet', type=int, default=180, help='Sekunden auf das Antippen in der App')
    p.add_argument('--strom', type=int, default=1,
                   help='WELCHER Strom gekoppelt wird (1 = der Dienst). Ohne diese Angabe '
                        'ging frueher jede Kopplung in den Ordner des Dienstes.')
    a = p.parse_args()

    if a.strom < 1:
        sys.exit('--strom faengt bei 1 an.')
    DATEN = daten_ordner(a.strom)
    CACHE = cache_ordner(a.strom)
    # NUR STROM 1 GEHOERT DEM DIENST. Bei den uebrigen darf er weiterlaufen —
    # ihn anzuhalten naehme der Familie waehrend des Koppelns die Musik weg.
    dienst_betroffen = a.strom == 1

    print('Soloist koppeln — %s, Strom %d\n' % (a.box.split('@')[-1], a.strom))
    print('  Ordner:  %s' % DATEN)
    print('  Dienst:  %s\n' % ('wird angehalten' if dienst_betroffen else 'laeuft weiter'))

    if a.wer:
        print(wer(a.box, DATEN))
        print('DAS SAGT NICHT, WELCHES KONTO AKTIV IST. Unter settings/Users sammeln')
        print('sich ALLE, die je verbunden waren. Was gilt, steht nur im Protokoll')
        print('einer laufenden Anmeldung — dafuer ohne --wer aufrufen.')
        return 0

    if a.zurueck:
        rc, aus = hartnaeckig(a.box, (
            'L=$(sudo -n ls -1dt %s.beiseite-* 2>/dev/null | head -1); '
            'if [ -z "$L" ]; then echo "KEINE"; else '
            '  sudo -n systemctl stop %s; '
            '  sudo -n rm -rf %s; sudo -n mv "$L" %s; '
            '  sudo -n systemctl start %s; echo "ZURUECK $L"; fi'
        ) % (DATEN, DIENST, DATEN, DATEN, DIENST), sek=60)
        print(aus.strip() or '(keine Ausgabe)')
        return 0

    # ── 1. LAGE VOR DEM EINGRIFF ────────────────────────────────────────
    print('══ VORHER ══════════════════════════════════════════════════════')
    print(wer(a.box, DATEN))

    # ── 2. DIENST ANHALTEN UND SITZUNG BEISEITE ─────────────────────────
    stempel = time.strftime('%Y%m%d-%H%M%S')
    beiseite = '%s.beiseite-%s' % (DATEN, stempel)
    print('══ SITZUNG BEISEITE ════════════════════════════════════════════')
    rc, aus = hartnaeckig(a.box, (
        '%s'
        'if [ -d %s ]; then sudo -n cp -a %s %s && echo "GESICHERT %s"; else echo "NICHTS DA"; fi; '
        'sudo -n mkdir -p %s %s; sudo -n chown dietpi:dietpi %s %s; '
        'sudo -n rm -rf %s/settings 2>/dev/null; echo FERTIG'
    ) % (
        ('sudo -n systemctl stop %s; sleep 2; ' % DIENST) if dienst_betroffen else '',
        DATEN, DATEN, beiseite, beiseite,
        DATEN, CACHE, DATEN, CACHE,
        DATEN,
    ), sek=90)
    print(aus.strip() or '(keine Ausgabe)')
    if 'FERTIG' not in aus:
        sys.exit('\nAbgebrochen — die Sitzung wurde nicht angetastet.')

    # ── 3. SOLOIST IM VORDERGRUND, MITSCHREIBEN ─────────────────────────
    #
    # Nicht ueber den Dienst: dessen Ausgabe landet nicht im Journal, und
    # genau die beiden Zeilen, auf die es ankommt, stehen nur dort.
    print('\n══ SOLOIST LAEUFT — JETZT IN DER SPOTIFY-APP ANTIPPEN ══════════')
    print('  Spotify oeffnen → Geraete-Symbol unten → die Box waehlen.')
    print('  DAS GERAET, MIT DEM DU VERBINDEST, BRINGT DAS KONTO MIT.')
    print('  Warte bis zu %d s …\n' % a.wartet)

    # DER NAME FOLGT DEM, WAS WIRKLICH LAEUFT: der Dienst meldet sich mit dem
    # blossen Boxnamen an (`-n MixPiBox`, am Geraet nachgesehen), die uebrigen
    # Stroeme mit `<Boxname> Stream <n>` wie in geraetename(). Wer hier einen
    # anderen Namen nimmt, sucht die Box spaeter in der App vergeblich.
    name_ausdruck = ('.mupibox.host // "MuPiBox"' if a.strom == 1
                     else '(.mupibox.host // "MuPiBox") + " Stream %d"' % a.strom)
    befehl = (
        'NAME=$(/usr/bin/jq -r \'%s\' %s); '
        'KEY=$(/usr/bin/jq -r \'[%s] | map(select(. != null and . != "")) | first // ""\' %s); '
        '%s'
        'if [ -z "$KEY" ]; then echo "KEIN SCHLUESSEL fuer Strom %d in %s"; exit 1; fi; '
        # `-p/--pair` IST DER UNTERSTUETZTE WEG (Spotify-Doku, 22.08.2026):
        # „Authenticate through Spotify Connect, store credentials, and exit."
        # Hier stand vorher ein handgeschnitzter Ersatz — Soloist im
        # Vordergrund mit `timeout` starten und nach dem Antippen abschiessen.
        # Das tat fast dasselbe, aber es endete mit einem Kill statt mit einem
        # ordentlichen Ende, und ob die Sitzung dabei vollstaendig geschrieben
        # war, stand nirgends. `--pair` beendet sich SELBST, wenn es fertig ist.
        # Das `timeout` bleibt als Notnagel, falls niemand antippt.
        'sudo -n timeout %d /usr/local/bin/soloist --pair -n "$NAME" -k "$KEY" '
        '  -D %s -C %s -z 100 2>&1 | tail -40'
    ) % (
        name_ausdruck, CONFIG,
        schluessel_ausdruck(a.strom), CONFIG,
        # NUR STROM 1 DARF ZURUECKFALLEN. Bei den uebrigen waere der alte
        # Schluessel der von Strom 1 — und damit genau der Fehler, der diesen
        # Umbau ausgeloest hat.
        ('if [ -z "$KEY" ]; then KEY=$(/usr/bin/jq -r \'.spotify.soloistApiKey // ""\' %s); fi; ' % CONFIG)
        if a.strom == 1 else '',
        a.strom, CONFIG,
        a.wartet, DATEN, CACHE,
    )
    rc, aus = ssh(a.box, befehl, sek=a.wartet + 60)
    print(aus.strip() or '(keine Ausgabe)')

    # ── 4. DIE EINE ZEILE, DIE ZAEHLT ───────────────────────────────────
    # DIE MUSTER FOLGEN DEM, WAS `--pair` WIRKLICH SAGT (am Geraet, 22.08.2026):
    #
    #     ready, device_name=MixPiBox device_id=…
    #     cleared existing session before pairing
    #     pairing mode - connect to "MixPiBox" from your Spotify app
    #     shutting down
    #
    # Vorher wurde nur auf „waiting for login" geprueft — das ist die Zeile des
    # NORMALEN Starts, nicht die des Koppelmodus. Ein Lauf, in dem niemand
    # antippte, meldete deshalb „?" statt „niemand hat verbunden", und der
    # Grund stand ratlos daneben, obwohl er klar in der Ausgabe stand.
    konto = re.search(r'logged in as (\S+)', aus)
    wartete = 'waiting for login' in aus or 'pairing mode' in aus

    print('\n══ ERGEBNIS ════════════════════════════════════════════════════')
    if konto:
        print('  ✔ GEKOPPELT mit: %s' % konto.group(1))
        print('    Das ist die einzige verlaessliche Auskunft — nicht der')
        print('    Rueckgabewert und nicht die Ordnerliste unter settings/Users.')
    elif wartete:
        print('  ✘ Soloist hat gewartet, aber niemand hat verbunden.')
        print('    Nochmal aufrufen und in der App das Geraet antippen.')
    else:
        print('  ? Weder „waiting for login" noch „logged in as" in der Ausgabe.')
        print('    Oben nachlesen — meist steht der Grund dort (Schluessel')
        print('    abgelehnt, Build verfallen, kein Ton-Server).')

    # ── 5. DIENST WIEDER ANWERFEN ───────────────────────────────────────
    print('\n══ DIENST WIEDER AN ════════════════════════════════════════════')
    rc, aus2 = hartnaeckig(a.box, (
        'sudo -n systemctl start %s; sleep 4; systemctl is-active %s'
    ) % (DIENST, DIENST), sek=60)
    print('  %s' % (aus2.strip() or '(keine Ausgabe)'))
    print('\n  Die alte Sitzung liegt unter %s' % beiseite)
    print('  Zurueckholen: --zurueck')
    return 0 if konto else 1


if __name__ == '__main__':
    sys.exit(main())
