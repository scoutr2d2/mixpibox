#!/usr/bin/env python3
"""
E18 STUFE 3 GEGENGELESEN — drei Fragen, die `resume-bruecke-probe.py` offen laesst.

`tools/resume-bruecke-probe.py` misst die vier root-Skripte NACHEINANDER, mit
der Fassung, die im Baum liegt, und mit erfundenem Bestand. Das laesst drei
Fragen unbeantwortet, und jede davon ist eine, an der die Naht still brechen
kann:

  A  DIE ALTE FASSUNG. `update/start_mupibox_update.sh` schiebt mit
     `mv ${MUPI_SRC}/scripts/mupibox/*` die UPSTREAM-Fassung aller vier Skripte
     zurueck — die Fassung ohne die Reparaturen dieses Forks. Die Bruecke ist
     genau dafuer gebaut; ob sie es aushaelt, ist damit aber noch nicht
     gemessen. Gemessen wird hier mit den Dateien aus `5f9c7d8e~1`, also dem
     letzten Stand VOR dem ersten Eingriff dieses Forks in diese Skripte.

  B  DAS RENNEN. Die Skripte laufen im Takt (check_network.sh alle 10 s,
     get_network.sh je Anstoss), der Server schreibt, wenn ein Kind etwas
     hoert. Beide fassen denselben Namen an. Ob dabei etwas verlorengeht, ist
     keine Frage an den Quelltext, sondern eine an die Uhr: hier laeuft ein
     ECHTER Server gegen eine ECHTE Skriptschleife, und danach wird gezaehlt.

  C  DER ECHTE BESTAND. Ob der Umzug etwas verliert, laesst sich an erfundenen
     zwei Eintraegen nicht sehen. Diese Probe nimmt den Bestand einer echten
     Box (Vorgabe: eine Kopie von .169), faehrt den Umzug und zaehlt vorher und
     nachher — Eintrag fuer Eintrag, nicht nur die Anzahl.

WAS AM SANDKASTEN GEAENDERT WIRD, und nur das: dieselben vier Dinge wie in
`resume-bruecke-probe.py` (Pfade, `while true`, check_network.py, die
$EUID-Wache). Jede jq-Kette, jedes `mv`, jedes `ln -s` laeuft im Wortlaut.

    python3 tools/e18s3-gegenprobe.py                   # alles
    python3 tools/e18s3-gegenprobe.py --nur A           # nur die alte Fassung
    python3 tools/e18s3-gegenprobe.py --bestand <datei> # eigenes resume.json fuer C
    python3 tools/e18s3-gegenprobe.py --runden 60       # laenger rennen lassen
    python3 tools/e18s3-gegenprobe.py --pruefen         # gruen/rot
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

BAUM = Path(__file__).resolve().parent.parent
SKRIPTE = BAUM / "scripts" / "mupibox"
BOX_KONFIG = "/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config"
# Der letzte Stand VOR dem ersten Eingriff dieses Forks in die Netz-Skripte.
# Wer ihn verschiebt, misst nicht mehr „die Fassung, die ein Update zurueckholt".
UPSTREAM_STAND = "5f9c7d8e~1"

ergebnisse: list[tuple[bool, str, str]] = []


def chk(ok: bool, was: str, gemessen: str = "") -> bool:
    ergebnisse.append((bool(ok), was, gemessen))
    print(f"  {'OK  ' if ok else 'ROT '} {was}")
    if gemessen:
        print(f"        gemessen: {gemessen}")
    return bool(ok)


# ── Der Sandkasten ──────────────────────────────────────────────────────────
#
# NICHT NACHGEBAUT, SONDERN GELIEHEN. `tools/resume-bruecke-probe.py` biegt die
# vier Skripte schon in einen Sandkasten (Pfade, `while true`, check_network.py,
# die $EUID-Wache) — und diese Umbiegung ist der heikelste Teil der ganzen
# Messung: wer sie ein zweites Mal aufschreibt, misst beim naechsten Mal etwas
# anderes als der Nachbar und weiss nicht, welcher von beiden recht hat.
# Deshalb wird sie hier IMPORTIERT. Der Modulname traegt Bindestriche, also
# ueber importlib.

import importlib.util as _ilu

_spec = _ilu.spec_from_file_location("resume_bruecke_probe", BAUM / "tools" / "resume-bruecke-probe.py")
_probe = _ilu.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(_probe)

herrichten = _probe.herrichten
netzschalter = _probe.netzschalter
aufbauen = _probe.aufbauen
art = _probe.art
liste = _probe.liste
GAST_BESTAND = _probe.GAST


def lauf(p: Path) -> subprocess.CompletedProcess:
    return subprocess.run(["bash", str(p)], capture_output=True, text=True, timeout=120)


BESTAND = [
    {"type": "spotify", "category": "resume", "id": "g1", "title": "Bibi Blocksberg",
     "resumespotifytrack_number": 3, "resumespotifyprogress_ms": 1000,
     "resumespotifyduration_ms": 900000},
    {"type": "library", "category": "resume", "id": "g2", "title": "Die Maus",
     "resumespotifytrack_number": 1, "resumespotifyprogress_ms": 500,
     "resumespotifyduration_ms": 900000},
]


# ── A: die alte Fassung ─────────────────────────────────────────────────────


def teil_a(behalten: bool) -> None:
    print("\n══ A  DIE UPSTREAM-FASSUNG DER SKRIPTE (aus %s)" % UPSTREAM_STAND)
    print("   Was ein Update zurueckschiebt. Wenn die Bruecke DAS nicht aushaelt,")
    print("   haelt sie bis zum naechsten Update — und faellt dann still um.\n")
    namen = ["check_network.sh", "get_network.sh", "clearresume.sh", "remove_max_resume.sh"]
    tmp = Path(tempfile.mkdtemp(prefix="e18s3-alt-"))
    try:
        # Die alten Fassungen erst als DATEIEN hinlegen — `herrichten` nimmt
        # einen Pfad, und so laeuft die geliehene Umbiegung Wort fuer Wort auf
        # denselben Text, den ein Update auf die Box legen wuerde.
        roh = tmp / "upstream"
        roh.mkdir()
        anders = 0
        for n in namen:
            r = subprocess.run(["git", "-C", str(BAUM), "show", f"{UPSTREAM_STAND}:scripts/mupibox/{n}"],
                               capture_output=True, text=True)
            if r.returncode != 0:
                chk(False, f"{n} aus {UPSTREAM_STAND} lesbar", r.stderr.strip()[:120])
                return
            (roh / n).write_text(r.stdout)
            anders += int(r.stdout != (SKRIPTE / n).read_text())
        # Erst zeigen, DASS es eine andere Fassung ist — sonst misst man zweimal
        # dasselbe und haelt es fuer einen Beweis.
        chk(anders > 0, "die Upstream-Fassung unterscheidet sich wirklich vom Baum",
            f"{anders} von {len(namen)} Skripten anders")

        # ── online: der Verweis, den check_network.sh legt
        konf, tm = aufbauen(tmp / "a")
        netzschalter(tm, online=True)
        lauf(herrichten(roh / "get_network.sh", konf, tm))
        chk((konf / "resume.json").is_symlink(),
            "alt: get_network.sh laesst die Bruecke stehen (kein leerer Stummel)",
            f"alter Ort: {art(konf / 'resume.json')}")
        chk(liste(konf / "profile" / "gast" / "resume.json") == GAST_BESTAND,
            "alt: und der Bestand des Gasts ist unangetastet",
            f"{len(liste(konf / 'profile' / 'gast' / 'resume.json') or [])} Eintraege")

        lauf(herrichten(roh / "check_network.sh", konf, tm, einmal=True))
        ar = konf / "active_resume.json"
        chk(ar.is_symlink() and liste(ar) == GAST_BESTAND,
            "alt: check_network.sh (online) — active_resume loest bis in den Bereich auf",
            f"{art(ar)}; darueber lesbar: {len(liste(ar) or [])} Eintraege")
        chk((konf / "resume.json").is_symlink(),
            "alt: und die Bruecke ist danach noch eine Bruecke",
            f"alter Ort: {art(konf / 'resume.json')}")

        # ── offline: hier trifft der jq-Syntaxfehler von 2024 die Offline-Liste
        konf2, tm2 = aufbauen(tmp / "b")
        netzschalter(tm2, online=False)
        lauf(herrichten(roh / "check_network.sh", konf2, tm2, einmal=True))
        offl = konf2 / "offline_resume.json"
        chk(liste(offl) == [],
            "alt: die Offline-Liste bleibt LEER — der jq-Fehler von 2024 wirkt weiter",
            f"offline_resume.json: {offl.read_text()!r}")
        chk(liste(konf2 / "profile" / "gast" / "resume.json") == GAST_BESTAND,
            "alt: ABER der BESTAND im Bereich bleibt vollstaendig — die Bruecke haelt",
            f"{len(liste(konf2 / 'profile' / 'gast' / 'resume.json') or [])} Eintraege")
        chk((konf2 / "resume.json").is_symlink(),
            "alt: und die Bruecke steht auch offline noch",
            f"alter Ort: {art(konf2 / 'resume.json')}")

        # ── die zwei, die mit `mv` schreiben — in ihrer alten Fassung
        konf3, tm3 = aufbauen(tmp / "c")
        lauf(herrichten(roh / "clearresume.sh", konf3, tm3))
        chk(not (konf3 / "resume.json").is_symlink() and liste(konf3 / "resume.json") == [],
            "alt: clearresume.sh nimmt die Bruecke mit — genau wie die neue Fassung",
            f"alter Ort: {art(konf3 / 'resume.json')}, Inhalt: {liste(konf3 / 'resume.json')!r}")
        chk(liste(konf3 / "profile" / "gast" / "resume.json") == GAST_BESTAND,
            "alt: und im Bereich steht solange der Stand von DAVOR (die Uebernahme holt ihn)",
            f"{len(liste(konf3 / 'profile' / 'gast' / 'resume.json') or [])} Eintraege")

        konf4, tm4 = aufbauen(tmp / "d")
        lauf(herrichten(roh / "remove_max_resume.sh", konf4, tm4))
        chk(not (konf4 / "resume.json").is_symlink() and len(liste(konf4 / "resume.json") or []) == 1,
            "alt: remove_max_resume.sh ebenso — Deckel 1, Ergebnis am alten Ort",
            f"alter Ort: {art(konf4 / 'resume.json')}, {len(liste(konf4 / 'resume.json') or [])} Eintraege")
    finally:
        if not behalten:
            shutil.rmtree(tmp, ignore_errors=True)
        else:
            print(f"  Sandkasten A bleibt: {tmp}")


# ── B: das Rennen ───────────────────────────────────────────────────────────


def server_starten(konf: Path, tm: Path, port: int) -> subprocess.Popen:
    umg = {
        **os.environ,
        "NODE_ENV": "development",
        "MUPIBOX_CONFIG_DIR": str(konf),
        "MUPIBOX_CONFIG": str(konf / "mupiboxconfig.json"),
        "MUPIBOX_LOCK_DIR": str(tm),
        "MUPIBOX_HTTP_PORT": str(port),
        "MUPIBOX_TLS_DIR": str(tm / "tls"),
    }
    return subprocess.Popen(
        ["npx", "tsx", "src/server.ts"],
        cwd=str(BAUM / "src" / "backend-api"),
        env=umg, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)


def warten_auf(port: int, frist: float = 90.0) -> bool:
    import socket
    ende = time.time() + frist
    while time.time() < ende:
        with socket.socket() as s:
            s.settimeout(0.5)
            try:
                s.connect(("127.0.0.1", port))
                return True
            except OSError:
                time.sleep(0.3)
    return False


def hole(port: int, weg: str, rumpf: dict | None = None) -> tuple[int, str]:
    import urllib.error
    import urllib.request
    r = urllib.request.Request(f"http://127.0.0.1:{port}{weg}")
    daten = None
    if rumpf is not None:
        daten = json.dumps(rumpf).encode()
        r.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(r, daten, timeout=10) as a:
            return a.status, a.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except Exception as e:  # noqa: BLE001
        return 0, str(e)


def rennplatz(tmp: Path, runden: int) -> tuple[Path, Path, list[dict]]:
    """Ein Konfigverzeichnis wie NACH dem Umzug — mit Deckel gross genug.

    `aufbauen` setzt `mupibox.resume` auf 1; das ist fuer die Skriptmessung
    richtig und hier falsch: mit Deckel 1 haelt der Server selbst nur eine
    Stelle, und dann kann man nicht mehr unterscheiden, ob eine fehlt, weil ein
    Skript sie genommen hat, oder weil der Deckel griff.
    """
    konf, tm = tmp / "config", tmp / "tmp"
    (konf / "profile" / "gast").mkdir(parents=True)
    tm.mkdir()
    medien = [{"type": "spotify", "category": "audiobook", "id": f"r{i}",
               "title": f"Rennen {i}", "artist": "Probe"} for i in range(runden)]
    (konf / "profile" / "gast" / "resume.json").write_text("[]")
    (konf / "data.json").write_text(json.dumps(medien, indent=4))
    (konf / "active_data.json").write_text(json.dumps(medien, indent=4))
    (konf / "profile.json").write_text(json.dumps(
        {"profile": [{"kennung": "gast", "name": "Gast", "figur": "m.png", "angelegt": 1}],
         "aktiv": "gast"}))
    (konf / "mupiboxconfig.json").write_text(json.dumps({"mupibox": {"resume": runden + 10}}))
    (konf / "resume.json").symlink_to("profile/gast/resume.json")
    (tm / "network.json").write_text('{"onlinestate":"starting"}')
    return konf, tm, medien


def ohne_sperrgriff(p: Path) -> Path:
    """Dasselbe Skript, aber es TOUCHT und LOESCHT die Sperrdatei nicht.

    WOFUER: Server und Skripte teilen sich `/tmp/.resume.lock`, und BEIDE
    pruefen und setzen sie in zwei Schritten (`[ -f ]` + `touch` auf der einen,
    `existsSync` + `writeFileSync` auf der anderen Seite). Wenn im Rennen etwas
    verlorengeht, muss man wissen, ob es DARAN liegt oder an der Bruecke. Diese
    Fassung nimmt genau den einen Verdaechtigen heraus und laesst alles andere
    — jede jq-Kette, jedes `ln -s` — im Wortlaut stehen.
    """
    text = p.read_text()
    zeilen = [z for z in text.splitlines()
              if not re.match(r"^\s*(touch|rm)\s+\S*\.resume\.lock", z)
              and "RESUME_LOCK}" not in z.replace("[ -f", "")]
    # Die `[ -f ${RESUME_LOCK} ]`-Abfrage bleibt stehen (sonst aendert sich der
    # Ablauf); nur Setzen und Loeschen fallen weg.
    zeilen = [z for z in text.splitlines()
              if not re.match(r"^\s*(touch|rm)\s+\$\{?RESUME_LOCK", z)
              and not re.match(r"^\s*(touch|rm)\s+\S*resume\.lock", z)]
    ziel = p.with_name(p.stem + "-ohnesperre" + p.suffix)
    ziel.write_text("\n".join(zeilen) + "\n")
    ziel.chmod(0o755)
    return ziel


def teil_b(runden: int, behalten: bool, mit_skripten: bool = True, sperrgriff: bool = True) -> None:
    if not mit_skripten:
        print("\n══ B0 STEUERLAUF: dieselben parallelen Schreibvorgaenge OHNE Skripte")
        print("   WOFUER: ohne ihn wuesste man bei einem Verlust nicht, ob die BRUECKE")
        print("   ihn verursacht oder die Sperrdatei, die es schon vorher gab.\n")
    elif not sperrgriff:
        print("\n══ B1 DASSELBE RENNEN, aber die Skripte fassen die SPERRDATEI nicht an")
        print("   Der eine Verdaechtige herausgenommen, alles andere im Wortlaut.\n")
    else:
        print("\n══ B  DAS RENNEN: der Server schreibt, waehrend die Skripte laufen")
        print("   Beide fassen `server/config/resume.json` an. Gemessen wird nicht der")
        print("   Anschein, sondern ob am Ende jede gemerkte Stelle noch da ist, die")
        print("   der Server quittiert hat.\n")

    tmp = Path(tempfile.mkdtemp(prefix="e18s3-rennen-"))
    konf, tm, _medien = rennplatz(tmp, runden)
    netzschalter(tm, online=True)
    gn = herrichten(SKRIPTE / "get_network.sh", konf, tm)
    cn = herrichten(SKRIPTE / "check_network.sh", konf, tm, einmal=True)
    if not sperrgriff:
        gn, cn = ohne_sperrgriff(gn), ohne_sperrgriff(cn)

    port = 18211 if mit_skripten else 18213
    if not sperrgriff:
        port = 18214
    proc = server_starten(konf, tm, port)
    laeuft = threading.Event()
    laeuft.set()
    zaehler = {"n": 0}
    # DER BEOBACHTER. Er misst das, was sich hinterher NICHT mehr feststellen
    # laesst: ob der alte Ort auch nur fuer einen Wimpernschlag unbesetzt war.
    # Genau in diesem Fenster legte `get_network.sh` dort `[]` an — und das war
    # der Grund, warum der Umzug ohne Bruecke binnen 20 s zunichte war.
    luecken: list[str] = []
    stichproben = {"n": 0}

    def stoeren() -> None:
        """Was die Box im Takt tut — hier OHNE Pause, damit es sich trifft."""
        while laeuft.is_set():
            subprocess.run(["bash", str(gn)], capture_output=True)
            subprocess.run(["bash", str(cn)], capture_output=True)
            zaehler["n"] += 1

    def zusehen() -> None:
        alt_ort = konf / "resume.json"
        bereich = konf / "profile" / "gast" / "resume.json"
        while laeuft.is_set():
            stichproben["n"] += 1
            try:
                if not alt_ort.is_symlink():
                    if not alt_ort.exists():
                        luecken.append("alter Ort war UNBESETZT")
                    elif alt_ort.is_dir():
                        luecken.append("alter Ort war ein Ordner")
                    elif alt_ort.read_text().strip() == "[]" and (liste(bereich) or []):
                        # Der teure Fall: ein leerer STUMMEL ueber vollem
                        # Bestand. Nur auf einer ECHTEN Datei ist das eine
                        # Aussage — solange dort ein Verweis steht, sind die
                        # beiden Namen dieselbe Datei, und ein Unterschied
                        # zwischen ihnen misst bloss die eigene Uhr.
                        luecken.append("alter Ort war ein leerer Stummel ueber vollem Bereich")
            except OSError:
                pass

    try:
        if not warten_auf(port):
            chk(False, "der Server ist gestartet", "Port kam nicht hoch")
            return
        chk(True, "der Server laeuft gegen den Sandkasten", f"Port {port}, {konf}")

        faeden = [threading.Thread(target=stoeren, daemon=True) for _ in range(3 if mit_skripten else 0)]
        faeden.append(threading.Thread(target=zusehen, daemon=True))
        for f in faeden:
            f.start()

        # PARALLEL SCHREIBEN. Nacheinander liefe jeder Schreibvorgang in einem
        # ruhigen Augenblick; die Sperrdatei soll gerade dann greifen, wenn zwei
        # gleichzeitig kommen.
        quittiert: list[str] = []
        gesperrt = {"n": 0}
        sperre = threading.Lock()

        def schreiben(i: int) -> None:
            st, rumpf = hole(port, "/api/weiterhoeren",
                             {"schluessel": f"spotify:r{i}", "titelNr": 2,
                              "bisher": 120 + i, "dauer": 900})
            with sperre:
                if st == 200 and '"ok"' in rumpf:
                    quittiert.append(f"r{i}")
                elif "gesperrt" in rumpf:
                    gesperrt["n"] += 1

        for block in range(0, runden, 4):
            w = [threading.Thread(target=schreiben, args=(i,))
                 for i in range(block, min(block + 4, runden))]
            for t in w:
                t.start()
            for t in w:
                t.join(timeout=30)

        laeuft.clear()
        for f in faeden:
            f.join(timeout=60)

        # Erst jetzt beruhigen lassen: der Server holt beim naechsten Lesen
        # nach, was ein Skript am alten Ort hinterlassen hat.
        hole(port, "/api/weiterhoeren")
        time.sleep(0.3)
        bereich = konf / "profile" / "gast" / "resume.json"
        drin = {e.get("id") for e in (liste(bereich) or [])}
        fehlt = [k for k in quittiert if k not in drin]

        chk(zaehler["n"] >= 3 or not mit_skripten,
            "die Skripte sind waehrenddessen wirklich gelaufen" if mit_skripten
            else "Steuerlauf: KEIN Skript hat mitgeredet",
            f"{zaehler['n']} Runden get_network.sh + check_network.sh, "
            f"{stichproben['n']} Stichproben am alten Ort")
        chk(len(quittiert) >= 5,
            "der Server hat genug Stellen quittiert, um etwas verlieren zu KOENNEN",
            f"{len(quittiert)} von {runden} mit status=ok, {gesperrt['n']} an der Sperre abgewiesen")
        chk(not fehlt,
            "KEINE quittierte Stelle ist verlorengegangen",
            f"{len(drin)} im Bereich, fehlend: {fehlt[:8]}")
        chk(not luecken,
            "der alte Ort war zu KEINEM Augenblick unbesetzt oder ein leerer Stummel",
            f"{stichproben['n']} Stichproben, {len(luecken)} Auffaelligkeiten: {sorted(set(luecken))[:3]}")
        chk((konf / "resume.json").is_symlink(),
            "am Ende steht am alten Ort wieder die Bruecke",
            f"alter Ort: {art(konf / 'resume.json')}")
        ar = konf / "active_resume.json"
        if mit_skripten:
            chk(ar.exists() and liste(ar) is not None,
                "und active_resume.json loest bis in den Bereich auf",
                f"{art(ar)}; darueber lesbar: {len(liste(ar) or [])} Eintraege")
        chk(liste(bereich) is not None,
            "der Bestand ist gueltiges JSON geblieben",
            f"{len(liste(bereich) or [])} Eintraege")
    finally:
        laeuft.clear()
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        if not behalten:
            shutil.rmtree(tmp, ignore_errors=True)
        else:
            print(f"  Sandkasten B bleibt: {tmp}")


# ── C: der echte Bestand ────────────────────────────────────────────────────


def teil_c(bestand: Path | None, behalten: bool) -> None:
    print("\n══ C  DER ECHTE BESTAND: verliert eine bestehende Box eine Stelle?")
    print("   Gezaehlt wird EINTRAG FUER EINTRAG, nicht die Anzahl: eine Zahl")
    print("   stimmt auch dann, wenn zwei vertauscht wurden.\n")
    if bestand is None or not bestand.exists():
        chk(False, "ein echtes resume.json liegt zum Messen bereit",
            f"nicht gefunden: {bestand}. Mit --bestand <datei> angeben "
            f"(z. B. eine Kopie von {BOX_KONFIG}/resume.json)")
        return
    vorher = json.loads(bestand.read_text())
    if not isinstance(vorher, list):
        chk(False, "die Vorlage ist eine Liste", f"{type(vorher).__name__}")
        return

    wurzel = Path(tempfile.mkdtemp(prefix="e18s3-echt-"))
    konf = wurzel / "config"
    konf.mkdir(parents=True)
    (wurzel / "tmp").mkdir()
    shutil.copy2(bestand, konf / "resume.json")
    (konf / "data.json").write_text("[]")
    (konf / "active_data.json").write_text("[]")
    (konf / "mupiboxconfig.json").write_text(json.dumps({"mupibox": {"resume": 9}}))
    port = 18212
    proc = server_starten(konf, wurzel / "tmp", port)
    try:
        if not warten_auf(port):
            chk(False, "der Server ist gestartet", "Port kam nicht hoch")
            return
        hole(port, "/api/weiterhoeren")
        time.sleep(0.3)
        nach = liste(konf / "profile" / "gast" / "resume.json")
        chk(nach is not None, "nach dem Umzug liegt der Bestand im Bereich des Gasts",
            f"{konf}/profile/gast/resume.json: {art(konf / 'profile' / 'gast' / 'resume.json')}")
        if nach is None:
            return
        chk(nach == vorher,
            "Eintrag fuer Eintrag identisch — nichts gekuerzt, nichts vertauscht",
            f"{len(vorher)} vorher, {len(nach)} nachher")
        chk((konf / "resume.json").is_symlink() and liste(konf / "resume.json") == vorher,
            "und ueber den alten Ort steht dasselbe da (das sehen die root-Skripte)",
            f"{art(konf / 'resume.json')}")
        st, rumpf = hole(port, "/api/resume")
        chk(st == 200 and json.loads(rumpf) == vorher,
            "GET /api/resume (die klassische Oberflaeche) liefert denselben Bestand",
            f"HTTP {st}, {len(json.loads(rumpf)) if st == 200 else '-'} Eintraege")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        if not behalten:
            shutil.rmtree(wurzel, ignore_errors=True)
        else:
            print(f"  Sandkasten C bleibt: {wurzel}")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--nur", choices=["A", "B0", "B", "B1", "C"], help="nur einen Teil messen")
    p.add_argument("--runden", type=int, default=40, help="wie viele Schreibvorgaenge im Rennen (Vorgabe 40)")
    p.add_argument("--bestand", type=Path, help="ein echtes resume.json fuer Teil C")
    p.add_argument("--behalten", action="store_true", help="Sandkaesten stehenlassen")
    p.add_argument("--pruefen", action="store_true", help="nur gruen/rot")
    a = p.parse_args()

    print("══ E18 STUFE 3 GEGENGELESEN — die alte Fassung, das Rennen, der echte Bestand")
    if a.nur in (None, "A"):
        teil_a(a.behalten)
    if a.nur in (None, "B0"):
        teil_b(a.runden, a.behalten, mit_skripten=False)
    if a.nur in (None, "B"):
        teil_b(a.runden, a.behalten)
    if a.nur in (None, "B1"):
        teil_b(a.runden, a.behalten, sperrgriff=False)
    if a.nur in (None, "C"):
        teil_c(a.bestand, a.behalten)

    rot = [e for e in ergebnisse if not e[0]]
    print(f"\n  {len(ergebnisse)} Messungen, {len(rot)} rot.")
    for _, was, gem in rot:
        print(f"    ROT  {was}\n         {gem}")
    return 1 if rot else 0


if __name__ == "__main__":
    sys.exit(main())
