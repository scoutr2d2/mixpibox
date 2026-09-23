#!/usr/bin/env python3
"""Traegt ein ZWEITER Spotify-Zugang einen ungestoerten Mitschnitt? — gemessen.

    python3 zweitzugang-probe.py spotify:track:<id>
    python3 zweitzugang-probe.py --paaren      # einmalig, vor dem ersten Lauf

Muss AUF DER BOX laufen, WAEHREND die Familie Musik hoert. Ohne laufende
Wiedergabe misst es die entscheidende Frage nicht (und sagt das).

══ DIE EINE FRAGE, AN DER ALLES HAENGT ════════════════════════════════════

Der Mitschnitt ist heute ein PASSIVER ABGRIFF: er klemmt sich an den Knoten
des Familien-Abspielers. Wer den Titel wechselt, schneidet die Aufnahme ab —
das ist E63/E64 in einem Satz.

Die Idee (Betreiber, 20.08.2026): der Mitschnitt bekommt einen EIGENEN
Zugang und spielt den Titel selbst, vollstaendig, an der Familie vorbei.
Soloist kann das von Haus aus:

    -s, --single-track <uri>   spielt EIN Stueck und beendet sich danach
    -p, --pair                 meldet einmalig an, Anmeldung bleibt im Datenordner

Das waere zugleich das Ende des Ratens: heute entscheidet eine 97-%-Schwelle,
ob ein Titel vollstaendig ist (E64a). Ein Prozess, der sich beim Ende des
Stuecks selbst beendet, ist ein HARTES Signal statt einer Schaetzung.

ABER DAS GANZE STEHT UND FAELLT MIT EINER ANNAHME: Spotify spielt je Konto
nur EINEN Strom. Mit demselben Konto naehme der Mitschnitt der Familie die
Musik weg. Deshalb diese Messung, BEVOR irgendetwas gebaut wird. Sie
beantwortet drei Dinge und nichts sonst:

    F1  Spielt die Familie waehrenddessen ungestoert weiter?
    F2  Entsteht ein zweiter, UNTERSCHEIDBARER Tonknoten?
    F3  Beendet sich der Zweit-Soloist von selbst, wenn das Stueck aus ist?

══ ZWEI SCHLUESSEL SIND NICHT NOETIG — DREI FAELLE ════════════════════════

Betreiber, 20.08.2026: „auch nur mit einem key soll es jeweils moeglich
sein". Stimmt, und der Grund ist, dass librespot GAR KEINEN spak_-Schluessel
benutzt: es meldet sich per Zeroconf an (die Token-Falle steht ausfuehrlich
in config/templates/env-librespot). Nur Soloist braucht einen.

  FALL 1 — zwei Schluessel.  .soloistApiKey traegt die Familie,
      .soloistApiKeyMitschnitt den Mitschnitt. Zwei Konten, parallel,
      unabhaengig davon welche Maschine die Familie bedient.

  FALL 2 — EIN Schluessel, engine=librespot.  Die Familie spielt ueber
      librespot ohne Schluessel; der eine vorhandene Schluessel gehoert
      damit dem Mitschnitt allein. Parallel moeglich. Das ist die
      „Mischung", die der Betreiber vorgeschlagen hat — und sie loest die
      Namenskollision gleich mit: librespots Knoten heisst
      `alsa_playback.librespot`, Soloists `spotify`.

  FALL 3 — EIN Schluessel, engine=soloist.  Familie und Mitschnitt haetten
      DENSELBEN Zugang. Parallel ist ausgeschlossen; ein Lauf naehme der
      Familie die Musik weg. Dieses Werkzeug VERWEIGERT dann den Start,
      solange gespielt wird. Nutzbar bleibt der Fall trotzdem: der
      Mitschnitt arbeitet die Liste ab, wenn die Box still ist.

══ WARUM DIE MESSUNG SO GEBAUT IST ════════════════════════════════════════

ZEHNMAL JE SEKUNDE, NICHT EINMAL. Ein laufender Vorgang hat einen Anlauf;
eine Momentaufnahme darin sieht aus wie ein Dauerzustand (Wiki:
einmal-hinsehen-ist-keine-messung). Es wird eine Zeile je Zeitpunkt
ausgegeben, damit Anlauf und Zustand unterscheidbar bleiben.

ZAHL UND ETIKETT IN GETRENNTEN FELDERN. Am 20.08.2026 hat ein
Messwerkzeug dieses Projekts den TITEL an denselben String gehaengt, aus
dem danach die Stroeme gezaehlt wurden — der Titel wurde als zweiter Strom
mitgezaehlt und meldete „zwei Stroeme gleichzeitig", wo einer lief. Genau
die Vermutung, die zu pruefen war (Wiki:
messwerkzeug-baut-sich-den-befund-selbst). Hier wird deshalb NIE ueber
Textzerlegung gezaehlt: jede Messung ist ein dict mit getrennten Feldern.

DIE KNOTEN HEISSEN BEIDE `spotify`. Soloists PipeWire-Knoten traegt den
Namen `spotify` — bei ZWEI Instanzen also zweimal derselbe Name (Wiki:
soloist-erste-messung). Ueber den Namen zu suchen griffe womoeglich den
Familienstrom ab und saehe dabei aus, als arbeite es. Unterschieden wird
deshalb ueber `application.process.id` gegen die PID, die wir selbst
gestartet haben.

DER TON DARF NICHT NACH DRAUSSEN. Ohne -d folgt Soloist der Standard-Senke;
dann hoerte die Familie den Mitschnitt mit — ein zweiter Strom auf demselben
Lautsprecher, also genau die Form, die in E63 als „Echo" gemeldet ist. Die
Probe legt dafuer eine Leersenke an und raeumt sie am Ende wieder weg.

══ WAS ES NICHT TUT ═══════════════════════════════════════════════════════

Es schneidet nichts mit. Es beantwortet nur, ob der Weg trägt.
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
DATEN_FAMILIE = '/var/lib/soloist'
DATEN_ZWEIT = os.path.expanduser('~/.local/share/soloist-mitschnitt')
LEERSENKE = 'mitschnitt_probe'
TAKT_S = 0.1


def laufen(befehl, frist=8):
    try:
        f = subprocess.run(befehl, capture_output=True, text=True, timeout=frist)
        return f.returncode, f.stdout, f.stderr
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        return -1, '', str(e)


def konfig(pfad_im_json, vorgabe=''):
    code, aus, _ = laufen(['jq', '-r', '%s // ""' % pfad_im_json, CONFIG])
    return aus.strip() if code == 0 and aus.strip() else vorgabe


def knoten_liste():
    """Alle Tonquellen als LISTE VON DICTS — nie als Text, der gezaehlt wird.

    Jeder Eintrag: {'id':…, 'name':…, 'pid':…, 'zustand':…}. Die pid ist der
    einzige verlaessliche Unterschied zwischen zwei Soloist-Knoten.
    """
    code, aus, _ = laufen(['pw-dump'], frist=10)
    if code != 0:
        return []
    try:
        roh = json.loads(aus)
    except json.JSONDecodeError:
        return []
    gefunden = []
    for k in roh:
        if k.get('type') != 'PipeWire:Interface:Node':
            continue
        eigen = (k.get('info') or {}).get('props') or {}
        if eigen.get('media.class') != 'Stream/Output/Audio':
            continue
        gefunden.append({
            'id': k.get('id'),
            'name': eigen.get('node.name') or eigen.get('application.name') or '?',
            'pid': eigen.get('application.process.id'),
            'zustand': (k.get('info') or {}).get('state', '?'),
        })
    return gefunden


def familie_jetzt():
    """Was die Familie hoert — ueber soloists eigene Steuerung, als dict.

    BEKANNTE GRENZE: Das geht nur, solange die Familie auf SOLOIST laeuft.
    Spielt sie ueber librespot (Fall 2), antwortet `ctl` nicht, und ein leeres
    dict saehe aus wie „spielt nicht" — ein stiller Falschbefund genau an der
    Stelle, die F1 beantworten soll. Der Aufrufer prueft deshalb `.spotify.engine`
    und sagt es an, statt die Luecke als Messwert auszugeben.
    """
    code, aus, _ = laufen([SOLOIST, 'ctl', 'now', '--json', '-D', DATEN_FAMILIE])
    if code != 0:
        return {}
    try:
        z = json.loads(aus)
    except json.JSONDecodeError:
        return {}
    return {
        'titel': (z.get('track') or {}).get('name') or z.get('name') or '?',
        'position_ms': z.get('position_ms') or z.get('position') or 0,
        'spielt': bool(z.get('is_playing', z.get('playing', False))),
    }


def leersenke_anlegen():
    code, aus, _ = laufen(['pactl', 'list', 'short', 'sinks'], frist=6)
    for zeile in aus.splitlines():
        if LEERSENKE in zeile:
            return None  # war schon da, nicht von uns
    code, aus, fehler = laufen([
        'pactl', 'load-module', 'module-null-sink',
        'sink_name=%s' % LEERSENKE,
        'sink_properties=device.description=Mitschnitt-Probe',
    ], frist=8)
    if code != 0:
        sys.exit('Leersenke liess sich nicht anlegen: %s' % fehler.strip())
    return aus.strip()


def leersenke_weg(modulnummer):
    if modulnummer:
        laufen(['pactl', 'unload-module', modulnummer], frist=8)


# Die Nummer dieses Stroms. 1 ist die Familie, 2 der Mitschnitt; weitere
# waeren 3, 4 … — das Schema traegt sie, ohne dass jemand Namen erfinden muss.
STROM_NR = 2


def name_waehlen():
    """Wie das zweite Geraet in der Connect-Liste heisst.

    NICHT „Mitschnitt" (Betreiber, 20.08.2026). Der Gerätename steht nicht nur
    in der Liste, die jeder im Haushalt sieht — er geht an SPOTIFY. Connect-
    Geraete tauchen in der Geraeteliste des Kontos auf, und ein Geraet namens
    „Mitschnitt" sagt dem Dienst woertlich, was es tut. Der Warntext des
    Plugins nennt genau das als Risiko: „es kann zum Verlust des Zugangs
    kommen."

    DAS SCHEMA IST `<Boxname> Stream <n>` (Betreiber, 20.08.2026: „MixPiBox_1
    Stream 1 und MixPiBox_1 Stream 2 — dann kann es mehrere geben"). Es traegt
    zwei Erweiterungen, die ein blosses „Box 2" nicht kann:

      * MEHRERE STROEME je Box: Stream 1 ist die Familie, Stream 2 der
        Mitschnitt; ein dritter braucht keinen erfundenen Namen mehr.
      * MEHRERE BOXEN im Haushalt: die kommen ueber den BOXNAMEN herein, nicht
        ueber den Geraetenamen. Ein zweiter Kasten heisst `MixPiBox_2` und
        bekommt damit `MixPiBox_2 Stream 1/2` von selbst.

    WARUM DIE BOXNUMMER NICHT HIER HINEINGEHOERT: `.mupibox.host` haengt an 29
    Stellen — am Systemhostnamen, an der Geraete-Kennung, an den Namen der
    Sicherungsdateien, am Boot-Splash und am Boxnamen in BEIDEN Oberflaechen.
    Ein `_1` dort ist kein Umbenennen eines Connect-Geraets, sondern der
    ganzen Box. Wer das will, tut es dort — und dieses Schema folgt ihm
    automatisch.

    UND ES DARF NICHT DERSELBE NAME SEIN wie der der Familienbox: zwei
    Connect-Geraete mit gleichem Namen sind in der App nicht zu unterscheiden,
    und dann verbindet sich jemand versehentlich mit dem falschen.
    """
    eigen = konfig('.spotify.soloistNameMitschnitt')
    familie = konfig('.mupibox.host', 'MuPiBox')
    name = eigen or ('%s Stream %d' % (familie, STROM_NR))
    if name == familie:
        sys.exit(
            'Der Mitschnitt-Name ist derselbe wie der der Box (%s).\n'
            'Zwei Connect-Geraete mit gleichem Namen sind in der App nicht zu\n'
            'unterscheiden — bitte .spotify.soloistNameMitschnitt anders setzen.' % name)
    return name


def schluessel_waehlen():
    """Welcher Schluessel gehoert dem Mitschnitt — und darf er PARALLEL laufen?

    Gibt (schluessel, beschreibung, parallel_moeglich) zurueck; die drei Faelle
    stehen im Kopf dieser Datei. Ein zweiter Schluessel ist NICHT Bedingung —
    er entscheidet nur, ob gleichzeitig gespielt werden darf.
    """
    zweit = konfig('.spotify.soloistApiKeyMitschnitt')
    erst = konfig('.spotify.soloistApiKey')
    engine = konfig('.spotify.engine', 'librespot')

    if zweit:
        if erst and zweit == erst:
            sys.exit(
                'soloistApiKeyMitschnitt und soloistApiKey sind DERSELBE Schluessel.\n'
                'Dann ist es EIN Konto, und ein Lauf naehme der Familie die Musik weg.\n'
                'Entweder den Schluessel des zweiten Zugangs eintragen — oder das\n'
                'Feld leeren, dann greift Fall 2 bzw. 3.')
        return zweit, 'Fall 1 — eigener Schluessel fuer den Mitschnitt', True
    if not erst:
        sys.exit(
            'kein spak_-Schluessel in %s.\n'
            'Erwartet wird .spotify.soloistApiKeyMitschnitt (eigener Zugang) oder\n'
            'wenigstens .spotify.soloistApiKey.' % CONFIG)
    if engine == 'soloist':
        return erst, 'Fall 3 — EIN Schluessel, den die Familie gerade selbst benutzt', False
    return erst, 'Fall 2 — EIN Schluessel; die Familie laeuft ueber librespot', True


def paaren(schluessel):
    print('PAAREN — jetzt Spotify auf dem Handy MIT DEM ZWEITEN KONTO oeffnen')
    print('und dort das Geraet "%s" auswaehlen.' % name_waehlen())
    print('Soloist beendet sich von selbst, sobald die Anmeldung steht.\n')
    os.makedirs(DATEN_ZWEIT, exist_ok=True)
    f = subprocess.run([
        SOLOIST, '-n', name_waehlen(), '-k', schluessel,
        '-D', DATEN_ZWEIT, '-p',
    ])
    if f.returncode == 0:
        print('\nAnmeldung steht in %s' % DATEN_ZWEIT)
    else:
        print('\nfehlgeschlagen (Code %d)' % f.returncode)
    return f.returncode


def main():
    p = argparse.ArgumentParser()
    p.add_argument('uri', nargs='?', help='spotify:track:<id>')
    p.add_argument('--paaren', action='store_true')
    p.add_argument('--sekunden', type=int, default=45, help='Messdauer (Vorgabe 45)')
    a = p.parse_args()

    if not os.path.exists(SOLOIST):
        sys.exit('kein %s — laeuft das hier auf der Box?' % SOLOIST)

    schluessel, fall, parallel = schluessel_waehlen()
    print('ZUGANG: %s' % fall)
    print('        gleichzeitig zur Familie: %s\n'
          % ('ja' if parallel else 'NEIN — nur wenn die Box still ist'))

    if a.paaren:
        return paaren(schluessel)

    if not a.uri:
        sys.exit('welchen Titel? -> zweitzugang-probe.py spotify:track:<id>')
    if not re.match(r'^spotify:track:[A-Za-z0-9]+$', a.uri):
        sys.exit('das sieht nicht nach spotify:track:<id> aus: %s' % a.uri)
    if not os.path.isdir(DATEN_ZWEIT) or not os.listdir(DATEN_ZWEIT):
        sys.exit('noch nicht angemeldet — erst: zweitzugang-probe.py --paaren')

    # ══ VORHER ══════════════════════════════════════════════════════════
    # Ob F1 ueberhaupt messbar ist, haengt an der Maschine der Familie: nur
    # Soloist beantwortet `ctl now`. Das wird ANGESAGT statt unterstellt.
    familie_lesbar = konfig('.spotify.engine', 'librespot') == 'soloist'
    if not familie_lesbar:
        print('HINWEIS: Die Familie laeuft nicht auf Soloist — ihr Zustand ist')
        print('ueber `soloist ctl` nicht lesbar. F1 wird deshalb nicht als')
        print('gemessen ausgegeben, sondern als offen.\n')
    vorher_familie = familie_jetzt()
    vorher_knoten = knoten_liste()
    print('VORHER')
    print('  Familie spielt : %s' % ('ja' if vorher_familie.get('spielt') else 'NEIN'))
    print('  Titel          : %s' % vorher_familie.get('titel', '?'))
    print('  Tonquellen     : %d' % len(vorher_knoten))
    for k in vorher_knoten:
        print('      id=%-6s pid=%-8s %s' % (k['id'], k['pid'], k['name']))
    # FALL 3: derselbe Zugang. Ein Lauf waehrend der Wiedergabe naehme der
    # Familie die Musik weg — das ist kein Messfehler, sondern Schaden am
    # laufenden Betrieb. Deshalb hier Schluss, nicht bloss eine Warnung.
    if not parallel and vorher_familie.get('spielt'):
        sys.exit(
            '\nABGEBROCHEN. Der Mitschnitt haette denselben Zugang wie die\n'
            'laufende Wiedergabe — der Lauf wuerde der Familie die Musik\n'
            'wegnehmen. Entweder warten, bis die Box still ist, oder einen\n'
            'zweiten Zugang unter .spotify.soloistApiKeyMitschnitt eintragen,\n'
            'oder die Familie auf librespot stellen (.spotify.engine).')

    if not vorher_familie.get('spielt'):
        if parallel:
            print('\nWARNUNG: Die Familie spielt gerade nicht. F1 (stoert es die')
            print('Wiedergabe?) laesst sich so NICHT beantworten — der Lauf misst')
            print('dann nur F2 und F3.\n')
        else:
            print('\nDie Box ist still — genau der Zustand, in dem dieser Fall')
            print('arbeiten darf. F1 entfaellt hier bauartbedingt.\n')

    modul = leersenke_anlegen()
    gestartet = time.time()
    kind = subprocess.Popen([
        SOLOIST, '-n', name_waehlen(), '-k', schluessel,
        '-D', DATEN_ZWEIT, '-d', LEERSENKE, '-i', '100',
        '-s', a.uri,
    ], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

    print('\nLAUF (PID %d) — eine Zeile je Aenderung, Takt %.0f ms'
          % (kind.pid, TAKT_S * 1000))
    print('  %6s  %-7s %-9s %-7s %s' % ('sek', 'familie', 'fam-pos', 'eigen', 'anmerkung'))

    letzte = None
    eigen_gesehen = False
    familie_stockte = False
    try:
        while time.time() - gestartet < a.sekunden:
            if kind.poll() is not None:
                break
            knoten = knoten_liste()
            eigen = [k for k in knoten if k['pid'] == kind.pid]
            fam = familie_jetzt()
            # GETRENNTE FELDER — kein String, der spaeter zerlegt wird.
            messung = {
                'familie_spielt': fam.get('spielt', False),
                'familie_pos': fam.get('position_ms', 0) // 1000,
                'eigene_knoten': len(eigen),
            }
            if eigen:
                eigen_gesehen = True
            if vorher_familie.get('spielt') and not messung['familie_spielt']:
                familie_stockte = True
            schluessel_zeile = (messung['familie_spielt'], messung['eigene_knoten'])
            if schluessel_zeile != letzte:
                anmerkung = ''
                if eigen:
                    anmerkung = 'eigener Knoten id=%s zustand=%s' % (
                        eigen[0]['id'], eigen[0]['zustand'])
                print('  %6.1f  %-7s %-9s %-7d %s' % (
                    time.time() - gestartet,
                    'ja' if messung['familie_spielt'] else 'NEIN',
                    messung['familie_pos'],
                    messung['eigene_knoten'],
                    anmerkung))
                letzte = schluessel_zeile
            time.sleep(TAKT_S)
    finally:
        selbst_beendet = kind.poll() is not None
        if not selbst_beendet:
            kind.terminate()
            try:
                kind.wait(timeout=5)
            except subprocess.TimeoutExpired:
                kind.kill()
        dauer = time.time() - gestartet
        ausgabe = ''
        if kind.stdout:
            try:
                ausgabe = kind.stdout.read() or ''
            except ValueError:
                ausgabe = ''
        leersenke_weg(modul)

    nachher_familie = familie_jetzt()

    print('\n══ BEFUND ═══════════════════════════════════════════════════')
    f1_gemessen = familie_lesbar and vorher_familie.get('spielt')
    f1_gut = f1_gemessen and nachher_familie.get('spielt') and not familie_stockte
    print('F1  Familie ungestoert : %s' % (
        'JA' if f1_gut
        else ('NEIN — sie stockte' if familie_stockte
              else ('OFFEN — Zustand der Familie nicht lesbar (nicht Soloist)'
                    if not familie_lesbar
                    else 'OFFEN — sie spielte waehrend der Messung nicht'))))
    print('F2  eigener Knoten     : %s' % (
        'JA — ueber die PID sauber unterscheidbar' if eigen_gesehen
        else 'NEIN — kein Knoten mit unserer PID gefunden'))
    print('F3  beendete sich selbst: %s  (nach %.1f s%s)' % (
        'JA' if selbst_beendet else 'NEIN, abgebrochen',
        dauer,
        ', Code %s' % kind.returncode if selbst_beendet else ''))
    if ausgabe.strip():
        print('\nSoloist sagte:')
        for zeile in ausgabe.strip().splitlines()[-12:]:
            print('   ', zeile)
    print()
    if eigen_gesehen and selbst_beendet and f1_gut:
        print('TRAEGT. Der zweite Zugang spielt an der Familie vorbei und')
        print('meldet das Ende des Stuecks selbst — die 97-%-Schaetzung aus')
        print('E64a waere damit ersetzbar.')
    elif eigen_gesehen and selbst_beendet:
        print('HALB. F2 und F3 sitzen, aber F1 ist OFFEN — und F1 ist die')
        print('Frage, an der die Funktion haengt. Der Lauf gehoert wiederholt,')
        print('WAEHREND die Familie hoerbar spielt. Ein Lauf ohne das ist kein')
        print('Beleg fuer Parallelbetrieb, auch wenn alles gruen aussieht.')
    else:
        print('TRAEGT NICHT ohne Weiteres — die Felder oben sagen, woran es lag.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
