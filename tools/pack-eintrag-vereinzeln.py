#!/usr/bin/env python3
"""EINEN Pack-Eintrag in den Index legen — ohne die Eintraege der Nachbarsitzung.

══ WOZU ═══════════════════════════════════════════════════════════════════════
In diesem Baum laufen mehrere Sitzungen parallel, und `llmwiki/pack.yaml` ist
die Datei, in die sie alle schreiben. `tools/wiki-anhaengen.py` haengt den
eigenen Eintrag ans Dateiende und zaehlt `version:` hoch — im ARBEITSBAUM.
Steht dort schon der noch nicht committete Eintrag einer Nachbarsitzung, dann
nimmt ein schlichtes

    git add llmwiki/pack.yaml

deren halbfertige Arbeit mit in den eigenen Commit. Gemerkt wird das spaet:
kein Konflikt, kein Hinweis, und die Nachbarsitzung findet ihren Eintrag
plötzlich als „schon committet" vor, ohne ihn je abgegeben zu haben. Das ist
dieselbe Falle wie `git add -A`, nur INNERHALB einer Datei — und deshalb faengt
sie auch keine Pfadliste ab.

DIESES WERKZEUG LEGT IN DEN INDEX: HEAD-Stand + GENAU EINEN Eintrag, mit
`version:` um eins hoch. Der Arbeitsbaum bleibt unangetastet — die
Nachbarsitzung sieht danach ihren eigenen Eintrag weiterhin als ihre Aenderung,
sauber gegen den neuen HEAD.

══ AUFRUF ═════════════════════════════════════════════════════════════════════
    python3 tools/wiki-anhaengen.py eintrag.yaml     # erst anhaengen
    python3 tools/pack-eintrag-vereinzeln.py <id>    # dann vereinzeln
    git diff --cached llmwiki/pack.yaml              # und LESEN

DIE UMFANGSANGABEN GEHEN MIT. `README.md`, `dokumentation/mixpibox.md` und
`benutzerhandbuch.html` nennen Eintragszahl und Fassung; im Index muessen sie
zum INDEX-Stand des Packs passen, nicht zum Arbeitsbaum, der die Eintraege der
Nachbarsitzung mitzaehlt. Das erledigt dieses Werkzeug gleich mit — sonst
meldet `tools/paket-angaben-nachziehen.py --index` einen Drift, den man selbst
gerade erzeugt hat. Danach nachmessen:

    python3 tools/paket-angaben-nachziehen.py --index

Rueckgabe 0 = im Index, 1 = nichts getan (mit Grund).
"""

import importlib.util
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import yaml

WURZEL = Path(__file__).resolve().parent.parent
PACK = "llmwiki/pack.yaml"


def git(*args: str) -> str:
    fertig = subprocess.run(["git", "-C", str(WURZEL), *args], capture_output=True, text=True)
    if fertig.returncode != 0:
        raise SystemExit(f"  git {' '.join(args)} scheiterte:\n{fertig.stderr.strip()}")
    return fertig.stdout


def block_holen(text: str, kennung: str) -> str:
    """Der Textblock EINES Eintrags — woertlich, wie er in der Datei steht.

    NICHT UEBER DEN YAML-LADER: der schriebe beim Zurueckschreiben die ganze
    Datei neu (2,5 MB Diff, siehe den Kopf von `wiki-anhaengen.py`). Gesucht
    wird die Zeile mit dieser `id` auf Eintragsebene, von dort rueckwaerts bis
    zum `  - ` des Eintrags und vorwaerts bis zum naechsten.
    """
    zeilen = text.splitlines(keepends=True)
    treffer = [i for i, z in enumerate(zeilen) if re.match(rf"^\s+id:\s*{re.escape(kennung)}\s*$", z)]
    if not treffer:
        raise SystemExit(f"  `{kennung}` steht nicht im Arbeitsbaum-Pack. Erst anhaengen.")
    if len(treffer) > 1:
        raise SystemExit(f"  `{kennung}` steht {len(treffer)}-mal drin — von Hand nachsehen.")
    i = treffer[0]
    while i > 0 and not zeilen[i].startswith("  - "):
        i -= 1
    ende = i + 1
    while ende < len(zeilen) and not zeilen[ende].startswith("  - "):
        ende += 1
    return "".join(zeilen[i:ende])


def version_lesen(text: str) -> int:
    treffer = re.search(r'^version:\s*"(\d+)"', text, re.M)
    if not treffer:
        raise SystemExit("  Keine `version:`-Zeile im Pack gefunden.")
    return int(treffer.group(1))


def in_index_legen(pfad: str, alt: str, neu: str) -> None:
    """Einen Dateiinhalt UEBER EINEN FLICKEN in den Index legen.

    `git apply --cached` liest den Arbeitsbaum gar nicht an — genau darum geht
    es hier. Ein `git add` nach dem Umschreiben haette die fremden Aenderungen
    derselben Datei wieder eingesammelt.
    """
    with tempfile.TemporaryDirectory() as ordner:
        a, b = Path(ordner) / "alt", Path(ordner) / "jung"
        a.write_text(alt, encoding="utf-8")
        b.write_text(neu, encoding="utf-8")
        roh = subprocess.run(
            ["diff", "-u", "--label", f"a/{pfad}", "--label", f"b/{pfad}", str(a), str(b)],
            capture_output=True,
            text=True,
        )
        if roh.returncode == 0:
            return
        flicken = Path(ordner) / "flicken.patch"
        flicken.write_text(roh.stdout, encoding="utf-8")
        git("apply", "--cached", str(flicken))


