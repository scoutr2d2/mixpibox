#!/usr/bin/env python3
"""STILLGELEGTE ORTE — schickt eine Doku-Zeile den Leser in ein totes Repo?

WOZU (24.08.2026): Sechzehn Wachen fragen, ob ein Name, ein Pfad, eine Zeile,
eine Beschriftung oder ein Endpunkt EXISTIERT. Ein stillgelegtes Repo besteht
jede einzelne davon — der Ordner liegt ja noch auf der Platte. Was keine Wache
fragt: ob die Doku den Leser dorthin SCHICKT.

Gemessen stand genau das in `dokumentation/mixpibox.md`: Zeile 70 erklaerte
`~/Downloads/llmwiki_mupibox` fuer stillgelegt („wer dort arbeitet, legt eine
zweite Wahrheit an"), sieben Zeilen weiter stand „Aenderungen gehoeren nach
`~/Downloads/llmwiki_mupibox`". Dieselbe Seite, derselbe Abschnitt, entgegen-
gesetzte Anweisung — und die zweite ist die, der man folgt, weil sie sagt, was
zu TUN ist. Der Schaden ist belegt: das stillgelegte Repo trug am 22.08.2026
noch Commits, zwoelf Tage nach der Stilllegung (llmwiki
`stillgelegtes-repo-lebt-im-fetch-cache-weiter`). Der Wiki-Eintrag dort verlangt woertlich,
„die Anleitung umzuschreiben" — die Anleitung stand zwei Tage spaeter
unveraendert da. Ein Satz im Wiki haelt niemanden auf; eine Wache schon.

WOHER DIE LISTE DER TOTEN ORTE KOMMT, und warum das keine zweite Handpflege
ist: aus dem Abschnitt „Die Herkunftsrepos sind stillgelegt" in `ZUGEZOGEN.md`
— der Stelle, die die Stilllegung ueberhaupt ausspricht. Wer ein Repo
stilllegt, schreibt es dort hin; die Wache erbt den Eintrag, ohne dass jemand
sie anfasst. Findet sie den Abschnitt nicht oder keinen Pfad darin, meldet sie
WARNUNG statt gruen (llmwiki `gegenprobe-statt-gruen-glauben`).

WAS SIE NICHT TUT — und das ist Absicht, keine Luecke:
  * Sie ruegt nicht JEDE Nennung eines toten Ortes. Ueber die Herkunft zu
    schreiben ist richtig und noetig; `ZUGEZOGEN.md` besteht zur Haelfte
    daraus. Sie ruegt nur Saetze, die etwas ANWEISEN (die Liste der Verben
    steht unten und ist bewusst kurz).
  * Sie erkennt nur die Schreibweise `~/Downloads/<name>`, so wie die
    Stilllegung sie nennt. Ein relativer Pfad (`../llmwiki_mupibox`) faellt
    durch — das ist eine Untergrenze, kein falsches Gruen.
  * Sie liest keine Absaetze, sondern Saetze: eine Anweisung, deren Verb drei
    Zeilen ueber dem Pfad steht, findet sie nicht.
  * Ein Satz, der die alte Anweisung ZITIERT — woertlich in Anfuehrungszeichen
    oder mit „bis zum … stand hier …" — kommt durch, ebenso einer, der sie
    verneint. Sonst ruegte die Wache genau die Warnungen, die den Fehler
    benennen: den Absatz in `ZUGEZOGEN.md`, den Bericht in `mixpibox.md` und
    den Wiki-Eintrag dazu. Wer eine echte Anweisung in Anfuehrungszeichen
    setzt, kommt damit ebenfalls durch.

Aufruf aus dem Wurzelverzeichnis:  python3 tools/stillgelegte-orte-pruefen.py
Gegenprobe:                        python3 tools/stillgelegte-orte-pruefen.py --sabotage
Rueckgabe: 0 = keine Luecke, 1 = mindestens eine.
"""

import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
ZUGEZOGEN = WURZEL / "ZUGEZOGEN.md"
ABSCHNITT = "Die Herkunftsrepos sind stillgelegt"

# Wo gesucht wird. Das Wissenspaket ist bewusst dabei: es ist Doku, wird von
# `tools/wiki-suche.py` gelesen und hat denselben Leser.
QUELLEN = [
    "README.md",
    "ZUGEZOGEN.md",
    "BACKLOG.md",
    "dokumentation/mixpibox.md",
    "dokumentation/benutzerhandbuch.html",
    "plugins/README.md",
    "llmwiki/pack.yaml",
    "remote-step-installer/README.md",
]

# ANWEISENDE WENDUNGEN. Kurz gehalten, weil jede Erweiterung Rauschen bringt:
# `README.md` erklaert „wie man es nachzieht" und meint den Baum, nicht das
# tote Repo — „nachziehen" darf deshalb NICHT in dieser Liste stehen. Ebenso
# `\bpflege\b` mit Wortgrenze, sonst faengt es „wird nicht mehr gepflegt", also
# genau den Satz, der die Stilllegung ausspricht.
ANWEISUNGEN = [
    r"geh(?:ö|oe)r(?:en|t) (?:nach|in|dorthin)",
    r"\bschreib(?:e|t|en)?\b",
    r"\barbeite(?:t|n)?\b",
    r"\bcommitte(?:t|n)?\b",
    r"\bpushe(?:t|n)?\b",
    r"\bpflege\b",
    r"\bleg(?:e|t|en)? (?:sie |es |ihn )?dort\b",
]

