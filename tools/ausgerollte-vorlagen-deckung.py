#!/usr/bin/env python3
"""AUSGEROLLTE-VORLAGEN-DECKUNG — jede Vorlage, die ein Ausrollweg auf die Box
legt, gegen die Prosa.

WARUM ES DAS GIBT (27.08.2026): `tools/doku-pfade-pruefen.py` prueft, ob die
Pfade, auf die die DOKU zeigt, im Baum existieren. Das ist die Richtung
DOKU → BAUM. In dieser Richtung faellt eine Datei, die niemand erwaehnt,
nicht auf — im Gegenteil, sie verbessert die Trefferquote, weil sie keinen
falschen Zeiger erzeugt. Dieselbe Luecke wie bei `api-doku-deckung.sh`
(Merksatz: jede zaehlende Wache braucht ihre Gegenrichtung).

DER FUND, DER SIE AUSGELOEST HAT: `config/templates/81-bluez-nur-a2dp.conf`
wird von BEIDEN Ausrollwegen (`autosetup/autosetup.sh:940`,
`update/start_mupibox_update.sh:1296`) nach
`/etc/wireplumber/wireplumber.conf.d/` kopiert und liegt damit auf JEDER Box.
Sie nimmt Bluetooth-Geraeten die Freisprech-Rollen (HFP/HSP) weg — ein
Lautsprecher mit Mikrofon bietet danach kein Mikrofon mehr an, dauerhaft und
mit Absicht. Gemessen am 27.08.2026: null Treffer in `dokumentation/`,
`plugins/README.md`, `README.md`, `BACKLOG.md` und `llmwiki/pack.yaml`. Die
ganze Begruendung stand nur im Kopf der Vorlage selbst und in zwei
Kommentarzeilen der Ausrollskripte — also genau dort, wo sie liest, wer die
Antwort schon hat.

WARUM AUSGERECHNET DIESE: die drei Schwestern desselben Blocks
(`80-bluez-ohne-seat.conf`, `61-entzerrer.conf`, `62-mixpi-mitschnitt.conf`)
stehen alle in Prosa. **Eine Aufzaehlung leiht dem fehlenden Eintrag die
Glaubwuerdigkeit seiner Nachbarn** — wer die Familie dokumentiert sieht,
prueft das einzelne Glied nicht nach.

DIE GRUNDMENGE IST DER AUSROLLWEG, NICHT DAS VERZEICHNIS: `ls
config/templates/` fuehrt auch Vorlagen, die KEIN Weg kopiert
(`proftpd.conf`, `mqtt-discovery.json`, `asound.conf_mono` — bekannt aus
AUDIT-2026-08-24 §7, dort als offene Entscheidung gefuehrt). Die auch noch
zu verlangen machte die Wache dauerrot fuer etwas, das absichtlich offen ist
([[dauerrote-wache-ist-keine]]). Gefragt wird nur nach dem, was TATSAECHLICH
auf einer Box landet.

WAS ALS BELEG ZAEHLT: ein Treffer des DATEINAMENS in einer der Prosa-Ablagen.
Bewusst nicht mehr — eine Wache, die Qualitaet der Erklaerung fordert, ist
nicht messbar. Bewusst auch nicht weniger: ein Treffer im AUSROLLSKRIPT
selbst zaehlt NICHT, sonst belegt die Wache ihren Gegenstand mit sich selbst
(dieselbe Falle wie bei `umgebungsvariablen-deckung.py`, die ihren Befund mit
dem eigenen Kopfkommentar belegte).

AUSNAHME IM REZEPT, NICHT IN DER WACHE: wer eine Vorlage bewusst undokumentiert
laesst, schreibt `# UNDOKUMENTIERT MIT GRUND:` in die Zeile ueber den Kopier-
befehl. Die Wache liest das und meldet die Vorlage als VERMERKT.
"""

import re
import subprocess
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent

