#!/usr/bin/env python3
"""
KOMMT MAN DURCH, UND HAELT ES BEI UNSINN? — die Merktiefe je Kind, boesartig.

`tools/merken-je-kind.py` misst, ob die Zahl je Kind das RICHTIGE tut. Diese
Probe misst das andere Ende: was passiert, wenn jemand Unsinn hineinschiebt.
Nicht „laesst es sich bedienen", sondern „laesst es sich MISSBRAUCHEN".

    python3 tools/durchkommen-merken.py            # alles, gruen/rot
    python3 tools/durchkommen-merken.py --nur AE   # nur diese Teile
    python3 tools/durchkommen-merken.py --gegenprobe  # wird F rot, wenn man
                                                      #   das Fenster aufreisst?
    python3 tools/durchkommen-merken.py --behalten # Sandkasten stehenlassen
    python3 tools/durchkommen-merken.py --port 9777

DIE SECHS TEILE
  A  DIE KENNUNG: keine, unbekannte, `..`, sehr lange, Zahl, Feld, Objekt.
     Und nach JEDEM abgewiesenen Versuch: ist die Datei Byte fuer Byte
     dieselbe geblieben?
  B  DIE ZAHL: 0, -1, 1e9, Infinity, NaN, Bruch, Text, `null`, fehlend, Feld,
     Objekt, ein zu grosser Rumpf, kaputtes JSON, `__proto__`.
  C  NICHTS DANEBEN: laesst sich ueber Kennung oder Zahl eine Datei AUSSERHALB
     des Kinderordners treffen? Gezaehlt wird der ganze Sandkasten vorher und
     nachher (Pfad, Groesse, Zeit).
  D  GLEICHZEITIG: `profile.json` ist EINE Datei. Zwei Kinder in derselben
     Sekunde, und dazu ein `PUT /api/profile` mittendrin — geht eine Zahl
     verloren, und laesst sich die Datei jederzeit lesen?
  E  DAS KAPPSKRIPT BEI UNSINN: Kinderordner ohne resume.json, kaputtes JSON,
     ein Objekt statt einer Liste, ein Ordner der ein VERWEIS ist, eine
     resume.json die ein Verweis ist, Namen mit Leerzeichen, Anfuehrungszeichen
     und `$(…)`, ein beiseitegelegter Ordner, gemischte Kategorien, die Sperre.
  F  DAS FENSTER IM LISTENWEG: eine Zahl, die mit 200 quittiert wird und
     trotzdem wieder verschwindet, weil `PUT /api/profile` gleichzeitig lief.
     Ein RENNEN — gruen beweist hier nichts, rot beweist alles.

NIEMALS GEGEN DIE ECHTE BOX. Alles laeuft in einem Sandkasten unter /tmp gegen
einen EIGENEN Server auf einem EIGENEN Port. Der Port wird vorher wirklich
gebunden, und danach wird an einer Kennung, die es sonst nirgends gibt,
nachgesehen, dass die Antwort aus DIESEM Sandkasten kommt — auf diesem Rechner
laufen fremde Sitzungen.
"""

from __future__ import annotations

import argparse
import http.client
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
from pathlib import Path

BAUM = Path(__file__).resolve().parent.parent
BACKEND = BAUM / "src" / "backend-api"
SKRIPT = BAUM / "scripts" / "mupibox" / "remove_max_resume.sh"

# ── Was die Nachbarprobe schon kann, wird nicht zweimal geschrieben ─────────
#
# `freier_port`, `server_starten`, `hole`, `skript_herrichten` und `art` stehen
# in tools/merken-je-kind.py und sind dort gemessen. Sie hier abzuschreiben
# hiesse, beim naechsten Umbau zwei Fassungen zu haben — dieselbe Fehlerklasse,
# gegen die diese Probe antritt.
_spec = importlib.util.spec_from_file_location("merken_je_kind", Path(__file__).parent / "merken-je-kind.py")
_nachbar = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_nachbar)
freier_port = _nachbar.freier_port
server_starten = _nachbar.server_starten
hole = _nachbar.hole
skript_herrichten = _nachbar.skript_herrichten
art = _nachbar.art

# Die Kennung, an der DIESER Sandkasten zu erkennen ist.
MARKE = "probe-durch-a"
BOX_ZAHL = 6
KINDER = [MARKE, "probe-durch-b", "probe-durch-c"]
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
    konf, tm = tmp / "config", tmp / "tmp"
    tm.mkdir(parents=True)
    (konf / "profile").mkdir(parents=True)
    medien = [
        {"type": "spotify", "category": "audiobook", "id": f"w{i}", "title": f"Werk {i}", "artist": "Probe"}
        for i in range(WERKE)
    ]
    (konf / "data.json").write_text(json.dumps(medien, indent=4))
    (konf / "active_data.json").write_text(json.dumps(medien, indent=4))
    profile = []
    for kennung in KINDER:
        (konf / "profile" / kennung).mkdir()
        (konf / "profile" / kennung / "resume.json").write_text("[]")
        profile.append({"kennung": kennung, "name": kennung.upper(), "figur": "", "angelegt": 1})
    profile[0]["merken"] = 3
    (konf / "profile" / "gast").mkdir()
    (konf / "profile" / "gast" / "resume.json").write_text("[]")
    (konf / "profile.json").write_text(json.dumps({"profile": profile, "aktiv": MARKE}, indent=4))
    (konf / "mupiboxconfig.json").write_text(json.dumps({"mupibox": {"resume": BOX_ZAHL}}, indent=4))
    (konf / "resume.json").symlink_to(f"profile/{MARKE}/resume.json")
    (tm / "network.json").write_text('{"onlinestate":"starting"}')
    return konf, tm


def wer_antwortet(port: int, frist: float = 120.0) -> bool:
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


def roh_schicken(port: int, weg: str, rumpf: bytes, art_: str = "PUT", typ: str = "application/json") -> tuple[int, str]:
    """
    Einen Rumpf schicken, den `json.dumps` gar nicht bauen kann.

    NaN, doppelte Schluessel und ein 8-kB-Klotz gehen nur so. Was der Server
    daraus macht, ist genau die Frage — eine 500 mit Stapelspur waere eine
    Antwort, die dem Angreifer den Bauplan zeigt.
    """
    v = http.client.HTTPConnection("127.0.0.1", port, timeout=15)
    try:
        v.request(art_, weg, body=rumpf, headers={"Content-Type": typ, "Content-Length": str(len(rumpf))})
        a = v.getresponse()
        return a.status, a.read().decode(errors="replace")
    except Exception as e:  # noqa: BLE001
        return 0, str(e)
    finally:
        v.close()


def datei_bytes(p: Path) -> bytes:
    try:
        return p.read_bytes()
    except OSError:
        return b""


