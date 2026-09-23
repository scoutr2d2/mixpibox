#!/usr/bin/env python3
"""ERGAENZUNGEN-DECKUNG — jede systemd-Ergaenzung, die ein Ausrollweg einer
fremden Unit unterschiebt, gegen die Prosa.

WARUM ES DAS GIBT (30.08.2026)

Es gibt zwei Schwesterwachen, und die Luecke liegt GENAU ZWISCHEN IHNEN:

  `ausgerollte-vorlagen-deckung.py`  prueft, was ein Weg auf die Box LEGT —
                                     eine Datei aus `config/templates/`.
  `ausgerollte-eingriffe-deckung.py` prueft, was ein Weg an einer fremden
                                     Datei AENDERT — `sed -i`, `tee -a`, `>>`.

Eine systemd-Ergaenzung (`/etc/systemd/system/UNIT.d/NAME.conf`) ist beides
nicht:

  * Sie ist KEINE VORLAGE. Es gibt keine Datei im Baum, die sie waere; das
    Rezept schreibt sie zur Laufzeit mit `cat > … <<'ENDE'`. Wer nach
    `config/templates/` sucht, findet nichts.
  * Sie ist KEIN EINGRIFF. Sie legt eine EIGENE, neue Datei an und fasst die
    Unit nicht an. Die Schwesterwache stuft `cat >` ausdruecklich als
    ANLEGEND ein und stellt daran keine Doku-Forderung — zu Recht, denn wer
    seine eigene Datei schreibt, hat den Namen, unter dem man sie sucht.

Und trotzdem ist sie die WIRKSAMSTE der drei Sorten: sie aendert das
Verhalten einer Unit, die dokumentiert ist, OHNE deren Datei anzufassen. Wer
`config/services/mupi_hat.service` liest, sieht keine Bedingung. Auf der Box
laeuft der Dienst nur, wenn `/usr/local/bin/mupihat-da` gruen meldet — das
steht in `mupi_hat.service.d/nur-wenn-da.conf`, und diese Datei hatte am
30.08.2026 NULL Treffer in `dokumentation/`, `README.md`, `BACKLOG.md` und
`llmwiki/pack.yaml`. Die Akkuanzeige startet oder startet nicht, und der
Grund dafuer stand in keiner Zeile Prosa.

DIE BAUART, DIE DAHINTER STECKT: eine Ergaenzung hat, wie ein Eingriff, keinen
Namen in der Doku-Tabelle ihrer Sorte — es gibt fuer sie keine Tabelle. Aber
anders als ein Eingriff bringt sie sehr wohl einen Namen mit, naemlich ihren
Dateinamen. Daran wird hier gemessen.

WACHE AUF DIE SORTE, NICHT AUF DEN BEFEHL: gesucht wird nicht `cat >`, sondern
das MERKMAL, das mit dem Fehler nicht verschwindet — ein Pfad unter
`/etc/systemd/system/` mit einem `.d/`-Verzeichnis darin. Ob ihn `cat`,
`printf`, `install`, `cp` oder ein `put:` des Rezepts schreibt, ist gleich.

WAS VERLANGT WIRD: der DATEINAME der Ergaenzung (`nur-wenn-da.conf`) muss in
einer Prosa-Ablage vorkommen. Nicht der Unit-Name — der steht ohnehin ueberall
und wuerde jede Ergaenzung fuer gedeckt erklaeren, sobald ihre Unit erwaehnt
ist. Das ist dieselbe Falle wie „eine Aufzaehlung leiht dem fehlenden Eintrag
die Glaubwuerdigkeit seiner Nachbarn".

AUSNAHME IM WEG, NICHT IN DER WACHE: wer eine Ergaenzung bewusst
undokumentiert laesst, schreibt `# UNDOKUMENTIERT MIT GRUND: <grund>` in die
Zeile darueber ([[dauerrote-wache-ist-keine]]).

Aufruf aus dem Wurzelverzeichnis:  python3 tools/ergaenzungen-deckung.py
Rueckgabe: 0 = keine Luecke, 1 = mindestens eine.
"""

import importlib.util
import re
import subprocess
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent


def _schwester():
    """Wegeliste und Prosa-Ablagen kommen aus der Schwesterwache, nicht aus
    einer Kopie — eine Korrektur an ihr soll beide heilen. Der Dateiname hat
    Bindestriche, deshalb ueber den Lader."""
    quelle = Path(__file__).with_name("ausgerollte-vorlagen-deckung.py")
    spec = importlib.util.spec_from_file_location("ausgerollte_vorlagen", quelle)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


_SCHWESTER = _schwester()

WEGE = list(_SCHWESTER.WEGE)
WEGE_HEUTE = list(_SCHWESTER.WEGE_HEUTE)
PROSA = list(_SCHWESTER.PROSA)

