#!/usr/bin/env python3
"""Die Bilder fuer den Ein-Knopf-Installer auf Fenstergroesse bringen.

══ WOZU ═══════════════════════════════════════════════════════════════════
Betreiber, 08.08.2026: „ich habe auch noch nette bilder die würde ich dann in
der 2ten runde einbauen" — und dann: „ich habe auch bilder ein mixpi der pi4
vs pi 5, dann der install pi und dann der sd karte in pi mixpi."

Die Quellbilder liegen als 1254x1254 in NewDesign/bilder/quellen/. So gross
gehoeren sie nicht in eine Oberflaeche: Tkinter kann Bilder nur GANZZAHLIG
verkleinern (`subsample`), aus 1254 wuerde also 627, 418 oder 313 — nie die
Groesse, die gebraucht wird, und jedes Mal mit harten Kanten.

Dieses Werkzeug rechnet sie EINMAL sauber herunter (Lanczos, mit Pillow) und
legt sie neben den Installer. Die Oberflaeche laedt dann nur noch fertige
Dateien und braucht kein Pillow — genau wie der Agent kein pip braucht.

══ WARUM NICHT DIE QUELLEN AUSLIEFERN ════════════════════════════════════
Fuenf Bilder zu je 1254x1254 sind rund 8 MB. Auf 260 px sind es zusammen
keine 300 kB. Ein Installer, der acht Megabyte Bilder mitschleppt, um sie
dann kleinzurechnen, laedt langsamer und sieht schlechter aus.

══ AUFRUF ════════════════════════════════════════════════════════════════
    python3 remote-step-installer/tools/sdstart-bilder.py
    python3 remote-step-installer/tools/sdstart-bilder.py --pruefen
"""
import hashlib
import pathlib
import sys

HIER = pathlib.Path(__file__).resolve().parent
INSTALLER = HIER.parent
WURZEL = INSTALLER.parent
QUELLEN = WURZEL / 'NewDesign' / 'bilder' / 'quellen'
ZIEL = INSTALLER / 'dateien'

# ══ WELCHES BILD WOFUER ═════════════════════════════════════════════════════
#
# Der Name links ist der, unter dem die Oberflaeche es sucht — er sagt, an
# WELCHER STELLE es haengt, nicht was darauf zu sehen ist. So kann ein Bild
# getauscht werden, ohne dass die Oberflaeche etwas davon merkt.
#
# 260 PIXEL, und zwar fuer alle: Das Fenster ist 720 breit, das Bild sitzt
# ueber dem Text und darf ihn nicht verdraengen. Bei 260 bleibt darunter Platz
# fuer zwei Zeilen Ueberschrift und den Knopf, ohne dass gerollt werden muss.
BILDER = {
    'willkommen': ('Meshy_AI_mixpi-hello-multilingual.png', 230),  # Hallo/Hello/Xin chào
    'board':   ('Meshy_AI_mixpi-raspi4-vs-5-final.png', 230),   # Welcher Pi?
    'wlan':    ('Meshy_AI_mixpi-wifi-setup.png', 200),          # In welches WLAN?
    'name':    ('Meshy_AI_mixpi-login.png', 200),               # Passwort + Name
    'karte':   ('Meshy_AI_mixpi-tap-install.png', 230),         # Karte + Knopf
    # ES WIRD GESCHRIEBEN. Betreiber, 10.08.2026: „ich hab ein bild für das
    # schreiben flashing sd card im quell ordner." Es passt besser als das
    # bisherige „installing-pi-board": darauf war ein Platinenbild zu sehen,
    # hier steckt der MixPi die Karte in einen Laptop, auf dessen Schirm ein
    # Balken laeuft — genau das, was die Seite darunter auch tut.
    # 230 STATT 190, weil es das erste Bild im QUERFORMAT ist (1536x1024): bei
    # gleicher Kantenlaenge ist es nur zwei Drittel so hoch wie ein
    # quadratisches und wirkt sonst versehentlich klein.
    'lauf':    ('Meshy_AI_mixpi-flashing-sdcard.png', 230),     # es wird geschrieben
    'fertig':  ('Meshy_AI_mixpi-insert-sd-raspi.png', 230),     # Karte in den Pi
    'geglueckt': ('Meshy_AI_mixpi-install-success.png', 190),   # geschafft
}

# Die Kante, in der freigestellt wird, BEVOR auf die Zielgroesse gerechnet wird.
# Gross genug, dass das Zuschneiden und das anschliessende Verkleinern nichts
# kosten — und klein genug, dass acht Bilder in Sekunden durchlaufen.
ARBEITSKANTE = 900

