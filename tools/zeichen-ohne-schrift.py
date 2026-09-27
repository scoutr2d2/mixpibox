#!/usr/bin/env python3
"""
WELCHE ZEICHEN KANN DIE BOX GAR NICHT ZEIGEN?

══ WOZU ═══════════════════════════════════════════════════════════════════════
Der Betreiber am 07.08.2026: „kann es sein das auf der box die icons im menue
nicht dargestellt werden wie im browser hier ich sehe nur rechtecke bei manchen
punkten wie kinder, info...."

Er hatte recht, und der Fehler ist von der teuersten Sorte: AUF DEM
ENTWICKLUNGSRECHNER IST ER UNSICHTBAR. Ein Arbeitsplatz hat eine Emoji-Schrift
(Noto Color Emoji o. ae.), die Box hat GENAU DREI Schriften:

    DejaVu Sans · DejaVu Sans Mono · DejaVu Serif

Keine davon kennt ein einziges Emoji. Wo im Menue 📊 stand, stand auf der Box
ein leeres Rechteck — und ein leeres Rechteck sieht aus wie Absicht. Beim Bauen
faellt das nirgends auf, im Wohnzimmer ueberall.

Damit die NAECHSTE Zeile, die jemand mit einem huebschen Zeichen schreibt, nicht
denselben Weg geht, prueft dieses Werkzeug den Quelltext gegen die Schriften,
die auf dem Zielgeraet WIRKLICH liegen.

══ WIE ES PRUEFT — UND WARUM NICHT MIT EINER LISTE IM KOPF ════════════════════
Eine handgeschriebene Liste „diese Zeichen gehen" veraltet in dem Moment, in dem
jemand ein Zeichen benutzt, an das die Liste nicht gedacht hat — und sie sagt
dann faelschlich „alles gut". Deshalb wird gegen die ECHTEN Schriftdateien
geprueft: die cmap-Tabelle jeder DejaVu-Datei sagt zeichengenau, welche
Kodepunkte sie zeichnen kann.

Der Arbeitsplatz hat mehr DejaVu-Dateien als die Box (Condensed, Math TeX Gyre).
Die zaehlen NICHT mit: gemessen wird gegen die drei Familien, die `fc-list` auf
192.168.178.169 nennt, sonst misst man den eigenen Rechner und nicht das Ziel.

    --schriften VERZ   wo die .ttf liegen (Vorgabe: /usr/share/fonts)
    --familie NAME     zusaetzliche Familie zulassen (mehrfach moeglich) —
                       fuer den Tag, an dem eine Box mehr mitbringt
    --pfade DATEI …    was geprueft wird (Vorgabe: die drei NewDesign-Dateien)
    --alles            auch Fundstellen zeigen, die in einem Kommentar stehen
    --json             maschinenlesbar

══ WAS EIN FUND IST — UND WAS NICHT ═══════════════════════════════════════════
Geprueft wird JEDES Zeichen ueber ASCII. Die deutschen Umlaute, die typografi-
schen Anfuehrungszeichen und die Pfeile in den Kommentaren bestehen die Pruefung
von selbst, weil DejaVu sie kennt — es braucht also keine Ausnahmeliste, die
gepflegt werden muesste.

KOMMENTARZEILEN ZAEHLEN NICHT FUERS ERGEBNIS. In dieser Datei hier stehen
Emoji im Fliesstext, und in app.js steht in einer Begruendung, welches Zeichen
frueher dort stand. Solcher Text geht nie an einen Bildschirm. Erkannt wird er
grob (Zeile beginnt mit `*`, `//`, `#` oder `<!--`) — grob genug, dass ein
Emoji in echtem Code niemals durchrutscht, denn Code beginnt nicht so.
Mit `--alles` sieht man auch diese Stellen.

══ DIE ZWEITE PRUEFUNG: JEDER NAME MUSS IN DER KARTE STEHEN ═══════════════════
Seit dem 07.08.2026 stehen in den Datensaetzen keine Zeichen mehr, sondern
NAMEN (`zeichen: 'wlan'`), und die Karte `ZEICHEN` in app.js macht daraus ein
SVG. Damit ist die alte Falle weg — und eine neue da: ein Tippfehler im Namen
ergaebe eine leere Scheibe, und eine leere Scheibe sieht aus wie Absicht,
genau wie das leere Rechteck vorher.

Zur Laufzeit faengt `zeichenKnoten()` das ab (Fragezeichen-Zeichen, Meldung in
der Konsole, `data-zeichen-fehlt` am Knoten). Das hilft aber nur, wer die Seite
oeffnet. Deshalb prueft dieses Werkzeug es AUCH still im Quelltext: jeder
Name, der als `zeichen: '…'` dasteht, muss in `ZEICHEN` vorkommen — und jeder
Name in `ZEICHEN`, den niemand mehr nennt, wird als tot gemeldet.

Abschalten mit --ohne-karte (etwa beim Pruefen fremder Verzeichnisse).

RUECKGABE: 0 = jedes sichtbare Zeichen ist zeichenbar und jeder Name bekannt,
1 = mindestens eines nicht, 2 = die Schriften waren nicht zu finden (dann wurde
NICHTS geprueft, und das ist kein „alles gut").

══ GEBRAUCH ══════════════════════════════════════════════════════════════════
    python3 tools/zeichen-ohne-schrift.py
    python3 tools/zeichen-ohne-schrift.py --pfade src/frontend-box/src --alles
"""

