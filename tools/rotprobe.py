#!/usr/bin/env python3
"""
WAR DER TEST OHNE DIE AENDERUNG WIRKLICH ROT?

WOZU DIESES WERKZEUG UEBERHAUPT:
Ein gruener Test beweist nur, dass er gruen ist. Er beweist NICHT, dass er die
Aenderung bewacht, fuer die er geschrieben wurde. Ein Test, der auch ohne sie
gruen bliebe, ist schlimmer als keiner: er sieht wie eine Absicherung aus und
ist eine Zusicherung, die niemand eingeloest hat. Genau diese Sorte ist an
dieser Box schon mehrfach aufgelaufen — im Wissenspaket unter
[[attrappe-luegt-durch-weglassen]]: die Attrappe liess ein Feld weg, das
Werkzeug sah nie den Fall, und alles war gruen.

WIE ES ARBEITET (und warum so):

  1. Es legt eine WEGWERF-ARBEITSKOPIE an (`git worktree`, losgeloest) und
     spielt den heutigen Arbeitsstand hinein — die Aenderungen an verfolgten
     Dateien ueber `git diff HEAD`, dazu die neuen (unverfolgten) Dateien unter
     den angegebenen Pfaden. AM ECHTEN BAUM WIRD NICHTS ANGEFASST. An diesem
     Baum arbeitet mehr als einer; ein Werkzeug, das zum Messen kurz eine
     Quelldatei verbiegt, verbaeje dem anderen seinen Testlauf.

  2. Es faehrt jede Pruefung EINMAL UNVERAENDERT (die Grundlinie). Ist sie
     dabei nicht gruen, wird gar nichts weiter behauptet: eine Pruefung, die
     immer rot ist, beweist beim Eingriff auch nichts.

  3. Dann nimmt es je EINEN Eingriff vor — eine genau benannte Textstelle wird
     durch eine ersetzt, die den Stand VOR der Aenderung wiederherstellt — und
     erwartet, dass die zugehoerige Pruefung ROT wird. Danach wird die Datei
     wieder zurueckgesetzt.

  DER EINGRIFF WIRD UEBER SEINEN WORTLAUT BENANNT, nicht ueber eine Zeilennummer:
  Zeilennummern verrutschen bei jedem Nachbarn. Kommt der Wortlaut nicht genau
  EINMAL vor, bricht der Lauf ab, statt irgendetwas zu ersetzen.

WAS ES NICHT KANN, ausdruecklich:
  * Eine Aenderung, deren Pruefung uebersprungen wird (der E2E-Lauf ohne
    Browser), kann es nicht rot faerben. Sie taucht als UNGEPRUEFT auf — und
    genau das soll sie, statt still zu fehlen.
  * Es prueft die REGEL, nicht das Geraet. Was nur an der Box zu sehen ist,
    steht in der Zusammenfassung und nicht hier.

AUFRUF
    python3 tools/rotprobe.py                  # alles
    python3 tools/rotprobe.py --nur jellyfin   # nur Eingriffe, die passen
    python3 tools/rotprobe.py --liste          # nur zeigen, nichts laufen
    python3 tools/rotprobe.py --behalten       # Arbeitskopie stehen lassen

ENDE 0, wenn jeder Eingriff seine Pruefung rot bekommen hat.
"""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Unverfolgte Dateien werden nur unter diesen Pfaden mitgenommen. Der Rest des
# Baumes traegt gerade fremde, halbfertige Arbeit (siehe tools/eigene-hunks.py);
# sie mitzuschleppen machte den Lauf von ihr abhaengig.
NEUE_UNTER = ('src/backend-api/src/', 'src/backend-player/src/', 'tools/', 'NewDesign/')

# Verzeichnisse, die in der Arbeitskopie VERLINKT statt kopiert werden.
#
# DIE WURZEL MUSS DABEISTEHEN, und das war der erste Fehlschlag dieses
# Werkzeugs: `src/backend-api/node_modules` ist auf diesem Rechner LEER — npm
# hebt die Pakete in die Wurzel (`supertest`, `nock`, `express` liegen dort).
# Verlinkt man nur den unteren Ordner, faellt jeder Testlauf mit
# ERR_MODULE_NOT_FOUND aus — und das saehe in der Grundlinie aus wie ein
# kaputter Test, waere aber nur eine fehlende Verknuepfung.
VERLINKEN = ('node_modules', 'src/backend-api/node_modules', 'src/backend-player/node_modules')

BACKEND = 'src/backend-api'
ABSPIELER = 'src/backend-player'


def pruefung_backend(*dateien: str) -> dict:
    """Ein Testlauf des Servers ueber genau diese Spec-Dateien."""
    return {
        'cwd': BACKEND,
        'argv': ['npx', 'tsx', '--test', *[f'src/{d}' for d in dateien]],
        'umgebung': {'NODE_ENV': 'test'},
    }


def pruefung_box_rein(*dateien: str) -> dict:
    """
    Ein Testlauf ueber die REINEN Dateien der klassischen Oberflaeche.

    `--globals` IST NICHT WEGZULASSEN, und das kostet sonst eine Viertelstunde:
    Diese Spec-Dateien sind fuer Karma/Jasmine geschrieben und rufen `describe`
    und `it`, ohne sie zu importieren. Ohne den Schalter meldet vitest
    `ReferenceError: describe is not defined`, zaehlt „no tests" — und meldet
    trotzdem einen FEHLGESCHLAGENEN Lauf. In einer Rotprobe saehe das aus wie
    ein bemerkter Eingriff, waere aber nur eine fehlende Fahne: rot aus dem
    falschen Grund. tools/pruefen.sh setzt ihn aus demselben Grund.

    NUR FUER REINE DATEIEN. Was Angulars TestBed braucht, laeuft hier nicht;
    dafuer ist `ng test` mit Karma da, und das braucht einen Chrome.
    """
    return {
        'cwd': 'src/frontend-box',
        'argv': ['npx', 'vitest', 'run', '--globals', *[f'src/app/{d}' for d in dateien]],
        'umgebung': {},
    }


def pruefung_abspieler(*dateien: str) -> dict:
    """
    Ein Testlauf des ABSPIELDIENSTES ueber genau diese Spec-Dateien.

    Eigene Funktion und nicht `pruefung_backend` mit anderem `cwd`: die beiden
    Arbeitsbereiche haben getrennte node_modules, und der Abspieler braucht
    KEIN NODE_ENV=test — dort schaltet die Variable den Konfigurationspfad um
    (`configBasePath` in spotify-control.ts), was hier nur verwirrte.
    """
    return {
        'cwd': ABSPIELER,
        'argv': ['npx', 'tsx', '--test', *[f'src/{d}' for d in dateien]],
        'umgebung': {},
    }


PRUEF_REGELN = {'cwd': '.', 'argv': ['node', 'tools/pruef-neu-regeln.js'], 'umgebung': {}}

# ── DIE BEIDEN BROWSER-PRUEFUNGEN DES ELTERN-BEREICHS ──────────────────────
#
# BEIDE BEKOMMEN AUSDRUECKLICH KEINE ADRESSE MIT, und das ist der ganze Punkt:
# Ohne Adresse starten sie ihre EIGENE tools/neu-vorschau.mjs auf einem freien
# Port und messen damit den Baum, in dem sie liegen — hier also die
# Wegwerf-Arbeitskopie mit dem eingesetzten Eingriff. Wuerde ihnen eine feste
# Adresse mitgegeben, maessen sie die Vorschau, die jemand anders gerade laufen
# hat, und meldeten fuer JEDEN Eingriff gruen ([[vorschau-wird-geliehen]]).
# Ihre Browser-Debug-Ports kommen aus `freierPort()` in tools/leihgabe.mjs.
PRUEF_ELTERN_TOR = {'cwd': '.', 'argv': ['node', 'tools/eltern-tor-schau.mjs'], 'umgebung': {}}
PRUEF_ELTERN_MASSE = {'cwd': '.',
                      'argv': ['node', 'tools/eltern-masse-messen.mjs', '--pruefen'],
                      'umgebung': {}}
# MIT FUENF FAECHERN, weil ein Eingriff sonst unsichtbar bliebe: die vier
# Pixel Polster unten fehlen erst dem FUENFTEN Fach. Heute stehen vier da.
PRUEF_ELTERN_MASSE_5 = {'cwd': '.',
                        'argv': ['node', 'tools/eltern-masse-messen.mjs', '--pruefen',
                                 '--faecher', '5', '--schirm', 'eltern-flaeche'],
                        'umgebung': {}}

# DIE FORM DES BEREICHS in seinen MELDENDEN Lagen — beide Themen, aber nur die
# zwei Lagen, in denen etwas schiefgeht. `--nur kaputt` und nicht der volle
# Lauf: Die dreizehn uebrigen Lagen sagen ueber diese drei Eingriffe nichts und
# kosteten je Eingriff rund zwei Minuten in der Wegwerf-Arbeitskopie. Eine
# Rotprobe, die zu lange braucht, wird nicht mehr gefahren — und das ist
# teurer als eine, die weniger misst.
PRUEF_ELTERN_FORM_KAPUTT = {'cwd': '.',
                            'argv': ['node', 'tools/eltern-form-schau.mjs', '--nur', 'kaputt'],
                            'umgebung': {}}

# DER ELTERN-BEREICH ALS SEITE (06.08.2026). Er misst genau das, was keine der
# anderen Pruefungen sieht: dass die Kategorienleiste NEBEN ihm steht und
# bedienbar ist, dass das Kissen einfaehrt statt zugedeckt zu werden, dass
# „wer hoert" solange SICHTBAR stillgelegt ist — und dass nach dem Verlassen
# nichts davon haengenbleibt. Er startet seine EIGENE Vorschau auf einem freien
# Port; ohne das maesse er nicht die Arbeitskopie, sondern den Baum dessen, der
# gerade eine Vorschau laufen hat.
PRUEF_ELTERN_SEITE = {'cwd': '.', 'argv': ['node', 'tools/eltern-seite-schau.mjs'], 'umgebung': {}}

# HIER STAND EIN `PRUEF_ICH_ZEICHEN` fuer tools/ich-zeichen-schau.mjs, und es
# ist wieder heraus — die Begruendung gehoert aufgeschrieben, damit sie niemand
# ein zweites Mal machen muss:
# Das Werkzeug LEIHT sich eine laufende Vorschau (Vorgabe 127.0.0.1:8299) und
# nimmt einen festen Debug-Port. Beides ist hier genau falsch herum. Eine
# geliehene Vorschau bedient den HAUPTBAUM, nicht die Wegwerf-Arbeitskopie —
# der Eingriff waere also gar nicht zu sehen, und der Lauf meldete gruen ueber
# eine Datei, die er nie gemessen hat. Das ist die schlimmere Haelfte von
# [[vorschau-wird-geliehen]]: nicht „ich verstelle einem anderen die Lage",
# sondern „ich messe seinen Baum und nenne es mein Ergebnis".
# Die Aussage selbst ist damit nicht ungeprueft: tools/eltern-seite-schau.mjs
# startet seine EIGENE Vorschau und haelt dieselbe Stilllegung mit zwei
# Eingriffen fest (`wer-hoert-ist-im-eltern-bereich-stillgelegt` und
# `wer-hoert-ist-sichtbar-stillgelegt`).

# DIE SICHT DES KINDES. Sie misst nicht, ob das Tor steht, sondern was es
# KOSTET, ohne die Loesung hineinzukommen — durchprobieren, ertasten,
# vorbeigehen. Das Fenster ist auf 12 s verkuerzt: die Aussage „gebremst" faellt
# schon dort, und der Lauf steht in einer Wegwerf-Arbeitskopie viermal
# hintereinander an.
PRUEF_KIND = {'cwd': '.',
              'argv': ['node', 'tools/kind-am-tor.mjs', '--fenster', '12', '--budget', '200'],
              'umgebung': {}}

# Der Selbsttest der Sicherung. Er laeuft ohne Box und ohne Netz (alles gegen
# Wegwerf-Verzeichnisse) und braucht rund eine Sekunde — teuer ist hier nur
# das, was er NICHT pruefen kann, und das steht in der Zusammenfassung.
PRUEF_SICHERUNG = {'cwd': '.',
                   'argv': ['python3', 'scripts/mupibox/mupibox-sicherung.py',
                            '--selbsttest'],
                   'umgebung': {}}


def pruefung_e2e(muster: str) -> dict:
    """
    EIN EINZELNER Fall des Browserlaufs.

    `--test-name-pattern` statt des ganzen Laufs: der komplette E2E-Durchgang
    dauert rund 17 s, und hier werden dreissig Eingriffe nacheinander gefahren.
    Passt kein Fall auf das Muster, meldet der Lauf GRUEN mit lauter
    uebersprungenen Faellen — das saehe wie ein unbemerkter Eingriff aus und ist
    genau der Grund, warum die Grundlinie oben mitlaeuft: sie faellt bei einem
    vertippten Muster sofort auf (0 bestandene Faelle).
    """
    return {
        'cwd': '.',
        'argv': ['node', '--test', '--test-name-pattern', muster, 'tools/e2e/neu-oberflaeche.test.mjs'],
        'umgebung': {},
    }

