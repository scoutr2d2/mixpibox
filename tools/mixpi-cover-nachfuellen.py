#!/usr/bin/env python3
"""Fehlende Album-Cover des Mitschnitt-Bestands nachfuellen (E135/1c Schritt 3).

WARUM ES DIESES WERKZEUG GIBT: Der Leerlauf-Nachschnitt hat bis zum
10.09.2026 reinen Ton abgelegt — keine Tags, kein eingebettetes Bild, keine
Ordner-`cover.jpg`. Der Fehler ist behoben (`veredelungsArgumente` im Plugin),
aber der BESTAND bleibt: Alben, die nachts entstanden sind, zeigen weiter das
Maskottchen. `tools/cover-platzhalter-probe.py` ZAEHLT sie; dieses hier fuellt
sie nach.

══ DIE QUELLE IST NICHT DIE, DIE IM PLAN STAND ════════════════════════════

Der Fixplan sagte: „die Spotify-uri steht in den FLAC-Tags". AM GERAET
GEMESSEN (10.09.2026, Box .62), bevor hier eine Zeile entstand:

    68 Alben ohne cover.jpg
      davon mit uri im Tag :  1
      davon ohne jede Tags : 67

Das ist kein Zufall, sondern DIESELBE URSACHE von der anderen Seite: die
Dateien ohne Cover sind genau die, die der defekte Weg erzeugt hat — und der
schrieb ja keine Tags. Der Fehler hatte die Quelle zerstoert, die der Fix
voraussetzte. llmwiki `der-fehler-zerstoert-die-quelle-die-der-fix-braucht`.

WAS TRAEGT: die Vormerkliste des Plugins selbst,
`server/config/plugin-daten/mixpi-mitschnitt/liste.json` — 303 Eintraege, ALLE
mit uri, 102 Alben. Sie entsteht VOR der Aufnahme und ist vom Fehler
unberuehrt. Die brauchbare Quelle lag vor der defekten Stelle, nicht dahinter.

══ WAS ES TUT ═════════════════════════════════════════════════════════════

1. Album-Ordner mit FLACs finden, die keine `cover.jpg` haben.
2. In der Vormerkliste den Eintrag suchen, dessen `albumInterpret`/`album`
   auf denselben Ordner fuehren (gesaeubert wie `albumOrdner` im Plugin).
3. Ueber die bewachte Lese-Durchreiche der Box
   (`/api/spotify/web/tracks/<id>`) `album.images[0].url` holen.
4. Das Bild auf 220 px verkleinern und als `cover.jpg` in den Album-Ordner
   legen — dieselbe Groesse wie `coverKlein` im Plugin.

TROCKEN IST DIE VORGABE. Ohne `--schreiben` wird nur gezeigt, was geschehen
WUERDE; das ist die Fassung, die man einem Betreiber vorlegt.

WARTUNGSMODUS BEIM SCHREIBEN: Die Box gehoert im Zweifel gerade einem Kind.
`--schreiben` schaltet darum von sich aus den Sperr-Schirm ein und danach
wieder aus (wie `tools/mixpi-wartung.sh`), damit niemand mitten im Nachfuellen
auf eine halb bebilderte Bibliothek sieht. Mit `--ohne-wartung` laesst sich
das abschalten — etwa nachts, wenn ohnehin niemand hoert.

DANACH: Die Kacheln lesen ihr Bild aus dem Bestandseintrag, nicht aus dem
Ordner. Wer die neuen Cover sehen will, stoesst „Medien neu einlesen" an
(Verwaltung, Medienseite) — das Werkzeug sagt es am Ende noch einmal.

Aufruf:
    python3 tools/mixpi-cover-nachfuellen.py --box dietpi@192.168.178.62
    python3 tools/mixpi-cover-nachfuellen.py --box … --schreiben
    python3 tools/mixpi-cover-nachfuellen.py --box … --schreiben --ohne-wartung
"""
from __future__ import annotations

