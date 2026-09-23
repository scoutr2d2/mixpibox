#!/usr/bin/env python3
"""Misst `randkontrast` ueberhaupt Sichtbarkeit? — vier Gegenproben.

══ DIE BEHAUPTUNG, DIE HIER GEPRUEFT WIRD ═════════════════════════════════
Aus tools/favicon-vergleich.py stammen die Zahlen

    auf dunkel (#202124):  zeichen 1.06 / 1.10 / 1.13   kachel 4.58 / 4.93 / 4.96
    auf creme  (#FFF7EC):  zeichen 3.20 / 4.21 / 4.11   kachel 2.98 / 2.52 / 2.33
    auf hell   (#FFFFFF):  zeichen 3.28 / 3.88 / 4.20   kachel 3.17 / 3.32 / 3.46

und daraus die Aussage „auf dunklem Reiter gewinnt die Kachel, und nur dort".
Die Zahl heisst `randkontrast` und ist definiert als WCAG-Kontrast zwischen
dem Reitergrund und dem MITTEL DER AEUSSERSTEN PIXELREIHE des Zeichens.

Bevor man aus einer Zahl eine Entscheidung macht, prueft man, ob sie das misst,
was ihr Name verspricht. Vier Gegenproben:

  A  WORAUS DIE AEUSSERSTE REIHE BESTEHT. Fuer ein freigestelltes Zeichen ist
     der aeusserste Ring der ANTIALIAS-SAUM: Pixel mit kleinem Alpha, also per
     Definition fast Reitergrund. Gemessen wird das mittlere Alpha genau jener
     Pixel, die `randkontrast` in den Mittelwert nimmt.

  B  DER KONTROLLVERSUCH. Dem Mass werden drei Formen vorgelegt, deren
     Sichtbarkeit auf dunkel niemand bestreitet: eine volle weisse Scheibe, eine
     weisse Scheibe MIT dunklem Umriss (die Bauart der Zeichnung) und ein voller
     weisser Block. Meldet das Mass fuer die umrandete Scheibe eine kleine Zahl,
     misst es nicht Sichtbarkeit, sondern die Farbe des Umrisses.

  C  WAS AUF DUNKEL WIRKLICH TRAEGT. favicon.svg begruendet sich mit ZWEI
     Traegern: „der dunkle Umriss haelt die weisse Figur auf hellem Reiter, die
     weisse Fuellung haelt sie auf dunklem". `randkontrast` schaut nur auf den
     Ring. Hier steht daneben, was die FLAECHE hergibt: der Anteil der Pixel,
     die gegen den Reitergrund 3:1 bzw. 4.5:1 schaffen, und der Kontrast des
     groessten zusammenhaengenden Farbflecks.

  D  WOHER DIE 4.58 DER KACHEL KOMMEN. Die Kachel hat keinen Alphakanal; ihre
     runden Ecken sind gebackenes Weiss (253,253,254). Auf dunklem Reiter ist
     damit JEDER Bildpunkt „fremd", der Ring ist die aeusserste Reihe der ganzen
     Leinwand — Ecken weiss, Mitte lila. Hier wird der Ring aufgeschluesselt.

══ AUFRUF ═════════════════════════════════════════════════════════════════
    python3 tools/favicon-randkontrast-gegenprobe.py

Braucht Pillow, numpy und rsvg-convert — dieselben Mittel wie
tools/favicon-vergleich.py, dessen Fassungen und Masse hier eingelesen und
wiederverwendet werden, damit dieselben Zahlen dieselben Zahlen bleiben.
AENDERT NICHTS IM BAUM.
"""
import importlib
import pathlib
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
vergleich = importlib.import_module('favicon-vergleich')

GROESSEN = vergleich.GROESSEN
REITER = vergleich.REITER
kontrast = vergleich.kontrast


