#!/usr/bin/env python3
"""ANALYSE-MD-STAND — die Analyse-Texte der Wurzel gegen ihre eigenen Audits.

WARUM ES DAS GIBT (26.08.2026): `tools/doku-widerruf-probe.sh` findet Aussagen,
die dastehen und falsch sind — aber nur in den FUENF Dateien ihrer Liste
`DATEIEN` (plugins/README.md, dokumentation/mixpibox.md, das Benutzerhandbuch,
BACKLOG.md, README.md). Daneben liegen in der Wurzel **neun Analyse-MDs**
(`AUDIT-*`, `MODERNIZATION`, `KONZEPT-SIGNAL`, `ADMIN-BOARD-ANALYSE`,
`BOX-MENUE-ANALYSE`, `NEUE-OBERFLAECHE-PLAN`, `ANGLEICH-PI4-PI5`,
`ZUGEZOGEN`) mit zusammen ueber 3 000 Zeilen. Fuer KEINE der 32 Wachen in
`tools/doku-luecken-probe.sh` existieren sie. Dieselbe Bauart wie die
`Dockerfile` (26.08., `abbild-pfade-pruefen.py`) und die Wurzel-npm-Skripte:
**eine fuenfte Sorte Datei, die niemand liest.**

DER FALL, DER SIE AUSGELOEST HAT: `AUDIT-2026-08-23.md` §6.3 und `BACKLOG.md`
A4 stellen am 23.08.2026 fest, `MODERNIZATION.md` fuehre belegt falsche
Zustandsaussagen, und empfehlen woertlich einen Kopf „ueberholt am …". Drei
Tage spaeter stand der Text unveraendert da — inklusive „no CI", waehrend
`.github/workflows/ci.yml` bereits lief. Das Urteil war gefaellt, notiert und
folgenlos: es stand in der PRUEFENDEN Datei, nie in der GEPRUEFTEN. Genau die
Luecke, die `a9ed42c1` schon einmal in einer Commit-Nachricht fand.

WAS GEPRUEFT WIRD (beides zaehlt als Luecke):

  1. **Jeder Analyse-MD traegt ein Datum im Kopf** (erste 15 Zeilen): „Stand:
     2026-07-30", „Stand 14.08.2026", „ueberholt am 26.08.2026" oder ein
     Datum im Fliesstext des Kopfes. Ein Analyse-Text ohne Datum ist eine
     Momentaufnahme, die sich als Gegenwart liest.
  2. **Wen ein Audit fuer ueberholt erklaert, der sagt es selbst.** Nennt
     `AUDIT-*.md` oder `BACKLOG.md` einen Analyse-MD in einem Satz mit einem
     der Urteilswoerter (`falsche Zustandsaussagen`, `ueberholt`, `veraltet`),
     dann muss DIESE Datei in ihren ersten 40 Zeilen eine Ueberholt-Marke
     tragen. Das ist die Richtung, die am 23.08. gefehlt hat.

`AUDIT-*.md` sind selbst datiert — durch ihren Dateinamen. Sie sind vom
Datums-Teil ausgenommen, nicht vom Urteils-Teil: ein Audit kann ein aelteres
Audit ueberholen.

AUSGENOMMEN, mit Grund (llmwiki `dauerrote-wache-ist-keine`):
  * `README.md`   — lebendes Handbuch, kein Stand-Text; es beschreibt, was IST.
  * `LICENSE.md`  — Rechtstext, acht Zeilen, kein Zustand.
  * `BACKLOG.md`  — lebende Liste, wird fortgeschrieben statt ueberholt; sie
                    ist hier PRUEFER, nicht Geprueftes.

WAS ES NICHT TUT: es liest nur `*.md` der Wurzel und aendert nichts.

Findet die Wache keinen einzigen Analyse-MD oder kein einziges Audit, meldet
sie FEHLER statt gruen — eine Wache, die eine Umbenennung ueberlebt, ist keine
(llmwiki `gegenprobe-statt-gruen-glauben`).

Aufruf aus dem Wurzelverzeichnis:  python3 tools/analyse-md-stand-pruefen.py
Rueckgabe: 0 = keine Luecke, 1 = mindestens eine, 2 = die Wache selbst blind.
"""

import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent

# Lebende Texte und Rechtstexte — siehe Kopf. Wer hier etwas eintraegt,
# schreibt den Grund dazu.
AUSGENOMMEN = {
    "README.md": "lebendes Handbuch, beschreibt was IST",
    "LICENSE.md": "Rechtstext ohne Zustand",
    "BACKLOG.md": "lebende Liste; hier Pruefer, nicht Geprueftes",
}

