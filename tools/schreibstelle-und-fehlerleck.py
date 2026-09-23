#!/usr/bin/env python3
"""Zwei Wachen an einer Naht: die Zwischendatei und die Fehlerantwort.

WOFUER — BEIDE BEFUNDE KOMMEN AUS DERSELBEN GEWOHNHEIT: eine Stelle wird von
Hand nachgebaut statt an die vorhandene Naht gehaengt, und die Kopie weicht
genau dort ab, wo es wehtut.

── 1. DIE ZWISCHENDATEI (AUDIT-2026-09-19 Rang 3) ──────────────────────────
Wer `<ziel>.<pid>.tmp` schreibt und dann umbenennt, teilt diese Datei mit
JEDER GLEICHZEITIGEN ANFRAGE DESSELBEN PROZESSES. Am 19.09.2026 an
`POST /api/vpn/konfiguration` gemessen (src/backend-api/src/server.spec.ts):
zwei ueberlappende Uebernahmen meldeten BEIDE 200 — und `install` trug
zweimal dieselbe Konfiguration nach /etc/wireguard, die des jeweils anderen.
Kein Fehler im Journal, kein Fehler in der Antwort. Nur die falsche Datei
mit dem falschen privaten Schluessel.

Verlangt wird deshalb ein Name, der JE AUFRUF verschieden ist: entweder
`zwischenname()` aus atomar.ts oder ein sichtbarer Zaehler im Namen.

── 2. DIE FEHLERANTWORT (AUDIT-2026-09-19 Rang 10 f) ───────────────────────
`String(e)` auf einem Systemfehler IST der absolute Pfad:

    {"error":"Error: EISDIR: ..., rename '/etc/mupibox/vorlesen.json...'"}

Und `String((e as Error)?.message ?? e)` — vom Audit als das bessere Vorbild
genannt — leckt GENAUSO VIEL; der Unterschied ist das Wort „Error: " davor.
Am 19.09.2026 beide Schreibweisen gegen dieselbe Stelle gemessen. Auf einer
Bestandsbox steht die Verwaltung ohne Anmeldung im Netz (`interfacelogin.state`
ist in der Vorlage `false`), das ging also an jeden im LAN.

Verlangt wird `fehlerAntwort(...)` (server.ts) bzw. `grundNachAussen(...)`
(fehlergrund.ts): fester Satz nach draussen, Volltext ins Journal.

WAS ES AENDERT
  NICHTS. Es liest und meldet.

AUFRUF
  python3 tools/schreibstelle-und-fehlerleck.py            # ganzes Backend
  python3 tools/schreibstelle-und-fehlerleck.py <datei> …  # einzelne Dateien

Rueckgabewert: 0 = sauber, sonst die Zahl der Funde.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
BASIS = WURZEL / "src/backend-api/src"

# Eine Zwischendatei, deren Name NUR aus Ziel und Prozesskennung besteht.
# Der Zaehler fehlt genau dann, wenn nach der pid direkt `.tmp` kommt oder ein
# fester Wortbestandteil statt einer laufenden Zahl.
TMP_OHNE_ZAEHLER = re.compile(r"""\$\{process\.pid\}(?:\.[a-zA-Z_-]+)?\.tmp""")

# Ein roher Fehler in einer Antwort nach draussen. BEIDE Schreibweisen, denn
# beide lecken denselben Pfad.
#
# WELCHE VARIABLE EIN FEHLER IST, wird nicht geraten: die Namen kommen aus den
# `catch (…)`-Bindungen DERSELBEN Datei. Eine feste Liste („e, err, f") waere
# eine Wache auf den Pfad statt auf die Sorte — sie uebersaehe `catch (ups)`
# und schluge auf `String(id)` an (am 19.09.2026 in genau dieser Reihenfolge
# passiert: drei Fehlalarme auf `String(id)` und `String(vorgabe)`).
CATCH_BINDUNG = re.compile(r"\bcatch\s*\(\s*([A-Za-z_$][\w$]*)\s*[):]")
ANTWORT = r"""res\.(?:status\(\d{3}\)\.)?(?:json|send)\([^\n]*?"""


def rohfehler_muster(namen: set[str]) -> re.Pattern[str] | None:
    if not namen:
        return None
    wahl = "|".join(sorted(re.escape(n) for n in namen))
    return re.compile(
        ANTWORT + rf"""String\(\s*(?:\(\s*(?:{wahl})\s+as\s+Error\s*\)\s*\?\.message\s*\?\?\s*)?(?:{wahl})\s*\)"""
    )

# ── AUSNAHMEN, jede mit Grund ───────────────────────────────────────────────
# Sie stehen hier und nicht als „ist schon in Ordnung" im Kopf des Lesers:
# eine dauerrote Wache verdeckt den naechsten echten Fund (llmwiki
# `dauerrote-wache-ist-keine`).
AUSNAHMEN = (
    # Kein Dateifehler, sondern ein Netzfehler von Spotify. `grundNachAussen`
    # kennt dafuer nur „Das hat nicht geklappt." und naehme dem Betreiber die
    # einzige Auskunft, die ihm hier weiterhilft. Ein Pfad steht nicht drin.
    "Spotify war nicht erreichbar",
)


def ohne_kommentare(text: str) -> list[str]:
    """Zeilen mit ausgeloeschten Kommentaren — Laenge und Nummern bleiben.

    Ein Kommentar, der einen Fund ZITIERT (und davon steht in diesem Baum
    reichlich neben jeder behobenen Stelle), ist keine Fundstelle. Wer das
    nicht trennt, bekommt eine Wache, die auf ihre eigene Begruendung
    anschlaegt — oder, schlimmer, eine, die man deshalb abschaltet.
    """
    zeilen = text.split("\n")
    im_block = False
    aus: list[str] = []
    for z in zeilen:
        if im_block:
            ende = z.find("*/")
            if ende == -1:
                aus.append("")
                continue
            z = " " * (ende + 2) + z[ende + 2 :]
            im_block = False
        # Blockanfang ohne Ende in derselben Zeile
        start = z.find("/*")
        if start != -1 and "*/" not in z[start:]:
            im_block = True
            z = z[:start]
        strich = z.find("//")
        if strich != -1:
            z = z[:strich]
        aus.append(z)
    return aus


def pruefe(datei: Path) -> list[tuple[int, str, str]]:
    """Funde als (zeilennummer, sorte, zeile)."""
    funde: list[tuple[int, str, str]] = []
    zeilen = ohne_kommentare(datei.read_text(encoding="utf-8"))
    rohfehler = rohfehler_muster({m.group(1) for z in zeilen for m in CATCH_BINDUNG.finditer(z)})
    for nr, zeile in enumerate(zeilen, 1):
        if any(a in zeile for a in AUSNAHMEN):
            continue
        if TMP_OHNE_ZAEHLER.search(zeile):
            funde.append((nr, "zwischendatei-ohne-zaehler", zeile.strip()))
        if rohfehler and rohfehler.search(zeile):
            funde.append((nr, "roher-fehler-nach-draussen", zeile.strip()))
    return funde


def main() -> int:
    ziele = [Path(a) for a in sys.argv[1:]] or sorted(BASIS.glob("*.ts"))
    # Tests duerfen beides zitieren — sie stellen den Fehler ja gerade her.
    # src/deploy/ ist das Kompilat und keine Gegenstelle.
    ziele = [
        z
        for z in ziele
        if z.suffix == ".ts" and not z.name.endswith(".spec.ts") and "deploy" not in z.parts
    ]

    gesamt = 0
    for datei in ziele:
        for nr, sorte, zeile in pruefe(datei):
            gesamt += 1
            print(f"{datei.relative_to(WURZEL)}:{nr}  {sorte}: {zeile[:110]}")

    print()
    if gesamt:
        print(f"{gesamt} Fund(e) in {len(ziele)} Datei(en).")
        print("  zwischendatei-ohne-zaehler  -> zwischenname() aus atomar.ts nehmen;")
        print("                                 zwei gleichzeitige Anfragen teilen")
        print("                                 sich sonst EINE Datei.")
        print("  roher-fehler-nach-draussen  -> fehlerAntwort(...) in server.ts;")
        print("                                 err.message IST der absolute Pfad.")
        return gesamt
    print(f"{len(ziele)} Datei(en) geprueft: jede Zwischendatei gehoert einem Aufruf,")
    print("keine Fehlerantwort nennt einen Serverpfad.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
