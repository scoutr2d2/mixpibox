#!/usr/bin/env python3
"""PAKETBUENDEL FUER DIE FRISCHE KARTE — OHNE BOX, OHNE apt, nur Python.

WOZU ES DAS GIBT (31.08.2026)
Betreiber: „das wlan im pi ist ja schnarch langsam". Der Installer laedt auf
der Box rund 33 Pakete samt Abhaengigkeiten ueber genau dieses WLAN. Liegen sie
schon in `/var/cache/apt/archives/`, nimmt apt sie von dort.

WARUM DIE ERSTE FASSUNG WEG MUSSTE — der Denkfehler, vom Betreiber gefunden
Sie packte das Buendel AUF EINER LAUFENDEN BOX (`apt-get install -d` per SSH).
Fuer Achim ging das, weil ein Pi 5 im Haus steht. Fuer jeden anderen, der
`sdstart` benutzt, gibt es weder Box noch Adresse: „die ip existiert ja noch
nicht und ein pi5 existiert ja bei jemand anderes auch nicht". Ein
Beschaffungsweg, der ein fertiges Geraet voraussetzt, hilft genau dort nicht,
wo man ihn braucht — beim ERSTEN Aufsetzen.

WARUM AUCH `apt` AUF DEM ARBEITSRECHNER NICHT GEHT
Der naechste Entwurf war `apt-get --print-uris` mit eigenem Wurzelverzeichnis.
Dieser Rechner laeuft aber unter CachyOS: kein apt, kein dpkg, kein
python-apt. Und bei anderen Nutzern kann man es genausowenig voraussetzen —
von Windows spaeter ganz zu schweigen. Also: die Debian-Indizes selbst lesen.
Das braucht nichts ausser Python und laeuft ueberall gleich.

DIE AUFLOESUNG IST ABSICHTLICH EINFACH, UND DAS IST VERTRETBAR
Sie folgt `Depends` (ohne `Recommends`), nimmt bei Alternativen (`a | b`) die
erste Wahl und beachtet `Provides`. Versionsbedingungen prueft sie NICHT — sie
nimmt, was im Index steht.

Das ist gut genug, WEIL DER ZWISCHENSPEICHER NICHT VOLLSTAENDIG SEIN MUSS.
Ein Paket zu viel schadet nicht (apt ignoriert es), ein fehlendes auch nicht
(apt laedt es nach). Der Cache ist eine Abkuerzung, keine Installation. Genau
deshalb darf hier vereinfacht werden, wo ein Paketmanager es nicht duerfte —
und deshalb steht am Ende, wie viele Pakete es geworden sind, statt einer
Erfolgsmeldung.

WAS GEPRUEFT WIRD: jede geladene Datei gegen den SHA256 aus dem Index. Ein
halb geladenes .deb im Zwischenspeicher waere schlimmer als keines — apt
wuerde daran haengenbleiben statt es neu zu holen.

AUFRUF
    tools/paketbuendel-bauen.py                 # Liste aus den Rezepten
    tools/paketbuendel-bauen.py --pakete mpv,jq
    tools/paketbuendel-bauen.py --pruefen
    tools/paketbuendel-bauen.py --suite trixie --arch arm64

RUECKGABEWERTE
    0  Buendel liegt (oder --pruefen: es gibt eines)
    1  Aufruf oder Umgebung — Indizes nicht erreichbar
    2  nichts geladen oder Pruefsumme falsch
"""

from __future__ import annotations

import argparse
import hashlib
import gzip
import io
import json
import lzma
import re
import sys
import tarfile
import time
import urllib.error
import urllib.request
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
REZEPTE = WURZEL / "remote-step-installer" / "recipes"
ZIEL_VORGABE = WURZEL / "remote-step-installer" / "dateien" / "paketbuendel.tgz"

