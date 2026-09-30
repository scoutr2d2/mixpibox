#!/usr/bin/env python3
"""Das App-Icon der Handy-App aus dem MixPi-Maskottchen bauen.

Betreiber 27.09.2026: „stelle das app icon auf mixpi um".
Betreiber 29.09.2026: „app icon durch mixpi maskottchen ersetzen, jetzt ist
ein gemalter kopf".

DIE QUELLE IST DAS STANDARD-MIXPI, NICHT MEHR DAS FAVICON. Die erste Fassung
nahm NewDesign/bilder/favicon.svg — einen von Hand gezeichneten Kopf, eigens
fuer 16 px gemacht. Auf dem Startbildschirm eines Telefons hat das Icon aber
48 bis 192 px; dort sah man den gezeichneten Kopf statt der Figur, die die
Box selbst zeigt. Jetzt kommt die ganze Figur aus derselben Vorlage wie
`mixpi-hoert.png` und das Startbild der Boot-Animation: WELCHE Vorlage das
ist, steht in NewDesign/maskottchen.json unter `zustaende.hoert.quelle` und
wird hier gelesen, nicht noch einmal entschieden. Genommen wird die Vorlage
(1254 px), nicht das fertige 256-px-Bild — der Vordergrund braucht bei
xxxhdpi 432 px.

WIE GROSS: Der Launcher schneidet den 108-dp-Vordergrund je nach Geraet rund,
eckig oder als Tropfen zu; heil bleibt nur der Kreis von 66 dp in der Mitte.
Die Figur ist nicht quadratisch (Ohrmuscheln, Arme, ein Fuss stehen ab), ein
Kasten um sie waere also zu vorsichtig. Deshalb wird der KLEINSTE KREIS um
alle sichtbaren Punkte gesucht und auf RADIUS_DP gebracht — gerechnet, nicht
geschaetzt; `--pruefen` misst es an den geschriebenen Dateien nach.

    python3 tools/handy-app-icon.py            # alles neu schreiben
    python3 tools/handy-app-icon.py --pruefen  # nachbauen und vergleichen

Es schreibt
  - mipmap-anydpi-v26/ic_launcher.xml   Adaptive Icon (Android 8+): Hinter-
    grundfarbe + Vordergrund; der Launcher schneidet die Form selbst zu
  - mipmap-*/ic_launcher_vordergrund.png  die freigestellte Figur, 108 dp
  - mipmap-*/ic_launcher.png            fertiges rundes Icon fuer Launcher
    ohne Adaptive Icons (Android 7) — genau der Ausschnitt, den ein runder
    Launcher vom Adaptive Icon zeigen wuerde, damit beide dasselbe Bild sind
  - mipmap-*/ic_launcher_monochrom.png  die Ebene fuer eingefaerbte Symbole
    (Android 13+, „Designte Symbole"): der Launcher nimmt davon nur den
    Alphakanal und malt ihn in der Themenfarbe. Sie entsteht aus dem
    Vordergrund, nicht aus einer zweiten Zeichnung — siehe monochrom_gross().
    Ob ein Launcher sie benutzt, entscheidet er: MagicOS (Honor) etwa hat
    ein eigenes Themen-System und zeigte am 29.09.2026 das farbige Icon.

Braucht Pillow und numpy (wie tools/bilder-freistellen.py).
Rueckgabe: 0 gut, 1 Befund (nur --pruefen), 2 Werkzeug fehlt.
"""

import argparse
import importlib.util
import json
import sys
from pathlib import Path

try:
    import numpy as np
    from PIL import Image, ImageChops, ImageDraw
except ImportError:
    print("Pillow und numpy fehlen (python3 -m pip install pillow numpy)", file=sys.stderr)
    sys.exit(2)

HIER = Path(__file__).resolve().parent
WURZEL = HIER.parent
KARTE = WURZEL / "NewDesign/maskottchen.json"
RES = WURZEL / "handy-app/android/app/src/main/res"

# Helles Korallrot — die Saatfarbe der App (0xFFFF6B57) aufgehellt; darauf
# traegt der dunkle Umriss des MixPi.
HINTERGRUND = "#FFE3DC"

