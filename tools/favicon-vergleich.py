#!/usr/bin/env python3
"""Zwei Quellen fuer dasselbe Reitersymbol — nebeneinander MESSEN statt raten.

══ WOZU ═══════════════════════════════════════════════════════════════════
Heute baut tools/favicon-bauen.py alle Groessen aus der von Hand gezeichneten
NewDesign/bilder/favicon.svg. Daneben liegt seit dem 10.08.2026 eine gerechnete
1024er-Kachel (NewDesign/bilder/quellen/Meshy_AI_mixpi-favicon.png). Die Frage
„nehmen wir die als neue Quelle?" ist eine Frage nach 16 Bildpunkten, und die
beantwortet man nicht im Kopf.

Dieses Werkzeug legt beide Kandidaten in jeder Zielgroesse auf jeden Reitergrund
(hell, creme, dunkel) und misst dieselben Zahlen an beiden. Es AENDERT NICHTS im
Baum — es schreibt nur einen Kontaktbogen in einen Ordner, den man ihm nennt.

══ WAS GEMESSEN WIRD UND WARUM DIESE ZAHLEN ═══════════════════════════════
  zeichenflaeche  Anteil der Bildflaeche, der NICHT Reiter-/Kachelgrund ist.
                  Ein freigestelltes Zeichen und eine randlose Kachel teilen
                  sich 256 Bildpunkte sehr verschieden auf: die Kachel gibt
                  einen Teil davon an ihren eigenen Grund ab.
  dunkelanteil    Anteil Pixel mit Luma < 96. Der Umriss IST das Zeichen bei
                  16 px; wenn er zu Grau verwaschen ist, faellt diese Zahl.
  dunkelinseln    Zahl zusammenhaengender dunkler Flecken. Zwei Augen in einem
                  weissen Gesicht sind zwei Inseln. Verlaufen sie zu einem
                  Balken, wird daraus eine. Das ist der graue Balken, wegen dem
                  favicon-bauen.py fuer 16 px ueberhaupt eine Sonderfassung hat.
  kanten          Mittlerer Betrag des Sobel-Gradienten auf der Luminanz,
                  normiert. Das Matsch-Mass: viele weiche Uebergaenge statt
                  weniger harter Kanten druecken es.
  stifte          Wie viele der sechs Stiftfarben (blau, gruen, stahlblau,
                  gelb, pink, orange) noch mit einem Pixel naeher als 60
                  (Euklid in RGB) im Bild stehen. Der Betreiber am 08.08.2026:
                  „ich denke 6 punkte sind wichtig : wie in der vorlage".
  randkontrast    WCAG-Kontrastverhaeltnis zwischen dem Reitergrund und der
                  aeussersten Pixelreihe des Zeichens. Sagt, ob das Symbol auf
                  DIESEM Reiter noch einen Rand hat oder darin ersaeuft.

══ AUFRUF ═════════════════════════════════════════════════════════════════
    python3 tools/favicon-vergleich.py                 # Zahlen auf die Konsole
    python3 tools/favicon-vergleich.py --bogen ORDNER  # zusaetzlich Bilder

Braucht rsvg-convert (Paket librsvg) und Pillow — dieselben Mittel wie
favicon-bauen.py, damit die SVG-Seite GENAU so gerendert wird wie im Bau.
"""
import argparse
import math
import pathlib
import subprocess
import sys
import tempfile

WURZEL = pathlib.Path(__file__).resolve().parent.parent
SVG = WURZEL / 'NewDesign/bilder/favicon.svg'
KACHEL = WURZEL / 'NewDesign/bilder/quellen/Meshy_AI_mixpi-favicon.png'

GROESSEN = (16, 32, 48)

# Die Reiter, auf denen das Symbol wirklich landet. Dunkel ist Chromiums
# Reiterleiste im dunklen Satz (#202124), creme der Hausgrund der Oberflaeche.
REITER = (('hell', (255, 255, 255)), ('creme', (255, 247, 236)), ('dunkel', (32, 33, 36)))

# Aus NewDesign/bilder/favicon.svg gezaehlt (dort ihrerseits aus mixpi-hoert.png).
STIFTE = (('blau', (0x00, 0xAC, 0xFD)), ('gruen', (0x11, 0xDE, 0x47)),
          ('stahlblau', (0x43, 0x71, 0x9A)), ('gelb', (0xFE, 0xEE, 0x04)),
          ('pink', (0xFD, 0x34, 0xA2)), ('orange', (0xFF, 0x70, 0x01)))
STIFT_SCHWELLE = 60.0


# ── DIE ZWEI KANDIDATEN, JEDER ALS RGBA IN DER GEWUENSCHTEN GROESSE ───────

