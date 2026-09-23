#!/usr/bin/env python3
"""Was steht WIRKLICH in favicon.ico — am rohen Byte, nicht ueber Pillows Leser.

══ WOZU ═══════════════════════════════════════════════════════════════════
tools/favicon-vergleich.py beantwortet die Frage „traegt die .ico die
16er-Sonderfassung?" ueber `im.size = s` und einen Bildvergleich. Das ist ein
Umweg ueber genau die Bibliothek, die im Verdacht steht — und `im.size = s`
hat bei IcoImageFile eine Geschichte (die Groesse umsetzen laedt den Rahmen
nicht zwingend neu). Wer damit misst, misst womoeglich zweimal denselben Rahmen.

Dieses Werkzeug liest die ICONDIR/ICONDIRENTRY-Tabelle selbst und schneidet
jeden Rahmen als eigene Bytefolge heraus. Danach steht fest, WIE VIELE Rahmen
drin sind, welche Groesse jeder hat, und — das ist der Kern — ob der 16er
Rahmen aus favicon-16.png stammt oder aus favicon-48.png heruntergerechnet ist.

══ DIE ENTSCHEIDENDE GEGENPROBE ═══════════════════════════════════════════
Eine mittlere Abweichung zu favicon-16.png beweist fuer sich GAR NICHTS: auch
zwei ehrlich verschiedene Skalierungswege weichen voneinander ab (der 32er tut
es, und dort gibt es gar keine Sonderfassung). Beweisend ist nur die andere
Seite: Wenn der 16er Rahmen der ICO Pixel fuer Pixel dem entspricht, was
`favicon-48.png .thumbnail((16,16), LANCZOS)` liefert — also genau dem, was
Pillows IcoImagePlugin._save im else-Zweig baut — dann ist er heruntergerechnet
und die Sonderfassung ist nicht drin.

══ UND DIE INSELN ═════════════════════════════════════════════════════════
Die Sonderfassung gibt es wegen EINER Sache: zwei Augen sollen bei 16 px zwei
getrennte dunkle Inseln bleiben statt zu einem Balken zu verlaufen. Also wird
das hier auch gezaehlt — sonst weiss man, dass etwas anders ist, aber nicht,
ob es weh tut.

══ AUFRUF ═════════════════════════════════════════════════════════════════
    python3 tools/ico-inhalt-schau.py
    python3 tools/ico-inhalt-schau.py --probe   # baut die Fassung MIT
                                                # append_images in einen
                                                # Wegwerfordner und misst sie
"""
import io
import pathlib
import struct
import sys
import tempfile

WURZEL = pathlib.Path(__file__).resolve().parent.parent
ORDNER = WURZEL / 'NewDesign/bilder'
ICO = ORDNER / 'favicon.ico'


def rahmen_lesen(weg):
    """Die ICONDIR-Tabelle selbst auseinandernehmen.

    Aufbau: 6 Byte Kopf (reserviert, Typ, Anzahl), dann je 16 Byte Eintrag.
    Byte 0/1 sind Breite/Hoehe, 0 bedeutet 256. Byte 8..11 Laenge, 12..15 Versatz.
    """
    roh = pathlib.Path(weg).read_bytes()
    res, typ, anzahl = struct.unpack('<HHH', roh[:6])
    eintraege = []
    for i in range(anzahl):
        e = roh[6 + i * 16: 22 + i * 16]
        b, h, farben, _r, ebenen, bits = struct.unpack('<BBBBHH', e[:8])
        laenge, versatz = struct.unpack('<II', e[8:16])
        nutz = roh[versatz:versatz + laenge]
        eintraege.append({
            'breite': b or 256, 'hoehe': h or 256, 'bits': bits,
            'laenge': laenge, 'versatz': versatz, 'bytes': nutz,
            'png': nutz[:8] == b'\x89PNG\r\n\x1a\n',
        })
    return {'typ': typ, 'anzahl': anzahl, 'rahmen': eintraege, 'gesamt': len(roh)}