# Adaptive Icon: Ebene 108 dp, sichtbar hoechstens 72 dp, sicher 66 dp (r 33).
# Die Figur bekommt r 31: zwei dp Luft, sonst stoesst ein Ohr an den Rand
# eines runden Launchers.
EBENE_DP, SICHTBAR_DP, SICHER_R_DP, RADIUS_DP = 108, 72, 33, 31
# Gebaut wird einmal gross und dann je Dichte verkleinert.
PX_JE_DP = 16

# Einfarbige Ebene: was deckt, entscheidet der dunkelste Kanal. Der weisse
# Koerper hat ihn ueberall ueber 0,95 und wird durchsichtig; Umriss, Gesicht,
# Kopfhoerer (Violett, 0,36) und die Stifte (bunt, nahe 0) decken. Dazwischen
# weich, damit die Kante zwischen Umriss und Koerper nicht treppt. Am
# 29.09.2026 mit 0,45/0,80 und 0,65/0,92 verglichen: kein sichtbarer
# Unterschied, die Farben der Vorlage liegen weit auseinander.
MONO_TIEF, MONO_HOCH = 0.55, 0.85

# Dichte → Faktor gegenueber mdpi (1 dp = 1 px).
DICHTEN = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
TOLERANZ = 2  # Stufen je Kanal — andere Pillow-Fassung, anderes Runden


def quelle() -> Path:
    karte = json.loads(KARTE.read_text(encoding="utf-8"))
    return KARTE.parent / karte["quellordner"] / karte["zustaende"]["hoert"]["quelle"]


def freigestellt(pfad: Path) -> Image.Image:
    """Die Vorlage hat ein eingebranntes Schachbrett statt Transparenz —
    dasselbe Freistellen wie fuer alle Maskottchen-Bilder."""
    spec = importlib.util.spec_from_file_location("freistellen", HIER / "bilder-freistellen.py")
    fs = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fs)
    bild, _ = fs.freistellen(pfad, fs.TOLERANZ)
    return bild.crop(bild.getbbox())


def kleinster_kreis(alpha: np.ndarray) -> tuple[float, float, float]:
    """(x, y, r) des kleinsten Kreises um alle sichtbaren Punkte.

    Die Huelle steckt in den aeussersten Punkten jeder Zeile; von denen aus
    wird der Mittelpunkt schrittweise zum fernsten Punkt hin geschoben
    (Badoiu-Clarkson). Nach n Schritten ist der Kreis hoechstens um
    1/sqrt(n) zu gross, bei 10000 also um 1 % — die Figur wird dadurch
    hoechstens etwas kleiner als moeglich, nie zu gross: r ist der echte
    Abstand zum fernsten Punkt.
    """
    zeilen = np.nonzero(alpha.any(axis=1))[0]
    punkte = []
    for y in zeilen:
        xs = np.nonzero(alpha[y])[0]
        punkte += [(xs[0], y), (xs[-1] + 1, y), (xs[0], y + 1), (xs[-1] + 1, y + 1)]
    p = np.array(punkte, dtype=float)
    m = p.mean(axis=0)
    for i in range(1, 10001):
        fern = p[np.argmax(((p - m) ** 2).sum(axis=1))]
        m += (fern - m) / (i + 1)
    r = float(np.sqrt(((p - m) ** 2).sum(axis=1)).max())
    return float(m[0]), float(m[1]), r


def vordergrund_gross() -> Image.Image:
    figur = freigestellt(quelle())
    mx, my, r = kleinster_kreis(np.asarray(figur)[:, :, 3] > 0)
    s = RADIUS_DP * PX_JE_DP / r
    klein = figur.convert("RGBa").resize(
        (round(figur.width * s), round(figur.height * s)), Image.Resampling.LANCZOS
    ).convert("RGBA")
    seite = EBENE_DP * PX_JE_DP
    ebene = Image.new("RGBA", (seite, seite), (0, 0, 0, 0))
    ebene.alpha_composite(klein, (round(seite / 2 - mx * s), round(seite / 2 - my * s)))
    return ebene


