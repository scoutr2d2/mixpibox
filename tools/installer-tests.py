#!/usr/bin/env python3
"""INSTALLER-TESTS — die Testdateien des remote-step-installer, jede fuer sich.

WARUM ES DAS GIBT (28.09.2026): unter `remote-step-installer/tests/` liegen 30
Testdateien, und KEIN Laeufer rief sie — weder `tools/pruefen.sh` noch
`tools/doku-luecken-probe.sh` noch die CI (`git grep -n '_test.py' -- tools/*.sh
.github` fand nur `readme-behauptungen-pruefen.sh`, und das ZAEHLT sie bloss).
Das Audit vom 30.08. (Rang 4) meldete genau das schon einmal: der
Zwillings-Angleich hatte drei dieser Tests rot gemacht, und niemand merkte es,
weil niemand sie fuhr — am 28.09. waren es noch dieselben drei. Es ist
dieselbe Falle wie bei den Plugin-Tests (llmwiki: testmenge-in-keinem-laeufer):
nicht eine Wache haengt in keinem Laeufer, sondern eine ganze Testmenge, und
`tools/ungerufene-wachen.py` sah sie nicht, weil es nur `tools/` las.

WAS ALS TEST GILT: `SAMMELRUF` unten, ohne Dateien, die mit `_` beginnen.
Nicht eine Namensliste — sonst ist die naechste neue Testdatei wieder in keinem
Laeufer. Die Endungen `_test.py` UND `_smoke.py` kommen beide vor; wer nur
`*_test.py` sucht, verliert die drei Rauchtests. `ungerufene-wachen.py` liest
dieselbe Konstante und zaehlt jede passende Datei als gerufen — darum steht das
Muster als Bindung da und wird unten benutzt, nicht abgeschrieben.

WIE: jede Datei einzeln, im Ordner `remote-step-installer/` (die Tests rechnen
mit diesem Arbeitsverzeichnis), mit Frist. Nacheinander, nicht parallel:
`watch_test.py` teilt sich eine feste Datei `/tmp/wt-pc`. Geglaubt wird der
Ausgang; jede Datei endet mit `sys.exit(1 if … else 0)` (nachgesehen 28.09.).
Dauer am 28.09.2026: rund 90 s, fast alles in watch_test (32 s),
selbstlauf_test (20 s) und pairing_test (17 s) — die warten auf echte Prozesse.

PYTHON: `remote-step-installer/.venv/bin/python3`, wenn es das gibt — dahin
legt `./setup-controller.sh --venv` die Controller-Abhaengigkeiten (PyYAML,
textual) ohne sudo. Sonst das `python3` des Rechners.

DREI URTEILE je Datei
    gruen    Ausgang 0.
    FEHLT    Ausgang ungleich 0, WEIL eine Controller-Abhaengigkeit fehlt
             („No module named …" fuer genau die Module, die
             `setup-controller.sh` nachzieht). Das ist die Umgebung, nicht der
             Code — es wird NICHT rot, steht aber mit Zahl in der Bilanz und
             nennt den Befehl, der es behebt. Nicht gemessen ist nicht dasselbe
             wie gruen gemessen (llmwiki:
             sonde-ohne-erreichbarkeitsriegel-urteilt-ueber-nichts).
             Ein fehlendes Modul, das NICHT auf der Liste steht, ist rot: ein
             Tippfehler im Import soll nicht als „Umgebung" durchgehen.
    ROT      alles andere, auch Fristablauf.

BEKANNT — rote Tests mit GENANNTEM Grund. Sie werden trotzdem GEFAHREN (sie
    sind in 0,1 s rot) und ihr Rot bricht nichts; wird einer gruen, bricht
    `--pruefen` mit „austragen" — sonst stuende ein reparierter Test weiter
    auf einer Liste, auf der sein naechstes Rot niemanden stoert. Ebenso rot:
    ein Eintrag fuer eine Datei, die es nicht mehr gibt.
    KEIN Ueberspringen: gemessen braucht keine der 30 Dateien Geraet, root oder
    Netz. Kaeme eine dazu, gehoert der Riegel IN den Test (so meldet
    einrichtung_schirm_test „0 Teil(e) uebersprungen") — eine Ueberspring-Liste
    HIER saehe `ungerufene-wachen.py` nicht, es wuerde die Datei weiter als
    gerufen zaehlen.

AUFRUF
    python3 tools/installer-tests.py              alle, Tabelle, Ausgang 0
    python3 tools/installer-tests.py --pruefen    dasselbe, Ausgang 1 bei ROT
    python3 tools/installer-tests.py -v qr_test.py   nur diese, mit Ausgabe
"""
import argparse
import re
import subprocess
import sys
import time
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
INSTALLER = WURZEL / "remote-step-installer"
SAMMELRUF = "remote-step-installer/tests/*.py"
FRIST = 120

