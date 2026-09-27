#!/usr/bin/env python3
"""Vergleicht die beiden Ausrollwege: was legt der Erstweg hin, was der Update-Weg?

DIE FRAGE, DIE DAS WERKZEUG BEANTWORTET: Wer eine Datei im Repo aendert (eine
systemd-Unit, eine Vorlage), erreicht damit nur FRISCHE Karten oder auch
BESTANDSBOXEN? Beide Wege pflegen je eine eigene, von Hand gefuehrte Liste
derselben Dateien - und die Raender laufen auseinander.

    autosetup/autosetup.sh           der Erstweg (frische SD-Karte)
    update/start_mupibox_update.sh   der Update-Weg (Box im Haus)

GEZAEHLT WIRD NUR, WAS WIRKLICH HINGELEGT WIRD: `cp`/`mv`/`install`-Zeilen mit
einem `${MUPI_SRC}/...`-Pfad. Auskommentierte Zeilen zaehlen NICHT - genau die
Falle, in die eine reine Trefferzaehlung (`grep -c`) laeuft: `systemctl start
mupibox-server.service` im Update-Weg sieht aus wie Pflege, legt die Unit aber
nie hin.

NICHT ZU VERWECHSELN mit `tools/units-decken-sich.sh`. Das fragt: hat jede Unit,
die autosetup.sh ANFASST, auch eine Datei im Repo? Das hier fragt die andere
Haelfte: kommt die Datei auch bei einer Box an, die schon laeuft? Beide Fragen
haben denselben Ausgang - eine Aenderung, die nirgends ankommt - aber sie
finden verschiedene Faelle, und keine der beiden findet die der anderen.

    python3 tools/ausrollwege-vergleich.py            # Bericht
    python3 tools/ausrollwege-vergleich.py --nur-luecke   # nur die eine Richtung
    python3 tools/ausrollwege-vergleich.py --streng    # Rueckgabe 1, wenn die Luecke nicht leer ist
"""

import argparse
import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
ERSTWEG = WURZEL / "autosetup" / "autosetup.sh"
UPDATEWEG = WURZEL / "update" / "start_mupibox_update.sh"

# ${MUPI_SRC}/<pfad> - der Pfad endet am Leerzeichen, Anfuehrungszeichen oder Zeilenende.
QUELLE = re.compile(r"\$\{MUPI_SRC\}/([^\s\"'>]+)")
# Nur echte Ablage-Befehle. `rm`, `chmod`, `systemctl` legen nichts hin.
ABLAGE = re.compile(r"\b(cp|mv|install|rsync)\b")


def ablagen(datei: Path) -> dict[str, int]:
    """Pfad relativ zum Repo -> Zeilennummer des ersten Vorkommens."""
    if not datei.exists():
        sys.exit(f"FEHLT: {datei}")
    gefunden: dict[str, int] = {}
    for nr, zeile in enumerate(datei.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
        entkleidet = zeile.lstrip()
        if entkleidet.startswith("#"):  # auskommentiert = wird nicht ausgerollt
            continue
        if not ABLAGE.search(zeile):
            continue
        for treffer in QUELLE.findall(zeile):
            gefunden.setdefault(treffer.rstrip("/"), nr)
    return gefunden


def erwaehnungen(datei: Path) -> dict[str, tuple[str, int]]:
    """Pfad -> ('auskommentiert'|'anders', Zeile) fuer alles, was KEINE Ablage ist.

    Der Unterschied traegt das Urteil: ein auskommentiertes `mv` ist eine
    ENTSCHEIDUNG (splash.png wird nicht ueberschrieben, der Betreiber hat
    vielleicht ein eigenes). Eine Datei, die im anderen Weg GAR NICHT vorkommt,
    ist dagegen wahrscheinlich vergessen worden.
    """
    gefunden: dict[str, tuple[str, int]] = {}
    for nr, zeile in enumerate(datei.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
        entkleidet = zeile.lstrip()
        kommentar = entkleidet.startswith("#")
        if not kommentar and ABLAGE.search(zeile):
            continue  # das ist eine echte Ablage, gehoert nicht hierher
        for treffer in QUELLE.findall(zeile):
            gefunden.setdefault(treffer.rstrip("/"), ("auskommentiert" if kommentar else "anders", nr))
    return gefunden


def bericht(nur_luecke: bool = False) -> int:
    erst = ablagen(ERSTWEG)
    upd = ablagen(UPDATEWEG)
    upd_sonst = erwaehnungen(UPDATEWEG)

    luecke = sorted(set(erst) - set(upd))       # frische Karte JA, Bestandsbox NEIN
    nur_update = sorted(set(upd) - set(erst))   # nur der Update-Weg kennt es
    beide = sorted(set(erst) & set(upd))

    if not nur_luecke:
        print(f"Erstweg   {ERSTWEG.relative_to(WURZEL)}: {len(erst)} Ablagen")
        print(f"Updateweg {UPDATEWEG.relative_to(WURZEL)}: {len(upd)} Ablagen")
        print(f"in beiden: {len(beide)}\n")

    # Das Urteil haengt daran, WIE der Update-Weg die Datei sonst erwaehnt.
    stumm = [p for p in luecke if p not in upd_sonst]
    erklaert = [p for p in luecke if p in upd_sonst]

    print(f"OHNE JEDE ERWAEHNUNG IM UPDATE-WEG ({len(stumm)}) - wer das aendert, erreicht KEINE Bestandsbox:")
    print("  (Screen, kein Urteil: gesucht wird der ${MUPI_SRC}-Pfad. Wer die Datei nur")
    print("   unter ihrem ZIEL nennt - /etc/asound.conf - faellt hier trotzdem herein.)")
    for pfad in stumm:
        print(f"  {pfad}   (autosetup.sh:{erst[pfad]})")

    print(f"\nERWAEHNT, ABER NICHT ABGELEGT ({len(erklaert)}) - je Zeile nachsehen, oft Absicht:")
    for pfad in erklaert:
        art, nr = upd_sonst[pfad]
        print(f"  {pfad}   (autosetup.sh:{erst[pfad]} -> update {art}, Zeile {nr})")

    if not nur_luecke:
        print(f"\nNUR IM UPDATE-WEG ({len(nur_update)}) - fehlt der frischen Karte:")
        for pfad in nur_update:
            print(f"  {pfad}   (start_mupibox_update.sh:{upd[pfad]})")

    return len(stumm)


if __name__ == "__main__":
    zerleger = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    zerleger.add_argument("--nur-luecke", action="store_true", help="nur die Richtung Erstweg -> Updateweg")
    zerleger.add_argument("--streng", action="store_true", help="Rueckgabe 1, wenn die Luecke nicht leer ist")
    args = zerleger.parse_args()

    offen = bericht(nur_luecke=args.nur_luecke)
    sys.exit(1 if (args.streng and offen) else 0)
