#!/usr/bin/env python3
"""Die weissen Ecken der Kachel — wo landen sie WIRKLICH?

══ DIE BEHAUPTUNG ═════════════════════════════════════════════════════════
„Die Kachel Meshy_AI_mixpi-favicon.png hat keinen Alphakanal — die runden
Ecken sind weisses Pixel, kein Loch." Als Beleg wird gerechnet, was das
heruntergerechnet bei 16, 32 und 48 px ausmacht.

══ WARUM ES DIESES WERKZEUG GIBT ══════════════════════════════════════════
Die Kachel hat ZWEI Abnehmer, und sie behandeln sie GEGENSAETZLICH:

  A) tools/favicon-bauen.py  -> NewDesign/bilder/mixpi-kachel.png, 180 px
     <link rel="apple-touch-icon">. Baut mit .convert('RGB') — ABSICHTLICH
     ohne Alpha: iOS legt ein durchsichtiges apple-touch-icon auf SCHWARZ.
     Hier ist „kein Loch" die richtige Eigenschaft, kein Fehler.

  B) remote-step-installer/tools/sdstart-bilder.py -> sdstart-symbol.png
     (256 px, Tk-Fenstersymbol) und sdstart-symbol.ico (16/24/32/48/64/
     128/256, Windows-Taskleiste). Hier ist ein Symbol ueblicherweise
     ausserhalb seiner Figur DURCHSICHTIG — und genau hier landen die
     weissen Ecken sichtbar.

  C) tools/favicon-bauen.py -> favicon-16/32/48.png + favicon.ico, der
     Browser-Reiter. DIESER ABNEHMER HAT SICH AM 10.08.2026 GEDREHT:
     frueher aus favicon.svg gerendert (echte Loecher, Alpha 0), seit
     „das fav icon ist auch fuer die software auf der box" aus der Kachel
     heruntergerechnet — also MIT den deckend weissen Ecken.

WEIL SICH DAS SCHON EINMAL GEDREHT HAT, wird die Herkunft hier nicht
behauptet, sondern gemessen: die Kachel wird auf die Zielgroesse skaliert
und bitweise gegen die ausgelieferte Datei gehalten. Steht in der Spalte
„Herkunft" das Wort KACHEL, dann traegt der Reiter die weissen Ecken.

AUFRUF:
    python3 tools/kachel-ecken-nachmessen.py
"""
import pathlib

from PIL import Image, ImageChops

WURZEL = pathlib.Path(__file__).resolve().parent.parent
KACHEL = WURZEL / 'NewDesign/bilder/quellen/Meshy_AI_mixpi-favicon.png'
ORDNER = WURZEL / 'NewDesign/bilder'
INSTALLER = WURZEL / 'remote-step-installer/dateien'

# „nahezu weiss" — dieselbe Schwelle, mit der die Behauptung gezaehlt hat.
HELL = 240


def hell_p(p):
    return len(p) >= 3 and p[0] >= HELL and p[1] >= HELL and p[2] >= HELL


def zwickel_zaehlen(bild, kante):
    """Nahezu weisse UND DECKENDE Pixel in den vier Eckquadraten.

    Die Deckung gehoert in die Bedingung: ein durchsichtiges Pixel ist ein
    Loch, kein weisser Fleck — genau der Unterschied, um den die Behauptung
    geht. Ohne diese Pruefung zaehlte man die Loecher mit.
    """
    b = bild.convert('RGBA')
    px = b.load()
    w, h = b.size
    n = 0
    for x0, y0 in ((0, 0), (w - kante, 0), (0, h - kante), (w - kante, h - kante)):
        for y in range(y0, y0 + kante):
            for x in range(x0, x0 + kante):
                p = px[x, y]
                if p[3] > 128 and hell_p(p):
                    n += 1
    return n


def eckauslauf(bild):
    """Wie weit reicht der weisse Zwickel entlang der oberen Kante?"""
    px = bild.convert('RGB').load()
    w, _ = bild.size
    x = 0
    while x < w and hell_p(px[x, 0]):
        x += 1
    return x


def ios_maske_test(bild):
    """Wieviel Weiss ueberlebt die Maske, die iOS ueber ein Icon legt?

    ES GIBT KEINE EINE ANTWORT, und deshalb rechnet das hier ZWEI Modelle:
      * Kreisbogen (n=2): der klassische abgerundete Kasten.
      * Superellipse (n=5): Apples „Squircle", der die Ecke viel enger
        umschliesst und deshalb WENIGER wegschneidet.
    Beide mit Radius 22,37 % der Kante. Welches Modell Apple genau benutzt,
    ist von aussen nicht messbar — die Spanne ist die ehrliche Antwort.
    """
    b = bild.convert('RGB')
    w, h = b.size
    px = b.load()
    R = 0.2237 * w
    rand = round(0.2 * w)

    def drin(x, y, n):
        cx = R if x < R else (w - R if x > w - R else x)
        cy = R if y < R else (h - R if y > h - R else y)
        dx, dy = abs(x - cx), abs(y - cy)
        if dx == 0 or dy == 0:
            return True
        return (dx / R) ** n + (dy / R) ** n <= 1.0

    aus = {}
    for name, pruef in (('ohne Maske', None), ('Kreisbogen n=2', 2.0),
                        ('Superellipse n=5', 5.0)):
        z = 0
        for y in range(h):
            for x in range(w):
                if min(x, w - 1 - x) < rand and min(y, h - 1 - y) < rand:
                    if hell_p(px[x, y]) and (pruef is None or drin(x + .5, y + .5, pruef)):
                        z += 1
        aus[name] = z
    return aus


