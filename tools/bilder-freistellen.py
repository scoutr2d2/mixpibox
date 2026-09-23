#!/usr/bin/env python3
"""Einfarbigen Hintergrund entfernen, zuschneiden, verkleinern — fuer Kachelbilder.

WOZU: Am 2026-07-31 kamen 24 erzeugte Maskottchen-Bilder ins Projekt, 26 MB
schwer, und KEINES hatte Transparenz — auch die vier nicht, die
"...-transparent.png" hiessen. Auf hellem Grund faellt das nicht auf; sobald die
Box ein dunkles Thema traegt, sitzt das Maskottchen in einem hellgrauen Kasten.

DIE TUECKE, an der eine naive Loesung scheitert: MixPi ist WEISS (bis 255), der
Hintergrund hellgrau (239). Drei Stufen Unterschied in der Flaeche. Wer nach
Helligkeit oder Farbnaehe maskiert, radiert die Figur zur Haelfte mit weg.

WAS STATTDESSEN TRAEGT: die dunkle Kontur. Die Figur ist rundum dunkelblau
umrandet. Deshalb wird nicht nach Farbe maskiert, sondern VOM RAND HER GEFLUTET:
Alles, was farblich zum Hintergrund passt UND mit dem Bildrand zusammenhaengt,
wird durchsichtig. Weisse Flaechen INNERHALB der Kontur bleiben, weil die Flut
an der Kontur stehenbleibt - obwohl sie farblich kaum zu unterscheiden sind.

WAS ES NICHT TUT
    * Es ueberschreibt NIE die Vorlagen. Ergebnisse landen in einem eigenen
      Verzeichnis; die Originale bleiben unangetastet.
    * Es rettet keinen unruhigen Hintergrund. Fuer Fotos oder Verlaeufe ist es
      das falsche Werkzeug - dafuer braucht es eine Freistellung mit Modell.
    * Es urteilt nicht ueber den Inhalt. Was auf dem Bild zu sehen ist, muss
      jemand ansehen.

AUFRUF
    tools/bilder-freistellen.py NewDesign/bilder/ --ziel NewDesign/bilder/fertig
    tools/bilder-freistellen.py bild.png --ziel /tmp/x --groessen 320,160
    tools/bilder-freistellen.py NewDesign/bilder/ --ziel /tmp/x --probe
        (--probe legt zusaetzlich eine Gegenprobe auf schwarzem Grund ab -
         dort sieht man sofort, ob ein grauer Saum stehengeblieben ist)
"""

import argparse
import sys
from pathlib import Path

try:
    import numpy as np
    from PIL import Image, ImageFilter
except ImportError:
    sys.exit("Es fehlt: python3 -m pip install pillow numpy")

# Wie weit darf eine Farbe vom Hintergrund abweichen und noch als Hintergrund
# gelten? Gemessen als euklidischer Abstand im RGB-Raum. 28 traegt die leichte
# Koernung erzeugter Bilder (dort schwanken die Werte um +-4), bleibt aber weit
# unter dem Abstand zur dunklen Kontur (>200).
TOLERANZ = 28

# Rand um die Figur, in Prozent der laengeren Seite. Ganz ohne Rand stossen
# Kachelbilder an ihre Kanten und wirken gedraengt.
RAND_ANTEIL = 0.04


