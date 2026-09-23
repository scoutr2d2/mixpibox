#!/usr/bin/env python3
"""PROTOKOLL-PFADE-DECKUNG — zeigt die Protokollseite auf Dateien, die auch
jemand schreibt?

══ WARUM ES DAS GIBT (30.08.2026) ══════════════════════════════════════════

`src/backend-api/src/protokolle.ts` fuehrt eine FESTE Tabelle `DATEIEN`: die
Protokolle, die die Verwaltung unter *Protokolle* zum Lesen anbietet. Feste
Tabelle ist richtig — ein Pfad aus der Anfrage waere ein Leseloch ueber das
ganze Dateisystem. Nur: eine feste Tabelle wird beim Schreiben EINMAL
ausgedacht und danach nie wieder gegen den Baum gehalten.

GEMESSEN am 30.08.2026: zwei der drei Eintraege zeigten auf
`/var/log/mupibox/`. Geschrieben wird an beiden Stellen nach `/tmp/`:

    scripts/mupibox/idle_shutdown.sh:108   : "${LOG:=/tmp/idle_shutdown.log}"
    scripts/OnOffShim/off_trigger.sh:10    LOGFILE="/tmp/shutdown_control.log"

Niemand setzt `LOG` von aussen — die Unit `mupi_idle_shutdown.service` hat
keine `Environment=`-Zeile. `autosetup.sh:397` legt `/var/log/mupibox/` an,
und danach schreibt dort nie jemand hinein. Die Protokollseite antwortete
also fuer BEIDE Dateieintraege dauerhaft „Protokoll nicht lesbar".

Und es war sogar schon gesehen worden: der Kopf von `fehlergrund.ts` zitiert
als Beispiel fuer eine durchgereichte Fehlermeldung genau

    ENOENT: no such file or directory, stat '/var/log/mupibox/idle_shutdown.log'

— am 07.08.2026 an einem echten Serverprozess gemessen. Gelesen wurde daraus
„der Pfad steht in der Antwort" (richtig, wurde behoben). Dass der Pfad
schlicht FALSCH ist, hat niemand mitgelesen.

══ WARUM DER TEST ES NICHT FING ════════════════════════════════════════════

`protokolle.spec.ts` prueft die Tabelle sehr wohl — aber auf das SYMPTOM des
letzten Falls: `d.pfad.includes('.pm2') === false`. Die vier pm2-Protokolle
waren eingefroren, also wurde auf „pm2" geprueft. Der naechste Fehler heisst
nicht pm2. Eine Wache gehoert auf die SORTE — „steht hinter jedem Pfad ein
Schreiber?" —, nicht auf den Wortlaut des letzten Fundes.
llmwiki: `doku-zeigt-auf-zeilen-die-wandern`.

══ WAS GEPRUEFT WIRD ═══════════════════════════════════════════════════════

Fuer jeden `pfad` der Tabelle: kommt genau dieser Pfad irgendwo im
AUSGELIEFERTEN Baum noch einmal vor — ausserhalb von `protokolle.ts` selbst,
ausserhalb der Tests und ausserhalb von `tools/`? Kommt er nicht vor, wohl
aber sein Dateiname unter einem ANDEREN Verzeichnis, nennt die Probe beides
nebeneinander. Genau dieser Fall ist der interessante.

KEIN URTEIL UEBER SCHREIBEND/LESEND: die Probe unterscheidet nicht, ob die
Fundstelle die Datei anlegt oder nur nennt. Sie beantwortet „kennt ausser der
Tabelle noch irgendwer diesen Pfad?" — und schon das reicht, um einen frei
erfundenen Pfad auffallen zu lassen.

KOMMENTARE ZAEHLEN NICHT. Die erste Fassung dieser Probe meldete gruen, und
zwar auf die schlimmste Art: `/var/log/mupibox/idle_shutdown.log` kommt sehr
wohl zweimal im Baum vor — in `fehlergrund.ts:11` und `server.ts:4980`, beide
Male als BEISPIEL IN EINEM KOMMENTAR, der die Fehlermeldung zitiert, die
gerade WEGEN des falschen Pfades entstand. Der Beleg fuer den Fehler galt der
Probe als Beleg gegen ihn. Zeilen, die mit `*`, `//`, `/*` oder `#` beginnen,
sind deshalb keine Gegenstelle.

Aufruf aus dem Wurzelverzeichnis:  python3 tools/protokoll-pfade-deckung.py
Rueckgabe: 0 = jeder Pfad hat eine Gegenstelle, 1 = mindestens einer nicht.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
TABELLE = WURZEL / "src/backend-api/src/protokolle.ts"

# Wo ausgeliefert wird. `tools/` steht ABSICHTLICH nicht dabei: dort liegen
# Mess- und Sandkastenwerkzeuge, die Pfade nennen, die auf keiner Box
# vorkommen (ausschalter-sandkasten.py baut sich seinen eigenen). Wer sie
# mitzaehlt, laesst sich einen erfundenen Pfad von einem Werkzeug bestaetigen.
BAUM = [
    "src",
    "scripts",
    "config",
    "autosetup",
    "update",
    "server",
    "bin",
    "mupictl",
    "remote-step-installer",
]


# ══ WER FREMD SCHREIBT, HAT KEINE ZEILE IM BAUM ════════════════════════════
#
# Nicht jedes Protokoll der Tabelle entsteht durch unseren Code. Chromium legt
# `chrome_debug.log` selbst an, sobald es mit `--enable-logging` startet; der
# Pfad ist Chromiums Konvention und steht in KEINER unserer Dateien. Eine Probe,
# die das als Luecke meldet, meldet auf Dauer rot und wird zu Recht ignoriert.
#
# Der Freibrief ist aber nicht blanko: zu jedem Eintrag gehoert die Zeile im
# Baum, die den fremden Schreiber EINSCHALTET. Verschwindet sie, faellt die
# Ausnahme auf, statt still weiterzugelten.
FREMDE_SCHREIBER = {
    "chromium": (
        "scripts/chromium-autostart.sh",
        "--enable-logging",
        "Chromium legt chrome_debug.log selbst in seinem Profil an; der Pfad "
        "ist Chromiums Konvention. Entsteht nur bei chromium.debug=1.",
    ),
}


def ausnahme_haelt(kennung: str) -> bool:
    """Steht der Schalter, auf den sich die Ausnahme beruft, noch im Baum?"""
    datei, schalter, _ = FREMDE_SCHREIBER[kennung]
    pfad = WURZEL / datei
    if not pfad.exists():
        print(f"  AUSNAHME OHNE GRUNDLAGE: {kennung} beruft sich auf {datei} — die Datei fehlt")
        return False
    if schalter not in pfad.read_text(encoding="utf-8"):
        print(f"  AUSNAHME OHNE GRUNDLAGE: {kennung} beruft sich auf `{schalter}` in {datei} — steht dort nicht mehr")
        return False
    return True


def tabellen_pfade() -> list[tuple[str, str]]:
    """Die Eintraege der festen Tabelle als (id, pfad)."""
    text = TABELLE.read_text(encoding="utf-8")
    block = re.search(r"export const DATEIEN[^=]*=\s*\{(.*?)\n\}", text, re.S)
    if not block:
        print(f"  WARNUNG: DATEIEN nicht gefunden in {TABELLE} — Zeile geaendert?")
        sys.exit(1)
    # id kommt als Feld `id: '...'` mit; der Pfad steht in derselben Klammer.
    return re.findall(r"id:\s*'([^']+)',\s*\n\s*pfad:\s*'([^']+)'", block.group(1))


def fundstellen(muster: str) -> list[str]:
    """Zeilen im ausgelieferten Baum, die `muster` woertlich enthalten."""
    orte = [str(WURZEL / b) for b in BAUM if (WURZEL / b).exists()]
    roh = subprocess.run(
        ["grep", "-rnF", "--binary-files=without-match", muster, *orte],
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    treffer = []
    for zeile in roh:
        datei = zeile.split(":", 1)[0]
        rel = Path(datei).resolve().relative_to(WURZEL).as_posix()
        if rel == "src/backend-api/src/protokolle.ts":
            continue  # die Tabelle belegt sich nicht selbst
        if ".spec." in rel or "/node_modules/" in rel:
            continue  # ein Test, der den Pfad festnagelt, ist kein Schreiber
        if rel.startswith("src/deploy/"):
            # DAS GEBAUTE BUENDEL. `src/deploy/server.js` ist die kompilierte
            # Fassung ebenjener Tabelle — 1,4 MB minifiziert, und der Pfad
            # steht dort drin, WEIL er in protokolle.ts steht. Die zweite
            # Fassung dieser Probe meldete daran gruen. Ein Erzeugnis der
            # geprueften Datei ist keine Gegenstelle zu ihr.
            continue
        inhalt = zeile.split(":", 2)[2].lstrip() if zeile.count(":") >= 2 else ""
        if inhalt.startswith(("*", "//", "/*", "#")):
            continue  # ein Kommentar, der den Pfad zitiert, schreibt ihn nicht
        treffer.append(rel + ":" + zeile.split(":", 2)[1])
    return treffer


def main() -> int:
    luecken = 0
    for kennung, pfad in tabellen_pfade():
        if fundstellen(pfad):
            continue
        if kennung in FREMDE_SCHREIBER:
            if ausnahme_haelt(kennung):
                continue
            luecken += 1
            continue
        name = pfad.rsplit("/", 1)[-1]
        anderswo = fundstellen(name)
        print(f"  OHNE GEGENSTELLE: {kennung} → {pfad}")
        if anderswo:
            print(f"      der Dateiname kommt vor, aber woanders: {', '.join(anderswo)}")
        else:
            print("      der Dateiname kommt im Baum ueberhaupt nicht vor")
        luecken += 1

    if luecken:
        print(f"\n{luecken} Protokollpfad(e) ohne Gegenstelle im Baum.")
        return 1
    print("Jeder Protokollpfad der Verwaltung hat eine Gegenstelle im Baum.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