# ZWEI AUSNAHMEN, und beide sind noetig, sonst ruegt die Wache genau die Saetze,
# die vor dem Fehler warnen:
#   * VERNEINUNG — „dort bitte nicht mehr arbeiten" ist keine Anweisung dorthin.
#   * HISTORISCH — ein Satz, der die alte Anweisung ZITIERT, um zu sagen, dass
#     sie falsch war („Bis zum 24.08.2026 stand hier das Gegenteil: …").
# Der Preis steht im Kopfkommentar: wer eine echte Anweisung schreibt und
# irgendwo im selben Satz „nicht" oder „bis zum" unterbringt, kommt durch. Das
# ist eine Untergrenze; die Alternative waere eine Wache, die jede Warnung
# anzeigt und darum abgeschaltet wird.
AUSNAHMEN = re.compile(
    r"\bnicht\b|\bnie\b|\bkeinesfalls\b"
    r"|stand hier|stand bis|\bbis zum\b|hie(?:ß|ss) es|\bfr(?:ü|ue)her\b|\behemals\b",
    re.I,
)


def steht_im_zitat(satz: str, ort: str) -> bool:
    """Steht der tote Pfad INNERHALB von Anfuehrungszeichen?

    Wer die alte, falsche Anweisung woertlich zitiert, um sie zu widerlegen,
    weist nichts an — dieser Eintrag im Wissenspaket tut genau das, und ohne
    diese Pruefung ruegte die Wache den Bericht ueber ihren eigenen Fund. Die
    Kehrseite steht im Kopfkommentar: eine echte Anweisung in
    Anfuehrungszeichen kommt durch. Untergrenze, kein falsches Gruen.
    """
    normal = satz.replace("„", '"').replace("“", '"').replace("”", '"')
    ort_n = ort
    teile = normal.split('"')
    return any(ort_n in teil for i, teil in enumerate(teile) if i % 2 == 1)


def satz_zerlegung(text: str) -> list[tuple[int, str]]:
    """(Zeilennummer, Satz) — Saetze, nicht Zeilen.

    Markdown bricht Saetze um; „Aenderungen gehoeren nach `~/…`" stand ueber
    zwei Zeilen und waere zeilenweise unsichtbar geblieben. Die Zeilennummer
    ist die des SATZANFANGS, damit der Bericht auf die Stelle zeigt, die man
    aufmacht.
    """
    saetze: list[tuple[int, str]] = []
    puffer: list[str] = []
    beginn = 1
    for nr, zeile in enumerate(text.splitlines(), start=1):
        if not puffer:
            beginn = nr
        puffer.append(zeile.strip())
        # Satzende oder Leerzeile: was im Puffer liegt, ist ein Satz.
        if not zeile.strip() or re.search(r"[.!?:]\s*$", zeile):
            saetze.append((beginn, " ".join(puffer)))
            puffer = []
    if puffer:
        saetze.append((beginn, " ".join(puffer)))
    return saetze


def tote_orte() -> list[str]:
    """Die stillgelegten Pfade aus dem Abschnitt in ZUGEZOGEN.md."""
    if not ZUGEZOGEN.exists():
        return []
    text = ZUGEZOGEN.read_text(encoding="utf-8")
    treffer = re.search(rf"^#+ {re.escape(ABSCHNITT)}\s*$(.*?)(?=^#+ |\Z)", text, re.S | re.M)
    if not treffer:
        return []
    return sorted(set(re.findall(r"`(~/Downloads/[A-Za-z0-9._-]+)`", treffer.group(1))))


def main() -> int:
    sabotage = "--sabotage" in sys.argv
    luecken: list[str] = []

    orte = tote_orte()
    if not orte:
        print(f"  WARNUNG: kein stillgelegter Pfad im Abschnitt '{ABSCHNITT}' in {ZUGEZOGEN}")
        print("  — umbenannt, verschoben oder die Schreibweise geaendert?")
        return 1
    print(f"  {len(orte)} stillgelegte(r) Ort(e) aus {ZUGEZOGEN.name}: {', '.join(orte)}")

    nennungen = 0
    for rel in QUELLEN:
        pfad = WURZEL / rel
        if not pfad.exists():
            continue
        text = pfad.read_text(encoding="utf-8", errors="replace")
        if sabotage:
            # GEGENPROBE: ein Satz, der genau den gesuchten Fehler macht.
            # Gruen am sauberen Baum beweist nichts — die Wache muss zeigen,
            # dass sie ueberhaupt rot werden kann.
            text += f"\n\nAenderungen gehoeren nach `{orte[0]}`.\n"
        for nr, satz in satz_zerlegung(text):
            for ort in orte:
                if ort not in satz:
                    continue
                nennungen += 1
                if AUSNAHMEN.search(satz) or steht_im_zitat(satz, ort):
                    continue
                for muster in ANWEISUNGEN:
                    if re.search(muster, satz, re.I):
                        kurz = re.sub(r"\s+", " ", satz)[:150]
                        print(f"  ANWEISUNG INS TOTE REPO: {rel}:{nr} → {ort}")
                        print(f"    {kurz}")
                        luecken.append(f"{rel}:{nr}")
                        break

    if nennungen == 0:
        # Zweite Sicherung: keine einzige Nennung heisst fast sicher, dass die
        # Quellenliste veraltet ist — nicht, dass alles sauber ist.
        print("  WARNUNG: kein stillgelegter Ort in irgendeiner Quelle genannt — Liste veraltet?")
        return 1

    print(f"  {nennungen} Nennung(en) geprueft.")
    if luecken:
        print(f"{len(luecken)} LUECKE(N).")
        return 1
    print("KEINE LUECKE.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