import argparse
import json
import re
import shlex
import subprocess
import sys

MEDIEN = "/home/dietpi/MuPiBox/media"
LISTE = (
    "/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config"
    "/plugin-daten/mixpi-mitschnitt/liste.json"
)
# Dieselbe Kante wie `coverKlein` im Plugin: 220 px, damit der Bestandseintrag
# unter der 32-kB-Grenze von POST /api/medien bleibt.
BREITE = 220
URI_MUSTER = re.compile(r"^spotify:track:([A-Za-z0-9]{22})$")
# Die Rueckfallbilder, die m3u_generator.sh als cover.jpg ablegt — dieselben
# wie in tools/cover-platzhalter-probe.py. BEIDE, nicht nur das aktuelle: eine
# Box, die aelter ist als der Wechsel vom 20.08.2026, traegt noch das MuPiLogo.
WWW = "/home/dietpi/.mupibox/Sonos-Kids-Controller-master/www"
RUECKFAELLE = (
    f"{WWW}/neu/bilder/mixpi-spielt.png",
    "/home/dietpi/MuPiBox/sysmedia/images/MuPiLogo.jpg",
)


def lauf(box: str, befehl: str, frist: int = 120) -> tuple[int, str]:
    """Eine Befehlszeile auf der Box ausfuehren. Gibt (Ruecklauf, Ausgabe)."""
    fertig = subprocess.run(
        ["ssh", "-o", "ConnectTimeout=10", "-o", "BatchMode=yes", box, befehl],
        capture_output=True,
        text=True,
        timeout=frist,
    )
    return fertig.returncode, fertig.stdout.strip()


def saeubern(text: str) -> str:
    """WORTGLEICH zu `saeubern` in plugins/mixpi-mitschnitt/index.mjs.

    Weicht sie ab, zeigt die Zuordnung auf Ordner, die es nicht gibt — und das
    Werkzeug meldete dann „nichts gefunden", obwohl alles da ist. Die
    Reihenfolge der Schritte ist Teil des Vertrags: erst ersetzen, dann
    Leerraum eindampfen, dann schneiden.
    """
    roh = "" if text is None else str(text)
    roh = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", roh)
    roh = re.sub(r"\s+", " ", roh).strip()[:120]
    return roh or "Unbekannt"


class Unvollstaendig(RuntimeError):
    """Die Box hat nicht auf alle Ordner geantwortet.

    EIGENE AUSNAHME, kein blosses `return []`: der Unterschied zwischen
    „gemessen, nichts gefunden" und „nicht zu Ende gemessen" ist genau der,
    an dem dieses Werkzeug schon zweimal gruen gelogen hat.
    """