def ring_pixel(bild, grund):
    """GENAU die Pixel, die vergleich.randkontrast mittelt — samt ihrem Alpha.

    Nachgebaut aus derselben Bedingung (Abstand > 12 in einem Kanal, und ein
    Nachbar, der das nicht ist oder ausserhalb liegt), damit hier nicht ein
    anderer Ring untersucht wird als der, aus dem die Zahl stammt.
    """
    voll = vergleich.auf_reiter(bild, grund)
    a = np.asarray(voll).astype(np.int16)
    alpha = np.asarray(bild.convert('RGBA'))[:, :, 3]
    fremd = (np.abs(a - np.array(grund, dtype=np.int16)).max(axis=2) > 12)
    innen = np.ones_like(fremd)
    for achse, schub in ((0, 1), (0, -1), (1, 1), (1, -1)):
        nachbar = np.roll(fremd, schub, axis=achse)
        # ausserhalb der Leinwand zaehlt als „nicht fremd"
        if achse == 0:
            nachbar[0 if schub == 1 else -1, :] = False
        else:
            nachbar[:, 0 if schub == 1 else -1] = False
        innen &= nachbar
    ring = fremd & ~innen
    return a[ring], alpha[ring]


def flaechenmass(bild, grund):
    """Was die FLAECHE hergibt, nicht der Ring.

    Zaehlt ueber alle deckenden Pixel (Alpha > 200), wie viele gegen den
    Reitergrund 3:1 und 4.5:1 schaffen, und nennt den besten Wert.
    """
    voll = np.asarray(vergleich.auf_reiter(bild, grund)).astype(np.int16)
    alpha = np.asarray(bild.convert('RGBA'))[:, :, 3]
    deckend = alpha > 200
    if not deckend.any():
        return 0, 0.0, 0.0, 0.0
    werte = np.array([kontrast(tuple(int(v) for v in p), grund)
                      for p in voll[deckend]])
    return (int(deckend.sum()), float((werte >= 3.0).mean()),
            float((werte >= 4.5).mean()), float(werte.max()))


def kontrollformen(g):
    """Drei Formen, deren Sichtbarkeit auf dunkel nicht strittig ist."""
    formen = {}
    for name in ('scheibe weiss', 'scheibe weiss + umriss', 'block weiss'):
        b = Image.new('RGBA', (g, g), (0, 0, 0, 0))
        d = ImageDraw.Draw(b)
        rand = max(1, round(g * 0.055))
        if name == 'block weiss':
            d.rectangle([0, 0, g - 1, g - 1], fill=(254, 254, 254, 255))
        elif name == 'scheibe weiss':
            d.ellipse([1, 1, g - 2, g - 2], fill=(254, 254, 254, 255))
        else:
            # dieselbe Bauart wie favicon.svg: weisse Fuellung, dunkler Umriss
            d.ellipse([1, 1, g - 2, g - 2], fill=(254, 254, 254, 255),
                      outline=(0, 3, 43, 255), width=rand)
        formen[name] = b
    return formen


