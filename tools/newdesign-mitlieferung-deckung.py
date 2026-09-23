#!/usr/bin/env python3
"""NEWDESIGN-MITLIEFERUNG-DECKUNG — geht etwas auf die Box, das nur fuer den
Entwickler gedacht war? Und kopiert wirklich nur EIN Weg?

══ WARUM ES DAS GIBT (30.08.2026) ══════════════════════════════════════════

Der Kopierschritt nach `www/neu/` nimmt ALLES aus NewDesign/ mit; was nicht
mitsoll, muss einzeln in eine Ausschlussliste — von Hand, von dem, der gerade
nicht daran denkt. GEMESSEN am 30.08.2026 im lokalen Bau: drei
Werkstatt-Dateien lagen im ausgelieferten Buendel, eine davon trug im
eigenen Kopf den Satz „Wird von keinem Bau mitgenommen". Der Bau nahm sie
mit. Kein Schaden damals — aber `neu/` wird vom selben Server ausgeliefert
wie die Oberflaeche, und die naechste Datei dieser Art muss nicht harmlos
sein.

══ WAS SICH MIT E118/1b GEAENDERT HAT ══════════════════════════════════════

Bis dahin kopierte eine Asset-Regel in `src/frontend-box/angular.json`
(dem Bau der ALTEN Oberflaeche), und diese Probe las die ignore-Liste dort.
Seit E118/1b kopiert `tools/newdesign-kopieren.py` — die Auslieferung der
neuen Oberflaeche haengt nicht mehr an der alten App. Die Probe prueft
seitdem DREI Dinge:

  1. DECKUNG: jede Werkstatt-Datei in NewDesign/ ist von AUSSEN_VOR des
     Kopier-Werkzeugs gedeckt (die Liste wird per importlib GELADEN, nicht
     per Textsuche erraten — was das Werkzeug ausschliesst, prueft die Probe).
  2. EIN WEG: angular.json traegt KEINE NewDesign-Regel mehr. Zwei
     Kopierwege hiessen zwei Listen, und zwei Listen laufen auseinander.
  3. BEIDE RUFER: src/deploy.sh und tools/ausliefern.py rufen das Werkzeug
     wirklich (ausserhalb von Kommentarzeilen — ein zitierender Kommentar
     ist kein Aufruf, llmwiki: kommentar-und-kompilat-sind-keine-gegenstelle).

══ WORAUF DIE DECKUNG STEHT ════════════════════════════════════════════════

Auf der SORTE, nicht auf Namen von heute (llmwiki:
`doku-zeigt-auf-zeilen-die-wandern`). Die Box-Oberflaeche besteht aus
LAUFZEIT-SEITEN (index.html — und seit E118/1a spotify-anmeldung.html, die
server.ts unter /spotify ausliefert) mit ihren Skripten. Also gilt:

  * jede `*.html`, die keine Laufzeit-Seite ist  — Messseiten, Standalone
  * jede `*.md` an jedem Ort                     — Text fuer Menschen
  * jede `*.json`, die keine Laufzeit-Datei nennt

muss von AUSSEN_VOR gedeckt sein. Ist sie es nicht, geht sie mit.

══ WAS DIE PROBE NICHT SIEHT ═══════════════════════════════════════════════

BILDER NICHT. `bilder/quellen/` haelt 117 PNG — dieselbe Endung wie die
ausgelieferten PNG daneben; jede Namensregel meldete Dutzende richtige
Dateien als Fund und waere binnen einer Woche zu Recht ueberlesen (llmwiki:
`dauerrote-wache-ist-keine`). `bilder/quellen/**` steht deshalb in
AUSSEN_VOR und wird hier NICHT nachgehalten; wer die Bilderseite absichern
will, braucht eine eigene Probe gegen `tools/maskottchen-bauen.py`.

DER GEBAUTE BAUM ZAEHLT NICHT ALS BELEG. `src/deploy/` ist ein Erzeugnis
ebendieses Kopiervorgangs; dass eine Datei dort liegt, belegt den Fehler,
nicht seine Abwesenheit. Die Probe sieht in die Quelle NewDesign/, in das
Kopier-Werkzeug und in die Rufer.

Aufruf aus dem Wurzelverzeichnis:  python3 tools/newdesign-mitlieferung-deckung.py
Rueckgabe: 0 = ein Weg, beide Rufer, nichts Fremdes geht mit; 1 = Befund.
"""

from __future__ import annotations

import importlib.util
import json
import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
QUELLE = WURZEL / "NewDesign"
WERKZEUG = WURZEL / "tools/newdesign-kopieren.py"
ALTPLAN = WURZEL / "src/frontend-box/angular.json"
RUFER = [WURZEL / "src/deploy.sh", WURZEL / "tools/ausliefern.py"]

# Die Laufzeit-Seiten der neuen Oberflaeche. index.html ist DIE Seite;
# spotify-anmeldung.html liefert server.ts unter /spotify aus (E118/1a).
SEITEN = {"index.html", "spotify-anmeldung.html"}