def abzug(wurzel: Path) -> dict[str, tuple[int, int]]:
    """Pfad -> (Groesse, Aenderungszeit in ns) fuer ALLES unter der Wurzel."""
    stand = {}
    for ordner, unter, dateien in os.walk(wurzel):
        for n in list(unter) + dateien:
            p = Path(ordner) / n
            try:
                s = p.lstat()
                stand[str(p.relative_to(wurzel))] = (s.st_size, s.st_mtime_ns)
            except OSError:
                stand[str(p.relative_to(wurzel))] = (-1, -1)
    return stand


def zahl_in_datei(konf: Path, kennung: str):
    roh = json.loads((konf / "profile.json").read_text())
    e = next((p for p in roh["profile"] if p["kennung"] == kennung), {})
    return e.get("merken", "(kein Feld)")


# ── A: die Kennung ──────────────────────────────────────────────────────────

# Was hier hineingeht, und was herauskommen MUSS.
#
# `400` heisst abgewiesen. `200-aktiv` heisst: ohne Angabe ist das aktive Kind
# gemeint — das ist die Hausregel von `auswahlKennungAus`, dieselbe wie bei
# `/api/profil/auswahl`, und sie steht hier ausdruecklich in der Messung, damit
# sie nicht eines Tages unbemerkt zu „irgendein Kind" wird.
KENNUNGEN = [
    ("(fehlt ganz)", None, "200-aktiv"),
    ("leer", "", "200-aktiv"),
    ("unbekannt", "gibtsnicht", "400"),
    ("zwei Punkte", "..", "400"),
    ("ein Weg nach oben", "../gast", "400"),
    ("ein Weg nach oben, verpackt", "%2e%2e%2fgast", "400"),
    ("ein absoluter Weg", "/etc/passwd", "400"),
    ("ein Weg zur echten Box", "../../../../etc/passwd", "400"),
    ("ein Nullbyte hinten dran", "gast\x00", "400"),
    ("GROSS geschrieben", "GAST", "400"),
    ("mit Leerzeichen hinten", "gast ", "400"),
    ("mit Zeilenumbruch", "gast\n", "400"),
    ("sehr lang (5000 Zeichen)", "a" * 5000, "400"),
    ("eine Zahl", "5", "400"),
    ("ein fremdes Kind (gibt es)", "probe-durch-b", "200-b"),
]


def teil_a(b: Befund, konf: Path, port: int) -> None:
    print("\n══ A  DIE KENNUNG — kommt man an ein fremdes oder an gar keines?")
    print("   Nach JEDEM abgewiesenen Versuch wird profile.json Byte fuer Byte")
    print("   verglichen. Eine Absage, die trotzdem etwas geschrieben hat, ist")
    print("   keine Absage.\n")
    pj = konf / "profile.json"

    for name, wert, erwartet in KENNUNGEN:
        vorher = datei_bytes(pj)
        if wert is None:
            weg = "/api/profil/merken"
        else:
            weg = "/api/profil/merken?profil=" + urllib.parse.quote(wert, safe="")
        code, antwort = hole(port, weg)
        if erwartet == "400":
            ok = code == 400
        elif erwartet == "200-aktiv":
            ok = code == 200 and isinstance(antwort, dict) and antwort.get("profil") == MARKE
        else:
            ok = code == 200 and isinstance(antwort, dict) and antwort.get("profil") == "probe-durch-b"
        b.prueft(ok, f"GET, Kennung {name}: {erwartet}", f"{code} {str(antwort)[:160]}")

        # Dasselbe schreibend — hier haengt eine Tat dran.
        vorher = datei_bytes(pj)
        rumpf = {"merken": 1, "bestaetigt": True}
        if wert is not None:
            rumpf["profil"] = wert
        code, antwort = hole(port, "/api/profil/merken", rumpf, "PUT")
        if erwartet == "400":
            ok = code == 400 and datei_bytes(pj) == vorher
            b.prueft(ok, f"PUT, Kennung {name}: 400 UND die Datei ist unberuehrt", f"{code} {str(antwort)[:120]}")
        else:
            b.prueft(code == 200, f"PUT, Kennung {name}: angenommen", f"{code} {str(antwort)[:120]}")

    # ── Die Formen, die eine URL erlaubt und ein Mensch nicht meint ─────────
    #
    # ZWEIMAL DASSELBE FELD wird bei express' einfachem Leser zu „a,b" — eine
    # Kennung, die es nicht gibt, also 400. DIE KLAMMERFORMEN (`profil[]`,
    # `profil[x]`) sind fuer denselben Leser gar kein `profil`; die Anfrage
    # nennt dann KEINE Kennung, und dafuer gilt die Hausregel „das aktive
    # Kind". Das ist gutartig, weil dieser Weg nur LIEST — aber es ist eine
    # Ecke, an der eine Oberflaeche sich selbst betruegen kann: sie fragt nach
    # b und bekommt die Zahl von a. Deshalb steht es hier als Messung und
    # nicht als Vermutung.
    for name, weg, erwartet in [
        ("zweimal dasselbe Feld (?profil=a&profil=b)", f"/api/profil/merken?profil={MARKE}&profil=probe-durch-b", "400"),
        ("ein Feld als Liste (?profil[]=…)", "/api/profil/merken?profil[]=probe-durch-b", "200-aktiv"),
        ("ein Feld als Objekt (?profil[x]=y)", "/api/profil/merken?profil[x]=probe-durch-b", "200-aktiv"),
    ]:
        code, antwort = hole(port, weg)
        if erwartet == "400":
            ok = code == 400
        else:
            ok = code == 200 and isinstance(antwort, dict) and antwort.get("profil") == MARKE
        b.prueft(ok, f"GET, {name}: {erwartet}", f"{code} {str(antwort)[:120]}")

    # Und im RUMPF, wo eine Liste wirklich eine Liste ist: `String(['b'])` ist
    # `'b'`. Es kommt nur durch, WEIL die Kennung danach in der Liste der
    # Profile stehen muss — an einen fremden Ordner fuehrt dieser Weg nicht.
    code, antwort = hole(
        port, "/api/profil/merken", {"profil": ["probe-durch-b"], "merken": 2, "bestaetigt": True}, "PUT"
    )
    b.prueft(
        code in (200, 400) and (code == 400 or antwort.get("profil") == "probe-durch-b"),
        "PUT mit einer einelementigen Liste als Kennung trifft genau dieses Kind oder gar keines",
        f"{code} {str(antwort)[:120]}",
    )
    code, antwort = hole(port, "/api/profil/merken", {"profil": [MARKE, "probe-durch-b"], "merken": 2}, "PUT")
    b.prueft(code == 400, "PUT mit ZWEI Kennungen in einer Liste: 400", f"{code} {str(antwort)[:120]}")

    # `null` und ein Feld im RUMPF — dieselbe Hausregel, schreibend.
    code, antwort = hole(port, "/api/profil/merken", {"profil": None, "merken": 2, "bestaetigt": True}, "PUT")
    b.prueft(
        code == 200 and isinstance(antwort, dict) and antwort.get("profil") == MARKE,
        "PUT mit `profil: null` meint das AKTIVE Kind (Hausregel, nicht ein beliebiges)",
        f"{code} {str(antwort)[:120]}",
    )
    code, antwort = hole(port, "/api/profil/merken", {"profil": {"kennung": MARKE}, "merken": 2}, "PUT")
    b.prueft(code == 400, "PUT mit einem Objekt als Kennung: 400", f"{code} {str(antwort)[:120]}")
    code, antwort = hole(port, "/api/profil/merken", {"profil": 7, "merken": 2}, "PUT")
    b.prueft(code == 400, "PUT mit einer Zahl als Kennung: 400", f"{code} {str(antwort)[:120]}")

    # Und der Gast — er ist kein Kind wie die anderen, aber er hat einen Bestand.
    code, antwort = hole(port, "/api/profil/merken?profil=gast")
    b.prueft(code == 200, "GET fuer den Gast geht (er hat einen eigenen Bestand)", f"{code} {str(antwort)[:120]}")


