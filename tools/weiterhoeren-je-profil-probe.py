#!/usr/bin/env python3
"""Haelt „Weiterhoeren gilt je Profil" an der ECHTEN Box? — nur lesend.

WOZU DIESES WERKZEUG: Die Behauptung „`profile/<kennung>/resume.json`, am alten
Ort steht nur noch ein Verweis" laesst sich mit zwei Befehlen (`readlink -f`,
`jq length`) scheinbar belegen — und genau diese zwei Befehle sehen NICHT nach,
ob der Verweis auch dann noch haelt, wenn ein Skript darueber geschrieben hat.
Die Trennung liegt nicht in den Dateien, sondern in der REIHENFOLGE beim
Profilwechsel. Also prueft dieses Werkzeug beides:

  A  Die Ablage       — liegt je Kind eine eigene Liste, und stehen darin
                        WIRKLICH verschiedene Staende (oder nur Kopien)?
  B  Die Bruecke      — ist der alte Ort ein Verweis, und wohin zeigt er?
  C  Die Schreiber    — welche der ausgelieferten root-Skripte ersetzen den
                        Verweis per `mv` durch eine echte Datei?
  D  Die Reihenfolge  — setzt der LAUFENDE Server beim Wechsel erst `aktiv`
                        und richtet DANACH die Bruecke? Dann uebernimmt er den
                        Stand des VORIGEN Kindes in den Bereich des neuen.
  E  Offline          — `offline_resume.json` ist box-weit, kein Bereich.

NICHTS WIRD GESCHRIEBEN: nur ssh mit ls/cat/jq/grep und curl GET.

Aufruf:  python3 tools/weiterhoeren-je-profil-probe.py [--box 192.168.178.169]
"""

import argparse
import json
import shlex
import subprocess
import sys

CONFIG = "/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config"
APP = "/home/dietpi/.mupibox/Sonos-Kids-Controller-master"
SKRIPTE = "/usr/local/bin/mupibox"

# Die Felder, die eine gemerkte STELLE ausmachen. Nur sie entscheiden, ob zwei
# Listen wirklich verschiedene Staende tragen oder bloss dieselbe Kopie.
STELLENFELDER = (
    "resumespotifytrack_number",
    "resumespotifyprogress_ms",
    "resumespotifyduration_ms",
    "resumelocalcurrentTracknr",
    "resumelocalprogressTime",
    "resumerssprogressTime",
    "resumeardfolge",
)


def ssh(box: str, befehl: str) -> str:
    fertig = subprocess.run(
        ["ssh", "-o", "ConnectTimeout=15", f"dietpi@{box}", befehl],
        capture_output=True,
        text=True,
    )
    return fertig.stdout


def hole(box: str, pfad: str) -> str:
    return ssh(box, f"cat {shlex.quote(pfad)} 2>/dev/null")


def werkschluessel(e: dict) -> str:
    kennung = (
        e.get("id")
        or e.get("playlistid")
        or e.get("showid")
        or e.get("audiobookid")
        or e.get("query")
        or "-"
    )
    return f"{e.get('type', '?')}:{kennung}"


def stelle(e: dict) -> tuple:
    return tuple(e.get(f) for f in STELLENFELDER)


