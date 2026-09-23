#!/usr/bin/env python3
"""
GEHT EINEM KIND ETWAS VERLOREN? — die Merktiefe je Kind, aus der Linse des Kindes.

WOZU NOCH EINE PROBE. `tools/merken-je-kind.py` misst, ob die Zahl je Kind
GREIFT. Diese hier misst das Gegenteil: was dabei WEGKOMMT. Sie fragt nicht
„tut es, was es soll", sondern „was verliert das Kind, und weiss der Erwachsene
es vorher". Das sind verschiedene Fragen, und die zweite faellt bei der ersten
regelmaessig hinten herunter.

    python3 tools/merken-verlust-linse.py               # alles
    python3 tools/merken-verlust-linse.py --nur VG      # nur diese Teile
    python3 tools/merken-verlust-linse.py --gegenprobe  # wird es rot mit der
                                                        #   Fassung vor 4e538125?
    python3 tools/merken-verlust-linse.py --behalten    # Sandkasten stehenlassen
    python3 tools/merken-verlust-linse.py --port 9771   # eigener Port

DIE TEILE
  V  HERUNTER, KAPPEN, HERAUF. Von 11 auf 3, das Skript laeuft, zurueck auf 11
     — kommen die Stellen wieder? (Nein.) Und was bekommt der Mensch in jedem
     dieser Schritte WIRKLICH zu lesen? Gemessen wird die Antwort Feld fuer
     Feld, nicht die Absicht.
  G  DREI KINDER GLEICHZEITIG. Jedes bekommt seine Zahl — gezaehlt in der
     DATEI. Die Bestaende schreibt der SERVER (nicht die Probe), damit die
     Eintraege so aussehen wie auf der Box. Danach der Verweis mit `lstat`.
  U  UEBERLEBT DIE ZAHL: Serverneustart, Profilwechsel, Umbenennen, das
     LOESCHEN EINES ANDEREN KINDES — und die Gegenfrage, ob sie beim Loeschen
     wirklich mitgeht (eine Kennung wird geloescht und gleich wieder angelegt).
  S  DIE SICHERUNG. Sichern, wegraeumen, zurueckspielen, NACHZAEHLEN — mit
     `scripts/mupibox/mupibox-sicherung.py`, im Sandkasten. „Es steht in der
     Aufnahmeliste" ist keine Messung.
  K  DIE KANTEN, an denen die Zusagen enden:
       K1 `PUT /api/profile` setzt die Zahl OHNE die 409-Rueckfrage.
       K2 Server und Skript zaehlen verschieden, sobald ein fremder Eintrag
          (nicht `category: "resume"`) in der Datei liegt.
       K3 Was `GET /api/profil/merken` NICHT sagt, wenn schon zu viel dasteht.

NIEMALS GEGEN DIE ECHTE BOX. Alles laeuft in einem Sandkasten unter /tmp gegen
einen EIGENEN Server auf einem EIGENEN Port. Der Port wird vorher wirklich
gebunden, und danach wird an einer Kennung nachgesehen, die es sonst nirgends
gibt, dass die Antwort aus DIESEM Sandkasten kommt — auf diesem Rechner laufen
fremde Sitzungen.
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
KAPP_SKRIPT = BAUM / "scripts" / "mupibox" / "remove_max_resume.sh"
SICHERUNG = BAUM / "scripts" / "mupibox" / "mupibox-sicherung.py"

# Die Pfade, die in den Skripten fest verdrahtet stehen.
BOX_BAUM = "/home/dietpi/.mupibox/Sonos-Kids-Controller-master"
BOX_KONFIG = BOX_BAUM + "/server/config"
BOX_STAENDE = "/home/dietpi/.mupibox/sicherungen"

# Die Kennung, an der DIESER Sandkasten wiederzuerkennen ist. Sie steht in
# keiner echten Box und in keiner anderen Probe — auch nicht in
# tools/merken-je-kind.py, sonst verwechselten die beiden sich gegenseitig.
MARKE = "linse-merken-a"

# Die Box-Zahl. Absichtlich weder 9 (Vorgabe des Skripts) noch eine der
# Kinderzahlen: sonst liesse sich nicht unterscheiden, ob die Kinderzahl
# gegriffen hat oder ob zufaellig dasselbe herauskam.
BOX_ZAHL = 7

KINDER = [
    (MARKE, 4),
    ("linse-merken-b", 11),
    ("linse-merken-c", 2),
    ("linse-merken-d", None),
]

# Mehr Werke als jede dieser Zahlen — sonst schluege kein Deckel zu.
WERKE = 15


class Befund:
    def __init__(self) -> None:
        self.zeilen: list[tuple[bool, str, str]] = []

    def prueft(self, ok: bool, was: str, gemessen: str = "") -> bool:
        self.zeilen.append((bool(ok), was, gemessen))
        print(f"  {'OK  ' if ok else 'ROT '} {was}")
        if gemessen:
            print(f"        gemessen: {gemessen}")
        return bool(ok)

    def merkt(self, was: str, gemessen: str) -> None:
        """Eine BEOBACHTUNG ohne Urteil — sie faerbt den Lauf nicht."""
        print(f"  --   {was}")
        print(f"        gemessen: {gemessen}")

    def rote(self) -> int:
        return sum(1 for ok, _, _ in self.zeilen if not ok)


# ── Der Sandkasten ──────────────────────────────────────────────────────────


def sandkasten(tmp: Path) -> tuple[Path, Path]:
    """
    Der Aufbau der Box, soweit er hier zaehlt — und in der Form, die BEIDE
    Skripte erwarten.

    NICHT NUR `server/config`: `mupibox-sicherung.py` sichert zwei Baeume
    (`/etc/mupibox` und `<box>/server/config`). Ein Sandkasten, der nur den
    einen kennt, kann die Sicherung nicht messen — und genau das ist die
    Frage, die hier offen war.
    """
    box = tmp / "box"
    konf = box / "server" / "config"
    etc = tmp / "etc" / "mupibox"
    tm = tmp / "lauf"
    for p in (konf / "profile", etc, tm, tmp / "staende"):
        p.mkdir(parents=True, exist_ok=True)

    medien = [
        {
            "type": "spotify",
            "category": "audiobook",
            "id": f"w{i}",
            "title": f"Werk {i}",
            "artist": "Linse",
        }
        for i in range(WERKE)
    ]
    (konf / "data.json").write_text(json.dumps(medien, indent=4))
    (konf / "active_data.json").write_text(json.dumps(medien, indent=4))

    profile = []
    for kennung, zahl in KINDER:
        (konf / "profile" / kennung).mkdir(exist_ok=True)
        (konf / "profile" / kennung / "resume.json").write_text("[]")
        p = {"kennung": kennung, "name": kennung.upper(), "figur": "", "angelegt": 1}
        if zahl is not None:
            p["merken"] = zahl
        profile.append(p)
    (konf / "profile" / "gast").mkdir(exist_ok=True)
    (konf / "profile" / "gast" / "resume.json").write_text("[]")
    (konf / "profile.json").write_text(json.dumps({"profile": profile, "aktiv": MARKE}, indent=4))

    # DIE BRUECKE — relativ, genau wie server.ts sie legt.
    bruecke = konf / "resume.json"
    if not bruecke.is_symlink() and not bruecke.exists():
        bruecke.symlink_to(f"profile/{MARKE}/resume.json")

    (etc / "mupiboxconfig.json").write_text(
        json.dumps({"mupibox": {"resume": BOX_ZAHL, "audioDevice": "hw:0,0"}}, indent=4)
    )
    (tm / "network.json").write_text('{"onlinestate":"starting"}')
    return konf, tm


def freier_port(wunsch: int) -> int:
    """
    Einen Port SUCHEN, indem man ihn wirklich bindet — nicht „ist da was?"
    fragen und hoffen. Was danach wirklich antwortet, prueft `wer_antwortet`.
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


