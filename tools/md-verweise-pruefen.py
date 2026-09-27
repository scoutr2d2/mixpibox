#!/usr/bin/env python3
# ── WOHIN EIN MARKDOWN-VERWEIS WIRKLICH ZEIGT ─────────────────────────────
# `doku-pfade-pruefen.py` liest Pfade aus FLIESSTEXT. Sein Muster verlangt
# dafuer ein oberstes Verzeichnis mit Schraegstrich (`tools/…`, `src/…`) —
# sonst wuerde jedes `app.css` in jedem Absatz als Baumpfad gelten. Der Preis
# steht nirgends: **ein Ziel an der WURZEL faellt komplett durch.**
# Nachgemessen am 03.09.2026 im HEAD-Baum, beide Faelle in dieselbe
# `BACKLOG.md` geschrieben:
#
#     [x](dokumentation/GIBTSNICHT.md)  ->  TOT: dokumentation/GIBTSNICHT.md
#     [y](WURZEL-GIBTSNICHT.md)         ->  schweigt
#
# An der Wurzel liegt aber die meistgelesene Prosa (`README.md`,
# `BACKLOG.md`, `MODERNIZATION.md`, `ADMIN-BOARD-ANALYSE.md`, die
# `KONZEPT-*.md`). Ein toter Verweis dorthin wird von keiner Wache bemerkt.
# Das ist die dritte Blindstelle derselben Wache — die beiden frueheren
# (Prosaliste zu schmal, Ordnerliste zu schmal) stehen in ihrem eigenen Kopf.
# llmwiki: `wache-auf-sorte-nicht-auf-pfad`.
#
# Diese Wache nimmt darum nicht den Fliesstext, sondern die SORTE, die
# eindeutig ein Pfad IST: das Ziel eines Markdown-Verweises `[text](ziel)`.
# Dort braucht es kein Verzeichnis als Beweis, dass ein Pfad gemeint war —
# die Klammer ist der Beweis.
#
# ── ZWEI URTEILE, NICHT EINS ──────────────────────────────────────────────
# Geprueft wird gegen `git ls-files`, NICHT gegen `os.path.exists`. Der
# Unterschied ist der ganze Fund: eine Datei kann DALIEGEN und trotzdem nicht
# zum Repo gehoeren. Genau das steht heute im Baum — `BACKLOG.md:11183`
# verweist auf `KONZEPT-NACHBARSCHAFT.md` (32 KB, 31.08.), und die Datei ist
# unverfolgt. Wer die `BACKLOG.md` committet und die Konzeptdatei vergisst,
# hinterlaesst einen toten Verweis, den `os.path.exists` auf seinem eigenen
# Rechner NIE sehen wird.
# llmwiki: `verweis-wache-las-nur-verfolgtes-und-verfehlte-die-neue-datei`.
#
# Darum meldet die Wache getrennt:
#   TOT        — Ziel liegt nirgends
#   UNVERFOLGT — Ziel liegt da, ist aber in keinem Commit
#
# ── DAS ZIEL GILT AB DER NENNENDEN DATEI ──────────────────────────────────
# Ein Verweis in `plugins/README.md` auf `(vertrag.md)` meint
# `plugins/vertrag.md`, nicht `vertrag.md` an der Wurzel. Gegen die Wurzel
# aufgeloest erfindet die Wache Tote — dieselbe Regel wie bei zitierten
# paketrelativen Pfaden: das Zitat traegt die Wahrheit des Zitierten.
# llmwiki: `paketrelativer-pfad-im-zitat-sieht-aus-wie-umzugsschuld`.
import os
import re
import subprocess
import sys

# `AUDIT-<datum>.md` sind Momentaufnahmen: sie nennen Vorschlaege und
# vergangene Staende, deren Abwesenheit ihr Befund IST. Dieselbe Begruendung
# und dieselbe Regel wie in `doku-pfade-pruefen.py`; ein stiller Ausschluss
# liest sich wie Deckung, darum wird die Zahl unten GEMELDET.
# llmwiki: `dauerrote-wache-ist-keine`.
MOMENTAUFNAHME = re.compile(r"(^|/)AUDIT-\d{4}-\d{2}-\d{2}\.md$")

# `[text](ziel)` — ohne verschachtelte Klammern im Ziel.
VERWEIS = re.compile(r"\[[^\]]*\]\(([^()\s]+)(?:\s+\"[^\"]*\")?\)")

# Kein Baumpfad: Netzadressen, Sprungmarken, Mail.
FREMD = re.compile(r"^(https?:|mailto:|ftp:|#|//)")

# Platzhalter und Sammelangaben sind keine Datei.
UNSCHARF = ("*", "<", "{", "...", "$")


