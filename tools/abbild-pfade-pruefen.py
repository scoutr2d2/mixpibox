#!/usr/bin/env python3
"""ABBILD-PFADE — die Bauanleitung des Entwicklungs-Abbilds gegen den Baum.

WARUM ES DAS GIBT (26.08.2026): `npm run docker:build` und `docker:start`
stehen in der Wurzel-`package.json` und in `dokumentation/mixpibox.md`,
Abschnitt 7.4, mit einer Zeile: „das Docker-Abbild aus dem Ursprungsprojekt".
Von den 31 Wachen in `tools/doku-luecken-probe.sh` las KEINE die `Dockerfile`.
`npm-skripte-deckung.py` prueft seit dem 26.08.2026 jeden Eingabe-Pfad jedes
Skripts — aber `docker build -t mupibox .` nennt keinen Pfad mit Endung; der
tote Pfad liegt eine Datei weiter, in der Bauanleitung selbst.

DER FALL, DER SIE AUSGELOEST HAT: die `Dockerfile` kopiert zwei Dateien, die
der Arbeitsbereichs-Umbau `5f5ea724` am **23.10.2024** verschoben hat:

  * `dev/customize/mplayer-wrapper/index.js` → `src/backend-player/src/mplayer-wrapper.ts`
  * `bin/nodejs/spotify-control.js`          → `src/backend-player/src/spotify-control.ts`

Ein `RUN cp` auf eine fehlende Quelle endet mit 1, und `docker build` bricht
an dieser Schicht ab. Das Abbild laesst sich seither nicht bauen — 22 Monate,
ohne dass es irgendwo stuende. Dieselbe Bauart wie `build-proto`
(llmwiki `skript-das-niemand-ruft-verrottet-lautlos`), nur eine Datei weiter:
**ein Rezept ist nur so wach wie sein Koch.**

WAS GEPRUEFT WIRD (beides zaehlt als Luecke):

  1. jede Quelle eines `COPY` liegt wirklich im Baum,
  2. jede Quelle eines `RUN cp/mv` unterhalb von `$mupisrc` liegt wirklich im
     Baum — UND ihr oberster Ordner wurde vorher per `COPY` ins Abbild
     gelegt. Der zweite Teil ist der eigentliche Wert: wer den Pfad oben auf
     `src/backend-player/src/…` richtet und das `COPY ./src` vergisst, hat
     eine Zeile repariert, die im Abbild trotzdem ins Leere greift. Der Baum
     allein kann das nicht beantworten.

Auskommentierte Zeilen zaehlen nicht — der `# TODO: Copy media files`-Block
ist absichtlich stillgelegt und soll nicht dauerrot melden.

WAS ES NICHT TUT: es ruft kein `docker` auf, baut nichts und aendert nichts.
Es liest `Dockerfile` und `BACKLOG.md`.

DAUERROT IST KEINE WACHE (llmwiki `dauerrote-wache-ist-keine`): die zwei
bekannten Funde zu reparieren ist Arbeit AM BAU (der `src/`-Baum muesste ins
Abbild und die Pfade umgeschrieben werden) — nicht Arbeit an der Doku. Die
Ausnahme wohnt darum im `BACKLOG.md` unter einer „Aufräumen"-Ueberschrift,
dort wo sie findet, wer sie abarbeiten soll, und gilt in BEIDE Richtungen:
ist kein Pfad mehr tot, meldet die Wache `BACKLOG VERALTET`.

Findet die Wache gar keine Quelle, meldet sie FEHLER statt gruen — eine
Wache, die eine Umbenennung ueberlebt, ist keine (llmwiki
`gegenprobe-statt-gruen-glauben`).

Aufruf aus dem Wurzelverzeichnis:  python3 tools/abbild-pfade-pruefen.py
Rueckgabe: 0 = keine Luecke, 1 = mindestens eine, 2 = die Wache selbst blind.
"""

import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
ABBILD = WURZEL / "Dockerfile"
BACKLOG = WURZEL / "BACKLOG.md"