import argparse
import json
import os
import re
import sys
import unicodedata

# Die drei Familien, die `fc-list` am 07.08.2026 auf der Box nannte. Mehr hat
# ein DietPi ohne Desktop nicht — und was hier nicht steht, darf beim Messen
# nicht mithelfen, auch wenn es auf dem Arbeitsplatz herumliegt.
BOX_FAMILIEN = ('DejaVu Sans', 'DejaVu Sans Mono', 'DejaVu Serif')

# Welche Dateien die Oberflaeche AUSMACHEN. Wer andere prueft, sagt es mit
# --pfade; diese drei sind der Normalfall.
VORGABE_PFADE = ('NewDesign/app.js', 'NewDesign/index.html', 'NewDesign/app.css')

ENDUNGEN = ('.js', '.mjs', '.ts', '.html', '.htm', '.css', '.scss', '.json')

# Zeichen, die zwar ueber ASCII liegen, aber nie fuer sich gezeichnet werden:
# sie steuern nur, WIE das Zeichen davor aussieht. Ein Fund waere hier immer ein
# Fehlalarm.
UNSICHTBAR = {
    0x200D,  # Zero Width Joiner
    0x200B,  # Zero Width Space
    0xFE0E,  # Textvariante
    0xFE0F,  # Emoji-Variante
    0x00A0,  # geschuetztes Leerzeichen (DejaVu kennt es, steht der Ordnung halber hier)
}

# ── WARUM VERBINDENDE AKZENTE NICHT ZAEHLEN (Unicode-Kategorie Mn) ────────────
# Sie stehen NIE allein auf dem Schirm; sie legen sich auf den Buchstaben davor.
# Fehlt so ein Kodepunkt in DejaVu, sieht man ein Wort mit schiefem Akzent —
# aerger lich, aber kein leeres Rechteck, und damit nicht die Fehlersorte, um
# die es hier geht.
# DER KONKRETE ANLASS: `suchWort()` in app.js traegt die Zeichenklasse
# /[̀-ͯ]/ im Quelltext — eine REGEL, die Akzente wegwirft, kein
# Bildschirminhalt. Ohne diese Regel meldete das Werkzeug ewig denselben
# Fehlalarm, und ein Werkzeug, das immer rot ist, liest bald niemand mehr.


def ist_verbindend(zeichen):
    return unicodedata.category(zeichen) == 'Mn'


def familie_von(tt):
    """Der Familienname, wie ihn fontconfig meldet (NameID 1, englisch)."""
    try:
        for eintrag in tt['name'].names:
            if eintrag.nameID == 1:
                return str(eintrag.toUnicode()).strip()
    except Exception:
        pass
    return ''


