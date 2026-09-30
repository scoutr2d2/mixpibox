#!/usr/bin/env python3
"""WERKZEUG-ZITATE IM CODE — gibt es das Werkzeug, mit dem ein Kommentar gemessen haben will?

WARUM ES DAS GIBT (29.09.2026): Vier Kritiker-Laeufe in Folge (AUDIT-2026-09-19
bis -28) fanden dieselbe Sorte Befund, und jedes Mal eine mehr: Kommentare, die
eine Zahl mit einem Werkzeug belegen, das es im Baum nicht gibt. In
NewDesign/app.js stand „GEMESSEN mit" einem Schau-Werkzeug, das nie jemand
eingecheckt hat; in app.css und index.html dreimal dasselbe mit einem
Schubladen-Messskript. Die Zahl daneben kann seitdem niemand nachrechnen —
der Leser tippt den Aufruf ab, bekommt „No such file", und weiss danach weder,
ob die Messung je stattfand, noch wie er sie wiederholt.

WARUM DER BEFUND WIEDERKAM: Keine Wache las Code-Kommentare.
`tools/doku-pfade-pruefen.py` stellt genau diese Frage — aber nur fuer PROSA
(jede getrackte `.md`, das Wissenspaket, das Benutzerhandbuch). Ein Kommentar
in app.js faellt durch dieses Netz, und derselbe Befund taucht im naechsten
Audit wieder auf (llmwiki: `wiederkehrender-befund-ist-ablauffehler`).

── WARUM EINE EIGENE WACHE UND NICHT doku-pfade-pruefen.py ERWEITERT ───────
Geprueft am 29.09.2026, und es spricht dreierlei dagegen:
  * Jene Wache prueft JEDEN Pfad unter jedem obersten Ordner. In Code stehen
    solche Pfade meist als ZEICHENKETTE, die etwas tut (`config/data.json`,
    `src/deploy/…`, npm-relative Pfade) — die Laufzeit- und Bauablage-Regeln
    dort sind fuer Prosa gebaut und meldeten hier Rauschen.
  * Sie wertet einen geloeschten Pfad in aktiver Doku als Luecke. In Code
    erzaehlen Dutzende Kommentare legitim, welches Werkzeug in welchem
    aufgegangen ist — dort waere das dauerrot, und zwar in Dateien, die
    niemand dafuer anfassen sollte (llmwiki: `dauerrote-wache-ist-keine`).
  * Nackte Namen (`…-schau.mjs` ohne `tools/`) kennt sie nicht.
Beide lesen dieselbe Wahrheit (`git ls-files`), beide lassen `.md` bei jener.

── WAS ALS PHANTOM GILT, UND WAS NICHT ─────────────────────────────────────
Die Trennlinie ist NACHRECHENBARKEIT, nicht Existenz:
  PHANTOM     weder im Index noch je in der Geschichte von HEAD, und der
              Kommentar sagt nicht selbst, dass es nie eingecheckt wurde.
              Niemand kann die Zahl daneben nachrechnen. -> LUECKE.
  GESCHICHTE  war einmal eingecheckt und ist geloescht. `git log -- <pfad>`
              findet es, die Messung ist wiederholbar. Gezaehlt, nicht rot.
  EHRLICH     der Kommentar sagt in derselben oder den zwei Zeilen daneben
              „nie eingecheckt" / „nie in den Baum" — dann behauptet er
              nichts, was ein Leser abtippen koennte. Gezaehlt, nicht rot.
  ARBEITSBAUM liegt da, ist aber nicht im Index: gleich committen oder das
              Zitat ist morgen ein Phantom. Gemeldet, nicht rot — sonst waere
              jede halbfertige Nachbarsitzung ein Befund dieser Wache.
  PLATZHALTER `x.py`, `tools/box/y.sh` — Beispiele in Erklaertexten.
  BAUABLAGE   `.gitignore` fuehrt den Ort (von einem Werkzeug erzeugt).
Der INDEX und nicht der Arbeitsbaum ist die Wahrheit: was zusammen mit dem
Kommentar gestaged ist, zaehlt; was nur daneben liegt, nicht.

── WAS SIE LIEST ───────────────────────────────────────────────────────────
Code in `NewDesign/`, `src/` (nur `.ts`, ohne `src/deploy/`), `plugins/`,
`tools/`, `desktop/` und `handy-app/` (auch `.dart`) — verfolgt UND neu (die neue Datei ist die, in der eine Sitzung aus
dem Gedaechtnis zitiert). Kommentar und Code werden NICHT getrennt: in einer
`.py` ist der Docstring der Kommentar, und ein `print()` mit einem Aufruf
darin ist Doku (AGENTS.md, Schritt 5). Beides wird abgetippt.
Kompilate bleiben draussen: `src/deploy/` ausdruecklich, alles Uebrige, was
ein Bau erzeugt, ueber `--exclude-standard` (llmwiki:
`kommentar-und-kompilat-sind-keine-gegenstelle`).

RIEGEL gegen die leere Zielmenge: Jeder der sechs Bereiche muss mindestens eine
Quelldatei liefern, und es muss mindestens ein Zitat gefunden werden — sonst
ist die Wache blind, nicht sauber (Ausgang 2).

Aufruf aus dem Wurzelverzeichnis:  python3 tools/werkzeug-zitate-pruefen.py
Gegenproben (nur im Speicher):     python3 tools/werkzeug-zitate-pruefen.py --sabotage
                                   python3 tools/werkzeug-zitate-pruefen.py --sabotage-blind
Rueckgabe: 0 = keine Luecke, 1 = mindestens eine, 2 = Wache blind.
"""

