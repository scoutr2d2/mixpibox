#!/usr/bin/env python3
"""Das MixPi-Reitersymbol in allen Groessen — aus EINER Quelle.

══ WOZU ═══════════════════════════════════════════════════════════════════
Betreiber, 08.08.2026: „wir brauchen ein favicon mixpi".

Ein Favicon ist nicht eine Datei, sondern vier bis fuenf: Der Reiter will bei
16 px etwas anderes sehen als der Lesezeichenbalken bei 32 und der
Startbildschirm eines Telefons bei 180. Wer die von Hand zeichnet, hat nach
der zweiten Aenderung fuenf Bilder, die verschiedene Figuren zeigen.

══ WAS ES TUT ═════════════════════════════════════════════════════════════
Es liest NewDesign/bilder/favicon.svg — die einzige Quelle — und schreibt:

    favicon-16.png    Reiter auf einem gewoehnlichen Schirm
    favicon-32.png    Reiter auf einem feinen Schirm, Lesezeichen
    favicon-48.png    Verlauf, Verknuepfung auf dem Schreibtisch
    favicon.ico       16+32+48 in einer Datei, fuer alles Aeltere
    mixpi-kachel.png  180 px MIT cremefarbenem Grund (Telefon-Startbild)

══ DIE EINE STELLE, AN DER ES DIE QUELLE AENDERT — UND WARUM ══════════════
BEI 16 PIXELN WERDEN AUS DEN AUGENBOEGEN EIN GRAUER BALKEN. Gemessen am
08.08.2026: vier Varianten nebeneinander bei 16 px (Boegen, keine Augen, zwei
Punkte, zwei kurze Striche). Die Boegen der Quelle laufen zu einem Streifen
zusammen, und aus dem Gesicht wird ein Fleck. ZWEI PUNKTE bleiben zwei
Punkte — bei 16 px liest man daran ein Gesicht.

Deshalb ersetzt dieses Werkzeug fuer die 16er-Fassung die beiden Augenpfade
durch zwei Ellipsen. Es ist die EINZIGE Abweichung, sie steht hier und nicht
in einer zweiten handgezeichneten Datei — sonst waeren es zwei Figuren, die
irgendwann verschieden aussehen.

DIE KACHEL BEKOMMT EINEN GRUND, weil ein Telefon das Symbol auf eine eigene
Flaeche legt; ein durchsichtiges Bild waere dort ein Loch. Creme (#FFF7EC)
ist der Hausgrund der Oberflaeche.

══ WAS ES BRAUCHT ═════════════════════════════════════════════════════════
`rsvg-convert` (Paket librsvg) und Pillow. Beides ist auf diesem Rechner da;
auf der Box laeuft es NICHT — die Bilder werden hier gebaut und ausgeliefert.

══ AUFRUF ═════════════════════════════════════════════════════════════════
    python3 tools/favicon-bauen.py
    python3 tools/favicon-bauen.py --pruefen   # Ende 1, wenn etwas fehlt
                                               # oder nicht mehr zur Quelle passt
"""
import hashlib
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

WURZEL = pathlib.Path(__file__).resolve().parent.parent
QUELLE = WURZEL / 'NewDesign/bilder/favicon.svg'
ORDNER = WURZEL / 'NewDesign/bilder'

# Der Hausgrund der neuen Oberflaeche (`--bg` im Satz „Creme", app.css).
KACHELGRUND = '#FFF7EC'

# Die fertige App-Kachel des Betreibers (10.08.2026). Sie schlaegt fuer den
# Telefon-Startbildschirm die aus dem SVG gebaute Fassung; die Begruendung
# samt Messung steht unten bei der Erzeugung.
KACHEL_QUELLE = WURZEL / 'NewDesign/bilder/quellen/Meshy_AI_mixpi-favicon.png'

# DIE ZWEI PUNKTE, die bei 16 px an die Stelle der Augenboegen treten.
# Ihre Mitten liegen auf denen der Boegen; nachgerechnet aus den Pfaden
# „M11.9 19.3 q1.2 1.6 2.4 0" und „M17.7 19.3 q1.2 1.6 2.4 0": die Sehne
# geht von x bis x+2,4, der Bogen sinkt um etwa 0,8 — Mitte also bei
# x+1,2 / 19,3+0,6.
PUNKTE = (
    '    <ellipse cx="13.1" cy="19.9" rx="1.25" ry="1.05" fill="#00032B"/>\n'
    '    <ellipse cx="18.9" cy="19.9" rx="1.25" ry="1.05" fill="#00032B"/>\n'
)