# ── B: die Zahl ─────────────────────────────────────────────────────────────

ZAHLEN_GUELTIG = [0, 1, 99, 0.0, -0.0]
ZAHLEN_KRUMM = [
    100,
    -1,
    -0.5,
    5.5,
    1e9,
    1e309,  # Infinity
    9007199254740993,
    "5",
    "0",
    "",
    "zehn",
    True,
    False,
    [],
    [5],
    {},
    {"n": 5},
]


def teil_b(b: Befund, konf: Path, port: int) -> None:
    print("\n══ B  DIE ZAHL — was ist eine Zahl, und was sieht nur so aus?")
    print("   Krummes wird ABGEWIESEN, nicht gerundet und nicht verschwiegen.")
    print("   Und nach jedem Versuch muss die Datei noch lesbar sein.\n")
    kennung = "probe-durch-b"
    pj = konf / "profile.json"

    def setzen(wert, bestaetigt=True):
        rumpf = {"profil": kennung, "merken": wert}
        if bestaetigt:
            rumpf["bestaetigt"] = True
        return hole(port, "/api/profil/merken", rumpf, "PUT")

    for wert in ZAHLEN_GUELTIG:
        code, antwort = setzen(wert)
        b.prueft(code == 200, f"merken={wert!r} wird angenommen", f"{code} {str(antwort)[:120]}")
    for wert in ZAHLEN_KRUMM:
        vorher = datei_bytes(pj)
        code, antwort = setzen(wert)
        b.prueft(
            code == 400 and datei_bytes(pj) == vorher,
            f"merken={wert!r} wird abgewiesen UND schreibt nichts",
            f"{code} {str(antwort)[:120]}",
        )
    # Ein fehlendes Feld ist keine Zahl — und nicht etwa „nimm sie weg".
    vorher = datei_bytes(pj)
    code, antwort = hole(port, "/api/profil/merken", {"profil": kennung}, "PUT")
    b.prueft(
        code == 400 and datei_bytes(pj) == vorher,
        "ein FEHLENDES Feld `merken` ist 400 — nicht stillschweigend „weg damit\"",
        f"{code} {str(antwort)[:120]}",
    )
    # `null` dagegen nimmt sie ausdruecklich weg.
    code, antwort = hole(port, "/api/profil/merken", {"profil": kennung, "merken": None}, "PUT")
    b.prueft(code == 200, "`merken: null` nimmt sie weg (200)", f"{code} {str(antwort)[:120]}")

    # ── Was `json.dumps` nicht bauen kann ──────────────────────────────────
    for name, rumpf, erwartet in [
        ("NaN", b'{"profil":"probe-durch-b","merken":NaN}', (400,)),
        ("kaputtes JSON", b'{"profil":"probe-durch-b","merken":', (400,)),
        ("gar kein Rumpf", b"", (400,)),
        (
            "derselbe Schluessel zweimal (5, dann 300)",
            b'{"profil":"probe-durch-b","merken":5,"merken":300,"bestaetigt":true}',
            (400,),
        ),
        # ── WIE GROSS DARF DER RUMPF SEIN? ─────────────────────────────────
        #
        # An der Route steht (stand) `express.json({ limit: '4kb' })`. Diese
        # Grenze HAELT NICHT: weiter oben liegt ein globales
        # `app.use(express.json())`, das den Rumpf laengst gelesen hat; der
        # zweite Aufbau steigt aus, sobald schon einer geparst wurde. Genau
        # diese Falle ist am 07.08.2026 an `/api/schirm/helligkeit` gemessen
        # und dort im Klartext hingeschrieben worden. Es gilt die GLOBALE
        # Grenze — 100 kB, die Vorgabe von express. Also wird hier beides
        # gemessen: was durchkommt, und wo es wirklich aufhoert.
        ("ein 8-kB-Klotz (die globale Grenze haelt ihn nicht)", b'{"profil":"probe-durch-b","merken":5,"bestaetigt":true,"fuellung":"' + b"x" * 8192 + b'"}', (200,)),
        ("ein 200-kB-Klotz (ueber der globalen Grenze)", b'{"profil":"probe-durch-b","merken":5,"fuellung":"' + b"x" * 200000 + b'"}', (413,)),
    ]:
        vorher = datei_bytes(pj)
        code, text = roh_schicken(port, "/api/profil/merken", rumpf)
        stapel = "at " in text and (".ts:" in text or ".js:" in text)
        # Wo eine Absage erwartet wird, muss die Datei unberuehrt sein. Wo
        # etwas durchkommen DARF, waere diese Forderung falsch herum.
        ruhig = datei_bytes(pj) == vorher if erwartet[0] != 200 else True
        b.prueft(
            code in erwartet and not stapel and ruhig,
            f"{name}: {erwartet[0]}, keine Stapelspur"
            + ("" if erwartet[0] == 200 else ", nichts geschrieben"),
            f"{code} {text[:140]}",
        )

    # Kein JSON angesagt: express liest den Rumpf gar nicht erst.
    code, text = roh_schicken(port, "/api/profil/merken", b'{"profil":"probe-durch-b","merken":5}', typ="text/plain")
    b.prueft(code == 400, "Rumpf ohne `application/json`: 400, nicht 500", f"{code} {text[:140]}")

    # ── `__proto__` ────────────────────────────────────────────────────────
    #
    # WARUM DAS HIER STEHT: der Endpunkt baut mit `{...jetzt, merken}` ein
    # neues Profil. Kaeme eine Verunreinigung des Prototyps durch, haette
    # PLOETZLICH JEDES Kind eine Zahl — auch die, die keine haben, und die
    # verhalten sich dann anders als vor dem 07.08.2026.
    vorher_c = zahl_in_datei(konf, "probe-durch-c")
    for rumpf in [
        b'{"profil":"probe-durch-b","merken":5,"bestaetigt":true,"__proto__":{"merken":77}}',
        b'{"profil":"probe-durch-b","merken":5,"bestaetigt":true,"constructor":{"prototype":{"merken":77}}}',
    ]:
        roh_schicken(port, "/api/profil/merken", rumpf)
    code, antwort = hole(port, "/api/profil/merken?profil=probe-durch-c")
    b.prueft(
        code == 200 and isinstance(antwort, dict) and antwort.get("merken") is None,
        "`__proto__` faerbt kein anderes Kind ein — c hat weiterhin KEINE eigene Zahl",
        f"{code} {str(antwort)[:160]}",
    )
    b.prueft(
        zahl_in_datei(konf, "probe-durch-c") == vorher_c,
        "und in der Datei steht bei c immer noch dasselbe",
        f"{zahl_in_datei(konf, 'probe-durch-c')!r}",
    )

    # ── Die Rueckfrage laesst sich nicht mit einem Wort ueberreden ──────────
    #
    # `bestaetigt` muss WIRKLICH `true` sein. Ein `"true"` als Text ist der
    # Fehler, den eine Oberflaeche macht, die den Wert aus einem Feld liest.
    hole(port, "/api/profil/merken", {"profil": kennung, "merken": 12, "bestaetigt": True}, "PUT")
    stelle = {"type": "spotify", "category": "resume", "id": "w0", "index": 0, "title": "Werk"}
    (konf / "profile" / kennung / "resume.json").write_text(json.dumps([dict(stelle, id=f"w{i}", index=i) for i in range(10)]))
    for wert, erwartet in [("true", 409), (1, 409), ("ja", 409), (True, 200)]:
        code, antwort = hole(
            port, "/api/profil/merken", {"profil": kennung, "merken": 2, "bestaetigt": wert}, "PUT"
        )
        b.prueft(
            code == erwartet,
            f"`bestaetigt: {wert!r}` -> {erwartet}" + ("  (nur echtes true zaehlt)" if erwartet == 409 else ""),
            f"{code} {str(antwort)[:120]}",
        )
        if erwartet == 409:
            b.prueft(
                zahl_in_datei(konf, kennung) == 12,
                "  und die Datei steht noch auf der alten Zahl",
                f"{zahl_in_datei(konf, kennung)!r}",
            )


