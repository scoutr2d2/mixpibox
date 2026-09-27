#!/usr/bin/env python3
"""
WOZU: Findet im alten PHP-Admin jede Stelle, die Dateien vom UPSTREAM-Projekt
(splitti/MuPiBox) holt — und sagt, welche davon den Fork loeschen wuerde.

Der Anlass (llmwiki mupi-update-knopf-loescht-den-fork): admin.php rief als root
`curl …/start_mupibox_update.sh | sudo bash` und installierte damit das
Upstream-Archiv ueber die Box. Ein Klick, und die Arbeit von Tagen ist weg.

DIE FALLE, DIE DIESES WERKZEUG ALS ERSTES GEFUNDEN HAT, und der eigentliche
Grund, warum es existiert:

    Ausgeliefert wird NICHT AdminInterface/www/, sondern
    AdminInterface/release/www.zip (autosetup/autosetup.sh:472 entpackt das Zip
    nach /var/www/). Wer nur die .php-Dateien bearbeitet und das Zip vergisst,
    hat auf einer frischen SD-Karte GAR NICHTS geaendert — die Quelle sieht
    sauber aus, die Box bekommt weiter den alten Knopf.

    Gemessen am 03.08.2026: www/ und das Zip gingen bereits auseinander
    (spotify.php war im Zip drei Monate alt). Der Abgleich ist also kein
    theoretischer Schutz.

AUFRUF:
    python3 tools/php-admin-fremdbezug-schau.py            # Bericht + Pruefung
    python3 tools/php-admin-fremdbezug-schau.py --liste     # nur die Fundstellen
    python3 tools/php-admin-fremdbezug-schau.py --zip-neu   # Zip aus www/ neu bauen

RUECKGABE: 0 wenn nichts Fork-Loeschendes mehr drin ist UND das Zip zur Quelle
passt; sonst 1. Damit taugt es fuer tools/pruefen.sh.
"""

import argparse
import hashlib
import re
import subprocess
import sys
import zipfile
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
QUELLE = WURZEL / "AdminInterface" / "www"
PAKET = WURZEL / "AdminInterface" / "release" / "www.zip"

# Der Rechnername des Ursprungsprojekts. Alles, was hier auftaucht UND
# ausgefuehrt oder in eine Systemdatei geschrieben wird, ist ein Fremdbezug.
UPSTREAM = re.compile(
    r"raw\.githubusercontent\.com/splitti/MuPiBox|api\.github\.com/repos/splitti/MuPiBox"
)

# Ein reiner Verweis (Link im Fusszeilen-HTML) ist KEIN Bezug — er laedt nichts.
NUR_VERWEIS = re.compile(r"<a\s|href=|target=\"_blank\"")

# Stellen, die den FORK SELBST ueberschreiben wuerden. Keine davon darf
# uebrigbleiben. Die Muster stehen einzeln da, damit der Bericht sagen kann,
# WAS zerstoert wuerde — "irgendwas mit curl" hilft beim Aufraeumen nicht.
TOEDLICH = {
    "start_mupibox_update.sh": "installiert das Upstream-Archiv ueber die Box — der Fork ist weg",
    "conf_update.sh": "zieht mupiboxconfig.json auf die Upstream-Schluesselliste zurueck",
    "config/templates/mupiboxconfig.json": "ersetzt die Konfiguration durch die Upstream-Vorlage",
    "main/version.json": "das Upstream-Angebot, aus dem der Update-Knopf seine Beschriftung baute",
    "main/news.txt": "Upstream-Nachrichten auf der Startseite eines Forks",
    "api.github.com": "fragt den Upstream-Stand ab, um ihn als 'neuer' anzubieten",
}