def augen_zu_punkten(svg):
    """Die beiden Augenpfade gegen zwei Ellipsen tauschen.

    ES WIRFT, WENN ES SIE NICHT FINDET, statt still nichts zu tun: Ein
    Werkzeug, das die 16er-Fassung unveraendert durchreicht, weil sich der
    Pfad geaendert hat, liefert genau den grauen Balken aus, wegen dem es
    diese Funktion gibt.
    """
    muster = re.compile(r'[ \t]*<path d="M1[0-9]\.[0-9] 19\.3 q1\.2 1\.6 2\.4 0"[^/]*/>\n')
    treffer = muster.findall(svg)
    if len(treffer) != 2:
        raise SystemExit(
            f'FEHLER: In {QUELLE.name} wurden {len(treffer)} Augenpfade gefunden, erwartet sind 2.\n'
            '       Wurde die Quelle umgezeichnet? Dann gehoert das Muster hier mit —\n'
            '       und die 16er-Fassung gehoert neu angesehen (sie ist der Grund fuer diesen Schritt).'
        )
    for t in treffer:
        svg = svg.replace(t, '', 1)
    return svg.replace('  </g>', PUNKTE + '  </g>', 1)


# ── DIE VERWALTUNG BEKOMMT DAS SYMBOL ALS DATA-URI ────────────────────────
#
# WARUM NICHT ALS DATEI: src/frontend-admin/angular.json hat GAR KEINE
# `assets`-Angabe — der Bau kopiert keine statischen Dateien. Eine
# favicon.svg dort hinzulegen hiesse, die Baukonfiguration zu aendern und
# einen Ordner einzufuehren, in dem sonst nichts liegt.
#
# Die Seite trug ohnehin schon `href="data:,"` (ein leeres Bild, damit der
# Browser nicht vergeblich nach /admin/favicon.ico fragt). Es ist also
# dieselbe Bauart, nur mit Inhalt: rund 1,2 kB im HTML gegen einen zweiten
# Abruf. Bei einer Seite, die ohnehin gebaut wird, ist das der bessere Handel.
#
# UND ES BLEIBT EINE QUELLE: Dieses Werkzeug schreibt die Zeile, und
# `--pruefen` merkt, wenn sie nicht mehr zu favicon.svg passt.
ADMIN_HTML = WURZEL / 'src/frontend-admin/src/index.html'
MARKE_AUF = '<!-- MixPi-Symbol: erzeugt von tools/favicon-bauen.py, nicht von Hand aendern -->'


def data_uri(svg):
    """Das Symbol als `data:`-Adresse fuer die Verwaltung.

    ══ SEIT DEM 10.08.2026 IST ES DIE KACHEL, NICHT MEHR DAS SVG ═══════════
    Betreiber: „das fav icon ist auch für die software auf der box." Die
    Verwaltung ist Teil davon — sie war die DRITTE Stelle mit einem eigenen
    Zeichen (Installer: Kachel, Box-Reiter: Kachel, Verwaltung: Zeichnung).

    DER PREIS IST GEMESSEN, und er ist hoeher als geschaetzt: als URL-kodiertes
    SVG waren es rund 1,2 kB, als base64-PNG in 48 px sind es 6,6 kB. Hier
    stand erst „etwa 3 kB" — geschaetzt, nicht nachgesehen. Der Handel bleibt
    trotzdem richtig: fuenf Kilobyte einmal, gegen drei verschiedene Zeichen
    fuer ein Geraet. Warum ueberhaupt eine data:-Adresse und keine Datei,
    steht oben.

    NICHT base64 WAR DIE REGEL, solange es ein SVG war: url-kodierter Text ist
    kuerzer als seine base64-Fassung und man kann ihn lesen. Bei einem PNG
    gilt das Gegenteil — Bilddaten sind keine Zeichen, und url-kodiert waeren
    sie laenger.
    """
    if KACHEL_QUELLE.is_file():
        import base64
        import io
        from PIL import Image
        speicher = io.BytesIO()
        Image.open(KACHEL_QUELLE).convert('RGBA').resize(
            (48, 48), Image.Resampling.LANCZOS).save(speicher, 'PNG', optimize=True)
        return 'data:image/png;base64,' + base64.b64encode(speicher.getvalue()).decode()
    # Der Rueckweg ohne die Kachel: das SVG, wie bisher.
    kern = re.sub(r'<!--.*?-->', '', svg, flags=re.S)
    kern = re.sub(r'\s*\n\s*', ' ', kern).strip()
    kern = re.sub(r'>\s+<', '><', kern)
    for a, b in (('%', '%25'), ('#', '%23'), ('<', '%3C'), ('>', '%3E'), ('"', "'")):
        kern = kern.replace(a, b)
    return 'data:image/svg+xml,' + kern