# Beide Quellen werden gebraucht: ein Teil der Pakete kommt NICHT von Debian.
# `xserver-xorg-legacy 2:21.1.16-1.3+rpt1+deb13u3` aus dem Lauf-Protokoll vom
# 31.08.2026 traegt `+rpt1` — das ist Raspberry Pi OS. Wer nur deb.debian.org
# nimmt, bekommt genau die Pakete nicht, die die Box eigentlich braucht.
QUELLEN = [
    ("http://deb.debian.org/debian", "{suite}", ["main", "contrib", "non-free-firmware"]),
    ("http://archive.raspberrypi.com/debian", "{suite}", ["main"]),
]
UA = "remote-step-installer/paketbuendel"

PAKETNAME = re.compile(r"^[a-z0-9][a-z0-9+.-]*[a-z0-9+]$")
PROSA = {"und", "oder", "holt", "startet", "ihn", "was", "beim", "install",
         "installieren", "installiert", "dann", "wird", "werden", "auch"}


def hole(url: str, zeitlimit: int = 60) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=zeitlimit) as r:
        return r.read()


def pakete_aus_rezepten() -> list[str]:
    """apt-Zeilen der Rezepte einsammeln, Kommentare ausgenommen.

    Positiv gegen das Debian-Namensmuster geprueft (Policy 5.6.1). Eine
    Verbotsliste von Fuellwoertern hatte hier schon `installieren.`
    durchgelassen — das Wort stand drauf, aber mit Satzpunkt, und Punkte sind
    in Paketnamen erlaubt."""
    namen: set[str] = set()
    for f in sorted(REZEPTE.glob("*.yaml")):
        for zeile in f.read_text(errors="replace").splitlines():
            if zeile.strip().startswith("#"):
                continue
            for m in re.finditer(r"apt(?:-get)?\s+install\s+([^&|;<>\n]*)", zeile):
                for wort in m.group(1).split():
                    w = wort.strip("`\"',").lower()
                    if PAKETNAME.match(w) and w not in PROSA:
                        namen.add(w)
    return sorted(namen)


def index_lesen(suite: str, arch: str, sag) -> tuple[dict, dict]:
    """Alle Packages-Indizes holen und zu {name: eintrag} zusammenfassen.

    Zweiter Rueckgabewert ist die Provides-Zuordnung: viele Depends nennen
    einen virtuellen Namen (`awk`, `libgl1-mesa-glx`), den kein Paket traegt —
    ohne Provides bricht die Aufloesung dort grundlos ab."""
    pakete: dict[str, dict] = {}
    liefert: dict[str, str] = {}
    for basis, suite_muster, bereiche in QUELLEN:
        for bereich in bereiche:
            # ZWEI ENDUNGEN, WEIL DIE SPIEGEL SICH UNTERSCHEIDEN: deb.debian.org
            # liefert Packages.xz, archive.raspberrypi.com NUR Packages.gz
            # (am 31.08.2026 geprueft: .xz dort 404, .gz 200). Wer nur .xz
            # probiert, verliert stillschweigend die halbe Paketwelt — und
            # zwar genau die Haelfte mit den rpt-Paketen, die die Box braucht.
            stamm = f"{basis}/dists/{suite_muster.format(suite=suite)}/{bereich}/binary-{arch}/Packages"
            roh = None
            for endung, auspacken in ((".xz", lzma.decompress), (".gz", gzip.decompress)):
                try:
                    roh = auspacken(hole(stamm + endung))
                    break
                except (urllib.error.URLError, OSError, lzma.LZMAError, EOFError):
                    continue
            if roh is None:
                sag(f"  uebersprungen: {bereich} @ {basis} (weder .xz noch .gz)")
                continue
            anzahl = 0
            for block in roh.decode("utf-8", "replace").split("\n\n"):
                if not block.strip():
                    continue
                feld: dict[str, str] = {}
                schluessel = None
                for z in block.splitlines():
                    if z[:1] in (" ", "\t") and schluessel:
                        continue
                    if ":" in z:
                        schluessel, _, wert = z.partition(":")
                        feld[schluessel.strip()] = wert.strip()
                name = feld.get("Package")
                if not name or "Filename" not in feld:
                    continue
                # Erster Treffer gewinnt: Debian steht vor Raspberry Pi in der
                # Liste, aber rpt-Pakete tragen dieselbe Version+rptN und sind
                # fuer die Box die richtigen. Deshalb NICHT ueberschreiben,
                # sondern die hoehere Version nehmen.
                alt = pakete.get(name)
                if alt is None or feld.get("Version", "") > alt.get("Version", ""):
                    feld["_basis"] = basis
                    pakete[name] = feld
                    for v in feld.get("Provides", "").split(","):
                        v = v.split("(")[0].strip()
                        if v:
                            liefert.setdefault(v, name)
                anzahl += 1
            sag(f"  {bereich} @ {basis.split('//')[1].split('/')[0]}: {anzahl} Eintraege")
    return pakete, liefert