# ── C: nichts daneben ───────────────────────────────────────────────────────


def teil_c(b: Befund, tmp: Path, konf: Path, port: int, vorher: dict) -> None:
    print("\n══ C  LAESST SICH ETWAS AUSSERHALB DES KINDERORDNERS TREFFEN?")
    print("   Der ganze Sandkasten wurde vor Teil A abgezaehlt. Jetzt noch einmal.\n")
    nachher = abzug(tmp)
    neu = sorted(set(nachher) - set(vorher))
    weg = sorted(set(vorher) - set(nachher))
    # Was sich aendern DARF: profile.json (die Zahl), der Bestand der Kinder,
    # und was der Server ohnehin schreibt (Sperren, Netzstand, Verlauf).
    #
    # `config/spiele.json` KAM AM 20.09.2026 DAZU, und diese Wache hat es
    # sofort gemeldet — zu Recht. Der Spielbereich zog aus `vorlesen.json`
    # aus, und der Server schreibt die neue Datei BEIM START einmal fest
    # (sonst verloere der Umzug seinen Wert, sobald jemand die Vorlesen-Seite
    # speichert). Eine Datei, die beim Hochfahren von selbst entsteht, ist
    # genau das, wonach dieser Abschnitt sucht; hier steht sie mit Grund, statt
    # die Liste stillschweigend weicher zu machen.
    erlaubt_neu = [
        p
        for p in neu
        if not (
            p.startswith("config/profile")
            or p.startswith("tmp/")
            or p.startswith("config/gespielt")
            or p.startswith("config/kinderzeit")
            or p == "config/spiele.json"
        )
    ]
    b.prueft(
        not erlaubt_neu,
        "es ist keine Datei an einem unerwarteten Ort entstanden",
        f"neu: {neu[:12]}{' …' if len(neu) > 12 else ''}",
    )
    b.prueft(not weg, "und keine ist verschwunden", f"weg: {weg}")
    # Die Bruecke steht noch — mit lstat, nicht mit stat.
    b.prueft(
        (konf / "resume.json").is_symlink() and os.readlink(konf / "resume.json") == f"profile/{MARKE}/resume.json",
        "die Bruecke am alten Ort ist unveraendert ein Verweis auf dasselbe Kind",
        art(konf / "resume.json"),
    )
    # Und die Datei ist nach allem noch das, was sie sein soll.
    try:
        roh = json.loads((konf / "profile.json").read_text())
        gut = isinstance(roh.get("profile"), list) and roh.get("aktiv") in [p["kennung"] for p in roh["profile"]]
        felder = sorted({s for p in roh["profile"] for s in p})
    except Exception as e:  # noqa: BLE001
        gut, felder = False, [str(e)]
    b.prueft(gut, "profile.json ist nach dem ganzen Unsinn noch ein gueltiger Stand", f"Felder: {felder}")
    b.prueft(
        set(felder) <= {"kennung", "name", "figur", "angelegt", "merken"},
        "und es steht kein Feld darin, das niemand hineingeschrieben haben sollte",
        f"Felder: {felder}",
    )


# ── D: gleichzeitig ─────────────────────────────────────────────────────────


