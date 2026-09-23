#!/usr/bin/env python3
"""Findet Eintraege des Wissenspakets, die sich EIN SYMPTOM teilen, ohne
voneinander zu wissen.

Der Anlass steht im Paket: 'Cannot ensure player ready' stand in zwei
Eintraegen mit verschiedener Ursache, 'Touch reagiert nicht' ebenso, die
durchgestrichene Wolke auch. Wer beim Suchen den ersten Treffer las, hielt
einen halben Weg fuer den ganzen. Von Hand wurden drei Paare verbunden --
diese Wache findet das vierte.

DAS MERKMAL, NICHT DIE LISTE: geprueft wird, ob zwei Eintraege in ihrem
`match:` dieselbe Alternative fuehren (getrennt an '|'). Ein Paar gilt als
versorgt, sobald die beiden sich GEGENSEITIG in `related:` nennen -- das ist
zugleich der einzige Weg, eine bewusste Doppelung stillzustellen. Eine
separate Ausnahmeliste gibt es absichtlich nicht: sie wuerde altern, ohne
dass es jemand merkt.

Ausgang 0 = keine unverbundene Kollision, 1 = Fund, 2 = unmessbar.
"""

import re
import subprocess
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
PAKET = WURZEL / "llmwiki" / "pack.yaml"

# DER AUSSCHLUSS GEHT UEBER DEN GEGENSTAND, NICHT UEBER DIE SCHREIBWEISE.
#
# Bis Fassung 382 stand hier `MINDESTWOERTER = 2`: einwortige Alternativen
# fielen heraus, begruendet damit, dass es geteilte WERKZEUGNAMEN seien
# ('api-doku-deckung', 'doku-luecken-probe'). Ein Handle ist wirklich keine
# Verwechslungsgefahr -- wer den Werkzeugnamen sucht, SOLL alle Eintraege dazu
# finden. Aber die Wortzahl ist eine Aussage ueber die SCHREIBWEISE, keine
# ueber den Gegenstand, und die ausgeschlossene Klasse war nie einzeln
# nachgemessen worden.
#
# Nachgemessen am 29.08.2026: von 36 einwortigen Kollisionen waren genau 5
# Namen aus dem Baum ('pack.yaml', 'pruefen.sh', 'doku-luecken-probe',
# '81-bluez-nur-a2dp', 'modernization'). Die anderen 31 waren
# Code-Bezeichner, Konfigurationsschluessel und API-Wege -- 'track_number',
# 'erkennung_ausfall_ms', 'interpretenerkannt', '/api/wlan' -- jeweils in zwei
# Eintraegen mit VERSCHIEDENER Ursache. Genau der Fall, fuer den die Wache
# gebaut wurde; die Wortzahl hatte ihn 31-fach weggeschnitten.
#
# Das Merkmal ist deshalb: ist die Alternative ein NAME aus dem Baum? Dann ist
# sie ein Indexbegriff und keine Beobachtung. Gefragt wird `git ls-files`,
# nicht das Dateisystem -- auf der Arbeitsmaschine liegt Ruecklass herum, und
# eine Wache, die ihn mitliest, spricht Namen frei, die kein anderer hat.
#
# IHRE BLINDHEIT, benannt statt verschwiegen: teilt sich ein echtes Symptom
# zufaellig den Wortlaut mit einem Dateinamen, sieht die Wache es nicht.
# 'pack.yaml' steht so in drei Eintraegen mit drei Ursachen.
MINDESTWOERTER = 1

# Und nur Eintraege, die auf ein BEOBACHTETES Symptom antworten. `note`,
# `howto`, `architektur` und die Audit-Protokolle teilen sich Vokabular, ohne
# dass jemand beim Suchen in den falschen Text geraet. Messung: 17 Gruppen
# ohne diese Bedingung, 14 mit ihr -- die drei Weggefallenen waren
# Audit-Protokolle, die den Wortlaut eines Fundes zitieren.
SYMPTOMARTEN = ("signature", "falle")

# Reine Regex-Gerueste tragen keine Aussage und kollidieren zufaellig.
NUR_GERUEST = re.compile(r"^[\W\d_\.\*\+\?\[\]\(\)\{\}\^\$\\|-]*$")


