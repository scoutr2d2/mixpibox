#!/usr/bin/env python3
"""
WAS DAS KAPPEN ALS ROOT ANFASST — die Zeilen, die bisher keine Probe gesehen hat.

`remove_max_resume.sh` laeuft als root aus dem Takt heraus. Seit dem 07.08.2026
laeuft es ueber JEDEN Kinderordner statt nur ueber den einen alten Ort. Damit
sind drei Zeilen, die vorher genau eine Datei betrafen, zu Zeilen geworden, die
ueber ein ganzes Verzeichnis laufen — und ausgerechnet diese drei stehen in
KEINER Messung:

    /usr/bin/chown dietpi:dietpi "${datei}"     — folgt einem Verweis
    TMP_RESUME="/tmp/.resume.json"              — fester Name, jeder darf dorthin
    touch ${RESUME_LOCK}                        — folgt einem Verweis

WARUM SIE NIEMAND GEMESSEN HAT: `skript_herrichten` in tools/merken-je-kind.py
(und in resume-bruecke-probe.py) biegt das Skript in den Sandkasten und wirft
dabei JEDE Zeile weg, in der „chown" oder „chmod" steht — sonst scheiterte die
Probe daran, dass ein gewoehnlicher Benutzer nicht chownen darf. Das ist fuer
die Nachbarproben richtig und hier das Problem: die weggeworfene Zeile IST die
Frage. Diese Probe wirft sie nicht weg, sondern schiebt einen SCHREIBER davor,
der jeden Aufruf mitschreibt. Und den Pfad, dem `chown` folgt, misst sie
getrennt am Betriebssystem — mit `chgrp`, das ein gewoehnlicher Benutzer auf
seinen eigenen Dateien ausfuehren darf.

    python3 tools/kappen-als-root-linse.py               # alles, gruen/rot
    python3 tools/kappen-als-root-linse.py --nur AB      # nur diese Teile
    python3 tools/kappen-als-root-linse.py --gegenprobe  # wird es rot mit der
                                                         #   Fassung von HEAD?
    python3 tools/kappen-als-root-linse.py --behalten    # Sandkasten stehenlassen

DIE DREI TEILE
  A  DAS EIGENTUM. Eine `resume.json`, die ein VERWEIS auf eine fremde Datei
     ist. Wird `chown` darauf ohne `-h` gerufen — also auf das ZIEL? Dazu der
     Beweis am Betriebssystem, dass „ohne -h" wirklich das Ziel trifft.
  B  DER ZWISCHENSPEICHER. Ein Verweis unter dem festen Namen, den das Skript
     benutzte. Landet der Inhalt einer `resume.json` in einer fremden Datei?
     Und: bleibt die Sperre liegen, wenn sich gar kein Zwischenspeicher
     anlegen laesst?
  C  DIE SPERRE. Ein TOTER Verweis an ihrer Stelle. Legt das Skript die Datei
     am anderen Ende an? Und laeuft es danach trotzdem sauber durch?

NIEMALS GEGEN DIE ECHTE BOX. Alles laeuft in einem Sandkasten unter /tmp; kein
Netz, kein Server, kein SSH. Diese Probe braucht keinen Port — sie misst nur
das Skript.

WAS SIE NICHT KANN: als root laufen. Ob `chown dietpi:dietpi` am Ende wirklich
den Eigentuemer von `/etc/shadow` aendert, ist hier NICHT gemessen und wird es
auch nicht — dafuer muesste die Probe genau den Schaden anrichten, gegen den
sie antritt. Gemessen sind die beiden Haelften, aus denen der Schaden besteht:
dass der Aufruf ohne `-h` erfolgt (Teil A1) und dass ein Aufruf ohne `-h` dem
Verweis folgt (Teil A2).
"""

from __future__ import annotations

import argparse
import grp
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

BAUM = Path(__file__).resolve().parent.parent
SKRIPT = BAUM / "scripts" / "mupibox" / "remove_max_resume.sh"
BOX_KONFIG = "/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config"

