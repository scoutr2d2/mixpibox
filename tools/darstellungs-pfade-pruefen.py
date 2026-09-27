#!/usr/bin/env python3
"""DARSTELLUNGS-PFADE — steht der Schalter noch unter dem Reiter, zu dem die Doku schickt?

WARUM ES DAS GIBT (30.08.2026): `tools/beschriftungen-deckung.py` fragt, ob es
den zitierten Knopf GIBT und ob er auf der genannten OBERFLAECHE sitzt
(Verwaltung oder Box). Keine Wache fragt, ob er auf der genannten SEITE an der
genannten STELLE sitzt. Genau dort ist am 30.08.2026 etwas verrutscht:

    Handbuch:  Eltern-Bereich -> Darstellung -> Verhalten -> "Wellen im Player"
    Wirklich:  Eltern-Bereich -> Darstellung -> Optik -> Mini-Player

Der Schalter war am selben Tag vom Reiter `verhalten` in die Optik-Gruppe `mp`
gewandert, und zwar auf Zuruf des Betreibers, dem er im Verhalten-Reiter NICHT
AUFGEFALLEN war ("der schalter ist nicht da ich haette ihn im player
vermutet"). Beide Doku-Dateien zeigten danach weiter auf den alten Ort.

DIESE SORTE KOMMT DURCH JEDE VORHANDENE WACHE. Die Beschriftung „Wellen im
Player" gibt es, sie steht in `src/frontend-admin`, der Absatz nennt einen
echten Menuepunkt, die Datei existiert, der Pfad `dokumentation/...` stimmt.
Falsch ist nur der Weg dorthin — und der Schaden ist derselbe wie beim
Betreiber: der Leser sucht an der genannten Stelle, findet nichts und haelt die
Funktion fuer nicht vorhanden.

AUF DIE SORTE GEWACHT, NICHT AUF DEN PFAD: die Namen der Reiter und der
Optik-Gruppen werden AUS `darstellung.ts` gelesen (`REITER`, `OPTIK_TEILE`,
`<h3>`), und die Zugehoerigkeit eines Knopfes ergibt sich aus dem `@if`-Block,
der ihn UMSCHLIESST — nicht aus der Feldliste einer Gruppe (die zaehlt nur die
fuehrenden Felder auf) und nicht aus einer Liste im Skript. Wird ein Reiter
umbenannt oder eine Gruppe geteilt, wandert die Wache mit.

GEPRUEFT WIRD NUR, WAS DIE DOKU BEHAUPTET. Ein Schalter, den kein Pfad nennt,
ist keine Luecke — das Handbuch beschreibt absichtlich nicht alle 60 Felder der
Darstellungsseite. Eine Wache, die das einforderte, waere dauerrot.

Aufruf aus dem Wurzelverzeichnis:  python3 tools/darstellungs-pfade-pruefen.py
Rueckgabe: 0 = keine Luecke, 1 = mindestens eine.
"""

import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
SEITE = WURZEL / "src/frontend-admin/src/app/seiten/darstellung.ts"
# ZWEI OBERFLAECHEN TRAGEN EINE „DARSTELLUNG", und bis zum 31.08.2026 kannte
# diese Wache nur eine davon. Der Eltern-Bereich der BOX gliedert seine
# Darstellung in eigene Unterseiten (Indikatoren, Farbe und Form, Player,
# Verhalten) — sie stehen in NewDesign/app.js und nirgends in darstellung.ts.
# Eine richtige Handbuchzeile ueber die Box („Eltern-Bereich → Darstellung →
# Indikatoren") wurde deshalb als erfundener Reiter gemeldet. Aufgefallen bei
# E113, als die zwei Groessen-Regler eingetragen wurden.
NEU_JS = WURZEL / "NewDesign/app.js"
DOKS = [
    WURZEL / "dokumentation/benutzerhandbuch.html",
    WURZEL / "dokumentation/mixpibox.md",
]

PFEIL = "→"
# Die Doku setzt beide Anfuehrungsformen; HTML-Entities kommen auch vor.
AUF = "„“”\"&"


def entschaerfen(s: str) -> str:
    """Zitatzeichen und Auszeichnung weg, damit Doku und Vorlage vergleichbar sind."""
    s = s.replace("&quot;", '"').replace("&nbsp;", " ")
    s = re.sub(r"</?(em|strong|code|span|i|b)[^>]*>", "", s)
    s = re.sub(r"[*`]", "", s)
    return s.strip().strip("„“”\"'").strip()


