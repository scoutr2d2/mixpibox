#!/usr/bin/env python3
"""HOLT SICH IRGENDEIN AUSROLLWEG SEINEN CODE WIEDER BEIM ORIGINAL?

DER ANLASS. `update/start_mupibox_update.sh` holte Archiv und Versionsliste von
github.com/splitti/MuPiBox, machte `rm -R` auf den Anwendungsbaum und packte
UPSTREAMS deploy.zip aus. Ein Druck auf „Update" ersetzte damit den Fork durch
das Original — ohne Rueckfrage, ohne Weg zurueck. Am 08.08.2026 bekam das
Skript dafuer einen Riegel: ohne `MUPI_ZURUECK_ZUM_ORIGINAL=1` bricht es ab,
bevor es irgendetwas anfasst.

WARUM DAS ALLEIN NICHT REICHT, und warum es diese Wache gibt: Ein Riegel ist
ein Satz in einer Datei. Er haelt, solange niemand die Datei umbaut, sie aus
dem Original neu zieht oder — der Fall, der wirklich eintrat — dieselbe Luecke
an einer ZWEITEN Stelle stehen laesst. `autosetup/autosetup.sh` trug sie noch
am 31.08.2026: ohne `MUPI_LOCAL_SRC` zog es version.json von splitti, daraus
die Archiv-Adresse, lud sie und packte sie aus. Dieselbe Ersetzung, nur auf dem
INSTALL-Weg statt auf dem Update-Weg — und dort faellt sie niemandem auf, weil
eine frische Karte ja ohnehin leer ist und am Ende alles „laeuft". Nur eben
MuPiBox statt MixPiBox.

WAS SIE PRUEFT — auf Sorte, nicht auf Pfad
Sie fuehrt KEINE Liste der Dateien, die man im Auge behalten muss; so eine
Liste haette `autosetup/autostart.sh` nie enthalten (es steht in keinem
Ausrollweg-Verzeichnis und schreibt trotzdem ein `curl … | sudo bash` auf das
Original in die `.bashrc` einer frischen Box). Gesucht wird stattdessen das
MERKMAL: eine AUSFUEHRBARE Zeile, die eine Upstream-Quelle nennt UND ein
Beschaffungsverb traegt (`wget`, `curl`, `git clone`). Wo das zusammentrifft,
muss in derselben Datei ein Riegel stehen, und zwar VOR der Zeile.

WAS SIE AUSDRUECKLICH NICHT BEWEIST — Untergrenze, kein Freispruch
  * Sie prueft die REIHENFOLGE (Riegel steht vor der Zeile), nicht den
    Kontrollfluss. Ein Riegel in einem `if`, das nie zutrifft, besteht sie.
    Wer den Fluss aendert, muss selbst hinsehen.
  * Ein Kommentar zaehlt nicht als Fundstelle — sonst schlaege sie auf genau
    die Absaetze an, die den Fehler ERKLAEREN (dieser hier eingeschlossen)
    [[kommentar-und-kompilat-sind-keine-gegenstelle]]. Erkannt wird ein
    Kommentar an der ersten Nicht-Leerstelle `#` sowie ab dem ersten ` #`
    einer Zeile; ein Verb hinter einem `#` in einer Zeichenkette faellt durch.
  * Fremde Projekte (DietPi-Dashboard, jq, nanorc, initramfs-splash) sind kein
    Fremdbezug in diesem Sinn: sie liefern Zubehoer, nicht die Anwendung. Nur
    MuPiBox-Quellen zaehlen.
  * Ein reiner `POST` an mupibox.de holt keinen Code (Telemetrie in
    autosetup.sh). Sie meldet ihn als HINWEIS, nicht als Luecke — verschweigen
    waere die gefaehrlichere Sorte gruen.

Findet sie ueberhaupt keine Fundstelle, meldet sie WARNUNG statt gruen: dann
ist eher das Muster veraltet als der Baum sauber ([[gegenprobe-statt-gruen-glauben]]).

Aufruf aus dem Wurzelverzeichnis:  python3 tools/mixpi-fremdbezug-pruefen.py
Gegenprobe:                        python3 tools/mixpi-fremdbezug-pruefen.py --sabotage
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent

# Die Quellen, die DIESES Projekt ersetzen koennen. Zubehoer anderer Projekte
# steht bewusst nicht hier (Begruendung im Kopf).
UPSTREAM = re.compile(r"splitti/MuPiBox|mupibox\.de", re.I)
# Verben, die etwas HERBEISCHAFFEN. `jq -r .release…` allein tut das nicht —
# es liest nur, was ein wget vorher geholt hat, und faellt deshalb hier durch;
# der wget davor wird gefunden, und das ist die Stelle, die zaehlt.
BESCHAFFEN = re.compile(r"\b(wget|curl|git\s+clone)\b")
# Ein POST holt nichts. Eigene Sorte, eigener Befund.
NUR_MELDEN = re.compile(r"-X\s*POST|--data\b|-d\s")
# Ein Bild kann den Fork nicht ersetzen. Es bleibt eine Kopplung ans Original
# (bricht, wenn dort jemand aufraeumt) — aber es ist nicht die Sorte, gegen die
# diese Wache steht. Als HINWEIS sichtbar, nicht als Luecke: still ausnehmen
# waere die gefaehrlichere Art gruen zu sein.
NUR_BEIWERK = re.compile(r"\.(jpe?g|png|gif|svg|webp|ico|ttf|woff2?)\b", re.I)
RIEGEL = "MUPI_ZURUECK_ZUM_ORIGINAL"

AUSGENOMMEN = ("node_modules", ".git", ".claude", "AdminInterface")


def code_teil(zeile: str) -> str:
    """Die Zeile ohne ihren Kommentar. Untergrenze, siehe Kopf."""
    if zeile.lstrip().startswith("#"):
        return ""
    schnitt = zeile.find(" #")
    return zeile if schnitt < 0 else zeile[:schnitt]


def skripte() -> list[Path]:
    """Alle verfolgten Shell-Skripte. `git ls-files`, damit nichts Ungetracktes
    ein Urteil traegt und nichts aus einem Arbeitsbaum hereinregnet."""
    try:
        e = subprocess.run(["git", "-C", str(WURZEL), "ls-files", "*.sh"],
                           capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError):
        return []
    if e.returncode != 0:
        return []
    aus = []
    for z in e.stdout.splitlines():
        z = z.strip()
        if not z or any(t in z for t in AUSGENOMMEN):
            continue
        p = WURZEL / z
        if p.is_file():
            aus.append(p)
    return aus


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--sabotage", action="store_true",
                   help="Gegenprobe: keinen Riegel gelten lassen. Danach MUSS "
                        "jede Fundstelle als Luecke erscheinen — sonst sucht "
                        "die Wache am falschen Ort.")
    a = p.parse_args()

    print("── Holt sich ein Ausrollweg seinen Code beim Original? ──")

    dateien = skripte()
    if not dateien:
        print("  WARNUNG: kein einziges verfolgtes Shell-Skript gefunden.")
        print("KEINE MESSUNG.")
        return 1

    luecken: list[str] = []
    hinweise: list[str] = []
    geriegelt = 0
    fundstellen = 0

    for pfad in sorted(dateien):
        rel = pfad.relative_to(WURZEL).as_posix()
        try:
            zeilen = pfad.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue

        # Wo steht der Riegel? Nur in AUSFUEHRBAREN Zeilen — ein Riegel, der
        # bloss im Kommentar beschrieben ist, riegelt nichts.
        riegel_zeile = None
        for i, z in enumerate(zeilen, 1):
            if RIEGEL in code_teil(z):
                riegel_zeile = i
                break
        if a.sabotage:
            riegel_zeile = None

        for i, z in enumerate(zeilen, 1):
            code = code_teil(z)
            if not (UPSTREAM.search(code) and BESCHAFFEN.search(code)):
                continue
            if NUR_MELDEN.search(code) and not re.search(r"-O\b|-o\b", code):
                hinweise.append(f"{rel}:{i}  (meldet nur)  {z.strip()[:70]}")
                continue
            if NUR_BEIWERK.search(code):
                hinweise.append(f"{rel}:{i}  (Beiwerk)     {z.strip()[:70]}")
                continue
            fundstellen += 1
            if riegel_zeile is not None and riegel_zeile < i:
                geriegelt += 1
                continue
            luecken.append(f"{rel}:{i}")
            print(f"  OFFENER FREMDBEZUG: {rel}:{i}")
            print(f"    {z.strip()[:100]}")
            if riegel_zeile is None:
                print(f"    In dieser Datei steht kein {RIEGEL}-Riegel.")
            else:
                print(f"    Der Riegel steht in Zeile {riegel_zeile} — also DAHINTER.")

    if fundstellen == 0 and not a.sabotage:
        print("  WARNUNG: keine einzige Beschaffungszeile mit Upstream-Quelle gefunden.")
        print("  Eher ist das Muster veraltet als der Baum sauber — bitte nachsehen.")
        print("KEINE MESSUNG.")
        return 1

    if hinweise:
        print()
        print(f"  HINWEIS — {len(hinweise)} Zeile(n) beschaffen keinen ersetzbaren Code:")
        for h in hinweise:
            print(f"    {h}")

    print()
    print(f"  {fundstellen} Beschaffungszeile(n) mit Upstream-Quelle, "
          f"davon {geriegelt} geriegelt, {len(luecken)} offen.")

    if luecken:
        print()
        print("  WAS DAS HEISST: Dieser Weg kann eine Box mit dem ORIGINAL")
        print("  bespielen statt mit diesem Fork. Auf dem Update-Weg loescht das")
        print("  die eigene Arbeit, auf dem Install-Weg entsteht still eine Karte,")
        print("  die nie MixPiBox war.")
        print(f"  Riegel-Vorlage: update/start_mupibox_update.sh, Kopf.")
        print(f"{len(luecken)} LUECKE(N).")
        return 1

    print("KEINE LUECKE.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