# Die Fassung, gegen die die Gegenprobe misst. NICHT `HEAD` als Vorgabe im
# Kopf, sondern hier — aber anders als bei den Nachbarproben ist es hier
# WIRKLICH `HEAD`, und das mit Absicht: die Reparatur, die diese Probe misst,
# ist noch nicht festgeschrieben. `gegen_pruefen` bricht laut ab, sobald der
# Vergleichsstand dieselbe Datei enthaelt wie der Arbeitsbaum — dann waere die
# Gegenprobe der Vergleich einer Fassung mit sich selbst.
GEGEN_VORGABE = "HEAD"

BOX_ZAHL = 6
WERKE = 12

# Die Kennung, an der DIESER Sandkasten zu erkennen ist.
MARKE = "probe-wurzel-a"


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


def art(p: Path) -> str:
    """Verweis, Datei oder nichts — mit `lstat`. Auf einem TOTEN Verweis luegt
    jede gewoehnliche Existenzpruefung."""
    if p.is_symlink():
        return f"Verweis -> {os.readlink(p)}" + ("" if p.exists() else "  (TOT)")
    if p.exists():
        return "echte Datei"
    return "fehlt"


def stellen_liste(n: int) -> list[dict]:
    return [
        {"type": "spotify", "category": "resume", "id": f"w{i}", "index": i, "title": f"Werk {i}"}
        for i in range(n)
    ]


# ── Der Sandkasten ──────────────────────────────────────────────────────────


def sandkasten(tmp: Path, name: str) -> tuple[Path, Path]:
    """Ein Konfigverzeichnis, wie es der Server nach dem Umzug hinterlaesst —
    zwei Kinder, der Gast, und die Bruecke als VERWEIS."""
    wurzel = tmp / name
    konf, tm = wurzel / "config", wurzel / "tmp"
    tm.mkdir(parents=True)
    (konf / "profile").mkdir(parents=True)
    profile = []
    for kennung in (MARKE, "probe-wurzel-b", "gast"):
        (konf / "profile" / kennung).mkdir()
        (konf / "profile" / kennung / "resume.json").write_text(json.dumps(stellen_liste(WERKE)))
        profile.append({"kennung": kennung, "name": kennung.upper(), "figur": "", "angelegt": 1})
    (konf / "profile.json").write_text(json.dumps({"profile": profile, "aktiv": MARKE}, indent=4))
    (konf / "mupiboxconfig.json").write_text(json.dumps({"mupibox": {"resume": BOX_ZAHL}}, indent=4))
    (konf / "resume.json").symlink_to(f"profile/{MARKE}/resume.json")
    return konf, tm


def herrichten(quelle_text: str, konf: Path, tm: Path, schreiber: Path | None) -> Path:
    """Das Skript in den Sandkasten biegen — UND DIE EIGENTUMSZEILE BEHALTEN.

    DER UNTERSCHIED ZU `skript_herrichten` (tools/merken-je-kind.py) IST DER
    GANZE GRUND DIESER PROBE: dort faellt jede Zeile mit „chown" heraus. Hier
    bleibt sie stehen und bekommt einen SCHREIBER vorgesetzt, der Wort fuer
    Wort mitschreibt, womit sie gerufen wurde. Ein gewoehnlicher Benutzer darf
    nicht chownen; gemessen wird deshalb der AUFRUF, nicht seine Wirkung — die
    Wirkung misst Teil A2 getrennt.

    Sonst dieselben vier Eingriffe wie bei den Nachbarproben: die Pfade, die
    $EUID-Wache und das `sudo`. Jede jq-Kette, jedes `cat >` und jedes `touch`
    laeuft im Wortlaut — sonst misst man sein eigenes Umschreiben.
    """
    text = quelle_text
    text = text.replace(BOX_KONFIG, str(konf))
    text = text.replace("/etc/mupibox/mupiboxconfig.json", str(konf / "mupiboxconfig.json"))
    text = text.replace("/tmp/.resume.lock", str(tm / ".resume.lock"))
    # NUR FUER DIE ALTE FASSUNG. Die neue kennt `TMP_DIR` und bekommt das
    # Verzeichnis ueber die Umgebung — ohne eine einzige umgeschriebene Zeile.
    text = text.replace('TMP_RESUME="/tmp/.resume.json"', f'TMP_RESUME="{tm / ".resume.json"}"')
    text = text.replace('if [ "$EUID" -ne 0 ]\n  then echo "Please run as root"\n  exit\nfi', "")
    text = text.replace("sudo /usr/bin/jq", "jq").replace("sudo /usr/bin/", "").replace("sudo ", "")
    if schreiber is not None:
        text = text.replace("/usr/bin/chown", str(schreiber))
    else:
        text = "\n".join(z for z in text.splitlines() if "chown" not in z)
    ziel = tm / "remove_max_resume.sh"
    ziel.write_text(text)
    ziel.chmod(0o755)
    return ziel