# ══ DAS FENSTERSYMBOL ═══════════════════════════════════════════════════════
#
# Betreiber, 10.08.2026: „ich habe auch für die software ein fav icon abgelegt."
#
# Bis dahin trug das Installerfenster die TK-FEDER — das Vorgabesymbol von
# Tkinter. In der Fensterleiste stand also neben „MixPiBox — Karte schreiben"
# das Zeichen einer Programmierbibliothek.
#
# DIESES BILD WIRD NICHT FREIGESTELLT, und das ist der Unterschied zu allen
# anderen hier: Die Kachel IST das Zeichen, samt lila Grund und runden Ecken.
# Freigestellt bliebe ein Kopf ohne Silhouette — und ein Symbol ohne Umriss
# verschwindet in jeder Leiste.
SYMBOL_QUELLE = 'Meshy_AI_mixpi-favicon.png'
# 256 fuer die Fensterleiste (Tk skaliert selbst herunter), und die .ico traegt
# die Groessen, die Windows fuer Taskleiste und Alt-Tab wirklich zieht.
SYMBOL_PNG = 256
SYMBOL_ICO = (16, 24, 32, 48, 64, 128, 256)


# Der Hausgrund der Oberflaeche — derselbe Wert wie GRUND in sdstart.py und
# `--bg` im Satz „Creme" (NewDesign/app.css).
GRUND = (0xFF, 0xF7, 0xEC)

# DIE QUELLEN TRAGEN EIN SCHACHBRETT, und zwar als echte Bildpunkte: #FEFEFE
# gegen #F0F0F0 im Raster. Das ist das Muster, mit dem Bildprogramme
# Transparenz ANZEIGEN — hier ist es hineingerendert. Ungefiltert stand es im
# Fenster und sah aus wie ein kaputtes Bild (am 08.08.2026 im Bildschirmfoto
# gesehen, nicht vermutet).
#
# 70 IST DIE TOLERANZ FUER SCHACHBRETT-QUELLEN. Sie steht so schon bei den 78
# Profilbildern: Ein Schachbrett ist nicht EINE Grundfarbe, sondern zwei, die
# sich um wenige Stufen unterscheiden — mit der Vorgabe bleibt die haerte
# Haelfte stehen.
TOLERANZ = 70


def bauen(ziel: pathlib.Path) -> dict:
    import subprocess
    import tempfile

    from PIL import Image

    freistellen = WURZEL / 'tools' / 'bilder-freistellen.py'
    ziel.mkdir(parents=True, exist_ok=True)
    gemacht = {}
    for name, (datei, breite) in BILDER.items():
        q = QUELLEN / datei
        if not q.is_file():
            print(f'  FEHLT  {datei} — {name} bleibt ohne Bild')
            continue
        with tempfile.TemporaryDirectory() as t:
            # DAS FREISTELLEN WIRD NICHT NACHGEBAUT. tools/bilder-freistellen.py
            # ist das Werkzeug, mit dem die 78 Profilbilder entstanden sind,
            # samt allem, was dort schon einmal schiefging (getilgte Taschen,
            # geretteter Innenraum). Eine zweite Fassung derselben Rechnung
            # waere eine zweite Gelegenheit, denselben Fehler anders zu machen.
            # GROSS FREISTELLEN, KLEIN RECHNEN — und zwar in dieser Reihenfolge.
            # Warum nicht gleich in der Zielgroesse, siehe direkt darunter.
            lauf = subprocess.run(
                ['python3', str(freistellen), str(q), '--ziel', t,
                 '--groessen', str(ARBEITSKANTE), '--toleranz', str(TOLERANZ)],
                capture_output=True, text=True, timeout=300)
            frei = pathlib.Path(t) / datei
            if lauf.returncode != 0 or not frei.is_file():
                print(f'  FEHLT  Freistellen von {datei} misslang:'
                      f' {(lauf.stderr or lauf.stdout).strip()[:160]}')
                continue
            fig = Image.open(frei).convert('RGBA')

        # ══ DAS QUADRAT WIEDER ABSCHNEIDEN ══════════════════════════════════
        #
        # `bilder-freistellen.py` fuellt sein Ergebnis auf ein QUADRAT auf, und
        # das ist dort richtig: es ist das Werkzeug der 78 Profilbilder, und ein
        # Kachelraster mit unterschiedlich hohen Kacheln wirkt unruhig.
        #
        # HIER IST ES FALSCH. Am 10.08.2026 kam vom Betreiber ein Bild im
        # Querformat („flashing sdcard", 1536x1024). Quadratisch aufgefuellt und
        # auf 200 gerechnet, sind davon nur 200x133 Bild — ein Drittel der Hoehe
        # ist leerer Hausgrund, und das Bild sieht neben den quadratischen aus
        # wie versehentlich zu klein geraten.
        #
        # Also: die Fuellung wieder abschneiden (der Alphakanal sagt genau, wo
        # die Figur aufhoert) und SELBST auf die Zielkante rechnen — die
        # LAENGSTE Seite bekommt sie. Quadratische Quellen aendern sich dadurch
        # nicht, Querformat behaelt sein Verhaeltnis.
        kasten = fig.getbbox()
        if kasten:
            fig = fig.crop(kasten)
        b, h = fig.size
        faktor = breite / max(b, h)
        fig = fig.resize((max(1, round(b * faktor)), max(1, round(h * faktor))),
                         Image.Resampling.LANCZOS)

        # AUF DEN HAUSGRUND SETZEN statt durchsichtig zu lassen: Tkinter kennt
        # keine Transparenz in einem Canvas-Bild — ein durchsichtiges PNG
        # bekaeme dort einen schwarzen Grund.
        blatt = Image.new('RGBA', fig.size, GRUND + (255,))
        blatt.alpha_composite(fig)
        weg = ziel / f'sdstart-{name}.png'
        blatt.convert('RGB').save(weg, optimize=True)
        gemacht[weg.name] = (f'{blatt.size[0]}x{blatt.size[1]} px, freigestellt, '
                             f'auf Hausgrund')
    gemacht.update(symbol_bauen(ziel))
    return gemacht


