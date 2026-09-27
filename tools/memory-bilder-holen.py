#!/usr/bin/env python3
"""MEMORY-BILDER HOLEN — CC0-Kartensaetze fuer das Memory der Box beschaffen.

══ WOZU (E140, 09.09.2026) ═════════════════════════════════════════════════

Der Betreiber am Brett: „viele bilder [sind] gleich aber nicht passend, da es
aus dem gleichen album unterschiedliche titel sind oder es sind mehrfach
platzhalter bilder". Beides stimmt und beides ist dieselbe Wurzel: Das Memory
nahm bisher NUR die Cover der eigenen Bibliothek, und die sind als Kartensatz
schlecht geeignet — ein Album liefert mehrere Titel mit demselben Bild, und
Alben ohne Cover bekommen vom m3u-Generator alle DASSELBE Maskottchen
untergeschoben (llmwiki rueckfallbild-macht-den-fehler-unsichtbar: 60 von 97
Alben, am Geraet gemessen).

Die Cover-Seite repariert `apps.js` (Inhalts-Aussiebung per Bildhash). Dieses
Werkzeug loest die andere Haelfte: MITGELIEFERTE Kartensaetze, bei denen jedes
Bild garantiert einmal vorkommt.

══ WARUM NUR CC0 UND WARUM DAS HIER GEPRUEFT WIRD ══════════════════════════

Auf einer Kinderbox, die verteilt wird, ist „frei gefunden" keine Lizenz. CC0
ist die einzige Sorte, die ohne Namensnennung, ohne Lizenztext im Geraet und
ohne Weitergabe-Auflage mitgeliefert werden darf.

DESHALB IST DIE LIZENZPRUEFUNG HIER EINE WACHE UND KEINE ANNAHME: Beide
Quellen sagen JE OBJEKT, ob es CC0 ist (Met: `isPublicDomain`, Cleveland:
`share_license_status`). Ein Objekt, das das nicht sagt, wird NICHT geladen —
auch dann nicht, wenn es in der Rezeptdatei steht. Eine Sammlung ist nicht
als Ganzes CC0; in beiden Haeusern liegen geschuetzte Leihgaben zwischen den
freien Stuecken, und man sieht es dem Bild nicht an.

WAS DAS WERKZEUG NICHT KANN: entscheiden, ob ein Bild KINDGERECHT ist. Das
tut ein Mensch, und zwar mit den Augen — `--kontaktbogen` legt alle geladenen
Bilder einer Reihe als ein PNG nebeneinander, damit das in einem Blick geht.
Museen fuehren auch Akt, Krieg und Grabbeigaben; ein Filter auf Stichworte
faende genau die Faelle nicht, an denen es haengt.

══ AUFRUF ═════════════════════════════════════════════════════════════════

    python3 tools/memory-bilder-holen.py --rezept config/memory-bilder.json
    python3 tools/memory-bilder-holen.py --rezept … --nur tiere
    python3 tools/memory-bilder-holen.py --rezept … --kontaktbogen /tmp/x.png
    python3 tools/memory-bilder-holen.py --suche cleveland "elephant" --typ Sculpture

`--suche` ist die KURATIERHILFE: sie laedt nichts herunter, sie zeigt
Kennungen und Titel, aus denen man ein Rezept schreibt. Das Rezept ist
Handarbeit und soll es bleiben — es ist die Stelle, an der ein Mensch
entschieden hat.

Rueckgabe: 0 alles geladen · 1 Umgebung/Rezept · 2 mindestens ein Bild fehlt
"""

from __future__ import annotations

import argparse
import io
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("PIL fehlt: pip install pillow", file=sys.stderr)
    raise SystemExit(1)

WURZEL = Path(__file__).resolve().parent.parent
ZIEL_BASIS = WURZEL / "NewDesign" / "bilder" / "memory"

# OHNE EIGENEN NAMEN ANTWORTET CLEVELAND MIT 403. Am 09.09.2026 gemessen:
# derselbe Aufruf per curl (das seinen Namen mitschickt) kam durch, per
# urllib ohne Kopfzeile nicht. Wer hier einen Fehler sucht, sucht ihn sonst
# in der Adresse.
KOPF = {"User-Agent": "MixPiBox-Memory-Bilder/1.0 (+lokales Kinderprojekt)"}