def vorrat_lesen(verzeichnis, familien):
    """
    Alle Kodepunkte, die die erlaubten Familien zeichnen koennen.

    Zurueck kommt (menge, gelesene_dateien). Eine leere Menge heisst NICHT
    „nichts geht", sondern „hier lag keine passende Schrift" — der Aufrufer
    muss das unterscheiden, sonst meldet ein Rechner ohne DejaVu jeden Buch-
    staben als Fehler.
    """
    try:
        from fontTools.ttLib import TTFont
    except ImportError:
        return None, []

    erlaubt = {f.lower() for f in familien}
    menge, dateien = set(), []
    for wurzel, _, namen in os.walk(verzeichnis):
        for name in namen:
            if not name.lower().endswith(('.ttf', '.otf', '.ttc')):
                continue
            pfad = os.path.join(wurzel, name)
            try:
                tt = TTFont(pfad, fontNumber=0, lazy=True)
            except Exception:
                continue
            try:
                if familie_von(tt).lower() not in erlaubt:
                    continue
                for tabelle in tt['cmap'].tables:
                    menge.update(tabelle.cmap.keys())
                dateien.append(pfad)
            except Exception:
                pass
            finally:
                try:
                    tt.close()
                except Exception:
                    pass
    return menge, sorted(dateien)


def ist_kommentarzeile(zeile):
    """
    Grob, und mit Absicht grob.

    Eine Zeile, die mit `*`, `//`, `#` oder `<!--` anfaengt, ist Erklaerung und
    kein Bildschirminhalt. Echter Code faengt nie so an — deshalb kann diese
    Regel wohl einen Kommentar fuer Code halten (harmlos, ein Hinweis zuviel),
    aber kein Code fuer einen Kommentar (das waere der gefaehrliche Irrtum).
    """
    t = zeile.lstrip()
    return t.startswith('*') or t.startswith('//') or t.startswith('#') or t.startswith('<!--')


def dateien_sammeln(pfade):
    raus = []
    for p in pfade:
        if os.path.isdir(p):
            for wurzel, verz, namen in os.walk(p):
                verz[:] = [v for v in verz if v not in ('node_modules', '.git', 'dist', 'www')]
                for n in sorted(namen):
                    if n.endswith(ENDUNGEN):
                        raus.append(os.path.join(wurzel, n))
        elif os.path.isfile(p):
            raus.append(p)
    return raus


def durchsuchen(dateien, vorrat):
    """
    Je Zeichen: wo es steht und ob DejaVu es kennt.

    Aufgehoben wird nach ZEICHEN und nicht nach Fundstelle — die Frage beim
    Beheben lautet „welches Zeichen muss weg", nicht „welche Zeile".
    """
    funde = {}
    for pfad in dateien:
        try:
            with open(pfad, encoding='utf-8') as f:
                zeilen = f.read().splitlines()
        except (OSError, UnicodeDecodeError):
            continue
        for nr, zeile in enumerate(zeilen, 1):
            kommentar = ist_kommentarzeile(zeile)
            for zeichen in zeile:
                kp = ord(zeichen)
                if kp < 128 or kp in UNSICHTBAR:
                    continue
                if kp in vorrat or ist_verbindend(zeichen):
                    continue
                eintrag = funde.setdefault(zeichen, {'stellen': [], 'nur_kommentar': True})
                eintrag['stellen'].append((pfad, nr, kommentar))
                if not kommentar:
                    eintrag['nur_kommentar'] = False
    return funde


def name_von(zeichen):
    try:
        return unicodedata.name(zeichen)
    except ValueError:
        return '?'


# ── DIE KARTE AUS app.js LESEN, OHNE JAVASCRIPT AUSZUFUEHREN ──────────────────
# Zwei Muster genuegen und zwar deshalb, weil die Datei EINE Bauart hat: die
# Karte ist ein Objektliteral mit Schluesseln in einer Zeile, die Verwendung
# steht immer als `zeichen: '…'`. Was NICHT erkannt wird, ist ein Name, der
# erst zur Laufzeit entsteht (etwa aus einer Antwort der Box) — den faengt
# `zeichenKnoten()` mit seiner Meldung in der Konsole.
KARTE_ANFANG = re.compile(r'^\s*const ZEICHEN = \{')
KARTE_SCHLUESSEL = re.compile(r"^\s{4}'?([a-z][a-z0-9-]*)'?:")
# Eine Zeichenkette, die ein Name sein KOENNTE: klein anfangend, dann Kleinbuch-
# staben, Ziffern, Bindestrich. Das schliesst 'WLAN', '/settings' und ganze
# Saetze von selbst aus — die faengt kein Name je an.
WIE_EIN_NAME = re.compile(r"'([a-z][a-z0-9-]*)'")


