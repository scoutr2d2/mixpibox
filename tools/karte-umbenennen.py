#!/usr/bin/env python3
"""EINER KARTE EINEN EIGENEN NAMEN GEBEN — alle Stellen oder keine.

WOZU ES DAS GIBT (31.08.2026)
Ein Klon einer laufenden Box traegt deren Namen mit. Steckt er in einem zweiten
Geraet und beide laufen, melden sich zwei Rechner unter demselben mDNS-Namen —
und die Spotify-Auswahl laeuft ueber den NAMEN, nicht ueber die Adresse: der Ton
landet im falschen Raum. ANGLEICH-PI4-PI5.md nennt das „ein Fehler, der sich
nicht als Fehler meldet". [[karte-in-anderes-geraet-umsetzen]] beschreibt den Fund,
`tools/karte-fuer-anderes-geraet.py` findet ihn. Dieses Werkzeug behebt ihn.

WARUM „ALLES ODER NICHTS" DER GANZE PUNKT IST
Der Name steht an DREI Stellen, und sie haengen ungleich zusammen:

    /etc/hostname                   der Rechnername
    /etc/hosts                      die Zeile `127.0.1.1 <name>`
    /etc/mupibox/mupiboxconfig.json `.mupibox.host` -> der Spotify-Geraetename
                                    (`/etc/librespot/env-librespot` liest ihn
                                    von dort, es gibt keinen vierten Ort)

Wer nur `/etc/hostname` aendert und `/etc/hosts` vergisst, bekommt ein System,
in dem der eigene Name nicht mehr aufloest — `sudo` laeuft dann bei jedem Aufruf
in eine Zeitueberschreitung, bevor es weitermacht. Wer die Konfiguration
vergisst, hat den Spotify-Gleichstand NICHT behoben und glaubt es doch.
Und die drei Dateien gehoeren verschiedenen Eigentuemern: zwei root, eine (auf
Achims Karte) `achim`. Ein Lauf ohne die noetigen Rechte wuerde also einen Teil
schaffen und einen nicht — genau der halbe Zustand, der hier am teuersten ist.

Deshalb prueft dieses Werkzeug ZUERST jede Stelle auf Schreibbarkeit und ruehrt
KEINE an, wenn eine fehlt. Es nennt dann den Aufruf, der es kann.

RUECKWEG
Jede angefasste Datei bekommt EINE Sicherung unter FESTEM Namen
(`<datei>.vor-umbenennen`), die der naechste Lauf ueberschreibt — kein
wachsender Haufen aus `.vor-<zeitstempel>`, wie ihn `tools/ausliefern.py` auf
der Box vorgefunden hat (99 Dateien, 163 MB).

AUFRUF
    sudo python3 tools/karte-umbenennen.py --neu mixpibox2
    sudo python3 tools/karte-umbenennen.py --neu mixpibox2 --spotify MixPiBox2
    python3 tools/karte-umbenennen.py --neu mixpibox2 --probe   # nur zeigen

Ohne `--spotify` wird der Spotify-Geraetename aus `--neu` gebildet, in der
Schreibweise, die dort schon steht (aus `MixPiBox` wird `MixPiBox2`, nicht
`mixpibox2`) — der Name steht in der Spotify-App eines Menschen.

Ohne `--boot`/`--wurzel` sucht es die Karte wie
`tools/karte-fuer-anderes-geraet.py`: das ext4 mit `etc/mupibox`.

RUECKGABEWERTE
    0  umbenannt (oder --probe: es waere gegangen)
    1  Aufruf oder Umgebung — Karte nicht gefunden, nur lesend eingehaengt
    2  Rechte fehlen — NICHTS angefasst, der noetige Aufruf steht in der Ausgabe
    3  eine Stelle liess sich nach dem Schreiben nicht nachlesen
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
from pathlib import Path

NAME_REGEL = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")


def karte_suchen() -> list[Path]:
    """Wie im Schwesterwerkzeug am INHALT erkannt, nicht am Einhaengepunkt."""
    gefunden = []
    for zeile in Path("/proc/mounts").read_text(errors="replace").splitlines():
        teile = zeile.split()
        if len(teile) < 3:
            continue
        punkt, art = Path(teile[1].replace("\\040", " ")), teile[2]
        if art not in ("ext4", "ext3", "btrfs"):
            continue
        try:
            if (punkt / "etc/mupibox").is_dir() and (punkt / "etc/hostname").is_file():
                gefunden.append(punkt)
        except (PermissionError, OSError):
            continue
    return gefunden


def schreibbar(pfad: Path) -> bool:
    """os.access mit effective ids — `-w` auf der Datei allein genuegt nicht,
    das VERZEICHNIS muss auch beschreibbar sein, weil ersetzt statt editiert
    wird."""
    return os.access(pfad, os.W_OK, effective_ids=True) and os.access(
        pfad.parent, os.W_OK, effective_ids=True
    )


def spotify_ableiten(alt: str, neu_klein: str) -> str:
    """Aus `MixPiBox` + `mixpibox2` mach `MixPiBox2`.

    Der Spotify-Name steht in der App eines Menschen; ihn beim Umbenennen still
    auf Kleinschreibung zu setzen waere eine sichtbare Verschlechterung. Wenn
    der neue Name den alten als Praefix enthaelt (der Normalfall: derselbe Name
    plus Ziffer), bleibt die Schreibweise des alten stehen und nur der Rest
    kommt dazu."""
    if alt and neu_klein.lower().startswith(alt.lower()):
        return alt + neu_klein[len(alt):]
    return neu_klein


def hosts_ersetzen(text: str, alt: str, neu: str) -> tuple[str, int]:
    """Nur die 127.0.1.1-Zeile anfassen. Ein `str.replace` ueber die ganze Datei
    traefe auch `localhost`-Zeilen oder einen Namen, der zufaellig als Teilwort
    vorkommt."""
    zeilen, treffer = [], 0
    for z in text.splitlines():
        t = z.split()
        if len(t) >= 2 and t[0] == "127.0.1.1":
            zeilen.append(" ".join([t[0]] + [neu if n == alt else n for n in t[1:]]))
            treffer += 1
        else:
            zeilen.append(z)
    if treffer == 0:
        zeilen.append(f"127.0.1.1 {neu}")
        treffer = 1
    return "\n".join(zeilen) + "\n", treffer


def json_host_ersetzen(text: str, neu: str) -> str:
    """GEZIELT die eine Zeichenkette ersetzen, nicht die Datei neu ausgeben.

    `json.dump` wuerde die gesamte Konfiguration umformatieren — Reihenfolge,
    Einrueckung, Zahlen-Schreibweise. Der Diff waere unlesbar und ein
    Gegenlesen unmoeglich. Also Textersatz mit anschliessender Gegenprobe:
    danach muss die Datei gueltiges JSON sein UND genau diesen Wert tragen."""
    daten = json.loads(text)
    alt = (daten.get("mupibox") or {}).get("host")
    if alt is None:
        raise SystemExit("  ABBRUCH: `.mupibox.host` steht nicht in der Konfiguration")
    neu_text, anzahl = re.subn(
        r'("host"\s*:\s*)"' + re.escape(alt) + r'"', lambda m: m.group(1) + json.dumps(neu),
        text, count=1,
    )
    if anzahl != 1:
        raise SystemExit(f'  ABBRUCH: `"host": "{alt}"` war nicht genau einmal zu finden')
    probe = json.loads(neu_text)
    if probe["mupibox"]["host"] != neu:
        raise SystemExit("  ABBRUCH: der Ersatz kam nicht an — nichts geschrieben")
    return neu_text


def main() -> int:
    t = argparse.ArgumentParser(description="Einer MixPi-Karte einen eigenen Namen geben")
    t.add_argument("--neu", required=True, help="neuer Rechnername, klein (z. B. mixpibox2)")
    t.add_argument("--spotify", help="Spotify-Geraetename (sonst aus --neu abgeleitet)")
    t.add_argument("--wurzel", help="Einhaengepunkt der Wurzel (sonst gesucht)")
    t.add_argument("--probe", action="store_true", help="nur zeigen, nichts schreiben")
    a = t.parse_args()

    if not NAME_REGEL.match(a.neu):
        print(f"`{a.neu}` ist kein gueltiger Rechnername (klein, a-z 0-9 -, max 63)", file=sys.stderr)
        return 1

    if a.wurzel:
        wurzel = Path(a.wurzel)
    else:
        treffer = karte_suchen()
        if not treffer:
            print("Keine MixPi-Karte eingehaengt gefunden (ext4 mit etc/mupibox).", file=sys.stderr)
            return 1
        if len(treffer) > 1:
            print("Mehr als eine Karte eingehaengt — mit --wurzel eine waehlen:\n  "
                  + "\n  ".join(str(x) for x in treffer), file=sys.stderr)
            return 1
        wurzel = treffer[0]

    hostname_p = wurzel / "etc/hostname"
    hosts_p = wurzel / "etc/hosts"
    konfig_p = wurzel / "etc/mupibox/mupiboxconfig.json"

    for p in (hostname_p, hosts_p, konfig_p):
        if not p.is_file():
            print(f"{p} fehlt — das sieht nicht nach einer MixPi-Wurzel aus", file=sys.stderr)
            return 1

    alt_name = hostname_p.read_text(errors="replace").strip()
    konfig_text = konfig_p.read_text(errors="replace")
    alt_spotify = (json.loads(konfig_text).get("mupibox") or {}).get("host") or ""
    neu_spotify = a.spotify or spotify_ableiten(alt_spotify, a.neu)

    print(f"KARTE   {wurzel}")
    print(f"NAME    {alt_name!r} -> {a.neu!r}")
    print(f"SPOTIFY {alt_spotify!r} -> {neu_spotify!r}\n")

    if alt_name == a.neu and alt_spotify == neu_spotify:
        print("Beide Namen stehen schon so. Nichts zu tun.")
        return 0

    # ── ERST DIE RECHTE, DANN DER ERSTE SCHREIBVORGANG ──────────────────────
    # Ein halb umbenanntes System ist schlimmer als ein gar nicht umbenanntes:
    # loest der eigene Name nicht mehr auf, laeuft `sudo` in eine
    # Zeitueberschreitung, und genau dann sitzt man vor einem Geraet, das man
    # schlecht reparieren kann.
    fehlend = [p for p in (hostname_p, hosts_p, konfig_p) if not schreibbar(p)]
    if fehlend and not a.probe:
        print("RECHTE FEHLEN — nichts angefasst. Nicht schreibbar als "
              f"{os.getlogin() if hasattr(os, 'getlogin') else 'dieser Benutzer'}:")
        for p in fehlend:
            eig = p.owner() if hasattr(p, "owner") else "?"
            print(f"  {p}  (gehoert {eig})")
        print("\nSo geht es in EINEM Aufruf:")
        werkzeug = Path(__file__).resolve()
        zusatz = f" --spotify {neu_spotify}" if a.spotify else ""
        print(f"  sudo python3 {werkzeug} --neu {a.neu}{zusatz} --wurzel {wurzel}")
        return 2

    if a.probe:
        print("PROBE — es wuerde geschrieben:")
        print(f"  {hostname_p}")
        print(f"  {hosts_p}          (nur die 127.0.1.1-Zeile)")
        print(f"  {konfig_p}  (nur .mupibox.host)")
        if fehlend:
            print("\nHINWEIS: als dieser Benutzer NICHT schreibbar: "
                  + ", ".join(str(p) for p in fehlend))
        return 0

    # ── schreiben, mit EINER Sicherung unter festem Namen ───────────────────
    neue_hosts, _ = hosts_ersetzen(hosts_p.read_text(errors="replace"), alt_name, a.neu)
    neue_konfig = json_host_ersetzen(konfig_text, neu_spotify)

    for p, inhalt in ((hostname_p, a.neu + "\n"), (hosts_p, neue_hosts), (konfig_p, neue_konfig)):
        sicherung = p.with_suffix(p.suffix + ".vor-umbenennen")
        shutil.copy2(p, sicherung)
        p.write_text(inhalt, encoding="utf-8")
        print(f"  geschrieben: {p}   (Rueckweg: {sicherung.name})")

    # ── GEGENPROBE: nachlesen, nicht glauben ────────────────────────────────
    fehler = []
    if hostname_p.read_text().strip() != a.neu:
        fehler.append("etc/hostname")
    if f"127.0.1.1 {a.neu}" not in hosts_p.read_text():
        fehler.append("etc/hosts")
    if json.loads(konfig_p.read_text())["mupibox"]["host"] != neu_spotify:
        fehler.append("mupiboxconfig.json")
    if fehler:
        print("\nNACHGELESEN und NICHT in Ordnung: " + ", ".join(fehler), file=sys.stderr)
        return 3

    os.sync()
    print("\nNachgelesen: alle drei Stellen tragen den neuen Namen.")

    # AUF DEM LAUFENDEN SYSTEM IST DER AUSHAENGE-RAT FALSCH — und zwar
    # gefaehrlich falsch: er wuerde vorschlagen, `/` auszuhaengen. Am
    # 31.08.2026 stand er genau so da, nachdem das Werkzeug mit `--wurzel /`
    # ueber SSH auf einer laufenden Box gefahren wurde (das geht, und es ist
    # der bequemste Weg — also wird es wieder jemand tun).
    #
    # Ein laufendes System braucht ausserdem MEHR als die drei Dateien: der
    # Kernel haelt seinen eigenen Namen, und librespot liest `mupibox.host`
    # NUR beim Start. Ohne diese zwei Schritte heisst die Box in der
    # Spotify-Geraeteliste weiter wie vorher — also genau der Gleichstand,
    # gegen den man gerade umbenannt hat.
    if wurzel.resolve() == Path("/"):
        print("\nDas ist das LAUFENDE System. Es fehlen noch zwei Schritte:")
        print(f"  sudo hostnamectl set-hostname {a.neu}")
        print("  sudo systemctl restart librespot     # liest den Namen nur beim Start")
        print("Danach nachlesen: hostname; jq -r .mupibox.host /etc/mupibox/mupiboxconfig.json")
    else:
        print("Die Karte vor dem Herausnehmen aushaengen:")
        print(f"  udisksctl unmount -b $(findmnt -no SOURCE {wurzel})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