# Bewusst GEDULDETE Fremdbezuege: sie holen fremden Code mit erhoehten Rechten,
# loeschen aber den Fork nicht — und es gibt in der neuen Verwaltung (noch)
# keinen Ersatz. Sperren wuerde eine echte Funktion ohne Nachfolger wegnehmen.
# Die Liste ist ABSICHTLICH eine feste Aufzaehlung: kommt eine NEUE Stelle
# dazu, faellt sie durch und muss hier eingetragen (= entschieden) werden.
GEDULDET = {
    ("service.php", "config/templates/smb.conf"),
    ("service.php", "config/templates/proftpd.conf"),
    ("network.php", "config/templates/smb.conf"),
    ("network.php", "config/templates/proftpd.conf"),
    ("network.php", "scripts/online/install_rtl88x2bu.sh"),
    ("network.php", "scripts/online/remove_rtl88x2bu.sh"),
}


def php_dateien(verzeichnis: Path):
    return sorted(p for p in verzeichnis.rglob("*.php"))


def zeilen_pruefen(name: str, text: str):
    """Liefert (toedlich, geduldet, unbekannt) als Listen von (zeile_nr, zeile, grund)."""
    toedlich, geduldet, unbekannt = [], [], []
    for nr, zeile in enumerate(text.split("\n"), 1):
        if not UPSTREAM.search(zeile):
            continue
        blank = zeile.strip()
        # Kommentarzeilen dokumentieren, was frueher dastand — kein Bezug.
        if blank.startswith(("*", "//", "#", "/*")):
            continue
        if NUR_VERWEIS.search(zeile):
            continue
        for muster, grund in TOEDLICH.items():
            if muster in zeile:
                toedlich.append((nr, blank, grund))
                break
        else:
            for datei, muster in GEDULDET:
                if datei == name and muster in zeile:
                    geduldet.append((nr, blank, "geduldet: kein Fork-Verlust, kein Ersatz da"))
                    break
            else:
                unbekannt.append((nr, blank, "NEUER Fremdbezug — bitte entscheiden"))
    return toedlich, geduldet, unbekannt


def paket_lesen(paket: Path) -> dict:
    if not paket.is_file():
        return {}
    with zipfile.ZipFile(paket) as z:
        return {
            i.filename: z.read(i.filename)
            for i in z.infolist()
            if not i.is_dir()
        }


def abgleich_quelle_paket(inhalt: dict):
    """Die eigentliche Falle: was ausgeliefert wird, ist das Zip — nicht www/."""
    abweichungen = []
    quell_dateien = {
        str(p.relative_to(QUELLE)): p.read_bytes()
        for p in QUELLE.rglob("*")
        if p.is_file()
    }
    for name, roh in sorted(quell_dateien.items()):
        # Das Zip enthaelt die Namen mit './'-Praefix je nach Bauart.
        treffer = inhalt.get(name, inhalt.get("./" + name))
        if treffer is None:
            abweichungen.append((name, "FEHLT im Zip"))
        elif hashlib.sha256(treffer).digest() != hashlib.sha256(roh).digest():
            abweichungen.append((name, "im Zip ANDERS als in www/"))
    for name in sorted(inhalt):
        sauber = name[2:] if name.startswith("./") else name
        if sauber not in quell_dateien:
            abweichungen.append((sauber, "im Zip, aber nicht mehr in www/"))
    return abweichungen


def zip_neu_bauen() -> int:
    """Baut release/www.zip aus www/ — wie AdminInterface/zip.sh, aber ohne cd-Falle."""
    PAKET.parent.mkdir(parents=True, exist_ok=True)
    if PAKET.exists():
        PAKET.unlink()
    ergebnis = subprocess.run(
        ["zip", "-r", "-q", str(PAKET), "."], cwd=str(QUELLE), check=False
    )
    return ergebnis.returncode


