#!/usr/bin/env python3
"""Die KI-Vorlagen freistellen — Hintergrund weg, Rand sauber, Groesse passend.

Betreiber (16.08.2026): „es gibt 2 neue ordner mit vorlage ordner darin einmal
für tastatur und einmal für progressbar ich habe sie generieren lassen von
einer ki ich habe die rechte diese jeweils verwenden ... es muss auch
freigestellt werden".

══ WARUM NICHT EINFACH „ALLES WEISSE TRANSPARENT" ═══════════════════════════

Weil die Bilder WEISS IM MOTIV tragen: der Panda hat ein weisses Gesicht, der
Wuerfel weisse Augen, der Geist ist fast ganz weiss. Eine Regel „Pixel heller
als X wird durchsichtig" stanzt genau dort Loecher hinein — und zwar so, dass
es auf 1024 px kaum auffaellt und auf 44 px wie ein Fehler aussieht.

Deshalb FLUTFUELLEN VOM RAND: durchsichtig wird nur, was mit dem Bildrand
zusammenhaengt. Was innen liegt, bleibt, egal wie hell es ist.

══ DIE ZWEITE FALLE: DER RAND WIRD HART ═════════════════════════════════════

Gemessen: die Ecken sind (254,254,254), nicht (255,255,255), und sie sind
nicht einmal untereinander gleich. Der Uebergang zum Motiv ist weich
(Kantenglaettung des Erzeugers). Wer hart schneidet, bekommt einen hellen
Saum um jede Figur — auf dunklem Grund sieht das aus wie ein Heiligenschein.

Also: die Deckkraft am Uebergang MITZIEHEN statt sie umzuschalten, und den
verbliebenen hellen Saum leicht abziehen.

Aufruf:
    python3 tools/vorlagen-freistellen.py                 # beide Ordner
    python3 tools/vorlagen-freistellen.py --nur tastatur
"""
from __future__ import annotations

import argparse
import sys
from collections import deque
from pathlib import Path

from PIL import Image

BASIS = Path(__file__).resolve().parent.parent / "NewDesign"

# Wie weit ein Pixel vom Hintergrundton abweichen darf und noch als
# Hintergrund gilt. Gemessen: die Ecken schwanken um 1..2 Stufen, das Motiv
# hebt sich deutlich ab. 30 laesst die Kantenglaettung mitlaufen, ohne helle
# Motivteile zu fassen.
TOLERANZ = 30
# Ab dieser Abweichung ist es sicher Motiv — dazwischen wird die Deckkraft
# weich gezogen, damit kein harter Saum entsteht.
VOLL_AB = 60

ZIELE = {
    # Tastenbilder: 256 px reicht — die Taste ist 44 bis 88 px gross, und das
    # Doppelte deckt auch einen Schirm mit doppelter Punktdichte ab.
    "Tastatur": 256,
    # Der Fortschrittspunkt ist WINZIG (18 bis 26 px). 128 ist grosszuegig.
    "Progressbar": 128,
}


def hintergrundton(im: Image.Image) -> tuple[int, int, int]:
    """Der haeufigste Ton am Bildrand — nicht die Ecke, die kann ein Ausreisser sein."""
    w, h = im.size
    rand = []
    for x in range(0, w, 4):
        rand.append(im.getpixel((x, 0)))
        rand.append(im.getpixel((x, h - 1)))
    for y in range(0, h, 4):
        rand.append(im.getpixel((0, y)))
        rand.append(im.getpixel((w - 1, y)))
    haeufig: dict[tuple[int, int, int], int] = {}
    for p in rand:
        haeufig[p] = haeufig.get(p, 0) + 1
    return max(haeufig.items(), key=lambda x: x[1])[0]


