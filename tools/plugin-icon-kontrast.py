#!/usr/bin/env python3
"""SIEHT MAN DAS PLUGIN-ZEICHEN? — gerendert und gegen den echten Untergrund gemessen.

══ DER BEFUND, DER DIESES WERKZEUG AUSGELOEST HAT (05.09.2026) ════════════════
Betreiber: „wir brauchen noch ein icon fuer internet archive." Es GAB eines,
`plugins/mixpi-archive/icon.svg`, und die Steckleiste holte es auch: die Route
antwortete mit 200, das Bild war geladen, `naturalWidth` 150. Trotzdem war
nichts zu sehen.

GEMESSEN IM BROWSER: 626 gedeckte Bildpunkte, ALLE `rgb(0,0,0)` — auf einem
Untergrund von `rgb(18,18,18)`. Kontrast 1,12:1. Schwarz auf Schwarz.

DIE URSACHE IST EINE ZEILE, DIE UEBERALL SONST RICHTIG IST: die Zeichen malen
mit `stroke="currentColor"`. Geladen wird das SVG aber ueber
`<img src="/api/plugins/<k>/icon">`, und ein SVG im `<img>` ist ein EIGENES
Dokument — es sieht die `color` der Seite nicht und faellt auf den Anfangswert
zurueck, und der ist Schwarz. Alle fuenf mitgelieferten Zeichen taten das.

WARUM ES KEINE WACHE FAND: jede vorhandene Pruefung fragt, ob die DATEI da ist
und ob sie sich parsen laesst. Beides war wahr. „Da, gueltig und unsichtbar"
ist ein Zustand, den man nur durch RENDERN findet — deshalb dieses Werkzeug.

══ WAS ES PRUEFT ══════════════════════════════════════════════════════════════
Je Plugin mit `icon` im Manifest:
  1. rsvg-convert bringt die Datei ueberhaupt durch (der `--`-Kommentarfehler
     faellt hier mit auf, siehe llmwiki: zwei Bindestriche toeten ein SVG)
  2. es wird ueberhaupt etwas gemalt (ein leeres Zeichen ist auch keines)
  3. die gemalte Farbe hebt sich vom Untergrund der Verwaltung ab

DER UNTERGRUND WIRD NICHT ABGESCHRIEBEN, sondern aus
`src/frontend-admin/src/styles.css` gelesen (`--grund`). Eine Wache mit einer
eigenen Kopie der Palette misst nach dem naechsten Umfaerben gegen eine Farbe,
die es nicht mehr gibt — und meldet dann gruen oder rot, aber jedenfalls
falsch.

GEMESSEN WIRD IN DER GROESSE, IN DER ES DASTEHT (24 px, `width: 1.5rem` in
`mixpi-plugin-abschnitt.ts`). Bei einer 1,8 px breiten Linie auf 24 px ist ein
grosser Teil der Bildpunkte halbdurchsichtig; deshalb zaehlt nur, was
deutlich deckt (Alpha > 128), und gewertet wird der HELLSTE dieser Punkte —
er ist die Farbe, die das Zeichen wirklich hat.

Schwelle 3,0:1 — die WCAG-Grenze fuer grafische Elemente, nicht die 4,5:1 fuer
Fliesstext. Ein Strichzeichen ist kein Fliesstext.

══ AUFRUF ═════════════════════════════════════════════════════════════════════
    python3 tools/plugin-icon-kontrast.py
    python3 tools/plugin-icon-kontrast.py --bogen /tmp/zeichen.png   # zum Ansehen

Rueckgabe: 0 = alle sichtbar, 1 = mindestens ein Zeichen geht unter,
2 = Umgebung fehlt (rsvg-convert oder Pillow).
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("  UMGEBUNG: Pillow fehlt (python3 -m pip install pillow)")
    sys.exit(2)

WURZEL = Path(__file__).resolve().parent.parent
PLUGINS = WURZEL / "plugins"
STIL = WURZEL / "src/frontend-admin/src/styles.css"
KANTE = 24  # wie in mixpi-plugin-abschnitt.ts: width/height 1.5rem
SCHWELLE = 3.0


def grund_lesen() -> tuple[int, int, int]:
    """Der Untergrund der Verwaltung — aus ihrer eigenen Palette."""
    text = STIL.read_text(encoding="utf-8")
    treffer = re.search(r"--grund:\s*#([0-9a-fA-F]{6})", text)
    if not treffer:
        print(f"  UMGEBUNG: keine --grund-Farbe in {STIL} — umbenannt?")
        sys.exit(2)
    h = treffer.group(1)
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def leuchtkraft(farbe: tuple[int, int, int]) -> float:
    """Relative Leuchtkraft nach WCAG 2.1."""
    teile = []
    for wert in farbe:
        c = wert / 255
        teile.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * teile[0] + 0.7152 * teile[1] + 0.0722 * teile[2]


def kontrast(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    la, lb = leuchtkraft(a), leuchtkraft(b)
    hell, dunkel = max(la, lb), min(la, lb)
    return (hell + 0.05) / (dunkel + 0.05)


def zeichen_pruefen(kennung: str, datei: Path, grund: tuple[int, int, int]) -> tuple[bool, str]:
    with tempfile.TemporaryDirectory() as ordner:
        bild = Path(ordner) / "z.png"
        lauf = subprocess.run(
            ["rsvg-convert", "-w", str(KANTE), "-h", str(KANTE), str(datei), "-o", str(bild)],
            capture_output=True,
            text=True,
        )
        if lauf.returncode != 0:
            return False, f"rsvg-convert scheitert: {lauf.stderr.strip().splitlines()[0] if lauf.stderr.strip() else 'ohne Meldung'}"
        with Image.open(bild) as offen:
            # UEBER tobytes() UND NICHT getdata(): letzteres ist in Pillow 12
            # abgekuendigt und faellt 2027 weg, der Ersatz gibt es in aelteren
            # Fassungen noch nicht. Rohe Bytes koennen beide.
            roh = offen.convert("RGBA").tobytes()
        punkte = [tuple(roh[i : i + 4]) for i in range(0, len(roh), 4)]

    gedeckt = [p for p in punkte if p[3] > 128]
    if not gedeckt:
        return False, "malt nichts, was deckt — leeres Zeichen?"

    # DER HELLSTE GEDECKTE PUNKT ist die Farbe des Zeichens: die dunkleren sind
    # Kantenglaettung gegen den Untergrund und sagen nichts ueber die Absicht.
    tinte = max(gedeckt, key=lambda p: leuchtkraft(p[:3]))[:3]
    wert = kontrast(tinte, grund)
    farbe = "#%02x%02x%02x" % tinte
    if wert < SCHWELLE:
        return False, f"Tinte {farbe} auf #%02x%02x%02x — Kontrast {wert:.2f}:1, noetig {SCHWELLE}:1" % grund
    return True, f"Tinte {farbe}, Kontrast {wert:.2f}:1 ({len(gedeckt)} gedeckte Punkte)"


def main() -> int:
    if subprocess.run(["which", "rsvg-convert"], capture_output=True).returncode != 0:
        print("  UMGEBUNG: rsvg-convert fehlt (Paket librsvg)")
        return 2

    grund = grund_lesen()
    print(f"── Plugin-Zeichen bei {KANTE} px auf #%02x%02x%02x ──" % grund)

    funde = 0
    geprueft = 0
    for manifest in sorted(PLUGINS.glob("*/plugin.json")):
        try:
            m = json.loads(manifest.read_text(encoding="utf-8"))
        except json.JSONDecodeError as fehler:
            print(f"  FUND  {manifest.parent.name}: plugin.json unlesbar ({fehler})")
            funde += 1
            continue
        name = m.get("icon")
        if not name:
            continue
        datei = manifest.parent / name
        if not datei.exists():
            print(f"  FUND  {m.get('kennung', manifest.parent.name)}: Manifest nennt {name}, die Datei fehlt")
            funde += 1
            continue
        geprueft += 1
        gut, wort = zeichen_pruefen(m.get("kennung", manifest.parent.name), datei, grund)
        print(f"  {'ok  ' if gut else 'FUND'}  {m.get('kennung', manifest.parent.name)}: {wort}")
        if not gut:
            funde += 1

    if geprueft == 0:
        # DIE WICHTIGSTE ZEILE: ohne sie meldet die Wache gruen, sobald das Feld
        # `icon` umbenannt wird oder der Ordner umzieht.
        print("  WARNUNG: kein einziges Manifest mit `icon` gefunden — umbenannt?")
        return 1

    print()
    if funde == 0:
        print(f"KEINE LUECKE. {geprueft} Zeichen gemessen.")
        return 0
    print(f"{funde} LUECKE(N) von {geprueft} Zeichen.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