# Kantenlaenge der fertigen Karte. 256 REICHT UND IST DIE OBERGRENZE: Auf dem
# 800x480-Schirm der Box ist eine Memory-Karte hoechstens rund 120 px breit
# (im Vollbild weniger, weil dort mehr Karten liegen). 256 gibt der doppelten
# Punktdichte noch Reserve; alles darueber sind Bytes, die jede SD-Karte
# mittraegt und die niemand sieht.
KANTE = 256
# JPEG und nicht PNG: Fotos von Museumsstuecken sind Fotos. Bei 256 px kostet
# PNG das Vier- bis Sechsfache fuer einen Unterschied, den man auf dieser
# Karte nicht sieht. 82 ist die Stufe, ab der Artefakte an Kanten anfangen.
GUETE = 82


def hol(url: str, roh: bool = False, versuche: int = 3):
    """Eine Adresse holen — mit Namen, mit Geduld, mit Bericht.

    DREI VERSUCHE MIT PAUSE, weil beide Haeuser bei schneller Folge kurz
    dichtmachen. Ein einzelner Fehlschlag waere sonst ein fehlendes Bild in
    einem Satz, der ansonsten stimmt — und das faellt erst am Brett auf.
    """
    letzte = None
    for versuch in range(1, versuche + 1):
        try:
            with urllib.request.urlopen(
                urllib.request.Request(url, headers=KOPF), timeout=40
            ) as a:
                daten = a.read()
            return daten if roh else json.loads(daten)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            letzte = e
            if versuch < versuche:
                time.sleep(2 * versuch)
    raise RuntimeError(f"{url} — {letzte}")


# ── DIE ZWEI QUELLEN ────────────────────────────────────────────────────────
#
# Jede liefert dasselbe Tripel: Titel, Bildadresse, CC0-JA-ODER-NEIN. Das
# dritte ist das wichtige — siehe den Kasten oben.

def met(kennung: str) -> dict:
    d = hol(f"https://collectionapi.metmuseum.org/public/collection/v1/objects/{kennung}")
    return {
        "titel": (d.get("title") or "").strip(),
        "bild": d.get("primaryImageSmall") or d.get("primaryImage") or "",
        "cc0": bool(d.get("isPublicDomain")),
        "wer": (d.get("artistDisplayName") or d.get("culture") or "").strip(),
        "jahr": (d.get("objectDate") or "").strip(),
        "seite": d.get("objectURL", ""),
        "haus": "The Metropolitan Museum of Art",
    }


def cleveland(kennung: str) -> dict:
    d = hol(f"https://openaccess-api.clevelandart.org/api/artworks/{kennung}")["data"]
    bilder = d.get("images") or {}
    bild = ""
    for sorte in ("web", "print", "full"):
        if isinstance(bilder.get(sorte), dict) and bilder[sorte].get("url"):
            bild = bilder[sorte]["url"]
            break
    return {
        "titel": (d.get("title") or "").strip(),
        "bild": bild,
        # `share_license_status` ist das Feld, das Cleveland selbst als
        # Lizenzaussage fuehrt. Alles ausser genau "CC0" faellt durch.
        "cc0": (d.get("share_license_status") or "").upper() == "CC0",
        "wer": (d.get("culture") or [""])[0] if isinstance(d.get("culture"), list) else (d.get("culture") or ""),
        "jahr": (d.get("creation_date") or "").strip(),
        "seite": d.get("url", ""),
        "haus": "The Cleveland Museum of Art",
    }


QUELLEN = {"met": met, "cleveland": cleveland}


def quadrat(daten: bytes) -> Image.Image:
    """Mittig auf ein Quadrat beschneiden und auf KANTE bringen.

    MITTIG UND NICHT GESTRECKT: Ein gestrecktes Tier ist ein anderes Tier.
    Museumsfotos zeigen das Stueck fast immer zentriert; der mittige
    Ausschnitt trifft deshalb, was gemeint ist. Wo er es nicht tut, sieht man
    es auf dem Kontaktbogen — genau dafuer gibt es ihn.
    """
    b = Image.open(io.BytesIO(daten))
    # `convert` VOR dem Beschneiden: Manche Museumsdateien sind CMYK,
    # Graustufen oder Palette; JPEG-Schreiben faellt darueber sonst um.
    if b.mode != "RGB":
        b = b.convert("RGB")
    kurz = min(b.width, b.height)
    links = (b.width - kurz) // 2
    oben = (b.height - kurz) // 2
    b = b.crop((links, oben, links + kurz, oben + kurz))
    return b.resize((KANTE, KANTE), Image.LANCZOS)


