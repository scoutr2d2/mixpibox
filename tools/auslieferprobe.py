#!/usr/bin/env python3
"""AUSLIEFERPROBE — haelt eine frische Karte ohne Nacharbeit fuer moeglich.

WOFUER (29.08.2026, Auftrag "alles muss auslieferbereit sein"): Die
Ausrollwege (autosetup.sh, start_mupibox_update.sh) referenzieren hunderte
Dateien; loescht oder verschiebt jemand eine, bricht die frische Karte —
und zwar STILL, weil die mv-Zeilen ihre Fehler nach >&3 umleiten. Diese
Probe liest die Ausrollwege und prueft vier Sorten, die keine bestehende
Wache abdeckt (ausrollweg-deckung.py prueft Units je Ablageweg,
zwillinge-nach-ziel.py prueft Inhalts-Drift derselben Ziele — beides
bleibt):

  A  Jede ${MUPI_SRC}-Quelle einer mv/cp/install-Zeile existiert im Repo.
  B  Kein Programm ist ExecStart von ZWEI Unit-Dateien im Repo — die
     Doppelfamilien-Sorte (mupi_taster neben mupi_offtrigger, beide auf
     off_trigger.sh, GPIO-Streit; behoben 29.08., DIESE Wache haelt es).
  C  Jeder /usr/local/bin/mupibox-Aufruf der Crontab-Vorlage kommt aus
     einem Ordner, den der Wholesale-mv wirklich kopiert (save_rrd.sh
     stand nach seiner Loeschung sonst als toter Crontab-Eintrag da).
  D  poweroff/reboot als Kommando gibt es in scripts/ nur in den
     benannten Endstufen — sleep_timer.sh endete bis 29.08. im nackten
     poweroff und umging Pause, Klang, Splash, WLED und Telegram.

AUFRUF
    python3 tools/auslieferprobe.py             Bericht
    python3 tools/auslieferprobe.py --pruefen   still bei gruen, Exit 1 bei Befund
"""

import re
import subprocess
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
AUSROLLWEGE = ["autosetup/autosetup.sh", "update/start_mupibox_update.sh"]
CRONTAB = WURZEL / "config/templates/crontab.template"

# ── A: Ausnahmen — Quellen, die es zur Laufzeit gibt, im Repo aber nicht ──
# Jede Zeile braucht einen Grund; eine Ausnahme ohne Grund ist ein Befund.
ERZEUGT_ZUR_LAUFZEIT = {
    # autosetup laedt librespot als Paket von GitHub und entpackt es dorthin;
    # das Repo traegt bewusst kein Binaer (Backlog E21/L-Reihe).
    "bin/librespot": "wird im Setup von GitHub geladen, nicht mitgeliefert",
}

# ── D: die benannten Endstufen (Stand 29.08.2026, jede am Code belegt) ────
ENDSTUFEN = {
    "scripts/mupibox/shutdown.sh": "DIE kanonische Endstufe: stoppt mupi_startstop (ExecStop faehrt mupi_shutdown.sh), dann poweroff",
    "scripts/mupibox/restart.sh": "die Neustart-Endstufe, Gegenstueck zu shutdown.sh",
    "scripts/OnOffShim/poweroff.sh": "systemd-shutdown-Haken: der Hardware-Schnitt NACH dem Herunterfahren",
    "scripts/OnOffShim/off_trigger.sh": "der Knopf-Weg: faehrt die Strecke selbst mit Fristen (nichts darf haengen), dann poweroff",
    "scripts/mupihat/mupihat_automation.sh": "Akku-Notabschaltung: ruft mupi_shutdown.sh, dann poweroff — bei leerem Akku zaehlt jede Sekunde",
    "scripts/mupibox/startup.sh": "einmaliger reboot der Erstkonfiguration (Rotation), kein Betriebs-Shutdown",
    "scripts/mupihat/enable_mupihat.sh": "schreibt reboot in /boot/run_once.sh — Setup-Weg, laeuft genau einmal",
}