def schreiber_bauen(tm: Path) -> tuple[Path, Path]:
    """Ein `chown`, das nichts tut, aber alles mitschreibt."""
    protokoll = tm / "chown-protokoll.txt"
    schreiber = tm / "chown-schreiber.sh"
    schreiber.write_text(
        "#!/bin/bash\n"
        "# Kein echtes chown — ein Zeuge. Eine Zeile je Aufruf, Wort fuer Wort.\n"
        f'printf "%s\\n" "$*" >> "{protokoll}"\n'
        "exit 0\n"
    )
    schreiber.chmod(0o755)
    protokoll.write_text("")
    return schreiber, protokoll


def laufen(skript: Path, tm: Path) -> subprocess.CompletedProcess:
    umg = {**os.environ, "TMP_DIR": str(tm)}
    return subprocess.run(["bash", str(skript)], capture_output=True, text=True, timeout=180, env=umg)


def zaehlen(p: Path) -> int:
    try:
        roh = json.loads(p.read_text())
        return len(roh) if isinstance(roh, list) else -1
    except Exception:  # noqa: BLE001
        return -1


# ── A: das Eigentum ─────────────────────────────────────────────────────────


def teil_a(b: Befund, tmp: Path, text: str) -> None:
    print("\n══ A  DAS EIGENTUM — worauf zeigt `chown`?")
    print("   Eine resume.json, die ein VERWEIS auf eine fremde Datei ist. Sie")
    print("   kommt auf einer gesunden Box nicht vor — aber das Verzeichnis")
    print("   gehoert dietpi, und dieses Skript laeuft als root.\n")
    konf, tm = sandkasten(tmp, "a")
    schreiber, protokoll = schreiber_bauen(tm)

    # Das Opfer liegt AUSSERHALB des Kinderordners — wie /etc/shadow es taete.
    opfer = tmp / "fremde-datei.json"
    opfer.write_text(json.dumps(stellen_liste(WERKE)))
    (konf / "profile" / "mit-verweis").mkdir()
    (konf / "profile" / "mit-verweis" / "resume.json").symlink_to(opfer)

    skript = herrichten(text, konf, tm, schreiber)
    lauf = laufen(skript, tm)
    b.prueft(lauf.returncode == 0, "das Skript endet ohne Fehler", f"code {lauf.returncode} {lauf.stderr[:120]}")

    rufe = [z for z in protokoll.read_text().splitlines() if z.strip()]
    b.prueft(
        len(rufe) >= 3,
        "`chown` wird ueberhaupt gerufen (sonst misst dieser Teil nichts)",
        f"{len(rufe)} Aufrufe: {rufe[:2]}",
    )
    ohne_h = [z for z in rufe if not z.split()[0].startswith("-h")]
    b.prueft(
        not ohne_h,
        "KEIN Aufruf ohne `-h` — dem Verweis wird nicht nachgegangen",
        f"{len(ohne_h)} von {len(rufe)} ohne -h: {ohne_h[:2]}",
    )
    auf_verweis = [z for z in rufe if "mit-verweis" in z]
    b.prueft(
        len(auf_verweis) == 1 and auf_verweis[0].split()[0] == "-h",
        "und der Aufruf AUF DEM VERWEIS trägt `-h`",
        f"{auf_verweis}",
    )

    # Die Reparatur darf nichts anderes veraendern: durch den Verweis wird
    # weiter geschrieben, und der Verweis steht danach noch.
    b.prueft(
        (konf / "profile" / "mit-verweis" / "resume.json").is_symlink(),
        "der Verweis steht danach noch (lstat)",
        art(konf / "profile" / "mit-verweis" / "resume.json"),
    )
    b.prueft(
        zaehlen(opfer) == BOX_ZAHL,
        "und durch ihn hindurch ist gekappt worden — `-h` aendert daran nichts",
        f"{zaehlen(opfer)} Eintraege (Box {BOX_ZAHL})",
    )
    b.prueft(
        zaehlen(konf / "profile" / MARKE / "resume.json") == BOX_ZAHL,
        "die gewoehnlichen Kinder werden weiter gekappt",
        f"{zaehlen(konf / 'profile' / MARKE / 'resume.json')} Eintraege",
    )

    # ── A2: DER BEWEIS AM BETRIEBSSYSTEM ───────────────────────────────────
    #
    # Dass „chown ohne -h" dem Verweis folgt, steht in jeder Anleitung. Diese
    # Probe misst es trotzdem: eine Anleitung ist keine Messung, und die ganze
    # Reparatur haengt daran. Gemessen wird mit `chgrp` — dieselbe Familie,
    # dieselbe `-h`-Regel, und ein gewoehnlicher Benutzer darf es auf seinen
    # eigenen Dateien tun, solange er Mitglied beider Gruppen ist.
    meine = [g for g in os.getgroups() if g != os.getgid()]
    if not meine:
        print("  ??   A2 uebersprungen: dieser Benutzer ist nur in einer Gruppe.")
        return
    andere = meine[0]
    name_andere = grp.getgrgid(andere).gr_name
    ziel = tmp / "chgrp-ziel.txt"
    ziel.write_text("x")
    verweis = tmp / "chgrp-verweis.txt"
    verweis.symlink_to(ziel)
    vorher = ziel.stat().st_gid
    subprocess.run(["chgrp", name_andere, str(verweis)], capture_output=True, text=True)
    nachher_ohne = ziel.stat().st_gid
    b.prueft(
        vorher != nachher_ohne and nachher_ohne == andere,
        f"A2: OHNE `-h` trifft es das ZIEL des Verweises (chgrp {name_andere})",
        f"Gruppe des Ziels: {vorher} -> {nachher_ohne}",
    )
    subprocess.run(["chgrp", "-h", grp.getgrgid(os.getgid()).gr_name, str(verweis)], capture_output=True, text=True)
    b.prueft(
        ziel.stat().st_gid == nachher_ohne and verweis.lstat().st_gid == os.getgid(),
        "A2: MIT `-h` bleibt das Ziel unberuehrt — nur der Verweis wechselt",
        f"Ziel {ziel.stat().st_gid} (unveraendert), Verweis {verweis.lstat().st_gid}",
    )