def admin_zeile_setzen(svg, schreiben=True):
    """Die eine Zeile in der Verwaltung setzen — und melden, ob sie schon stimmte."""
    text = ADMIN_HTML.read_text(encoding='utf-8')
    zeile = f'    {MARKE_AUF}\n    <link rel="icon" href="{data_uri(svg)}" />'
    muster = re.compile(r'[ \t]*(?:' + re.escape(MARKE_AUF) + r'\n[ \t]*)?<link rel="icon"[^>]*>')
    if not muster.search(text):
        raise SystemExit(f'FEHLER: In {ADMIN_HTML.name} steht keine <link rel="icon">-Zeile mehr.')
    neu = muster.sub(lambda _: zeile, text, count=1)
    passt = neu == text
    if schreiben and not passt:
        ADMIN_HTML.write_text(neu, encoding='utf-8')
    return passt


def malen(svg_text, breite, ziel):
    with tempfile.NamedTemporaryFile('w', suffix='.svg', delete=False, encoding='utf-8') as f:
        f.write(svg_text)
        weg = f.name
    try:
        lauf = subprocess.run(
            ['rsvg-convert', '-w', str(breite), '-h', str(breite), weg, '-o', str(ziel)],
            capture_output=True, text=True,
        )
        if lauf.returncode:
            # DIE MELDUNG VON rsvg STATT EINES STAPELABZUGS. Sie sagt Zeile und
            # Spalte; ein `check=True` warf stattdessen zwanzig Zeilen Python,
            # in denen der eigentliche Satz gar nicht vorkam. Gemessen am
            # 08.08.2026 an einem „--" im XML-Kommentar, das die Quelle
            # unlesbar machte: Der Grund stand nur in stderr.
            raise SystemExit(
                f'FEHLER: rsvg-convert kam mit {QUELLE.name} bei {breite} px nicht zurecht.\n'
                + '\n'.join('       ' + z for z in lauf.stderr.strip().split('\n'))
            )
    finally:
        pathlib.Path(weg).unlink(missing_ok=True)


