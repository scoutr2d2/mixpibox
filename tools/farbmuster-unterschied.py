#!/usr/bin/env python3
"""Wie weit stehen die Farbmuster AUSEINANDER — je Satz und je Streifen?

WOZU: Gemeldet am 08.08.2026: „die farbton vorschau war glaube ich schon mal
besser jetzt sieht man nur schwarze balken" — und nachgeschoben: „ich hab es in
dunkel angeschaut dort ist es deutlicher erkennbar der farb unterschied", „im
hellen modus ist es sehr schwach".

Das Muster (`farbwahlBauen` in NewDesign/app.js) zeigt DREI Streifen: den Grund
(--bg), die Flaeche (--surface) und die Schrift (--ink). Ob fuenf solche Muster
UNTERSCHEIDBAR sind, entscheidet nicht der Geschmack, sondern der Abstand ihrer
Farben. Genau den rechnet dieses Werkzeug aus — getrennt nach hell und dunkel,
und getrennt nach Streifen.

DER ABSTAND IST ΔE (CIE76 in Lab) und nicht die Differenz der RGB-Zahlen: Zwei
Farben mit gleichem RGB-Abstand koennen fuer das Auge weit auseinander oder
ununterscheidbar sein. Als Faustzahlen gelten:
    ΔE < 1     nicht zu unterscheiden
    ΔE 1..2    nur im direkten Vergleich, geuebtes Auge
    ΔE 2..10   sichtbar
    ΔE > 10    deutlich verschieden
Auf einem 7-Zoll-Schirm mit Fingerabdruecken darf man die untere Haelfte davon
vergessen.

WAS ES AENDERT: nichts. Es liest NewDesign/app.css.

AUFRUF
    python3 tools/farbmuster-unterschied.py
"""
import itertools
import pathlib
import re

QUELLE = pathlib.Path('NewDesign/app.css')
# Die Streifen des Musters, in der Reihenfolge, in der sie uebereinander liegen.
#
# NACHGEZOGEN AM 08.08.2026: Hier stand `['bg', 'surface', 'ink']` — das war
# das Muster von FRUEHER. Seit der Meldung „die farbton vorschau war glaube
# ich schon mal besser jetzt sieht man nur schwarze balken" zeigt es
# `--hl / --muted / --bg` (app.css, `.farbwahl-hell/-mitte/-grund`), und das
# Werkzeug urteilte seither ueber ein Muster, das es nicht mehr gibt: es rief
# `surface` aus, das in JEDEM Satz reines Weiss ist (ΔE 0,0), und hielt das
# fuer eine Aussage ueber die Unterscheidbarkeit.
STREIFEN = ['hl', 'muted', 'bg']
# SIE WIRD NICHT AUS app.css GERATEN, sondern steht da. Ein Werkzeug, das
# alle `[data-farbe='…']` einsammelt, faende auch Bloecke, die kein Satz sind,
# und die Zahl „schlechtestes Paar" haengt daran, WELCHE Saetze verglichen
# werden. Wer einen Satz hinzufuegt, traegt ihn hier ein — genau wie in
# FARB_SAETZE in NewDesign/app.js und in SAETZE in farbsaetze-bauen.mjs.
FARBEN = ['creme', 'blau', 'rot', 'rosa', 'gruen', 'superrosa', 'pink', 'gelb', 'orange']


def rgb(h):
    h = h.strip().lstrip('#')
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def lab(farbe):
    """sRGB -> CIE L*a*b* (D65). Ohne Bibliothek, damit die Box nichts nachladen muss."""
    def linear(c):
        c = c / 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (linear(c) for c in farbe)
    x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047
    y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.00000
    z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883

    def f(t):
        return t ** (1 / 3) if t > 0.008856 else (7.787 * t + 16 / 116)

    fx, fy, fz = f(x), f(y), f(z)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def de(a, b):
    la, lb = lab(rgb(a)), lab(rgb(b))
    return sum((x - y) ** 2 for x, y in zip(la, lb)) ** 0.5