# ── B: der Zwischenspeicher ─────────────────────────────────────────────────


def teil_b(b: Befund, tmp: Path, text: str) -> None:
    print("\n══ B  DER ZWISCHENSPEICHER — ein fester Name in einem offenen Verzeichnis")
    print("   `/tmp` gehoert allen. Wer den Namen kennt, den root gleich")
    print("   beschreiben wird, legt vorher einen Verweis dorthin.\n")
    konf, tm = sandkasten(tmp, "b")
    schreiber, _ = schreiber_bauen(tm)

    opfer = tmp / "b-opfer.txt"
    inhalt = "DIESE DATEI GEHOERT ROOT UND SOLL SO BLEIBEN\n"
    opfer.write_text(inhalt)
    # Der Name, den das Skript bis zum 07.08.2026 benutzt hat.
    (tm / ".resume.json").symlink_to(opfer)

    skript = herrichten(text, konf, tm, schreiber)
    lauf = laufen(skript, tm)
    b.prueft(lauf.returncode == 0, "das Skript endet ohne Fehler", f"code {lauf.returncode} {lauf.stderr[:120]}")
    b.prueft(
        opfer.read_text() == inhalt,
        "die fremde Datei am Ende des Verweises ist Byte fuer Byte dieselbe",
        f"{len(opfer.read_text())} Bytes (vorher {len(inhalt)}): {opfer.read_text()[:40]!r}",
    )
    b.prueft(
        zaehlen(konf / "profile" / MARKE / "resume.json") == BOX_ZAHL,
        "und gekappt wurde trotzdem",
        f"{zaehlen(konf / 'profile' / MARKE / 'resume.json')} Eintraege",
    )
    reste = sorted(p.name for p in tm.iterdir() if p.name.startswith(".resume.") and not p.is_symlink())
    b.prueft(
        not reste,
        "kein Zwischenspeicher bleibt liegen",
        f"{reste}",
    )

    # ── B2: kein Zwischenspeicher moeglich ─────────────────────────────────
    #
    # DIE FALLE DER REPARATUR SELBST. Wer beim Anlegen aussteigt, darf die
    # Sperre nicht liegenlassen: sie liegt in /tmp, kein Mensch sieht sie, und
    # das Kappen faende nie wieder statt.
    konf2, tm2 = sandkasten(tmp, "b2")
    schreiber2, _ = schreiber_bauen(tm2)
    skript2 = herrichten(text, konf2, tm2, schreiber2)
    eng = tmp / "b2-eng"
    eng.mkdir()
    eng.chmod(0o500)
    umg = {**os.environ, "TMP_DIR": str(eng)}
    lauf2 = subprocess.run(["bash", str(skript2)], capture_output=True, text=True, timeout=180, env=umg)
    eng.chmod(0o700)
    sperre_liegt = (tm2 / ".resume.lock").exists() or (tm2 / ".resume.lock").is_symlink()
    b.prueft(
        not sperre_liegt,
        "B2: laesst sich kein Zwischenspeicher anlegen, bleibt die SPERRE trotzdem nicht liegen",
        f"{art(tm2 / '.resume.lock')}, Ausgabe: {(lauf2.stdout + lauf2.stderr).strip()[-120:]!r}",
    )


