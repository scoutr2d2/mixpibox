#!/usr/bin/env python3
"""Ist der duenne Umriss wirklich die Ursache des Matschs bei 16 px?

══ DIE BEHAUPTUNG, DIE HIER GEPRUEFT WIRD ═════════════════════════════════
tools/favicon-vergleich.py meldet ueber die gerechnete Kachel:

    Umriss  im Mittel 34 von 1024 px  =  0.53 px bei 16 —
            unter einem Bildpunkt wird jeder Strich zu Grau

Daraus wurde die Ursache des Matschs gemacht. Das ist eine Aussage ueber
URSACHE UND WIRKUNG, und die prueft man nicht mit derselben Zahl, aus der man
sie gewonnen hat. Dieses Werkzeug nimmt vier Gegenproben:

  A  WAS DIE DREI ZEILEN WIRKLICH ZAEHLEN. Die 34 sind ein Mittel ueber alle
     schwarzen Laeufe auf drei Zeilen. Es sagt jeden Lauf einzeln mit seiner
     x-Lage an, damit man sieht, ob da ein Umriss gemessen wurde oder ein Auge.

  B  WAS IM GESICHT WIRKLICH STEHT. Nicht die Strichbreite, sondern Groesse und
     FUELLUNG der Gesichtszuege entscheiden bei 16 px. Gemessen wird an beiden
     Kandidaten dasselbe: Gesichtsbreite und jeder dunkle Fleck darin, mit dem
     Anteil seines Rahmens, den er wirklich ausfuellt.

  C  DIE GROESSEN, IN DENEN DER UMRISS UEBER EINEM BILDPUNKT LIEGT. Bei 48 px
     ist er 1,6 px breit. Waere er die Ursache, muesste dort ein Knick in den
     Zahlen stehen — bei genau einem Bildpunkt.

  D  DIE GEGENPROBE AM BILD SELBST: den Umriss in der 1024er-Quelle kuenstlich
     verdicken, bis er bei 16 px ueber einem Bildpunkt liegt, und dann noch
     einmal dieselben Masse nehmen. Wird es besser, stimmt die Behauptung.

  E  DAS GEGENBEISPIEL: favicon.svg traegt einen Kopfumriss von genau 1,00 px
     bei 16 — ueber der Schwelle. Mit den Augenboegen der Quelle ist sie dort
     trotzdem Matsch, mit zwei Punkten und DEMSELBEN Umriss ist sie lesbar.

══ AUFRUF ═════════════════════════════════════════════════════════════════
    python3 tools/favicon-umriss-probe.py
    python3 tools/favicon-umriss-probe.py --bogen ORDNER   # Bilder dazu

Braucht Pillow, numpy und rsvg-convert — dieselben Mittel wie
tools/favicon-vergleich.py, dessen Masse hier eingelesen und wiederverwendet
werden, damit dieselben Zahlen dieselben Zahlen bleiben.
"""
import argparse
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import importlib

vergleich = importlib.import_module('favicon-vergleich')

WURZEL = vergleich.WURZEL
KACHEL = vergleich.KACHEL

# Dieselben drei Zeilen, an denen favicon-vergleich.py misst.
ZEILEN_ANTEIL = (0.547, 0.605, 0.684)
DUNKEL = 80          # dieselbe Schwelle wie dort: max(rgb) < 80
MINDESTLAUF = 5      # dieselbe Filterung: Laeufe bis 5 px fliegen raus


def _dunkelmaske(bild):
    import numpy as np
    a = np.asarray(bild.convert('RGB')).astype(np.int16)
    return a.max(axis=2) < DUNKEL


def _laeufe_der_zeile(maske, y):
    """Alle dunklen Laeufe einer Zeile als (x_start, laenge)."""
    reihe = maske[y]
    raus = []
    n = 0
    for x, dunkel in enumerate(reihe):
        if dunkel:
            n += 1
        elif n:
            raus.append((x - n, n))
            n = 0
    if n:
        raus.append((len(reihe) - n, n))
    return raus


