#!/usr/bin/env python3
"""Was kostet `mupibox-sicherung.py --anlegen`, und haelt sie unter Last?

WARUM ES DAS GIBT (E29/B5)
Die neue Auslieferung soll VOR dem Tausch einen Stand anstossen statt eine
weitere `.vor-<stempel>`-Datei anzulegen. Bevor man sich darauf verlaesst,
muessen vier Dinge gemessen sein — GEMESSEN, nicht gelesen:

  A KOSTEN       wie lange dauert `--anlegen` an der Box wirklich? Eine
                 Auslieferung, die dadurch eine Minute laenger dauert, waere
                 ein anderer Handel als eine, die zwei Sekunden kostet.
  B GLEICHZEITIG haelt die Reparatur aus [[sicherung-leere-datei-besteht-jede-
                 pruefung]], wenn der Server WAEHRENDDESSEN schreibt? Gemessen
                 wurde damals: 20,8 % der Leser sahen data.json mit NULL Bytes.
                 Hier laufen beide Seiten nebeneinander — der ungeschuetzte
                 Weg (stand_bauen, EIN Lesen) und der geschuetzte (anlegen).
  C KONTINGENT   raeumt die Auslese zuverlaessig? Und was zaehlt NICHT gegen
                 das Kontingent?
  D VOLL         was tut sie, wenn der Datentraeger voll ist — und was bleibt
                 danach liegen?

DAS WICHTIGSTE AN DER BAUART: dieses Werkzeug fasst die echten Staende der Box
NICHT an. Es biegt `STAENDE` auf ein Wegwerf-Verzeichnis um und legt fuer B
einen Abzug des Konfigurationsbaums an. Gelesen wird der echte Baum nur in A —
und Lesen aendert nichts. Eine Messung, die die Sicherung der Box beschaedigt,
waere teurer als ihr Ergebnis.

AUFRUF (auf der Box)
    python3 sicherung-kosten.py            # alles
    python3 sicherung-kosten.py A C        # nur einzelne Abschnitte
    python3 sicherung-kosten.py --laeufe 20
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import resource
import shutil
import signal
import statistics
import sys
import tempfile
import threading
import time

SKRIPT = "/usr/local/bin/mupibox/mupibox-sicherung.py"


def modul_laden(pfad: str):
    """Genau das laden, was auf der Box LIEGT — nicht, was im Baum steht."""
    spec = importlib.util.spec_from_file_location("mupibox_sicherung", pfad)
    if spec is None or spec.loader is None:
        raise SystemExit(f"{pfad} laesst sich nicht laden")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def still(*_a, **_k):
    pass


class Sammler:
    """Ausgabe einsammeln statt drucken — sonst versinkt die Messung darin."""

    def __init__(self):
        self.zeilen: list[str] = []

    def __call__(self, *teile):
        self.zeilen.append(" ".join(str(t) for t in teile))

    @property
    def text(self) -> str:
        return "\n".join(self.zeilen)


# ── A: was kostet ein Stand? ───────────────────────────────────────────────
def abschnitt_a(S, laeufe: int) -> dict:
    """`--anlegen` gegen ein Wegwerf-Verzeichnis, aber am ECHTEN Baum.

    Warum das Wegwerf-Verzeichnis unter /home/dietpi liegen MUSS: `schreiben`
    macht fsync auf die Datei UND auf das Verzeichnis. Auf tmpfs kostet das
    nichts, auf der SD-Karte sehr wohl. Eine Messung in /tmp waere zu schoen.
    """
    echt = S.STAENDE
    probe = os.path.join(os.path.dirname(echt), "kosten-probe")
    shutil.rmtree(probe, ignore_errors=True)
    os.makedirs(probe, exist_ok=True)
    S.STAENDE = probe
    ergebnis: dict = {"verzeichnis": probe, "laeufe": laeufe}
    try:
        # Erst die Teilschritte einzeln, damit man weiss, WO die Zeit bleibt.
        t_lesen, t_stabil, t_schreiben, t_ganz = [], [], [], []
        for i in range(laeufe):
            t0 = time.perf_counter()
            stand, inhalte, *_r = S.stand_bauen("kosten-probe")
            t1 = time.perf_counter()
            t_lesen.append(t1 - t0)

            t0 = time.perf_counter()
            # `*_r` haelt beide Fassungen aus: bis E29/B6 gab
            # stand_bauen_stabil vier Werte zurueck, seither fuenf (die
            # Zugangsdaten kommen getrennt heraus). Ein Messwerkzeug soll
            # nicht daran scheitern, gegen welche Fassung es laeuft.
            stand2, inhalte2, *_r = S.stand_bauen_stabil("kosten-probe")
            klagen, stabil = _r[-2], _r[-1]
            t1 = time.perf_counter()
            t_stabil.append(t1 - t0)

            ziel = os.path.join(probe, f"mupibox-sicherung-2026-kosten{i:02d}.tar.gz")
            t0 = time.perf_counter()
            S.schreiben(ziel, stand2, inhalte2)
            t1 = time.perf_counter()
            t_schreiben.append(t1 - t0)
            ergebnis.setdefault("bytes", os.path.getsize(ziel))
            ergebnis.setdefault("dateien", len(stand2["dateien"]))
            ergebnis.setdefault("klagen", klagen)
            ergebnis.setdefault("stabil", stabil)
            os.remove(ziel)

        # Und dann der ganze Befehl, so wie die Auslieferung ihn ruft.
        for _ in range(laeufe):
            for n in S.staende_lesen(probe):
                os.remove(os.path.join(probe, n))
            s = Sammler()
            t0 = time.perf_counter()
            code = S.anlegen("kosten-messung", False, False, sagen=s)
            t1 = time.perf_counter()
            t_ganz.append(t1 - t0)
            ergebnis["letzter_code"] = code
            ergebnis["letzte_ausgabe"] = s.text
        ergebnis["lesen_einmal"] = kennzahlen(t_lesen)
        ergebnis["stabil_zweimal"] = kennzahlen(t_stabil)
        ergebnis["schreiben"] = kennzahlen(t_schreiben)
        ergebnis["anlegen_ganz"] = kennzahlen(t_ganz)
    finally:
        shutil.rmtree(probe, ignore_errors=True)
        S.STAENDE = echt
    return ergebnis


def kennzahlen(werte: list[float]) -> dict:
    return {"n": len(werte),
            "min_ms": round(min(werte) * 1000, 1),
            "median_ms": round(statistics.median(werte) * 1000, 1),
            "max_ms": round(max(werte) * 1000, 1)}


# ── B: der Server schreibt, waehrend gesichert wird ────────────────────────
class Schreiber(threading.Thread):
    """Ahmt `POST /api/add` nach: `jsonfile.writeFile` auf die ZIELDATEI.

    Der Unterschied, um den es geht: `medienAendern` legt daneben und benennt
    um — da gibt es nie eine halbe Datei. `jsonfile.writeFile` oeffnet die
    Zieldatei zum Schreiben; sie ist damit auf 0 gekuerzt und wird erst
    danach gefuellt. Genau dieses Fenster hat
    tools/data-json-schreibfenster.sh mit 20,8 % gemessen.
    """

    def __init__(self, pfad: str, nutzlast: bytes):
        super().__init__(daemon=True)
        self.pfad, self.nutzlast = pfad, nutzlast
        self.halt = threading.Event()
        self.runden = 0

    def run(self):
        while not self.halt.is_set():
            with open(self.pfad, "wb") as f:
                time.sleep(0.004)      # das Fenster, in dem die Datei 0 B ist
                f.write(self.nutzlast)
            self.runden += 1
            time.sleep(0.004)


def abschnitt_b(S, laeufe: int) -> dict:
    echt_baeume, echt_staende = S.BAEUME, S.STAENDE
    tmp = tempfile.mkdtemp(prefix="sicherung-last-")
    fake = os.path.join(tmp, "config")
    os.makedirs(fake)
    quelle = echt_baeume["server/config"]
    for n in sorted(os.listdir(quelle)):
        q = os.path.join(quelle, n)
        if os.path.isfile(q) and not os.path.islink(q):
            shutil.copy2(q, os.path.join(fake, n))
    ziel_json = os.path.join(fake, "data.json")
    if not os.path.isfile(ziel_json):
        shutil.rmtree(tmp, ignore_errors=True)
        return {"fehler": "keine data.json im Abzug"}
    nutzlast = open(ziel_json, "rb").read()

    staende = os.path.join(tmp, "staende")
    os.makedirs(staende)
    S.BAEUME = {"server/config": fake}
    S.STAENDE = staende
    erg: dict = {"abzug": fake, "data_json_bytes": len(nutzlast), "laeufe": laeufe}
    w = Schreiber(ziel_json, nutzlast)
    try:
        w.start()
        # (1) DER UNGESCHUETZTE WEG: einmal lesen, nichts pruefen. So haette
        #     eine Sicherung ohne die Reparatur ausgesehen.
        roh_leer = roh_ok = 0
        for _ in range(laeufe):
            _stand, inhalte, *_r = S.stand_bauen("last-roh")
            if S.klagen_ueber(inhalte):
                roh_leer += 1
            else:
                roh_ok += 1
        erg["roh_erwischt"] = roh_leer
        erg["roh_anteil_prozent"] = round(100.0 * roh_leer / max(1, laeufe), 1)

        # (2) DER GESCHUETZTE WEG: der Befehl, den die Auslieferung ruft.
        codes: dict[int, int] = {}
        entstanden, kaputt, unruhig = 0, [], 0
        for _ in range(laeufe):
            for n in S.staende_lesen(staende):
                os.remove(os.path.join(staende, n))
            s = Sammler()
            code = S.anlegen("last-probe", False, False, sagen=s)
            codes[code] = codes.get(code, 0) + 1
            for n in S.staende_lesen(staende):
                entstanden += 1
                stand, inhalte = S.stand_oeffnen(os.path.join(staende, n))
                klagen = S.klagen_ueber(inhalte)
                if klagen:
                    kaputt.append(klagen)
                if stand.get("unruhig"):
                    unruhig += 1
        erg["codes"] = codes
        erg["staende_entstanden"] = entstanden
        erg["staende_mit_leerer_datei"] = len(kaputt)
        erg["staende_unruhig_vermerkt"] = unruhig
        erg["beispiel_klage"] = kaputt[0] if kaputt else None
        erg["schreibrunden"] = w.runden
    finally:
        w.halt.set()
        w.join(timeout=5)
        S.BAEUME, S.STAENDE = echt_baeume, echt_staende
        shutil.rmtree(tmp, ignore_errors=True)
    return erg


# ── C: das Kontingent ──────────────────────────────────────────────────────
def abschnitt_c(S) -> dict:
    echt = S.STAENDE
    tmp = tempfile.mkdtemp(prefix="sicherung-kontingent-")
    S.STAENDE = tmp
    erg: dict = {"BEHALTEN": S.BEHALTEN, "KARTE_BEHALTEN": S.KARTE_BEHALTEN}
    try:
        # 3 angeheftete und 15 lose Staende, aelteste zuerst.
        fest = [f"mupibox-sicherung-20260101-0000{i:02d}-fest.behalten.tar.gz"
                for i in range(3)]
        lose = [f"mupibox-sicherung-20260201-0001{i:02d}-lose.tar.gz"
                for i in range(15)]
        for n in fest + lose:
            open(os.path.join(tmp, n), "wb").write(b"x")
        fallen = S.auslese(S.staende_lesen(tmp), S.BEHALTEN)
        erg["vorher"] = {"fest": len(fest), "lose": len(lose)}
        erg["auslese_nennt"] = len(fallen)
        erg["auslese_nennt_fest"] = [n for n in fallen if ".behalten." in n]
        erg["auslese_nennt_namen"] = sorted(fallen)
        for n in fallen:
            os.remove(os.path.join(tmp, n))
        rest = S.staende_lesen(tmp)
        erg["nachher_fest"] = len([n for n in rest if ".behalten." in n])
        erg["nachher_lose"] = len([n for n in rest if ".behalten." not in n])

        # Zaehlen angeheftete Staende gegen das Kontingent? (Antwort: nein —
        # und das ist die Stelle, an der eine Auslieferung mit `--behalten`
        # genau die Halde erzeugen wuerde, die E29 abschaffen soll.)
        for n in S.staende_lesen(tmp):
            os.remove(os.path.join(tmp, n))
        for i in range(40):
            open(os.path.join(tmp, f"mupibox-sicherung-20260301-0002{i:02d}"
                                   f"-ausliefern.behalten.tar.gz"), "wb").write(b"x")
        erg["40_angeheftete_fallen"] = len(S.auslese(S.staende_lesen(tmp), S.BEHALTEN))

        # Zwei Staende in DERSELBEN Sekunde mit demselben Grund: gleicher Name.
        s1 = {"erzeugt": "2026-08-05T12:00:00+02:00", "grund": "vor-Auslieferung"}
        s2 = {"erzeugt": "2026-08-05T12:00:00+02:00", "grund": "vor-Auslieferung"}
        erg["gleiche_sekunde_gleicher_name"] = (S.name_bauen(s1, False)
                                                == S.name_bauen(s2, False))
        erg["name_beispiel"] = S.name_bauen(s1, False)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
        S.STAENDE = echt
    return erg


# ── D: der Datentraeger ist voll ───────────────────────────────────────────
def abschnitt_d(S) -> dict:
    """Kein root, kein echtes ENOSPC — aber derselbe Weg durch den Code.

    RLIMIT_FSIZE laesst `write` mit EFBIG scheitern, genau dort, wo ENOSPC es
    auch taete: mitten im Schreiben des Archivs. Gemessen wird nicht die
    Fehlernummer, sondern was DANACH liegen bleibt.
    """
    echt = S.STAENDE
    tmp = tempfile.mkdtemp(prefix="sicherung-voll-")
    S.STAENDE = tmp
    erg: dict = {"art": "RLIMIT_FSIZE = 4096 B (ENOSPC-Ersatz, ohne root)"}
    lesen, schreiben = os.pipe()
    kind = os.fork()
    if kind == 0:                                    # Kind
        os.close(lesen)
        try:
            signal.signal(signal.SIGXFSZ, signal.SIG_IGN)
            resource.setrlimit(resource.RLIMIT_FSIZE, (4096, 4096))
            s = Sammler()
            try:
                code = S.anlegen("voller-traeger", False, False, sagen=s)
                aus = {"code": code, "ausnahme": None, "text": s.text[:400]}
            except BaseException as e:               # noqa: BLE001
                aus = {"code": None, "ausnahme": f"{type(e).__name__}: {e}",
                       "text": s.text[:400]}
            os.write(schreiben, json.dumps(aus).encode())
        finally:
            os.close(schreiben)
            os._exit(0)
    os.close(schreiben)
    roh = b""
    while True:
        st = os.read(lesen, 65536)
        if not st:
            break
        roh += st
    os.close(lesen)
    os.waitpid(kind, 0)
    try:
        erg.update(json.loads(roh.decode() or "{}"))
    except ValueError:
        erg["kind_sagte_nichts"] = roh.decode(errors="replace")[:400]
    liegen = sorted(os.listdir(tmp))
    erg["liegt_danach"] = liegen
    erg["halbe_archive"] = [n for n in liegen if n.endswith(".imbau")]
    erg["zaehlt_gegen_kontingent"] = len(S.staende_lesen(tmp))
    shutil.rmtree(tmp, ignore_errors=True)
    S.STAENDE = echt
    return erg


# ── Die Sperre: was sagt `--anlegen`, waehrend zurueckgespielt wird? ───────
def abschnitt_e(S) -> dict:
    """Der Rueckgabewert, an dem sich eine Auslieferung verrechnen kann.

    Waehrend einer Wiederherstellung legt `--anlegen` NICHTS an — und meldet
    trotzdem 0. Wer nur den Rueckgabewert prueft, glaubt, er habe einen Stand.
    """
    echt_sperre, echt_staende = S.SPERRE, S.STAENDE
    tmp = tempfile.mkdtemp(prefix="sicherung-sperre-")
    S.SPERRE = os.path.join(tmp, "sperre")
    S.STAENDE = os.path.join(tmp, "staende")
    os.makedirs(S.STAENDE)
    erg: dict = {}
    try:
        open(S.SPERRE, "w").write("1 0\n")
        s = Sammler()
        erg["code_mit_sperre"] = S.anlegen("sperr-probe", False, False, sagen=s)
        erg["staende_mit_sperre"] = len(S.staende_lesen(S.STAENDE))
        erg["sagt"] = s.zeilen[0] if s.zeilen else ""
        # Verfaellt sie? SPERRE_GILT Sekunden nach der letzten Aenderung.
        alt = time.time() - S.SPERRE_GILT - 5
        os.utime(S.SPERRE, (alt, alt))
        erg["gilt_nach_ablauf"] = S.Sperre.gilt()
        erg["SPERRE_GILT_s"] = S.SPERRE_GILT
        erg["sperrpfad_echt"] = echt_sperre
    finally:
        S.SPERRE, S.STAENDE = echt_sperre, echt_staende
        shutil.rmtree(tmp, ignore_errors=True)
    return erg


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("abschnitte", nargs="*", default=None,
                   help="A B C D E — ohne Angabe alles")
    p.add_argument("--skript", default=SKRIPT)
    p.add_argument("--laeufe", type=int, default=12)
    p.add_argument("--json", action="store_true")
    a = p.parse_args(argv[1:])
    will = {x.upper() for x in (a.abschnitte or ["A", "B", "C", "D", "E"])}

    S = modul_laden(a.skript)
    aus: dict = {"skript": a.skript,
                 "gemessen": time.strftime("%Y-%m-%d %H:%M:%S"),
                 "host": os.uname().nodename}
    if "A" in will:
        aus["A_kosten"] = abschnitt_a(S, a.laeufe)
    if "B" in will:
        aus["B_gleichzeitig"] = abschnitt_b(S, a.laeufe)
    if "C" in will:
        aus["C_kontingent"] = abschnitt_c(S)
    if "D" in will:
        aus["D_voll"] = abschnitt_d(S)
    if "E" in will:
        aus["E_sperre"] = abschnitt_e(S)
    print(json.dumps(aus, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