# Die Ausrollwege. Nicht nach `*.sh` suchen — `tools/` und `scripts/` legen
# nichts auf eine fremde Box.
#
# NACHGETRAGEN 27.08.2026: die erste Fassung fuehrte nur die beiden Skripte und
# begruendete das Auslassen des Installers damit, er "fuehre seine Dateien in
# einem YAML-Rezept statt in einer Kopierzeile" — das ist eine Aussage ueber
# die SCHREIBWEISE, keine ueber den Gegenstand. Genau dieser Weg ist laut
# `dokumentation/mixpibox.md` §5.1 **der Weg heute**; eine Wache, die ihn nicht
# liest, misst die Vergangenheit. Und sie ueberschrieb ihre Liste mit
# "Vorlagen, die auf jede Box gehen", obwohl die Vereinigung mehrerer Wege nur
# belegt, dass IRGENDEIN Weg eine Vorlage legt — nie, dass jede Box sie hat.
WEGE = [
    "autosetup/autosetup.sh",
    "update/start_mupibox_update.sh",
    "remote-step-installer/recipes/mupibox.yaml",
    "remote-step-installer/recipes/mupibox-app.yaml",
]

# Wege, die eine heute frisch aufgesetzte Box geht. Wer eine Vorlage nur in
# den anderen findet, darf ueber sie nicht "auf jeder Box" schreiben.
WEGE_HEUTE = [
    "remote-step-installer/recipes/mupibox.yaml",
    "remote-step-installer/recipes/mupibox-app.yaml",
]

# Prosa-Ablagen. `llmwiki/pack.yaml` gehoert dazu — das Wissenspaket ist die
# Ablage, in der eine Begruendung am ehesten landet.
PROSA = [
    "dokumentation",
    "plugins/README.md",
    "README.md",
    "BACKLOG.md",
    "llmwiki/pack.yaml",
]

# `mv`/`cp` aus dem Vorlagenverzeichnis heraus. Der Name steht hinter dem
# letzten Schraegstrich der QUELLE, nicht des Ziels — das Ziel heisst
# manchmal anders (`librespot.conf` → `spotifyd.conf`).
#
# Die Variable heisst nicht ueberall `MUPI_SRC`: das Rezept schreibt
# `${MUPI_REPO:-$HOME/Downloads/mixpibox}/config/templates/…`. Auf den festen
# Namen zu pruefen hiesse, den Weg von heute mitzuzaehlen und trotzdem nichts
# in ihm zu finden.
KOPIERZEILE = re.compile(
    r"(?:\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*)?/config/templates/"
    r"(?P<name>[A-Za-z0-9._-]+)"
)

# Der Installer legt eine Vorlage auch aus SEINEM eigenen Baum ab
# (`remote-step-installer/tools/wireplumber/80-bluez-ohne-seat.conf`, Wort fuer
# Wort dieselbe Datei wie unter `config/templates/`). Wer nur nach dem
# Quellordner sucht, meldet sie als "geht den heutigen Weg nicht" — falsch.
# Fuer die Frage, WELCHER Weg eine Vorlage traegt, zaehlt der Name im Ziel.
ZIELZEILE = re.compile(r"^\s*-?\s*(?:src|dest):\s*\S*/(?P<name>[A-Za-z0-9._-]+)\s*$")
VERMERK = re.compile(r"#\s*UNDOKUMENTIERT MIT GRUND:")


def prosa_dateien():
    """Nur, was git kennt — nicht `os.path.exists`. Auf einer Arbeitsmaschine
    liegt Ruecklass herum, und eine Wache, die ihn mitliest, meldet gruen fuer
    Dateien, die kein anderer hat."""
    aus = subprocess.run(
        ["git", "ls-files", "-z", *PROSA],
        cwd=WURZEL, capture_output=True, text=True, check=True,
    )
    return [WURZEL / p for p in aus.stdout.split("\0") if p]


