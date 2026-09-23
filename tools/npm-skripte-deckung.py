#!/usr/bin/env python3
"""NPM-SKRIPTE-DECKUNG — die zwanzig Einstiege im Wurzelverzeichnis gegen die
Wirklichkeit und gegen die Doku.

WARUM ES DAS GIBT (25.08.2026): `README.md` nennt in Abschnitt 5 die
npm-Skripte des Wurzelverzeichnisses als DEN Weg, hier zu entwickeln, und
verweist fuer „Einzelheiten" auf `dokumentation/mixpibox.md`, Abschnitt 7.
Abschnitt 7 enthielt keinen einzigen davon — er beschreibt `tools/pruefen.sh`
und die Vorschauen. Gemessen: von den 20 Skripten in der Wurzel-`package.json`
stand KEINES in irgendeinem Handbuch. Der Verweis lief ins Leere.

Und in dem Loch sass ein toter Eintrag: `test:frontend-api` ruft den
Arbeitsbereich `mupibox-frontend-api` — den es nicht gibt, es sind
`backend-api`, `backend-player`, `frontend-box`, `frontend-admin`. `npm run
test:frontend-api` bricht mit „No workspaces found" ab. Das stand am
03.08.2026 in `AUDIT-2026-08-03.md` und am 23.08.2026 nochmal in
`AUDIT-2026-08-23.md` — zweimal gefunden, nie behoben, nie in einer Wache.
Ein Befund in einer Audit-Liste ist keine Dokumentation; er wird einmal
gelesen und altert dann still weiter. Darum diese Datei.

NACHGEZOGEN AM 26.08.2026 — dieselbe Sorte Leiche, eine Ebene tiefer: die
Wache las nur die Wurzel, und genau darum sass in `src/backend-player` seit
einem Jahr ein zweites totes Skript. `build-proto` ruft
`npx pbjs ... proto/spotify/login5/v3/login5.proto` — diese Datei und der
ganze `proto/`-Baum wurden am 26.08.2025 in `ce63e126` („Use official spotify
Playback SDK") geloescht, zusammen mit dem erzeugten `src/spotify-proto.js`
(5806 Zeilen). Das Skript blieb stehen und bricht mit ENOENT ab. Mitgeschleppt
wurden `protobufjs` und `protobufjs-cli` — beide stehen bis heute unter
`dependencies` (nicht `devDependencies`), obwohl kein Quelltext im ganzen Baum
noch das Wort „protobuf" enthaelt: sie landen bei jeder Installation auf der
Box. Kein Laeufer und keine Wache hat das je angefasst, weil die Wache hier
per Bauart bei der Wurzel-`package.json` aufhoerte.

WAS GEPRUEFT WIRD (alle drei zaehlen als Luecke):
  * jedes `--workspace=NAME` in der Wurzel-`package.json` nennt einen
    Arbeitsbereich, den es unter `src/*` wirklich gibt,
  * jeder Skriptname steht in Backticks in `dokumentation/mixpibox.md`,
  * jeder EINGABE-Pfad, den ein Skript nennt — in der Wurzel UND in jedem
    Arbeitsbereich —, liegt wirklich auf der Platte. AUSGABE-Pfade (`-o`,
    `--outfile=`, `--output-path=`, `--metafile=`) sind ausgenommen: die
    entstehen ja erst beim Bau. Sternchen werden als Muster aufgeloest, ein
    Muster ohne einen einzigen Treffer zaehlt als Loch.

WAS NUR GEMELDET, ABER NICHT GEZAEHLT WIRD (HINWEIS-Zeilen): die Loecher der
`--workspaces`-Faecherung. `npm run lint --workspaces` ueberspringt
`frontend-admin` stumm, weil der Arbeitsbereich gar kein `lint` hat — npm
sagt dazu nichts. Und `npm run test --workspaces` faechert in zwei
Angular-Bereiche, deren eigenes `test` das nackte `ng test` ist: das laeuft im
Beobachtungsmodus und endet nie, ausserdem braucht Karma ein Chrome, das hier
nicht installiert ist. Diese beiden Loecher zu SCHLIESSEN ist eine Aenderung
am Bau, nicht an der Doku; die Wache zaehlt sie deshalb nicht rot, sondern
haelt sie sichtbar. Der Weg, der wirklich prueft, ist `tools/pruefen.sh` —
es loest den Browser selbst auf und ruft `ng test --watch=false`.

WAS ES NICHT TUT: es fuehrt kein einziges Skript aus, misst keine Laufzeit
und aendert nichts. Es liest `package.json` und Text.

Findet die Wache GAR KEIN Skript oder GAR KEINEN Arbeitsbereich, meldet sie
eine Warnung statt gruen — eine Wache, die eine umbenannte Datei ueberlebt,
ist keine (llmwiki: `gegenprobe-statt-gruen-glauben`).

Aufruf aus dem Wurzelverzeichnis:  python3 tools/npm-skripte-deckung.py
Rueckgabe: 0 = keine Luecke, 1 = mindestens eine.
"""