def bloecke(text):
    """Je Farbe und Satz die Variablen einsammeln.

    KOMMENTARE FLIEGEN ZUERST RAUS, und das ist keine Kosmetik: Der Fang fuer
    den Waehler (`[^{}]*` vor der Klammer) reicht bis zur vorigen schliessenden
    Klammer und nimmt den Kommentar davor mit. Im Kommentar ueber dem HELLEN
    Creme-Block steht das Wort „dunkel" — der helle Satz wurde damit als dunkel
    einsortiert und ueberschrieb den echten. Gemerkt beim ersten Lauf: „Nicht
    gefunden: [('creme', 'hell')]".

    DIE WAHL ENTSCHEIDET, NICHT DIE REIHENFOLGE: gesucht werden die Bloecke mit
    `[data-farbe='<name>']`, und ein Block mit zusaetzlichem `data-licht='dunkel'`
    gehoert zum dunklen Satz. Ein blosses Durchzaehlen der Bloecke waere beim
    naechsten Umbau still falsch.
    """
    raus = {}
    text = re.sub(r'/\*.*?\*/', ' ', text, flags=re.S)
    for m in re.finditer(r'([^{}]*)\{([^{}]*)\}', text):
        wahl, leib = m.group(1), m.group(2)
        if 'data-farbe' not in wahl:
            continue
        namen = set(re.findall(r"data-farbe='(\w+)'", wahl))
        if len(namen) != 1:
            continue
        name = namen.pop()
        satz = 'dunkel' if 'dunkel' in wahl else 'hell'
        werte = dict(re.findall(r'--([\w-]+):\s*(#[0-9A-Fa-f]{3,8})', leib))
        if werte:
            raus.setdefault((name, satz), {}).update(werte)
    return raus


