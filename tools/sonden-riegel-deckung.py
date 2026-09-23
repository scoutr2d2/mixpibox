#!/usr/bin/env python3
"""SONDEN-RIEGEL-DECKUNG — welche Box-Sonde faellt ein Urteil, ohne gemessen zu haben?

WARUM ES DAS GIBT (24.08.2026, Doku-Lauf): der Lauf davor (dc2bfc21) fand drei
ungerufene Wachen, zwei davon urteilten an der ABGESCHALTETEN Box, und stellte
die Regel auf:

    JEDE SONDE, DIE UEBER SSH ODER HTTP AN DIE BOX GEHT, BRAUCHT EINEN
    ERREICHBARKEITSRIEGEL VOR DER ERSTEN MESSUNG.

Die Regel wurde aufgeschrieben und an genau den drei Dateien angewandt, die
die damalige Suche gefunden hatte. Die Suche lief aber ueber die NAMEN
`*deckung*`, `*pruefen*`, `*halten*` — und die naechsten Geschwister heissen
`*-probe`, `*-messen`, `*-wer`. Zwei davon urteilten an derselben
abgeschalteten Box weiter:

  * `boxlisten-je-profil-probe.py` druckte „URTEIL: WIDERLEGT (zu
    optimistisch) — die Kinder-Oberflaeche liest die Listen NIE", ohne dass
    ein einziges Byte von der Box gekommen waere. Ausgang: 0.
  * `spotify-erneuerung-wer.py` las die tote Leitung als BESTAETIGUNG:
    „Zugangsdaten nicht mehr abrufbar (= Ziel von E15/S4)". Ausgang: 0.

Der Ausgang 0 ist dabei der Unterschied zum Vorlauf: dessen zwei Sonden gingen
mit 1 und sahen wenigstens nach einem Fund aus. Diese hier sehen GRUEN aus und
tragen die falsche Behauptung im Text.

WAS DIESE WACHE PRUEFT, und wo sie bewusst aufhoert
    Rot ist nur, wer alle drei Eigenschaften traegt:

      (1) redet im CODE mit der Box (nicht bloss im Fliesstext),
      (2) SCHLUCKT den Fehlschlag (leerer Text / None statt Abbruch),
      (3) faellt danach ein URTEIL.

    Ohne (2) stuerzt die Sonde ab — laut, haesslich, aber nicht luegend.
    Ohne (3) druckt sie Rohwerte, die niemand als Befund zitiert. Erst die
    Kombination erzeugt einen Satz, der wie eine Messung aussieht und keine
    ist. Was aus welchem Grund WEGFAELLT, sagt die Wache am Ende selbst —
    eine Wache liest man an ihren Ausschluessen, nicht an ihren Treffern
    (llmwiki: `wache-sieht-die-schleife-nicht-die-scharf-schaltet`).

Aufruf aus dem Wurzelverzeichnis:  python3 tools/sonden-riegel-deckung.py
Rueckgabe: 0 = keine Luecke, 1 = mindestens eine.
"""

import ast
import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
TOOLS = WURZEL / "tools"

# Die Box im Code: Benutzer@Host oder die feste Adresse. Beides kommt auch im
# Fliesstext vor — deshalb wird vorher entkommentiert, siehe `nur_code`.
BOX_IM_CODE = re.compile(r"dietpi@|192\.168\.178\.169")

# Ein geschluckter Fehlschlag: der Zweig, der aus einem toten `ssh`/`curl`
# einen harmlosen Wert macht, statt abzubrechen.
SCHLUCKT = [
    re.compile(r"except[^\n]*:\s*\n\s*return\s*(None|\"\"|''|\[\]|\{\}|0\b|-1\b)"),
    re.compile(r"except[^\n]*:\s*\n\s*return\s*\{?\s*[\"']fehler[\"']"),
    re.compile(r"capture_output=True[\s\S]{0,400}?return\s+\w+\.stdout"),
    re.compile(r"2>/dev/null\s*\|\|\s*(true|echo)"),
    re.compile(r"catch\s*\([^)]*\)\s*\{\s*return\s*(null|''|\"\"|\[\]|\{\})"),
]

# Ein Urteil: ein Satz, den jemand als Befund zitiert.
URTEIL = re.compile(
    r"URTEIL|WIDERLEGT|WIDERLEGUNG|BESTAETIGT|BESTAETIGUNG|✗|✓"
)

# Ein Riegel: EINE Erreichbarkeitsfrage vor der ersten Messung.
RIEGEL = re.compile(
    r"def erreichbar|erreichbar\(|ping\s+-c|ABBRUCH|nicht erreichbar|"
    r"No route to host|antwortet nicht"
)

# Die Stelle, an der eine Datei die Box anfasst — nur DORT zaehlt das
# Schlucken. Die erste Fassung suchte im ganzen Dateitext und meldete
# `wiki-pflege.py` rot: irgendwo darin steht ein `except: return ""` ueber
# einer Zeichenkette, mit der Box hat es nichts zu tun. Deren Box-Tuer
# (`stand_holen`) prueft `returncode` und WIRFT — genau richtig.
TUER = re.compile(r"\"ssh\"|'ssh'|\bssh\s+-o|urlopen\(|curl\b|fetch\(")