def ohne_cover(box: str) -> list[str]:
    """Album-Ordner mit FLACs, die kein ECHTES Cover haben.

    ══ „DA" IST NICHT „ECHT" — DIESELBE FALLE ZUM ZWEITEN MAL ═══════════════

    Der erste Entwurf fragte `[ -f "$d/cover.jpg" ]` und uebersprang jeden
    Ordner, in dem eine lag. Nach dem Nachfuellen blieben drei Alben mit
    Maskottchen zurueck — weil `m3u_generator.sh` das Rueckfallbild SELBST als
    `cover.jpg` in den Medienordner legt (Zeile 161/162). Fuer eine
    Existenzpruefung sieht das aus wie ein Cover.

    Das ist wortwoertlich der Fehler, gegen den dieses Werkzeug gebaut ist
    (llmwiki `rueckfallbild-macht-den-fehler-unsichtbar`): Wer einen
    Rueckfall sucht, darf nicht nach der DATEI fragen, sondern muss ihren
    INHALT vergleichen. Deshalb hier Pruefsummen, wie in der Schwesterprobe.

    UEBER -print0 UND SPLIT, NICHT UEBER EINE SHELL-SCHLEIFE: `for d in
    $(find …)` zerfaellt an Leerzeichen, und Albumnamen sind voller
    Leerzeichen. Die erste Messung meldete so 880 Ordner statt 68 — aufgefallen
    ist es nur, weil die naechste Zahl groesser war als ihre Grundmenge.
    """
    rc, aus = lauf(box, f"find {shlex.quote(MEDIEN)} -name '*.flac' -printf '%h\\0'")
    if rc != 0:
        return []
    ordner = sorted({o for o in aus.split("\0") if o.strip()})
    if not ordner:
        return []
    # Die Pruefsummen der Rueckfallbilder — auf der Box gerechnet, nicht hier
    # fest verdrahtet: eine aeltere Box traegt noch die MuPiLogo.jpg.
    rc, roh = lauf(box, "md5sum " + " ".join(shlex.quote(p) for p in RUECKFAELLE) + " 2>/dev/null")
    rueck = {z.split()[0] for z in roh.splitlines() if z.strip()}
    # ══ KEINE SHELL-SCHLEIFE MEHR ══════════════════════════════════════════
    # Hier stand bis 11.09.2026 eine `while IFS= read -r d`-Schleife auf der
    # Box, die je Ordner ein `md5sum` in einer Befehlssubstitution rief. Sie
    # verlor reproduzierbar GENAU EINEN Eintrag: 113 Antworten auf 114 Ordner,
    # jedes Mal denselben („Der Glitzerweg"). Ausgeschlossen wurden der Reihe
    # nach: der typografische Apostroph im Namen (die Zeile allein
    # durchgeschickt kam an), das Heredoc (dieselbe Liste ohne den
    # md5sum-Zweig kam vollstaendig an), stdin der Kindprozesse (`</dev/null`
    # aenderte nichts) und `sort -zu` (gibt auf der Box nachweislich 114 aus).
    # Nur Schleife UND Befehlssubstitution zusammen verlieren ihn.
    #
    # Weitersuchen waere Shell-Archaeologie um ihrer selbst willen gewesen.
    # Die Frage lautet ja nicht „welcher Puffer frisst den Happen", sondern
    # „welcher Ordner hat ein echtes Cover" — und die beantwortet `find`
    # selbst, ohne Schleife und ohne Substitution: zwei Mengen holen, in
    # Python voneinander abziehen. Das ist auch das kuerzere Programm.
    #
    # `-print0`/`\\0` durchgaengig: Albumnamen duerfen Zeilenumbrueche
    # enthalten, und ein Werkzeug, das an Dateinamen entlangarbeitet, ist der
    # falsche Ort fuer die Annahme, dass sie es nicht tun.
    rc, aus = lauf(
        box,
        f"find {shlex.quote(MEDIEN)} -name 'cover.jpg' -print0 | xargs -0 -r md5sum")
    # md5sum schreibt "<summe>  <pfad>" — zwei Leerzeichen, und der Pfad darf
    # selbst welche enthalten. Also nur EINMAL trennen, und von links.
    mit_cover: dict[str, str] = {}
    for zeile in aus.splitlines():
        if "  " not in zeile:
            continue
        summe, pfad = zeile.split("  ", 1)
        if pfad.endswith("/cover.jpg"):
            mit_cover[pfad[: -len("/cover.jpg")]] = summe

    # Ein Ordner braucht ein Cover, wenn er gar keines hat ODER wenn seines
    # das Rueckfallbild ist. Beides zaehlt gleich — genau das ist der Fund,
    # dem dieses Werkzeug seinen Namen verdankt.
    fehlend = [o for o in ordner
               if o not in mit_cover or mit_cover[o] in rueck]
    beantwortet = len(ordner) if rc == 0 else 0

    # DER RUECKLAUF IST HIER KEIN URTEIL, und das hat schon einmal grün
    # gelogen: der erste Entwurf gab bei rc != 0 eine leere Liste zurueck —
    # und meldete damit „kein Album ohne cover.jpg", waehrend drei ohne
    # dastanden. Gezaehlt wird deshalb, was ANKAM; fehlt etwas, wird es gesagt.
    #
    # UND SIE MUSS DAS URTEIL KIPPEN, nicht nur danebenstehen. Bis zum
    # 11.09.2026 druckte sie brav „nur 113 von 114 Ordnern beantwortet" — und
    # die Zeile DARUNTER sagte trotzdem „Kein Album ohne cover.jpg — nichts
    # nachzufuellen". Gelesen wird das Urteil, nicht die Warnung davor; der
    # Lauf galt als gruen, waehrend genau der verlorene Ordner der eine war,
    # dem das Cover fehlte. Eine Warnung, die den Ausgang nicht aendert, ist
    # Dekoration. Jetzt wirft sie, und der Aufrufer endet mit 1.
    if beantwortet < len(ordner):
        raise Unvollstaendig(
            f"nur {beantwortet} von {len(ordner)} Ordnern beantwortet — die Bilanz "
            f"waere unvollstaendig, und ein unvollstaendiges 'nichts zu tun' ist "
            f"schlimmer als gar keines."
        )
    return fehlend