def a_was_die_zeilen_zaehlen():
    from PIL import Image
    bild = Image.open(KACHEL).convert('RGB')
    w, h = bild.size
    maske = _dunkelmaske(bild)
    zeilen = ['A  WAS DIE DREI ZEILEN WIRKLICH ZAEHLEN',
              f'   (Bild {w}x{h}; gezaehlt wird max(rgb) < {DUNKEL}, Laeufe bis {MINDESTLAUF} px fliegen raus)']
    alle = []
    for anteil in ZEILEN_ANTEIL:
        y = int(h * anteil)
        gross = [(x, n) for x, n in _laeufe_der_zeile(maske, y) if n > MINDESTLAUF]
        klein = [(x, n) for x, n in _laeufe_der_zeile(maske, y) if n <= MINDESTLAUF]
        alle += [n for _, n in gross]
        text = '  '.join(f'x={x} ({n})' for x, n in gross)
        zeilen.append(f'   y={y}: {len(gross)} Laeufe > {MINDESTLAUF}   {text}')
        if klein:
            zeilen.append(f'          verworfen: {len(klein)} Laeufe <= {MINDESTLAUF} px')
    mittel = sum(alle) / len(alle)
    zeilen.append(f'   Mittel {mittel:.1f} von {w} = {16 * mittel / w:.2f} px bei 16'
                  f'   (kleinster {min(alle)}, groesster {max(alle)})')
    return zeilen


def _groesster_fleck(maske, nur_innen=False):
    """Rahmen des groessten zusammenhaengenden True-Flecks als (y0, y1, x0, x1)."""
    import numpy as np
    h, w = maske.shape
    gesehen = np.zeros_like(maske)
    bester = None
    for sy in range(h):
        for sx in range(w):
            if not maske[sy, sx] or gesehen[sy, sx]:
                continue
            stapel = [(sy, sx)]
            gesehen[sy, sx] = True
            n = 0
            y0 = y1 = sy
            x0 = x1 = sx
            randberuehrung = False
            while stapel:
                a, b = stapel.pop()
                n += 1
                y0, y1, x0, x1 = min(y0, a), max(y1, a), min(x0, b), max(x1, b)
                if a in (0, h - 1) or b in (0, w - 1):
                    randberuehrung = True
                for da, db in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    u, v = a + da, b + db
                    if 0 <= u < h and 0 <= v < w and maske[u, v] and not gesehen[u, v]:
                        gesehen[u, v] = True
                        stapel.append((u, v))
            if nur_innen and randberuehrung:
                continue
            if bester is None or n > bester[0]:
                bester = (n, y0, y1, x0, x1)
    return bester[1:] if bester else None