def seite_lesen() -> tuple[dict, dict, set, list]:
    """(reiter-id->name, optikteil-id->name, h3-namen, zeilen) aus darstellung.ts."""
    text = SEITE.read_text(encoding="utf-8")
    zeilen = text.split("\n")

    def tabelle(name: str) -> dict:
        m = re.search(r"const " + name + r"\s*(?::[^=]*)?=\s*\[(.*?)\n\]", text, re.S)
        if not m:
            raise SystemExit(f"FEHLER: `const {name}` nicht gefunden in {SEITE}")
        return dict(re.findall(r"id:\s*'([^']+)'\s*,\s*name:\s*'([^']*)'", m.group(1)))

    h3 = {entschaerfen(t) for t in re.findall(r"<h3>(.*?)</h3>", text, re.S)}
    return tabelle("REITER"), tabelle("OPTIK_TEILE"), h3, zeilen


def box_unterseiten() -> set:
    """Die Unterseiten von „Darstellung" im Eltern-Bereich der BOX.

    AUS DER QUELLE GELESEN, NICHT ABGESCHRIEBEN — dieselbe Regel wie fuer die
    Reiter der Verwaltung: Die Punkte stehen in NewDesign/app.js als
    `{ id: 'ind', gruppe: 'anzeige', …, name: 'Indikatoren', … }`. Wer einen
    umbenennt, verschiebt damit auch das, was diese Wache gelten laesst.

    FINDET SIE NICHTS, IST DAS EIN FEHLER UND KEIN LEERER SATZ. Eine still auf
    die leere Menge zurueckfallende Suche machte die Wache genau an der Stelle
    blind, an der sie eben erst sehend geworden ist.
    """
    text = NEU_JS.read_text(encoding="utf-8")
    namen = set()
    for zeile in text.splitlines():
        if "gruppe: 'anzeige'" not in zeile:
            continue
        m = re.search(r"name:\s*'([^']*)'", zeile)
        if m:
            namen.add(m.group(1))
    if not namen:
        raise SystemExit(f"FEHLER: keine Punkte mit gruppe: 'anzeige' gefunden in {NEU_JS}")
    return namen


def bloecke_verorten(zeilen: list, bekannt: dict) -> list:
    """Je Zeile die Menge der `@if`-Bedingungen, die sie umschliessen.

    Gezaehlt wird ueber die geschweiften Klammern der Vorlage. Interessant ist
    JEDER Vergleich `irgendwas() === 'x'`, dessen `x` eine Kennung aus `REITER`
    oder `OPTIK_TEILE` ist — bewusst NICHT der Name des Signals: der hiess
    schon `reiter`, heisst heute `reiterAktiv` und darf morgen anders heissen,
    ohne dass die Wache blind wird. Jede andere Klammer wird bloss mitgezaehlt,
    damit die Tiefe stimmt.
    """
    aktiv: list[tuple[int, str]] = []  # (tiefe beim Oeffnen, kennung)
    tiefe = 0
    je_zeile = []
    for zeile in zeilen:
        # Bedingung dieser Zeile merken, BEVOR ihre Klammern gezaehlt werden.
        neu = [
            kennung
            for _, wert in re.findall(r"(\w+)\(\)\s*===\s*'([^']+)'", zeile)
            for kennung in bekannt.get(wert, ())
        ]
        je_zeile.append({k for _, k in aktiv})
        for auf in zeile:
            if auf == "{":
                tiefe += 1
                if neu:
                    for kennung in neu:
                        aktiv.append((tiefe, kennung))
                    neu = []
            elif auf == "}":
                aktiv = [(t, k) for t, k in aktiv if t < tiefe]
                tiefe -= 1
    return je_zeile


def knopf_orte(zeilen: list, je_zeile: list) -> dict:
    """Beschriftung -> Menge der Kennungen (`reiter:x`, `optikTeilEff:y`), die sie umschliessen.

    Die Beschriftung eines Knopfes ist der Text zwischen `>` und `</button>`;
    der laufende Zustand (`{{ ... }}`) faellt weg — „Wellen im Player {{ ... }}"
    ist derselbe Knopf wie „Wellen im Player".
    """
    orte: dict[str, set] = {}
    voll = "\n".join(zeilen)
    for m in re.finditer(r">([^<>]*?)</button>", voll, re.S):
        text = entschaerfen(re.sub(r"\{\{.*?\}\}", "", m.group(1)))
        if not text or len(text) < 3:
            continue
        # Der Knopf gehoert dorthin, wo sein SCHLUSSTAG steht — die Zeile ist
        # ueber den Zeichen-Versatz zu finden, weil er ueber mehrere geht.
        i = voll.count("\n", 0, m.start())
        orte.setdefault(text, set()).update(je_zeile[i])
    return orte