def teil_d(b: Befund, konf: Path, port: int) -> None:
    print("\n══ D  GLEICHZEITIG — profile.json ist EINE Datei")
    print("   An genau dieser Bauart ist heute schon ein Spleiss gemessen worden")
    print("   (337 Bytes, wo 336 hingehoerten). Also: viele auf einmal, und")
    print("   waehrenddessen wird ununterbrochen gelesen.\n")
    pj = konf / "profile.json"

    for k in KINDER:
        hole(port, "/api/profil/merken", {"profil": k, "merken": 1, "bestaetigt": True}, "PUT")
        (konf / "profile" / k / "resume.json").write_text("[]")

    kaputt = {"n": 0, "beispiel": ""}
    laeuft = threading.Event()
    laeuft.set()

    def leser():
        while laeuft.is_set():
            roh = datei_bytes(pj)
            if not roh:
                continue
            try:
                stand = json.loads(roh)
                if not isinstance(stand.get("profile"), list):
                    raise ValueError("keine Liste")
            except Exception as e:  # noqa: BLE001
                kaputt["n"] += 1
                kaputt["beispiel"] = f"{e}: {roh[:80]!r}"

    t = threading.Thread(target=leser, daemon=True)
    t.start()

    runden, verloren = 12, []
    for r in range(runden):
        ziel = {k: 10 + r * 3 + i for i, k in enumerate(KINDER)}
        faeden = [
            threading.Thread(
                target=hole,
                args=(port, "/api/profil/merken", {"profil": k, "merken": v, "bestaetigt": True}, "PUT"),
            )
            for k, v in ziel.items()
        ]
        for f in faeden:
            f.start()
        for f in faeden:
            f.join()
        time.sleep(0.15)
        da = {k: zahl_in_datei(konf, k) for k in KINDER}
        if da != ziel:
            verloren.append((r, ziel, da))

    laeuft.clear()
    t.join(timeout=5)

    b.prueft(
        not verloren,
        f"{runden} Runden mit drei gleichzeitigen Zahlen: in der DATEI steht jedes Mal jede",
        f"abweichend: {verloren[:3]}",
    )
    b.prueft(
        kaputt["n"] == 0,
        "und waehrenddessen war profile.json bei JEDEM Lesen ganz (kein Spleiss)",
        f"{kaputt['n']} unlesbare Lesungen; {kaputt['beispiel']}",
    )

    # ── Und jetzt der gefaehrliche Nachbar: die GANZE Liste ────────────────
    #
    # `PUT /api/profile` ersetzt alles und rettet die Zahl ueber
    # `merkenBewahren` — aus dem Stand, den es beim Hereinkommen vorfand. Wer
    # in derselben Sekunde eine Zahl setzt, kann genau dazwischen geraten.
    code, antwort = hole(port, "/api/profile")
    schlank = [
        {"kennung": p["kennung"], "name": p["name"], "figur": p["figur"], "angelegt": p["angelegt"]}
        for p in antwort["profile"]
    ]
    daneben = []
    for r in range(20):
        wert = 50 + r
        f1 = threading.Thread(
            target=hole,
            args=(port, "/api/profil/merken", {"profil": "probe-durch-c", "merken": wert, "bestaetigt": True}, "PUT"),
        )
        f2 = threading.Thread(target=hole, args=(port, "/api/profile", schlank, "PUT"))
        f1.start()
        f2.start()
        f1.join()
        f2.join()
        time.sleep(0.12)
        da = zahl_in_datei(konf, "probe-durch-c")
        code, auskunft = hole(port, "/api/profil/merken?profil=probe-durch-c")
        gesagt = auskunft.get("merken") if isinstance(auskunft, dict) else "?"
        if da != wert or gesagt != da:
            daneben.append((r, wert, da, gesagt))
    b.prueft(
        not daneben,
        "20-mal `PUT /api/profil/merken` und `PUT /api/profile` gleichzeitig: die Zahl ueberlebt,",
        f"und Datei und Auskunft sagen dasselbe. Abweichungen: {daneben[:4]}",
    )

    # Zum Schluss: sagt der Server dasselbe wie die Platte?
    unstimmig = []
    for k in KINDER:
        code, auskunft = hole(port, f"/api/profil/merken?profil={k}")
        gesagt = auskunft.get("merken") if isinstance(auskunft, dict) else "?"
        steht = zahl_in_datei(konf, k)
        if gesagt != (None if steht == "(kein Feld)" else steht):
            unstimmig.append((k, gesagt, steht))
    b.prueft(not unstimmig, "Arbeitsspeicher und Platte sind am Ende einig", f"{unstimmig}")


# ── F: das Fenster im Listenweg ─────────────────────────────────────────────


def teil_f(b: Befund, konf: Path, port: int) -> None:
    """
    EINE ZAHL, DIE MIT 200 QUITTIERT WIRD UND TROTZDEM WEG IST.

    `PUT /api/profile` liest beim Hereinkommen den ganzen Stand (`vorher`) und
    baut daraus die neue Liste. Wartet er zwischen diesem Lesen und dem Setzen
    auch nur EINMAL, dann kann in dieser Zeit ein `PUT /api/profil/merken`
    laufen: es schreibt seine Zahl, sagt 200 — und der Listenweg legt gleich
    darauf seinen alten Stand darueber. Die Zahl ist weg, und niemand hat einen
    Fehler gesehen.

    SO WIRD ES SICHTBAR GEMACHT: die Zahl wird SOFORT nach der 200 in der Datei
    nachgesehen und dann NOCH EINMAL, nachdem der Listenweg fertig ist. Steht
    sie erst da und danach nicht mehr, ist genau das passiert.

    EIN GRUENES ERGEBNIS BEWEIST FUER SICH NICHTS — es ist ein Rennen. Deshalb
    gibt es `--gegenprobe`: dieselbe Messung gegen eine Fassung, in der das
    Fenster absichtlich aufgerissen ist. Wird sie dort nicht rot, misst dieser
    Teil nichts.
    """
    print("\n══ F  DAS FENSTER IM LISTENWEG — 200 gesagt, Zahl trotzdem weg")
    print("   Die Zahl wird sofort nach der 200 nachgesehen und noch einmal,")
    print("   wenn der Listenweg durch ist. Gruen beweist hier nur mit")
    print("   --gegenprobe etwas.\n")
    einzeln = "probe-durch-c"
    code, antwort = hole(port, "/api/profile")
    grund = [
        {"kennung": p["kennung"], "name": p["name"], "figur": p["figur"], "angelegt": p["angelegt"]}
        for p in antwort["profile"]
    ]
    verloren = []
    versaetze = [0.001, 0.005, 0.015, 0.030, 0.060, 0.090]
    for r, versatz in enumerate(versaetze * 2):
        hole(port, "/api/profil/merken", {"profil": einzeln, "merken": None, "bestaetigt": True}, "PUT")
        erg: dict = {}

        def listenweg():
            erg["code"] = hole(port, "/api/profile", grund, "PUT")[0]

        f = threading.Thread(target=listenweg)
        f.start()
        time.sleep(versatz)
        wert = 40 + r
        code, antwort = hole(
            port, "/api/profil/merken", {"profil": einzeln, "merken": wert, "bestaetigt": True}, "PUT"
        )
        sofort = zahl_in_datei(konf, einzeln)
        f.join()
        time.sleep(0.12)
        danach = zahl_in_datei(konf, einzeln)
        if code == 200 and danach != wert:
            verloren.append((round(versatz * 1000, 1), wert, sofort, danach, erg.get("code")))

    b.prueft(
        not verloren,
        f"{len(versaetze) * 2} Runden mit sechs Versaetzen: keine Zahl ist trotz 200 wieder verschwunden",
        f"verloren in {len(verloren)} Runden (Versatz ms, gesetzt, sofort, danach, Liste): {verloren[:4]}",
    )


