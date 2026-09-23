#!/usr/bin/env python3
"""HORCHENDE-PORTS-DECKUNG — jeder Port, auf dem die Box HORCHT, muss in der
Doku stehen.

WARUM DIESE WACHE UEBERHAUPT
Ein Port, auf dem ein Dienst horcht, ist Aussenflaeche. Wer die Box absichert,
eine Firewall-Regel schreibt, den Kiosk einrichtet oder eine Anmeldung
debuggt, liest die Doku — und findet dort nur die Ports, die jemand
aufgeschrieben hat. Ein undokumentierter Horcher ist kein Schoenheitsfehler:
er ist eine offene Tuer, von der das Handbuch nichts weiss.

Gefunden am 30.08.2026: `s.listen(5588, '127.0.0.1')` — der Horcher, der den
Spotify-Rueckweg entgegennimmt. Steht seit dem Bau im Code, mit langen
Kommentaren, und in KEINER Zeile Doku. Die Doku kannte 8200 und 8443.

AUF DIE SORTE, NICHT AUF DEN PFAD
Die Wache sucht `.listen(` im Backend — nicht die Zahl 5588, nicht die Datei
`server.ts`. Ein neuer Horcher in einer neuen Datei faellt genauso auf. Das
Merkmal darf nicht mit dem Fehler verschwinden.

Der Port darf als Zahl dastehen (`listen(5588, ...)`) oder ueber eine
Konstante kommen (`app.listen(httpPort)`); im zweiten Fall wird die
Zuweisung `const httpPort = ... || 8200` im selben Werk aufgeloest.
"""

import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent

# Wo gehorcht wird: alles Backend-TypeScript, keine Tests.
QUELLEN = sorted(
    p
    for p in (WURZEL / "src").rglob("*.ts")
    if ".spec." not in p.name and "node_modules" not in str(p)
)

# Wo ein Port dokumentiert sein darf.
DOKU = [
    WURZEL / "README.md",
    WURZEL / "BACKLOG.md",
    WURZEL / "llmwiki" / "pack.yaml",
    *sorted((WURZEL / "dokumentation").rglob("*.md")),
    *sorted((WURZEL / "dokumentation").rglob("*.html")),
    *sorted((WURZEL / "documentation").rglob("*.md")),
]

LISTEN = re.compile(r"\.listen\(\s*([A-Za-z_$][\w$]*|\d{2,5})")
# const foo = Number(process.env.X) || 8200   /   const foo = 8200
ZUWEISUNG = re.compile(r"\b(?:const|let|var)\s+([\w$]+)\s*=[^\n]*?(\d{2,5})\s*$", re.M)


def ports_der_datei(text: str) -> dict[int, str]:
    """Port -> der Ausdruck, der im listen() stand."""
    namen: dict[str, int] = {}
    for name, zahl in ZUWEISUNG.findall(text):
        namen.setdefault(name, int(zahl))

    gefunden: dict[int, str] = {}
    for roh in LISTEN.findall(text):
        if roh.isdigit():
            gefunden[int(roh)] = roh
        elif roh in namen:
            gefunden[namen[roh]] = roh
    return gefunden


def main() -> int:
    doku_text = ""
    for p in DOKU:
        if p.is_file():
            doku_text += p.read_text(encoding="utf-8", errors="replace")

    luecken: list[str] = []
    gesehen = 0
    for quelle in QUELLEN:
        text = quelle.read_text(encoding="utf-8", errors="replace")
        if ".listen(" not in text:
            continue
        for port, ausdruck in sorted(ports_der_datei(text).items()).__iter__():
            gesehen += 1
            if str(port) not in doku_text:
                rel = quelle.relative_to(WURZEL)
                luecken.append(
                    f"  Port {port} (aus `.listen({ausdruck})` in {rel}) "
                    f"steht in keiner Doku-Datei."
                )

    print("── Horchende Ports ohne Doku (tools/horchende-ports-deckung.py) ──")
    for zeile in luecken:
        print(zeile)
    if not luecken:
        return 0
    print(
        f"\n  {gesehen} Horcher geprueft, {len(luecken)} undokumentiert.\n"
        "  Ein Horcher ist Aussenflaeche. Wer die Box absichert oder eine\n"
        "  Anmeldung debuggt, muss den Port im Handbuch finden."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