# ══ DIE EINGRIFFE ══════════════════════════════════════════════════════════
#
# Je Eintrag: welche Aenderung wird zurueckgenommen, und welche Pruefung MUSS
# das merken. `alt` ist der heutige Wortlaut, `neu` stellt den Stand davor her.
EINGRIFFE = [
    # ── Punkt 1: Jellyfin in die Reihe ─────────────────────────────────────
    {
        'name': 'jellyfin-tor-1-stelleAus',
        'punkt': '1',
        'worum': 'stelleAus schreibt fuer Jellyfin ueberhaupt eine Stelle',
        'datei': 'src/backend-api/src/weiterhoeren.ts',
        'alt': "  if (dienst === 'jellyfin') {",
        'neu': "  if (false) {",
        'pruefung': pruefung_backend('weiterhoeren.spec.ts'),
    },
    {
        'name': 'jellyfin-tor-2-istWeiterhoerbar',
        'punkt': '1',
        'worum': 'die Aufzaehlung in istWeiterhoerbar laesst jellyfin durch',
        'datei': 'src/backend-api/src/weiterhoeren.ts',
        'alt': "&& dienst !== 'jellyfin')",
        'neu': "&& dienst !== 'jellyfin-gibt-es-nicht')",
        'pruefung': pruefung_backend('weiterhoeren.spec.ts'),
    },
    # ── Punkt 2: Folgentitel merken und als Rueckfall nutzen ───────────────
    {
        'name': 'folgentitel-merken',
        'punkt': '2',
        'worum': 'stelleAus legt resumeardfolgentitel ab',
        'datei': 'src/backend-api/src/weiterhoeren.ts',
        'alt': '    if (folgeTitel) s.resumeardfolgentitel = folgeTitel',
        'neu': '    if (false && folgeTitel) s.resumeardfolgentitel = folgeTitel',
        'pruefung': pruefung_backend('weiterhoeren.spec.ts'),
    },
    {
        'name': 'folgentitel-vom-server',
        'punkt': '2',
        'worum': 'POST /api/weiterhoeren reicht den Folgentitel ueberhaupt herein',
        'datei': 'src/backend-api/src/server.ts',
        'alt': '        folgeTitel: treffer.folgeTitel,',
        'neu': '        folgeTitel: undefined,',
        'pruefung': pruefung_backend('ard.integration.spec.ts'),
    },
    {
        'name': 'rueckfall-ueber-den-titel',
        'punkt': '2',
        'worum': 'folgeWiederfinden faellt auf den Titel zurueck, wenn die Kennung nicht trifft',
        'datei': 'src/backend-api/src/weiterhoeren.ts',
        'alt': '  const titel = normal(gesucht?.titel)',
        'neu': '  const titel = ((): string => "")()',
        'pruefung': pruefung_backend('weiterhoeren.spec.ts'),
    },
    {
        'name': 'position-als-schiedsrichter',
        'punkt': '2',
        'worum': 'bei doppelten Titeln entscheidet die gemerkte Position',
        'datei': 'src/backend-api/src/weiterhoeren.ts',
        'alt': '  return nr > 0 && treffer.includes(nr) ? nr : 0',
        'neu': '  return nr > 0 && treffer.includes(nr) ? 0 : 0',
        'pruefung': pruefung_backend('weiterhoeren.spec.ts'),
    },
    {
        'name': 'inhalt-nutzt-die-regel',
        'punkt': '2',
        'worum': '/inhalt ordnet die gemerkte Stelle ueber folgeWiederfinden zu',
        'datei': 'src/backend-api/src/server.ts',
        'alt': '      titel: stelle?.folgeTitel,',
        'neu': '      titel: undefined,',
        'pruefung': pruefung_backend('ard.integration.spec.ts'),
    },
    {
        'name': 'von-vorn-raeumt-die-folge-weg',
        'punkt': '2',
        'worum': 'VON_VORN nimmt folge und folgeTitel mit — sonst luegt die Kachel',
        'datei': 'src/backend-api/src/weiterhoeren.ts',
        'alt': '  folge: undefined,\n  folgeTitel: undefined,',
        'neu': '',
        'pruefung': pruefung_backend('weiterhoeren.spec.ts'),
    },
    # ── Punkt 3: die Kachel sagt den Namen ─────────────────────────────────
    {
        'name': 'kachel-sagt-den-namen',
        'punkt': '3',
        'worum': 'weiterMarke zieht den Folgennamen der Nummer vor',
        'datei': 'NewDesign/app.js',
        'alt': "    if (name) return { art: 'name', text: name }",
        'neu': "    if (false) return { art: 'name', text: name }",
        'pruefung': PRUEF_REGELN,
    },
    # ── Punkt 4: die Wache gegen Adressen im Titel ─────────────────────────
    {
        'name': 'wache-schneidet',
        'punkt': '4',
        'worum': 'titelOhneAdresse schneidet den http-Lauf wirklich heraus',
        'datei': 'src/backend-api/src/medien.ts',
        'alt': "  const ohne = s.replace(/https?:\\/\\/\\S*/gi, ' ')",
        'neu': '  const ohne = s',
        'pruefung': pruefung_backend('medien.spec.ts'),
    },
    {
        'name': 'wache-liegt-auf-api-add',
        'punkt': '4',
        'worum': 'die Wache ist in /api/add auch ANGESCHLOSSEN',
        'datei': 'src/backend-api/src/server.ts',
        'alt': '          data.push(mitGeputztemTitel(req.body))',
        'neu': '          data.push(req.body)',
        'pruefung': pruefung_backend('titelwache.integration.spec.ts'),
    },
    {
        'name': 'wache-liegt-auf-api-edit',
        'punkt': '4',
        'worum': 'die Wache ist in /api/edit auch ANGESCHLOSSEN',
        'datei': 'src/backend-api/src/server.ts',
        'alt': '          data.splice(req.body.index, 1, mitGeputztemTitel(req.body.data))',
        'neu': '          data.splice(req.body.index, 1, req.body.data)',
        'pruefung': pruefung_backend('titelwache.integration.spec.ts'),
    },
    {
        'name': 'wache-macht-nicht-leer',
        'punkt': '4',
        'worum': 'ein Titel, der NUR eine Adresse ist, bleibt stehen statt zu verschwinden',
        'datei': 'src/backend-api/src/medien.ts',
        'alt': '  return sauber || s.trim()',
        'neu': '  return sauber',
        'pruefung': pruefung_backend('medien.spec.ts', 'titelwache.integration.spec.ts'),
    },
    {
        # DIE REGEL ZU PRUEFEN GENUEGT NICHT. `weiterMarke` kann richtig
        # entscheiden und trotzdem auf keiner Kachel ankommen — dazwischen
        # liegen das Feld aus dem Server, die Plakette und ihr aria-label.
        # Dieser Eingriff faerbt den Browserlauf, nicht die Regel.
        'name': 'kachel-sagt-den-namen-am-schirm',
        'punkt': '3',
        'worum': 'der Folgenname steht wirklich auf der Kachel (Browserlauf)',
        'datei': 'NewDesign/app.js',
        'alt': "    if (name) return { art: 'name', text: name }",
        'neu': "    if (false) return { art: 'name', text: name }",
        'pruefung': pruefung_e2e('FOLGENNAMEN'),
    },
    # ── Punkt 5: das Cover folgt der Position ──────────────────────────────
    {
        'name': 'cover-an-der-position',
        'punkt': '5',
        'worum': 'folgenBildAn schlaegt das Bild zur laufenden Nummer nach (1-basiert)',
        'datei': 'NewDesign/app.js',
        # ERWEITERT AM 06.08.2026: `const t = l[n - 1]` steht seit
        # 5ee6562c ZWEIMAL da (folgenBildAn und folgenNameAn), und dieser
        # Eingriff brach seither mit ABBRUCH ab — die Wache war still
        # ausser Dienst. Die Folgezeile macht ihn wieder eindeutig.
        'alt': '    const t = l[n - 1]\n    const b = t && t.bild',
        'neu': '    const t = l[n]\n    const b = t && t.bild',
        'pruefung': PRUEF_REGELN,
    },
    {
        # DER EIGENTLICHE PUNKT 5, und die Regel allein beweist ihn NICHT:
        # `folgenBildAn` kann stimmen, ohne dass `coverAdresse` sie je fragt.
        # Genau diese Naht ist die, an der Punkt 5 haengt.
        'name': 'cover-fragt-die-position',
        'punkt': '5',
        'worum': 'coverAdresse fragt die laufende Position, statt beim Werkbild zu bleiben',
        'datei': 'NewDesign/app.js',
        # ERWEITERT AM 06.08.2026, gleicher Grund wie oben: die Bedingung
        # steht seit 5ee6562c auch in `titelAnzeige`. Die Folgezeile sagt,
        # welche der beiden gemeint ist — hier die des COVERS.
        'alt': '      if (laufendeFolgen && w && laufendeFolgen.schluessel === w.schluessel && passtZuLaufendem(w, np)) {\n        const b = folgenBildAn(',
        'neu': '      if (false) {\n        const b = folgenBildAn(',
        'pruefung': pruefung_e2e('Cover geht bei mpv'),
    },
    {
        # DIE ANDERE RICHTUNG DERSELBEN NAHT, nachgetragen beim Gegenlesen am
        # 06.08.2026. Der Schluesselvergleich allein kann gar nicht nein
        # sagen: `laufendesWerk()` gibt `zuletztGestartet` unbesehen zurueck,
        # und beide Seiten stammen aus derselben Zuweisung in `albumSpielen`.
        # Ohne `passtZuLaufendem` zeigte die Leiste das Bild einer Folge
        # weiter, waehrend laengst etwas anderes lief.
        'name': 'cover-laesst-fremdes-los',
        'punkt': '5',
        'worum': 'coverAdresse haengt nicht an der alten Liste, wenn etwas Fremdes laeuft',
        'datei': 'NewDesign/app.js',
        # ERWEITERT AM 06.08.2026: auch dieser Wortlaut kam nach 5ee6562c
        # zweimal vor. Gemeint ist die Wache VOR dem Bild.
        'alt': ' && passtZuLaufendem(w, np)) {\n        const b = folgenBildAn(',
        'neu': ') {\n        const b = folgenBildAn(',
        'pruefung': pruefung_e2e('Fremdes laeuft'),
    },
    {
        # UND DIE LISTE MUSS BEIM START ABGELEGT WERDEN. Ohne sie hat
        # `coverAdresse` nichts nachzuschlagen — die Anzeige faellt still auf
        # das Sendungsbild zurueck und sieht dabei richtig aus.
        'name': 'cover-merkt-die-liste',
        'punkt': '5',
        'worum': 'albumSpielen legt die Liste ab, gegen die mpv zaehlt',
        'datei': 'NewDesign/app.js',
        'alt': '    laufendeFolgen = { schluessel: w.schluessel, liste: titel }',
        'neu': '    laufendeFolgen = null',
        'pruefung': pruefung_e2e('Cover geht bei mpv'),
    },
    # ── Punkt 6 (F1): der Titelname reist im Warteschlangeneintrag mit ─────
    #
    # Bis zum 06.08.2026 blieb `currentTrackname` auf dem Namen stehen, den der
    # STARTBEFEHL gesetzt hatte. Rueckte mpv von selbst weiter, ging er nicht
    # mit — seit das Cover der Position folgt, widersprach sich die Anzeige
    # sogar sichtbar: Bild von Folge N, Name von Folge 1.
    {
        'name': 'f1-name-an-den-eintrag',
        'punkt': '6',
        'worum': 'loadfile bekommt den Namen ueberhaupt mitgegeben (force-media-title)',
        'datei': 'src/backend-player/src/mpv-protokoll.ts',
        'alt': "  if (!titel) return ['loadfile', was, modus]\n"
               "  return ['loadfile', was, modus, -1, { 'force-media-title': titel }]",
        'neu': "  return ['loadfile', was, modus]",
        'pruefung': pruefung_abspieler('mpv-protokoll.spec.ts'),
    },
    {
        # DER INDEX IST KEINE ZIERDE. Ohne ihn antwortet mpv 0.40 mit
        # "invalid parameter" — still, im Socket. Aus einem falschen
        # Titelnamen wuerde dann eine STUMME BOX.
        'name': 'f1-index-minus-eins',
        'punkt': '6',
        'worum': 'der Pflicht-Index -1 steht im loadfile',
        'datei': 'src/backend-player/src/mpv-protokoll.ts',
        'alt': "  return ['loadfile', was, modus, -1, { 'force-media-title': titel }]",
        'neu': "  return ['loadfile', was, modus, { 'force-media-title': titel }]",
        'pruefung': pruefung_abspieler('mpv-protokoll.spec.ts'),
    },
    {
        # mpv schiebt ZWISCHEN zwei Titeln `media-title = null`. Wer das
        # weiterreicht, leert bei JEDEM Uebergang kurz die Titelzeile.
        'name': 'f1-null-am-uebergang',
        'punkt': '6',
        'worum': 'der leere media_title wird geschluckt statt angezeigt',
        'datei': 'src/backend-player/src/mpv-protokoll.ts',
        'alt': "  if (name === 'media_title') return typeof wert === 'string' && wert !== ''",
        'neu': "  if (name === 'media_title') return true",
        'pruefung': pruefung_abspieler('mpv-protokoll.spec.ts'),
    },
    {
        # DIE NAHT. `BEFEHLE.queue` kann den Namen richtig einbauen, ohne dass
        # der Aufsatz ihn je uebergibt — im Test der reinen Schicht saehe
        # trotzdem alles gut aus.
        'name': 'f1-wrapper-reicht-den-namen',
        'punkt': '6',
        'worum': 'der Aufsatz gibt den Namen an BEFEHLE.queue weiter',
        'datei': 'src/backend-player/src/mpv-wrapper.ts',
        'alt': '  out.queue = (f, titel) => ladeMit(BEFEHLE.queue(f, titel))',
        'neu': '  out.queue = (f) => ladeMit(BEFEHLE.queue(f))',
        'pruefung': pruefung_abspieler('mpv-wrapper.spec.ts'),
    },
    {
        # Ohne Beobachtung erfuehre der Dienst den neuen Namen erst, wenn ihn
        # jemand abfragt — und den Uebergang von selbst fragt niemand ab.
        'name': 'f1-media-title-beobachtet',
        'punkt': '6',
        'worum': 'media-title steht in EIGENSCHAFTEN und wird dadurch beobachtet',
        'datei': 'src/backend-player/src/mpv-protokoll.ts',
        'alt': "  media_title: 'media-title',",
        'neu': '',
        'pruefung': pruefung_abspieler('mpv-wrapper.spec.ts'),
    },
    {
        # DER RUECKFALL. Lehnt ein aelteres mpv die Langform ab, wird gar
        # nichts geladen. Ohne diese Zeile bliebe die Box still stumm.
        'name': 'f1-rueckfall-bei-altem-mpv',
        'punkt': '6',
        'worum': 'ein abgelehnter loadfile wird ohne Namen wiederholt',
        'datei': 'src/backend-player/src/mpv-wrapper.ts',
        'alt': '          schicke(rueckfall)',
        'neu': '          void rueckfall',
        'pruefung': pruefung_abspieler('mpv-wrapper.spec.ts'),
    },
    {
        # Das Anhaengen hat den Namen bis zum 06.08.2026 nicht angefasst. Es
        # darf durch das LESEN nicht anfangen zu werfen — sonst risse ein
        # einzelnes `%` im Titel mitten in einer Sendung die Warteschlange weg.
        'name': 'f1-titelname-wirft-nicht',
        'punkt': '6',
        'worum': 'titelAusName wirft auch bei kaputter Kodierung nicht',
        'datei': 'src/backend-player/src/befehlspfad.ts',
        'alt': '  let text = roh\n  try {\n    text = decodeURIComponent(roh)\n  } catch {\n'
               '    /* unkodierbar: roh nehmen, aber nicht werfen */\n  }\n'
               "  return text.split(':title:artist:')[0]",
        'neu': "  return decodeURIComponent(roh).split(':title:artist:')[0]",
        'pruefung': pruefung_abspieler('befehlspfad.spec.ts'),
    },
    # DIE BEIDEN NAECHSTEN EINGRIFFE SIND VON ANDERER ART, und das gehoert
    # dazugesagt, damit ein Naechster nicht denkt, hier haette jemand das
    # Werkzeug missverstanden: sie stellen KEINEN frueheren Stand wieder her.
    # An mplayer-wrapper.ts hat F1 nichts geaendert — es war ja gerade die
    # Auflage, dass dort alles stehenbleibt. Zurueckgenommen werden kann also
    # nichts. Was hier eingesetzt wird, ist der FEHLGRIFF, den der Test
    # bewacht: der Titelname wird durchgereicht, statt verworfen zu werden.
    # Bleibt die Pruefung dabei gruen, bewacht sie nichts — und genau das ist
    # die Frage, die dieses Werkzeug beantwortet.
    #
    # Warum der Fehlgriff teuer waere: mplayer liest im Slave-Modus das zweite
    # Wort eines `loadfile` als Anhaenge-Schalter. Aus jedem Startbefehl wuerde
    # ein Einreihen — auf einer mplayer-Box startete nichts mehr.
    {
        'name': 'f1-mplayer-verwirft-den-namen-beim-abspielen',
        'punkt': '6',
        'worum': 'mplayers play laesst das zweite Argument folgenlos ins Leere fallen',
        'datei': 'src/backend-player/src/mplayer-wrapper.ts',
        'alt': "  const play = (fileOrUrl: string): void => exec('loadfile', [fileOrUrl])",
        'neu': "  const play = (fileOrUrl: string, titel?: string): void =>\n"
               "    exec('loadfile', titel ? [fileOrUrl, titel] : [fileOrUrl])",
        'pruefung': pruefung_abspieler('mplayer-wrapper.spec.ts'),
    },
    {
        'name': 'f1-mplayer-verwirft-den-namen-beim-anhaengen',
        'punkt': '6',
        'worum': 'mplayers queue laesst das zweite Argument folgenlos ins Leere fallen',
        'datei': 'src/backend-player/src/mplayer-wrapper.ts',
        'alt': "  const queue = (fileOrUrl: string): void => exec('loadfile', [fileOrUrl, '1'])",
        'neu': "  const queue = (fileOrUrl: string, titel?: string): void =>\n"
               "    exec('loadfile', titel ? [fileOrUrl, '1', titel] : [fileOrUrl, '1'])",
        'pruefung': pruefung_abspieler('mplayer-wrapper.spec.ts'),
    },
    # ── Punkt 7 (F6): zwei Knoepfe, gleiche Hoehe ──────────────────────────
    #
    # Bis zum 06.08.2026 gab es EINEN Knopf, der nur die Farbe wechselte. Lag
    # zu einem Album eine gemerkte Stelle vor, war er blau und setzte fort —
    # und dann fuehrte KEIN Weg mehr zum Anfang desselben Albums.
    #
    # ALLE VIER EINGRIFFE FAERBEN DEN BROWSERLAUF, nicht die Regel: Was hier
    # zu pruefen ist, sind Groessen und Lagen auf dem Schirm. Eine reine
    # Funktion, die man einzeln pruefen koennte, gibt es dafuer nicht.
    {
        'name': 'f6-leiste-entsteht',
        'punkt': '7',
        'worum': 'wahlLeisteBauen liefert die Leiste ueberhaupt',
        'datei': 'NewDesign/app.js',
        'alt': '    if (!a || !a.weiterAb) return null',
        'neu': '    if (true) return null',
        'pruefung': pruefung_e2e('GLEICHER HOEHE'),
    },
    {
        # DIE NAHT. `wahlLeisteBauen` kann tadellos bauen, ohne dass die Lane
        # sie je einhaengt — dieselbe Sorte Luecke wie beim Cover, wo
        # `folgenBildAn` stimmte und `coverAdresse` nicht fragte.
        'name': 'f6-leiste-haengt-in-der-lane',
        'punkt': '7',
        'worum': 'die Titel-Lane haengt die Leiste auch WIRKLICH ein',
        'datei': 'NewDesign/app.js',
        'alt': '    const wahl = wahlLeisteBauen(w, a, laneKachel)\n    if (wahl) tief.appendChild(wahl)\n',
        'neu': '',
        'pruefung': pruefung_e2e('GLEICHER HOEHE'),
    },
    {
        # DER GEFAEHRLICHSTE FEHLER DIESES UMBAUS: ein Knopf mit der richtigen
        # Aufschrift, der das Gegenteil tut. Ohne den Schalter findet
        # `albumSpielenAusLane` die gemerkte Stelle und spielt dort weiter —
        # „Von vorne" faenge in der Mitte an. Am Schirm ist das nicht zu sehen.
        'name': 'f6-von-vorne-faengt-vorn-an',
        'punkt': '7',
        'worum': 'der weisse Knopf schaltet die gemerkte Stelle wirklich ab',
        'datei': 'NewDesign/app.js',
        'alt': '      albumSpielenAusLane(w, a, laneKachel, true),',
        'neu': '      albumSpielenAusLane(w, a, laneKachel),',
        'pruefung': pruefung_e2e('schickt den Anfang'),
    },
    {
        # „auf gleicher hoehe" ist der ausdrueckliche Wunsch des Betreibers
        # und keine Geschmacksfrage. Er haengt an EINER Zeile im Stilblatt.
        'name': 'f6-gleiche-hoehe',
        'punkt': '7',
        'worum': 'die beiden Knoepfe stehen nebeneinander statt untereinander',
        'datei': 'NewDesign/app.css',
        'alt': '.lane-wahl {\n  display: flex;',
        'neu': '.lane-wahl {\n  display: block;',
        'pruefung': pruefung_e2e('GLEICHER HOEHE'),
    },
    {
        # 9 mm nach ISO 9241-411, im Stilblatt als `--griff` (66 px seit dem
        # 05.08.2026). Der Knopf auf dem Cover haelt sie nicht (44 px,
        # 6,16 mm) — DIESER haelt sie, und genau deshalb sitzt die Leiste dort,
        # wo Platz ist.
        #
        # DER EINGRIFF NIMMT SEIT DEM 06.08.2026 DIE VARIABLE ZURUECK, nicht
        # mehr eine nackte 64: hier stand `min-height: 64px`, und das war die
        # letzte Stelle im Stilblatt, an der die alte Marke ueberlebt hatte.
        # Der Fall dazu las die 64 ebenfalls abgeschrieben — beide waren gruen
        # und hielten eine Zahl fest, die das Haus laengst geaendert hatte.
        'name': 'f6-neun-millimeter',
        'punkt': '7',
        'worum': 'die Knoepfe der Leiste halten die 9-mm-Marke',
        'datei': 'NewDesign/app.css',
        # ZWEI ZEILEN ALS ANKER, weil `min-height: var(--griff)` seit dieser
        # Aenderung VIERMAL im Stilblatt steht — rotprobe.py verlangt (zu
        # Recht) genau einen Treffer und braeche sonst ab.
        'alt': '  min-width: 176px;\n  min-height: var(--griff);',
        'neu': '  min-width: 176px;\n  min-height: 44px;',
        'pruefung': pruefung_e2e('GLEICHER HOEHE'),
    },
    # ── E18 Stufe 2: der Ordner je Profil ──────────────────────────────────
    #
    # DIE TEUERSTE FEHLERSORTE HIER IST DIE STILLE: ein Umzug, der danebengeht,
    # macht keine Meldung — die Box startet, die Reihen sind bloss leer, und das
    # sieht aus wie „noch nichts gehoert". Jede der fuenf Nahte unten hat einen
    # Test, und hier steht, dass er ohne sie wirklich rot wird.
    {
        'name': 'bereich-verweis-zieht-nicht-mit',
        'punkt': 'E18/2',
        'worum': 'ein SYMLINK wird beim Umzug uebersprungen statt umbenannt',
        'datei': 'src/backend-api/src/server.ts',
        # AM `isFile` UND NICHT AM `isSymbolicLink`: der erste Anlauf griff die
        # Warnzeile an — und blieb GRUEN, weil `!s.isFile()` den Verweis ohnehin
        # abfing. Der Eingriff hatte also gar keine Wirkung. Genau dafuer gibt
        # es dieses Werkzeug.
        'alt': '      if (!s.isFile()) {',
        'neu': '      if (false) {',
        'pruefung': pruefung_backend('bereich.integration.spec.ts'),
    },
    {
        'name': 'bereich-juengere-form-gewinnt',
        'punkt': 'E18/2',
        'worum': 'liegen beide alten Formen da, zieht die MIT Namenszusatz um',
        'datei': 'src/backend-api/src/server.ts',
        'alt': '  const quellen = kennung === GAST ? [ablageName(basis, kennung), basis] : [ablageName(basis, kennung)]\n',
        'neu': '  const quellen = kennung === GAST ? [basis, ablageName(basis, kennung)] : [ablageName(basis, kennung)]\n',
        'pruefung': pruefung_backend('bereich.integration.spec.ts'),
    },
    {
        # Der Rueckfall ist die Naht gegen den schlimmsten Fall: der Bereich
        # laesst sich nicht anlegen (volle oder schreibgeschuetzte Karte). Ohne
        # ihn saehe eine gefuellte Box aus wie eine neue.
        'name': 'bereich-rueckfall-aufs-alte',
        'punkt': 'E18/2',
        'worum': 'gelesen wird an der alten Stelle weiter, wenn der Umzug scheiterte',
        'datei': 'src/backend-api/src/server.ts',
        'alt': '    for (const quelle of kennung === GAST ? [ablageName(basis, kennung), basis] : [ablageName(basis, kennung)]) {\n      if (fs.existsSync(quelle)) return quelle\n    }\n',
        'neu': '',
        'pruefung': pruefung_backend('bereich.integration.spec.ts'),
    },
    {
        'name': 'bereich-angelegt-beim-anlegen',
        'punkt': 'E18/2',
        'worum': 'ein neues Profil bekommt seinen Ordner beim Anlegen',
        'datei': 'src/backend-api/src/server.ts',
        'alt': '  bereicheHerrichten()\n  try {\n    await profileSchreiben()',
        'neu': '  try {\n    await profileSchreiben()',
        'pruefung': pruefung_backend('bereich.integration.spec.ts'),
    },
    {
        'name': 'bereich-listen-liegen-drin',
        'punkt': 'E18/2',
        'worum': 'die eigenen Listen werden IN den Bereich geschrieben',
        'datei': 'src/backend-api/src/server.ts',
        'alt': '  const ziel = bereichSchreibPfad(listenFile, kennung)',
        'neu': '  const ziel = listenFile',
        'pruefung': pruefung_backend('bereich.integration.spec.ts'),
    },
    # ══ E29/B6: die Zugangsdaten verschluesselt, der Akkuverlauf mit ═══════
    #
    # Hier ist der Preis eines gruenen Tests, der nichts bewacht, hoeher als
    # sonst: was diese Naehte falsch machen, faellt nicht beim Sichern auf,
    # sondern Monate spaeter beim Zurueckspielen — wenn es keinen zweiten
    # Versuch gibt.
    {
        'name': 'geheim-werte-kommen-heraus',
        'punkt': 'E29/B6',
        'worum': 'entgeheimen gibt die WERTE getrennt heraus (sonst ist der Behaelter leer)',
        'datei': 'scripts/mupibox/mupibox-sicherung.py',
        'alt': "            werte.append({\"zeiger\": z, \"stelle\": stelle, \"wert\": wert,\n"
               "                          \"datei\": im_archiv})",
        'neu': "            pass",
        'pruefung': PRUEF_SICHERUNG,
    },
    {
        # DIE GEFAEHRLICHSTE RICHTUNG: ein Wert, der in stand.json landet,
        # ist im Klartext auf der Karte — verschluesselt haette man dann gar
        # nichts, nur den Anschein davon.
        'name': 'geheim-werte-nicht-in-stand-json',
        'punkt': 'E29/B6',
        'worum': 'stand.json bekommt die Felder, aber keinen Wert',
        'datei': 'scripts/mupibox/mupibox-sicherung.py',
        'alt': "        felder.append({\"datei\": g[\"datei\"], \"zeiger\": g[\"zeiger\"],\n"
               "                       \"warum\": warum.get(schl, \"Zugangsdatum\")})",
        'neu': "        felder.append(dict(g))",
        'pruefung': PRUEF_SICHERUNG,
    },
    {
        'name': 'geheim-an-die-richtige-stelle',
        'punkt': 'E29/B6',
        'worum': 'jedes WLAN-Passwort geht an SEIN Netz zurueck, nicht der Reihe nach',
        'datei': 'scripts/mupibox/mupibox-sicherung.py',
        'alt': "                if zeiger_setzen(neu, f[\"stelle\"], f[\"wert\"]):",
        'neu': "                if zeiger_setzen(neu, f[\"zeiger\"], f[\"wert\"]):",
        'pruefung': PRUEF_SICHERUNG,
    },
    {
        'name': 'geheim-schlaegt-den-boxwert',
        'punkt': 'E29/B6',
        'worum': 'der entschluesselte Wert kommt VOR dem, was auf der Box steht',
        'datei': 'scripts/mupibox/mupibox-sicherung.py',
        'alt': "            if gesetzt:\n                eingespielt.append(",
        'neu': "            if False:\n                eingespielt.append(",
        'pruefung': PRUEF_SICHERUNG,
    },
    {
        # Ohne diese Meldung steht jemand vor einer Box, die aussieht wie
        # vorher, und sucht den WLAN-Fehler an der falschen Stelle.
        'name': 'ohne-passwort-wird-es-gesagt',
        'punkt': 'E29/B6',
        'worum': 'der Bericht nennt die verschluesselten Felder, wenn kein Passwort da war',
        'datei': 'scripts/mupibox/mupibox-sicherung.py',
        'alt': "    if zug and geheim is None:",
        'neu': "    if False:",
        'pruefung': PRUEF_SICHERUNG,
    },
    {
        'name': 'behaelter-pruefsumme-wird-geprueft',
        'punkt': 'E29/B6',
        'worum': 'der Behaelter steht nicht in `dateien` — seine sha256 wird von Hand geprueft',
        'datei': 'scripts/mupibox/mupibox-sicherung.py',
        'alt': "            if zug.get(\"sha256\") and sha(roh) != zug[\"sha256\"]:",
        'neu': "            if False:",
        'pruefung': PRUEF_SICHERUNG,
    },
    {
        # Der Ausfall, den sonst erst der Ernstfall zeigt: gnupg ist auf der
        # Box nur angeweht.
        'name': 'probe-schlaegt-ohne-gpg-alarm',
        'punkt': 'E29/B6',
        'worum': 'die woechentliche Probe faellt durch, wenn gpg fehlt und ein Behaelter da ist',
        'datei': 'scripts/mupibox/mupibox-sicherung.py',
        'alt': "        if not gpg_pfad():\n            sagen(f\"PROBE FEHLGESCHLAGEN: {kandidat} traegt \"",
        'neu': "        if False:\n            sagen(f\"PROBE FEHLGESCHLAGEN: {kandidat} traegt \"",
        'pruefung': PRUEF_SICHERUNG,
    },
    {
        # Ein Pruefer mit blindem Fleck sagt BESTANDEN. Der juengste Stand
        # ist auf einer echten Box fast immer der selbsttaetige OHNE
        # Behaelter — wer nur ihn ansieht, prueft die Verschluesselung nie.
        'name': 'probe-sucht-den-stand-mit-behaelter',
        'punkt': 'E29/B6',
        'worum': 'die Probe sucht den juengsten Stand MIT Behaelter, nicht nur den juengsten',
        'datei': 'scripts/mupibox/mupibox-sicherung.py',
        'alt': "    for kandidat in staende_lesen():",
        'neu': "    for kandidat in staende_lesen()[:1]:",
        'pruefung': PRUEF_SICHERUNG,
    },
    {
        'name': 'aead-pruefer-ist-nicht-blind',
        'punkt': 'E29/B6',
        'worum': 'ist_aead erkennt `aead 0` (nur MDC) NICHT als AEAD',
        'datei': 'scripts/mupibox/mupibox-sicherung.py',
        'alt': "        if teil.startswith(\"aead \") and teil[5:].strip() not in (\"\", \"0\"):",
        'neu': "        if teil.startswith(\"aead \"):",
        'pruefung': PRUEF_SICHERUNG,
    },
    # ── E29/B6, zweiter Teil: der Akkuverlauf geht mit ─────────────────────
    {
        'name': 'akkuverlauf-geht-mit',
        'punkt': 'E29/B6',
        'worum': 'akkuverlauf.json steht auf der Ja-Liste',
        'datei': 'scripts/mupibox/mupibox-sicherung.py',
        'alt': "        \"akkuverlauf.json\",             # die Messreihe — siehe BEIWERK",
        'neu': "",
        'pruefung': PRUEF_SICHERUNG,
    },
    {
        # GEMESSEN (.169, 05.08.2026): der Server schreibt die Reihe alle
        # zehn Minuten. Zaehlte sie in die Kennung, unterdrueckte
        # `--wenn-anders` nie mehr etwas, und das Kontingent von 10 rollte
        # durch — die folgenlosen Staende verdraengten den einen, auf den es
        # ankommt.
        'name': 'akkuverlauf-nicht-in-der-kennung',
        'punkt': 'E29/B6',
        'worum': 'die Messreihe zaehlt NICHT als Aenderung der Konfiguration',
        'datei': 'scripts/mupibox/mupibox-sicherung.py',
        'alt': "                            for d in sorted(dateien, key=lambda x: x[\"pfad\"])\n"
               "                            if d[\"pfad\"] not in BEIWERK).encode())",
        'neu': "                            for d in sorted(dateien, key=lambda x: x[\"pfad\"])"
               ").encode())",
        'pruefung': PRUEF_SICHERUNG,
    },
    {
        # Eine Messreihe darf die Sicherung der BIBLIOTHEK nicht aufhalten —
        # sonst waere aus einer Vorsichtsmassnahme ein neuer Weg geworden,
        # Daten zu verlieren.
        'name': 'messreihe-haelt-die-sicherung-nicht-auf',
        'punkt': 'E29/B6',
        'worum': 'eine leer erwischte Messreihe verhindert den Stand NICHT',
        'datei': 'scripts/mupibox/mupibox-sicherung.py',
        'alt': "                        for p in sorted(inhalte) if p not in BEIWERK) if k]",
        'neu': "                        for p in sorted(inhalte)) if k]",
        'pruefung': PRUEF_SICHERUNG,
    },
    # ══ F2: die Marke „spielt gerade" bei mpv ═══════════════════════════════
    #
    # DIESE AUFGABE IST ZWEIMAL ZU FRUEH GESCHLOSSEN WORDEN, und beide Male war
    # ein gruener Lauf schuld: tools/raster-marke-schau.mjs prueft, ob die Marke
    # sich BEWEGT, tools/lane-marke-wandert.mjs, ob sie im BAUM mitwandert.
    # Keines der beiden hat je gefragt, ob bei mpv ueberhaupt eine da ist oder
    # ob man sie sieht. Die vier Eingriffe unten sind genau die vier Naehte,
    # ueber die das hinweggegangen ist.
    {
        'name': 'f2-kennung-an-der-folgenkachel',
        'punkt': 'F2',
        'worum': 'die ARD-Folgenkachel bekommt ueberhaupt ein data-spielt',
        'datei': 'NewDesign/app.js',
        'alt': "      const kennung = stueckKennung(zush, t.uri) || folgeKennung(w && w.schluessel, t)",
        'neu': "      const kennung = stueckKennung(zush, t.uri)",
        'pruefung': pruefung_e2e('ARD-Folge'),
    },
    {
        # DIE ANDERE HAELFTE DERSELBEN NAHT: Die Kachel kann tadellos ein
        # Merkmal tragen, ohne dass `laufendeKennungen` je eines baut, das dazu
        # passt. Dann steht das Merkmal da und trifft nie — und am Schirm sieht
        # das genauso aus wie gar keins.
        'name': 'f2-kennung-beim-laufenden',
        'punkt': 'F2',
        'worum': 'laufendeKennungen baut die folge|…-Kennung des Laufenden',
        'datei': 'NewDesign/app.js',
        'alt': "    const f = laufendeFolgeJetzt(np)\n    if (f) {",
        'neu': "    const f = laufendeFolgeJetzt(np)\n    if (false) {",
        'pruefung': pruefung_e2e('ARD-Folge'),
    },
    {
        # DIE EINZIGE WACHE, DIE NEIN SAGEN KANN. Der Schluesselvergleich
        # daneben kann es nicht: beide Seiten stammen aus derselben Zuweisung
        # in `albumSpielen` (llmwiki vergleich-aus-derselben-zuweisung). Ohne
        # `passtZuLaufendem` behauptete die Marke „diese Folge laeuft", waehrend
        # laengst etwas anderes toent.
        'name': 'f2-marke-laesst-fremdes-los',
        'punkt': 'F2',
        'worum': 'laufendeFolgeJetzt prueft, ob die Liste zum Gehoerten passt',
        'datei': 'NewDesign/app.js',
        'alt': "    if (!w || laufendeFolgen.schluessel !== w.schluessel || !passtZuLaufendem(w, np)) return null",
        'neu': "    if (!w || laufendeFolgen.schluessel !== w.schluessel) return null",
        'pruefung': pruefung_e2e('ARD-Folge'),
    },
    {
        # UND MAN MUSS SIE SEHEN. Der Eingriff nimmt genau die Zeile zurueck,
        # die es tut; ohne sie steht die markierte Kachel bei Folge 7 von 14
        # rund 100 px rechts ausserhalb der Reihe — und die Marke wandert
        # voellig richtig von einer unsichtbaren Kachel zur naechsten.
        'name': 'f2-marke-rollt-heran',
        'punkt': 'F2',
        'worum': 'beim Aufklappen wird die markierte Kachel waagerecht ins Bild geholt',
        'datei': 'NewDesign/app.js',
        'alt': "      spieltMarkieren()\n      markeInsBild(reihe)",
        'neu': "      spieltMarkieren()",
        'pruefung': pruefung_e2e('ins Bild gerollt'),
    },
    {
        # DIE HALBE KENNUNG. Kaeme bei fehlender `id` eine Zeichenkette heraus,
        # waere sie gleich der jeder anderen Folge ohne Kennung — die Marke
        # saesse auf der ersten davon. Das ist die stillste Sorte Fehler in
        # dieser Datei: sie sieht aus wie eine Marke.
        'name': 'f2-halbe-kennung-trifft-nie',
        'punkt': 'F2',
        'worum': 'folgeKennung gibt nichts zurueck, wenn Schluessel oder id fehlen',
        'datei': 'NewDesign/app.js',
        'alt': "    return s && roh ? `folge|${s}|${roh}` : ''",
        'neu': "    return `folge|${s}|${roh}`",
        'pruefung': PRUEF_REGELN,
    },
    # ══ E18 Stufe 3: resume.json gehoert je Kind ════════════════════════════
    #
    # JEDER FEHLER DIESER NAHT IST STILL. Eine Box, die nichts mehr fortsetzt,
    # sieht aus wie eine Box, an der noch niemand etwas angefangen hat — HTTP
    # 200, leere Liste, kein Protokolleintrag. Die sieben Eingriffe unten sind
    # genau die Stellen, an denen das passieren kann.
    {
        'name': 'e18s3-resume-in-der-einen-liste',
        'punkt': 'E18/3',
        'worum': 'resume.json steht in BEREICH_ABLAGEN — der Liste, an der auch die Sicherung haengt',
        'datei': 'src/backend-api/src/profile.ts',
        'alt': "export const BEREICH_ABLAGEN = [ABLAGE_GESPIELT, ABLAGE_VERBRAUCH, ABLAGE_LISTEN, ABLAGE_RESUME] as const",
        'neu': "export const BEREICH_ABLAGEN = [ABLAGE_GESPIELT, ABLAGE_VERBRAUCH, ABLAGE_LISTEN] as const",
        'pruefung': pruefung_backend('profile.spec.ts'),
    },
    {
        # DAS SIEB. Es steht NICHT in weiterhoerbare() — dort ginge es ueber
        # einen Stellvertreter (den Verlauf) und loeschte Stellen, die dem Kind
        # sehr wohl gehoeren. Es steht an der QUELLE: wer aus dem Bereich liest,
        # bekommt nur, was ihm gehoert.
        'name': 'e18s3-stellen-je-kind-lesen',
        'punkt': 'E18/3',
        'worum': 'resumeStellenLesen liest den Bereich DES PROFILS, nicht immer denselben',
        'datei': 'src/backend-api/src/server.ts',
        'alt': "    const roh = JSON.parse(await fs.promises.readFile(resumeLesePfad(kennung), 'utf8'))",
        'neu': "    const roh = JSON.parse(await fs.promises.readFile(resumeLesePfad(GAST), 'utf8'))",
        'pruefung': pruefung_backend('bruecke.integration.spec.ts'),
    },
    {
        'name': 'e18s3-geschrieben-wird-in-den-bereich',
        'punkt': 'E18/3',
        'worum': 'POST /api/weiterhoeren schreibt in den Bereich, nicht an den alten Ort',
        'datei': 'src/backend-api/src/server.ts',
        'alt': "    const ziel = resumeSchreibPfad(kennung)\n    const liste = await resumeStellenLesen(kennung)",
        'neu': "    const ziel = resumeFile\n    const liste = await resumeStellenLesen(kennung)",
        'pruefung': pruefung_backend('bruecke.integration.spec.ts'),
    },
    {
        # OHNE DIE BRUECKE IST DER UMZUG BINNEN 20 SEKUNDEN ZUNICHTE:
        # get_network.sh legt am leeren alten Ort `[]` an, check_network.sh
        # haengt active_resume.json darauf, und die Box setzt nichts mehr fort.
        'name': 'e18s3-die-bruecke-wird-gelegt',
        'punkt': 'E18/3',
        'worum': 'am alten Ort bleibt ein Verweis auf den Bereich stehen',
        'datei': 'src/backend-api/src/server.ts',
        'alt': "    fs.symlinkSync(zielRel, zwischen)\n    fs.renameSync(zwischen, resumeFile)",
        'neu': "    fs.symlinkSync(zielRel, zwischen)",
        'pruefung': pruefung_backend('bruecke.integration.spec.ts'),
    },
    {
        # Der Verweis active_resume.json wird vom Server NIE angefasst — er
        # loest ueber die Bruecke auf. Bliebe die beim Profilwechsel stehen,
        # saehe die klassische Oberflaeche weiter die Stellen des vorigen Kindes.
        'name': 'e18s3-bruecke-zieht-beim-wechsel-mit',
        'punkt': 'E18/3',
        'worum': 'POST /api/profil/aktiv haengt die Bruecke um',
        'datei': 'src/backend-api/src/server.ts',
        'alt': "  resumeBrueckeRichten()\n  resumeBrueckeAuffrischen()",
        'neu': "  resumeBrueckeAuffrischen()",
        'pruefung': pruefung_backend('bruecke.integration.spec.ts'),
    },
    {
        # remove_max_resume.sh und clearresume.sh schreiben ihr Ergebnis mit
        # `mv` ueber den alten Ort und nehmen die Bruecke dabei mit (gemessen,
        # tools/resume-bruecke-probe.py). Ohne die Uebernahme waeren der Deckel
        # und „Clear all resume media" ab dem Umzug wirkungslos — lautlos.
        'name': 'e18s3-arbeit-der-skripte-hereinholen',
        'punkt': 'E18/3',
        'worum': 'eine echte Datei am alten Ort wandert in den Bereich, statt ueberschrieben zu werden',
        'datei': 'src/backend-api/src/server.ts',
        'alt': "    if (stand?.isFile()) resumeUebernehmen(ziel)",
        'neu': "    if (false && stand?.isFile()) resumeUebernehmen(ziel)",
        'pruefung': pruefung_backend('bruecke.integration.spec.ts'),
    },
    {
        # Die eine Stelle, an der die Uebernahme falsch sein KANN: `[]` ueber
        # einem vollen Bestand. clearresume.sh erzeugt das legitim, get_network.sh
        # als Stummel. Von hier aus nicht zu unterscheiden — also uebernehmen
        # UND aufheben.
        'name': 'e18s3-leerer-stummel-wird-aufgehoben',
        'punkt': 'E18/3',
        'worum': 'vor einer leeren Uebernahme wird der bisherige Bestand danebengelegt',
        'datei': 'src/backend-api/src/server.ts',
        'alt': "    if (leereListe(zwischen) && !leereListe(ziel)) fs.renameSync(ziel, `${ziel}.vorher`)",
        'neu': "    if (false) fs.renameSync(ziel, `${ziel}.vorher`)",
        'pruefung': pruefung_backend('bruecke.integration.spec.ts'),
    },
    {
        # DIE SUBTILSTE: `stat` folgt einem Verweis NICHT (GNU stat braucht -L,
        # keines der beiden Skripte gibt es an). `utimesSync` folgt ihm sehr
        # wohl — es faerbte also genau die Datei, die niemand ansieht, und die
        # Offline-Liste bliebe auf dem Stand des letzten Profilwechsels stehen.
        'name': 'e18s3-aufgefrischt-wird-der-verweis',
        'punkt': 'E18/3',
        'worum': 'lutimes auf die Bruecke, nicht utimes auf ihr Ziel',
        'datei': 'src/backend-api/src/server.ts',
        'alt': "    fs.lutimesSync(resumeFile, jetzt, jetzt)",
        'neu': "    fs.utimesSync(resumeFile, jetzt, jetzt)",
        'pruefung': pruefung_backend('bruecke.integration.spec.ts'),
    },
    # ── E18/4: die Figur des Kindes und das Zeichen oben links ─────────────
    #
    # WAS HIER STILL DANEBENGEHEN KANN: Jede dieser vier Nahten laesst die
    # Oberflaeche NORMAL AUSSEHEN, wenn sie fehlt. Ein Bild, das im Kopf
    # fehlt, sieht aus wie „das Kind hat halt keins"; ein Figurname ohne
    # Endung sieht aus wie ein Name; ein Besitzer aus dem Rumpf sieht aus wie
    # ein Wechsel, der geklappt hat.
    {
        'name': 'e18s4-figur-braucht-endung',
        'punkt': 'E18/4',
        'worum': 'ein Figurname ohne .png faellt durch (sonst: leeres Bildzeichen)',
        'datei': 'src/backend-api/src/profile.ts',
        'alt': "const FIGUR_MUSTER = /^[a-z0-9][a-z0-9._-]{0,59}\\.png$/",
        'neu': "const FIGUR_MUSTER = /^[a-z0-9][a-z0-9._-]{0,63}$/",
        'pruefung': pruefung_backend('profile.spec.ts'),
    },
    {
        'name': 'e18s4-figur-muss-es-geben',
        'punkt': 'E18/4',
        'worum': 'POST /api/profil/figur prueft, ob die DATEI da ist',
        'datei': 'src/backend-api/src/server.ts',
        'alt': "    if (!figurenLesen().figuren.includes(figur)) return res.status(400).json({ error: 'figurFehlt' })",
        'neu': "    if (false) return res.status(400).json({ error: 'figurFehlt' })",
        'pruefung': pruefung_backend('figuren.integration.spec.ts'),
    },
    {
        # DER BESITZER KOMMT VOM SERVER. Naehme die Route die Kennung aus dem
        # Rumpf, koennte ein Client das Bild eines anderen Kindes aendern —
        # und der einzige Ort, an dem man es saehe, waere dessen Kopf.
        'name': 'e18s4-besitzer-kommt-vom-server',
        'punkt': 'E18/4',
        'worum': 'die Figur trifft das AKTIVE Profil, nicht das im Rumpf genannte',
        'datei': 'src/backend-api/src/server.ts',
        'alt': "  const kennung = profilAktiv()\n  profilStand = {\n    ...profilStand,\n    profile: profilStand.profile.map((p) => (p.kennung === kennung ? { ...p, figur } : p)),",
        'neu': "  const kennung = String((req.body as { kennung?: unknown })?.kennung ?? profilAktiv())\n  profilStand = {\n    ...profilStand,\n    profile: profilStand.profile.map((p) => (p.kennung === kennung ? { ...p, figur } : p)),",
        'pruefung': pruefung_backend('figuren.integration.spec.ts'),
    },
    {
        # EIN UNTERVERZEICHNIS `mixpi-alt.png` kaeme durch `figurPruefen` glatt
        # durch — im Browser ergaebe es ein leeres Bild.
        'name': 'e18s4-nur-dateien-sind-figuren',
        'punkt': 'E18/4',
        'worum': 'ein Verzeichnis mit gueltigem Namen zaehlt nicht als Figur',
        'datei': 'src/backend-api/src/server.ts',
        'alt': "    if (!istDatei) continue",
        'neu': "    if (false) continue",
        'pruefung': pruefung_backend('figuren.integration.spec.ts'),
    },
    {
        # DIE AUSWAHL LIEGT UEBER ALLEM. Faellt diese Zeile weg, schliesst ein
        # Tipp auf den Rueckweg den Eltern-Bereich, WAEHREND die Auswahl noch
        # darauf liegt — und der Schirm sieht dabei richtig aus.
        'name': 'e18s4-auswahl-liegt-oben',
        'punkt': 'E18/4',
        'worum': 'der Rueckweg schliesst die Auswahl „wer hoert" zuerst',
        'datei': 'NewDesign/app.js',
        'alt': "    if (lage.ichFenster) return 'ich'",
        'neu': "    if (false) return 'ich'",
        'pruefung': PRUEF_REGELN,
    },
    {
        # DIE WANDERUNG: die laufende Box antwortet heute (05.08.2026) mit
        # `figur: "mixpi-hoert.png"` — dem Vorgabewert der alten Fassung, als
        # die Bilder noch direkt in `bilder/` lagen. Ohne diese Zeile stuende
        # der tote Name weiter in der Antwort, und der Browser holte bei jedem
        # Laden eine 404. Der Eingriff nimmt genau die Aussortierung zurueck.
        'name': 'e18s4-tote-figur-wird-verschwiegen',
        'punkt': 'E18/4',
        'worum': 'GET /api/profile nennt keine Figur, zu der es keine Datei gibt',
        'datei': 'src/backend-api/src/server.ts',
        'alt': 'p.figur && !da.has(p.figur)',
        'neu': 'false && p.figur && !da.has(p.figur)',
        'pruefung': pruefung_backend('figuren.integration.spec.ts'),
    },
    # ── E18/4, Nachtrag: das Bild kommt nach OBEN LINKS ────────────────────
    #
    # DER BERICHTIGTE WUNSCH (Betreiber, 05.08.2026): „ich wollte niemals die
    # mixpi figur unten links, ich wollte sie oben links, schon vorbereitend
    # fuer den platz des bildes."
    #
    # BEIDE EINGRIFFE FAERBEN DENSELBEN LEERFALL, und der ist die stille
    # Stelle der ganzen Aenderung: Ein Kind, das sich nichts ausgesucht hat,
    # kommt beim Server als LEER an. Ob dann ein MixPi oder eine Silhouette
    # dasteht, entscheidet allein die Oberflaeche — und beide Ausgaenge sehen
    # aus wie eine Absicht. Ohne diese Pruefungen faellt weder das eine noch
    # das andere je auf.
    {
        'name': 'e18s4-vorgabe-ist-das-mixpi',
        'punkt': 'E18/4',
        'worum': '„kein Bild gewaehlt" zeigt oben links das Standardbild, nicht nichts',
        'datei': 'NewDesign/app.js',
        'alt': "    return 'bilder/mixpi-hoert.png'\n  }",
        'neu': "    return ''\n  }",
        'pruefung': PRUEF_REGELN,
    },
    {
        # DIE ANDERE HAELFTE, und sie ist die heimtueckischere: Ein Pfad DURCH
        # den Figurenordner ist syntaktisch tadellos und ergibt eine 404 —
        # `bilder/figuren/mixpi-hoert.png` gibt es nicht. Am Schirm sieht die
        # 404 aus wie „kein Bild gewaehlt", also wie der Zustand davor.
        # Genau diese Falle steht im Wissenspaket unter
        # [[vorgabewert-ueberlebt-den-umzug-seines-ordners]].
        'name': 'e18s4-vorgabe-nicht-im-figurenordner',
        'punkt': 'E18/4',
        'worum': 'die Vorgabe laeuft NICHT durch `profil.ordner` — dort liegt sie nicht',
        'datei': 'NewDesign/app.js',
        'alt': "  function ichBildPfad(figur, ordner) {\n    if (typeof figur === 'string' && figur) {",
        'neu': "  function ichBildPfad(figur, ordner) {\n    if (true) {\n      figur = typeof figur === 'string' && figur ? figur : 'mixpi-hoert.png'",
        'pruefung': PRUEF_REGELN,
    },
    {
        # DER RUECKWEG IN DEN ALTEN ZUSTAND, und er ist der wahrscheinlichste
        # von allen: Ein spaeterer Leser sieht ein Wappen ohne Bild, haelt es
        # fuer eine Luecke und setzt das <img> wieder hinein. Danach stehen
        # zwei MixPis auf einem Schirm — und das sieht am Bildschirm nicht
        # nach einem Fehler aus, sondern nach Gestaltung.
        'name': 'e18s4-kein-bild-mehr-im-wappen',
        'punkt': 'E18/4',
        'worum': 'das Wappen unten links traegt KEIN Bild mehr — es steht oben links',
        'datei': 'NewDesign/index.html',
        'alt': '      <!-- DER NAME KOMMT AUS `mupibox.host`, NIE AUS EINER KONSTANTEN.',
        'neu': '      <img class="wappen-bild" id="wappen-bild" src="bilder/mixpi-hoert.png" alt="" width="44" height="44">\n'
               '      <!-- DER NAME KOMMT AUS `mupibox.host`, NIE AUS EINER KONSTANTEN.',
        'pruefung': pruefung_e2e('KEIN Bild im Wappen'),
    },
    {
        # DIE GEGENMASSNAHME, OHNE DIE DIE AENDERUNG SCHADET. Das Bild aus dem
        # Wappen zu nehmen macht es 46 px kuerzer; mit `safe center` teilt die
        # Kategorienliste diesen Zugewinn auf beide Seiten und schiebt alle
        # vier Knoepfe 23 px nach unten — in die runde Backe des
        # Lautstaerke-Kissens. GEMESSEN (tools/beruehrziele-neu.mjs, eigener
        # Debug-Port): „Radio" faellt von 7,56 auf 5,60 mm.
        #
        # UND DIE ANZAHL VERRAET ES NICHT: 22 von 193 zu kleinen Zielen,
        # vorher wie nachher. Wer zwei Laeufe an ihrer Schlusszahl vergleicht,
        # laesst diesen Fall durch. Genau deshalb misst der Fall den ABSTAND
        # und nicht die Bilanz.
        'name': 'e18s4-kategorien-bleiben-oben',
        'punkt': 'E18/4',
        'worum': 'die 46 px aus dem Wappen liegen UNTEN, sie schieben die Kategorien nicht nach unten',
        'datei': 'NewDesign/app.css',
        'alt': '  justify-content: flex-start;\n  gap: 6px;\n  overflow-y: auto;',
        'neu': '  justify-content: safe center;\n  gap: 6px;\n  overflow-y: auto;',
        'pruefung': pruefung_e2e('KEIN Bild im Wappen'),
    },
    {
        # DIE DRITTE STELLE, an der der Leerfall gezeichnet wird — und die
        # einzige, die am 05.08.2026 vergessen wurde. Die Reihe „Wer hoert?"
        # zeichnete mit `figurPfad`, also mit dem LEEREN Pfad, also mit der
        # Silhouette, waehrend 200 px daneben oben links das MixPi stand.
        # Fuer EIN UND DASSELBE KIND standen damit zwei verschiedene Koepfe
        # gleichzeitig auf dem Schirm (das Fenster deckt nur mit 42 % ab).
        #
        # WARUM DER EINGRIFF DER RUECKWEG IST, DEN JEMAND WIRKLICH GEHT: Die
        # Zeile sieht mit `figurPfad` voellig richtig aus — daneben, in
        # derselben Funktion, steht `figurPfad` fuer das Figurengitter zu
        # Recht. Wer die beiden angleicht, weil sie sich aehneln, stellt den
        # Fehler wieder her.
        'name': 'e18s4-profilreihe-zeigt-die-vorgabe',
        'punkt': 'E18/4',
        'worum': 'die Profilreihe zeichnet den Leerfall wie das Zeichen oben links, nicht als Silhouette',
        'datei': 'NewDesign/app.js',
        'alt': 'const k = ichKachel(ichBildPfad(p.figur, profil.ordner), p.name || p.kennung, p.kennung === profil.aktiv)',
        'neu': 'const k = ichKachel(figurPfad(p.figur), p.name || p.kennung, p.kennung === profil.aktiv)',
        'pruefung': pruefung_e2e('die Profilreihe zeigt dasselbe'),
    },
    # ══ E31/P1: DAS TOR VOR DEM ELTERN-BEREICH ═══════════════════════════════
    #
    # WARUM DIESE SORTE HIER BESONDERS HINGEHOERT: Eine Sperre, die nicht mehr
    # sperrt, sieht am Bildschirm EXAKT so aus wie eine, die niemand
    # eingeschaltet hat. Es gibt keinen Bildfehler, keine Meldung, keine
    # Verzoegerung — es geht nur eine Tuer auf, hinter der WLAN, Bluetooth, die
    # rohe Mediendatenbank samt Loeschknoepfen und das Herunterfahren liegen.
    # Jeder Eingriff unten ist ein Rueckweg, den jemand wirklich geht: dreimal
    # ist es woertlich der Stand von vor dem 06.08.2026.
    {
        # DER TEUERSTE EINGRIFF DER GANZEN GRUPPE, und der unauffaelligste:
        # eine einzige Zeichenkette. Vorher stand hier „aus", und weil auf
        # jeder Box, deren Konfiguration aelter ist als das Feld, genau dieser
        # Schluessel FEHLT, stand der Eltern-Bereich dort offen. An der Box
        # .169 nachgesehen (06.08.2026): er fehlt wirklich.
        'name': 'sperre-vorgabe-ist-rechnen',
        'punkt': 'E31/P1',
        'worum': 'ein fehlender Schluessel heisst „rechnen" und nicht mehr „aus"',
        'datei': 'NewDesign/app.js',
        'alt': "    if (SPERR_ARTEN.includes(w)) return w",
        'neu': "    if (SPERR_ARTEN.includes(w)) return w\n    if (true) return 'aus'",
        'pruefung': PRUEF_REGELN,
    },
    {
        # DIE GEGENPROBE ZUR VORGABE. „aus" muss ankommen, wenn es dasteht —
        # sonst haette der Betreiber, der die Sperre bewusst abgeschaltet hat,
        # sie beim naechsten Update wieder. Eine Sperre, die den Willen des
        # Benutzers ueberschreibt, wird abgeschaltet, und dann ist sie ganz weg.
        'name': 'sperre-aus-gewinnt-weiterhin',
        'punkt': 'E31/P1',
        'worum': 'ein ausdrueckliches „aus" schlaegt die neue Vorgabe',
        'datei': 'NewDesign/app.js',
        'alt': "  const SPERR_ARTEN = ['aus', 'rechnen', 'pin', 'geste']",
        'neu': "  const SPERR_ARTEN = ['rechnen', 'pin', 'geste']",
        'pruefung': PRUEF_REGELN,
    },
    {
        # DIE ANZEIGE DES BOARDS MUSS ZUR BOX PASSEN. Dieser `standard` wird
        # NUR von feldNachAussen eingesetzt, also nur auf dem Weg
        # GET /api/konfiguration — die Box liest GET /api/config und sieht ihn
        # nie. Stuende hier „aus", waehrend `sperrModus` „rechnen" tut,
        # behauptete das Board „jeder kommt hinein" ueber eine Box, die
        # nachfragt. Der umgekehrte Fehler war der Stand bis zum 06.08.2026.
        'name': 'sperre-standard-zieht-mit',
        'punkt': 'E31/P1',
        'worum': 'das Board zeigt bei fehlendem Schluessel dasselbe, was die Box tut',
        'datei': 'src/backend-api/src/konfiguration.ts',
        'alt': "    standard: 'rechnen',",
        'neu': "    standard: 'aus',",
        'pruefung': pruefung_backend('konfiguration.spec.ts'),
    },
    {
        # DIE EINZIGE STELLE, DIE ÜBER EINE FRISCHE BOX ENTSCHEIDET. autosetup
        # schiebt diese Vorlage an die Stelle der Konfiguration; ein gesetzter
        # Wert gewinnt gegen jeden `standard` und gegen jede Ruecknahme beim
        # Lesen. Wer nur konfiguration.ts und app.js aendert, hat den Satz des
        # Betreibers („eine frische Box darf nicht offen stehen") nicht
        # beruehrt — und merkt es nie, weil beide Boxen, die er hat, alt sind.
        'name': 'sperre-vorlage-schliesst-die-frische-box',
        'punkt': 'E31/P1',
        'worum': 'die Installationsvorlage schreibt eine geschlossene Sperre aus',
        'datei': 'config/templates/mupiboxconfig.json',
        'alt': '"einstellungssperre": "rechnen",',
        'neu': '"einstellungssperre": "aus",',
        'pruefung': pruefung_backend('konfiguration.spec.ts'),
    },
    {
        # DIE GESTE ALS VIERTE STUFE. Faellt sie aus der Auswahl, laesst sich
        # „geste" in der Verwaltung nicht mehr WAEHLEN — die Box wuerde einen
        # Wert lesen, den das Board nicht kennt, und die Sorte waere ein
        # Geheimnis fuer alle ausser dem, der die Datei von Hand schreibt.
        'name': 'sperre-geste-ist-waehlbar',
        'punkt': 'E31/P1',
        'worum': 'die Geste steht in der Auswahl der Verwaltung',
        'datei': 'src/backend-api/src/konfiguration.ts',
        'alt': "      { wert: 'geste', titel: 'Geste — vier Ecken im Uhrzeigersinn (nur neue Oberfläche)' },",
        'neu': '',
        'pruefung': pruefung_backend('konfiguration.spec.ts'),
    },
    {
        # DER HINWEIS IST DIE EINZIGE STELLE, AN DER DIE GESTE STEHT. Der
        # Bildschirm der Box sagt mit Absicht nur, DASS eine Geste noetig ist
        # und WO sie beschrieben ist. Faellt die Beschreibung hier weg, ist die
        # Sorte „geste" fuer den zweiten Elternteil eine Aussperrung — und
        # zwar eine, die niemandem auffaellt, weil das Feld weiter waehlbar
        # ist und die Box weiter richtig sperrt.
        'name': 'sperre-geste-steht-im-hinweis',
        'punkt': 'E31/P1',
        'worum': 'der Hinweis erklaert die Geste vollstaendig — Richtung, Anfang, Zeitgrenze',
        'datei': 'src/backend-api/src/konfiguration.ts',
        'alt': "      'im Uhrzeigersinn beginnend links oben — links oben, rechts oben, rechts unten, links ' +",
        'neu': "      'so, wie es die Anleitung beschreibt. ' +",
        'pruefung': pruefung_backend('konfiguration.spec.ts'),
    },
    {
        # OHNE DIE ZEITGRENZE ist die Geste keine Folge mehr, sondern eine
        # Sammlung: vier ueber den Nachmittag verteilte Zufallstreffer zaehlen
        # dann zusammen. Genau das erzeugt ein Kind, das auf allem
        # herumdrueckt — der Fall, gegen den die Geste gebaut ist.
        'name': 'geste-hat-ein-zeitfenster',
        'punkt': 'E31/P1',
        'worum': 'zwischen zwei Ecken duerfen hoechstens vier Sekunden liegen',
        'datei': 'NewDesign/app.js',
        'alt': '    const rechtzeitig = s === 0 || Number(jetzt) - Number(zuletzt) <= Number(fensterMs)',
        'neu': '    const rechtzeitig = true',
        'pruefung': PRUEF_REGELN,
    },
    {
        # OHNE DEN RUECKSETZER IST DIE REIHENFOLGE NUR EINE EMPFEHLUNG. Vier
        # Tipps in die Ecken in beliebiger Folge oeffneten den Bereich, und die
        # Geste waere keine Huerde mehr, sondern eine Verzierung — sichtbar
        # gleich, wirksam nicht.
        'name': 'geste-falsche-ecke-setzt-zurueck',
        'punkt': 'E31/P1',
        'worum': 'die falsche Ecke setzt die Folge zurueck',
        'datei': 'NewDesign/app.js',
        'alt': '    return { stand: e === 0 ? 1 : 0, offen: false }',
        'neu': '    return { stand: s, offen: false }',
        'pruefung': PRUEF_REGELN,
    },
    {
        # DIE ECKEN DUERFEN NICHT DIE HALBE FLAECHE SEIN. Ohne den Deckel auf
        # der Kante ueberlappten sie sich auf schmalen Flaechen, und mit einer
        # grossen Kante traefe Herumtippen sie staendig. Der Eingriff nimmt den
        # Deckel weg — die reine Regel merkt es, weil dann ein Punkt in zwei
        # Ecken zugleich laege.
        'name': 'geste-ecken-ueberlappen-nicht',
        'punkt': 'E31/P1',
        'worum': 'die Eckenkante wird auf die halbe Flaeche gedeckelt',
        'datei': 'NewDesign/app.js',
        'alt': '    const k = Math.max(1, Math.min(Number(kante) || 0, Math.floor(b / 2), Math.floor(h / 2)))',
        'neu': '    const k = Math.max(1, Number(kante) || 0)',
        'pruefung': PRUEF_REGELN,
    },
    # ══ E31/P3: DIE 2-mm-MARKE AUF DEN ELTERN-SCHIRMEN ═══════════════════════
    #
    # DIESE DREI FAERBEN EINEN BROWSERLAUF, nicht eine Regel. Was hier
    # kaputtgeht, ist in keiner Datei zu lesen: ein `gap` ist eine Zahl, und ob
    # aus ihr 2 mm werden, entscheidet die Anordnung ringsum.
    # tools/eltern-masse-messen.mjs startet SEINE EIGENE Vorschau auf einem
    # freien Port — ohne das maesse es die Arbeitskopie NICHT, sondern den Baum
    # dessen, der gerade eine Vorschau laufen hat.
    {
        # 6 px = 0,84 mm zwischen zwei .fach-knopf — der engste Abstand dieses
        # Bildschirms, an der Stelle, an der ein Erwachsener im Stehen mit
        # einem Kind auf dem Arm zielt.
        'name': 'eltern-faecher-halten-zwei-millimeter',
        'punkt': 'E31/P3',
        'worum': 'zwischen zwei Faechern liegen 2 mm, nicht 0,84',
        'datei': 'NewDesign/app.css',
        'alt': '  flex-direction: column;\n  gap: 15px;\n  overflow-y: auto;',
        'neu': '  flex-direction: column;\n  gap: 6px;\n  overflow-y: auto;',
        'pruefung': PRUEF_ELTERN_MASSE,
    },
    {
        # DAS ZWEITE PAAR UNTER 2 mm, und es kommt NICHT vom `gap` der Spalte:
        # „Suchen" im Fachkopf und „Verbinden" in der ersten Zeile. Wer nur die
        # Spalte aufmacht, hat den engsten Abstand verschoben und die Marke
        # nicht erreicht — dieser Eingriff ist der Beweis, dass der Pruefschritt
        # das merkt.
        'name': 'fachkopf-haelt-abstand-zur-ersten-zeile',
        'punkt': 'E31/P3',
        'worum': '„Suchen" und „Verbinden" stehen 2 mm auseinander',
        'datei': 'NewDesign/app.css',
        'alt': '  height: var(--griff);\n  margin-bottom: 9px;',
        'neu': '  height: var(--griff);',
        'pruefung': PRUEF_ELTERN_MASSE,
    },
    {
        # DAS TASTENFELD DES TORS: fuenfzehn Tastenpaare lagen 1,12 mm
        # auseinander. Zwei davon sind verschieden gefaehrlich — „Letzte Ziffer
        # loeschen" und „0" standen nebeneinander.
        'name': 'tor-tasten-halten-zwei-millimeter',
        'punkt': 'E31/P3',
        'worum': 'die Tasten des Tors stehen 2 mm auseinander',
        'datei': 'NewDesign/app.css',
        'alt': '  grid-template-columns: repeat(3, 84px);\n  gap: 16px;',
        'neu': '  grid-template-columns: repeat(3, 84px);\n  gap: 8px;',
        'pruefung': PRUEF_ELTERN_MASSE,
    },
    {
        # UND DIE VIER PIXEL, AN DENEN DAS FUENFTE FACH HAENGT. Mit
        # `padding-bottom: 12px` traegt die Spalte bei `gap: 15px` nur noch
        # vier Faecher; das fuenfte ist um 4 px angeschnitten. Der Pruefschritt
        # laeuft dafuer mit `--faecher 5` — ohne diesen Schalter waere der
        # Eingriff unsichtbar, weil heute genau vier Faecher dastehen.
        'name': 'eltern-polster-traegt-das-fuenfte-fach',
        'punkt': 'E31/P3',
        'worum': 'die Faecherspalte rollt auch mit fuenf Faechern nicht',
        'datei': 'NewDesign/app.css',
        'alt': '  padding: 0 16px 8px;',
        'neu': '  padding: 0 16px 12px;',
        'pruefung': PRUEF_ELTERN_MASSE_5,
    },
    {
        # DAS ZIFFERNFELD IN DER SORTE „geste" MUSS WEG SEIN, nicht unsichtbar.
        # `display: grid` schlaegt das `hidden`-Merkmal: ohne diese eine Zeile
        # im Stilblatt setzt app.js `hidden = true`, der Bildschirm sieht
        # richtig aus — und zwoelf Tasten sind weiter bedienbar. Nur ein
        # Browserlauf sieht den Unterschied.
        'name': 'geste-ziffernfeld-ist-wirklich-weg',
        'punkt': 'E31/P1',
        'worum': 'in der Sorte „geste" ist das Ziffernfeld aus dem Baum, nicht nur unsichtbar',
        'datei': 'NewDesign/app.css',
        'alt': '.tor-feld[hidden] { display: none; }',
        'neu': '',
        'pruefung': PRUEF_ELTERN_TOR,
    },
    {
        # DER ZUHOERER SELBST. Alle Regeln koennen stimmen, waehrend die Geste
        # gar nicht verdrahtet ist — dann steht das Tor fuer immer, und der
        # Eltern-Bereich ist von der Box aus unerreichbar. Das ist der
        # gefaehrlichste Ausfall dieser Gruppe, und die einzige Pruefung, die
        # ihn sieht, ist die, die wirklich tippt.
        'name': 'geste-ist-am-tor-verdrahtet',
        'punkt': 'E31/P1',
        'worum': 'die vier Ecken oeffnen den Bereich wirklich',
        'datei': 'NewDesign/app.js',
        'alt': "    eltern.gesteTipp(e.clientX - r.left, e.clientY - r.top, r.width, r.height, Date.now())",
        'neu': "    void r",
        'pruefung': PRUEF_ELTERN_TOR,
    },
    # ══ E31/P1, ZWEITER DURCHGANG: DIE SICHT DES KINDES ══════════════════════
    #
    # Die Eingriffe oben pruefen, ob das Tor STEHT und ob die richtige Loesung
    # es fallen laesst — die Sicht dessen, der die Loesung kennt. Die drei hier
    # pruefen die andere: was es kostet, ohne die Loesung hineinzukommen. Alle
    # drei Zustaende, die sie wiederherstellen, waren am 06.08.2026 der
    # ausgelieferte Stand, und alle drei sahen am Bildschirm vollkommen richtig
    # aus.
    {
        # DER TEUERSTE DER DREI. Er nimmt keine Sperre weg — er stellt nur den
        # zweiten Weg wieder her, der nie durch sie fuehrte: EIN kurzer Tipp
        # aufs Zahnrad, und man ist in `/settings` der alten Oberflaeche. Deren
        # eigener Waechter liest einen FEHLENDEN Schluessel als „aus", also
        # ausgerechnet auf den Boxen, um derentwillen die Vorgabe geaendert
        # wurde. Gemessen mit tools/kind-am-tor.mjs: an allen vier Sperren
        # vorbei, mit einer Beruehrung.
        'name': 'kurzer-tipp-geht-nicht-am-tor-vorbei',
        'punkt': 'E31/P1',
        'worum': 'auch der kurze Tipp aufs Zahnrad und aufs Bluetooth-Zeichen fuehrt durch das Tor',
        'datei': 'NewDesign/app.js',
        'alt': "    if (modus === 'aus') return andereOberflaeche(pfad)",
        'neu': "    if (true) return andereOberflaeche(pfad)",
        'pruefung': PRUEF_KIND,
    },
    {
        # OHNE BREMSE IST DIE RECHENAUFGABE IN SEKUNDEN OFFEN. Gemessen 2,55
        # Versuche je Sekunde, und geraten werden muss auch nicht: 49 Paare
        # ergeben nur 26 Ergebnisse, die 24 kommt viermal vor. Wer stur 24
        # tippt, ist im Mittel beim zwoelften Versuch drin. Der Eingriff setzt
        # alle Wartezeiten auf null — die Sperre sieht danach Zeichen fuer
        # Zeichen gleich aus.
        'name': 'rechenaufgabe-hat-eine-bremse',
        'punkt': 'E31/P1',
        'worum': 'nach dem ersten Fehlversuch wartet das Tor, und die Wartezeit waechst',
        'datei': 'NewDesign/app.js',
        'alt': '  const TOR_WARTEN_S = [0, 5, 15, 30, 60]',
        'neu': '  const TOR_WARTEN_S = [0, 0, 0, 0, 0]',
        'pruefung': PRUEF_KIND,
    },
    {
        # DIE ANZEIGE DARF NICHT VERRATEN, OB EIN SCHRITT RICHTIG WAR. Stand
        # dort der Fortschritt, wurde aus einer Folge, die man raten muss, ein
        # Warm-Kalt-Spiel, das man ertastet: gemessen 107 Beruehrungen bis der
        # Bereich offen stand, gegenueber 1:180 000 fuer blindes Tippen. Der
        # Eingriff stellt genau diese eine Zahl zurueck.
        'name': 'geste-verraet-den-fortschritt-nicht',
        'punkt': 'E31/P1',
        'worum': 'die Punkte am Schirm zaehlen Beruehrungen, nicht richtige Ecken',
        'datei': 'NewDesign/app.js',
        'alt': "        '●'.repeat(this.gesteTipps) + '–'.repeat(GESTE_ECKEN - this.gesteTipps)",
        'neu': "        '●'.repeat(this.gesteStand) + '–'.repeat(GESTE_ECKEN - this.gesteStand)",
        'pruefung': PRUEF_KIND,
    },
    {
        # DIE GESTE BRAUCHT EINE EIGENE BREMSE, und der Grund ist nicht die
        # Zahl der Moeglichkeiten, sondern die Zahl der Versuche je Minute.
        # „1 : 180 000" gilt fuer gleichverteiltes Tippen. Ein Kind, das
        # gemerkt hat, dass es auf die ECKEN ankommt — mehr muss es nicht
        # gemerkt haben —, hat 4^4 = 256 Folgen vor sich; gemessen ging das Tor
        # in einem Lauf nach 150 Beruehrungen auf, also nach zwei Minuten. Der
        # Eingriff macht alle Beruehrungen wieder frei.
        'name': 'geste-hat-eine-bremse',
        'punkt': 'E31/P1',
        'worum': 'auch das Kind, das nur in die Ecken tippt, wird gebremst',
        'datei': 'NewDesign/app.js',
        'alt': '    if (n <= GESTE_FREI) return 0',
        'neu': '    if (true) return 0',
        'pruefung': PRUEF_KIND,
    },
    # ══ E31/P3, DIE FORM: EIN FEHLSCHLAG MUSS WIE EINER AUSSEHEN ═════════════
    #
    # Die drei Eingriffe hier haengen zusammen und sind es wert, zusammen
    # gelesen zu werden. Der Reihe nach:
    #
    #   1. Die Vorschau verschluckte den Statuscode: `res.statusCode = 503`
    #      und dann `jsonAus(res, …)` ohne dritten Wert — die Vorgabe 200 hat
    #      ihn ueberschrieben. `bt-suche-kaputt` liess sich also STELLEN, aber
    #      nicht ERLEBEN; die Suche gelang bei jeder Messung.
    #   2. Weil dieser Fall nie am Schirm stand, fiel nicht auf, dass die
    #      Meldezeile des Faches „Die Suche ist fehlgeschlagen." in genau
    #      derselben grauen Farbe zeigte wie die Auskunft „Suche läuft …".
    #      Das Tor auf DEMSELBEN Bildschirm faerbt jeden Fehlschlag rot.
    #
    # EIN FEHLER IN DER ATTRAPPE HAT EINEN FEHLER IN DER OBERFLAECHE VERDECKT.
    # Deshalb steht die Attrappe hier mit in der Rotprobe: Der erste Eingriff
    # prueft nicht die Box, sondern das Messgeraet.
    {
        'name': 'vorschau-gibt-den-status-wirklich-heraus',
        'punkt': 'E31/P3',
        'worum': 'die Lage „die Suche misslingt" antwortet auch wirklich mit 503',
        'datei': 'tools/neu-vorschau.mjs',
        'alt': "      return jsonAus(res, { ok: false, error: 'Die Suche ist fehlgeschlagen', grund: 'kein Adapter' }, 503)",
        'neu': "      return jsonAus(res, { ok: false, error: 'Die Suche ist fehlgeschlagen', grund: 'kein Adapter' })",
        'pruefung': PRUEF_ELTERN_FORM_KAPUTT,
    },
    {
        # DIE KLASSE ALLEIN IST KEINE REPARATUR. Ohne Regel im Stilblatt haengt
        # sie am Element und aendert nichts — deshalb misst das Werkzeug die
        # FARBE und nicht die Klasse, und deshalb faerbt dieser Eingriff rot.
        'name': 'fehlschlag-im-fach-ist-abgesetzt',
        'punkt': 'E31/P3',
        'worum': 'die Meldezeile des Faches hat fuer den Fehlschlag eine eigene Farbe',
        'datei': 'NewDesign/app.css',
        'alt': '.fach-hinweis.falsch { color: #c4392a; }',
        'neu': '.fach-hinweis.falsch { color: var(--muted); }',
        'pruefung': PRUEF_ELTERN_FORM_KAPUTT,
    },
    {
        'name': 'fehlschlag-im-fach-wird-erkannt',
        'punkt': 'E31/P3',
        'worum': 'app.js unterscheidet ueberhaupt zwischen Auskunft und Fehlschlag',
        'datei': 'NewDesign/app.js',
        'alt': "      hin.classList.toggle('falsch', this.meldung !== '' && !this.meldungRuhig)",
        'neu': "      hin.classList.toggle('falsch', false)",
        'pruefung': PRUEF_ELTERN_FORM_KAPUTT,
    },
    {
        # DIE ZWEITE ANTWORT AUF DIESELBE FRAGE. `sperrModus` in der neuen
        # Oberflaeche und `alsModus` hier lesen denselben Schluessel; bis zum
        # 06.08.2026 gaben sie nach der Reparatur VERSCHIEDENE Antworten. Und
        # weil die neue Oberflaeche fuer WLAN, Anzeige und System an die
        # klassische UEBERGIBT, waere die Sperre genau dort weg gewesen, wo sie
        # etwas schuetzt ([[drei-orte-eine-anzeige]]).
        'name': 'sperre-klassisch-faellt-auf-rechnen',
        'punkt': 'E31/P1',
        'worum': 'auch die klassische Oberflaeche liest einen fehlenden Schluessel als „rechnen"',
        'datei': 'src/frontend-box/src/app/einstellungssperre/sperrlogik.ts',
        'alt': "  if (w === 'aus' || w === 'rechnen' || w === 'pin') return w\n  return 'rechnen'",
        'neu': "  if (w === 'rechnen' || w === 'pin') return w\n  return 'aus'",
        'pruefung': pruefung_box_rein('einstellungssperre/sperrlogik.spec.ts'),
    },
    {
        # DER ORT, DER DIE REPARATUR SONST WIEDER AUFHEBT. conf_update.sh
        # laeuft bei JEDEM Update und schreibt einen AUSDRUECKLICHEN Wert in
        # genau die Boxen, denen der Schluessel fehlt. Ein ausdrueckliches
        # „aus" gewinnt zu Recht gegen jede Ruecknahme beim Lesen — die
        # Leseseite allein haette also bis zum naechsten Update gehalten.
        #
        # GEPRUEFT WIRD MIT DEM WERKZEUG, DAS DAS SKRIPT WIRKLICH AUSFUEHRT:
        # konfig-umzug-probe.py baut eine alte Box nach, laesst conf_update.sh
        # darauf laufen und vergleicht das Ergebnis mit FELDER.standard aus
        # konfiguration.ts. Ein Auseinanderlaufen ist ein Befund, und ein
        # Befund ist Exitcode 1.
        'name': 'sperre-update-zementiert-nicht-mehr-aus',
        'punkt': 'E31/P1',
        'worum': 'das Update schreibt „rechnen" in Boxen ohne den Schluessel, nicht „aus"',
        'datei': 'update/conf_update.sh',
        'alt': '\t/usr/bin/cat <<< $(/usr/bin/jq --arg v "rechnen" \'.mupibox.einstellungssperre = $v\' ${CONFIG}) >  ${CONFIG}',
        'neu': '\t/usr/bin/cat <<< $(/usr/bin/jq --arg v "aus" \'.mupibox.einstellungssperre = $v\' ${CONFIG}) >  ${CONFIG}',
        'pruefung': {'cwd': '.', 'argv': ['python3', 'tools/konfig-umzug-probe.py'], 'umgebung': {}},
    },

    # ══ E31/P3: DER ELTERN-BEREICH IST EINE SEITE GEWORDEN (06.08.2026) ══════
    #
    # Der Betreiber hat entschieden, nachdem er drei Bildschirmfotos gesehen
    # hatte: „ich finde den entwurf gut wo nicht alles zu gedeckt ist". Aus dem
    # Deckel (`inset: 0`) wurde eine Seite neben der Kategorienleiste, mit einem
    # Kissen, das einfaehrt statt zu verschwinden.
    #
    # WAS DIESE GRUPPE BEWACHT, ist nicht die Form — die sieht man. Es sind die
    # ZEHN Zahlen und Zeilen, die die Form erst tragbar machen und die alle
    # einzeln wegfallen koennen, ohne dass am Bildschirm etwas fehlt: ein
    # Kissen, das tot statt bedienbar ist; ein Fenster, das hinter dem Bereich
    # aufgeht; eine Ecke der Geste, die um ein Drittel leichter zu treffen ist.
    {
        # DIE FORM SELBST. Ohne sie ist der Bereich wieder ein Deckel — die
        # Leiste ist zugedeckt, das Kissen auch, und die drei Bedingungen des
        # Auftrags sind gar nicht mehr gestellt.
        'name': 'eltern-ist-eine-seite-kein-deckel',
        'punkt': 'E31/P3',
        'worum': 'der Eltern-Bereich beginnt bei x 88 und laesst die Leiste stehen',
        'datei': 'NewDesign/app.css',
        'alt': '  inset: 0 0 0 var(--eltern-links);',
        'neu': '  inset: 0;',
        'pruefung': PRUEF_ELTERN_SEITE,
    },
    {
        # DAS KISSEN FAEHRT EIN. Ohne den Zustand steht es in voller Breite da
        # und liegt ueber der Karte — und mit fuenf Bluetooth-Zeilen liegt die
        # vierte „Verbinden" darunter.
        'name': 'kissen-faehrt-im-eltern-bereich-ein',
        'punkt': 'E31/P3',
        'worum': 'solange der Bereich offen ist, schrumpft das Kissen auf seine vier Knoepfe',
        'datei': 'NewDesign/app.js',
        'alt': "      document.body.classList.add('eltern-offen')",
        'neu': '      void 0',
        'pruefung': PRUEF_ELTERN_SEITE,
    },
    {
        # DAS KISSEN MUSS UEBER DEM BEREICH LIEGEN. `.eltern` traegt
        # `background: var(--bg)` und ist undurchsichtig: mit der alten Stufe 5
        # ist das Kissen nicht bloss unsichtbar, sondern TOT — gemessen trifft
        # ein Finger auf jedem der vier Knoepfe `div#eltern-flaeche`. Ein Knopf,
        # der dasteht und nicht reagiert, ist die Attrappe in Reinform.
        'name': 'kissen-liegt-ueber-dem-eltern-bereich',
        'punkt': 'E31/P3',
        'worum': 'anhalten, weiterschalten und lauter sind im Eltern-Bereich wirklich zu treffen',
        'datei': 'NewDesign/app.css',
        'alt': '     Marken der Kacheln). */\n  z-index: 9;',
        'neu': '     Marken der Kacheln). */\n  z-index: 5;',
        'pruefung': PRUEF_ELTERN_SEITE,
    },
    {
        # DIE LEISTE MUSS BEIM OEFFNEN ZURUECKGEHOLT WERDEN. Der Weg dahin ist
        # der eines Fingers: rollen, dann sofort 700 ms aufs Zahnrad halten —
        # dann bleibt `platz-machen` stehen, und der freigegebene 88-px-Streifen
        # zeigt nicht die vier Kategorien, sondern die BUEHNE. GEMESSEN sind
        # dort acht KACHELN treffbar: ein Kind koennte waehrend der PIN-Eingabe
        # Musik starten.
        'name': 'leiste-steht-beim-oeffnen-des-eltern-bereichs',
        'punkt': 'E31/P3',
        'worum': 'der Bereich geht nie mit eingefahrener Leiste auf',
        'datei': 'NewDesign/app.js',
        'alt': '      platzBeimBlaettern.zeigen()\n      // 3. \u201eWER HOERT" WIRD SICHTBAR STILLGELEGT.',
        'neu': '      // 3. \u201eWER HOERT" WIRD SICHTBAR STILLGELEGT.',
        'pruefung': PRUEF_ELTERN_SEITE,
    },
    {
        # „WER HOERT" MUSS STILLGELEGT SEIN. Sein Fenster hat dieselbe Stufe wie
        # der Bereich (beide 8), und `#eltern` steht spaeter im Baum — es ginge
        # HINTER ihm auf, unbedienbar, und der eine Rueckweg raeumte es beim
        # ERSTEN Tipp weg, ohne dass sich am Schirm etwas ruehrt. Schwerer wiegt
        # der zweite Grund: ein Profilwechsel ruft `location.reload()`, und das
        # loescht die Bremse des Tors aus dem Seitenspeicher — drei Beruehrungen
        # statt der Wartezeit.
        'name': 'wer-hoert-ist-im-eltern-bereich-stillgelegt',
        'punkt': 'E31/P3',
        'worum': 'das Zeichen oben links ist gesperrt, solange der Bereich offen ist',
        'datei': 'NewDesign/app.js',
        'alt': "      $('ich').disabled = true",
        'neu': '      void 0',
        'pruefung': PRUEF_ELTERN_SEITE,
    },
    {
        # UND DIE STILLLEGUNG MUSS ZU SEHEN SEIN. `pointer-events: none` allein
        # ist genau die Attrappe, gegen die dieses Haus mehrfach angelaufen ist:
        # ein Knopf, der bedienbar aussieht und es nicht ist.
        'name': 'wer-hoert-ist-sichtbar-stillgelegt',
        'punkt': 'E31/P3',
        'worum': 'gedaempft und nicht heimlich tot',
        'datei': 'NewDesign/app.css',
        'alt': '.ich[disabled] {\n  opacity: 0.3;\n  pointer-events: none;\n}',
        'neu': '.ich[disabled] {\n  pointer-events: none;\n}',
        'pruefung': PRUEF_ELTERN_SEITE,
    },
    {
        # DER PLATZ FUER DAS SCHWEBENDE KISSEN. Ohne ihn liegt es auf der Karte;
        # gemessen mit fuenf Zeilen traf ein Finger auf „Verbinden" der vierten
        # Zeile `div#mp`.
        'name': 'karte-haelt-platz-fuer-das-kissen',
        'punkt': 'E31/P3',
        'worum': 'das eingefahrene Kissen liegt auf keinem Punkt der Karte',
        'datei': 'NewDesign/app.css',
        'alt': 'body.eltern-offen.kissen-da .eltern-fach {\n  margin-bottom: calc(var(--mp-hoehe) + var(--mp-rand));\n}',
        'neu': '',
        'pruefung': PRUEF_ELTERN_SEITE,
    },
    {
        # UND DERSELBE PLATZ AM TOR, mit 10 px mehr. Ohne ihn faellt die Taste
        # „0" auf 4,06 mm, „Letzte Ziffer loeschen" auf 5,18 mm, und
        # `#mp-zurueck` ueberlappt die Loeschtaste mit 0,00 mm. Mit nur 84 px
        # waeren es 1,96 mm — knapp daneben.
        'name': 'tor-haelt-platz-fuer-das-kissen',
        'punkt': 'E31/P3',
        'worum': 'die Tasten des Tors halten 2 mm zu den Kissenknoepfen',
        'datei': 'NewDesign/app.css',
        'alt': 'body.eltern-offen.kissen-da .eltern-tor {\n  margin-bottom: calc(var(--mp-hoehe) + var(--mp-rand) + 10px);\n}',
        'neu': '',
        'pruefung': PRUEF_ELTERN_SEITE,
    },
    {
        # DER PLATZ VERSCHWINDET, WENN NICHTS SPIELT. Sonst steht ein leerer
        # Streifen unter der Karte und ein Tor, das sichtbar zu hoch haengt —
        # reservierter Platz fuer etwas, das nicht da ist. Dieser Fall war beim
        # Bauen zuerst vergessen.
        'name': 'ohne-wiedergabe-kein-reservierter-platz',
        'punkt': 'E31/P3',
        'worum': 'spielt nichts, reicht die Karte wieder bis unten',
        'datei': 'NewDesign/app.js',
        'alt': "      document.body.classList.remove('kissen-da')",
        'neu': '      void 0',
        'pruefung': PRUEF_ELTERN_SEITE,
    },
    {
        # DIE DREI KATEGORIENPAARE. 6 px = 0,84 mm standen seit je auf dem
        # Startschirm und waren dort nie der engste Abstand. Seit die Leiste im
        # Eltern-Bereich bedienbar ist, WANDERN sie auf einen Schirm, fuer den
        # 2 mm gefordert sind.
        'name': 'kategorien-halten-zwei-millimeter',
        'punkt': 'E31/P3',
        'worum': 'zwischen zwei Kategorien liegen 2 mm, nicht 0,84',
        'datei': 'NewDesign/app.css',
        'alt': '  justify-content: flex-start;\n  gap: 15px;\n  overflow-y: auto;',
        'neu': '  justify-content: flex-start;\n  gap: 6px;\n  overflow-y: auto;',
        'pruefung': PRUEF_ELTERN_SEITE,
    },
    {
        # DIE DREI KISSENPAARE, aus demselben Grund: 10 px = 1,40 mm zwischen
        # zwei `.mp-knopf`. Bestand des Startschirms, seit dem 06.08.2026 auf den
        # Eltern-Schirmen sichtbar.
        'name': 'kissenknoepfe-halten-zwei-millimeter',
        'punkt': 'E31/P3',
        'worum': 'zwischen zwei Kissenknoepfen liegen 2 mm, nicht 1,40',
        'datei': 'NewDesign/app.css',
        'alt': '  --mp-gap: 15px;',
        'neu': '  --mp-gap: 10px;',
        'pruefung': PRUEF_ELTERN_SEITE,
    },
    {
        # UND DIE BREITE MUSS MITWACHSEN. Vier 66-px-Knoepfe mit 15 px Abstand
        # passen nicht in 334 px: gemessen faellt „Naechster Titel" dann auf
        # 8,82 mm. Das war der einzige Rueckschlag dieses Vorschlags, und er
        # haengt an genau dieser Zeile.
        'name': 'eingefahrenes-kissen-waechst-mit-dem-abstand',
        'punkt': 'E31/P3',
        'worum': 'die Breite des eingefahrenen Kissens rechnet mit --mp-gap',
        'datei': 'NewDesign/app.css',
        'alt': '  width: calc(4 * max(var(--griff), calc(var(--griff) * var(--mupi-btn, 1))) + 5 * var(--mp-gap) + 20px);\n  margin-top:',
        'neu': '  width: calc(4 * max(var(--griff), calc(var(--griff) * var(--mupi-btn, 1))) + 70px);\n  margin-top:',
        'pruefung': PRUEF_ELTERN_SEITE,
    },
    {
        # DER EINZUG DER UEBERSCHRIFT. `#zurueck` steht `fixed` am SCHIRM, der
        # Bereich beginnt bei 88 — ohne den Abzug ist die Luft 100 px statt 12.
        # Der bisherige Pruefschritt („mindestens 12 px") bliebe dabei GRUEN und
        # meldete eine Zahl, die um 88 px danebenliegt: dieselbe Fehlersorte wie
        # [[rueckweg-verdeckt-die-ueberschrift]], nur andersherum.
        'name': 'eltern-kopf-rechnet-vom-rand-des-bereichs',
        'punkt': 'E31/P3',
        'worum': 'die Ueberschrift steht 12 px neben dem Rueckweg, nicht 100',
        'datei': 'NewDesign/app.css',
        'alt': '  padding-left: calc(var(--zurueck-links, 96px) + var(--griff) + 12px - 16px - var(--eltern-links));',
        'neu': '  padding-left: calc(var(--zurueck-links, 96px) + var(--griff) + 12px - 16px);',
        'pruefung': PRUEF_ELTERN_SEITE,
    },
    {
        # DIE ECKE DER GESTE FOLGT DER FLAECHE. Das Tor schrumpfte mit der neuen
        # Form von 768x390 auf 680x296; die feste Kante von 120 px deckte damit
        # 30 statt 20 Prozent — ein zufaelliger Tipp traf die jeweils richtige
        # Ecke mit 1 : 13 statt 1 : 20. Niemand hatte eine Zeile an der Geste
        # angefasst. Der Eingriff stellt die feste Zahl wieder her.
        'name': 'gesten-ecke-folgt-der-flaeche',
        'punkt': 'E31/P1',
        'worum': 'die vier Ecken decken hoechstens ein Fuenftel der Tor-Flaeche',
        'datei': 'NewDesign/app.js',
        'alt': '      const ecke = gesteEcke(x, y, breite, hoehe, gesteEckeKante(breite, hoehe))',
        'neu': '      const ecke = gesteEcke(x, y, breite, hoehe, 120)',
        'pruefung': PRUEF_ELTERN_TOR,
    },

    # ══ E31/P1: DIE GEMEINSAME FREIGABE (06.08.2026) ══════════════════════
    #
    # GEMELDET VOM BETREIBER AM GERAET: „beim eingeben kömmt 2 mal die
    # aufgabe". Der Weg aus dem neuen Eltern-Bereich in die klassische
    # Oberflaeche ist ein VOLLER Seitenwechsel; die Freigabe des ersten Tors
    # lag nur im Arbeitsspeicher und war danach weg. Ende zu Ende belegt und
    # nachgemessen mit `node tools/zwei-tore-messen.mjs` (27 Aussagen, beide
    # Oberflaechen auf EINEM Ursprung). Diese vier Eingriffe bewachen den
    # reinen Kern, den eine Spec-Datei ohne Browser pruefen kann.
    {
        # DAS ZEITFENSTER. Ohne die Pruefung „juenger als FREIGABE_DAUER_MS"
        # gaelte eine einmal gesetzte Freigabe fuer immer — die Sperre waere
        # nach dem ersten Mal keine mehr, und zwar unsichtbar.
        'name': 'freigabe-verfaellt-wirklich',
        'punkt': 'E31/P1',
        'worum': 'eine Freigabe aus der Vergangenheit traegt nicht ewig',
        'datei': 'src/frontend-box/src/app/einstellungssperre/freigabe.ts',
        'alt': '  return alter >= 0 && alter < FREIGABE_DAUER_MS',
        'neu': '  return alter >= 0',
        'pruefung': pruefung_box_rein('einstellungssperre/freigabe.spec.ts'),
    },
    {
        # DIE UHR, DIE SPRINGT. `alter >= 0` faengt einen Zeitstempel aus der
        # ZUKUNFT ab. Die Box hat keine Pufferuhr und stellt sich per NTP —
        # springt sie nach dem Setzen zurueck, waere eine Freigabe aus der
        # Zukunft sonst beliebig lange gueltig.
        'name': 'freigabe-aus-der-zukunft-zaehlt-nicht',
        'punkt': 'E31/P1',
        'worum': 'ein Zeitstempel in der Zukunft gilt nicht als Freigabe',
        'datei': 'src/frontend-box/src/app/einstellungssperre/freigabe.ts',
        'alt': '  return alter >= 0 && alter < FREIGABE_DAUER_MS',
        'neu': '  return alter < FREIGABE_DAUER_MS',
        'pruefung': pruefung_box_rein('einstellungssperre/freigabe.spec.ts'),
    },
    {
        # KEIN BELIEBIGER INHALT. Der Wert kommt aus dem sessionStorage und ist
        # damit fremde Eingabe wie jede andere. Ohne das Muster wuerde
        # `Number("")` zu 0 — und die Absicht ist, dass Unsinn GAR NICHT ERST
        # als Freigabe durchgeht, statt sich auf das Zeitfenster zu verlassen.
        'name': 'freigabe-nimmt-nur-ziffern',
        'punkt': 'E31/P1',
        'worum': 'nur eine reine Ziffernfolge kann eine Freigabe sein',
        'datei': 'src/frontend-box/src/app/einstellungssperre/freigabe.ts',
        'alt': "  if (!/^[0-9]{1,15}$/.test(w)) return false",
        'neu': "  if (false) return false",
        'pruefung': pruefung_box_rein('einstellungssperre/freigabe.spec.ts'),
    },
    {
        # EINE QUELLE FUER NAME UND DAUER. Stuende die Zahl ein zweites Mal im
        # Code, liefen die beiden Oberflaechen beim naechsten Anfassen
        # auseinander — [[drei-orte-eine-anzeige]] ist an genau dieser Naht
        # schon zweimal gebrochen. Dieser Eingriff verstellt die JSON-Datei;
        # bemerkt die Pruefung ihn nicht, liest sie den Wert gar nicht.
        'name': 'freigabe-dauer-kommt-aus-der-einen-datei',
        'punkt': 'E31/P1',
        'worum': 'Name und Dauer werden wirklich aus NewDesign/freigabe.json gelesen',
        'datei': 'NewDesign/freigabe.json',
        'alt': '"dauerMs": 120000,',
        'neu': '"dauerMs": 1,',
        'pruefung': pruefung_box_rein('einstellungssperre/freigabe.spec.ts'),
    },
]

