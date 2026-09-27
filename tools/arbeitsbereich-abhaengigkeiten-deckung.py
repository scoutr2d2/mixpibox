#!/usr/bin/env python3
"""ARBEITSBEREICHS-ABHAENGIGKEITEN — welches Paket benutzt ein Bereich, ohne
dass er (oder die Wurzel) es deklariert?

WARUM ES DAS GIBT (29.08.2026): `390880f5` strich `karma-coverage` aus
`src/frontend-box/package.json` — voellig zu Recht, dessen `karma.conf.js`
laedt nur den istanbul-Reporter. Kaputt ging davon die **Verwaltung**: ihr
`ng test` startete nicht mehr. Sie hat gar keine `karma.conf.js`; der Angular-
Karma-Bauer erzeugt sich eine und laedt dabei fest `karma-jasmine`,
`karma-chrome-launcher`, `karma-jasmine-html-reporter` und `karma-coverage`
(`@angular/build/src/builders/karma/application_builder.js:604-606`). Bezogen
hatte sie diese Pakete nie selbst, sondern ueber das gemeinsame
Wurzel-`node_modules` aus der SCHWESTER.

**Ein Arbeitsbereich, der nichts deklariert, ist fuer jede Paket-Wache
unsichtbar.** `src/frontend-admin/package.json` fuehrte bis zum 25.09.2026
**null** Abhaengigkeiten — kein `@angular/core`, kein `rxjs`, kein `karma`.
Jede Inventur ueber `package.json` mass dort eine leere Menge und meldete
gruen; gebaut und getestet wurde trotzdem, weil npm alles in die Wurzel hebt.
Die Leihe faellt erst auf, wenn der Verleiher aufraeumt — und dann sieht es
aus wie ein Fehler im Aufraeumen, nicht wie ein Fehler in der Buchhaltung.
Genau so kam es: E118/1e (05.09.2026) loeschte den Verleiher samt
`package.json`, und ein frischer Klon hatte danach kein `ng` mehr. Seit dem
25.09.2026 deklariert die Verwaltung selbst (`dokumentation/mixpibox.md` 7.13).

WAS ALS DEKLARATION ZAEHLT: der eigene `package.json` des Bereichs ODER die
Wurzel. Bewusst NICHT der Schwesterbereich — genau das ist der Gegenstand.
Die Wurzel zaehlt mit, weil sie der Ort ist, an dem `ef946f34` das
`karma-coverage` untergebracht hat: geteiltes Werkzeug gehoert dorthin.

WAS ALS BENUTZUNG ZAEHLT, in zwei Sorten:

  1. Ein **blanker Import** in einer verfolgten Quelldatei des Bereichs
     (`import … from 'x'`, `require('x')`). Node-Bordmittel, `paths`-Aliase
     aus der eigenen `tsconfig.json` und Pfade unter dem Bereich selbst
     zaehlen nicht.
  2. Ein Paket, das der **Bauer stillschweigend voraussetzt**. Das ist die
     Sorte, die kein Grep findet: in `frontend-admin` steht `karma` in keiner
     einzigen Zeile Quelltext. Gemessen wird nur, was im Bauer als Literal
     steht (siehe oben), und nur fuer ein `:karma`-Ziel OHNE eigene
     `karmaConfig` — wer eine eigene Konfiguration mitbringt, faellt schon
     ueber Sorte 1 auf, denn dort stehen die `require()`.

AUSNAHME IN DER DOKU, NICHT IN DER WACHE: `dokumentation/mixpibox.md` fuehrt
zwischen `GELIEHENE-ABHAENGIGKEITEN:ANFANG` und `:ENDE` eine Tabelle der
hingenommenen Leihen. Die Wache liest sie und meldet solche Zeilen als
VERMERKT ([[dauerrote-wache-ist-keine]]) — der Befund ist offen, die
Aufraeumarbeit ist Arbeit am Bau und steht im `BACKLOG.md`. Damit muss die
Erklaerung dort stehen, wo sie jemand findet, der die `package.json` aufmacht;
loescht sie jemand, wird die Wache wieder rot.

UND DIE AUSNAHME WIRD IN DER GEGENRICHTUNG GEPRUEFT (`DOKU VERALTET`): wer
eine geliehene Abhaengigkeit endlich deklariert oder ihren letzten Nutzer
loescht, ohne die Tabelle nachzuziehen, faellt hier auf. Eine Ausnahmeliste,
die nur entschaerft, verrottet wie jede andere Zustandsaussage.

Aufruf:  python3 tools/arbeitsbereich-abhaengigkeiten-deckung.py
Rueckgabe: 0 = keine Luecke, 1 = mindestens eine.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
DOKU = WURZEL / "dokumentation" / "mixpibox.md"

MARKE_AUF = "GELIEHENE-ABHAENGIGKEITEN:ANFANG"
MARKE_ZU = "GELIEHENE-ABHAENGIGKEITEN:ENDE"

# Node-Bordmittel. Ein `import 'fs'` ist keine Abhaengigkeit, und `fs/promises`
# faellt ueber das erste Segment mit heraus.
BORDMITTEL = {
    "assert", "async_hooks", "buffer", "child_process", "cluster", "console",
    "constants", "crypto", "dgram", "diagnostics_channel", "dns", "domain",
    "events", "fs", "http", "http2", "https", "inspector", "module", "net",
    "os", "path", "perf_hooks", "process", "punycode", "querystring",
    "readline", "repl", "stream", "string_decoder", "sys", "timers", "tls",
    "tty", "url", "util", "v8", "vm", "worker_threads", "zlib",
}

# WAS DER ANGULAR-KARMA-BAUER OHNE EIGENE karma.conf FEST LAEDT. Die Liste ist
# NICHT geraten: sie steht als Literal in
# node_modules/@angular/build/src/builders/karma/application_builder.js:604-606
# (und gleichlautend im alten @angular-devkit/build-angular). `karma` selbst
# ist der Laeufer, ohne den das Ziel nicht startet.
BAUER_SETZT_VORAUS = {
    "@angular-devkit/build-angular:karma": [
        "karma",
        "karma-jasmine",
        "karma-chrome-launcher",
        "karma-jasmine-html-reporter",
        "karma-coverage",
    ],
    "@angular/build:karma": [
        "karma",
        "karma-jasmine",
        "karma-chrome-launcher",
        "karma-jasmine-html-reporter",
        "karma-coverage",
    ],
}

QUELLENDUNG = (".ts", ".tsx", ".js", ".mjs", ".cjs")

# KOMMENTARE ZAEHLEN NICHT. `freigabe.spec.ts` erklaert in seinem Kopf, warum
# dort KEIN `import { describe } from 'vitest'` steht — und zitiert dabei
# genau die Zeile, die es nicht gibt. Eine Wache, die das mitliest, meldet
# `vitest` als undeklarierte Abhaengigkeit und liegt damit doppelt daneben:
# das Paket ist nicht installiert, und die Datei benutzt es bewusst nicht.
# (Dieselbe Falle wie eine Probe, die ueber das eigene Zitat einer
# widerrufenen Aussage faellt.)
BLOCKKOMMENTAR = re.compile(r"/\*.*?\*/", re.S)
# `//` nur dann als Kommentar, wenn kein `:` davor steht — sonst schneidet die
# Wache jedes `'https://…'` mitten aus der Zeile.
ZEILENKOMMENTAR = re.compile(r"(?<!:)//[^\n]*")

# `import x from 'y'`, `import 'y'`, `export … from 'y'`, `require('y')`.
#
# EIN WEG, DER AUF `import` ENDET, IST KEIN IMPORT (25.09.2026). Mit dem
# Themen-Tausch kam `'/api/thema/import'` in Server, Spec und Verwaltung — und
# `import'` liest sich fuer `\bimport\s*['"]` wie `import 'paket'`: `\b` steht
# auch zwischen `/` und `i`. Gefangen wurde dann alles bis zum naechsten
# Anfuehrungszeichen, ueber Zeilen hinweg, und die Wache meldete acht
# „Pakete" wie `).send({ dokument }).expect(200)…`. Zwei Riegel: vor dem
# Schluesselwort darf kein `/` oder `.` stehen, und ein Modulname enthaelt
# keinen Zeilenumbruch.
IMPORT = re.compile(
    r"""(?<![./])(?:\bimport\b[^;'"\n]*?\bfrom\s*|\bexport\b[^;'"\n]*?\bfrom\s*|"""
    r"""\bimport\s*|\brequire\s*\(\s*)['"]([^'"\n]+)['"]"""
)


def verfolgte_dateien():
    """git ls-files fragen, nicht die Platte — auf der Arbeitsmaschine liegt
    Ruecklass herum, und eine Wache, die ihn mitliest, misst einen Baum, den
    kein anderer hat."""
    aus = subprocess.run(
        ["git", "-C", str(WURZEL), "ls-files"], capture_output=True, text=True
    )
    return [z for z in aus.stdout.splitlines() if z]


def paketname(spez: str):
    """'@scope/paket/unter/pfad' -> '@scope/paket', 'paket/x' -> 'paket'."""
    if not spez or spez[0] in "./" or spez.startswith("node:"):
        return None
    teile = spez.split("/")
    if spez.startswith("@"):
        return "/".join(teile[:2]) if len(teile) >= 2 else None
    return teile[0]


def deklariert(pfad: Path):
    if not pfad.exists():
        return set(), None
    p = json.loads(pfad.read_text(encoding="utf-8"))
    d = set()
    for feld in ("dependencies", "devDependencies", "optionalDependencies"):
        d |= set(p.get(feld, {}))
    return d, p


def bereiche(wurzelpaket):
    """Die Bereichsordner aus `workspaces` der Wurzel — nicht aus einer
    Kopie der Liste hier."""
    muster = wurzelpaket.get("workspaces", [])
    gefunden = []
    for m in muster:
        for kandidat in sorted(WURZEL.glob(m)):
            if (kandidat / "package.json").is_file():
                gefunden.append(kandidat.relative_to(WURZEL).as_posix())
    return gefunden


def aliase(bereich: str):
    """`paths` aus der tsconfig des Bereichs — deren Praefixe sind keine
    Pakete. Zusaetzlich die obersten Ordner des Bereichs, weil ein `baseUrl`
    Importe wie `src/app/x` erlaubt."""
    praefixe = set()
    for name in ("tsconfig.json", "tsconfig.app.json", "tsconfig.spec.json"):
        p = WURZEL / bereich / name
        if not p.is_file():
            continue
        # JSON mit Kommentaren: die Zeilenkommentare wegnehmen, sonst wirft json.
        roh = re.sub(r"^\s*//.*$", "", p.read_text(encoding="utf-8"), flags=re.M)
        try:
            cfg = json.loads(roh)
        except json.JSONDecodeError:
            continue
        for schluessel in (cfg.get("compilerOptions", {}) or {}).get("paths", {}):
            # `@backend-api/*` -> Praefix `@backend-api`. Der Alias sieht aus
            # wie ein Scope-Paket (`@scope/name`), ist aber keines — deshalb
            # wird das erste Segment verglichen, nicht der ganze Paketname.
            praefixe.add(schluessel.split("/")[0])
    for kind in (WURZEL / bereich).iterdir():
        if kind.is_dir() and kind.name != "node_modules":
            praefixe.add(kind.name)
    return praefixe


def benutzt(bereich: str, dateien):
    """Sorte 1: blanke Importe im Quelltext des Bereichs."""
    weg = aliase(bereich)
    treffer = {}
    for f in dateien:
        if not f.startswith(bereich + "/") or not f.endswith(QUELLENDUNG):
            continue
        try:
            text = (WURZEL / f).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        text = ZEILENKOMMENTAR.sub("", BLOCKKOMMENTAR.sub("", text))
        for spez in IMPORT.findall(text):
            name = paketname(spez)
            if not name or name in BORDMITTEL or name in weg:
                continue
            if name.split("/")[0] in weg:
                continue
            treffer.setdefault(name, f)
    return treffer


def bauer_voraussetzungen(bereich: str):
    """Sorte 2: was der Bauer laedt, ohne dass es im Quelltext steht."""
    ang = WURZEL / bereich / "angular.json"
    if not ang.is_file():
        return {}
    cfg = json.loads(ang.read_text(encoding="utf-8"))
    treffer = {}
    for projekt in (cfg.get("projects", {}) or {}).values():
        for zielname, ziel in (projekt.get("architect", {}) or {}).items():
            bauer = ziel.get("builder", "")
            if bauer not in BAUER_SETZT_VORAUS:
                continue
            # Eine EIGENE karma.conf bringt ihre Plugins per require() mit —
            # die faellt schon ueber Sorte 1 auf, hier waere sie doppelt.
            if (ziel.get("options", {}) or {}).get("karmaConfig"):
                continue
            # Der Bauer selbst ist die erste Voraussetzung: `angular.json`
            # nennt ihn als `paket:ziel`, und ohne das Paket startet nichts.
            for paket in [bauer.split(":", 1)[0], *BAUER_SETZT_VORAUS[bauer]]:
                treffer.setdefault(paket, f"{bereich}/angular.json ({zielname}: {bauer})")
    return treffer


def skript_werkzeuge(bereich: str):
    """Sorte 3: das Werkzeug, das ein npm-Skript aufruft. `ng build` braucht
    `@angular/cli`, und auch das steht in keiner Zeile Quelltext. Bewusst eine
    kurze, hier gefuehrte Zuordnung statt einer Aufloesung ueber
    `node_modules/.bin` — dort liegt, was die Wurzel geholt hat, nicht das,
    was der Bereich fordert; eine Wache, die sich am Installationsstand misst,
    misst das Ergebnis der Leihe statt der Leihe."""
    zuordnung = {"ng": "@angular/cli", "tsc": "typescript", "biome": "@biomejs/biome"}
    p = WURZEL / bereich / "package.json"
    if not p.is_file():
        return {}
    skripte = json.loads(p.read_text(encoding="utf-8")).get("scripts", {}) or {}
    treffer = {}
    for name, befehl in skripte.items():
        for wort in re.findall(r"[\w@/.-]+", befehl):
            if wort in zuordnung:
                treffer.setdefault(zuordnung[wort], f"{bereich}/package.json (scripts.{name}: {wort})")
    return treffer


def vermerkte():
    """Die hingenommenen Leihen aus der Doku: | `paket` | `bereich` | grund |"""
    if not DOKU.is_file():
        return None
    text = DOKU.read_text(encoding="utf-8")
    if MARKE_AUF not in text or MARKE_ZU not in text:
        return None
    block = text.split(MARKE_AUF, 1)[1].split(MARKE_ZU, 1)[0]
    eintraege = set()
    for zeile in block.splitlines():
        m = re.match(r"\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|", zeile)
        if m:
            eintraege.add((m.group(2), m.group(1)))
    return eintraege


def main():
    wurzel_deps, wurzelpaket = deklariert(WURZEL / "package.json")
    if wurzelpaket is None:
        print("WARNUNG: keine package.json in der Wurzel — hat sich der Baum geaendert?")
        return 1
    liste = bereiche(wurzelpaket)
    if not liste:
        print("WARNUNG: kein Arbeitsbereich gefunden — steht `workspaces` noch da?")
        return 1

    dateien = verfolgte_dateien()
    eigen = {b: deklariert(WURZEL / b / "package.json")[0] for b in liste}

    offen = vermerkte()
    if offen is None:
        print(f"WARNUNG: die Ausnahmetabelle fehlt in {DOKU.relative_to(WURZEL)}")
        print(f"         (Marken {MARKE_AUF} / {MARKE_ZU})")
        return 1

    luecken = 0
    gesehen = set()
    for b in liste:
        gebraucht = benutzt(b, dateien)
        for quelle in (bauer_voraussetzungen(b), skript_werkzeuge(b)):
            for paket, wo in quelle.items():
                gebraucht.setdefault(paket, wo)
        for paket in sorted(gebraucht):
            if paket in eigen[b] or paket in wurzel_deps or paket == b.split("/")[-1]:
                continue
            # Der eigene Paketname steht als `name` in der package.json, nicht
            # als Ordner — deshalb hier nochmal ueber den echten Namen.
            eigener_name = json.loads(
                (WURZEL / b / "package.json").read_text(encoding="utf-8")
            ).get("name")
            if paket == eigener_name:
                continue
            verleiher = [a for a in liste if a != b and paket in eigen[a]]
            gesehen.add((b, paket))
            if (b, paket) in offen:
                print(f"  VERMERKT: {b} leiht `{paket}` ({gebraucht[paket]})")
                continue
            if verleiher:
                print(f"  GELIEHEN: {b} benutzt `{paket}`, deklariert wird es nur in "
                      f"{', '.join(verleiher)} — {gebraucht[paket]}")
            else:
                print(f"  NIRGENDS DEKLARIERT: {b} benutzt `{paket}` — {gebraucht[paket]}")
            luecken += 1

    for b, paket in sorted(offen - gesehen):
        print(f"  DOKU VERALTET: die Tabelle fuehrt `{paket}` als Leihe von {b} — "
              f"der Bereich leiht es nicht (mehr)")
        luecken += 1

    print()
    if luecken == 0:
        print("KEINE LUECKE.")
        return 0
    print(f"{luecken} LUECKE(N).")
    return 1


if __name__ == "__main__":
    sys.exit(main())