def satz_holen(name: str, eintraege: list[dict], neu: bool) -> tuple[int, int, list[dict]]:
    """Einen Kartensatz laden. Liefert (geladen, uebersprungen, Herkunftsliste)."""
    ordner = ZIEL_BASIS / name
    ordner.mkdir(parents=True, exist_ok=True)
    geladen = fehlt = 0
    herkunft = []
    for e in eintraege:
        quelle, kennung = e["quelle"], str(e["id"])
        datei = ordner / f"{e['datei']}.jpg"
        if datei.exists() and not neu:
            print(f"    = {datei.name} (liegt schon)")
            herkunft.append(e.get("_herkunft", {"datei": datei.name, "id": kennung, "quelle": quelle}))
            continue
        try:
            m = QUELLEN[quelle](kennung)
        except Exception as ex:
            print(f"    X {datei.name}: {ex}")
            fehlt += 1
            continue
        # ── DIE WACHE. Sie steht VOR dem Laden, nicht danach. ──────────────
        if not m["cc0"]:
            print(f"    X {datei.name}: {quelle}/{kennung} ist NICHT CC0 — nicht geladen.")
            fehlt += 1
            continue
        if not m["bild"]:
            print(f"    X {datei.name}: {quelle}/{kennung} hat kein Bild.")
            fehlt += 1
            continue
        try:
            quadrat(hol(m["bild"], roh=True)).save(datei, "JPEG", quality=GUETE, optimize=True)
        except Exception as ex:
            print(f"    X {datei.name}: Bild ging nicht: {ex}")
            fehlt += 1
            continue
        kb = datei.stat().st_size / 1024
        print(f"    + {datei.name}  {kb:5.1f} KB  {m['titel'][:44]}")
        geladen += 1
        herkunft.append({
            "datei": datei.name,
            "wort": e.get("wort", ""),
            "titel": m["titel"],
            "wer": m["wer"],
            "jahr": m["jahr"],
            "haus": m["haus"],
            "seite": m["seite"],
            "lizenz": "CC0",
            "quelle": quelle,
            "id": kennung,
        })
    return geladen, fehlt, herkunft