def _gesichtsmasse(bild, name):
    """Gesichtsbreite, Augenbreite und Luecke zwischen den Augen — in px des Bildes.

    Gesucht werden dunkle Laeufe, die INNERHALB einer hellen Flaeche liegen:
    links und rechts vom Lauf steht Weiss. Das sind die Augen und der Mund;
    der Umriss des Kopfes faellt raus, weil aussen kein Weiss steht.
    """
    import numpy as np
    a = np.asarray(bild.convert('RGB')).astype(np.int16)
    h, w = a.shape[:2]
    maske = a.max(axis=2) < DUNKEL
    hell = a.min(axis=2) > 200

    # DAS GESICHT IST DER GROESSTE WEISSE FLECK, DER DEN BILDRAND NICHT BERUEHRT.
    # „Die breiteste weisse Zeile" reichte nicht: die Kachel hat WEISSE ECKEN
    # (kein Alphakanal, die runden Ecken sind gebackenes Weiss), und die zaehlten
    # als Gesicht mit — das Gesicht kam dann 10,25 px breit heraus, breiter als
    # das ganze Zeichen.
    gesicht = _groesster_fleck(hell, nur_innen=True)
    if gesicht is None:
        return None
    gy0, gy1, gx0, gx1 = gesicht
    gesichtsbreite = gx1 - gx0 + 1
    gesicht_y = (gy0 + gy1) // 2

    # DIE AUGEN ALS ZUSAMMENHAENGENDE FLECKEN, nicht als Laeufe einer Zeile.
    # Ein Bogen liefert auf einer Zeile ZWEI Laeufe (linkes und rechtes Ende) —
    # wer Laeufe zaehlt, findet bei der Kachel vier „Augen" und bei der
    # Punkte-Fassung zwei. Gesucht sind Flecken, die ganz im weissen Gesicht
    # liegen: alle vier Nachbarn ihres Rahmens sind hell.
    innen = maske[gy0:gy1 + 1, gx0:gx1 + 1]
    gesehen = np.zeros_like(innen)
    flecken = []
    hi, wi = innen.shape
    for sy in range(hi):
        for sx in range(wi):
            if not innen[sy, sx] or gesehen[sy, sx]:
                continue
            stapel = [(sy, sx)]
            gesehen[sy, sx] = True
            punkte = []
            while stapel:
                a, b = stapel.pop()
                punkte.append((a, b))
                for da, db in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    u, v = a + da, b + db
                    if 0 <= u < hi and 0 <= v < wi and innen[u, v] and not gesehen[u, v]:
                        gesehen[u, v] = True
                        stapel.append((u, v))
            if len(punkte) < 50:
                continue
            pa = np.array(punkte)
            ry0, ry1 = pa[:, 0].min(), pa[:, 0].max()
            rx0, rx1 = pa[:, 1].min(), pa[:, 1].max()
            rahmen = (ry1 - ry0 + 1) * (rx1 - rx0 + 1)
            # Nur Flecken, die das Gesicht nicht beruehren — der Kopfumriss faellt so raus.
            if ry0 == 0 or rx0 == 0 or ry1 == hi - 1 or rx1 == wi - 1:
                continue
            flecken.append({'breite': rx1 - rx0 + 1, 'hoehe': ry1 - ry0 + 1,
                            'x': (rx0 + rx1) / 2, 'y': (ry0 + ry1) / 2,
                            'fuellung': len(punkte) / rahmen})
    flecken.sort(key=lambda f: -f['breite'] * f['hoehe'])
    return {'name': name, 'bild': w, 'gesichtsbreite': gesichtsbreite,
            'gesicht_y': gesicht_y, 'flecken': flecken[:3]}


def b_abstaende_im_gesicht():
    from PIL import Image
    zeilen = ['B  DIE ABSTAENDE IM GESICHT (alles auf 16 px umgerechnet)']
    kandidaten = [('kachel', Image.open(KACHEL).convert('RGB'))]
    svg = vergleich.svg_fassung(1024)   # die 16er-Fassung, gross gerendert
    kandidaten.append(('zeichen', svg))
    for name, bild in kandidaten:
        m = _gesichtsmasse(bild, name)
        if not m:
            zeilen.append(f'   {name:8} keine zwei inneren Laeufe gefunden')
            continue
        f = 16 / m['bild']
        zeilen.append(f"   {name:8} Gesicht {m['gesichtsbreite'] * f:5.2f} px breit")
        for fl in m['flecken']:
            zeilen.append(
                f"            Fleck {fl['breite'] * f:4.2f} x {fl['hoehe'] * f:4.2f} px, "
                f"Rahmen zu {fl['fuellung']:.0%} gefuellt")
    zeilen.append('   DIE FUELLUNG ENTSCHEIDET: ein Bogen laesst seinen Rahmen zu zwei Dritteln')
    zeilen.append('   leer. Beim Herunterrechnen wird aus 30 % Tinte auf einer Flaeche von')
    zeilen.append('   zwei Bildpunkten ein helles Grau — egal wie breit sein Strich ist.')
    return zeilen


def _auf_creme(bild):
    """RGBA auf den Hausgrund legen — NIE convert('RGB').

    `convert('RGB')` backt einen durchsichtigen Grund als SCHWARZ ein. Der
    erste Lauf dieses Werkzeugs hat genau das getan, und die Zeichnung kam mit
    69,5 % Tinte und einem Kantenwert heraus, der zur Haelfte ihr eigener
    schwarzer Grund war. Zahlen ueber ein Bild, das es nicht gibt.
    """
    from PIL import Image
    flaeche = Image.new('RGBA', bild.size, (255, 247, 236, 255))
    flaeche.alpha_composite(bild.convert('RGBA'))
    return flaeche.convert('RGB')