# Was `setup-controller.sh` nachzieht (Kopfzeile dort: PyYAML, textual). Fehlt
# eines davon, ist es die Umgebung.
CONTROLLER_MODULE = {"yaml", "textual"}

# Datei -> Grund.
#
# Gemessen am 28.09.2026: 30 Dateien, 24 gruen, 3 brauchen textual (FEHLT,
# siehe oben), 3 rot. Die drei roten sind dieselben, die AUDIT-2026-08-30
# Rang 4 schon meldete. In allen dreien ist der TEST veraltet, nicht der Code:
BEKANNT: dict[str, str] = {
    "bootwache_test.py":
        "rot seit dem Zwillings-Angleich 276e42ea (29.08.): der Test liest "
        "bw.FRIST_S, die Bootwache kennt seither FRIST_VORGABE/FRIST_MIN/FRIST_MAX",
    "pythonpaket_test.py":
        "rot, der Test verlangt die ALTE Reihenfolge: er sucht "
        "'cmp -s \"$E/vorstart.sh\"' und will das Kopieren VOR dem Vergleich — "
        "sdprep.vorstart_skript vergleicht '$Q/vorstart.sh' gegen \"$0\" absichtlich "
        "DAVOR (Kommentar dort: dahinter verglich es sich mit sich selbst)",
    "touchbridge_test.py":
        "rot: die Attrappe _Ctl im Test kennt kein lesen(), "
        "mupibox-touch-bridge.py ruft in laufen() ctl.lesen()",
}


def python_waehlen() -> str:
    venv = INSTALLER / ".venv" / "bin" / "python3"
    return str(venv) if venv.exists() else sys.executable


def testdateien() -> list[Path]:
    return sorted(p for p in WURZEL.glob(SAMMELRUF) if p.is_file() and not p.name.startswith("_"))


def letzte_zeile(text: str) -> str:
    for z in reversed(text.splitlines()):
        z = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", z).strip()
        if z:
            return z
    return ""


def fehlendes_controller_modul(text: str) -> str | None:
    # Nicht nach `ModuleNotFoundError:` suchen: die TUI-Tests fangen den
    # Importfehler im Controller ab und drucken nur
    # „Fehlende Abhängigkeit (No module named 'textual')".
    m = re.search(r"No module named '([^'.]+)", text)
    if m and m.group(1) in CONTROLLER_MODULE:
        return m.group(1)
    return None


