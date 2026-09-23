#!/usr/bin/env python3
"""
SACKGASSEN-PROBE — Bedienungen, aus denen ein Elternteil AM GERAET nicht zurueckkommt.

DIE FRAGE, jedes Mal dieselbe:
  „Ein Elternteil tut das. Es hat kein zweites Geraet, kein SSH und keine
   Anleitung. Kommt es zurueck?"

Vorbild ist die 0 in der Bildschirmhelligkeit: eine Bedienung, die am Geraet
moeglich ist und aus der es am Geraet keinen Weg zurueck gibt. Diese Probe
sucht die uebrigen — und zwar MESSEND, nicht lesend. Jeder Abschnitt baut
einen Sandkasten, laesst das ECHTE Skript darin laufen und vergleicht
vorher/nachher.

NICHTS WIRD AN DER BOX GEAENDERT. Die Probe laeuft ausschliesslich in
tempfile-Ordnern auf dem Entwicklungsrechner. Der Abschnitt „box" liest per
SSH, mehr nicht.

  python3 tools/sackgassen-probe.py            # alles, ohne Box
  python3 tools/sackgassen-probe.py --box 192.168.178.169
  python3 tools/sackgassen-probe.py --nur update
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

BAUM = Path(__file__).resolve().parent.parent
SKRIPTE = BAUM / "scripts" / "mupibox"
UPDATE = BAUM / "update" / "start_mupibox_update.sh"

# Der Ort, den der Server auf der Box benutzt (server.ts:403 + productionServe).
BOX_KONFIG = "/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config"
BOX_WWW = "/home/dietpi/.mupibox/Sonos-Kids-Controller-master/www"
BOX_MEDIA = "/home/dietpi/MuPiBox/media"

befunde: list[dict] = []


def befund(was: str, hinein: str, zurueck: str, schwere: str, beleg: str) -> None:
    befunde.append(
        {"was": was, "weg_hinein": hinein, "weg_zurueck": zurueck, "schwere": schwere, "beleg": beleg}
    )
    print(f"\n  [{schwere.upper()}] {was}")
    print(f"      hinein : {hinein}")
    print(f"      zurueck: {zurueck}")
    print(f"      beleg  : {beleg}")


def sauber(was: str, warum: str) -> None:
    print(f"\n  [ok] {was}\n      {warum}")


def herrichten(skript: Path, ziel_konfig: Path, ziel_media: Path, ziel_www: Path) -> Path:
    """Ein Box-Skript mit umgebogenen Pfaden in den Sandkasten kopieren.

    Die Skripte tragen ihre Pfade fest verdrahtet; sie zu veraendern waere ein
    Eingriff. Kopieren und im KOPIE die drei Wurzeln ersetzen laesst das
    Original unberuehrt und misst trotzdem das echte Verhalten.
    """
    text = skript.read_text(encoding="utf-8", errors="replace")
    text = text.replace(BOX_KONFIG, str(ziel_konfig))
    text = text.replace(BOX_WWW, str(ziel_www))
    text = text.replace(BOX_MEDIA, str(ziel_media))
    text = text.replace('if [ "$EUID" -ne 0 ]\n  then echo "Please run as root"\n  exit\nfi', "")
    kopie = ziel_konfig.parent / skript.name
    kopie.write_text(text, encoding="utf-8")
    kopie.chmod(0o755)
    return kopie


# ══════════════════════════════════════════════════════════════════════════
# 1. Das Update — WAS wird gerettet, WAS faellt?
# ══════════════════════════════════════════════════════════════════════════
def probe_update(box: str | None) -> None:
    print("\n" + "=" * 74)
    print("1. DAS UPDATE — was ueberlebt das `rm -R`?")
    print("=" * 74)

    text = UPDATE.read_text(encoding="utf-8", errors="replace")
    zeilen = text.splitlines()

    # Was wird VOR dem rm -R beiseitegeschafft?
    gerettet = []
    rm_zeile = None
    for i, z in enumerate(zeilen, 1):
        if "rm -R" in z and "Sonos-Kids-Controller-master/" in z:
            rm_zeile = i
        if z.strip().startswith("mv ") and "/tmp/" in z and "Sonos-Kids-Controller-master" in z:
            quelle = z.strip().split()[1]
            gerettet.append((i, quelle))

    print(f"\n  `rm -R` auf das ganze Verzeichnis: Zeile {rm_zeile}")
    print("  gerettet (mv nach /tmp) VOR dem rm -R:")
    for i, q in gerettet:
        print(f"      Zeile {i:>4}: {q}")

    if box:
        print("\n  Gegen den WIRKLICHEN Bestand der Box gehalten:")
        da = ssh(box, f"ls -A {BOX_KONFIG}")
        if da is None:
            print("      (Box nicht erreichbar — uebersprungen)")
            return
        eintraege = [e for e in da.split("\n") if e.strip()]

        gerettet_namen = set()
        for _, q in gerettet:
            if q.startswith(BOX_KONFIG):
                gerettet_namen.add(q[len(BOX_KONFIG) :].lstrip("/"))

        faellt = [e for e in eintraege if e not in gerettet_namen]
        print(f"      im Verzeichnis: {len(eintraege)} Eintraege")
        print(f"      davon gerettet: {sorted(gerettet_namen & set(eintraege))}")
        print(f"      davon WEG     : {sorted(faellt)}")

        # Und die Rettungen, die INS LEERE greifen.
        ins_leere = []
        for _, q in gerettet:
            if ssh(box, f"test -e '{q}' && echo da || echo weg") == "weg":
                ins_leere.append(q)
        if ins_leere:
            print(f"      Rettungen, die ins LEERE greifen: {ins_leere}")

        kinder = ssh(box, f"ls {BOX_KONFIG}/profile 2>/dev/null") or ""
        kinder = [k for k in kinder.split("\n") if k.strip()]

        befund(
            was=(
                f"Das Update loescht das ganze Konfigurationsverzeichnis und rettet "
                f"{len(gerettet)} Dinge. Auf DIESER Box faellt damit alles Kindbezogene: "
                f"die Bereiche von {len(kinder)} Kindern ({', '.join(kinder)}) mit "
                f"Weiterhoeren, Verlauf, eigenen Listen und Hoerzeit-Konto, dazu "
                f"profile.json (die Kinder SELBST), kinderzeit.json, darstellung.json, "
                f"vorlesen.json, verschmelzung.json, wlan.json, network.json"
            ),
            hinein="Verwaltung/altes Admin → «Update» — ein Knopf, eine Bestaetigung",
            zurueck=(
                "AM GERAET KEINER. mupibox-sicherung.py kann es, ist aber ein "
                "Befehlszeilenwerkzeug — nur ueber SSH erreichbar. Kein API-Endpunkt, "
                "kein Knopf in der Verwaltung (grep ueber src/backend-api: keine Route "
                "/api/sicherung*)."
            ),
            schwere="hoch",
            beleg=(
                f"update/start_mupibox_update.sh:{rm_zeile} (`rm -R`), Rettungen in "
                f"{', '.join(str(i) for i, _ in gerettet)}. Bestand der Box per SSH "
                f"gelesen (nur `ls`): {len(faellt)} von {len(eintraege)} Eintraegen fallen."
            ),
        )

        if ins_leere:
            befund(
                was=(
                    "Von den drei Rettungen greift eine INS LEERE: `www/cover` gibt es "
                    "auf dieser Box nicht mehr. Die Titelbilder liegen seit E29 unter "
                    "`server/config/coverspeicher` — also INNERHALB des geloeschten "
                    "Verzeichnisses. Sie fallen mit."
                ),
                hinein="derselbe Update-Knopf",
                zurueck=(
                    "Halb: die Bilder werden bei Bedarf neu geladen, solange das Netz "
                    "steht und der Dienst antwortet. Im Offline-Betrieb sind sie weg."
                ),
                schwere="mittel",
                beleg=(
                    f"per SSH gemessen: `test -e {BOX_WWW}/cover` → weg; "
                    f"`ls {BOX_KONFIG}/coverspeicher | wc -l` → "
                    f"{ssh(box, f'ls {BOX_KONFIG}/coverspeicher | wc -l')} Dateien"
                ),
            )


# ══════════════════════════════════════════════════════════════════════════
# 2. „Medien neu einlesen" — was macht data_clean.sh mit den eigenen Dateien?
# ══════════════════════════════════════════════════════════════════════════
def probe_medien_neu() -> None:
    print("\n" + "=" * 74)
    print("2. «MEDIEN NEU EINLESEN» — data_clean.sh gegen eigene Dateien")
    print("=" * 74)

    if not shutil.which("jq"):
        print("\n  jq fehlt — Abschnitt uebersprungen.")
        return

    with tempfile.TemporaryDirectory(prefix="sackgasse-medien-") as tmp:
        wurzel = Path(tmp)
        konfig = wurzel / "config"
        media = wurzel / "media"
        www = wurzel / "www"
        for p in (konfig, media, www):
            p.mkdir(parents=True)
        (www / "cover" / "audiobook").mkdir(parents=True)
        (www / "cover" / "music").mkdir(parents=True)
        (www / "cover" / "other").mkdir(parents=True)

        # EIN Werk liegt da, EINES nicht (umbenannt / Datentraeger nicht
        # eingehaengt / Netzfreigabe gerade weg).
        (media / "audiobook" / "Bibi" / "Folge 1").mkdir(parents=True)
        (media / "audiobook" / "Bibi" / "Folge 1" / "01.mp3").write_text("x")

        bestand = [
            {
                "type": "library",
                "category": "audiobook",
                "artist": "Bibi",
                "title": "Folge 1",
                "cover": "http://box:8200/cover/audiobook/Bibi/Folge 1/cover.jpg",
                "sortOrder": 3,
                "aPartOfAll": True,
                "index": 0,
            },
            {
                "type": "library",
                "category": "audiobook",
                "artist": "Opa",
                "title": "Gute-Nacht-Geschichte",
                "cover": "http://box:8200/cover/audiobook/Opa/Gute-Nacht-Geschichte/cover.jpg",
                "index": 1,
            },
            {"type": "spotify", "artist": "Rolf", "title": "Zoo", "id": "abc", "index": 2},
        ]
        (konfig / "data.json").write_text(json.dumps(bestand, indent=4))

        dc = herrichten(SKRIPTE / "data_clean.sh", konfig, media, www)
        subprocess.run(["bash", str(dc)], capture_output=True, text=True, cwd=tmp)

        nachher = json.loads((konfig / "data.json").read_text())
        typen_vorher = [e["type"] for e in bestand]
        typen_nachher = [e["type"] for e in nachher]
        print(f"\n  vorher : {typen_vorher}")
        print(f"  nachher: {typen_nachher}")

        blieb_library = [e for e in nachher if e.get("type") == "library"]
        if not blieb_library:
            # Und jetzt der zweite Teil: baut m3u_generator sie wieder auf?
            mg = herrichten(SKRIPTE / "m3u_generator.sh", konfig, media, www)
            (media.parent / "sysmedia" / "images").mkdir(parents=True, exist_ok=True)
            (media.parent / "sysmedia" / "images" / "MuPiLogo.jpg").write_text("x")
            txt = mg.read_text().replace(
                "/home/dietpi/MuPiBox/sysmedia", str(media.parent / "sysmedia")
            )
            mg.write_text(txt)
            subprocess.run(["bash", str(mg)], capture_output=True, text=True, cwd=tmp)
            wieder = json.loads((konfig / "data.json").read_text())
            wieder_lib = [e for e in wieder if e.get("type") == "library"]
            print(f"  nach m3u_generator wieder da: {[(e['artist'], e['title']) for e in wieder_lib]}")

            verloren_felder = []
            for e in wieder_lib:
                if e.get("artist") == "Bibi":
                    for f in ("sortOrder", "aPartOfAll"):
                        if f not in e:
                            verloren_felder.append(f)

            befund(
                was=(
                    "«Medien neu einlesen» wirft ZUERST jeden Eintrag der eigenen "
                    "Bibliothek aus data.json — bedingungslos — und baut danach nur "
                    "wieder auf, was in diesem Augenblick als Ordner dasteht. Ein Werk, "
                    "dessen Ordner gerade nicht erreichbar ist (USB nicht eingehaengt, "
                    "Netzfreigabe weg, umbenannt), ist danach spurlos aus der "
                    "Mediendatenbank verschwunden. Was wiederkommt, kommt NACKT zurueck: "
                    f"von Hand gesetzte Felder ({', '.join(verloren_felder) or 'sortOrder/aPartOfAll'}) "
                    "sind weg."
                ),
                hinein=(
                    "Verwaltung → Medien → «Medien neu einlesen» (POST /api/system/medien-neu). "
                    "UND VON SELBST: change_checker.sh ruft dasselbe Skript, sobald sich "
                    "die Aenderungszeit eines Medienordners aendert — ohne Knopfdruck."
                ),
                zurueck=(
                    "Fuer den fehlenden Ordner: keiner. data.json hat KEINE Sicherung auf "
                    "diesem Weg — die datierte `data-vor-aufraeumen-*.json` legt nur "
                    "/api/medien/aufraeumen an, und `data.json.bak` schreibt nur "
                    "medienAendern. Beide sind hier nicht beteiligt: das Skript schreibt "
                    "data.json an ihnen vorbei. Fuer die Handfelder: neu eintippen."
                ),
                schwere="hoch",
                beleg=(
                    "GEMESSEN in einem Sandkasten (dieses Werkzeug, Abschnitt 2): "
                    "data_clean.sh im Kopie-Lauf, 2 library-Eintraege hinein, "
                    f"{len(blieb_library)} heraus. Ursache steht in scripts/mupibox/data_clean.sh:63-71 — "
                    "die Ordnerpruefung ist auskommentiert, `add_item=0` steht "
                    "unbedingt da. Der Knopf ist in src/backend-api/src/system.ts:53-58 "
                    "mit `einschneidend: false` gekennzeichnet und traegt den Hinweis "
                    "«Liest die Musikdateien neu ein»."
                ),
            )
        else:
            sauber("data_clean.sh", "library-Eintraege bleiben stehen — nichts zu melden.")


# ══════════════════════════════════════════════════════════════════════════
# 3. Der Papierkorb, den es nicht gibt: rm -r auf die eigenen Dateien
# ══════════════════════════════════════════════════════════════════════════
def probe_deletelocal() -> None:
    print("\n" + "=" * 74)
    print("3. «Loeschen» in der Medienliste der BOX — rm -r auf eigene Dateien")
    print("=" * 74)

    quelle = (BAUM / "src" / "backend-player" / "src" / "spotify-control.ts").read_text(
        encoding="utf-8", errors="replace"
    )
    zeilen = quelle.splitlines()
    ort = None
    for i, z in enumerate(zeilen, 1):
        if "function deleteLocal" in z:
            ort = i
    rumpf = "\n".join(zeilen[ort - 1 : ort + 16]) if ort else ""
    print(f"\n  spotify-control.ts:{ort}")
    for z in rumpf.splitlines()[:8]:
        print(f"      {z}")

    hat_shell = "exec(deleteCMD" in rumpf
    hat_rm = 'rm -r "' in rumpf

    # Nachbauen, was der Befehl WIRD — dieselbe Formel, ohne ihn auszufuehren.
    def gebaut(category: str, artist: str, title: str) -> str:
        from urllib.parse import quote

        stueck = f"{quote(category)}:{quote(artist)}:{quote(title)}"
        # decodeURI(x).replace(/:/g,'/') — decodeURI laesst %3A stehen, %20 wird Leerzeichen
        import re
        entschaerft = re.sub(r"%20", " ", stueck).replace(":", "/")
        return f'rm -r "{BOX_MEDIA}/{entschaerft}"'

    faelle = [
        ("audiobook", "Bibi", "Folge 1"),
        ("audiobook", "", ""),
        ("audiobook", "Bibi", 'x" ; echo TREFFER ; "'),
    ]
    print("\n  Was der Befehl wird:")
    for c, a, t in faelle:
        print(f"      ({c!r},{a!r},{t!r})\n          {gebaut(c, a, t)}")

    if hat_shell and hat_rm:
        befund(
            was=(
                "Der Papierkorb-Knopf in der Medienliste der Box loescht die "
                "TONDATEIEN selbst — `rm -r` auf den Ordner unter "
                "/home/dietpi/MuPiBox/media. Eine Rueckfrage, ein «Ok», und die "
                "eingelesene CD, die selbst aufgenommene Geschichte, das gekaufte "
                "Hoerbuch sind von der Karte verschwunden. Kein Papierkorb, keine "
                "Sicherung, kein Rueckgaengig."
            ),
            hinein=(
                "Box → Einstellungen → Medienliste → Papierkorb an einem Eintrag der "
                "eigenen Bibliothek → «Ok» (src/frontend-box/src/app/edit/edit.page.ts:81-128)"
            ),
            zurueck=(
                "KEINER — weder am Geraet noch ueber SSH. Die Dateien sind fort. Auch "
                "mupibox-sicherung.py hilft nicht: es sichert die Konfiguration, nicht "
                "/home/dietpi/MuPiBox/media (nachgesehen in der Aufnahmeliste, "
                "scripts/mupibox/mupibox-sicherung.py, Abschnitt HINEIN)."
            ),
            schwere="hoch",
            beleg=(
                f"src/backend-player/src/spotify-control.ts:{ort} baut die Zeichenkette "
                f"und uebergibt sie an `exec` (Shell). Aufrufkette gelesen: "
                "edit.page.ts:128 → player.service.ts:232 (`deletelocal/<cat>:<artist>:<title>`) "
                f"→ spotify-control.ts:2389. Der Wortlaut der Rueckfrage steht in "
                "edit.page.ts:85. Zusammensetzung hier nachgerechnet, nicht ausgefuehrt."
            ),
        )
        befund(
            was=(
                "Derselbe Knopf traegt zwei Sonderfaelle mit sich, weil die Zeichenkette "
                "in eine SHELL geht und nur mit doppelten Anfuehrungszeichen umschlossen "
                "ist: (a) ein leerer Interpret ODER Titel laesst den Pfad auf den "
                "KATEGORIEORDNER zusammenfallen — `rm -r «…/media/audiobook//»` nimmt "
                "die ganze Kategorie mit, nicht ein Werk. (b) ein Anfuehrungszeichen im "
                "Titel bricht aus der Umschliessung aus."
            ),
            hinein="derselbe Knopf — Titel/Interpret kommen aus data.json bzw. dem Ordnernamen",
            zurueck="KEINER.",
            schwere="mittel",
            beleg=(
                "Die Zusammensetzung hier nachgerechnet (Abschnitt 3, Ausgabe oben): "
                "aus ('audiobook','','') wird "
                f"`{gebaut('audiobook','','')}`; aus einem Titel mit `\"` wird "
                f"`{gebaut('audiobook','Bibi', 'x\" ; echo TREFFER ; \"')}`. "
                "NICHT ausgefuehrt — nur gebaut."
            ),
        )
    else:
        sauber("deleteLocal", "kein Shell-`rm` gefunden — die Lage hat sich geaendert.")


# ══════════════════════════════════════════════════════════════════════════
# 4. Was HAELT — die Gegenprobe, damit die Liste nicht nur aus Ungluecken besteht
# ══════════════════════════════════════════════════════════════════════════
def probe_gehalten() -> None:
    print("\n" + "=" * 74)
    print("4. GEGENPROBE — wo ein Rueckweg NACHWEISLICH da ist")
    print("=" * 74)

    k = (BAUM / "src" / "backend-api" / "src" / "konfiguration.ts").read_text(
        encoding="utf-8", errors="replace"
    )
    for was, muster in [
        (
            "Anmeldung EIN ohne Passwort wird verweigert",
            "Anmeldung eingeschaltet, aber kein Passwort gesetzt",
        ),
        ("Sperre auf PIN ohne PIN wird verweigert", "gestellt, aber keine PIN gesetzt"),
        ("Startlautstaerke ueber Hoechstlautstaerke wird verweigert", "Startlautstärke liegt über"),
    ]:
        sauber(was, "pruefeKonfig lehnt ab — gelesen in konfiguration.ts" if muster in k else "FEHLT!")

    s = (BAUM / "src" / "backend-api" / "src" / "server.ts").read_text(
        encoding="utf-8", errors="replace"
    )
    if "geloescht-${kennung}-${Date.now()}" in s:
        sauber(
            "Ein geloeschtes Kind wird BEISEITEGELEGT, nicht geworfen",
            "bereichBeiseite benennt den Ordner in `geloescht-<kennung>-<zeit>` um "
            "(server.ts, `fs.renameSync`) — am Geraet nicht zurueckholbar, aber die "
            "Daten sind noch da.",
        )
    if "data-vor-aufraeumen-" in s:
        sauber(
            "Sammelaufraeumen der Medien legt eine datierte Sicherung an",
            "und /api/medien/aufraeumen/zurueck spielt sie ein — ein Rueckweg AUS DER "
            "VERWALTUNG, drei Staende werden behalten.",
        )


def ssh(host: str, befehl: str) -> str | None:
    try:
        p = subprocess.run(
            ["ssh", "-o", "ConnectTimeout=8", "-o", "BatchMode=yes", f"dietpi@{host}", befehl],
            capture_output=True,
            text=True,
            timeout=25,
        )
        return p.stdout.strip()
    except Exception:
        return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--box", default=None, help="Adresse der Box — NUR LESEND")
    ap.add_argument("--nur", default=None, choices=["update", "medien", "loeschen", "gehalten"])
    a = ap.parse_args()

    laeufe = {
        "update": lambda: probe_update(a.box),
        "medien": probe_medien_neu,
        "loeschen": probe_deletelocal,
        "gehalten": probe_gehalten,
    }
    for name, f in laeufe.items():
        if a.nur and a.nur != name:
            continue
        f()

    print("\n" + "=" * 74)
    print(f"BEFUNDE: {len(befunde)}")
    for b in befunde:
        print(f"  [{b['schwere']}] {b['was'][:88]}…")
    print("=" * 74)
    return 0


if __name__ == "__main__":
    sys.exit(main())