def vormerkliste(box: str) -> list[dict]:
    rc, aus = lauf(box, f"cat {shlex.quote(LISTE)}")
    if rc != 0 or not aus:
        return []
    try:
        return json.loads(aus).get("eintraege", []) or []
    except json.JSONDecodeError:
        return []


def uri_je_ordner(eintraege: list[dict]) -> dict[tuple[str, str], str]:
    """Von (Interpret-Ordner, Album-Ordner) auf EINE uri des Albums.

    Die erste genuegt: gebraucht wird das ALBUM-Bild, und jeder Titel des
    Albums fuehrt ueber `album.images` zu demselben.
    """
    karte: dict[tuple[str, str], str] = {}
    for e in eintraege:
        uri = str(e.get("uri") or "")
        if not URI_MUSTER.match(uri):
            continue
        wer = saeubern(e.get("albumInterpret") or e.get("interpret") or "")
        was = saeubern(e.get("album") or "")
        if wer == "Unbekannt" or was == "Unbekannt":
            continue
        karte.setdefault((wer, was), uri)
    return karte


def bildadresse(box: str, uri: str) -> str | None:
    """Ueber die BESTEHENDE Lese-Durchreiche der Box — kein neuer Endpunkt."""
    m = URI_MUSTER.match(uri)
    if not m:
        return None
    rc, aus = lauf(
        box,
        f"curl -s -m 20 http://127.0.0.1:8200/api/spotify/web/tracks/{m.group(1)}?market=DE",
    )
    if rc != 0 or not aus:
        return None
    try:
        bilder = (json.loads(aus).get("album") or {}).get("images") or []
    except json.JSONDecodeError:
        return None
    return bilder[0].get("url") if bilder and isinstance(bilder[0], dict) else None


def nachfuellen(box: str, ordner: str, adresse: str) -> bool:
    """Bild holen, verkleinern, als cover.jpg ablegen — auf der Box.

    ERST DANEBEN, DANN UMBENENNEN: bricht der Lauf mittendrin ab, liegt sonst
    eine halbe JPEG unter dem richtigen Namen, und der m3u-Generator haelt sie
    fuer ein Cover. Dieselbe Regel wie beim Ausliefern.
    """
    ziel = f"{ordner}/cover.jpg"
    befehl = (
        f"set -e; t=$(mktemp /tmp/mixpi-cover-XXXXXX.jpg); "
        f"curl -sfL -m 30 -o \"$t\" {shlex.quote(adresse)}; "
        f"ffmpeg -hide_banner -loglevel error -y -i \"$t\" -vf scale={BREITE}:-1 -q:v 8 \"$t.klein.jpg\"; "
        f"mv \"$t.klein.jpg\" {shlex.quote(ziel)}; rm -f \"$t\""
    )
    rc, _ = lauf(box, befehl, frist=90)
    return rc == 0