# ── Die Gegenprobe zu F ─────────────────────────────────────────────────────


def mit_fenster(tmp: Path) -> Path:
    """
    Dieselbe Fassung, aber mit EINEM `await` an der verbotenen Stelle.

    WOZU: Teil F ist ein Rennen, und ein Rennen, das niemand gewinnt, sieht
    genauso aus wie eines, das es gar nicht gibt. Hier wird das Fenster
    absichtlich aufgerissen — zwischen „den Stand gelesen" und „den Stand
    gesetzt" in `PUT /api/profile`. Wird Teil F dann NICHT rot, misst er nichts.

    Der Eingriff ist EINE Zeile. Sie steht genau dort, wo der Kommentar im
    Server sagt, dass sie nicht stehen darf.
    """
    ziel = BACKEND / ".durchkommen-fenster"
    if ziel.exists():
        shutil.rmtree(ziel)
    # tsx sucht `node_modules` vom Quelltext aus nach oben — deshalb INNERHALB
    # von src/backend-api und nicht unter /tmp.
    shutil.copytree(BACKEND / "src", ziel, ignore=shutil.ignore_patterns("*.spec.ts"))
    text = (ziel / "server.ts").read_text()
    marke = """  const profile = profilStandNormalisieren({
    profile: figurenBewahren(merkenBewahren(req.body, vorher), vorher),
  }).profile"""
    if marke not in text:
        raise SystemExit("die Stelle in PUT /api/profile ist nicht mehr wiederzuerkennen")
    text = text.replace(
        marke,
        marke + "\n  await new Promise((r) => setTimeout(r, 120)) // NUR FUER DIE GEGENPROBE",
        1,
    )
    (ziel / "server.ts").write_text(text)
    return ziel / "server.ts"


def gegenprobe(tmp: Path, port: int, behalten: bool) -> int:
    print("\n" + "═" * 76)
    print("GEGENPROBE ZU F — dieselbe Messung gegen eine Fassung mit EINEM `await`")
    print("zwischen „Stand gelesen\" und „Stand gesetzt\". Sie MUSS rot werden.")
    print("═" * 76)
    quelle = None
    g = Befund()
    try:
        quelle = mit_fenster(tmp)
        konf, tm = sandkasten(tmp / "fenster")
        p = server_starten(konf, tm, port, quelle)
        try:
            if not wer_antwortet(port):
                print("  ! der Server mit dem Fenster kam nicht hoch")
                return 1
            teil_f(g, konf, port)
        finally:
            p.terminate()
            try:
                p.wait(timeout=15)
            except subprocess.TimeoutExpired:
                p.kill()
    finally:
        ziel = BACKEND / ".durchkommen-fenster"
        if ziel.exists() and not behalten:
            shutil.rmtree(ziel, ignore_errors=True)
    if g.rote():
        print("\n  GEGENPROBE BESTANDEN: mit dem Fenster wird Teil F rot.")
        return 0
    print("\n  GEGENPROBE MISSLUNGEN: auch MIT dem Fenster bleibt Teil F gruen.")
    print("  Dann beweist ein gruenes F gar nichts — der Versatz muss anders liegen.")
    return 1


# ── E: das Kappskript bei Unsinn ────────────────────────────────────────────


def stellen_liste(n: int, kategorie: str = "resume") -> list:
    return [
        {"type": "spotify", "category": kategorie, "id": f"w{i}", "index": i, "title": f"Werk {i}"}
        for i in range(n)
    ]


# Name des Ordners, Inhalt der resume.json (None = gar keine Datei), und was
# danach dastehen MUSS.
#
# „unveraendert" heisst hier zweierlei, und beides ist richtig: bei einer
# unlesbaren Datei, WEIL man nicht kappt, was man nicht verstanden hat — bei
# einem krummen Ordnernamen, WEIL das kein Kinderordner sein kann. Ein Bereich
# heisst immer wie eine Kennung (`^[a-z0-9-]{1,24}$`); alles andere hat dort
# jemand von Hand hingelegt oder der Server beiseitegeschoben.
BOESE_ORDNER = [
    ("probe-durch-a", json.dumps(stellen_liste(12)), 3),
    ("ohne-datei", None, None),
    ("kaputtes-json", "{das ist kein json", "unveraendert"),
    ("objekt-statt-liste", '{"a": 1, "b": 2}', "unveraendert"),
    ("leere-liste", "[]", "unveraendert"),
    ("nur-text", '"gar keine Liste"', "unveraendert"),
    ("kind mit leerzeichen", json.dumps(stellen_liste(12)), "unveraendert"),
    ('kind"mit-anfuehrung', json.dumps(stellen_liste(12)), "unveraendert"),
    ("$(touch PWNED)", json.dumps(stellen_liste(12)), "unveraendert"),
    ("`touch PWNED2`", json.dumps(stellen_liste(12)), "unveraendert"),
    ("kind;rm -rf .", json.dumps(stellen_liste(12)), "unveraendert"),
    # Ein Bindestrich vorn ist eine gueltige Kennung — und ein Ordner, den
    # `echo` und `[` fuer einen Schalter halten koennten. Er wird gekappt.
    ("-n", json.dumps(stellen_liste(12)), BOX_ZAHL),
    # ── DER BEISEITEGELEGTE BESTAND EINES GELOESCHTEN KINDES ────────────────
    # `bereichBeiseite()` legt ihn ausdruecklich hin, statt ihn wegzuwerfen.
    # Ein Kappen darin loescht aus einer Sicherung, und zwar still.
    ("geloescht-kalea-1754650000000", json.dumps(stellen_liste(12)), "unveraendert"),
]


