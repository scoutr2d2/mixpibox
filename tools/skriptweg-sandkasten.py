#!/usr/bin/env python3
"""Faehrt den Skript-Auslieferweg im SANDKASTEN — mit laufenden Schleifen.

WOZU ES DAS GIBT
`tools/ausliefern.py` hat seit dem 08.08.2026 ein fuenftes Ziel: `scripts`.
Es tauscht Dateien AUS, WAEHREND SIE LAUFEN. Das ist bei bash besonders heikel,
und die Behauptung „mit rename passiert nichts" darf man nicht glauben, sondern
muss sie sehen. Also: ein nachgestelltes /usr/local/bin/mupibox, echte bash- und
Python-Schleifen darin, tauschen, nachzaehlen.

WAS HIER BEWIESEN WIRD — jede Probe hat eine GEGENPROBE, sonst beweist sie nur,
dass nichts kaputtging:

  1 rename stoert die laufende Schleife NICHT.
    Gegenprobe: dasselbe mit `cp` (in denselben Inode schreiben) — die Schleife
    geraet durcheinander. Ohne diese Gegenprobe koennte Probe 1 auch daran
    liegen, dass die Schleife gar nicht neu liest.

  2 Der laufende Prozess behaelt SEINE Fassung bis zum Ende.
    Nach dem Tausch steht am Namen der neue Inhalt, in der Schleife laeuft der
    alte weiter. Genau deshalb muessen Dienste neu starten.

  3 Rechte und Eigentuemer werden vom ZIEL uebernommen, nicht vom Paket.
    Gegenprobe: das Paket bekommt absichtlich 0600, das Ziel steht auf 0755 —
    danach muss 0755 dastehen.

  4 Der Rueckweg wirkt, und er wirkt in BEIDE Richtungen.
    Gegenprobe: sind Ziel und `.zurueck` derselbe Inode, muss er das MELDEN
    statt Erfolg zu behaupten.

  5 Ein Ziel, das ein VERWEIS ist, wird nicht angefasst.
    (rename wuerde den Verweis ersetzen statt sein Ziel — genau daran ist
    remove_max_resume.sh schon einmal teuer geworden.)

  6 Fremde Dateien im Verzeichnis ueberleben.
    Das ist der Grund, warum dieses Ziel kein Baum ist: unter
    /usr/local/bin/mupibox liegen auch Dateien aus anderen Wegen.

  7 GEGENPROBE AM WERKZEUG SELBST: in der letzten Fassung von ausliefern.py,
    die das Ziel `scripts` noch nicht kannte, darf nichts ankommen. Sonst
    belegt dieser Sandkasten nur, dass Python Dateien kopieren kann.
    Diese Fassung wird in der Geschichte GESUCHT, nicht ueber `HEAD` geraten —
    siehe `letzte_fassung_ohne_skripte`.

WIE DER ECHTE CODE HIER HINEINKOMMT
Es wird NICHTS nachgebaut. Der Boxhelfer steht seit E42 in
`scripts/box/mupibox-tauscher.py` (davor als Zeichenkette `BOXHELFER` mitten in
ausliefern.py — Probe 7 laedt noch solche Fassungen, darum kennt
`helfer_laden` beide Formen). Er wird hier in einen eigenen Namensraum
ausgefuehrt und dann werden genau die Funktionen aufgerufen, die auch auf der
Box laufen.
Eine Kopie waere wertlos: sie koennte richtig sein, waehrend die echte falsch
ist.

BERUEHRT DIE BOX NICHT. Kein SSH, kein Netz, alles unter einem Ordner in /tmp.

    python3 tools/skriptweg-sandkasten.py
    python3 tools/skriptweg-sandkasten.py --behalten   # Sandkasten stehen lassen
"""
from __future__ import annotations

import argparse
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
AUSLIEFERN = WURZEL / "tools" / "ausliefern.py"
# DIESELBE DATEI, die ausliefern.py einliest (dort: TAUSCHER). Zwei Pfade auf
# denselben Helfer waeren zwei Wahrheiten — bricht der eine, muss der andere
# mitbrechen, und genau das hat er beim E42-Umzug nicht getan.
TAUSCHER = WURZEL / "scripts" / "box" / "mupibox-tauscher.py"

gruen = 0
rot = 0