def wartung(box: str, an: bool) -> None:
    zustand = "true" if an else "false"
    lauf(
        box,
        "curl -sf -X POST http://127.0.0.1:8200/api/wartung "
        f"-H 'Content-Type: application/json' -d '{{\"aktiv\":{zustand}}}'",
        frist=30,
    )


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--box", required=True, help="z. B. dietpi@192.168.178.62")
    p.add_argument("--schreiben", action="store_true", help="wirklich nachfuellen (Vorgabe: nur zeigen)")
    p.add_argument("--ohne-wartung", action="store_true", help="den Sperr-Schirm NICHT schalten")
    # ERST EINES, DANN ALLE. Ein Lauf ueber den ganzen Bestand, dessen erster
    # Schritt schon falsch ist, schreibt 67 unbrauchbare Dateien — und die
    # sehen aus wie Cover, genau der Fehler, gegen den das hier gebaut ist.
    p.add_argument("--hoechstens", type=int, default=0, metavar="N", help="nur die ersten N nachfuellen (Probelauf)")
    a = p.parse_args()

    try:
        fehlend = ohne_cover(a.box)
    except Unvollstaendig as fehler:
        print(f"ABBRUCH: {fehler}", file=sys.stderr)
        return 1
    if not fehlend:
        print("Kein Album ohne cover.jpg — nichts nachzufuellen.")
        return 0
    karte = uri_je_ordner(vormerkliste(a.box))
    print(f"{len(fehlend)} Alben ohne cover.jpg, {len(karte)} Alben in der Vormerkliste\n")

    treffer: list[tuple[str, str]] = []
    ohne_quelle: list[str] = []
    for ordner in fehlend:
        teile = ordner.rstrip("/").split("/")
        if len(teile) < 2:
            ohne_quelle.append(ordner)
            continue
        uri = karte.get((teile[-2], teile[-1]))
        (treffer.append((ordner, uri)) if uri else ohne_quelle.append(ordner))

    print(f"  zuzuordnen  : {len(treffer)}")
    print(f"  ohne Quelle : {len(ohne_quelle)}")
    if ohne_quelle:
        # NICHT VERSCHWEIGEN: Was die Liste nicht kennt, bleibt ohne Bild —
        # eine Bilanz, die nur die Treffer nennt, liest sich wie „alles gut".
        print("\nDiese Alben stehen in keiner Vormerkung (Bild nur von Hand):")
        for o in sorted(ohne_quelle):
            print(f"    {o}")

    if not a.schreiben:
        print(f"\nTROCKEN — mit --schreiben wuerden {len(treffer)} Cover geholt.")
        return 0

    if not a.ohne_wartung:
        print("\nWartungsmodus AN (die Box gehoert im Zweifel gerade einem Kind)")
        wartung(a.box, True)
    dran = treffer[: a.hoechstens] if a.hoechstens > 0 else treffer
    if len(dran) < len(treffer):
        print(f"PROBELAUF: nur {len(dran)} von {len(treffer)}")
    gefuellt, misslungen = 0, []
    try:
        for ordner, uri in dran:
            adresse = bildadresse(a.box, uri)
            if not adresse or not nachfuellen(a.box, ordner, adresse):
                misslungen.append(ordner)
                continue
            gefuellt += 1
            print(f"  ✓ {ordner}")
    finally:
        if not a.ohne_wartung:
            wartung(a.box, False)
            print("Wartungsmodus AUS")

    print(f"\n{gefuellt} von {len(dran)} Cover nachgefuellt, {len(misslungen)} misslungen, {len(ohne_quelle)} ohne Quelle")
    for o in misslungen:
        print(f"  ✗ {o}")
    if gefuellt:
        print("\nJETZT NOCH: in der Verwaltung 'Medien neu einlesen' — die Kacheln")
        print("lesen ihr Bild aus dem Bestandseintrag, nicht aus dem Ordner.")
    return 1 if misslungen else 0


if __name__ == "__main__":
    sys.exit(main())
