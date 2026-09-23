#!/usr/bin/env python3
"""Prueft die GRENZE zwischen Oberflaeche und Server nicht nur nach Pfad,
sondern nach VERB.

Der bekannte Kurzschluss: ein Pfad existiert im Server, also gilt der Aufruf
als gedeckt. Express unterscheidet aber app.get von app.post. Ein GET auf eine
nur als POST registrierte Route faellt in den Catch-all am Dateiende und
liefert die Angular-Seite (HTML) statt JSON — die Oberflaeche bekommt keinen
Fehlercode, sondern einen Parse-Fehler an einer ganz anderen Stelle.

Erkannt werden in NewDesign/app.js:
  * fetch(<literal>, {method: …})
  * fetch(API + '/x' + …)  und  fetch(`${API}/x`)
  * json(<pfad>)  — der GET-Helfer in app.js (Zeile ~296), immer GET

Aufruf:
    python3 tools/grenzruf-verb-deckung.py
    python3 tools/grenzruf-verb-deckung.py --zeigen     # auch die gedeckten
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
SERVER = WURZEL / "src/backend-api/src/server.ts"
STANDARD_QUELLEN = ["NewDesign/app.js"]

ROUTE = re.compile(r"^\s*app\.(get|post|put|delete|patch|all)\(\s*['\"`]([^'\"`]+)['\"`]")
# gebautes Buendel (server.js auf der Box): der Bezeichner ist verkuerzt
ROUTE_BUENDEL = re.compile(
    r"[A-Za-z_$][\w$]*\.(get|post|put|delete|patch|all)\(\s*['\"`](/api/[^'\"`]*)['\"`]"
)


def routen_lesen(pfad: Path) -> list[tuple[str, str, int]]:
    text = pfad.read_text(encoding="utf-8")
    aus = []
    for nr, zeile in enumerate(text.splitlines(), 1):
        t = ROUTE.match(zeile)
        if t:
            aus.append((t.group(1).upper(), t.group(2), nr))
    if aus:
        return aus
    # Buendel: eine Zeile, Bezeichner verkuerzt
    for t in ROUTE_BUENDEL.finditer(text):
        nr = text[: t.start()].count("\n") + 1
        aus.append((t.group(1).upper(), t.group(2), nr))
    return aus


def route_passt(muster: str, pfad: str) -> bool:
    """Express-Segmentvergleich: :name deckt genau ein Segment.

    `X` AUF DER AUFRUFSEITE ist ein ganzes Segment, das die Oberflaeche zur
    Laufzeit einsetzt (`API + '/funk/' + was`). Es deckt darum jedes
    Mustersegment — anders als bisher, wo es nur auf ein woertliches „X"
    gepasst haette und `POST /api/funk/X` als „KEIN PFAD" gemeldet wurde,
    obwohl `was` nachweislich nur `bluetooth`, `wlan` oder `flug` ist.
    Was dabei NICHT verlorengeht: die Verbpruefung. `/api/funk/X` trifft jetzt
    alle drei `/api/funk/*`-Routen, und `main()` verlangt weiterhin, dass das
    Verb in mindestens einer davon vorkommt — ein GET auf diesen Zweig faellt
    nach wie vor auf. Verloren geht nur die Aussage „genau DIESES Segment gibt
    es nicht"; die ist bei einem zur Laufzeit gebauten Wert ohnehin nicht
    statisch zu treffen.
    """
    m = [s for s in muster.split("/") if s]
    p = [s for s in pfad.split("/") if s]
    if len(m) != len(p):
        return False
    for a, b in zip(m, p):
        if b == "X":                      # zur Laufzeit gesetztes Segment
            continue
        if a.startswith(":"):
            continue
        if ":" in a:                      # z.B. protokoll.:format
            if not b.startswith(a.split(":")[0]):
                return False
            continue
        if a != b:
            return False
    return True


def treffer_suchen(routen: list[tuple[str, str, int]], url: str) -> list[tuple[str, str, int]]:
    """Alle Routen, die `url` decken — mit unscharfem ENDE.

    WARUM DIE ZWEITE RUNDE: `pfad_aus` ersetzt jeden unbekannten Ausdruck
    durch `X`, auch wenn der gar kein Pfadstueck ist. Bei
    `json(API + '/medien' + (suche ? '?q=' + … : ''))` steht der Abfrageteil
    in einem Bedingungsausdruck; das `?` ist damit erst NACH der Ersetzung da,
    das Abschneiden an `?` greift zu frueh, und uebrig bleibt `/api/medienX` —
    ein Pfad, den es nicht gibt. Ein `X`, das ohne `/` an ein Segment klebt,
    ist deshalb kein eigenes Segment, sondern ein unscharfer Rest: erst
    woertlich versuchen, dann ohne ihn.
    """
    t = [r for r in routen if route_passt(r[1], url)]
    if t:
        return t
    if len(url) > 1 and url.endswith("X") and not url.endswith("/X"):
        return [r for r in routen if route_passt(r[1], url[:-1])]
    return []


# --- Ausdruck hinter fetch(/json( bis zum Komma bzw. zur schliessenden Klammer

def _ausdruck(text: str, i: int) -> tuple[str, int]:
    """Liest ab i den ersten Argumentausdruck (klammer-/anfuehrungsbewusst)."""
    tiefe = 0
    j = i
    zeichen = None
    while j < len(text):
        c = text[j]
        if zeichen:
            if c == "\\":
                j += 2
                continue
            if c == zeichen:
                zeichen = None
        elif c in "'\"`":
            zeichen = c
        elif c in "([{":
            tiefe += 1
        elif c in ")]}":
            if tiefe == 0:
                return text[i:j], j
            tiefe -= 1
        elif c == "," and tiefe == 0:
            return text[i:j], j
        j += 1
    return text[i:j], j


TEIL = re.compile(r"'([^']*)'|\"([^\"]*)\"|`([^`]*)`|\b(API)\b")


def pfad_aus(ausdruck: str) -> str | None:
    """Setzt einen Konkatenationsausdruck zu einem Pfadmuster zusammen.
    Alles Unbekannte (Variablen, Aufrufe) wird zu einem Platzhalter X."""
    if "/api" not in ausdruck and "API" not in ausdruck:
        return None
    stuecke: list[str] = []
    pos = 0
    for t in TEIL.finditer(ausdruck):
        zwischen = ausdruck[pos:t.start()]
        if re.search(r"[A-Za-z_$][\w$]*\s*\(|[A-Za-z_$][\w$.]*", zwischen.replace("+", " ")):
            if re.search(r"[A-Za-z_$]", zwischen):
                stuecke.append("X")
        if t.group(4):
            stuecke.append("/api")
        else:
            roh = t.group(1) or t.group(2) or t.group(3) or ""
            roh = re.sub(r"\$\{\s*API\s*\}", "/api", roh)
            stuecke.append(re.sub(r"\$\{[^}]*\}", "X", roh))
        pos = t.end()
    rest = ausdruck[pos:]
    if re.search(r"[A-Za-z_$]", rest):
        stuecke.append("X")
    url = "".join(stuecke)
    url = url.split("?")[0].split("#")[0]
    i = url.find("/api/")
    if i == -1:
        if url.rstrip("/") == "/api":
            return "/api"
        return None
    url = url[i:]
    # X als eigenes Segment normalisieren, Endschraegstrich weg
    url = re.sub(r"X+", "X", url)
    return url.rstrip("/") or "/api"


def aufrufe_lesen(pfad: Path) -> list[tuple[str, str, int]]:
    text = pfad.read_text(encoding="utf-8")
    aus: list[tuple[str, str, int]] = []
    for t in re.finditer(r"\b(fetch|json)\(", text):
        art = t.group(1)
        ausdruck, ende = _ausdruck(text, t.end())
        url = pfad_aus(ausdruck)
        if not url:
            continue
        if art == "json":
            verb = "GET"                      # der Helfer setzt kein method
        else:
            rest, _ = _ausdruck(text, ende + 1) if ende < len(text) and text[ende] == "," else ("", 0)
            v = re.search(r"method\s*:\s*['\"`](\w+)['\"`]", rest)
            verb = v.group(1).upper() if v else "GET"
        nr = text[: t.start()].count("\n") + 1
        aus.append((verb, url, nr))
    return aus


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--quelle", action="append", default=None)
    p.add_argument("--zeigen", action="store_true", help="auch gedeckte Aufrufe listen")
    a = p.parse_args()

    routen = routen_lesen(SERVER)
    fehler = 0
    for q in a.quelle or STANDARD_QUELLEN:
        qp = WURZEL / q
        if not qp.exists():
            print(f"FEHLT: {q}")
            fehler += 1
            continue
        rufe = sorted(set(aufrufe_lesen(qp)), key=lambda r: (r[1], r[0]))
        print(f"\n== {q}: {len(rufe)} Aufrufe an /api ({len(routen)} Routen im Server) ==")
        for verb, url, nr in rufe:
            treffer = treffer_suchen(routen, url)
            if not treffer:
                print(f"  KEIN PFAD   {verb:6} {url}   ({q}:{nr})")
                fehler += 1
                continue
            verben = {v for v, _, _ in treffer}
            if verb in verben or "ALL" in verben:
                if a.zeigen:
                    print(f"  ok          {verb:6} {url}")
                continue
            wo = ", ".join(f"{v} {m} (server.ts:{ln})" for v, m, ln in treffer)
            print(f"  VERB FEHLT  {verb:6} {url}   ({q}:{nr}) -> Server kennt nur: {wo}")
            fehler += 1

    print(f"\nAbweichungen: {fehler}")
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(main())
