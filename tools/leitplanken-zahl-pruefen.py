#!/usr/bin/env python3
"""LEITPLANKEN-ZAHL — zaehlt die Doku die Schritte von `pruefen.sh` richtig?

WARUM ES DAS GIBT (24.08.2026): Abschnitt 7.1 von `dokumentation/mixpibox.md`
sagte seit der ersten Fassung „17 Schritte". Gemessen waren es 73 unbedingte
plus 6, die nur mit `--box` bzw. am echten Geraet laufen — 79. Die Zahl war um
62 daneben, drei Wochen lang, direkt ueber dem Aufrufblock, den jeder liest.

Es ist derselbe Fehler wie die 51 in der README (llmwiki:
`zahlenwache-kannte-nur-eine-datei`): eine Zahl ueber den Baum, von Hand
geschrieben, danach nie wieder angefasst. Achtzehn Doku-Wachen pruefen Pfade,
Zeilen, Endpunkte, Verben, Units und Vokabular — KEINE zaehlt nach, was die
Doku ueber den Laeufer selbst behauptet. Ausgerechnet ueber den Laeufer: wer
liest, dass 17 Schritte laufen, und 79 Zeilen vorbeirauschen sieht, glaubt
eher, das falsche Skript erwischt zu haben, als der Doku zu misstrauen.

WAS GEZAEHLT WIRD, und warum in zwei Toepfen: `schritt "…" …` am Zeilenanfang
laeuft immer; eingerueckt steht es in einem `if` (Geraet, E2E, `--box`). Beide
Zahlen einzeln zu nennen ist der einzige Weg, eine Doku zu schreiben, die fuer
`--schnell` UND fuer `--box` stimmt. Die Doku muss BEIDE nennen.

GEGENPROBE EINGEBAUT: findet die Wache GAR KEINE `schritt`-Zeile, meldet sie
eine Warnung statt gruen — sonst quittiert sie ein umbenanntes
Aufrufwort stumm mit Erfolg (llmwiki: `gegenprobe-statt-gruen-glauben`).

Aufruf aus dem Wurzelverzeichnis:  python3 tools/leitplanken-zahl-pruefen.py
Rueckgabe: 0 = die Doku nennt beide Zahlen, 1 = mindestens eine fehlt.
"""

import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
LAEUFER = WURZEL / "tools/pruefen.sh"
DOKU = WURZEL / "dokumentation/mixpibox.md"

# `schritt "Name" befehl …` — am Zeilenanfang unbedingt, eingerueckt bedingt.
UNBEDINGT = re.compile(r"^schritt\s+\"", re.M)
BEDINGT = re.compile(r"^[ \t]+schritt\s+\"", re.M)


def main() -> int:
    luecken: list[str] = []

    if not LAEUFER.is_file():
        print(f"  WARNUNG: {LAEUFER} gibt es nicht — umbenannt?")
        return 1
    if not DOKU.is_file():
        print(f"  WARNUNG: {DOKU} gibt es nicht — umbenannt?")
        return 1

    quelle = LAEUFER.read_text(encoding="utf-8", errors="replace")
    immer = len(UNBEDINGT.findall(quelle))
    nur_geraet = len(BEDINGT.findall(quelle))

    if immer + nur_geraet == 0:
        # DIE WICHTIGSTE ZEILE DER DATEI. Ohne sie meldet die Wache gruen,
        # sobald `schritt` anders heisst — und die Doku darf dann jede Zahl
        # behaupten.
        print("  WARNUNG: keine einzige `schritt \"…\"`-Zeile gefunden — umbenannt?")
        return 1

    text = DOKU.read_text(encoding="utf-8", errors="replace")
    # Die Zahl muss ALS ZAHL dastehen, nicht irgendwo im Fliesstext vorkommen:
    # gesucht wird „<n> Schritte" bzw. „<n> weitere" / „<n> insgesamt".
    for zahl, wofuer, formen in (
        (immer, "Schritte, die immer laufen", (rf"\b{immer}\s+Schritte",)),
        (
            nur_geraet,
            "Schritte, die nur am Geraet laufen",
            (rf"\b{nur_geraet}\s+weitere", rf"\b{nur_geraet}\s+Schritte"),
        ),
        (
            immer + nur_geraet,
            "Schritte insgesamt",
            (rf"\b{immer + nur_geraet}\s+insgesamt", rf"\b{immer + nur_geraet}\s+Schritte"),
        ),
    ):
        if not any(re.search(f, text) for f in formen):
            print(f"  FEHLT in {DOKU.name}: {zahl} ({wofuer})")
            luecken.append(wofuer)

    if luecken and "--schreiben" in sys.argv:
        # ══ DIE ZAHL NACHZIEHEN, STATT SIE ABZUSCHREIBEN (19.09.2026) ═══════
        #
        # WARUM ES DEN SCHALTER GIBT: Die Zahl ist am 19.09.2026 ZWEIMAL an
        # einem Tag gedriftet — erst von 98 auf 112, Stunden spaeter auf 126,
        # weil fuenfzehn Schritte dazukamen. Ein wiederkehrender Befund ist
        # ein Ablauffehler, und der lag hier im Ablauf: Das Werkzeug KENNT die
        # richtige Zahl und durfte sie trotzdem nicht hinschreiben, also
        # musste ein Mensch sie abtippen. Das haelt nie.
        #
        # ERSETZT WIRD NUR DER EINE SATZ, nicht jede Zahl im Dokument. Der
        # Absatz darunter erzaehlt „um 62 Schritte daneben" als Geschichte
        # eines alten Fehlers — eine pauschale Ersetzung von `\d+ Schritte`
        # wuerde ihn verfaelschen und dabei gruen bleiben.
        satz = re.compile(r"^\d+ Schritte laufen immer, \d+ weitere", re.M)
        summe = re.compile(r"^(09\.09\.2026 die Cover-gegen-Rückfallbild-Probe\) — )\d+", re.M)
        neu_text, n1 = satz.subn(f"{immer} Schritte laufen immer, {nur_geraet} weitere", text)
        neu_text, n2 = summe.subn(rf"\g<1>{immer + nur_geraet}", neu_text)
        if n1 == 1 and n2 == 1:
            DOKU.write_text(neu_text, encoding="utf-8")
            print(f"  nachgezogen: {immer} unbedingt + {nur_geraet} am Geraet = {immer + nur_geraet}")
            return 0
        # Kein stilles Halb-Schreiben: wer die Saetze umformuliert, bekommt
        # eine Ansage statt einer halb gerichteten Doku.
        print(f"  ABBRUCH: erwartet genau EINE Fundstelle je Satz, gefunden {n1} und {n2}.")
        print(f"  Was zu tun ist: die zwei Saetze in {DOKU.name} ansehen und dieses")
        print("  Werkzeug nachziehen — die Zahl von Hand zu setzen faengt die Drift nur bis zum naechsten Mal.")
        return 2

    if luecken:
        print(f"  gemessen: {immer} unbedingt + {nur_geraet} am Geraet = {immer + nur_geraet}")
        print(f"\n{len(luecken)} LUECKE(N).")
        print("  Nachziehen:  python3 tools/leitplanken-zahl-pruefen.py --schreiben")
        return 1

    print(f"  KEINE LUECKE ({immer} unbedingt + {nur_geraet} am Geraet = {immer + nur_geraet}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