def rund_gross(vorn: Image.Image) -> Image.Image:
    """Was ein runder Launcher vom Adaptive Icon zeigt: Grund + Figur, der
    mittlere 72-dp-Ausschnitt, kreisrund."""
    seite = vorn.width
    bild = Image.new("RGBA", (seite, seite), HINTERGRUND)
    bild.alpha_composite(vorn)
    rand = (EBENE_DP - SICHTBAR_DP) // 2 * PX_JE_DP
    bild = bild.crop((rand, rand, seite - rand, seite - rand))
    maske = Image.new("L", bild.size, 0)
    ImageDraw.Draw(maske).ellipse((0, 0, bild.width - 1, bild.height - 1), fill=255)
    bild.putalpha(maske)
    return bild


def monochrom_gross(vorn: Image.Image) -> Image.Image:
    """Die Ebene fuer eingefaerbte Symbole, aus dem Vordergrund abgeleitet.

    Der Launcher liest nur Alpha. Ein Schattenriss der ganzen Figur waere ein
    Klecks, in dem man nichts erkennt; erkannt wird MixPi an Umriss, Gesicht,
    Kopfhoerern und Stiften. Also deckt alles, was NICHT weiss ist, und der
    weisse Koerper wird durchsichtig — in der Themenfarbe gemalt bleibt eine
    Linienfigur mit vollen Kopfhoerern.
    """
    a = np.asarray(vorn).astype(np.float32) / 255
    weiss = a[:, :, :3].min(axis=2)
    deckt = np.clip((MONO_HOCH - weiss) / (MONO_HOCH - MONO_TIEF), 0, 1)
    alpha = Image.fromarray((a[:, :, 3] * deckt * 255).round().astype(np.uint8))
    ebene = Image.new("RGBA", vorn.size, (255, 255, 255, 0))
    ebene.putalpha(alpha)
    return ebene


def mono_befund(mono: Image.Image, vorn: Image.Image) -> str:
    """Ist die einfarbige Ebene eine Linienfigur? -> Befund oder "".

    Geprueft wird der Zweck, keine Zahl: was im Vordergrund satt WEISS ist
    (der Koerper), muss durchsichtig sein; was satt FARBIG ist (Umriss,
    Gesicht, Kopfhoerer, Stifte — kleinster Kanal unter 0,5), muss decken.
    Eine erste Fassung verglich nur den Deckanteil mit einem Bereich — die
    Gegenprobe zeigte, dass eine halb zugelaufene und eine fast leere Ebene
    beide darin landen. Eine zweite verlangte nur den DUNKLEN Umriss: der
    deckt fast immer, und die Kopfhoerer fielen weg, ohne dass es auffiel.
    """
    m = np.asarray(mono)[:, :, 3].astype(np.float32) / 255
    v = np.asarray(vorn).astype(np.float32) / 255
    satt = v[:, :, 3] > 0.99
    klein = v[:, :, :3].min(axis=2)
    weiss, farbig = satt & (klein > 0.95), satt & (klein < 0.5)
    if not weiss.any() or not farbig.any():
        return "im Vordergrund fehlt weisser Koerper oder farbiger Umriss"
    if (w := m[weiss].mean()) > 0.10:
        return f"der weisse Koerper deckt im Mittel {w:.0%} (erlaubt 10 %) — die Ebene laeuft zum Klecks zu"
    if (f := m[farbig].mean()) < 0.90:
        return (f"Umriss, Kopfhoerer und Stifte decken im Mittel nur {f:.0%} (verlangt 90 %)"
                " — die Figur zerfaellt")
    return ""


def verkleinert(bild: Image.Image, px: int) -> Image.Image:
    return bild.convert("RGBa").resize((px, px), Image.Resampling.LANCZOS).convert("RGBA")