def bauen(ordner):
    from PIL import Image

    if not shutil.which('rsvg-convert'):
        raise SystemExit('FEHLER: rsvg-convert fehlt (Paket librsvg). Ohne das geht hier nichts.')
    quelle = QUELLE.read_text(encoding='utf-8')
    klein = augen_zu_punkten(quelle)

    gemacht = {}
    # ══ EIN ZEICHEN, UEBERALL DASSELBE ══════════════════════════════════════
    #
    # Betreiber, 10.08.2026: „das fav icon ist auch für die software auf der
    # box."
    #
    # Damit ist die Frage entschieden, und zwar richtig. Es waere sonst so
    # gekommen: der Karteninstaller traegt die lila Kachel, der Reiter der
    # Box-Oberflaeche die gezeichnete Figur ohne Grund, und die Verwaltung eine
    # dritte Fassung als data:-Adresse. Drei Zeichen fuer ein Geraet — und
    # niemand haette es gemerkt, weil sie nie nebeneinander stehen.
    #
    # DER PREIS IST GEMESSEN UND ER IST KLEIN. Am 10.08.2026 beide Fassungen
    # bei 16, 32 und 48 px nebeneinander gerendert:
    #   * 32 und 48: die Kachel gewinnt klar. Sie hat einen gefuellten Grund,
    #     also im Reiterstreifen ueberhaupt eine Silhouette, und sie traegt den
    #     Mund, den die Zeichnung unterhalb von 48 px verliert.
    #   * 16: das Gesicht der Kachel zerfaellt. Aber ein Reiter wird nicht
    #     GELESEN, er wird GEFUNDEN — und ein lila Block faellt zwischen zwanzig
    #     weissen Reitern auf, wo eine blasse Strichzeichnung untergeht.
    #
    # Die alte Sorge in favicon.svg („VIOLETT faellt aus, die Kopfhoerer
    # verschwinden im Grund") galt fuer JENE Zeichnung mit duennem Umriss. An
    # der Kachel nachgemessen: Ohrmuschel gegen Grund 4,68:1, Gesicht gegen
    # Grund 4,41:1 — beides ueber der 3:1-Schwelle fuer getrennte Flaechen.
    #
    # favicon.svg BLEIBT IM BAUM. Sie ist die vorige Fassung samt ihrer
    # Herleitung, und wer die Kachel je zuruecknehmen will, findet sie dort —
    # geloescht waere sie eine Entscheidung, die niemand mehr nachlesen kann.
    kachel = Image.open(KACHEL_QUELLE).convert('RGBA') if KACHEL_QUELLE.is_file() else None
    for g in (16, 32, 48):
        if kachel is not None:
            kachel.resize((g, g), Image.Resampling.LANCZOS).save(
                ordner / f'favicon-{g}.png', 'PNG', optimize=True)
            gemacht[f'favicon-{g}.png'] = f'{g} px aus {KACHEL_QUELLE.name}'
        else:
            # Der Rueckweg ohne die Kachel: wie bisher aus dem SVG, samt der
            # Punkte-Fassung fuer 16 px.
            malen(klein if g == 16 else quelle, g, ordner / f'favicon-{g}.png')
            gemacht[f'favicon-{g}.png'] = ('aus der 16er-Fassung (Punkte statt Boegen)'
                                           if g == 16 else 'aus der Quelle')

    # DIE .ico TRAEGT ALLE DREI. Pillow legt sie in eine Datei; Windows und
    # aeltere Browser holen sich daraus die Groesse, die sie brauchen.
    bilder = [Image.open(ordner / f'favicon-{g}.png').convert('RGBA') for g in (16, 32, 48)]
    bilder[2].save(ordner / 'favicon.ico', format='ICO', sizes=[(16, 16), (32, 32), (48, 48)])
    gemacht['favicon.ico'] = '16 + 32 + 48 in einer Datei'

    # DIE KACHEL: 180 px auf cremefarbenem Grund, mit Luft am Rand — Telefone
    # runden die Ecken selbst ab, und was zu dicht am Rand steht, wird
    # angeschnitten.
    # ══ DIE TELEFONKACHEL KOMMT JETZT AUS EINER EIGENEN QUELLE ══════════════
    #
    # Betreiber, 10.08.2026: „ich habe auch für die software ein fav icon
    # abgelegt." Was er abgelegt hat, ist eine fertige App-Kachel: lila,
    # abgerundete Ecken, der MixPi-Kopf darauf.
    #
    # SIE IST FUER DIESEN PLATZ BESSER ALS DAS, WAS HIER STAND — und zwar
    # gemessen, nicht gefunden:
    #   Kachelgrund   #8953FA
    #   Ohrmuschel gegen Grund   4,68:1
    #   Gesicht    gegen Grund   4,41:1
    # (Schwelle fuer „zwei getrennte Flaechen", WCAG grafische Objekte: 3:1.)
    #
    # DAMIT IST AUCH DIE ALTE SORGE ERLEDIGT, die oben in favicon.svg steht:
    # „VIOLETT faellt aus. Der Grund hat die Farbe der Kopfhoerer, und Buegel
    # und Ohrmuscheln verschwinden darin." Das galt fuer DIESE Zeichnung, wo
    # die Kopfhoerer violett mit duennem Umriss sind. Die neue Kachel loest es
    # mit einem dicken schwarzen Umriss — dieselbe Farbe, trotzdem getrennt.
    #
    # DER REITER KOMMT AUS DERSELBEN QUELLE — seit demselben Tag. Der Block
    # oben („EIN ZEICHEN, UEBERALL DASSELBE") hat 16/32/48 mit auf die Kachel
    # gezogen; die Schleife davor liest sie aus KACHEL_QUELLE und faellt nur
    # ohne diese Datei aufs SVG zurueck. Hier unten steht darum nichts
    # Eigenes mehr, sondern nur, was das Telefon zusaetzlich braucht: 180 px
    # statt 48 — und einen gefuellten Grund, den die Kachel schon mitbringt.
    #
    # DIE MESSUNG, DIE FRUEHER FUER ZWEI QUELLEN SPRACH, GILT WEITER — sie
    # traegt die Entscheidung nur nicht mehr. Am 10.08.2026 nebeneinander
    # gerendert und angesehen: bei 16 px zerfaellt die Kachel zu einem
    # violetten Fleck mit einem hellen Schemen darin, waehrend die Zeichnung
    # dort noch ein Gesicht zeigt. Daraus folgte zuerst „ein Telefon zeigt
    # 180 px, ein Reiter 16 — zwei verschiedene Aufgaben", also zwei Quellen.
    # Dagegen steht oben das staerkere Argument: ein Reiter wird nicht
    # GELESEN, sondern GEFUNDEN, und der Satz des Betreibers verlangt EIN
    # Zeichen fuer das ganze Geraet. Wer die 16er je zurueckholen will, nimmt
    # KACHEL_QUELLE weg — dann malt der `else`-Zweig der Schleife sie wieder
    # aus dem SVG, mit Punkten statt Augenboegen.
    if KACHEL_QUELLE.is_file():
        Image.open(KACHEL_QUELLE).convert('RGB').resize(
            (180, 180), Image.Resampling.LANCZOS).save(ordner / 'mixpi-kachel.png')
        gemacht['mixpi-kachel.png'] = f'180 px aus {KACHEL_QUELLE.name} (lila Kachel)'
    else:
        # Der Rueckweg, falls die Quelle fehlt: wie bisher aus dem SVG.
        malen(quelle, 148, ordner / '.kachel-roh.png')
        figur = Image.open(ordner / '.kachel-roh.png').convert('RGBA')
        kachel = Image.new('RGBA', (180, 180), KACHELGRUND)
        kachel.alpha_composite(figur, (16, 16))
        kachel.convert('RGB').save(ordner / 'mixpi-kachel.png')
        (ordner / '.kachel-roh.png').unlink(missing_ok=True)
        gemacht['mixpi-kachel.png'] = f'180 px auf {KACHELGRUND}, 16 px Luft ringsum'

    # NUR wenn wirklich in den Baum geschrieben wird — beim `--pruefen`-Lauf
    # geht das Malen in einen Wegwerfordner, und die Verwaltung darf dabei
    # nicht angefasst werden.
    if ordner == ORDNER:
        gemacht['src/frontend-admin/src/index.html'] = (
            'Symbol als data:-Adresse stand schon richtig'
            if admin_zeile_setzen(quelle) else 'Symbol als data:-Adresse eingesetzt'
        )
    return gemacht