def main():
    dunkel = dict(REITER)['dunkel']

    print('═══ A  Woraus die aeusserste Reihe besteht ' + '═' * 31)
    print('   (Alpha der Pixel, die randkontrast mittelt — 255 = deckend)')
    for g in GROESSEN:
        for kname, mach in vergleich.KANDIDATEN:
            b = mach(g)
            for rname, grund in REITER:
                farben, alpha = ring_pixel(b, grund)
                if len(alpha) == 0:
                    continue
                mitte = farben.mean(axis=0)
                print(f'  {g:2d} px  {kname:8s} auf {rname:6s}  ringpixel {len(alpha):4d}'
                      f'  alpha im mittel {alpha.mean():6.1f}'
                      f'  mittelfarbe ({mitte[0]:5.1f},{mitte[1]:5.1f},{mitte[2]:5.1f})'
                      f'  -> {kontrast(tuple(mitte), grund):5.2f}')

    print('\n═══ B  Der Kontrollversuch auf dunkel ' + '═' * 36)
    print('   Formen, die auf #202124 unbestreitbar sichtbar sind:')
    for g in GROESSEN:
        for name, b in kontrollformen(g).items():
            rk = vergleich.randkontrast(b, dunkel)
            n, d3, d45, best = flaechenmass(b, dunkel)
            print(f'  {g:2d} px  {name:24s} randkontrast {rk:5.2f}'
                  f'   |  flaeche: {d3:5.1%} ueber 3:1, {d45:5.1%} ueber 4.5:1, best {best:5.2f}')

    print('\n═══ C  Was auf dunkel wirklich traegt (Flaeche statt Ring) ' + '═' * 15)
    for g in GROESSEN:
        for kname, mach in vergleich.KANDIDATEN:
            b = mach(g)
            rk = vergleich.randkontrast(b, dunkel)
            n, d3, d45, best = flaechenmass(b, dunkel)
            print(f'  {g:2d} px  {kname:8s} randkontrast {rk:5.2f}'
                  f'   |  {n:4d} deckende pixel, {d3:5.1%} ueber 3:1,'
                  f' {d45:5.1%} ueber 4.5:1, best {best:5.2f}')
    weiss, umriss = (254, 254, 254), (0, 3, 43)
    print(f'  zum Vergleich, aus favicon.svg gezaehlt:')
    print(f'    Fuellung #FEFEFE gegen dunklen Reiter   {kontrast(weiss, dunkel):5.2f}')
    print(f'    Umriss   #00032B gegen dunklen Reiter   {kontrast(umriss, dunkel):5.2f}')
    print(f'    Fuellung #FEFEFE gegen creme            {kontrast(weiss, dict(REITER)["creme"]):5.2f}')
    print(f'    Umriss   #00032B gegen creme            {kontrast(umriss, dict(REITER)["creme"]):5.2f}')

    print('\n═══ D  Woher die Zahl der Kachel auf dunkel kommt ' + '═' * 24)
    for g in GROESSEN:
        b = vergleich.kachel_fassung(g)
        farben, alpha = ring_pixel(b, dunkel)
        hell = (farben.mean(axis=1) > 200).mean()
        lila = (np.abs(farben - np.array([139, 85, 250])).max(axis=1) < 45).mean()
        print(f'  {g:2d} px  ring {len(farben):4d} pixel:  {hell:5.1%} nahezu weiss'
              f' (gebackene Ecken),  {lila:5.1%} lila Kachelgrund')
    roh = np.asarray(Image.open(vergleich.KACHEL).convert('RGB'))
    ecke = roh[:40, :40].reshape(-1, 3).mean(axis=0)
    print(f'  Quelle: Eckfeld 40x40 im Mittel ({ecke[0]:.0f},{ecke[1]:.0f},{ecke[2]:.0f})'
          f'  — Kontrast gegen dunklen Reiter {kontrast(tuple(ecke), dunkel):5.2f},'
          f' gegen creme {kontrast(tuple(ecke), dict(REITER)["creme"]):5.2f}')

    print('\n═══ E  Haelt die Rangfolge die Schwelle aus? ' + '═' * 29)
    print('   Die 12 in fremd() ist gesetzt, nicht hergeleitet. Dieselbe Rechnung')
    print('   mit anderen, ebenso vertretbaren Schwellen — nur die hellen Reiter,')
    print('   denn auf ihnen ruht das „und nur dort":')
    for schwelle in (4, 8, 12, 20, 32):
        zeile = []
        for rname in ('hell', 'creme'):
            grund = dict(REITER)[rname]
            for g in GROESSEN:
                werte = {}
                for kname, mach in vergleich.KANDIDATEN:
                    farben, _ = ring_pixel_schwelle(mach(g), grund, schwelle)
                    werte[kname] = (kontrast(tuple(farben.mean(axis=0)), grund)
                                    if len(farben) else 0.0)
                sieger = 'zeichen' if werte['zeichen'] > werte['kachel'] else 'KACHEL '
                zeile.append(f'{rname[0]}{g:02d} {werte["zeichen"]:4.2f}/{werte["kachel"]:4.2f} {sieger}')
        print(f'  schwelle {schwelle:2d}:  ' + ' | '.join(zeile))


def ring_pixel_schwelle(bild, grund, schwelle):
    """ring_pixel, aber mit frei waehlbarer Schwelle statt der festen 12."""
    voll = vergleich.auf_reiter(bild, grund)
    a = np.asarray(voll).astype(np.int16)
    fremd = (np.abs(a - np.array(grund, dtype=np.int16)).max(axis=2) > schwelle)
    innen = np.ones_like(fremd)
    for achse, schub in ((0, 1), (0, -1), (1, 1), (1, -1)):
        nachbar = np.roll(fremd, schub, axis=achse)
        if achse == 0:
            nachbar[0 if schub == 1 else -1, :] = False
        else:
            nachbar[:, 0 if schub == 1 else -1] = False
        innen &= nachbar
    ring = fremd & ~innen
    return a[ring], ring.sum()


if __name__ == '__main__':
    main()