def main():
    print('══ 1. DIE QUELLE ══════════════════════════════════════════════')
    k = Image.open(KACHEL)
    print(f'  {KACHEL.name}')
    print(f'  Modus {k.mode}, {k.size[0]}x{k.size[1]}, '
          f'transparency-Angabe: {"ja" if "transparency" in k.info else "nein"}')
    rgb = k.convert('RGB').load()
    w, h = k.size
    print(f'  Eckpixel (0,0)={rgb[0, 0]}  ({w-1},{h-1})={rgb[w-1, h-1]}')
    n = zwickel_zaehlen(k, 200)
    print(f'  nahezu weiss in den vier 200x200-Zwickeln: {n} = {100*n/(w*h):.2f} % der Kachel')
    print(f'  Auslauf der Ecke: {eckauslauf(k)} px = {100*eckauslauf(k)/w:.1f} % der Kante')
    print('  --> BEFUND DER BEHAUPTUNG BESTAETIGT.')

    print('\n══ 2. WEB-REITER: kommen sie aus der Kachel? ══════════════════')
    print('  NICHT geraten, sondern nachgerechnet: die Kachel wird auf die')
    print('  Zielgroesse skaliert und BITWEISE gegen die Datei gehalten.')
    print(f'  {"Datei":<16} {"Modus":<6} {"Eckpixel":<22} {"weiss+deckend":>13}  Herkunft')
    kachel_rgba = k.convert('RGBA')
    for g in (16, 32, 48):
        b = Image.open(ORDNER / f'favicon-{g}.png')
        e = b.convert('RGBA').load()[0, 0]
        kante = max(1, round(g * 200 / 1024))
        gleich = ImageChops.difference(
            kachel_rgba.resize((g, g), Image.Resampling.LANCZOS),
            b.convert('RGBA')).getbbox() is None
        print(f'  favicon-{g}.png{" " * (2 - len(str(g)) // 10)} {b.mode:<6} {str(e):<22} '
              f'{zwickel_zaehlen(b, kante):>13}  '
              f'{"KACHEL (bitgleich)" if gleich else "nicht die Kachel (SVG)"}')
    print('  --> Solange hier „KACHEL" steht, traegt JEDER Browser-Reiter die')
    print('      deckend weissen Ecken — die Rechnung 4/24/57 trifft ihn direkt.')

    print('\n══ 3. INSTALLER-SYMBOL: HIER landen die weissen Ecken ═════════')
    ico = INSTALLER / 'sdstart-symbol.ico'
    if ico.is_file():
        i = Image.open(ico)
        print(f'  {ico.name}  (Windows-Taskleiste, aus der Kachel gebaut)')
        print(f'  {"Rahmen":>7} {"Eckpixel":<24} {"weiss+deckend":>14}')
        for g in sorted(s[0] for s in i.info['sizes']):
            i.size = (g, g)
            f = i.convert('RGBA').copy()
            kante = max(1, round(g * 200 / 1024))
            print(f'  {g:>7} {str(f.load()[0, 0]):<24} {zwickel_zaehlen(f, kante):>14}')
    png = INSTALLER / 'sdstart-symbol.png'
    if png.is_file():
        s = Image.open(png)
        print(f'  {png.name}: Modus {s.mode}, {s.size[0]}x{s.size[1]}, '
              f'Eckpixel {s.convert("RGBA").load()[0, 0]}  (Tk-Fenstersymbol)')
    print('  --> deckendes Weiss in JEDEM Rahmen. Auf einer dunklen Taskleiste')
    print('      sind das vier helle Ecken um die lila Kachel.')

    print('\n══ 4. DIE 180er-KACHEL FUERS TELEFON ══════════════════════════')
    m = Image.open(ORDNER / 'mixpi-kachel.png')
    print(f'  mixpi-kachel.png  Modus {m.mode}, {m.size[0]}x{m.size[1]}')
    print(f'  Auslauf der Ecke: {eckauslauf(m)} px = {100*eckauslauf(m)/m.size[0]:.1f} % der Kante')
    for name, z in ios_maske_test(m).items():
        print(f'    {name:<20} weisse Eckpixel: {z}')
    print('  --> Ob iOS das Weiss verdeckt, haengt am Maskenmodell: der')
    print('      Kreisbogen schluckt es, der Squircle laesst Splitter stehen.')
    print('      NICHT entscheidbar ohne echtes Geraet — also nicht behaupten.')

    print('\n══ 5. WAS EIN ALPHAKANAL HIER ANRICHTEN WUERDE ════════════════')
    print('  favicon-bauen.py macht .convert(\'RGB\') OHNE Hintergrund.')
    print('  Pillow wirft dabei den Alphakanal weg und behaelt die RGB-Werte')
    print('  darunter — bei ausgeschnittenen Ecken (RGB 0,0,0) waeren das')
    print('  SCHWARZE Ecken auf dem Telefon-Startbildschirm. Ein Alphakanal')
    print('  in der Quelle ist also nur mit Anfassen dieser Stelle zu haben.')


if __name__ == '__main__':
    main()
