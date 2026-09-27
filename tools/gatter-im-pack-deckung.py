#!/usr/bin/env python3
"""GATTER IM PACK — was einen Commit aufhalten darf, muss das Wiki erklaeren.

WOFUER (30.08.2026, stuendlicher Doku-Lauf): `tools/pruefen.sh` und der
pre-commit-Haken sind die zwei Wege, auf denen dieser Baum NEIN sagt. Wer
dort rot laeuft, liest den Werkzeugkopf — und der erklaert das Werkzeug,
nicht das RITUAL. Bei einer Ratsche ist genau das Ritual die ganze Frage:
darf ich die Baseline neu einfrieren, oder ist die Zahl der Befund?

Gemessen am 30.08.2026: von 78 Werkzeugen, die `pruefen.sh` als Schritt
ruft, nannte das Wissenspaket NEUN mit keinem Wort — darunter drei der vier
Ratschen. Eine Sitzung ohne Vorwissen haette dort raten muessen.

WAS GEPRUEFT WIRD
    Jedes Werkzeug, das eine der beiden Pflichtstrecken auf einer
    NICHT-Kommentarzeile aufruft, kommt im Wissenspaket namentlich vor
    (Basisname, irgendwo — Eintragskoerper, `match` oder `source`).

DAS MERKMAL IST DER AUFRUF, NICHT DER ORT (llmwiki: verweis-wache-las-nur-verfolgtes-und-verfehlte-die-neue-datei).
    Nicht "liegt in tools/" und nicht eine feste Liste: gemessen wird, was
    die Pflichtstrecken WIRKLICH rufen. Ein neuer Schritt bringt seine
    Pflicht zur Doku selbst mit; faellt ein Schritt weg, faellt die Pflicht
    mit ihm. Kommentare zaehlen nicht — ein Werkzeug, das nur im Fliesstext
    von pruefen.sh vorkommt, haelt niemanden auf.

VERGLICHEN WIRD UEBER DEN BASISNAMEN, nicht den Pfad; ob das Praefix
stimmt, ist Revier von doku-pfade-pruefen.py.

AUFRUF
    python3 tools/gatter-im-pack-deckung.py             Bericht
    python3 tools/gatter-im-pack-deckung.py --pruefen   still bei gruen, Exit 1
    python3 tools/gatter-im-pack-deckung.py --sabotage  Gegenprobe: der
                                                        Pack-Text wird
                                                        ignoriert, danach muss
                                                        JEDES Gatter auffallen
"""

import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
PACK = WURZEL / "llmwiki" / "pack.yaml"

# Die Pflichtstrecken. Beide sagen NEIN und halten damit Arbeit auf.
STRECKEN = [
    (Path("tools/pruefen.sh"), "tools/pruefen.sh"),
    (Path("tools/git-hooks/pre-commit"), "der pre-commit-Haken"),
]

WERKZEUG = re.compile(r"tools/[a-z0-9/_-]+\.(?:sh|py|mjs|ts)")


def gerufene_werkzeuge(datei: Path) -> set[str]:
    """Werkzeugpfade auf Nicht-Kommentarzeilen — das sind die, die laufen."""
    gefunden: set[str] = set()
    for zeile in datei.read_text(encoding="utf-8", errors="replace").splitlines():
        if zeile.lstrip().startswith("#"):
            continue
        gefunden.update(WERKZEUG.findall(zeile))
    return gefunden


def main() -> int:
    pruefen = "--pruefen" in sys.argv
    sabotage = "--sabotage" in sys.argv

    if not PACK.exists():
        print(f"FEHLER: {PACK} fehlt — ohne Wissenspaket ist nichts zu decken.")
        return 1
    pack = "" if sabotage else PACK.read_text(encoding="utf-8", errors="replace")

    gatter: dict[str, list[str]] = {}
    for rel, name in STRECKEN:
        datei = WURZEL / rel
        if not datei.exists():
            print(f"FEHLER: {rel} fehlt — die Wache misst ins Leere.")
            return 1
        for werkzeug in gerufene_werkzeuge(datei):
            gatter.setdefault(werkzeug, []).append(name)

    if not gatter:
        # Kein Fund heisst hier nicht gruen, sondern kaputt
        # (llmwiki: gegenprobe-statt-gruen-glauben).
        print("WARNUNG: keine einzige Werkzeugzeile in den Pflichtstrecken gelesen.")
        return 1

    fehlend = []
    for werkzeug in sorted(gatter):
        basis = werkzeug.rsplit("/", 1)[-1]
        if basis not in pack:
            fehlend.append((werkzeug, gatter[werkzeug]))

    if not pruefen:
        print(f"\n== Gatter der Pflichtstrecken: {len(gatter)} Werkzeuge ==\n")
        for werkzeug in sorted(gatter):
            basis = werkzeug.rsplit("/", 1)[-1]
            zeichen = "  " if basis in pack else "FEHLT"
            print(f"  {zeichen:5s}  {werkzeug:52s}  {', '.join(sorted(set(gatter[werkzeug])))}")
        print()

    if fehlend:
        print(f"BEFUND: {len(fehlend)} Gatter, die das Wissenspaket nicht nennt:")
        for werkzeug, wo in fehlend:
            print(f"  {werkzeug}  ({', '.join(sorted(set(wo)))})")
        print()
        print("  Wer dort rot laeuft, findet im Pack keine Zeile dazu. Eintrag")
        print("  in llmwiki/pack.yaml nachtragen — was das Gatter blockt und")
        print("  was rot bedeutet (bei Ratschen: darf neu eingefroren werden?).")
        return 1

    if not pruefen:
        print(f"Jedes der {len(gatter)} Gatter kommt im Wissenspaket vor.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