def karte_pruefen(pfad):
    """
    (fehlende_namen, tote_eintraege, anzahl_karte) — oder None, wenn die Datei
    gar keine Karte hat (dann gibt es hier nichts zu pruefen).

    ── ZWEI RICHTUNGEN, ZWEI STRENGEN ────────────────────────────────────────
    FEHLT (ein benutzter Name steht nicht in der Karte) ist der gefaehrliche
    Fall — dort steht dann ein Fragezeichen statt eines Zeichens. Gesucht wird
    er eng: nur, was HINTER einem `zeichen:` in Anfuehrungszeichen steht. Was
    davor auf derselben Zeile steht (`id`, `gruppe`), geht niemanden an.
    Ein Ternaer (`flug ? 'flugmodus' : 'wlan'`) liefert dabei beide Namen.

    KARTEILEICHE (ein Eintrag, den niemand nennt) ist bloss Ballast. Gesucht
    wird sie WEIT: der Name gilt als benutzt, sobald er IRGENDWO ausserhalb der
    Karte in Anfuehrungszeichen vorkommt. Das muss so weit sein, weil die
    Namen nicht nur direkt dastehen, sondern ueber Zwischenkarten kommen
    (`WLAN_BALKEN`, `MEDIEN_ZEICHEN`, die Geraetearten in `btZeile`). Eine zu
    enge Regel meldete hier reihenweise Leichen, die keine sind — und ein
    Werkzeug, das man wegsehen lernt, ist keins.
    """
    try:
        with open(pfad, encoding='utf-8') as f:
            zeilen = f.read().splitlines()
    except OSError:
        return None

    bekannt, von, bis = [], None, None
    for nr, zeile in enumerate(zeilen):
        if von is None:
            if KARTE_ANFANG.match(zeile):
                von = nr
            continue
        if bis is None and zeile.startswith('  }'):
            bis = nr
            continue
    if von is None:
        return None
    if bis is None:
        bis = len(zeilen)
    for zeile in zeilen[von + 1 : bis]:
        t = KARTE_SCHLUESSEL.match(zeile)
        if t:
            bekannt.append(t.group(1))

    benutzt, irgendwo = {}, set()
    for nr, zeile in enumerate(zeilen, 1):
        if ist_kommentarzeile(zeile):
            continue
        if von < nr - 1 <= bis:
            continue  # innerhalb der Karte selbst zaehlt nichts als Verwendung
        irgendwo.update(WIE_EIN_NAME.findall(zeile))
        pos = zeile.find('zeichen:')
        if pos >= 0:
            for name in WIE_EIN_NAME.findall(zeile[pos:]):
                benutzt.setdefault(name, []).append(nr)

    fehlend = {n: s for n, s in benutzt.items() if n not in bekannt}
    # 'fehlt' ist der Rueckfall und wird nie genannt — er darf nicht als tot
    # gelten, sonst entfernte ihn irgendwann jemand und die leere Scheibe waere
    # zurueck.
    tot = [n for n in bekannt if n not in irgendwo and n != 'fehlt']
    return fehlend, tot, len(bekannt)