def kontaktbogen(name: str, ziel: Path) -> None:
    """Alle Bilder eines Satzes als EIN PNG nebeneinander — zum Ansehen.

    DAS IST DER KURATIERSCHRITT und der Grund, warum dieses Werkzeug keinen
    Stichwortfilter fuer „kindgerecht" hat: Ein Mensch sieht in einem Blick,
    was zwoelf Einzelabrufe nicht zeigen — dass zwei Motive sich aehneln,
    dass eines im Kleinen zu Brei wird, dass eines nicht hierher gehoert.
    """
    dateien = sorted((ZIEL_BASIS / name).glob("*.jpg"))
    if not dateien:
        print(f"  {name}: nichts da")
        return
    spalten = min(6, len(dateien))
    reihen = (len(dateien) + spalten - 1) // spalten
    kachel = 180
    beschriftung = 16
    blatt = Image.new("RGB", (spalten * kachel, reihen * (kachel + beschriftung)), "white")
    for i, d in enumerate(dateien):
        b = Image.open(d).resize((kachel, kachel), Image.LANCZOS)
        blatt.paste(b, ((i % spalten) * kachel, (i // spalten) * (kachel + beschriftung)))
    blatt.save(ziel)
    print(f"  {name}: {len(dateien)} Bilder -> {ziel}")


def suche(quelle: str, wort: str, typ: str | None, wieviel: int) -> None:
    """Kandidaten zeigen, NICHTS laden — die Vorstufe zum Rezept."""
    if quelle == "cleveland":
        u = ("https://openaccess-api.clevelandart.org/api/artworks/?q="
             + urllib.parse.quote(wort) + f"&cc0=1&has_image=1&limit={wieviel}")
        if typ:
            u += "&type=" + urllib.parse.quote(typ)
        d = hol(u)
        was = wort + (f"/{typ}" if typ else "")
        print(f"── cleveland {was!r}: {d['info']['total']} Treffer")
        for a in d["data"]:
            print(f"   {a['id']:>8} | {(a.get('type') or '?')[:14]:<14} | {a['title'][:52]}")
        return
    u = ("https://collectionapi.metmuseum.org/public/collection/v1/search?hasImages=true&q="
         + urllib.parse.quote(wort))
    d = hol(u)
    kennungen = (d.get("objectIDs") or [])[:wieviel]
    print(f"── met {wort!r}: {d.get('total', 0)} Treffer, zeige {len(kennungen)}")
    for k in kennungen:
        try:
            m = met(str(k))
        except Exception as ex:
            print(f"   {k:>8} | Fehler: {ex}")
            continue
        print(f"   {k:>8} | {'CC0' if m['cc0'] else 'NICHT CC0':<9} | {m['titel'][:52]}")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--rezept", help="JSON mit den kuratierten Kennungen je Satz")
    p.add_argument("--nur", help="nur diesen Satz")
    p.add_argument("--neu", action="store_true", help="auch neu laden, was schon daliegt")
    p.add_argument("--kontaktbogen", help="Kontaktbogen-PNG je Satz in diesen Ordner")
    p.add_argument("--suche", nargs="+", metavar=("QUELLE", "WORT"), help="Kandidaten zeigen (met|cleveland)")
    p.add_argument("--typ", help="nur bei --suche cleveland: Sorte (Sculpture, Print, Painting …)")
    p.add_argument("--wieviel", type=int, default=20)
    a = p.parse_args()

    if a.suche:
        if len(a.suche) < 2:
            print("--suche braucht QUELLE und WORT", file=sys.stderr)
            return 1
        suche(a.suche[0], " ".join(a.suche[1:]), a.typ, a.wieviel)
        return 0

    if not a.rezept:
        p.print_help()
        return 1
    rezept = json.loads(Path(a.rezept).read_text(encoding="utf-8"))
    saetze = {k: v for k, v in rezept["saetze"].items() if not a.nur or k == a.nur}
    if not saetze:
        print(f"Kein Satz namens {a.nur!r} im Rezept.", file=sys.stderr)
        return 1

    fehlt_gesamt = 0
    for name, satz in saetze.items():
        print(f"── {name} ({satz.get('wort', name)})")
        geladen, fehlt, herkunft = satz_holen(name, satz["bilder"], a.neu)
        fehlt_gesamt += fehlt
        # DIE HERKUNFT WIRD MITGESCHRIEBEN, obwohl CC0 sie nicht verlangt.
        # Nicht als Pflicht, sondern damit ein Zweiter in fuenf Jahren
        # nachsehen kann, WOHER ein Bild kommt und dass es frei ist — ohne
        # diese Datei muesste er es glauben.
        if herkunft:
            (ZIEL_BASIS / name / "herkunft.json").write_text(
                json.dumps({"satz": name, "lizenz": "CC0", "bilder": herkunft},
                           ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"   {geladen} geladen, {fehlt} fehlgeschlagen")
        if a.kontaktbogen:
            ordner = Path(a.kontaktbogen)
            ordner.mkdir(parents=True, exist_ok=True)
            kontaktbogen(name, ordner / f"{name}.png")

    verzeichnis_schreiben(rezept)
    return 2 if fehlt_gesamt else 0


def verzeichnis_schreiben(rezept: dict) -> None:
    """`saetze.json` — das Verzeichnis, das die Seite liest.

    WARUM ES DAS BRAUCHT: Eine Seite kann keinen Ordner auflisten. Ohne diese
    Datei muesste in `apps.js` eine zweite Liste der Dateinamen stehen — und
    die liefe auseinander, sobald jemand ein Bild austauscht (genau die Sorte
    Doppelwahrheit, die dieser Baum an mehreren Stellen teuer bezahlt hat).

    GESCHRIEBEN WIRD, WAS WIRKLICH DALIEGT, nicht was im Rezept steht: Ein
    Bild, das nicht geladen werden konnte, fehlt dann auch im Verzeichnis —
    statt als leere Karte im Spiel zu landen. Und ueber ALLE Saetze, auch bei
    `--nur`: sonst schriebe ein Lauf fuer einen Satz die anderen aus dem
    Verzeichnis heraus.
    """
    verzeichnis = {}
    for name, satz in rezept["saetze"].items():
        dateien = sorted(p.name for p in (ZIEL_BASIS / name).glob("*.jpg"))
        if not dateien:
            continue
        # DIE VORSCHAU MUSS ES WIRKLICH GEBEN: Ein Rezept, das auf eine
        # geloeschte Datei zeigt, ergaebe eine Kachel mit leerem Bild — und
        # die sieht aus wie ein Ladefehler, nicht wie ein Tippfehler.
        vorschau = satz.get("vorschau")
        if vorschau and vorschau not in dateien:
            print(f"   ! {name}: Vorschau {vorschau} liegt nicht da — nehme {dateien[0]}")
            vorschau = None
        verzeichnis[name] = {
            "wort": satz.get("wort", name),
            "vorschau": vorschau or dateien[0],
            "bilder": dateien,
        }
    ziel = ZIEL_BASIS / "saetze.json"
    ziel.write_text(json.dumps(verzeichnis, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    gesamt = sum(len(s["bilder"]) for s in verzeichnis.values())
    print(f"── Verzeichnis: {ziel.relative_to(WURZEL)} ({len(verzeichnis)} Saetze, {gesamt} Bilder)")


if __name__ == "__main__":
    sys.exit(main())