def ordner_idiom(quelle: str) -> tuple:
    """Die Schreibweisen, die den ORDNER meinen, auf `(pfad, als_ordner)` bringen.

    `mv ${MUPI_SRC}/scripts/mupibox/* ziel/` — der Stern steht ausserhalb der
    Zeichenklasse des Musters, also bleibt der Schraegstrich haengen.
    `cp -rf ${MUPI_SRC}/config/fernbedienungen/. ziel/` kopiert den INHALT des
    Ordners ueberschreibend (das ist der Zweck des Idioms: Punktdateien mit,
    Zielordner bleibt stehen) — und endet auf `/.`, nicht auf `/`.

    DAS ZWEITE HAT `rstrip("/")` NICHT GEFANGEN (Kritiker-Lauf 19.09.2026):
    die Probe suchte eine Datei namens "." und meldete
    `${MUPI_SRC}/config/fernbedienungen/.` an autosetup.sh:1135 und
    start_mupibox_update.sh:1079 als fehlend — der Ordner existiert und ist
    getrackt. Zwei Befunde, beide falsch, in JEDEM Lauf; nach
    `dauerrote-wache-ist-keine` verdeckt genau das den naechsten echten.

    Genommen wird die SORTE (ein Pfad, der auf Schraegstrich-Punkt-Folgen
    endet), nicht der Name des einen Ordners — sonst stuende hier eine Liste,
    die beim naechsten `/.`-Aufruf wieder veraltet ist. Ein echt fehlendes Ziel
    bleibt rot: `config/gibtsnicht/.` wird zu `config/gibtsnicht`, und das
    findet weiterhin niemand.

    DER ZWEITE RUECKGABEWERT KOMMT AUS DER GEGENPROBE (19.09.2026): Mit
    blosser Normalisierung wurde `cp -rf ${MUPI_SRC}/bin/gibts.sh/. ziel/`
    gruen — eine Zeile, die zur Laufzeit an „Not a directory" stirbt. Die alte
    Fassung fing sie, aber aus dem falschen Grund (sie hielt `…/.` fuer einen
    Dateinamen). `als_ordner` haelt die FORDERUNG der Schreibweise fest, damit
    der Aufrufer sie gegen die Wirklichkeit halten kann, statt sie zu
    verlieren.
    """
    ohne = re.sub(r"(?:/+\.?)+$", "", quelle)
    return ohne, ohne != quelle


def lauf(cmd):
    return subprocess.run(cmd, cwd=WURZEL, capture_output=True, text=True).stdout


def getrackt() -> set:
    return set(lauf(["git", "ls-files"]).splitlines())


