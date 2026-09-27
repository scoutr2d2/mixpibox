#!/usr/bin/env python3
"""Zitierte Namen der Oberflaeche — lebt die Funktion noch, auf die der Text zeigt?

WOFUER: die Doku-Wachen pruefen Pfade, Zeilen, Endpunkte, Verben, Units und
Vokabular. KEINE prueft einen FUNKTIONSNAMEN. Genau der ist der Satzteil, der
einen Rueckbau nicht ueberlebt und trotzdem stehenbleibt: die Datei existiert
weiter, die Zeile existiert weiter, die Funktion darin nicht. Kein Werkzeug
schlaegt an, weil keines den Namen gegen den Baum haelt.

DER ANLASS (31.08.2026, E95/V Stufe 3): der Rueckbau loeschte `abspielBefehl`
(heute `startPlan` in spielfunktion.ts),
`ardSendungAb`, `titelUndStelle` und sechs weitere aus NewDesign/app.js.
Danach standen neun Kommentare im Server-Quelltext, die `abspielBefehl` im
PRAESENS — statt `startPlan` —
als den Ort nannten, an dem der Abspielbefehl entsteht — darunter die
Architektur-Saetze in `verschmelzung.ts` („Entschieden wird dort, wo der Befehl
ENTSTEHT") und in `lane-weiter.ts` („die Addition steht an genau einer
Stelle"). Beide schickten den Leser nach NewDesign/app.js, wo nichts mehr war.
`tools/pruefen.sh` war komplett gruen, `tools/doku-luecken-probe.sh` meldete
KEINE LUECKE.

WIE DIE SORTE GEMESSEN WIRD, STATT SIE ZU RATEN — drei Toepfe, alle drei aus
dem Baum, keiner aus einer Wortliste:

  EINMAL DEFINIERT   aus `git log -p -- NewDesign/app.js`: jede Zeile, die je
                     eine Definition ENTFERNT hat. Wer nie eine Funktion war,
                     kann kein toter Wegweiser sein.
  HEUTE LEBEND       was NewDesign/app.js jetzt definiert. Ein Name, der
                     zwischendurch weg war und wiederkam, ist kein Fund.
  MEHRDEUTIG         Namen, die HEUTE anderswo im Quelltext ein Bezeichner
                     sind (`titel`, `dienst`, `bild`, `treffer` …). Sie in
                     Backticks zu finden beweist nichts — der Text meint dann
                     das Feld, nicht die geloeschte Funktion.

TOT = EINMAL DEFINIERT − HEUTE LEBEND − MEHRDEUTIG. Diese Namen darf ein
lebender Text nicht als Ort nennen. Kein Naehe-Fenster noetig: der Name selbst
ist der Beleg.

BEKANNTE LUECKE, ausdruecklich benannt statt verschwiegen: ein Name, der
zugleich anderswo Bezeichner ist, faellt durch (MEHRDEUTIG). `angekommen` und
`starte` sind so verlorengegangen. Die Wache faengt die Namen, die nur EINEN
Ort hatten — und das sind die Wegweiser, denen jemand folgt.

WAS SIE NICHT PRUEFT, UND WARUM: Logbuecher (BACKLOG.md, AUDIT-*.md,
news.txt) und das Wissenspaket. Deren Eintraege sind DATIERT und halten
ausdruecklich einen Stand fest — „am 04.08. war es so" bleibt wahr, auch wenn
es heute anders ist. Das ist eine Aussage ueber die SORTE des Textes, nicht
ueber seinen Pfad: ein Logbuch dokumentiert Vergangenheit per Bauart, ein
Quelltextkommentar behauptet Gegenwart.

DIE BEKANNT-LISTE ist der Gegenpol zur Fehlalarm-Muellhalde: sie nennt je
Eintrag den GRUND, warum ein toter Name dort richtig steht — fast immer, weil
der Satz den Umzug SELBST beschreibt und den alten Namen braucht, um ihn
benennen zu koennen. Wer sie ohne Grund fuellt, hat die Wache abgeschaltet.

Aufruf aus dem Wurzelverzeichnis:  python3 tools/ui-namen-zitate-pruefen.py
                                   python3 tools/ui-namen-zitate-pruefen.py --alle
"""