import os
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
os.chdir(WURZEL)
ICH = "tools/werkzeug-zitate-pruefen.py"

# Die vier Bereiche und was darin Code ist. `.md` fehlt ueberall mit Absicht:
# Prosa ist das Revier von doku-pfade-pruefen.py — zwei Wachen auf derselben
# Datei geben verschiedene Antworten
# (llmwiki: `zwei-wachen-eine-datei-verschiedene-antwort`).
CODE = (".js", ".mjs", ".cjs", ".ts", ".mts", ".css", ".html", ".py", ".sh")
BEREICHE = {
    "NewDesign": lambda p: p.startswith("NewDesign/") and p.endswith(CODE),
    "src": lambda p: p.startswith("src/") and not p.startswith("src/deploy/") and p.endswith((".ts", ".mts")),
    "plugins": lambda p: p.startswith("plugins/") and p.endswith(CODE),
    "tools": lambda p: p.startswith("tools/") and p.endswith(CODE),
    # Ueber den Auftrag hinaus, weil das Audit vom 28.09. das fuenfte Phantom
    # „aus der Gestalter-/Handy-Welle" meldete: deren Code liegt auch hier.
    # Beim Einhaengen (29.09.2026) null Funde in beiden.
    "desktop": lambda p: p.startswith("desktop/") and p.endswith(CODE),
    "handy-app": lambda p: p.startswith("handy-app/") and p.endswith(CODE + (".dart",)),
}

