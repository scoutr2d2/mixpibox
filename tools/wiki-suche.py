#!/usr/bin/env python3
"""Im Wissenspaket suchen — nach id, Titel, Schlagwort (tags) oder Volltext.

`tools/wiki-schau.py` sagt, OB das Paket heil ist. Dieses Werkzeug sagt, WAS
darin steht. Es wurde gebaut, weil das Nachschlagen vor jedem Umbau der
teuerste Schritt ist, wenn man ihn mit `grep` auf eine 1,4-MB-YAML macht:
man findet die Zeile, aber nicht den Eintrag, zu dem sie gehoert.

AUFRUF
    python3 tools/wiki-suche.py --tag admin --tag gliederung
    python3 tools/wiki-suche.py --kind entscheidung --tag verwaltung
    python3 tools/wiki-suche.py --text "Unterseite"
    python3 tools/wiki-suche.py --id unterseiten-statt-sechzehn-reiter --lang

Ohne --lang werden nur id, kind, title und die ersten Zeilen des Koerpers
gezeigt; --lang gibt den ganzen Eintrag aus.
"""

import argparse
import os
import sys

try:
    import yaml
except ImportError:
    sys.exit("PyYAML fehlt: pip install pyyaml")

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
def _pack():
    hier = os.path.dirname(os.path.abspath(__file__))
    for k in (os.path.join(os.path.dirname(hier), "llmwiki", "pack.yaml"),
              "/home/achim/Downloads/llmwiki_mupibox/pack.yaml"):
        if os.path.exists(k):
            return k
    return os.path.join(os.path.dirname(hier), "llmwiki", "pack.yaml")


STANDARD = _pack()


def paket_laden(pfad):
    if os.path.isdir(pfad):
        pfad = os.path.join(pfad, "pack.yaml")
    with open(pfad, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def passt(eintrag, args):
    if args.id and eintrag.get("id") not in args.id:
        return False
    if args.kind and str(eintrag.get("kind", "")) not in args.kind:
        return False
    if args.tag:
        tags = [str(t).lower() for t in (eintrag.get("tags") or [])]
        for gesucht in args.tag:
            if gesucht.lower() not in tags:
                return False
    if args.text:
        heu = "\n".join(
            str(eintrag.get(k, "")) for k in ("id", "title", "body", "match", "source", "why", "fix")
        ).lower()
        for gesucht in args.text:
            if gesucht.lower() not in heu:
                return False
    return True


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--datei", default=STANDARD, help="pack.yaml oder Wiki-Verzeichnis")
    p.add_argument("--id", action="append", default=[], help="genaue id (mehrfach erlaubt)")
    p.add_argument("--kind", action="append", default=[], help="kind, z.B. entscheidung/falle/offen")
    p.add_argument("--tag", action="append", default=[], help="Schlagwort; mehrere = UND")
    p.add_argument("--text", action="append", default=[], help="Volltext; mehrere = UND")
    p.add_argument("--lang", action="store_true", help="ganzen Koerper ausgeben")
    p.add_argument("--zeilen", type=int, default=3, help="Koerperzeilen ohne --lang (Vorgabe 3)")
    args = p.parse_args()

    paket = paket_laden(args.datei)
    eintraege = paket.get("entries") or []
    treffer = [e for e in eintraege if isinstance(e, dict) and passt(e, args)]

    for e in treffer:
        print(f"── {e.get('id')}  [{e.get('kind')}]")
        if e.get("title"):
            print(f"   {e['title']}")
        if e.get("tags"):
            print(f"   tags: {', '.join(str(t) for t in e['tags'])}")
        if e.get("source"):
            print(f"   quelle: {e['source']}")
        koerper = str(e.get("body") or e.get("why") or "").rstrip()
        if koerper:
            zeilen = koerper.splitlines()
            zeige = zeilen if args.lang else zeilen[: args.zeilen]
            for z in zeige:
                print(f"   | {z}")
            if not args.lang and len(zeilen) > args.zeilen:
                print(f"   | … ({len(zeilen)} Zeilen; --lang zeigt alles)")
        print()

    print(f"{len(treffer)} von {len(eintraege)} Eintraegen.", file=sys.stderr)
    return 0 if treffer else 1


if __name__ == "__main__":
    sys.exit(main())