def _git(*mehr):
    aus = subprocess.run(
        ["git", "ls-files", "-z", *mehr], capture_output=True, text=True, check=True
    ).stdout.split("\0")
    return {p for p in aus if p}


def _verfolgte():
    """Nur Verfolgtes — das ist hier das URTEIL, nicht die Bequemlichkeit."""
    return _git("--cached")


def _gelesene():
    """Jede Prosadatei, AUCH die noch unverfolgte.

    Getrennt von `_verfolgte()`, und das ist der ganze Punkt: eine frisch
    geschriebene Prosadatei ist unverfolgt, bis sie committet wird. Wer die
    QUELLENliste aus `--cached` zieht, laeuft blind an genau der Datei
    vorbei, fuer die es die Wache gibt — einmal belegt am 30.08.2026, zwei
    Laeufe hintereinander
    (llmwiki: `verweis-wache-las-nur-verfolgtes-und-verfehlte-die-neue-datei`).
    `--exclude-standard` haelt `node_modules` und Baugut von vornherein
    draussen.
    """
    return _git("--cached", "--others", "--exclude-standard")


def _prosadateien(gelesen):
    md = sorted(p for p in gelesen if p.endswith(".md"))
    uebersprungen = [p for p in md if MOMENTAUFNAHME.search(p)]
    return [p for p in md if p not in uebersprungen], uebersprungen


def main():
    verfolgt = _verfolgte()
    dateien, momentaufnahmen = _prosadateien(_gelesene())

    # Riegel wie bei der Nachbarwache: eine ABGELEITETE Liste kann man
    # versehentlich leeren, und der Wachhund `geprueft == 0` merkt es erst,
    # wenn ALLES weg ist. Absichtlich keine Mindestzahl
    # (llmwiki: `tests-duerfen-keine-zahlen-festnageln`), sondern die Ablagen,
    # die es seit Jahren gibt.
    KERN = ("README.md", "BACKLOG.md", "plugins/README.md", "dokumentation/mixpibox.md")
    for k in KERN:
        if k not in dateien:
            print(f"  WARNUNG: {k} kam in der Ableitung nicht an — git ls-files geaendert?")

    tot = {}
    unverfolgt = {}
    geprueft = 0

    for datei in dateien:
        try:
            text = open(datei, encoding="utf-8").read()
        except OSError as e:
            print(f"  WARNUNG: {datei} nicht lesbar ({e})")
            continue
        for m in VERWEIS.finditer(text):
            ziel = m.group(1).split("#")[0].strip()
            if not ziel or FREMD.match(ziel) or any(u in ziel for u in UNSCHARF):
                continue
            # Absolute Pfade sind Orte AUF DER BOX (`/opt/mupibox/…`), nicht
            # im Baum — eine Wache, die sie einfordert, meldet ewig rot.
            if ziel.startswith("/") or ziel.startswith("~"):
                continue
            # Das Ziel gilt ab der nennenden Datei.
            aufgeloest = os.path.normpath(os.path.join(os.path.dirname(datei), ziel))
            if aufgeloest.startswith(".."):
                continue
            geprueft += 1
            zeile = text[: m.start()].count("\n") + 1
            if aufgeloest in verfolgt:
                continue
            # Ein Verzeichnis als Ziel ist in Ordnung, wenn der Baum es fuehrt.
            if any(p.startswith(aufgeloest + "/") for p in verfolgt):
                continue
            if os.path.exists(aufgeloest):
                unverfolgt.setdefault(aufgeloest, []).append(f"{datei}:{zeile}")
            else:
                tot.setdefault(aufgeloest, []).append(f"{datei}:{zeile}")

    print(
        f"── {len(dateien)} Prosadateien gelesen, {len(momentaufnahmen)} Momentaufnahmen "
        "(AUDIT-*.md) uebersprungen, {0} Verweise geprueft ──".format(geprueft)
    )

    if geprueft == 0:
        print("  WARNUNG: kein einziger Verweis geprueft — Muster oder Ableitung kaputt?")
        return 1

    for ziel, orte in sorted(tot.items()):
        print(f"  TOT: {ziel}   (genannt in {', '.join(sorted(orte))})")
    for ziel, orte in sorted(unverfolgt.items()):
        print(f"  UNVERFOLGT (liegt da, gehoert aber keinem Commit): {ziel}   (genannt in {', '.join(sorted(orte))})")

    anzahl = len(tot) + len(unverfolgt)
    if anzahl:
        print(f"{anzahl} LUECKE(N) von {geprueft} geprueften Verweisen.")
        return 1
    print(f"Kein toter Verweis. {geprueft} Verweise geprueft.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
