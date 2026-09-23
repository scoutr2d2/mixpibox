#!/usr/bin/env python3
"""FARBKANAL-VERDRAHTUNG — hat der Farbwaehler der neuen Oberflaeche genau
EINEN Weg, und ist er durchgehend verdrahtet?

══ WARUM ES DAS GIBT (E118/1c, 05.09.2026) ═════════════════════════════════

Bis E118/1c fuhren die Waehler-Farben ueber DREI bewegliche Teile: das
Konfigfeld `mupibox.theme`, die Datei `themes/<name>.css` und den Symlink
`www/active_theme.css`, nachgezogen von einem sudo-Aufruf. Jedes Teil ist
einzeln verschwunden (der Verweis beim Ausrollen, gemessen 05.08.; das
Umhaengen am Teilstring-Vergleich, llmwiki: mupi-themawechsel-teilstring) —
und jedes Mal sah es aus wie ein kaputter Farbwaehler.

Seit 1c ist der Weg: PUT /api/farbthema schreibt in EINE feste Datei
(mixpi-farben.css neben der Konfiguration), GET /farben.css liefert sie
aus, /neu/index.html bindet sie VOR app.css. Diese Wache haelt die Kette
zusammen — reisst ein Glied, ist der Waehler wieder ein Regler ohne Draht,
und zwar STILL (gespeichert wird brav, nur faerbt nichts).

Gepruft wird die SORTE (Kette vorhanden), nicht der Wortlaut:

  1. index.html bindet /farben.css, und zwar VOR app.css (!important-Logik
     des Blocks verlangt diese Reihenfolge, siehe farbthema.ts), und traegt
     keinen active_theme-Link mehr.
  2. server.ts hat die Route '/farben.css' und eine Konstante, die auf die
     feste Datei zeigt — beides ausserhalb von Kommentarzeilen.
  3. Der Farbthema-Schreibweg kommt ohne sudo/setting_update aus: zwischen
     dem PUT-Kopf und der naechsten Route faellt kein solcher Aufruf mehr.
     (setting_update.sh selbst darf bis E118/1e anderswo weiterleben.)

Aufruf aus dem Wurzelverzeichnis:  python3 tools/farbkanal-verdrahtung.py
Rueckgabe: 0 = Kette geschlossen, 1 = mindestens ein Glied fehlt.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
INDEX = WURZEL / "NewDesign/index.html"
SERVER = WURZEL / "src/backend-api/src/server.ts"


def ohne_kommentare_ts(text: str) -> str:
    """TypeScript grob von Kommentaren befreien — reicht fuer eine
    Vorkommens-Pruefung (llmwiki: kommentar-und-kompilat-sind-keine-gegenstelle)."""
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"^\s*//.*$", "", text, flags=re.M)


def main() -> int:
    rot = 0

    html = INDEX.read_text(encoding="utf-8", errors="replace")
    ohne_html_kommentare = re.sub(r"<!--.*?-->", "", html, flags=re.S)
    farben = ohne_html_kommentare.find('href="/farben.css"')
    appcss = ohne_html_kommentare.find('href="app.css"')
    if farben < 0:
        print("  KETTE OFFEN: NewDesign/index.html bindet /farben.css nicht ein.")
        rot += 1
    elif appcss >= 0 and farben > appcss:
        print("  FALSCHE REIHENFOLGE: /farben.css muss VOR app.css stehen —")
        print("      der Block arbeitet mit !important gegen die Vorgaben (farbthema.ts).")
        rot += 1
    if "active_theme" in ohne_html_kommentare:
        print("  ALTER WEG ZURUECK: NewDesign/index.html bindet wieder active_theme ein.")
        rot += 1

    ts = ohne_kommentare_ts(SERVER.read_text(encoding="utf-8", errors="replace"))
    if "'/farben.css'" not in ts:
        print("  KETTE OFFEN: server.ts traegt keine Route '/farben.css'.")
        rot += 1
    if "mixpi-farben.css" not in ts:
        print("  KETTE OFFEN: server.ts kennt die feste Datei mixpi-farben.css nicht.")
        rot += 1
    put = re.search(r"app\.put\('/api/farbthema'.*?(?=\napp\.)", ts, flags=re.S)
    if not put:
        print("  KETTE OFFEN: server.ts traegt kein PUT /api/farbthema.")
        rot += 1
    elif "setting_update" in put.group(0) or "sudo" in put.group(0):
        print("  ALTER WEG ZURUECK: der Farbthema-Schreibweg ruft wieder sudo/setting_update.")
        rot += 1

    if not rot:
        print("Farbkanal geschlossen: eine Datei, eine Route, ein Blatt vor app.css.")
        return 0
    print(f"\n{rot} Befund(e) am Farbkanal.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
