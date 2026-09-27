#!/usr/bin/env python3
"""Verschwinden Buegel und Ohrmuscheln im violetten Kachelgrund?

══ DIE BEHAUPTUNG, DIE HIER GEPRUEFT WIRD ═════════════════════════════════
„Ohrmuschelfuellung und Kachelgrund haben dieselbe Farbe (Abstand 5-6 in
RGB). Getrennt sind sie nur durch den Umriss, der bei 16 px 0,53 px breit
ist — also derselbe Fall, den favicon.svg am 08.08. verworfen hat."

BEIDE MESSUNGEN STIMMEN, und dieses Werkzeug bestaetigt sie zuerst:
die Fuellung IST die Grundfarbe (1,03:1), und 34 von 1024 Umriss sind bei
16 px genau 0,53 Bildpunkte. Auch der Buegel ist violett gefuellt — die
Kachel hat dieselbe Bauart wie die verworfene Zeichnung.

STRITTIG IST NUR DER SCHLUSS, und er faellt an zwei Stellen:

  1. „0,53 px Umriss" heisst nicht „fast weg". LANCZOS mittelt Flaechen.
     0,53 Bildpunkte Schwarz in einem 1-px-Feld sind 53 % Schwarz IN
     DIESEM BILDPUNKT. Der Umriss verschwindet nicht, er faerbt.
  2. Der Ablehnungsgrund vom 08.08. war nicht „gleiche Fuellfarbe",
     sondern „Buegel und Ohrmuscheln VERSCHWINDEN darin". Ob sie das tun,
     entscheidet das Verhaeltnis von dunklem Umriss zu violetter Fuellung
     im Band — nicht die Fuellfarbe allein.

Dieses Werkzeug misst beides und stellt Kachel und verworfene Zeichnung
nebeneinander, so wie es der 08.08. getan hat.

══ AUFRUF ═════════════════════════════════════════════════════════════════
    python3 tools/kachel-ohrmuschel-nachmessen.py [zielbild.png]
"""
import pathlib
import shutil
import subprocess
import sys
import tempfile

from PIL import Image

WURZEL = pathlib.Path(__file__).resolve().parent.parent
KACHEL = WURZEL / 'NewDesign/bilder/quellen/Meshy_AI_mixpi-favicon.png'
SVG = WURZEL / 'NewDesign/bilder/favicon.svg'
ORDNER = WURZEL / 'NewDesign/bilder'
AUS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else None


def leuchte(f):
    f = f / 255
    return f / 12.92 if f <= 0.04045 else ((f + 0.055) / 1.055) ** 2.4


def helligkeit(c):
    r, g, b = (leuchte(x) for x in c[:3])
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def kontrast(a, b):
    ha, hb = helligkeit(a), helligkeit(b)
    return (max(ha, hb) + 0.05) / (min(ha, hb) + 0.05)


def abstand(a, b):
    return sum((x - y) ** 2 for x, y in zip(a[:3], b[:3])) ** 0.5


def laeufe(im, x, y0, y1, schwelle=90):
    """Dunkle und helle Laeufe auf einer Senkrechten — Umriss gegen Fuellung.

    Liefert eine Liste (dunkel?, breite). So sieht man auf einen Blick, wie
    viel Schwarz und wie viel violette Fuellung in einem Band stecken.
    """
    aus = []
    art = None
    n = 0
    for y in range(y0, y1):
        p = im.getpixel((x, y))
        d = sum(p[:3]) / 3 < schwelle
        if d != art:
            if art is not None:
                aus.append((art, n))
            art, n = d, 1
        else:
            n += 1
    if art is not None:
        aus.append((art, n))
    return aus


def band_bericht(name, im, x, y0, y1, kante=1024):
    """Das Band als Laufmuster — und der laengste ZUSAMMENHAENGENDE Lauf
    reiner Grundfarbe INNERHALB des Bandes.

    Auf den Schwarzanteil kommt es NICHT an (gemessen: die Kachel hat mit
    37 % sogar weniger als die Zeichnung mit 47 %). Es kommt darauf an, ob
    irgendwo ein Streifen reiner Grundfarbe breit genug ist, um bei 16 px
    einen ganzen Bildpunkt in Grundfarbe zu fuellen — dann bekommt der
    Bogen dort ein Loch und „verschwindet im Grund".
    """
    ll = [(d, n) for d, n in laeufe(im, x, y0, y1) if n > 3]
    dunkel = sum(n for d, n in ll if d)
    hell = sum(n for d, n in ll if not d)
    ganz = dunkel + hell or 1
    muster = '  '.join(('%s%d' % ('#' if d else '.', n)) for d, n in ll)
    # Innerhalb des Bandes: nur die hellen Laeufe ZWISCHEN zwei dunklen.
    innen = [n for i, (d, n) in enumerate(ll)
             if not d and 0 < i < len(ll) - 1 and ll[i - 1][0] and ll[i + 1][0]]
    laengster = max(innen) if innen else 0
    print(f'  {name:<10} {muster}')
    print(f'  {"":<10} dunkel {dunkel} px, violett {hell} px'
          f' (Schwarzanteil {dunkel * 100 / ganz:.0f} %)')
    print(f'  {"":<10} laengster Streifen REINER Grundfarbe im Band:'
          f' {laengster} px  =  {laengster * 16 / kante:.2f} Bildpunkte bei 16 px')
    return laengster


def verworfen(kante, grund):
    """favicon.svg auf violettem Grund — der Entwurf, den der 08.08. verwarf."""
    with tempfile.TemporaryDirectory() as t:
        roh = pathlib.Path(t) / 'f.png'
        subprocess.run(['rsvg-convert', '-w', str(kante), '-h', str(kante),
                        '-o', str(roh), str(SVG)], check=True)
        figur = Image.open(roh).convert('RGBA')
    g = Image.new('RGBA', (kante, kante), grund)
    g.alpha_composite(figur)
    return g.convert('RGB')