def ausgerollte_vorlagen():
    """(Name, Weg, Zeilennummer, vermerkt) je Kopierzeile."""
    treffer = {}
    for weg in WEGE:
        pfad = WURZEL / weg
        if not pfad.exists():
            print(f"  ! Ausrollweg fehlt: {weg}", file=sys.stderr)
            continue
        zeilen = pfad.read_text(encoding="utf-8", errors="replace").splitlines()
        for nr, zeile in enumerate(zeilen, start=1):
            # Auskommentierte Kopierzeilen sind kein Ausrollen. Der tote
            # `librespot.conf`-Verweis in start_mupibox_update.sh:974 ist
            # genau so einer und steht seit AUDIT-2026-08-27 §1.3 als Befund.
            if zeile.lstrip().startswith("#"):
                continue
            fund = KOPIERZEILE.search(zeile)
            if not fund:
                continue
            name = fund.group("name")
            # Vermerk in der Zeile darueber (oder in derselben).
            davor = zeilen[nr - 2] if nr >= 2 else ""
            vermerkt = bool(VERMERK.search(zeile) or VERMERK.search(davor))
            eintrag = treffer.setdefault(name, {"orte": [], "wege": set(),
                                                "vermerkt": False})
            eintrag["orte"].append(f"{weg}:{nr}")
            eintrag["wege"].add(weg)
            eintrag["vermerkt"] = eintrag["vermerkt"] or vermerkt

    # Zweiter Durchgang fuer die Wege von heute: dort zaehlt der Name im
    # Ziel, nicht der Quellordner (siehe ZIELZEILE).
    for weg in WEGE_HEUTE:
        pfad = WURZEL / weg
        if not pfad.exists():
            continue
        for zeile in pfad.read_text(encoding="utf-8", errors="replace").splitlines():
            if zeile.lstrip().startswith("#"):
                continue
            fund = ZIELZEILE.match(zeile)
            if fund and fund.group("name") in treffer:
                treffer[fund.group("name")]["wege"].add(weg)
    return treffer


def main():
    vorlagen = ausgerollte_vorlagen()
    if not vorlagen:
        print("  ! Keine Kopierzeile gefunden — das Muster passt nicht mehr.",
              file=sys.stderr)
        return 1

    texte = {p: p.read_text(encoding="utf-8", errors="replace")
             for p in prosa_dateien()}

    luecken = []
    vermerkt = []
    for name in sorted(vorlagen):
        eintrag = vorlagen[name]
        belege = [p for p, t in texte.items() if name in t]
        if belege:
            continue
        if eintrag["vermerkt"]:
            vermerkt.append(name)
            continue
        luecken.append((name, eintrag["orte"]))

    # Vereinigung belegt Existenz, nicht Allgemeinheit: eine Vorlage, die nur
    # der alte Monolith und der Update-Weg legen, fehlt auf einer heute frisch
    # aufgesetzten Box, bis sie das erste Mal aktualisiert wird. Kein Fehler
    # (11 von 16 sind so, das waere dauerrot) — aber jeder Satz "auf jeder Box"
    # ueber eine dieser Vorlagen ist falsch.
    nur_alt = [n for n in sorted(vorlagen)
               if not (vorlagen[n]["wege"] & set(WEGE_HEUTE))]
    if nur_alt:
        print("── Nicht auf einer heute frisch aufgesetzten Box (erst nach dem "
              "ersten Update) ──")
        for name in nur_alt:
            print(f"  {name}")
        print("      Ueber diese Vorlagen darf keine Prosa \"auf jeder Box\" "
              "schreiben.")
        print()

    print("── Ausgerollte Vorlagen, die in keiner Prosa stehen ──")
    for name, orte in luecken:
        print(f"  {name}")
        for ort in orte:
            print(f"      ausgerollt von {ort}")
    for name in vermerkt:
        print(f"  (vermerkt, mit Grund undokumentiert: {name})")

    if luecken:
        print(f"\n{len(luecken)} LUECKE(N) von {len(vorlagen)} ausgerollten "
              f"Vorlagen.")
        return 1
    print(f"\nKEINE LUECKE. ({len(vorlagen)} ausgerollte Vorlagen geprueft)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