# Die Dateien, deren Urteil zaehlt: die Audits und der Backlog.
PRUEFER_MUSTER = ("AUDIT-*.md", "BACKLOG.md")

# Ein Datum im Kopf — mit oder ohne Doppelpunkt, deutsch oder ISO.
DATUM = re.compile(r"\b(\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{4})\b")

# Die Marke, die ein ueberholter Text tragen muss. Beide Schreibweisen —
# „ÜBERHOLT" und „ueberholt" — der Baum fuehrt sie nebeneinander.
UEBERHOLT = r"(?:überholt|ueberholt)"
UEBERHOLT_MARKE = re.compile(rf"(?i){UEBERHOLT}")

# Urteilswoerter: faellt eines im selben Satz wie ein Dateiname, gilt die
# Datei als fuer ueberholt erklaert.
URTEIL = re.compile(rf"(?i)(falsche[rn]? Zustandsaussagen|{UEBERHOLT}|veraltet)")

KOPF_ZEILEN_DATUM = 15
KOPF_ZEILEN_MARKE = 40


def fehler(satz: str) -> None:
    print(f"FEHLER: {satz}")
    sys.exit(2)


def analyse_mds() -> list[Path]:
    """Die Analyse-Texte der Wurzel, ohne die ausgenommenen."""
    return sorted(
        p for p in WURZEL.glob("*.md") if p.name not in AUSGENOMMEN
    )


def saetze(text: str) -> list[str]:
    """Grob in Saetze zerlegt — Punkt/Semikolon/Zeilenumbruch als Grenze.

    Absichtlich grob: es geht um Naehe im Text, nicht um Grammatik. Zu weit
    geschnitten meldet falsch-rot, zu eng verpasst den Fund; ein Satz ist die
    Einheit, in der ein Audit ein Urteil formuliert.
    """
    return re.split(r"(?<=[.;])\s+|\n", text)


def main() -> int:
    luecken: list[str] = []
    texte = analyse_mds()
    if not texte:
        fehler(
            "kein einziger Analyse-MD in der Wurzel — umbenannt oder verschoben? "
            "Die Wache liest WURZEL/*.md."
        )

    # ── 1. Datum im Kopf ────────────────────────────────────────────────
    print("── Analyse-Texte ohne Datum im Kopf ──")
    for pfad in texte:
        if pfad.name.startswith("AUDIT-") and DATUM.search(pfad.name):
            continue  # traegt sein Datum im Namen
        kopf = "\n".join(pfad.read_text(encoding="utf-8").splitlines()[:KOPF_ZEILEN_DATUM])
        if not DATUM.search(kopf):
            print(
                f"  OHNE STAND: {pfad.name} nennt in den ersten {KOPF_ZEILEN_DATUM} "
                "Zeilen kein Datum — ein Analyse-Text ohne Stand liest sich als Gegenwart"
            )
            luecken.append(f"{pfad.name}/ohne-stand")

    # ── 2. Wen ein Audit ueberholt, der sagt es selbst ──────────────────
    print("── Fuer ueberholt erklaert, ohne es selbst zu sagen ──")
    namen = {p.name: p for p in texte}
    pruefer: list[Path] = []
    for muster in PRUEFER_MUSTER:
        pruefer.extend(sorted(WURZEL.glob(muster)))
    if not pruefer:
        fehler(
            "weder ein AUDIT-*.md noch BACKLOG.md in der Wurzel — der Urteils-Teil "
            "der Wache liefe ins Leere."
        )

    # name -> Liste der Fundstellen, die es fuer ueberholt erklaeren
    erklaert: dict[str, list[str]] = {}
    for p in pruefer:
        for nr, satz in enumerate(saetze(p.read_text(encoding="utf-8")), 1):
            if not URTEIL.search(satz):
                continue
            for name in namen:
                if name in satz and name != p.name:
                    erklaert.setdefault(name, []).append(f"{p.name}: „{satz.strip()[:90]}…\"")

    for name, stellen in sorted(erklaert.items()):
        kopf = "\n".join(namen[name].read_text(encoding="utf-8").splitlines()[:KOPF_ZEILEN_MARKE])
        if UEBERHOLT_MARKE.search(kopf):
            continue
        print(f"  URTEIL OHNE FOLGE: {name} traegt keine Ueberholt-Marke im Kopf, aber:")
        for stelle in stellen[:3]:
            print(f"      {stelle}")
        luecken.append(f"{name}/urteil-ohne-folge")

    print()
    if not luecken:
        print("KEINE LUECKE.")
        return 0
    print(f"{len(luecken)} LUECKE(N).")
    return 1


if __name__ == "__main__":
    sys.exit(main())