def server_starten(tmp: Path, port: int, quelle: Path | None = None) -> subprocess.Popen:
    konf = tmp / "box" / "server" / "config"
    umg = {
        **os.environ,
        "NODE_ENV": "development",
        "MUPIBOX_CONFIG_DIR": str(konf),
        "MUPIBOX_CONFIG": str(tmp / "etc" / "mupibox" / "mupiboxconfig.json"),
        "MUPIBOX_LOCK_DIR": str(tmp / "lauf"),
        "MUPIBOX_HTTP_PORT": str(port),
        "MUPIBOX_TLS_DIR": str(tmp / "lauf" / "tls"),
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


def server_beenden(p: subprocess.Popen) -> None:
    p.terminate()
    try:
        p.wait(timeout=20)
    except subprocess.TimeoutExpired:
        p.kill()
        p.wait(timeout=10)


def hole(port: int, weg: str, rumpf=None, art: str = "GET") -> tuple[int, object]:
    r = urllib.request.Request(f"http://127.0.0.1:{port}{weg}", method=art)
    daten = None
    if rumpf is not None:
        daten = json.dumps(rumpf).encode()
        r.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(r, daten, timeout=20) as a:
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

    Auf diesem Rechner laufen fremde Sitzungen. Ein offener Port beweist gar
    nichts; ein Server einer anderen Sitzung wuerde jede Messung still
    verfaelschen. Bewiesen wird es an `MARKE`.
    """
    ende = time.time() + frist
    while time.time() < ende:
        code, antwort = hole(port, "/api/profile")
        if code == 200 and isinstance(antwort, dict):
            kennungen = [p.get("kennung") for p in antwort.get("profile", [])]
            if MARKE in kennungen:
                return True
            print(f"  ! Port {port} antwortet, aber das ist NICHT dieser Sandkasten: {kennungen}")
            return False
        time.sleep(0.4)
    return False


def stellen(konf: Path, kennung: str) -> list:
    try:
        roh = json.loads((konf / "profile" / kennung / "resume.json").read_text())
        return roh if isinstance(roh, list) else []
    except Exception:  # noqa: BLE001
        return []


def zahl_in_datei(konf: Path, kennung: str):
    """Was in profile.json BEIM KIND steht — `...` heisst „Feld nicht da"."""
    try:
        roh = json.loads((konf / "profile.json").read_text())
    except Exception:  # noqa: BLE001
        return "(profile.json unlesbar)"
    e = next((p for p in roh.get("profile", []) if p.get("kennung") == kennung), None)
    if e is None:
        return "(kein Eintrag)"
    return e.get("merken", "(kein Feld)")


def hoeren(port: int, kennung: str, wieviel: int = WERKE) -> None:
    """Das Kind hoert `wieviel` Werke — ueber den Weg, den die Box wirklich geht."""
    code, _ = hole(port, "/api/profil/aktiv", {"kennung": kennung}, "POST")
    assert code == 200, f"Umschalten auf {kennung} misslang: {code}"
    for i in range(wieviel):
        hole(
            port,
            "/api/weiterhoeren",
            {"schluessel": f"spotify:w{i}", "titelNr": 2, "bisher": 120, "dauer": 900},
            "POST",
        )


def art(p: Path) -> str:
    """Verweis, Datei oder nichts — mit `lstat`. `stat` folgt dem Verweis und
    sieht keinen Unterschied; genau daran ist am 07.08. schon eine Probe blind
    gewesen."""
    if p.is_symlink():
        return f"Verweis -> {os.readlink(p)}" + ("" if p.exists() else "  (TOT)")
    if p.exists():
        return "echte Datei"
    return "fehlt"


def kappskript(quelle: Path, tmp: Path) -> Path:
    """
    `remove_max_resume.sh` in den Sandkasten biegen — PFADE, sonst nichts.

    Jede jq-Kette und jedes `cat >` laeuft im Wortlaut. Wer hier mehr
    umschreibt, misst sein eigenes Umschreiben.
    """
    konf = tmp / "box" / "server" / "config"
    tm = tmp / "lauf"
    text = quelle.read_text()
    text = text.replace(BOX_KONFIG, str(konf))
    text = text.replace("/tmp/.resume.lock", str(tm / ".resume.lock"))
    text = text.replace("/tmp/.resume.json", str(tm / ".resume.json"))
    text = text.replace("/etc/mupibox/mupiboxconfig.json", str(tmp / "etc" / "mupibox" / "mupiboxconfig.json"))
    text = text.replace('if [ "$EUID" -ne 0 ]\n  then echo "Please run as root"\n  exit\nfi', "")
    text = text.replace("sudo /usr/bin/jq", "jq").replace("sudo /usr/bin/", "").replace("sudo ", "")
    text = "\n".join(z for z in text.splitlines() if "chown" not in z and "chmod" not in z)
    ziel = tmp / "lauf" / f"kapp-{quelle.name}"
    ziel.write_text(text)
    ziel.chmod(0o755)
    return ziel


def kappen_lassen(skript: Path) -> subprocess.CompletedProcess:
    return subprocess.run(["bash", str(skript)], capture_output=True, text=True, timeout=180)


# ── V: herunter, kappen, herauf ─────────────────────────────────────────────


def teil_v(b: Befund, tmp: Path, port: int, skript: Path) -> None:
    konf = tmp / "box" / "server" / "config"
    print("\n══ V  HERUNTER, KAPPEN, HERAUF — KOMMEN DIE STELLEN ZURUECK?")
    print("   Und, wichtiger: was liest der Mensch in JEDEM Schritt? Nicht was")
    print("   der Code meint, sondern was ueber die Leitung geht.\n")
    kennung = KINDER[1][0]  # merken = 11

    hoeren(port, kennung)
    b.prueft(
        len(stellen(konf, kennung)) == 11,
        f"Vorbedingung: {kennung} hat 11 gemerkte Stellen (eigene Zahl 11)",
        f"{len(stellen(konf, kennung))} Eintraege in der Datei",
    )

    # ── 1. Der erste Versuch: 11 -> 3, ohne Bestaetigung.
    code, warnung = hole(port, "/api/profil/merken", {"profil": kennung, "merken": 3}, "PUT")
    b.prueft(
        code == 409 and isinstance(warnung, dict) and warnung.get("verliert") == 8,
        "11 -> 3 ohne `bestaetigt`: 409 und die Zahl, die es kosten wuerde (8)",
        f"{code} {warnung}",
    )
    # WAS DER MENSCH DA WIRKLICH BEKOMMT. Eine Zahl allein ist keine Warnung;
    # sie muss sagen, WESSEN Stellen und dass es keinen Weg zurueck gibt.
    felder = sorted(warnung.keys()) if isinstance(warnung, dict) else []
    b.merkt(
        "die 409 traegt genau diese Felder — mehr steht der Oberflaeche nicht zur Verfuegung",
        str(felder),
    )
    b.prueft(
        isinstance(warnung, dict) and warnung.get("profil") == kennung,
        'sie sagt WESSEN Stellen es sind (`profil`) — sonst koennte die Seite nur „8" hinschreiben',
        str(warnung.get("profil") if isinstance(warnung, dict) else warnung),
    )
    b.prueft(
        len(stellen(konf, kennung)) == 11 and zahl_in_datei(konf, kennung) == 11,
        "und NICHTS ist geschrieben — weder die Zahl noch eine Stelle ist weg",
        f"{len(stellen(konf, kennung))} Stellen, merken={zahl_in_datei(konf, kennung)}",
    )

    # ── 2. Mit Bestaetigung. Es wird gesetzt, aber nichts geloescht.
    code, gesetzt = hole(
        port, "/api/profil/merken", {"profil": kennung, "merken": 3, "bestaetigt": True}, "PUT"
    )
    b.prueft(code == 200, "mit `bestaetigt: true` wird die Zahl gesetzt", f"{code} {gesetzt}")
    b.prueft(
        len(stellen(konf, kennung)) == 11,
        "das SETZEN loescht nichts — die 11 Stellen stehen noch",
        f"{len(stellen(konf, kennung))} Eintraege",
    )

    # ── 3. DER ZUSTAND DAZWISCHEN. Die Zahl steht auf 3, es liegen aber 11
    #      Stellen da. Sie fallen beim naechsten Kappen. Sagt das jemand?
    code, jetzt = hole(port, f"/api/profil/merken?profil={kennung}")
    b.prueft(
        isinstance(jetzt, dict) and jetzt.get("gilt") == 3 and jetzt.get("hatte") == 11,
        "die Auskunft zeigt den Zwischenzustand: gilt=3, hatte=11",
        f"{code} {jetzt}",
    )
    b.prueft(
        isinstance(jetzt, dict) and "verliert" in jetzt,
        "GET sagt AUSDRUECKLICH, dass 8 Stellen auf der Kippe stehen (`verliert`)",
        f"Felder: {sorted(jetzt.keys()) if isinstance(jetzt, dict) else jetzt}",
    )

    # ── 4. Das Skript laeuft — jetzt faellt es wirklich.
    lauf = kappen_lassen(skript)
    nach = len(stellen(konf, kennung))
    b.prueft(
        nach == 3,
        "nach dem Lauf des Skripts sind es 3 — die acht Stellen sind WEG",
        f"{nach} Eintraege (Skript: {lauf.returncode})",
    )

    # ── 5. Zurueck auf 11. Kommen sie wieder? (Die Antwort ist nein — die
    #      Frage ist, ob es jemand SAGT.)
    code, zurueck = hole(
        port, "/api/profil/merken", {"profil": kennung, "merken": 11, "bestaetigt": True}, "PUT"
    )
    b.prueft(
        code == 200 and len(stellen(konf, kennung)) == 3,
        "zurueck auf 11: die Stellen kommen NICHT wieder (3 bleiben 3)",
        f"{code}, {len(stellen(konf, kennung))} Eintraege",
    )
    b.merkt(
        "und die Antwort auf das Heraufsetzen sagt dazu nichts — sie sieht aus wie ein Erfolg",
        str(zurueck),
    )
    # Aber es waechst wieder — die Zahl ist keine Narbe.
    hoeren(port, kennung)
    b.prueft(
        len(stellen(konf, kennung)) == 11,
        "danach waechst es wieder auf 11 — die Zahl selbst ist nicht beschaedigt",
        f"{len(stellen(konf, kennung))} Eintraege",
    )

    # ── 6. UND DER WEG, DER GAR NICHT FRAGT: das naechste Merken kappt selbst.
    #      Wer die Zahl herabsetzt und das Kind hoert weiter, verliert die
    #      Stellen OHNE dass das Skript je gelaufen ist.
    hole(port, "/api/profil/merken", {"profil": kennung, "merken": 5, "bestaetigt": True}, "PUT")
    b.prueft(
        len(stellen(konf, kennung)) == 11,
        "auf 5 gesetzt: noch stehen alle 11 da",
        f"{len(stellen(konf, kennung))} Eintraege",
    )
    hole(port, "/api/profil/aktiv", {"kennung": kennung}, "POST")
    hole(
        port,
        "/api/weiterhoeren",
        {"schluessel": "spotify:w0", "titelNr": 3, "bisher": 200, "dauer": 900},
        "POST",
    )
    b.prueft(
        len(stellen(konf, kennung)) == 5,
        "EIN einziges Weiterhoeren kappt auf 5 — ohne Skript, ohne Rueckfrage",
        f"{len(stellen(konf, kennung))} Eintraege nach einer Meldung",
    )


# ── G: drei Kinder gleichzeitig ─────────────────────────────────────────────


def teil_g(b: Befund, tmp: Path, port: int, skript: Path) -> None:
    konf = tmp / "box" / "server" / "config"
    print("\n══ G  DREI KINDER GLEICHZEITIG — JEDE DATEI BEI IHRER ZAHL")
    print("   Die Bestaende schreibt der SERVER, nicht die Probe: nur so sehen")
    print("   die Eintraege aus wie auf der Box (das Skript sortiert nach")
    print("   `.index`, und ob der dasteht, entscheidet der Server).\n")

    # Jedes Kind auf eine bekannte Zahl setzen und volle Listen hoeren lassen.
    for kennung, zahl in KINDER:
        if zahl is not None:
            hole(
                port, "/api/profil/merken", {"profil": kennung, "merken": zahl, "bestaetigt": True}, "PUT"
            )
    for kennung, _ in KINDER:
        hoeren(port, kennung)
    hoeren(port, "gast")
    # Am Ende ist EIN Kind aktiv — die Bruecke zeigt auf den Gast.
    hole(port, "/api/profil/aktiv", {"kennung": MARKE}, "POST")

    # Die Deckel des Servers haben schon gekappt. Damit das SKRIPT etwas zu tun
    # hat, wird jede Datei jetzt ueber ihre Zahl hinaus gefuellt — mit den
    # Eintraegen, die der Server geschrieben hat, vervielfacht.
    for kennung, _ in KINDER + [("gast", None)]:
        da = stellen(konf, kennung)
        if not da:
            continue
        voll = []
        for i in range(WERKE):
            e = dict(da[i % len(da)])
            e["id"] = f"voll{i}"
            e["title"] = f"Voll {i}"
            voll.append(e)
        (konf / "profile" / kennung / "resume.json").write_text(json.dumps(voll, indent=4))

    hat_index = any("index" in e for e in stellen(konf, MARKE))
    b.merkt(
        "traegt ein vom Server geschriebener Eintrag ein `index`-Feld? "
        "(davon haengt ab, WELCHE Stellen das Skript wegnimmt)",
        f"index vorhanden: {hat_index} — Felder: {sorted(stellen(konf, MARKE)[0].keys())}",
    )

    lauf = kappen_lassen(skript)
    for kennung, zahl in KINDER:
        erwartet = BOX_ZAHL if zahl is None else zahl
        da = len(stellen(konf, kennung))
        b.prueft(
            da == erwartet,
            f"{kennung}: in der DATEI stehen {erwartet} ({'eigene Zahl' if zahl is not None else 'Box-Zahl'})",
            f"{da} Eintraege",
        )
    b.prueft(
        len(stellen(konf, "gast")) == BOX_ZAHL,
        f"der Gast ohne eigene Zahl: Box-Zahl {BOX_ZAHL}",
        f"{len(stellen(konf, 'gast'))} Eintraege",
    )
    # DAS KIND, AUF DAS DIE BRUECKE NICHT ZEIGT, wird auch gekappt.
    nicht_aktiv = [k for k, _ in KINDER if k != MARKE]
    b.prueft(
        all(len(stellen(konf, k)) <= BOX_ZAHL + 5 for k in nicht_aktiv),
        "auch die Kinder, auf die die Bruecke NICHT zeigt, wurden angefasst",
        str({k: len(stellen(konf, k)) for k in nicht_aktiv}),
    )
    b.prueft(
        (konf / "resume.json").is_symlink(),
        "UND DER VERWEIS STEHT DANACH NOCH (lstat, nicht stat)",
        f"alter Ort: {art(konf / 'resume.json')}",
    )
    b.prueft(
        (konf / "resume.json").is_symlink() and os.readlink(konf / "resume.json").endswith(f"{MARKE}/resume.json"),
        "und er zeigt noch auf dasselbe Kind",
        art(konf / "resume.json"),
    )
    # DIE ERSTEN ODER DIE LETZTEN? Was weggenommen wird, muss das AELTESTE sein.
    uebrig = [e.get("id") for e in stellen(konf, MARKE)]
    b.prueft(
        uebrig == [f"voll{i}" for i in range(WERKE - 4, WERKE)],
        "und weggenommen wird das AELTESTE (vorn), nicht das juengste",
        f"uebrig: {uebrig}",
    )
    if lauf.returncode != 0:
        b.prueft(False, "das Skript endete mit einem Fehler", lauf.stdout[-800:])


# ── U: ueberlebt die Zahl ───────────────────────────────────────────────────


def teil_u(b: Befund, tmp: Path, port: int, server: list) -> None:
    konf = tmp / "box" / "server" / "config"
    print("\n══ U  UEBERLEBT DIE ZAHL — NEUSTART, WECHSEL, LOESCHEN EINES ANDEREN")
    print("   Gefragt ist BEIDES: sie darf nicht verschwinden, wenn sie soll,")
    print("   und sie MUSS verschwinden, wenn das Kind geht.\n")

    for kennung, zahl in KINDER:
        if zahl is not None:
            hole(port, "/api/profil/merken", {"profil": kennung, "merken": zahl, "bestaetigt": True}, "PUT")
    vorher = {k: zahl_in_datei(konf, k) for k, z in KINDER if z is not None}

    # ── Profilwechsel
    for kennung, _ in KINDER:
        hole(port, "/api/profil/aktiv", {"kennung": kennung}, "POST")
    b.prueft(
        {k: zahl_in_datei(konf, k) for k in vorher} == vorher,
        "vier Profilwechsel lassen jede Zahl stehen",
        str({k: zahl_in_datei(konf, k) for k in vorher}),
    )

    # ── Umbenennen und Bildwechsel des AKTIVEN
    hole(port, "/api/profil/aktiv", {"kennung": MARKE}, "POST")
    hole(port, "/api/profil/name", {"name": "Umbenannt"}, "POST")
    hole(port, "/api/profil/figur", {"figur": ""}, "POST")
    b.prueft(
        {k: zahl_in_datei(konf, k) for k in vorher} == vorher,
        "Umbenennen und Bildwechsel lassen jede Zahl stehen",
        str({k: zahl_in_datei(konf, k) for k in vorher}),
    )

    # ── DAS LOESCHEN EINES ANDEREN KINDES. Der gefaehrlichste Weg: die
    #    Verwaltung schickt die GANZE Liste und kennt das Feld nicht.
    code, alle = hole(port, "/api/profile")
    schlank = [
        {"kennung": p["kennung"], "name": p["name"], "figur": p["figur"], "angelegt": p["angelegt"]}
        for p in alle["profile"]
        if p["kennung"] != KINDER[2][0]
    ]
    hole(port, "/api/profile", schlank, "PUT")
    uebrig = {k: zahl_in_datei(konf, k) for k, z in KINDER if z is not None and k != KINDER[2][0]}
    b.prueft(
        uebrig == {k: v for k, v in vorher.items() if k != KINDER[2][0]},
        f"das Loeschen von {KINDER[2][0]} laesst die Zahlen der ANDEREN stehen",
        str(uebrig),
    )
    b.prueft(
        zahl_in_datei(konf, KINDER[2][0]) == "(kein Eintrag)",
        "und die Zahl des geloeschten Kindes ist mit ihm gegangen",
        str(zahl_in_datei(konf, KINDER[2][0])),
    )

    # ── UND DIE GEGENFRAGE: eine Kennung wieder anlegen. Bekommt das NEUE Kind
    #    die Zahl des alten untergeschoben? (Am 07.08. ist beim Loeschen schon
    #    einmal etwas hinter dem Ordner liegengeblieben.)
    neu = schlank + [
        {"kennung": KINDER[2][0], "name": "Neues Kind", "figur": "", "angelegt": 2}
    ]
    hole(port, "/api/profile", neu, "PUT")
    b.prueft(
        zahl_in_datei(konf, KINDER[2][0]) == "(kein Feld)",
        f"dieselbe Kennung neu angelegt: KEINE alte Zahl kommt zurueck ({KINDER[2][0]})",
        str(zahl_in_datei(konf, KINDER[2][0])),
    )
    b.merkt(
        "was aber vom alten Kind im Ordner liegenblieb (das ist eine ANDERE Frage als die Zahl)",
        f"profile/{KINDER[2][0]}/: {sorted(p.name for p in (konf / 'profile' / KINDER[2][0]).iterdir())}"
        if (konf / "profile" / KINDER[2][0]).is_dir()
        else "Ordner weg",
    )

    # ── DER NEUSTART. profile.json wird beim Start gelesen; wenn `merken`
    #    dabei durchfaellt, merkt es niemand — bis die Box neu startet.
    vor_neustart = {k: zahl_in_datei(konf, k) for k, z in KINDER if z is not None and k != KINDER[2][0]}
    server_beenden(server[0])
    server[0] = server_starten(tmp, port)
    if not wer_antwortet(port):
        b.prueft(False, "der Server kam nach dem Neustart nicht wieder hoch", "kein Kontakt")
        return
    nach = {}
    for kennung in vor_neustart:
        code, a = hole(port, f"/api/profil/merken?profil={kennung}")
        nach[kennung] = a.get("merken") if isinstance(a, dict) else a
    b.prueft(
        nach == vor_neustart,
        "der SERVERNEUSTART laesst jede Zahl stehen — sie kommt aus der Datei zurueck",
        f"vorher {vor_neustart} / nachher {nach}",
    )


# ── S: die Sicherung ────────────────────────────────────────────────────────


def sicherungsskript(tmp: Path) -> Path:
    """
    `mupibox-sicherung.py` in den Sandkasten biegen — die drei festen Pfade.

    Nur Pfade. Die Aufnahmelisten (`HINEIN`), das Packen und das Zurueckspielen
    laufen im Wortlaut; sonst misst man wieder sein eigenes Umschreiben.
    """
    text = SICHERUNG.read_text()
    text = text.replace(f'BOX = "{BOX_BAUM}"', f'BOX = "{tmp / "box"}"')
    text = text.replace(f'STAENDE = "{BOX_STAENDE}"', f'STAENDE = "{tmp / "staende"}"')
    text = text.replace('"etc/mupibox": "/etc/mupibox"', f'"etc/mupibox": "{tmp / "etc" / "mupibox"}"')
    text = text.replace('SPERRE = "/run/mupibox-sicherung-laeuft"', f'SPERRE = "{tmp / "lauf" / "sicherung-laeuft"}"')
    text = text.replace('KARTE = "/boot/firmware"', f'KARTE = "{tmp / "karte"}"')
    ziel = tmp / "lauf" / "sicherung.py"
    ziel.write_text(text)
    ziel.chmod(0o755)
    return ziel


def teil_s(b: Befund, tmp: Path, port: int, server: list) -> None:
    konf = tmp / "box" / "server" / "config"
    print("\n══ S  DIE SICHERUNG — IST DIE ZAHL WIRKLICH IN EINEM STAND DRIN?")
    print('   „Sie steht in der Aufnahmeliste" ist keine Messung. Also:')
    print("   sichern, wegraeumen, zurueckspielen, NACHZAEHLEN.\n")

    for kennung, zahl in KINDER:
        if zahl is not None and zahl_in_datei(konf, kennung) not in ("(kein Eintrag)",):
            hole(port, "/api/profil/merken", {"profil": kennung, "merken": zahl, "bestaetigt": True}, "PUT")
    hoeren(port, MARKE, 6)
    # DER GAST GEHOERT DAZU. `profilStandNormalisieren` stellt ihn immer her —
    # eine Erwartung ohne ihn vergliche das Archiv mit einer Box, die es nicht
    # gibt.
    alle_kinder = [k for k, _ in KINDER] + ["gast"]
    soll_zahlen = {k: zahl_in_datei(konf, k) for k in alle_kinder}
    soll_stellen = {k: len(stellen(konf, k)) for k in alle_kinder}
    soll_bruecke = art(konf / "resume.json")

    skript = sicherungsskript(tmp)
    lauf = subprocess.run(
        [sys.executable, str(skript), "--anlegen", "--grund", "linse", "--json"],
        capture_output=True,
        text=True,
        timeout=300,
    )
    staende = sorted((tmp / "staende").glob("*.tar.gz"))
    if not b.prueft(
        lauf.returncode == 0 and bool(staende),
        "ein Stand laesst sich anlegen",
        f"rc={lauf.returncode} staende={[s.name for s in staende]} {lauf.stderr[-400:]}",
    ):
        return

    # DIE ZAHL IM ARCHIV — nachgesehen, nicht geglaubt.
    im_archiv = subprocess.run(
        ["tar", "-xzOf", str(staende[-1]), "--wildcards", "*server/config/profile.json"],
        capture_output=True,
        text=True,
        timeout=60,
    )
    drin = {}
    try:
        for p in json.loads(im_archiv.stdout).get("profile", []):
            drin[p["kennung"]] = p.get("merken", "(kein Feld)")
    except Exception as e:  # noqa: BLE001
        drin = {"fehler": str(e)}
    b.prueft(
        drin == soll_zahlen,
        "die Zahl JEDES Kindes liegt im Archiv — direkt aus dem tar gelesen",
        f"im Archiv {drin} / erwartet {soll_zahlen}",
    )

    # ── WEGRAEUMEN. Nicht nur profile.json: auch die Bestaende und die Bruecke,
    #    so wie es nach einem Kartenwechsel aussieht. MIT ABGESCHALTETEM SERVER
    #    — so spielt man auf einer Box zurueck, und nur so misst man die Datei
    #    und nicht den Arbeitsspeicher eines Servers, der den alten Stand haelt.
    server_beenden(server[0])
    server[0] = None
    (konf / "profile.json").unlink()
    for kennung in alle_kinder:
        d = konf / "profile" / kennung / "resume.json"
        if d.exists():
            d.unlink()
    if (konf / "resume.json").is_symlink():
        (konf / "resume.json").unlink()

    zurueck = subprocess.run(
        [sys.executable, str(skript), "--wiederherstellen", staende[-1].name, "--trotzdem"],
        capture_output=True,
        text=True,
        timeout=300,
    )
    b.prueft(
        zurueck.returncode == 0,
        "und er laesst sich zurueckspielen",
        f"rc={zurueck.returncode} {zurueck.stdout[-500:]}{zurueck.stderr[-300:]}",
    )
    b.prueft(
        {k: zahl_in_datei(konf, k) for k in alle_kinder} == soll_zahlen,
        "NACH DEM ZURUECKSPIELEN steht bei jedem Kind wieder SEINE Zahl",
        f"{ {k: zahl_in_datei(konf, k) for k in alle_kinder} }",
    )
    b.prueft(
        {k: len(stellen(konf, k)) for k in alle_kinder} == soll_stellen,
        "und die gemerkten Stellen sind auch wieder da",
        f"{ {k: len(stellen(konf, k)) for k in alle_kinder} } / erwartet {soll_stellen}",
    )

    # ── DIE BRUECKE. Das Zurueckspielen legt sie NICHT wieder an — es sagt das
    #    sogar hin („Verweis (NICHT angefasst)"). Das ist kein Versehen: der
    #    Server legt sie beim naechsten Lesen selbst (`resumeBrueckeRichten`).
    #    ABER ES IST EINE ANNAHME, und Annahmen ueber die Bruecke sind an
    #    dieser Stelle heute schon zweimal falsch gewesen. Also gemessen.
    b.merkt(
        "gleich nach dem Zurueckspielen ist die Bruecke noch nicht da "
        "(das Zurueckspielen fasst Verweise nicht an)",
        art(konf / "resume.json"),
    )
    server[0] = server_starten(tmp, port)
    if not wer_antwortet(port):
        b.prueft(False, "der Server kam nach dem Zurueckspielen nicht hoch", "kein Kontakt")
        return
    hole(port, "/api/profil/aktiv", {"kennung": MARKE}, "POST")
    hole(port, "/api/resume")
    b.prueft(
        art(konf / "resume.json") == soll_bruecke,
        "aber der erste Serverstart danach legt sie wieder an — Verweis auf dasselbe Kind (lstat)",
        f"{art(konf / 'resume.json')} / vorher {soll_bruecke}",
    )
    b.prueft(
        {k: len(stellen(konf, k)) for k in alle_kinder} == soll_stellen,
        "und dabei geht keine zurueckgespielte Stelle verloren",
        f"{ {k: len(stellen(konf, k)) for k in alle_kinder} }",
    )
    nach = {}
    for kennung in alle_kinder:
        code, a = hole(port, f"/api/profil/merken?profil={kennung}")
        nach[kennung] = (a.get("merken") if isinstance(a, dict) else a) or "(kein Feld)"
    b.prueft(
        nach == {k: (v if v != "(kein Feld)" else "(kein Feld)") for k, v in soll_zahlen.items()},
        "und der Server liest die zurueckgespielten Zahlen auch wieder",
        f"{nach} / erwartet {soll_zahlen}",
    )


# ── K: die Kanten ───────────────────────────────────────────────────────────


def teil_k(b: Befund, tmp: Path, port: int, skript: Path) -> None:
    konf = tmp / "box" / "server" / "config"
    print("\n══ K  DIE KANTEN — WO DIE ZUSAGEN AUFHOEREN")
    print('   Der Riegel soll „im Server stehen, damit ihn jede Oberflaeche')
    print('   erbt". Hier wird gefragt, ob das stimmt.\n')
    kennung = KINDER[0][0]

    # ── K1: DER ZWEITE WEG AN DIESELBE ZAHL. `PUT /api/profil/merken` fragt
    #        nach; `PUT /api/profile` nimmt dieselbe Zahl als Feld in der Liste
    #        entgegen. Erbt es den Riegel wirklich?
    hole(port, "/api/profil/merken", {"profil": kennung, "merken": 12, "bestaetigt": True}, "PUT")
    hoeren(port, kennung)
    vor = len(stellen(konf, kennung))

    def liste_mit(merken=None, wer: str = kennung) -> list:
        _, alle = hole(port, "/api/profile")
        return [
            {
                "kennung": p["kennung"],
                "name": p["name"],
                "figur": p["figur"],
                "angelegt": p["angelegt"],
                **({"merken": merken} if p["kennung"] == wer and merken is not None else {}),
            }
            for p in alle["profile"]
        ]

    code, antwort = hole(port, "/api/profile", liste_mit(1), "PUT")
    b.prueft(
        code == 409,
        "`PUT /api/profile` mit merken=1 bei 12 Stellen wird ABGEWIESEN — "
        "sonst umgeht jede Oberflaeche den Riegel",
        f"{code} {antwort}",
    )
    b.prueft(
        zahl_in_datei(konf, kennung) == 12 and len(stellen(konf, kennung)) == vor,
        "und nichts ist angefasst — weder die Zahl noch eine Stelle",
        f"merken={zahl_in_datei(konf, kennung)}, {len(stellen(konf, kennung))} Stellen",
    )
    b.prueft(
        isinstance(antwort, dict) and antwort.get("ueber") == "/api/profil/merken",
        "die Absage nennt den Weg, der die Rueckfrage stellen kann",
        str(antwort),
    )
    # ABER: was nichts kostet, muss weiter durchgehen — sonst waere das Feld
    # auf diesem Weg unbenutzbar (Umbenennen schickt die ganze Liste mit).
    code, _ = hole(port, "/api/profile", liste_mit(40), "PUT")
    b.prueft(
        code == 200 and zahl_in_datei(konf, kennung) == 40,
        "HERAUFsetzen ueber denselben Weg geht weiter durch (es kann nichts kosten)",
        f"{code}, merken={zahl_in_datei(konf, kennung)}",
    )
    code, _ = hole(port, "/api/profile", liste_mit(), "PUT")
    b.prueft(
        code == 200 and zahl_in_datei(konf, kennung) == 40,
        'und eine Liste OHNE das Feld (die Seite „Kinder") aendert nichts',
        f"{code}, merken={zahl_in_datei(konf, kennung)}",
    )
    hole(port, "/api/profil/merken", {"profil": kennung, "merken": 12, "bestaetigt": True}, "PUT")

    # ── K2: ein FREMDER Eintrag in der Datei — zaehlen Server und Skript gleich?
    #
    # `stelleEinsetzen` (Server) deckelt die GANZE Liste; `remove_max_resume.sh`
    # zaehlt nur `category == "resume"`, schneidet aber vom Anfang der ganzen
    # Liste. Das ist AELTER als die Zahl je Kind und auf der Box heute folgenlos
    # (am 07.08.2026 am Geraet nachgezaehlt: alle 16 Eintraege beider Kinder
    # tragen `category: "resume"`). Gemessen wird trotzdem, und zwar in der
    # Richtung, die dem Kind wehtut: das Skript darf NICHT MEHR wegnehmen als
    # der Server. Zu viel behalten ist harmlos, zu viel loeschen nicht.
    hole(port, "/api/profil/merken", {"profil": kennung, "merken": 5, "bestaetigt": True}, "PUT")
    bestand = [
        {"type": "spotify", "category": "resume", "id": f"r{i}", "title": f"Resume {i}"}
        for i in range(8)
    ]
    fremd = [{"type": "spotify", "category": "audiobook", "id": "fremd", "title": "Kein Resume"}]
    gemischt = fremd + bestand

    # Was der SERVER aus derselben Datei machen wuerde — ueber seinen Weg.
    (konf / "profile" / kennung / "resume.json").write_text(json.dumps(gemischt, indent=4))
    hole(port, "/api/profil/aktiv", {"kennung": kennung}, "POST")
    hole(
        port,
        "/api/weiterhoeren",
        {"schluessel": "spotify:w0", "titelNr": 2, "bisher": 120, "dauer": 900},
        "POST",
    )
    stellen_vom_server = stellen(konf, kennung)
    server_ids = [e.get("id") for e in stellen_vom_server]
    vom_server = len(server_ids)

    # Und was das SKRIPT daraus macht.
    (konf / "profile" / kennung / "resume.json").write_text(json.dumps(gemischt, indent=4))
    kappen_lassen(skript)
    danach = stellen(konf, kennung)
    b.prueft(
        len(danach) >= vom_server,
        "bei einem FREMDEN Eintrag nimmt das Skript nicht MEHR weg als der Server",
        f"Skript laesst {len(danach)} stehen, Server {vom_server} — {[e.get('id') for e in danach]}",
    )
    # SEIT DEM 07.08.2026 ZAEHLEN BEIDE DASSELBE. Hier standen zwei blosse
    # Vermerke („die beiden zaehlen verschieden — auf der Box heute folgenlos"),
    # weil der Server die GANZE Liste deckelte und das Skript nur die
    # Resume-Eintraege. Gemessen wurde damals: 12 Eintraege (6 resume, 6 fremd),
    # Deckel 3 — der Server liess 2 gemerkte und 1 fremden uebrig, die jq-Kette
    # 3 gemerkte und alle 6 fremden. `istGemerkteStelle` (weiterhoeren.ts) ist
    # jetzt die eine Regel fuer beide, also ist es keine Fussnote mehr, sondern
    # eine Messung.
    b.prueft(
        sum(1 for e in danach if e.get("category") == "resume") == 5
        and sum(1 for e in stellen_vom_server if e.get("category") == "resume") == 5,
        "und beide lassen GENAU SO VIELE gemerkte Stellen stehen, wie der Deckel erlaubt (5)",
        f"Skript {sum(1 for e in danach if e.get('category') == 'resume')} / "
        f"Server {sum(1 for e in stellen_vom_server if e.get('category') == 'resume')}",
    )
    b.prueft(
        any(e.get("id") == "fremd" for e in danach) and "fremd" in server_ids,
        "und der fremde Eintrag, den `stelleEinsetzen` ausdruecklich stehenlassen WILL "
        '(„die Datei ist eine Medienliste"), steht bei BEIDEN noch',
        f"Skript: {'steht noch' if any(e.get('id') == 'fremd' for e in danach) else 'entfernt'}  /  "
        f"Server: {'steht noch' if 'fremd' in server_ids else 'entfernt'} ({server_ids})",
    )

    # ── K3: was die Auskunft NICHT sagt, wenn schon zu viel dasteht.
    (konf / "profile" / kennung / "resume.json").write_text(json.dumps(fremd + bestand, indent=4))
    code, a = hole(port, f"/api/profil/merken?profil={kennung}")
    b.merkt(
        "GET bei 9 Eintraegen und gilt=5 — was die Oberflaeche daraus lesen kann",
        str(a),
    )
    # HIER STAND `hatte == 9` — die Laenge der Datei. Seit dem 07.08.2026 zaehlt
    # `gemerkteStellenZaehlen` nur die gemerkten Stellen, weil genau diese Zahl
    # dem Betreiber vor dem Herunterstellen genannt wird: die Datei hat 9
    # Zeilen, aber nur 8 davon kann er verlieren.
    b.prueft(
        isinstance(a, dict) and a.get("hatte") == 8 and a.get("verliert") == 3,
        "`hatte` zaehlt die GEMERKTEN STELLEN (8), nicht die Zeilen der Datei (9) — "
        "und `verliert` rechnet mit derselben Zahl (8-5)",
        f"hatte={a.get('hatte') if isinstance(a, dict) else a}, "
        f"verliert={a.get('verliert') if isinstance(a, dict) else '-'}",
    )

    # ── K4: DER KLASSISCHE WEG. `/api/addresume` haengt an und kuerzt NIE —
    #        die eigene Zahl des Kindes greift dort ueberhaupt nicht. Das ist
    #        die Begruendung dafuer, dass das Kappen im Skript geblieben ist;
    #        hier wird sie nachgemessen statt geglaubt. Es ist zugleich das
    #        Fenster, in dem ein Kind MEHR hat als seine Zahl erlaubt: bis das
    #        Skript laeuft. Der klassische Player stoesst es zwei Sekunden nach
    #        dem Merken selbst an (`PlayerCmds.MAXRESUME`), aber das ist eine
    #        Zusage der OBERFLAECHE, keine des Servers.
    hole(port, "/api/profil/merken", {"profil": kennung, "merken": 3, "bestaetigt": True}, "PUT")
    (konf / "profile" / kennung / "resume.json").write_text("[]")
    hole(port, "/api/profil/aktiv", {"kennung": kennung}, "POST")
    for i in range(8):
        hole(
            port,
            "/api/addresume",
            {"type": "spotify", "category": "resume", "id": f"klassisch{i}", "title": f"K {i}"},
            "POST",
        )
    ueber_die_zahl = len(stellen(konf, kennung))
    b.prueft(
        ueber_die_zahl == 8,
        "der KLASSISCHE Weg (`/api/addresume`) kuerzt nie — die Zahl des Kindes "
        "greift dort nicht, das Kappen bleibt Sache des Skripts",
        f"{ueber_die_zahl} Eintraege bei merken=3",
    )
    kappen_lassen(skript)
    b.prueft(
        len(stellen(konf, kennung)) == 3,
        "und erst der Lauf des Skripts bringt sie auf ihre 3 zurueck",
        f"{len(stellen(konf, kennung))} Eintraege (vorher {ueber_die_zahl})",
    )


# ── Die Gegenprobe ──────────────────────────────────────────────────────────


def teil_gegenprobe(tmp: Path, gegen: str) -> int:
    """
    WIRD ES ROT MIT DER FASSUNG VON VORHER?

    Gemessen wird der Teil, der ohne Server auskommt: das Skript. Die alte
    Fassung kannte nur den alten Ort — sie MUSS jedes Kind ausser dem aktiven
    unberuehrt lassen. Tut sie es nicht, misst diese Probe nichts.
    """
    print("\n" + "═" * 76)
    print(f"GEGENPROBE — dasselbe Kappen mit `remove_max_resume.sh` aus {gegen}.")
    print("   Dort MUESSEN die nicht aktiven Kinder unberuehrt bleiben.")
    print("═" * 76)
    alt = subprocess.run(
        ["git", "show", f"{gegen}:scripts/mupibox/remove_max_resume.sh"],
        cwd=str(BAUM),
        capture_output=True,
        text=True,
    )
    if alt.returncode != 0:
        print(f"  ! {gegen} nicht lesbar: {alt.stderr}")
        return 1
    if alt.stdout == KAPP_SKRIPT.read_text():
        print(f"  ! GEGENPROBE UNBRAUCHBAR: {gegen} traegt dieselbe Fassung wie der Arbeitsbaum.")
        return 1

    gtmp = tmp / "gegen"
    konf, _ = sandkasten(gtmp)
    voll = [
        {"type": "spotify", "category": "resume", "id": f"v{i}", "title": f"Voll {i}"}
        for i in range(WERKE)
    ]
    for kennung, _ in KINDER + [("gast", None)]:
        (konf / "profile" / kennung / "resume.json").write_text(json.dumps(voll, indent=4))
    altdatei = gtmp / "lauf" / "alt-remove_max_resume.sh"
    altdatei.write_text(alt.stdout)
    kappen_lassen(kappskript(altdatei, gtmp))

    unberuehrt = {k: len(stellen(konf, k)) for k, _ in KINDER if k != MARKE}
    aktiv = len(stellen(konf, MARKE))
    print(f"\n  aktives Kind {MARKE}: {aktiv} Eintraege")
    print(f"  die anderen:  {unberuehrt}")
    if all(n == WERKE for n in unberuehrt.values()) and aktiv < WERKE:
        print("\n  GEGENPROBE BESTANDEN: die alte Fassung kappt NUR das aktive Kind.")
        print("  Die Messung in Teil G misst also wirklich etwas.")
        return 0
    print("\n  GEGENPROBE MISSLUNGEN: die alte Fassung verhaelt sich schon wie die neue.")
    return 1


# ── main ────────────────────────────────────────────────────────────────────


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--nur", default="", help="nur diese Teile, z.B. VG")
    ap.add_argument("--gegenprobe", action="store_true")
    ap.add_argument("--gegen", default="4e538125~1", help="Vergleichsstand (Vorgabe 4e538125~1)")
    ap.add_argument("--behalten", action="store_true", help="Sandkasten stehenlassen")
    ap.add_argument("--port", type=int, default=9771, help="Wunschport (ab hier wird gesucht)")
    a = ap.parse_args()
    teile = (a.nur or "VGUSK").upper()

    tmp = Path(tempfile.mkdtemp(prefix="merken-verlust-linse-"))
    b = Befund()
    schluss = 0
    server: list = [None]
    try:
        port = freier_port(a.port)
        print(f"Sandkasten: {tmp}")
        print(f"Port:       {port}  (gebunden, danach an `{MARKE}` gegengeprueft)")
        print(f"Box-Zahl:   {BOX_ZAHL}   Kinder: {[(k, z) for k, z in KINDER]}")

        if a.gegenprobe:
            schluss |= teil_gegenprobe(tmp, a.gegen)

        if set(teile) & set("VGUSK"):
            sandkasten(tmp)
            skript = kappskript(KAPP_SKRIPT, tmp)
            server[0] = server_starten(tmp, port)
            try:
                if not wer_antwortet(port):
                    print("\n  ! Der eigene Server kam nicht hoch (oder es war ein fremder).")
                    if server[0]:
                        server[0].terminate()
                        print((server[0].stdout.read() or "")[-2000:] if server[0].stdout else "")
                    return 2
                if "V" in teile:
                    teil_v(b, tmp, port, skript)
                if "G" in teile:
                    teil_g(b, tmp, port, skript)
                if "U" in teile:
                    teil_u(b, tmp, port, server)
                if "S" in teile:
                    teil_s(b, tmp, port, server)
                if "K" in teile:
                    teil_k(b, tmp, port, skript)
            finally:
                if server[0]:
                    server_beenden(server[0])
    finally:
        if a.behalten:
            print(f"\nSandkasten steht: {tmp}")
        else:
            shutil.rmtree(tmp, ignore_errors=True)

    print("\n" + "═" * 76)
    rot = b.rote()
    if rot:
        print(f"  {len(b.zeilen)} Messungen, {rot} ROT:")
        for ok, was, gemessen in b.zeilen:
            if not ok:
                print(f"    - {was}")
                if gemessen:
                    print(f"      {gemessen}")
        schluss |= 1
    else:
        print(f"  {len(b.zeilen)} Messungen, alle gruen.")
    return schluss


if __name__ == "__main__":
    sys.exit(main())