def symbol_bauen(ziel: pathlib.Path) -> dict:
    """Das Fenstersymbol — als PNG fuer Tk und als .ico fuer Windows."""
    from PIL import Image

    q = QUELLEN / SYMBOL_QUELLE
    if not q.is_file():
        print(f'  FEHLT  {SYMBOL_QUELLE} — das Fenster behaelt die Tk-Feder')
        return {}
    kachel = Image.open(q).convert('RGBA')
    gemacht = {}

    png = ziel / 'sdstart-symbol.png'
    kachel.resize((SYMBOL_PNG, SYMBOL_PNG), Image.Resampling.LANCZOS).save(
        png, 'PNG', optimize=True)
    gemacht[png.name] = f'{SYMBOL_PNG}x{SYMBOL_PNG} px, Fenstersymbol (Tk)'

    # ZWEI DATEIEN FUER EINE SACHE, und der Grund ist Windows: `iconphoto`
    # setzt dort das Symbol im Fensterrahmen, aber die TASKLEISTE zieht sich
    # ihres aus einer .ico. Ein Fenster mit MixPi-Kopf und einer Tk-Feder
    # daneben in der Leiste waere halb erledigt.
    ico = ziel / 'sdstart-symbol.ico'
    # Pillow rechnet die Groessen selbst herunter; angegeben wird, welche
    # drinstehen sollen.
    kachel.save(ico, 'ICO', sizes=[(g, g) for g in SYMBOL_ICO])
    gemacht[ico.name] = 'Fenstersymbol (Windows-Taskleiste), ' + \
                        '+'.join(str(g) for g in SYMBOL_ICO)
    return gemacht


def pruefen() -> int:
    import tempfile
    with tempfile.TemporaryDirectory() as t:
        neu = pathlib.Path(t)
        bauen(neu)
        schlecht = 0
        for datei in sorted(p.name for p in neu.iterdir()):
            alt = ZIEL / datei
            if not alt.exists():
                print(f'NEIN  {datei} fehlt in dateien/')
                schlecht += 1
                continue
            a = hashlib.sha256(alt.read_bytes()).hexdigest()[:12]
            b = hashlib.sha256((neu / datei).read_bytes()).hexdigest()[:12]
            if a != b:
                print(f'NEIN  {datei} passt nicht mehr zur Quelle ({a} gegen {b})')
                schlecht += 1
            else:
                print(f'ok    {datei}  {a}')
        print('\nok    alle Bilder folgen ihren Quellen' if not schlecht
              else f'\n{schlecht} Abweichung(en) — dieses Werkzeug ohne Schalter baut sie neu.')
        return schlecht


if __name__ == '__main__':
    if '--pruefen' in sys.argv[1:]:
        sys.exit(1 if pruefen() else 0)
    for name, wie in bauen(ZIEL).items():
        print(f'  {name:26} {wie}')
    print(f'\nGeschrieben nach {ZIEL.relative_to(WURZEL)}/')