def svg_fassung(groesse):
    """Die heutige Quelle — ueber DENSELBEN Weg wie im Bau.

    Fuer 16 px die Punkte-Fassung, weil genau die ausgeliefert wird. Wer hier
    die rohe Quelle naehme, verglichen mit einem Bild, das es nicht gibt.
    """
    from PIL import Image
    text = SVG.read_text(encoding='utf-8')
    if groesse == 16:
        text = _augen_zu_punkten(text)
    with tempfile.TemporaryDirectory() as t:
        ziel = pathlib.Path(t) / 'x.png'
        with tempfile.NamedTemporaryFile('w', suffix='.svg', delete=False, encoding='utf-8') as f:
            f.write(text)
            weg = f.name
        lauf = subprocess.run(['rsvg-convert', '-w', str(groesse), '-h', str(groesse),
                               weg, '-o', str(ziel)], capture_output=True, text=True)
        pathlib.Path(weg).unlink(missing_ok=True)
        if lauf.returncode:
            raise SystemExit('FEHLER: rsvg-convert: ' + lauf.stderr.strip())
        return Image.open(ziel).convert('RGBA').copy()


def _augen_zu_punkten(svg):
    """Dieselbe Ersetzung wie in favicon-bauen.py — hier NUR gelesen, nie geschrieben."""
    import re
    muster = re.compile(r'[ \t]*<path d="M1[0-9]\.[0-9] 19\.3 q1\.2 1\.6 2\.4 0"[^/]*/>\n')
    treffer = muster.findall(svg)
    if len(treffer) != 2:
        raise SystemExit(f'FEHLER: {len(treffer)} Augenpfade in favicon.svg, erwartet 2 — '
                         'die Quelle wurde umgezeichnet, das Muster gehoert nachgezogen '
                         '(steht auch in tools/favicon-bauen.py).')
    for t in treffer:
        svg = svg.replace(t, '', 1)
    punkte = ('    <ellipse cx="13.1" cy="19.9" rx="1.25" ry="1.05" fill="#00032B"/>\n'
              '    <ellipse cx="18.9" cy="19.9" rx="1.25" ry="1.05" fill="#00032B"/>\n')
    return svg.replace('  </g>', punkte + '  </g>', 1)


def kachel_fassung(groesse):
    """Die gerechnete Kachel, heruntergerechnet wie es ein Bauwerkzeug taete."""
    from PIL import Image
    return Image.open(KACHEL).convert('RGBA').resize((groesse, groesse), Image.LANCZOS)


KANDIDATEN = (('zeichen', svg_fassung), ('kachel', kachel_fassung))


# ── DIE MASSE ─────────────────────────────────────────────────────────────

def auf_reiter(bild, grund):
    from PIL import Image
    flaeche = Image.new('RGBA', bild.size, grund + (255,))
    flaeche.alpha_composite(bild)
    return flaeche.convert('RGB')


def luma(p):
    return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]


def rel_hell(c):
    def f(k):
        k /= 255.0
        return k / 12.92 if k <= 0.03928 else ((k + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])


def kontrast(a, b):
    x, y = sorted((rel_hell(a), rel_hell(b)), reverse=True)
    return (x + 0.05) / (y + 0.05)


def zeichenflaeche(bild, grund):
    """Anteil Pixel, der sich vom Reitergrund unterscheidet.

    Fuer das freigestellte Zeichen ist das die Figur. Fuer die Kachel ist es
    die Kachel — sie deckt fast alles ab, und genau das ist die Auskunft.
    """
    px = auf_reiter(bild, grund).load()
    w, h = bild.size
    n = sum(1 for y in range(h) for x in range(w)
            if max(abs(px[x, y][k] - grund[k]) for k in range(3)) > 12)
    return n / (w * h)


def dunkelmass(bild):
    """Anteil dunkler Pixel und Zahl der zusammenhaengenden dunklen Inseln.

    IMMER AUF WEISS GERECHNET, und das mit Absicht: Auf einem dunklen Reiter
    waere jeder Reiterpunkt selbst „dunkel", und die Zahl saehe fuer beide
    Kandidaten gut aus, ohne etwas ueber die Tinte zu sagen. Der erste Entwurf
    dieses Werkzeugs mass genau so und meldete auf dunkel 69,5 % — davon war
    nichts das Zeichen. Tinte ist eine Eigenschaft des Bildes, nicht des Reiters.
    """
    grund = (255, 255, 255)
    px = auf_reiter(bild, grund).load()
    w, h = bild.size
    dunkel = [[luma(px[x, y]) < 96 for x in range(w)] for y in range(h)]
    anteil = sum(sum(z) for z in dunkel) / (w * h)
    gesehen = [[False] * w for _ in range(h)]
    inseln = 0
    for y in range(h):
        for x in range(w):
            if dunkel[y][x] and not gesehen[y][x]:
                inseln += 1
                stapel = [(x, y)]
                gesehen[y][x] = True
                while stapel:
                    a, b = stapel.pop()
                    for da, db in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        u, v = a + da, b + db
                        if 0 <= u < w and 0 <= v < h and dunkel[v][u] and not gesehen[v][u]:
                            gesehen[v][u] = True
                            stapel.append((u, v))
    return anteil, inseln


