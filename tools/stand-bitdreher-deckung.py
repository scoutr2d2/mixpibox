#!/usr/bin/env python3
"""Wie viele Bit-Dreher in einem Stand merkt `--pruefen` ueberhaupt?

WARUM DIE FRAGE AUFKAM
Der Selbsttest von mupibox-sicherung.py dreht EIN Byte in der MITTE des
Archivs um und erwartet, dass die Probe durchfaellt. Am 05.08.2026 fiel
dieser Test auf der Box einmal rot und dreimal gruen — bei gleicher Fassung
und gleichem md5. Ein Test, der von der Groesse des Archivs abhaengt, ist
kein Test, sondern ein Wuerfel.

DIE VERMUTUNG DAHINTER, die dieses Werkzeug pruefen soll: ein tar.gz wird
NICHT vollstaendig gelesen. `tarfile` haelt am Ende-Merkmal des tar an; was
danach kommt, sieht niemand an — und die Pruefsumme des gzip-Stroms wird
erst am STROMENDE geprueft, das dann nie erreicht wird. Ein Bit-Dreher hinter
dem Ende-Merkmal bliebe also unbemerkt.

Und das waere kein Schoenheitsfehler: `--pruefen` und die woechentliche
`--probe` sind das EINZIGE, was zwischen einer muede gewordenen Karte und
einem stillen Datenverlust steht.

AUFRUF
    stand-bitdreher-deckung.py <stand.tar.gz> [--schritt N]

Gearbeitet wird auf einer KOPIE unter /tmp; der Stand selbst wird nur
gelesen.
"""

from __future__ import annotations

import importlib.util
import os
import shutil
import sys
import tempfile

# WOHER DAS GEPRUEFTE WERKZEUG KOMMT (24.08.2026 nachgezogen):
# Der feste Pfad /usr/local/bin/... gilt nur AUF der Box. Am Arbeitsplatz
# starb diese Datei darum schon beim Import mit einem FileNotFoundError-
# Rueckverfolg — obwohl dieselbe Quelle im Baum unter scripts/mupibox/ liegt.
# Erst Box-Pfad, dann Baum-Kopie; welcher es wurde, wird GESAGT, damit
# niemand eine Messung am Baum fuer eine an der Box haelt (die beiden
# Fassungen laufen erfahrungsgemaess auseinander).
_BAUM = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     "scripts/mupibox/mupibox-sicherung.py")
WERKZEUG = os.environ.get("MUPIBOX_SICHERUNG") or next(
    (p for p in ("/usr/local/bin/mupibox/mupibox-sicherung.py", _BAUM) if os.path.exists(p)), "")
if not WERKZEUG or not os.path.exists(WERKZEUG):
    sys.exit("ABBRUCH: mupibox-sicherung.py nicht gefunden — weder unter "
             f"/usr/local/bin/mupibox/ noch unter {_BAUM}. "
             "Pfad ueber MUPIBOX_SICHERUNG setzen.")
if not WERKZEUG.startswith("/usr/local/"):
    print(f"HINWEIS: gemessen wird die BAUM-Fassung {WERKZEUG}, nicht die ausgelieferte.",
          file=sys.stderr)
_spec = importlib.util.spec_from_file_location("mupibox_sicherung", WERKZEUG)
sich = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sich)


