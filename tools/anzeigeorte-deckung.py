#!/usr/bin/env python3
"""ANZEIGEORTE-DECKUNG — die Orte der neuen Oberflaeche gegen die Doku.

WARUM ES DAS GIBT (30.08.2026): `tools/box-seiten-deckung.py` haelt die 16
Wege der KLASSISCHEN Box-Oberflaeche gegen `dokumentation/mixpibox.md` und
meldet gruen. Die NEUE Oberflaeche (`NewDesign/`, die groessere und die
aktiv gebaute) hat aber gar keine Routentabelle — sie ist eine Seite, und was
man sieht, entscheidet ein `hidden`. Eine Wache, die nach `path:` sucht,
findet dort nichts und schweigt.

Gemessen am 30.08.2026: `Mini-Player`, `grosser Player` und `Cover-Vollbild`
kamen in `dokumentation/mixpibox.md` mit NULL Treffern vor. Das Handbuch
beschrieb die neue Oberflaeche (4.3) und ihre Gesten (4.8), aber nirgends,
dass sie DREI Orte hat, die dasselbe zeigen.

DASS GENAU DIESE ACHSE TEUER IST, steht schon im Baum: bis zum 03.08.2026
hatte jeder der drei Orte EIGENE Zuweisungen, zwei liefen im Takt, einer nur
beim Oeffnen — im Vollbild blieb der vorige Titel stehen. Die Lehre war nicht
die vergessene Zeile, sondern dass es drei Stellen gab, an denen man sie
vergessen konnte. Seither liest `anzeigeOrte()` die Liste AUS DEM BAUM, und
ein vierter Ort wird ohne eine Zeile app.js mitgemalt. Das ist die gute
Bauart — und zugleich der Grund fuer diese Wache: ein Ort, der sich selbst
verdrahtet, faellt niemandem auf, wenn er in der Doku fehlt.

AUF DIE SORTE GEWACHT, NICHT AUF DEN PFAD: gesucht wird das MERKMAL
`data-anzeigeort`, nicht `#mp` und nicht eine Liste bekannter Namen. Ein Ort,
der umbenannt wird, bleibt damit im Blick; eine Liste im Skript waere
derselbe Fehler noch einmal, nur eine Ebene hoeher — das Merkmal darf nicht
mit dem Fehler zusammen verschwinden koennen.

HTML-KOMMENTARE FALLEN HERAUS: `index.html` erklaert das Verfahren ueber der
Stelle und tippt dabei `data-anzeigeort="<Name>"` als Muster ab. Wer den
Kommentar mitliest, verlangt einen Ort namens `<Name>`. Ein zitierender
Kommentar ist keine Gegenstelle — wer ihn als solche gelten liesse, bekaeme
gruen von genau der Datei, die er gerade pruefen will.

GESUCHT WIRD DIE TABELLE, NICHT DER FLIESSTEXT — aus demselben Grund wie bei
den bewachten Wegen in `box-seiten-deckung.py`: die Namen stehen im Abschnitt
ohnehin auch im Fliesstext („Mini-Player einen Balken, der grosse Player …").
Eine Suche ueber das ganze Dokument meldete deshalb auf Dauer gruen, ohne je
die AUFZAEHLUNG geprueft zu haben — und die ist das, was altert.

FINDET DIE WACHE GAR KEINEN ORT, meldet sie eine Warnung statt gruen: eine
Wache, die ein umbenanntes Merkmal oder eine umgezogene Datei ueberlebt, ist
keine (llmwiki `gegenprobe-statt-gruen-glauben`).

Aufruf aus dem Wurzelverzeichnis:  python3 tools/anzeigeorte-deckung.py
Rueckgabe: 0 = keine Luecke, 1 = mindestens eine.
"""

import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
HTML = WURZEL / "NewDesign/index.html"
DOKU = WURZEL / "dokumentation/mixpibox.md"

luecken: list[str] = []


def orte_aus_html() -> list[str]:
    """Die Namen aller `data-anzeigeort`, Kommentare vorher entfernt.

    ENTFERNT STATT UEBERSPRUNGEN: ein `<!-- … -->` kann ueber viele Zeilen
    laufen (in `index.html` tut es das — der erklaerende Block ist ein
    Dutzend Zeilen lang). Zeilenweise zu filtern hiesse, den Anfang zu
    erkennen und das Ende zu raten.
    """
    text = HTML.read_text(encoding="utf-8")
    ohne_kommentar = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    return re.findall(r'data-anzeigeort="([^"]+)"', ohne_kommentar)


def orte_aus_doku(text: str) -> set[str]:
    """Die Namen aus der Tabelle unter der Ueberschrift mit `data-anzeigeort`.

    ABGEGRENZT AN DER NAECHSTEN LEERZEILE NACH DEM TABELLENKOPF: Markdown
    beendet eine Tabelle am ersten Absatz. Weiter zu lesen hiesse, jeden
    spaeteren Backtick-Namen des Abschnitts als Tabelleneintrag zu zaehlen —
    und der Fliesstext darunter nennt die Orte sehr wohl.
    """
    kopf = re.search(r"^\| `data-anzeigeort` \|.*$", text, re.M)
    if not kopf:
        return set()
    rest = text[kopf.end() :]
    ende = rest.find("\n\n")
    tabelle = rest[:ende] if ende != -1 else rest
    return set(re.findall(r"^\| `([^`]+)` \|", tabelle, re.M))


if not HTML.exists():
    print(f"  WARNUNG: {HTML} nicht gefunden — ist die neue Oberflaeche umgezogen?")
    sys.exit(1)

orte = orte_aus_html()
if not orte:
    print("  WARNUNG: kein `data-anzeigeort` in NewDesign/index.html —")
    print("           heisst das Merkmal noch so? Ohne es ist die Achse ungeprueft.")
    sys.exit(1)

doppelt = {n for n in orte if orte.count(n) > 1}
for n in sorted(doppelt):
    luecken.append(n)
    print(f"  ZWEIMAL VERGEBEN: `{n}` traegt mehr als eine Huelle — die Meldungen")
    print("                    der Pruefung koennen die Orte dann nicht unterscheiden.")

doku_text = DOKU.read_text(encoding="utf-8") if DOKU.exists() else ""
genannt = orte_aus_doku(doku_text)

if not genannt:
    print("  WARNUNG: die Tabelle mit dem Kopf `data-anzeigeort` steht nicht in")
    print(f"           {DOKU.relative_to(WURZEL)} — ohne sie ist die Aufzaehlung ungeprueft.")
    sys.exit(1)

# ── Richtung 1: jeder Ort aus dem Baum steht in der Tabelle ─────────────────
print("── Anzeigeorte aus NewDesign/index.html, die die Doku nicht fuehrt ──")
for name in sorted(set(orte)):
    if name not in genannt:
        luecken.append(name)
        print(f"  FEHLT in {DOKU.relative_to(WURZEL)}: `{name}`")

# ── Richtung 2: die Tabelle behauptet keinen Ort, den es nicht gibt ─────────
print("── Anzeigeorte, die die Doku fuehrt und der Baum nicht kennt ──")
for name in sorted(genannt - set(orte)):
    luecken.append(name)
    print(f"  GENANNT, ABER NICHT GEBAUT: die Doku fuehrt `{name}`, im HTML steht er nicht")

print()
if luecken:
    print(f"{len(luecken)} LUECKE(N) — {len(set(orte))} Anzeigeorte geprueft.")
    sys.exit(1)
print(f"Keine Luecke. {len(set(orte))} Anzeigeorte geprueft.")
