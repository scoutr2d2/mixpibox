#!/usr/bin/env python3
"""HANDBUCH-ORT-DECKUNG — steht der Knopf auf DER SEITE, die der Weg nennt?

WARUM ES DAS GIBT (29.08.2026, stuendlicher Doku-Lauf): das Benutzerhandbuch
schickte den Betreiber fuer Suche und Aufnahme des Internet Archive nach

    Verwaltung → Plugins → Internet Archive

und zaehlte darunter zwei Schritte auf: „Suchbegriff eintippen und auf
**Suchen** klicken", „auf **Aufnehmen** klicken". Beide Knoepfe gibt es —
aber auf `Verwaltung → Medien`, im Abschnitt „Internet Archive"
(`seiten/medien.ts`). Die Plugin-Unterseite (`seiten/plugin-eine.ts`) zeichnet
ausschliesslich `Eingeschaltet`, `Warum es nicht laedt`, `Einstellungen` und
`Aktionen` aus dem Manifest; ein Suchfeld hat sie nie gehabt. Wer dem Handbuch
folgte, sass auf der richtigen Box vor der falschen Seite.

WARUM KEINE DER VIERZIG BESTEHENDEN WACHEN DAS FAND, und das ist der
eigentliche Fund: `tools/beschriftungen-deckung.py` prueft genau diese Sorte —
aber nur bis zur OBERFLAECHE. Es fragt „steht die Beschriftung in
`frontend-admin` oder bloss in `frontend-box`?". „Suchen" und „Aufnehmen"
stehen in `frontend-admin`, also meldete es gruen. Innerhalb der Verwaltung
kann es die Plugin-Unterseite nicht von der Medien-Seite unterscheiden. Ein
Befund traegt die Schicht, in der gemessen wurde: die Schwesterwache misst
OBERFLAECHE, diese misst SEITE.

WOHER DIE LISTE KOMMT (und warum das keine zweite Handpflege ist): die
Menuepunkte werden aus `rahmen.ts` gelesen, die Zuordnung Menuepunkt → Bauteil
aus `app.routes.ts` — dieselben zwei Quellen, die die Luecken-Probe schon
benutzt. Gepruefter Gegenstand ist die PROSA des Handbuchs; die Liste stammt
also nicht aus derselben Quelle wie ihr Gegenstand und ist nicht tautologisch.

WAS GEPRUEFT WIRD, eng gefasst: ein `<ol class="schritte">`, dessen
einleitender Absatz einen `<span class="pfad">` mit einem Menuepunkt der
Verwaltung traegt. Nur dort sind fett gesetzte Stellen verlaesslich
Bedienelemente — die uebrigen Schritt-Listen des Handbuchs beschreiben
Hardware-Montage und das Einbacken der Karte und tragen gar keinen Weg.

DIE RICHTUNG, und was sie ausdruecklich NICHT findet: gemeldet wird nur, was
ANDERSWO in der Verwaltung als Bedienelement existiert, aber nicht auf der
genannten Seite (ORT). Eine fett gesetzte Stelle, die NIRGENDS ein
Bedienelement ist, bleibt still — sie ist im Zweifel Betonung und keine
erfundene Beschriftung („weder Konto noch Server im Haus"). Erfundene
Beschriftungen sind der Gegenstand von `beschriftungen-deckung.py`, das dafuer
die Anfuehrungszeichen des Handbuchs liest. Bewusst wird hier NICHT nach
Wortzahl ausgeschlossen: ein Ausschluss ueber die Schreibweise ist keiner
ueber den Gegenstand (Wissenspaket: `wortzahl-ist-kein-ausschluss-ueber-den-
gegenstand`). Der Ausschluss lautet „ist anderswo ein Bedienelement", und das
ist am Baum gemessen, nicht geschaetzt.

Aufruf aus dem Wurzelverzeichnis:  python3 tools/handbuch-ort-deckung.py
Gegenprobe an einem alten Stand:   python3 tools/handbuch-ort-deckung.py --datei <pfad>
Rueckgabe: 0 = keine Luecke, 1 = mindestens eine.
"""

import argparse
import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
BENUTZER = WURZEL / "dokumentation/benutzerhandbuch.html"
RAHMEN = WURZEL / "src/frontend-admin/src/app/rahmen.ts"
ROUTEN = WURZEL / "src/frontend-admin/src/app/app.routes.ts"
SEITEN = WURZEL / "src/frontend-admin/src/app/seiten"

# Wege, die bewusst keine Seite der Verwaltung meinen. Jede traegt ihren Grund.
# Eine Ausnahme, auf die kein Weg mehr passt, wird GEMELDET statt still
# mitgeschleppt — sonst deckt sie irgendwann eine echte Luecke zu.
# Derzeit leer, und das ist gemessen: beim Bau war eine Ausnahme fuer den
# Box-Weg „Eltern-Bereich → Darstellung → Gesten" vorgesehen — die Wache meldete
# sie sofort als „Ausnahme ohne Fall". Sie stand in keiner Schritt-Liste, war
# also aus dem Kopf erfunden und nicht am Baum gemessen. Wege fremder
# Oberflaechen fallen ohnehin schon durch die Menuepunkt-Frage.
AUSNAHMEN: dict[str, str] = {}


def menuepunkte() -> dict[str, str]:
    """Menuepunkt → Weg, gelesen aus dem Rahmen der Verwaltung."""
    text = RAHMEN.read_text(encoding="utf-8")
    return {
        m.group(2).strip(): m.group(1)
        for m in re.finditer(r'<a\s+routerLink="([^"]+)"[^>]*>([^<]+)</a>', text)
    }


