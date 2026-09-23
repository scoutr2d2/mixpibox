#!/usr/bin/env python3
"""Welche Wege fassen `resume.json` an — und woher naehme jeder das Profil?

WOFUER: E18 Stufe 3 soll `resume.json` je Kind fuehren. Vor dem ersten
Handgriff muss dieselbe Frage an JEDER Stelle beantwortet sein, die die Datei
anfasst — und zwar getrennt nach dem, was der Quelltext sagt, und dem, was die
Box tut. Bei Stufe 2 sind genau diese beiden Antworten auseinandergelaufen
(llmwiki `ablage-besitz-gemessen-e18-stufe2`): der Quelltext kannte
`profile.json`, auf der Box gab es sie nicht.

WARUM EIN WERKZEUG UND KEIN BEFEHL VON HAND: die Zeilennummern der sieben
Stellen wandern bei jeder Aenderung an server.ts. Im Wiki stehen die vom
05.08.2026 — sie waren beim Nachsehen am selben Abend schon um 177 Zeilen
verschoben. Ein Werkzeug, das die Stellen SUCHT statt sie aufzuzaehlen, ist in
vier Wochen noch richtig.

WAS ES BEANTWORTET

  1. QUELLTEXT: welche Stelle liest, welche schreibt, welche nimmt die Sperre —
     und woher naehme sie ein Profil? Gemessen wird nicht „steht das Wort
     profil im Rumpf", sondern welche der drei vorhandenen Quellen benutzt
     wird: `profilAktiv()` (der Server weiss es selbst), `req.query.profil`
     (der Client sagt es) oder GAR KEINE.
  2. OBERFLAECHEN: wer ruft welche Route.
  3. AUSSERHALB DES SERVERS: welche Shell-Skripte haben resume.json und die
     Sperrdatei fest verdrahtet.
  4. AM GERAET (--box): zeigt die Weiterhoeren-Reihe Zeilen, die im Verlauf des
     aktiven Profils GAR NICHT vorkommen? Das ist der Beweis, dass
     `weiterhoerbare()` nicht siebt, sondern nur sortiert — er braucht kein
     zweites Profil, denn eine Zeile mit `zuletzt: 0` ist eine, deren Werk
     dieses Profil nie gestartet hat.
     Dazu: worauf zeigt `active_resume.json` gerade, und antworten die Routen
     auf ein unbekanntes Profil verschieden?

AUFRUF
    python3 tools/resume-wege-schau.py                 # nur Quelltext
    python3 tools/resume-wege-schau.py --box           # dazu die Box
    python3 tools/resume-wege-schau.py --box 192.168.178.169 --benutzer dietpi

LIEST NUR. Es aendert nichts, weder hier noch auf der Box.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
SERVER_TS = WURZEL / "src" / "backend-api" / "src" / "server.ts"
WEITER_TS = WURZEL / "src" / "backend-api" / "src" / "weiterhoeren.ts"
SKRIPTE = WURZEL / "scripts" / "mupibox"
OBERFLAECHEN = [
    WURZEL / "src" / "frontend-box" / "src" / "app",
    WURZEL / "NewDesign",
]

BOX_VORGABE = "192.168.178.169"
BOX_KONFIG = "/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config"

# Die Wege, die resume.json anfassen. Der Schluessel ist das Suchmuster, mit
# dem die Stelle in server.ts GEFUNDEN wird — nicht ihre Zeilennummer.
WEGE = [
    (r"app\.get\('/api/resume'", "GET  /api/resume"),
    (r"async function resumeStellenLesen", "fn   resumeStellenLesen()"),
    (r"async function laneWeiterZeile", "fn   laneWeiterZeile()"),
    (r"app\.get\('/api/weiterhoeren'", "GET  /api/weiterhoeren"),
    (r"app\.post\('/api/weiterhoeren'", "POST /api/weiterhoeren"),
    (r"app\.get\('/api/activeresume'", "GET  /api/activeresume"),
    (r"app\.post\('/api/addresume'", "POST /api/addresume"),
    (r"app\.post\('/api/editresume'", "POST /api/editresume"),
]

# Woran erkannt wird, WOHER eine Stelle ihr Profil naehme.
PROFILQUELLEN = [
    (r"profilAktiv\(\)", "profilAktiv()   — der Server liest selbst, wer dran ist"),
    (r"kzKennungAus\(", "kzKennungAus()  — ?profil= mit Pruefung, sonst das aktive"),
    (r"req\.query\.profil", "req.query.profil — der Client sagt es (nur lesend zulaessig)"),
    (r"req\.body[^\n]*\bprofil\b", "req.body.profil — der Client BEHAUPTET es"),
]

# Was eine Stelle mit der Datei tut.
TATEN = [
    # OHNE DEN RUECKBLICK TRAEFE `resumeFile` AUCH `activeresumeFile` — und
    # `GET /api/activeresume` saehe dann so aus, als lese es die Datei selbst.
    (r"(?<![A-Za-z])resumeFile", "resume.json"),
    (r"activeresumeFile", "active_resume.json (VERWEIS)"),
    (r"resumeStellenLesen\(\)", "ueber resumeStellenLesen()"),
    (r"resumeLock", "/tmp/.resume.lock"),
    (r"fs\.promises\.rename\(zwischen, resumeFile\)|jsonfile\.writeFile\(resumeFile", "SCHREIBT"),
]


def rumpf(zeilen: list[str], start: int) -> tuple[int, str]:
    """Von `start` bis zum naechsten Ding auf Spaltenhoehe null.

    Absichtlich nicht ueber eine Klammerzaehlung: Klammern stehen auch in
    Zeichenketten und Kommentaren, und ein Fehlgriff daran waere still. Der
    naechste `app.`/`function`/`const` am Zeilenanfang ist ein Schnitt, den
    dieser Quelltext seit jeher einhaelt.
    """
    ende = len(zeilen)
    for i in range(start + 1, len(zeilen)):
        if re.match(r"^(app\.|(async )?function |const |let |// ──)", zeilen[i]):
            ende = i
            break
    return ende, "\n".join(zeilen[start:ende])


def quelltext_messen() -> list[dict]:
    text = SERVER_TS.read_text(encoding="utf8")
    zeilen = text.split("\n")
    aus = []
    for muster, name in WEGE:
        treffer = None
        for i, z in enumerate(zeilen):
            if re.search(muster, z):
                treffer = i
                break
        if treffer is None:
            aus.append({"name": name, "zeile": None})
            continue
        ende, koerper = rumpf(zeilen, treffer)
        aus.append(
            {
                "name": name,
                "zeile": treffer + 1,
                "bis": ende,
                "taten": [t for m, t in TATEN if re.search(m, koerper)],
                "profil": [t for m, t in PROFILQUELLEN if re.search(m, koerper)],
            }
        )
    return aus


def weiterhoerbare_messen() -> dict:
    """Was macht `weiterhoerbare()` mit dem Verlauf — sieben oder sortieren?"""
    text = WEITER_TS.read_text(encoding="utf8")
    m = re.search(r"export function weiterhoerbare\((.*?)\n}", text, re.S)
    if not m:
        return {"gefunden": False}
    koerper = m.group(0)
    zeile = text[: m.start()].count("\n") + 1
    return {
        "gefunden": True,
        "zeile": zeile,
        # Der Verlauf taucht GENAU EINMAL auf, und zwar als Zeitquelle.
        "verlauf_verwendungen": re.findall(r"\bverlauf\b|zeiten\.(get|set)", koerper),
        "siebt_ueber_verlauf": bool(re.search(r"if \(!zeiten\.has|zeiten\.has\(", koerper)),
        "sortiert_ueber_verlauf": bool(re.search(r"zeiten\.get\([^)]*\) \?\? 0", koerper)),
        "siebe": re.findall(r"if \(!?([a-zA-Z]+)\(", koerper),
    }


def oberflaechen_messen() -> list[tuple[str, str, int]]:
    aus = []
    muster = re.compile(r"(addresume|editresume|activeresume|/weiterhoeren|/api/resume)")
    for wurzel in OBERFLAECHEN:
        if not wurzel.exists():
            continue
        for pfad in sorted(wurzel.rglob("*")):
            if pfad.suffix not in (".ts", ".js") or ".spec." in pfad.name:
                continue
            try:
                for nr, z in enumerate(pfad.read_text(encoding="utf8").split("\n"), 1):
                    if "getApiBackendUrl()}/" in z or "${API}/" in z:
                        t = muster.search(z)
                        if t:
                            aus.append((str(pfad.relative_to(WURZEL)), t.group(1), nr))
            except (UnicodeDecodeError, OSError):
                continue
    return aus


def skripte_messen() -> list[tuple[str, list[str]]]:
    aus = []
    if not SKRIPTE.exists():
        return aus
    for pfad in sorted(SKRIPTE.glob("*.sh")):
        text = pfad.read_text(encoding="utf8", errors="replace")
        was = []
        if "resume.json" in text:
            was.append("resume.json fest verdrahtet")
        if ".resume.lock" in text:
            was.append("/tmp/.resume.lock")
        if "active_resume.json" in text:
            was.append("active_resume.json (legt den VERWEIS)")
        if "offline_resume.json" in text:
            was.append("offline_resume.json (per jq aus resume.json)")
        if was:
            aus.append((pfad.name, was))
    return aus


def box(ziel: str, benutzer: str, befehl: str) -> str:
    fertig = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", f"{benutzer}@{ziel}", befehl],
        capture_output=True,
        text=True,
        timeout=60,
    )
    return fertig.stdout.strip()


def box_messen(ziel: str, benutzer: str) -> dict:
    aus: dict = {}
    aus["verweis"] = box(ziel, benutzer, f"readlink {BOX_KONFIG}/active_resume.json || echo '(kein Verweis)'")
    aus["verweis_lebt"] = box(
        ziel, benutzer, f"test -f {BOX_KONFIG}/active_resume.json && echo ja || echo NEIN"
    )
    aus["netz"] = box(ziel, benutzer, "jq -r .onlinestate /tmp/network.json 2>/dev/null || echo '?'")
    aus["waechter"] = box(ziel, benutzer, "pgrep -af check_network.sh | head -1 || echo '(laeuft nicht)'")
    aus["profile"] = box(ziel, benutzer, "curl -s http://127.0.0.1:8200/api/profile")
    aus["bereiche"] = box(ziel, benutzer, f"ls {BOX_KONFIG}/profile 2>/dev/null | tr '\\n' ' '")
    aus["resume_n"] = box(ziel, benutzer, "curl -s http://127.0.0.1:8200/api/resume | jq length")
    aus["activeresume_n"] = box(ziel, benutzer, "curl -s http://127.0.0.1:8200/api/activeresume | jq length")
    aus["weiter"] = box(
        ziel,
        benutzer,
        'curl -s "http://127.0.0.1:8200/api/weiterhoeren?max=20" | jq -c "[.weiter[] | {key, zuletzt}]"',
    )
    aus["weiter_mit_profil"] = box(
        ziel,
        benutzer,
        'curl -s "http://127.0.0.1:8200/api/weiterhoeren?max=20&profil=niemand" | jq -c "[.weiter[].key]"',
    )
    aus["weiter_ohne_profil"] = box(
        ziel,
        benutzer,
        'curl -s "http://127.0.0.1:8200/api/weiterhoeren?max=20" | jq -c "[.weiter[].key]"',
    )
    # Wie antworten die Routen, die ein Profil KENNEN, auf ein unbekanntes?
    aus["gespielt_fremd"] = box(
        ziel,
        benutzer,
        'curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:8200/api/gespielt?profil=niemand"',
    )
    aus["kinderzeit_fremd"] = box(
        ziel,
        benutzer,
        'curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:8200/api/kinderzeit/stand?profil=niemand"',
    )
    return aus


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--box", nargs="?", const=BOX_VORGABE, default=None, help="auch am Geraet messen")
    p.add_argument("--benutzer", default="dietpi")
    a = p.parse_args()

    print("── DIE WEGE IM SERVER (server.ts) ──────────────────────────────────")
    wege = quelltext_messen()
    for w in wege:
        if w["zeile"] is None:
            print(f"  {w['name']:26}  NICHT GEFUNDEN — Muster passt nicht mehr")
            continue
        print(f"  {w['name']:26}  Zeile {w['zeile']:>5}")
        print(f"      tut:    {', '.join(w['taten']) or '(nichts erkannt)'}")
        if w["profil"]:
            for q in w["profil"]:
                print(f"      Profil: {q}")
        else:
            print("      Profil: KEINE QUELLE — die Stelle kennt kein Profil")

    print()
    print("── weiterhoerbare() (weiterhoeren.ts) ──────────────────────────────")
    wh = weiterhoerbare_messen()
    if not wh["gefunden"]:
        print("  NICHT GEFUNDEN")
    else:
        print(f"  Zeile {wh['zeile']}")
        print(f"  siebt ueber den Verlauf:    {'JA' if wh['siebt_ueber_verlauf'] else 'NEIN'}")
        print(f"  sortiert ueber den Verlauf: {'JA' if wh['sortiert_ueber_verlauf'] else 'NEIN'}")
        print(f"  die Siebe im Rumpf:         {', '.join(sorted(set(wh['siebe']))) or '(keine)'}")

    print()
    print("── WER DIE ROUTEN RUFT ─────────────────────────────────────────────")
    for datei, route, nr in oberflaechen_messen():
        print(f"  {route:16} {datei}:{nr}")

    print()
    print("── AUSSERHALB DES SERVERS (scripts/mupibox) ────────────────────────")
    for name, was in skripte_messen():
        print(f"  {name:24} {'; '.join(was)}")

    if a.box:
        print()
        print(f"── AM GERAET ({a.box}) ─────────────────────────────────────")
        try:
            b = box_messen(a.box, a.benutzer)
        except (subprocess.TimeoutExpired, OSError) as e:
            print(f"  NICHT GEMESSEN: {e}")
            return 1
        print(f"  active_resume.json -> {b['verweis']}")
        print(f"  Verweis lebt:         {b['verweis_lebt']}")
        print(f"  Netzlage:             {b['netz']}")
        print(f"  Netzwaechter:         {b['waechter']}")
        print(f"  Profile:              {b['profile']}")
        print(f"  Bereiche auf Platte:  {b['bereiche'] or '(keine)'}")
        print(f"  /api/resume:          {b['resume_n']} Eintraege")
        print(f"  /api/activeresume:    {b['activeresume_n']} Eintraege")
        print()
        print("  DIE PROBE OHNE ZWEITES PROFIL — Zeilen, die dem aktiven Profil")
        print("  nicht gehoeren, stehen trotzdem in der Reihe:")
        try:
            zeilen = json.loads(b["weiter"])
        except (json.JSONDecodeError, TypeError):
            zeilen = []
        fremd = [z for z in zeilen if not z.get("zuletzt")]
        for z in zeilen:
            marke = "  <- NIE VON DIESEM PROFIL GESTARTET" if not z.get("zuletzt") else ""
            print(f"    {z.get('key','?'):42} zuletzt={z.get('zuletzt')}{marke}")
        print(f"  {len(fremd)} von {len(zeilen)} Zeilen haben KEINEN Verlaufseintrag.")
        print()
        gleich = b["weiter_mit_profil"] == b["weiter_ohne_profil"]
        print(f"  ?profil= aendert die Reihe: {'NEIN — wird stillschweigend verworfen' if gleich else 'JA'}")
        print(f"  unbekanntes Profil an /api/gespielt:         HTTP {b['gespielt_fremd']}")
        print(f"  unbekanntes Profil an /api/kinderzeit/stand: HTTP {b['kinderzeit_fremd']}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