def kanten(bild, grund):
    """Mittlerer Sobel-Betrag auf der Luminanz, auf 0..1 normiert."""
    px = auf_reiter(bild, grund).load()
    w, h = bild.size
    L = [[luma(px[x, y]) for x in range(w)] for y in range(h)]
    s = 0.0
    n = 0
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            gx = (L[y-1][x+1] + 2*L[y][x+1] + L[y+1][x+1]) - (L[y-1][x-1] + 2*L[y][x-1] + L[y+1][x-1])
            gy = (L[y+1][x-1] + 2*L[y+1][x] + L[y+1][x+1]) - (L[y-1][x-1] + 2*L[y-1][x] + L[y-1][x+1])
            s += math.hypot(gx, gy)
            n += 1
    return s / n / (4 * 255) if n else 0.0


def stifte_ueberlebt(bild, grund):
    """Wie viele der sechs Stiftfarben stehen noch erkennbar im Bild."""
    px = auf_reiter(bild, grund).load()
    w, h = bild.size
    da = []
    for name, soll in STIFTE:
        best = min(math.dist(px[x, y], soll) for y in range(h) for x in range(w))
        da.append((name, best))
    return sum(1 for _, d in da if d < STIFT_SCHWELLE), da


def randkontrast(bild, grund):
    """Kontrast zwischen Reitergrund und der aeussersten Reihe des Zeichens.

    Gesucht wird der Umriss: die Pixel, die den Grund beruehren. Bei der Kachel
    ist das ihre eigene Kante, beim Zeichen der dunkle Aussenrand.
    """
    voll = auf_reiter(bild, grund)
    px = voll.load()
    w, h = bild.size
    def fremd(x, y):
        return max(abs(px[x, y][k] - grund[k]) for k in range(3)) > 12
    rand = []
    for y in range(h):
        for x in range(w):
            if not fremd(x, y):
                continue
            if any(not (0 <= x+d < w and 0 <= y+e < h) or not fremd(x+d, y+e)
                   for d, e in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                rand.append(px[x, y])
    if not rand:
        return 0.0
    mitte = tuple(sum(p[k] for p in rand) / len(rand) for k in range(3))
    return kontrast(mitte, grund)


# ── DER KONTAKTBOGEN ──────────────────────────────────────────────────────

def bogen(ziel):
    """Alle Fassungen, 1:1 und achtfach ohne Glaettung, auf allen Reitern."""
    from PIL import Image
    zoom = 8
    zeile_h = max(GROESSEN) * zoom + 24
    spalten = len(GROESSEN) * 2
    breite = sum(g * zoom + 16 for g in GROESSEN) * 2 + 40
    hoehe = len(REITER) * zeile_h + 20
    blatt = Image.new('RGB', (breite, hoehe), (128, 128, 128))
    y = 10
    for rname, grund in REITER:
        streifen = Image.new('RGB', (breite, zeile_h), grund)
        x = 20
        for kname, mach in KANDIDATEN:
            for g in GROESSEN:
                b = auf_reiter(mach(g), grund)
                streifen.paste(b.resize((g * zoom, g * zoom), Image.NEAREST), (x, 12))
                x += g * zoom + 16
        blatt.paste(streifen, (0, y))
        y += zeile_h
    ziel = pathlib.Path(ziel)
    ziel.parent.mkdir(parents=True, exist_ok=True)
    blatt.save(ziel)
    reihe = ' | '.join(f'{k} {"/".join(str(g) for g in GROESSEN)}' for k, _ in KANDIDATEN)
    return f'{ziel}  (Zeilen: {", ".join(r for r, _ in REITER)}; Spalten: {reihe})'


# ── ZWEI FRAGEN, DIE NUR DIE KACHEL BETREFFEN ────────────────────────────

def kachel_befund():
    """Was die Kachel ALS DATEI mitbringt — unabhaengig von jeder Groesse.

    Drei Dinge entscheiden, ob sie ueberhaupt Quelle sein KANN:
      * hat sie einen Alphakanal, oder sind ihre runden Ecken weiss gebacken?
      * traegt sie den Grund in derselben Farbe wie die Ohrmuscheln?
      * wie dick ist ihr Umriss, umgerechnet auf 16 px?
    """
    from PIL import Image
    roh = Image.open(KACHEL)
    rgb = roh.convert('RGB')
    w, h = rgb.size
    px = rgb.load()
    zeilen = [f'Datei      {KACHEL.relative_to(WURZEL)}  {w}x{h}  Modus {roh.mode}']
    zeilen.append(f'Alpha      {"ja" if roh.mode in ("RGBA", "LA", "P") and "transparency" in roh.info else "NEIN"}'
                  '  — ohne Alpha sind die runden Ecken gebackenes Weiss')
    ecke, mitte = px[2, 2], px[w // 2, int(h * 0.68)]
    zeilen.append(f'Ecke       {ecke}   Gesicht {mitte}   Abstand {math.dist(ecke, mitte):.1f}'
                  '  — zu klein, um Weiss auszustanzen, ohne das Gesicht mitzunehmen')
    grund, muschel = px[int(w * 0.06), h // 2], px[int(w * 0.226), int(h * 0.586)]
    zeilen.append(f'Grund      {grund}   Ohrmuschel {muschel}   Abstand {math.dist(grund, muschel):.1f}'
                  '  — Ohrmuschel auf Grund derselben Farbe, nur durch den Umriss getrennt')
    laeufe = []
    for y in (int(h * 0.547), int(h * 0.605), int(h * 0.684)):
        n = 0
        for x in range(w):
            if max(px[x, y]) < 80:
                n += 1
            elif n:
                laeufe.append(n)
                n = 0
    laeufe = [n for n in laeufe if n > 5]
    d = sum(laeufe) / len(laeufe)
    zeilen.append(f'Umriss     im Mittel {d:.0f} von {w} px  =  {16 * d / w:.2f} px bei 16 —'
                  ' unter einem Bildpunkt wird jeder Strich zu Grau')
    return zeilen


def ico_befund():
    """Traegt favicon.ico wirklich die 16er-Sonderfassung?

    favicon-bauen.py speichert die ICO aus EINEM Bild (dem 48er) mit
    `sizes=[(16,16),(32,32),(48,48)]`. Pillow rechnet die kleineren Groessen
    daraus selbst herunter — die 16er-Fassung mit den Punkten statt der Boegen
    landet also NICHT in der Datei. Hier steht die Zahl dazu.
    """
    from PIL import Image, ImageChops
    ico = WURZEL / 'NewDesign/bilder/favicon.ico'
    if not ico.exists():
        return [f'{ico.name} fehlt — erst python3 tools/favicon-bauen.py laufen lassen.']
    im = Image.open(ico)
    zeilen = []
    for s in sorted(im.info['sizes']):
        im.size = s
        gerahmt = im.copy().convert('RGBA')
        png = WURZEL / f'NewDesign/bilder/favicon-{s[0]}.png'
        ref = Image.open(png).convert('RGBA')
        diff = ImageChops.difference(gerahmt, ref)
        p = list(diff.get_flattened_data() if hasattr(diff, 'get_flattened_data') else diff.getdata())
        mad = sum(max(q[:3]) for q in p) / len(p)
        zeilen.append(f'  {s[0]:3d} px  {"gleich wie" if mad == 0 else "ANDERS als"} {png.name}'
                      f'   mittlere Abweichung {mad:6.2f}')
    return zeilen


def main():
    p = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    p.add_argument('--bogen', metavar='DATEI', help='Kontaktbogen als PNG hierhin schreiben')
    a = p.parse_args()

    print('═══ Die Kachel als Datei ' + '═' * 49)
    for z in kachel_befund():
        print('  ' + z)
    print('\n═══ Was in favicon.ico wirklich steht ' + '═' * 36)
    for z in ico_befund():
        print(z)

    for g in GROESSEN:
        print(f'\n═══ {g} px ' + '═' * 62)
        for kname, mach in KANDIDATEN:
            b = mach(g)
            da, ins = dunkelmass(b)
            print(f'  {kname:8s} (reiterunabhaengig)  tinte {da:5.1%}  inseln {ins:3d}')
        for rname, grund in REITER:
            print(f'  auf {rname}:')
            for kname, mach in KANDIDATEN:
                b = mach(g)
                fl = zeichenflaeche(b, grund)
                ka = kanten(b, grund)
                st, det = stifte_ueberlebt(b, grund)
                rk = randkontrast(b, grund)
                fehlt = ', '.join(n for n, d in det if d >= STIFT_SCHWELLE)
                print(f'    {kname:8s} flaeche {fl:5.1%}  kanten {ka:.4f}  stifte {st}/6'
                      f'  randkontrast {rk:5.2f}' + (f'   fehlt: {fehlt}' if fehlt else ''))
    if a.bogen:
        print('\n' + bogen(a.bogen))


if __name__ == '__main__':
    main()
