#!/usr/bin/env python3
"""BESCHRIFTUNGEN-DECKUNG — heisst der Knopf so, und steht er dort, wo die Doku hinschickt?

WARUM ES DAS GIBT (23.08.2026): in `tools/doku-luecken-probe.sh` standen
DREIZEHN Wachen, und alle dreizehn fragen in dieselbe Richtung — steht ein
Name aus dem CODE irgendwo in einem Handbuch? Die letzte hinzugekommene
(`doku-pfade-pruefen.py`) drehte das immerhin um und fragte, ob es die Datei
noch gibt, auf die die Doku zeigt. Keine fragte, ob es den KNOPF gibt, den die
Doku in Anfuehrungszeichen zitiert — und ob er auf der Oberflaeche sitzt, die
im selben Satz genannt wird.

Der Unterschied ist teuer, und er ist teurer als eine fehlende Zeile. Wer eine
Seite im Handbuch vermisst, merkt es sofort. Wer der Anweisung folgt

    „In der Verwaltung: Streaming-Dienste → Spotify → ,Ton anmelden' →
     ,Code anzeigen'."

sucht dagegen in der Verwaltung nach zwei Knoepfen, die es dort nicht gibt.
Beide Beschriftungen sind ECHT — sie stehen in `frontend-box`, auf dem
Bildschirm der Box selbst. In der Verwaltung heisst derselbe Knopf
`Code holen`. Gemessen am 23.08.2026 traf das DREI Stellen im
Benutzerhandbuch, alle nach demselben Muster: ein Ablauf der BOX-Oberflaeche,
der der VERWALTUNG zugeschrieben wird (Spotify-Anmeldung zweimal, das
Zuruecksetzen mitgelieferter Themen einmal).

Genau diese Sorte kommt durch jede Namenspruefung: die Woerter stehen im Baum,
nur eben in `src/frontend-box`. Und sie kommt auch durch die Widerruf-Probe,
denn widerrufen wurde nichts — die Aussage war nie richtig.

WOHER DIE FRAGE „WELCHE OBERFLAECHE?" KOMMT, und warum das keine zweite
Handpflege ist: die Menuepunkte der Verwaltung werden aus `rahmen.ts` gelesen
(dieselbe Quelle, die die Seitenpruefung in der Luecken-Probe benutzt). Nennt
der Absatz um ein Zitat herum einen dieser Menuepunkte, ist das Zitat eine
Aussage ueber die VERWALTUNG — dann muss die Beschriftung in
`src/frontend-admin` stehen und nicht bloss irgendwo im Baum. Steht sie nur in
`src/frontend-box`, meldet die Wache OBERFLAECHE; steht sie nirgends, ERFUNDEN.

Zitate ohne Menuepunkt im Absatz werden NICHT geprueft. Das ist Absicht: das
Handbuch zitiert auch Schalterstellungen der Platine („Akku benutzen"),
Ausgaben fremder Werkzeuge („Paired: no") und blosse Beispielsaetze. Eine
Wache, die die einfordert, meldet ewig rot und wird zu Recht ignoriert —
dieselbe Falle wie `RECHTE` im Benutzerhandbuch, siehe Luecken-Probe.

Die AUSNAHMEN unten sind der Rest, den diese Regel nicht wegnimmt: Zitate, die
zufaellig in einem Absatz mit Menuepunkt stehen und trotzdem keine
Beschriftung sind. Jede traegt ihren Grund. Eine Ausnahme, auf die kein Zitat
mehr passt, wird GEMELDET statt still mitgeschleppt — sonst deckt sie
irgendwann eine echte Luecke zu.

Aufruf aus dem Wurzelverzeichnis:  python3 tools/beschriftungen-deckung.py
Rueckgabe: 0 = keine Luecke, 1 = mindestens eine.
"""

