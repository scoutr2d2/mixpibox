#!/usr/bin/env python3
"""Wem gehoert, was auf dieser Box liegt? — die Ablagen nach Besitz sortieren.

WOFUER: E18 Stufe 2 dreht die Ablage um. Heute haengt die Kennung an den
DATEINAMEN (`gespielt.gast.json`), kuenftig soll ein ORDNER je Profil daran
haengen. Vor jedem solchen Umbau muss dieselbe Frage zweimal beantwortet
werden, und zwar getrennt:

  1. Was sagt der QUELLTEXT — welche Ablage geht durch `ablageName()`
     (also je Profil) und welche nicht (also box-weit)?
  2. Was liegt WIRKLICH auf der Box — welche Datei traegt eine Kennung im
     Namen, wie gross ist sie, und was davon ist in Wahrheit ein VERWEIS?

Diese beiden Antworten liefen am 05.08.2026 auseinander: der Quelltext
kennt `profile.json`, auf der Box gibt es sie NICHT (der Server faellt auf
den Gast zurueck und schreibt sie erst beim ersten Aendern). Wer nur den
Quelltext liest, plant einen Umzug fuer eine Datei, die es nicht gibt; wer
nur die Box ansieht, uebersieht, dass sie jederzeit entstehen kann.

WARUM EIN WERKZEUG UND KEIN BEFEHL VON HAND: die Liste der Ablagen waechst
(sie ist seit Juli von 12 auf 20 gewachsen). Ein `ls` von Hand nennt, was
heute daliegt; dieses Werkzeug nennt AUCH, was der Quelltext anlegen kann,
und stellt beides nebeneinander.

SYMLINKS SIND DER GRUND, WARUM ES `--box` GIBT. `active_data.json` und
`active_resume.json` sind Verweise, die von einem Skript (check_network.sh /
get_network.sh) je nach Netzlage umgehaengt werden. Im Quelltext sind sie
gewoehnliche Pfade; nur am Geraet sieht man, dass dahinter kein Inhalt liegt.

AUFRUF:
    python3 tools/ablage-besitz-schau.py                  # nur Quelltext
    python3 tools/ablage-besitz-schau.py --box            # dazu die Box
    python3 tools/ablage-besitz-schau.py --box 192.168.178.169 --benutzer dietpi

LIEST NUR. Es aendert nichts, weder hier noch auf der Box.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
SERVER_TS = WURZEL / "src" / "backend-api" / "src" / "server.ts"
PROFILE_TS = WURZEL / "src" / "backend-api" / "src" / "profile.ts"

# Wo die Ablagen auf der Box liegen. Aus der systemd-Unit
# (`mupibox-server.service`, WorkingDirectory) plus `configBasePath` in
# server.ts — NICHT geraten.
BOX_KONFIG = "/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config"
BOX_VORGABE = "192.168.178.169"

# Ablagen, die der Quelltext NICHT ueber `${configBasePath}` bildet, aber
# trotzdem zur Frage gehoeren: die beiden Sperrdateien liegen in /tmp und
# beschuetzen resume.json bzw. data.json. Wer resume.json je Profil fuehrt,
# braucht auch je Profil eine Sperre — sonst sperrt Liams Merkpunkt Kaleas
# aus. Fest verdrahtet sind sie ausserdem in vier Shell-Skripten.
SPERREN = {
    "/tmp/.resume.lock": "resume.json",
    "/tmp/.data.lock": "data.json",
}


def quelltext_ablagen(text: str) -> dict[str, dict]:
    """Alle `const X = `${configBasePath}/name.json`` einsammeln."""
    aus: dict[str, dict] = {}
    muster = re.compile(r"^const (\w+) = `\$\{configBasePath\}/([^`]+)`", re.M)
    for treffer in muster.finditer(text):
        zeile = text[: treffer.start()].count("\n") + 1
        aus[treffer.group(1)] = {
            "datei": treffer.group(2),
            "zeile": zeile,
            "durch_ablageName": [],
            "roh": [],
        }
    return aus


def ablagename_stellen(text: str, ablagen: dict[str, dict]) -> None:
    """Wer geht durch `ablageName(...)`? Das ist die Trennlinie.

    `ablageName(gespieltFile, kennung)` heisst: je Profil. Steht die
    Konstante dagegen blank da, ist die Ablage box-weit — und genau das ist
    die Liste, die E18 Stufe 2 abzuarbeiten hat.
    """
    zeilen = text.split("\n")
    for nr, zeile in enumerate(zeilen, start=1):
        for name, eintrag in ablagen.items():
            # Wortgrenze, sonst trifft `resumeFile` auch `activeresumeFile`.
            if not re.search(rf"\b{re.escape(name)}\b", zeile):
                continue
            if nr == eintrag["zeile"]:
                continue  # die Definition selbst zaehlt nicht als Nutzung
            if re.search(rf"ablageName\(\s*{re.escape(name)}\b", zeile):
                eintrag["durch_ablageName"].append(nr)
            else:
                eintrag["roh"].append(nr)


def routen(text: str) -> list[tuple[int, str, str]]:
    """Alle `app.<verb>('/api/...')` mit Zeilennummer."""
    aus = []
    muster = re.compile(r"^app\.(get|post|put|patch|delete)\('([^']+)'", re.M)
    for t in muster.finditer(text):
        aus.append((text[: t.start()].count("\n") + 1, t.group(1).upper(), t.group(2)))
    return aus


def routen_die_anfassen(text: str, konstante: str) -> list[tuple[int, str, str]]:
    """Welche Route fasst diese Ablage an?

    ZUORDNUNG UEBER DIE REIHENFOLGE IM TEXT: express-Routen stehen als
    Bloecke untereinander; eine Fundstelle gehoert zu der Route, die zuletzt
    davor deklariert wurde. Das ist eine Naeherung — Hilfsfunktionen ausserhalb
    jeder Route werden derselben zugeschlagen, die zufaellig davor steht.
    Deshalb wird die Funktion, in der die Stelle steht, mit ausgegeben, und
    Fundstellen VOR der ersten Route bekommen ausdruecklich „(ausserhalb)".
    """
    alle = routen(text)
    zeilen = text.split("\n")
    aus = []
    for nr, zeile in enumerate(zeilen, start=1):
        if not re.search(rf"\b{re.escape(konstante)}\b", zeile):
            continue
        davor = [r for r in alle if r[0] <= nr]
        if davor:
            r = davor[-1]
            aus.append((nr, f"{r[1]} {r[2]}", zeile.strip()[:90]))
        else:
            aus.append((nr, "(ausserhalb)", zeile.strip()[:90]))
    return aus


def funktionen_die_anfassen(text: str, konstante: str) -> list[tuple[int, str]]:
    """In welcher Funktion steht die Fundstelle? (letzte Deklaration davor)"""
    fmuster = re.compile(r"^(?:export )?(?:async )?function (\w+)", re.M)
    fkt = [(text[: t.start()].count("\n") + 1, t.group(1)) for t in fmuster.finditer(text)]
    rt = [r[0] for r in routen(text)]
    zeilen = text.split("\n")
    aus = []
    for nr, zeile in enumerate(zeilen, start=1):
        if not re.search(rf"\b{re.escape(konstante)}\b", zeile):
            continue
        davor = [f for f in fkt if f[0] <= nr]
        # Eine Funktion gilt nur, wenn zwischen ihr und der Fundstelle keine
        # Route beginnt — sonst steht die Fundstelle im Rumpf der Route.
        if davor and not any(davor[-1][0] < r <= nr for r in rt):
            aus.append((nr, davor[-1][1]))
    return aus


def box_lesen(host: str, benutzer: str) -> str | None:
    """Was liegt WIRKLICH da? Groesse, Verweisziel, Kennung im Namen."""
    befehl = (
        f"C={BOX_KONFIG}; "
        "for f in $C/*; do "
        '  if [ -L "$f" ]; then printf "%s\\tVERWEIS\\t->%s\\n" "$(basename $f)" "$(readlink $f)"; '
        '  elif [ -d "$f" ]; then printf "%s\\tORDNER\\t%s Eintraege\\n" "$(basename $f)" "$(ls -1 $f | wc -l)"; '
        '  else printf "%s\\t%s\\t\\n" "$(basename $f)" "$(stat -c %s $f)"; fi; '
        "done; "
        'for l in /tmp/.resume.lock /tmp/.data.lock; do '
        '  if [ -e "$l" ]; then printf "%s\\tSPERRE-GESETZT\\t\\n" "$l"; '
        '  else printf "%s\\tsperre-frei\\t\\n" "$l"; fi; done'
    )
    try:
        e = subprocess.run(
            ["ssh", "-o", "ConnectTimeout=10", "-o", "BatchMode=yes", f"{benutzer}@{host}", befehl],
            capture_output=True,
            text=True,
            timeout=40,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError) as f:
        print(f"  NICHT GEMESSEN: {f}", file=sys.stderr)
        return None
    if e.returncode != 0:
        print(f"  NICHT GEMESSEN: ssh endete mit {e.returncode}: {e.stderr.strip()[:200]}", file=sys.stderr)
        return None
    return e.stdout


def kennung_im_namen(datei: str, bekannt: set[str]) -> str | None:
    """`gespielt.gast.json` -> `gast`; `kinderzeit.json` -> None.

    DIESELBE FORM WIE `ablageName` in profile.ts: die Kennung steht VOR der
    Endung. Das Muster der Kennung (`^[a-z0-9-]{1,24}$`) steht dort ebenfalls
    und wird hier absichtlich nachgeschlagen statt nachgebaut — laufen die
    beiden auseinander, meldet dieses Werkzeug es (siehe `muster_pruefen`).

    DIE BASIS MUSS DER QUELLTEXT KENNEN, sonst gaebe es Kennungen, die keine
    sind: `data.json.bak` ergaebe „json", `/tmp/.resume.lock` ergaebe
    „resume". Beides ist am 05.08.2026 in der ersten Fassung dieses Werkzeugs
    genau so herausgekommen — die Form allein reicht nicht, es muss zu einer
    Ablage passen, die es im Quelltext WIRKLICH gibt.
    """
    if not datei.endswith(".json"):
        return None
    teile = datei.split(".")
    if len(teile) < 3:
        return None
    mitte = teile[-2]
    if not re.fullmatch(r"[a-z0-9-]{1,24}", mitte):
        return None
    basis = ".".join(teile[:-2] + teile[-1:])
    return mitte if basis in bekannt else None


def muster_pruefen() -> str:
    """Steht in profile.ts noch dasselbe Kennungsmuster wie hier?"""
    try:
        t = PROFILE_TS.read_text(encoding="utf-8")
    except OSError:
        return "profile.ts nicht lesbar — Muster NICHT geprueft"
    t2 = re.search(r"KENNUNG_MUSTER = /\^([^/]+)\$/", t)
    if not t2:
        return "KENNUNG_MUSTER in profile.ts nicht gefunden — NICHT geprueft"
    if t2.group(1) != "[a-z0-9-]{1,24}":
        return f"ACHTUNG: profile.ts hat {t2.group(1)}, dieses Werkzeug [a-z0-9-]{{1,24}}"
    return "Kennungsmuster stimmt mit profile.ts ueberein ([a-z0-9-]{1,24})"


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--box", nargs="?", const=BOX_VORGABE, default=None, help=f"Box dazu messen (Vorgabe {BOX_VORGABE})")
    p.add_argument("--benutzer", default="dietpi")
    p.add_argument("--resume", action="store_true", help="alle Stellen zu resume.json einzeln nennen")
    args = p.parse_args()

    text = SERVER_TS.read_text(encoding="utf-8")
    ablagen = quelltext_ablagen(text)
    ablagename_stellen(text, ablagen)

    print("── QUELLTEXT: welche Ablage geht durch ablageName()? ──────────────")
    print(f"   {SERVER_TS.relative_to(WURZEL)}, {len(ablagen)} Ablagen\n")
    je_profil, box_weit = [], []
    for name, e in sorted(ablagen.items(), key=lambda x: x[1]["datei"]):
        (je_profil if e["durch_ablageName"] else box_weit).append((name, e))

    print(f"  JE PROFIL ({len(je_profil)}):")
    for name, e in je_profil:
        stellen = ", ".join(str(z) for z in e["durch_ablageName"])
        roh = f", roh noch an {len(e['roh'])} Stellen" if e["roh"] else ""
        print(f"    {e['datei']:32s} {name} (Zeile {e['zeile']}) ablageName@{stellen}{roh}")

    print(f"\n  BOX-WEIT ({len(box_weit)}):")
    for name, e in box_weit:
        print(f"    {e['datei']:32s} {name} (Zeile {e['zeile']}), {len(e['roh'])} Fundstellen")

    print("\n── resume.json: was fasst es an? ──────────────────────────────────")
    for kon in ("resumeFile", "activeresumeFile", "resumeLock"):
        stellen = routen_die_anfassen(text, kon)
        fkt = dict(funktionen_die_anfassen(text, kon))
        print(f"\n  {kon}: {len(stellen)} Fundstellen")
        gesehen = []
        for nr, route, inhalt in stellen:
            # DIE DEKLARATION IST KEINE NUTZUNG. Sie steht auf Modulebene und
            # wuerde sonst der letzten Funktion davor zugeschlagen — `const
            # resumeFile = …` erschien so als Stelle „in ensureTlsCert()",
            # was schlicht falsch ist.
            if re.match(rf"\s*const {re.escape(kon)}\s*=", inhalt):
                if args.resume:
                    print(f"    {nr:6d}  {'(Deklaration)':44s} {inhalt}")
                continue
            marke = fkt.get(nr)
            # STEHT DIE STELLE IN EINER FUNKTION, gilt DIE — nicht die Route,
            # die zufaellig davor deklariert ist. `resumeStellenLesen()` wird
            # von drei Routen benutzt; sie einer davon zuzuschlagen waere die
            # falsche Antwort auf „wer fasst resume.json an?".
            ort = f"Funktion {marke}()" if marke else route
            if args.resume:
                print(f"    {nr:6d}  {ort:44s} {inhalt}")
            elif ort not in gesehen:
                gesehen.append(ort)
        if not args.resume:
            for ort in gesehen:
                print(f"    {ort}")

    print("\n── Sperrdateien (liegen in /tmp, NICHT in server/config) ──────────")
    for pfad, wofuer in SPERREN.items():
        print(f"    {pfad:22s} schuetzt {wofuer} — box-weit, eine fuer alle Profile")

    print(f"\n── Muster-Gegenprobe ──────────────────────────────────────────────\n    {muster_pruefen()}")

    if args.box:
        print(f"\n── AM GERAET ({args.box}:{BOX_KONFIG}) ────────────────────")
        aus = box_lesen(args.box, args.benutzer)
        if aus is None:
            print("    NICHT GEMESSEN — die Box war nicht erreichbar.")
        else:
            bekannt = {e["datei"] for e in ablagen.values()}
            gefunden = set()
            for zeile in aus.strip().split("\n"):
                teile = zeile.split("\t")
                if len(teile) < 2:
                    continue
                datei, groesse = teile[0], teile[1]
                rest = teile[2] if len(teile) > 2 else ""
                k = kennung_im_namen(datei, bekannt)
                marke = f"  Kennung={k}" if k else ""
                print(f"    {datei:34s} {groesse:>10s} {rest}{marke}")
                gefunden.add(datei)
                if k:  # gespielt.gast.json -> gespielt.json als Basis merken
                    teile2 = datei.split(".")
                    gefunden.add(".".join(teile2[:-2] + teile2[-1:]))
            fehlt = sorted(bekannt - gefunden)
            if fehlt:
                print("\n    IM QUELLTEXT, ABER NICHT AUF DER BOX (entsteht erst beim ersten Schreiben):")
                for d in fehlt:
                    print(f"      {d}")
    else:
        print("\n  (Box nicht gemessen — mit --box dazunehmen.)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