def sagen(erwartet, bekommen, was: str) -> None:
    global gruen, rot
    if erwartet == bekommen:
        gruen += 1
        print(f"  gruen  {was}")
    else:
        rot += 1
        print(f"  ROT    {was}")
        print(f"         erwartet: {erwartet!r}")
        print(f"         bekommen: {bekommen!r}")


def erwarte(bedingung: bool, was: str) -> None:
    sagen(True, bool(bedingung), was)


# ── Den ECHTEN Boxhelfer laden ───────────────────────────────────────────────

def helfer_laden(quelle: Path) -> dict:
    """Fuehrt den echten Boxhelfer der angegebenen Fassung aus.

    Der Helfer ruft am Ende `main()` auf und liest dabei stdin — deshalb faellt
    diese letzte Zeile weg. Alles darueber ist unveraendert der Code, der auf
    der Box laeuft.

    ZWEI FORMEN, und darum keine Wahl zwischen ihnen (25.08.2026): bis E42
    stand der Helfer als Zeichenkette `BOXHELFER = r'''…'''` MITTEN in
    ausliefern.py; seither wohnt er in `scripts/box/mupibox-tauscher.py` und
    ausliefern.py liest ihn nur noch ein. Diese Wache braucht BEIDE: Probe 7
    laedt absichtlich eine ALTE Fassung aus der Geschichte, und die hat die
    Zeichenkette noch. Nur die alte Form zu kennen hiess: ValueError statt
    Urteil — genau daran starb diese Datei 9 Tage lang stumm, weil sie in
    keinem Laeufer hing
    (llmwiki: `wache-die-nirgends-laeuft-rostet-auf-einem-fehlalarm`)."""
    ns: dict = {"__name__": "boxhelfer"}
    text = quelle.read_text(encoding="utf-8")
    if "BOXHELFER = r'''" in text:          # die Form vor E42
        anfang = text.index("BOXHELFER = r'''") + len("BOXHELFER = r'''")
        code = text[anfang:text.index("'''", anfang)]
        herkunft = str(quelle) + " (BOXHELFER)"
    else:                                   # die Form seit E42
        if not TAUSCHER.exists():
            raise SystemExit(
                f"{quelle} bettet keinen BOXHELFER mehr ein, und der Tauscher "
                f"fehlt auch: {TAUSCHER}. Hier nachsehen — ein stiller Abbruch "
                f"waere schlimmer als gar keine Wache."
            )
        code = TAUSCHER.read_text(encoding="utf-8")
        herkunft = str(TAUSCHER)
    if "\nmain()\n" not in code:
        raise SystemExit(
            f"In {herkunft} steht kein `main()`-Aufruf am Ende mehr. Die Naht, "
            f"an der diese Wache schneidet, hat sich geaendert."
        )
    code = code.replace("\nmain()\n", "\n")
    exec(compile(code, herkunft, "exec"), ns)  # noqa: S102
    return ns


def ziele_lesen(quelle: Path) -> set[str]:
    """Welche Ziele kennt eine Fassung von ausliefern.py? Ueber den Text, nicht
    ueber einen Import — die alte Fassung soll hier nichts ausfuehren."""
    text = quelle.read_text()
    anfang = text.index("ZIELE: dict[str, dict] = {")
    ende = text.index("\n}\n", anfang)
    stueck = text[anfang:ende]
    import re
    return set(re.findall(r'^    "([a-z]+)": \{', stueck, re.M))


# ── Der Sandkasten ───────────────────────────────────────────────────────────

