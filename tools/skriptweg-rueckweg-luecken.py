#!/usr/bin/env python3
"""Was der Skript-Rueckweg NICHT zurueckholt — gemessen, nicht gelesen.

tools/skriptweg-sandkasten.py belegt den Hinweg: rename statt cp, Rechte vom
Ziel, Verweise unangetastet, fremde Dateien ueberleben. Dieses Werkzeug fragt
die andere Richtung, und zwar die Faelle, in denen der Rueckweg NICHTS meldet:

  A  EINE FREMDE ….zurueck WIRD BEIM HINWEG GELOESCHT.
     `modus_skripte_zurueck` ueberspringt sorgfaeltig jede Rueckdreh-Erzeugung,
     die nicht im Merkzettel steht. `modus_skripte_tauschen` loescht sie ohne
     ein Wort, bevor es seine eigene anlegt. Auf DIESER Box liegt genau so eine:
     /usr/local/bin/mupibox/mupibox-sicherung.py.zurueck (eigener Inode, aus
     einer Kopie von Hand). Der Schutz gilt also nur in einer Richtung.

  B  NEUE DATEIEN KOMMEN NIE WIEDER WEG.
     Eine Datei, die auf der Box noch nicht lag (--auch-neue), hat nichts, was
     man vertauschen koennte — es entsteht keine ….zurueck. Der Rueckweg sucht
     aber genau danach (`find … -name '*.zurueck'`). Was er nicht findet,
     meldet er auch nicht: die Datei bleibt liegen, und der Bericht sagt
     „Zurueckgedreht" ohne sie zu erwaehnen.

  C  DER MERKZETTEL WIRD BEI JEDEM LAUF UEBERSCHRIEBEN.
     Er wird mit "w" geschrieben und traegt nur die Ziele DIESES Laufs. Nach
     einem zweiten Lauf gelten die Dateien des ersten als „nicht von diesem
     Weg" — obwohl sie es waren. Ihre ….zurueck bleibt liegen und der Rueckweg
     ruehrt sie nicht mehr an.

Es wird der ECHTE Boxhelfer ausgefuehrt, keine Nachbildung — eine Kopie
koennte richtig sein, waehrend das Original falsch ist.

WOHER DER HELFER KOMMT (25.08.2026): frueher stand er als Zeichenkette
`BOXHELFER = r'''…'''` mitten in `tools/ausliefern.py`, und diese Wache schnitt
ihn dort heraus. Mit E42 zog er in eine eigene Datei
(`scripts/box/mupibox-tauscher.py`); `ausliefern.py` LIEST sie nur noch ein.
Die Wache suchte weiter die alte Naht, fand sie nicht und starb im
`helfer_laden` mit einem ValueError — nicht rot, sondern gar kein Urteil. Sie
haengt in keinem Laeufer, darum fiel es 9 Tage lang niemandem auf
(llmwiki: `wache-die-nirgends-laeuft-rostet-auf-einem-fehlalarm`). Jetzt
wird die Datei direkt
gelesen; fehlt sie, bricht die Wache mit einer Ansage ab statt mit einem
Stapelabzug.

BERUEHRT DIE BOX NICHT. Alles unter einem Ordner in /tmp.

    python3 tools/skriptweg-rueckweg-luecken.py
    python3 tools/skriptweg-rueckweg-luecken.py --behalten
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
AUSLIEFERN = WURZEL / "tools" / "ausliefern.py"
# DIESELBE DATEI, die ausliefern.py einliest (dort: TAUSCHER). Ein zweiter
# Pfad hier waere eine zweite Wahrheit — bricht der eine, muss der andere
# mitbrechen, und genau das hat er beim E42-Umzug nicht getan.
TAUSCHER = WURZEL / "scripts" / "box" / "mupibox-tauscher.py"

gruen = 0
rot = 0


def sagen(erwartet, bekommen, was: str) -> None:
    global gruen, rot
    if erwartet == bekommen:
        gruen += 1
        print(f"  gruen  {was}")
    else:
        rot += 1
        print(f"  ROT    {was}\n         erwartet: {erwartet!r}\n         bekommen: {bekommen!r}")


def erwarte(bedingung: bool, was: str) -> None:
    sagen(True, bool(bedingung), was)


def helfer_laden(datei: Path) -> dict:
    """Den Boxhelfer aus scripts/box/mupibox-tauscher.py holen und ausfuehren."""
    if not datei.exists():
        raise SystemExit(
            f"Der Tauscher fehlt: {datei}\n"
            f"Ohne ihn hat diese Wache nichts zu messen — und ein stiller "
            f"Abbruch waere schlimmer als gar keine Wache."
        )
    quelle = datei.read_text(encoding="utf-8")
    # Der Helfer ruft am Ende `main()` auf und liest dabei stdin — diese eine
    # Zeile faellt weg. Alles darueber ist unveraendert der Code von der Box.
    if "\nmain()\n" not in quelle:
        raise SystemExit(
            f"In {datei} steht kein `main()`-Aufruf am Ende mehr. Die Naht, an "
            f"der diese Wache schneidet, hat sich geaendert — hier nachsehen, "
            f"statt der Wache zu glauben."
        )
    code = quelle.replace("\nmain()\n", "\n")
    raum: dict = {"__name__": "boxhelfer"}
    exec(compile(code, str(datei), "exec"), raum)  # noqa: S102
    return raum


def bauen(ordner: Path) -> dict:
    """Ein nachgestelltes /usr/local/bin/mupibox mit Lager daneben."""
    ziel = ordner / "usr-local-bin-mupibox"
    lager = ordner / "lager"
    ziel.mkdir(parents=True, exist_ok=True)
    lager.mkdir(parents=True, exist_ok=True)
    return {"ziel": ziel, "lager": lager}


# ── A  Der Hinweg loescht eine fremde Rueckdreh-Erzeugung ────────────────────

def probe_fremde_zurueck_ueberlebt_den_hinweg(h: dict, ordner: Path) -> None:
    print("\nA · Eine FREMDE ….zurueck neben dem Ziel — ueberlebt sie den Tausch?")
    s = bauen(ordner / "a")
    ziel = s["ziel"] / "mupibox-sicherung.py"
    ziel.write_text("#!/usr/bin/env python3\nprint('ALT')\n")
    os.chmod(ziel, 0o755)
    # Genau die Lage auf der Box: eine Sicherung VON HAND, eigener Inode.
    fremd = Path(str(ziel) + ".zurueck")
    fremd.write_text("#!/usr/bin/env python3\nprint('VON HAND GESICHERT')\n")
    fremd_inode = fremd.stat().st_ino
    erwarte(fremd_inode != ziel.stat().st_ino,
            "Ausgangslage wie auf der Box: die fremde .zurueck ist ein EIGENER Inode")

    neu = s["lager"] / "mupibox-sicherung.py"
    neu.write_text("#!/usr/bin/env python3\nprint('NEU')\n")
    befund = h["modus_skripte_tauschen"]({"dateien": [{
        "name": "mupibox-sicherung.py", "quelle": str(neu), "ziel": str(ziel),
        "modus": "0755", "uid": os.getuid(), "gid": os.getgid()}],
        "merkzettel": str(s["ziel"] / "merkzettel.json"), "stempel": "probe"})

    beiseite = Path(str(ziel) + ".zurueck.fremd")
    erwarte(beiseite.is_file(), "die fremde Sicherung liegt beiseite, nicht im Muell")
    erwarte(beiseite.exists() and "VON HAND GESICHERT" in beiseite.read_text(),
            "und sie traegt unveraendert ihren Inhalt")
    sagen([{"war": str(ziel) + ".zurueck", "jetzt": str(beiseite)}],
          befund["fremde_beiseite"], "der Bericht nennt sie — sie verschwindet nicht still")
    sagen("ALT", Path(str(ziel) + ".zurueck").read_text().split("'")[1],
          "die eigene .zurueck haelt jetzt den Stand von vorher")

    # ZWEITER LAUF am selben Ziel: jetzt ist die .zurueck die EIGENE. Sie darf
    # ohne Aufhebens weichen, sonst wuechse bei jedem Lauf eine Halde.
    neu2 = s["lager"] / "zweite.py"
    neu2.write_text("#!/usr/bin/env python3\nprint('NEU2')\n")
    b2 = h["modus_skripte_tauschen"]({"dateien": [{
        "name": "mupibox-sicherung.py", "quelle": str(neu2), "ziel": str(ziel),
        "modus": "0755", "uid": os.getuid(), "gid": os.getgid()}],
        "merkzettel": str(s["ziel"] / "merkzettel.json"), "stempel": "probe2"})
    sagen([], b2["fremde_beiseite"],
          "der zweite Lauf legt die EIGENE .zurueck nicht auch noch beiseite")
    sagen("NEU", Path(str(ziel) + ".zurueck").read_text().split("'")[1],
          "sie haelt jetzt den Stand, der eben lief")


# ── B  Neue Dateien nach dem Rueckweg ────────────────────────────────────────

def probe_neue_datei_kommt_zurueck(h: dict, ordner: Path) -> None:
    print("\nB · Eine NEUE Datei (--auch-neue) — nimmt der Rueckweg sie wieder mit?")
    s = bauen(ordner / "b")
    ziel = s["ziel"] / "piper-einrichten.sh"
    neu = s["lager"] / "piper-einrichten.sh"
    neu.write_text("#!/bin/bash\necho NEU\n")
    erwarte(not ziel.exists(), "vorher liegt am Ziel nichts (so wie die 5 NEU-Dateien)")

    befund = h["modus_skripte_tauschen"]({"dateien": [{
        "name": "piper-einrichten.sh", "quelle": str(neu), "ziel": str(ziel),
        "modus": "0755", "uid": os.getuid(), "gid": os.getgid()}],
        "merkzettel": str(s["ziel"] / "merkzettel.json"), "stempel": "probe"})
    sagen(["piper-einrichten.sh"], befund["getauscht"], "sie wurde angelegt")
    erwarte(ziel.is_file(), "sie liegt jetzt am Ziel")
    erwarte(not Path(str(ziel) + ".zurueck").exists(),
            "es entstand KEINE .zurueck (es gab nichts zu sichern)")

    zettel_pfad = s["ziel"] / "merkzettel.json"
    zettel = json.loads(zettel_pfad.read_text())
    eintrag = next((e for e in zettel["eintraege"] if e["ziel"] == str(ziel)), None)
    erwarte(eintrag is not None, "der Merkzettel nennt sie")
    erwarte(bool(eintrag and eintrag["neu"]),
            "und merkt sich, dass vorher NICHTS da lag — sonst waere sie nicht zu finden")
    erwarte(bool(eintrag and eintrag["sha"]),
            "samt Stand, an dem sich spaeter erkennen laesst, ob jemand daran war")

    # Die .zurueck-Suche des Rueckwegs findet sie NICHT — es gibt keine. Genau
    # deshalb braucht er den Merkzettel als zweite Quelle.
    gefunden = {str(q)[: -len(".zurueck")] for q in s["ziel"].glob("*.zurueck")}
    erwarte(str(ziel) not in gefunden,
            "ueber die .zurueck-Suche allein waere sie unauffindbar (darum der Merkzettel)")

    zurueck = h["modus_skripte_zurueck"]({
        "dateien": [], "entfernen": [{"ziel": str(ziel), "sha": eintrag["sha"]}],
        "merkzettel": str(zettel_pfad), "stempel": "zurueck"})
    sagen([str(ziel)], zurueck["entfernt"], "der Rueckweg meldet sie als entfernt")
    erwarte(not ziel.exists(), "nach dem Rueckweg ist sie wieder weg")
    erwarte(not json.loads(zettel_pfad.read_text())["eintraege"],
            "und der Merkzettel kennt sie nicht mehr")

    # GEGENPROBE: hat seither jemand daran gearbeitet, bleibt sie liegen.
    ziel.write_text("#!/bin/bash\necho VON HAND WEITERGEBAUT\n")
    z2 = h["modus_skripte_zurueck"]({
        "dateien": [], "entfernen": [{"ziel": str(ziel), "sha": eintrag["sha"]}]})
    sagen([], z2["entfernt"], "eine seither veraenderte Datei wird NICHT entfernt")
    erwarte(bool(z2["nicht_entfernt"]) and "veraendert" in z2["nicht_entfernt"][0]["grund"],
            "sondern mit Begruendung genannt")
    erwarte(ziel.is_file(), "und sie liegt noch da")


# ── C  Der Merkzettel und der zweite Lauf ────────────────────────────────────

def probe_merkzettel_zweiter_lauf(h: dict, ordner: Path) -> None:
    print("\nC · Zwei Laeufe hintereinander — kennt der Merkzettel noch den ersten?")
    s = bauen(ordner / "c")
    zettel = s["ziel"] / "merkzettel.json"
    ziele = {}
    for name in ("erster.sh", "zweiter.sh"):
        z = s["ziel"] / name
        z.write_text(f"#!/bin/bash\necho ALT {name}\n")
        os.chmod(z, 0o755)
        q = s["lager"] / name
        q.write_text(f"#!/bin/bash\necho NEU {name}\n")
        ziele[name] = (z, q)

    for name in ("erster.sh", "zweiter.sh"):        # zwei getrennte Laeufe
        z, q = ziele[name]
        h["modus_skripte_tauschen"]({"dateien": [{
            "name": name, "quelle": str(q), "ziel": str(z),
            "modus": "0755", "uid": os.getuid(), "gid": os.getgid()}],
            "merkzettel": str(zettel), "stempel": "lauf-" + name})

    gemerkt = {e["ziel"] for e in json.loads(zettel.read_text())["eintraege"]}
    for name in ("erster.sh", "zweiter.sh"):
        erwarte(Path(str(ziele[name][0]) + ".zurueck").is_file(),
                f"{name}: eine .zurueck aus dem eigenen Lauf liegt da")
    erwarte(str(ziele["zweiter.sh"][0]) in gemerkt,
            "der Merkzettel kennt die Datei aus dem ZWEITEN Lauf")
    erwarte(str(ziele["erster.sh"][0]) in gemerkt,
            "…und die aus dem ERSTEN Lauf auch noch")


def main() -> int:
    t = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    t.add_argument("--behalten", action="store_true", help="den Sandkasten stehen lassen")
    a = t.parse_args()

    ordner = Path(tempfile.mkdtemp(prefix="skriptweg-rueckweg-"))
    print(f"Sandkasten: {ordner}")
    print("Es wird KEINE Verbindung zur Box aufgebaut.")

    h = helfer_laden(TAUSCHER)
    fehlt = [n for n in ("modus_skripte_tauschen", "modus_skripte_zurueck")
             if n not in h]
    if fehlt:
        print(f"ROT: dem Boxhelfer fehlen {fehlt}")
        return 1

    try:
        probe_fremde_zurueck_ueberlebt_den_hinweg(h, ordner)
        probe_neue_datei_kommt_zurueck(h, ordner)
        probe_merkzettel_zweiter_lauf(h, ordner)
    finally:
        if a.behalten:
            print(f"\nSandkasten bleibt stehen: {ordner}")
        else:
            shutil.rmtree(ordner, ignore_errors=True)

    print(f"\ngruen: {gruen}, rot: {rot}")
    return 0 if rot == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
