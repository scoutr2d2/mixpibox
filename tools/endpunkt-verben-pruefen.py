#!/usr/bin/env python3
"""ENDPUNKT-VERBEN — steht die Doku auf dem richtigen HTTP-Verb?

WOZU (24.08.2026): Siebzehn Wachen laufen in `tools/doku-luecken-probe.sh`.
Eine davon, `tools/api-doku-deckung.sh`, haelt 200 REST-Routen gegen vier
Handbuecher — und liest dabei AUSSCHLIESSLICH den Pfad. Ihr grep-Muster
beginnt hinter dem Anfuehrungszeichen; das Verb steht davor und faellt weg.
Alle uebrigen sechzehn fragen nach Existenz: gibt es die Datei, die Zeile,
die Beschriftung, den Endpunkt. KEINE fragt, ob die Doku ihn richtig AUFRUFT.

Der Schaden ist nicht derselbe wie bei einem ungenannten Endpunkt. Wer eine
Route nicht dokumentiert findet, sucht weiter. Wer `PUT /api/konfiguration`
liest, tippt es ab und bekommt vom Express-Server ein 404 — dieselbe Antwort
wie fuer einen Pfad, den es gar nicht gibt. Der wahrscheinliche Schluss ist
„die Schreib-Schnittstelle ist weg", und der ist falsch: sie heisst POST.

── DER FUND BEIM ERSTEN LAUF ──────────────────────────────────────────────
  llmwiki/pack.yaml:29726   `PUT /api/konfiguration`   Code kennt GET, POST

Und es ist nicht irgendeine Zeile. Der Eintrag `theme-weg-fuenf-stellen`
belegt am Geraet, dass der Verweis `www/active_theme.css` NUR nachgezogen
wird, wenn die Verwaltung speichert — der Beleg dafuer ist genau dieser eine
Aufruf. Wer die Kette nachmessen will, macht es mit dem Verb, das dort steht,
bekommt 404, und die einzige gemessene Aussage ueber den Themenweg sieht aus
wie widerlegt.

── WAS SIE NICHT TUT, und warum das Absicht ist ───────────────────────────
  * Sie prueft nur Paare, zu denen der Code eine passende Route HAT. Ein
    dokumentierter Pfad ohne Route ist die Frage von `api-doku-deckung.sh`
    (Gegenrichtung) — hier waere er Rauschen.
  * Sie liest nur `src/backend-api/src/*.ts` ohne `*.spec.ts`. Plugins
    bringen eigene Routen mit; die stehen nicht in dieser Wache, und ein
    dokumentiertes Plugin-Verb faellt darum stumm durch. Untergrenze, kein
    falsches Gruen.
  * VERNEINUNG kommt durch. `BACKLOG.md` haelt fest: „Es gibt **kein** `PATCH
    /api/darstellung` — nur `GET` und `PUT`." Das ist die Wahrheit ueber ein
    Verb, keine falsche Anleitung. Ohne diese Ausnahme ruegte die Wache genau
    die Zeile, die den Fehler bereits benennt — derselbe Grund wie bei
    `stillgelegte-orte-pruefen.py`.
  * Sie sieht ein Verb nur, wenn es unmittelbar vor dem Pfad steht. Ein
    „mit PUT gegen /api/konfiguration" faellt durch.

WARNUNG STATT GRUEN, wenn sie nichts findet: keine Route im Backend oder kein
einziges dokumentiertes Verb/Pfad-Paar heisst, dass sich eine Schreibweise
geaendert hat, nicht dass alles stimmt (llmwiki `gegenprobe-statt-gruen-\
glauben`).

Aufruf aus dem Wurzelverzeichnis:  python3 tools/endpunkt-verben-pruefen.py
Gegenprobe:                        python3 tools/endpunkt-verben-pruefen.py --sabotage
Rueckgabe: 0 = keine Luecke, 1 = mindestens eine, 2 = Wache blind.
"""

import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
BACKEND = WURZEL / "src/backend-api/src"

# Dieselben Quellen wie `doku-zeilenzitate-pruefen.py`. BACKLOG.md ist dabei,
# weil dort die Abgleiche stehen, die Verben ausdruecklich benennen.
QUELLEN = [
    "README.md",
    "plugins/README.md",
    "dokumentation/mixpibox.md",
    "dokumentation/benutzerhandbuch.html",
    "BACKLOG.md",
    "llmwiki/pack.yaml",
]

VERBEN = ("GET", "POST", "PUT", "PATCH", "DELETE")

# `app.get('/api/x'`, `router.post("/api/y"`, `r.put(\`/api/z\`)` — dieselbe
# Schreibweise, die `api-doku-deckung.sh` liest, nur mit dem Verb als Gruppe.
ROUTE = re.compile(r"\b(?:app|router|r)\.(get|post|put|patch|delete)\(\s*['\"`]([^'\"`]+)")

# Im Text: `PUT /api/konfiguration`, PUT `/api/konfiguration`, „POST /api/x".
NENNUNG = re.compile(r"\b(" + "|".join(VERBEN) + r")\s+`?(/api/[A-Za-z0-9_:/.-]+)")