def freistellen(pfad: Path, ziel: Path, kante: int) -> tuple[int, int]:
    im = Image.open(pfad).convert("RGB")
    w, h = im.size
    px = im.load()
    grund = hintergrundton(im)

    def abstand(p: tuple[int, int, int]) -> float:
        return max(abs(p[0] - grund[0]), abs(p[1] - grund[1]), abs(p[2] - grund[2]))

    # ── Flutfuellen vom Rand ─────────────────────────────────────────────
    # Nur was mit dem Rand ZUSAMMENHAENGT wird durchsichtig. Weisse Flaechen
    # im Motiv (Pandagesicht, Wuerfelaugen) bleiben stehen.
    alpha = [[255] * w for _ in range(h)]
    gesehen = bytearray(w * h)
    schlange: deque[tuple[int, int]] = deque()
    for x in range(w):
        for y in (0, h - 1):
            if abstand(px[x, y]) <= TOLERANZ:
                schlange.append((x, y))
                gesehen[y * w + x] = 1
    for y in range(h):
        for x in (0, w - 1):
            if not gesehen[y * w + x] and abstand(px[x, y]) <= TOLERANZ:
                schlange.append((x, y))
                gesehen[y * w + x] = 1

    while schlange:
        x, y = schlange.popleft()
        d = abstand(px[x, y])
        if d <= TOLERANZ:
            alpha[y][x] = 0
        elif d < VOLL_AB:
            # WEICHER UEBERGANG statt harter Kante: sonst bleibt ein heller
            # Saum stehen, der auf dunklem Grund wie ein Heiligenschein wirkt.
            alpha[y][x] = int(255 * (d - TOLERANZ) / (VOLL_AB - TOLERANZ))
        else:
            continue  # sicher Motiv — hier hoert die Flut auf
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not gesehen[ny * w + nx]:
                gesehen[ny * w + nx] = 1
                schlange.append((nx, ny))

    aus = im.convert("RGBA")
    aus.putalpha(Image.frombytes("L", (w, h), bytes(v for zeile in alpha for v in zeile)))

    # ── Auf das Motiv beschneiden, dann quadratisch auffuellen ───────────
    # Sonst haengt jedes Bild an einer anderen Stelle in seiner Taste — die
    # Erzeuger setzen das Motiv nicht mittig.
    kasten = aus.getbbox()
    if kasten:
        aus = aus.crop(kasten)
    seite = max(aus.size)
    rand = int(seite * 0.06)  # etwas Luft, sonst klebt es am Tastenrand
    quadrat = Image.new("RGBA", (seite + 2 * rand, seite + 2 * rand), (0, 0, 0, 0))
    quadrat.paste(aus, ((quadrat.width - aus.width) // 2, (quadrat.height - aus.height) // 2))
    quadrat = quadrat.resize((kante, kante), Image.LANCZOS)
    ziel.parent.mkdir(parents=True, exist_ok=True)
    quadrat.save(ziel, optimize=True)
    return kasten[2] - kasten[0] if kasten else 0, ziel.stat().st_size


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--nur", help="nur dieser Ordner (tastatur|progressbar)")
    a = p.parse_args()

    gesamt = 0
    for ordner, kante in ZIELE.items():
        if a.nur and a.nur.lower() != ordner.lower():
            continue
        quelle = BASIS / ordner / "Vorlage"
        if not quelle.is_dir():
            print(f"FEHLT: {quelle}", file=sys.stderr)
            continue
        ziel_ordner = BASIS / "bilder" / ordner.lower()
        print(f"\n{ordner} → {ziel_ordner} ({kante} px)")
        for datei in sorted(quelle.glob("*.png")):
            # Aus „Meshy_AI_icon-flat-cat-clean.png" wird „cat-clean".
            name = datei.stem
            for weg in ("Meshy_AI_icon-flat-", "Meshy_AI_icon-", "Meshy_AI_"):
                if name.startswith(weg):
                    name = name[len(weg):]
                    break
            ziel = ziel_ordner / f"{name}.png"
            breite, gross = freistellen(datei, ziel, kante)
            print(f"  {datei.name[:40]:<42} → {name+'.png':<20} Motiv {breite}px, {gross} B")
            gesamt += 1
    print(f"\n{gesamt} Vorlagen freigestellt.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