def hintergrundfarben(a: np.ndarray, toleranz: int) -> list:
    """Die Farbe(n) des Hintergrunds - aus den Ecken, wo nie die Figur steht.

    GIBT EINE LISTE ZURUECK, nicht eine Farbe, wegen des eingebrannten
    SCHACHBRETTS: Manche Werkzeuge zeigen Transparenz als graues Karo an, und
    beim Ausgeben landet dieses Karo als echte Pixel in der Datei. Der
    Hintergrund hat dann ZWEI Farben, die sich abwechseln.

    Am Geraet belegt (Meshy_AI_mixpi-error-transparent.png, 2026-07-31): Die
    Ecke wechselt blockweise zwischen 237 und 254. Wer nur die eine Farbe
    entfernt, behaelt das halbe Karo - und weil die hellere davon (254) genau
    das Figurenweiss trifft, sieht das Ergebnis auf weissem Grund sogar richtig
    aus. Auf dunklem Grund steht dann ein Karomuster um die Figur.
    """
    k = max(8, min(a.shape[0], a.shape[1]) // 40)
    ecken = np.concatenate([
        a[:k, :k].reshape(-1, 3), a[:k, -k:].reshape(-1, 3),
        a[-k:, :k].reshape(-1, 3), a[-k:, -k:].reshape(-1, 3),
    ])
    erste = np.median(ecken, axis=0)
    farben = [erste]

    # Bleibt ein nennenswerter Teil der Ecke WEIT von dieser Farbe entfernt,
    # ist es kein Rauschen mehr, sondern eine zweite Hintergrundfarbe.
    fern = ecken[np.sqrt(((ecken - erste) ** 2).sum(axis=1)) > toleranz]
    if len(fern) > 0.2 * len(ecken):
        farben.append(np.median(fern, axis=0))
    return farben


def _flut(passt: np.ndarray, marken: np.ndarray, start: list, marke: int) -> int:
    """Zeilenweise Flut von `start` aus; traegt `marke` in `marken` ein.

    Zeilenweise (Scanline-Fill), weil das auf zusammenhaengenden ABSCHNITTEN
    arbeitet statt auf einzelnen Pixeln: ohne scipy und ohne minutenlange
    Schleifen. Gibt die Zahl der erfassten Pixel zurueck.
    """
    h, b = passt.shape
    stapel = list(start)
    anzahl = 0
    while stapel:
        y, x = stapel.pop()
        if marken[y, x] or not passt[y, x]:
            continue
        links = x
        while links > 0 and passt[y, links - 1] and not marken[y, links - 1]:
            links -= 1
        rechts = x
        while rechts < b - 1 and passt[y, rechts + 1] and not marken[y, rechts + 1]:
            rechts += 1
        marken[y, links:rechts + 1] = marke
        anzahl += rechts - links + 1
        for ny in (y - 1, y + 1):
            if not (0 <= ny < h):
                continue
            zeile = passt[ny, links:rechts + 1] & (marken[ny, links:rechts + 1] == 0)
            stellen = np.flatnonzero(zeile)
            if stellen.size == 0:
                continue
            # Nur EINEN Startpunkt je zusammenhaengendem Abschnitt auf den
            # Stapel - sonst waechst er auf Pixelzahl und das Werkzeug haengt.
            brueche = np.flatnonzero(np.diff(stellen) > 1)
            anfaenge = np.concatenate(([stellen[0]], stellen[brueche + 1]))
            for s in anfaenge:
                stapel.append((ny, links + int(s)))
    return anzahl


def randsaat(passt: np.ndarray) -> list:
    h, b = passt.shape
    saat = []
    for x in range(b):
        if passt[0, x]:
            saat.append((0, x))
        if passt[h - 1, x]:
            saat.append((h - 1, x))
    for y in range(h):
        if passt[y, 0]:
            saat.append((y, 0))
        if passt[y, b - 1]:
            saat.append((y, b - 1))
    return saat


def freistellen(pfad: Path, toleranz: int, taschen: bool = True) -> tuple[Image.Image, dict]:
    quelle = Image.open(pfad)

    # SCHON FREIGESTELLTE BILDER NICHT NOCH EINMAL BEARBEITEN.
    #
    # `convert("RGB")` wirft den Alphakanal weg und laesst dort, wo einmal
    # nichts war, die blanken Farbwerte stehen - meist Weiss. Danach haelt das
    # Werkzeug 255 fuer den Hintergrund und die Figur (253) fuer eine Tasche
    # und stanzt sie aus. Genau so wurde mixpi-farben.png beim ersten Lauf
    # zerloechert. Wer schon Transparenz hat, wird nur zugeschnitten.
    if quelle.mode in ("RGBA", "LA") or "transparency" in quelle.info:
        fertig = quelle.convert("RGBA")
        vorhanden = np.asarray(fertig)[:, :, 3]
        if (vorhanden == 0).mean() > 0.01:
            return fertig, {
                "hintergrund": None,
                "durchsichtig": float((vorhanden == 0).mean()),
                "innen_gerettet": 0.0,
                "taschen": 0,
                "taschen_pixel": 0,
                "taschen_median": [],
                "figur_weiss": None,
                "uebernommen": True,
            }

    roh = quelle.convert("RGB")
    a = np.asarray(roh).astype(np.float32)
    gruende = hintergrundfarben(a, toleranz)

    passt = np.zeros(a.shape[:2], dtype=bool)
    for g in gruende:
        passt |= np.sqrt(((a - g) ** 2).sum(axis=2)) < toleranz
    bg = gruende[0]

    marken = np.zeros(passt.shape, dtype=np.int32)
    _flut(passt, marken, randsaat(passt), 1)
    aussen = marken == 1

    # EINGESCHLOSSENE HINTERGRUNDTASCHEN.
    #
    # Zwischen Kopfbuegel und Kopf liegt Hintergrund, der den Bildrand NICHT
    # beruehrt - die Flut von aussen kommt nicht hin, und er bliebe als heller
    # Fleck stehen. Auf weissem Grund sieht das niemand, auf dunklem Thema ist
    # es ein Kasten mitten im Bild.
    #
    # Farblich sind Tasche und Figur kaum zu trennen: am Beispielbild 248 gegen
    # 254. Am EINZELPIXEL ist das nicht zu entscheiden - am MEDIAN eines ganzen
    # Gebiets schon, denn der wackelt bei tausenden Pixeln nicht.
    #
    # Im Zweifel wird BEHALTEN: ein Loch in der Figur ist ein schlimmerer
    # Fehler als ein grauer Fleck. Wie entschieden wird, steht unten bei
    # NAH_GENUG.
    grau = np.asarray(roh.convert("L")).astype(np.float32)
    gebiete = []
    if taschen:
        naechste = 2
        offen = passt & (marken == 0)
        while offen.any():
            ys, xs = np.nonzero(offen)
            n = _flut(passt, marken, [(int(ys[0]), int(xs[0]))], naechste)
            gebiete.append({"marke": naechste, "pixel": n, "median": float(np.median(grau[marken == naechste]))})
            naechste += 1
            offen = passt & (marken == 0)

    getilgt = []
    grund_wert = float(np.median(grau[aussen])) if aussen.any() else float(bg.mean())
    if gebiete:
        # ABSOLUTE NAEHE ZUM HINTERGRUND, nicht Vergleich mit dem "Koerper".
        #
        # Der erste Versuch nahm das GROESSTE eingeschlossene Gebiet als
        # Figurenweiss und ordnete jede Tasche der naeheren Seite zu. Das kippte
        # bei zwei Bildern um: dort war das groesste eingeschlossene Gebiet
        # nicht der Koerper (Median 243), und prompt wurden die REINWEISSEN
        # Flaechen bei 254 fuer Hintergrund gehalten und ausgestanzt - Loecher
        # mitten in der Figur.
        #
        # Eine Tasche IST Hintergrund und hat deshalb praktisch DENSELBEN Wert
        # wie der Hintergrund draussen. Das ist eine absolute Aussage und kippt
        # nicht: liegt ein Gebiet mehr als NAH_GENUG daneben, bleibt es stehen.
        NAH_GENUG = 3.0
        mindest = 0.0002 * grau.size  # winzige Gebiete sind Koernung
        for g in gebiete:
            if g["pixel"] < mindest:
                continue
            if abs(g["median"] - grund_wert) <= NAH_GENUG:
                aussen |= marken == g["marke"]
                getilgt.append(g)

    # AUSSEN IST RESTLOS AUSSEN - kein Abstufen nach Farbabstand.
    #
    # Der erste Versuch liess die Deckkraft dort vom Farbabstand abhaengen, um
    # weiche Kanten zu bekommen. Das ging schief: Die Vorlagen haben einen
    # leichten Verlauf (Ecken 236, Mitte 247) und dazu Koernung. Beides zusammen
    # ueberschreitet stellenweise die halbe Toleranz - und ploetzlich blieb der
    # ganze Hintergrund als schwaches Gewebemuster halbdurchsichtig stehen. Auf
    # weissem Grund unsichtbar, auf schwarzem sofort da.
    #
    # Die weiche Kante kommt allein aus der Weichzeichnung unten. Sie wirkt nur
    # an der Grenze, weil eine Flaeche aus lauter Nullen weichgezeichnet Null
    # bleibt.
    alpha = np.where(aussen, 0.0, 1.0)

    alpha_bild = Image.fromarray((alpha * 255).astype(np.uint8), "L")
    alpha_bild = alpha_bild.filter(ImageFilter.GaussianBlur(0.8))

    ergebnis = roh.convert("RGBA")
    ergebnis.putalpha(alpha_bild)

    bericht = {
        "hintergrund": [tuple(int(x) for x in g) for g in gruende],
        "durchsichtig": float(aussen.mean()),
        # Wieviel Hintergrundfarbe steckt IM Bild, ohne mit dem Rand
        # zusammenzuhaengen? Das sind die geretteten weissen Flaechen.
        "innen_gerettet": float((passt & ~aussen).mean()),
        "taschen": len(getilgt),
        "taschen_pixel": sum(g["pixel"] for g in getilgt),
        # Damit nachvollziehbar bleibt, WIE knapp die Entscheidung war.
        "taschen_median": [round(g["median"], 1) for g in getilgt],
        "figur_weiss": round(max(gebiete, key=lambda g: g["pixel"])["median"], 1) if gebiete else None,
        "grund_wert": round(grund_wert, 1),
        "uebernommen": False,
    }
    return ergebnis, bericht


def zuschneiden(bild: Image.Image, rand_anteil: float) -> Image.Image:
    kasten = bild.getbbox()  # richtet sich nach Alpha
    if not kasten:
        return bild
    bild = bild.crop(kasten)
    b, h = bild.size
    rand = int(max(b, h) * rand_anteil)
    seite = max(b, h) + 2 * rand
    # QUADRATISCH auffuellen: Kachelplaetze sind quadratisch. Wer ein
    # rechteckiges Bild hineinlegt, bekommt je Zustand eine andere Groesse -
    # das Raster wirkt dann unruhig, ohne dass man den Grund sieht.
    leinwand = Image.new("RGBA", (seite, seite), (0, 0, 0, 0))
    leinwand.paste(bild, ((seite - b) // 2, (seite - h) // 2))
    return leinwand


def main() -> int:
    p = argparse.ArgumentParser(description="Einfarbigen Hintergrund entfernen (Originale bleiben)")
    p.add_argument("pfad", type=Path)
    p.add_argument("--ziel", type=Path, required=True, help="Ausgabeverzeichnis (wird angelegt)")
    p.add_argument("--groessen", default="320", help="Kantenlaengen, Komma-getrennt (Vorgabe 320)")
    p.add_argument("--toleranz", type=int, default=TOLERANZ)
    p.add_argument("--rand", type=float, default=RAND_ANTEIL)
    p.add_argument("--probe", action="store_true", help="Gegenprobe auf schwarzem Grund mit ablegen")
    p.add_argument("--ohne-taschen", action="store_true", help="Eingeschlossene Hintergrundflaechen NICHT entfernen")
    a = p.parse_args()

    if a.pfad.is_dir():
        dateien = sorted(f for f in a.pfad.iterdir() if f.suffix.lower() == ".png")
    elif a.pfad.is_file():
        dateien = [a.pfad]
    else:
        print(f"Nicht gefunden: {a.pfad}", file=sys.stderr)
        return 1

    groessen = [int(g) for g in a.groessen.split(",") if g.strip()]
    a.ziel.mkdir(parents=True, exist_ok=True)
    if a.probe:
        (a.ziel / "probe").mkdir(exist_ok=True)

    print(f"{len(dateien)} Bilder → {a.ziel}  (Groessen: {', '.join(map(str, groessen))})\n")
    for f in dateien:
        try:
            bild, bericht = freistellen(f, a.toleranz, taschen=not a.ohne_taschen)
        except Exception as e:  # noqa: BLE001 - eine kaputte Datei darf den Lauf nicht beenden
            print(f"  {f.name}: FEHLER {e}")
            continue
        bild = zuschneiden(bild, a.rand)

        zeilen = []
        for g in groessen:
            klein = bild.resize((g, g), Image.Resampling.LANCZOS)
            name = f"{f.stem}-{g}.png" if len(groessen) > 1 else f"{f.stem}.png"
            ziel = a.ziel / name
            klein.save(ziel, "PNG", optimize=True)
            zeilen.append(f"{g}px {ziel.stat().st_size / 1024:.0f}kB")
            if a.probe:
                grund = Image.new("RGBA", klein.size, (0, 0, 0, 255))
                grund.alpha_composite(klein)
                grund.convert("RGB").save(a.ziel / "probe" / name, "PNG")

        if bericht.get("uebernommen"):
            print(f"  {f.name[:44]:<46} hatte schon Transparenz - nur zugeschnitten · " + ", ".join(zeilen))
            continue
        tasche = ""
        if bericht["taschen"]:
            tasche = (f" · {bericht['taschen']} Tasche(n) getilgt "
                      f"(Median {bericht['taschen_median']} gegen Figur {bericht['figur_weiss']})")
        print(
            f"  {f.name[:44]:<46} Grund {bericht['hintergrund']} · "
            f"{bericht['durchsichtig']:.0%} frei · {bericht['innen_gerettet']:.1%} innen gerettet"
            + tasche + " · " + ", ".join(zeilen)
        )

    print(f"\nFertig. Originale unveraendert in {a.pfad}")
    if a.probe:
        print(f"Gegenprobe auf Schwarz: {a.ziel / 'probe'} — dort faellt ein grauer Saum sofort auf.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