def bauteile() -> dict[str, Path]:
    """Weg → Datei des Bauteils, gelesen aus den Routen."""
    text = ROUTEN.read_text(encoding="utf-8")
    zu = {}
    for pfad, modul in re.findall(r"path:\s*'([^']*)'.*?import\('\./([^']+)'\)", text, re.S):
        datei = WURZEL / "src/frontend-admin/src/app" / (modul + ".ts")
        if datei.exists():
            zu.setdefault("/" + pfad, datei)
    return zu


def steuerungen(datei: Path) -> set[str]:
    """Die Bedienelemente EINER Seite: Knopfaufschriften, Feldnamen, Platzhalter."""
    if not datei.exists():
        return set()
    text = datei.read_text(encoding="utf-8")
    gefunden: set[str] = set()
    for roh in re.findall(r"<button[^>]*>(.*?)</button>", text, re.S):
        gefunden.add(roh)
    for roh in re.findall(r"<label[^>]*>(.*?)(?:<input|<select|</label>)", text, re.S):
        gefunden.add(roh)
    for roh in re.findall(r'placeholder="([^"]*)"', text):
        gefunden.add(roh)
    for roh in re.findall(r"<h2[^>]*>(.*?)</h2>", text, re.S):
        gefunden.add(roh)
    sauber = set()
    for roh in gefunden:
        # Bindungen und Interpolationen raus, dann die Tags.
        ohne = re.sub(r"\{\{.*?\}\}", " ", roh, flags=re.S)
        ohne = re.sub(r"<[^>]*>", " ", ohne)
        ohne = re.sub(r"@\w+[^{]*\{", " ", ohne)
        for stueck in re.split(r"[|·\n]", ohne):
            wort = " ".join(stueck.split()).strip(" :·—-").lower()
            if wort:
                sauber.add(wort)
    return sauber


def alle_steuerungen() -> dict[str, set[str]]:
    return {d.name: steuerungen(d) for d in sorted(SEITEN.glob("*.ts")) if not d.name.endswith(".spec.ts")}


def bloecke(html: str):
    """(Weg, fette Stellen) je Schritt-Liste, deren Absatz einen Weg nennt."""
    for m in re.finditer(r'<ol class="schritte">(.*?)</ol>', html, re.S):
        vorlauf = html[:m.start()]
        start = vorlauf.rfind("<p>")
        if start < 0:
            continue
        absatz = html[start:m.start()]
        weg = re.search(r'<span class="pfad">([^<]*)</span>', absatz)
        if not weg:
            continue
        fett = []
        for roh in re.findall(r"<strong>(.*?)</strong>", m.group(1), re.S):
            wort = " ".join(re.sub(r"<[^>]*>", "", roh).split()).strip(" :.,—-")
            if wort:
                fett.append(wort)
        yield weg.group(1).strip(), fett, html[:m.start()].count("\n") + 1


def main() -> int:
    zerteiler = argparse.ArgumentParser(add_help=True)
    zerteiler.add_argument("--datei", default=str(BENUTZER), help="Handbuch (fuer Gegenproben an alten Staenden)")
    args = zerteiler.parse_args()

    html = Path(args.datei).read_text(encoding="utf-8")
    menue = menuepunkte()
    routen = bauteile()
    seitenweise = alle_steuerungen()

    luecken: list[str] = []
    benutzte_ausnahmen: set[str] = set()

    for weg, fette, zeile in bloecke(html):
        stufen = [s.strip().strip("„“\"' ") for s in weg.split("→")]
        stufen = [s for s in stufen if s and s != "Verwaltung"]
        if not stufen:
            continue
        if weg in AUSNAHMEN:
            benutzte_ausnahmen.add(weg)
            continue
        kopf = stufen[0]
        if kopf not in menue:
            continue  # kein Weg der Verwaltung — nicht unser Gegenstand
        route = menue[kopf]
        ziel = routen.get(route)
        # Eine weitere Stufe hinter dem Menuepunkt heisst Unterseite, falls es
        # eine Kind-Route gibt (Plugins → <Name> ist `plugins/:kennung`).
        if len(stufen) > 1:
            for kandidat, datei in routen.items():
                if kandidat.startswith(route.rstrip("/") + "/:"):
                    ziel = datei
                    break
        if ziel is None:
            continue
        hier = steuerungen(ziel)
        for stelle in fette:
            klein = stelle.lower()
            if any(klein == k or klein in k for k in hier):
                continue
            anderswo = [
                name for name, menge in seitenweise.items()
                if name != ziel.name and any(klein == k or klein in k for k in menge)
            ]
            if anderswo:
                andere = ", ".join(anderswo)
                luecken.append(
                    f'  Zeile {zeile}: „{stelle}“ gibt es nicht auf {ziel.name} '
                    f'(Weg: {weg}) — sondern auf {andere}'
                )

    for weg, grund in AUSNAHMEN.items():
        if weg not in benutzte_ausnahmen:
            luecken.append(f'  Ausnahme ohne Fall: „{weg}“ ({grund}) — passt auf keinen Weg mehr, bitte streichen')

    print("── Knoepfe, die auf einer ANDEREN Verwaltungsseite sitzen als der Weg sagt ──")
    for zeile in luecken:
        print(zeile)
    print()
    print("KEINE LUECKE." if not luecken else f"{len(luecken)} LUECKE(N).")
    return 1 if luecken else 0


if __name__ == "__main__":
    sys.exit(main())