def werkzeug_laden():
    """AUSSEN_VOR und muster_regex aus dem Kopier-Werkzeug — geladen, nicht
    erraten. Faellt das Werkzeug oder die Liste weg, ist das ein Befund."""
    spec = importlib.util.spec_from_file_location("newdesign_kopieren", WERKZEUG)
    if spec is None or spec.loader is None:
        print(f"  WARNUNG: {WERKZEUG.relative_to(WURZEL)} laesst sich nicht laden")
        sys.exit(1)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    if not getattr(mod, "AUSSEN_VOR", None):
        print(f"  WARNUNG: AUSSEN_VOR fehlt oder ist leer in {WERKZEUG.relative_to(WURZEL)}")
        sys.exit(1)
    return mod


def alte_kopierregel_noch_da() -> bool:
    """Traegt angular.json wieder eine NewDesign-Regel? Dann kopieren ZWEI
    Wege mit ZWEI Listen — genau der Drift, den E118/1b beendet hat."""
    if not ALTPLAN.is_file():
        # Die alte App ist geloescht (E118/1e) — dann kann sie auch nicht
        # kopieren. Kein Befund.
        return False
    plan = json.loads(ALTPLAN.read_text(encoding="utf-8"))
    for projekt in plan.get("projects", {}).values():
        assets = projekt.get("architect", {}).get("build", {}).get("options", {}).get("assets", [])
        for eintrag in assets:
            if isinstance(eintrag, dict) and eintrag.get("input", "").rstrip("/").endswith("NewDesign"):
                return True
    return False


def rufer_ruft(datei: Path) -> bool:
    """Steht der Werkzeug-Aufruf in einer NICHT-Kommentarzeile? Python und
    Shell kommentieren beide mit #; das reicht fuer beide Rufer."""
    if not datei.is_file():
        return False
    for zeile in datei.read_text(encoding="utf-8", errors="replace").splitlines():
        if "newdesign-kopieren.py" in zeile and not zeile.lstrip().startswith("#"):
            return True
    return False


def laufzeit_json(mod) -> set[str]:
    """JSON-Dateien, die eine Laufzeit-Seite oder ihre Skripte wirklich
    nennen. apps.js ist seit 03.09.2026 das zweite Skript; die
    Anmeldeseite und ihr Logik-Modul (E118/1a) lesen mit, falls sie je
    eine JSON nennen."""
    dateien = [QUELLE / s for s in sorted(SEITEN)]
    dateien += [QUELLE / "app.js", QUELLE / "apps.js", QUELLE / "spotify-anmeldung-logik.mjs"]
    genannt = set()
    for datei in dateien:
        if not datei.exists():
            continue
        text = datei.read_text(encoding="utf-8", errors="replace")
        genannt.update(re.findall(r"[\w./-]+\.json", text))
    return {n.rsplit("/", 1)[-1] for n in genannt}


def werkstatt(mod) -> list[tuple[str, str]]:
    """Alles in NewDesign/, das kein Laufzeit-Baustein der Seiten ist."""
    json_der_seite = laufzeit_json(mod)
    funde = []
    for pfad in sorted(QUELLE.rglob("*")):
        if not pfad.is_file():
            continue
        rel = pfad.relative_to(QUELLE).as_posix()
        endung = pfad.suffix.lower()
        if endung == ".html" and rel not in SEITEN:
            funde.append((rel, "zweite Seite neben den Laufzeit-Seiten"))
        elif endung == ".md":
            funde.append((rel, "Text fuer Menschen"))
        elif endung == ".json" and pfad.name not in json_der_seite:
            funde.append((rel, "JSON, das keine Laufzeit-Datei nennt"))
    return funde


def main() -> int:
    if not QUELLE.is_dir():
        print(f"  WARNUNG: {QUELLE.relative_to(WURZEL)} fehlt")
        return 1

    mod = werkzeug_laden()
    rot = 0

    if alte_kopierregel_noch_da():
        print(f"  ZWEI WEGE: {ALTPLAN.relative_to(WURZEL)} traegt wieder eine NewDesign-Regel.")
        print("      Seit E118/1b kopiert NUR tools/newdesign-kopieren.py — die Regel dort entfernen.")
        rot += 1

    for rufer in RUFER:
        if not rufer_ruft(rufer):
            print(f"  KEIN RUFER: {rufer.relative_to(WURZEL)} ruft newdesign-kopieren.py nicht auf.")
            print("      Dieser Ausrollweg liefert die neue Oberflaeche dann nicht mehr aus.")
            rot += 1

    muster = [mod.muster_regex(m) for m in mod.AUSSEN_VOR]
    offen = [(rel, grund) for rel, grund in werkstatt(mod)
             if not any(m.match(rel) for m in muster)]
    for rel, grund in offen:
        print(f"  GEHT MIT: NewDesign/{rel} → www/neu/{rel}")
        print(f"      {grund}; steht in keinem Muster von AUSSEN_VOR")
    rot += len(offen)

    if not rot:
        print("Ein Kopierweg, beide Rufer rufen, nichts aus der Werkstatt geht mit.")
        return 0
    print(f"\n{rot} Befund(e).")
    print(f"      Abhilfe: AUSSEN_VOR in {WERKZEUG.relative_to(WURZEL)} bzw. die Rufer pruefen.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
