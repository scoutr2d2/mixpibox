#!/usr/bin/env python3
"""Sind diese Bilder fuer die Box brauchbar? — Masse, Transparenz, Dopplungen.

WOZU: Am 2026-07-31 landeten 26 erzeugte Maskottchen-Bilder im Projekt, 27 MB
schwer. Vier hiessen "...-transparent.png" — und KEINES davon hatte einen
Alphakanal. Das faellt am Bildschirm nicht auf, solange der Hintergrund zufaellig
weiss ist; auf der Box mit dunklem Thema sitzt das Maskottchen dann in einem
weissen Kasten. Von Hand nachgesehen haette es niemand: `ls` zeigt keine
Transparenz, und die Dateinamen LOGEN.

Dazu kommt das Gewicht. Die neue Oberflaeche wurde muehsam von 4,1 MB auf 300 kB
gebracht; ein einziges 1,2-MB-Bild macht das zunichte. Auf einer Box, die per
WLAN an einem Pi haengt, ist das der Unterschied zwischen "sofort da" und
"Kachel baut sich auf".

WAS ES PRUEFT
    * Masse, Farbmodell, Dateigroesse
    * ECHTE Transparenz - nicht ob ein Alphakanal da ist, sondern ob er
      benutzt wird (ein RGBA-Bild mit lauter 255 ist genauso undurchsichtig)
    * den Rand: wie viel des Bildes ist leer? Ein Maskottchen mit 30 % Luft
      ringsum wirkt in der Kachel winzig, obwohl die Datei gross ist
    * Dopplungen ueber einen Durchschnittshash - bei erzeugten Bildern sind
      oft mehrere fast gleich, und man waehlt sonst zweimal dasselbe aus
    * Lesbarkeit in Kachelgroesse: wie viel Kontrast bleibt bei 160 px?

WAS ES NICHT TUT
    * Es aendert NICHTS. Kein Zuschneiden, kein Verkleinern, kein Umbenennen -
      es sagt nur, was ist. Aendern ist ein zweiter, bewusster Schritt.
    * Es sagt nicht, WAS auf dem Bild zu sehen ist. Dafuer muss jemand
      hinsehen; hier gibt es nur Zahlen.

AUFRUF
    tools/bilder-pruefen.py NewDesign/bilder/
    tools/bilder-pruefen.py NewDesign/bilder/ --json     # fuer Weiterverarbeitung
    tools/bilder-pruefen.py bild.png --kachel 160        # andere Zielgroesse
"""

import argparse
import json
import sys
from pathlib import Path

try:
    import numpy as np
    from PIL import Image
except ImportError:
    sys.exit("Es fehlt: python3 -m pip install pillow numpy")

# Richtwerte. Sie stammen aus der Verwendung, nicht aus dem Gefuehl:
# KACHEL ist die Groesse, in der ein Cover-Ersatzbild im Raster erscheint.
# GEWICHT_WARN gilt je Datei - bei einem Dienstausfall traegt das Ersatzbild
# JEDE Kachel, dann zaehlt jedes Kilobyte.
KACHEL_PX = 160
GEWICHT_WARN_KB = 60
RAND_WARN = 0.18  # mehr als 18 % leerer Rand je Seite faellt in der Kachel auf


def durchschnittshash(bild: Image.Image) -> int:
    """Ein 64-Bit-Fingerabdruck: 8x8 grau, jedes Feld heller als der Mittelwert?

    Reicht fuer "das ist fast dasselbe Bild" und braucht keine Fremdbibliothek.
    Gegen Verschiebungen ist er unempfindlich, gegen Spiegelungen nicht - das
    genuegt hier, weil erzeugte Varianten sich in Details unterscheiden.
    """
    klein = bild.convert("L").resize((8, 8), Image.Resampling.LANCZOS)
    feld = np.asarray(klein, dtype=np.float64)
    bits = (feld > feld.mean()).flatten()
    wert = 0
    for b in bits:
        wert = (wert << 1) | int(b)
    return wert


