#!/usr/bin/env python3
"""STIMMT README.en.md MIT README.md UEBEREIN? — Zahlen, Pfade, Befehle, Bilder.

WOZU
Seit dem 23.09.2026 gibt es die README zweimal: deutsch (die massgebliche)
und englisch (uebersetzt). Zwei Fassungen driften — nicht bei der Prosa, das
ist erwartbar, sondern bei dem, was man NACHRECHNEN kann: eine Zahl, die nur
in einer Fassung nachgezogen wurde, ein Pfad, der in der anderen noch alt
heisst, ein Bild, das nur eine einbettet. Genau das prueft dieses Werkzeug —
mechanisch, ohne Sprachverstand.

WAS ES VERGLEICHT
  * alles in Backticks (Pfade, Befehle, Bezeichner) — Menge muss gleich sein
  * alle Codebloecke — Zeile fuer Zeile gleich (Befehle uebersetzt man nicht)
  * alle Bild-Einbettungen
  * alle Zahlen mit Kontext (z.B. "42", "3,3 s" bzw. "3.3 s", "27") — als
    Multimenge; Dezimalkomma und -punkt gelten als gleich
  * die Ueberschriften-Nummern (## 1., ### 3.4 …) in derselben Reihenfolge

WAS ES NICHT TUT
  * Es beurteilt keine Uebersetzung. Ein falsch uebersetzter Satz mit richtigen
    Zahlen geht hier durch — dafuer gibt es Menschen.
  * Es faellt nicht um, wenn README.en.md fehlt: dann sagt es das und endet
    rot — eine angekuendigte Fassung, die es nicht gibt, ist ein Befund.

AUFRUF
    python3 tools/readme-paritaet-pruefen.py            # exit 0 = deckungsgleich
"""
import collections
import os
import re
import sys

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DE = os.path.join(WURZEL, "README.md")
EN = os.path.join(WURZEL, "README.en.md")


def lesen(p):
    return open(p, encoding="utf-8").read()


def codebloecke(t):
    return re.findall(r"```[^\n]*\n(.*?)```", t, re.S)


def ohne_codebloecke(t):
    return re.sub(r"```.*?```", "", t, flags=re.S)


def backticks(t):
    return collections.Counter(re.findall(r"`([^`\n]+)`", ohne_codebloecke(t)))


def bilder(t):
    return collections.Counter(re.findall(r"!\[[^\]]*\]\(([^)]+)\)", t))


def zahlen(t):
    # Zahlen mit Dezimalkomma ODER -punkt; Komma wird normiert. Datumsangaben
    # (23.09.2026) zerfallen in ihre Teile — das ist fuer den Vergleich egal,
    # solange es in beiden Dateien gleich zerfaellt.
    roh = re.findall(r"(?<![\w/])\d+(?:[.,]\d+)?(?![\w/])", ohne_codebloecke(t))
    return collections.Counter(z.replace(",", ".") for z in roh)


def ueberschriften(t):
    return re.findall(r"^(#{2,3}) (\d+(?:\.\d+)?)\.? ", t, re.M)


def diff(name, a, b):
    """Zwei Multimengen vergleichen; gibt die Zahl der Abweichungen zurueck."""
    nur_de = a - b
    nur_en = b - a
    if not nur_de and not nur_en:
        print(f"  OK    {name}: {sum(a.values())} deckungsgleich")
        return 0
    print(f"  WEICHT AB  {name}:")
    for k, n in sorted(nur_de.items())[:15]:
        print(f"      nur deutsch : {k!r} ×{n}")
    for k, n in sorted(nur_en.items())[:15]:
        print(f"      nur englisch: {k!r} ×{n}")
    return len(nur_de) + len(nur_en)


def main():
    if not os.path.isfile(EN):
        print("  FEHLT README.en.md — die deutsche README kuendigt sie an.")
        return 1
    de, en = lesen(DE), lesen(EN)
    fehler = 0
    print("── README.md gegen README.en.md ──────────────────────────────────")
    fehler += diff("Bilder", bilder(de), bilder(en))
    fehler += diff("Backticks (Pfade/Befehle/Bezeichner)", backticks(de), backticks(en))
    fehler += diff("Zahlen", zahlen(de), zahlen(en))
    cb_de, cb_en = codebloecke(de), codebloecke(en)
    if cb_de == cb_en:
        print(f"  OK    Codebloecke: {len(cb_de)} gleich")
    else:
        fehler += 1
        print(f"  WEICHT AB  Codebloecke: {len(cb_de)} deutsch, {len(cb_en)} englisch")
        for i, (x, y) in enumerate(zip(cb_de, cb_en)):
            if x != y:
                print(f"      Block {i + 1} unterscheidet sich:")
                for zx, zy in zip(x.splitlines(), y.splitlines()):
                    if zx != zy:
                        print(f"        de: {zx}\n        en: {zy}")
                        break
    u_de, u_en = ueberschriften(de), ueberschriften(en)
    if u_de == u_en:
        print(f"  OK    Ueberschriften-Nummern: {len(u_de)} in gleicher Folge")
    else:
        fehler += 1
        print(f"  WEICHT AB  Ueberschriften: de {u_de[:8]} … en {u_en[:8]} …")
    print()
    if fehler:
        print(f"{fehler} Abweichung(en) — die englische Fassung hinkt (oder die deutsche).")
        return 1
    print("DECKUNGSGLEICH.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