def prosa_vereinzeln(zahl: int, fassung: int) -> None:
    """Die Umfangsangaben im INDEX auf den Index-Stand des Packs bringen.

    ══ WARUM DAS HIERHER GEHOERT UND NICHT IN DIE HAND DES AUFRUFERS ══════════
    Beim ersten Bau sagte dieses Werkzeug nur, WELCHE Zahl in den drei
    Prosadateien stehen muss — und genau daran ist der erste Lauf am
    05.09.2026 gescheitert: waehrend ich arbeitete, hing die Nachbarsitzung
    zwei weitere Eintraege an, der Arbeitsbaum sprang auf 979/490, und ein
    `git add README.md` legte diese Zahl neben ein Pack, das im Index 978/489
    war. `tools/paket-angaben-nachziehen.py --index` haette es beim naechsten
    Lauf gemeldet — eine Wache hinter dem Ereignis.

    DIE ZAHLEN KOMMEN AUS HEAD, NICHT AUS DEM BAUM: der Baum zaehlt die
    Eintraege der Nachbarsitzung mit, der Commit tut es nicht.

    DAS MUSTER WIRD NICHT NACHGEBAUT, sondern aus
    `tools/paket-angaben-nachziehen.py` geholt (`ANGABE`, `ist_kandidat`).
    Zwei Kopien einer Formulierung laufen auseinander, und dann faerbt das
    eine Werkzeug Stellen um, die das andere nicht kennt.
    """
    lader = importlib.util.spec_from_file_location(
        "paket_angaben_nachziehen", WURZEL / "tools" / "paket-angaben-nachziehen.py"
    )
    if lader is None or lader.loader is None:
        print("  WARNUNG: tools/paket-angaben-nachziehen.py nicht ladbar — Prosa NICHT gerichtet.")
        return
    modul = importlib.util.module_from_spec(lader)
    lader.loader.exec_module(modul)

    ersatz = rf"\g<vor>{zahl}\g<mitte>{fassung}"
    gerichtet = []
    for name in git("ls-files").splitlines():
        if not modul.ist_kandidat(name):
            continue
        alt = git("show", f"HEAD:{name}")
        neu, treffer = modul.ANGABE.subn(ersatz, alt)
        if treffer and neu != alt:
            in_index_legen(name, alt, neu)
            gerichtet.append(name)

    if not gerichtet:
        # KEIN GRUEN: findet das Muster nirgends etwas, ist entweder die Form
        # umgeschrieben oder HEAD nennt die Zahl schon richtig. Beides muss
        # dastehen, sonst haelt man das eine fuer das andere.
        print(f"  Keine Umfangsangabe zu richten — HEAD nennt bereits {zahl}/{fassung}?")
        return
    print(f"  Prosa im Index auf {zahl} Eintraege/Fassung {fassung}: {', '.join(gerichtet)}")


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] in ("-h", "--help"):
        print(__doc__)
        return 1
    kennung = sys.argv[1]

    kopf = git("show", f"HEAD:{PACK}")
    baum = (WURZEL / PACK).read_text(encoding="utf-8")

    if re.search(rf"^\s+id:\s*{re.escape(kennung)}\s*$", kopf, re.M):
        print(f"  `{kennung}` steht schon in HEAD — nichts zu tun.")
        return 1

    block = block_holen(baum, kennung)
    neu = re.sub(r'^version:\s*"\d+"', f'version: "{version_lesen(kopf) + 1}"', kopf, count=1, flags=re.M)
    if not neu.endswith("\n"):
        neu += "\n"
    neu += block

    # UEBER EINEN PATCH IN DEN INDEX, nicht ueber `git add`: `git apply --cached`
    # liest den Arbeitsbaum gar nicht an. Ein `add` nach dem Umschreiben der
    # Datei haette genau die fremden Eintraege wieder eingesammelt, um die es
    # hier geht — und den Arbeitsbaum der Nachbarsitzung beschaedigt.
    with tempfile.TemporaryDirectory() as ordner:
        alt, jung = Path(ordner) / "alt", Path(ordner) / "jung"
        alt.write_text(kopf, encoding="utf-8")
        jung.write_text(neu, encoding="utf-8")
        roh = subprocess.run(
            ["diff", "-u", "--label", f"a/{PACK}", "--label", f"b/{PACK}", str(alt), str(jung)],
            capture_output=True,
            text=True,
        )
        if roh.returncode == 0:
            print("  Kein Unterschied zu HEAD — nichts zu tun.")
            return 1
        flicken = Path(ordner) / "flicken.patch"
        flicken.write_text(roh.stdout, encoding="utf-8")
        git("apply", "--cached", str(flicken))

    # GEZAEHLT WIRD MIT DEM LADER, nicht mit einer Zeilensuche: ein Eintrag
    # beginnt mal mit `  - id:` und mal mit `  - kind:`, und `id:` steht auch
    # in manchem Fliesstext. Eine Regexzaehlung meldete beim ersten Lauf 544
    # statt 975 — eine Zahl, die in drei Prosadateien gewandert waere.
    zahl = len(yaml.safe_load(neu)["entries"])
    fassung = version_lesen(neu)
    print(f"  Im Index: HEAD + `{kennung}` — {zahl} Eintraege, Fassung {fassung}")
    prosa_vereinzeln(zahl, fassung)
    print("  Jetzt lesen:  git diff --cached llmwiki/pack.yaml")
    return 0


if __name__ == "__main__":
    sys.exit(main())