def _masse_bei(bild, groesse, grund=(255, 247, 236)):
    """kanten / dunkelinseln / tinte fuer ein Bild in einer Zielgroesse."""
    from PIL import Image
    klein = _auf_creme(bild).convert('RGBA').resize((groesse, groesse), Image.LANCZOS)
    anteil, inseln = vergleich.dunkelmass(klein)
    return {'kanten': vergleich.kanten(klein, grund), 'inseln': inseln, 'tinte': anteil, 'bild': klein}


def c_wo_der_umriss_dick_genug_ist():
    from PIL import Image
    kachel = Image.open(KACHEL).convert('RGB')
    zeilen = ['C  DIE GROESSEN, IN DENEN DER UMRISS UEBER EINEM BILDPUNKT LIEGT',
              '   (kanten = das Matsch-Mass aus favicon-vergleich.py, auf creme)']
    for g in (16, 32, 48, 64):
        breite = 34 * g / 1024
        k = _masse_bei(kachel, g)
        z = _masse_bei(vergleich.svg_fassung(1024), g)
        zeilen.append(f'   {g:3} px: Umriss {breite:4.2f} px | kachel kanten {k["kanten"]:.4f} inseln {k["inseln"]:2}'
                      f' | zeichen kanten {z["kanten"]:.4f} inseln {z["inseln"]:2}'
                      f' | Verhaeltnis {k["kanten"] / z["kanten"]:.2f}')
    return zeilen


def _verdicken(bild, radius):
    """Die dunklen Striche um `radius` px in alle Richtungen wachsen lassen."""
    import numpy as np
    from PIL import Image, ImageFilter
    maske = _dunkelmaske(bild)
    m = Image.fromarray((maske * 255).astype('uint8'))
    rest = radius
    while rest > 0:
        schritt = min(rest, 5)
        m = m.filter(ImageFilter.MaxFilter(2 * schritt + 1))
        rest -= schritt
    dick = np.asarray(m) > 127
    a = np.asarray(bild.convert('RGB')).copy()
    a[dick] = (0, 0, 0)
    return Image.fromarray(a)


def d_gegenprobe(bogen=None):
    from PIL import Image
    kachel = Image.open(KACHEL).convert('RGB')
    zeilen = ['D  GEGENPROBE: DEN UMRISS DICKER MACHEN, ALS DIE BEHAUPTUNG VERLANGT']
    roh = _masse_bei(kachel, 16)
    zeichen = _masse_bei(vergleich.svg_fassung(1024), 16)
    zeilen.append(f'   Umriss 0.53 px (wie gebaut) : kanten {roh["kanten"]:.4f}  inseln {roh["inseln"]:2}  tinte {roh["tinte"]:.1%}')
    bilder = [('roh', roh['bild'])]
    for radius, soll in ((15, 1.0), (31, 1.5), (47, 2.0)):
        dick = _verdicken(kachel, radius)
        m = _masse_bei(dick, 16)
        breite = (34 + 2 * radius) * 16 / 1024
        zeilen.append(f'   Umriss {breite:4.2f} px (verdickt)   : kanten {m["kanten"]:.4f}  inseln {m["inseln"]:2}  tinte {m["tinte"]:.1%}')
        bilder.append((f'dick{radius}', m['bild']))
    zeilen.append(f'   Zeichnung (Umriss 1.00 px)  : kanten {zeichen["kanten"]:.4f}  inseln {zeichen["inseln"]:2}  tinte {zeichen["tinte"]:.1%}')
    bilder.append(('zeichen', zeichen['bild']))
    if bogen:
        ziel = pathlib.Path(bogen)
        ziel.mkdir(parents=True, exist_ok=True)
        breit = len(bilder) * (16 * 16 + 8) + 8
        blatt = Image.new('RGB', (breit, 16 * 16 + 16), (255, 247, 236))
        for i, (_, b) in enumerate(bilder):
            gross = vergleich.auf_reiter(b, (255, 247, 236)).resize((256, 256), Image.NEAREST)
            blatt.paste(gross, (8 + i * 264, 8))
        weg = ziel / 'umriss-gegenprobe.png'
        blatt.save(weg)
        zeilen.append(f'   Bogen: {weg}   (Reihe: {", ".join(n for n, _ in bilder)})')
    return zeilen