ENDUNG = r"(?:py|mjs|sh|js|ts|cjs)"
# Ein Zitat mit `tools/`. Der Blick zurueck verbietet `/` davor — ein
# `/home/dietpi/…/tools/x.py` ist ein Pfad AUF DER BOX. Ein Praefix wie
# `remote-step-installer/` bleibt Teil des Pfads: dessen `tools/` ist ein
# anderer Ordner.
ZITAT = re.compile(
    r"(?<![\w./-])((?:\.\.?/)*(?:[\w][\w.-]*/)*tools/(?:[\w-]+/)*[\w][\w.-]*\." + ENDUNG + r")(?![\w-])"
)
# Ein NACKTER Name, nur in den Formen, die in diesem Baum Werkzeuge sind. `.js`
# fehlt mit Absicht: `mess-sonde.js` ist eine Datei, die ein Werkzeug AUF DER
# BOX anlegt, kein Werkzeug im Baum.
NACKT = re.compile(
    r"(?<![\w/.-])([a-z0-9][a-z0-9-]*-(?:schau|messen|pruefen|probe|deckung|inventur|abgleich|sonde)\.(?:mjs|py|sh))(?![\w-])"
)
# `x.py`, `tools/box/y.sh`, `tools/e2e/x.test.mjs` — Beispiele in Erklaertexten.
PLATZHALTER = re.compile(r"^[xyz]{1,3}(?:\.test)?$")
# Was ein Kommentar sagt, der ehrlich ist. Zwei Zeilen Umkreis, weil ein
# umbrochener Satz das Merkmal eine Zeile tiefer traegt.
EHRLICH = re.compile(r"nie\s+(?:eingecheckt|committet|in\s+den\s+Baum|im\s+Baum)", re.I)

# ── AUSNAHMEN JE QUELLE, JE NAME — MIT GRUND, UND MIT RUECKWAERTSPRUEFUNG ──
# Dieselbe Bauart wie AUSNAHMEN_JE_QUELLE in doku-pfade-pruefen.py: eine
# Datei darf den Namen nennen, dessen Fehlen sie BESCHREIBT, und nur diesen.
# Steht er anderswo, meldet die Wache weiter. Und umgekehrt: verschwindet die
# Nennung, meldet die Wache die Ausnahme als erledigt — sonst waechst die Liste
# still zu einem Loch (Vorbild: menue-schalter-deckung.py, NUR_AM_GERAET).
AUSNAHMEN = {
    # Die Gegenprobe-Attrappe der Pfadwache heisst so, damit es sie nie gibt.
    ("tools/doku-pfade-pruefen.py", "gibt-es-nicht-wirklich.py"): "Gegenprobe-Attrappe jener Wache",
    # Ein Vorschlag aus AUDIT-2026-08-26, nie gebaut; die Wache fuehrt ihn als
    # Ausnahme, weil ein Wiki-Eintrag ihn woertlich nennt.
    ("tools/doku-pfade-pruefen.py", "wachen_lib.py"): "Vorschlag aus einem Audit, in jener Ausnahmeliste",
    # E71/A3 schlug den Namen vor, gebaut wurde tools/ungerufene-wachen.py.
    ("tools/doku-pfade-pruefen.py", "werkzeug-inventur.py"): "Vorschlag, unter anderem Namen gebaut",
    ("tools/ungerufene-wachen.py", "werkzeug-inventur.py"): "zitiert die Ausnahmeliste der Pfadwache als Beispiel",
    # Und diese Datei selbst: die zwei Zeilen darueber MUESSEN die Namen
    # nennen, die sie ausnehmen. Je Name, nicht pauschal fuer die Datei — der
    # Kopf oben umschreibt seine Funde deshalb, statt sie zu zitieren, und die
    # Gegenprobe wird aus Stuecken gebaut (siehe SABOTAGE_NAME).
    (ICH, "werkzeug-inventur.py"): "die Ausnahmezeilen darueber",
    (ICH, "wachen-ohne-probe.py"): "die Ausnahmezeile darueber",
}

# Die Gegenprobe steht IM BAUM, und diese Wache liest den Baum — auch sich
# selbst. Zusammengesetzt erst zur Laufzeit, sonst meldete sie ihre eigene
# Attrappe (llmwiki: `gegenprobe-der-baumweiten-wache-liegt-im-baum`).
SABOTAGE_NAME = "werkzeug-das-es-nie-gab" + "-schau" + ".mjs"


def _git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout


def _liste(*args):
    return [p for p in _git("ls-files", "-z", *args).split("\0") if p]


