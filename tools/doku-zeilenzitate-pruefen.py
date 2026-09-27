#!/usr/bin/env python3
"""DOKU-ZEILENZITATE — zeigt `datei.ts:2584` noch auf eine Zeile, die es gibt?

WARUM ES DAS GIBT (24.08.2026): `tools/doku-luecken-probe.sh` fuehrt vierzehn
Wachen. `doku-pfade-pruefen.py` stellt als einzige die Gegenfrage — GIBT ES
NOCH, WORAUF DIE DOKU ZEIGT? — aber sie fragt sie nur fuer den PFAD. Den
Doppelpunkt dahinter schneidet sie ab.

Der Unterschied ist der zwischen "die Datei gibt es" und "die Stelle gibt es".
Gemessen stehen 198 Verweise der Form `pfad:zeile` in den Handbuechern und im
Wissenspaket, viele davon als einziger Beleg fuer eine Behauptung
(`server.ts:2584` belegt, dass es nur EINEN Aufrufer gibt). Wandert der Code —
und genau das misst `doku-pfade-pruefen.py` staendig: die Warteliste aus E66
zog aus dem Kern in ein Plugin —, dann bleibt der Dateiname richtig und die
Zeile zeigt woandershin. Die Wache davor meldet gruen.

WAS SIE PRUEFT, UND WAS EHRLICHERWEISE NICHT
  GEPRUEFT: die genannte Zeile liegt innerhalb der Datei. Das faengt jede
  Schrumpfung — geloeschter Block, ausgelagerte Datei, halbierter Server.
  NICHT GEPRUEFT: ob an Zeile 2584 noch DASSELBE steht. Das ist aus dem Text
  nicht ableitbar, und eine Wache, die es zu raten versucht, meldet Rauschen.
  Die Wache ist damit eine UNTERGRENZE: sie sagt nie faelschlich rot.

MEHRDEUTIGE NAMEN — DIE ZEILENZAHL ENTSCHEIDET MIT.
`streaming.ts` gibt es zweimal (Backend und Verwaltungsseite), `index.mjs`
zehnmal. Fuer einen blossen Pfad ist das nicht aufloesbar; MIT Zeilennummer
schon: ein Kandidat, der kuerzer ist als die genannte Zeile, kann nicht
gemeint sein. Bleibt DANACH kein einziger Kandidat uebrig, ist das ein Fund —
egal welche Datei gemeint war, diese Zeile hat keine von ihnen. Bleiben
mehrere, schweigt die Wache: sie weiss es dann nicht, und eine Wache, die
raet, ist keine.

GEGENPROBE (llmwiki: `gegenprobe-statt-gruen-glauben`). Findet die Wache GAR
KEIN Zitat, meldet sie eine Warnung statt gruen — eine Wache, die eine
geaenderte Schreibweise ueberlebt, bewacht nichts mehr. Nachgestellt wurde sie
mit `--sabotage <zahl>`: die Zeilennummern werden kuenstlich um <zahl> erhoeht,
und die Wache MUSS rot melden. Ohne diesen Schalter faellt sie am sauberen
Baum gruen aus, und gruen allein beweist nichts.

Aufruf aus dem Wurzelverzeichnis:  python3 tools/doku-zeilenzitate-pruefen.py
                                   python3 tools/doku-zeilenzitate-pruefen.py --sabotage 100000
Rueckgabe: 0 = keine Luecke, 1 = mindestens eine.
"""

import os
import re
import subprocess
import sys

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(WURZEL)

# DIESELBEN QUELLEN WIE `doku-pfade-pruefen.py`, plus zwei, die dort fehlen:
# BACKLOG.md belegt seine Status-Zellen mit Zeilenverweisen (`index.html:104`),
# und das Benutzerhandbuch zitiert vereinzelt in denselben Form.
QUELLEN = [
    "README.md",
    "plugins/README.md",
    "dokumentation/mixpibox.md",
    "dokumentation/benutzerhandbuch.html",
    "BACKLOG.md",
    "llmwiki/pack.yaml",
]

# Nur Endungen, hinter denen im Baum wirklich eine Textdatei mit Zeilen liegt.
# Ein `mupibox.service:3` waere ein Verweis in eine Unit-Datei; die stehen
# nicht im Baum, sondern auf der Box — dieselbe Regel wie OBERSTE drueben.
ENDUNGEN = "ts|tsx|mjs|js|py|sh|html|json|md|yaml|yml|css|scss"

ZITAT = re.compile(r"(?<![\w:/-])([A-Za-z0-9_@./+-]+\.(?:" + ENDUNGEN + r")):(\d+)(?:-(\d+))?(?![\w.])")