# WIE EIN SKRIPT AUSSEHEN MUSS, DAMIT DIESE PROBE ETWAS WERT IST — zweimal
# nachgemessen, und beim ersten Anlauf war sie es NICHT:
#
#   (a) KEINE `while`-Schleife. bash parst eine while-Schleife EINMAL
#       vollstaendig und fuehrt sie danach aus dem Speicher aus; es liest waehrend
#       des Laufens keine Zeile mehr nach. Eine Probe mit `while true` bestaetigt
#       also nur, dass nichts nachgelesen wird — sie kann gar nicht rot werden.
#       Nachgelesen wird zwischen Befehlen auf OBERSTER Ebene: bash merkt sich
#       den Offset, fuehrt aus, sucht zurueck, liest den naechsten Brocken.
#       Also: eine lange Folge von Befehlen, kein Rumpf.
#
#   (b) DIE FASSUNGEN MUESSEN VERSCHIEDEN LANG SEIN. Beim ersten Anlauf hiessen
#       sie „ALT" und „NEU" — gleich viele Zeichen. Ein `cp` schrieb dann Byte
#       fuer Byte deckungsgleich darueber, die Offsets passten weiter, und die
#       GEGENPROBE blieb gruen. Das haette bewiesen, dass `cp` harmlos ist.
#       Echte Reparaturen aendern die Laenge (mupi-lautstaerke.sh wuchs diese
#       Woche von 3175 auf 9092 Byte), also muss die Probe das auch tun.

def schleife_quelltext(fassung: str, breite: int) -> str:
    kopf = f"#!/bin/bash\n# FASSUNG {fassung}\n"
    zeilen = []
    for i in range(1, 700):
        polster = "#" + "=" * breite
        zeilen.append(f'echo "{fassung} runde {i}" >> "$1"   {polster}')
        zeilen.append("sleep 0.01")
    return kopf + "\n".join(zeilen) + "\n"


ALT, NEU = ("ALT", 20), ("NEU", 95)


def bauen(ordner: Path) -> dict:
    """Ein nachgestelltes /usr/local/bin/mupibox mit allem, was die echte Lage
    ausmacht: laufende Skripte, eine fremde Datei, ein Verweis."""
    ziel = ordner / "usr-local-bin-mupibox"
    lager = ordner / "lager"
    ziel.mkdir()
    lager.mkdir()

    (ziel / "schleife.sh").write_text(schleife_quelltext(*ALT))
    os.chmod(ziel / "schleife.sh", 0o755)
    (ziel / "ruhig.py").write_text("#!/usr/bin/env python3\nprint('ALT')\n")
    os.chmod(ziel / "ruhig.py", 0o755)
    # Kommt aus einem anderen Weg und darf NICHT verschwinden.
    (ziel / "fremd.sh").write_text("#!/bin/bash\necho fremd\n")
    os.chmod(ziel / "fremd.sh", 0o755)
    # Ein Verweis nach draussen — wie active_theme.css bei der Oberflaeche.
    (ordner / "woanders.sh").write_text("#!/bin/bash\necho woanders\n")
    os.symlink(ordner / "woanders.sh", ziel / "verweis.sh")

    (lager / "schleife.sh").write_text(schleife_quelltext(*NEU))
    (lager / "ruhig.py").write_text("#!/usr/bin/env python3\nprint('NEU')\n")
    (lager / "verweis.sh").write_text("#!/bin/bash\necho ersetzt\n")
    # ABSICHTLICH ENG: die Rechte muessen vom ZIEL kommen, nicht von hier.
    for d in lager.iterdir():
        os.chmod(d, 0o600)
    return {"ziel": ziel, "lager": lager}


def schleife_starten(skript: Path, protokoll: Path) -> subprocess.Popen:
    p = subprocess.Popen(["/bin/bash", str(skript), str(protokoll)],
                         stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                         start_new_session=True)
    time.sleep(0.6)
    return p