def als_bild(rahmen):
    from PIL import Image
    if rahmen['png']:
        return Image.open(io.BytesIO(rahmen['bytes'])).convert('RGBA')
    # DIB-Rahmen: Pillow kann ihn nicht direkt, aber diese Datei hat keine.
    raise SystemExit('Rahmen ist kein PNG — dieser Weg ist hier nicht gebaut.')


def abweichung(a, b):
    """Mittlere Abweichung ueber RGB *und* Alpha, plus Zahl ungleicher Pixel."""
    if a.size != b.size:
        return None, None
    pa, pb = list(a.getdata()), list(b.getdata())
    s = 0
    n = 0
    for x, y in zip(pa, pb):
        d = max(abs(x[k] - y[k]) for k in range(4))
        s += d
        if d:
            n += 1
    return s / len(pa), n


def inseln(bild):
    """Dunkle zusammenhaengende Flecken auf Weiss — die Augenprobe.

    Dieselbe Rechnung wie in tools/favicon-vergleich.py (Luma < 96, auf Weiss
    komponiert), damit die Zahlen vergleichbar bleiben.
    """
    from PIL import Image
    flaeche = Image.new('RGBA', bild.size, (255, 255, 255, 255))
    flaeche.alpha_composite(bild)
    px = flaeche.convert('RGB').load()
    w, h = bild.size
    dunkel = [[0.2126 * px[x, y][0] + 0.7152 * px[x, y][1] + 0.0722 * px[x, y][2] < 96
               for x in range(w)] for y in range(h)]
    gesehen = [[False] * w for _ in range(h)]
    z = 0
    for y in range(h):
        for x in range(w):
            if dunkel[y][x] and not gesehen[y][x]:
                z += 1
                stapel = [(x, y)]
                gesehen[y][x] = True
                while stapel:
                    a, b = stapel.pop()
                    for da, db in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        u, v = a + da, b + db
                        if 0 <= u < w and 0 <= v < h and dunkel[v][u] and not gesehen[v][u]:
                            gesehen[v][u] = True
                            stapel.append((u, v))
    return z


def pillow_verkleinert(quelle, groesse):
    """GENAU der else-Zweig aus IcoImagePlugin._save nachgebaut."""
    from PIL import Image
    f = Image.open(quelle).convert('RGBA').copy()
    f.thumbnail((groesse, groesse), Image.Resampling.LANCZOS, reducing_gap=None)
    return f


def schau(weg, titel):
    from PIL import Image
    d = rahmen_lesen(weg)
    print(f'\n═══ {titel} ' + '═' * max(2, 60 - len(titel)))
    print(f'  Datei {d["gesamt"]} Byte, Typ {d["typ"]} (1=ICO), {d["anzahl"]} Rahmen')
    for r in d['rahmen']:
        print(f'  Rahmen {r["breite"]}x{r["hoehe"]}  {r["bits"]} bit  '
              f'{r["laenge"]} Byte  {"PNG" if r["png"] else "DIB"}')
    print()
    for r in d['rahmen']:
        g = r['breite']
        drin = als_bild(r)
        png = ORDNER / f'favicon-{g}.png'
        soll = Image.open(png).convert('RGBA')
        herunter = pillow_verkleinert(ORDNER / 'favicon-48.png', g)
        a1, n1 = abweichung(drin, soll)
        a2, n2 = abweichung(drin, herunter)
        # DER BYTEVERGLEICH ist schaerfer als jeder Pixelvergleich: gleiche
        # Pixel koennen aus verschiedenen Wegen kommen, gleiche Bytes nicht.
        roh_soll = io.BytesIO()
        soll.save(roh_soll, 'png')
        roh_herunter = io.BytesIO()
        herunter.save(roh_herunter, 'png')
        gleich_soll = r['bytes'] == roh_soll.getvalue()
        gleich_herunter = r['bytes'] == roh_herunter.getvalue()
        print(f'  {g:3d} px  gegen {png.name:16s} abw {a1:6.2f}  ungleiche Pixel {n1:4d}'
              f'  bytegleich {"JA" if gleich_soll else "nein"}')
        print(f'          gegen 48er heruntergerechnet  abw {a2:6.2f}  ungleiche Pixel {n2:4d}'
              f'  bytegleich {"JA" if gleich_herunter else "nein"}')
        print(f'          dunkle Inseln: in der ICO {inseln(drin)}  '
              f'in {png.name} {inseln(soll)}  im heruntergerechneten {inseln(herunter)}')
    return d


