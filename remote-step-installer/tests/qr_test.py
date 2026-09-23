#!/usr/bin/env python3
"""
Tests fuer den selbstgeschriebenen QR-Kodierer (tools/qr.py).

WARUM DIESER TEST MEHR WERT IST ALS DER UEBLICHE: Ein QR-Code, der falsch ist,
SIEHT AUS WIE EINER. Am Bildschirm der Box faellt nichts auf; der Fehler zeigt
sich erst, wenn ein Elternteil das Handy davorhaelt und nichts passiert. Ein
Test, der nur prueft „es kommt eine Matrix heraus", waere hier wertlos.

Deshalb wird gegen ZWEI unabhaengige Fremdmeinungen geprueft:

  1. `qrencode` erzeugt denselben Code — Feld fuer Feld verglichen. Das deckt
     Fassungswahl, Fehlerkorrektur, Maskenwahl und Platzierung ab; ein
     einzelnes falsches Feld faellt sofort auf.
  2. `zbarimg` LIEST das Ergebnis ZURUECK. Das ist die Probe, die zaehlt: es
     ist derselbe Weg, den das Handy geht.

Beide fehlen auf einer frischen Box — sie sind Werkzeuge des
Entwicklungsrechners, nicht der Box. Fehlen sie, wird der jeweilige Teil
UEBERSPRUNGEN und gesagt, was fehlt; rot wird davon nichts.

  python3 tests/qr_test.py
"""
import os
import shutil
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "tools"))
import qr  # noqa: E402

ok = bad = uebersprungen = 0


def pruefe(bedingung: bool, was: str, hinweis: str = "") -> None:
    global ok, bad
    if bedingung:
        ok += 1
        print(f"  ok    {was}")
    else:
        bad += 1
        print(f"  FEHL  {was}")
        if hinweis:
            print(f"        {hinweis}")


# Die Faelle, die im Betrieb wirklich vorkommen — plus die Raender.
FAELLE = [
    ("kurz", "MuPiBox"),
    ("Adresse der Box", "http://192.168.178.169:8098/einrichtung"),
    ("WLAN-Code", "WIFI:S:MuPiBox-Einrichtung;T:WPA;P:einrichten2026;;"),
    ("mit Umlauten (UTF-8)", "MuPiBox — Grüße aus der Küche"),
    ("lang", "http://192.168.178.169:8098/einrichtung?token=" + "a" * 120),
]


def qrencode_matrix(text: str) -> list[list[int]] | None:
    """Die Referenzmatrix von qrencode — '##' ist ein dunkles Feld.

    MIT `-8`, also erzwungenem Byte-Modus. OHNE das zerlegt qrencode den Text
    in gemischte Modi und kodiert Ziffernblöcke kompakter — voellig richtig,
    aber ein anderer Bitstrom und damit eine andere Matrix. tools/qr.py macht
    das bewusst nicht (siehe „WAS ES NICHT KANN" dort). Ohne `-8` vergliche man
    zwei verschiedene, jeweils gueltige Kodierungen und nennte den Unterschied
    einen Fehler.
    """
    roh = subprocess.run(
        ["qrencode", "-l", "M", "-t", "ASCII", "-m", "0", "-8", "--", text],
        capture_output=True,
        text=True,
    )
    if roh.returncode != 0:
        return None
    zeilen = [z for z in roh.stdout.splitlines() if z.strip()]
    return [[1 if z[i] == "#" else 0 for i in range(0, len(z), 2)] for z in zeilen]


# Die genormten Formatzeichenketten fuer Stufe M — daraus laesst sich die von
# einer fremden Umsetzung GEWAEHLTE Maske ablesen.
FORMAT_M = {
    0: "101010000010010", 1: "101000100100101", 2: "101111001111100", 3: "101101101001011",
    4: "100010111111001", 5: "100000011001110", 6: "100111110010111", 7: "100101010100000",
}


def maske_von(matrix: list[list[int]]) -> int | None:
    """Welche Maske benutzt diese Matrix? Aus der zweiten Formatkopie gelesen."""
    n = len(matrix)
    bits = "".join(str(matrix[n - 1 - i][8]) for i in range(7))
    bits += "".join(str(matrix[8][n - 8 + i]) for i in range(8))
    for k, v in FORMAT_M.items():
        if v == bits:
            return k
    return None