# Das Merkmal der Sorte. `UNIT` traegt die Endung mit (`mupi_hat.service`,
# `mupi-network-info.timer`), weil `systemctl` sie auch mittraegt und ein
# Leser danach sucht. Ein Pfad ohne `.d/` ist eine gewoehnliche Unit und
# gehoert der Schwesterwache `dienste-doku-deckung.sh`.
ERGAENZUNG = re.compile(
    r"/etc/systemd/system/"
    r"(?P<unit>[A-Za-z0-9_.@-]+\.(?:service|timer|socket|path|mount|target))\.d/"
    r"(?P<conf>[A-Za-z0-9._-]+\.conf)"
)

VERMERK = re.compile(r"#\s*UNDOKUMENTIERT MIT GRUND:")


def prosa_text():
    """Nur, was git kennt — Ruecklass auf der Arbeitsmaschine wuerde eine
    Deckung vortaeuschen, die kein anderer hat."""
    aus = subprocess.run(
        ["git", "ls-files", "-z", *PROSA],
        cwd=WURZEL, capture_output=True, text=True, check=True,
    )
    text = []
    for p in aus.stdout.split("\0"):
        if not p:
            continue
        datei = WURZEL / p
        try:
            text.append((p, datei.read_text(encoding="utf-8", errors="replace")))
        except OSError:
            continue
    return text


def gefundene_ergaenzungen():
    """Alle Ergaenzungen, die ein Weg schreibt — mit Weg, Zeile und Vermerk.

    Nur das ERSTE Vorkommen je (Unit, Datei) und Weg zaehlt als Fundort; die
    `mkdir -p`-Zeile davor und die `sed -i`/`check:`-Zeilen danach nennen
    denselben Pfad noch einmal und sind kein zweiter Gegenstand.
    """
    gefunden = {}
    for weg in WEGE:
        datei = WURZEL / weg
        if not datei.exists():
            continue
        zeilen = datei.read_text(encoding="utf-8", errors="replace").splitlines()
        for nr, zeile in enumerate(zeilen, start=1):
            for treffer in ERGAENZUNG.finditer(zeile):
                schluessel = (treffer.group("unit"), treffer.group("conf"))
                eintrag = gefunden.setdefault(schluessel, {
                    "wege": set(), "orte": [], "vermerkt": False,
                })
                if weg not in eintrag["wege"]:
                    eintrag["wege"].add(weg)
                    eintrag["orte"].append(f"{weg}:{nr}")
                # Der Vermerk darf in der Zeile selbst oder in einer der drei
                # Zeilen darueber stehen — im Rezept traegt der Schritt seine
                # Begruendung im `note:`, nicht unmittelbar an der Zeile.
                umfeld = zeilen[max(0, nr - 4):nr]
                if any(VERMERK.search(z) for z in umfeld):
                    eintrag["vermerkt"] = True
    return gefunden


def main():
    argumente = set(sys.argv[1:])
    ergaenzungen = gefundene_ergaenzungen()
    prosa = prosa_text()

    luecken = []
    gedeckt = []
    for (unit, conf), eintrag in sorted(ergaenzungen.items()):
        belege = [p for p, text in prosa if conf in text]
        zeile = {
            "unit": unit, "conf": conf, "belege": belege,
            "orte": eintrag["orte"], "vermerkt": eintrag["vermerkt"],
            "nur_alt": not (eintrag["wege"] & set(WEGE_HEUTE)),
        }
        if belege or eintrag["vermerkt"]:
            gedeckt.append(zeile)
        else:
            luecken.append(zeile)

    print("── Ergaenzungen an fremden Units, die keine Zeile Prosa nennt ──")
    for z in luecken:
        print(f"  * {z['unit']}.d/{z['conf']}")
        print(f"      geschrieben von: {', '.join(z['orte'])}")
        if z["nur_alt"]:
            print("      (nur auf den aelteren Wegen — eine frische Box hat sie nicht)")

    if "--alle" in argumente:
        print()
        print("── gedeckt ──")
        for z in gedeckt:
            wie = "VERMERKT" if z["vermerkt"] else ", ".join(z["belege"])
            print(f"  * {z['unit']}.d/{z['conf']}  →  {wie}")

    print()
    if not ergaenzungen:
        # Kein Fund ist hier NICHT gruen: die Wege schrieben am 30.08.2026
        # vier Ergaenzungen. Null heisst, das Muster greift nicht mehr.
        print("WARNUNG: kein einziger Ergaenzungspfad gefunden — greift das "
              "Muster noch? (Wege: " + ", ".join(WEGE) + ")")
        return 1
    if luecken:
        print(f"{len(luecken)} von {len(ergaenzungen)} Ergaenzungen stehen in keiner Prosa.")
        return 1
    print(f"KEINE LUECKE. {len(ergaenzungen)} Ergaenzungen, alle benannt "
          "(--alle zeigt sie).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
