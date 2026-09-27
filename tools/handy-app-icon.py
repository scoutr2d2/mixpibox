#!/usr/bin/env python3
"""Das App-Icon der Handy-App aus dem MixPi-Favicon bauen.

Betreiber 27.09.2026: „stelle das app icon auf mixpi um".

QUELLE IST NewDesign/bilder/favicon.svg — der MixPi-Kopf mit Kopfhoerern,
eigens fuer kleine Groessen gezeichnet (die ganze Figur wird klein zum
Fleck). Aendert sich das Favicon, dieses Werkzeug erneut laufen lassen:

    python3 tools/handy-app-icon.py

Es schreibt
  - mipmap-anydpi-v26/ic_launcher.xml   Adaptive Icon (Android 8+): Hinter-
    grundfarbe + Vordergrund; der Launcher schneidet die Form selbst zu
  - mipmap-*/ic_launcher_vordergrund.png  der Vordergrund, 108 dp, das Logo
    nur im inneren 66-dp-Kreis — was ausserhalb liegt, schneidet der
    Launcher je nach Form ab
  - mipmap-*/ic_launcher.png            fertiges rundes Icon fuer Launcher
    ohne Adaptive Icons (Android 7)

Braucht rsvg-convert (librsvg).
"""

import re
import subprocess
import tempfile
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
QUELLE = WURZEL / "NewDesign/bilder/favicon.svg"
RES = WURZEL / "handy-app/android/app/src/main/res"

# Helles Korallrot — die Saatfarbe der App (0xFFFF6B57) aufgehellt; darauf
# traegt der dunkle Umriss des MixPi.
HINTERGRUND = "#FFE3DC"

# Dichte → Faktor gegenueber mdpi (1 dp = 1 px).
DICHTEN = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}


def logo_innen() -> str:
    """Das Favicon ohne Kommentare und ohne sein Wurzelelement."""
    svg = QUELLE.read_text(encoding="utf-8")
    svg = re.sub(r"<!--.*?-->", "", svg, flags=re.S)
    return re.sub(r"^.*?<svg[^>]*>|</svg>\s*$", "", svg.strip(), flags=re.S)


def verschachtelt(x: float, groesse: float) -> str:
    return f'<svg x="{x}" y="{x}" width="{groesse}" height="{groesse}" viewBox="0 0 32 32">{logo_innen()}</svg>'


def vordergrund_svg() -> str:
    # 108 dp Flaeche, 66 dp sicherer Kreis; das quadratische Logo in 60 dp,
    # damit auch seine Ecken (Kopfhoerer) im Kreis bleiben.
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108">{verschachtelt(24, 60)}</svg>'


def rund_svg() -> str:
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">'
        f'<circle cx="24" cy="24" r="24" fill="{HINTERGRUND}"/>{verschachtelt(8, 32)}</svg>'
    )


def rendern(svg: str, px: int, ziel: Path) -> None:
    with tempfile.NamedTemporaryFile("w", suffix=".svg", delete=False) as f:
        f.write(svg)
    ziel.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["rsvg-convert", "-w", str(px), "-h", str(px), f.name, "-o", str(ziel)], check=True)
    Path(f.name).unlink()


def main() -> None:
    for name, faktor in DICHTEN.items():
        rendern(vordergrund_svg(), round(108 * faktor), RES / f"mipmap-{name}/ic_launcher_vordergrund.png")
        rendern(rund_svg(), round(48 * faktor), RES / f"mipmap-{name}/ic_launcher.png")
    (RES / "values/ic_launcher_farbe.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<!-- Erzeugt von tools/handy-app-icon.py -->\n'
        f'<resources>\n    <color name="ic_launcher_hintergrund">{HINTERGRUND}</color>\n</resources>\n',
        encoding="utf-8",
    )
    adaptiv = RES / "mipmap-anydpi-v26/ic_launcher.xml"
    adaptiv.parent.mkdir(parents=True, exist_ok=True)
    adaptiv.write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<!-- Erzeugt von tools/handy-app-icon.py -->\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background android:drawable="@color/ic_launcher_hintergrund"/>\n'
        '    <foreground android:drawable="@mipmap/ic_launcher_vordergrund"/>\n'
        "</adaptive-icon>\n",
        encoding="utf-8",
    )
    print(f"Icons geschrieben nach {RES.relative_to(WURZEL)}")


if __name__ == "__main__":
    main()
