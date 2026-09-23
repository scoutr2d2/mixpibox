#!/usr/bin/env python3
"""SCHRIFT-HERKUNFT — traegt jede mitgelieferte Schriftdatei ihre Quelle?

WARUM ES DAS GIBT (27.08.2026): dieses Repo hat eine Regel, die es nirgends
aufgeschrieben hat, aber zehnmal befolgt: neben JEDEM Themenordner mit
fremden Bildern und Schriften liegt eine `Readme.md` mit genau zwei Zeilen —
`# Sources`, dann `Background:` und `Font:` mit der Adresse, von der das Ding
stammt. `themes/steampunk/Readme.md` fuehrt sogar vier Quellen einzeln auf.
Die README nennt in ihrer Danksagung jede fremde Zutat MIT Adresse: das
Katzenbild, den Startklang, den Ausschaltklang, jq, die Symbole.

Genau an einer Stelle ist die Regel gebrochen, und es ist die sichtbarste:
seit `3c59c80f` (31.07.2026, „Stufe 1 der zweiten Oberflaeche") liegen unter
`NewDesign/schriften/` VIER `woff2`-Dateien — 135 kB fremde Binaerdaten, die
auf jede Box ausgeliefert werden und die JEDER Buchstabe der neuen
Oberflaeche benutzt. Kein `Readme.md` daneben, kein Lizenztext im Baum,
`LICENSE.md` erwaehnt keine Schrift, und die eine Zeile in `README.md`
(Abschnitt Danksagung) nennt „**Baloo 2** und **Nunito**" als einzige
Eintraege der ganzen Liste OHNE Adresse.

Und keine der 34 Doku-Wachen konnte das je sehen. Sie fragen alle „nennt die
Doku, was im Baum steht?" fuer Wege, Zeilen, Endpunkte, Units, Vokabular,
Schluessel — also fuer TEXT. Eine mitgelieferte Binaerdatei hat keinen
Bezeichner, den man greppen koennte; sie faellt durch jede dieser Fragen
hindurch. Ausserdem lasen die Wachen die zehn `themes/*/Readme.md` nie: die
Wache fuer tote Wege (`tools/doku-pfade-pruefen.py`) haelt eine Liste von
SIEBEN Handbuechern, und wer nicht daraufsteht, existiert fuer sie nicht.

WARUM AUSGERECHNET SCHRIFTEN UND NICHT „ALLE FREMDDATEIEN": weil die Frage
sonst nicht beantwortbar waere. Im Baum liegen 298 PNG, 40 STL, 32 SKP — der
weit ueberwiegende Teil ist selbst gebaut (3D-Teile, Bildschirmfotos, das
Maskottchen), und eine Wache, die fuer jedes Bild einen Herkunftsnachweis
verlangt, meldet auf Dauer rot und wird zu Recht ignoriert. Bei Schriften
stellt sich die Frage nicht: eine Schriftdatei zeichnet in diesem Projekt
niemand selbst, JEDE ist fremd. Darum ist die Sorte „Schrift" die einzige,
bei der „ohne Quelle" zuverlaessig „Luecke" heisst — und der Baum belegt es,
zehn von vierzehn hatten ihre Quelle von Anfang an.

WAS GEPRUEFT WIRD: fuer jede von `git ls-files` gemeldete Datei mit der
Endung `ttf`, `otf`, `woff` oder `woff2` muss es eine Herkunftsangabe geben.
Zwei Wege zaehlen, und sie sind mit Absicht verschieden streng:

  * NEBEN der Schrift eine `Readme.md`/`README.md` mit einer `Font:`- bzw.
    `Schrift:`-Zeile, in der eine `http`-Adresse steht. Hier wird NICHT auf
    den Dateinamen geprueft, und das ist gemessen: `themes/comic` liefert
    `snaphand-v1-free.ttf` und nennt `dafont.com/de/snaphand.font`,
    `themes/mystic` liefert `ylee_Mortal_Heart.ttf` und nennt
    `dafont.com/de/ylee-mhim.font`. Schriftgiessereien benennen ihre Seite
    anders als die Datei; eine Wache, die auf Namensgleichheit besteht,
    meldet beide rot, obwohl die Quelle vollstaendig dasteht — und wird
    dafuer zu Recht ignoriert (llmwiki: `dauerrote-wache-ist-keine`). Ein
    solcher Ordner ist klein und enthaelt die Schriften EINER Sache; die
    Zeile daneben ist eindeutig genug.
  * Sonst in der `README.md` der Wurzel oder in `LICENSE.md` eine Zeile mit
    `http`-Adresse, die den Namen der Datei ODER ihres Ordners nennt. Dort
    ist die Namensprobe noetig, weil in diesen Dateien Dutzende fremder
    Zutaten stehen und sonst irgendeine fremde Adresse als Beleg durchginge.
    Der Name wird entschaerft (Kleinbuchstaben, ohne Ziffern-, Binde- und
    Unterstriche), damit `baloo2-latin.woff2` ein „Baloo 2" findet.

WAS ES NICHT PRUEFT: WELCHE Lizenz das ist und ob sie eingehalten wird. Das
ist eine Rechtsfrage und keine Wache; hier steht nur, dass ueberhaupt
jemand aufgeschrieben hat, woher die Datei kommt.

GEGENPROBE EINGEBAUT: findet die Wache GAR KEINE Schriftdatei, meldet sie
eine Warnung statt gruen — sonst quittiert sie ein umbenanntes Verzeichnis
stumm mit Erfolg (llmwiki: `gegenprobe-statt-gruen-glauben`). Sie haengt an
der SORTE (Dateiendung), nicht an einem Pfad: eine Schrift, die morgen unter
`src/` statt unter `NewDesign/` liegt, wird genauso gefragt (llmwiki:
`bauanleitung-ist-eine-vierte-sorte-datei`).

Aufruf aus dem Wurzelverzeichnis:  python3 tools/schrift-herkunft-pruefen.py
Rueckgabe: 0 = jede Schrift nennt ihre Quelle, 1 = mindestens eine nicht.
"""