def aufloesen(wunsch: list[str], pakete: dict, liefert: dict, sag) -> tuple[list[str], list[str]]:
    """Depends iterativ folgen. Gibt (gefunden, unbekannt)."""
    offen, fertig, fehlt = list(wunsch), [], []
    gesehen = set()
    while offen:
        name = offen.pop(0)
        if name in gesehen:
            continue
        gesehen.add(name)
        eintrag = pakete.get(name) or pakete.get(liefert.get(name, ""))
        if eintrag is None:
            fehlt.append(name)
            continue
        fertig.append(eintrag["Package"])
        for teil in eintrag.get("Depends", "").split(","):
            # Bei `a | b` die erste Wahl nehmen — wie apt es meistens tut.
            # `perl:any` ist `perl` — der Multi-Arch-Zusatz gehoert nicht zum
            # Namen. Ohne das Abschneiden meldet die Aufloesung ihn als
            # unbekannt und laesst seine Abhaengigkeiten weg.
            erste = teil.split("|")[0].split("(")[0].split(":")[0].strip()
            if erste and erste not in gesehen:
                offen.append(erste)
    return sorted(set(fertig)), sorted(set(fehlt))


def pruefen(ziel: Path) -> int:
    blatt = ziel.with_suffix(".json")
    if not ziel.is_file() or not blatt.is_file():
        print(f"Kein Buendel unter {ziel}", file=sys.stderr)
        return 1
    d = json.loads(blatt.read_text())
    tage = (time.time() - d.get("gebaut_um", 0)) / 86400
    print(f"BUENDEL  {ziel}  ({ziel.stat().st_size / 1e6:.0f} MB)")
    print(f"  Suite/Arch  {d.get('suite')} / {d.get('arch')}")
    print(f"  Pakete      {d.get('anzahl')} (angefordert {len(d.get('angefordert', []))})")
    print(f"  gebaut      vor {tage:.0f} Tagen, ohne Box")
    if d.get("unbekannt"):
        print(f"  nicht gefunden: {', '.join(d['unbekannt'])}")
    if tage > 30:
        print("  ALT: apt laedt den Rest nach; neu bauen lohnt.")
    return 0


