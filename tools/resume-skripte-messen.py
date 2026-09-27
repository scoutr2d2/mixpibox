#!/usr/bin/env python3
"""Was die vier Shell-Skripte mit resume.json tun — gemessen, nicht erinnert.

WARUM ES DIESES WERKZEUG GIBT. E18 Stufe 3 zieht `resume.json` in
`server/config/profile/<kennung>/`. Vier Shell-Skripte kennen den ALTEN Pfad
absolut fest verdrahtet, und keines davon weiss etwas vom Server. Die Frage
„was passiert dann?" wurde bisher am Quelltext BEANTWORTET — und die Antwort
war an zwei entscheidenden Stellen falsch:

  * „check_network.sh legt den Verweis alle zehn Sekunden neu an."  NEIN. Der
    Verweis wird nur bei einem ZUSTANDSWECHSEL angefasst (Abschnitt TAKT).
  * „Dann zeigt active_resume.json ins Leere und /api/activeresume liefert []."
    NEIN, das waere der harmlose Fall. Gemessen passiert etwas Schlimmeres:
    get_network.sh legt binnen 20 s eine LEERE resume.json am alten Ort NEU an,
    der Verweis LEBT wieder, jede Existenzpruefung sagt „in Ordnung" — und
    offline_resume.json wird aus der leeren Datei ueberschrieben und ist weg
    (Abschnitt SANDKASTEN).

Das Werkzeug misst drei Dinge und mischt sie nie:

  QUELLTEXT   welche Zeile welcher Datei welche der drei Resume-Dateien
              anfasst, und unter welcher Bedingung.
  GERAET      wer die Skripte startet (Unit/Zeitgeber/PID), wohin der Verweis
              zeigt, und OB die Fassung auf der Box die aus dem Baum ist.
              Zustandsaussagen haben Haltbarkeit — darum hier und nicht im Wiki.
  SANDKASTEN  fuehrt get_network.sh mit umgebogenen Pfaden auf einer Kopie aus
              und zeigt, was der Umzug wirklich anrichtet. Fasst die Box NICHT
              an.

AUFRUF
    python3 tools/resume-skripte-messen.py                 # alles
    python3 tools/resume-skripte-messen.py --quelltext
    python3 tools/resume-skripte-messen.py --geraet [--box 192.168.178.169]
    python3 tools/resume-skripte-messen.py --sandkasten    # braucht --box fuer echten Bestand
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

BAUM = Path(__file__).resolve().parent.parent
SKRIPTE = ["check_network.sh", "get_network.sh", "clearresume.sh", "remove_max_resume.sh"]
BOX_ABLAGE = "/usr/local/bin/mupibox"
BOX_KONFIG = "/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config"

# Die drei Dateien, um die es geht. Der Verweis ist die gefaehrlichste:
# er zeigt auf einen PFAD, nicht auf einen Inhalt.
DATEIEN = {
    "RESUME_FILE": "resume.json          (die Stelle selbst — zieht in Stufe 3 um)",
    "ACTIVERESUME_FILE": "active_resume.json   (VERWEIS auf eine der beiden anderen)",
    "OFFLINERESUME_FILE": "offline_resume.json  (per jq aus resume.json erzeugt)",
}


def lauf(befehl: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(befehl, capture_output=True, text=True, **kw)


def ssh(box: str, befehl: str) -> tuple[int, str]:
    e = lauf(["ssh", "-o", "ConnectTimeout=8", "-o", "BatchMode=yes", f"dietpi@{box}", befehl])
    return e.returncode, (e.stdout + e.stderr).strip()


# ══════════════════════════════════════════════════════════════ QUELLTEXT ════


def quelltext(verzeichnis: Path, ueberschrift: str) -> None:
    print(f"══ QUELLTEXT — {ueberschrift}")
    for name in SKRIPTE:
        pfad = verzeichnis / name
        if not pfad.is_file():
            print(f"\n  {name}: FEHLT unter {verzeichnis}")
            continue
        zeilen = pfad.read_text(errors="replace").splitlines()
        treffer = []
        # LAENGSTE ZUERST. `RESUME_FILE` ist ein Teilstring von
        # `ACTIVERESUME_FILE` und `OFFLINERESUME_FILE` — wer der Reihe nach
        # sucht, schreibt jede Verweiszeile faelschlich der Stelle selbst zu
        # und liest dann aus der eigenen Messung heraus, resume.json werde
        # dauernd verlinkt. Genau dieser Lesefehler steckte im Auftrag.
        namen = sorted(DATEIEN, key=len, reverse=True)
        for nr, z in enumerate(zeilen, 1):
            if z.lstrip().startswith("#"):
                continue
            for var in namen:
                if var not in z:
                    continue
                if re.match(rf"\s*{var}=", z):  # Zuweisung, keine Benutzung
                    break
                treffer.append((nr, var, z.strip()))
                break
        print(f"\n  ── {name}  ({len(zeilen)} Zeilen)")
        if not treffer:
            print("     fasst KEINE der drei Dateien an")
            continue
        for nr, var, z in treffer:
            was = {"ln -s": "legt den VERWEIS an", "rm ": "entfernt", "> $": "SCHREIBT",
                   ">> $": "haengt an", "jq ": "erzeugt per jq", "stat ": "vergleicht Alter",
                   "chown": "chown"}
            marke = next((v for k, v in was.items() if k in z), "")
            kurz = z if len(z) <= 96 else z[:93] + "..."
            print(f"     {nr:>4}  {var:<19} {kurz}")
            if marke:
                print(f"           {'':19} -> {marke}")
    print()


def takt() -> None:
    """Der Punkt, an dem die Auftragsbeschreibung falsch lag."""
    pfad = BAUM / "scripts/mupibox/check_network.sh"
    text = pfad.read_text(errors="replace")
    print("══ TAKT — wie oft wird der Verweis wirklich angefasst?")
    hat_wechsel = 'if [ "${ONLINESTATE}" != "${OLDSTATE}" ]' in text
    setzt_alt = re.search(r"^\s*OLDSTATE=\$\{ONLINESTATE\}", text, re.M) is not None
    liest_alt_einmal = text.count("OLD_ONLINESTATE=$(") == 1
    print(f"  Der Verweis-Block steht hinter `ONLINESTATE != OLDSTATE`   : {'ja' if hat_wechsel else 'NEIN'}")
    print(f"  OLDSTATE wird am Schleifenende nachgezogen                 : {'ja' if setzt_alt else 'NEIN'}")
    print("  => der Verweis wird NUR BEI EINEM ZUSTANDSWECHSEL angefasst,")
    print("     nicht alle zehn Sekunden. `sleep 10` ist der Takt der PRUEFUNG.")
    print()
    print(f"  OLD_ONLINESTATE wird genau EINMAL gelesen (vor der Schleife): {'ja' if liest_alt_einmal else 'NEIN'}")
    print("  => es ist eine MOMENTAUFNAHME vom Start und altert nie nach.")
    print("     Folge (Fall B unten): stand beim Start `online` in /tmp/network.json,")
    print("     wird die RUECKKEHR aus offline nach online NICHT nachgezogen —")
    print("     active_resume.json bleibt auf offline_resume.json stehen.")
    print()
    for beschriftung, alt, verlauf in [
        ("A) Neustart der Box (/tmp ist tmpfs, network.json fehlt -> leer)", "", "an an an aus aus an an"),
        ("B) systemctl restart ohne Neustart (network.json ueberlebt: online)", "online", "an an aus aus an an an"),
    ]:
        print(f"  {beschriftung}")
        for zeile in _takt_spielen(alt, verlauf.split()):
            print(f"     {zeile}")
        print()
    _vergleich_ist_keiner()


def _vergleich_ist_keiner() -> None:
    """Die Mine fuer den, der check_network.py „aufraeumt".

    Im Skript steht  `if ( $(check_network.py) == ${TRUESTATE} ); then`.
    Das sieht aus wie ein Vergleich mit "online" — es ist keiner. Die Klammern
    sind eine SUBSHELL, und darin wird die Ausgabe der Python-Datei als
    KOMMANDO ausgefuehrt; `==` und `online` sind bloss seine Argumente.
    Richtig herum faellt es nur aus, weil check_network.py `true`/`false`
    ausgibt — und das sind zwei Kommandos mit genau den passenden
    Rueckgabewerten.
    """
    print("══ DER VERGLEICH, DER KEINER IST")
    py = BAUM / "scripts/mupibox/check_network.py"
    ausgaben = re.findall(r'print\("(\w+)"\)', py.read_text(errors="replace")) if py.is_file() else []
    print(f"  check_network.py gibt aus: {sorted(set(ausgaben)) or '(nicht gefunden)'}")
    for wert in ("online", "quatsch"):
        zeile = "; ".join(
            f'{a}:{"ONLINE" if lauf(["bash", "-c", f"if ( {a} == {wert} ) 2>/dev/null; then exit 0; else exit 1; fi"]).returncode == 0 else "OFFLINE"}'
            for a in ("true", "false")
        )
        print(f"  mit TRUESTATE={wert:<8} -> {zeile}")
    print("  => beide Zeilen gleich: der Vergleichswert ist WIRKUNGSLOS.")
    print("     WER check_network.py AUF `online`/`offline` UMSTELLT — was wie")
    print("     die offensichtliche Absicht aussieht —, macht die Box DAUERHAFT")
    print("     OFFLINE: `online` ist kein Kommando, Rueckgabe 127, immer der")
    print("     else-Zweig. active_resume.json zeigte dann fuer immer auf")
    print("     offline_resume.json.")
    print()


def _takt_spielen(old_onlinestate: str, verlauf: list[str]) -> list[str]:
    """Nur die Zustandslogik aus check_network.sh, nachgebaut."""
    oldstate, lebt, aus = "starting", False, []
    for i, netz in enumerate(verlauf, 1):
        zustand = "online" if netz == "an" else "offline"
        tat = "—"
        if zustand != oldstate:
            ziel = "resume.json" if zustand == "online" else "offline_resume.json"
            if not lebt:
                tat = f"ln -s {ziel}"
            elif old_onlinestate != zustand:
                tat = f"rm + ln -s {ziel}"
            else:
                tat = f"NICHTS  <-- OLD_ONLINESTATE ist noch '{old_onlinestate}'"
            lebt = True
        aus.append(f"Runde {i} ({i*10:>3}s)  Netz {netz:<4}  {zustand:<8}  am Verweis: {tat}")
        oldstate = zustand
    return aus


# ═════════════════════════════════════════════════════════════════ GERAET ════


def geraet(box: str) -> None:
    print(f"══ GERAET — {box} (Zustandsaussagen; sie haben Haltbarkeit)")
    rc, _ = ssh(box, "true")
    if rc != 0:
        print("  Box nicht erreichbar — kein Befund, KEINE Annahme.\n")
        return

    print("\n  ── Wer startet die Skripte")
    _, units = ssh(box, "grep -rl 'check_network.sh\\|get_network.sh\\|clearresume.sh\\|remove_max_resume.sh"
                        "\\|mupibox-network-sync' /etc/systemd/system 2>/dev/null")
    for u in [z for z in units.splitlines() if z.strip()]:
        name = os.path.basename(u)
        _, akt = ssh(box, f"systemctl is-active {name} 2>&1; systemctl is-enabled {name} 2>&1")
        print(f"     {name:<32} {' / '.join(akt.split())}")
    _, timer = ssh(box, "systemctl list-timers --all --no-pager 2>/dev/null | grep -i mupi-network || true")
    if timer:
        print(f"     Zeitgeber: {timer.splitlines()[0].strip()}")
    _, intervall = ssh(box, "grep -h 'OnUnitActiveSec\\|OnBootSec' /etc/systemd/system/mupi-network-info.timer 2>/dev/null")
    for z in intervall.splitlines():
        print(f"     mupi-network-info.timer  {z.strip()}")
    _, cron = ssh(box, "crontab -l 2>/dev/null; sudo -n crontab -l 2>/dev/null")
    treffer = [z for z in cron.splitlines() if any(s.split(".")[0] in z for s in SKRIPTE)]
    print(f"     Crontab: {'; '.join(treffer) if treffer else 'kein Eintrag (dietpi und root leer)'}")

    print("\n  ── Was gerade laeuft")
    _, ps = ssh(box, "ps -eo pid,etime,cmd | grep -E 'check_network|get_network' | grep -v grep || true")
    print("     " + ("\n     ".join(ps.splitlines()) if ps else "kein Dauerlaeufer"))

    print("\n  ── Der Verweis")
    _, v = ssh(box, f"cd {BOX_KONFIG} && for f in active_resume.json active_data.json; do "
                    f"printf '%s -> %s   (Ziel da: %s, Verweis-mtime %s)\\n' $f \"$(readlink $f)\" "
                    f"\"$([ -f $f ] && echo ja || echo NEIN)\" \"$(stat -c%y $f | cut -d. -f1)\"; done")
    for z in v.splitlines():
        print(f"     {z}")
    _, groessen = ssh(box, f"cd {BOX_KONFIG} && for f in resume.json offline_resume.json; do "
                           f"printf '%s  %s Eintraege  %s B\\n' $f \"$(jq length $f 2>/dev/null)\" \"$(stat -c%s $f)\"; done; "
                           f"jq -r .onlinestate /tmp/network.json 2>/dev/null | sed 's/^/onlinestate /'")
    for z in groessen.splitlines():
        print(f"     {z}")

    print("\n  ── Faehrt die Box die Fassung aus dem Baum?")
    _, summen = ssh(box, f"md5sum {BOX_ABLAGE}/{{{','.join(s[:-3] for s in SKRIPTE)}}}.sh 2>/dev/null")
    aufbox = {os.path.basename(t[1]): t[0] for t in (z.split() for z in summen.splitlines()) if len(t) == 2}
    for name in SKRIPTE:
        p = BAUM / "scripts/mupibox" / name
        eigen = lauf(["md5sum", str(p)]).stdout.split()[0] if p.is_file() else "?"
        dort = aufbox.get(name, "fehlt")
        gleich = "gleich" if eigen == dort else "ANDERS — der Baum ist NICHT ausgeliefert"
        print(f"     {name:<24} Baum {eigen[:8]}  Box {dort[:8]}   {gleich}")
    print()


# ═════════════════════════════════════════════════════════════ SANDKASTEN ════


def sandkasten(box: str | None) -> None:
    """get_network.sh WIRKLICH ausfuehren, mit umgebogenen Pfaden, auf einer Kopie."""
    print("══ SANDKASTEN — der Umzug, vorgespielt (die Box wird nicht angefasst)")
    tmp = Path(tempfile.mkdtemp(prefix="resume-umzug-"))
    konf, tm = tmp / "config", tmp / "tmp"
    (konf / "profile" / "gast").mkdir(parents=True)
    tm.mkdir()

    geholt = False
    if box:
        for f in ("resume.json", "offline_resume.json", "data.json", "offline_data.json"):
            if lauf(["scp", "-q", f"dietpi@{box}:{BOX_KONFIG}/{f}", str(konf / f)]).returncode == 0:
                geholt = True
    if not geholt:
        print("  (kein echter Bestand von der Box — Attrappe mit den ECHTEN Feldnamen)")
        (konf / "resume.json").write_text(json.dumps([
            {"type": "spotify", "category": "resume", "id": "a", "title": "Bibi",
             "resumespotifytrack_number": 3, "resumespotifyprogress_ms": 1000,
             "resumespotifyduration_ms": 9000},
            {"type": "library", "category": "resume", "id": "b", "title": "Aufnahme",
             "resumespotifytrack_number": 1, "resumespotifyprogress_ms": 500,
             "resumespotifyduration_ms": 9000},
        ]))
        (konf / "offline_resume.json").write_text('[{"type":"library","category":"resume","id":"b","title":"Aufnahme"}]')
        (konf / "data.json").write_text("[]")
        (konf / "offline_data.json").write_text("[]")

    quelle = (BAUM / "scripts/mupibox/get_network.sh").read_text()
    quelle = quelle.replace(BOX_KONFIG, str(konf))
    quelle = quelle.replace("/tmp/network.json", str(tm / "network.json"))
    quelle = quelle.replace("/tmp/.data.lock", str(tm / ".data.lock"))
    quelle = quelle.replace("/tmp/.resume.lock", str(tm / ".resume.lock"))
    # Der Netzteil (ip/iw/iwconfig/hostname + die jq-Kette darauf) gehoert nicht
    # zur Frage und braucht sudo. Alles ab `GW=` faellt weg.
    quelle = quelle.split("\nGW=")[0] + "\n"
    nachbau = tmp / "get_network.sh"
    nachbau.write_text(quelle)
    nachbau.chmod(0o755)
    (tm / "network.json").write_text('{"onlinestate":"online"}')
    (konf / "active_resume.json").symlink_to(konf / "resume.json")

    def zaehle(p: Path) -> str:
        if not p.exists():
            return "fehlt"
        try:
            return f"{len(json.loads(p.read_text()))} Eintraege, {p.stat().st_size} B"
        except Exception:
            return f"unlesbar, {p.stat().st_size} B"

    def stand(titel: str) -> None:
        vw = konf / "active_resume.json"
        lebt = "ja" if vw.exists() else "NEIN (toter Verweis)"
        print(f"  {titel}")
        print(f"     resume.json (alter Ort)        {zaehle(konf / 'resume.json')}")
        print(f"     profile/gast/resume.json       {zaehle(konf / 'profile/gast/resume.json')}")
        print(f"     offline_resume.json            {zaehle(konf / 'offline_resume.json')}")
        print(f"     active_resume.json             lebt: {lebt}  -> {os.path.basename(os.readlink(vw))}")

    stand("── VORHER")
    shutil.move(str(konf / "resume.json"), str(konf / "profile/gast/resume.json"))
    print("\n  ── DER UMZUG: resume.json nach profile/gast/")
    stand("     unmittelbar danach")

    print("\n  ── EIN Lauf von get_network.sh (der Zeitgeber ruft es alle 20 s)")
    lauf(["bash", str(nachbau)])
    stand("── NACHHER")

    print("""
  DER BEFUND, und er ist schlimmer als „der Verweis zeigt ins Leere":
    1. resume.json ist am ALTEN Ort WIEDER DA — leer. get_network.sh legt sie
       an (`if [ ! -f ${RESUME_FILE} ]` -> `echo -n "[]"`), weil sie fehlt.
    2. offline_resume.json wurde daraus NEU GESCHRIEBEN und ist damit WEG.
       Sie ist die einzige Datei hier, die sich nicht wiederherstellen laesst:
       ihre Quelle liegt jetzt woanders.
    3. Der Verweis LEBT wieder — auf die leere Datei. Die Existenzpruefung in
       `GET /api/activeresume` (`fs.existsSync(activeresumeFile)`) sagt dann
       „in Ordnung". Es gibt keinen Fehler, keinen Protokolleintrag, keine
       404: nur eine Box, die nichts mehr fortsetzt.
    Ein Vorbeugen, das nur den toten Verweis behandelt, greift also daneben.

    ZEILENNUMMERN STEHEN HIER ABSICHTLICH KEINE. An server.ts arbeiten
    mehrere gleichzeitig; die Nummern aus der Aufgabenstellung waren beim
    Messen am 05.08.2026 schon rund 180 Zeilen daneben. Wer sie braucht:
        grep -n 'api/activeresume\\|api/resume\\|resumeStellenLesen' \\
             src/backend-api/src/server.ts""")

    print(f"\n  (Sandkasten bleibt zum Nachsehen stehen: {tmp})\n")


def dangling() -> None:
    print("══ DER TOTE VERWEIS — warum das Skript ihn nie repariert")
    tmp = Path(tempfile.mkdtemp(prefix="resume-verweis-"))
    ziel, vw = tmp / "resume.json", tmp / "active_resume.json"
    ziel.write_text("[]")
    vw.symlink_to(ziel)
    print(f"  lebender Verweis:  -f -> {'wahr' if vw.exists() else 'falsch'}")
    ziel.rename(tmp / "weg.json")
    print(f"  toter Verweis:     -f -> {'wahr' if vw.exists() else 'falsch'}"
          f"   (-e {'wahr' if vw.exists() else 'falsch'}, -L {'wahr' if vw.is_symlink() else 'falsch'})")
    print("  => das Skript nimmt den Zweig `[ ! -f ]` und ruft `ln -s` OHNE -f:")
    e = lauf(["ln", "-s", str(ziel), str(vw)])
    print(f"     ln -s Rueckgabe {e.returncode}: {e.stderr.strip()}")
    print("  => der Zweig, der reparieren soll, KANN NICHT reparieren. Nur der")
    print("     elif-Zweig hat `rm` davor — und der wird bei totem Verweis nie")
    print("     erreicht. Ein einmal toter Verweis bleibt tot, bis jemand von")
    print("     Hand loescht. (Greift nur, wenn nichts die Datei neu anlegt —")
    print("     auf der Box tut get_network.sh genau das, siehe SANDKASTEN.)")
    shutil.rmtree(tmp, ignore_errors=True)
    print()


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--box", default="192.168.178.169")
    p.add_argument("--quelltext", action="store_true")
    p.add_argument("--geraet", action="store_true")
    p.add_argument("--sandkasten", action="store_true")
    a = p.parse_args()
    alles = not (a.quelltext or a.geraet or a.sandkasten)

    if alles or a.quelltext:
        quelltext(BAUM / "scripts/mupibox", "scripts/mupibox/ im Baum")
        takt()
    if alles or a.sandkasten:
        dangling()
        sandkasten(a.box if (alles or a.geraet or a.box) else None)
    if alles or a.geraet:
        geraet(a.box)
    return 0


if __name__ == "__main__":
    sys.exit(main())