import re
import subprocess
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent

ENDUNGEN = (".ttf", ".otf", ".woff", ".woff2")

# Die Ablagen, in denen eine Herkunft ausserdem stehen darf — zusaetzlich zu
# einer Readme NEBEN der Schrift. Beide sind Danksagungslisten und fuehren
# heute schon fremde Zutaten mit Adresse.
WEITERE_ORTE = ("README.md", "LICENSE.md")

# Eine Zeile zaehlt nur als Herkunft, wenn eine Adresse drinsteht. „Font:
# Nunito" ohne Adresse ist keine Quelle, sondern ein Name.
ADRESSE = re.compile(r"https?://")

# Die Beschriftung, die eine Zeile in der Nachbar-Readme zur SCHRIFT-Quelle
# macht — im Unterschied zu `Background:`/`Image:` daneben.
SCHRIFTZEILE = re.compile(r"^\s*(fonts?|schriftarten?|schriften?)\s*:", re.I)


def entschaerft(name: str) -> str:
    """`MagnoliaScript.otf` -> `magnoliascript`, `baloo2-latin` -> `baloolatin`.

    Ziffern fallen mit weg, damit `baloo2` auch „Baloo 2" trifft; ohne das
    haette die Schreibweise mit Leerzeichen keine Chance.
    """
    return re.sub(r"[^a-z]", "", name.lower())


def herkunftszeilen(pfad: Path) -> list[str]:
    if not pfad.is_file():
        return []
    text = pfad.read_text(encoding="utf-8", errors="replace")
    return [z for z in text.splitlines() if ADRESSE.search(z)]


def main() -> int:
    ergebnis = subprocess.run(
        ["git", "ls-files", "*.ttf", "*.otf", "*.woff", "*.woff2"],
        cwd=WURZEL,
        capture_output=True,
        text=True,
    )
    schriften = [Path(z) for z in ergebnis.stdout.split() if z]

    if not schriften:
        # DIE WICHTIGSTE ZEILE DER DATEI. Ohne sie meldet die Wache gruen,
        # sobald die Schriften umziehen oder in eine andere Endung wandern.
        print("  WARNUNG: keine einzige Schriftdatei gefunden — umgezogen?")
        return 1

    # Die Danksagungen der Wurzel einmal lesen, nicht je Schrift.
    weit = []
    for ort in WEITERE_ORTE:
        weit += herkunftszeilen(WURZEL / ort)

    luecken: list[Path] = []
    for schrift in schriften:
        # Weg 1: die Readme NEBEN der Schrift, mit `Font:`-Zeile und Adresse.
        nachbar = []
        for name in ("Readme.md", "README.md"):
            nachbar += herkunftszeilen(WURZEL / schrift.parent / name)
        if any(SCHRIFTZEILE.search(z) for z in nachbar):
            continue

        # Weg 2: die Danksagungen der Wurzel — dort mit Namensprobe.
        gesucht = {entschaerft(schrift.stem), entschaerft(schrift.parent.name)}
        gesucht.discard("")
        if any(any(n in entschaerft(z) for n in gesucht) for z in weit):
            continue

        print(f"  OHNE QUELLE: {schrift}")
        luecken.append(schrift)

    if luecken:
        print(
            f"\n{len(luecken)} LUECKE(N) von {len(schriften)} Schriften. "
            "Erwartet wird eine Zeile mit http-Adresse in einer `Readme.md` "
            "neben der Datei (so wie in `themes/*/Readme.md`) oder in der "
            "Danksagung der Wurzel-README."
        )
        return 1

    print(f"  KEINE LUECKE ({len(schriften)} Schriften, jede mit Quelle).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