def anhalten(p: subprocess.Popen) -> str:
    """Sauber beenden — ueber die Prozessgruppe, NICHT ueber pkill -f: das
    traefe die eigene Shell mit."""
    try:
        os.killpg(os.getpgid(p.pid), signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        pass
    try:
        _, stderr = p.communicate(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(os.getpgid(p.pid), signal.SIGKILL)
        _, stderr = p.communicate(timeout=5)
    return (stderr or b"").decode("utf-8", "replace")


def zeilen(protokoll: Path) -> list[str]:
    if not protokoll.exists():
        return []
    return [z for z in protokoll.read_text(errors="replace").splitlines() if z.strip()]


# ── Die Proben ───────────────────────────────────────────────────────────────

def probe_tausch_stoert_nicht(h: dict, ordner: Path) -> None:
    print("\n1 · rename stoert die laufende bash-Schleife nicht")
    s = bauen(ordner / "p1")
    prot = ordner / "p1" / "lauf.log"
    kind = schleife_starten(s["ziel"] / "schleife.sh", prot)
    vor = len(zeilen(prot))

    befund = h["modus_skripte_tauschen"]({"dateien": [{
        "name": "schleife.sh", "quelle": str(s["lager"] / "schleife.sh"),
        "ziel": str(s["ziel"] / "schleife.sh"),
        "modus": "0755", "uid": os.getuid(), "gid": os.getgid()}]})
    time.sleep(0.8)
    nach = len(zeilen(prot))
    fehlertext = anhalten(kind)

    sagen(["schleife.sh"], befund["getauscht"], "getauscht gemeldet")
    sagen([], befund["fehler"], "kein Fehler beim Tausch")
    erwarte(nach > vor, f"die Schleife lief weiter ({vor} -> {nach} Runden)")
    # DAS IST DIE EIGENTLICHE PROBE: keine einzige Zeile darf krumm sein.
    krumm = [z for z in zeilen(prot) if not z.startswith(("ALT runde ", "NEU runde "))]
    sagen([], krumm, "keine verstuemmelte Zeile im Protokoll")
    # AUF DEN LEEREN stderr, nicht auf einen Wortlaut: die Meldung heisst hier
    # „Kommando nicht gefunden" und anderswo „command not found". Beim ersten
    # Anlauf pruefte diese Probe auf den englischen Text und blieb deshalb still
    # gruen, obwohl `cp` sehr wohl Schaden anrichtete.
    sagen("", fehlertext.strip(), "bash hat nichts zu beanstanden (stderr ist leer)")
    # Und sie laeuft mit IHRER Fassung weiter — deshalb braucht es Neustarts.
    sagen(["ALT"], sorted({z.split()[0] for z in zeilen(prot)}),
          "der laufende Prozess behaelt seine Fassung (darum die Dienst-Neustarts)")
    erwarte("# FASSUNG NEU" in (s["ziel"] / "schleife.sh").read_text(),
            "am Namen steht die neue Fassung")


def probe_cp_stoert_sehr_wohl(ordner: Path) -> None:
    print("\n1b · GEGENPROBE: dasselbe mit `cp` — in DENSELBEN Inode geschrieben")
    s = bauen(ordner / "p1b")
    prot = ordner / "p1b" / "lauf.log"
    kind = schleife_starten(s["ziel"] / "schleife.sh", prot)

    # Genau das, was ein naives Auslieferwerkzeug taete.
    subprocess.run(["cp", str(s["lager"] / "schleife.sh"), str(s["ziel"] / "schleife.sh")],
                   check=True)
    time.sleep(0.8)
    fehlertext = anhalten(kind)
    fassungen = sorted({z.split()[0] for z in zeilen(prot)})

    # ZWEI SPUREN, beide sprachunabhaengig:
    #   * bash hat etwas auf stderr zu sagen (es fuehrt Bruchstuecke aus)
    #   * der LAUFENDE Prozess wechselt mitten im Lauf die Fassung — er liest
    #     jetzt neuen Text an einem Offset, der fuer den alten gerechnet war
    #
    # WARUM DIE ERSTE SPUR NICHT ALLEIN ZAEHLEN DARF — nachgemessen am
    # 08.08.2026: ob bash ueberhaupt MECKERT, haengt davon ab, WO im Skript die
    # Schleife gerade steht, wenn `cp` zuschlaegt. Landet der alte Offset zufaellig
    # auf einem Zeilenanfang im neuen Text, laeuft es still weiter. Auf einer
    # ruhigen Maschine war diese Probe gruen, unter Last dreimal hintereinander
    # ROT — bei voellig unveraendertem Weg. Eine Probe, deren Farbe von der
    # Maschinenlast abhaengt, belegt nichts und ruiniert das Vertrauen in die
    # anderen 42.
    #
    # DIE BEHAUPTUNG IST NICHT „bash meckert", sondern „der laufende Prozess
    # geraet durcheinander". Dafuer genuegt EINE der beiden Spuren — und die
    # zweite (der Lauf kippt mitten drin in die neue Fassung) ist nicht vom
    # Zufall abhaengig, sondern die unmittelbare Folge davon, dass `cp` in
    # denselben Inode schreibt. Also: die Spuren werden VERODERT, und welche
    # gegriffen hat, steht im Bericht.
    if fehlertext.strip():
        print(f"         bash meldete: {fehlertext.strip().splitlines()[:2]}")
    gestoert = bool(fehlertext.strip()) or fassungen != ["ALT"]
    erwarte(gestoert,
            "cp bringt die laufende Schleife durcheinander "
            f"(stderr: {'ja' if fehlertext.strip() else 'nein'}, "
            f"Fassungen im Lauf: {fassungen})")
    # ZWEI AUSPRAEGUNGEN DERSELBEN GEFAHR (berichtigt 30.08.2026, nach einem
    # 42:1-Lauf): ob der Prozess in die NEUE Fassung KIPPT oder am
    # zerschnittenen Read STIRBT (bash: "Dateiende beim Suchen nach ..."),
    # entscheidet das Timing des cp gegen den read der Schleife - ein
    # Wettrennen, kein Verhalten des Werkzeugs. BEIDES beweist, was diese
    # Gegenprobe zeigen soll: cp in den lebenden Inode zerstoert den
    # laufenden Prozess. Die alte Erwartung nagelte nur das Kippen fest und
    # fiel rot, wenn der Zufall die drastischere Auspraegung wuerfelte.
    kippte = fassungen == ["ALT", "NEU"]
    starb = bool(fehlertext.strip()) and fassungen == ["ALT"]
    erwarte(kippte or starb,
            "und der laufende Prozess kippt in die neue Fassung ODER stirbt am "
            f"zerschnittenen Read (gekippt: {'ja' if kippte else 'nein'}, "
            f"gestorben: {'ja' if starb else 'nein'})")
    print("         Genau das darf ein Auslieferweg nicht tun — deshalb rename(2).")


def probe_rechte(h: dict, ordner: Path) -> None:
    print("\n3 · Rechte und Eigentuemer kommen vom ZIEL, nicht aus dem Paket")
    s = bauen(ordner / "p3")
    os.chmod(s["ziel"] / "ruhig.py", 0o754)     # ein ungewoehnlicher, gemessener Wert
    vorher = oct(os.stat(s["ziel"] / "ruhig.py").st_mode & 0o7777)
    sagen("0o754", vorher, "Ausgangswert am Ziel steht auf 754")
    sagen("0o600", oct(os.stat(s["lager"] / "ruhig.py").st_mode & 0o7777),
          "das Paket traegt absichtlich 600")

    h["modus_skripte_tauschen"]({"dateien": [{
        "name": "ruhig.py", "quelle": str(s["lager"] / "ruhig.py"),
        "ziel": str(s["ziel"] / "ruhig.py"),
        "modus": "0754", "uid": os.getuid(), "gid": os.getgid()}]})
    sagen("0o754", oct(os.stat(s["ziel"] / "ruhig.py").st_mode & 0o7777),
          "nach dem Tausch gilt weiter 754 — der gemessene Wert, nicht der aus dem Paket")
    sagen("NEU\n", (s["ziel"] / "ruhig.py").read_text().split("'")[1] + "\n",
          "und der Inhalt ist der neue")


def probe_rueckweg(h: dict, ordner: Path) -> None:
    print("\n4 · Der Rueckweg — und die Lage, in der er nur so TAET, als wirke er")
    s = bauen(ordner / "p4")
    ziel = s["ziel"] / "ruhig.py"
    auftrag = [{"name": "ruhig.py", "quelle": str(s["lager"] / "ruhig.py"),
                "ziel": str(ziel), "modus": "0755", "uid": os.getuid(), "gid": os.getgid()}]
    h["modus_skripte_tauschen"]({"dateien": auftrag})
    erwarte(Path(str(ziel) + ".zurueck").is_file(), "eine Rueckdreh-Erzeugung liegt da")
    erwarte("NEU" in ziel.read_text(), "am Ziel steht die neue Fassung")

    zurueck = h["modus_skripte_zurueck"]({"dateien": [{"name": "ruhig.py", "ziel": str(ziel)}]})
    sagen(["ruhig.py"], zurueck["zurueck"], "zurueckgedreht gemeldet")
    erwarte("ALT" in ziel.read_text(), "am Ziel steht wieder die alte Fassung")
    erwarte("NEU" in Path(str(ziel) + ".zurueck").read_text(),
            "und .zurueck haelt jetzt den Stand, der eben lief (der Weg fuehrt in beide Richtungen)")

    print("   4b · GEGENPROBE: Ziel und Rueckweg sind DERSELBE Inode")
    # So liegt die Box da, wenn ein Lauf zwischen os.link und os.replace abreisst.
    os.unlink(str(ziel) + ".zurueck")
    os.link(str(ziel), str(ziel) + ".zurueck")
    zurueck = h["modus_skripte_zurueck"]({"dateien": [{"name": "ruhig.py", "ziel": str(ziel)}]})
    sagen([], zurueck["zurueck"], "es wird KEIN Erfolg gemeldet")
    sagen(["ruhig.py"], zurueck["ohne_wirkung"],
          "sondern ausdruecklich 'ohne Wirkung' — ein stiller Rueckweg ist schlimmer als keiner")


def probe_verweis_und_fremde(h: dict, ordner: Path) -> None:
    print("\n5/6 · Verweise bleiben unangetastet, fremde Dateien ueberleben")
    s = bauen(ordner / "p56")
    vorher = sorted(p.name for p in s["ziel"].iterdir())

    befund = h["modus_skripte_tauschen"]({"dateien": [{
        "name": "verweis.sh", "quelle": str(s["lager"] / "verweis.sh"),
        "ziel": str(s["ziel"] / "verweis.sh"),
        "modus": "0755", "uid": os.getuid(), "gid": os.getgid()}]})
    sagen([], befund["getauscht"], "der Verweis wurde NICHT getauscht")
    sagen(["verweis.sh"], befund["uebersprungen"], "er ist als uebersprungen gemeldet")
    erwarte("VERWEIS" in (befund["fehler"] or [""])[0],
            f"und die Begruendung nennt den Verweis: {(befund['fehler'] or [''])[0][:90]!r}")
    erwarte((s["ziel"] / "verweis.sh").is_symlink(), "er ist immer noch ein Verweis")
    erwarte("woanders" in (s["ziel"] / "verweis.sh").read_text(),
            "und zeigt weiter auf dieselbe Datei")

    # Jetzt alles Uebrige tauschen und nachzaehlen: fremd.sh muss bleiben.
    h["modus_skripte_tauschen"]({"dateien": [
        {"name": n, "quelle": str(s["lager"] / n), "ziel": str(s["ziel"] / n),
         "modus": "0755", "uid": os.getuid(), "gid": os.getgid()}
        for n in ("schleife.sh", "ruhig.py")]})
    nachher = sorted(p.name for p in s["ziel"].iterdir() if not p.name.endswith(".zurueck"))
    sagen(vorher, nachher, "kein Eintrag im Verzeichnis ist verschwunden (fremd.sh lebt)")
    erwarte("fremd" in (s["ziel"] / "fremd.sh").read_text(),
            "und fremd.sh hat unveraenderten Inhalt")
    uebrig = [p.name for p in s["ziel"].iterdir() if p.name.startswith(".")]
    sagen([], uebrig, "keine halbfertige .…ausliefern-Datei blieb liegen")


def probe_merkzettel(h: dict, ordner: Path) -> None:
    print("\n8 · Der Merkzettel — der Rueckweg nimmt nur zurueck, was ER gab")
    s = bauen(ordner / "p8")
    zettel = ordner / "p8" / "merkzettel.json"
    ziel = s["ziel"] / "ruhig.py"
    # Eine Rueckdreh-Erzeugung, die NICHT von diesem Weg stammt — genau so lag
    # mupibox-sicherung.py.zurueck am 08.08.2026 auf der Box.
    (s["ziel"] / "fremd.sh.zurueck").write_text("#!/bin/bash\necho fremd-alt\n")

    h["modus_skripte_tauschen"]({
        "dateien": [{"name": "ruhig.py", "quelle": str(s["lager"] / "ruhig.py"),
                     "ziel": str(ziel), "modus": "0755",
                     "uid": os.getuid(), "gid": os.getgid()}],
        "merkzettel": str(zettel), "stempel": "2026-08-08T00:00:00"})

    import json
    inhalt = json.loads(zettel.read_text())
    sagen([str(ziel)], inhalt["ziele"], "der Merkzettel nennt genau die getauschte Datei")
    erwarte(str(s["ziel"] / "fremd.sh") not in inhalt["ziele"],
            "und NICHT die fremde Rueckdreh-Erzeugung, die daneben liegt")
    erwarte((s["ziel"] / "fremd.sh.zurueck").is_file(),
            "die fremde bleibt unangetastet liegen")


def probe_welcher_ort_gewinnt(ordner: Path) -> None:
    print("\n9 · Welcher Ort gewinnt — die Unit, nicht die Tabelle")
    import importlib.util
    spec = importlib.util.spec_from_file_location("ausliefern_unter_probe", AUSLIEFERN)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)

    # DIE LAGE, DIE ES AUF DIESER BOX WIRKLICH GIBT: die Einrichtung sieht
    # /usr/local/bin/mupibox/mupibox-boot-splash.py vor, die Unit auf der Box
    # nennt /usr/local/bin/mupibox-boot-splash.py. Wer der Tabelle folgt, legt
    # eine Datei ab, die NIEMAND ausfuehrt — derselbe Fehler wie bei
    # spotify-control.js, der zwei Korrekturen wirkungslos machte.
    k = {"rel": "mupibox/mupibox-boot-splash.py", "name": "mupibox-boot-splash.py",
         "kanon": "/usr/local/bin/mupibox/mupibox-boot-splash.py", "sha": "aaa"}
    funde = [{"pfad": "/usr/local/bin/mupibox-boot-splash.py", "verweis": False,
              "modus": "0755", "uid": 0, "gid": 0, "nutzer": "root", "gruppe": "root",
              "nlink": 1, "bytes": 1, "sha": "bbb", "nlink_fremd": 0}]
    units = [{"unit": "mupibox-boot-splash.service", "aktiv": "inactive", "unter": "dead",
              "pfade": ["/usr/local/bin/mupibox-boot-splash.py"]}]
    e = m.ziel_bestimmen(k, funde, units)
    sagen("/usr/local/bin/mupibox-boot-splash.py", e["ziel"],
          "ausgeliefert wird dorthin, wo die Unit hinzeigt")
    erwarte(e.get("abweichender_ort"), "und die Abweichung von der Tabelle wird gemeldet")
    sagen("anders", e["lage"], "der Inhalt weicht ab, also waere zu tauschen")

    # Zwei Kopien an zwei Orten: dann weiss dieser Weg NICHT, welche laeuft.
    zwei = funde + [dict(funde[0], pfad="/usr/local/bin/mupibox/mupibox-boot-splash.py")]
    e2 = m.ziel_bestimmen(k, zwei, [])
    sagen("mehrdeutig", e2["lage"], "zwei Kopien an zwei Orten -> nichts anfassen")

    # Ein Verweis am Ziel wird erkannt, bevor irgendetwas passiert.
    e3 = m.ziel_bestimmen(k, [{"pfad": k["kanon"], "verweis": True, "zeigt_auf": "/woanders"}], [])
    sagen("verweis", e3["lage"], "ein Verweis am Ziel wird vorher erkannt")

    # Der eigene Rueckweg darf nicht als 'haengt noch woanders dran' zaehlen.
    mit_zurueck = [dict(funde[0], pfad=k["kanon"], nlink=2, nlink_fremd=0,
                        zurueck_selber_inode=True)]
    sagen("anders", m.ziel_bestimmen(k, mit_zurueck, [])["lage"],
          "die eigene ….zurueck blockiert den naechsten Lauf nicht")
    fremd_verknuepft = [dict(funde[0], pfad=k["kanon"], nlink=2, nlink_fremd=1)]
    sagen("verknuepft", m.ziel_bestimmen(k, fremd_verknuepft, [])["lage"],
          "eine FREMDE harte Verknuepfung dagegen schon")


def letzte_fassung_ohne_skripte(ordner: Path) -> Path | None:
    """Die JUENGSTE Fassung von ausliefern.py, die `scripts` noch nicht kennt.

    WARUM NICHT EINFACH `HEAD`. Genau so stand es hier, und genau deshalb war
    diese Gegenprobe nur bis zum Festschreiben gruen: solange der neue Weg im
    Arbeitsbaum lag, war `HEAD` die alte Fassung — danach war `HEAD` die neue,
    und alle fuenf Proben kippten auf ROT, ohne dass sich am Weg etwas geaendert
    haette. Eine Gegenprobe, die vom Zeitpunkt ihres Laufs abhaengt, belegt
    nichts. Deshalb wird die Vergleichsfassung jetzt GESUCHT statt geraten: die
    Geschichte der Datei ruecklings durchgehen und die erste nehmen, in der
    `scripts` fehlt. Das bleibt richtig, egal wie viele Festschreibungen
    daraufkommen.
    """
    p = subprocess.run(["git", "log", "--format=%H", "--", "tools/ausliefern.py"],
                       cwd=WURZEL, capture_output=True, text=True)
    if p.returncode != 0:
        return None
    for stand in p.stdout.split():
        q = subprocess.run(["git", "show", f"{stand}:tools/ausliefern.py"],
                           cwd=WURZEL, capture_output=True, text=True)
        if q.returncode != 0:
            continue
        alt = ordner / "ausliefern-vorher.py"
        alt.write_text(q.stdout)
        try:
            if "scripts" not in ziele_lesen(alt):
                print(f"  (Vergleichsfassung: {stand[:8]})")
                return alt
        except ValueError:
            continue
    return None


def probe_alte_fassung(ordner: Path) -> None:
    print("\n7 · GEGENPROBE am Werkzeug: die vorige Fassung kann scripts/ gar nicht")
    alt = letzte_fassung_ohne_skripte(ordner)
    if alt is None:
        print("  ROT    keine Fassung ohne 'scripts' in der Geschichte gefunden")
        globals()["rot"] += 1
        return

    alte_ziele = ziele_lesen(alt)
    neue_ziele = ziele_lesen(AUSLIEFERN)
    erwarte("scripts" not in alte_ziele,
            f"die vorige Fassung kennt die Ziele {sorted(alte_ziele)} — 'scripts' ist keines davon")
    erwarte("scripts" in neue_ziele,
            f"diese Fassung kennt {sorted(neue_ziele)}")

    # Und sie wuerde den Aufruf ablehnen, statt still etwas anderes zu tun.
    q = subprocess.run([sys.executable, str(alt), "--nur", "scripts", "--probe"],
                       cwd=WURZEL, capture_output=True, text=True, timeout=120)
    erwarte(q.returncode == 1,
            f"`--nur scripts` mit der alten Fassung endet mit 1 (bekommen: {q.returncode})")
    erwarte("Unbekanntes Ziel" in q.stdout,
            "und sagt 'Unbekanntes Ziel' — es kommt nichts an, auch nicht aus Versehen")

    # Der Helfer der alten Fassung kennt die Modi gar nicht.
    alt_h = helfer_laden(alt)
    erwarte("modus_skripte_tauschen" not in alt_h,
            "auch ihr Boxhelfer hat keinen Modus fuer Skripte")


def main() -> int:
    t = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    t.add_argument("--behalten", action="store_true", help="den Sandkasten stehen lassen")
    a = t.parse_args()

    ordner = Path(tempfile.mkdtemp(prefix="skriptweg-sandkasten-"))
    print(f"Sandkasten: {ordner}")
    print("Es wird KEINE Verbindung zur Box aufgebaut.")
    for n in ("p1", "p1b", "p3", "p4", "p56", "p8"):
        (ordner / n).mkdir()

    h = helfer_laden(AUSLIEFERN)
    fehlt = [n for n in ("modus_skripte_tauschen", "modus_skripte_zurueck",
                         "modus_skripte_lage", "modus_skripte_pruefen")
             if n not in h]
    if fehlt:
        print(f"ROT: dem Boxhelfer fehlen {fehlt}")
        return 1

    try:
        probe_tausch_stoert_nicht(h, ordner)
        probe_cp_stoert_sehr_wohl(ordner)
        probe_rechte(h, ordner)
        probe_rueckweg(h, ordner)
        probe_verweis_und_fremde(h, ordner)
        probe_merkzettel(h, ordner)
        probe_welcher_ort_gewinnt(ordner)
        probe_alte_fassung(ordner)
    finally:
        if a.behalten:
            print(f"\nSandkasten bleibt stehen: {ordner}")
        else:
            shutil.rmtree(ordner, ignore_errors=True)

    print(f"\ngruen: {gruen}, rot: {rot}")
    return 0 if rot == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
