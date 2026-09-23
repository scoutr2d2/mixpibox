#!/usr/bin/env python3
"""Deckt auf, wenn die APT-Paketlisten der beiden Ausrollwege auseinanderlaufen.

WOFUER
Es gibt zwei Wege auf eine Box, und jeder fuehrt seine eigene Paketliste von
Hand ([[zwei-ausrollwege-eine-handgefuehrte-liste]], dort in der Datei-Form):

    autosetup/autosetup.sh          der Erstweg   — die frische SD-Karte
    update/start_mupibox_update.sh  der Update-Weg — die Box im Haus

Am 24.08.2026 wurde die erste Abweichung aufgeschrieben (AUDIT-2026-08-24:
`python3-rpi-lgpio` hier, `python3-rpi.gpio` dort). Am 19.09.2026 stand sie
noch da und wurde ein ZWEITES Mal von Hand gefunden — inzwischen um eine
zweite Abweichung reicher (`wireguard-tools` fehlte dem Update-Weg ganz, der
VPN-Heimweg E30 kann ohne das Paket auf keiner Bestandsbox laufen). Derselbe
Befund in zwei Laeufen heisst: die Wache fehlt, nicht der Leser
([[wiederkehrender-befund-ist-ein-ablauffehler]]).

Die Fehlerklasse ist NICHT "ein Paket fehlt". Sie ist:
FUNKTIONIERT AUF FRISCHEN KARTEN, BRICHT AUF GEPFLEGTEN BOXEN — und umgekehrt.
Beide Wege sind fuer sich gruen, niemand vergleicht sie, und auffallen wuerde
es erst an einem Geraet: auf dem Pi 5 als toter Taster/Luefter, beim VPN als
Seite, die nur "Werkzeug fehlt" sagt.

WAS GEPRUEFT WIRD (fuenf Fragen, jede einzeln rot)
  1. Hauptliste       `packages2install` — dieselben Pakete auf beiden Wegen?
  2. Tonstapel        `AUDIO_PAKETE` — alle Zweige zusammengenommen
  3. Zweig-Listen     `for package in <literale>` (der bullseye/else-Zweig)
  4. pip-Liste        `pip install <paket>`
  5. Richtung         die `packages2remove`-Schleife des Update-Wegs muss
                      `-gt 0` pruefen (entfernen, was DA IST) und darf NICHT
                      dieselbe Bedingung tragen wie die Install-Schleife
  6. Keine zweite Zuweisung an `packages2install` in einem Zweig — die
                      globale Liste ueberschrieben ist eine gestellte Falle

Nummer 5 und 6 stehen hier, weil sie zur selben Stelle gehoeren und sonst
niemand sie bewacht: Die Entfernen-Schleife war von der Install-Schleife
KOPIERT, ohne die Richtung zu drehen, und hat deshalb seit ihrem Entstehen nie
etwas entfernt (Nachbau des Beweises: der Zweig `-eq 0` ruft `apt-get remove`
ausgerechnet fuer Pakete, die gar nicht installiert sind).

WARUM NICHT EINE EINZIGE LISTE IN `config/pakete.liste`?
Das waere die bessere Bauart und ist geprueft worden — sie geht heute NICHT: der
Update-Weg installiert seine Pakete in den Schleifen bei Zeile 548/581, holt und
entpackt den Quellbaum aber erst bei Zeile 684/693. Eine Liste IM Archiv liegt
zum Zeitpunkt des `apt-get install` noch nicht auf der Platte. Es braeuchte also
entweder den ganzen Paketblock hinter das Entpacken (eine Umstellung der
Update-Reihenfolge, samt 64-Bit-Tor und „Prepare Update") oder eine dritte
Kopie der Liste. Solange beide Listen von Hand gefuehrt werden, gehoert der
Vergleich in die Pruefbatterie — genau die Begruendung, die
[[zwei-ausrollwege-eine-handgefuehrte-liste]] fuer die Dateien schon traegt.

WAS DIESES WERKZEUG NICHT SIEHT — und wo also weiter von Hand gelesen wird:
`dietpi-software`-Nummern, npm-Globals, Node selbst, die Rezepte des
remote-step-installers und alles, was ein Skript unter scripts/ nachinstalliert.

AUSNAHMEN VERROTTEN — deshalb tragen sie hier einen Anker (`gilt_solange`):
Faellt der Grund weg (z. B. der PulseAudio-Zweig des Update-Wegs), meldet das
Werkzeug die Ausnahme selbst als verrottet und wird rot. Eine Ausnahme ohne
lebenden Grund ist eine Luege, die genau einmal hilft
([[dauerrote-wache-ist-keine]] von der anderen Seite).

AUFRUF
    python3 tools/paketlisten-deckung.py           Bericht, Rueckgabe 1 bei Befund
    python3 tools/paketlisten-deckung.py --leise   nur die Bilanzzeile
Haengt in tools/pruefen.sh ("Paketlisten-Deckung"), neben der Ausrollweg-Deckung.
"""

