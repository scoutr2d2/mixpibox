#!/usr/bin/env python3
"""
RICHTEN DIE VIER ROOT-SKRIPTE AN DER BRUECKE SCHADEN AN?

WOZU DIESES WERKZEUG:
Seit E18 Stufe 3 liegt der Bestand der gemerkten Stellen in
`server/config/profile/<kennung>/resume.json`. Am ALTEN Ort steht nur noch ein
VERWEIS darauf — die BRUECKE. Sie ist die einzige Stelle, an der sich der
Server und vier root-Skripte noch treffen, die den neuen Pfad NIE lernen
werden: `update/start_mupibox_update.sh` und `autosetup/autosetup.sh` schieben
mit `mv ${MUPI_SRC}/scripts/mupibox/*` bei jedem Update die Upstream-Fassung
aller vier zurueck.

„Die Skripte richten keinen Schaden an" ist damit eine BEHAUPTUNG UEBER FREMDEN
CODE, den man nicht aendern darf. So etwas liest man nicht nach, man misst es —
und zwar mit den ECHTEN Skripten aus dem Baum, nicht mit einer Nacherzaehlung.
Genau daran ist die Vorgaenger-Messung schon einmal gescheitert
([[attrappe-luegt-durch-weglassen]]).

WAS GEAENDERT WIRD, UM SIE UEBERHAUPT LAUFEN ZU LASSEN — und nur das:
  * die vier fest verdrahteten Pfade (Konfigverzeichnis, /tmp) zeigen in den
    Sandkasten,
  * `check_network.sh` ist ein Dauerlaeufer: `while true` und `sleep 10` fallen
    weg, damit GENAU EIN Takt laeuft. Der Rumpf bleibt Wort fuer Wort stehen.
  * `check_network.py` wird durch ein Zweizeilen-Skript ersetzt, das `true`
    bzw. `false` ausgibt — dieselbe Ausgabe wie das Original (siehe die Falle
    unten),
  * die `$EUID`-Wache und `sudo`/`chown` fallen weg (kein root im Sandkasten).
Der Rest — jede jq-Kette, jedes `mv`, jedes `ln -s` — laeuft im Wortlaut.

DIE FALLE, UEBER DIE HIER NIEMAND STOLPERN SOLL:
`if ( $(check_network.py) == ${TRUESTATE} )` ist KEIN Vergleich. Die Klammern
sind eine Subshell, die Ausgabe wird als KOMMANDO ausgefuehrt; `==` und
`online` sind blosse Argumente. Es funktioniert nur, weil das Python-Skript
`true`/`false` ausgibt und das zwei Kommandos mit passenden Rueckgabewerten
sind. Der Ersatz hier gibt deshalb ebenfalls `true`/`false` aus.

    python3 tools/resume-bruecke-probe.py            # Messreihe, ausfuehrlich
    python3 tools/resume-bruecke-probe.py --pruefen  # gruen/rot, fuer pruefen.sh
    python3 tools/resume-bruecke-probe.py --behalten # Sandkasten stehenlassen
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time as _zeit
from pathlib import Path

BAUM = Path(__file__).resolve().parent.parent
SKRIPTE = BAUM / "scripts" / "mupibox"
BOX_KONFIG = "/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config"

# Der Bestand zweier Kinder. Die Feldnamen sind die ECHTEN aus resume.json der
# Box; `type` entscheidet, was ohne Netz uebrig bleibt (library bleibt, spotify
# nicht) — daran haengt die Offline-Liste.
GAST = [
    {"type": "spotify", "category": "resume", "id": "g1", "title": "Bibi Blocksberg",
     "resumespotifytrack_number": 3, "resumespotifyprogress_ms": 1000,
     "resumespotifyduration_ms": 900000},
    {"type": "library", "category": "resume", "id": "g2", "title": "Die Maus",
     "resumespotifytrack_number": 1, "resumespotifyprogress_ms": 500,
     "resumespotifyduration_ms": 900000},
]
KALEA = [
    {"type": "library", "category": "resume", "id": "k1", "title": "Pettersson",
     "resumespotifytrack_number": 2, "resumespotifyprogress_ms": 700,
     "resumespotifyduration_ms": 900000},
]


class Befund:
    """Sammelt Behauptung + Messung, damit am Ende EINE Zahl dasteht."""

    def __init__(self) -> None:
        self.zeilen: list[tuple[bool, str, str]] = []

    def prueft(self, gut: bool, was: str, gemessen: str) -> None:
        self.zeilen.append((gut, was, gemessen))

    def ausgeben(self) -> int:
        schlecht = 0
        for gut, was, gemessen in self.zeilen:
            if not gut:
                schlecht += 1
            print(f"  {'OK  ' if gut else 'ROT '} {was}")
            print(f"        gemessen: {gemessen}")
        print()
        if schlecht:
            print(f"  {schlecht} von {len(self.zeilen)} Messungen widersprechen der Behauptung.")
        else:
            print(f"  {len(self.zeilen)} Messungen, alle wie behauptet.")
        return 1 if schlecht else 0


def liste(p: Path) -> list | None:
    """Was steht drin? `None`, wenn es die Datei nicht gibt oder sie unlesbar ist."""
    try:
        roh = json.loads(p.read_text())
        return roh if isinstance(roh, list) else None
    except Exception:
        return None


def art(p: Path) -> str:
    """Verweis, Datei oder nichts — mit `lstat`, denn auf einem TOTEN Verweis
    luegt jede Existenzpruefung."""
    if p.is_symlink():
        return f"Verweis -> {os.readlink(p)}" + ("" if p.exists() else "  (TOT)")
    if p.exists():
        return "echte Datei"
    return "fehlt"


def herrichten(quelle: Path, konf: Path, tm: Path, einmal: bool = False) -> Path:
    """Ein Skript aus dem Baum in den Sandkasten biegen — Pfade, sonst nichts."""
    text = quelle.read_text()
    text = text.replace(BOX_KONFIG, str(konf))
    text = text.replace("/tmp/network.json", str(tm / "network.json"))
    text = text.replace("/tmp/.data.lock", str(tm / ".data.lock"))
    text = text.replace("/tmp/.resume.lock", str(tm / ".resume.lock"))
    # ZWEI ZEILEN FUER DENSELBEN ZWISCHENSPEICHER, und beide werden gebraucht:
    # bis zum 07.08.2026 stand in remove_max_resume.sh ein FESTER Name
    # (`/tmp/.resume.json`), seither legt `mktemp` ihn in `TMP_DIR` an. Die
    # erste Zeile biegt die alte Fassung (Gegenproben lesen sie mit `git show`),
    # die zweite die heutige.
    text = text.replace("/tmp/.resume.json", str(tm / ".resume.json"))
    text = text.replace('TMP_DIR="${TMP_DIR:-/tmp}"', f'TMP_DIR="{tm}"')
    text = text.replace("/etc/mupibox/mupiboxconfig.json", str(konf / "mupiboxconfig.json"))
    text = text.replace("/usr/local/bin/mupibox/check_network.py", str(tm / "check_network.py"))
    # Kein root im Sandkasten: die Wache und alles, was Eigentum umschreibt.
    text = text.replace('if [ "$EUID" -ne 0 ]\n  then echo "Please run as root"\n  exit\nfi', "")
    text = text.replace("sudo /usr/bin/jq", "jq").replace("sudo /usr/bin/", "").replace("sudo ", "")
    text = "\n".join(z for z in text.splitlines() if "chown" not in z and "chmod" not in z)
    if einmal:
        # Der Dauerlaeufer wird zu EINEM Takt. Der Rumpf bleibt unveraendert.
        text = text.replace("while true\ndo\n", "").replace("\tsleep 10\ndone", "")
    # Der Netzteil (ip/iw/iwconfig) gehoert nicht zur Frage und braucht Geraete.
    text = text.split("\nGW=")[0] + "\n"
    ziel = tm / quelle.name
    ziel.write_text(text)
    ziel.chmod(0o755)
    return ziel


def netzschalter(tm: Path, online: bool) -> None:
    """
    Der Ersatz fuer check_network.py — er gibt `true`/`false` aus, wie das
    Original, und muss deshalb PYTHON sein: das Skript ruft es mit
    `/usr/bin/python3 …` auf. Ein Shell-Zweizeiler stuerbe hier lautlos ab, und
    `if ( $(…) == online )` faende dann den OFFLINE-Zweig — eine Messung, die
    behauptet, online gemessen zu haben, und offline gemessen hat.
    """
    (tm / "check_network.py").write_text('print("' + ("true" if online else "false") + '")\n')
    (tm / "check_network.py").chmod(0o755)


def aufbauen(tmp: Path) -> tuple[Path, Path]:
    """Ein Konfigverzeichnis, wie der Server es nach dem Umzug hinterlaesst."""
    konf, tm = tmp / "config", tmp / "tmp"
    (konf / "profile" / "gast").mkdir(parents=True)
    (konf / "profile" / "kalea").mkdir(parents=True)
    tm.mkdir()
    (konf / "profile" / "gast" / "resume.json").write_text(json.dumps(GAST, indent=4))
    (konf / "profile" / "kalea" / "resume.json").write_text(json.dumps(KALEA, indent=4))
    (konf / "data.json").write_text("[]")
    (konf / "mupiboxconfig.json").write_text(json.dumps({"mupibox": {"resume": 1}}))
    # DIE BRUECKE — relativ, genau wie server.ts sie legt.
    (konf / "resume.json").symlink_to("profile/gast/resume.json")
    (tm / "network.json").write_text('{"onlinestate":"starting"}')
    return konf, tm


def bruecke_legen(konf: Path, kennung: str) -> None:
    """Was `resumeBrueckeRichten` tut, auf das Noetigste eingedampft: Verweis
    ersetzen, ohne dass der alte Ort je unbesetzt ist."""
    zwischen = konf / "resume.json.bruecke"
    if zwischen.is_symlink() or zwischen.exists():
        zwischen.unlink()
    zwischen.symlink_to(f"profile/{kennung}/resume.json")
    os.rename(zwischen, konf / "resume.json")


def messen(behalten: bool) -> int:
    tmp = Path(tempfile.mkdtemp(prefix="resume-bruecke-"))
    b = Befund()
    try:
        # ── 1. get_network.sh: legt es den leeren Stummel an? ───────────────
        konf, tm = aufbauen(tmp / "a")
        gn = herrichten(SKRIPTE / "get_network.sh", konf, tm)
        subprocess.run(["bash", str(gn)], capture_output=True, text=True)
        b.prueft(
            (konf / "resume.json").is_symlink(),
            "get_network.sh laesst die Bruecke stehen (kein leerer Stummel)",
            f"alter Ort: {art(konf / 'resume.json')}",
        )
        b.prueft(
            liste(konf / "profile" / "gast" / "resume.json") == GAST,
            "und der Bestand des Gasts ist unangetastet",
            f"{len(liste(konf / 'profile/gast/resume.json') or [])} Eintraege",
        )
        offl = liste(konf / "offline_resume.json")
        b.prueft(
            offl is not None and [e["id"] for e in offl] == ["g2"],
            "die Offline-Liste entsteht aus dem Bestand des AKTIVEN Kindes",
            f"offline_resume.json: {[e['id'] for e in offl] if offl is not None else 'unlesbar/fehlt'}",
        )

        # ── 2. check_network.sh online: der Verweis auf den Verweis ─────────
        konf, tm = aufbauen(tmp / "b")
        cn = herrichten(SKRIPTE / "check_network.sh", konf, tm, einmal=True)
        netzschalter(tm, True)
        subprocess.run(["bash", str(cn)], capture_output=True, text=True)
        av = konf / "active_resume.json"
        b.prueft(
            av.is_symlink() and liste(av) == GAST,
            "check_network.sh (online): active_resume -> Bruecke -> Bereich loest auf",
            f"{art(av)}; darueber lesbar: {len(liste(av) or [])} Eintraege",
        )
        b.prueft(
            (konf / "resume.json").is_symlink(),
            "und die Bruecke selbst bleibt eine Bruecke",
            f"alter Ort: {art(konf / 'resume.json')}",
        )

        # ── 3. check_network.sh offline ─────────────────────────────────────
        konf, tm = aufbauen(tmp / "c")
        cn = herrichten(SKRIPTE / "check_network.sh", konf, tm, einmal=True)
        netzschalter(tm, False)
        subprocess.run(["bash", str(cn)], capture_output=True, text=True)
        av = konf / "active_resume.json"
        gelesen = liste(av)
        b.prueft(
            av.is_symlink() and gelesen is not None and [e["id"] for e in gelesen] == ["g2"],
            "check_network.sh (offline): active_resume -> offline_resume, aus dem Bereich erzeugt",
            f"{art(av)}; darueber lesbar: {[e['id'] for e in gelesen] if gelesen is not None else 'unlesbar'}",
        )

        # ── 4. WELCHEN Zeitstempel liest `stat` auf einer Bruecke? ──────────
        #
        # DIE ANNAHME, DIE HIER FAST DURCHGERUTSCHT WAERE: „`stat` folgt dem
        # Verweis, misst also den Bestand dahinter." Sie ist FALSCH — GNU `stat`
        # braucht dafuer `-L`, und keines der beiden Skripte gibt es an. Sie
        # messen die BRUECKE SELBST. Das ist keine Spitzfindigkeit: der
        # Zeitstempel eines Verweises steht fest, seit er gelegt wurde. Ohne
        # Zutun bliebe die Offline-Liste also auf dem Stand des letzten
        # PROFILWECHSELS stehen, waehrend die gemerkten Stellen weiterwandern —
        # ein Fehler, den man erst ohne Netz und erst Wochen spaeter saehe.
        # Vor dem Umzug gab es ihn nicht: da war der alte Ort eine echte Datei.
        konf, tm = aufbauen(tmp / "d")
        gn = herrichten(SKRIPTE / "get_network.sh", konf, tm)
        subprocess.run(["bash", str(gn)], capture_output=True, text=True)

        # DIE UHREN AUSEINANDERZIEHEN, sonst misst man die Sekundenaufloesung
        # von `stat --format='%Y'` statt der Frage:
        #   Bruecke        vor einer Stunde gelegt (der letzte Profilwechsel)
        #   Offline-Liste  kurz danach geschrieben (der letzte Netzwechsel)
        #   Bestand        gerade eben geaendert (ein neuer Merkpunkt)
        vorhin = _zeit.time() - 3600
        os.utime(konf / "resume.json", (vorhin, vorhin), follow_symlinks=False)
        os.utime(konf / "offline_resume.json", (vorhin + 60, vorhin + 60))
        (konf / "profile" / "gast" / "resume.json").write_text(json.dumps(KALEA, indent=4))

        gemessen = subprocess.run(
            ["stat", "--format=%Y", str(konf / "resume.json")], capture_output=True, text=True
        ).stdout.strip()
        b.prueft(
            gemessen == str(int(os.lstat(konf / "resume.json").st_mtime))
            and gemessen != str(int(os.stat(konf / "profile" / "gast" / "resume.json").st_mtime)),
            "`stat --format=%Y` auf der Bruecke misst den VERWEIS, nicht sein Ziel",
            f"stat: {gemessen}, lstat(Verweis): {int(os.lstat(konf / 'resume.json').st_mtime)}, "
            f"stat(Ziel): {int(os.stat(konf / 'profile/gast/resume.json').st_mtime)}",
        )

        subprocess.run(["bash", str(gn)], capture_output=True, text=True)
        ohne = liste(konf / "offline_resume.json")
        b.prueft(
            ohne is not None and [e["id"] for e in ohne] == ["g2"],
            "ein neuer Merkpunkt ALLEIN frischt die Offline-Liste NICHT auf (der Grund fuer resumeBrueckeAuffrischen)",
            f"Bestand jetzt k1, Offline-Liste: {[e['id'] for e in ohne] if ohne is not None else 'unlesbar'}",
        )

        # Und jetzt dasselbe mit dem, was der Server tut: `lutimes` auf den
        # VERWEIS (nicht `utimes`, das folgte ihm und faerbte das Ziel).
        jetzt = _zeit.time()
        os.utime(konf / "resume.json", (jetzt, jetzt), follow_symlinks=False)
        subprocess.run(["bash", str(gn)], capture_output=True, text=True)
        mit = liste(konf / "offline_resume.json")
        b.prueft(
            mit is not None and [e["id"] for e in mit] == ["k1"],
            "mit `lutimes` auf der Bruecke folgt die Offline-Liste dem Bestand",
            f"Offline-Liste: {[e['id'] for e in mit] if mit is not None else 'unlesbar'}",
        )

        # ── 5. Die Skripte, die die Bruecke ANFASSEN ────────────────────────
        #
        # HIER STAND: „Beide schreiben ihr Ergebnis mit `mv` ueber den alten
        # Ort. Der Verweis ist danach weg." Das galt fuer
        # `remove_max_resume.sh` bis zum 07.08.2026 und fuer `clearresume.sh`
        # bis zum 19.09.2026. HEUTE GILT ES FUER KEINES DER BEIDEN MEHR.
        #
        # UND DAS IST DIE LEHRE AUS DEM 19.09.: Als clearresume.sh gerichtet
        # wurde, zog die Wache davor (tools/wer-hoert-wechsel-fremde-stellen.mjs)
        # mit — DIESE hier aber nicht, und sie meldete am selben Abend rot.
        # Dieselbe falsche Annahme lag an ZWEI Stellen, und beim Richten wurde
        # nur die eine gesucht, die den Fehler gemeldet hatte. Wer ein
        # Verhalten aendert, muss nach ALLEN Stellen suchen, die es behaupten,
        # nicht nach der einen, ueber die man gestolpert ist.
        #
        # `resumeUebernehmen` in server.ts bleibt trotzdem noetig — aber aus
        # einem anderen Grund als hier frueher stand: nicht wegen der Skripte
        # in DIESEM Baum, sondern wegen der UPSTREAM-Fassung, die jedes
        # Update per `mv` einspielt (gemessen in tools/e18s3-gegenprobe.py
        # --nur A), und wegen Boxen, auf denen vor dem Update noch die alte
        # Fassung lief und eine echte Datei am alten Ort hinterliess.
        #
        # `remove_max_resume.sh` GING ALS ERSTES DEN ANDEREN WEG, und diese
        # Messung ist mitgezogen worden, weil sie sonst eine Behauptung ueber
        # eine Fassung waere, die es nicht mehr gibt:
        #   * Es schreibt mit `cat >` DURCH den Verweis — der bleibt stehen.
        #   * Und es laeuft ueber ALLE `profile/*/resume.json`, jedes mit
        #     SEINER Zahl (`Profil.merken`, sonst `mupibox.resume`). Vorher
        #     traf es nur das Kind, auf das die Bruecke gerade zeigte.
        # Beides gemessen in `tools/merken-je-kind.py` (Teil F, samt
        # Gegenprobe gegen HEAD); hier steht nur, was es fuer die BRUECKE
        # bedeutet. `aufbauen` legt kein profile.json an — also hat kein Kind
        # eine eigene Zahl, und fuer alle gilt der Deckel 1 aus der
        # mupiboxconfig.
        konf, tm = aufbauen(tmp / "e")
        rm = herrichten(SKRIPTE / "remove_max_resume.sh", konf, tm)
        subprocess.run(["bash", str(rm)], capture_output=True, text=True)
        b.prueft(
            (konf / "resume.json").is_symlink()
            and os.readlink(konf / "resume.json") == "profile/gast/resume.json",
            "remove_max_resume.sh LAESST die Bruecke stehen (seit 07.08.2026, `cat >`)",
            f"alter Ort: {art(konf / 'resume.json')}",
        )
        b.prueft(
            len(liste(konf / "profile" / "gast" / "resume.json") or []) == 1,
            "das Kind, auf das die Bruecke zeigt, ist gekappt (Deckel 1)",
            f"gast: {len(liste(konf / 'profile/gast/resume.json') or [])} Eintraege",
        )
        b.prueft(
            len(liste(konf / "profile" / "kalea" / "resume.json") or []) == 1,
            "UND DAS ANDERE KIND AUCH — es wird nicht mehr uebersehen",
            f"kalea: {len(liste(konf / 'profile/kalea/resume.json') or [])} Eintraege",
        )

        konf, tm = aufbauen(tmp / "f")
        cr = herrichten(SKRIPTE / "clearresume.sh", konf, tm)
        subprocess.run(["bash", str(cr)], capture_output=True, text=True)
        leer = liste(konf / "resume.json")
        b.prueft(
            (konf / "resume.json").is_symlink()
            and os.readlink(konf / "resume.json") == "profile/gast/resume.json"
            and leer == [],
            "clearresume.sh LAESST die Bruecke ebenfalls stehen (seit 19.09.2026, `cat >`)",
            f"alter Ort: {art(konf / 'resume.json')}, Inhalt: {leer}",
        )
        # Und die zweite Haelfte, ohne die die erste zu wenig sagt: der
        # Verweis darf stehen und die Liste leer sein — geleert werden muss
        # aber die Datei DAHINTER, nicht irgendeine daneben. Stuende hier nur
        # `is_symlink()`, waere ein Skript gruen, das den Verweis anfasst und
        # sonst nichts tut.
        b.prueft(
            liste(konf / "profile" / "gast" / "resume.json") == [],
            "… und geleert ist die Datei DES KINDES, hinter dem Verweis",
            f"profile/gast/resume.json: {liste(konf / 'profile/gast/resume.json')}",
        )

        # ── 6. Ein Kind, das noch nichts angefangen hat ─────────────────────
        #
        # Dann zeigt die Bruecke auf eine Datei, die es NOCH NICHT GIBT — ein
        # toter Verweis, und auf dem luegt jede Existenzpruefung. `[ ! -f ]` ist
        # dort wahr, get_network.sh schreibt also. WOHIN, ist die Frage: durch
        # den Verweis hindurch (dann entsteht der Bestand des Kindes) oder
        # daneben (dann laege wieder eine echte Datei am alten Ort). Gemessen
        # statt angenommen — davon haengt ab, ob dieser Zustand von selbst
        # ausheilt.
        konf, tm = aufbauen(tmp / "g")
        (konf / "profile" / "kalea" / "resume.json").unlink()
        bruecke_legen(konf, "kalea")
        b.prueft(
            not (konf / "resume.json").exists() and (konf / "resume.json").is_symlink(),
            "Vorbedingung: die Bruecke eines Kindes ohne Bestand ist TOT",
            art(konf / "resume.json"),
        )
        gn = herrichten(SKRIPTE / "get_network.sh", konf, tm)
        subprocess.run(["bash", str(gn)], capture_output=True, text=True)
        b.prueft(
            (konf / "resume.json").is_symlink() and liste(konf / "profile" / "kalea" / "resume.json") == [],
            "get_network.sh schreibt DURCH den toten Verweis — der Zustand heilt von selbst aus",
            f"alter Ort: {art(konf / 'resume.json')}, "
            f"profile/kalea/resume.json: {liste(konf / 'profile/kalea/resume.json')}",
        )

        print("\n══ WAS DER SERVER DARAUS ZU MACHEN HAT")
        print("""  `resumeUebernehmen` in server.ts bleibt der Auffangkorb: eine ECHTE Datei am
  alten Ort ist die Arbeit eines Skripts und gehoert in den Bereich geholt,
  bevor das naechste Lesen daran vorbeigeht. Seit dem 19.09.2026 erzeugt sie
  KEINES der vier Skripte in diesem Baum mehr — geblieben sind die
  UPSTREAM-Fassungen, die jedes Update per `mv` einspielt, und Boxen, auf
  denen vor dem Update die alte Fassung lief. Und weil ein geleerter Bestand
  legitim `[]` ist, darf die Uebernahme eine leere Liste NICHT abweisen — sie
  legt den bisherigen Stand daneben (`.vorher`).
  Dass der Server das wirklich tut, misst nicht dieses Werkzeug, sondern
  src/backend-api/src/bruecke.integration.spec.ts.""")
        return b.ausgeben()
    finally:
        if behalten:
            print(f"\n  (Sandkasten bleibt stehen: {tmp})")
        else:
            shutil.rmtree(tmp, ignore_errors=True)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--pruefen", action="store_true", help="nur gruen/rot, fuer tools/pruefen.sh")
    p.add_argument("--behalten", action="store_true", help="Sandkasten zum Nachsehen stehenlassen")
    a = p.parse_args()
    if not shutil.which("jq"):
        print("jq fehlt — ohne jq laesst sich keines der vier Skripte messen.")
        return 2
    print("══ DIE BRUECKE UND DIE VIER ROOT-SKRIPTE (echte Skripte aus scripts/mupibox)\n")
    schlecht = messen(a.behalten)
    if a.pruefen and schlecht:
        return 1
    return schlecht


if __name__ == "__main__":
    sys.exit(main())