# `ARG mupisrc=/home/dietpi/MuPiBoxSource` — der Ort IM Abbild, an den die
# `COPY`-Zeilen den Baum legen. Aus dem `Dockerfile` gelesen, nicht geraten:
# wer den Ordner umbenennt, soll keine stumme Wache erben.
ARG_ZEILE = re.compile(r"^ARG\s+mupisrc=(\S+)", re.M)


def fehler(satz: str) -> None:
    print(f"FEHLER: {satz}")
    sys.exit(2)


def zeilen_ohne_kommentar(text: str) -> list[tuple[int, str]]:
    """Die Anweisungen der Datei, Fortsetzungszeilen zusammengezogen."""
    ergebnis: list[tuple[int, str]] = []
    puffer, ab = "", 0
    for nr, roh in enumerate(text.splitlines(), start=1):
        zeile = roh.rstrip()
        if not puffer and zeile.lstrip().startswith("#"):
            continue
        if not puffer:
            ab = nr
        if zeile.endswith("\\"):
            puffer += zeile[:-1] + " "
            continue
        ergebnis.append((ab, (puffer + zeile).strip()))
        puffer = ""
    if puffer:
        ergebnis.append((ab, puffer.strip()))
    return ergebnis


def main() -> int:
    if not ABBILD.is_file():
        fehler("Dockerfile gibt es nicht — verschoben?")

    text = ABBILD.read_text(encoding="utf-8", errors="replace")
    treffer = ARG_ZEILE.search(text)
    if not treffer:
        fehler("`ARG mupisrc=…` steht nicht mehr in der Dockerfile — umbenannt?")
    mupisrc = treffer.group(1).rstrip("/")

    anweisungen = zeilen_ohne_kommentar(text)

    # ── 1. Was legt `COPY` ueberhaupt ins Abbild? ──────────────────────────
    # Die Quellen sind alle Worte bis auf das letzte (das Ziel); Schalter wie
    # `--from=` gehoeren nicht dazu.
    kopiert: list[tuple[int, str]] = []
    for nr, zeile in anweisungen:
        if not re.match(r"^COPY\s", zeile):
            continue
        worte = [w for w in zeile.split()[1:] if not w.startswith("--")]
        for quelle in worte[:-1]:
            kopiert.append((nr, quelle.lstrip("./")))

    if not kopiert:
        fehler("kein einziges `COPY` in der Dockerfile — Muster kaputt?")

    # Die obersten Ordner, die im Abbild wirklich unter $mupisrc liegen.
    # `COPY ./docker/entrypoint.sh /entrypoint.sh` legt nichts dorthin und
    # zaehlt hier nicht mit — deshalb wird das ZIEL geprueft, nicht die Quelle.
    im_abbild: set[str] = set()
    for nr, zeile in anweisungen:
        if not re.match(r"^COPY\s", zeile):
            continue
        worte = [w for w in zeile.split()[1:] if not w.startswith("--")]
        ziel = worte[-1]
        if ziel.startswith("$mupisrc/") or ziel.startswith(f"{mupisrc}/"):
            im_abbild.add(ziel.split("/")[-1] if ziel.count("/") == 1 else ziel.split("/")[1])

    luecken: list[str] = []
    # Jeder Fund als (Pfad im Baum, fertige Meldung). Erst GESAMMELT, dann
    # gemeldet: ob ein Fund rot ist oder nur ein HINWEIS, entscheidet der
    # BACKLOG weiter unten — wer hier schon druckt, meldet einen angemeldeten
    # Fund zweimal und in zwei Tonlagen.
    tote: list[tuple[str, str]] = []

    for nr, quelle in kopiert:
        if (WURZEL / quelle).exists():
            continue
        tote.append(
            (quelle, f"Dockerfile:{nr} kopiert `{quelle}` — das liegt nicht im Baum")
        )

    # ── 2. Die `cp`/`mv`-Zeilen, die aus $mupisrc lesen ────────────────────
    muster = re.compile(r"(?:\$mupisrc|\$\{mupisrc\}|" + re.escape(mupisrc) + r")/(\S+)")
    gesehen = 0
    for nr, zeile in anweisungen:
        if not re.match(r"^RUN\s+(cp|mv)\b", zeile):
            continue
        for pfad in muster.findall(zeile):
            gesehen += 1
            oberster = pfad.split("/")[0]
            if oberster not in im_abbild:
                tote.append(
                    (
                        pfad,
                        f"Dockerfile:{nr} liest `$mupisrc/{pfad}`, aber kein COPY legt "
                        f"`{oberster}` dorthin "
                        f"(dort liegen: {', '.join(sorted(im_abbild)) or '—'})",
                    )
                )
                continue
            if (WURZEL / pfad).exists():
                continue
            tote.append(
                (
                    pfad,
                    f"Dockerfile:{nr} liest `$mupisrc/{pfad}` — das liegt nicht im Baum, "
                    f"`cp` endet mit 1 und der Bau bricht ab",
                )
            )

    if gesehen == 0:
        fehler("keine einzige `cp`/`mv`-Zeile liest aus $mupisrc — Muster kaputt?")

    # ── 3. Die Ausnahme wohnt im BACKLOG, nicht hier ───────────────────────
    # Wie bei `npm-skripte-deckung.py`: ein ERKANNTER Fund, dessen Behebung
    # Arbeit am Bau ist, darf die Wache nicht dauerrot halten — sonst geht der
    # naechste echte Fund in einer Meldung unter, die man schon kennt.
    # ALLE „Aufräumen"-Abschnitte werden gelesen, nicht nur der erste: es gibt
    # inzwischen mehr als einen, und eine Wache, die beim ersten aufhoert,
    # meldet den zweiten Fund als neu.
    backlog = BACKLOG.read_text(encoding="utf-8") if BACKLOG.exists() else ""
    angemeldet: set[str] = set()
    for block in backlog.split("\n## ")[1:]:
        if not block.startswith("Aufräumen"):
            continue
        angemeldet |= set(re.findall(r"`([^`\n]+)`", block))

    # Beide Seiten auf denselben Nenner: der Backlog nennt die Zeile so, wie
    # sie in der Dockerfile steht (`$mupisrc/…`), die Wache haelt den Pfad im
    # Baum. Wer das nicht angleicht, meldet einen angemeldeten Fund als neu.
    def ohne_praefix(pfad: str) -> str:
        return pfad[len("$mupisrc/") :] if pfad.startswith("$mupisrc/") else pfad

    angemeldet = {ohne_praefix(a) for a in angemeldet}

    print("── Quellen, auf die die Dockerfile zeigt ──")
    for pfad, meldung in tote:
        if ohne_praefix(pfad) in angemeldet:
            print(f"  HINWEIS: {meldung} — im BACKLOG.md unter „Aufräumen\" angemeldet, zaehlt nicht")
            continue
        print(f"  TOTE QUELLE: {meldung}")
        luecken.append(pfad)

    # Die Gegenrichtung: der Backlog meldet ein Aufraeumen an, das es nicht
    # mehr gibt. Sie haengt am ERGEBNIS (gibt es noch einen toten Pfad?),
    # nicht am Namen — deshalb faengt sie „repariert" und „gestrichen".
    ABBILD_MARKE = "Dockerfile"
    meldet_abbild = any(
        block.startswith("Aufräumen") and ABBILD_MARKE in block and "OFFEN" in block.split("\n")[0]
        for block in backlog.split("\n## ")[1:]
    )
    if meldet_abbild and not tote:
        print(
            "  BACKLOG VERALTET: ein Abschnitt „Aufräumen\" in BACKLOG.md meldet eine "
            "tote Quelle der Dockerfile an, aber keine ist mehr tot — erledigt? "
            "Dann den Abschnitt streichen."
        )
        luecken.append("backlog/veraltet")

    print()
    if not luecken:
        print("KEINE LUECKE.")
        return 0
    print(f"{len(luecken)} LUECKE(N).")
    return 1


if __name__ == "__main__":
    sys.exit(main())