def main():
    ap = argparse.ArgumentParser(description='Zeichen finden, die eine Box mit DejaVu nicht zeigen kann.')
    ap.add_argument('--pfade', nargs='*', default=list(VORGABE_PFADE))
    ap.add_argument('--schriften', default='/usr/share/fonts')
    ap.add_argument('--familie', action='append', default=[])
    ap.add_argument('--alles', action='store_true', help='auch Fundstellen in Kommentaren zeigen')
    ap.add_argument('--ohne-karte', action='store_true', help='die Namenspruefung gegen ZEICHEN auslassen')
    ap.add_argument('--json', action='store_true')
    a = ap.parse_args()

    hier = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(hier)

    familien = list(BOX_FAMILIEN) + list(a.familie)
    vorrat, schriftdateien = vorrat_lesen(a.schriften, familien)

    if vorrat is None:
        print('ABBRUCH: fontTools fehlt (pip install fonttools). Es wurde NICHTS geprueft.', file=sys.stderr)
        return 2
    if not vorrat:
        print(f'ABBRUCH: unter {a.schriften} lag keine der Schriften {familien}.', file=sys.stderr)
        print('Es wurde NICHTS geprueft — das ist kein „alles gut".', file=sys.stderr)
        return 2

    dateien = dateien_sammeln(a.pfade)
    funde = durchsuchen(dateien, vorrat)

    sichtbar = {z: d for z, d in funde.items() if not d['nur_kommentar']}
    zeigen = funde if a.alles else sichtbar

    karten = [] if a.ohne_karte else [(p, karte_pruefen(p)) for p in dateien]
    karten = [(p, k) for p, k in karten if k is not None]
    karte_kaputt = any(k[0] for _, k in karten)

    if a.json:
        print(json.dumps({
            'karte': [
                {'datei': p, 'eintraege': k[2], 'fehlende_namen': k[0], 'nie_genannt': k[1]}
                for p, k in karten
            ],
            'schriften': schriftdateien,
            'kodepunkte_im_vorrat': len(vorrat),
            'geprueft': dateien,
            'fehlend': [
                {
                    'zeichen': z,
                    'kodepunkt': 'U+%04X' % ord(z),
                    'name': name_von(z),
                    'nur_kommentar': d['nur_kommentar'],
                    'stellen': [f'{p}:{n}' for p, n, _ in d['stellen']],
                }
                for z, d in sorted(zeigen.items(), key=lambda kv: ord(kv[0]))
            ],
        }, ensure_ascii=False, indent=2))
        return 1 if (sichtbar or karte_kaputt) else 0

    print(f'Vorrat: {len(vorrat)} Kodepunkte aus {len(schriftdateien)} Datei(en) der Familien {", ".join(familien)}')
    print(f'Geprueft: {len(dateien)} Datei(en)')
    print()

    # ── DIE KARTE ────────────────────────────────────────────────────────────
    for pfad, (fehlend, tot, anzahl) in karten:
        print(f'KARTE ZEICHEN in {pfad}: {anzahl} Eintraege')
        for name, stellen in sorted(fehlend.items()):
            orte = ', '.join(f'{pfad}:{n}' for n in stellen[:6])
            print(f'  FEHLT: „{name}" wird benutzt, steht aber nicht in der Karte — {orte}')
        if tot:
            print(f'  nie genannt (Karteileiche?): {", ".join(sorted(tot))}')
        if not fehlend and not tot:
            print('  jeder benutzte Name steht drin, und jeder Eintrag wird benutzt.')
        print()

    if not zeigen:
        if karte_kaputt:
            print('KEIN ZEICHEN AUSSERHALB DES VORRATS — aber ein Name fehlt in der Karte.')
            print('An seiner Stelle steht ein Fragezeichen; gemeint war etwas anderes.')
            return 1
        print('KEIN ZEICHEN AUSSERHALB DES VORRATS. Was hier steht, kann die Box zeichnen.')
        return 0

    for z, d in sorted(zeigen.items(), key=lambda kv: ord(kv[0])):
        marke = '  (nur in Kommentaren)' if d['nur_kommentar'] else ''
        print(f'{z}  U+{ord(z):04X}  {name_von(z)}{marke}')
        stellen = d['stellen'] if a.alles else [s for s in d['stellen'] if not s[2]]
        for pfad, nr, _ in stellen[:8]:
            print(f'      {pfad}:{nr}')
        if len(stellen) > 8:
            print(f'      … und {len(stellen) - 8} weitere')
        print()

    if sichtbar:
        print(f'{len(sichtbar)} Zeichen wuerden auf der Box als leeres Rechteck erscheinen.')
        print('Ein leeres Rechteck sieht aus wie Absicht — nimm ein SVG (siehe ZEICHEN in app.js).')
        return 1

    print('Alle Funde stehen in Kommentaren; auf dem Bildschirm landet keiner.')
    return 1 if karte_kaputt else 0


if __name__ == '__main__':
    sys.exit(main())
