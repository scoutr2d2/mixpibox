#!/usr/bin/env python3
"""Wuerde „Weiss zu Alpha" das Gesicht der Kachel durchloechern? MESSEN.

══ DIE BEHAUPTUNG ═════════════════════════════════════════════════════════
Aus tools/favicon-vergleich.py, Abschnitt „Die Kachel als Datei":

    „Ecke (253,253,254)  Gesicht (254,254,254)  Abstand 1.4
     — zu klein, um Weiss auszustanzen, ohne das Gesicht mitzunehmen"

Daraus wird die Aussage: das Weiss der Leinwand IST das Weiss des Gesichts,
also durchloechert jedes Freistellen die Figur.

══ WAS DIESES WERKZEUG PRUEFT ═════════════════════════════════════════════
Vier Fragen, getrennt, weil sie verschiedene Antworten haben koennen:

  1. STIMMT DER BELEG?  Eckpixel, Gesichtspixel, Abstand — nachgemessen.

  2. WIRD IM BAUM UEBERHAUPT „Weiss zu Alpha" GERECHNET?  Das Projekt hat
     genau EIN Freistellwerkzeug (tools/bilder-freistellen.py), und das
     maskiert AUSDRUECKLICH NICHT nach Farbe. Es flutet vom Bildrand her und
     bleibt an der dunklen Kontur stehen. Die Frage ist also nicht „sind die
     beiden Weiss gleich", sondern „haengt das Gesichtsweiss mit dem Bildrand
     zusammen". Das ist eine TOPOLOGISCHE Frage, keine farbliche.

  3. WAS PASSIERT WIRKLICH, wenn man die Kachel durch dieses Werkzeug
     schickt?  Nicht ueberlegt — ausgefuehrt, und danach im Ergebnis
     nachgesehen, ob an der Stelle des Gesichts ein Loch steht.

  4. WER LIEST DIE DATEI IM BAU?  Eine Gefahr, die kein Ablauf ausloest, ist
     eine andere Gefahr als eine, die bei jedem Lauf zuschlaegt.

AUFRUF
    python3 tools/kachel-weiss-loecher.py
    python3 tools/kachel-weiss-loecher.py --bild /tmp/x.png   # andere Quelle
"""
import argparse
import ast
import math
import pathlib
import sys

WURZEL = pathlib.Path(__file__).resolve().parent.parent
KACHEL = WURZEL / 'NewDesign/bilder/quellen/Meshy_AI_mixpi-favicon.png'
FREISTELLEN = WURZEL / 'tools/bilder-freistellen.py'

# Die zwei Stellen, mit denen die Behauptung rechnet (aus favicon-vergleich.py:
# `px[2, 2]` und `px[w // 2, int(h * 0.68)]`).
ECKE = (2, 2)
GESICHT_REL = (0.5, 0.68)


def _laden():
    from PIL import Image
    return Image.open(KACHEL)


def beleg_nachmessen(pfad):
    """Frage 1: Stimmen die Zahlen, mit denen die Behauptung rechnet?"""
    from PIL import Image
    roh = Image.open(pfad)
    px = roh.convert('RGB').load()
    w, h = roh.size
    gx, gy = int(w * GESICHT_REL[0]), int(h * GESICHT_REL[1])
    ecke, gesicht = px[ECKE], px[gx, gy]
    return {
        'modus': roh.mode,
        'groesse': (w, h),
        'alpha': roh.mode in ('RGBA', 'LA') or 'transparency' in roh.info,
        'ecke': ecke,
        'gesicht': gesicht,
        'gesicht_ort': (gx, gy),
        'abstand': math.dist(ecke, gesicht),
    }


def haengt_zusammen(pfad, toleranz):
    """Frage 2: Erreicht die Flut vom Bildrand das Gesicht?

    Genau die Rechnung, die bilder-freistellen.py macht — dieselben
    Funktionen, nicht nachgebaut.
    """
    import importlib.util

    import numpy as np
    from PIL import Image

    spec = importlib.util.spec_from_file_location('fs', FREISTELLEN)
    fs = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fs)

    roh = Image.open(pfad).convert('RGB')
    a = np.asarray(roh).astype(np.float32)
    gruende = fs.hintergrundfarben(a, toleranz)
    passt = np.zeros(a.shape[:2], dtype=bool)
    for g in gruende:
        passt |= np.sqrt(((a - g) ** 2).sum(axis=2)) < toleranz

    marken = np.zeros(passt.shape, dtype=np.int32)
    fs._flut(passt, marken, fs.randsaat(passt), 1)
    aussen = marken == 1

    h, w = passt.shape
    gx, gy = int(w * GESICHT_REL[0]), int(h * GESICHT_REL[1])
    grau = np.asarray(roh.convert('L')).astype(np.float32)

    # Das Gebiet, in dem der Gesichtspunkt liegt — als eigene Flut.
    eigen = np.zeros(passt.shape, dtype=np.int32)
    n = fs._flut(passt, eigen, [(gy, gx)], 9) if passt[gy, gx] else 0

    return {
        'gruende': [tuple(int(x) for x in g) for g in gruende],
        'gesicht_passt_zum_grund': bool(passt[gy, gx]),
        'gesicht_ist_aussen': bool(aussen[gy, gx]),
        'aussen_anteil': float(aussen.mean()),
        'gesichtsgebiet_pixel': int(n),
        'gesichtsgebiet_median': float(np.median(grau[eigen == 9])) if n else None,
        'grund_wert': float(np.median(grau[aussen])) if aussen.any() else None,
        'nah_genug': 3.0,
    }