def pruefen():
    """Steht neben der Quelle noch das, was aus ihr folgt?

    Es baut in einen Wegwerfordner und vergleicht BYTEWEISE. Ein Vergleich
    ueber Dateidatum ginge auch — und waere die uebliche Luege: `git` setzt
    beim Auschecken alle Datumsangaben neu, und dann waere jedes Bild „alt".
    """
    with tempfile.TemporaryDirectory() as t:
        neu = pathlib.Path(t)
        bauen(neu)
        schlecht = 0
        for datei in sorted(p.name for p in neu.iterdir()):
            alt = ORDNER / datei
            if not alt.exists():
                print(f'NEIN  {datei} fehlt in NewDesign/bilder')
                schlecht += 1
                continue
            a = hashlib.sha256(alt.read_bytes()).hexdigest()[:12]
            b = hashlib.sha256((neu / datei).read_bytes()).hexdigest()[:12]
            if a != b:
                print(f'NEIN  {datei} passt nicht mehr zu favicon.svg ({a} gegen {b})')
                schlecht += 1
            else:
                print(f'ok    {datei}  {a}')
        if admin_zeile_setzen(QUELLE.read_text(encoding='utf-8'), schreiben=False):
            print('ok    src/frontend-admin/src/index.html traegt dasselbe Symbol')
        else:
            print('NEIN  src/frontend-admin/src/index.html traegt ein anderes Symbol als favicon.svg')
            schlecht += 1
        print('\nok    alle Groessen folgen der Quelle' if not schlecht
              else f'\n{schlecht} Abweichung(en) — python3 tools/favicon-bauen.py baut sie neu.')
        return schlecht


if __name__ == '__main__':
    if '--pruefen' in sys.argv[1:]:
        sys.exit(1 if pruefen() else 0)
    for name, wie in bauen(ORDNER).items():
        print(f'  {name:20} {wie}')
    print(f'\nGeschrieben nach {ORDNER.relative_to(WURZEL)}/')
