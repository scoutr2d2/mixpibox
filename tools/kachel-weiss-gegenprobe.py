#!/usr/bin/env python3
"""Haelt „Weiss zu Alpha durchloechert die Kachel" der Gegenprobe stand?

══ DIE BEHAUPTUNG, DIE HIER GEPRUEFT WIRD ══════════════════════════════════
Aus der Favicon-Untersuchung (10.08.2026) stammt der Satz:

    „Das Weiss der Leinwand ist das Weiss des Gesichts — 'Weiss zu Alpha'
     durchloechert die Figur."

Beleg dort: Ecke (2,2) = (253,253,254), Gesicht (512,700) = (254,254,254),
Abstand 1.4 in RGB. Daraus wird gefolgert, dass
NewDesign/bilder/quellen/Meshy_AI_mixpi-favicon.png NICHT freigestellt werden
darf — und deshalb setzt remote-step-installer/tools/sdstart-bilder.py in
`symbol_bauen()` die Kachel UNFREIGESTELLT als Fenstersymbol ein, waehrend
jedes andere Bild dort durch tools/bilder-freistellen.py laeuft.

══ WARUM ZWEI BILDPUNKTE NICHT REICHEN ═════════════════════════════════════
Der Beleg misst FARBE. Ob ein Freisteller ein Loch reisst, entscheidet aber
nicht die Farbe allein, sondern ob die beiden Flaechen ZUSAMMENHAENGEN.
tools/bilder-freistellen.py maskiert ausdruecklich nicht nach Farbe, sondern
flutet vom Bildrand — genau, weil MixPi weiss ist und der Grund fast auch.

Diese Kachel hat zwischen Aussenweiss und Gesichtsweiss noch etwas stehen,
was die Profilbilder nicht hatten: den lila Kachelkoerper. Ob der die Flut
aufhaelt, ist eine Frage an das Bild, nicht an zwei Pixel.

══ WAS GEMESSEN WIRD ═══════════════════════════════════════════════════════
  1. Die zwei belegten Bildpunkte nachgeschlagen — stimmt der Beleg ueberhaupt,
     und WAS liegt an diesen Stellen (Aussenrand oder Kachelgrund)?
  2. Naive Fassung: alles unter Farbabstand TOLERANZ zum Eckenweiss wird
     durchsichtig. Wieviel vom GESICHT faellt dabei? (Das ist die Fassung, von
     der die Behauptung spricht.)
  3. Die Fassung, DIE IM BAUM STEHT: tools/bilder-freistellen.py, unveraendert
     als Unterprozess. Wieviel vom Gesicht faellt dort?
  4. Gegenprobe auf das Ergebnis: bleibt die Figur geschlossen? Gezaehlt wird
     die Deckkraft in einem Gitter ueber dem Gesicht, nicht an einem Punkt.
  5. Was das Fenstersymbol daraus macht — auf hellem UND dunklem Fensterrahmen,
     denn ein Symbol mit weissen Ecken faellt erst auf dunklem Grund auf.

══ AUFRUF ══════════════════════════════════════════════════════════════════
    python3 tools/kachel-weiss-gegenprobe.py
    python3 tools/kachel-weiss-gegenprobe.py --bogen /tmp/x   # Bilder dazu

AENDERT NICHTS im Baum. Schreibt nur, wenn --bogen genannt wird.
"""
import argparse
import math
import pathlib
import subprocess
import sys
import tempfile

WURZEL = pathlib.Path(__file__).resolve().parent.parent
KACHEL = WURZEL / 'NewDesign/bilder/quellen/Meshy_AI_mixpi-favicon.png'
FREISTELLEN = WURZEL / 'tools' / 'bilder-freistellen.py'

# Dieselbe Toleranz, mit der sdstart-bilder.py seine Bilder freistellt.
TOLERANZ_SDSTART = 70
# Die Vorgabe von bilder-freistellen.py.
TOLERANZ_VORGABE = 28

# Das Gesicht: ein Rechteck in Bildanteilen, das sicher INNERHALB der weissen
# Kopfflaeche liegt (nachgesehen am 1024er Bild — Kopf reicht etwa von
# x 0.28..0.72, y 0.45..0.85). Bewusst enger gefasst, damit die Zahl nicht
# von der Kontur lebt.
GESICHT = (0.33, 0.50, 0.67, 0.82)


def _feld(a, kasten):
    """Der Ausschnitt `kasten` (Anteile) aus einem Feld der Form (h, b, ...)."""
    h, b = a.shape[:2]
    x0, y0, x1, y1 = kasten
    return a[int(h * y0):int(h * y1), int(b * x0):int(b * x1)]


