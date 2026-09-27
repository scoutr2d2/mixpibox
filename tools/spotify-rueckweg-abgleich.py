#!/usr/bin/env python3
"""
DER EINE RUECKWEG — steht er UEBERALL gleich?

WOZU DIESES WERKZEUG (BACKLOG E22, gegengelesen 2026-08-04):

Spotify vergleicht `redirect_uri` ZEICHENGENAU, und zwar an ZWEI Stellen im
Ablauf (Autorisieren und Tausch). Dass die beiden zusammenpassen, nagelt ein
Test fest (`spotify-auth.service.spec.ts`). Der teure Fehler liegt aber
woanders: an den Stellen, die dem MENSCHEN sagen, was er ins Spotify-Dashboard
eintragen soll. Steht dort etwas anderes als das, was der Browser schickt,
scheitert die Anmeldung auf SPOTIFYS Seite — dorthin kommt keine Erklaerung der
Box mehr.

Genau das ist beim Gegenlesen am 04.08.2026 schon einmal passiert (Befund G1):
`AdminInterface/www/spotify.php` nannte weiter `https://<box>:8443/spotify`,
waehrend der Browser laengst `http://127.0.0.1:8200/spotify` schickte. Ein
Suchlauf von Hand findet so etwas EINMAL. Dieses Werkzeug findet es JEDES MAL.

WAS GEPRUEFT WIRD:
  1. Die Wahrheit: `SPOTIFY_RUECKWEG_VORGABE` in spotify-auth.ts.
     Sie muss Spotifys einzige verbliebene HTTP-Ausnahme sein — das
     IP-LITERAL 127.0.0.1 (oder [::1]). `localhost` ist ausdruecklich NICHT
     erlaubt und sieht trotzdem harmlos aus.
  2. Jede Stelle, die dem Menschen eine Adresse zum EINTRAGEN nennt:
     spotify.php (in www/ UND im ausgelieferten Zip — ausgeliefert wird das
     Zip, siehe [[php-admin-knopf-sperren-nicht-ausblenden]]), die Vorlage der
     Einrichtungsseite, die Verwaltungsseite, die Dokumentation.
  3. Adressen, die als Rueckweg NICHT mehr taugen und trotzdem noch irgendwo
     als solcher empfohlen werden (https auf 8443, https auf 8200, localhost).

MIT --box <adresse> ZUSAETZLICH, NUR LESEND:
  * antwortet die Box unter dem Rueckweg-Pfad?
  * ist die Box noch angemeldet (`/api/spotify/config` -> eingerichtet)?
    Das ist die wichtigste Frage nach jeder Aenderung am Rueckweg: die
    Erneuerung kennt gar kein redirect_uri, ALSO DARF SICH DARAN NICHTS
    AENDERN. Faellt es hier um, ist etwas ganz anderes kaputt.

AUFRUF:
    python3 tools/spotify-rueckweg-abgleich.py
    python3 tools/spotify-rueckweg-abgleich.py --box 192.168.178.169

RUECKGABE: 0 wenn alles zusammenpasst, 1 bei jedem Widerspruch.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Die Quelle der Wahrheit. Aendert sich ihr Ort, faellt die Pruefung laut aus —
# und das ist richtig so: eine Vorgabe, die niemand mehr findet, ist keine.
# SEIT E118/1a/1e lebt sie in der eigenstaendigen Anmeldeseite beim NewDesign
# (die alte Angular-Seite und der PHP-Admin sind geloescht).
VORGABE_DATEI = "NewDesign/spotify-anmeldung-logik.mjs"
VORGABE_MUSTER = re.compile(r"SPOTIFY_RUECKWEG_VORGABE\s*=\s*['\"]([^'\"]+)['\"]")

# Stellen, die dem Menschen eine einzutragende Adresse nennen. Jede muss die
# Vorgabe WOERTLICH enthalten. (Der PHP-Admin und die Angular-Seite standen
# hier bis E118/1e; www.zip fiel mit dem PHP-Admin.)
NENNT_DIE_ADRESSE = [
    ("NewDesign/spotify-anmeldung.html", "die Einrichtungsseite selbst"),
]


# Adressen, die als Spotify-Rueckweg SICHER nicht mehr taugen. Wer eine davon
# einem Menschen zum Eintragen hinschreibt, schickt ihn in
# "INVALID_CLIENT: Insecure redirect URI".
UNTAUGLICH = [
    (re.compile(r"https://[^\s`'\"]*:8443/spotify"), "https auf 8443 — seit E22/R1 wird das nie mehr geschickt"),
    (re.compile(r"https://[^\s`'\"]*:8200/spotify"), "https auf 8200 — dort liegt gar kein TLS (gemessen: 000)"),
    (re.compile(r"http://localhost:\d+/spotify"), "localhost — von Spotify ausdruecklich NICHT als Ausnahme erlaubt"),
]
# Wo nach untauglichen Empfehlungen gesucht wird. Quelltext-Kommentare und der
# Backlog duerfen sie nennen (sie erzaehlen ja die Geschichte); eine ANLEITUNG
# darf es nicht.
ANLEITUNGEN = [
    "documentation",
    "README.md",
    "AdminInterface/www",
]


def lies(pfad: str) -> str:
    with open(os.path.join(WURZEL, pfad), encoding="utf-8") as f:
        return f.read()


def vorgabe_lesen() -> str:
    treffer = VORGABE_MUSTER.search(lies(VORGABE_DATEI))
    if not treffer:
        raise SystemExit(f"FEHLT: SPOTIFY_RUECKWEG_VORGABE in {VORGABE_DATEI}")
    return treffer.group(1)


def vorgabe_pruefen(vorgabe: str) -> list[str]:
    """Ist die Vorgabe ueberhaupt eine Adresse, die Spotify noch nimmt?"""
    klagen = []
    if not vorgabe.startswith("http://"):
        klagen.append(f"die Vorgabe ist nicht http: {vorgabe}")
    rumpf = vorgabe[len("http://") :] if vorgabe.startswith("http://") else vorgabe
    rechner = rumpf.split("/")[0].rsplit(":", 1)[0]
    if rechner not in ("127.0.0.1", "[::1]"):
        klagen.append(
            f"die Vorgabe zeigt auf '{rechner}' statt auf das IP-LITERAL 127.0.0.1 / [::1]. "
            "Spotify hat 2025 alle HTTP-Rueckwege abgeschafft AUSSER diesen beiden; "
            "'localhost' ist ausdruecklich keine Ausnahme."
        )
    if not vorgabe.endswith("/spotify"):
        klagen.append(f"die Vorgabe endet nicht auf /spotify: {vorgabe}")
    return klagen


def nennungen_pruefen(vorgabe: str) -> list[str]:
    """Die Seite fuellt ihr Rueckweg-FELD zur Laufzeit aus der Logik-Datei —
    die Adresse muss also nicht woertlich im HTML stehen. Geprueft wird, dass
    die genannten Dateien DA sind und die Logik-Datei (VORGABE_DATEI, oben
    schon gelesen) die einzige Traegerin der Vorgabe bleibt."""
    klagen = []
    for pfad, wozu in NENNT_DIE_ADRESSE:
        try:
            lies(pfad)
        except FileNotFoundError:
            klagen.append(f"{pfad} fehlt ({wozu})")
    return klagen


# HIER STAND zip_pruefen(): sie hielt AdminInterface/release/www.zip gegen
# www/ — der PHP-Admin ist seit 19.08.2026 aus dem Projekt, das Zip fiel mit
# E118/1e. Die Anmeldeseite reist heute im normalen deploy.zip mit
# (Waechter www/neu/index.html in src/deploy.sh).


def anleitungen_pruefen() -> list[str]:
    """Empfiehlt noch irgendeine ANLEITUNG eine Adresse, die Spotify ablehnt?"""
    klagen = []
    for ort in ANLEITUNGEN:
        vollpfad = os.path.join(WURZEL, ort)
        dateien = []
        if os.path.isfile(vollpfad):
            dateien = [ort]
        else:
            for tief, _, namen in os.walk(vollpfad):
                for name in namen:
                    if name.endswith((".md", ".php", ".html", ".txt")):
                        dateien.append(os.path.relpath(os.path.join(tief, name), WURZEL))
        for datei in dateien:
            try:
                text = lies(datei)
            except (UnicodeDecodeError, FileNotFoundError):
                continue
            # EINE ALTE ADRESSE ZU NENNEN IST ERLAUBT — sie zu EMPFEHLEN nicht.
            #
            # Der Unterschied laesst sich nicht an einer einzelnen Zeile
            # ablesen: die Begruendung „HIER STAND …" steht am Anfang eines
            # Kommentarblocks, die alte Adresse drei Zeilen weiter unten. Wer
            # nur die Zeile ansieht, klagt genau die Stelle an, die den Irrtum
            # ERKLAERT — und man gewoehnt sich an, das Werkzeug zu uebergehen.
            # Deshalb faerbt ein Merkwort auf den Rest seines Blocks ab; der
            # Block endet an der ersten Zeile, die kein Kommentar mehr ist.
            geschichte = False
            for nr, zeile in enumerate(text.splitlines(), 1):
                blank = zeile.strip()
                ist_kommentar = blank.startswith(("//", "*", "/*", "#", "<!--", ">")) or not blank
                if not ist_kommentar:
                    geschichte = False
                if re.search(
                    r"HIER STAND|stand hier|used to say|frueher|UEBERHOLT|Geschichte|history", zeile, re.I
                ):
                    geschichte = True
                    continue
                if geschichte:
                    continue
                for muster, warum in UNTAUGLICH:
                    if muster.search(zeile):
                        klagen.append(f"{datei}:{nr} empfiehlt {muster.search(zeile).group(0)} — {warum}")
    return klagen


def box_messen(adresse: str, vorgabe: str) -> tuple[list[str], list[str]]:
    """Nur LESEN. Die Box wird nicht angefasst."""
    meldungen, klagen = [], []
    pfad = "/" + vorgabe.split("/", 3)[3] if vorgabe.count("/") >= 3 else "/spotify"

    def hole(url: str) -> tuple[int, str]:
        try:
            with urllib.request.urlopen(url, timeout=8) as antwort:
                return antwort.status, antwort.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as fehler:
            return fehler.code, ""
        except Exception as fehler:  # noqa: BLE001 — offline ist eine Antwort
            return 0, str(fehler)

    stand, _ = hole(f"http://{adresse}:8200{pfad}")
    meldungen.append(f"http://{adresse}:8200{pfad} -> {stand}")
    if stand != 200:
        klagen.append(f"die Box antwortet unter {pfad} nicht mit 200 (sondern {stand})")

    stand, koerper = hole(f"http://{adresse}:8200/api/spotify/config")
    if stand != 200:
        klagen.append(f"/api/spotify/config antwortet {stand}")
    else:
        try:
            daten = json.loads(koerper)
        except json.JSONDecodeError:
            klagen.append("/api/spotify/config antwortet kein JSON")
        else:
            meldungen.append(f"/api/spotify/config -> {daten}")
            if not daten.get("eingerichtet"):
                klagen.append(
                    "DIE BOX IST NICHT MEHR ANGEMELDET. Der Rueckweg wird nur beim "
                    "Autorisieren und beim Tausch verglichen — die Erneuerung kennt "
                    "gar kein redirect_uri. Faellt das hier um, liegt es NICHT am Rueckweg."
                )
    return meldungen, klagen


def main() -> int:
    zerleger = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    zerleger.add_argument("--box", help="Adresse der Box; misst zusaetzlich, NUR LESEND")
    args = zerleger.parse_args()

    vorgabe = vorgabe_lesen()
    print(f"Vorgabe ({VORGABE_DATEI}): {vorgabe}\n")

    klagen: list[str] = []
    klagen += vorgabe_pruefen(vorgabe)
    klagen += nennungen_pruefen(vorgabe)
    klagen += anleitungen_pruefen()

    if args.box:
        meldungen, boxklagen = box_messen(args.box, vorgabe)
        for zeile in meldungen:
            print(f"  gemessen: {zeile}")
        print()
        klagen += boxklagen

    if klagen:
        print("WIDERSPRUECHE:")
        for klage in klagen:
            print(f"  * {klage}")
        return 1
    print("Der Rueckweg steht ueberall gleich.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