# VERNEINUNG — siehe Kopfteil. Bewusst kurz: jedes weitere Wort macht die
# Wache blinder, und `kein`/`nicht` deckt die Faelle ab, die im Baum stehen.
VERNEINT = re.compile(r"\bkein(?:e|en|er|es)?\b|\bnicht\b|\bstatt\b|\bnie\b", re.I)


def routen() -> dict[str, set[str]]:
    """Pfad -> Menge der Verben, die der Kern dafuer registriert."""
    gefunden: dict[str, set[str]] = {}
    for datei in sorted(BACKEND.glob("*.ts")):
        if datei.name.endswith(".spec.ts"):
            continue
        for m in ROUTE.finditer(datei.read_text(encoding="utf-8", errors="replace")):
            gefunden.setdefault(m.group(2), set()).add(m.group(1).upper())
    return gefunden


def passende(pfad: str, tabelle: dict[str, set[str]]) -> set[str]:
    """Alle Verben der Routen, auf die dieser dokumentierte Pfad passt.

    Express schreibt `:kennung`, die Doku schreibt Beispiele — dieselbe Falle
    wie in `api-doku-deckung.sh`, dieselbe Loesung: Platzhalter zu `[^/]+`
    aufweiten. Passt der Pfad auf MEHRERE Routen (die feste
    `/api/plugins/liste` und die Platzhalter-Route daneben), zaehlen die Verben
    aller Treffer — sonst ruegte die Wache eine Route, die es gibt.
    """
    verben: set[str] = set()
    for route, ms in tabelle.items():
        muster = "^" + re.sub(r":[A-Za-z0-9_]+", "[^/]+", re.escape(route).replace(r"\:", ":")) + "$"
        muster = re.sub(r":[A-Za-z0-9_]+", "[^/]+", muster)
        if re.match(muster, pfad):
            verben |= ms
    return verben


def saetze(text: str) -> list[tuple[int, str]]:
    """(Zeilennummer des Satzanfangs, Satz) — wie in stillgelegte-orte-pruefen."""
    ergebnis: list[tuple[int, str]] = []
    puffer: list[str] = []
    beginn = 1
    for nr, zeile in enumerate(text.splitlines(), start=1):
        if not puffer:
            beginn = nr
        puffer.append(zeile.strip())
        if not zeile.strip() or re.search(r"[.!?:]\s*$", zeile):
            ergebnis.append((beginn, " ".join(puffer)))
            puffer = []
    if puffer:
        ergebnis.append((beginn, " ".join(puffer)))
    return ergebnis


def main() -> int:
    sabotage = "--sabotage" in sys.argv
    tabelle = routen()
    if not tabelle:
        print(f"  WARNUNG: keine Route in {BACKEND} gefunden — Schreibweise geaendert?")
        return 2
    print(f"  {len(tabelle)} Route(n) aus {BACKEND.relative_to(WURZEL)} gelesen.")

    # Fuer die Gegenprobe eine Route mit GENAU EINEM Verb: bei mehreren waere
    # das „falsche" Verb womoeglich eines der richtigen.
    einzel = sorted(p for p, v in tabelle.items() if len(v) == 1)
    paare = 0
    funde = 0

    for rel in QUELLEN:
        pfad = WURZEL / rel
        if not pfad.exists():
            print(f"  WARNUNG: {rel} nicht gefunden — ist die Doku umgezogen?")
            return 2
        text = pfad.read_text(encoding="utf-8", errors="replace")
        if sabotage and einzel:
            # GEGENPROBE: ein Satz mit einem Verb, das diese Route nicht kennt.
            route = einzel[0]
            falsch = next(v for v in VERBEN if v not in tabelle[route])
            text += f"\n\nZum Schreiben ruft man `{falsch} {route}` auf.\n"
        for nr, satz in saetze(text):
            for m in NENNUNG.finditer(satz):
                verb = m.group(1)
                doku_pfad = m.group(2).rstrip(".,;:`")
                echte = passende(doku_pfad, tabelle)
                if not echte:
                    continue  # Gegenrichtung — Sache von api-doku-deckung.sh
                paare += 1
                if verb in echte:
                    continue
                if VERNEINT.search(satz):
                    continue
                funde += 1
                kurz = re.sub(r"\s+", " ", satz)[:150]
                print(f"  FALSCHES VERB: {rel}:{nr} → {verb} {doku_pfad}")
                print(f"    Der Kern kennt dafuer: {', '.join(sorted(echte))}")
                print(f"    {kurz}")

    if paare == 0:
        print("  WARNUNG: kein einziges dokumentiertes Verb/Pfad-Paar gefunden.")
        print("  — schreibt die Doku Endpunkte anders, oder ist eine Quelle leer?")
        return 2

    print(f"  {paare} dokumentierte(s) Verb/Pfad-Paar(e) mit Route im Kern geprueft.")
    if funde:
        print(f"\n{funde} LUECKE(N).")
        return 1
    print("\nKEINE LUECKE.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
