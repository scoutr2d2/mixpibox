#!/usr/bin/env python3
"""WO IST DIE BOX? — die eine Stelle, die das beantwortet.

WOZU (Betreiber, 20.09.2026): „ich moechte ein auffindbarkeits feature im
netzwerk, gerade auch hier zum entwickeln — es gibt immer wieder die frage
welche ip, das muessen wir doch besser hinbekommen."

══ WAS BISHER DAGEGEN STAND ═══════════════════════════════════════════════

155 Werkzeuge in diesem Baum nehmen eine Box-Adresse von Hand entgegen, und
die Adresse wechselt per DHCP. Im Wissenspaket stehen deshalb Saetze wie
„.62/.78/.81 binnen Tagen" — Zustandsangaben mit Verfallsdatum.

UND DER NAHELIEGENDE AUSWEG IST EINE FALLE. Am 20.09.2026 habe ich das ganze
Netz auf Port 8200 abgesucht und einen Treffer bekommen: 192.168.178.199.
Das war ein FREMDER Rechner, der dort schlichte 404er liefert — beinahe
haette ich ihn fuer die Box gehalten. „Etwas antwortet auf 8200" ist keine
Identifikation, sondern eine Vermutung.

Im selben Haus stehen ausserdem ZWEI Geraete mit aehnlichem Namen
(`MuPiBox.local` und `MixPiBox.local`). Ein Suchlauf ohne Namensabgleich
liefert dann die falsche.

══ DIE REIHENFOLGE, UND WARUM SIE SO IST ══════════════════════════════════

  1. `--box` / MUPIBOX_BOX   was der Mensch sagt, gilt — aber wird geprueft.
  2. der gemerkte Fund       billigster Treffer, meist richtig.
  3. die mDNS-Namen          der EIGENTLICH richtige Weg (siehe unten).
  4. das Netz absuchen       teuer und laut; nur, wenn sonst nichts half.

JEDE STUFE PRUEFT POSITIV: Es zaehlt nur, was auf `/api/box` mit
`{"box":"mixpibox", …}` antwortet. Ein 404, eine HTML-Seite, ein anderer
JSON-Dienst — alles kein Treffer.

══ WARUM DER SCAN NICHT DIE LOESUNG IST, SONDERN DER RUECKFALL ════════════

mDNS ist die richtige Antwort auf „welche IP" — die Box sagt es selbst, ohne
dass jemand sucht. Genau deshalb steht hier ein Hinweis, wenn der Scan
greifen musste: Dann ist am Geraet etwas nicht in Ordnung (avahi aus, Name
geaendert), und das gehoert dort behoben und nicht hier umgangen.

AUFRUF
    python3 tools/box-finden.py                 # findet und nennt die Adresse
    python3 tools/box-finden.py --nur-adresse   # nur die Adresse, fuer $(…)
    python3 tools/box-finden.py --pruefen       # fuer tools/pruefen.sh
    python3 tools/box-finden.py --box 192.168.178.62
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
GEMERKT = WURZEL / ".box-adresse.json"
PORT = 8200

# Die Namen, unter denen die Box sich melden koennte. MEHRERE, weil der
# Hostname im Ausrollweg (`config/templates/dietpi.txt`: MuPiBox) und der
# Name der Box im Haus (MixPiBox) auseinanderlaufen — wer nur einen fragt,
# findet die Haelfte der Boxen nicht.
NAMEN = ["MixPiBox.local", "mixpibox.local", "MuPiBox.local", "mupibox.local"]

# Wie lange ein gemerkter Fund ueberhaupt einen Versuch wert ist. Danach wird
# er trotzdem probiert (er kostet eine halbe Sekunde), aber nicht mehr
# gemeldet als „frisch".
GEMERKT_FRISCH_S = 6 * 3600


def kennmarke(adresse: str, frist: float = 1.5) -> dict | None:
    """Antwortet dort eine MixPiBox? Gibt ihre Auskunft zurueck, sonst None.

    DIE PRUEFUNG IST DER KERN DIESES WERKZEUGS. Sie darf nicht weicher
    werden: `box == 'mixpibox'` ist die Bedingung, nicht „irgendein JSON".
    """
    ziel = adresse if adresse.startswith("http") else f"http://{klammer(adresse)}:{PORT}"
    try:
        with urllib.request.urlopen(f"{ziel}/api/box", timeout=frist) as a:
            if a.status != 200:
                return None
            d = json.loads(a.read().decode("utf-8", "replace"))
    except (urllib.error.URLError, OSError, ValueError, json.JSONDecodeError):
        return None
    return d if isinstance(d, dict) and d.get("box") == "mixpibox" else None


def klammer(adresse: str) -> str:
    """IPv6 gehoert in eckige Klammern, sonst ist die URL keine."""
    try:
        if isinstance(ipaddress.ip_address(adresse.split("%")[0]), ipaddress.IPv6Address):
            return f"[{adresse}]"
    except ValueError:
        pass
    return adresse


def merken(adresse: str, auskunft: dict) -> None:
    try:
        GEMERKT.write_text(
            json.dumps({"adresse": adresse, "name": auskunft.get("name", ""), "wann": time.time()}, indent=2),
            encoding="utf-8",
        )
    except OSError:
        pass  # Kein Schreibrecht: dann eben jedes Mal suchen.


def gemerkt_lesen() -> tuple[str, float] | None:
    try:
        d = json.loads(GEMERKT.read_text(encoding="utf-8"))
        return str(d.get("adresse", "")), float(d.get("wann", 0))
    except (OSError, ValueError, json.JSONDecodeError):
        return None


def ueber_namen() -> list[str]:
    """Alle Adressen, die hinter den mDNS-Namen stehen — IPv4 zuerst."""
    aus: list[str] = []
    for name in NAMEN:
        try:
            for fam, _t, _p, _k, sa in socket.getaddrinfo(name, PORT, proto=socket.IPPROTO_TCP):
                adresse = sa[0]
                if fam == socket.AF_INET6 and "%" not in adresse and adresse.startswith("fe80"):
                    continue  # link-local ohne Zone ist nicht waehlbar
                if adresse not in aus:
                    aus.append(adresse)
        except (socket.gaierror, OSError):
            continue
    aus.sort(key=lambda a: ":" in a)  # IPv4 vor IPv6
    return aus


def eigene_netze() -> list[str]:
    """Die /24-Netze, in denen dieser Rechner steht."""
    netze: list[str] = []
    try:
        roh = subprocess.run(["ip", "-4", "-o", "addr"], capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.SubprocessError):
        return netze
    for zeile in roh.splitlines():
        teile = zeile.split()
        if "inet" not in teile:
            continue
        try:
            netz = ipaddress.ip_interface(teile[teile.index("inet") + 1]).network
        except ValueError:
            continue
        if netz.is_loopback or netz.prefixlen < 22:
            continue  # nichts Groesseres als /22 absuchen — sonst dauert es ewig
        s = str(netz)
        if s not in netze:
            netze.append(s)
    return netze


def netz_absuchen(netz: str) -> tuple[str, dict] | None:
    adressen = [str(a) for a in ipaddress.ip_network(netz).hosts()]
    with ThreadPoolExecutor(max_workers=64) as pool:
        for adresse, auskunft in zip(adressen, pool.map(lambda a: kennmarke(a, 0.7), adressen)):
            if auskunft:
                return adresse, auskunft
    return None


def suchen(vorgabe: str | None) -> tuple[str, dict, str] | None:
    """Gibt (Adresse, Auskunft, Weg) zurueck — oder None."""
    if vorgabe:
        # AUCH DAS GESAGTE WIRD GEPRUEFT. Eine veraltete Adresse aus dem
        # Gedaechtnis eines Menschen ist genauso falsch wie eine aus einer
        # Datei — und sie ohne Pruefung weiterzureichen heisst, den Fehler
        # erst drei Werkzeuge spaeter zu sehen.
        a = kennmarke(vorgabe, 3.0)
        return (vorgabe, a, "genannt") if a else None

    g = gemerkt_lesen()
    if g and g[0]:
        a = kennmarke(g[0], 1.5)
        if a:
            alter = "frisch" if time.time() - g[1] < GEMERKT_FRISCH_S else "aelter"
            return g[0], a, f"gemerkt ({alter})"

    for adresse in ueber_namen():
        a = kennmarke(adresse, 2.0)
        if a:
            return adresse, a, "mDNS"

    for netz in eigene_netze():
        fund = netz_absuchen(netz)
        if fund:
            return fund[0], fund[1], f"Suchlauf in {netz}"
    return None


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--box", help="Adresse oder Name, die geprueft werden soll")
    p.add_argument("--nur-adresse", action="store_true", help="nur die Adresse ausgeben")
    p.add_argument("--pruefen", action="store_true", help="still; Exit 1, wenn die Box nicht gefunden wurde")
    a = p.parse_args()

    vorgabe = a.box or os.environ.get("MUPIBOX_BOX") or None
    fund = suchen(vorgabe)

    if not fund:
        if a.pruefen:
            # NICHT ROT: Eine ausgeschaltete Box ist kein Fehler im Baum. Der
            # Gesamtlauf darf daran nicht scheitern — er misst Quelltext, nicht
            # die Steckdose. Gesagt wird es trotzdem.
            print("  keine Box im Netz gefunden — uebersprungen (Box aus? anderes Netz?)")
            return 0
        print(
            "Keine Box gefunden.\n"
            "  Geprueft wurde: gemerkte Adresse, die mDNS-Namen "
            f"({', '.join(NAMEN)}), und ein Suchlauf ueber die eigenen Netze.\n"
            "  Ist sie an? Haengt sie im selben Netz? Dann am Geraet nachsehen:\n"
            "    systemctl is-active avahi-daemon   (der Name kommt von dort)\n"
            "    hostname -I                        (welche Adresse sie wirklich hat)",
            file=sys.stderr,
        )
        return 1

    adresse, auskunft, weg = fund
    merken(adresse, auskunft)

    if a.nur_adresse:
        print(adresse)
        return 0
    if a.pruefen:
        print(f"  {auskunft.get('name', '?')} auf {adresse} ({weg})")
        return 0

    print(f"\n  {auskunft.get('name', '?')} — {adresse}:{PORT}   (gefunden ueber: {weg})")
    print(f"    Quelle : {auskunft.get('quelle', '?')}")
    print(f"    Stand  : {(auskunft.get('commit') or '?')[:8]} auf {auskunft.get('zweig') or '?'}, "
          f"gebaut {auskunft.get('gebautAm') or '?'}")
    andere = [x for x in auskunft.get("adressen", []) if x != adresse]
    if andere:
        print(f"    Auch da: {', '.join(andere)}")
    if weg.startswith("Suchlauf"):
        # EIN SCAN IST EIN BEFUND, KEIN ERFOLG. Wer ihn braucht, hat am Geraet
        # ein Problem — und wer das hier nicht sagt, gewoehnt sich das Suchen an.
        print(
            "\n    HINWEIS: gefunden nur ueber den Suchlauf, nicht ueber den Namen.\n"
            "    Das heisst: mDNS antwortet nicht. Am Geraet nachsehen —\n"
            "      systemctl is-active avahi-daemon\n"
            "    Solange das so ist, ist die Box fuer jeden anderen im Haus unauffindbar."
        )
    print(f"\n    Weiterverwenden:  python3 tools/ausliefern.py --box dietpi@{adresse}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