def erreichbar(box: str) -> bool:
    """Steht die Box ueberhaupt? EINMAL, vor jeder Messung.

    WARUM (24.08.2026): `ssh` scheitert leise, `hole` gibt leeren Text, und
    Abschnitt B liest das als „der alte Ort ist GERADE eine echte Datei".
    An der abgeschalteten Box lief die Probe bis zum Schluss durch und
    schrieb „gilt je Profil ist NICHT dicht" — ein Urteil ueber einen
    Dateibaum, den sie nie gesehen hat.
    """
    r = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8",
         f"dietpi@{box}", "echo da"],
        capture_output=True, text=True, timeout=20,
    )
    return r.stdout.strip() == "da"


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--box", default="192.168.178.169")
    a = p.parse_args()
    box = a.box
    urteil: list[str] = []

    if not erreichbar(box):
        print(f"ABBRUCH: {box} antwortet nicht auf ssh — es wurde NICHTS gemessen.")
        print("Kein Urteil. Box einschalten und erneut laufen lassen.")
        return 2

    # ── A: die Ablage je Kind ────────────────────────────────────────────────
    stand = json.loads(hole(box, f"{CONFIG}/profile.json") or "{}")
    aktiv = stand.get("aktiv", "?")
    kennungen = [k["kennung"] for k in stand.get("profile", [])]
    print(f"A  aktiv: {aktiv}   Profile: {', '.join(kennungen) or '(keine)'}")

    listen: dict[str, list] = {}
    for k in kennungen:
        roh = hole(box, f"{CONFIG}/profile/{k}/resume.json")
        try:
            listen[k] = json.loads(roh) if roh.strip() else []
        except json.JSONDecodeError:
            listen[k] = []
        print(f"   profile/{k}/resume.json: {len(listen[k])} Eintraege")

    # Sind die Staende ECHT verschieden? Gleiches Werk, gleiche Stelle in zwei
    # Bereichen heisst: irgendwann hat einer den Stand des anderen bekommen.
    if len(listen) >= 2:
        a_k, b_k = kennungen[0], kennungen[1]
        A = {werkschluessel(e): stelle(e) for e in listen[a_k]}
        B = {werkschluessel(e): stelle(e) for e in listen[b_k]}
        gemeinsam = sorted(set(A) & set(B))
        gleich = [s for s in gemeinsam if A[s] == B[s]]
        print(
            f"   gemeinsame Werke {a_k}/{b_k}: {len(gemeinsam)}, "
            f"davon STELLENGLEICH: {len(gleich)}"
        )
        for s in gleich:
            print(f"     ! {s} — identische Stelle in beiden Bereichen")

    # ── B: die Bruecke am alten Ort ─────────────────────────────────────────
    zeile = ssh(box, f"ls -l {CONFIG}/resume.json").strip()
    ist_verweis = zeile.startswith("l")
    print(f"\nB  alter Ort: {'VERWEIS' if ist_verweis else 'ECHTE DATEI'} — {zeile[-60:]}")
    if not ist_verweis:
        urteil.append(
            "Der alte Ort ist GERADE eine echte Datei — der naechste Profilwechsel "
            "zieht ihren Inhalt in den Bereich des NEUEN Kindes."
        )

    # ── C: wer ersetzt den Verweis? ─────────────────────────────────────────
    print("\nC  ausgelieferte root-Skripte am alten Ort:")
    for name in ("clearresume.sh", "remove_max_resume.sh"):
        text = hole(box, f"{SKRIPTE}/{name}")
        # `mv … ${RESUME}` bzw. `${DATA}` auf den alten Ort = Bruecke gekappt.
        treffer = [
            z.strip()
            for z in text.splitlines()
            if "mv " in z and not z.lstrip().startswith("#")
        ]
        if treffer:
            print(f"   {name}: KAPPT die Bruecke -> {treffer[0]}")
            urteil.append(
                f"{name} (ausgeliefert) schreibt mit `mv` UEBER den alten Ort; "
                "danach ist er eine echte Datei."
            )
        else:
            print(f"   {name}: schreibt DURCH den Verweis (kein mv)")

    # ── D: die Reihenfolge im LAUFENDEN Server ──────────────────────────────
    # Im Bundle heisst `resumeBrueckeRichten` anders; erkennbar ist sie an der
    # Meldung, die `resumeUebernehmen` schreibt. Gesucht wird der Rumpf von
    # POST /api/profil/aktiv: steht dort `aktiv:` VOR den beiden Aufrufen?
    rumpf = ssh(
        box,
        "grep -o '/api/profil/aktiv.\\{0,420\\}' " + f"{APP}/server.js | head -1",
    ).strip()
    vor = rumpf.find("aktiv:")
    # Die zwei Aufrufe stehen unmittelbar hinter dem Setzen (…,Pt=0,xc(),yc()).
    nach = rumpf.find("()", vor) if vor >= 0 else -1
    print("\nD  POST /api/profil/aktiv im laufenden Bundle:")
    print(f"   {rumpf[:200]}")
    if vor >= 0 and 0 <= nach:
        print("   -> `aktiv` wird ZUERST gesetzt, die Bruecke DANACH gerichtet.")
        urteil.append(
            "Der Wechsel setzt `aktiv` vor dem Richten der Bruecke — die "
            "Uebernahme einer echten Datei am alten Ort zielt damit auf das "
            "NEUE Kind."
        )

    # ── E: offline ──────────────────────────────────────────────────────────
    off = hole(box, f"{CONFIG}/offline_resume.json").strip()
    aktiv_verweis = ssh(box, f"ls -l {CONFIG}/active_resume.json").strip()
    print(f"\nE  offline_resume.json (box-weit, kein Bereich): {off[:60] or '(fehlt)'}")
    print(f"   active_resume.json -> {aktiv_verweis[-70:]}")

    print("\n── URTEIL ──────────────────────────────────────────────────────")
    if urteil:
        for s in urteil:
            print(f" * {s}")
        print("\n=> „gilt je Profil" + "“ ist NICHT dicht.")
        return 1
    print(" keine der gepruefte Nahtstellen offen.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