def augenfeld():
    """Die Augengegend bei 16 px als Zeichenkarte — dort, und nur dort, sitzt der Streit.

    Die Ellipsen der Sonderfassung stehen bei cx 13,1 / 18,9 und cy 19,9 in
    einem viewBox von 0 0 32 32. Bei 16 px ist das der halbe Wert: x 6,6 / 9,5,
    y 10,0. Ausgeschnitten wird grosszuegig x 4..12, y 8..13.

    WARUM DIE INSELZAHL DES GANZEN BILDES NICHT REICHT: sie zaehlt Kopfhoerer,
    Umriss und Stifte mit. Sieben Inseln hier und sieben dort kann zweimal eine
    voellig andere Aufteilung sein. Die Frage ist, ob im AUGENFELD zwei
    getrennte dunkle Flecken stehen.
    """
    from PIL import Image
    d = rahmen_lesen(ICO)
    ico16 = als_bild(next(r for r in d['rahmen'] if r['breite'] == 16))
    fassungen = (
        ('favicon.ico (heruntergerechnet)', ico16),
        ('favicon-16.png (Sonderfassung)', Image.open(ORDNER / 'favicon-16.png').convert('RGBA')),
    )
    print('\n═══ Das Augenfeld bei 16 px ' + '═' * 45)
    print('  Zeichen: # unter Luma 96 (dunkel), + unter 160, . darueber\n')
    for name, bild in fassungen:
        flaeche = Image.new('RGBA', bild.size, (255, 255, 255, 255))
        flaeche.alpha_composite(bild)
        px = flaeche.convert('RGB').load()
        print(f'  {name}')
        felder = []
        for y in range(8, 13):
            zeile = ''
            for x in range(4, 13):
                p = px[x, y]
                L = 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]
                zeile += '#' if L < 96 else ('+' if L < 160 else '.')
                felder.append((x, y, L))
            print('    ' + zeile)
        # Inseln NUR in diesem Ausschnitt zaehlen.
        dunkel = {(x, y) for x, y, L in felder if L < 96}
        gesehen = set()
        z = 0
        for p in dunkel:
            if p in gesehen:
                continue
            z += 1
            stapel = [p]
            gesehen.add(p)
            while stapel:
                a, b = stapel.pop()
                for da, db in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    q = (a + da, b + db)
                    if q in dunkel and q not in gesehen:
                        gesehen.add(q)
                        stapel.append(q)
        print(f'    -> dunkle Flecken im Augenfeld: {z}\n')


def probe():
    """Die vorgeschlagene Fassung bauen — und pruefen, ob sie sich anders verhaelt."""
    from PIL import Image
    with tempfile.TemporaryDirectory() as t:
        ziel = pathlib.Path(t) / 'favicon.ico'
        bilder = [Image.open(ORDNER / f'favicon-{g}.png').convert('RGBA') for g in (16, 32, 48)]
        bilder[2].save(ziel, format='ICO', sizes=[(16, 16), (32, 32), (48, 48)],
                       append_images=bilder[:2])
        schau(ziel, 'MIT append_images (Vorschlag, Wegwerfordner)')


if __name__ == '__main__':
    schau(ICO, 'ausgeliefert: NewDesign/bilder/favicon.ico')
    if '--probe' in sys.argv[1:]:
        probe()
