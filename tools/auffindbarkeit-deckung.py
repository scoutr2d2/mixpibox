#!/usr/bin/env python3
"""BLEIBT DIE BOX AUFFINDBAR? — beide Ausrollwege, die Kennmarke, der Finder.

WOZU (Betreiber, 20.09.2026): „es gibt immer wieder die frage welche ip, das
muessen wir doch besser hinbekommen."

Die Antwort besteht aus drei Teilen, und JEDER EINZELNE kann still
wegbrechen, ohne dass etwas rot wird:

  1. avahi auf der Box      -> <name>.local findet sie, ohne dass jemand sucht
  2. `GET /api/box`         -> die Kennmarke, an der ein Fund sich BEWEIST
  3. tools/box-finden.py    -> das Werkzeug, das beides benutzt

WARUM ES DIESE WACHE GIBT: avahi war bis zum 20.09.2026 auf KEINEM der beiden
Ausrollwege installiert. Dass die Box im Haus trotzdem unter MixPiBox.local
zu erreichen war, lag an DietPi — also an Glueck. Auf einer frischen Karte
konnte es anders ausgehen, und gemerkt haette es niemand, weil „nicht
auffindbar" sich wie „falsche IP notiert" anfuehlt.

══ AUF DIE SORTE, NICHT AUF DEN WORTLAUT ═════════════════════════════════

Geprueft wird, dass BEIDE Wege avahi installieren UND einschalten — nicht,
dass eine bestimmte Zeile dasteht. Eine Wache, die auf den Wortlaut zeigt,
faellt beim ersten Umformatieren um und wird dann abgeschaltet statt
verstanden.

DIE KENNMARKE WIRD AM QUELLTEXT GEPRUEFT und nicht an einer laufenden Box:
Diese Wache soll auch gruen sein koennen, wenn gerade keine Box am Netz ist
— der Gesamtlauf misst den Baum, nicht die Steckdose.

Aufruf:  python3 tools/auffindbarkeit-deckung.py [--pruefen]
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent

WEGE = {
    "frische Karte": WURZEL / "autosetup" / "autosetup.sh",
    "laufende Box": WURZEL / "update" / "start_mupibox_update.sh",
}
SERVER = WURZEL / "src" / "backend-api" / "src" / "server.ts"
FINDER = WURZEL / "tools" / "box-finden.py"


def abbruch(text: str) -> None:
    print(f"\nABBRUCH: {text}\n", file=sys.stderr)
    sys.exit(2)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--pruefen", action="store_true", help="nur gruen/rot, fuer tools/pruefen.sh")
    a = p.parse_args()

    for name, pfad in list(WEGE.items()) + [("Server", SERVER), ("Finder", FINDER)]:
        if not pfad.exists():
            abbruch(
                f"{pfad.relative_to(WURZEL)} gibt es nicht mehr ({name}).\n"
                "  Diese Wache haelt die Auffindbarkeit der Box zusammen. Ist eine\n"
                "  der Stellen umgezogen, gehoert der Pfad hier nachgezogen — NICHT\n"
                "  die Wache entfernt."
            )

    luecken: list[str] = []
    zeilen: list[tuple[str, str]] = []

    # ── 1. avahi auf beiden Wegen: installiert UND eingeschaltet ───────────
    for name, pfad in WEGE.items():
        t = pfad.read_text(encoding="utf-8")
        # INSTALLIEREN: irgendwo in einer Paketliste oder einem apt-Aufruf.
        installiert = bool(re.search(r"avahi-daemon", t))
        # EINSCHALTEN: `systemctl enable` auf avahi — mit oder ohne `--now`,
        # mit oder ohne `.service`. Auf die Sorte, nicht auf den Wortlaut.
        an = bool(re.search(r"systemctl\s+enable[^\n]*\bavahi-daemon\b", t))
        zeilen.append((f"{name}: avahi wird installiert", "ja" if installiert else "NEIN"))
        zeilen.append((f"{name}: avahi wird eingeschaltet", "ja" if an else "NEIN"))
        if not installiert:
            luecken.append(f"{pfad.relative_to(WURZEL)} installiert avahi-daemon nicht — <name>.local bleibt Glueckssache")
        if not an:
            luecken.append(
                f"{pfad.relative_to(WURZEL)} schaltet avahi-daemon nicht ein — installiert ist nicht eingeschaltet"
            )

    # ── 2. Die Kennmarke im Server ────────────────────────────────────────
    s = SERVER.read_text(encoding="utf-8")
    route = bool(re.search(r"app\.get\(\s*['\"]/api/box['\"]", s))
    marke = "box: 'mixpibox'" in s
    zeilen.append(("Server: die Route /api/box gibt es", "ja" if route else "NEIN"))
    zeilen.append(("Server: sie nennt sich `mixpibox`", "ja" if marke else "NEIN"))
    if not route:
        luecken.append("src/backend-api/src/server.ts hat keine Route /api/box — ohne sie ist kein Fund beweisbar")
    if not marke:
        luecken.append(
            "die Route /api/box nennt nicht mehr `box: 'mixpibox'` — genau daran unterscheidet "
            "tools/box-finden.py die Box von einem fremden Dienst auf demselben Port"
        )

    # ── 3. Und der Finder prueft wirklich auf diese Marke ──────────────────
    #
    # SONST WAERE DIE KETTE ZWEIGETEILT: Der Server koennte sich nennen, wie
    # er will, und der Finder wuerde weiter irgendetwas glauben. Genau diese
    # Sorte Halbheit hat am 20.09.2026 einen fremden Rechner auf 8200 fast zu
    # einer Box gemacht.
    f = FINDER.read_text(encoding="utf-8")
    prueft = 'get("box") == "mixpibox"' in f or "get('box') == 'mixpibox'" in f
    fragt = "/api/box" in f
    zeilen.append(("Finder: fragt /api/box", "ja" if fragt else "NEIN"))
    zeilen.append(("Finder: und verlangt die Marke `mixpibox`", "ja" if prueft else "NEIN"))
    if not fragt or not prueft:
        luecken.append(
            "tools/box-finden.py prueft nicht mehr auf `box == 'mixpibox'` — dann zaehlt wieder "
            "'etwas antwortet auf 8200' als Fund, und das ist eine Vermutung, keine Identifikation"
        )

    if not a.pruefen:
        print("\n══ BLEIBT DIE BOX AUFFINDBAR?\n")
        breite = max(len(n) for n, _ in zeilen)
        for name, wert in zeilen:
            print(f"  {name.ljust(breite)}  {wert}")
        print()

    if luecken:
        print(f"{'  ' if a.pruefen else ''}AUFFINDBARKEIT: {len(luecken)} LUECKE(N) —")
        for l in luecken:
            print(f"    {l}")
        if not a.pruefen:
            print(
                "\n  Ohne diese Kette ist die Frage nach der IP wieder eine, die jemand\n"
                "  von Hand beantworten muss — und ein Suchlauf ueber das Netz ist\n"
                "  dafuer keine Antwort, sondern eine Vermutung."
            )
        return 1 if a.pruefen else 1

    if not a.pruefen:
        print("  Alle drei Teile stehen: melden, beweisen, finden.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