import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
BENUTZER = WURZEL / "dokumentation/benutzerhandbuch.html"
RAHMEN = WURZEL / "src/frontend-admin/src/app/rahmen.ts"
ADMIN = (WURZEL / "src/frontend-admin/src",)
# DIE BOX-OBERFLAECHE SIND ZWEI ORTE, und der zweite fehlte bis zum
# 31.08.2026: `NewDesign/` ist die NEUE Oberflaeche der Box — genau die, die
# ein Kind und ein Elternteil heute vor sich haben. Solange nur
# `src/frontend-box/src` durchsucht wurde, meldete diese Wache jede dort
# zitierte Beschriftung als ERFUNDEN, also als schlimmsten ihrer drei
# Befunde: „gibt es in keiner Oberflaeche". Aufgefallen am 31.08.2026 beim
# Eintragen der zwei Groessen-Regler (E113) — die Zeilen stehen am Schirm,
# die Wache konnte sie nur nicht sehen.
# Seit E118/1e gibt es nur die neue Oberflaeche.
BOX = (WURZEL / "NewDesign",)
# `.js` GEHOERT DAZU, SEIT NewDesign MITGESUCHT WIRD: die neue Oberflaeche ist
# eine einzelne Browser-Datei ohne Angular. Der Ordner ist EINGEGRENZT — nicht
# `src/frontend-box/www`, wo das Kompilat derselben Datei liegt; ein Fund im
# Kompilat waere keine Gegenstelle, sondern dieselbe Aussage zweimal.
# `.mjs` SEIT DEM THEME-GESTALTER (E144, 27.09.2026): er liegt als ES-Module
# unter `NewDesign/gestalter/`, und seine Beschriftungen („Grundfarbe",
# „Fläche" in katalog.mjs) meldete die Wache als ERFUNDEN — sie stehen am
# Schirm, die Wache las die Endung nur nicht.
# DIE HANDY-APP IST DIE DRITTE OBERFLAECHE (28.09.2026). Seit sie Kinderzeit,
# Sperre und Sicherung kann, zitiert das Handbuch ihre Knoepfe („Für Mo–Fr",
# „Alle Kinder") — und diese Wache meldete sie als ERFUNDEN, weil sie nur
# Verwaltung und Box kannte. Die Absaetze nennen dabei regelmaessig einen
# Menuepunkt der Verwaltung als WORT („Sicherung"), obwohl der Weg durch die
# App fuehrt; ohne eigene Sorte schlug die Wache sie der Verwaltung zu.
HANDY = (WURZEL / "handy-app/lib",)
ENDUNGEN = {".ts", ".html", ".js", ".mjs", ".dart"}

# Zitate, die in einem Absatz mit Menuepunkt stehen und trotzdem keine
# Beschriftung der Verwaltung sind. Der Wert ist der Grund — er steht hier,
# damit der naechste Leser nicht raten muss, ob die Zeile noch stimmt.
AUSNAHMEN = {
    "Kinderzeit": "der ALTE Name der Seite Profile, im Satz ausdruecklich als historisch ausgewiesen",
    "heute 15 Minuten mehr": "Beispiel fuer eine Bonusminuten-Eingabe, keine Beschriftung",
    "Paired: no": "Ausgabe von bluetoothctl auf der Schale, nicht der Verwaltung",
    "USB-C mode (no battery)": "Aufdruck neben Schalter SW2 auf der MuPiHAT-Platine",
}

# Wendungen, mit denen das Handbuch von der Verwaltung auf den Bildschirm der
# Box selbst umschwenkt. Ein Absatz nennt regelmaessig BEIDE Oberflaechen
# ("In der Verwaltung: … An der Box selbst führt derselbe Weg über …"), und
# eine Wache, die den ganzen Absatz der Verwaltung zuschlaegt, meldet den
# richtig geschriebenen zweiten Halbsatz als Fehler.
# „Oberfläche der Box" SEIT DEM GESTALTER (27.09.2026): sein Absatz nennt den
# Weg über die Darstellungsseite und beschreibt DANACH „die echte Oberfläche
# der Box als Vorschau" samt ihrer Knöpfe — ohne die Wendung schlug die Wache
# die Knöpfe des Gestalters der Verwaltung zu.
BOX_MARKER = ("an der Box selbst", "auf der Box selbst", "Box-Oberfläche", "an der Box unter", "Oberfläche der Box")
# Und die Wendungen, mit denen es auf die Handy-App umschwenkt — nach derselben
# Regel: der naechste Vorgaenger vor dem Zitat bestimmt die Oberflaeche.
HANDY_MARKER = ("Handy-App", "in der App", "die App ")