def geschichte():
    """Jeder Pfad, den die HAUPTLINIE je beruehrt hat — beide Seiten jeder Umbenennung.

    `--first-parent` IST NICHT ZIERAT (29.09.2026 gemessen): `remote-step-
    installer/` und `llmwiki/` sind am 10.08.2026 per `git subtree` samt ihrer
    Geschichte hereingekommen, und in DER lag `tools/qr.py` noch an der
    Wurzel ihres eigenen Repos. Ohne den Schalter galt ein `tools/qr.py`
    hier als „geloescht, nachrechenbar" — dabei hat es diesen Pfad in diesem
    Baum nie gegeben (es ist `remote-step-installer/tools/qr.py`).
    """
    return {
        z
        for z in _git("log", "--first-parent", "--no-renames", "--format=", "--name-only", "HEAD").splitlines()
        if z
    }


_ignoriert = {}


def bauablage(p):
    if p not in _ignoriert:
        _ignoriert[p] = subprocess.run(["git", "check-ignore", "-q", "--", p], capture_output=True).returncode == 0
    return _ignoriert[p]


def normal(p):
    """`../tools/x` und `MuPiBox/tools/x` meinen `tools/x`."""
    while p.startswith(("./", "../")):
        p = p.split("/", 1)[1]
    i = p.find("tools/")
    if i > 0 and not os.path.isdir(p[:i]):
        p = p[i:]
    return p


