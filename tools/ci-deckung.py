#!/usr/bin/env python3
"""CI-DECKUNG — was auf jedem `push` wirklich laeuft, gegen das, was das
Handbuch als „geprueft" beschreibt.

WARUM ES DAS GIBT (26.08.2026): `.github/workflows/ci.yml` gibt es seit dem
Umbau B0. Von 30 Wachen in `tools/doku-luecken-probe.sh` liest KEINE die
Datei, und die Woerter „CI" oder „GitHub Actions" stehen in KEINEM der
Handbuecher — nicht in `README.md`, nicht in `dokumentation/mixpibox.md`.
Wer hier arbeitet, kann also nirgends nachlesen, welche Pruefung ein Fremder
mit einem PR ausloest und welche nur am eigenen Rechner existiert. Abschnitt
7.3 zaehlt 197 Testdateien auf und liest sich wie eine Deckung; Abschnitt 7.4
nennt `tools/pruefen.sh` als „den Weg, der wirklich prueft". Beide sagen
nichts darueber, was DURCHGESETZT wird.

DER FALL, DER SIE AUSGELOEST HAT: die 14 Testdateien unter `plugins/*/` —
367 Tests, gruen, 230 Millisekunden — laufen in KEINEM Laeufer.

  * `npm run test` in der Wurzel ist `npm run test --workspaces && npm run
    test:plugins`. Die Faecherung geht in `frontend-box`/`frontend-admin`,
    deren `test` das nackte `ng test` ist: Karma bleibt im Beobachtungsmodus
    stehen und endet nie. Das `&&` wird nie erreicht.
  * `tools/pruefen.sh` ruft `plugin-geruest-probe.sh` (das Geruest fuer
    Fremde) und `mixpi-plugins-nachziehen-probe.sh` — beide pruefen ETWAS mit
    Plugins, keines ruft die 14 Dateien. Ein Namenstreffer taugt als Alibi.
  * die CI ruft `test` nur fuer `backend-api` und `backend-player`.

Das ist dieselbe Bauart wie „ungerufene Wachen" (llmwiki
`ungerufene-wache-driftet-in-den-fehlalarm`), nur eine Ebene hoeher: nicht eine
Wache haengt in keinem Laeufer, sondern eine ganze TESTMENGE. Sie war gruen,
weil niemand fragte.

WAS GEPRUEFT WIRD (jedes zaehlt als Luecke):

  1. jeder Auftrag (`job`) aus `ci.yml` steht mit seinem Namen im Handbuch,
  2. jedes `npm run …` aus `ci.yml` steht in Backticks im Handbuch,
  3. umgekehrt: jedes `npm run …`, das das Handbuch der CI zuschreibt, steht
     wirklich in `ci.yml` (sonst beschreibt die Doku eine CI von gestern),
  4. jeder TESTEINSTIEG des Baums — das `test`-Skript jedes Arbeitsbereichs
     plus `test:plugins` der Wurzel — laeuft in der CI ODER in
     `tools/pruefen.sh` ODER steht im Handbuch namentlich als bewusst
     nicht durchgesetzt. Ein Einstieg, den niemand ruft und niemand
     erwaehnt, ist die Luecke, fuer die es diese Wache gibt.

Punkt 4 ist der einzige, der ueber Text hinausgeht: er liest, WER ruft.

DAUERROT IST KEINE WACHE (llmwiki `dauerrote-wache-ist-keine`): die Loecher,
die das Handbuch in 7.5 begruendet — `ng test` braucht einen Browser, den ein
Runner nicht hat; `lint` prueft seit 25.09.2026 nur die Lint-Regeln, nicht
Formatierung und Import-Reihenfolge — sind ABSICHT und stehen im
AUSNAHMEN-Kasten des Handbuchs. (Bis zum 25.09. stand hier auch „`lint`
ueberspringt `frontend-admin` still" — das war falsch, npm bricht bei einem
fehlenden Skript ab; `tools/npm-skripte-deckung.py` zaehlt das jetzt rot.) Die Wache liest diesen
Kasten aus der Doku, statt ihn im Code zu fuehren. Wer die Absicht aendert,
aendert den Kasten, und die Wache zieht mit.

WAS ES NICHT TUT: es ruft keinen Test auf, startet keinen Runner und aendert
nichts. Es liest `ci.yml`, `package.json`, `tools/pruefen.sh` und Text.

Findet die Wache keinen Auftrag, keinen Testeinstieg oder keinen
Ausnahme-Kasten, meldet sie FEHLER statt gruen — eine Wache, die eine
Umbenennung ueberlebt, ist keine (llmwiki `gegenprobe-statt-gruen-glauben`).

Aufruf aus dem Wurzelverzeichnis:  python3 tools/ci-deckung.py
Rueckgabe: 0 = keine Luecke, 1 = mindestens eine, 2 = die Wache selbst blind.
"""