luecken: list[str] = []


def menuepunkte() -> list[str]:
    """Die Beschriftungen der Kopfleiste — dieselbe Quelle wie in der Luecken-Probe."""
    text = RAHMEN.read_text(encoding="utf-8")
    return sorted(set(re.findall(r'<a routerLink="/[^"]+"[^>]*>([^<]+)</a>', text)))


def absaetze() -> list[str]:
    """Das Handbuch in Bloecke, in denen ein Zitat und sein Menuepunkt beieinander stehen.

    GESCHNITTEN AN <p>/<li>/<td> UND NICHT AM SATZPUNKT: die Wege stehen im
    Handbuch regelmaessig eine Zeile ueber dem Zitat („Server finden:
    Streaming-Dienste → Jellyfin → Serveradresse → ,Im Netz suchen'"), und ein
    Schnitt am Punkt haette den Menuepunkt vom Zitat getrennt. Dann faende die
    Wache nichts und meldete gruen, weil sie nichts geprueft hat.
    """
    text = BENUTZER.read_text(encoding="utf-8")
    roh = re.split(r"</?(?:p|li|td|div|h[1-6])\b[^>]*>", text)
    return [re.sub(r"<[^>]*>", "", stueck) for stueck in roh]


def ist_beschriftung(zeile: str, beschriftung: str) -> bool:
    """Steht der Text auf dieser Zeile als BESCHRIFTUNG und nicht als Fliesstext?

    WARUM DAS NOETIG IST: die erste Fassung suchte den blossen Teilstring und
    winkte „Original" durch — das Wort steht in `verschmelzung.ts` mitten in
    einem Erklaersatz („heissen genauso wie das Original"). Der Knopf
    `Original` gibt es nur auf der Box, und genau den sollte die Wache melden.
    Eine Wache, die an gewoehnlichen deutschen Woertern blind wird, ist an den
    kurzen Beschriftungen — und das sind die haeufigen — wertlos.

    ZWEI FORMEN, weil Angular-Vorlagen beide benutzen: der Text steht allein
    auf seiner Zeile (mehrzeiliges `<ion-button>`), oder er ist auf der Zeile
    von Zeichen umschlossen, die kein Fliesstext hat (`>Original<`,
    `: 'Code holen' }}`).
    """
    if zeile.strip() == beschriftung:
        return True
    muster = re.escape(beschriftung)
    return re.search(rf"[>'\"`]\s*{muster}\s*[<'\"`]", zeile) is not None


def steht_in(orte: tuple[Path, ...], beschriftung: str) -> bool:
    """Kommt die Beschriftung als Bedienelement dieser Oberflaeche vor?

    EINE OBERFLAECHE KANN AUS MEHREREN ORDNERN BESTEHEN — die Box hat seit dem
    Umbau zwei (siehe BOX). Deshalb eine Liste und kein einzelner Pfad.

    WOERTLICH UND MIT GROSSSCHREIBUNG: `Im Netz suchen` gegen
    `Jellyfin im Netz suchen` ist genau der Fall, den diese Wache melden soll —
    das Handbuch kuerzt die Beschriftung, und wer im Bild danach sucht, findet
    sie nicht auf Anhieb. Ein `casefold()` haette ihn verschluckt.
    """
    for ordner in orte:
        if not ordner.is_dir():
            continue
        for datei in ordner.rglob("*"):
            if datei.suffix not in ENDUNGEN or not datei.is_file():
                continue
            text = datei.read_text(encoding="utf-8", errors="ignore")
            if beschriftung not in text:
                continue
            for zeile in text.splitlines():
                if beschriftung in zeile and ist_beschriftung(zeile, beschriftung):
                    return True
    return False