def e_gegenbeispiel(bogen=None):
    """DER FALL, DEN DIE BEHAUPTUNG NICHT ERKLAEREN KANN.

    favicon.svg hat einen Kopfumriss von 1,7 * 1,18 = 2,0 von 32 Einheiten,
    also GENAU 1,00 px bei 16 — ueber der Schwelle, die die Behauptung nennt.
    Mit den Augenboegen der Quelle war diese Zeichnung bei 16 px trotzdem
    Matsch; das steht seit dem 08.08.2026 in favicon-bauen.py („aus dem
    Gesicht wird ein Fleck"). Geheilt wurde es NICHT ueber die Strichbreite,
    sondern indem die Boegen durch zwei gefuellte Punkte ersetzt wurden.

    Beide Fassungen haben denselben Umriss. Nur eine davon ist lesbar.
    """
    from PIL import Image
    quelle = vergleich.SVG.read_text(encoding='utf-8')

    def rendern(text):
        import subprocess
        import tempfile
        with tempfile.TemporaryDirectory() as t:
            svg = pathlib.Path(t) / 'x.svg'
            png = pathlib.Path(t) / 'x.png'
            svg.write_text(text, encoding='utf-8')
            subprocess.run(['rsvg-convert', '-w', '1024', '-h', '1024',
                            str(svg), '-o', str(png)], check=True, capture_output=True)
            return Image.open(png).convert('RGBA').copy()

    faelle = [('boegen (Quelle)', rendern(quelle)),
              ('punkte (16er)', rendern(vergleich._augen_zu_punkten(quelle))),
              ('kachel', Image.open(KACHEL).convert('RGBA'))]
    zeilen = ['E  DER FALL, DEN DIE BEHAUPTUNG NICHT ERKLAEREN KANN',
              '   Kopfumriss der Zeichnung: stroke-width 1.7 * scale 1.18 = 2.0 von 32 = 1.00 px bei 16.',
              '   Beide SVG-Fassungen tragen DENSELBEN Umriss — nur die Augen sind anders.']
    bilder = []
    for name, bild in faelle:
        m = _masse_bei(bild, 16)
        bilder.append((name, m['bild']))
        zeilen.append(f'   {name:16} kanten {m["kanten"]:.4f}  dunkelinseln {m["inseln"]:2}  tinte {m["tinte"]:.1%}')
    zeilen.append('   Matsch bei 1,00 px Umriss ist moeglich (Boegen), und Lesbarkeit bei')
    zeilen.append('   demselben 1,00 px Umriss ist moeglich (Punkte). Die Strichbreite')
    zeilen.append('   unterscheidet die beiden Faelle nicht — die Form der Augen tut es.')
    if bogen:
        ziel = pathlib.Path(bogen)
        ziel.mkdir(parents=True, exist_ok=True)
        blatt = Image.new('RGB', (len(bilder) * 264 + 8, 272), (255, 247, 236))
        for i, (_, b) in enumerate(bilder):
            blatt.paste(vergleich.auf_reiter(b, (255, 247, 236)).resize((256, 256), Image.NEAREST),
                        (8 + i * 264, 8))
        weg = ziel / 'umriss-gegenbeispiel.png'
        blatt.save(weg)
        zeilen.append(f'   Bogen: {weg}   (Reihe: {", ".join(n for n, _ in bilder)})')
    return zeilen


def main():
    p = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    p.add_argument('--bogen', help='Ordner fuer den Kontaktbogen')
    args = p.parse_args()
    for teil in (a_was_die_zeilen_zaehlen(), b_abstaende_im_gesicht(),
                 c_wo_der_umriss_dick_genug_ist(), d_gegenprobe(args.bogen),
                 e_gegenbeispiel(args.bogen)):
        print('\n'.join(teil))
        print()


if __name__ == '__main__':
    main()
