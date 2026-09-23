#!/usr/bin/env python3
"""PACK.YAML PRUEFEN: gueltiges YAML, und jeder Verweis trifft eine Kennung.

WOZU ES DAS GIBT
Am 08.08.2026 standen in `llmwiki_mupibox/pack.yaml` vier `related`-Ziele, die
es nicht gab — und sie hatten eine gemeinsame Ursache: `vorschau-wird-geliehen`
und `wiki-zustand-hat-haltbarkeit` sind DATEINAMEN aus dem Gedaechtnis unter
`~/.claude/.../memory/`, keine Wiki-Kennungen. ZWEI Wissensspeicher, EINE
Verweis-Schreibweise. Das passiert wieder, solange nichts es meldet.

Ein zweiter Grund: an dieser Datei arbeitet mehr als einer gleichzeitig. Wer
einen Eintrag anlegt und ihn von einem anderen aus verlinkt, kann sich nicht
darauf verlassen, dass sein Nachbar dieselbe Kennung schreibt. Und wer einen
Eintrag im ARBEITSBAUM anlegt, aber nur einen Teil in den Index legt (siehe
tools/eigene-hunks.py), erzeugt einen Verweis, der im Arbeitsbaum stimmt und
NACH DEM COMMIT ins Leere geht. Deshalb kann dieses Werkzeug beide Staende
lesen: die Datei auf der Platte UND den Stand im Index.

WAS ES PRUEFT
  1. Ist die Datei gueltiges YAML? (sonst laedt sie der Installer nicht)
  2. Gibt es jede Kennung nur einmal?
  3. Trifft jedes `related:`-Ziel eine Kennung, die es gibt?
  4. Trifft jeder Verweis der Form [[kennung]] im Fliesstext eine Kennung?
     (Diese Form ist NICHT maschinenlesbar gemeint, aber ein Mensch klickt sie
     im Kopf — ein toter Verweis im Fliesstext kostet dieselbe Suchzeit.)
     Was in Backticks steht, ist zitiert und zaehlt nicht — siehe ZITAT.

WAS ES NICHT ANSIEHT
  Die `match:`-Muster und alles ausserhalb von pack.yaml. Wer nach der
  Deckung von Doku-SEITEN fragt, ist hier falsch.

AUFRUF
    python3 tools/pack-verweise.py                     # Arbeitsbaum
    python3 tools/pack-verweise.py --index             # Stand im Git-Index
    python3 tools/pack-verweise.py --nur-neu <a> <b>   # nur diese Kennungen
    python3 tools/pack-verweise.py --pfad /wo/pack.yaml

RUECKGABE: 0 sauber, 1 Befund, 2 Aufrufproblem. Damit taugt es fuer pruefen.sh.
"""

import re
import subprocess
import sys
from pathlib import Path

# ══ SEIT DEM 08.08.2026 LIEGT DAS WISSENSPAKET IM BAUM ══════════════════════
#
# Betreiber: „ich möchte das wiki llm und auch die werkzeuge wie das zum sd
# karte schreiben mit ins repository aufnehmen dass alles beisammen ist."
# Es steht seither unter `llmwiki/` (per `git subtree`, siehe ZUGEZOGEN.md).
#
# DER ALTE PFAD BLEIBT ALS RUECKFALL, und zwar nicht aus Bequemlichkeit: Wer
# einen Stand von vor diesem Tag ausgecheckt hat, hat kein `llmwiki/` — und
# ein Werkzeug, das dann bloss abbricht, ist schlechter als eines, das den
# alten Ort noch kennt. Gefunden wird, was zuerst dasteht.
def _pack() -> Path:
    hier = Path(__file__).resolve().parent
    for k in (hier.parent / "llmwiki" / "pack.yaml",
              Path("/home/achim/Downloads/llmwiki_mupibox/pack.yaml")):
        if k.exists():
            return k
    return hier.parent / "llmwiki" / "pack.yaml"


STANDARD = _pack()