def belegpunkte(px, w, h):
    zeilen = []
    ecke = px[2, 2]
    gesicht = px[512, 700] if (w > 512 and h > 700) else None
    zeilen.append(f'Ecke (2,2)        {ecke}')
    if gesicht:
        zeilen.append(f'Gesicht (512,700) {gesicht}   Abstand {math.dist(ecke, gesicht):.1f}')
    # WO liegen diese Punkte? Der Kachelkoerper ist lila; wer auf Lila trifft,
    # steht nicht auf demselben Weiss.
    mitte_links = px[int(w * 0.06), h // 2]
    zeilen.append(f'Kachelgrund (6% Breite, halbe Hoehe) {mitte_links}'
                  '  — der Koerper der Kachel, nicht Weiss')
    return zeilen


def naive_maske(a, np, grund, toleranz):
    """„Weiss zu Alpha" woertlich: nach FARBE maskieren, ohne Zusammenhang."""
    return ((a - grund) ** 2).sum(axis=2) ** 0.5 < toleranz


def main():
    p = argparse.ArgumentParser(description='Gegenprobe zur Weiss-zu-Alpha-Behauptung')
    p.add_argument('--bogen', type=pathlib.Path, help='Ordner fuer Bildbelege')
    a = p.parse_args()

    try:
        import numpy as np
        from PIL import Image
    except ImportError:
        sys.exit('Es fehlt: python3 -m pip install pillow numpy')

    if not KACHEL.is_file():
        sys.exit(f'FEHLT: {KACHEL}')

    roh = Image.open(KACHEL)
    rgb = roh.convert('RGB')
    w, h = rgb.size
    px = rgb.load()

    print('═══ 1. Der Beleg nachgeschlagen ' + '═' * 43)
    print(f'  Datei {KACHEL.relative_to(WURZEL)}  {w}x{h}  Modus {roh.mode}')
    for z in belegpunkte(px, w, h):
        print('  ' + z)

    arr = np.asarray(rgb).astype(np.float32)
    ecke = arr[2, 2]

    print('\n═══ 2. Naive Fassung: nach Farbe maskieren ' + '═' * 32)
    for tol in (TOLERANZ_VORGABE, TOLERANZ_SDSTART):
        m = naive_maske(arr, np, ecke, tol)
        g = _feld(m, GESICHT)
        print(f'  Toleranz {tol:3d}:  durchsichtig gesamt {m.mean():6.1%}'
              f'   davon im GESICHT {g.mean():6.1%}')
    print('  → Das ist die Fassung, von der die Behauptung spricht.')

    print('\n═══ 3. Die Fassung, die im Baum steht ' + '═' * 37)
    print(f'  {FREISTELLEN.relative_to(WURZEL)} — flutet vom Bildrand, maskiert NICHT nach Farbe')
    with tempfile.TemporaryDirectory() as t:
        for tol in (TOLERANZ_VORGABE, TOLERANZ_SDSTART):
            ordner = pathlib.Path(t) / str(tol)
            lauf = subprocess.run(
                ['python3', str(FREISTELLEN), str(KACHEL), '--ziel', str(ordner),
                 '--groessen', str(w), '--toleranz', str(tol)],
                capture_output=True, text=True, timeout=600)
            frei = ordner / KACHEL.name
            if lauf.returncode or not frei.is_file():
                print(f'  Toleranz {tol:3d}:  FEHLER {(lauf.stderr or lauf.stdout).strip()[:200]}')
                continue
            bild = Image.open(frei).convert('RGBA')
            al = np.asarray(bild)[:, :, 3].astype(np.float32) / 255.0
            loch = al < 0.5
            gl = _feld(loch, GESICHT)
            print(f'  Toleranz {tol:3d}:  durchsichtig gesamt {loch.mean():6.1%}'
                  f'   davon im GESICHT {gl.mean():6.1%}'
                  f'   Groesse {bild.size[0]}x{bild.size[1]}')
            for z in lauf.stdout.strip().splitlines():
                if z.strip().startswith(KACHEL.stem[:12]) or 'gerettet' in z or 'Tasche' in z:
                    print('      ' + z.strip())
            if a.bogen:
                a.bogen.mkdir(parents=True, exist_ok=True)
                for name, grund in (('hell', (255, 255, 255, 255)),
                                    ('dunkel', (32, 33, 36, 255))):
                    blatt = Image.new('RGBA', bild.size, grund)
                    blatt.alpha_composite(bild)
                    blatt.convert('RGB').resize((256, 256), Image.Resampling.LANCZOS).save(
                        a.bogen / f'frei-{tol}-{name}.png')

    print('\n═══ 4. Die Kachel UNFREIGESTELLT auf zwei Fensterrahmen ' + '═' * 19)
    # Was heute ausgeliefert wird: die Kachel roh. Auf dunklem Rahmen steht
    # dann ein weisses Quadrat mit runden Ecken um das Symbol.
    if a.bogen:
        a.bogen.mkdir(parents=True, exist_ok=True)
        for name, grund in (('hell', (255, 255, 255)), ('dunkel', (32, 33, 36))):
            blatt = Image.new('RGB', (256, 256), grund)
            blatt.paste(rgb.resize((256, 256), Image.Resampling.LANCZOS), (0, 0))
            blatt.save(a.bogen / f'roh-{name}.png')
    ecken = [arr[2, 2], arr[2, w - 3], arr[h - 3, 2], arr[h - 3, w - 3]]
    print('  Die vier Ecken: ' + '  '.join(f'({int(e[0])},{int(e[1])},{int(e[2])})' for e in ecken))
    weiss_ecke = sum(1 for e in ecken if math.dist(e, (255, 255, 255)) < 10)
    print(f'  {weiss_ecke} von 4 Ecken sind gebackenes Weiss — auf dunklem Fensterrahmen sichtbar.')
    if a.bogen:
        print(f'\n  Bilder in {a.bogen}')


if __name__ == '__main__':
    main()
