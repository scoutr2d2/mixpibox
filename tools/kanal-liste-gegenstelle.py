#!/usr/bin/env python3
"""DIE DREI KANAELE STEHEN AN DREI ORTEN — sagen sie dasselbe?

WOZU (AUDIT-2026-09-01 Rang 13, gebaut 03.09.2026):
`dev`/`beta`/`stable` sind an drei Stellen aufgeschrieben, und keine davon
fragt die andere:

    src/backend-api/src/aktualisierung.ts          KANAELE — was der Server
                                                   als Kanalnamen ANNIMMT
    src/frontend-admin/src/app/seiten/…            KANAELE — was die Verwaltung
      aktualisierung.ts                            als Knoepfe ANBIETET, und
                                                   `kanalErklaerung()` daneben
    scripts/box/mixpi-zieher.py                    der Rueckfall, wenn in der
                                                   Einstellung nichts steht

DIE REIHENFOLGE DARF ABWEICHEN, DIE MENGE NICHT. Das ist der Kern dieser
Wache und der Grund, warum sie nicht einfach „gleiche Zeile hier wie dort"
prueft: der Server fuehrt eine PRUEFLISTE (Reihenfolge bedeutungslos), die
Verwaltung eine ANZEIGEORDNUNG — `dev → beta → stable` ist der Weg, den eine
Fassung nimmt, und so gehoeren die Knoepfe nebeneinander. Wer die beiden
Listen gleichschaltet, nimmt der Anzeige ihre Aussage.

Was auseinanderlaufen KANN und teuer waere:
  * Ein VIERTER Kanal in der Verwaltung, den der Server mit 400
    („kanalUnbekannt") ablehnt — ein Knopf, der nichts tut.
  * Ein vierter Kanal im Server, den niemand anbieten kann.
  * Ein Kanal OHNE eigenen Zweig in `kanalErklaerung()`. Der faellt in
    `default:` und bekommt damit die Erklaerung von `stable` („Nur erprobte
    Fassungen.") — eine Auskunft, die falscher ist als gar keine, weil sie
    ueberzeugt klingt.
  * Ein Rueckfall im Zieher, den es nicht mehr gibt: die Box zoege dann gegen
    einen Kanal, den der Feed nicht fuehrt, und bekaeme dauerhaft „kein
    Angebot" statt einer Fehlermeldung.

AUFRUF
    python3 tools/kanal-liste-gegenstelle.py             Bericht
    python3 tools/kanal-liste-gegenstelle.py --pruefen   still bei gruen, Exit 1 sonst
"""

import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent

SERVER = WURZEL / "src/backend-api/src/aktualisierung.ts"
VERWALTUNG = WURZEL / "src/frontend-admin/src/app/seiten/aktualisierung.ts"
ZIEHER = WURZEL / "scripts/box/mixpi-zieher.py"

# `KANAELE = [...] as const` — in beiden TS-Dateien dieselbe Form, einmal mit
# `export const`, einmal als `readonly` Feld einer Klasse.
LISTE = re.compile(r"KANAELE\s*=\s*\[([^\]]*)\]\s*as const")
NAME = re.compile(r"'([a-z]+)'")
# Der Rueckfall des Ziehers: `... or k.get("kanal") or "stable"`.
RUECKFALL = re.compile(r'MIXPI_KANAL"\)\s*or\s*k\.get\("kanal"\)\s*or\s*"([a-z]+)"')
# Die Zweige der Erklaerung — `case 'dev':`.
FALL = re.compile(r"case\s+'([a-z]+)':")


def _text(p: Path) -> str:
    """Eine fehlende Quelle ist ein FEHLER, kein leeres Ergebnis.

    Eine Wache, die das Verschwinden ihrer Quelle als „nichts gefunden, also
    gruen" verbucht, ist keine (llmwiki `gegenprobe-statt-gruen-glauben`).
    """
    if not p.is_file():
        print(f"FEHLER: {p.relative_to(WURZEL)} gibt es nicht — umbenannt oder verschoben?")
        sys.exit(2)
    return p.read_text(encoding="utf-8")


def liste_aus(p: Path) -> list[str]:
    t = _text(p)
    m = LISTE.search(t)
    if not m:
        print(f"FEHLER: In {p.relative_to(WURZEL)} steht kein `KANAELE = [...] as const` mehr.")
        sys.exit(2)
    namen = NAME.findall(m.group(1))
    if not namen:
        print(f"FEHLER: Die KANAELE-Liste in {p.relative_to(WURZEL)} ist leer.")
        sys.exit(2)
    return namen