import re
import subprocess
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
UI_REL = "NewDesign/app.js"
UI = WURZEL / UI_REL

# Texte, die per Bauart Vergangenheit festhalten — siehe Kopf.
LOGBUCH = re.compile(r"^(BACKLOG\.md|AUDIT-\d{4}-\d{2}-\d{2}\.md|llmwiki/|news\.txt)")
GESUCHT = (".ts", ".mjs", ".js", ".py", ".sh", ".md", ".html")

DEF_HEUTE = [
    re.compile(r"\bfunction\s+([A-Za-z_$][\w$]*)"),
    re.compile(r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*="),
    re.compile(r"^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{", re.M),
]
# Aus dem Verlauf: nur ENTFERNTE Definitionszeilen (fuehrendes `-`).
DEF_ENTFERNT = re.compile(
    r"^-\s*(?:function\s+([A-Za-z_$][\w$]*)"
    r"|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|function))"
)
# Der NAME ist das Merkmal, nicht seine Auszeichnung: `abspielBefehl`
# (-> `startPlan`),
# `abspielBefehl()` und das nackte „siehe abspielBefehl" wiegen gleich schwer.
# Ohne Backticks zu suchen ist hier billig, weil die toten Namen GEMESSEN sind
# (einmal definiert, heute weg, nirgends sonst Bezeichner) — ein Wort wie
# `abspielBefehl` (-> `startPlan`) kommt in Prosa nicht zufaellig vor.
ZITAT = re.compile(r"\b([A-Za-z_$][\w$]{3,})\b")

# EIN TOTER WEGWEISER MUSS WEITERLEITEN.
#
# Der erste Entwurf dieser Wache fuehrte eine BEKANNT-Liste je FUNDSTELLE und
# stand nach einer einzigen Reparaturrunde bei dreizehn Eintraegen — eine
# Pflegelast, die mit jedem Satz waechst und nach drei Wochen niemand mehr
# liest (siehe llmwiki wache-die-nirgends-laeuft-rostet-auf-einem-fehlalarm:
# eine Ausnahmeliste ohne Gruende ist eine Muellhalde).
#
# Die Regel stattdessen: einen geloeschten Namen zu nennen ist ERLAUBT — er
# ist oft der einzige Weg, einen Umzug ueberhaupt zu benennen —, aber nur,
# wenn in Sichtweite auch steht, WOHIN er umgezogen ist. Das ist keine
# Tempus-Raterei (ein Werkzeug kann „gab" nicht von „gibt" unterscheiden,
# ohne Deutsch zu koennen), sondern die Frage, die der Leser wirklich hat:
# ich stehe vor einem Namen, den es nicht gibt — wo suche ich jetzt?
#
# Die Karte kostet EINE Zeile je geloeschter Funktion statt einer je Satz,
# und sie haelt Wissen fest, das sonst nirgends steht: wo das Ding hin ist.
# `ehemals` ist der Notausgang fuer den Fall, dass es keinen Nachfolger gibt
# (ersatzlos gestrichen) — dann muss das Wort dastehen.
NACHFOLGER = {
    "abspielBefehl": "startPlan",             # E95/V, spielfunktion.ts
    "werkTaugtFuerInterpret": "interpretTaugt",  # in den Server gezogen, werke.ts
}
FREIWORT = "ehemals"
FENSTER = 2


def namen_heute(text: str) -> set:
    aus = set()
    for muster in DEF_HEUTE:
        aus |= set(muster.findall(text))
    return aus


def namen_je_entfernt() -> set:
    roh = subprocess.run(
        ["git", "log", "-p", "--format=", "--", UI_REL],
        cwd=WURZEL, capture_output=True, text=True, errors="replace",
    ).stdout
    aus = set()
    for z in roh.splitlines():
        t = DEF_ENTFERNT.match(z)
        if t:
            aus.add(t.group(1) or t.group(2))
    return aus


def dateien() -> list:
    roh = subprocess.run(
        ["git", "ls-files"], cwd=WURZEL, capture_output=True, text=True, check=True
    ).stdout.splitlines()
    return [
        p for p in roh
        if p.endswith(GESUCHT) and not LOGBUCH.match(p) and not p.startswith("NewDesign/")
    ]


def mehrdeutige(namen: set, pfade: list) -> set:
    """Namen, die HEUTE anderswo ein Bezeichner sind — gemessen, nicht geraten."""
    if not namen:
        return set()
    alt = "|".join(re.escape(n) for n in namen)
    # Drei Formen, in denen ein Name HEUTE ein Bezeichner ist. Die dritte —
    # die KLASSENMETHODE — kostete einen Fehlalarm: `einstellungenOeffnen`
    # lebt als `protected einstellungenOeffnen(): void` in der KLASSISCHEN
    # Oberflaeche weiter, waehrend die neue sie geloescht hat. Ein Name, den
    # es irgendwo noch gibt, ist kein toter Wegweiser.
    dekl = re.compile(
        rf"\b(?:function|const|let|var|class|interface|type|enum)\s+({alt})\b"
        rf"|^\s*({alt})\??\s*:"
        rf"|^\s*(?:(?:public|private|protected|static|readonly|async|override)\s+)*({alt})\s*\(",
        re.M,
    )
    aus = set()
    for rel in pfade + [UI_REL]:
        try:
            text = (WURZEL / rel).read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for treffer in dekl.findall(text):
            aus.add(next(t for t in treffer if t))
    return aus


def main() -> int:
    alle = "--alle" in sys.argv
    if not UI.exists():
        print(f"WARNUNG: {UI_REL} fehlt — die Wache kann nichts pruefen.", file=sys.stderr)
        return 2

    pfade = dateien()
    lebend = namen_heute(UI.read_text(encoding="utf-8", errors="replace"))
    entfernt = namen_je_entfernt()
    if not entfernt:
        print("WARNUNG: kein Verlauf zu NewDesign/app.js — die Wache misst nichts.", file=sys.stderr)
        return 2

    kandidaten = entfernt - lebend
    mehr = mehrdeutige(kandidaten, pfade)
    tot = kandidaten - mehr

    funde, weitergeleitet = [], 0
    for rel in pfade:
        try:
            zeilen = (WURZEL / rel).read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        for i, z in enumerate(zeilen):
            for name in set(ZITAT.findall(z)):
                if name not in tot:
                    continue
                sicht = "\n".join(
                    zeilen[max(0, i - FENSTER):min(len(zeilen), i + FENSTER + 1)]
                )
                ziel = NACHFOLGER.get(name)
                if FREIWORT in sicht.lower() or (ziel and ziel in sicht):
                    weitergeleitet += 1
                    continue
                funde.append((rel, i + 1, name, z.strip(), ziel))

    print("── Tote Wegweiser: geloeschter Name, ohne zu sagen wohin ──")
    for rel, nr, name, z, ziel in funde:
        wohin = f"`{ziel}`" if ziel else f"kein Nachfolger bekannt — „{FREIWORT}\" schreiben"
        print(f"  {rel}:{nr}  `{name}`  ->  {wohin}")
        print(f"      {z[:118]}")

    print("\n── Die Nachfolger-Karte gegen den Baum ──")
    verwaist = [n for n in NACHFOLGER if n not in tot]
    for n in verwaist:
        print(f"  VERWAIST: `{n}` ist nicht (mehr) tot — Zeile aus NACHFOLGER streichen.")
    ohne = sorted(n for n in NACHFOLGER.values() if n not in mehr and n not in lebend)
    if alle:
        print(f"  TOTE NAMEN ({len(tot)}): {', '.join(sorted(tot))}")
        print(f"  MEHRDEUTIG, darum draussen ({len(mehr)}): {', '.join(sorted(mehr))}")
        print(f"  KARTE: {', '.join(f'{a} -> {b}' for a, b in sorted(NACHFOLGER.items()))}")

    if funde or verwaist:
        print(f"\n{len(funde)} tote Wegweiser, {len(verwaist)} verwaiste Karteneintraege.")
        return 1
    print(
        f"\nKein toter Wegweiser. {len(tot)} geloeschte Namen gegen {len(pfade)} Dateien "
        f"gehalten; {weitergeleitet} Zitate nennen ihr Ziel (--alle zeigt die Karte)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