def main():
    sabotage = "--sabotage" in sys.argv
    blind = "--sabotage-blind" in sys.argv

    index = set(_liste("--cached"))
    neu = set(_liste("--others", "--exclude-standard"))
    alt = geschichte()
    basen_index = {os.path.basename(p) for p in index}
    basen_neu = {os.path.basename(p) for p in neu}
    basen_alt = {os.path.basename(p) for p in alt}

    quellen = defaultdict(list)
    for p in sorted(index | neu):
        for name, passt in BEREICHE.items():
            if passt(p) and os.path.isfile(p):
                quellen[name].append(p)
    if blind:
        # GEGENPROBE: ein Bereich faellt aus der Ableitung — die Wache muss
        # das merken, statt ueber drei Bereiche gruen zu melden.
        quellen["NewDesign"] = []

    print(
        "── "
        + ", ".join(f"{n} {len(quellen[n])}" for n in BEREICHE)
        + " Quelldateien gelesen (Code, verfolgt und neu; ohne src/deploy/, ohne .md) ──"
    )
    blinde = [n for n in BEREICHE if not quellen[n]]
    for n in blinde:
        print(f"  WARNUNG: Bereich {n}/ lieferte KEINE Quelldatei — git ls-files oder die Endungen geaendert?")
    if blinde:
        return 2

    zaehler = defaultdict(int)
    phantome = defaultdict(list)
    bekannt_gesehen = set()
    geloescht = defaultdict(set)
    nur_hier = defaultdict(set)
    anderswo = defaultdict(set)

    for bereich in BEREICHE:
        for q in quellen[bereich]:
            try:
                text = Path(q).read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            if sabotage and q == "NewDesign/app.js":
                # GEGENPROBE: ein Kommentar, der mit einem Werkzeug belegt, das
                # es nie gab. Nur im Speicher, nichts wird geschrieben.
                text += f"\n// GEMESSEN mit tools/{SABOTAGE_NAME}: 42 von 42.\n"
            if "tools/" not in text and not NACKT.search(text):
                continue
            zeilen = text.splitlines()
            funde = [(m, True) for m in ZITAT.finditer(text)] + [(m, False) for m in NACKT.finditer(text)]
            for m, mit_pfad in funde:
                roh = m.group(1)
                p = normal(roh) if mit_pfad else roh
                name = os.path.basename(p)
                stamm = re.sub(r"\.\w+$", "", name)
                nr = text.count("\n", 0, m.start()) + 1
                zaehler["zitate"] += 1
                if (p in index) if mit_pfad else (name in basen_index):
                    zaehler["vorhanden"] += 1
                    continue
                if PLATZHALTER.match(stamm):
                    zaehler["platzhalter"] += 1
                    continue
                if mit_pfad and bauablage(p):
                    zaehler["bauablage"] += 1
                    continue
                # ANDERER ORT: `tools/x` gibt es nicht, ein `x` liegt aber
                # anderswo im Index (meist `remote-step-installer/tools/`,
                # Umzug vom 10.08.2026). In Code haengt der Ordner oft an
                # einer Variablen (`INSTALLER / 'tools/…'`), die das Muster
                # nicht sieht — rot waere dort Rauschen. Das Werkzeug GIBT
                # es, die Zahl ist nachrechenbar; gemeldet wird es trotzdem.
                if mit_pfad and name in basen_index:
                    anderswo[p].add(f"{q}:{nr}")
                    continue
                if (p in neu) if mit_pfad else (name in basen_neu):
                    nur_hier[p].add(f"{q}:{nr}")
                    continue
                if (p in alt) if mit_pfad else (name in basen_alt):
                    geloescht[p].add(q)
                    continue
                umkreis = "\n".join(zeilen[max(0, nr - 3) : nr + 2])
                if EHRLICH.search(umkreis):
                    zaehler["ehrlich"] += 1
                    continue
                if (q, name) in AUSNAHMEN:
                    bekannt_gesehen.add((q, name))
                    continue
                phantome[p].append(f"{q}:{nr}")

    luecken = 0
    print("── Zitierte Werkzeuge, die es nie im Baum gab (niemand kann die Zahl daneben nachrechnen) ──")
    for p in sorted(phantome):
        orte = phantome[p]
        print(f"  PHANTOM: {p}   ({', '.join(orte[:4])}{' …' if len(orte) > 4 else ''})")
        luecken += 1
    for (q, name), grund in sorted(AUSNAHMEN.items()):
        if (q, name) in bekannt_gesehen:
            if grund.startswith("OFFEN"):
                print(f"  BEKANNT: {name} in {q} — {grund}")
        else:
            print(f"  ERLEDIGTE AUSNAHME: {name} in {q} steht dort nicht mehr — die Zeile in AUSNAHMEN streichen")
            luecken += 1
    if anderswo:
        print("── Nicht unter diesem Pfad, aber gleichnamig anderswo im Index (Ordner im Zitat pruefen) ──")
        for p in sorted(anderswo):
            print(f"  ANDERER ORT: {p}   ({', '.join(sorted(anderswo[p])[:2])})")
    if nur_hier:
        print("── Nur im Arbeitsbaum, nicht im Index (mit dem Zitat zusammen committen) ──")
        for p in sorted(nur_hier):
            print(f"  NUR HIER: {p}   ({', '.join(sorted(nur_hier[p])[:2])})")

    if zaehler["zitate"] == 0:
        print("  WARNUNG: kein einziges Werkzeug-Zitat gefunden — Muster oder Schreibweise geaendert?")
        return 2
    print(
        f"  {zaehler['zitate']} Zitate: {zaehler['vorhanden']} vorhanden, {len(geloescht)} geloeschte Werkzeuge "
        f"(Geschichte, per git log nachrechenbar), {zaehler['ehrlich']} ehrlich als nie eingecheckt markiert, "
        f"{zaehler['platzhalter']} Platzhalter, {zaehler['bauablage']} Bauablage, {len(anderswo)} an anderem Ort, "
        f"{len(nur_hier)} nur im Arbeitsbaum."
    )
    if "--geschichte" in sys.argv:
        for p in sorted(geloescht):
            print(f"  GESCHICHTE: {p}   ({', '.join(sorted(geloescht[p])[:3])})")
    print()
    if luecken:
        print(f"{luecken} LUECKE(N).")
        return 1
    print("KEINE LUECKE.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
