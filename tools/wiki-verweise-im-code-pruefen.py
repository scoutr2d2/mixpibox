#!/usr/bin/env python3
"""WIKI-VERWEISE AUSSERHALB DES PAKETS — trifft `llmwiki: <kennung>` im Code
und in der Prosa noch einen Eintrag?

WOZU (27.08.2026): `tools/pack-verweise.py` gibt es, weil am 08.08.2026 vier
`related`-Ziele ins Leere zeigten, und die Ursache stand schon damals in
seinem Kopf: `vorschau-wird-geliehen` und `wiki-zustand-hat-haltbarkeit` sind
DATEINAMEN aus dem Gedaechtnis unter `~/.claude/.../memory/`, keine
Wiki-Kennungen. Zwei Wissensspeicher, EINE Verweis-Schreibweise.

Diese Wache prueft aber nur die Verweise INNERHALB von `pack.yaml`. Die
gleiche Schreibweise steht laengst ueberall sonst: 290 Nennungen der Form
`(llmwiki: \\`kennung\\`)` in Quelltextkommentaren, Tests, Handbuechern und
Rezepten — und dort hat sie nie jemand nachgeschlagen.

── WAS DER ERSTE LAUF FAND (290 Nennungen ausserhalb von `llmwiki/`) ──────
DREIZEHN, die keinen Eintrag treffen. Und die Ursache ist genau die, gegen
die `pack-verweise.py` gebaut wurde — sechs davon sind woertlich Dateinamen
aus dem Gedaechtnisordner:

    gruene-probe-deckt-nur-ihre-wachen   3× (ci-deckung.py, skriptweg-*.py)
    was-kostet-das-grep-v-dieser-wache   1× (doku-pfade-pruefen.py)
    wache-auf-sorte-nicht-auf-pfad       1× (schrift-herkunft-pruefen.py)
    tests-fahren-nichts-herunter         1× (src/backend-api/src/server.ts)
    git-add-schleppt-fremdes-mit         1× (ungerufene-wachen.py)
    eltern-bereich-fernsteuern-geht-nicht 1× (bildwahl-gruppen-schau.mjs)

Der Schaden ist NICHT „ein Link geht nicht". Der Satz davor behauptet etwas
und nennt einen Beleg. Wer das Paket holt, nach der Kennung greppt und nichts
findet, hat zwei Lesarten: der Beleg wurde geloescht, oder es gab ihn nie.
Beide fuehren dazu, die Behauptung fuer unbelegt zu halten — und in den sechs
Faellen oben ist sie das AUCH: die Lektion liegt in einem privaten Ordner,
den ausser dem Schreiber niemand lesen kann.

── DIE ZWEITE KLASSE: DER ZEILENUMBRUCH ───────────────────────────────────
Neun weitere Nennungen sehen tot aus und sind es nicht. Sie stehen in
Kommentaren, die umbrochen wurden:

    // (llmwiki `vorgabewert-ueberlebt-den-umzug-
    // seines-ordners`). Deshalb wird der Ordner …

Die Kennung ist richtig, sie ist nur ungreppbar. `pack-verweise.py` kennt
diese Falle seit dem 23.08.2026 (\"LEERRAUM MITTEN IM VERWEIS ZAEHLT MIT\") —
INNERHALB von pack.yaml. Diese Wache fuegt darum zusammen, was mit einem
Bindestrich am Zeilenende abbricht, und meldet es erst, wenn auch die
zusammengefuegte Kennung ins Leere geht.

── WAS SIE NICHT TUT, und warum das Absicht ist ───────────────────────────
  * `llmwiki/` bleibt draussen — das ist `pack-verweise.py`s Revier. Zwei
    Wachen auf derselben Datei geben verschiedene Antworten
    (llmwiki: `zwei-wachen-eine-datei-verschiedene-antwort`).
  * Eine Nennung zaehlt nur mit BINDESTRICH. `llmwiki: verweist` und
    `llmwiki … gemischt` sind Prosa, kein Verweis; Kennungen dieses Pakets
    sind durchweg Mehrwort-Kebab. Kostet die einwortige Kennung, falls je
    eine entsteht — Untergrenze statt Dauerrot
    (llmwiki: `dauerrote-wache-ist-keine`).
  * Sie prueft die EXISTENZ der Kennung, nicht ob der Eintrag die Behauptung
    im Satz davor auch traegt. Dagegen hilft nur Lesen.
  * Sie liest sich SELBST mit — und deshalb steht die Attrappe der Gegenprobe
    zerlegt in `MARKE` und `SABOTAGE_KENNUNG` da. Als ein Stueck geschrieben
    meldete sie den ersten Lauf ueber sich selbst rot (27.08.2026, c4971722)
    und riss die ganze `doku-luecken-probe.sh` mit
    (llmwiki: `gegenprobe-der-baumweiten-wache-liegt-im-baum`).

WARNUNG STATT GRUEN, wenn sie keine einzige Nennung findet: dann hat sich die
Schreibweise geaendert und die Wache ist blind, nicht sauber
(llmwiki: `gegenprobe-statt-gruen-glauben`).

Aufruf aus dem Wurzelverzeichnis:  python3 tools/wiki-verweise-im-code-pruefen.py
Gegenprobe:                        python3 tools/wiki-verweise-im-code-pruefen.py --sabotage
Rueckgabe: 0 = keine Luecke, 1 = mindestens eine, 2 = Wache blind.
"""