def namen_im_baum():
    """Alle NAMEN, die der Baum fuehrt: Dateinamen mit und ohne Endung sowie
    Verzeichnisnamen. Quelle ist `git ls-files`, nicht das Dateisystem --
    Ruecklass auf der Arbeitsmaschine darf keinen Namen freisprechen.

    Gibt None zurueck, wenn git nicht antwortet; die Wache ist dann unmessbar
    und behauptet nicht ersatzweise, es gebe keine Namen (das wuerde jeden
    Indexbegriff als Kollision melden)."""
    try:
        lauf = subprocess.run(
            ["git", "ls-files"],
            cwd=WURZEL, capture_output=True, text=True, check=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return None

    namen = set()
    for pfad in lauf.stdout.split("\n"):
        pfad = pfad.strip()
        if not pfad:
            continue
        for teil in pfad.split("/"):
            if not teil:
                continue
            namen.add(teil.casefold())
            stamm = teil.rsplit(".", 1)[0]
            if stamm:
                namen.add(stamm.casefold())
    return namen or None


def alternativen(muster):
    """Zerlegt ein match: in seine Alternativen und normalisiert sie."""
    roh = []
    tiefe = 0
    stueck = ""
    # An '|' trennen, aber nicht innerhalb von [...] oder (...) -- dort ist
    # der Strich Teil des Ausdrucks, keine Alternative des Autors.
    for zeichen in muster:
        if zeichen in "[(":
            tiefe += 1
        elif zeichen in "])":
            tiefe = max(0, tiefe - 1)
        if zeichen == "|" and tiefe == 0:
            roh.append(stueck)
            stueck = ""
        else:
            stueck += zeichen
    roh.append(stueck)

    ergebnis = set()
    for teil in roh:
        teil = teil.strip()
        if not teil or NUR_GERUEST.match(teil):
            continue
        schluessel = teil.casefold()
        if len(schluessel.split()) >= MINDESTWOERTER:
            ergebnis.add(schluessel)
    return ergebnis


def main():
    try:
        import yaml
    except ImportError:
        print("UNMESSBAR: PyYAML fehlt", file=sys.stderr)
        return 2
    if not PAKET.exists():
        print(f"UNMESSBAR: {PAKET} fehlt", file=sys.stderr)
        return 2
    try:
        paket = yaml.safe_load(PAKET.read_text(encoding="utf-8"))
    except yaml.YAMLError as fehler:
        print(f"UNMESSBAR: {PAKET} laesst sich nicht lesen: {fehler}", file=sys.stderr)
        return 2

    eintraege = (paket or {}).get("entries") or []
    if not eintraege:
        print("UNMESSBAR: keine Eintraege im Paket", file=sys.stderr)
        return 2

    namen = namen_im_baum()
    if namen is None:
        print("UNMESSBAR: `git ls-files` antwortet nicht -- ohne die Namen des"
              " Baums waere jeder Indexbegriff ein Fund", file=sys.stderr)
        return 2

    verweise = {}
    traeger = {}
    ausgeschlossen = 0
    for eintrag in eintraege:
        kennung = eintrag.get("id")
        if not kennung:
            continue
        verweise[kennung] = set(eintrag.get("related") or [])
        if eintrag.get("kind") not in SYMPTOMARTEN:
            continue
        muster = eintrag.get("match")
        if not isinstance(muster, str):
            continue
        for alternative in alternativen(muster):
            # Ein NAME aus dem Baum ist ein Indexbegriff, keine Beobachtung.
            if alternative in namen:
                ausgeschlossen += 1
                continue
            traeger.setdefault(alternative, set()).add(kennung)

    funde = []
    for alternative, kennungen in sorted(traeger.items()):
        if len(kennungen) < 2:
            continue
        sortiert = sorted(kennungen)
        # Versorgt ist die Gruppe erst, wenn JEDES Paar darin sich
        # gegenseitig kennt. Ein einseitiger Verweis hilft dem nicht, der
        # beim anderen Eintrag landet.
        offen = [
            (a, b)
            for i, a in enumerate(sortiert)
            for b in sortiert[i + 1:]
            if b not in verweise.get(a, ()) or a not in verweise.get(b, ())
        ]
        if offen:
            funde.append((alternative, sortiert, offen))

    if not funde:
        geprueft = sum(1 for a, k in traeger.items() if len(k) >= 2)
        print(f"      {len(traeger)} Symptome geprueft, "
              f"{geprueft} davon doppelt belegt und alle verbunden "
              f"({ausgeschlossen} Nennungen waren Namen aus dem Baum).")
        return 0

    for alternative, kennungen, offen in funde:
        print(f"KOLLISION  \"{alternative}\"")
        for kennung in kennungen:
            print(f"           {kennung}")
        for a, b in offen:
            richtung = []
            if b not in verweise.get(a, ()):
                richtung.append(f"{a} nennt {b} nicht")
            if a not in verweise.get(b, ()):
                richtung.append(f"{b} nennt {a} nicht")
            print(f"           -> {'; '.join(richtung)}")
    print()
    print(f"{len(funde)} unverbundene Symptom-Kollision(en).")
    print("Beheben: in BEIDE Eintraege 'related: [<zwilling>]' setzen und im")
    print("body die eine Frage nennen, die zwischen ihnen entscheidet.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
