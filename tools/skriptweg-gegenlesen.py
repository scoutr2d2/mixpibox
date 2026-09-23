#!/usr/bin/env python3
"""Gegenlesen zum fuenften Ziel von `tools/ausliefern.py` (`--nur scripts`).

WOZU. `ausliefern.py --nur scripts --probe` sagt, was es taete. Dieses Werkzeug
sagt unabhaengig davon, was AN DER BOX steht — mit einer zweiten Messung, die
nicht denselben Code benutzt. Zwei Wege, die dasselbe behaupten, sind ein Beleg;
ein Weg, der sich selbst bestaetigt, ist keiner.

Es fasst NICHTS an. Alles laeuft ueber eine Leseverbindung, das einzige, was
auf der Box entsteht, ist ein Python-Aufruf ueber stdin.

WAS ES MISST — jede Frage einzeln, weil jede einzeln falsch sein kann:

  1 BESTAND. Alle Dateien an den drei Zielorten (/usr/local/bin/mupibox,
    /usr/local/bin, /opt/mupibox-tools): Rechte, Eigentuemer, Groesse, sha256,
    mtime, Zahl der Namen (nlink), Verweise. Auch die, die nicht aus dem Baum
    kommen — gerade die: ein Tausch des ganzen Ordners wuerde sie loeschen.

  2 DECKUNG BAUM ↔ BOX. Fuer jede Datei aus scripts/, die einen Ort hat:
    gleich · anders · nicht da. Und fuer jede Datei an den Zielorten, die im
    Baum KEINE Entsprechung hat: fremd.

  3 DIE GEGENRICHTUNG — und das ist die Frage, die ein Ausrollweg nicht selbst
    stellt: gibt es an der Box Dateien, die NEUER sind als im Baum? Verglichen
    wird die mtime an der Box gegen den Zeitpunkt des letzten Commits, der die
    Datei im Baum angefasst hat. Ist die Box neuer UND der Inhalt anders, wuerde
    ein Ausliefern Arbeit wegwerfen. Das ist ein Verdacht, kein Urteil: eine
    Kopie von Hand traegt die Zeit der Kopie, nicht die der Aenderung. Deshalb
    steht daneben, ob der Boxstand einem AELTEREN Stand aus der Geschichte des
    Baumes entspricht (dann ist er nicht neu, sondern nur spaeter kopiert).

  4 WORAUS WUERDE EIN LAUF SCHOEPFEN. `ausliefern.py --nur scripts` nimmt den
    ARBEITSBAUM, nicht `HEAD` — bei den vier alten Zielen ist das richtig, dort
    liefert jemand seine eigene, eben geschriebene Aenderung aus und sieht sie
    sofort. Bei scripts/ ist es etwas anderes: hier gehen fremde Dateien mit,
    die derselbe Betreiber nie angesehen hat. Am 08.08.2026 um 01:07 stand
    `scripts/mupibox/remove_max_resume.sh` mitten in einer Aenderung, die noch
    niemand festgeschrieben hatte — und der Probelauf zaehlte sie zu den zehn,
    die er ausliefern wuerde. Deshalb steht hier zu jeder Datei, ob ihr Stand im
    Baum festgeschrieben ist. Es ist kein Verbot; es ist die Auskunft, die ein
    Gegenleser braucht, bevor er den echten Lauf freigibt.

  5 WER FUEHRT WAS AUS. Aus `systemctl cat` JEDER Unit (nicht `systemctl show`,
    damit es eine wirklich andere Messung ist als die in ausliefern.py) werden
    die Exec-Zeilen gelesen und den Dateien zugeordnet. Dazu der Zustand des
    Dienstes. Gemeldet wird auch die Gegenrichtung: eine Unit, die einen Pfad an
    einem der drei Orte nennt, an dem gar nichts liegt.

AUFRUF
    tools/skriptweg-gegenlesen.py                 # Bericht
    tools/skriptweg-gegenlesen.py --json          # als JSON
    tools/skriptweg-gegenlesen.py --nur-abweichung  # nur, was nicht gleich ist

RUECKGABE   0 gemessen · 1 Box nicht erreichbar oder Messung unvollstaendig
Es gibt bewusst KEINEN Rueckgabewert fuer „es gibt Abweichungen": dieses
Werkzeug urteilt nicht, es misst.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
BOX_VORGABE = "dietpi@192.168.178.169"
ORTE = ["/usr/local/bin/mupibox", "/usr/local/bin", "/opt/mupibox-tools"]

# Der Teil, der auf der Box laeuft. Absichtlich klein und ohne Abhaengigkeiten:
# er soll auf einem DietPi mit Systempython laufen, sonst misst er nichts.
FERNMESSER = r'''#!/usr/bin/env python3
import grp, hashlib, json, os, pwd, subprocess, sys

ORTE = json.load(sys.stdin)["orte"]


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def name(uid, gid):
    try:
        n = pwd.getpwuid(uid).pw_name
    except Exception:
        n = str(uid)
    try:
        g = grp.getgrgid(gid).gr_name
    except Exception:
        g = str(gid)
    return n, g


bestand = []
for ort in ORTE:
    if not os.path.isdir(ort):
        bestand.append({"ort": ort, "fehlt": True})
        continue
    for eintrag in sorted(os.listdir(ort)):
        p = os.path.join(ort, eintrag)
        e = {"pfad": p, "ort": ort, "name": eintrag}
        if os.path.islink(p):
            e["verweis"] = os.readlink(p)
            e["art"] = "verweis"
            bestand.append(e)
            continue
        st = os.lstat(p)
        if os.path.isdir(p):
            e["art"] = "ordner"
            bestand.append(e)
            continue
        n, g = name(st.st_uid, st.st_gid)
        e.update({"art": "datei", "modus": "%04o" % (st.st_mode & 0o7777),
                  "uid": st.st_uid, "gid": st.st_gid, "nutzer": n, "gruppe": g,
                  "bytes": st.st_size, "mtime": int(st.st_mtime),
                  "nlink": st.st_nlink})
        try:
            e["sha"] = sha(p)
        except OSError as ex:
            e["lesefehler"] = str(ex)
        bestand.append(e)

# WER FUEHRT WAS AUS — ueber `systemctl cat`, nicht `systemctl show`.
# `cat` zeigt die Unit-Datei so, wie sie auf der Platte steht, und stolpert
# nicht ueber Vorlagen. Dafuer sind die Werte NICHT aufgeloest (%i, Umgebung) —
# das ist hier gewollt: es soll eine ANDERE Messung sein als die in
# ausliefern.py, damit nicht beide denselben Fehler machen.
p = subprocess.run(["systemctl", "list-unit-files", "--type=service",
                    "--no-legend", "--no-pager"], capture_output=True, text=True)
namen = [z.split()[0] for z in (p.stdout or "").splitlines() if z.split()]
units = []
for u in namen:
    c = subprocess.run(["systemctl", "cat", u], capture_output=True, text=True)
    if c.returncode != 0:
        units.append({"unit": u, "lesefehler": (c.stderr or "").strip()[:120]})
        continue
    pfade = set()
    for zeile in (c.stdout or "").splitlines():
        s = zeile.strip()
        if not s.startswith(("ExecStart", "ExecStop", "ExecReload", "ExecCondition")):
            continue
        for stueck in s.partition("=")[2].replace(";", " ").split():
            roh = stueck.split("=", 1)[-1].strip('"\'')
            roh = roh.lstrip("-+!@:")
            if roh.startswith("/"):
                pfade.add(os.path.normpath(roh))
    z = subprocess.run(["systemctl", "show", u, "-p", "ActiveState", "-p",
                        "SubState", "-p", "UnitFileState", "--no-pager"],
                       capture_output=True, text=True)
    zust = dict(x.partition("=")[::2] for x in (z.stdout or "").splitlines() if "=" in x)
    units.append({"unit": u, "pfade": sorted(pfade),
                  "aktiv": zust.get("ActiveState", "").strip(),
                  "unter": zust.get("SubState", "").strip(),
                  "datei": zust.get("UnitFileState", "").strip()})

json.dump({"bestand": bestand, "units": units, "unitzahl": len(namen)}, sys.stdout)
'''


def sha256_datei(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def baum_dateien() -> dict[str, dict]:
    """Alle Dateien unter scripts/, mit sha256 und dem Zeitpunkt des letzten
    Commits, der sie angefasst hat. NICHT die mtime im Arbeitsbaum: die sagt
    nur, wann git sie zuletzt ausgecheckt hat."""
    wurzel = WURZEL / "scripts"
    aus: dict[str, dict] = {}
    for p in sorted(wurzel.rglob("*")):
        if not p.is_file() or p.is_symlink() or p.suffix == ".pyc":
            continue
        rel = p.relative_to(wurzel).as_posix()
        if "__pycache__" in p.relative_to(wurzel).parts:
            continue
        aus[rel] = {"rel": rel, "name": p.name, "pfad": p,
                    "sha": sha256_datei(p), "bytes": p.stat().st_size}
    # Ein Aufruf fuer alle statt einer je Datei.
    for rel, e in aus.items():
        q = subprocess.run(["git", "-C", str(WURZEL), "log", "-1", "--format=%ct %H",
                            "--", f"scripts/{rel}"], capture_output=True, text=True)
        teile = (q.stdout or "").split()
        e["commit_zeit"] = int(teile[0]) if teile else 0
        e["commit"] = teile[1][:8] if len(teile) > 1 else ""
        # Steht die Datei im Arbeitsbaum anders da als im letzten Commit?
        s = subprocess.run(["git", "-C", str(WURZEL), "status", "--porcelain",
                            "--", f"scripts/{rel}"], capture_output=True, text=True)
        e["ungespeichert"] = bool((s.stdout or "").strip())
    return aus


def stand_in_geschichte(rel: str, sha_box: str) -> str:
    """Kommt der Stand, der an der Box liegt, aus der Geschichte DIESES Baumes?

    Das entscheidet, ob 'die Box ist neuer' ernst zu nehmen ist. Traegt die Box
    eine Fassung, die im Baum irgendwann einmal so aussah, ist sie nicht neuer —
    sie ist nur spaeter dorthin kopiert worden. Traegt sie eine Fassung, die es
    im Baum NIE gab, wurde dort am Geraet gearbeitet.
    """
    q = subprocess.run(["git", "-C", str(WURZEL), "log", "--format=%H", "-n", "80",
                        "--", f"scripts/{rel}"], capture_output=True, text=True)
    for h in (q.stdout or "").split():
        b = subprocess.run(["git", "-C", str(WURZEL), "show", f"{h}:scripts/{rel}"],
                           capture_output=True)
        if b.returncode != 0:
            continue
        if hashlib.sha256(b.stdout).hexdigest() == sha_box:
            k = subprocess.run(["git", "-C", str(WURZEL), "log", "-1", "--format=%ct",
                                h, "--", f"scripts/{rel}"], capture_output=True, text=True)
            return f"aus der Geschichte: {h[:8]}"
    return "in der Geschichte des Baumes nicht gefunden"


def main() -> int:
    t = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    t.add_argument("--box", default=BOX_VORGABE)
    t.add_argument("--json", action="store_true")
    t.add_argument("--nur-abweichung", action="store_true")
    t.add_argument("--zeitlimit", type=int, default=600)
    a = t.parse_args()

    # Der Fernmesser geht als Datei ueber stdin — `sudo -n python3 -` liest
    # den Code, den Auftrag holt er sich aus einer zweiten Zeile. Das ginge
    # auch huebscher; es geht hier darum, NICHTS auf der Box liegen zu lassen.
    p = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", a.box,
         "sudo -n python3 -c \"import sys;exec(sys.stdin.read(int(sys.stdin.readline())))\""],
        input=f"{len(FERNMESSER)}\n{FERNMESSER}" + json.dumps({"orte": ORTE}),
        capture_output=True, text=True, timeout=a.zeitlimit)
    if p.returncode != 0 or not p.stdout.strip():
        print(f"Box nicht messbar: rc={p.returncode} {(p.stderr or '')[:400]}",
              file=sys.stderr)
        return 1
    fern = json.loads(p.stdout)

    baum = baum_dateien()
    nach_name: dict[str, list[str]] = {}
    for rel, e in baum.items():
        nach_name.setdefault(e["name"], []).append(rel)

    bestand = [e for e in fern["bestand"] if e.get("art") == "datei"]
    verweise = [e for e in fern["bestand"] if e.get("art") == "verweis"]
    units = fern["units"]

    # ── Deckung ─────────────────────────────────────────────────────────────
    zeilen = []
    fremd = []
    for e in sorted(bestand, key=lambda x: x["pfad"]):
        treffer = nach_name.get(e["name"], [])
        passend = [r for r in treffer if baum[r]["sha"] == e.get("sha")]
        if not treffer:
            fremd.append(e)
            continue
        rel = passend[0] if passend else treffer[0]
        b = baum[rel]
        gleich = b["sha"] == e.get("sha")
        z = {"pfad": e["pfad"], "rel": rel, "gleich": gleich,
             "modus": e["modus"], "besitz": f"{e['nutzer']}:{e['gruppe']}",
             "nlink": e["nlink"], "mtime": e["mtime"],
             "commit_zeit": b["commit_zeit"], "commit": b["commit"],
             "mehrere_baumpfade": treffer if len(treffer) > 1 else None,
             "ungespeichert": b["ungespeichert"]}
        if not gleich:
            z["box_neuer"] = e["mtime"] > b["commit_zeit"]
            z["herkunft"] = stand_in_geschichte(rel, e.get("sha", ""))
        zeilen.append(z)

    da = {z["rel"] for z in zeilen}
    nicht_da = [r for r in sorted(baum) if r not in da]

    # ── Units ───────────────────────────────────────────────────────────────
    pfad_zu_unit: dict[str, list[dict]] = {}
    for u in units:
        for pf in u.get("pfade", []):
            if any(pf.startswith(o + "/") for o in ORTE):
                pfad_zu_unit.setdefault(pf, []).append(u)
    vorhandene = {e["pfad"] for e in bestand} | {e["pfad"] for e in verweise}
    unit_ins_leere = {pf: us for pf, us in pfad_zu_unit.items() if pf not in vorhandene}
    lesefehler = [u for u in units if u.get("lesefehler")]

    befund = {
        "orte": ORTE,
        "bestand_zahl": len(bestand),
        "verweise": [{"pfad": e["pfad"], "zeigt_auf": e["verweis"]} for e in verweise],
        "baum_zahl": len(baum),
        "gleich": [z for z in zeilen if z["gleich"]],
        "anders": [z for z in zeilen if not z["gleich"]],
        "nicht_auf_der_box": nicht_da,
        "fremd_auf_der_box": [{"pfad": e["pfad"], "modus": e["modus"],
                               "besitz": f"{e['nutzer']}:{e['gruppe']}",
                               "bytes": e["bytes"], "mtime": e["mtime"]} for e in fremd],
        "mehrfach_verknuepft": [{"pfad": e["pfad"], "nlink": e["nlink"]}
                                for e in bestand if e["nlink"] > 1],
        "rechte_verteilung": {},
        "besitz_verteilung": {},
        "unit_zu_datei": {pf: [{"unit": u["unit"], "aktiv": u["aktiv"],
                                "datei": u["datei"]} for u in us]
                          for pf, us in sorted(pfad_zu_unit.items())},
        "unit_zeigt_ins_leere": {pf: [u["unit"] for u in us]
                                 for pf, us in sorted(unit_ins_leere.items())},
        "units_gelesen": len(units) - len(lesefehler),
        "units_gesamt": fern["unitzahl"],
        "unit_lesefehler": [u["unit"] for u in lesefehler],
    }
    for e in bestand:
        befund["rechte_verteilung"][e["modus"]] = befund["rechte_verteilung"].get(e["modus"], 0) + 1
        k = f"{e['nutzer']}:{e['gruppe']}"
        befund["besitz_verteilung"][k] = befund["besitz_verteilung"].get(k, 0) + 1

    if a.json:
        json.dump(befund, sys.stdout, indent=2, ensure_ascii=False)
        print()
        return 0

    import time

    def zeit(t_: int) -> str:
        return time.strftime("%Y-%m-%d %H:%M", time.localtime(t_)) if t_ else "—"

    print(f"Gegenlesen an {a.box}")
    print(f"  Orte: {', '.join(ORTE)}")
    print(f"  {befund['bestand_zahl']} Dateien an den Zielorten, "
          f"{len(befund['verweise'])} Verweise, {befund['baum_zahl']} Dateien unter scripts/")
    print(f"  Units: {befund['units_gelesen']} von {befund['units_gesamt']} gelesen"
          + (f", Lesefehler: {befund['unit_lesefehler']}" if befund["unit_lesefehler"] else ""))
    print()
    print(f"DECKUNG   gleich {len(befund['gleich'])} · ANDERS {len(befund['anders'])} · "
          f"nicht auf der Box {len(befund['nicht_auf_der_box'])} · "
          f"fremd auf der Box {len(befund['fremd_auf_der_box'])}")
    print()

    if befund["anders"]:
        print("ANDERS — Baum und Box tragen verschiedenen Inhalt")
        for z in sorted(befund["anders"], key=lambda x: x["pfad"]):
            marke = "  BOX NEUER" if z["box_neuer"] else ""
            print(f"  {z['pfad']}")
            print(f"      Baum: scripts/{z['rel']}  Commit {z['commit']} {zeit(z['commit_zeit'])}"
                  + ("  [im Arbeitsbaum ungespeichert]" if z["ungespeichert"] else ""))
            print(f"      Box:  {z['modus']} {z['besitz']}  mtime {zeit(z['mtime'])}{marke}")
            print(f"      Boxstand: {z['herkunft']}")
            for u in befund["unit_zu_datei"].get(z["pfad"], []):
                print(f"      Dienst: {u['unit']} [{u['aktiv']}, {u['datei']}]")
            if not befund["unit_zu_datei"].get(z["pfad"]):
                print("      Dienst: keiner nennt diesen Pfad")
        print()

    # WORAUS EIN LAUF SCHOEPFEN WUERDE. Getrennt vom Rest, weil es die einzige
    # Frage ist, die nicht die Box beantwortet, sondern der Arbeitsbaum — und
    # weil sie vor dem echten Lauf beantwortet sein muss, nicht danach.
    offen = [z for z in befund["anders"] if z["ungespeichert"]]
    if offen:
        print("NICHT FESTGESCHRIEBEN — der Arbeitsbaum weicht hier von HEAD ab")
        print("  Ein Lauf von `ausliefern.py --nur scripts` nimmt DIESEN Stand,")
        print("  nicht den aus dem letzten Commit. Bei fremden Dateien heisst das:")
        print("  es geht Arbeit auf die Box, die niemand gegengelesen hat.")
        for z in offen:
            print(f"  scripts/{z['rel']}  ->  {z['pfad']}")
        print()

    if befund["nicht_auf_der_box"]:
        print(f"NICHT AUF DER BOX ({len(befund['nicht_auf_der_box'])})")
        for r in befund["nicht_auf_der_box"]:
            print(f"  scripts/{r}")
        print()

    if befund["fremd_auf_der_box"]:
        print(f"FREMD AUF DER BOX — kein Name unter scripts/ passt dazu "
              f"({len(befund['fremd_auf_der_box'])})")
        print("  Ein Tausch des ganzen Verzeichnisses wuerde genau diese loeschen.")
        for e in befund["fremd_auf_der_box"]:
            print(f"  {e['pfad']:52s} {e['modus']} {e['besitz']:14s} {e['bytes']:8d} B  {zeit(e['mtime'])}")
        print()

    if not a.nur_abweichung:
        print("RECHTE UND EIGENTUEMER an den Zielorten")
        for m, n in sorted(befund["rechte_verteilung"].items()):
            print(f"  Modus {m}: {n}")
        for k, n in sorted(befund["besitz_verteilung"].items()):
            print(f"  {k}: {n}")
        print()

    if befund["verweise"]:
        print("VERWEISE (rename wuerde den Verweis ersetzen, nicht sein Ziel)")
        for v in befund["verweise"]:
            print(f"  {v['pfad']} -> {v['zeigt_auf']}")
        print()
    if befund["mehrfach_verknuepft"]:
        print("MEHRERE NAMEN AUF EINEM INODE")
        for e in befund["mehrfach_verknuepft"]:
            print(f"  {e['pfad']} (nlink {e['nlink']})")
        print()

    print("WER FUEHRT WAS AUS (aus `systemctl cat`, an den drei Orten)")
    for pf, us in sorted(befund["unit_zu_datei"].items()):
        print(f"  {pf}")
        for u in us:
            print(f"      {u['unit']} [{u['aktiv']}, {u['datei']}]")
    if befund["unit_zeigt_ins_leere"]:
        print()
        print("UNIT NENNT EINEN PFAD, AN DEM NICHTS LIEGT")
        for pf, us in befund["unit_zeigt_ins_leere"].items():
            print(f"  {pf} <- {', '.join(us)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