def abstand(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


def rand_anteil(alpha: np.ndarray) -> dict:
    """Wie viel leerer Rand? Gemessen am umschliessenden Rechteck des Inhalts."""
    sichtbar = alpha > 8
    if not sichtbar.any():
        return {"links": 0.0, "rechts": 0.0, "oben": 0.0, "unten": 0.0, "fuellung": 0.0}
    zeilen = np.where(sichtbar.any(axis=1))[0]
    spalten = np.where(sichtbar.any(axis=0))[0]
    h, b = alpha.shape
    o, u = int(zeilen[0]), int(zeilen[-1])
    l, r = int(spalten[0]), int(spalten[-1])
    return {
        "links": l / b,
        "rechts": (b - 1 - r) / b,
        "oben": o / h,
        "unten": (h - 1 - u) / h,
        # Anteil der Flaeche, den der Inhalt wirklich fuellt
        "fuellung": float(sichtbar.mean()),
    }


def kachel_kontrast(bild: Image.Image, kachel: int) -> float:
    """Standardabweichung der Helligkeit bei Kachelgroesse.

    Ein Bild, das beim Verkleinern zu Brei wird, hat hier einen kleinen Wert.
    Kein Urteil, nur eine Zahl zum Vergleichen zwischen Kandidaten.
    """
    klein = bild.convert("L").resize((kachel, kachel), Image.Resampling.LANCZOS)
    return float(np.asarray(klein, dtype=np.float64).std())


def ein_bild(pfad: Path, kachel: int) -> dict:
    roh = Image.open(pfad)
    breit, hoch = roh.size
    modus = roh.mode
    groesse_kb = pfad.stat().st_size / 1024

    rgba = roh.convert("RGBA")
    alpha = np.asarray(rgba)[:, :, 3]

    # DIE ENTSCHEIDENDE UNTERSCHEIDUNG: Alphakanal VORHANDEN ist nicht
    # dasselbe wie Alphakanal BENUTZT. Ein RGBA-Bild mit lauter 255 ist
    # ebenso undurchsichtig wie ein RGB-Bild - es sieht nur so aus, als
    # waere alles in Ordnung.
    hat_kanal = modus in ("RGBA", "LA", "PA") or "transparency" in roh.info
    voll_durchsichtig = float((alpha == 0).mean())
    teil_durchsichtig = float(((alpha > 0) & (alpha < 255)).mean())
    echt_transparent = voll_durchsichtig > 0.01

    befund = {
        "datei": pfad.name,
        "breit": breit,
        "hoch": hoch,
        "modus": modus,
        "kb": round(groesse_kb, 1),
        "alphakanal": hat_kanal,
        "transparent": echt_transparent,
        "durchsichtig_anteil": round(voll_durchsichtig, 4),
        "weiche_kanten_anteil": round(teil_durchsichtig, 4),
        "kachel_kontrast": round(kachel_kontrast(rgba, kachel), 1),
        "hash": durchschnittshash(rgba),
    }
    befund["rand"] = {k: round(v, 3) for k, v in rand_anteil(alpha).items()}

    maengel = []
    if not echt_transparent:
        maengel.append("KEINE TRANSPARENZ" + (" (Alphakanal da, aber ungenutzt)" if hat_kanal else " (RGB)"))
    if groesse_kb > GEWICHT_WARN_KB:
        maengel.append(f"schwer: {groesse_kb:.0f} kB")
    if breit > 512:
        maengel.append(f"gross: {breit}px")
    if echt_transparent:
        r = befund["rand"]
        schlimmster = max(r["links"], r["rechts"], r["oben"], r["unten"])
        if schlimmster > RAND_WARN:
            maengel.append(f"viel leerer Rand: {schlimmster:.0%}")
    befund["maengel"] = maengel
    return befund


def dopplungen(befunde: list, schwelle: int = 6) -> list:
    """Paare, die sich um weniger als `schwelle` Bits unterscheiden."""
    paare = []
    for i in range(len(befunde)):
        for j in range(i + 1, len(befunde)):
            d = abstand(befunde[i]["hash"], befunde[j]["hash"])
            if d < schwelle:
                paare.append({"a": befunde[i]["datei"], "b": befunde[j]["datei"], "abstand": d})
    return sorted(paare, key=lambda p: p["abstand"])


def main() -> int:
    p = argparse.ArgumentParser(description="Bilder auf Web-Tauglichkeit pruefen (aendert nichts)")
    p.add_argument("pfad", type=Path, help="Datei oder Verzeichnis")
    p.add_argument("--kachel", type=int, default=KACHEL_PX, help=f"Zielgroesse in px (Vorgabe {KACHEL_PX})")
    p.add_argument("--json", action="store_true", help="Maschinenlesbar ausgeben")
    a = p.parse_args()

    if a.pfad.is_dir():
        dateien = sorted(f for f in a.pfad.iterdir() if f.suffix.lower() in (".png", ".webp", ".jpg", ".jpeg"))
    elif a.pfad.is_file():
        dateien = [a.pfad]
    else:
        print(f"Nicht gefunden: {a.pfad}", file=sys.stderr)
        return 1
    if not dateien:
        print("Keine Bilder gefunden.", file=sys.stderr)
        return 1

    befunde = [ein_bild(f, a.kachel) for f in dateien]
    paare = dopplungen(befunde)

    if a.json:
        print(json.dumps({"bilder": befunde, "dopplungen": paare}, indent=2, ensure_ascii=False))
        return 0

    print(f"{len(befunde)} Bilder in {a.pfad}\n")
    kopf = f"{'Datei':<44} {'Masse':>11} {'kB':>7} {'transp':>7} {'Rand':>6} {'Kontr':>6}"
    print(kopf)
    print("─" * len(kopf))
    for b in befunde:
        r = b["rand"]
        schlimmster = max(r["links"], r["rechts"], r["oben"], r["unten"]) if b["transparent"] else 0
        print(
            f"{b['datei'][:44]:<44} {b['breit']}x{b['hoch']:<5} {b['kb']:>7.0f} "
            f"{('ja' if b['transparent'] else 'NEIN'):>7} {schlimmster:>5.0%} {b['kachel_kontrast']:>6.1f}"
        )

    mit_mangel = [b for b in befunde if b["maengel"]]
    if mit_mangel:
        print(f"\n── Maengel ({len(mit_mangel)} von {len(befunde)})")
        for b in mit_mangel:
            print(f"  {b['datei']}")
            for m in b["maengel"]:
                print(f"      • {m}")

    if paare:
        print(f"\n── Fast gleiche Bilder ({len(paare)} Paare, kleiner Abstand = aehnlicher)")
        for pa in paare:
            print(f"  {pa['abstand']:>2} Bit   {pa['a']}  ≈  {pa['b']}")

    gesamt = sum(b["kb"] for b in befunde)
    ohne = sum(1 for b in befunde if not b["transparent"])
    print(f"\nZusammen {gesamt / 1024:.1f} MB · {ohne} ohne Transparenz · {len(paare)} aehnliche Paare")
    return 0


if __name__ == "__main__":
    sys.exit(main())