def main() -> int:
    t = argparse.ArgumentParser(description="Paketbuendel ohne Box bauen (nur Python)")
    t.add_argument("--pakete", help="Komma-Liste; sonst aus den Rezepten")
    t.add_argument("--ziel", type=Path, default=ZIEL_VORGABE)
    t.add_argument("--suite", default="trixie")
    t.add_argument("--arch", default="arm64")
    t.add_argument("--maxmb", type=int, default=0,
                   help="Obergrenze in MB — nimmt die GROESSTEN Pakete zuerst "
                        "(0 = alles). Fuer die 128-MB-Bootpartition z. B. 70.")
    t.add_argument("--pruefen", action="store_true")
    a = t.parse_args()
    if a.pruefen:
        return pruefen(a.ziel)

    wunsch = ([p.strip() for p in a.pakete.split(",") if p.strip()]
              if a.pakete else pakete_aus_rezepten())
    if not wunsch:
        print("Keine Pakete ermittelt.", file=sys.stderr)
        return 1

    print(f"ZIEL    {a.suite} / {a.arch}, {len(wunsch)} angeforderte Pakete")
    print("Indizes holen …")
    pakete, liefert = index_lesen(a.suite, a.arch, print)
    if not pakete:
        print("Kein einziger Index erreichbar — Netz?", file=sys.stderr)
        return 1
    print(f"  {len(pakete)} Pakete bekannt\n")

    alle, fehlt = aufloesen(wunsch, pakete, liefert, print)
    if fehlt:
        print(f"Nicht im Index (uebergangen): {', '.join(fehlt)}")
    print(f"Aufgeloest: {len(alle)} Pakete werden geladen\n")

    # ── OBERGRENZE: DIE GROESSTEN ZUERST ───────────────────────────────────
    # Passt das ganze Buendel nicht (128-MB-Bootpartition unter Windows), ist
    # eine Teilmenge immer noch der halbe Gewinn — aber nur, wenn es die
    # richtige ist. Gespart wird UEBERTRAGUNGSZEIT, und die haengt an Bytes,
    # nicht an der Paketzahl: 50 kleine Pakete wiegen weniger als ein
    # nodejs. Deshalb absteigend nach Groesse, nicht alphabetisch und nicht
    # in Abhaengigkeitsreihenfolge.
    #
    # Dass dabei Abhaengigkeitsketten zerreissen, ist ohne Belang: apt laedt
    # nach, was fehlt. Der Zwischenspeicher ist eine Abkuerzung, keine
    # Installation — genau deshalb darf hier gekuerzt werden.
    if a.maxmb:
        budget = a.maxmb * 1_000_000
        nach_groesse = sorted(alle, key=lambda n: int(pakete[n].get("Size", 0) or 0), reverse=True)
        gewaehlt, summe = [], 0
        for name in nach_groesse:
            gr = int(pakete[name].get("Size", 0) or 0)
            if summe + gr > budget:
                continue
            gewaehlt.append(name)
            summe += gr
        weg = len(alle) - len(gewaehlt)
        print(f"Obergrenze {a.maxmb} MB: {len(gewaehlt)} Pakete ({summe / 1e6:.0f} MB), "
              f"{weg} uebergangen — apt laedt die nach.")
        alle = gewaehlt

    a.ziel.parent.mkdir(parents=True, exist_ok=True)
    puffer = io.BytesIO()
    geladen = bytes_gesamt = 0
    with tarfile.open(fileobj=puffer, mode="w:gz") as tar:
        for i, name in enumerate(alle, 1):
            e = pakete[name]
            url = f"{e['_basis']}/{e['Filename']}"
            try:
                inhalt = hole(url, zeitlimit=120)
            except (urllib.error.URLError, OSError) as f:
                print(f"  [{i}/{len(alle)}] {name}: NICHT geladen ({f})")
                continue
            # PRUEFSUMME: ein halbes .deb im Zwischenspeicher waere schlimmer
            # als keines — apt bliebe daran haengen, statt es neu zu holen.
            soll = e.get("SHA256", "")
            if soll and hashlib.sha256(inhalt).hexdigest() != soll:
                print(f"  [{i}/{len(alle)}] {name}: PRUEFSUMME FALSCH — verworfen")
                continue
            info = tarfile.TarInfo(Path(e["Filename"]).name)
            info.size = len(inhalt)
            info.mode = 0o644
            tar.addfile(info, io.BytesIO(inhalt))
            geladen += 1
            bytes_gesamt += len(inhalt)
            if i % 20 == 0 or i == len(alle):
                print(f"  [{i}/{len(alle)}] {bytes_gesamt / 1e6:.0f} MB")

    if geladen == 0:
        print("Nichts geladen.", file=sys.stderr)
        return 2
    a.ziel.write_bytes(puffer.getvalue())
    a.ziel.with_suffix(".json").write_text(json.dumps({
        "suite": a.suite, "arch": a.arch, "anzahl": geladen,
        "angefordert": wunsch, "unbekannt": fehlt, "gebaut_um": int(time.time()),
        "groesse": a.ziel.stat().st_size,
        "sha256": hashlib.sha256(a.ziel.read_bytes()).hexdigest(),
    }, ensure_ascii=False, indent=2))

    print(f"\nFERTIG  {a.ziel}  ({a.ziel.stat().st_size / 1e6:.0f} MB, {geladen} Pakete)")
    print("        sdstart legt es beim naechsten Schreiben mit auf die Karte.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