def main() -> int:
    for pfad in (BENUTZER, RAHMEN):
        if not pfad.is_file():
            print(f"  WARNUNG: {pfad.relative_to(WURZEL)} nicht gefunden — umgezogen?")
            return 1

    punkte = menuepunkte()
    if not punkte:
        print("  WARNUNG: keine Menuepunkte in rahmen.ts gefunden — Schreibweise geaendert?")
        return 1

    gepruefte = 0
    benutzte_ausnahmen: set[str] = set()

    for block in absaetze():
        genannt = [p for p in punkte if p in block]
        if not genannt:
            continue
        weg = " → ".join(genannt)
        for treffer in re.finditer(r"„([^“]{3,60})“", block):
            zitat = treffer.group(1)
            if zitat in AUSNAHMEN:
                benutzte_ausnahmen.add(zitat)
                continue
            # NAECHSTER VORGAENGER GEWINNT: was zuletzt VOR dem Zitat genannt
            # wurde — ein Menuepunkt oder die Box — bestimmt die Oberflaeche.
            # Eine Ja/Nein-Frage an den ganzen Absatz kann das nicht: derselbe
            # Absatz beschreibt beide Wege nacheinander.
            # KLEINGESCHRIEBEN VERGLICHEN, weil dieselbe Wendung mal am
            # Satzanfang steht ("An der Box selbst …") und mal mitten drin.
            davor = block[: treffer.start()]
            klein = davor.casefold()
            bis_box = max((klein.rfind(m.casefold()) for m in BOX_MARKER), default=-1)
            # ZITATE ZAEHLEN NICHT ALS WEGWEISER: „Ton anmelden" enthaelt den
            # Menuepunkt `Ton`, ist aber eine Beschriftung und kein Weg. Ohne
            # dieses Ausblenden kippte der zweite Halbsatz eines Absatzes
            # zurueck auf „Verwaltung", sobald das erste Zitat zufaellig einen
            # Menuenamen enthielt.
            # LAENGENTREU ersetzt, nicht geloescht: die beiden Fundstellen
            # werden gegeneinander gehalten, und ein Verrutschen der Zaehlung
            # waere ein stiller Fehler.
            ohne_zitate = re.sub(r"„[^“]*“", lambda t: " " * len(t.group(0)), davor)
            bis_menue = max((ohne_zitate.rfind(p) for p in genannt), default=-1)
            bis_handy = max((klein.rfind(m.casefold()) for m in HANDY_MARKER), default=-1)
            # Bei Gleichstand gewinnt die Verwaltung — wie vor der dritten Sorte.
            kandidaten = [(bis_menue, 2, ADMIN, "Verwaltung"), (bis_box, 1, BOX, "Box-Oberflaeche"), (bis_handy, 0, HANDY, "Handy-App")]
            _, _, wo, gegen = max(kandidaten, key=lambda k: (k[0], k[1]))
            gepruefte += 1
            if steht_in(wo, zitat):
                continue
            anderswo = [name for _, _, orte, name in kandidaten if orte is not wo and steht_in(orte, zitat)]
            if anderswo:
                luecken.append(
                    f"  OBERFLAECHE: „{zitat}“ gibt es nicht in der {gegen}, "
                    f"sondern in: {', '.join(anderswo)} ({weg})"
                )
            else:
                luecken.append(
                    f"  ERFUNDEN: „{zitat}“ gibt es in keiner Oberflaeche "
                    f"(Absatz nennt {weg})"
                )

    if gepruefte == 0:
        print("  WARNUNG: kein einziges Zitat geprueft — Anfuehrungszeichen geaendert?")
        return 1

    for zitat in sorted(set(AUSNAHMEN) - benutzte_ausnahmen):
        luecken.append(
            f"  TOTE AUSNAHME: „{zitat}“ steht in AUSNAHMEN, kommt aber "
            f"in keinem geprueften Absatz mehr vor — Zeile streichen"
        )

    print(f"── Zitierte Beschriftungen im Benutzerhandbuch ({gepruefte} geprueft) ──")
    for zeile in luecken:
        print(zeile)
    if not luecken:
        print("  KEINE LUECKE.")
        return 0
    print(f"\n{len(luecken)} LUECKE(N).")
    return 1


if __name__ == "__main__":
    sys.exit(main())
