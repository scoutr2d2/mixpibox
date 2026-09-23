#!/usr/bin/env python3
"""Stehen CLAUDE.md und das Wissenspaket noch auf demselben Arbeitsablauf?

══ WARUM ES DAS GIBT ══════════════════════════════════════════════════════
Der Ablauf einer Sitzung (erst Wiki, dann Stand von draussen, dann Werkzeuge
pruefen, notfalls bauen, dokumentieren, Wiki nachziehen) steht an ZWEI Orten,
und beide werden gebraucht:

  * `CLAUDE.md`            — wird zu Beginn JEDER Sitzung gelesen
  * `llmwiki/pack.yaml`    — das durchsuchbare Wissen, Eintrag
                             `arbeitsablauf-der-sitzung`

Eine Regel an zwei Orten laeuft auseinander, sobald jemand nur einen davon
anfasst. Dann liest die naechste Sitzung einen Ablauf, den das Wissenspaket
nicht kennt — oder umgekehrt —, und niemand sieht, welcher der richtige ist.
Genau diese Bauart hat am 04.09.2026 den Anlass fuer den Eintrag gegeben.

══ WAS SIE PRUEFT, UND WAS AUSDRUECKLICH NICHT ════════════════════════════
Sie vergleicht die beiden Orte NUR MITEINANDER. Die Wache hat KEINE eigene
Meinung darueber, welche Schritte es geben soll und wie sie heissen — sonst
waere sie ein DRITTER Ort, der beim naechsten Umbau mitgepflegt werden muss
und es nicht wird. Wer einen Schritt hinzufuegt, aendert zwei Dateien; diese
Wache sagt nur, ob er beide gemeint hat.

Gemessen wird an der Marke `SCHRITT <n>: <kennung>`; die Prosa dahinter darf
sich zwischen den beiden Orten unterscheiden (sie tut es auch — `CLAUDE.md`
ist eine Anleitung, der Wiki-Eintrag eine Begruendung).

DIE MARKE IST DAS MERKMAL, NICHT DER PFAD: Verschwindet sie aus einer der
beiden Dateien, ist das ein BEFUND und kein Grund zu schweigen. Eine Wache,
die still gruen wird, sobald das Merkmal fehlt, ist die gefaehrlichste Sorte
(llmwiki: wache-auf-sorte-nicht-auf-pfad).

══ AUFRUF ═════════════════════════════════════════════════════════════════
    python3 tools/arbeitsablauf-deckung.py
    python3 tools/arbeitsablauf-deckung.py --json

Rueckgabe: 0 = die beiden Orte stimmen ueberein, 1 = Befund, 2 = Umgebung.
Haengt in `tools/doku-luecken-probe.sh`.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
# ── DER INHALT STEHT IN AGENTS.md (04.09.2026) ──────────────────────────
# `AGENTS.md` ist die werkzeuguebergreifende Datei; `CLAUDE.md` verweist nur
# noch darauf. Der Baum haengt damit nicht mehr am Namen eines Werkzeugs.
# Betreiber: "dann waeren wir llm unabhaengig vom projekt".
ANLEITUNG = WURZEL / "AGENTS.md"
# Und der Verweis wird MITGEPRUEFT: Stuende in CLAUDE.md wieder eine eigene
# Regel, gaebe es zwei Wahrheiten ueber denselben Ablauf — genau das, wogegen
# diese Wache ueberhaupt gebaut ist. Sie darf deshalb AGENTS.md nennen und
# sonst keine SCHRITT-Marke tragen.
VERWEIS = WURZEL / "CLAUDE.md"
PAKET = WURZEL / "llmwiki" / "pack.yaml"
EINTRAG = "arbeitsablauf-der-sitzung"

# `SCHRITT 3: werkzeug-suchen` — Nummer und Kennung, sonst nichts. Die
# Ueberschrift dahinter ist Prosa und darf sich unterscheiden.
MARKE = re.compile(r"^\s*SCHRITT\s+(\d+):\s*([a-z0-9-]+)", re.MULTILINE)


def schritte_aus(text: str) -> list[tuple[int, str]]:
    """Die Marken in der Reihenfolge, in der sie dastehen."""
    return [(int(nr), kennung) for nr, kennung in MARKE.findall(text)]


def eintrag_rumpf(paket: str, eintrag_id: str) -> str | None:
    """Den Text EINES Eintrags herausschneiden — ohne das Paket zu laden.

    2,5 MB YAML zu parsen kostet hier mehrere Sekunden und bringt nichts: Die
    Marke steht im Rumpf als Klartext. Geschnitten wird von der Kennung bis
    zur naechsten Kennung auf derselben Einrueckung.
    """
    anfang = re.search(rf"^  - id: {re.escape(eintrag_id)}$", paket, re.MULTILINE)
    if not anfang:
        return None
    rest = paket[anfang.end():]
    naechster = re.search(r"^  - id: ", rest, re.MULTILINE)
    return rest[: naechster.start()] if naechster else rest


def pruefen() -> tuple[int, list[str], dict]:
    befunde: list[str] = []

    for pfad in (ANLEITUNG, PAKET, VERWEIS):
        if not pfad.exists():
            return 2, [f"FEHLER: {pfad.relative_to(WURZEL)} gibt es nicht."], {}

    # ── DER VERWEIS DARF KEINE EIGENE REGEL TRAGEN ────────────────────────
    # CLAUDE.md soll auf AGENTS.md zeigen und sonst nichts sagen. Stuende dort
    # wieder eine SCHRITT-Marke, gaebe es zwei Wahrheiten ueber denselben
    # Ablauf — und diese Wache verglichen nur eine davon mit dem Paket.
    verweis_text = VERWEIS.read_text(encoding="utf-8")
    if "AGENTS.md" not in verweis_text:
        befunde.append(
            "BEFUND: CLAUDE.md nennt AGENTS.md nicht mehr — der Verweis ist tot, "
            "und wer nur CLAUDE.md liest, bekommt den Arbeitsablauf gar nicht."
        )
    if schritte_aus(verweis_text):
        befunde.append(
            "BEFUND: CLAUDE.md traegt wieder eigene SCHRITT-Marken. Der Ablauf "
            "gehoert nach AGENTS.md; zwei Orte laufen auseinander."
        )

    anleitung_text = ANLEITUNG.read_text(encoding="utf-8")
    paket_text = PAKET.read_text(encoding="utf-8")

    rumpf = eintrag_rumpf(paket_text, EINTRAG)
    if rumpf is None:
        return 1, [
            f"BEFUND: Das Wissenspaket hat keinen Eintrag `{EINTRAG}` mehr.",
            "  AGENTS.md beschreibt damit einen Ablauf, den das Paket nicht kennt.",
        ], {}

    hier = schritte_aus(anleitung_text)
    dort = schritte_aus(rumpf)

    # KEINE MARKE IST EIN BEFUND, KEIN FREISPRUCH. Ohne diese Bedingung waere
    # die Wache genau dann still, wenn jemand die Marken entfernt — also im
    # gefaehrlichsten Fall.
    if not hier:
        befunde.append("BEFUND: In CLAUDE.md steht keine einzige `SCHRITT <n>: <kennung>`-Marke.")
    if not dort:
        befunde.append(f"BEFUND: Im Eintrag `{EINTRAG}` steht keine einzige Marke.")

    if hier and dort:
        kennungen_hier = [k for _, k in hier]
        kennungen_dort = [k for _, k in dort]

        if kennungen_hier != kennungen_dort:
            befunde.append("BEFUND: Die beiden Orte nennen nicht dieselben Schritte in derselben Reihenfolge.")
            befunde.append(f"  CLAUDE.md:  {' -> '.join(kennungen_hier)}")
            befunde.append(f"  Wiki:       {' -> '.join(kennungen_dort)}")
            nur_hier = [k for k in kennungen_hier if k not in kennungen_dort]
            nur_dort = [k for k in kennungen_dort if k not in kennungen_hier]
            if nur_hier:
                befunde.append(f"  nur in CLAUDE.md: {', '.join(nur_hier)}")
            if nur_dort:
                befunde.append(f"  nur im Wiki:      {', '.join(nur_dort)}")

        # Die Nummern muessen bei 1 beginnen und lueckenlos steigen — eine
        # Anleitung mit zwei Schritten 3 schickt den Leser in die Irre.
        for ort, schritte in (("CLAUDE.md", hier), ("Wiki", dort)):
            nummern = [n for n, _ in schritte]
            if nummern != list(range(1, len(nummern) + 1)):
                befunde.append(f"BEFUND: Die Schrittnummern in {ort} sind nicht 1..n: {nummern}")

        doppelte = {k for k in kennungen_hier if kennungen_hier.count(k) > 1}
        if doppelte:
            befunde.append(f"BEFUND: Kennung doppelt vergeben in CLAUDE.md: {', '.join(sorted(doppelte))}")

    messung = {
        "eintrag": EINTRAG,
        "claude_md": [{"nr": n, "kennung": k} for n, k in hier],
        "wiki": [{"nr": n, "kennung": k} for n, k in dort],
        "befunde": befunde,
    }
    return (1 if befunde else 0), befunde, messung


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--json", action="store_true")
    args = p.parse_args()

    code, befunde, messung = pruefen()

    if args.json:
        print(json.dumps(messung, ensure_ascii=False, indent=2))
        return code

    if code == 0:
        anzahl = len(messung["claude_md"])
        print(f"  AGENTS.md und llmwiki:{EINTRAG} nennen dieselben {anzahl} Schritte in derselben Reihenfolge.")
    else:
        for zeile in befunde:
            print(f"  {zeile}")
    return code


if __name__ == "__main__":
    sys.exit(main())