import json
import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
WURZEL_PAKET = WURZEL / "package.json"
QUELLEN = WURZEL / "src"
DOKU = WURZEL / "dokumentation/mixpibox.md"

luecken: list[str] = []


def paket_lesen(pfad: Path) -> dict:
    try:
        return json.loads(pfad.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


skripte: dict[str, str] = paket_lesen(WURZEL_PAKET).get("scripts", {})
if not skripte:
    print(f"  WARNUNG: keine Skripte in {WURZEL_PAKET} gefunden — umbenannt?")
    sys.exit(1)

# Die Arbeitsbereiche, wie sie sich SELBST nennen — nicht wie ihr Ordner heisst.
# `src/frontend-admin` heisst `mupibox-frontend-admin`; `--workspace=` will den
# Namen aus der package.json, nicht den Pfad.
bereiche: dict[str, dict] = {}
for paketdatei in sorted(QUELLEN.glob("*/package.json")):
    paket = paket_lesen(paketdatei)
    if paket.get("name"):
        bereiche[paket["name"]] = paket.get("scripts", {})

if not bereiche:
    print(f"  WARNUNG: kein einziger Arbeitsbereich unter {QUELLEN} — verschoben?")
    sys.exit(1)


# ── 1. Zeigt jedes `--workspace=` auf etwas, das es gibt? ───────────────────
print("── Arbeitsbereiche, die die Wurzel-package.json ruft ──")
for name, befehl in skripte.items():
    for ziel in re.findall(r"--workspace=([\w@/.-]+)", befehl):
        if ziel not in bereiche:
            print(
                f"  TOTES SKRIPT: `{name}` ruft --workspace={ziel} — "
                f"den gibt es nicht (da sind: {', '.join(sorted(bereiche))})"
            )
            luecken.append(f"tot/{name}")


# ── 2. Steht jedes Skript in der Doku? ──────────────────────────────────────
#
# IN BACKTICKS gesucht, aus demselben Grund wie bei den Rechten und den
# Sektionen: `build`, `test`, `serve` und `lint` sind Woerter, die in jeder
# Entwicklerdoku zufaellig herumstehen. Nur der gesetzte Name zaehlt.
print("── Skripte der Wurzel, die die Doku nicht nennt ──")
doku_text = DOKU.read_text(encoding="utf-8") if DOKU.exists() else ""
if not doku_text:
    print(f"  WARNUNG: {DOKU} nicht gefunden oder leer.")
    luecken.append("doku")
else:
    for name in skripte:
        if f"`{name}`" not in doku_text and f"`npm run {name}`" not in doku_text:
            print(f"  FEHLT in {DOKU.relative_to(WURZEL)}: {name}")
            luecken.append(f"doku/{name}")


# ── 3. Zeigt jeder Eingabe-Pfad eines Skripts auf etwas, das es gibt? ──────
#
# Hier sass `build-proto` ein Jahr lang: ein Skript darf auf eine Datei
# zeigen, die es nicht mehr gibt, ohne dass irgendwer es merkt — es laeuft ja
# nur, wenn jemand es von Hand ruft, und das tut niemand.
#
# Ein Wort gilt als Eingabe-Pfad, wenn es einen `/` UND eine bekannte Endung
# hat. Das ist absichtlich eng: `-p proto` (ein Ordner ohne Endung) faengt
# diese Wache NICHT, die Datei dahinter aber schon, und ein zu weites Netz
# meldet jeden Schalter als Pfad.
ENDUNGEN = (".ts", ".js", ".mjs", ".cjs", ".proto", ".json", ".html", ".css", ".scss")
AUSGABE_SCHALTER = {"-o", "--outfile", "--output-path", "--metafile", "--output"}
AUSGABE_PRAEFIXE = ("--outfile=", "--output-path=", "--metafile=", "--output=")


def eingabe_pfade(befehl: str) -> list[str]:
    """Die Pfade, die ein Skript LIEST — Ausgabeziele ausgenommen."""
    worte = befehl.split()
    gefunden: list[str] = []
    for stelle, wort in enumerate(worte):
        if wort.startswith(AUSGABE_PRAEFIXE):
            continue
        if stelle > 0 and worte[stelle - 1] in AUSGABE_SCHALTER:
            continue
        if "/" in wort and wort.endswith(ENDUNGEN):
            gefunden.append(wort)
    return gefunden


# ── DIE AUSNAHME STEHT IM BACKLOG, NICHT HIER ──────────────────────────────
# `build-proto` ist ein ERKANNTER Fund, dessen Behebung Arbeit AM BAU ist
# (Skript und zwei Abhaengigkeiten streichen) — nicht Arbeit an der Doku.
# Bliebe die Wache dafuer dauerrot, waere sie keine mehr: der naechste, echte
# tote Pfad ginge in einer Meldung unter, die man schon kennt (llmwiki
# `dauerrote-wache-ist-keine`).
#
# Die Ausnahme wohnt darum NICHT in diesem Skript, sondern im `BACKLOG.md` —
# dort, wo der findet, der sie abarbeiten soll. Dieselbe Regel wie bei
# `sektionen-deckung.py` und `box-adresse-deckung.py`.
#
# UND IN BEIDE RICHTUNGEN, sonst verrottet sie: wer `build-proto` streicht und
# den Backlog stehen laesst, bekaeme sonst still gruen. Ist der Pfad wieder da
# (oder das Skript weg), meldet die Wache `BACKLOG VERALTET` und zaehlt das.
BACKLOG = WURZEL / "BACKLOG.md"
backlog_text = BACKLOG.read_text(encoding="utf-8") if BACKLOG.exists() else ""
# Nur Skripte unter einer „Aufraeumen"-Ueberschrift gelten als angemeldet —
# eine Nennung irgendwo im 8000-Zeilen-Dokument waere ein Sammelbecken.
aufraeum_block = ""
if "## Aufräumen" in backlog_text:
    aufraeum_block = backlog_text.split("## Aufräumen", 1)[1]
angemeldet = set(re.findall(r"`([\w:-]+)`", aufraeum_block.split("\n## ", 1)[0]))


print("── Pfade, die Skripte lesen wollen ──")
# Die Wurzel und jeder Arbeitsbereich, jeweils gegen SEIN eigenes Verzeichnis
# aufgeloest: `src/server.ts` in backend-api meint src/backend-api/src/server.ts.
paket_orte: list[tuple[str, Path, dict]] = [("(Wurzel)", WURZEL, skripte)]
for paketdatei in sorted(QUELLEN.glob("*/package.json")):
    paket = paket_lesen(paketdatei)
    if paket.get("name"):
        paket_orte.append((paket["name"], paketdatei.parent, paket.get("scripts", {})))

geprueft = 0
backlog_traf_zu = False
for ort_name, ort, ort_skripte in paket_orte:
    for name, befehl in ort_skripte.items():
        if not isinstance(befehl, str):
            continue
        for pfad in eingabe_pfade(befehl):
            geprueft += 1
            if "*" in pfad:
                # Ein Muster ist erfuellt, sobald es EINEN Treffer hat.
                if next(ort.glob(pfad), None) is not None:
                    continue
            elif (ort / pfad).exists():
                continue
            wo = ort.relative_to(WURZEL) if ort != WURZEL else "."
            if name in angemeldet:
                # Bekannt und im BACKLOG angemeldet — sichtbar halten, nicht zaehlen.
                print(
                    f"  HINWEIS: {ort_name} `{name}` liest `{pfad}` (nicht unter "
                    f"{wo}) — im BACKLOG.md unter \u201eAufräumen\u201c angemeldet, zaehlt nicht"
                )
                backlog_traf_zu = True
                continue
            print(f"  TOTER PFAD: {ort_name} `{name}` liest `{pfad}` — das liegt nicht unter {wo}")
            luecken.append(f"pfad/{ort_name}/{name}")

if geprueft == 0:
    # Kein einziger Pfad in keinem Skript: dann misst diese Wache nichts mehr
    # und wuerde eine Umbenennung stumm ueberleben (llmwiki:
    # `gegenprobe-statt-gruen-glauben`).
    print("  WARNUNG: kein Skript nennt einen Pfad — Endungsliste veraltet?")
    luecken.append("pfad/keiner")

# Die Gegenrichtung: der Backlog meldet ein Aufraeumen an, das es nicht mehr
# gibt — Skript repariert oder gestrichen, Eintrag stehengeblieben. Beides
# faengt diese eine Frage, weil sie am ERGEBNIS haengt und nicht am Namen.
if angemeldet and not backlog_traf_zu:
    print(
        "  BACKLOG VERALTET: der Abschnitt \u201eAufräumen\u201c in BACKLOG.md meldet ein "
        "totes Skript an, aber kein Skript hat mehr einen toten Pfad — "
        "erledigt? Dann den Abschnitt streichen."
    )
    luecken.append("backlog/veraltet")


# ── 4. Die Loecher der Faecherung — gemeldet, nicht gezaehlt ────────────────
print("── Faecherung ueber --workspaces (HINWEIS, zaehlt nicht) ──")
for name, befehl in skripte.items():
    treffer = re.search(r"npm run ([\w:-]+) --workspaces", befehl)
    if not treffer:
        continue
    gefaechert = treffer.group(1)
    for bereich, bereich_skripte in sorted(bereiche.items()):
        if gefaechert not in bereich_skripte:
            print(
                f"  HINWEIS: `npm run {name}` faechert `{gefaechert}` aus, "
                f"{bereich} hat es nicht — npm ueberspringt still"
            )
            continue
        # Das nackte `ng test` endet nie: Karma bleibt im Beobachtungsmodus
        # stehen. Wer `npm run test` in der Wurzel ruft, wartet unbegrenzt.
        eigener = bereich_skripte[gefaechert]
        if "ng test" in eigener and "--watch=false" not in eigener:
            print(
                f"  HINWEIS: `npm run {name}` faechert in {bereich}, dessen "
                f"`{gefaechert}` ist `{eigener}` — Beobachtungsmodus, endet nie"
            )

print()
if not luecken:
    print("KEINE LUECKE.")
    sys.exit(0)
print(f"{len(luecken)} LUECKE(N).")
sys.exit(1)