import re
import subprocess
import sys
from pathlib import Path

import yaml

WURZEL = Path(__file__).resolve().parent.parent
PACK = WURZEL / "llmwiki/pack.yaml"

# `llmwiki`, dann optional Doppelpunkt/Leerraum, dann die Kennung — mit oder
# ohne Backticks. Deckt jede Form ab, die im Baum vorkommt:
#   (llmwiki `x`)   (llmwiki: `x`)   "llmwiki:x"   * llmwiki x
NENNUNG = re.compile(r"llmwiki[-:\s]*[`'\"]?([a-z0-9][a-z0-9-]{7,})[`'\"]?")

# Eine Kennung dieses Pakets ist Mehrwort-Kebab. Ohne Bindestrich ist es ein
# deutsches Wort, das zufaellig hinter „llmwiki" steht.
KEBAB = re.compile(r"-")

# Zeilenanfangs-Zierrat, den ein Kommentar vor die Fortsetzung setzt.
ZIERRAT = re.compile(r"^[\s*#/>|-]*")

# Die Gegenprobe steht IM BAUM, und diese Wache liest den Baum — auch sich
# selbst. Stuenden Marke und Kennung als ein Stueck in der Zeile, meldete die
# Wache ihre eigene Attrappe als Fund und waere ab dem ersten Lauf dauerrot
# (llmwiki: `dauerrote-wache-ist-keine`). Getrennt gehalten kann `NENNUNG`
# nicht ueber die Anfuehrungszeichen greifen; zusammengesetzt wird erst zur
# Laufzeit in `main()`.
MARKE = "llmwiki"
SABOTAGE_KENNUNG = "diese-kennung-gibt-es-nicht"


def kennungen():
    daten = yaml.safe_load(PACK.read_text(encoding="utf-8"))
    return {
        e.get("id")
        for e in (daten.get("entries") or [])
        if isinstance(e, dict) and e.get("id")
    }