def gemerkt(pfad: str) -> bool:
    """Faellt `stand_oeffnen` ueber diese Fassung? -> True heisst: gemerkt."""
    try:
        sich.stand_oeffnen(pfad)
        return False
    except (SystemExit, Exception):                              # noqa: BLE001
        return True


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    quelle = sys.argv[1]
    schritt = 1
    if "--schritt" in sys.argv:
        schritt = int(sys.argv[sys.argv.index("--schritt") + 1])

    roh = open(quelle, "rb").read()
    print(f"Stand: {quelle}  ({len(roh)} B), jedes {schritt}. Byte")

    with tempfile.TemporaryDirectory(prefix="bitdreher-") as tmp:
        ziel = os.path.join(tmp, "stand.tar.gz")
        shutil.copy2(quelle, ziel)
        if not gemerkt(ziel):
            pass
        else:
            print("  ! der unveraenderte Stand faellt schon durch — Abbruch")
            return 2

        # Was das Archiv UNVERAENDERT hergibt — der Massstab fuer „harmlos".
        stand0, inhalte0 = sich.stand_oeffnen(ziel)

        blind: list[int] = []
        harmlos: list[int] = []
        geprueft = 0
        for i in range(0, len(roh), schritt):
            b = bytearray(roh)
            b[i] ^= 0xFF
            with open(ziel, "wb") as f:
                f.write(bytes(b))
            geprueft += 1
            if gemerkt(ziel):
                continue
            blind.append(i)
            # NICHT GEMERKT ist nicht dasselbe wie SCHAEDLICH. Ein Byte im
            # gzip-Kopf (Zeitstempel, Betriebssystem) traegt keine Daten —
            # wird es umgedreht, kommt hinten dasselbe heraus, und dass
            # niemand Alarm schlaegt, ist richtig so. Diese Unterscheidung
            # entscheidet, ob ein Befund ein Fehler ist oder nur eine Zahl.
            try:
                stand1, inhalte1 = sich.stand_oeffnen(ziel)
                if inhalte1 == inhalte0 and stand1 == stand0:
                    harmlos.append(i)
            except (SystemExit, Exception):                       # noqa: BLE001
                pass

    print(f"  geprueft         {geprueft} Stellen")
    print(f"  gemerkt          {geprueft - len(blind)}")
    print(f"  NICHT GEMERKT    {len(blind)}  "
          f"({100.0 * len(blind) / max(1, geprueft):.1f} %)")
    print(f"    davon harmlos  {len(harmlos)}  (Archiv liefert danach Byte "
          f"fuer Byte dasselbe — nichts zu merken)")
    echt = [i for i in blind if i not in harmlos]
    print(f"    davon ECHT BLIND {len(echt)}  "
          f"({100.0 * len(echt) / max(1, geprueft):.2f} %)  "
          f"{'-> ' + str(echt[:20]) if echt else '— keine'}")
    if blind:
        # Zusammenhaengende Laeufe zeigen, nicht 286 einzelne Zahlen: erst an
        # den Laeufen sieht man, DASS es zwei verschiedene Ursachen sind.
        laeufe: list[list[int]] = []
        for i in blind:
            if laeufe and i == laeufe[-1][1] + schritt:
                laeufe[-1][1] = i
            else:
                laeufe.append([i, i])
        print("  blinde Bereiche:")
        for a, e in laeufe:
            anteil = 100.0 * (e - a + schritt) / len(roh)
            wo = ("gzip-Kopf (Zeitstempel/Merkmale — steht nicht fuer Daten)"
                  if e < 10 else
                  "am ENDE: hinter dem Ende-Merkmal des tar" if e > len(roh) - 1200
                  else "mittendrin")
            print(f"    Byte {a}–{e}  ({e - a + schritt} B, {anteil:.1f} %)  {wo}")
        schwanz = [a for a, e in laeufe if e > len(roh) - 1200]
        if schwanz:
            print(f"  -> die letzten {len(roh) - min(schwanz)} Bytes "
                  f"({100.0 * (len(roh) - min(schwanz)) / len(roh):.1f} % des "
                  f"Archivs) werden NIE gelesen: `tarfile` haelt am "
                  f"Ende-Merkmal an, und damit wird die Pruefsumme des "
                  f"gzip-Stroms nie erreicht.")
        mitte = len(roh) // 2
        print(f"  die MITTE ({mitte}) liegt "
              f"{'IM BLINDEN BEREICH — der Selbsttest wuerfelt' if mitte in blind else 'im geprueften Bereich'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
