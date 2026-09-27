#!/usr/bin/env python3
"""
DIE ZAHL GEHOERT DEM KIND — gemessen, nicht behauptet.

WAS HIER GEFRAGT WIRD: `mupibox.resume` ist eine Zahl fuer die ganze Box. Seit
dem 07.08.2026 darf jedes Kind eine EIGENE haben (`Profil.merken` in
`profile.json`). Diese Probe misst, ob das stimmt — und zwar in der DATEI, die
am Ende auf der SD-Karte liegt, nicht in der Antwort, die der Server gibt. Eine
Antwort kann sich irren; die Datei ist das, was das Kind morgen wiederfindet.

    python3 tools/merken-je-kind.py                # alles, gruen/rot
    python3 tools/merken-je-kind.py --nur A        # nur ein Teil (A..F)
    python3 tools/merken-je-kind.py --gegenprobe   # zusaetzlich: wird es ROT
                                                   #   mit der Fassung VOR 4e538125?
    python3 tools/merken-je-kind.py --gegenprobe --gegen <ref>   # anderer Stand
    python3 tools/merken-je-kind.py --behalten     # Sandkasten stehenlassen
    python3 tools/merken-je-kind.py --port 9751    # eigener Port

DIE SIEBEN TEILE
  A  Drei Kinder mit VERSCHIEDENEN Zahlen — jedes bekommt genau seine.
  B  Ein Kind OHNE eigene Zahl verhaelt sich wie vor dem 07.08.2026.
  C  Die Grenzen am Endpunkt: 0, 1, 99, 100, -1, 5.5, Text, `null`.
  D  Herunter- und Heraufsetzen: es SAGT den Verlust vorher, und es LOESCHT
     nichts, solange nicht gekappt wird.
  E  Umbenennen, Bildwechsel und `PUT /api/profile` lassen die Zahl stehen.
  F  `remove_max_resume.sh` trifft JEDES Kind — und der VERWEIS steht danach
     noch (mit `lstat` nachgesehen, nicht mit `stat`: auf einem Verweis luegt
     jede gewoehnliche Existenzpruefung). Dazu F2: der alte Ort als ECHTE
     Datei — der Zweig, in dem er ueberhaupt geschrieben wird.
  G  DIE GEGENPROBE (nur mit --gegenprobe): dieselben Messungen gegen den
     Stand VOR der Aenderung. A, B(teilweise) und F MUESSEN dort rot werden —
     sonst misst diese Probe nichts.

     DER STAND IST FESTGENAGELT (`GEGEN_VORGABE`) UND HEISST NICHT `HEAD`.
     Hier stand `HEAD`, und das war genau so lange richtig, wie die Aenderung
     noch nicht festgeschrieben war. Mit dem Festschreiben wurde `HEAD` zur
     NEUEN Fassung — die Gegenprobe verglich die neue Fassung mit sich selbst
     und meldete „alles gruen", also: diese Probe misst nichts. Ein bewegliches
     `HEAD` als Vergleichsstand macht jede Gegenprobe genau in dem Augenblick
     wertlos, in dem sie gebraucht wird. Deshalb eine feste Kennung, wie es
     `tools/e18s3-gegenprobe.py` mit `5f9c7d8e~1` haelt.

NIEMALS GEGEN DIE ECHTE BOX. Alles laeuft in einem Sandkasten unter /tmp gegen
einen EIGENEN Server auf einem EIGENEN Port. Der Port wird vorher wirklich
gebunden, und danach wird nachgesehen, dass die Antwort aus DIESEM Sandkasten
kommt (an einer Kennung, die es sonst nirgends gibt) — auf diesem Rechner
laufen fremde Sitzungen.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

BAUM = Path(__file__).resolve().parent.parent
BACKEND = BAUM / "src" / "backend-api"
SKRIPT = BAUM / "scripts" / "mupibox" / "remove_max_resume.sh"
BOX_KONFIG = "/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config"

# Die Kennung, an der wir DIESEN Sandkasten wiedererkennen. Sie steht in keiner
# echten Box und in keiner anderen Probe.
MARKE = "probe-merken-a"

# DER STAND, GEGEN DEN DIE GEGENPROBE MISST — festgenagelt, nicht `HEAD`.
#
# 4e538125 ist die Aenderung „Die Merktiefe gehoert dem Kind"; `~1` ist der
# Stand unmittelbar davor. Hier stand `HEAD`, und solange die Aenderung nur im
# Arbeitsbaum lag, war das richtig. Mit dem Festschreiben wurde `HEAD` zur
# NEUEN Fassung: die Gegenprobe verglich sie mit sich selbst und meldete „alles
# gruen" — der Beweis, dass die Probe etwas misst, war damit lautlos zu einem
# Beweis geworden, dass sie nichts misst. `gegen_pruefen` bricht heute laut ab,
# wenn der Vergleichsstand dieselben Dateien enthaelt wie der Arbeitsbaum.
GEGEN_VORGABE = "4e538125~1"

# Die Box-Zahl im Sandkasten. Absichtlich WEDER 9 (die Vorgabe des Skripts)
# NOCH eine der Kinderzahlen: sonst liesse sich nicht unterscheiden, ob die
# Kinderzahl gegriffen hat oder ob zufaellig dasselbe herauskam.
BOX_ZAHL = 6

# Drei Kinder mit verschiedenen Zahlen — und eines ohne.
KINDER = [
    (MARKE, 3),
    ("probe-merken-b", 5),
    ("probe-merken-c", 9),
    ("probe-merken-d", None),
]

# Mehr Werke als jede dieser Zahlen: sonst schluege der Deckel nie zu und die
# Messung waere gruen, ohne etwas gemessen zu haben.
WERKE = 12


class Befund:
    def __init__(self) -> None:
        self.zeilen: list[tuple[bool, str, str]] = []

    def prueft(self, ok: bool, was: str, gemessen: str = "") -> bool:
        self.zeilen.append((bool(ok), was, gemessen))
        print(f"  {'OK  ' if ok else 'ROT '} {was}")
        if gemessen:
            print(f"        gemessen: {gemessen}")
        return bool(ok)

    def rote(self) -> int:
        return sum(1 for ok, _, _ in self.zeilen if not ok)


# ── Der Sandkasten ──────────────────────────────────────────────────────────


def sandkasten(tmp: Path) -> tuple[Path, Path]:
    """Ein Konfigverzeichnis, wie der Server es nach dem Umzug hinterlaesst."""
    konf, tm = tmp / "config", tmp / "tmp"
    tm.mkdir(parents=True)
    (konf / "profile").mkdir(parents=True)
    medien = [
        {
            "type": "spotify",
            "category": "audiobook",
            "id": f"w{i}",
            "title": f"Werk {i}",
            "artist": "Probe",
        }
        for i in range(WERKE)
    ]
    (konf / "data.json").write_text(json.dumps(medien, indent=4))
    (konf / "active_data.json").write_text(json.dumps(medien, indent=4))
    profile = []
    for kennung, zahl in KINDER:
        (konf / "profile" / kennung).mkdir()
        (konf / "profile" / kennung / "resume.json").write_text("[]")
        p = {"kennung": kennung, "name": kennung.upper(), "figur": "", "angelegt": 1}
        if zahl is not None:
            p["merken"] = zahl
        profile.append(p)
    # Der Gast steht immer vorn (profileNormalisieren stellt ihn her).
    (konf / "profile" / "gast").mkdir()
    (konf / "profile" / "gast" / "resume.json").write_text("[]")
    (konf / "profile.json").write_text(
        json.dumps({"profile": profile, "aktiv": KINDER[0][0]}, indent=4)
    )
    (konf / "mupiboxconfig.json").write_text(json.dumps({"mupibox": {"resume": BOX_ZAHL}}, indent=4))
    # DIE BRUECKE — relativ, genau wie server.ts sie legt.
    (konf / "resume.json").symlink_to(f"profile/{KINDER[0][0]}/resume.json")
    (tm / "network.json").write_text('{"onlinestate":"starting"}')
    return konf, tm


def freier_port(wunsch: int) -> int:
    """
    Einen Port SUCHEN, indem man ihn wirklich bindet.

    NICHT „ist da was?" fragen und dann hoffen: zwischen der Frage und dem
    Start des Servers kann sich eine fremde Sitzung dazwischenschieben. Hier
    wird gebunden, gehalten, und erst unmittelbar vor dem Start losgelassen —
    das Fenster bleibt, ist aber so klein wie es geht. Was danach wirklich
    antwortet, prueft `wer_antwortet`.
    """
    for port in range(wunsch, wunsch + 40):
        s = socket.socket()
        try:
            s.bind(("127.0.0.1", port))
            s.close()
            return port
        except OSError:
            s.close()
    raise SystemExit(f"kein freier Port ab {wunsch}")


def server_starten(konf: Path, tm: Path, port: int, quelle: Path | None = None) -> subprocess.Popen:
    umg = {
        **os.environ,
        "NODE_ENV": "development",
        "MUPIBOX_CONFIG_DIR": str(konf),
        "MUPIBOX_CONFIG": str(konf / "mupiboxconfig.json"),
        "MUPIBOX_LOCK_DIR": str(tm),
        "MUPIBOX_HTTP_PORT": str(port),
        "MUPIBOX_TLS_DIR": str(tm / "tls"),
    }
    ziel = quelle or (BACKEND / "src" / "server.ts")
    return subprocess.Popen(
        ["npx", "tsx", str(ziel)],
        cwd=str(BACKEND),
        env=umg,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )


def hole(port: int, weg: str, rumpf: dict | None = None, art: str = "GET") -> tuple[int, object]:
    r = urllib.request.Request(f"http://127.0.0.1:{port}{weg}", method=art)
    daten = None
    if rumpf is not None:
        daten = json.dumps(rumpf).encode()
        r.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(r, daten, timeout=15) as a:
            text = a.read().decode()
            try:
                return a.status, json.loads(text)
            except ValueError:
                return a.status, text
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        try:
            return e.code, json.loads(text)
        except ValueError:
            return e.code, text
    except Exception as e:  # noqa: BLE001
        return 0, str(e)


def wer_antwortet(port: int, frist: float = 120.0) -> bool:
    """
    Wartet, bis DIESER Sandkasten antwortet — nicht bloss irgendwer.

    AUF DIESEM RECHNER LAUFEN FREMDE SITZUNGEN. Ein offener Port beweist gar
    nichts; ein Server einer anderen Sitzung wuerde jede Messung still
    verfaelschen. Bewiesen wird es an `MARKE`: eine Kennung, die es nur in
    diesem Sandkasten gibt.
    """
    ende = time.time() + frist
    while time.time() < ende:
        code, antwort = hole(port, "/api/profile")
        if code == 200 and isinstance(antwort, dict):
            kennungen = [p.get("kennung") for p in antwort.get("profile", [])]
            if MARKE in kennungen:
                return True
            print(f"  ! Port {port} antwortet, aber es ist NICHT dieser Sandkasten: {kennungen}")
            return False
        time.sleep(0.4)
    return False


def stellen(konf: Path, kennung: str) -> list:
    try:
        roh = json.loads((konf / "profile" / kennung / "resume.json").read_text())
        return roh if isinstance(roh, list) else []
    except Exception:  # noqa: BLE001
        return []


def merken_lassen(port: int, kennung: str, wieviel: int = WERKE) -> None:
    """Das Kind hoert `wieviel` Werke an — ueber den Weg, den die Box geht."""
    code, _ = hole(port, "/api/profil/aktiv", {"kennung": kennung}, "POST")
    assert code == 200, f"Umschalten auf {kennung} misslang: {code}"
    for i in range(wieviel):
        hole(
            port,
            "/api/weiterhoeren",
            {"schluessel": f"spotify:w{i}", "titelNr": 2, "bisher": 120, "dauer": 900},
            "POST",
        )


# ── A: drei Kinder, drei Zahlen ─────────────────────────────────────────────


def teil_a(b: Befund, konf: Path, port: int) -> None:
    print("\n══ A  DREI KINDER MIT VERSCHIEDENEN ZAHLEN")
    print("   Jedes hoert dieselben %d Werke. Danach wird in der DATEI gezaehlt." % WERKE)
    print("   Box-Zahl: %d — sie darf bei keinem der drei durchschlagen.\n" % BOX_ZAHL)
    for kennung, zahl in KINDER:
        if zahl is None:
            continue
        merken_lassen(port, kennung)
        da = len(stellen(konf, kennung))
        b.prueft(
            da == zahl,
            f"{kennung}: eigene Zahl {zahl} — in der Datei stehen {da}",
            f"{da} Eintraege in profile/{kennung}/resume.json (erwartet {zahl})",
        )
    # Und die Zahlen haben sich NICHT gegenseitig angefasst.
    stand = {k: len(stellen(konf, k)) for k, z in KINDER if z is not None}
    b.prueft(
        stand == {k: z for k, z in KINDER if z is not None},
        "und nach allen drei Durchgaengen steht bei jedem noch seine eigene Zahl",
        str(stand),
    )


# ── B: ein Kind ohne eigene Zahl ────────────────────────────────────────────


def teil_b(b: Befund, konf: Path, port: int) -> None:
    print("\n══ B  EIN KIND OHNE EIGENE ZAHL")
    print("   Es muss sich verhalten wie vor dem 07.08.2026: die Box-Zahl gilt.\n")
    kennung = KINDER[3][0]
    merken_lassen(port, kennung)
    da = len(stellen(konf, kennung))
    b.prueft(
        da == BOX_ZAHL,
        f"{kennung}: keine eigene Zahl — es gilt die Box-Zahl {BOX_ZAHL}",
        f"{da} Eintraege (erwartet {BOX_ZAHL})",
    )
    code, antwort = hole(port, f"/api/profil/merken?profil={kennung}")
    b.prueft(
        code == 200 and isinstance(antwort, dict) and antwort.get("merken") is None,
        'die Auskunft sagt `merken: null` — „keine eigene", nicht „null Stellen"',
        f"{code} {antwort}",
    )
    b.prueft(
        isinstance(antwort, dict) and antwort.get("gilt") == BOX_ZAHL and antwort.get("box") == BOX_ZAHL,
        "und sie sagt gleich dazu, worauf das hinauslaeuft (`gilt`, `box`)",
        f"gilt={antwort.get('gilt') if isinstance(antwort, dict) else '?'}",
    )


# ── C: die Grenzen ──────────────────────────────────────────────────────────


def teil_c(b: Befund, konf: Path, port: int) -> None:
    print("\n══ C  DIE GRENZEN AM ENDPUNKT")
    print("   0 und 99 sind gueltig, alles Krumme wird ABGEWIESEN — nicht gerundet")
    print('   und nicht verschwiegen. Ein Vertipper, der „gespeichert" hoert, ist')
    print("   eine Zahl, an die jemand glaubt und die nirgends steht.\n")
    kennung = KINDER[1][0]

    def setzen(wert, bestaetigt: bool = True) -> tuple[int, object]:
        rumpf = {"profil": kennung, "merken": wert}
        if bestaetigt:
            rumpf["bestaetigt"] = True
        return hole(port, "/api/profil/merken", rumpf, "PUT")

    for wert, erwartet in [(0, 200), (1, 200), (99, 200)]:
        code, _ = setzen(wert)
        b.prueft(code == erwartet, f"merken={wert!r} wird angenommen ({code})")
    for wert in [100, -1, 5.5, "zehn", True, [], {}]:
        code, antwort = setzen(wert)
        b.prueft(
            code == 400,
            f"merken={wert!r} wird abgewiesen (400)",
            f"{code} {antwort}",
        )
    # Nach all dem Abgewiesenen steht noch die letzte GUELTIGE Zahl da.
    code, antwort = hole(port, f"/api/profil/merken?profil={kennung}")
    b.prueft(
        isinstance(antwort, dict) and antwort.get("merken") == 99,
        "und nach jedem abgewiesenen Versuch steht noch die letzte gueltige Zahl",
        str(antwort),
    )
    # `null` nimmt die Zahl WEG — sonst waere das Setzen eine Einbahnstrasse.
    code, antwort = setzen(None)
    b.prueft(
        code == 200 and isinstance(antwort, dict) and antwort.get("merken") is None,
        "`null` nimmt die eigene Zahl wieder weg — es gilt wieder die der Box",
        f"{code} {antwort}",
    )
    roh = json.loads((konf / "profile.json").read_text())
    eintrag = next(p for p in roh["profile"] if p["kennung"] == kennung)
    b.prueft(
        "merken" not in eintrag,
        "und in der DATEI ist das Feld dann WEG, nicht `null`",
        str(eintrag),
    )
    # ── 0 HEISST „GAR NICHTS MERKEN" — und ist keine Sackgasse ──────────────
    #
    # WAS ES NICHT HEISST: „loesche, was da ist". Das Setzen einer Zahl
    # loescht nie (siehe D). Bei 0 heisst das: es kommt nichts mehr DAZU. Was
    # schon dasteht, nimmt beim naechsten Lauf von remove_max_resume.sh das
    # Skript — dieselbe Arbeitsteilung wie bei jeder anderen Zahl.
    vor_null = len(stellen(konf, kennung))
    setzen(0)
    hole(port, "/api/profil/aktiv", {"kennung": kennung}, "POST")
    code, antwort = hole(
        port,
        "/api/weiterhoeren",
        {"schluessel": "spotify:w0", "titelNr": 2, "bisher": 120, "dauer": 900},
        "POST",
    )
    b.prueft(
        isinstance(antwort, dict) and antwort.get("status") == "ausgeschaltet",
        "merken=0 heisst wirklich: gar nichts merken (`ausgeschaltet`)",
        f"{code} {antwort}",
    )
    b.prueft(
        len(stellen(konf, kennung)) == vor_null,
        "und es kommt nichts mehr dazu — geloescht wird dabei aber auch nichts",
        f"{len(stellen(konf, kennung))} Eintraege (vorher {vor_null})",
    )
    code, _ = setzen(7)
    merken_lassen(port, kennung, 9)
    b.prueft(
        code == 200 and len(stellen(konf, kennung)) == 7,
        "und von 0 wieder herauf geht — 0 ist eine Wahl, keine Sackgasse",
        f"{len(stellen(konf, kennung))} Eintraege (erwartet 7)",
    )


# ── D: herunter und herauf ──────────────────────────────────────────────────


def teil_d(b: Befund, konf: Path, port: int) -> None:
    print("\n══ D  HERUNTERSETZEN — SAGT ES DAS VORHER, UND LOESCHT ES SOFORT?")
    print("   Von 12 auf 2 heisst zehn gemerkte Stellen. Es gibt fuer diesen Weg")
    print("   KEINE Sicherung. Also: erst nennen, dann annehmen.\n")
    kennung = KINDER[2][0]
    hole(port, "/api/profil/merken", {"profil": kennung, "merken": 12, "bestaetigt": True}, "PUT")
    merken_lassen(port, kennung)
    vorher = len(stellen(konf, kennung))
    b.prueft(vorher == 12, f"Vorbedingung: {kennung} hat {vorher} Stellen", str(vorher))

    code, antwort = hole(port, "/api/profil/merken", {"profil": kennung, "merken": 2}, "PUT")
    b.prueft(
        code == 409 and isinstance(antwort, dict) and antwort.get("verliert") == 10,
        "ohne `bestaetigt` kommt 409 mit der Zahl, die es kosten wuerde (10)",
        f"{code} {antwort}",
    )
    roh = json.loads((konf / "profile.json").read_text())
    eintrag = next(p for p in roh["profile"] if p["kennung"] == kennung)
    b.prueft(
        eintrag.get("merken") == 12,
        "und NICHTS ist geschrieben — in der Datei steht noch die alte Zahl",
        str(eintrag),
    )
    b.prueft(
        len(stellen(konf, kennung)) == 12,
        "und keine einzige Stelle ist weg",
        f"{len(stellen(konf, kennung))} Eintraege",
    )

    code, antwort = hole(
        port, "/api/profil/merken", {"profil": kennung, "merken": 2, "bestaetigt": True}, "PUT"
    )
    b.prueft(code == 200, "mit `bestaetigt: true` wird die Zahl gesetzt", f"{code} {antwort}")
    b.prueft(
        len(stellen(konf, kennung)) == 12,
        "aber das SETZEN loescht nichts — gekappt wird beim naechsten Merken",
        f"{len(stellen(konf, kennung))} Eintraege, unveraendert",
    )
    # Solange nicht gekappt hat, ist ein Vertipper folgenlos.
    hole(port, "/api/profil/merken", {"profil": kennung, "merken": 12, "bestaetigt": True}, "PUT")
    b.prueft(
        len(stellen(konf, kennung)) == 12,
        "ein sofort zurueckgedrehter Vertipper kostet daher nichts",
        f"{len(stellen(konf, kennung))} Eintraege",
    )
    # Herauf kostet nie etwas, also auch keine Rueckfrage.
    hole(port, "/api/profil/merken", {"profil": kennung, "merken": 2, "bestaetigt": True}, "PUT")
    code, antwort = hole(port, "/api/profil/merken", {"profil": kennung, "merken": 40}, "PUT")
    b.prueft(
        code == 200,
        "HERAUFsetzen fragt nicht nach — es kann nichts kosten",
        f"{code} {antwort}",
    )


# ── E: die Zahl darf nie verschwinden ───────────────────────────────────────


def teil_e(b: Befund, konf: Path, port: int) -> None:
    print("\n══ E  UMBENENNEN, BILDWECHSEL, GANZE LISTE — DIE ZAHL BLEIBT")
    print("   Beim Loeschen eines Kindes ist am 07.08. schon einmal etwas hinter")
    print("   dem Ordner liegengeblieben. Hier die Gegenrichtung: was NICHT")
    print("   verschwinden darf.\n")
    kennung = KINDER[0][0]
    hole(port, "/api/profil/merken", {"profil": kennung, "merken": 17, "bestaetigt": True}, "PUT")

    def zahl_in_datei(k: str = kennung):
        roh = json.loads((konf / "profile.json").read_text())
        e = next((p for p in roh["profile"] if p["kennung"] == k), {})
        return e.get("merken")

    hole(port, "/api/profil/aktiv", {"kennung": kennung}, "POST")
    hole(port, "/api/profil/name", {"name": "Neuer Name"}, "POST")
    b.prueft(zahl_in_datei() == 17, "Umbenennen laesst die Zahl stehen", str(zahl_in_datei()))

    hole(port, "/api/profil/figur", {"figur": ""}, "POST")
    b.prueft(zahl_in_datei() == 17, "Bildwechsel laesst die Zahl stehen", str(zahl_in_datei()))

    # DER GEFAEHRLICHSTE WEG: die Verwaltung schickt die GANZE Liste — und
    # kennt das Feld `merken` womoeglich gar nicht.
    code, antwort = hole(port, "/api/profile")
    schlank = [
        {"kennung": p["kennung"], "name": p["name"], "figur": p["figur"], "angelegt": p["angelegt"]}
        for p in antwort["profile"]
    ]
    hole(port, "/api/profile", schlank, "PUT")
    b.prueft(
        zahl_in_datei() == 17,
        "`PUT /api/profile` OHNE das Feld loescht die Zahl NICHT (merkenBewahren)",
        str(zahl_in_datei()),
    )
    # Und mit dem Feld setzt sie sich sehr wohl — sonst waere sie unaenderbar.
    mit = [
        ({**p, "merken": 4} if p["kennung"] == kennung else p)
        for p in [
            {"kennung": p["kennung"], "name": p["name"], "figur": p["figur"], "angelegt": p["angelegt"]}
            for p in antwort["profile"]
        ]
    ]
    hole(port, "/api/profile", mit, "PUT")
    b.prueft(
        zahl_in_datei() == 4,
        'MIT dem Feld setzt sie sich — „nichts gesagt" und „so soll es sein" sind unterscheidbar',
        str(zahl_in_datei()),
    )
    # Der Gast bekommt auch eine — er hat einen eigenen Bestand.
    code, antwort = hole(
        port, "/api/profil/merken", {"profil": "gast", "merken": 2, "bestaetigt": True}, "PUT"
    )
    b.prueft(
        code == 200 and zahl_in_datei("gast") == 2,
        "der GAST bekommt auch eine eigene Zahl (er hat einen eigenen Bestand)",
        f"{code} {zahl_in_datei('gast')}",
    )
    # Und ein Kind, das geloescht wird, nimmt seine Zahl mit — ohne Zutun.
    ohne = [p for p in schlank if p["kennung"] != KINDER[3][0]]
    hole(port, "/api/profile", ohne, "PUT")
    roh = json.loads((konf / "profile.json").read_text())
    b.prueft(
        all(p["kennung"] != KINDER[3][0] for p in roh["profile"]),
        "ein geloeschtes Kind nimmt seine Zahl mit — sie steht in seinem Eintrag",
        str([p["kennung"] for p in roh["profile"]]),
    )


# ── F: das Skript ───────────────────────────────────────────────────────────


def skript_herrichten(quelle: Path, konf: Path, tm: Path) -> Path:
    """Das Skript in den Sandkasten biegen — Pfade, sonst nichts.

    DIESELBEN VIER EINGRIFFE wie in `tools/resume-bruecke-probe.py`: die Pfade,
    die $EUID-Wache, das `sudo` und die Eigentumszeilen. Jede jq-Kette und
    jedes `cat >` laeuft im Wortlaut — sonst misst man sein eigenes Umschreiben.
    """
    text = quelle.read_text()
    text = text.replace(BOX_KONFIG, str(konf))
    text = text.replace("/tmp/.resume.lock", str(tm / ".resume.lock"))
    # ZWEI ZEILEN FUER DENSELBEN ZWISCHENSPEICHER, und beide werden gebraucht:
    # bis zum 07.08.2026 stand in remove_max_resume.sh ein FESTER Name
    # (`/tmp/.resume.json`), seither legt `mktemp` ihn in `TMP_DIR` an. Die
    # erste Zeile biegt die alte Fassung (die Gegenprobe liest sie mit
    # `git show`), die zweite die heutige. Ohne die zweite schriebe der
    # Sandkasten in das echte /tmp.
    text = text.replace("/tmp/.resume.json", str(tm / ".resume.json"))
    text = text.replace('TMP_DIR="${TMP_DIR:-/tmp}"', f'TMP_DIR="{tm}"')
    text = text.replace("/etc/mupibox/mupiboxconfig.json", str(konf / "mupiboxconfig.json"))
    text = text.replace('if [ "$EUID" -ne 0 ]\n  then echo "Please run as root"\n  exit\nfi', "")
    text = text.replace("sudo /usr/bin/jq", "jq").replace("sudo /usr/bin/", "").replace("sudo ", "")
    # DIE EIGENTUMSZEILE FAELLT HIER HERAUS — ein gewoehnlicher Benutzer darf
    # nicht chownen. Was sie tut, misst tools/kappen-als-root-linse.py (Teil A)
    # mit einem Schreiber davor; hier waere sie nur ein Fehlschlag im Protokoll.
    text = "\n".join(z for z in text.splitlines() if "chown" not in z and "chmod" not in z)
    ziel = tm / quelle.name
    ziel.write_text(text)
    ziel.chmod(0o755)
    return ziel


def art(p: Path) -> str:
    """Verweis, Datei oder nichts — mit `lstat`. Auf einem TOTEN Verweis luegt
    jede gewoehnliche Existenzpruefung."""
    if p.is_symlink():
        return f"Verweis -> {os.readlink(p)}" + ("" if p.exists() else "  (TOT)")
    if p.exists():
        return "echte Datei"
    return "fehlt"


def teil_f(b: Befund, tmp: Path, quelle: Path, ueberschrift: str = "") -> None:
    print("\n══ F  DAS KAPPEN TRIFFT JEDES KIND%s" % ueberschrift)
    print("   Nicht nur das, auf das die Bruecke gerade zeigt. Und danach steht")
    print("   die Bruecke noch — mit `lstat` nachgesehen.\n")
    konf, tm = sandkasten(tmp)
    # Jedes Kind bekommt VOLLE Listen — 12 Stellen, unabhaengig vom Server.
    bestand = [
        {"type": "spotify", "category": "resume", "id": f"w{i}", "index": i, "title": f"Werk {i}"}
        for i in range(WERKE)
    ]
    for kennung, _ in KINDER:
        (konf / "profile" / kennung / "resume.json").write_text(json.dumps(bestand, indent=4))
    (konf / "profile" / "gast" / "resume.json").write_text(json.dumps(bestand, indent=4))

    skript = skript_herrichten(quelle, konf, tm)
    lauf = subprocess.run(["bash", str(skript)], capture_output=True, text=True, timeout=120)

    for kennung, zahl in KINDER:
        erwartet = BOX_ZAHL if zahl is None else zahl
        da = len(stellen(konf, kennung))
        b.prueft(
            da == erwartet,
            f"{kennung}: gekappt auf {erwartet} ({'eigene Zahl' if zahl is not None else 'Box-Zahl'})",
            f"{da} Eintraege — Ausgabe: {lauf.stdout.strip().splitlines()[-1] if lauf.stdout.strip() else '(nichts)'}",
        )
    b.prueft(
        len(stellen(konf, "gast")) == BOX_ZAHL,
        f"auch der Gast wird gekappt (Box-Zahl {BOX_ZAHL})",
        f"{len(stellen(konf, 'gast'))} Eintraege",
    )
    # ── DER VERWEIS ─────────────────────────────────────────────────────────
    #
    # WAS DIESE ZWEI MESSUNGEN WERT SIND — ehrlich gesagt: WENIGER, als hier
    # bis zum 07.08.2026 abends behauptet wurde.
    #
    # Es stand hier, sie seien der Riegel gegen die Falle vom Nachmittag (`mv`
    # ersetzt den Verweis durch eine Datei). SIE SIND ES NICHT. Nachgemessen:
    # setzt man `mv` an die Stelle von `cat >` zurueck, bleiben sie GRUEN —
    # und selbst wenn man ZUSAETZLICH den `-L`-Riegel entfernt, bleiben sie
    # gruen. Der Grund ist der Bau des Skriptes: der alte Ort wird nur dann
    # angefasst, wenn er KEIN Verweis ist, und die Schleife hat den Bestand
    # des aktiven Kindes vorher schon auf dessen Zahl gebracht — der zweite
    # Durchgang findet nichts mehr zu kappen und schreibt gar nicht.
    #
    # DAMIT IST DIE BRUECKE HEUTE NICHT DURCH EINE SCHREIBWEISE ZU BRECHEN,
    # sondern durch den `-L`-Riegel geschuetzt. Das ist eine gute Nachricht,
    # aber sie gehoert richtig aufgeschrieben: was hier steht, ist eine
    # RUECKFALLWACHE — sie schlaegt an, wenn das Skript den alten Ort eines
    # Tages wieder unbedingt anfasst (wie in seiner alten Fassung). Sie ist
    # KEIN Beweis, dass `cat >` noetig ist; `cat >` ist an dieser Stelle
    # Vorsorge und laesst sich mit dieser Probe nicht belegen.
    b.prueft(
        (konf / "resume.json").is_symlink(),
        "der Verweis steht danach noch (lstat, nicht stat) — Rueckfallwache, kein mv-Riegel",
        f"alter Ort: {art(konf / 'resume.json')}",
    )
    b.prueft(
        (konf / "resume.json").is_symlink()
        and os.readlink(konf / "resume.json") == f"profile/{KINDER[0][0]}/resume.json",
        "und er zeigt noch auf dasselbe Kind wie vorher",
        art(konf / "resume.json"),
    )
    if lauf.returncode != 0:
        b.prueft(False, "das Skript endete mit einem Fehler", lauf.stdout[-800:])


def teil_f_alt(b: Befund, tmp: Path, quelle: Path, ueberschrift: str = "") -> None:
    """
    DER ALTE ORT ALS ECHTE DATEI — der Zweig, den bis jetzt NICHTS gemessen hat.

    WANN ES IHN GIBT: nach `clearresume.sh`, nach der alten Fassung dieses
    Skriptes (die den Verweis durch eine Datei ersetzte) und auf jeder Box vor
    E18 Stufe 2, die noch gar keine Bereiche hat. Dann ist `server/config/
    resume.json` der GANZE Bestand, und das Skript kappt ihn mit der Zahl des
    AKTIVEN Kindes.

    WARUM DAS GEMESSEN GEHOERT: es ist der einzige Zweig, in dem der alte Ort
    ueberhaupt geschrieben wird. Er stand seit dem Umbau ungeprueft da — und
    genau in ihm entscheidet sich, ob ein Kind ohne Bereiche seine Zahl
    bekommt oder still die der Box.
    """
    print("\n══ F2  DER ALTE ORT ALS ECHTE DATEI%s" % ueberschrift)
    print("   Kein Verweis (nach clearresume.sh, oder Box vor E18 Stufe 2).")
    print("   Dann gehoert der Bestand dem AKTIVEN Kind — mit dessen Zahl.\n")
    konf, tm = sandkasten(tmp)
    bestand = [
        {"type": "spotify", "category": "resume", "id": f"w{i}", "index": i, "title": f"Werk {i}"}
        for i in range(WERKE)
    ]
    # Die Bruecke WEG und durch eine echte Datei ersetzt.
    (konf / "resume.json").unlink()
    (konf / "resume.json").write_text(json.dumps(bestand, indent=4))
    # Die Bereiche bleiben leer — sonst liefe die Schleife und man saehe nicht,
    # was der Zweig fuer den alten Ort allein tut.
    for kennung, _ in KINDER:
        (konf / "profile" / kennung / "resume.json").unlink()
    (konf / "profile" / "gast" / "resume.json").unlink()

    skript = skript_herrichten(quelle, konf, tm)
    lauf = subprocess.run(["bash", str(skript)], capture_output=True, text=True, timeout=120)

    try:
        da = len(json.loads((konf / "resume.json").read_text()))
    except Exception as e:  # noqa: BLE001
        da = f"unlesbar: {e}"
    aktiv, aktiv_zahl = KINDER[0]
    b.prueft(
        da == aktiv_zahl,
        f"der alte Ort wird mit der Zahl des AKTIVEN Kindes gekappt ({aktiv} → {aktiv_zahl})",
        f"{da} Eintraege — Ausgabe: {lauf.stdout.strip().splitlines()[-1] if lauf.stdout.strip() else '(nichts)'}",
    )
    b.prueft(
        (konf / "resume.json").exists() and not (konf / "resume.json").is_symlink(),
        "und er ist danach immer noch eine echte Datei",
        art(konf / "resume.json"),
    )
    if lauf.returncode != 0:
        b.prueft(False, "das Skript endete mit einem Fehler", lauf.stdout[-800:])


# ── G: die Gegenprobe ───────────────────────────────────────────────────────


def alte_quellen(tmp: Path, gegen: str) -> Path:
    """
    Die Fassung VOR der Aenderung — lauffaehig, aber INNERHALB von src/backend-api.

    WARUM DORT UND NICHT UNTER /tmp: `tsx` sucht `node_modules`, indem es vom
    Quelltext aus nach oben laeuft. Ein Verzeichnis unter /tmp faende express
    nicht. Also liegt die alte Fassung als verstecktes Verzeichnis IM Backend
    und wird danach wieder abgeraeumt.
    """
    ziel = BACKEND / ".merken-gegenprobe"
    if ziel.exists():
        shutil.rmtree(ziel)
    shutil.copytree(BACKEND / "src", ziel, ignore=shutil.ignore_patterns("*.spec.ts"))
    for datei in ("profile.ts", "server.ts"):
        alt = subprocess.run(
            ["git", "show", f"{gegen}:src/backend-api/src/{datei}"],
            cwd=str(BAUM),
            capture_output=True,
            text=True,
        )
        if alt.returncode != 0:
            raise SystemExit(f"{gegen}:src/backend-api/src/{datei} nicht lesbar: {alt.stderr}")
        (ziel / datei).write_text(alt.stdout)
    return ziel


def gegen_pruefen(gegen: str) -> None:
    """
    DER VERGLEICHSSTAND MUSS EIN ANDERER SEIN ALS DER, DEN WIR MESSEN.

    Zeigt er auf dieselben Dateien, vergleicht die Gegenprobe die neue Fassung
    mit sich selbst — und meldet „alles gruen", was wie ein Freispruch aussieht
    und keiner ist. Genau das ist passiert, als hier `HEAD` stand und die
    Aenderung festgeschrieben wurde. Also lieber laut abbrechen.
    """
    gleich = []
    for datei in ("src/backend-api/src/profile.ts", "scripts/mupibox/remove_max_resume.sh"):
        a = subprocess.run(["git", "show", f"{gegen}:{datei}"], cwd=str(BAUM), capture_output=True, text=True)
        if a.returncode != 0:
            raise SystemExit(f"{gegen}:{datei} nicht lesbar: {a.stderr}")
        if a.stdout == (BAUM / datei).read_text():
            gleich.append(datei)
    if gleich:
        raise SystemExit(
            f"GEGENPROBE UNBRAUCHBAR: `{gegen}` enthaelt dieselbe Fassung wie der Arbeitsbaum "
            f"({', '.join(gleich)}). Sie wuerde die neue Fassung mit sich selbst vergleichen "
            f"und ALLES GRUEN melden. Mit --gegen einen Stand VOR der Aenderung angeben."
        )


def teil_g(tmp: Path, port: int, behalten: bool, gegen: str) -> int:
    print("\n" + "═" * 76)
    print(f"G  DIE GEGENPROBE — dieselben Messungen gegen die Fassung aus {gegen}.")
    print("   A, B und F MUESSEN dort rot werden. Werden sie gruen, misst diese")
    print("   Probe nichts und ist wertlos.")
    print("═" * 76)
    alt_src = None
    alt_b = Befund()
    try:
        gegen_pruefen(gegen)
        alt_src = alte_quellen(tmp, gegen)
        konf, tm = sandkasten(tmp / "alt")
        p = server_starten(konf, tm, port, alt_src / "server.ts")
        try:
            if not wer_antwortet(port):
                print("  ! der alte Server kam nicht hoch — Gegenprobe nicht gemessen")
                return 1
            teil_a(alt_b, konf, port)
            teil_b(alt_b, konf, port)
        finally:
            p.terminate()
            try:
                p.wait(timeout=15)
            except subprocess.TimeoutExpired:
                p.kill()
        alt_skript = tmp / "alt-remove_max_resume.sh"
        roh = subprocess.run(
            ["git", "show", f"{gegen}:scripts/mupibox/remove_max_resume.sh"],
            cwd=str(BAUM),
            capture_output=True,
            text=True,
        )
        alt_skript.write_text(roh.stdout)
        teil_f(alt_b, tmp / "altf", alt_skript, "  (ALTE FASSUNG)")
        teil_f_alt(alt_b, tmp / "altf2", alt_skript, "  (ALTE FASSUNG)")
    finally:
        if alt_src and alt_src.exists() and not behalten:
            shutil.rmtree(alt_src, ignore_errors=True)

    rot = alt_b.rote()
    print("\n" + "─" * 76)
    if rot:
        print(f"  GEGENPROBE BESTANDEN: {rot} von {len(alt_b.zeilen)} Messungen werden mit")
        print("  der alten Fassung rot. Die Probe misst also wirklich etwas.")
        return 0
    print("  GEGENPROBE MISSLUNGEN: mit der ALTEN Fassung ist alles gruen.")
    print("  Dann prueft diese Probe nicht, was sie zu pruefen behauptet.")
    return 1


# ── main ────────────────────────────────────────────────────────────────────


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--nur", default="", help="nur diese Teile, z.B. ADF")
    ap.add_argument("--gegenprobe", action="store_true", help="zusaetzlich gegen den alten Stand messen")
    ap.add_argument("--gegen", default=GEGEN_VORGABE, help=f"Vergleichsstand (Vorgabe {GEGEN_VORGABE})")
    ap.add_argument("--behalten", action="store_true", help="Sandkasten stehenlassen")
    ap.add_argument("--port", type=int, default=9751, help="Wunschport (ab hier wird gesucht)")
    a = ap.parse_args()
    teile = (a.nur or "ABCDEF").upper()

    tmp = Path(tempfile.mkdtemp(prefix="merken-je-kind-"))
    b = Befund()
    schluss = 0
    try:
        port = freier_port(a.port)
        print(f"Sandkasten: {tmp}")
        print(f"Port: {port} (gebunden und wieder losgelassen; die Antwort wird an `{MARKE}` geprueft)")
        if set("ABCDE") & set(teile):
            konf, tm = sandkasten(tmp / "neu")
            p = server_starten(konf, tm, port)
            try:
                if not wer_antwortet(port):
                    print("  ! der Server kam nicht hoch oder gehoert nicht zu diesem Sandkasten")
                    return 2
                if "A" in teile:
                    teil_a(b, konf, port)
                if "B" in teile:
                    teil_b(b, konf, port)
                if "C" in teile:
                    teil_c(b, konf, port)
                if "D" in teile:
                    teil_d(b, konf, port)
                if "E" in teile:
                    teil_e(b, konf, port)
            finally:
                p.terminate()
                try:
                    p.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    p.kill()
        if "F" in teile:
            teil_f(b, tmp / "f", SKRIPT)
            teil_f_alt(b, tmp / "f2", SKRIPT)

        print("\n" + "═" * 76)
        rot = b.rote()
        if rot:
            print(f"  {rot} von {len(b.zeilen)} Messungen sind ROT.")
            schluss = 1
        else:
            print(f"  {len(b.zeilen)} Messungen, alle gruen.")

        if a.gegenprobe:
            schluss = max(schluss, teil_g(tmp, port, a.behalten, a.gegen))
    finally:
        if a.behalten:
            print(f"\nSandkasten bleibt: {tmp}")
        else:
            shutil.rmtree(tmp, ignore_errors=True)
    return schluss


if __name__ == "__main__":
    sys.exit(main())