import json
import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent

CI = WURZEL / ".github" / "workflows" / "ci.yml"
HANDBUCH = WURZEL / "dokumentation" / "mixpibox.md"
PRUEFEN = WURZEL / "tools" / "pruefen.sh"

# Der Kasten, aus dem die Wache die ABSICHT liest. Alles zwischen dieser
# Marke und der naechsten Ueberschrift gilt als Begruendung; ein Einstieg,
# der dort in Backticks steht, ist bewusst nicht durchgesetzt und zaehlt
# nicht rot. Steht die Marke nicht mehr da, ist die Wache blind und sagt es.
AUSNAHME_MARKE = "Was die CI *nicht* durchsetzt"


def npm_rufe(text: str) -> set[str]:
    """Alle `npm run NAME` aus einem Text — der Name ohne Flaggen.

    `--workspace=…` und `--workspaces` gehoeren zum Ruf, nicht zum Namen;
    die erste Fassung nahm sie mit und fand deshalb nie eine Entsprechung
    im Handbuch, das nur den Namen nennt.
    """
    return set(re.findall(r"npm run ([a-z0-9:._-]+)", text))


def fehler(satz: str) -> None:
    print(f"FEHLER: {satz}")
    sys.exit(2)


def main() -> int:
    for pfad in (CI, HANDBUCH, PRUEFEN):
        if not pfad.exists():
            fehler(f"{pfad.relative_to(WURZEL)} gibt es nicht")

    ci_text = CI.read_text(encoding="utf-8")
    doku = HANDBUCH.read_text(encoding="utf-8")
    pruefen = PRUEFEN.read_text(encoding="utf-8")

    # ── Auftraege und ihre Namen ───────────────────────────────────────────
    # `name: CI` ganz oben ist der Name des WORKFLOWS, kein Auftrag. Die
    # Auftraege stehen unter `jobs:` und sind genau zwei Ebenen eingerueckt.
    jobs_ab = ci_text.find("\njobs:")
    if jobs_ab < 0:
        fehler("`ci.yml` hat keinen `jobs:`-Block")
    job_block = ci_text[jobs_ab:]
    job_namen = re.findall(r"^    name: (.+)$", job_block, re.MULTILINE)
    job_schluessel = re.findall(r"^  ([a-z][a-z0-9_-]*):$", job_block, re.MULTILINE)
    if not job_schluessel:
        fehler("`ci.yml` nennt keinen einzigen Auftrag")

    ci_rufe = npm_rufe(ci_text)
    if not ci_rufe:
        fehler("`ci.yml` ruft kein einziges `npm run` — Muster kaputt?")

    # ── Der Ausnahme-Kasten des Handbuchs ──────────────────────────────────
    marke = doku.find(AUSNAHME_MARKE)
    if marke < 0:
        fehler(f"das Handbuch hat keinen Kasten fuer {AUSNAHME_MARKE!r} mehr")
    naechste = doku.find("\n### ", marke)
    kasten = doku[marke : naechste if naechste > 0 else len(doku)]
    entschuldigt = set(re.findall(r"`([a-z0-9:._-]+)`", kasten))

    # ── NUR DER CI-ABSCHNITT ZAEHLT ────────────────────────────────────────
    # Die erste Fassung suchte im GANZEN Handbuch. Damit galt jeder Ruf, den
    # die CI aus der Wurzel nimmt, als dokumentiert — Abschnitt 7.4 zaehlt die
    # zwanzig Wurzel-Skripte ohnehin alle auf. In der Gegenprobe liess sich
    # `npm run docker:build` in die CI haengen, ohne dass die Wache mit der
    # Wimper zuckte. Was die CI ruft, muss DORT stehen, wo einer nachliest,
    # was die CI tut.
    ci_abschnitt_ab = doku.find("### 7.5")
    if ci_abschnitt_ab < 0:
        fehler("das Handbuch hat keinen Abschnitt 7.5 mehr")
    ci_abschnitt_bis = doku.find("\n### ", ci_abschnitt_ab + 1)
    ci_abschnitt = doku[ci_abschnitt_ab:ci_abschnitt_bis]
    doku_backticks = set(re.findall(r"`([^`\n]+)`", ci_abschnitt))

    luecken = 0

    # ── 1. Auftraege ───────────────────────────────────────────────────────
    print("── Auftraege der CI, die das Handbuch nicht nennt ──")
    for name in job_namen:
        if name not in doku:
            print(f"  Auftrag {name!r} steht in keinem Handbuch")
            luecken += 1

    # ── 2. Rufe der CI ─────────────────────────────────────────────────────
    print("── `npm run` der CI, die das Handbuch nicht nennt ──")
    for ruf in sorted(ci_rufe):
        if ruf not in doku_backticks and f"npm run {ruf}" not in ci_abschnitt:
            print(f"  `npm run {ruf}` laeuft in der CI, steht nicht in Abschnitt 7.5")
            luecken += 1

    # ── 3. Gegenrichtung: beschreibt die Doku eine CI von gestern? ─────────
    # Nur der CI-Abschnitt zaehlt; im uebrigen Handbuch stehen dieselben
    # Skripte voellig zu Recht, ohne dass die CI sie riefe.
    print("── Was die Doku der CI zuschreibt und was dort nicht steht ──")
    for ruf in sorted(npm_rufe(ci_abschnitt)):
        if ruf not in ci_rufe and ruf not in entschuldigt:
            print(f"  die Doku schreibt der CI `npm run {ruf}` zu — `ci.yml` nicht")
            luecken += 1

    # ── 4. Testeinstiege: wer ruft sie? ────────────────────────────────────
    print("── Testeinstiege, die kein Laeufer ruft und kein Handbuch nennt ──")
    wurzel_pkg = json.loads((WURZEL / "package.json").read_text(encoding="utf-8"))
    einstiege: dict[str, str] = {}
    for name, befehl in (wurzel_pkg.get("scripts") or {}).items():
        if name.startswith("test:") and "--workspace" not in befehl:
            einstiege[name] = befehl
    for pkg in sorted((WURZEL / "src").glob("*/package.json")):
        daten = json.loads(pkg.read_text(encoding="utf-8"))
        if "test" in (daten.get("scripts") or {}):
            einstiege[daten["name"]] = daten["scripts"]["test"]
    if not einstiege:
        fehler("kein einziger Testeinstieg gefunden — Baum umgebaut?")

    for name, befehl in sorted(einstiege.items()):
        # Ruft die CI ihn? Entweder ueber den Skriptnamen (`test:plugins`)
        # oder ueber `--workspace=NAME`.
        # NICHT `f"--workspace={name}" in ci_text` — daran ist die erste
        # Fassung in der Gegenprobe gescheitert: `backend-player` steht in
        # `ci.yml` ZWEIMAL, einmal fuer `test` und einmal fuer `check-types`.
        # Nimmt man die Zeile mit den Tests heraus, haelt die Typpruefung den
        # Bereich weiter als „gedeckt". Ein Bereichsname ist kein Beleg dafuer,
        # dass die TESTS laufen (llmwiki `gegenprobe-statt-gruen-glauben`).
        in_ci = f"npm run {name}" in ci_text or f"npm run test --workspace={name}" in ci_text
        # Ruft `pruefen.sh` ihn? Dort heisst es `npm --prefix src/X run test`
        # oder der Befehl selbst steht da.
        kurz = name.removeprefix("mupibox-")
        in_pruefen = (
            f"--prefix src/{kurz} run test" in pruefen
            or f"npm run {name}" in pruefen
            or befehl in pruefen
        )
        if in_ci or in_pruefen:
            continue
        if name in entschuldigt:
            continue
        print(f"  `{name}` ({befehl}) — weder CI noch pruefen.sh noch Handbuch")
        luecken += 1

    print()
    if luecken == 0:
        print("KEINE LUECKE.")
        return 0
    print(f"{luecken} LUECKE(N).")
    return 1


if __name__ == "__main__":
    sys.exit(main())
