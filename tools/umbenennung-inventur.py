#!/usr/bin/env python3
"""
WOZU
  Zaehlt die Vorkommen von "mupi/MuPi/mupibox/MuPiBox/MUPI_" im Baum und sortiert
  sie in DREI Toepfe, damit vor einer Umbenennung klar ist, was gefahrlos geht:

    A  SICHTBAR    Text, den Kind oder Eltern lesen oder hoeren
                   (Seitentitel, Ueberschriften, Meldungen, Bootbild)
    B  INTERN      eigene Werkzeuge, eigene Kommentare, eigene Doku
                   (aendert nichts am Betrieb, ist aber Arbeit ohne Nutzen)
    C  UNANTASTBAR Dienstnamen, Pfade auf der Box, Konfigurationsschluessel,
                   npm-Paketnamen, Geraetenamen bei Spotify/Jellyfin,
                   Themennamen (= Datenschluessel), alles was der
                   remoteinstaller anfasst

WAS ES AENDERT
  NICHTS. Es liest nur und schreibt eine Tabelle nach stdout.

AUFRUF
  python3 tools/umbenennung-inventur.py [wurzel]      # Standard: cwd
  python3 tools/umbenennung-inventur.py --dateien     # zusaetzlich je Datei
"""

import re
import subprocess
import sys
from collections import defaultdict

MUSTER = r"mupi"  # gross/klein egal, faengt MuPiBox, mupibox, MUPI_, mupihat …

AUSSCHLUSS = [
    "!node_modules",
    "!.git",
    "!package-lock.json",
    "!*.zip",
    "!*.png",
    "!*.jpg",
    "!*.JPG",
    "!*.stl",
    "!*.f3z",
    "!www",
    "!dist",
]

# Reihenfolge zaehlt: die ERSTE passende Regel gewinnt. C steht vorn, weil ein
# Pfad wie config/services/ ausnahmslos unantastbar ist, egal was drinsteht.
REGELN = [
    # ── C: UNANTASTBAR ───────────────────────────────────────────────────
    ("C", r"^config/services/"),        # 16 systemd-Units mupi_*.service
    ("C", r"^config/templates/"),       # mupiboxconfig.json, env-librespot, smb.conf …
    ("C", r"^scripts/"),                # liegt auf der Box unter /usr/local/bin/mupibox
    ("C", r"^autosetup/"),              # Erstinstallation
    ("C", r"^update/"),                 # Aktualisierung bestehender Boxen
    ("C", r"^AdminInterface/"),         # alte PHP-Verwaltung, vom Installer ausgerollt
    ("C", r"^Dockerfile$"),
    ("C", r"^harness/"),                # baut die Box-Pfade nach
    ("C", r"^package(-lock)?\.json$"),
    ("C", r"^src/[^/]+/package\.json$"),
    ("C", r"^mupictl$"),                # Befehl auf der Box
    ("C", r"^version\.json$"),
    ("C", r"^bin/"),
    ("C", r"^3D-Design/"),              # Dateinamen gedruckter Teile
    ("C", r"^screenshots/"),
    ("C", r"^themes/"),                 # Themendateien = Datenschluessel
    ("C", r"^src/backend-player/"),     # Geraetename bei Spotify
    ("C", r"^media/"),
    ("C", r"^config/"),
    # ── A: SICHTBAR ──────────────────────────────────────────────────────
    ("A", r"^NewDesign/index\.html$"),
    ("A", r"^src/frontend-box/src/index\.html$"),
    ("A", r"^src/frontend-admin/src/index\.html$"),
    ("A", r"^src/frontend-admin/src/app/rahmen\.ts$"),
    ("A", r"^src/frontend-admin/src/app/app\.routes\.ts$"),
    ("A", r"^src/frontend-admin/src/app/seiten/anmeldung\.ts$"),
    # Ein einziger Satz („Do you want to reboot…"), aber er steht im Dialog vor
    # den Augen der Eltern. Von der groben Regel `^src/` waere er als B
    # eingeordnet worden — von Hand nachgezaehlt gehoert er nach A.
    ("A", r"^src/frontend-box/src/app/settings/settings\.page\.ts$"),
    # ── B: INTERN ────────────────────────────────────────────────────────
    ("B", r"^tools/"),
    ("B", r"^documentation/"),
    ("B", r"^dev/"),
    ("B", r"\.md$"),
    ("B", r"\.txt$"),
    ("B", r"\.spec\.ts$"),
    ("B", r"^src/"),                    # Rest: Code-Kommentare, CSS-Variablen
    ("B", r""),                         # Auffangnetz
]


def topf(pfad: str) -> str:
    for name, muster in REGELN:
        if re.search(muster, pfad):
            return name
    return "B"


def main() -> int:
    wurzel = "."
    zeige_dateien = "--dateien" in sys.argv
    for a in sys.argv[1:]:
        if not a.startswith("--"):
            wurzel = a

    befehl = ["rg", "-c", "-i", MUSTER]
    for g in AUSSCHLUSS:
        befehl += ["-g", g]
    befehl += ["--hidden", wurzel]

    lauf = subprocess.run(befehl, capture_output=True, text=True)
    # rg meldet 1, wenn nichts gefunden wurde — das ist kein Fehler.
    if lauf.returncode not in (0, 1):
        sys.stderr.write(lauf.stderr)
        return 1

    summe: dict[str, int] = defaultdict(int)
    dateien: dict[str, int] = defaultdict(int)
    je_topf: dict[str, list[tuple[int, str]]] = defaultdict(list)

    for zeile in lauf.stdout.splitlines():
        if ":" not in zeile:
            continue
        pfad, _, zahl = zeile.rpartition(":")
        pfad = pfad.removeprefix("./").removeprefix(wurzel.rstrip("/") + "/")
        try:
            n = int(zahl)
        except ValueError:
            continue
        t = topf(pfad)
        summe[t] += n
        dateien[t] += 1
        je_topf[t].append((n, pfad))

    print(f"{'Topf':<4} {'Dateien':>8} {'Zeilen':>8}")
    for t in ("A", "B", "C"):
        print(f"{t:<4} {dateien[t]:>8} {summe[t]:>8}")
    print(f"{'ALLE':<4} {sum(dateien.values()):>8} {sum(summe.values()):>8}")

    if zeige_dateien:
        for t in ("A", "B", "C"):
            print(f"\n── Topf {t} ──")
            for n, p in sorted(je_topf[t], reverse=True)[:40]:
                print(f"{n:>5}  {p}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