def streifen(im):
    felder = [im.resize((g, g), Image.Resampling.LANCZOS).resize(
        (128, 128), Image.Resampling.NEAREST) for g in (16, 32, 48, 180)]
    band = Image.new('RGB', (138 * len(felder) - 10, 128), '#FFFFFF')
    for i, f in enumerate(felder):
        band.paste(f, (i * 138, 0))
    return band


def main():
    if not KACHEL.is_file():
        print(f'FEHLT: {KACHEL}')
        return 1
    kachel = Image.open(KACHEL).convert('RGB')
    b = kachel.size[0]
    grund = kachel.getpixel((60, 512))

    print('══ 1. DIE BEHAUPTUNG STIMMT, SOWEIT SIE MISST ═══════════════════')
    print(f'  Kachelgrund       (60,512)  {grund}')
    for p in ((232, 600), (800, 600)):
        f = kachel.getpixel(p)
        print(f'  Ohrmuschelfuellung {str(p):<10} {f}   Abstand'
              f' {abstand(grund, f):.1f}   Kontrast {kontrast(grund, f):.2f}:1')
    print('  → Fuellung = Grundfarbe. Unstrittig; favicon-bauen.py schreibt')
    print('    es selbst hin („dieselbe Farbe, trotzdem getrennt").')

    print('\n══ 2. WAS „0,53 px UMRISS" WIRKLICH BEDEUTET ════════════════════')
    umriss = (0, 3, 20)
    print(f'  Umrissfarbe {umriss}, rein gegen den Grund: '
          f'{kontrast(grund, umriss):.2f}:1')
    print('  (Das ist die Zahl, die favicon-bauen.py als „4,68:1" fuehrt —')
    print('   sie gilt fuer den UMRISS gegen den Grund, nicht fuer die')
    print('   Fuellung. WCAG 1.4.11 laesst genau das zu: zwei gleichfarbige')
    print('   Flaechen duerfen durch eine kontrastreiche Grenze getrennt sein.)')
    print()
    print('  Ein Ziel-Bildpunkt deckt 1024/g Quellpunkte ab. Ein 34-px-Umriss')
    print('  faerbt ihn anteilig ein — er verschwindet nicht:')
    print()
    print('   g  | Fussabdruck | Schwarzanteil | Mischfarbe      | Kontrast')
    print('  ----+-------------+---------------+-----------------+---------')
    for g in (16, 32, 48, 180):
        fuss = b / g
        a = min(1.0, 34 / fuss)
        m = tuple(round(grund[i] * (1 - a) + umriss[i] * a) for i in range(3))
        print(f'  {g:>3} | {fuss:>8.1f} px | {a * 100:>11.0f} % |'
              f' {str(m):<15} | {kontrast(grund, m):>5.2f}:1')

    print('\n══ 3. DER EIGENTLICHE ABLEHNUNGSGRUND VOM 08.08. ════════════════')
    print('  „Buegel UND Ohrmuscheln verschwinden darin." Beide Bilder haben')
    print('  violette Fuellung auf violettem Grund. Der Unterschied liegt im')
    print('  Verhaeltnis Umriss zu Fuellung im Band — senkrechter Schnitt')
    print('  x=512 durch den Buegel (#n = dunkel, .n = violett, in px):')
    print()
    if not SVG.is_file() or not shutil.which('rsvg-convert'):
        print('  rsvg-convert oder favicon.svg fehlt — Gegenprobe entfaellt.')
        return 0
    alt = verworfen(b, grund)
    k = band_bericht('Kachel', kachel, 512, 80, 300, b)
    z = band_bericht('Zeichnung', alt, 512, 60, 330, b)
    print()
    print('  → NICHT der Schwarzanteil unterscheidet sie — der ist bei der')
    print('    Kachel sogar kleiner. Es ist die LAENGE des ungestoerten')
    print('    Streifens in Grundfarbe:')
    print(f'      Zeichnung {z} px = {z * 16 / b:.2f} Bildpunkte → ueber 1: bei 16 px')
    print('        bleibt ein ganzer Bildpunkt in Grundfarbe stehen, der Bogen')
    print('        bekommt ein Loch und laeuft in den Grund aus. GENAU DAS')
    print('        heisst „Buegel und Ohrmuscheln verschwinden darin".')
    print(f'      Kachel    {k} px = {k * 16 / b:.2f} Bildpunkte → unter 1: jeder')
    print('        Bildpunkt bekommt Schwarz ab, es entsteht ein geschlossener')
    print('        dunkler Ring statt eines Lochs.')

    print('\n══ 4. WAS AUSGELIEFERT IST ══════════════════════════════════════')
    for n in ('favicon-16.png', 'favicon-32.png', 'favicon-48.png'):
        d = ORDNER / n
        if d.is_file():
            im = Image.open(d).convert('RGB')
            dunkelster = min(im.getdata(), key=helligkeit)
            print(f'  {n:<16} {im.size[0]}x{im.size[1]}  dunkelster Punkt'
                  f' {dunkelster}  Kontrast zum Grund'
                  f' {kontrast(grund, dunkelster):.2f}:1')

    if AUS is not None:
        zus = Image.new('RGB', (streifen(kachel).size[0], 268), '#FFFFFF')
        zus.paste(streifen(kachel), (0, 0))
        zus.paste(streifen(alt), (0, 140))
        AUS.parent.mkdir(parents=True, exist_ok=True)
        zus.save(AUS)
        print(f'\n  Gegenueberstellung 16/32/48/180 (oben Kachel, unten der')
        print(f'  verworfene Entwurf): {AUS}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