def aus_index(pfad: Path) -> str:
    """Der Stand, den ein `git commit` OHNE -a schreiben wuerde."""
    wurzel = pfad.parent
    rel = pfad.name
    return subprocess.run(
        ["git", "-C", str(wurzel), "show", f":{rel}"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout


# Was in BACKTICKS steht, ist zitiert und nicht gemeint.
#
# WOZU (21.08.2026, im stuendlichen Doku-Lauf gefunden): Dieses Werkzeug
# meldete `halbe-pruefung-meldet-wie-eine-ganze` als toten Verweis. Der
# Eintrag ERKLAERT die Verweisformen und schreibt dabei „(`[[id]]` und
# `[id]`)" hin — ein Zitat, kein Verweis. `tools/wiki-schau.py` kennt diese
# Konvention seit dem 02.08.2026 und bleibt gruen; dieses hier kannte sie
# nicht. Zwei Wachen ueber derselben Datei, verschiedene Antwort — und die
# rote hatte unrecht. Eine Wache, die beim BESCHREIBEN eines Fehlers rot
# wird, erzieht dazu, sie wegzuschauen.
ZITAT = re.compile(r"`[^`\n]*`")


def laden(text: str):
    import yaml

    return yaml.safe_load(text)


def kennungen(daten) -> list:
    return [e.get("id") for e in (daten.get("entries") or []) if isinstance(e, dict)]


def pruefen(text: str, nur_neu=None) -> int:
    befunde = []
    try:
        daten = laden(text)
    except Exception as f:  # noqa: BLE001 - die Meldung IST das Ergebnis
        print(f"  KAPUTT: pack.yaml ist kein gueltiges YAML\n         {f}")
        return 1

    eintraege = [e for e in (daten.get("entries") or []) if isinstance(e, dict)]
    alle = kennungen(daten)
    bekannt = {k for k in alle if k}
    print(f"  YAML gueltig, {len(eintraege)} Eintraege, {len(bekannt)} Kennungen")

    # 2 — doppelte Kennungen
    gesehen, doppelt = set(), []
    for k in alle:
        if k in gesehen:
            doppelt.append(k)
        gesehen.add(k)
    for k in sorted(set(doppelt)):
        befunde.append(f"Kennung ZWEIMAL vergeben: {k}")

    ohne_id = [i for i, e in enumerate(eintraege) if not e.get("id")]
    for i in ohne_id:
        befunde.append(f"Eintrag ohne id (Nummer {i}): {eintraege[i].get('title')!r}")

    # 3 — related
    for e in eintraege:
        quelle = e.get("id") or "<ohne id>"
        if nur_neu and quelle not in nur_neu:
            continue
        rel = e.get("related") or []
        if isinstance(rel, str):
            rel = [rel]
        for ziel in rel:
            if not isinstance(ziel, str) or not ziel.strip():
                befunde.append(f"{quelle}: leeres related-Ziel")
            elif ziel not in bekannt:
                befunde.append(f"{quelle}: related -> {ziel} GIBT ES NICHT")

    # 4 — [[kennung]] im Fliesstext
    for e in eintraege:
        quelle = e.get("id") or "<ohne id>"
        if nur_neu and quelle not in nur_neu:
            continue
        roh = "\n".join(str(v) for v in e.values() if isinstance(v, (str, int, float)))
        roh = ZITAT.sub(" ", roh)
        # LEERRAUM MITTEN IM VERWEIS ZAEHLT MIT (23.08.2026, Doku-Lauf).
        # Bis hierher stand hier `[a-z0-9][a-z0-9-]*` — ohne Leerzeichen. Zwei
        # Verweise im Paket waren beim Schreiben ueber den Zeilenrand gerutscht
        # (`[[benennung-mixpibox-\ndrei-toepfe]]`); YAML faltet die Zeile zu
        # einem LEERZEICHEN, und das Muster sah den Verweis daraufhin GAR
        # NICHT. Die Wache meldete gruen, weil sie nichts fand — nicht, weil
        # nichts kaputt war. Genau die Bauart, vor der
        # `halbe-pruefung-meldet-wie-eine-ganze` warnt, eine Etage tiefer.
        #
        # Der Leerraum wird zu einem Bindestrich zurueckgefaltet, BEVOR
        # nachgeschlagen wird: so meldet die Wache den Verweis, den der
        # Schreiber GEMEINT hat, und nicht einen mit einem Loch darin.
        for roh_ziel in set(re.findall(r"\[\[([a-z0-9][a-z0-9\-\s]*)\]\]", roh)):
            ziel = re.sub(r"[\s-]+", "-", roh_ziel).strip("-")
            if ziel not in bekannt:
                befunde.append(f"{quelle}: Fliesstext [[{ziel}]] GIBT ES NICHT")
            elif ziel != roh_ziel:
                befunde.append(
                    f"{quelle}: Verweis [[{ziel}]] ist ueber den Zeilenrand gerutscht "
                    f"(gelesen als „{roh_ziel}“) — in EINE Zeile schreiben"
                )

    if not befunde:
        print("  keine toten Verweise" + (" (nur die genannten geprueft)" if nur_neu else ""))
        return 0
    print(f"  BEFUND: {len(befunde)}")
    for b in befunde:
        print(f"    - {b}")
    return 1


def main() -> int:
    argv = sys.argv[1:]
    pfad = STANDARD
    if "--pfad" in argv:
        pfad = Path(argv[argv.index("--pfad") + 1])
    nur_neu = None
    if "--nur-neu" in argv:
        nur_neu = set(argv[argv.index("--nur-neu") + 1 :])
        if not nur_neu:
            print(__doc__)
            return 2
    if not pfad.exists():
        print(f"  {pfad} gibt es nicht")
        return 2
    try:
        text = aus_index(pfad) if "--index" in argv else pfad.read_text(encoding="utf-8")
    except subprocess.CalledProcessError:
        print("  im Index liegt nichts (die Datei ist unveraendert oder nicht vorgemerkt)")
        return 2
    woher = "Index" if "--index" in argv else "Arbeitsbaum"
    print(f"── pack.yaml ({woher}) ─────────────────────────────────────")
    return pruefen(text, nur_neu)


if __name__ == "__main__":
    raise SystemExit(main())