import argparse
import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
ERSTWEG = WURZEL / "autosetup" / "autosetup.sh"
UPDATEWEG = WURZEL / "update" / "start_mupibox_update.sh"
SEITEN = {"erstweg": ERSTWEG, "updateweg": UPDATEWEG}

# ── Ausnahmen: Paket, Seite, Grund, und der Anker, der den Grund belegt ──────
# Ohne lebenden Anker ist die Ausnahme verrottet und das Werkzeug wird rot.
AUSNAHMEN: list[dict] = [
    {
        "frage": "Tonstapel",
        "paket": "pulseaudio-module-bluetooth",
        "seite": "updateweg",
        "grund": (
            "Der Update-Weg traegt einen PulseAudio-Zweig fuer Boxen, die noch "
            "nicht auf PipeWire stehen; der Umstieg ist eine Entscheidung fuer "
            "die FRISCHE Karte. autosetup.sh kennt darum nur den PipeWire-Satz."
        ),
        "gilt_solange": (UPDATEWEG, r'AUDIO_STAPEL="pulseaudio"'),
    },
]


def text(datei: Path) -> str:
    if not datei.exists():
        # Kein stilles Gruen, wenn der Gegenstand fehlt: eine umbenannte Datei
        # ist ein Befund, keine Abwesenheit von Befunden.
        sys.exit(f"FEHLT: {datei} — die Wache hat ihren Gegenstand verloren.")
    return datei.read_text(encoding="utf-8", errors="replace")


ZUWEISUNG = r'^[^\S\n]*{name}="([^"]*)"'
FOR_LISTE = re.compile(r"^[^\S\n]*for\s+package\s+in\s+(.+?)$", re.M)
PIP = re.compile(r"^[^\S\n]*pip\s+install\s+([^\s|>]+)", re.M)


def zuweisungen(inhalt: str, name: str) -> list[list[str]]:
    """Alle Zuweisungen an <name>, jede als Wortliste (Reihenfolge erhalten)."""
    muster = re.compile(ZUWEISUNG.format(name=name), re.M)
    return [m.group(1).split() for m in muster.finditer(inhalt)]


def literale_for_listen(inhalt: str) -> list[str]:
    """`for package in a b c` — Variablen (`${...}`) zaehlen NICHT mit."""
    gefunden: list[str] = []
    for m in FOR_LISTE.finditer(inhalt):
        rest = m.group(1).split(";")[0]
        worte = [w for w in rest.split() if w not in ("do",)]
        if any("$" in w for w in worte):
            continue
        gefunden.extend(worte)
    return gefunden


def pip_pakete(inhalt: str) -> list[str]:
    return [p for p in PIP.findall(inhalt) if not p.startswith("-")]


def ausnahme(frage: str, paket: str, seite: str) -> dict | None:
    for a in AUSNAHMEN:
        if a["frage"] == frage and a["paket"] == paket and a["seite"] == seite:
            return a
    return None


class Bericht:
    def __init__(self, leise: bool) -> None:
        self.leise = leise
        self.befunde: list[str] = []

    def sag(self, zeile: str = "") -> None:
        if not self.leise:
            print(zeile)

    def befund(self, zeile: str) -> None:
        self.befunde.append(zeile)
        self.sag(f"  FEHL {zeile}")

    def gut(self, zeile: str) -> None:
        self.sag(f"  ok   {zeile}")


def vergleiche(b: Bericht, frage: str, links: list[str], rechts: list[str]) -> None:
    """Mengenvergleich beider Wege fuer EINE Frage, Ausnahmen benannt."""
    b.sag(f"── {frage}")
    if not links or not rechts:
        # Anker weg: die Liste, an der wir messen, gibt es nicht mehr.
        b.befund(
            f"{frage}: Liste nicht gefunden "
            f"(erstweg {len(links)} Pakete, updateweg {len(rechts)}) — "
            "Muster stimmt nicht mehr, hier wird NICHT stillschweigend gruen gemeldet"
        )
        return
    for seite, fehlt_in, menge in (
        ("erstweg", "updateweg", set(links) - set(rechts)),
        ("updateweg", "erstweg", set(rechts) - set(links)),
    ):
        for paket in sorted(menge):
            a = ausnahme(frage, paket, seite)
            if a:
                b.gut(f"{paket}: nur im {seite} — bekannt ({a['grund'].split('.')[0]}.)")
            else:
                b.befund(
                    f"{paket}: steht im {seite}, fehlt im {fehlt_in} "
                    f"({frage}) — angleichen oder als Ausnahme mit Grund eintragen"
                )
    if set(links) == set(rechts):
        b.gut(f"{len(links)} Pakete, beide Wege gleich")


