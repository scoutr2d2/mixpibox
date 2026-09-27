#!/usr/bin/env python3
"""Ist die WPEPlatform-Nachfolge von Cog beschaffbar — und was haengt im Baum daran?

    python3 tools/wpe-nachfolge-pruefen.py               # Wache (offline, fuer pruefen.sh)
    python3 tools/wpe-nachfolge-pruefen.py --lage        # hat sich draussen die Lage gedreht?
    python3 tools/wpe-nachfolge-pruefen.py --gegenprobe  # taugt die Lage-Wache? (offline)
    python3 tools/wpe-nachfolge-pruefen.py --quellen     # Paketindex draussen messen
    python3 tools/wpe-nachfolge-pruefen.py --stellen     # Stellen im Baum auflisten
    python3 tools/wpe-nachfolge-pruefen.py --box dietpi@192.168.178.62 --wdh 2 --abstand 180

══ WOZU ═══════════════════════════════════════════════════════════════════
Cog ist abgekuendigt (Igalia/cog#799, offen am 17.09.2026: die libwpe-gestuetzte
API ist „officially deprecated", ueber 0.18.x hinaus gibt es keine stabilen
Releases). Der zweite Kiosk-Browser dieses Projekts — `mupibox.kioskBrowser`
= "cog", gebaut in E56 — steht damit auf einem toten Ast. Der Nachfolger
heisst WPEPlatform und ist seit WPE WebKit 2.54.0 (16.09.2026) stabil.

Die Frage „koennen wir umsteigen?" ist KEINE Code-Frage, sondern eine
Beschaffungsfrage: liegt WPEPlatform in den Paketquellen, die diese Box
benutzt? Sie aus der Erinnerung zu beantworten geht schief, weil die Antwort
sich mit jedem Debian-Upload aendert. Darum misst dieses Werkzeug sie —
und zwar am Index, nicht am Blogeintrag.

══ WORAN MAN WPEPlatform IM PAKET ERKENNT ═════════════════════════════════
NICHT an einer Datei namens libWPEPlatform*.so — die gibt es in Debian nicht.
Debian baut WPEPlatform IN libWPEWebKit-2.0.so.1 hinein. Der einzige
verlaessliche Nachweis am Index ist die symbols-Datei des Binaerpakets:
stehen dort `wpe_display_*`, `wpe_view_*`, `wpe_toplevel_*`, ist die API drin.

    2.48.3-1 (trixie):  0 solcher Symbole  -> WPEPlatform NICHT vorhanden
    2.54.0-2 (sid):   215 solcher Symbole  -> WPEPlatform vorhanden
                      (davon 111 allein display/view/toplevel; gemessen
                       19.09.2026)

Wer stattdessen nach dem Dateinamen sucht, bekommt in BEIDEN Faellen null
Treffer und haelt die Nachfolge faelschlich fuer nirgends verfuegbar.

══ WAS DIE WACHE PRUEFT (offline, ohne Netz, ohne Box) ════════════════════
Den Naht, die ein Umbau als erstes kreuzt: die Liste der waehlbaren
Kiosk-Browser steht an DREI Orten, und sie muessen sich decken.

  1  src/backend-api/src/konfiguration.ts  — was der Eltern-Bereich anbietet
  2  scripts/mupibox/mixpi-kiosk-pakete.sh — wofuer Pakete nachgeholt werden
  3  scripts/chromium-autostart.sh         — wer einen Rueckfall auf Chromium hat

Traegt jemand einen dritten Browser in die Oberflaeche ein und vergisst den
Paketholer, dann zeigt der Schalter auf ein Programm, das die Box nie
installiert — genau die Falle, vor der der Kopf von mixpi-kiosk-pakete.sh
warnt. Vergisst er den Rueckfall, steht ein Kind vor einem schwarzen Schirm
an einer Box OHNE TASTATUR. Das ist der Grund, warum diese Wache offline und
in jedem Lauf steht und nicht in einer Messung mit Netz.

══ WAS `--lage` PRUEFT — die Antwort mit Haltbarkeitsdatum ════════════════
„WPEPlatform gibt es fuer Trixie nicht" ist am 19.09.2026 richtig und HOERT
IRGENDWANN AUF, RICHTIG ZU SEIN — sobald ein Backport erscheint, die
Raspberry-Pi-Quelle etwas liefert oder die Box auf das naechste Debian-Stable
zieht. Als Prosa in einem Bericht wird dieser Satz nie wieder gelesen; er
altert still und schickt die naechste Sitzung auf dieselbe Ausgrabung.

`--lage` misst die vier Orte, an denen sich die Antwort drehen kann, und
vergleicht sie mit dem FESTGESCHRIEBENEN STAND unten (`LAGE_STAND`):

  1  Debian stable: welche wpewebkit-Fassung, und traegt sie WPEPlatform-
     Symbole? (0 heisst: nein; die Suite selbst wandert mit, wenn Debian ein
     neues Stable veroeffentlicht — auch das faellt hier auf)
  2  madison fuer trixie-backports: gibt es dort ueberhaupt eine Fassung?
  3  der Binaerindex trixie-backports/main/arm64: liegt dort ein wpe/cog-Paket?
  4  archive.raspberrypi.com trixie: liefert die Pi-Quelle etwas Neues?

SIE IST STILL, SOLANGE DIE LAGE IST WIE HEUTE, und schlaegt an, sobald einer
dieser vier Orte WPEPlatform hergibt (llmwiki `dauerrote-wache-ist-keine`:
ein erwarteter Zustand ist kein Befund). Kein Netz heisst NICHT GEMESSEN und
NICHT „Befund" — eine Wache, die ohne Netz rot wird, erzieht zum Ueberlesen.

Wandert die stable-Fassung, ohne dass Symbole dazukommen (Punktupdate), ist
das ein HINWEIS zum Nachziehen von `LAGE_STAND`, kein Befund: die Antwort auf
die Frage hat sich nicht geaendert, nur ihre Herkunft.

`--gegenprobe` prueft beide Richtungen offline, an Attrappen echter
Paketindizes, die durch denselben Auswerteweg laufen: einmal die Lage von
heute (muss SCHWEIGEN) und einmal eine gedrehte Lage (muss ANSCHLAGEN).

══ WAS ES NICHT TUT ═══════════════════════════════════════════════════════
Es baut nichts um und stellt nichts um. `--box` liest ausschliesslich
(ps, free, dpkg-query, apt-cache, jq auf die Konfigurationsdatei) und ruft
kein sudo. Es misst auch KEIN PSS: /proc/<pid>/smaps_rollup der Kiosk-
Prozesse gehoert root und ist fuer den Nutzer `dietpi` nicht lesbar. Was
hier steht, ist RSS aus ps — die Summe ueber mehrere Prozesse zaehlt
gemeinsame Seiten MEHRFACH und ist darum systematisch zu hoch. Die
Gegenprobe dazu ist `free`, das keine Seite doppelt zaehlt. Wer eine
PSS-Zahl braucht (wie in llmwiki `cog-spart-267-mb-gemessen`), braucht
root und damit tools/kiosk-benchmark.py.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent

# Die vier Quellpakete des Stapels. `cog` ist der abgekuendigte Starter,
# libwpe/wpebackend-fdo der abgekuendigte Unterbau, wpewebkit die Maschine.
STAPEL = ["wpewebkit", "cog", "libwpe", "wpebackend-fdo"]

MADISON = "https://api.ftp-master.debian.org/madison?package={p}&f=json"
MADISON_SUITE = "https://api.ftp-master.debian.org/madison?package={p}&s={s}&f=json"
SYMBOLE = ("https://sources.debian.org/data/main/w/wpewebkit/"
           "{v}/debian/libwpewebkit-2.0-1.symbols")
RPI = "http://archive.raspberrypi.com/debian/dists/trixie/{k}/binary-arm64/Packages.gz"
BACKPORTS = ("https://deb.debian.org/debian/dists/trixie-backports/"
             "main/binary-arm64/Packages.xz")

# ══ DER FESTGESCHRIEBENE STAND ═════════════════════════════════════════════
# Gemessen am 19.09.2026, 20:56 — unabhaengig nachgemessen gegen den Bericht
# AUDIT-2026-09-19-WPE.md vom selben Tag, alle vier Werte deckungsgleich.
# Aendert sich hier etwas, aendert sich die ANTWORT auf „koennen wir
# umsteigen?". Wer den Stand nachzieht, traegt das Datum mit nach.
LAGE_STAND = {
    "gemessen": "2026-09-19",
    "wpewebkit_stable": "2.48.3-1",     # Debian stable = trixie, das die Box faehrt
    "symbole_stable": 0,                # WPEPlatform steckt dort NICHT drin
    "drm_stable": False,                # kein wpe_display_drm_new
    "backports_fassungen": [],          # madison kennt keine trixie-backports-Fassung
    "backports_pakete": [],             # und der Binaerindex kein wpe/cog-Paket
    "rpi_pakete": ["gstreamer1.0-wpe", "gstreamer1.0-wpe-dbgsym"],
}
# Diese beiden sind ein GStreamer-Plugin, das WPE benutzt — kein Browser und
# kein Unterbau. Sie stehen im Stand, damit ihr Auftauchen nicht jedes Mal
# als Fund gemeldet wird; alles DARUEBER HINAUS ist einer.

# Symbolpraefixe der WPEPlatform-API. wpe_display_drm_* ist der fuer uns
# entscheidende: ohne ihn gaebe es zwar die API, aber keinen Weg auf den
# Schirm ohne Fenstermanager.
WPEPLATFORM_MUSTER = re.compile(r"\bwpe_(display|view|toplevel|screen|settings|buffer|keymap)_")


def hole(url: str, roh: bool = False, grenze: int = 40):
    try:
        with urllib.request.urlopen(url, timeout=grenze) as a:
            d = a.read()
        return d if roh else d.decode("utf-8", "replace")
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        return None if roh else f"__FEHLER__ {e}"


# ═══ 1. DIE QUELLEN DRAUSSEN ═══════════════════════════════════════════════

def quellen() -> int:
    print("PAKETQUELLEN — gemessen am Index, nicht aus der Erinnerung")
    print(f"gemessen: {time.strftime('%Y-%m-%d %H:%M')}\n")

    print("  Debian (api.ftp-master.debian.org/madison)")
    fassungen: dict[str, dict[str, str]] = {}
    for p in STAPEL:
        t = hole(MADISON.format(p=p))
        if t is None or t.startswith("__FEHLER__"):
            print(f"    {p:<16} NICHT GEMESSEN ({t})")
            continue
        try:
            daten = json.loads(t)[0][p]
        except (ValueError, KeyError, IndexError):
            print(f"    {p:<16} NICHT GEMESSEN (Antwort unlesbar)")
            continue
        zeile = []
        for lager in ("stable", "testing", "unstable"):
            vs = sorted(daten.get(lager, {}))
            fassungen.setdefault(p, {})[lager] = vs[-1] if vs else "-"
            zeile.append(f"{lager}={vs[-1] if vs else '-'}")
        print(f"    {p:<16} " + "  ".join(zeile))
    print("    (stable = trixie, das die Box faehrt)")

    print("\n  WPEPlatform in libWPEWebKit-2.0.so.1? (symbols-Datei des Binaerpakets)")
    for lager in ("stable", "unstable"):
        v = fassungen.get("wpewebkit", {}).get(lager)
        if not v or v == "-":
            print(f"    {lager:<10} NICHT GEMESSEN (keine Fassung bekannt)")
            continue
        t = hole(SYMBOLE.format(v=v))
        if t is None or t.startswith("__FEHLER__"):
            print(f"    {lager:<10} {v:<12} NICHT GEMESSEN ({t})")
            continue
        n = len(WPEPLATFORM_MUSTER.findall(t))
        drm = "ja" if "wpe_display_drm_new" in t else "NEIN"
        urteil = "vorhanden" if n else "FEHLT"
        print(f"    {lager:<10} {v:<12} {n:>4} WPEPlatform-Symbole -> {urteil}"
              f"   (DRM-Anzeige: {drm})")

    print("\n  archive.raspberrypi.com trixie/arm64")
    import gzip
    for komponente in ("main", "beta", "untested"):
        d = hole(RPI.format(k=komponente), roh=True)
        if d is None:
            print(f"    {komponente:<10} NICHT GEMESSEN (nicht erreichbar)")
            continue
        try:
            text = gzip.decompress(d).decode("utf-8", "replace")
        except (OSError, EOFError):
            print(f"    {komponente:<10} NICHT GEMESSEN (kein gzip)")
            continue
        gesamt = text.count("\nPackage: ") + text.startswith("Package: ")
        treffer = sorted({
            m.group(1) for m in re.finditer(r"^Package: (\S*(?:wpe|cog)\S*)$", text, re.M)
        })
        print(f"    {komponente:<10} {gesamt:>5} Pakete, davon wpe/cog: "
              + (", ".join(treffer) if treffer else "KEINES"))

    print("\n  trixie-backports/main/arm64")
    bp = _index(hole, BACKPORTS, "xz")
    if bp is None:
        print("    NICHT GEMESSEN (Index nicht erreichbar)")
    else:
        print(f"    {bp[0]:>5} Pakete, davon wpe/cog: "
              + (", ".join(bp[1]) if bp[1] else "KEINES"))
    return 0


# ═══ 1b. DIE LAGE — die Antwort mit Haltbarkeitsdatum ══════════════════════

def _index(holen, url: str, art: str) -> tuple[int, list[str]] | None:
    """(Zahl der Pakete, wpe/cog-Treffer) aus einem Debian-Binaerindex.

    Gibt None zurueck, wenn der Index nicht zu lesen war — NICHT (0, []).
    Der Unterschied ist die ganze Sache: „nichts gefunden" und „nicht
    nachgesehen" duerfen nicht dieselbe Zahl ergeben.
    """
    import gzip
    import lzma
    d = holen(url, roh=True)
    if d is None:
        return None
    try:
        text = (lzma.decompress(d) if art == "xz" else gzip.decompress(d)).decode(
            "utf-8", "replace")
    except (OSError, EOFError, lzma.LZMAError):
        return None
    gesamt = text.count("\nPackage: ") + (1 if text.startswith("Package: ") else 0)
    treffer = sorted({
        m.group(1) for m in re.finditer(r"^Package: (\S*(?:wpe|cog)\S*)$", text, re.M)
    })
    return gesamt, treffer


def _madison(holen, paket: str, suite: str | None = None) -> dict | None:
    url = MADISON_SUITE.format(p=paket, s=suite) if suite else MADISON.format(p=paket)
    t = holen(url)
    if t is None or t.startswith("__FEHLER__"):
        return None
    try:
        daten = json.loads(t)
    except ValueError:
        return None
    if not daten:            # leere Liste = Paket in dieser Suite unbekannt
        return {}
    try:
        return daten[0][paket]
    except (KeyError, IndexError, TypeError):
        return None


def lage_messen(holen) -> dict:
    """Die vier Orte, an denen sich die Antwort drehen kann. `holen` ist
    austauschbar, damit --gegenprobe denselben Auswerteweg mit Attrappen
    fahren kann statt einer zweiten, nie mitgepflegten Kopie davon."""
    m = _madison(holen, "wpewebkit")
    stable = None
    if m:
        vs = sorted(m.get("stable", {}))
        stable = vs[-1] if vs else None

    symbole = drm = None
    if stable:
        t = holen(SYMBOLE.format(v=stable))
        if t is not None and not t.startswith("__FEHLER__"):
            symbole = len(WPEPLATFORM_MUSTER.findall(t))
            drm = "wpe_display_drm_new" in t

    bp_m = _madison(holen, "wpewebkit", "trixie-backports")
    bp_fassungen = None
    if bp_m is not None:
        bp_fassungen = sorted({v for lager in bp_m.values() for v in lager})

    bp_i = _index(holen, BACKPORTS, "xz")
    rpi_i = _index(holen, RPI.format(k="main"), "gz")

    return {
        "wpewebkit_stable": stable,
        "symbole_stable": symbole,
        "drm_stable": drm,
        "backports_fassungen": bp_fassungen,
        "backports_pakete": bp_i[1] if bp_i else None,
        "backports_gesamt": bp_i[0] if bp_i else None,
        "rpi_pakete": rpi_i[1] if rpi_i else None,
    }


def lage_urteilen(g: dict) -> tuple[list[str], list[str]]:
    """(Befunde, Hinweise). Befund = die Lage hat sich GEDREHT."""
    befunde: list[str] = []
    hinweise: list[str] = []

    if g["wpewebkit_stable"] is None:
        hinweise.append("Debian stable: NICHT GEMESSEN (madison nicht erreichbar)")
    elif g["wpewebkit_stable"] != LAGE_STAND["wpewebkit_stable"]:
        hinweise.append(
            f"Debian stable ist von {LAGE_STAND['wpewebkit_stable']} auf "
            f"{g['wpewebkit_stable']} gewandert. Solange dort 0 WPEPlatform-"
            f"Symbole stehen, ist das kein Fund — aber LAGE_STAND gehoert "
            f"nachgezogen (Datum mit).")

    if g["symbole_stable"] is None:
        hinweise.append("WPEPlatform-Symbole in stable: NICHT GEMESSEN "
                        "(symbols-Datei nicht erreichbar)")
    elif g["symbole_stable"] > LAGE_STAND["symbole_stable"]:
        befunde.append(
            f"WPEPlatform IST IN DEBIAN STABLE ANGEKOMMEN: "
            f"{g['wpewebkit_stable']} traegt {g['symbole_stable']} "
            f"WPEPlatform-Symbole (DRM-Anzeige: "
            f"{'ja' if g['drm_stable'] else 'NEIN'}), am "
            f"{LAGE_STAND['gemessen']} waren es {LAGE_STAND['symbole_stable']}. "
            f"Damit ist die Nachfolge zum ersten Mal beschaffbar — "
            f"AUDIT-2026-09-19-WPE.md §1 ist ab jetzt falsch. Naechster "
            f"Schritt: am Geraet nachsehen, welche Suite die Box wirklich "
            f"faehrt (apt-cache policy libwpewebkit-2.0-1), denn diese Wache "
            f"misst Debian, nicht die Box.")

    if g["backports_fassungen"] is None:
        hinweise.append("trixie-backports (madison): NICHT GEMESSEN")
    elif g["backports_fassungen"]:
        befunde.append(
            f"wpewebkit liegt jetzt in trixie-backports: "
            f"{', '.join(g['backports_fassungen'])}. Das ist der billige Weg "
            f"— er braucht keinen Distributionswechsel.")

    if g["backports_pakete"] is None:
        hinweise.append("trixie-backports (Binaerindex): NICHT GEMESSEN")
    else:
        neu = sorted(set(g["backports_pakete"]) - set(LAGE_STAND["backports_pakete"]))
        if neu:
            befunde.append(
                f"trixie-backports/main/arm64 enthaelt jetzt: {', '.join(neu)} "
                f"({g['backports_gesamt']} Pakete im Index).")

    if g["rpi_pakete"] is None:
        hinweise.append("archive.raspberrypi.com trixie/main: NICHT GEMESSEN")
    else:
        neu = sorted(set(g["rpi_pakete"]) - set(LAGE_STAND["rpi_pakete"]))
        if neu:
            befunde.append(
                f"archive.raspberrypi.com trixie/main liefert jetzt: "
                f"{', '.join(neu)}. Diese Quelle steht auf der Box bereits in "
                f"/etc/apt/sources.list.d/raspi.list.")

    return befunde, hinweise


def lage(holen=hole) -> int:
    g = lage_messen(holen)
    befunde, hinweise = lage_urteilen(g)

    print(f"LAGE DER WPEPlatform-NACHFOLGE — Stand festgeschrieben am "
          f"{LAGE_STAND['gemessen']}, gemessen {time.strftime('%Y-%m-%d %H:%M')}")
    print(f"  Debian stable wpewebkit : {g['wpewebkit_stable'] or 'NICHT GEMESSEN'}"
          f"   WPEPlatform-Symbole: "
          f"{'NICHT GEMESSEN' if g['symbole_stable'] is None else g['symbole_stable']}")
    print(f"  trixie-backports        : "
          f"{'NICHT GEMESSEN' if g['backports_fassungen'] is None else (', '.join(g['backports_fassungen']) or 'keine Fassung')}"
          f" | Index: "
          f"{'NICHT GEMESSEN' if g['backports_pakete'] is None else (', '.join(g['backports_pakete']) or 'kein wpe/cog-Paket')}")
    print(f"  archive.raspberrypi.com : "
          f"{'NICHT GEMESSEN' if g['rpi_pakete'] is None else ', '.join(g['rpi_pakete'])}")
    for h in hinweise:
        print(f"  Hinweis  {h}")
    if not befunde:
        print("\n  Lage unveraendert: WPEPlatform ist fuer die Suite dieser Box "
              "nicht beschaffbar. Das ist der ERWARTETE Zustand und kein "
              "Befund — nicht umbauen, nicht selbst bauen.")
        return 0
    print()
    for b in befunde:
        print(f"BEFUND  {b}")
    print(f"\n{len(befunde)} Befund(e): die Lage hat sich gedreht.")
    return 1


# ═══ 1c. DIE GEGENPROBE ZUR LAGE-WACHE (offline, Attrappen) ════════════════
#
# Eine Wache, die nur im erwarteten Zustand geprueft wurde, ist ungeprueft:
# „gruen" kann heissen, dass sie schweigt, weil sie nie etwas sagt (llmwiki
# `gegenprobe-statt-gruen-glauben`). Hier laufen darum ECHTE, wenn auch
# selbstgebaute Paketindizes durch denselben Auswerteweg — xz/gzip, dieselbe
# Stanza-Zaehlung, dieselbe symbols-Suche. Eine zweite Kopie der Auswertung
# nur fuer den Test gaebe es nicht: die wuerde mitaltern, ohne mitzupruefen.

def _attrappe(*, gedreht: bool, leer: bool = False):
    import gzip
    import lzma

    def madison_json(fassung: str, suite: str = "stable") -> str:
        return json.dumps([{"wpewebkit": {suite: {fassung: {"component": "main"}}}}])

    def symbols(n: int, drm: bool) -> str:
        kopf = "libWPEWebKit-2.0.so.1 libwpewebkit-2.0-1 #MINVER#\n"
        zeilen = [" webkit_web_view_new@Base 2.48.0",
                  " webkit_settings_new@Base 2.48.0"]
        if drm:
            zeilen.append(" wpe_display_drm_new@Base 2.54.0")
            zeilen.append(" wpe_display_drm_connect@Base 2.54.0")
        for i in range(n):
            zeilen.append(f" wpe_view_set_toplevel_{i}@Base 2.54.0")
            zeilen.append(f" wpe_toplevel_fullscreen_{i}@Base 2.54.0")
        return kopf + "\n".join(zeilen) + "\n"

    def index(pakete: list[str], fuellung: int) -> bytes:
        stanzas = []
        for i in range(fuellung):
            stanzas.append(f"Package: fuellpaket-{i}\nVersion: 1.0\n"
                           f"Architecture: arm64\n")
        for p in pakete:
            stanzas.append(f"Package: {p}\nVersion: 2.54.0-2~bpo13+1\n"
                           f"Architecture: arm64\n")
        return "\n".join(stanzas).encode()

    def holen(url: str, roh: bool = False, grenze: int = 40):
        if leer:
            return None if roh else "__FEHLER__ Attrappe: kein Netz"
        if "madison" in url and "s=trixie-backports" in url:
            if gedreht:
                return madison_json("2.54.0-2~bpo13+1", "stable-backports")
            return "[]"
        if "madison" in url:
            return madison_json("2.56.0-1" if gedreht else "2.48.3-1")
        if "symbols" in url:
            return symbols(120, drm=True) if gedreht else symbols(0, drm=False)
        if "trixie-backports" in url:
            return lzma.compress(index(
                ["libwpewebkit-2.0-1", "cog"] if gedreht else [], 3419))
        if "raspberrypi" in url:
            p = list(LAGE_STAND["rpi_pakete"])
            if gedreht:
                p.append("cog")
            return gzip.compress(index(p, 1469))
        raise AssertionError(f"Attrappe kennt die Adresse nicht: {url}")

    return holen


def gegenprobe() -> int:
    fehler = 0

    print("GEGENPROBE DER LAGE-WACHE — beide Richtungen, offline an Attrappen\n")

    b, h = lage_urteilen(lage_messen(_attrappe(gedreht=False)))
    if b:
        print(f"BEFUND  Lage wie heute: die Wache schlaegt an, obwohl nichts "
              f"passiert ist — sie waere dauerrot. Gemeldet: {b}")
        fehler += 1
    else:
        print(f"  1  Lage wie am {LAGE_STAND['gemessen']}   -> schweigt   "
              f"({len(h)} Hinweis(e)) — richtig")

    b, h = lage_urteilen(lage_messen(_attrappe(gedreht=True)))
    erwartet = {
        "WPEPlatform in stable": any("IN DEBIAN STABLE ANGEKOMMEN" in x for x in b),
        "Backport (madison)": any("trixie-backports:" in x for x in b),
        "Backport (Index)": any("trixie-backports/main/arm64" in x for x in b),
        "Raspberry-Pi-Quelle": any("raspberrypi" in x for x in b),
    }
    fehlend = [k for k, v in erwartet.items() if not v]
    if fehlend:
        print(f"BEFUND  Gedrehte Lage: die Wache uebersieht {', '.join(fehlend)}. "
              f"Eine Wache, die im Ernstfall still bleibt, ist keine.")
        fehler += 1
    else:
        print(f"  2  WPEPlatform aufgetaucht          -> {len(b)} Befund(e) "
              f"— alle vier Orte gemeldet")

    b, h = lage_urteilen(lage_messen(_attrappe(gedreht=False, leer=True)))
    if b:
        print(f"BEFUND  Ohne Netz meldet die Wache {len(b)} Befund(e), statt "
              f"NICHT GEMESSEN zu sagen — so wird sie im Laeufer ueberlesen.")
        fehler += 1
    elif len(h) < 4:
        print(f"BEFUND  Ohne Netz nennt die Wache nur {len(h)} unmessbare "
              f"Stelle(n) statt aller vier — eine davon wird stillschweigend "
              f"als 'unveraendert' verbucht.")
        fehler += 1
    else:
        print(f"  3  kein Netz                        -> schweigt, "
              f"{len(h)} x NICHT GEMESSEN — richtig")

    print(f"\n3 Richtungen geprueft, {fehler} Befund(e).")
    return 1 if fehler else 0


# ═══ 2. DIE STELLEN IM BAUM ════════════════════════════════════════════════

def _lies(rel: str) -> list[str]:
    p = WURZEL / rel
    if not p.is_file():
        return []
    return p.read_text(encoding="utf-8", errors="replace").splitlines()


def _angebotene_browser() -> list[str]:
    """Was der Eltern-Bereich zur Wahl stellt — aus konfiguration.ts gelesen.

    NICHT ueber den Dateinamen gesucht, sondern ueber das Feld `id:
    'kioskBrowser'` und die darauf folgende `festeAuswahl`-Liste: der
    Dateiname kann wandern, das Feld ist die Sache selbst.
    """
    z = _lies("src/backend-api/src/konfiguration.ts")
    if not z:
        return []
    text = "\n".join(z)
    m = re.search(r"id:\s*'kioskBrowser'.*?festeAuswahl:\s*\[(.*?)\]", text, re.S)
    if not m:
        return []
    return re.findall(r"wert:\s*'([^']+)'", m.group(1))


def stellen(nur_wache: bool) -> int:
    fehler = 0
    angeboten = _angebotene_browser()
    if not angeboten:
        print("BEFUND  konfiguration.ts: Feld 'kioskBrowser' oder seine "
              "auswahl-Liste nicht gefunden")
        return 1

    pakete_text = "\n".join(_lies("scripts/mupibox/mixpi-kiosk-pakete.sh"))
    m = re.search(r"case\s+\"\$\{BROWSER\}\"\s+in(.*?)esac", pakete_text, re.S)
    gekannt = re.findall(r"^\s*([a-z0-9-]+)\)", m.group(1), re.M) if m else []

    start_text = "\n".join(_lies("scripts/chromium-autostart.sh"))
    # Ein Rueckfall ist: irgendwo wird KIOSK_BROWSER wieder auf chromium
    # gesetzt. Das ist das Merkmal der SACHE (jemand kann umkehren), nicht
    # der Name einer Zeile — ein Umbau darf sie verschieben, nicht streichen.
    hat_rueckfall = re.search(r'KIOSK_BROWSER\s*=\s*"chromium"', start_text) is not None

    print(f"Eltern-Bereich bietet an: {', '.join(angeboten)}")
    print(f"mixpi-kiosk-pakete.sh kennt: {', '.join(gekannt) or '(nichts)'}")
    print(f"Rueckfall auf Chromium in chromium-autostart.sh: "
          f"{'ja' if hat_rueckfall else 'NEIN'}\n")

    for b in angeboten:
        if b not in gekannt:
            print(f"BEFUND  '{b}' steht im Eltern-Bereich, aber nicht im "
                  f"case von mixpi-kiosk-pakete.sh — der Schalter zeigte "
                  f"auf ein Programm, das die Box nie nachholt")
            fehler += 1
    if not hat_rueckfall:
        print("BEFUND  chromium-autostart.sh setzt KIOSK_BROWSER nirgends "
              "auf \"chromium\" zurueck — ohne Rueckfall darf der Schalter "
              "gar nicht angeboten werden (llmwiki "
              "kiosk-browser-umschaltbar-mit-rueckfall)")
        fehler += 1

    if not nur_wache:
        # NUR VERFOLGTE DATEIEN. `git ls-files` sieht Unversioniertes nicht
        # (llmwiki: verweis-wache-las-nur-verfolgtes-und-verfehlte-die-neue-datei)
        # — eine frisch
        # angelegte, noch nicht committete Datei fehlt hier. Die WACHE oben
        # ist davon nicht betroffen: sie liest ihre drei Pfade direkt.
        print("\nWAS EIN UMBAU BERUEHRT — Stellen, die 'cog' namentlich "
              "nennen (nur verfolgte Textdateien):")
        aus = subprocess.run(["git", "ls-files"], cwd=WURZEL,
                             capture_output=True, text=True).stdout.split()
        muster = re.compile(r"\bcog\b", re.I)
        for rel in aus:
            if rel.startswith((".claude/", "src/deploy/", "AUDIT-", "llmwiki/",
                               "bin/", "screenshots/")):
                continue
            p = WURZEL / rel
            try:
                roh = p.read_bytes()
            except OSError:
                continue
            # BILDER UND KOMPILATE FALLEN RAUS. In einer PNG-Datei steht das
            # Byte-Trio "cog" zufaellig — ein Treffer dort ist keine Stelle,
            # die jemand aendern muesste (llmwiki:
            # kommentar-und-kompilat-sind-keine-gegenstelle). Merkmal ist das
            # NUL-Byte, nicht die Endung: eine neue Bildart faellt sonst
            # wieder durch.
            if b"\x00" in roh[:4096]:
                continue
            zeilen = roh.decode("utf-8", "replace").splitlines()
            nr = [i + 1 for i, z in enumerate(zeilen) if muster.search(z)]
            if nr:
                kurz = ", ".join(str(x) for x in nr[:12])
                mehr = f" (+{len(nr) - 12})" if len(nr) > 12 else ""
                print(f"  {rel:<52} {len(nr):>3}x  Z. {kurz}{mehr}")

    print(f"\n{len(angeboten)} angebotene(r) Browser geprueft, {fehler} Befund(e).")
    return 1 if fehler else 0


# ═══ 3. DIE BOX ════════════════════════════════════════════════════════════

BOX_BEFEHL = r"""
echo "###zeit"; date "+%Y-%m-%d %H:%M:%S"
echo "###uptime"; uptime
echo "###schalter"; /usr/bin/jq -r '.mupibox.kioskBrowser // "(fehlt)"' /etc/mupibox/mupiboxconfig.json 2>/dev/null
echo "###seitengroesse"; getconf PAGESIZE
echo "###prozesse"; ps -eo user,pid,rss,comm,args --sort=-rss | grep -iE "chromium|(^|/)cog( |$)|WPEWebProcess|WPENetworkProcess|WPEGPUProcess|Xorg" | grep -v grep
echo "###free"; free -k
echo "###dpkg"; dpkg-query -W -f='${Package} ${Version}\n' chromium cog libgles2 libwpewebkit-2.0-1 libwpe-1.0-1 libwpebackend-fdo-1.0-1 2>/dev/null
echo "###policy"; apt-cache policy libwpewebkit-2.0-1 cog 2>/dev/null | grep -E "Installed|Candidate|^ +[0-9]+ http"
"""


def _abschnitte(text: str) -> dict[str, list[str]]:
    d: dict[str, list[str]] = {}
    schluessel = None
    for z in text.splitlines():
        if z.startswith("###"):
            schluessel = z[3:].strip()
            d[schluessel] = []
        elif schluessel:
            d[schluessel].append(z)
    return d


def box(ziel: str, wdh: int, abstand: int) -> int:
    laeufe = []
    for i in range(wdh):
        if i:
            print(f"  … {abstand} s Abstand (llmwiki einmal-hinsehen-ist-keine-messung)")
            time.sleep(abstand)
        r = subprocess.run(
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=12", ziel, BOX_BEFEHL],
            capture_output=True, text=True, timeout=180)
        if r.returncode:
            print(f"NICHT GEMESSEN: ssh {ziel} endete mit {r.returncode}: "
                  f"{r.stderr.strip()[:200]}")
            return 2
        laeufe.append(_abschnitte(r.stdout))

    erste = laeufe[0]
    print(f"BOX {ziel}")
    print(f"  Schalter mupibox.kioskBrowser : "
          f"{' '.join(erste.get('schalter', ['?'])).strip()}")
    print(f"  Seitengroesse                 : "
          f"{' '.join(erste.get('seitengroesse', ['?'])).strip()} Byte "
          f"(Pi 5: 16384 — /proc/statm NICHT mit 4096 rechnen)")
    print("  Pakete:")
    for z in erste.get("dpkg", []):
        if z.strip():
            print(f"    {z.strip()}")
    print("  apt-Kandidat:")
    for z in erste.get("policy", []):
        if z.strip():
            print(f"    {z.strip()}")

    print("\n  Messreihe (RSS ist KEIN PSS — gemeinsame Seiten mehrfach gezaehlt):")
    for lauf in laeufe:
        zeit = " ".join(lauf.get("zeit", ["?"])).strip()
        familien: dict[str, list[int]] = {}
        for z in lauf.get("prozesse", []):
            t = z.split(None, 4)
            if len(t) < 4 or not t[2].isdigit():
                continue
            comm, rss = t[3], int(t[2])
            if comm.startswith("chromium") or comm.startswith("chrome_"):
                fam = "chromium"
            elif comm == "Xorg":
                fam = "Xorg"
            elif comm == "cog" or comm.startswith("WPE"):
                fam = "cog/WPE"
            else:
                continue
            familien.setdefault(fam, []).append(rss)
        frei = {}
        for z in lauf.get("free", []):
            t = z.split()
            if t and t[0] == "Mem:" and len(t) >= 7:
                frei = {"gesamt": int(t[1]), "belegt": int(t[2]),
                        "verfuegbar": int(t[6])}
            if t and t[0] == "Swap:" and len(t) >= 3:
                frei["swap_belegt"] = int(t[2])
        teile = [f"{f}: {len(v)} Proz., RSS {sum(v)//1024} MB"
                 for f, v in sorted(familien.items())]
        print(f"    {zeit}  " + " | ".join(teile) if teile
              else f"    {zeit}  KEIN Kiosk-Prozess gefunden")
        if frei:
            print(f"      free: gesamt {frei['gesamt']//1024} MB, "
                  f"belegt {frei['belegt']//1024} MB, "
                  f"verfuegbar {frei['verfuegbar']//1024} MB, "
                  f"Swap belegt {frei.get('swap_belegt', 0)//1024} MB")
    print(f"\n  {' '.join(erste.get('uptime', ['?'])).strip()}")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__ and __doc__.splitlines()[0])
    p.add_argument("--quellen", action="store_true", help="Paketindex draussen messen (Netz)")
    p.add_argument("--stellen", action="store_true", help="Stellen im Baum auflisten")
    p.add_argument("--lage", action="store_true",
                   help="hat sich die WPEPlatform-Lage gedreht? (Netz; ohne Netz "
                        "NICHT GEMESSEN und gruen)")
    p.add_argument("--gegenprobe", action="store_true",
                   help="taugt die Lage-Wache? beide Richtungen, offline")
    p.add_argument("--box", metavar="ZIEL", help="nur lesend am Geraet messen")
    p.add_argument("--wdh", type=int, default=2, help="Messungen am Geraet (Vorgabe 2)")
    p.add_argument("--abstand", type=int, default=180, help="Sekunden dazwischen")
    a = p.parse_args()

    if not (a.quellen or a.stellen or a.box or a.lage or a.gegenprobe):
        return stellen(nur_wache=True)   # Wachenlauf: offline, schnell
    r = 0
    erste = True

    def trenner():
        nonlocal erste
        if not erste:
            print()
        erste = False

    if a.gegenprobe:
        trenner()
        r |= gegenprobe()
    if a.lage:
        trenner()
        r |= lage()
    if a.quellen:
        trenner()
        r |= quellen()
    if a.stellen:
        trenner()
        r |= stellen(nur_wache=False)
    if a.box:
        trenner()
        r |= box(a.box, max(1, a.wdh), max(0, a.abstand))
    return r


if __name__ == "__main__":
    sys.exit(main())