# ── C: die Sperre ───────────────────────────────────────────────────────────


def teil_c(b: Befund, tmp: Path, text: str) -> None:
    print("\n══ C  DIE SPERRE — `touch` folgt einem Verweis")
    print("   Ein TOTER Verweis an ihrer Stelle: `[ -f ]` sagt 'frei', und")
    print("   `touch` legt die Datei am anderen Ende an. Als root.\n")
    konf, tm = sandkasten(tmp, "c")
    schreiber, _ = schreiber_bauen(tm)

    opfer = tmp / "c-opfer-gibtsnochnicht.txt"
    (tm / ".resume.lock").symlink_to(opfer)
    b.prueft(not opfer.exists(), "vorher gibt es die fremde Datei nicht", art(opfer))

    skript = herrichten(text, konf, tm, schreiber)
    lauf = laufen(skript, tm)
    b.prueft(
        not opfer.exists(),
        "sie wird auch nicht angelegt — an einem Verweis scheitert das Setzen der Sperre",
        art(opfer),
    )
    b.prueft(
        "locked" in lauf.stdout,
        "stattdessen sagt das Skript, es sei gesperrt",
        f"{lauf.stdout.strip()[:120]!r}",
    )
    b.prueft(
        zaehlen(konf / "profile" / MARKE / "resume.json") == WERKE,
        "und es kappt nichts, solange es sich fuer gesperrt haelt",
        f"{zaehlen(konf / 'profile' / MARKE / 'resume.json')} Eintraege (unveraendert {WERKE})",
    )
    (tm / ".resume.lock").unlink(missing_ok=True)

    # ── C2: der gewoehnliche Lauf ──────────────────────────────────────────
    lauf2 = laufen(skript, tm)
    b.prueft(
        lauf2.returncode == 0 and zaehlen(konf / "profile" / MARKE / "resume.json") == BOX_ZAHL,
        "C2: ohne Verweis laeuft es durch und kappt",
        f"code {lauf2.returncode}, {zaehlen(konf / 'profile' / MARKE / 'resume.json')} Eintraege",
    )
    b.prueft(
        not (tm / ".resume.lock").exists() and not (tm / ".resume.lock").is_symlink(),
        "C2: und die Sperre ist danach wieder weg",
        art(tm / ".resume.lock"),
    )

    # ── C3: eine ECHTE Sperre haelt weiterhin ──────────────────────────────
    (konf / "profile" / MARKE / "resume.json").write_text(json.dumps(stellen_liste(WERKE)))
    (tm / ".resume.lock").write_text("")
    lauf3 = laufen(skript, tm)
    b.prueft(
        zaehlen(konf / "profile" / MARKE / "resume.json") == WERKE,
        "C3: liegt eine echte Sperre, wird nach wie vor nichts gekappt",
        f"{zaehlen(konf / 'profile' / MARKE / 'resume.json')} Eintraege, {lauf3.stdout.strip()[:60]!r}",
    )
    (tm / ".resume.lock").unlink(missing_ok=True)