def pruefe_ausnahmen_leben(b: Bericht) -> None:
    b.sag("── Ausnahmen noch begruendet?")
    if not AUSNAHMEN:
        b.gut("keine Ausnahmen eingetragen")
        return
    for a in AUSNAHMEN:
        datei, muster = a["gilt_solange"]
        if re.search(muster, text(datei)):
            b.gut(f"{a['paket']}: Grund belegt durch /{muster}/ in {datei.name}")
        else:
            b.befund(
                f"{a['paket']}: Ausnahme VERROTTET — der Anker /{muster}/ steht "
                f"nicht mehr in {datei.name}; Ausnahme streichen oder neu begruenden"
            )


def pruefe_entfernen_richtung(b: Bericht) -> None:
    """Die Entfernen-Schleife muss die UMGEKEHRTE Bedingung der Install-Schleife
    tragen. Genau das ging beim Kopieren verloren."""
    b.sag("── Richtung der Entfernen-Schleife (Update-Weg)")
    inhalt = text(UPDATEWEG)
    bedingungen = {}
    for schleife, art in (("packages2install", "install"), ("packages2remove", "remove")):
        block = re.search(
            r"for\s+package\s+in\s+\$\{" + schleife + r"\}(.*?)\bdone\b",
            inhalt,
            re.S,
        )
        if not block:
            b.befund(
                f"Schleife ueber ${{{schleife}}} nicht gefunden — "
                "umbenannt oder entfallen; diese Wache misst dann nichts"
            )
            return
        treffer = re.search(r"\$\{PKG_OK\}\s+(-\w\w)\s+0", block.group(1))
        if not treffer:
            b.befund(f"{art}-Schleife: keine PKG_OK-Bedingung gefunden")
            return
        bedingungen[art] = treffer.group(1)
    if bedingungen.get("remove") != "-gt":
        b.befund(
            f"Entfernen-Schleife prueft `{bedingungen.get('remove')} 0` statt `-gt 0` — "
            "so entfernt sie NUR, was gar nicht installiert ist, also nie etwas"
        )
    elif bedingungen["install"] == bedingungen["remove"]:
        b.befund(
            "Install- und Entfernen-Schleife tragen dieselbe Bedingung "
            f"`{bedingungen['install']} 0` — eine der beiden geht in die falsche Richtung"
        )
    else:
        b.gut(
            f"install prueft `{bedingungen['install']} 0`, "
            f"remove prueft `{bedingungen['remove']} 0` — Richtungen getrennt"
        )


def pruefe_einmalige_liste(b: Bericht) -> None:
    b.sag("── Globale Liste nicht in einem Zweig ueberschrieben")
    for name, datei in SEITEN.items():
        anzahl = len(zuweisungen(text(datei), "packages2install"))
        if anzahl == 0:
            b.befund(f"{name}: keine Zuweisung an packages2install gefunden — Anker weg")
        elif anzahl > 1:
            b.befund(
                f"{name}: {anzahl} Zuweisungen an packages2install — eine davon "
                "ueberschreibt die globale Liste (Liste in den Schleifenkopf schreiben, "
                "autosetup.sh zeigt die Form)"
            )
        else:
            b.gut(f"{name}: genau eine Zuweisung")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--leise", action="store_true", help="nur die Bilanzzeile")
    args = p.parse_args()

    b = Bericht(args.leise)
    erst, update = text(ERSTWEG), text(UPDATEWEG)

    haupt_e = zuweisungen(erst, "packages2install")
    haupt_u = zuweisungen(update, "packages2install")
    vergleiche(
        b,
        "Hauptliste",
        haupt_e[0] if haupt_e else [],
        haupt_u[0] if haupt_u else [],
    )

    ton_e = [p for liste in zuweisungen(erst, "AUDIO_PAKETE") for p in liste]
    ton_u = [p for liste in zuweisungen(update, "AUDIO_PAKETE") for p in liste]
    vergleiche(b, "Tonstapel", ton_e, ton_u)

    vergleiche(b, "Zweig-Listen", literale_for_listen(erst), literale_for_listen(update))
    vergleiche(b, "pip-Liste", pip_pakete(erst), pip_pakete(update))

    pruefe_ausnahmen_leben(b)
    pruefe_entfernen_richtung(b)
    pruefe_einmalige_liste(b)

    b.sag()
    if b.befunde:
        print(f"{len(b.befunde)} ABWEICHUNG(EN).")
        return 1
    print("Beide Paketlisten decken sich.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