def wirklich_freistellen(pfad, toleranz):
    """Frage 3: Durch das echte Werkzeug schicken und ins Ergebnis sehen."""
    import importlib.util

    import numpy as np

    spec = importlib.util.spec_from_file_location('fs', FREISTELLEN)
    fs = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fs)

    bild, bericht = fs.freistellen(pathlib.Path(pfad), toleranz)
    alpha = np.asarray(bild.convert('RGBA'))[:, :, 3]
    h, w = alpha.shape
    gx, gy = int(w * GESICHT_REL[0]), int(h * GESICHT_REL[1])

    # Wie gross ist das Loch, wenn eins da ist? Nur zusammenhaengend um den
    # Gesichtspunkt herum gezaehlt — sonst zaehlt man den Aussenraum mit.
    loch = 0
    if alpha[gy, gx] == 0:
        durchsichtig = alpha == 0
        marken = np.zeros(durchsichtig.shape, dtype=np.int32)
        fs._flut(durchsichtig, marken, [(gy, gx)], 1)
        loch = int((marken == 1).sum())

    return {
        'alpha_am_gesicht': int(alpha[gy, gx]),
        'loch_pixel': loch,
        'loch_anteil': loch / alpha.size,
        'bericht': bericht,
    }


def wer_liest_die_datei():
    """Frage 4: Welche Bauwerkzeuge lesen die Kachel — und freistellen sie?

    Gelesen wird der QUELLTEXT der Werkzeuge, nicht geraten: gesucht wird
    nach dem Dateinamen und danach, ob im selben Werkzeug bilder-freistellen
    vorkommt.
    """
    treffer = []
    for p in sorted((WURZEL / 'tools').glob('*.py')) + \
            sorted((WURZEL / 'remote-step-installer/tools').glob('*.py')):
        try:
            text = p.read_text(encoding='utf-8')
        except OSError:
            continue
        if KACHEL.name not in text:
            continue
        baut = 'bauen' in p.name or 'sdstart-bilder' in p.name
        treffer.append({
            'werkzeug': str(p.relative_to(WURZEL)),
            'baut_ausgeliefertes': baut,
            'ruft_freistellen': 'bilder-freistellen' in text or 'freistellen(' in text,
        })
    return treffer


def main():
    p = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    p.add_argument('--bild', type=pathlib.Path, default=KACHEL)
    p.add_argument('--toleranz', type=int, default=None,
                   help='Vorgabe: beide gemessen — 28 (bilder-freistellen) und '
                        '70 (sdstart-bilder)')
    a = p.parse_args()

    if not a.bild.is_file():
        print(f'Nicht gefunden: {a.bild}', file=sys.stderr)
        return 1

    print('═══ 1. Der Beleg der Behauptung ' + '═' * 44)
    b = beleg_nachmessen(a.bild)
    print(f'  Datei      {a.bild}  {b["groesse"][0]}x{b["groesse"][1]}  Modus {b["modus"]}')
    print(f'  Alphakanal {"ja" if b["alpha"] else "NEIN"}')
    print(f'  Ecke{ECKE}  {b["ecke"]}')
    print(f'  Gesicht{b["gesicht_ort"]}  {b["gesicht"]}')
    print(f'  Abstand in RGB  {b["abstand"]:.1f}')

    toleranzen = [a.toleranz] if a.toleranz else [28, 70]
    for t in toleranzen:
        print(f'\n═══ 2. Haengt das Gesichtsweiss mit dem Rand zusammen? (Toleranz {t}) '
              + '═' * 8)
        z = haengt_zusammen(a.bild, t)
        print(f'  Grundfarben aus den Ecken   {z["gruende"]}')
        print(f'  Gesichtspunkt faellt in die Grundtoleranz   '
              f'{"JA" if z["gesicht_passt_zum_grund"] else "nein"}')
        print(f'  Gesichtspunkt von der Randflut erreicht     '
              f'{"JA" if z["gesicht_ist_aussen"] else "NEIN — die Flut kommt nicht hin"}')
        print(f'  Aussen (durchsichtig) insgesamt   {z["aussen_anteil"]:.1%}')
        if z['gesichtsgebiet_pixel']:
            print(f'  Eingeschlossenes Gebiet um das Gesicht  '
                  f'{z["gesichtsgebiet_pixel"]} px, Median {z["gesichtsgebiet_median"]:.1f}')
            print(f'  Hintergrund draussen Median            {z["grund_wert"]:.1f}'
                  f'   (Taschenschwelle NAH_GENUG = {z["nah_genug"]})')

        print(f'\n═══ 3. Durch das echte Werkzeug geschickt (Toleranz {t}) ' + '═' * 18)
        w = wirklich_freistellen(a.bild, t)
        print(f'  Alpha am Gesichtspunkt   {w["alpha_am_gesicht"]}'
              f'   {"— LOCH" if w["alpha_am_gesicht"] == 0 else "— deckend, kein Loch"}')
        if w['loch_pixel']:
            print(f'  Loch zusammenhaengend    {w["loch_pixel"]} px '
                  f'({w["loch_anteil"]:.1%} der Flaeche)')
        ber = w['bericht']
        print(f'  Bericht: {ber["durchsichtig"]:.1%} frei, '
              f'{ber["innen_gerettet"]:.1%} innen gerettet, '
              f'{ber["taschen"]} Tasche(n) getilgt {ber.get("taschen_median")}')

    print('\n═══ 4. Wer liest die Datei im Bau? ' + '═' * 41)
    for t in wer_liest_die_datei():
        marke = 'BAUT AUS' if t['baut_ausgeliefertes'] else 'nur messen'
        print(f'  {marke:10s}  {t["werkzeug"]:52s} '
              f'freistellen: {"JA" if t["ruft_freistellen"] else "NEIN"}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