def main():
    text = QUELLE.read_text(encoding='utf-8')
    b = bloecke(text)
    fehlt = [k for k in itertools.product(FARBEN, ('hell', 'dunkel')) if k not in b]
    if fehlt:
        print('Nicht gefunden:', fehlt)
        return 2

    for satz in ('hell', 'dunkel'):
        print(f'\n══ {satz.upper()} ═══════════════════════════════════════════════')
        # ALLE Variablen, die in JEDER Palette stehen — nicht nur die
        # drei gezeigten. Sonst waehlt man die Verbesserung nach Gefuehl aus.
        gemeinsam = sorted(set.intersection(*(set(b[(f, satz)]) for f in FARBEN)))
        zeilen = []
        for var in gemeinsam:
            werte = {f: b[(f, satz)][var] for f in FARBEN}
            paare = [(a, c, de(werte[a], werte[c])) for a, c in itertools.combinations(FARBEN, 2)]
            kleinster = min(paare, key=lambda p: p[2])
            zeilen.append((kleinster[2], sum(p[2] for p in paare) / len(paare), var, kleinster))
        # NACH DEM KLEINSTEN ABSTAND SORTIERT, nicht nach dem Mittel: Ein Muster
        # ist genau so gut wie sein SCHLECHTESTES Paar. Muster, von denen
        # zwei gleich aussehen, sind fuenf unbrauchbare Muster.
        zeilen.sort(reverse=True)
        for klein, mittel, var, k in zeilen:
            marke = ' <- zeigt das Muster' if var in STREIFEN else ''
            print(
                f'  {var:<12} schlechtestes Paar ΔE {klein:5.1f} ({k[0]}/{k[1]}), '
                f'Mittel {mittel:5.1f}{marke}'
            )
        # Die Farben selbst, damit man sie nachschlagen kann
        print('   ', ' '.join(f'{f}:{b[(f, satz)].get("bg", "?")}' for f in FARBEN))

    # ══ WELCHE DREI GEHOEREN INS MUSTER? ═══════════════════════════════════
    #
    # DIE FRAGE IST NICHT „welche Variable ist am buntesten", sondern: Sind
    # zwei Muster UNTERSCHEIDBAR? Und das sind sie, sobald IRGENDEINER ihrer
    # gezeigten Streifen weit genug auseinanderliegt. Gerechnet wird deshalb
    #     je Palettenpaar  das MAXIMUM ueber die gezeigten Streifen
    #     ueber alle Paare das MINIMUM davon
    # — das schlechteste Paar entscheidet. Muster, von denen zwei gleich
    # aussehen, sind fuenf unbrauchbare Muster.
    #
    # UND ES ZAEHLT DER SCHLECHTERE DER BEIDEN SAETZE. Ein Muster, das nur im
    # Dunkeln taugt, ist genau das, was gemeldet wurde.
    print('\n══ WELCHE STREIFEN MACHEN DIE SAETZE UNTERSCHEIDBAR?  ════════════')
    gemeinsam = sorted(set.intersection(*(set(b[(f, satz)]) for f in FARBEN for satz in ('hell', 'dunkel'))))

    def guete(vars_, satz):
        schlecht = 1e9
        for a, c in itertools.combinations(FARBEN, 2):
            bestes = max(de(b[(a, satz)][v], b[(c, satz)][v]) for v in vars_)
            schlecht = min(schlecht, bestes)
        return schlecht

    kandidaten = []
    for n in (3, 4):
        for kombi in itertools.combinations(gemeinsam, n):
            h, d = guete(kombi, 'hell'), guete(kombi, 'dunkel')
            kandidaten.append((min(h, d), h, d, kombi))
    kandidaten.sort(reverse=True)
    jetzt = guete(STREIFEN, 'hell'), guete(STREIFEN, 'dunkel')
    print(f'  HEUTE ({", ".join(STREIFEN)}): hell {jetzt[0]:5.1f}   dunkel {jetzt[1]:5.1f}   '
          f'-> schlechter Satz {min(jetzt):5.1f}')
    print('  Die zehn besten (ohne Ruecksicht auf die Flaeche):')
    for w, h, d, k in kandidaten[:10]:
        print(f'    {w:5.1f}  (hell {h:5.1f}, dunkel {d:5.1f})  {", ".join(k)}')

    # ══ UND JETZT MIT FLAECHE — DENN DARAN SCHEITERT DIE ZAHL OBEN ═════════
    #
    # Die reine ΔE-Rechnung gibt dem heutigen Muster im Hellen 13,6 und damit
    # ein „unterscheidbar". Am Schirm sieht man „nur schwarze Balken". Beides
    # stimmt, und der Widerspruch hat einen Namen: FLAECHE.
    #
    #   Grund    66x66 minus die zwei Streifen  ~3020 px²  = 69 %  ΔE 2,5
    #   Flaeche  50x20                           1000 px²  = 23 %  ΔE 0,0
    #   Schrift  42x8                              336 px²  =  8 %  ΔE 13,6
    #
    # Die einzige Farbe, die im Hellen ueberhaupt etwas sagt, sitzt also auf
    # acht Prozent der Flaeche — und ist dort ausserdem fast schwarz, wo das
    # Auge Farbtoene am schlechtesten trennt. Deshalb geht die Flaeche als
    # Wurzel in die Wertung ein: sie daempft, ohne einen kleinen, aber sehr
    # starken Unterschied ganz wegzurechnen.
    print('\n══ DIESELBE FRAGE, ABER MIT DER FLAECHE GEWICHTET ══════════════')
    ENTWUERFE = {
        'heute (Grund/Flaeche/Schrift)': [('bg', 0.69), ('surface', 0.23), ('ink', 0.08)],
        'Flaeche -> hl':                 [('bg', 0.69), ('hl', 0.23), ('ink', 0.08)],
        'Grund -> hl':                   [('hl', 0.69), ('surface', 0.23), ('ink', 0.08)],
        'Flaeche -> hl, Schrift -> muted': [('bg', 0.69), ('hl', 0.23), ('muted', 0.08)],
        'halb Grund, halb hl':           [('bg', 0.46), ('hl', 0.46), ('ink', 0.08)],
        'Grund/hl/muted zu Dritteln':    [('bg', 0.33), ('hl', 0.34), ('muted', 0.33)],
    }

    def gewichtet(teile, satz):
        schlecht = 1e9
        for a, c in itertools.combinations(FARBEN, 2):
            bestes = max(de(b[(a, satz)][v], b[(c, satz)][v]) * (anteil ** 0.5) for v, anteil in teile)
            schlecht = min(schlecht, bestes)
        return schlecht

    for name, teile in ENTWUERFE.items():
        h, d = gewichtet(teile, 'hell'), gewichtet(teile, 'dunkel')
        print(f'  {name:<34} hell {h:5.1f}   dunkel {d:5.1f}   -> schlechter Satz {min(h, d):5.1f}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
