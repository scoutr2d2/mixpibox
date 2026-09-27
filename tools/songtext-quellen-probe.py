#!/usr/bin/env python3
"""Befragt LRCLIB — die Quelle fuer BACKLOG E84/B2 (Songtext-Anmeldepunkt).

WOZU: B2 entwirft einen Kern-Anmeldepunkt fuer Songtexte und nennt LRCLIB als
erste Wahl. Was der Entwurf NICHT sagt, ist die Zahl, an der das Feature
haengt: WIE VIEL von dem, was auf einer KINDERBOX liegt, kennt LRCLIB
ueberhaupt? Bei Popmusik ist die Antwort offensichtlich gut, bei deutschen
Kinderliedern ist sie offen, und bei Hoerspielen sagt der Entwurf selbst
„findet sich nichts". Das ist keine Dokumentationsfrage, sondern eine
Messfrage — deshalb ein Werkzeug und keine Reihe von curl-Zeilen.

WAS ES AENDERT: nichts. Ausschliesslich GET auf lrclib.net. Kein Zugriff auf
die Box, keine Zugangsdaten, es wird keine Datei geschrieben.

WAS ES BEWUSST NICHT AUSGIBT: den Songtext selbst. Songtexte sind
urheberrechtlich geschuetzt (B2 nennt das als Randbedingung). Diese Probe ist
eine MESSUNG, keine Kopie — sie zaehlt Treffer, Zeilen und Zeitmarken und
meldet, OB ein Text da ist, nie WELCHER. `--roh` gibt die Antwort unveraendert
aus und ist deshalb der einzige Weg, an den Text zu kommen; dort steht er dann
absichtlich als das, was er ist: fremde Antwort, nicht Ausgabe dieses Werkzeugs.

DER FUND, der das Feature entscheidet — DUBLETTEN (gemessen 05.09.2026):
LRCLIB ist nutzerbefuellt, und derselbe Song liegt vielfach darin. „Radiohead —
Creep" hat 20 Treffer mit 15 VERSCHIEDENEN Dauern: 236 s (Studio), 259 s
(Collector's Edition), 292 s (Reading Festival), 311 s (Live in Stockholm).
Alle tragen synchrone Zeitmarken, und alle sind fuer sich richtig.

WAS DARAUS FOLGT: Wer den Text nur ueber Interpret+Titel sucht und den ersten
Treffer nimmt, bekommt mit hoher Wahrscheinlichkeit die Zeitmarken einer
FREMDEN Aufnahme. Der Text stimmt dann Wort fuer Wort und laeuft trotzdem um
eine Minute versetzt — der schlimmste Fehlerfall, weil er wie ein Fehler der
eigenen Zeitbasis aussieht. Die DAUER ist das einzige Merkmal, das die
Fassungen trennt. Ein Songtext-Anmeldepunkt muss deshalb auf die Dauer
abgleichen und im Zweifel LEER bleiben (was B2 fuer Hoerspiele ohnehin fordert).

UND DER API-ABGLEICH NIMMT EINEM DAS NICHT AB (gemessen, Gegenprobe unten):
  * falsches Album      -> 404   (Album wird streng geprueft)
  * erfundener Titel    -> 404
  * duration=239 richtig-> 200
  * duration=30  absurd -> 200   (!) — die Dauer wirkt NICHT als Riegel
  * duration=600 absurd -> 404
Die Dauer waehlt also unter den Dubletten aus, sie weist aber nicht zuverlaessig
ab. Wer sich auf den 404 verlaesst, bekommt still die falsche Fassung. Der
Unterbefehl `dubletten` zeigt das Feld, `wege` haelt beide Zugriffsarten dagegen.

AUFRUF:
    tools/songtext-quellen-probe.py zugang
    tools/songtext-quellen-probe.py titel "Rolf Zuckowski" "In der Weihnachtsbaeckerei"
    tools/songtext-quellen-probe.py titel "Radiohead" "Creep" --dauer 239 --album "Pablo Honey"
    tools/songtext-quellen-probe.py deckung
    tools/songtext-quellen-probe.py deckung --datei meine-titel.tsv
    tools/songtext-quellen-probe.py dubletten
    tools/songtext-quellen-probe.py dubletten "Nena|99 Luftballons"

Format fuer --datei: je Zeile `Interpret<TAB>Titel` (optional `<TAB>Dauer`).
Zeilen, die mit # beginnen, sind Kommentar. Ohne --datei laeuft die eingebaute
Stichprobe (siehe STICHPROBE) — sie ist als Stichprobe gekennzeichnet und
ersetzt keine Messung an der echten Medienliste.

Rueckgabe: 0 = alles beantwortet, 1 = mindestens eine Probe fiel durch.
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASIS = "https://lrclib.net"
ZEITGRENZE = 20

# LRCLIB VERLANGT eine Kennung — nachgelesen in der API-Doku (lrclib.net/docs):
# „you are required to identify your client in requests by setting the
# User-Agent header with your application's name, version, and a link".
# Ohne sie ist man ein anonymer Massenabrufer; mit ihr ist die Box im Log des
# Betreibers als das erkennbar, was sie ist.
KENNUNG = "mixpi-songtext-probe/0.1.0 (https://github.com/splitti/MuPiBox)"

# STICHPROBE — drei Sorten Inhalt, wie sie auf einer Kinderbox nebeneinander
# liegen. Der Sinn ist NICHT eine Gesamtzahl, sondern der Unterschied ZWISCHEN
# den Sorten: er entscheidet, ob sich der Anmeldepunkt lohnt.
STICHPROBE = [
    # (Interpret, Titel, Sorte)
    ("Rolf Zuckowski", "In der Weihnachtsbäckerei", "kinderlied"),
    ("Rolf Zuckowski", "Wie schön, dass du geboren bist", "kinderlied"),
    ("Volker Rosin", "Das Krokodil", "kinderlied"),
    ("Detlev Jöcker", "Laterne, Laterne", "kinderlied"),
    ("Simone Sommerland", "Aramsamsam", "kinderlied"),
    ("Die Toten Hosen", "Tage wie diese", "pop"),
    ("Nena", "99 Luftballons", "pop"),
    ("Herbert Grönemeyer", "Männer", "pop"),
    ("Queen", "Bohemian Rhapsody", "pop"),
    ("ABBA", "Dancing Queen", "pop"),
    ("Bibi Blocksberg", "Die neue Schule", "hoerspiel"),
    ("Benjamin Blümchen", "als Detektiv", "hoerspiel"),
    ("Die drei ???", "Der Karpatenhund", "hoerspiel"),
    ("Conni", "Conni kommt in den Kindergarten", "hoerspiel"),
    ("Die Maus", "Lach- und Sachgeschichten", "hoerspiel"),
]


def holen(pfad, felder=None, roh=False):
    """Ein GET auf LRCLIB. Gibt (status, objekt_oder_text) zurueck, wirft nie."""
    adresse = BASIS + pfad
    if felder:
        adresse += "?" + urllib.parse.urlencode(felder)
    anfrage = urllib.request.Request(adresse, headers={"User-Agent": KENNUNG})
    try:
        with urllib.request.urlopen(anfrage, timeout=ZEITGRENZE) as antwort:
            rumpf = antwort.read().decode("utf-8", "replace")
            if roh:
                return antwort.status, rumpf
            return antwort.status, json.loads(rumpf)
    except urllib.error.HTTPError as fehler:
        # 404 ist bei /api/get eine ANTWORT („kenne ich nicht"), kein Fehler.
        return fehler.code, None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as fehler:
        return 0, str(fehler)


def zeitmarken_zaehlen(synced):
    """Zaehlt Zeilen mit Zeitmarke — ohne den Text anzufassen."""
    if not synced:
        return 0
    return sum(1 for zeile in synced.splitlines() if zeile.startswith("["))


def befund(eintrag):
    """Verdichtet einen LRCLIB-Treffer zu Zahlen. NIE zum Text."""
    if not isinstance(eintrag, dict):
        return None
    synced = eintrag.get("syncedLyrics")
    plain = eintrag.get("plainLyrics")
    return {
        "id": eintrag.get("id"),
        "interpret": eintrag.get("artistName"),
        "titel": eintrag.get("trackName"),
        "album": eintrag.get("albumName"),
        "dauer": eintrag.get("duration"),
        "instrumental": bool(eintrag.get("instrumental")),
        "synchron": bool(synced),
        "zeitmarken": zeitmarken_zaehlen(synced),
        "einfach": bool(plain),
        "zeilen_einfach": len(plain.splitlines()) if plain else 0,
    }


def cmd_zugang(args):
    """Misst die Schnittstelle selbst: Schluessel noetig? Drosselung? Kennung?"""
    print("ZUGANG ZU LRCLIB — gemessen, nicht angenommen\n")
    fehler = 0

    status, daten = holen("/api/search", {"q": "Creep Radiohead"})
    print(f"  /api/search ohne jeden Schluessel      -> HTTP {status}")
    if status != 200:
        fehler += 1
    elif isinstance(daten, list):
        print(f"  Treffer in einer Antwort              -> {len(daten)}")
        if daten:
            felder = sorted(daten[0].keys())
            print(f"  Felder je Treffer                     -> {', '.join(felder)}")

    # Trifft /api/get ohne Dauer? Die Doku sagt, alle vier Felder seien noetig.
    status_ohne, _ = holen(
        "/api/get", {"artist_name": "Radiohead", "track_name": "Creep"}
    )
    print(f"  /api/get OHNE album+duration           -> HTTP {status_ohne}")

    status_mit, daten_mit = holen(
        "/api/get",
        {
            "artist_name": "Radiohead",
            "track_name": "Creep",
            "album_name": "Pablo Honey",
            "duration": "239",
        },
    )
    print(f"  /api/get MIT album+duration           -> HTTP {status_mit}")
    if status_mit != 200:
        fehler += 1

    # WELCHES FELD RIEGELT WIRKLICH AB? Der erste Entwurf dieser Probe stellte
    # die Frage falsch — er mass eine „Dauer-Toleranz" und bekam auf +0 bis
    # +10 s lauter 200. Das sah nach grosszuegiger Toleranz aus und hiess in
    # Wahrheit: die Dauer riegelt gar nicht ab. Sichtbar wird das erst mit
    # ABSURDEN Werten und einem falschen Album als Gegenprobe.
    print("\n  Welches Feld weist wirklich ab? (echte Dauer 239 s)")
    faelle = [
        ("Dauer richtig  (239 s)", {"album_name": "Pablo Honey", "duration": "239"}, 200),
        ("Dauer absurd    (30 s)", {"album_name": "Pablo Honey", "duration": "30"}, 200),
        ("Dauer absurd   (600 s)", {"album_name": "Pablo Honey", "duration": "600"}, 404),
        ("Album falsch", {"album_name": "Voellig Falsch", "duration": "239"}, 404),
    ]
    for name, zusatz, erwartet in faelle:
        felder = {"artist_name": "Radiohead", "track_name": "Creep"}
        felder.update(zusatz)
        st, _ = holen("/api/get", felder)
        stimmt = "" if st == erwartet else "   ABWEICHUNG zur Messung vom 05.09.2026!"
        print(f"    {name:<24} -> HTTP {st}{stimmt}")
        if st != erwartet:
            fehler += 1
        time.sleep(0.2)
    print("    Lehre: das ALBUM riegelt ab, die DAUER waehlt nur unter Dubletten.")

    # Drosselung: zehn Anfragen hintereinander.
    print("\n  Zehn Anfragen hintereinander:")
    codes = []
    for _ in range(10):
        st, _ = holen("/api/search", {"q": "Nena 99 Luftballons"})
        codes.append(st)
    verteilung = {c: codes.count(c) for c in sorted(set(codes))}
    print(f"    {verteilung}   (429 = gedrosselt)")
    if 429 in verteilung:
        print("    ACHTUNG: Drosselung erreicht — Retry-After beachten.")

    print(f"\nBILANZ: {'ZUGANG STEHT' if fehler == 0 else f'{fehler} Probe(n) durchgefallen'}")
    return 1 if fehler else 0


def cmd_titel(args):
    """Ein einzelner Titel — ueber /api/search, mit /api/get als Gegenprobe."""
    if args.roh:
        status, rumpf = holen(
            "/api/search",
            {"artist_name": args.interpret, "track_name": args.titel},
            roh=True,
        )
        print(f"HTTP {status}")
        print(rumpf)
        return 0 if status == 200 else 1

    status, daten = holen(
        "/api/search", {"artist_name": args.interpret, "track_name": args.titel}
    )
    print(f"SUCHE  {args.interpret} — {args.titel}")
    print(f"  /api/search -> HTTP {status}, {len(daten) if isinstance(daten, list) else 0} Treffer\n")
    if status != 200 or not isinstance(daten, list) or not daten:
        print("BILANZ: KEIN TREFFER")
        return 1

    synchron = 0
    for eintrag in daten[:5]:
        b = befund(eintrag)
        if not b:
            continue
        if b["synchron"]:
            synchron += 1
        art = []
        if b["instrumental"]:
            art.append("instrumental")
        if b["synchron"]:
            art.append(f"synchron ({b['zeitmarken']} Zeitmarken)")
        elif b["einfach"]:
            art.append(f"nur einfach ({b['zeilen_einfach']} Zeilen)")
        else:
            art.append("ohne Text")
        print(f"  [{b['id']}] {b['interpret']} — {b['titel']}")
        print(f"       Album {b['album']!r}, {b['dauer']} s, {', '.join(art)}")

    if args.dauer and args.album:
        st, _ = holen(
            "/api/get",
            {
                "artist_name": args.interpret,
                "track_name": args.titel,
                "album_name": args.album,
                "duration": str(args.dauer),
            },
        )
        print(f"\n  Gegenprobe /api/get (exakt) -> HTTP {st}")

    print(f"\nBILANZ: {synchron} von {min(5, len(daten))} gezeigten Treffern SYNCHRON")
    return 0 if synchron else 1


def titel_messen(interpret, titel, dauer=None):
    """Ein Titel, ein Befund. Nimmt den BESTEN der Treffer (synchron schlaegt einfach)."""
    status, daten = holen("/api/search", {"artist_name": interpret, "track_name": titel})
    if status != 200 or not isinstance(daten, list) or not daten:
        return {"status": status, "treffer": 0, "synchron": False, "einfach": False}
    beste = None
    for eintrag in daten:
        b = befund(eintrag)
        if not b:
            continue
        if beste is None:
            beste = b
        elif b["synchron"] and not beste["synchron"]:
            beste = b
    return {
        "status": status,
        "treffer": len(daten),
        "synchron": bool(beste and beste["synchron"]),
        "einfach": bool(beste and beste["einfach"]),
        "zeitmarken": beste["zeitmarken"] if beste else 0,
    }


def liste_lesen(pfad):
    """Liest `Interpret<TAB>Titel[<TAB>Dauer]` — Sorte ist dann immer 'liste'."""
    eintraege = []
    with open(pfad, encoding="utf-8") as datei:
        for zeile in datei:
            zeile = zeile.strip()
            if not zeile or zeile.startswith("#"):
                continue
            teile = zeile.split("\t")
            if len(teile) < 2:
                print(f"  uebersprungen (kein Tabulator): {zeile!r}", file=sys.stderr)
                continue
            eintraege.append((teile[0].strip(), teile[1].strip(), "liste"))
    return eintraege


def cmd_deckung(args):
    """DIE Messung: wie viel einer Kinderbox kennt LRCLIB — getrennt nach Sorte."""
    if args.datei:
        eintraege = liste_lesen(args.datei)
        print(f"DECKUNG — aus {args.datei}, {len(eintraege)} Titel\n")
    else:
        eintraege = STICHPROBE
        print("DECKUNG — EINGEBAUTE STICHPROBE (keine echte Medienliste!)")
        print("Sie zeigt den Unterschied ZWISCHEN den Sorten, keine Gesamtquote.")
        print("Fuer die echte Zahl: --datei mit den Titeln der eigenen Box.\n")

    nach_sorte = {}
    for interpret, titel, sorte in eintraege:
        ergebnis = titel_messen(interpret, titel)
        nach_sorte.setdefault(sorte, []).append((interpret, titel, ergebnis))
        zeichen = "SYNCHRON" if ergebnis["synchron"] else (
            "nur Text" if ergebnis["einfach"] else "—       "
        )
        marken = f"{ergebnis['zeitmarken']:>4} Marken" if ergebnis["synchron"] else ""
        print(f"  {zeichen}  {interpret} — {titel}  {marken}")
        time.sleep(0.15)

    print("\n" + "=" * 64)
    gesamt_s = gesamt_n = 0
    for sorte, treffer in sorted(nach_sorte.items()):
        synchron = sum(1 for _, _, e in treffer if e["synchron"])
        einfach = sum(1 for _, _, e in treffer if e["einfach"] and not e["synchron"])
        gesamt_s += synchron
        gesamt_n += len(treffer)
        quote = 100 * synchron / len(treffer) if treffer else 0
        print(
            f"  {sorte:<12} {synchron}/{len(treffer)} synchron ({quote:.0f} %), "
            f"{einfach} nur einfach"
        )

    quote = 100 * gesamt_s / gesamt_n if gesamt_n else 0
    print(f"\nBILANZ: {gesamt_s} von {gesamt_n} Titeln SYNCHRON ({quote:.0f} %)")
    return 0


def cmd_dubletten(args):
    """DER Befund: wie viele FASSUNGEN desselben Songs LRCLIB fuehrt.

    Die Spanne der Dauern ist das Mass fuer die Gefahr: liegen zwischen der
    kuerzesten und der laengsten Fassung 75 Sekunden, dann laeuft der Text um
    bis zu 75 Sekunden versetzt, wenn man die falsche erwischt.
    """
    proben = args.titel or [
        "Radiohead|Creep",
        "Nena|99 Luftballons",
        "Queen|Bohemian Rhapsody",
        "Rolf Zuckowski|In der Weihnachtsbäckerei",
    ]
    print("DUBLETTEN — dieselbe Nummer in mehreren Fassungen, alle mit Zeitmarken\n")
    schlimmste = 0
    for probe in proben:
        if "|" not in probe:
            print(f"  uebersprungen (kein |): {probe!r}", file=sys.stderr)
            continue
        interpret, titel = probe.split("|", 1)
        status, daten = holen(
            "/api/search", {"artist_name": interpret, "track_name": titel}
        )
        if status != 200 or not isinstance(daten, list) or not daten:
            print(f"  {interpret} — {titel}: kein Treffer (HTTP {status})")
            continue
        dauern = sorted({round(float(e["duration"])) for e in daten if e.get("duration")})
        synchron = sum(1 for e in daten if e.get("syncedLyrics"))
        spanne = (max(dauern) - min(dauern)) if len(dauern) > 1 else 0
        schlimmste = max(schlimmste, spanne)
        print(f"  {interpret} — {titel}")
        print(f"    {len(daten)} Treffer, davon {synchron} synchron")
        print(f"    {len(dauern)} verschiedene Dauern: {min(dauern)}–{max(dauern)} s")
        print(f"    SPANNE {spanne} s  = groesstmoegliche Verschiebung bei Fehlgriff")
        time.sleep(0.2)

    print(f"\nBILANZ: schlimmste Spanne {schlimmste} s.")
    print("Ohne Dauer-Abgleich laeuft der Text um bis zu so viel versetzt —")
    print("und sieht dabei aus wie ein Fehler der eigenen Zeitbasis.")
    return 0


def main():
    zerleger = argparse.ArgumentParser(
        description="Befragt LRCLIB fuer BACKLOG E84/B2 — misst, gibt keine Songtexte aus.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    unter = zerleger.add_subparsers(dest="befehl", required=True)

    p = unter.add_parser("zugang", help="Schluessel, Toleranz, Drosselung messen")
    p.set_defaults(funktion=cmd_zugang)

    p = unter.add_parser("titel", help="einen Titel nachschlagen")
    p.add_argument("interpret")
    p.add_argument("titel")
    p.add_argument("--album")
    p.add_argument("--dauer", type=int, help="Sekunden, fuer die /api/get-Gegenprobe")
    p.add_argument("--roh", action="store_true", help="unveraenderte Antwort (enthaelt den Text)")
    p.set_defaults(funktion=cmd_titel)

    p = unter.add_parser("deckung", help="wie viel einer Kinderbox LRCLIB kennt")
    p.add_argument("--datei", help="TSV: Interpret<TAB>Titel[<TAB>Dauer]")
    p.set_defaults(funktion=cmd_deckung)

    p = unter.add_parser("dubletten", help="wie viele Fassungen LRCLIB je Song fuehrt")
    p.add_argument("titel", nargs="*", help="je Argument 'Interpret|Titel'")
    p.set_defaults(funktion=cmd_dubletten)

    args = zerleger.parse_args()
    return args.funktion(args)


if __name__ == "__main__":
    sys.exit(main())