def fahren(py: str, datei: Path, frist: int) -> dict:
    start = time.monotonic()
    try:
        lauf = subprocess.run([py, str(datei.relative_to(INSTALLER))], cwd=INSTALLER,
                              stdin=subprocess.DEVNULL, capture_output=True, text=True,
                              timeout=frist)
        rc, text = lauf.returncode, (lauf.stdout or "") + (lauf.stderr or "")
    except subprocess.TimeoutExpired as e:
        rc = None
        roh = e.stdout or b""
        text = roh.decode(errors="replace") if isinstance(roh, bytes) else roh
    dauer = time.monotonic() - start
    if rc == 0:
        urteil = "gruen"
    elif rc is not None and (modul := fehlendes_controller_modul(text)):
        urteil = f"FEHLT {modul}"
    else:
        urteil = "ROT"
    return {"name": datei.name, "rc": rc, "urteil": urteil, "dauer": dauer,
            "letzte": letzte_zeile(text) if rc is not None else f"Frist {frist}s abgelaufen",
            "text": text}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--pruefen", action="store_true", help="Ausgang 1 bei ROT")
    ap.add_argument("--frist", type=int, default=FRIST, help="Sekunden je Datei")
    ap.add_argument("-v", "--laut", action="store_true", help="Ausgabe roter Tests zeigen")
    ap.add_argument("namen", nargs="*", help="nur diese Dateien")
    a = ap.parse_args()

    alle = testdateien()
    vorhanden = {p.name for p in alle}
    if not alle:
        # Eine Wache, die nichts findet, darf nicht gruen sagen: das Muster
        # griffe dann ins Leere, und jeder Lauf waere „0 rot".
        print(f"KEINE Testdatei unter {SAMMELRUF} — Muster oder Ordner verschoben?")
        return 1
    tote = sorted(n for n in BEKANNT if n not in vorhanden)
    if a.namen:
        unbekannt = [n for n in a.namen if n not in vorhanden]
        if unbekannt:
            print(f"keine solche Testdatei: {', '.join(unbekannt)}", file=sys.stderr)
            return 2
        auswahl = [p for p in alle if p.name in a.namen]
    else:
        auswahl = alle

    py = python_waehlen()
    print(f"Installer-Tests ({py}, Frist {a.frist}s je Datei)")
    ergebnisse = []
    for datei in auswahl:
        e = fahren(py, datei, a.frist)
        ergebnisse.append(e)
        rc = "—" if e["rc"] is None else str(e["rc"])
        marke = "  [BEKANNT]" if e["name"] in BEKANNT else ""
        print(f"  {e['urteil']:<14} rc={rc:<3} {e['dauer']:5.1f}s  {e['name']}{marke}")
        print(f"      {e['letzte'][:150]}")
        if a.laut and e["urteil"] != "gruen":
            for z in e["text"].splitlines()[-25:]:
                print(f"        | {z}")

    rot = [e["name"] for e in ergebnisse if e["urteil"] == "ROT" and e["name"] not in BEKANNT]
    rot_bekannt = [e["name"] for e in ergebnisse if e["urteil"] == "ROT" and e["name"] in BEKANNT]
    gruen_bekannt = [e["name"] for e in ergebnisse if e["urteil"] == "gruen" and e["name"] in BEKANNT]
    fehlt = [e for e in ergebnisse if e["urteil"].startswith("FEHLT")]
    gruen = sum(1 for e in ergebnisse if e["urteil"] == "gruen")

    for n in rot_bekannt:
        print(f"BEKANNT ROT: {n} — {BEKANNT[n]}")
    if tote:
        print(f"BEKANNT ZEIGT INS LEERE: {', '.join(tote)} — Eintrag in tools/installer-tests.py streichen")
    if gruen_bekannt:
        print(f"BEKANNT, ABER GRUEN: {', '.join(gruen_bekannt)} — Eintrag in tools/installer-tests.py streichen")
    if fehlt:
        module = sorted({e["urteil"].split()[1] for e in fehlt})
        print(f"NICHT GEMESSEN ({len(fehlt)}): {', '.join(e['name'] for e in fehlt)}")
        print(f"  es fehlt {', '.join(module)} — beheben mit: remote-step-installer/setup-controller.sh --venv")
    if rot:
        print(f"ROT: {', '.join(rot)}")
        print("  einzeln ansehen: python3 tools/installer-tests.py -v " + " ".join(rot))
    print(f"Bilanz: {len(alle)} Testdateien, {len(ergebnisse)} gefahren, {gruen} gruen, "
          f"{len(rot)} rot, {len(rot_bekannt)} BEKANNT rot, {len(fehlt)} nicht gemessen")

    if a.pruefen and (rot or tote or gruen_bekannt):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
