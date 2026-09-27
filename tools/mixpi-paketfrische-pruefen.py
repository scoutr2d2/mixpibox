#!/usr/bin/env python3
"""IST `bin/nodejs/deploy.zip` AELTER ALS DIE QUELLEN, AUS DENEN ES GEBAUT WIRD?

DER ANLASS (31.08.2026): Auf einer FRISCH INSTALLIERTEN Box fehlte „Jingle
ueberspringen". Nicht, weil der Code fehlte — er lag seit Tagen im Baum. Sondern
weil `bin/nodejs/deploy.zip` ein VON HAND gebautes, eingechecktes Artefakt ist
und der Installer es nur hochlaedt: `remote-step-installer/recipes/mupibox-app.yaml`
holt `$MUPI_REPO/bin/nodejs/deploy.zip` und packt es nach `$MUPI_APP` aus. Jede
frische Karte traegt damit den Stand des letzten manuellen Bauens — nicht den
Stand des Baums, aus dem sie gezogen wurde.

Das ist dieselbe Klasse wie [[rezeptschleife-nennt-acht-von-siebzehn]],
[[bt-skripte-lagen-nie-im-baum]] und [[ohne-linger-kein-ton-auf-frischer-box]]:
eine von Hand grossgezogene Box ist kein Beleg dafuer, dass etwas ausgerollt
WIRD. Am Arbeitsplatz laeuft der frische Stand, weil `tools/ausliefern.py` ihn
dorthin traegt. Auf der frischen Karte laeuft, was zuletzt jemand gezippt hat.
Nichts wird rot. Gesucht wird der Fehler danach im Code.

WAS SIE MISST — und warum nicht ueber Zeitstempel
Ein `mtime`-Vergleich waere raten: `git checkout` setzt Zeitstempel neu, ein
frisch geklonter Baum traegt fuer alles dieselbe Sekunde. Das Paket weiss es
selbst besser. Seit `src/deploy.sh` den Herkunftsstempel schreibt, liegt IM
Zip ein `herkunft.json` mit dem COMMIT, aus dem gebaut wurde. Diese Wache liest
ihn heraus und fragt git, was seither an den Eingaengen passiert ist. Das ist
keine Schaetzung, sondern die Liste der Commits, die im Paket fehlen.

WOHER DIE EINGAENGE KOMMEN, und warum das keine zweite Handliste ist
Nicht aufgezaehlt, sondern AUS DER BAUKONFIGURATION abgeleitet — sonst laeuft
sie auseinander wie jede Handliste (`tools/update-bestand-probe.py` beschreibt
denselben Schaden fuer die Rettungsliste):
  * `package.json` → `workspaces` (heute `src/*`) ergibt die Arbeitsbereiche,
    die `npm run build --workspaces` baut.
  * jede `angular.json` darunter → die `assets`-Eintraege mit `input`, relativ
    zu ihrer eigenen Datei aufgeloest. So kommt `NewDesign/` herein: es ist ein
    Asset von `src/frontend-box`, landet als `www/neu/` im Paket und waere von
    einer Liste „src/ und sonst nichts" uebersehen worden.
Findet sie UEBERHAUPT KEINEN Eingang, ist das rot: „KEIN EINGANG ABLEITBAR"
und Rueckgabe 1 — eine Wache, die ihre Eingaenge nicht mehr findet, misst
nichts und darf nicht gruen melden ([[gegenprobe-statt-gruen-glauben]]).

Ein EINZELNER Eingang, den es im Baum nicht gibt, ist dagegen nur eine
WARNUNG-Zeile; das Urteil bleibt gruen, solange ein anderer Eingang uebrig
ist. Das ist Absicht und trifft heute genau einen Fall:
`src/frontend-box/angular.json` zieht `./../../MuPiBox/media` als Cover-Asset
— einen Pfad, den es nur auf dem GERAET gibt, nie im Repo. Er kann keinen
Rueckstand belegen und faellt aus der Messmenge. Diese Zeile steht bei JEDEM
Lauf da und ist KEIN Neufund (llmwiki:
`deploy-zip-traegt-den-stand-des-letzten-handbaus`, Abschnitt „Die stehende
Warnung, die keine Luecke ist"). Wer nur die Bilanzzeile liest, sieht sie gar
nicht.

WAS SIE NICHT TUT — Absicht, keine Luecke
  * Sie baut nicht. Sie sagt, DASS das Paket hinterherhinkt, nicht welcher
    Knopf hilft (der ist `bash src/deploy.sh`, und der Aufruf steht im Befund).
  * Sie prueft nicht den INHALT des Pakets gegen den Baum. Ob `server.js` im
    Zip aus genau diesem Commit stammt, misst `tools/ausliefern.py` beim
    Ausliefern gegen die Box. Hier geht es um die Frage davor: ist ueberhaupt
    der richtige Stand eingepackt?
  * Ungetrackte Dateien zaehlt sie nicht als Rueckstand — sie koennen nie in
    einem Commit-Vergleich auftauchen ([[wache-misst-erst-verfolgt-vollstaendig]]).
    Geaenderte VERFOLGTE Dateien meldet sie als eigenen, weicheren Befund:
    auch sie sind im Paket nicht drin.

Aufruf aus dem Wurzelverzeichnis:  python3 tools/mixpi-paketfrische-pruefen.py
Gegenprobe:                        python3 tools/mixpi-paketfrische-pruefen.py --sabotage
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
PAKET = WURZEL / "bin" / "nodejs" / "deploy.zip"
BAUWEG = "src/deploy.sh"


def git(*args: str) -> str:
    """git im Wurzelverzeichnis. Leer bei Fehlschlag — die Auswertung
    entscheidet, ob das ein Befund ist."""
    try:
        e = subprocess.run(["git", "-C", str(WURZEL), *args],
                           capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError):
        return ""
    return e.stdout.strip() if e.returncode == 0 else ""


def eingaenge_ableiten() -> tuple[list[str], list[str]]:
    """Die Pfade, aus denen `deploy.zip` gebaut wird — aus der Baukonfiguration.

    Rueckgabe: (Pfade repo-relativ sortiert, Klagen). Eine Klage ist ein Grund
    fuer WARNUNG, nicht fuer gruen: eine Wache, die ihre Eingaenge nicht findet,
    misst nichts.
    """
    pfade: set[str] = set()
    klagen: list[str] = []

    try:
        wurzelpaket = json.loads((WURZEL / "package.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        return [], [f"package.json nicht lesbar: {e}"]

    muster = wurzelpaket.get("workspaces") or []
    if not muster:
        klagen.append("package.json nennt keine `workspaces` — Eingaenge nicht ableitbar")

    arbeitsbereiche: list[Path] = []
    for m in muster:
        # `src/*` und Verwandte. Nur Ordner mit package.json sind Arbeitsbereiche.
        for treffer in sorted(WURZEL.glob(m)):
            if (treffer / "package.json").is_file():
                arbeitsbereiche.append(treffer)
                pfade.add(treffer.relative_to(WURZEL).as_posix())

    if not arbeitsbereiche:
        klagen.append(f"kein Arbeitsbereich zu {muster!r} gefunden")

    # Assets aus jeder angular.json — hier haengt NewDesign/ dran.
    gefundene_assets = 0
    for ab in arbeitsbereiche:
        ajson = ab / "angular.json"
        if not ajson.is_file():
            continue
        try:
            konf = json.loads(ajson.read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            klagen.append(f"{ajson.relative_to(WURZEL)} nicht lesbar: {e}")
            continue
        for projekt in (konf.get("projects") or {}).values():
            for ziel in (projekt.get("architect") or projekt.get("targets") or {}).values():
                schichten = [ziel.get("options") or {}]
                schichten += list((ziel.get("configurations") or {}).values())
                for opt in schichten:
                    for a in (opt.get("assets") or []):
                        if not isinstance(a, dict):
                            continue
                        quelle = a.get("input")
                        if not quelle:
                            continue
                        gefundene_assets += 1
                        ziel_pfad = (ab / quelle).resolve()
                        try:
                            rel = ziel_pfad.relative_to(WURZEL).as_posix()
                        except ValueError:
                            # Ein Asset ausserhalb des Baums kann kein Commit tragen.
                            continue
                        # Assets INNERHALB eines Arbeitsbereichs sind schon
                        # abgedeckt; nur die von aussen erweitern die Menge.
                        pfade.add(rel)

    # SEIT E118/1b KOMMT NewDesign/ NICHT MEHR ALS ANGULAR-ASSET ins Paket,
    # sondern ueber tools/newdesign-kopieren.py (beide Ausrollwege rufen es;
    # die Deckung haelt tools/newdesign-mitlieferung-deckung.py). Fuer die
    # Frische-Messung ist es damit ein FESTER Eingang: eine Aenderung dort
    # muss als Rueckstand zaehlen, auch ohne angular.json-Regel. Fehlt der
    # Ordner, greift unten die normale "fehlt im Baum"-Klage.
    pfade.add("NewDesign")
    # (Die fruehere Klage "keine angular.json mit assets.input gefunden"
    # entfiel mit E118/1e: die letzte angular.json mit Fremd-Assets gehoerte
    # der alten Box-Oberflaeche. Verbliebene Assets werden weiter gelesen,
    # ihr Fehlen ist aber kein Befund mehr.)

    # Was git nicht kennt, kann keinen Rueckstand belegen.
    echte: list[str] = []
    for p in sorted(pfade):
        if not (WURZEL / p).exists():
            klagen.append(f"abgeleiteter Eingang fehlt im Baum: {p}")
            continue
        if not git("ls-files", "--", p):
            klagen.append(f"abgeleiteter Eingang ist unverfolgt: {p}")
            continue
        echte.append(p)

    # Die Eingaenge sind ineinander verschachtelt (src/frontend-box liegt in
    # keinem anderen, aber NewDesign koennte). Ueberdeckte Pfade wegwerfen,
    # damit `git log` sie nicht doppelt zaehlt.
    knapp = [p for p in echte
             if not any(p != q and p.startswith(q + "/") for q in echte)]
    return knapp, klagen


def herkunft_aus_paket() -> tuple[dict | None, str]:
    """`herkunft.json` aus dem Zip. Rueckgabe (Stempel, Klage)."""
    if not PAKET.is_file():
        return None, f"{PAKET.relative_to(WURZEL)} gibt es nicht"
    try:
        with zipfile.ZipFile(PAKET) as z:
            with z.open("herkunft.json") as f:
                return json.loads(f.read().decode("utf-8")), ""
    except KeyError:
        return None, ("das Paket traegt kein herkunft.json — es stammt aus einem "
                      "Bau VOR dem Herkunftsstempel und ist damit sicher veraltet")
    except (OSError, ValueError, zipfile.BadZipFile) as e:
        return None, f"das Paket ist nicht lesbar: {e}"


def alter_in_tagen(iso: str) -> float | None:
    try:
        t = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - t).total_seconds() / 86400


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--sabotage", action="store_true",
                   help="Gegenprobe: den Bau-Commit auf HEAD setzen. Danach MUSS "
                        "die Wache gruen sein — sonst misst sie etwas anderes "
                        "als den Rueckstand.")
    a = p.parse_args()

    print("── Ist das eingecheckte Paket so neu wie der Quelltext? ──")

    eingaenge, klagen = eingaenge_ableiten()
    for k in klagen:
        print(f"  WARNUNG: {k}")
    if not eingaenge:
        print("KEIN EINGANG ABLEITBAR — diese Wache misst nichts.")
        return 1
    print(f"  Eingaenge aus der Baukonfiguration: {', '.join(eingaenge)}")

    stempel, klage = herkunft_aus_paket()
    if stempel is None:
        print(f"  {klage}")
        print("LUECKE.")
        return 1

    bau_commit = str(stempel.get("commit") or "")
    gebaut_am = str(stempel.get("gebautAm") or "")
    if a.sabotage:
        kopf = git("rev-parse", "HEAD")
        if not kopf:
            print("  WARNUNG: HEAD nicht aufloesbar — Gegenprobe nicht moeglich.")
            return 1
        print(f"  GEGENPROBE: Bau-Commit auf HEAD gesetzt ({kopf[:8]}).")
        bau_commit = kopf

    if not bau_commit:
        print("  das Paket nennt keinen Bau-Commit (herkunft.json ohne `commit`)")
        print("LUECKE.")
        return 1

    kurz = bau_commit[:8]
    tage = alter_in_tagen(gebaut_am)
    alter = f", gebaut vor {tage:.1f} Tagen" if tage is not None else ""
    print(f"  Paket gebaut aus {kurz}{alter}.")

    # Kennt dieser Baum den Commit ueberhaupt, und liegt er HINTER uns?
    # Nach einem Rebase oder auf einem anderen Zweig ist `A..HEAD` sonst eine
    # Zahl ohne Bedeutung ([[zweig-kann-unter-dir-wechseln]]).
    # `cat-file -e` gibt bei Erfolg NICHTS aus — hier zaehlt allein der
    # Rueckgabewert, nicht die (immer leere) Ausgabe von git().
    bekannt = subprocess.run(
        ["git", "-C", str(WURZEL), "cat-file", "-e", f"{bau_commit}^{{commit}}"],
        capture_output=True).returncode == 0
    if not bekannt:
        print(f"  den Bau-Commit {kurz} gibt es in diesem Baum nicht.")
        print("  Das Paket stammt aus einer anderen Historie (Rebase? fremder Klon?)")
        print("  — sein Stand laesst sich hier nicht beziffern.")
        print("LUECKE.")
        return 1

    vorfahr = subprocess.run(
        ["git", "-C", str(WURZEL), "merge-base", "--is-ancestor", bau_commit, "HEAD"],
        capture_output=True).returncode == 0
    if not vorfahr:
        print(f"  {kurz} ist kein Vorfahr von HEAD — das Paket wurde auf einem")
        print("  anderen Zweig gebaut. Sein Rueckstand ist nicht vergleichbar.")
        print("LUECKE.")
        return 1

    fehlend = git("log", "--oneline", f"{bau_commit}..HEAD", "--", *eingaenge)
    zeilen = [z for z in fehlend.splitlines() if z.strip()]

    # Geaenderte, aber nicht eingecheckte Eingaenge: auch sie sind nicht im
    # Paket. Ungetracktes zaehlt hier nicht mit (`^??` weg).
    schmutzig = [z for z in git("status", "--porcelain", "--", *eingaenge).splitlines()
                 if z.strip() and not z.startswith("??")]

    if zeilen:
        print()
        print(f"  {len(zeilen)} Commit(s) an den Eingaengen sind NICHT im Paket:")
        for z in zeilen[:15]:
            print(f"    {z}")
        if len(zeilen) > 15:
            print(f"    … und {len(zeilen) - 15} weitere")
    if schmutzig:
        print()
        print(f"  {len(schmutzig)} geaenderte, nicht eingecheckte Datei(en) an den Eingaengen:")
        for z in schmutzig[:8]:
            print(f"    {z}")
        if len(schmutzig) > 8:
            print(f"    … und {len(schmutzig) - 8} weitere")

    if zeilen or schmutzig:
        print()
        print("  WAS DAS HEISST: Eine jetzt frisch installierte Karte bekommt")
        print("  diesen Stand NICHT. Der Installer laedt das Paket, wie es hier")
        print("  liegt (recipes/mupibox-app.yaml). Am Arbeitsplatz faellt das")
        print("  nicht auf, weil tools/ausliefern.py die laufende Box direkt")
        print("  bedient.")
        print(f"  ZURUECK IN DEN GLEICHSTAND:  bash {BAUWEG}")
        print("LUECKE.")
        return 1

    print("  Kein Commit und keine Aenderung an den Eingaengen seit dem Bau.")
    print("KEINE LUECKE.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