def teil_e(b: Befund, tmp: Path) -> None:
    print("\n══ E  DAS KAPPSKRIPT BEI UNSINN")
    print("   Kein Server. Nur der Ordner, wie er nach Monaten Betrieb aussieht:")
    print("   halbe Dateien, Verweise, beiseitegelegte Kinder, krumme Namen.\n")
    konf, tm = sandkasten(tmp)
    wurzel = konf / "profile"

    for name, inhalt, _ in BOESE_ORDNER:
        ordner = wurzel / name
        ordner.mkdir(exist_ok=True)
        if inhalt is not None:
            (ordner / "resume.json").write_text(inhalt)

    # Ein Ordner, der ein VERWEIS auf einen anderen ist.
    (tmp / "woanders").mkdir()
    (tmp / "woanders" / "resume.json").write_text(json.dumps(stellen_liste(12)))
    (wurzel / "verweis-ordner").symlink_to(tmp / "woanders", target_is_directory=True)
    # Eine resume.json, die selbst ein Verweis ist.
    (wurzel / "mit-verweis").mkdir()
    (tmp / "ziel-bestand.json").write_text(json.dumps(stellen_liste(12)))
    (wurzel / "mit-verweis" / "resume.json").symlink_to(tmp / "ziel-bestand.json")
    # Eine TOTE resume.json.
    (wurzel / "toter-verweis").mkdir()
    (wurzel / "toter-verweis" / "resume.json").symlink_to(tmp / "gibtsnicht.json")
    # Eine gewoehnliche Datei mitten im Ordner.
    (wurzel / "nichtsda.txt").write_text("kein Kind")
    # Gemischte Kategorien, abwechselnd.
    gemischt = []
    for i in range(12):
        gemischt.append(
            {
                "type": "spotify",
                "category": "resume" if i % 2 == 0 else "audiobook",
                "id": f"w{i}",
                "index": i,
                "title": f"Werk {i}",
            }
        )
    (wurzel / "gemischt").mkdir()
    (wurzel / "gemischt" / "resume.json").write_text(json.dumps(gemischt))
    # Der Gast bekommt auch etwas.
    (wurzel / "gast" / "resume.json").write_text(json.dumps(stellen_liste(12)))

    # Eine Zahl, die ein Mensch von Hand falsch in profile.json geschrieben hat.
    stand = json.loads((konf / "profile.json").read_text())
    for p in stand["profile"]:
        if p["kennung"] == "probe-durch-b":
            p["merken"] = "5"  # Text statt Zahl
        if p["kennung"] == "probe-durch-c":
            p["merken"] = -4
    stand["profile"].append({"kennung": "gemischt", "name": "Gemischt", "figur": "", "angelegt": 1, "merken": 3})
    (konf / "profile.json").write_text(json.dumps(stand, indent=4))
    for k in ("probe-durch-b", "probe-durch-c"):
        (wurzel / k / "resume.json").write_text(json.dumps(stellen_liste(12)))

    vorher = {}
    for name, inhalt, _ in BOESE_ORDNER:
        if inhalt is not None:
            vorher[name] = datei_bytes(wurzel / name / "resume.json")

    skript = skript_herrichten(SKRIPT, konf, tm)
    lauf = subprocess.run(["bash", str(skript)], capture_output=True, text=True, timeout=180)

    b.prueft(lauf.returncode == 0, "das Skript endet ohne Fehler", f"code {lauf.returncode}")
    boese_ausgabe = [
        z
        for z in (lauf.stdout + lauf.stderr).splitlines()
        if "unary operator" in z or "too many arguments" in z or "integer expression" in z or "command not found" in z
    ]
    b.prueft(not boese_ausgabe, "und ohne Klagen der Shell ueber krumme Namen", f"{boese_ausgabe[:4]}")

    def zaehlen(name: str) -> int:
        try:
            return len(json.loads((wurzel / name / "resume.json").read_text()))
        except Exception:  # noqa: BLE001
            return -1

    for name, inhalt, erwartet in BOESE_ORDNER:
        if erwartet is None:
            b.prueft(
                not (wurzel / name / "resume.json").exists(),
                f"{name!r}: ohne resume.json wird nichts angelegt",
                art(wurzel / name / "resume.json"),
            )
        elif erwartet == "unveraendert":
            b.prueft(
                datei_bytes(wurzel / name / "resume.json") == vorher[name],
                f"{name!r}: unangetastet, Byte fuer Byte",
                f"{len(datei_bytes(wurzel / name / 'resume.json'))} Bytes (vorher {len(vorher[name])})",
            )
        else:
            b.prueft(
                zaehlen(name) == erwartet,
                f"{name!r}: auf {erwartet} gekappt",
                f"{zaehlen(name)} Eintraege",
            )

    b.prueft(
        not (wurzel / "PWNED").exists()
        and not (Path.cwd() / "PWNED").exists()
        and not (wurzel / "PWNED2").exists()
        and not (tmp / "PWNED").exists(),
        "aus `$(touch PWNED)` im Ordnernamen wird nichts ausgefuehrt",
        f"{sorted(p.name for p in wurzel.iterdir())[:6]} …",
    )
    b.prueft(
        (wurzel / "verweis-ordner").is_symlink() and len(json.loads((tmp / "woanders" / "resume.json").read_text())) == BOX_ZAHL,
        "ein Ordner, der ein VERWEIS ist, wird gekappt — und bleibt ein Verweis",
        f"{art(wurzel / 'verweis-ordner')}",
    )
    b.prueft(
        (wurzel / "mit-verweis" / "resume.json").is_symlink()
        and len(json.loads((tmp / "ziel-bestand.json").read_text())) == BOX_ZAHL,
        "eine resume.json, die ein VERWEIS ist: durch den Verweis geschrieben, er bleibt stehen",
        art(wurzel / "mit-verweis" / "resume.json"),
    )
    b.prueft(
        (wurzel / "toter-verweis" / "resume.json").is_symlink() and not (wurzel / "toter-verweis" / "resume.json").exists(),
        "ein TOTER Verweis wird nicht zu einer Datei gemacht",
        art(wurzel / "toter-verweis" / "resume.json"),
    )
    b.prueft(
        (wurzel / "nichtsda.txt").read_text() == "kein Kind",
        "eine gewoehnliche Datei zwischen den Ordnern wird nicht angefasst",
        f"{len(datei_bytes(wurzel / 'nichtsda.txt'))} Bytes",
    )
    b.prueft(
        zaehlen("probe-durch-b") == BOX_ZAHL,
        "eine Zahl, die als TEXT in profile.json steht, gilt nicht — es greift die Box-Zahl",
        f"{zaehlen('probe-durch-b')} Eintraege (Box {BOX_ZAHL})",
    )
    b.prueft(
        zaehlen("probe-durch-c") == BOX_ZAHL,
        "eine NEGATIVE Zahl in profile.json gilt nicht — es greift die Box-Zahl",
        f"{zaehlen('probe-durch-c')} Eintraege (Box {BOX_ZAHL})",
    )
    b.prueft(
        (konf / "resume.json").is_symlink(),
        "UND DIE BRUECKE STEHT DANACH NOCH (lstat)",
        art(konf / "resume.json"),
    )
    b.prueft(
        not (tm / ".resume.lock").exists(),
        "die Sperre ist am Ende wieder weg",
        art(tm / ".resume.lock"),
    )

    # ── Gemischte Kategorien ───────────────────────────────────────────────
    #
    # Gezaehlt wird nach `.category == "resume"`. Geloescht wurde bis zum
    # 07.08.2026 nach POSITION — also auch Fremdes, und der Deckel wurde dabei
    # nicht einmal erreicht. `stelleEinsetzen` (weiterhoeren.ts) laesst fremde
    # Eintraege ausdruecklich stehen; das Skript muss dasselbe tun.
    gem = json.loads((wurzel / "gemischt" / "resume.json").read_text())
    resume_n = sum(1 for e in gem if e.get("category") == "resume")
    fremd_n = sum(1 for e in gem if e.get("category") != "resume")
    b.prueft(
        resume_n == 3,
        "gemischte Kategorien: der Deckel (3) gilt fuer die RESUME-Eintraege",
        f"{resume_n} Resume-Eintraege (vorher 6, Deckel 3)",
    )
    b.prueft(
        fremd_n == 6,
        "und kein einziger FREMDER Eintrag ist dabei weggefallen",
        f"{fremd_n} fremde Eintraege (vorher 6)",
    )

    # DIE GEGENPROBE ZUR REPARATUR: bei einer reinen Resume-Liste — und so
    # sieht jede Datei auf der Box heute aus — muss die neue jq-Kette Eintrag
    # fuer Eintrag dasselbe liefern wie die alte. Sonst waere die Reparatur
    # eine Verhaltensaenderung fuer alle.
    rein = tmp / "rein.json"
    rein.write_text(json.dumps(stellen_liste(12)))
    alt = subprocess.run(
        ["jq", "--argjson", "num_to_delete", "5", "sort_by(.index) | .[$num_to_delete:]", str(rein)],
        capture_output=True,
        text=True,
    )
    neu = subprocess.run(
        [
            "jq",
            "--argjson",
            "num_to_delete",
            "5",
            "sort_by(.index)\n| (to_entries | map(select(.value.category == \"resume\")) | .[:$num_to_delete] | map(.key)) as $raus\n| to_entries | map(select(.key as $k | $raus | index($k) | not)) | map(.value)",
            str(rein),
        ],
        capture_output=True,
        text=True,
    )
    b.prueft(
        alt.returncode == 0 and neu.returncode == 0 and json.loads(alt.stdout) == json.loads(neu.stdout),
        "bei einer REINEN Resume-Liste liefert die neue jq-Kette dasselbe wie die alte",
        f"alt {len(json.loads(alt.stdout or '[]'))} / neu {len(json.loads(neu.stdout or '[]'))} Eintraege",
    )

    # ── Ein zweiter Lauf darf nichts mehr tun ──────────────────────────────
    zweiter_vorher = {n: datei_bytes(wurzel / n / "resume.json") for n, i, _ in BOESE_ORDNER if i is not None}
    lauf2 = subprocess.run(["bash", str(skript)], capture_output=True, text=True, timeout=180)
    zweiter_nachher = {n: datei_bytes(wurzel / n / "resume.json") for n, i, _ in BOESE_ORDNER if i is not None}
    b.prueft(
        lauf2.returncode == 0 and zweiter_vorher == zweiter_nachher,
        "ein zweiter Lauf aendert nichts mehr (es ist ein Deckel, kein Fass ohne Boden)",
        f"code {lauf2.returncode}, abweichend: {[n for n in zweiter_vorher if zweiter_vorher[n] != zweiter_nachher[n]]}",
    )

    # ── Die Sperre haelt ───────────────────────────────────────────────────
    (wurzel / "probe-durch-a" / "resume.json").write_text(json.dumps(stellen_liste(12)))
    (tm / ".resume.lock").write_text("")
    lauf3 = subprocess.run(["bash", str(skript)], capture_output=True, text=True, timeout=60)
    b.prueft(
        len(json.loads((wurzel / "probe-durch-a" / "resume.json").read_text())) == 12,
        "liegt die Sperre, wird gar nichts gekappt",
        f"{lauf3.stdout.strip()[:80]}",
    )
    (tm / ".resume.lock").unlink()

    # ── Und ohne profile.json? ─────────────────────────────────────────────
    (konf / "profile.json").unlink()
    (wurzel / "probe-durch-a" / "resume.json").write_text(json.dumps(stellen_liste(12)))
    lauf4 = subprocess.run(["bash", str(skript)], capture_output=True, text=True, timeout=180)
    b.prueft(
        lauf4.returncode == 0 and len(json.loads((wurzel / "probe-durch-a" / "resume.json").read_text())) == BOX_ZAHL,
        "ohne profile.json gilt fuer jedes Kind die Box-Zahl — und nichts bricht",
        f"code {lauf4.returncode}, {len(json.loads((wurzel / 'probe-durch-a' / 'resume.json').read_text()))} Eintraege",
    )