# Die Methode, nicht ihr Aufruf in der Vorlage: `kanalErklaerung(x: string)…{`.
# Ohne den Klammer-Anker traf die Suche den Ruf im Template und las danach den
# NAECHSTEN switch der Datei (den ueber das Urteil) — die Wache meldete
# `aktuell`/`eigenbau` als Kanaele und war damit dauerhaft rot auf die
# nutzloseste Art (llmwiki `dauerrote-wache-ist-keine`).
METHODE = re.compile(r"kanalErklaerung\s*\([^)]*\)\s*:\s*string\s*\{")


def erklaerte_kanaele() -> list[str]:
    t = _text(VERWALTUNG)
    m = METHODE.search(t)
    if not m:
        print("FEHLER: Die Methode `kanalErklaerung(…): string` gibt es in der "
              "Verwaltung nicht mehr.")
        sys.exit(2)
    # Nur der Rumpf DIESER Methode — sonst zaehlten `case`-Zweige anderer
    # switch-Bloecke mit. Der Rumpf endet an der ersten Zeile, die auf
    # Methodentiefe wieder schliesst.
    ab = m.end()
    ende = t.find("\n  }", ab)
    if ende < 0:
        print("FEHLER: Das Ende von `kanalErklaerung` ist nicht auffindbar.")
        sys.exit(2)
    return FALL.findall(t[ab:ende])


def rueckfall() -> str:
    m = RUECKFALL.search(_text(ZIEHER))
    if not m:
        print("FEHLER: Der Kanal-Rueckfall des Ziehers ist nicht mehr auffindbar.")
        sys.exit(2)
    return m.group(1)


def main() -> int:
    still = "--pruefen" in sys.argv
    server = liste_aus(SERVER)
    verwaltung = liste_aus(VERWALTUNG)
    erklaert = erklaerte_kanaele()
    rueck = rueckfall()

    luecken: list[str] = []

    if not still:
        print("── Die Kanaele an ihren drei Orten ──")
        print(f"  Server (Prueflist)     {server}")
        print(f"  Verwaltung (Anzeige)   {verwaltung}")
        print(f"  Erklaerung hat Zweig   {erklaert}  (+ default:)")
        print(f"  Rueckfall des Ziehers  {rueck!r}")
        print()

    nur_server = sorted(set(server) - set(verwaltung))
    nur_verwaltung = sorted(set(verwaltung) - set(server))
    if nur_server:
        luecken.append(f"nur im Server: {', '.join(nur_server)} — die Verwaltung bietet sie nicht an")
    if nur_verwaltung:
        luecken.append(
            f"nur in der Verwaltung: {', '.join(nur_verwaltung)} — der Server "
            "lehnt sie mit 400 `kanalUnbekannt` ab, der Knopf taete nichts"
        )

    # GENAU EINER darf ohne eigenen Zweig sein: der, den `default:` bedient.
    ohne_zweig = sorted(set(verwaltung) - set(erklaert))
    if len(ohne_zweig) > 1:
        luecken.append(
            f"ohne eigenen Zweig in kanalErklaerung: {', '.join(ohne_zweig)} — "
            "`default:` kann nur EINEN richtig bedienen, die uebrigen bekommen "
            "eine Erklaerung, die nicht ihre ist"
        )
    fremd = sorted(set(erklaert) - set(verwaltung))
    if fremd:
        luecken.append(f"erklaert, aber nicht angeboten: {', '.join(fremd)}")

    if rueck not in server:
        luecken.append(
            f"der Zieher faellt auf {rueck!r} zurueck — den Kanal gibt es nicht "
            "(mehr); die Box zoege gegen einen Kanal, den der Feed nicht fuehrt"
        )

    if luecken:
        print("── Die Kanaele laufen auseinander ──")
        for z in luecken:
            print(f"  LUECKE: {z}")
        print(f"\n{len(luecken)} LUECKE(N).")
        return 1

    if not still:
        print(f"Alle drei Orte fuehren dieselben {len(server)} Kanaele "
              f"({', '.join(sorted(server))}); die Reihenfolge darf abweichen.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