def lauf(argv, cwd, umgebung=None):
    u = dict(os.environ)
    u.update(umgebung or {})
    return subprocess.run(argv, cwd=cwd, env=u, capture_output=True, text=True)


def wirklich_gelaufen(ausgabe: str) -> bool:
    """
    HAT DER LAUF UEBERHAUPT EINEN FALL BESTANDEN?

    Ende 0 allein genuegt hier nicht. `node --test --test-name-pattern` meldet
    bei einem Muster, auf das NICHTS passt, brav Ende 0 mit lauter
    uebersprungenen Faellen — die Grundlinie waere gruen, der Eingriff bliebe
    „unbemerkt", und niemand saehe, dass gar nichts gemessen wurde. Dieselbe
    Sorte Luege durch Weglassen wie im Wissenspaket unter
    [[attrappe-luegt-durch-weglassen]].

    Wo es die Zeile `ℹ pass N` nicht gibt (tools/pruef-neu-regeln.js schreibt
    seine eigene Bilanz), wird nichts behauptet und der Ende-Code gilt.
    """
    for zeile in ausgabe.splitlines():
        z = zeile.strip()
        if z.startswith('ℹ pass '):
            try:
                return int(z.split()[-1]) > 0
            except ValueError:
                return True
    return True


def arbeitskopie_bauen(ziel: str) -> None:
    subprocess.run(['git', 'worktree', 'add', '--detach', ziel, 'HEAD'], cwd=WURZEL, check=True,
                   capture_output=True, text=True)
    fleck = subprocess.run(['git', 'diff', 'HEAD'], cwd=WURZEL, check=True,
                           capture_output=True, text=True).stdout
    if fleck.strip():
        p = os.path.join(ziel, '.rotprobe.patch')
        with open(p, 'w', encoding='utf-8') as f:
            f.write(fleck)
        subprocess.run(['git', 'apply', p], cwd=ziel, check=True, capture_output=True, text=True)
        os.remove(p)
    neue = subprocess.run(['git', 'ls-files', '--others', '--exclude-standard'], cwd=WURZEL,
                          check=True, capture_output=True, text=True).stdout.split('\n')
    for rel in neue:
        rel = rel.strip()
        if not rel or not rel.startswith(NEUE_UNTER):
            continue
        quelle = os.path.join(WURZEL, rel)
        if not os.path.isfile(quelle):
            continue
        zieldatei = os.path.join(ziel, rel)
        os.makedirs(os.path.dirname(zieldatei), exist_ok=True)
        shutil.copy2(quelle, zieldatei)
    for rel in VERLINKEN:
        q = os.path.join(WURZEL, rel)
        z = os.path.join(ziel, rel)
        if os.path.isdir(q) and not os.path.exists(z):
            os.makedirs(os.path.dirname(z), exist_ok=True)
            os.symlink(q, z)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--nur', action='append', default=[], help='nur Eingriffe, deren Name/Punkt das enthaelt')
    p.add_argument('--liste', action='store_true', help='nur zeigen, nichts laufen lassen')
    p.add_argument('--behalten', action='store_true', help='die Arbeitskopie stehen lassen')
    a = p.parse_args()

    gewaehlt = [e for e in EINGRIFFE
                if not a.nur or any(n in e['name'] or n == e['punkt'] for n in a.nur)]
    if not gewaehlt:
        print('kein Eingriff passt.')
        return 1

    if a.liste:
        for e in gewaehlt:
            print(f"  [{e['punkt']}] {e['name']:34s} {e['worum']}")
        return 0

    ziel = tempfile.mkdtemp(prefix='mupi-rotprobe-')
    kopie = os.path.join(ziel, 'baum')
    fehler = 0
    try:
        print(f'Arbeitskopie: {kopie}')
        arbeitskopie_bauen(kopie)

        # ══ DIE GRUNDLINIE ═════════════════════════════════════════════════
        # Ohne sie beweist ein rotes Ergebnis nichts: eine Pruefung, die schon
        # unveraendert rot ist, wird es beim Eingriff auch sein.
        grundlinie = {}
        print('\n── Grundlinie: laeuft alles UNVERAENDERT gruen? ─────────────')
        for e in gewaehlt:
            schl = (e['pruefung']['cwd'], tuple(e['pruefung']['argv']))
            if schl in grundlinie:
                continue
            r = lauf(e['pruefung']['argv'], os.path.join(kopie, e['pruefung']['cwd']), e['pruefung']['umgebung'])
            gut = r.returncode == 0 and wirklich_gelaufen(r.stdout + r.stderr)
            grundlinie[schl] = gut
            wort = 'gruen' if gut else ('LEER ' if r.returncode == 0 else 'ROT  ')
            print(f"  {wort}  {' '.join(e['pruefung']['argv'])}")
            if not gut:
                print((r.stdout + r.stderr)[-1500:])

        print('\n── Die Eingriffe ───────────────────────────────────────────')
        for e in gewaehlt:
            datei = os.path.join(kopie, e['datei'])
            with open(datei, encoding='utf-8') as f:
                vorher = f.read()
            treffer = vorher.count(e['alt'])
            if treffer != 1:
                print(f"  ABBRUCH  {e['name']}: der Wortlaut kommt {treffer}-mal vor, erwartet genau 1")
                fehler += 1
                continue
            schl = (e['pruefung']['cwd'], tuple(e['pruefung']['argv']))
            if not grundlinie.get(schl):
                print(f"  UNGEPRUEFT {e['name']}: die Pruefung ist schon unveraendert rot")
                fehler += 1
                continue
            try:
                with open(datei, 'w', encoding='utf-8') as f:
                    f.write(vorher.replace(e['alt'], e['neu']))
                r = lauf(e['pruefung']['argv'], os.path.join(kopie, e['pruefung']['cwd']), e['pruefung']['umgebung'])
            finally:
                with open(datei, 'w', encoding='utf-8') as f:
                    f.write(vorher)
            if r.returncode != 0:
                print(f"  ROT ohne die Aenderung  [{e['punkt']}] {e['name']} — {e['worum']}")
            else:
                fehler += 1
                print(f"  GRUEN GEBLIEBEN         [{e['punkt']}] {e['name']} — {e['worum']}")
                print('     der Test bewacht diese Aenderung NICHT.')
        return 0 if fehler == 0 else 1
    finally:
        if a.behalten:
            print(f'\nArbeitskopie bleibt stehen: {kopie}')
        else:
            subprocess.run(['git', 'worktree', 'remove', '--force', kopie], cwd=WURZEL,
                           capture_output=True, text=True)
            shutil.rmtree(ziel, ignore_errors=True)
        print(f"\n{'alle Eingriffe wurden bemerkt' if fehler == 0 else f'{fehler} Eingriff(e) blieben unbemerkt'}")


if __name__ == '__main__':
    sys.exit(main())