# Die Gegenrichtung zum Schlucken: die Tuer prueft den Draht oder wirft.
MELDET = re.compile(r"raise\b|returncode\s*!=\s*0|returncode\s*==\s*0|"
                    r"\.status\s*!=|throw\b|check=True")

luecken: list[str] = []
# Warum eine Datei NICHT rot ist — die Wache sagt ihre Ausschluesse selbst an.
verworfen: dict[str, list[str]] = {
    "redet nicht im Code mit der Box": [],
    "bricht bei totem Draht ab (schluckt nicht)": [],
    "druckt Rohwerte, faellt kein Urteil": [],
    "hat einen Riegel": [],
}


def nur_code(pfad: Path, text: str) -> str:
    """Der Text OHNE Doku-Bloecke und Kommentare.

    WARUM: `spotify-erneuerung-wer.py` nennt die Box-Adresse dreimal — zweimal
    in der Beschreibung, einmal als `default=`. Ein Dateiname (oder eine
    Adresse) im Fliesstext ist ein VERWEIS, kein Zugriff; die erste Fassung
    dieser Wache zaehlte `wiki-pflege.py` als Box-Sonde, weil dort ein
    ssh-Aufruf als BEISPIEL zitiert steht.
    """
    if pfad.suffix == ".py":
        try:
            baum = ast.parse(text)
        except SyntaxError:
            return text
        stellen: list[tuple[int, int]] = []
        for knoten in ast.walk(baum):
            if not isinstance(knoten, (ast.Module, ast.ClassDef,
                                       ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            erst = knoten.body[0] if knoten.body else None
            if (isinstance(erst, ast.Expr)
                    and isinstance(erst.value, ast.Constant)
                    and isinstance(erst.value.value, str)
                    and erst.value.lineno and erst.value.end_lineno):
                stellen.append((erst.value.lineno, erst.value.end_lineno))
        zeilen = text.splitlines()
        for von, bis in stellen:
            for i in range(von - 1, min(bis, len(zeilen))):
                zeilen[i] = ""
        return "\n".join(z for z in zeilen if not z.lstrip().startswith("#"))
    if pfad.suffix == ".sh":
        return "\n".join(z for z in text.splitlines()
                         if not z.lstrip().startswith("#"))
    # .mjs / .ts
    ohne = re.sub(r"/\*[\s\S]*?\*/", "", text)
    return "\n".join(z for z in ohne.splitlines()
                     if not z.lstrip().startswith("//"))


def tueren(pfad: Path, code: str) -> list[str]:
    """Die Stuecke Code, die die Box wirklich anfassen.

    Fuer Python die FUNKTIONEN mit ssh/curl/urlopen darin — sonst faellt das
    Urteil ueber ein `except` am anderen Ende der Datei. Fuer die uebrigen
    Sprachen ein Fenster um die Zeile herum; ein Fenster ist groeber, aber
    ehrlicher als der ganze Text.
    """
    if pfad.suffix == ".py":
        try:
            baum = ast.parse(code)
        except SyntaxError:
            return [code]
        gefunden = []
        for knoten in ast.walk(baum):
            if not isinstance(knoten, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            stueck = ast.get_source_segment(code, knoten) or ""
            if TUER.search(stueck):
                gefunden.append(stueck)
        # Keine Funktion? Dann steht der Zugriff auf Modulebene.
        return gefunden or [code]
    zeilen = code.splitlines()
    gefunden = []
    for i, z in enumerate(zeilen):
        if TUER.search(z):
            gefunden.append("\n".join(zeilen[max(0, i - 12):i + 25]))
    return gefunden or [code]


def main() -> int:
    dateien = sorted(p for p in TOOLS.iterdir()
                     if p.suffix in {".py", ".sh", ".mjs", ".ts"})
    if not dateien:
        print("  WARNUNG: keine Werkzeuge gefunden — die Wache misst nichts")
        return 1

    selbst = Path(__file__).name
    for pfad in dateien:
        if pfad.name == selbst:
            continue
        text = pfad.read_text(encoding="utf-8", errors="replace")
        code = nur_code(pfad, text)
        name = f"tools/{pfad.name}"

        if not BOX_IM_CODE.search(code):
            verworfen["redet nicht im Code mit der Box"].append(name)
            continue
        if RIEGEL.search(code):
            verworfen["hat einen Riegel"].append(name)
            continue
        stuecke = tueren(pfad, code)
        schluckt = any(m.search(s) for s in stuecke for m in SCHLUCKT)
        meldet = all(MELDET.search(s) for s in stuecke)
        if not schluckt or meldet:
            verworfen["bricht bei totem Draht ab (schluckt nicht)"].append(name)
            continue
        if not URTEIL.search(text):
            verworfen["druckt Rohwerte, faellt kein Urteil"].append(name)
            continue
        luecken.append(
            f"  OHNE RIEGEL: {name} schluckt den toten Draht und faellt "
            f"trotzdem ein Urteil"
        )

    for zeile in luecken:
        print(zeile)

    gesamt = sum(len(v) for v in verworfen.values())
    print(f"  (geprueft: {len(dateien) - 1} Werkzeuge; "
          f"{gesamt} fielen vorher heraus)")
    for grund, liste in verworfen.items():
        print(f"    – {len(liste):3d}  {grund}")

    if luecken:
        print(f"\n{len(luecken)} LUECKE(N).")
        return 1
    print("\nKEINE LUECKE.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