def alle_bilder() -> dict[Path, Image.Image]:
    vorn = vordergrund_gross()
    rund = rund_gross(vorn)
    mono = monochrom_gross(vorn)
    bilder = {}
    for name, faktor in DICHTEN.items():
        bilder[RES / f"mipmap-{name}/ic_launcher_vordergrund.png"] = verkleinert(vorn, round(EBENE_DP * faktor))
        bilder[RES / f"mipmap-{name}/ic_launcher.png"] = verkleinert(rund, round(48 * faktor))
        bilder[RES / f"mipmap-{name}/ic_launcher_monochrom.png"] = verkleinert(mono, round(EBENE_DP * faktor))
    return bilder


def ausserhalb_sicher(vorn: Image.Image) -> int:
    """Sichtbare Punkte ausserhalb des 66-dp-Kreises (Alpha > 8)."""
    a = np.asarray(vorn)[:, :, 3] > 8
    ys, xs = np.nonzero(a)
    halb = vorn.width / 2
    r = SICHER_R_DP * vorn.width / EBENE_DP
    return int((((xs + 0.5 - halb) ** 2 + (ys + 0.5 - halb) ** 2) > r * r).sum())


def texte() -> dict[Path, str]:
    kopf = '<?xml version="1.0" encoding="utf-8"?>\n<!-- Erzeugt von tools/handy-app-icon.py -->\n'
    return {
        RES / "values/ic_launcher_farbe.xml": kopf
        + f'<resources>\n    <color name="ic_launcher_hintergrund">{HINTERGRUND}</color>\n</resources>\n',
        RES / "mipmap-anydpi-v26/ic_launcher.xml": kopf
        + '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background android:drawable="@color/ic_launcher_hintergrund"/>\n'
        '    <foreground android:drawable="@mipmap/ic_launcher_vordergrund"/>\n'
        '    <monochrome android:drawable="@mipmap/ic_launcher_monochrom"/>\n'
        "</adaptive-icon>\n",
    }


def pruefen() -> list[str]:
    befunde = []
    for ziel, soll in alle_bilder().items():
        name = ziel.relative_to(WURZEL)
        if not ziel.is_file():
            befunde.append(f"{name} fehlt")
            continue
        ist = Image.open(ziel).convert("RGBA")
        if ist.size != soll.size:
            befunde.append(f"{name}: {ist.size} statt {soll.size}")
            continue
        groesste = max(hi for _, hi in ImageChops.difference(ist, soll).getextrema())
        if groesste > TOLERANZ:
            befunde.append(f"{name}: weicht um bis zu {groesste} Stufen ab (erlaubt {TOLERANZ})")
        if ziel.name != "ic_launcher.png" and (n := ausserhalb_sicher(ist)):
            befunde.append(f"{name}: {n} sichtbare Punkte ausserhalb des sicheren 66-dp-Kreises")
        vorn_datei = ziel.with_name("ic_launcher_vordergrund.png")
        if ziel.name == "ic_launcher_monochrom.png" and vorn_datei.is_file():
            if b := mono_befund(ist, Image.open(vorn_datei).convert("RGBA")):
                befunde.append(f"{name}: {b}")
    for ziel, soll in texte().items():
        if not ziel.is_file() or ziel.read_text(encoding="utf-8") != soll:
            befunde.append(f"{ziel.relative_to(WURZEL)} fehlt oder weicht ab")
    return befunde


def main() -> int:
    p = argparse.ArgumentParser(description="App-Icon der Handy-App aus dem MixPi bauen")
    p.add_argument("--pruefen", action="store_true", help="nachbauen und mit den Dateien vergleichen")
    a = p.parse_args()

    if a.pruefen:
        befunde = pruefen()
        for b in befunde:
            print(f"FAIL {b}")
        if befunde:
            print(f"{len(befunde)} Befund(e) — neu bauen: python3 tools/handy-app-icon.py")
            return 1
        print(f"App-Icon passt zu {quelle().name}, Figur im sicheren Kreis")
        return 0

    for ziel, bild in alle_bilder().items():
        ziel.parent.mkdir(parents=True, exist_ok=True)
        bild.save(ziel, "PNG", optimize=True)
    for ziel, text in texte().items():
        ziel.parent.mkdir(parents=True, exist_ok=True)
        ziel.write_text(text, encoding="utf-8")
    print(f"Icons aus {quelle().name} geschrieben nach {RES.relative_to(WURZEL)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