def pruefe_quellen(dateien: set):
    """A — jede ${MUPI_SRC}-Quelle existiert im Repo (oder ist begruendet)."""
    befunde = []
    muster = re.compile(r"\$\{MUPI_SRC\}/([A-Za-z0-9_.@/-]+)")
    for weg in AUSROLLWEGE:
        for nr, zeile in enumerate((WURZEL / weg).read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            strip = zeile.strip()
            if strip.startswith("#"):
                continue
            for quelle in muster.findall(zeile):
                # `scripts/mupibox/*`, `themes/` und `fernbedienungen/.` meinen
                # alle den ORDNER und laufen auf denselben Check hinaus; die
                # Begruendung je Schreibweise steht bei `ordner_idiom`.
                quelle, als_ordner = ordner_idiom(quelle)
                if quelle in dateien:
                    if not als_ordner:
                        continue
                    # Die Schreibweise verlangt einen Ordner, im Repo liegt
                    # eine Datei: `cp -rf datei/. ziel/` bricht mit „Not a
                    # directory", und `mv datei/* ziel/` findet nichts.
                    befunde.append((weg, nr, f"${{MUPI_SRC}}/{quelle} ist eine Datei, die Zeile verlangt einen Ordner"))
                    continue
                if any(d.startswith(quelle + "/") for d in dateien):
                    continue  # Ordner mit Inhalt
                grund = next((g for p, g in ERZEUGT_ZUR_LAUFZEIT.items() if quelle.startswith(p)), None)
                if grund:
                    continue
                # Erzeugnis eines frueheren Schritts DESSELBEN Laufs? Dann
                # taucht die Quelle vorher als ZIEL einer Zeile auf.
                text_bis_hier = "\n".join(
                    (WURZEL / weg).read_text(encoding="utf-8", errors="replace").splitlines()[: nr - 1]
                )
                if re.search(r"(?:-o\s+|>\s*)\$\{MUPI_SRC\}/" + re.escape(quelle), text_bis_hier):
                    continue
                befunde.append((weg, nr, f"${{MUPI_SRC}}/{quelle} existiert im Repo nicht"))
    return befunde


def pruefe_execstart(dateien: set):
    """B — kein Programm gehoert zwei Unit-Dateien."""
    traeger = {}
    for f in sorted(dateien):
        if not f.endswith(".service"):
            continue
        if not (f.startswith("config/services/") or f.startswith("scripts/systemd/")):
            continue
        text = (WURZEL / f).read_text(encoding="utf-8", errors="replace")
        for m in re.finditer(r"^ExecStart=(.+)$", text, re.M):
            # Verglichen wird die GANZE Kommandozeile, nicht das erste Wort:
            # zwei Units mit `/usr/bin/python3 a.py` und `/usr/bin/python3 b.py`
            # streiten sich nicht — zwei mit woertlich derselben Zeile schon
            # (mupi_taster/mupi_offtrigger starteten identisch off_trigger.sh).
            # sicherung/wiederherstellung teilen sich ein Skript mit
            # VERSCHIEDENEN Argumenten und bleiben deshalb zu Recht stumm.
            zeile = m.group(1).strip().strip("'\"").replace("/./", "/")
            zeile = re.sub(r"^/bin/bash -c\s+", "", zeile)
            traeger.setdefault(zeile, []).append(f)
    return [
        (prog, quellen)
        for prog, quellen in sorted(traeger.items())
        if len(quellen) > 1
    ]


def pruefe_crontab(dateien: set):
    """C — Crontab-Aufrufe kommen aus wirklich kopierten Ordnern."""
    # Die Ordnerliste wird aus autosetup GELESEN, nicht hier behauptet —
    # aendert jemand den Wholesale-Block, folgt die Probe von selbst.
    text = (WURZEL / AUSROLLWEGE[0]).read_text(encoding="utf-8", errors="replace")
    ordner = re.findall(r"mv \$\{MUPI_SRC\}/(scripts/[A-Za-z0-9_/-]+)/\* /usr/local/bin/mupibox/", text)
    befunde = []
    for nr, zeile in enumerate(CRONTAB.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
        if zeile.strip().startswith("#") or not zeile.strip():
            continue
        for name in re.findall(r"/usr/local/bin/mupibox/(?:\./)?([A-Za-z0-9_.-]+)", zeile):
            if not any(f"{o}/{name}" in dateien for o in ordner):
                befunde.append((nr, f"{name}: kein Wholesale-Ordner traegt diese Datei"))
    return befunde


def pruefe_endstufen(dateien: set):
    """D — poweroff/reboot als Kommando nur in den benannten Endstufen."""
    befunde = []
    kommando = re.compile(r"(?:^|[;&|]\s*|then\s+|do\s+|sudo\s+)(poweroff|reboot|halt)\b")
    for f in sorted(dateien):
        if not f.startswith("scripts/") or not f.endswith(".sh"):
            continue
        if f in ENDSTUFEN:
            continue
        for nr, zeile in enumerate((WURZEL / f).read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            strip = zeile.strip()
            if strip.startswith("#"):
                continue
            m = kommando.search(strip)
            if not m:
                continue
            # Woerter in echo/printf/Log-Zeilen sind Prosa, keine Kommandos.
            davor = strip[: m.start()]
            if re.search(r"(echo|printf|tee|LOG|log)", davor):
                continue
            befunde.append((f, nr, strip[:100]))
    return befunde


def main() -> int:
    still = "--pruefen" in sys.argv
    dateien = getrackt()

    a = pruefe_quellen(dateien)
    b = pruefe_execstart(dateien)
    c = pruefe_crontab(dateien)
    d = pruefe_endstufen(dateien)

    kaputt = bool(a or b or c or d)
    if not kaputt:
        if not still:
            print("Auslieferprobe: alle vier Sorten gruen (Quellen, ExecStart-Eindeutigkeit, Crontab, Endstufen).")
        return 0

    if a:
        print("A — AUSROLLWEG-QUELLE FEHLT IM REPO (frische Karte bricht still):")
        for weg, nr, text in a:
            print(f"  {weg}:{nr}  {text}")
    if b:
        print("B — EIN PROGRAMM, ZWEI UNITS (GPIO-/Prozess-Streit der Doppelfamilien):")
        for prog, quellen in b:
            print(f"  {prog}\n      " + "\n      ".join(quellen))
    if c:
        print("C — CRONTAB RUFT, WAS KEIN AUSROLLWEG LEGT:")
        for nr, text in c:
            print(f"  crontab.template:{nr}  {text}")
    if d:
        print("D — DIREKTES poweroff/reboot AUSSERHALB DER ENDSTUFEN:")
        for f, nr, text in d:
            print(f"  {f}:{nr}  {text}")
        print("  (Endstufen und ihre Gruende stehen im Kopf dieser Probe.)")
    return 1


if __name__ == "__main__":
    sys.exit(main())