def dateien():
    """Verfolgte UND neue Dateien — die neuen sind der ganze Punkt.

    Bis zum 30.08.2026 stand hier `git ls-files -z`, also NUR Verfolgtes. Eine
    frisch geschriebene Wache ist aber unverfolgt, bis sie committet wird — und
    genau in ihrem Kopf steht der Verweis, den eine Sitzung aus dem Gedaechtnis
    hinschreibt, statt ihn im Paket nachzuschlagen. Die Wache lief also blind an
    der einen Datei vorbei, an der sie gebraucht wurde, und meldete gruen.

    Belegt zweimal: Commit bb6611b2 (30.08., 02:11) musste genau diesen Fehler
    von Hand nachbessern; im Lauf um 03:00 trat er sofort wieder auf, in
    tools/verworfene-wege-markiert.py, mit zwei Merkzettel-Slugs, die im Paket
    nie existiert haben. Zweimal derselbe Befund heisst: die Wache steht hinter
    dem Ereignis (llmwiki: `wiederkehrender-befund-ist-ablauffehler`).

    `--exclude-standard` haelt draussen, was `.gitignore` ohnehin nicht meint;
    `node_modules` und Baugut kommen so gar nicht erst herein.
    """
    aus = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        capture_output=True,
        text=True,
        check=True,
        cwd=WURZEL,
    ).stdout.split("\0")
    return [p for p in aus if p and not p.startswith("llmwiki/")]


def zusammengefuegt(zeilen, nr, roh):
    """Bricht die Kennung am Zeilenende mit `-` ab, holt die Fortsetzung.

    Der Kommentar setzt vor die Fortsetzung sein Zierrat (`//`, `*`, `#`).
    Zurueck kommt die laengste Kennung, die sich so bilden laesst.
    """
    if not roh.endswith("-") or nr >= len(zeilen):
        return roh
    weiter = ZIERRAT.sub("", zeilen[nr])
    m = re.match(r"([a-z0-9][a-z0-9-]*)", weiter)
    return roh + m.group(1) if m else roh


def main():
    sabotage = "--sabotage" in sys.argv
    if not PACK.exists():
        print(f"  WARNUNG: {PACK} fehlt — laeuft die Wache im Repo?")
        return 2
    ids = kennungen()
    if not ids:
        print("  WARNUNG: keine Kennung im Wissenspaket gelesen.")
        return 2
    print(f"  {len(ids)} Kennung(en) aus llmwiki/pack.yaml gelesen.")

    nennungen = 0
    funde = 0
    gefuegt = 0
    prosa = 0

    for rel in dateien():
        pfad = WURZEL / rel
        try:
            text = pfad.read_text(encoding="utf-8", errors="strict")
        except (OSError, UnicodeDecodeError):
            continue  # Binaerdatei oder unlesbar — kein Kommentar drin

        if sabotage and rel == "README.md":
            # GEGENPROBE: eine Kennung, die es sicher nicht gibt. Nur im
            # Speicher, nichts wird auf Platte geschrieben.
            text += f"\n\nBelegt ist das ({MARKE}: `{SABOTAGE_KENNUNG}`).\n"

        if "llmwiki" not in text:
            continue
        zeilen = text.splitlines()

        for m in NENNUNG.finditer(text):
            roh = m.group(1)
            if not KEBAB.search(roh):
                prosa += 1
                continue
            nr = text.count("\n", 0, m.start()) + 1
            kennung = zusammengefuegt(zeilen, nr, roh)
            if kennung != roh:
                gefuegt += 1
            nennungen += 1
            if kennung in ids:
                continue
            funde += 1
            zeile = zeilen[nr - 1].strip() if nr <= len(zeilen) else ""
            print(f"  TOTER VERWEIS: {rel}:{nr} → {kennung}")
            print(f"    {re.sub(r'[ \t]+', ' ', zeile)[:150]}")

    if prosa:
        print(f"  {prosa} einwortige Nennung(en) als Prosa gewertet (kein Verweis).")
    if gefuegt:
        print(f"  {gefuegt} ueber einen Zeilenumbruch zusammengefuegt.")

    if nennungen == 0:
        print("  WARNUNG: keine einzige Verweis-Nennung ausserhalb von llmwiki/.")
        print("  — hat sich die Schreibweise geaendert?")
        return 2

    print(f"  {nennungen} Verweis(e) ausserhalb des Pakets geprueft.")
    if funde:
        print(f"\n{funde} LUECKE(N).")
        return 1
    print("\nKEINE LUECKE.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