# ── Die Gegenprobe ──────────────────────────────────────────────────────────


def gegen_text(ref: str) -> str:
    """Das Skript aus einem festgeschriebenen Stand — als Text, ohne den
    Arbeitsbaum anzufassen."""
    lauf = subprocess.run(
        ["git", "show", f"{ref}:scripts/mupibox/remove_max_resume.sh"],
        cwd=str(BAUM),
        capture_output=True,
        text=True,
    )
    if lauf.returncode != 0:
        raise SystemExit(f"Stand {ref} nicht lesbar: {lauf.stderr.strip()}")
    return lauf.stdout


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--nur", default="ABC", help="Teile, z.B. AB")
    p.add_argument("--gegenprobe", action="store_true")
    p.add_argument("--gegen", default=GEGEN_VORGABE)
    p.add_argument("--behalten", action="store_true")
    a = p.parse_args()

    text = SKRIPT.read_text()
    tmp = Path(tempfile.mkdtemp(prefix="kappen-wurzel-"))
    b = Befund()
    print(f"Sandkasten: {tmp}")
    print(f"Skript:     {SKRIPT}")
    try:
        if "A" in a.nur:
            teil_a(b, tmp, text)
        if "B" in a.nur:
            teil_b(b, tmp, text)
        if "C" in a.nur:
            teil_c(b, tmp, text)
    finally:
        if a.behalten:
            print(f"\nSandkasten bleibt: {tmp}")
        else:
            shutil.rmtree(tmp, ignore_errors=True)

    print(f"\n{len(b.zeilen)} Messungen, {b.rote()} rot.")

    if not a.gegenprobe:
        return 1 if b.rote() else 0

    # ── DIE GEGENPROBE ─────────────────────────────────────────────────────
    alt = gegen_text(a.gegen)
    if alt == text:
        raise SystemExit(
            f"Die Gegenprobe misst nichts: {a.gegen} enthaelt dasselbe Skript wie der Arbeitsbaum.\n"
            "Nach dem Festschreiben gehoert hier eine feste Kennung hin (…~1), nicht HEAD."
        )
    print(f"\n══════ DIE GEGENPROBE gegen {a.gegen} ══════")
    print("   Dieselben Messungen gegen die Fassung davor. Sie MUESSEN rot")
    print("   werden — sonst misst diese Probe nichts.\n")
    tmp2 = Path(tempfile.mkdtemp(prefix="kappen-wurzel-alt-"))
    g = Befund()
    try:
        if "A" in a.nur:
            teil_a(g, tmp2, alt)
        if "B" in a.nur:
            teil_b(g, tmp2, alt)
        if "C" in a.nur:
            teil_c(g, tmp2, alt)
    finally:
        shutil.rmtree(tmp2, ignore_errors=True)
    print(f"\nGegenprobe: {len(g.zeilen)} Messungen, {g.rote()} rot.")
    if g.rote() == 0:
        print("ROT: die alte Fassung besteht dieselben Messungen — diese Probe misst nichts.")
        return 1
    print("Gut: die alte Fassung faellt durch.")
    return 1 if b.rote() else 0


if __name__ == "__main__":
    sys.exit(main())
