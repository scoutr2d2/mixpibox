#!/usr/bin/env python3
"""ENTWICKLERABBILD — die Bauanleitung des Codespace gegen den Baum.

WARUM ES DAS GIBT (27.08.2026): `.devcontainer/` ist die **siebte Sorte
Datei**, die keine Wache liest. Die Reihe davor: die Bauanleitung
(`Dockerfile`, 24.08.), die Momentaufnahme (Analyse-MDs, 26.08.), das
Urteil (`.github/workflows/ci.yml`, 26.08.), das Simulationsrezept
(`harness/`, 26.08.). Jedes Mal derselbe Bau: eine Datei, die ein MENSCH
zuerst anfasst, und die keine der Proben je aufschlug.

`tools/abbild-pfade-pruefen.py` sieht sie ausdruecklich nicht — es haelt
`ABBILD = WURZEL / "Dockerfile"` fest, also die Wurzel-Bauanleitung. Im
ganzen `tools/`-Verzeichnis nannte am 27.08.2026 **kein einziges** Werkzeug
das Wort `devcontainer`. Wer den Codespace-Weg geht, geht ihn ungeprueft.

DER FALL, DER SIE AUSGELOEST HAT: `BACKLOG.md` A4b meldet seit dem
26.08.2026, `.devcontainer/` provisioniere den mit E47 ausgebauten
PHP-Stack — ausdruecklich **„nicht nachgemessen"**. Genau die Sorte Satz,
die liegenbleibt (llmwiki `aufraeumen-nachmessen`). Diese Wache misst ihn:
`features/php:1` + `installComposer` + `devsense.phptools-vscode` gegen
**null** `.php` und **null** `composer.json` im versionierten Baum.
Nachgemessen ist damit die BEHAUPTUNG, nicht der Bau — es wird weiterhin
kein Container gebaut.

WAS GEPRUEFT WIRD (jedes zaehlt als Luecke):

  1. jede Quelle eines `COPY` in `.devcontainer/Dockerfile` liegt wirklich
     im Bau-Kontext. Dieselbe Bauart, die die Wurzel-`Dockerfile` seit dem
     23.10.2024 abbrechen laesst — dort fand sie niemand 22 Monate lang.
  2. jedes Sprach-Feature aus `devcontainer.json` hat im Baum ueberhaupt
     etwas zu tun. Ein Feature, dessen Sprache im Baum nicht mehr
     vorkommt, baut Minuten in jeden Start, die niemandem gehoeren.
  3. jede VS-Code-Erweiterung, die an einer Sprache haengt, hat diese
     Sprache im Baum.

Gezaehlt wird der VERSIONIERTE Baum (`git ls-files`), nicht das
Arbeitsverzeichnis: ein unversioniertes `vendor/` oder ein Fund aus
`node_modules/` faelscht die Antwort sonst in beide Richtungen.

WAS ES NICHT TUT: es ruft weder `docker` noch `devcontainer` auf, baut
nichts und aendert nichts. Es liest `.devcontainer/` und `BACKLOG.md`.

DAUERROT IST KEINE WACHE (llmwiki `dauerrote-wache-ist-keine`): das
PHP-Feature zu streichen ist Arbeit AM BAU, nicht an der Doku. Die
Ausnahme wohnt darum im `BACKLOG.md` unter `#### A4b`, dort wo sie findet,
wer sie abarbeiten soll — und gilt in BEIDE Richtungen: ist nichts mehr
ueberfluessig, meldet die Wache `BACKLOG VERALTET`.

Findet die Wache gar kein Feature oder kein `COPY`, meldet sie FEHLER statt
gruen — eine Wache, die eine Umbenennung ueberlebt, ist keine (llmwiki
`gegenprobe-statt-gruen-glauben`).

Aufruf aus dem Wurzelverzeichnis:  python3 tools/entwicklerabbild-pruefen.py
Rueckgabe: 0 = keine Luecke, 1 = mindestens eine, 2 = die Wache selbst blind.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
ORDNER = WURZEL / ".devcontainer"
REZEPT = ORDNER / "devcontainer.json"
ABBILD = ORDNER / "Dockerfile"
BACKLOG = WURZEL / "BACKLOG.md"

# Der Abschnitt, in dem ein bekannter Fund angemeldet ist. Die Wache haengt
# am Namen des Abschnitts, nicht an seiner Zeilennummer — der Backlog waechst.
ANMELDUNG = "A4b"

# Welches Feature welche Sprache in den Container zieht, und woran man im
# Baum sieht, dass die Sprache noch vorkommt. Bewusst KURZ gehalten: nur
# Features, deren Sprache sich an einer Dateiendung ablesen laesst. Alles
# andere (sshd, git, docker-in-docker) ist Werkzeug ohne Spur im Baum und
# wird nicht geraten.
SPRACHEN = {
    "php": (["*.php"], "PHP"),
    "python": (["*.py"], "Python"),
    "node": (["*.ts", "*.js", "*.mjs"], "Node"),
    "java": (["*.java"], "Java"),
    "go": (["*.go"], "Go"),
    "ruby": (["*.rb"], "Ruby"),
    "rust": (["*.rs"], "Rust"),
    "dotnet": (["*.cs"], ".NET"),
}

# Erweiterungen, die an genau einer Sprache haengen. Eine Erweiterung, die
# fuer mehrere Sprachen taugt (GitLens, Biome), steht hier absichtlich nicht.
ERWEITERUNGEN = {
    "devsense.phptools-vscode": "php",
    "Angular.ng-template": "node",
    "ms-python.python": "python",
    "golang.go": "go",
}


def fehler(text: str) -> int:
    print(f"  FEHLER: {text}")
    print()
    print("DIE WACHE IST BLIND.")
    return 2


def versionierte(muster: list[str]) -> int:
    """Wie viele versionierte Dateien passen auf die Muster?"""
    try:
        ergebnis = subprocess.run(
            ["git", "ls-files", "--", *muster],
            cwd=WURZEL,
            capture_output=True,
            text=True,
            check=True,
        )
    except (subprocess.CalledProcessError, OSError):
        return -1
    return len([z for z in ergebnis.stdout.splitlines() if z.strip()])


def rezept_lesen() -> dict | None:
    """devcontainer.json lesen. Kommentare sind dort erlaubt (jsonc)."""
    text = REZEPT.read_text(encoding="utf-8")
    # Zeilenkommentare entfernen, aber keine, die in einem String stehen.
    ohne = re.sub(r'(^|[^:"])//[^\n]*', r"\1", text)
    try:
        return json.loads(ohne)
    except json.JSONDecodeError:
        return None


def main() -> int:
    luecken: list[str] = []

    if not ORDNER.is_dir():
        return fehler(".devcontainer/ gibt es nicht — verschoben?")
    if not REZEPT.is_file():
        return fehler(".devcontainer/devcontainer.json gibt es nicht — umbenannt?")
    if not ABBILD.is_file():
        return fehler(".devcontainer/Dockerfile gibt es nicht — umbenannt?")

    rezept = rezept_lesen()
    if rezept is None:
        return fehler("devcontainer.json laesst sich nicht lesen — kaputtes JSON?")

    features = rezept.get("features") or {}
    if not features:
        return fehler(
            "kein einziges `features`-Feld in devcontainer.json — Muster kaputt? "
            "Die Wache prueft genau diese Liste."
        )

    # Der Bau-Kontext steht im Rezept; er ist relativ zu .devcontainer/.
    kontext = ORDNER / (rezept.get("build", {}).get("context") or ".")

    # ── 1. Quellen des COPY ────────────────────────────────────────────────
    print("── Quellen, auf die die .devcontainer/Dockerfile zeigt ──")
    zeilen = ABBILD.read_text(encoding="utf-8").splitlines()
    kopien: list[tuple[int, str]] = []
    for nr, zeile in enumerate(zeilen, 1):
        if zeile.lstrip().startswith("#"):
            continue  # auskommentiert zaehlt nicht
        treffer = re.match(r"\s*COPY\s+(?!--from)(.+)$", zeile)
        if not treffer:
            continue
        teile = [t for t in treffer.group(1).split() if not t.startswith("--")]
        for quelle in teile[:-1]:  # das letzte Feld ist das Ziel
            kopien.append((nr, quelle))

    if not kopien:
        return fehler(
            "kein einziges `COPY` in der .devcontainer/Dockerfile — Muster kaputt?"
        )

    for nr, quelle in kopien:
        if "*" in quelle or "?" in quelle:
            continue  # Globs loest Docker auf, nicht diese Wache
        if not (kontext / quelle).exists():
            print(
                f"  TOTE QUELLE: .devcontainer/Dockerfile:{nr} kopiert `{quelle}` — "
                f"das liegt nicht im Bau-Kontext ({kontext.relative_to(WURZEL)})"
            )
            luecken.append(f"copy/{quelle}")

    # ── 2. Sprach-Features ohne Sprache im Baum ────────────────────────────
    print("── Features, deren Sprache im Baum nicht mehr vorkommt ──")
    angemeldet = anmeldung_lesen()
    ueberfluessig: list[str] = []

    for pfad in features:
        # "ghcr.io/devcontainers/features/php:1" → "php"
        name = pfad.rstrip("/").split("/")[-1].split(":")[0]
        if name not in SPRACHEN:
            continue
        muster, klartext = SPRACHEN[name]
        anzahl = versionierte(muster)
        if anzahl < 0:
            return fehler("`git ls-files` laeuft nicht — kein Baum? Ohne ihn kein Urteil.")
        if anzahl > 0:
            continue
        meldung = (
            f"devcontainer.json zieht `features/{name}` — im versionierten Baum "
            f"liegt aber keine einzige {klartext}-Datei ({', '.join(muster)})"
        )
        ueberfluessig.append(name)
        if name in angemeldet:
            print(f"  HINWEIS: {meldung} — im BACKLOG.md unter {ANMELDUNG} angemeldet, zaehlt nicht")
        else:
            print(f"  UEBERFLUESSIG: {meldung}")
            luecken.append(f"feature/{name}")

    # ── 3. Erweiterungen ohne ihre Sprache ─────────────────────────────────
    print("── Erweiterungen, deren Sprache im Baum nicht mehr vorkommt ──")
    anpassung = rezept.get("customizations", {}).get("vscode", {})
    for erweiterung in anpassung.get("extensions") or []:
        name = ERWEITERUNGEN.get(erweiterung)
        if not name:
            continue
        muster, klartext = SPRACHEN[name]
        if versionierte(muster) > 0:
            continue
        meldung = (
            f"devcontainer.json empfiehlt `{erweiterung}` — im versionierten Baum "
            f"liegt aber keine einzige {klartext}-Datei"
        )
        ueberfluessig.append(name)
        if name in angemeldet:
            print(f"  HINWEIS: {meldung} — im BACKLOG.md unter {ANMELDUNG} angemeldet, zaehlt nicht")
        else:
            print(f"  UEBERFLUESSIG: {meldung}")
            luecken.append(f"erweiterung/{erweiterung}")

    # ── Die Gegenrichtung ──────────────────────────────────────────────────
    # Der Backlog meldet ein Aufraeumen an, das es nicht mehr gibt. Sie haengt
    # am ERGEBNIS, nicht am Namen — so faengt sie „repariert" und „gestrichen".
    if angemeldet and not ueberfluessig:
        print(
            f"  BACKLOG VERALTET: {ANMELDUNG} in BACKLOG.md meldet ein ueberfluessiges "
            "Feature des Devcontainers an, aber keines ist mehr ueberfluessig — "
            "erledigt? Dann den Abschnitt streichen."
        )
        luecken.append("backlog/veraltet")

    print()
    if not luecken:
        print("KEINE LUECKE.")
        return 0
    print(f"{len(luecken)} LUECKE(N).")
    return 1


def anmeldung_lesen() -> set[str]:
    """Welche Sprachen meldet der BACKLOG-Abschnitt A4b als bekannt an?"""
    if not BACKLOG.is_file():
        return set()
    text = BACKLOG.read_text(encoding="utf-8")
    block = ""
    for kandidat in text.split("\n#### ")[1:]:
        # Genau diese Ueberschrift, nicht bloss ihr Anfang: `A4b2` ist ein
        # anderer Abschnitt als `A4b`, und ein Praefix-Treffer wuerde einen
        # Fund unter fremder Anmeldung stillstellen.
        if re.match(rf"{re.escape(ANMELDUNG)}(?![0-9A-Za-z])", kandidat):
            block = kandidat.split("\n#### ")[0]
            break
    if not block:
        return set()
    # Angemeldet ist, was der Block beim Namen nennt — in Backticks oder als
    # Klartext. Gesucht wird nach den Feature-Namen, die die Wache kennt.
    klein = block.lower()
    return {name for name in SPRACHEN if name in klein}


if __name__ == "__main__":
    sys.exit(main())