"""Wie weit vor einem Pfad noch nach der zugehoerigen Beschriftung gesucht wird.

Das Handbuch schreibt die Beschriftung IN den Pfad („… → ,Wellen im Player'"),
die Architekturdoku davor („Beschriftung ,Wellen im Player' unter *Darstellung →
Optik → Mini-Player*"). Ohne dieses Vorfeld pruefte die Wache dort nur, ob es
den Reiter GIBT — und ein Pfad auf einen falschen, aber existierenden Reiter
kaeme durch (in der Gegenprobe C genau so gesehen).
"""
VORFELD = 140


def pfade_sammeln() -> list:
    """Alle Pfadangaben der Doku, die `Darstellung` nennen: (datei, roh, schritte)."""
    treffer = []
    for datei in DOKS:
        text = datei.read_text(encoding="utf-8")
        stellen = []
        # HTML: das Merkmal ist die Auszeichnung, nicht der Wortlaut.
        stellen += list(re.finditer(r'<span class="pfad">(.*?)</span>', text, re.S))
        # Markdown: kursive Kette mit mindestens einem Pfeil (darf umbrechen).
        stellen += list(re.finditer(r"\*([^*\n]*" + PFEIL + r"[^*]*)\*", text))
        for m in stellen:
            roh = m.group(1)
            flach = " ".join(roh.split())
            if PFEIL not in flach or "Darstellung" not in flach:
                continue
            schritte = [entschaerfen(s) for s in flach.split(PFEIL)]
            if "Darstellung" not in schritte:
                continue
            nach = schritte[schritte.index("Darstellung") + 1 :]
            if not nach:
                continue
            # Beschriftung aus dem Vorfeld, falls sie nicht im Pfad selbst steht.
            vor = " ".join(text[max(0, m.start() - VORFELD) : m.start()].split())
            zitate = re.findall(r"[„“”\"]([^„“”\"]{3,60})[„“”\"]", vor)
            treffer.append((datei.name, flach, nach, [entschaerfen(z) for z in zitate]))
    return treffer


def main() -> int:
    reiter, teile, h3, zeilen = seite_lesen()

    bekannt: dict[str, list] = {}
    name_zu_kennung: dict[str, set] = {}
    for tabelle_name, tabelle_inhalt in (("reiter", reiter), ("optikteil", teile)):
        for kid, name in tabelle_inhalt.items():
            bekannt.setdefault(kid, []).append(f"{tabelle_name}:{kid}")
            name_zu_kennung.setdefault(name, set()).add(f"{tabelle_name}:{kid}")

    je_zeile = bloecke_verorten(zeilen, bekannt)
    orte = knopf_orte(zeilen, je_zeile)
    box_seiten = box_unterseiten()

    luecken = []
    for datei, roh, schritte, vorfeld in pfade_sammeln():
        # Der letzte Schritt ist eine Beschriftung, wenn es ihn als Knopf gibt;
        # sonst zaehlt ein Zitat aus dem Vorfeld (siehe VORFELD).
        beschriftung = schritte[-1] if schritte[-1] in orte else None
        abschnitte = schritte[:-1] if beschriftung else schritte
        if not beschriftung:
            beschriftung = next((z for z in reversed(vorfeld) if z in orte), None)

        for abschnitt in abschnitte:
            # DIE VEREINIGUNG BEIDER OBERFLAECHEN und keine Fallunterscheidung
            # am Wort „Eltern-Bereich": Beide Wege werden im Handbuch so
            # eingeleitet — der Gruendungsfall dieser Wache („Eltern-Bereich →
            # Darstellung → Verhalten → ,Wellen im Player'") meinte die
            # VERWALTUNG. Wer daraus eine Weiche baute, machte die Wache fuer
            # den Fall blind, fuer den sie gebaut wurde. Ein Name, den KEINE
            # der beiden Oberflaechen kennt, faellt weiterhin auf.
            if abschnitt in name_zu_kennung or abschnitt in h3 or abschnitt in box_seiten:
                continue
            luecken.append(
                f"{datei}: „{roh}" + PFEIL.join([])
                + f"“ — weder die Darstellungsseite der Verwaltung (Reiter, "
                f"Gruppe, Ueberschrift) noch der Eltern-Bereich der Box "
                f"kennt „{abschnitt}“"
            )

        if not beschriftung:
            continue
        umgibt = orte[beschriftung]
        for abschnitt in abschnitte:
            erwartet = name_zu_kennung.get(abschnitt)
            if not erwartet:
                continue  # schon oben gemeldet oder eine <h3> ohne @if-Block
            if not (erwartet & umgibt):
                wo = sorted(umgibt) or ["(kein @if-Block)"]
                luecken.append(
                    f"{datei}: „{roh}“ — der Knopf „{beschriftung}“ "
                    f"steht NICHT unter „{abschnitt}“ ({'/'.join(sorted(erwartet))}), "
                    f"sondern unter: {', '.join(wo)}"
                )

    if luecken:
        for l in luecken:
            print("  " + l)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