def main() -> int:
    zerteiler = argparse.ArgumentParser(description=__doc__)
    zerteiler.add_argument("--liste", action="store_true", help="nur die Fundstellen")
    zerteiler.add_argument("--zip-neu", action="store_true", help="release/www.zip neu bauen")
    args = zerteiler.parse_args()

    # DER PHP-ADMIN IST AUSGEBAUT (E47, 19.08.2026): `git ls-tree HEAD
    # AdminInterface` ist leer, die neue Verwaltung ist die einzige. Auf dieser
    # Maschine liegt nur noch ein leerer, root-eigener Geisterordner. Ohne
    # diesen Fruehausstieg war die Wache seitdem DAUERROT („release/www.zip
    # fehlt") — und eine dauerrote Wache verdeckt den naechsten echten Fund
    # (llmwiki: dauerrote-wache-ist-keine). Sie bleibt trotzdem bestehen:
    # taucht je wieder eine .php-Quelle auf, prueft sie wie zuvor.
    if not any(True for _ in php_dateien(QUELLE)) and not PAKET.exists():
        print("PHP-Admin ist ausgebaut (E47) — keine Quelle, kein Paket, nichts zu pruefen.")
        return 0

    if args.zip_neu:
        rc = zip_neu_bauen()
        print(f"release/www.zip neu gebaut (rc={rc})")
        if rc != 0:
            return 1

    fehler = 0
    alle_toedlich, alle_unbekannt = [], []
    geduldet_gesamt = 0

    for pfad in php_dateien(QUELLE):
        name = str(pfad.relative_to(QUELLE))
        text = pfad.read_text(encoding="utf-8", errors="replace")
        toedlich, geduldet, unbekannt = zeilen_pruefen(name, text)
        geduldet_gesamt += len(geduldet)
        for nr, zeile, grund in toedlich:
            alle_toedlich.append((name, nr, zeile, grund))
        for nr, zeile, grund in unbekannt:
            alle_unbekannt.append((name, nr, zeile, grund))
        if args.liste:
            for nr, zeile, grund in geduldet:
                print(f"  geduldet  {name}:{nr}  {grund}")

    print("== Fremdbezug im PHP-Admin (Quelle: AdminInterface/www) ==")
    if alle_toedlich:
        fehler = 1
        print(f"\nFORK-LOESCHEND — {len(alle_toedlich)} Stelle(n), keine davon darf bleiben:")
        for name, nr, zeile, grund in alle_toedlich:
            print(f"  {name}:{nr}  {grund}")
            print(f"      {zeile[:140]}")
    else:
        print("\nFORK-LOESCHEND: keine. Der Update-Knopf kann den Fork nicht mehr entfernen.")

    if alle_unbekannt:
        fehler = 1
        print(f"\nNEU UND UNENTSCHIEDEN — {len(alle_unbekannt)} Stelle(n):")
        for name, nr, zeile, grund in alle_unbekannt:
            print(f"  {name}:{nr}  {grund}")
            print(f"      {zeile[:140]}")

    print(f"\nGEDULDET (fremder Code, aber kein Fork-Verlust): {geduldet_gesamt} Stelle(n)")
    print("  -> service.php/network.php: smb.conf, proftpd.conf, rtl88x2bu-Treiber.")
    print("     Sie bleiben, bis die neue Verwaltung einen Ersatz hat.")

    print("\n== Abgleich www/ gegen release/www.zip (das AUSGELIEFERTE) ==")
    inhalt = paket_lesen(PAKET)
    if not inhalt:
        print("  release/www.zip fehlt oder ist leer.")
        fehler = 1
    else:
        abweichungen = abgleich_quelle_paket(inhalt)
        if abweichungen:
            fehler = 1
            print(f"  {len(abweichungen)} Abweichung(en) — die Box bekaeme NICHT, was hier steht:")
            for name, was in abweichungen:
                print(f"    {name}: {was}")
            print("  Beheben:  python3 tools/php-admin-fremdbezug-schau.py --zip-neu")
        else:
            print(f"  deckungsgleich ({len(inhalt)} Dateien). Eine frische SD bekaeme genau das hier.")

    print("\nErgebnis:", "FEHLER" if fehler else "in Ordnung")
    return fehler


if __name__ == "__main__":
    sys.exit(main())
