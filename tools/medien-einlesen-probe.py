#!/usr/bin/env python3
"""
MEDIEN-EINLESEN-PROBE — was „Medien neu einlesen" mit data.json macht.

DIE FRAGE:
  „Ein Elternteil drueckt den Knopf (oder der change_checker drueckt ihn von
   selbst), waehrend der USB-Stick nicht steckt. Es hat kein zweites Geraet,
   kein SSH und keine Anleitung. Kommt seine Mediathek zurueck?"

Gemessen wird NICHT gelesen: jede Lage baut einen Sandkasten unter /tmp mit
echten Ordnern, laesst die ECHTEN Skripte (scripts/mupibox/data_clean.sh,
scripts/mupibox/m3u_generator.sh) darin laufen und zaehlt hinterher nach.
Die Skripte nehmen ihre Orte aus MUPI_*-Variablen; ohne diese Variablen
zeigen sie auf die Box. AN DER BOX WIRD NICHTS GEAENDERT — die Probe fasst
sie nicht einmal an.

Die fuenf Lagen und die Gegenprobe:

  1. Ordner da                          -> Eintrag bleibt, Felder unveraendert
  2. Ordner weg, Kategorie hat Inhalt   -> Eintrag faellt        (GEGENPROBE)
  3. Kategorieordner leer               -> nichts faellt
  4. Einhaengepunkt ohne Einhaengung    -> nichts faellt
  5. Medienablage ganz weg              -> nichts faellt
  6. Handfelder (sortOrder, eigener
     Titel, eigenes Bild)               -> ueberleben, und zwar auch den
                                           anschliessenden m3u_generator
  7. Sicherung                          -> entsteht genau dann, wenn etwas
                                           faellt, und spielt zurueck
  8. Die alte Fassung zur Gegenrechnung -> verliert, was diese behaelt
  9. Haengende Freigabe                  -> kein Zugriff ohne Frist
 10. Sonderfaelle (leer, Umlaute und
     Anfuehrungszeichen, Eintrag ohne
     Titel, halb geschriebene Datei)

  python3 tools/medien-einlesen-probe.py
  python3 tools/medien-einlesen-probe.py --nur 4 --behalten
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
SKRIPTE = BAUM / "scripts" / "mupibox"
DATA_CLEAN = SKRIPTE / "data_clean.sh"
M3U = SKRIPTE / "m3u_generator.sh"

rot: list[str] = []
gruen = 0


def pruefe(was: str, bedingung: bool, beleg: str = "") -> None:
    global gruen
    if bedingung:
        gruen += 1
        print(f"  [ok]     {was}")
    else:
        rot.append(was)
        print(f"  [FEHLER] {was}")
        if beleg:
            for zeile in beleg.rstrip().splitlines():
                print(f"           {zeile}")


class Sandkasten:
    """Ein vollstaendiger Box-Nachbau unter /tmp — Ordner, data.json, fstab."""

    def __init__(self, name: str, behalten: bool = False) -> None:
        self.pfad = Path(tempfile.mkdtemp(prefix=f"mupi-einlesen-{name}-"))
        self.behalten = behalten
        self.config = self.pfad / "config"
        self.media = self.pfad / "media"
        self.cover = self.pfad / "www" / "cover"
        for d in (self.config, self.media, self.cover):
            d.mkdir(parents=True, exist_ok=True)
        self.data = self.config / "data.json"
        self.fstab = self.pfad / "fstab"
        self.mounts = self.pfad / "mounts"
        self.fstab.write_text("# leer\n")
        self.mounts.write_text("")

    # ── aufbauen ──────────────────────────────────────────────────────────
    def werk(self, kategorie: str, artist: str, titel: str, dateien: bool = True) -> Path:
        d = self.media / kategorie / artist / titel
        d.mkdir(parents=True, exist_ok=True)
        if dateien:
            (d / "01.mp3").write_bytes(b"x")
        return d

    def kategorie(self, name: str) -> Path:
        d = self.media / name
        d.mkdir(parents=True, exist_ok=True)
        return d

    def eintraege(self, liste: list[dict]) -> None:
        self.data.write_text(json.dumps(liste, indent=2, ensure_ascii=False))

    def gelesen(self) -> list[dict]:
        return json.loads(self.data.read_text())

    def als_einhaengeziel(self, pfad: Path, eingehaengt: bool = False) -> None:
        """Traegt den Pfad in die fstab ein — und nur dort, wenn er nicht
        eingehaengt sein soll. Genau so sieht ein nicht eingehaengter
        USB-Stick oder eine weggefallene Netzfreigabe aus."""
        self.fstab.write_text(
            self.fstab.read_text() + f"//server/medien {pfad} cifs defaults 0 0\n"
        )
        if eingehaengt:
            self.mounts.write_text(
                self.mounts.read_text() + f"//server/medien {pfad} cifs rw 0 0\n"
            )

    # ── laufen lassen ─────────────────────────────────────────────────────
    def umgebung(self) -> dict[str, str]:
        e = dict(os.environ)
        e.update(
            {
                "MUPI_CONFIG_DIR": str(self.config),
                "MUPI_DATA": str(self.data),
                "MUPI_COVER": str(self.cover),
                "MUPI_MEDIA": str(self.media),
                "MUPI_TMP_DATA": str(self.pfad / "cleaned_data.json"),
                "MUPI_SKRIPTE": str(SKRIPTE),
                "MUPI_FSTAB": str(self.fstab),
                "MUPI_MOUNTS": str(self.mounts),
                "MUPI_DATA_LOCK": str(self.pfad / "data.lock"),
                "MUPI_LOGO": str(self.pfad / "logo.jpg"),
                "MUPI_BESITZER": f"{os.getuid()}:{os.getgid()}",
                "MUPI_WARTE": "5",
            }
        )
        return e

    def aufraeumen_laufen(self) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["bash", str(DATA_CLEAN)],
            env=self.umgebung(),
            capture_output=True,
            text=True,
        )

    def einlesen_laufen(self) -> subprocess.CompletedProcess:
        (self.pfad / "logo.jpg").write_bytes(b"logo")
        return subprocess.run(
            ["bash", str(M3U)],
            env=self.umgebung(),
            capture_output=True,
            text=True,
        )

    def sicherungen(self) -> list[Path]:
        return sorted(self.config.glob("data-vor-aufraeumen-*.json"))

    def weg(self) -> None:
        if self.behalten:
            print(f"           (Sandkasten bleibt: {self.pfad})")
        else:
            shutil.rmtree(self.pfad, ignore_errors=True)


def eintrag(kategorie: str, artist: str, titel: str, **rest) -> dict:
    d = {
        "type": "library",
        "category": kategorie,
        "artist": artist,
        "title": titel,
        "cover": f"http://mupibox:8200/cover/{kategorie}/{artist}/{titel}/cover.jpg",
    }
    d.update(rest)
    return d


def titel_von(liste: list[dict]) -> set[str]:
    return {f"{e.get('category')}/{e.get('artist')}/{e.get('title')}" for e in liste}


# ── Lage 1: Ordner da ───────────────────────────────────────────────────────


def lage1(behalten: bool) -> None:
    print("\nLAGE 1 — der Ordner ist da")
    s = Sandkasten("da", behalten)
    s.werk("audiobook", "Bibi", "Folge 1")
    s.werk("audiobook", "Bibi", "Folge 2")
    s.eintraege([eintrag("audiobook", "Bibi", "Folge 1"), eintrag("audiobook", "Bibi", "Folge 2")])
    vorher = s.gelesen()
    p = s.aufraeumen_laufen()
    nachher = s.gelesen()
    pruefe("beide Eintraege bleiben", len(nachher) == 2, p.stdout + p.stderr)
    pruefe("und zwar unveraendert", nachher == vorher, f"{vorher}\n{nachher}")
    pruefe("keine Sicherung angelegt (nichts ist gefallen)", not s.sicherungen())
    s.weg()


# ── Lage 2: wirklich geloescht — DIE GEGENPROBE ─────────────────────────────


def lage2(behalten: bool) -> None:
    print("\nLAGE 2 — ein Werk ist WIRKLICH geloescht (Gegenprobe)")
    s = Sandkasten("geloescht", behalten)
    s.werk("audiobook", "Bibi", "Folge 1")
    # „Folge 2" gibt es auf der Platte nicht mehr, „Folge 1" schon.
    s.eintraege([eintrag("audiobook", "Bibi", "Folge 1"), eintrag("audiobook", "Bibi", "Folge 2")])
    p = s.aufraeumen_laufen()
    nach = titel_von(s.gelesen())
    pruefe(
        "das geloeschte Werk verschwindet (ein Schutz, der auch das verhindert, wird umgangen)",
        "audiobook/Bibi/Folge 2" not in nach,
        p.stdout + p.stderr,
    )
    pruefe("das vorhandene bleibt", "audiobook/Bibi/Folge 1" in nach)
    pruefe("und es wurde vorher gesichert", len(s.sicherungen()) == 1)
    if s.sicherungen():
        alt = json.loads(s.sicherungen()[0].read_text())
        pruefe("die Sicherung enthaelt den Stand VOR dem Eingriff", len(alt) == 2)
    s.weg()


# ── Lage 3: Kategorieordner leer ────────────────────────────────────────────


def lage3(behalten: bool) -> None:
    print("\nLAGE 3 — der Kategorieordner ist leer (Einhaengepunkt sieht genau so aus)")
    s = Sandkasten("leer", behalten)
    s.kategorie("audiobook")
    s.eintraege([eintrag("audiobook", "Bibi", "Folge 1"), eintrag("audiobook", "Benjamin", "Folge 7")])
    p = s.aufraeumen_laufen()
    pruefe("nichts faellt", len(s.gelesen()) == 2, p.stdout + p.stderr)
    pruefe("keine Sicherung noetig", not s.sicherungen())
    s.weg()


# ── Lage 4: Einhaengepunkt ohne Einhaengung ─────────────────────────────────


def lage4(behalten: bool) -> None:
    print("\nLAGE 4 — laut fstab ein Einhaengeziel, aber nichts eingehaengt")
    s = Sandkasten("nichteingehaengt", behalten)
    kat = s.kategorie("audiobook")
    # Der Ordner ist NICHT leer — ein Rest liegt darin. Ohne die fstab-Frage
    # wuerde die Basis also als „taugt" gelten und alles Fehlende fiele.
    (kat / "hinweis.txt").write_text("Reste vom letzten Mal")
    s.als_einhaengeziel(kat, eingehaengt=False)
    s.eintraege([eintrag("audiobook", "Bibi", "Folge 1")])
    p = s.aufraeumen_laufen()
    pruefe("nichts faellt, solange nichts eingehaengt ist", len(s.gelesen()) == 1, p.stdout + p.stderr)

    # Gegenprobe im selben Aufbau: ist die Freigabe DA (steht in /proc/mounts),
    # dann darf ein fehlendes Werk wieder fallen.
    s2 = Sandkasten("eingehaengt", behalten)
    kat2 = s2.kategorie("audiobook")
    s2.werk("audiobook", "Bibi", "Folge 1")
    s2.als_einhaengeziel(kat2, eingehaengt=True)
    s2.eintraege([eintrag("audiobook", "Bibi", "Folge 1"), eintrag("audiobook", "Bibi", "Folge 2")])
    p2 = s2.aufraeumen_laufen()
    nach = titel_von(s2.gelesen())
    pruefe(
        "ist die Freigabe eingehaengt, faellt das Fehlende wieder",
        "audiobook/Bibi/Folge 2" not in nach and "audiobook/Bibi/Folge 1" in nach,
        p2.stdout + p2.stderr,
    )
    s.weg()
    s2.weg()


# ── Lage 5: Medienablage ganz weg ───────────────────────────────────────────


def lage5(behalten: bool) -> None:
    print("\nLAGE 5 — die Medienablage ist ganz weg (Kategorieordner fehlt)")
    s = Sandkasten("weg", behalten)
    s.eintraege(
        [
            eintrag("audiobook", "Bibi", "Folge 1"),
            eintrag("music", "Rolf", "Album"),
            {"type": "spotify", "category": "playlist", "id": "abc", "title": "Kinderlieder"},
        ]
    )
    p = s.aufraeumen_laufen()
    pruefe("nichts faellt", len(s.gelesen()) == 3, p.stdout + p.stderr)

    # DAS IST DIE SACKGASSE SELBST: der Knopf „Medien neu einlesen" bzw. der
    # change_checker laeuft, WAEHREND der Stick nicht steckt. Voller Weg.
    p2 = s.einlesen_laufen()
    danach = s.gelesen()
    pruefe(
        "auch der volle Lauf (Medien neu einlesen) laesst die Mediathek stehen",
        len(danach) == 3,
        p2.stdout + p2.stderr + "\n" + json.dumps(danach, ensure_ascii=False),
    )

    # Und noch eine Stufe hoeher: media/ selbst existiert nicht.
    s2 = Sandkasten("keinmedia", behalten)
    shutil.rmtree(s2.media)
    s2.eintraege([eintrag("audiobook", "Bibi", "Folge 1")])
    p2 = s2.aufraeumen_laufen()
    pruefe("auch ohne media/ faellt nichts", len(s2.gelesen()) == 1, p2.stdout + p2.stderr)
    s.weg()
    s2.weg()


# ── Lage 6: Handfelder ──────────────────────────────────────────────────────


def lage6(behalten: bool) -> None:
    print("\nLAGE 6 — von Hand gesetzte Felder (der zweite Verlustweg)")
    s = Sandkasten("handfelder", behalten)
    s.werk("audiobook", "Bibi", "Folge 1")
    hand = eintrag(
        "audiobook",
        "Bibi",
        "Folge 1",
        sortOrder=3,
        aPartOfAll=True,
        cover="http://mupibox:8200/cover/eigen/bibi.jpg",
        artistcover="http://mupibox:8200/cover/eigen/bibi-artist.jpg",
    )
    # ES MUSS ETWAS FALLEN. Sonst geht data_clean.sh oben in den Zweig
    # „Nichts zu entfernen — data.json bleibt, wie sie ist", schreibt die Datei
    # ueberhaupt nicht neu, und die drei Aussagen unten waeren wahr, ohne dass
    # der jq-Umbau je gelaufen ist. Genau so stand es hier zuerst: gruen, ohne
    # die Zeile zu beruehren, die sie schuetzen sollen (nachgewiesen mit
    # tools/aussagen-halten.py). „Benjamin" hat keinen Ordner und faellt.
    s.eintraege([hand, eintrag("audiobook", "Benjamin", "Folge 9")])
    p = s.aufraeumen_laufen()
    nachher = s.gelesen()
    pruefe(
        "der Umbau ist WIRKLICH gelaufen — sonst haelt das Folgende nichts",
        "Eintrag/Eintraege entfernt" in p.stdout,
        p.stdout + p.stderr,
    )
    pruefe("der Eintrag ueberlebt das Aufraeumen", len(nachher) == 1, p.stdout + p.stderr)
    if nachher:
        pruefe("sortOrder steht noch da", nachher[0].get("sortOrder") == 3)
        pruefe("aPartOfAll steht noch da", nachher[0].get("aPartOfAll") is True)
        pruefe("das eigene Titelbild steht noch da", nachher[0].get("cover", "").endswith("bibi.jpg"))
        pruefe(
            "das eigene Interpretenbild steht noch da",
            nachher[0].get("artistcover", "").endswith("bibi-artist.jpg"),
        )
        pruefe(
            "es ist ueberhaupt kein Feld verlorengegangen",
            set(nachher[0]) == set(hand),
            f"vorher {sorted(hand)}\nnachher {sorted(nachher[0])}",
        )

    # Und jetzt der ganze Weg: „Medien neu einlesen" von vorn. Genau hier
    # entstand frueher der zweite, nackte Eintrag daneben — der Generator
    # erkannte den Eintrag an der Bildadresse nicht wieder.
    p2 = s.einlesen_laufen()
    danach = s.gelesen()
    treffer = [e for e in danach if e.get("title") == "Folge 1"]
    pruefe(
        "nach dem vollen Einlesen steht der Eintrag GENAU EINMAL da",
        len(treffer) == 1,
        p2.stdout + p2.stderr + "\n" + json.dumps(danach, ensure_ascii=False, indent=1),
    )
    if len(treffer) == 1:
        pruefe("und immer noch mit sortOrder", treffer[0].get("sortOrder") == 3)
        pruefe("und immer noch mit dem eigenen Bild", treffer[0].get("cover", "").endswith("bibi.jpg"))
    s.weg()


# ── Lage 7: Sicherung und Rueckweg ──────────────────────────────────────────


def lage7(behalten: bool) -> None:
    print("\nLAGE 7 — die Sicherung ist der Rueckweg")
    s = Sandkasten("sicherung", behalten)
    s.werk("audiobook", "Bibi", "Folge 1")
    s.eintraege([eintrag("audiobook", "Bibi", "Folge 1"), eintrag("audiobook", "Bibi", "Folge 2")])
    vorher = s.gelesen()
    s.aufraeumen_laufen()
    sich = s.sicherungen()
    pruefe("es liegt genau eine Sicherung da", len(sich) == 1)
    if sich:
        muster = re.compile(r"^data-vor-aufraeumen-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$")
        pruefe(
            "ihr Name passt auf das Muster, das die Verwaltung kennt "
            "(SICHERUNG_MUSTER in server.ts) — also greift der vorhandene Rueckweg",
            bool(muster.match(sich[0].name)),
            sich[0].name,
        )
        pruefe("sie enthaelt den Stand von vorher", json.loads(sich[0].read_text()) == vorher)
    # Mehr als drei sammeln sich nicht an.
    for _ in range(5):
        s.eintraege(vorher)
        s.aufraeumen_laufen()
    pruefe("es bleiben hoechstens drei Sicherungen liegen", len(s.sicherungen()) <= 3,
           str([p.name for p in s.sicherungen()]))
    s.weg()


# ── Lage 8: die alte Fassung zur Gegenrechnung ──────────────────────────────


def lage8(behalten: bool) -> None:
    print("\nLAGE 8 — was die alte Fassung im selben Aufbau getan haette")
    # Fest auf den Stand vor der Reparatur gezeigt und NICHT auf HEAD: sonst
    # misst diese Lage nach dem naechsten Commit die neue Fassung gegen sich
    # selbst und wird gruen, ohne etwas zu belegen. eaa89654 ("Fix data_clean",
    # 14.12.2023) ist der letzte Stand mit `add_item=0`.
    alt_text = subprocess.run(
        ["git", "show", "eaa89654:scripts/mupibox/data_clean.sh"],
        cwd=BAUM,
        capture_output=True,
        text=True,
    )
    if alt_text.returncode != 0:
        pruefe("die alte Fassung liess sich aus git holen", False, alt_text.stderr)
        return
    s = Sandkasten("altefassung", behalten)
    s.werk("audiobook", "Bibi", "Folge 1")
    hand = eintrag("audiobook", "Bibi", "Folge 1", sortOrder=3)
    s.eintraege([hand])
    # Die alte Fassung kennt keine Variablen — ihre Pfade werden fuer den
    # Sandkasten umgebogen, sonst nichts.
    alt = alt_text.stdout
    alt = alt.replace(
        "/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config/data.json", str(s.data)
    )
    alt = alt.replace("/home/dietpi/.mupibox/Sonos-Kids-Controller-master/www/cover", str(s.cover))
    alt = alt.replace("/home/dietpi/MuPiBox/media", str(s.media))
    alt = alt.replace("/tmp/cleaned_data.json", str(s.pfad / "alt.json"))
    alt = alt.replace("bash /usr/local/bin/mupibox/add_index.sh", "true")
    alt = alt.replace("/usr/bin/chown dietpi:dietpi", "true #")
    altdatei = s.pfad / "data_clean_alt.sh"
    altdatei.write_text(alt)
    p = subprocess.run(["bash", str(altdatei)], capture_output=True, text=True)
    danach = s.gelesen()
    pruefe(
        "die ALTE Fassung wirft den Eintrag hinaus, obwohl der Ordner da ist "
        "(das ist der Befund, gegen den hier gebaut wurde)",
        len(danach) == 0,
        p.stdout + p.stderr,
    )
    s.weg()


# ── Lage 9: kein ungeschuetzter Zugriff auf die Medienablage ────────────────


def lage9(_behalten: bool) -> None:
    print("\nLAGE 9 — haengende Freigabe: JEDER Zugriff laeuft in eine Frist")
    text = DATA_CLEAN.read_text()
    # Eine haengende NFS-Freigabe laesst sich hier nicht nachbauen (dafuer
    # braeuchte es einen eigenen Dateisystemtreiber). Nachweisbar ist das
    # andere, und darauf kommt es an: dass es keinen Zugriff auf ${MEDIA}
    # gibt, der NICHT ueber die drei Helfer mit `timeout` geht.
    verdaechtig = []
    for nr, zeile in enumerate(text.splitlines(), 1):
        nackt = zeile.strip()
        if nackt.startswith("#") or "${MEDIA}" not in nackt:
            continue
        if any(h in nackt for h in ("ordner_antwortet", "hat_inhalt", "einhaengeziel", "MEDIA=", 'd="${MEDIA}')):
            continue
        verdaechtig.append(f"{nr}: {nackt}")
    pruefe(
        "kein Zugriff auf die Medienablage ohne timeout",
        not verdaechtig,
        "\n".join(verdaechtig),
    )
    for helfer in ("ordner_antwortet", "hat_inhalt"):
        block = text.split(f"{helfer}() {{", 1)[-1].split("\n}", 1)[0]
        pruefe(f"{helfer} laeuft in eine Frist", 'timeout "${WARTE}"' in block, block)
    pruefe(
        "bash -n ist zufrieden",
        subprocess.run(["bash", "-n", str(DATA_CLEAN)]).returncode == 0
        and subprocess.run(["bash", "-n", str(M3U)]).returncode == 0,
    )


# ── Lage 10: Sonderfaelle, die ein Skript zum Stolpern bringen ──────────────


def lage10(behalten: bool) -> None:
    print("\nLAGE 10 — Sonderfaelle")

    s = Sandkasten("leerdatei", behalten)
    s.eintraege([])
    p = s.aufraeumen_laufen()
    pruefe("leere data.json: laeuft durch und bleibt leer", s.gelesen() == [], p.stdout + p.stderr)
    s.weg()

    s = Sandkasten("namen", behalten)
    komisch = 'Käpt\'n "Blaubär" & Co'
    s.werk("audiobook", komisch, "Folge 1 (Höhle)")
    s.eintraege(
        [
            eintrag("audiobook", komisch, "Folge 1 (Höhle)"),
            eintrag("audiobook", komisch, "Folge 2 (weg)"),
        ]
    )
    p = s.aufraeumen_laufen()
    nach = titel_von(s.gelesen())
    pruefe(
        "Umlaute, Anfuehrungszeichen und Klammern: das vorhandene Werk bleibt",
        f"audiobook/{komisch}/Folge 1 (Höhle)" in nach,
        p.stdout + p.stderr,
    )
    pruefe("und das fehlende faellt trotzdem", len(nach) == 1, str(nach))
    s.weg()

    s = Sandkasten("ohnetitel", behalten)
    s.werk("audiobook", "Bibi", "Folge 1")
    s.eintraege(
        [
            {"type": "library", "category": "audiobook", "artist": "Bibi", "aPartOfAll": True},
            eintrag("audiobook", "Bibi", "Folge 1"),
        ]
    )
    p = s.aufraeumen_laufen()
    pruefe(
        "ein Eintrag ohne Titel ist nicht beurteilbar und bleibt",
        len(s.gelesen()) == 2,
        p.stdout + p.stderr,
    )
    s.weg()

    s = Sandkasten("kaputt", behalten)
    s.werk("audiobook", "Bibi", "Folge 1")
    s.data.write_text('[{"type": "library", "cat')  # halb geschrieben
    p = s.aufraeumen_laufen()
    pruefe(
        "halb geschriebene data.json wird NICHT angefasst",
        s.data.read_text() == '[{"type": "library", "cat' and p.returncode != 0,
        p.stdout + p.stderr,
    )
    s.weg()


LAGEN = {
    "1": lage1,
    "2": lage2,
    "3": lage3,
    "4": lage4,
    "5": lage5,
    "6": lage6,
    "7": lage7,
    "8": lage8,
    "9": lage9,
    "10": lage10,
}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--nur", action="append", choices=sorted(LAGEN), help="nur diese Lage")
    ap.add_argument("--behalten", action="store_true", help="Sandkaesten stehen lassen")
    a = ap.parse_args()
    if shutil.which("jq") is None:
        print("jq fehlt — die Skripte brauchen es.")
        return 2
    print("MEDIEN-EINLESEN-PROBE — Sandkasten unter /tmp, die Box wird nicht angefasst.")
    for name in a.nur or sorted(LAGEN):
        LAGEN[name](a.behalten)
    print(f"\n{gruen} gruen, {len(rot)} rot")
    for r in rot:
        print(f"  rot: {r}")
    return 1 if rot else 0


if __name__ == "__main__":
    sys.exit(main())