# Siehe Kopfteil: jede Zeile traegt ihren Grund. Ein Zitat, das hier landet,
# wird nie wieder geprueft — das ist kein Sammelbecken fuer Unbequemes.
AUSNAHMEN: dict[str, str] = {}


def sabotage_wert() -> int:
    """Die Gegenprobe: alle Zeilennummern kuenstlich hochsetzen."""
    if "--sabotage" in sys.argv:
        i = sys.argv.index("--sabotage")
        if i + 1 >= len(sys.argv):
            print("AUFRUF: --sabotage braucht eine Zahl.")
            sys.exit(2)
        return int(sys.argv[i + 1])
    return 0


VERSATZ = sabotage_wert()

# Der Baum, wie git ihn fuehrt. NICHT os.walk: node_modules und die
# Laufzeitablage haetten sonst Namensvettern, die es im Baum nicht gibt.
gefuehrt = set(subprocess.run(["git", "ls-files"], capture_output=True, text=True, check=True).stdout.split())
nach_namen: dict[str, list[str]] = {}
for pfad in gefuehrt:
    nach_namen.setdefault(pfad.rsplit("/", 1)[-1], []).append(pfad)

_laenge: dict[str, int] = {}


def zeilen(pfad: str) -> int:
    """Zeilenzahl einer Datei im Baum, einmal gelesen."""
    if pfad not in _laenge:
        with open(pfad, "rb") as f:
            roh = f.read()
        # Eine Datei mit abschliessendem Zeilenumbruch hat KEINE letzte leere
        # Zeile — `wc -l` und ein Editor zaehlen hier verschieden, und ein
        # Zitat auf die letzte Zeile darf daran nicht scheitern.
        _laenge[pfad] = roh.count(b"\n") + (0 if roh.endswith(b"\n") else 1)
    return _laenge[pfad]


def kandidaten(roh: str) -> list[str]:
    """Welche Dateien im Baum dieser Verweis meinen KANN."""
    if roh in gefuehrt:
        return [roh]
    treffer = nach_namen.get(roh.rsplit("/", 1)[-1], [])
    genauer = [p for p in treffer if p.endswith("/" + roh)]
    return genauer or treffer


luecken: list[str] = []
geprueft = 0
offen = 0

for quelle in QUELLEN:
    if not os.path.exists(quelle):
        print(f"  WARNUNG: {quelle} gibt es nicht — umbenannt?")
        luecken.append(quelle)
        continue
    with open(quelle, encoding="utf-8", errors="replace") as f:
        text = f.read()

    for treffer in ZITAT.finditer(text):
        roh, anfang, bis = treffer.group(1), int(treffer.group(2)), treffer.group(3)
        ende = int(bis) if bis else anfang
        ende += VERSATZ
        if treffer.group(0) in AUSNAHMEN:
            continue

        moegliche = kandidaten(roh)
        if not moegliche:
            # Die tote DATEI ist der Fund von `doku-pfade-pruefen.py`; hier
            # doppelt zu melden hiesse, denselben Fund zweimal zu zaehlen.
            continue

        geprueft += 1
        passend = [p for p in moegliche if zeilen(p) >= ende]
        if passend:
            if len(passend) > 1:
                offen += 1
            continue

        if len(moegliche) == 1:
            ziel = moegliche[0]
            print(f"  ZEILE GIBT ES NICHT: {treffer.group(0)} — {ziel} hat {zeilen(ziel)} Zeilen   (in {quelle})")
        else:
            kurz = ", ".join(f"{p} ({zeilen(p)})" for p in sorted(moegliche)[:3])
            print(f"  ZEILE GIBT ES IN KEINER: {treffer.group(0)} — {len(moegliche)} Namensvettern: {kurz}   (in {quelle})")
        luecken.append(treffer.group(0))

# DIE WICHTIGSTE PRUEFUNG DER DATEI. Ohne sie meldet die Wache gruen, sobald
# die Schreibweise der Verweise sich aendert — es gaebe dann schlicht nichts
# mehr zu pruefen, und das saehe genauso aus wie "alles in Ordnung".
if geprueft == 0:
    print("  WARNUNG: kein einziges Zeilenzitat in den Handbuechern gefunden — Schreibweise geaendert?")
    luecken.append("keine-zitate")

print()
print(f"{geprueft} Zeilenzitat(e) geprueft, davon {offen} mit mehreren moeglichen Dateien (nicht entscheidbar).")
if not luecken:
    print("KEINE LUECKE.")
    sys.exit(0)
print(f"{len(luecken)} LUECKE(N).")
sys.exit(1)