# ── main ────────────────────────────────────────────────────────────────────


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--nur", default="", help="nur diese Teile, z.B. AE")
    ap.add_argument("--behalten", action="store_true", help="Sandkasten stehenlassen")
    ap.add_argument("--gegenprobe", action="store_true", help="zusaetzlich: wird F rot, wenn man das Fenster aufreisst?")
    ap.add_argument("--port", type=int, default=9777, help="Wunschport (ab hier wird gesucht)")
    a = ap.parse_args()
    teile = (a.nur or "ABCDEF").upper()

    tmp = Path(tempfile.mkdtemp(prefix="durchkommen-merken-"))
    b = Befund()
    schluss = 0
    try:
        port = freier_port(a.port)
        print(f"Sandkasten: {tmp}")
        print(f"Port: {port} (wirklich gebunden; die Antwort wird an `{MARKE}` geprueft)")
        if set("ABCDF") & set(teile):
            konf, tm = sandkasten(tmp / "neu")
            vorher = abzug(tmp / "neu")
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
                    teil_c(b, tmp / "neu", konf, port, vorher)
                if "D" in teile:
                    teil_d(b, konf, port)
                if "F" in teile:
                    teil_f(b, konf, port)
            finally:
                p.terminate()
                try:
                    p.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    p.kill()
        if "E" in teile:
            teil_e(b, tmp / "e")

        print("\n" + "═" * 76)
        rot = b.rote()
        if rot:
            print(f"  {rot} von {len(b.zeilen)} Messungen sind ROT.")
            for ok, was, gemessen in b.zeilen:
                if not ok:
                    print(f"    - {was}\n        {gemessen}")
            schluss = 1
        else:
            print(f"  {len(b.zeilen)} Messungen, alle gruen.")
        if a.gegenprobe:
            schluss = max(schluss, gegenprobe(tmp, port, a.behalten))
    finally:
        if a.behalten:
            print(f"\nSandkasten bleibt: {tmp}")
        else:
            shutil.rmtree(tmp, ignore_errors=True)
    return schluss


if __name__ == "__main__":
    sys.exit(main())