print("── 1. Feld fuer Feld gegen qrencode (Byte-Modus, bei DESSEN Maske)")
# WARUM BEI DESSEN MASKE: Die Maskenwahl haengt an den vier Strafregeln, und in
# deren Randfaellen (zaehlt ein sucheraehnliches Muster am Bildrand mit?)
# unterscheiden sich Umsetzungen legitim — beide Ergebnisse sind gueltige, gut
# lesbare Codes. Geprueft wird deshalb das, was WIRKLICH stimmen muss:
# Fassungswahl, Datenwoerter, Fehlerkorrektur, Verschraenkung, Platzierung,
# Funktionsmuster und Formatbits. Genau dieser Vergleich hat den echten Fehler
# gefunden: die erste Formatkopie stand verkehrt herum, und weil Leser ueber die
# zweite Kopie an die Maske kommen, war davon nichts zu merken.
if not shutil.which("qrencode"):
    uebersprungen += 1
    print("  uebersprungen — qrencode ist nicht installiert")
else:
    for name, text in FAELLE:
        referenz = qrencode_matrix(text)
        if referenz is None:
            pruefe(False, f"{name}: qrencode scheiterte")
            continue
        k = maske_von(referenz)
        if k is None:
            pruefe(False, f"{name}: Maske von qrencode nicht lesbar")
            continue
        meine = qr.mit_maske(text, k)
        if len(meine) != len(referenz):
            pruefe(
                False,
                f"{name}: andere Groesse",
                f"meine {len(meine)}x{len(meine)}, qrencode {len(referenz)}x{len(referenz)}",
            )
            continue
        abweichungen = [
            (r, s)
            for r in range(len(meine))
            for s in range(len(meine))
            if meine[r][s] != referenz[r][s]
        ]
        pruefe(
            not abweichungen,
            f"{name}: deckungsgleich bei Maske {k} ({len(meine)}x{len(meine)})",
            f"{len(abweichungen)} Felder anders, zuerst bei {abweichungen[:3]}",
        )

print("── 2. Zurueckgelesen mit zbarimg (der Weg des Handys)")
if not shutil.which("zbarimg"):
    uebersprungen += 1
    print("  uebersprungen — zbarimg ist nicht installiert")
else:
    with tempfile.TemporaryDirectory() as ordner:
        for name, text in FAELLE:
            pfad = os.path.join(ordner, "code.pbm")
            # SKALA 8 ist Absicht: bei einem Pixel je Feld liest zbarimg gar
            # nichts, und das sieht aus wie ein kaputter Kodierer. Genau darauf
            # bin ich beim Bauen hereingefallen — der erste Verdacht galt dem
            # Kodierer, obwohl nur das Bild zu klein war.
            with open(pfad, "wb") as f:
                f.write(qr.als_pbm(qr.kodieren(text), rand=4, skala=8))
            lauf = subprocess.run(
                ["zbarimg", "--quiet", "--raw", pfad], capture_output=True, text=True
            )
            gelesen = lauf.stdout.rstrip("\n")
            pruefe(gelesen == text, f"{name}: zurueckgelesen", f"gelesen: {gelesen!r}")

print("── 3. Fassungswahl")
# Die Grenzen aus der Norm fuer Stufe M im Byte-Modus: Fassung 1 traegt 14
# Bytes, Fassung 2 traegt 26.
pruefe((len(qr.kodieren("a" * 14)) - 17) // 4 == 1, "14 Bytes passen in Fassung 1")
pruefe((len(qr.kodieren("a" * 15)) - 17) // 4 == 2, "15 Bytes brauchen Fassung 2")
pruefe((len(qr.kodieren("a" * 26)) - 17) // 4 == 2, "26 Bytes passen in Fassung 2")
pruefe((len(qr.kodieren("a" * 27)) - 17) // 4 == 3, "27 Bytes brauchen Fassung 3")

print("── 4. Formatbits gegen die genormte Tabelle")
# Der Wachposten fuer den Fehler, der hier wirklich drinsteckte: die erste
# Formatkopie stand verkehrt herum. Die Bits SELBST waren richtig — deshalb
# steht hier beides, die Tabelle und (in Teil 1) die Platzierung.
for k, erwartet in FORMAT_M.items():
    hier = "".join(str(b) for b in qr._format_bits(k))
    pruefe(hier == erwartet, f"Formatbits Maske {k}", f"{hier} statt {erwartet}")

print("── 5. Was nicht mehr passt, wird gesagt statt still verstuemmelt")
try:
    qr.kodieren("a" * 400)
    pruefe(False, "zu langer Text wird abgewiesen", "es kam kein Fehler")
except ValueError as e:
    pruefe("Fassung 1-10" in str(e), "zu langer Text wird mit Begruendung abgewiesen", str(e))

print()
print(f"{ok} in Ordnung, {bad} gebrochen, {uebersprungen} Teil(e) uebersprungen")
sys.exit(1 if bad else 0)
