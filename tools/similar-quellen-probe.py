#!/usr/bin/env python3
"""Befragt die vier Fremdquellen fuer ein Plugin „aehnliche Interpreten".

WOZU: Ein geplantes Plugin soll zu einem Interpreten aehnliche vorschlagen.
Die Doku aller vier Quellen liest sich hervorragend — sie ist aber an
Popmusik gemessen. Auf einer KINDERBOX steht „Pettersson und Findus",
„Bibi Blocksberg", „Conni", „Benjamin Bluemchen". Ob eine Quelle dazu
ueberhaupt etwas weiss, ist keine Doku-, sondern eine Messfrage — deshalb ein
Werkzeug und keine Reihe von curl-Zeilen.

WAS ES AENDERT: nichts. Ausschliesslich GET auf musicbrainz.org,
labs.api.listenbrainz.org, api.listenbrainz.org, api.deezer.com und
ws.audioscrobbler.com. Keine Zugangsdaten, keine Datei wird geschrieben, die
Box wird nicht angefasst. Nur Standardbibliothek, kein pip.

HOEFLICHKEIT: jede Anfrage traegt KENNUNG als User-Agent (MusicBrainz
verlangt das ausdruecklich und sperrt sonst). Vor jeder MusicBrainz-Anfrage
liegt eine volle Sekunde Pause — das ist deren dokumentierte Grenze. Das
Rate-Limit von Deezer wird NICHT durch Fluten gemessen, sondern aus den
Kopfzeilen gelesen (Unterbefehl `deezer` --kopfzeilen).

GEMESSEN AM 2026-09-06 (Arbeitsplatz, ohne Box). Zustandsaussagen — wer sie
spaeter braucht, laesst das Werkzeug neu laufen, statt ihnen zu glauben.

DIE EINE ZAHL, um die es geht (`bilanz`, vier Serien gegen zwei Popmusiker):
    Kinderserien: 4/4 in MusicBrainz gefunden
                  1/4 mit ListenBrainz-Aehnlichen
                  3/4 mit Deezer-/related
    Kontrolle:    2/2 MB / 2/2 LB / 2/2 DZ
Die Kontrolle liefert also ueberall. Wo die Serien leer bleiben, liegt es
NICHT am Endpunkt, sondern am Bestand. DEEZER IST DIE EINZIGE QUELLE, DIE
FUER DIESEN ANWENDUNGSFALL WIRKLICH TRAEGT.

1. MUSICBRAINZ — gute Bruecke fuer die IDENTITAET, nichts fuer AEHNLICHKEIT
   Alle vier Serien mit score 100 gefunden, Typ „Character" (Bibi, Conni,
   Benjamin) bzw. „Other" (Pettersson und Findus), Land DE:
     Pettersson und Findus  36e9efe3-37c0-4ce1-a8f7-5e9a57980646
     Bibi Blocksberg        2c89e930-7769-403f-8145-f215bb8fb5ba
     Conni                  dcb12871-1bb5-4b2a-b431-40f9548056c6
     Benjamin Bluemchen     6f4b441a-3197-47bd-b572-a53ae4ba3b00
   Der Abstand zum zweiten Kandidaten ist bei drei Serien gross (46–61) und
   bei „Conni" WACKELIG (100 gegen 96 fuer „Liane Schneider", die Autorin).
   Tags sind da und sind BRAUCHBAR — „audio drama", „hoerspiel", „children",
   „has german audio plays", „fictitious artist", „series title as artist" —
   aber die Zaehler sind winzig (1–3). Als Aehnlichkeitsmerkmal reicht das
   fuer eine grobe Sortierung „Hoerspiel gegen Musik", nicht fuer „wer passt
   zu wem".
   Release-Groups: Bibi 186, Benjamin 235, Pettersson 13 — aber CONNI 1, und
   diese eine ist die Single „Hotel Room" (2025), die mit der Serie nichts zu
   tun hat. „Meine Freundin Conni" ist ein eigener Eintrag mit ebenfalls 1
   Gruppe. Der Conni-Bestand fehlt in MusicBrainz schlicht.
   Datumsgenauigkeit ist die zweite Falle: bei den Serien ueberwiegt das
   blosse JAHR (Bibi 8 taggenau gegen 15 nur Jahr; Benjamin 13 gegen 11),
   bei der Popmusik-Kontrolle ist fast alles taggenau (Die Toten Hosen 24 von
   25). Wer nach Datum sortiert, sortiert bei Hoerspielen Rauschen.

2. LISTENBRAINZ/LABS — lebt, taugt fuer Kinderhoerspiele aber praktisch nicht
   Der lebende Pfad, roh durchprobiert (Unterbefehl `listenbrainz
   --kandidaten`):
     .../similar-artists/json?artist_mbids=<MBID>&algorithm=<ALG>   -> 200
     dasselbe mit artist_mbid (EINZAHL)                             -> 400
     dasselbe OHNE algorithm                                        -> 400
     .../similar-artists (ohne /json)                               -> Timeout
     api.listenbrainz.org/1/similar-artists                         -> 404
     api.listenbrainz.org/1/metadata/artist?artist_mbids=…&inc=…    -> 200
     labs .../artist-similarity/json (alter Name)                   -> 404
   `artist_mbids` (Mehrzahl) und `algorithm` sind BEIDE Pflicht; der Fehler
   ist eine HTML-Seite, kein JSON. Die Antwort ist eine flache JSON-Liste mit
   artist_mbid, name, comment, gender, type, reference_mbid und score.
   DER SCORE IST KEIN 0..1-WERT, sondern ein roher Zaehler: Nena 60–453, Die
   Toten Hosen 166–1032, Benjamin Bluemchen 19–20. Er ist zwischen zwei
   Interpreten NICHT vergleichbar — nur innerhalb einer Liste.
   Bestand: Nena 100 Aehnliche, Die Toten Hosen 100 (das ist der Deckel aus
   `limit_100` im Algorithmusnamen, keine echte Zahl). Dagegen Pettersson 0,
   Bibi 0, Conni 0 und Benjamin Bluemchen genau ZWEI: „Simone Sommerland,
   Karsten Glueck & die Kita-Froesche" (20) und RAMMSTEIN (19). Auf einer
   Kinderbox ist der zweite Vorschlag der Grund, warum man diese Quelle nicht
   ungefiltert anzeigt.
   Die Algorithmuswahl aendert das Ergebnis erheblich (`--alle-algorithmen`):
   mit `session_based_days_9000_…_threshold_15_limit_50_skip_30` liefert Bibi
   Blocksberg genau einen sinnvollen Treffer — „Benjamin Bluemchen", score 34 —
   waehrend alle anderen Algorithmen 0 liefern. Wer nur den erstbesten
   Algorithmus probiert, haelt „leer" faelschlich fuer eine Eigenschaft des
   Dienstes.

3. DEEZER — die einzige Quelle, die fuer Kinderhoerspiele wirklich liefert
   Suche und /related ohne jede Anmeldung, HTTP 200, CORS offen.
     Pettersson und Findus (id 989833, 61 Alben)   -> 20 Aehnliche:
       Benjamin Bluemchen, Die Fuchsbande, Pumuckl, Astrid Lindgren Deutsch,
       Kati & Azuro
     Bibi Blocksberg (id 64579, 266 Alben)         -> 20 Aehnliche:
       Bibi und Tina, Deine Freunde, Die Schule der magischen Tiere,
       Tanya Stewner, Dikka
     Benjamin Bluemchen (id 64571, 290 Alben)      -> 20 Aehnliche:
       Astrid Lindgren Deutsch, Kati & Azuro, Die Fuchsbande, SimsalaGrimm,
       Pumuckl
   Das sind Namen, die auf eine Kinderbox gehoeren. /related liefert IMMER
   genau 20 und KEINEN Score — nur eine Reihenfolge.
   DIE FALLE BEI DEEZER IST DIE SUCHE, nicht die Aehnlichkeit: `q=Conni`
   liefert 25 Treffer und stellt „Conni & Co" (id 57582222, 20 Alben) nach
   vorn — der hat /related total 0. Der richtige Eintrag heisst ebenfalls
   „Conni" (id 75255, 95 Alben, 29964 Fans) und wird erst von
   `q=Meine Freundin Conni` gefunden; DER hat 20 Aehnliche (Peppa Pig
   Hoerspiele, Prinzessin Lillifee, Benjamin Bluemchen, …). Der erste
   Suchtreffer ist also nicht der beste; `nb_album`/`nb_fan` trennen die
   beiden sauber und stehen im Suchergebnis schon drin.
   /artist/<id>/albums: release_date IMMER taggenau (25 von 25, auch bei
   Hoerspielen — anders als MusicBrainz), aber OHNE UPC. Den UPC gibt es nur
   je Album unter /album/<id> (dort gemessen: upc 4071498050781, label
   „Silberfisch"). Bei 290 Alben sind das 290 zusaetzliche Anfragen.

4. LAST.FM — ohne Schluessel gar nichts, Fehlerform gemessen
   ohne api_key                -> HTTP 400, error 6, „Invalid parameters"
   mit erfundenem api_key      -> HTTP 403, error 10, „Invalid API key"
   Es wurde KEIN Schluessel erfunden und niemand angemeldet. Der Rest steht
   im Unterbefehl `lastfm` aus der Doku (match ist dort echt 0..1).

AUFRUF:
    tools/similar-quellen-probe.py --help
    tools/similar-quellen-probe.py musicbrainz
    tools/similar-quellen-probe.py musicbrainz --name "Bibi Blocksberg"
    tools/similar-quellen-probe.py listenbrainz --kandidaten
    tools/similar-quellen-probe.py listenbrainz --mbid <MBID>
    tools/similar-quellen-probe.py listenbrainz --name "Conni"
    tools/similar-quellen-probe.py deezer --name "Benjamin Blümchen"
    tools/similar-quellen-probe.py deezer --kopfzeilen
    tools/similar-quellen-probe.py lastfm
    tools/similar-quellen-probe.py bilanz

Mit --roh gibt jeder Unterbefehl die unveraenderte Antwort aus.
Rueckgabe: 0 = alles beantwortet, 1 = mindestens eine Probe fiel durch.
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# Ein hoeflicher, eindeutiger Absender. MusicBrainz verlangt ihn ausdruecklich
# („Application/Version (contact)"), und ein Betreiber kann uns damit im Log
# als das erkennen, was wir sind: eine Messung, kein Massenabrufer.
KENNUNG = "mixpi-similar-probe/0.1 (https://github.com/splitti/MuPiBox)"

MB = "https://musicbrainz.org/ws/2"
LABS = "https://labs.api.listenbrainz.org"
LB = "https://api.listenbrainz.org"
DEEZER = "https://api.deezer.com"
LASTFM = "https://ws.audioscrobbler.com/2.0/"

ZEITGRENZE = 25
MB_PAUSE = 1.05  # MusicBrainz: hoechstens eine Anfrage je Sekunde.

# Die Stichprobe. Vier deutsche Kinderserien — das ist der Anwendungsfall —
# und zwei Popmusiker als KONTROLLE. Ohne Kontrolle kann man „Endpunkt kaputt"
# nicht von „kennt diese Kinderserie nicht" unterscheiden.
KINDERSERIEN = [
    "Pettersson und Findus",
    "Bibi Blocksberg",
    "Conni",
    "Benjamin Blümchen",
]
KONTROLLE = [
    "Nena",
    "Die Toten Hosen",
]

# Die Algorithmus-Zeichenketten, die die Labs-Oberflaeche am 2026-09-06 in
# ihrem Auswahlfeld anbot. Der Parameter ist PFLICHT und hat keinen Standard —
# wer ihn weglaesst, bekommt keinen Fehler, den man als solchen erkennt.
ALGORITHMEN = [
    "session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30",
    "session_based_days_1825_session_300_contribution_3_threshold_10_limit_100_filter_True_skip_30",
    "session_based_days_7500_session_300_contribution_3_threshold_10_limit_100_filter_True_skip_30",
    "session_based_days_9000_session_300_contribution_5_threshold_15_limit_50_skip_30",
    "session_based_days_75_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30",
]
ALGORITHMUS = ALGORITHMEN[0]

_letzte_mb = [0.0]


# ── Grundlage ───────────────────────────────────────────────────────────────


def holen(adresse, felder=None, kopfzeilen=None):
    """Ein GET. Gibt (status, objekt_oder_text, kopfzeilen) zurueck, wirft nie.

    Das Werkzeug soll auch dann noch etwas sagen, wenn eine Quelle antwortet
    wie sie will — deshalb wird JEDER Fehler zu einem Messwert, nicht zu einem
    Abbruch.
    """
    if felder:
        adresse += "?" + urllib.parse.urlencode(felder)
    kopf = {"User-Agent": KENNUNG, "Accept": "application/json"}
    if kopfzeilen:
        kopf.update(kopfzeilen)
    anfrage = urllib.request.Request(adresse, headers=kopf)
    try:
        with urllib.request.urlopen(anfrage, timeout=ZEITGRENZE) as antwort:
            rumpf = antwort.read().decode("utf-8", "replace")
            kopfe = dict(antwort.headers.items())
            try:
                return antwort.status, json.loads(rumpf), kopfe
            except json.JSONDecodeError:
                return antwort.status, rumpf, kopfe
    except urllib.error.HTTPError as fehler:
        rumpf = fehler.read().decode("utf-8", "replace") if fehler.fp else ""
        kopfe = dict(fehler.headers.items()) if fehler.headers else {}
        try:
            return fehler.code, json.loads(rumpf), kopfe
        except json.JSONDecodeError:
            return fehler.code, rumpf, kopfe
    except (urllib.error.URLError, TimeoutError, OSError) as fehler:
        return 0, str(fehler), {}


def mb_holen(pfad, felder, versuche=4):
    """MusicBrainz — erzwungene Sekundenpause UND Wiederholung bei 503.

    DIE FALLE (gemessen 2026-09-06): die dokumentierte Grenze „eine Anfrage je
    Sekunde" reicht nicht. Der erste Lauf dieses Werkzeugs hielt den Takt exakt
    ein und bekam trotzdem in 5 von 18 Anfragen ein HTTP 503 („Your requests
    are exceeding the allowable rate limit"). Der Eimer ist offenbar pro
    Absender-Adresse gefuellt und wird geteilt. Wer 503 als „gibt es nicht"
    liest, streicht Serien aus dem Ergebnis, die sehr wohl da sind — hier ist
    genau das im ersten Lauf passiert (Benjamin Bluemchen sah tagsueber wie
    „ohne Tags" aus). Ein Plugin MUSS 503 wiederholen, nicht deuten.
    """
    felder = dict(felder)
    felder.setdefault("fmt", "json")
    wartezeit = MB_PAUSE
    for versuch in range(versuche):
        verstrichen = time.monotonic() - _letzte_mb[0]
        if verstrichen < wartezeit:
            time.sleep(wartezeit - verstrichen)
        _letzte_mb[0] = time.monotonic()
        status, daten, kopfe = holen(MB + pfad, felder)
        if status != 503:
            return status, daten, kopfe
        # 503 heisst hier fast immer Drosselung, nicht Ausfall. Zurueckziehen.
        wartezeit = min(wartezeit * 2, 8.0)
    return status, daten, kopfe


def roh_aus(status, daten):
    print(f"HTTP {status}")
    print(json.dumps(daten, ensure_ascii=False, indent=2) if not isinstance(daten, str) else daten)


def namen(args):
    """Welche Namen misst dieser Lauf? --name schlaegt die Stichprobe."""
    if args.name:
        return list(args.name)
    return KINDERSERIEN + KONTROLLE


# ── MusicBrainz ─────────────────────────────────────────────────────────────


def mb_suche(name, grenze=5):
    """Artist-Suche. Gibt (status, liste_der_kandidaten) zurueck."""
    status, daten, _ = mb_holen("/artist", {"query": name, "limit": grenze})
    if status != 200 or not isinstance(daten, dict):
        return status, []
    return status, daten.get("artists", [])


def cmd_musicbrainz(args):
    """Sucht, liest Tags und zaehlt Veroeffentlichungsgruppen — je Name."""
    print("MUSICBRAINZ — Artist-Suche, Tags, Release-Groups")
    print(f"  Basis   {MB}")
    print(f"  Kennung {KENNUNG}")
    print(f"  Takt    eine Anfrage je {MB_PAUSE} s (Vorgabe des Betreibers)\n")
    fehler = 0

    for name in namen(args):
        status, kandidaten = mb_suche(name, args.grenze)
        if args.roh:
            roh_aus(status, kandidaten)
            continue
        print(f"── {name}")
        if status != 200:
            print(f"   HTTP {status} — keine Antwort")
            fehler += 1
            continue
        if not kandidaten:
            print("   0 Kandidaten — MusicBrainz kennt diesen Namen nicht")
            fehler += 1
            continue

        erster = kandidaten[0]
        zweiter_score = kandidaten[1].get("score") if len(kandidaten) > 1 else None
        print(f"   {len(kandidaten)} Kandidaten (bis {args.grenze})")
        print(
            f"   [1] score {erster.get('score')}  {erster.get('name')!r}"
            f"  Typ {erster.get('type')}  Land {erster.get('country')}"
        )
        print(f"       MBID {erster.get('id')}")
        if erster.get("disambiguation"):
            print(f"       Zusatz: {erster['disambiguation']}")
        if zweiter_score is not None:
            abstand = erster.get("score", 0) - zweiter_score
            eindeutig = "EINDEUTIG" if abstand >= 10 else "WACKELIG"
            print(
                f"   [2] score {zweiter_score}  {kandidaten[1].get('name')!r}"
                f"   -> Abstand {abstand} = {eindeutig}"
            )

        mbid = erster.get("id")
        if not mbid:
            fehler += 1
            continue

        # Tags am Artist selbst — taugen sie als Merkmal fuer „aehnlich"?
        st, daten, _ = mb_holen(f"/artist/{mbid}", {"inc": "tags"})
        if st == 200 and isinstance(daten, dict):
            tags = daten.get("tags") or []
            if tags:
                gezeigt = ", ".join(
                    f"{t.get('name')} ({t.get('count')})" for t in tags[:8]
                )
                print(f"   Tags ({len(tags)}): {gezeigt}")
            else:
                print("   Tags: KEINE")
        else:
            print(f"   Tags: HTTP {st}")
            fehler += 1

        # Release-Groups — Anzahl und Datumsgenauigkeit.
        st, daten, _ = mb_holen(
            "/release-group", {"artist": mbid, "limit": args.grenze_rg}
        )
        if st == 200 and isinstance(daten, dict):
            gesamt = daten.get("release-group-count")
            gruppen = daten.get("release-groups") or []
            genau = {"leer": 0, "jahr": 0, "monat": 0, "tag": 0}
            for gruppe in gruppen:
                datum = (gruppe.get("first-release-date") or "").strip()
                laenge = len(datum)
                genau["leer" if laenge == 0 else
                      "jahr" if laenge == 4 else
                      "monat" if laenge == 7 else "tag"] += 1
            print(f"   Release-Groups: {gesamt} gesamt, {len(gruppen)} gelesen")
            print(
                f"       Datumsgenauigkeit: {genau['tag']} taggenau, "
                f"{genau['monat']} monatsgenau, {genau['jahr']} nur Jahr, "
                f"{genau['leer']} ohne Datum"
            )
            for gruppe in gruppen[:3]:
                print(
                    f"       · {gruppe.get('first-release-date') or '—':<10} "
                    f"{gruppe.get('primary-type')}  {gruppe.get('title')!r}"
                )
        else:
            print(f"   Release-Groups: HTTP {st}")
            fehler += 1
        print()

    print(f"BILANZ: {'alles beantwortet' if fehler == 0 else f'{fehler} Probe(n) durchgefallen'}")
    return 1 if fehler else 0


# ── ListenBrainz / Labs ─────────────────────────────────────────────────────


def lb_kandidaten(mbid):
    """Welcher Pfad LEBT? Alle Kandidaten einmal fragen, roh gemessen.

    Die Frage ist NICHT „was steht in der Doku", sondern „was antwortet heute".
    Deshalb stehen hier auch offensichtlich falsche Formen (Einzahl statt
    Mehrzahl, ohne algorithm): erst der Vergleich sagt, welcher Parameter
    wirklich Pflicht ist und wie der Dienst einen Fehler ueberhaupt meldet.
    """
    return [
        (
            "Labs, artist_mbids + algorithm",
            f"{LABS}/similar-artists/json",
            {"artist_mbids": mbid, "algorithm": ALGORITHMUS},
        ),
        (
            "Labs, artist_mbid (Einzahl)",
            f"{LABS}/similar-artists/json",
            {"artist_mbid": mbid, "algorithm": ALGORITHMUS},
        ),
        (
            "Labs, OHNE algorithm",
            f"{LABS}/similar-artists/json",
            {"artist_mbids": mbid},
        ),
        (
            "Labs, ohne /json",
            f"{LABS}/similar-artists",
            {"artist_mbids": mbid, "algorithm": ALGORITHMUS},
        ),
        (
            "Hauptdienst 1/similar-artists",
            f"{LB}/1/similar-artists",
            {"artist_mbids": mbid, "algorithm": ALGORITHMUS},
        ),
        (
            "Hauptdienst 1/metadata/artist",
            f"{LB}/1/metadata/artist",
            {"artist_mbids": mbid, "inc": "artist tag"},
        ),
        (
            "Labs, artist-similarity (alter Name)",
            f"{LABS}/artist-similarity/json",
            {"artist_mbids": mbid, "algorithm": ALGORITHMUS},
        ),
    ]


def kurz(daten, zeichen=200):
    text = json.dumps(daten, ensure_ascii=False) if not isinstance(daten, str) else daten
    text = " ".join(text.split())
    return text[:zeichen] + ("…" if len(text) > zeichen else "")


def cmd_listenbrainz(args):
    """Sucht den lebenden Endpunkt und misst, was er fuer die Serien liefert."""
    fehler = 0

    # Die MBID: entweder gegeben, oder aus MusicBrainz geholt.
    proben = []
    if args.mbid:
        proben = [(f"MBID {args.mbid}", args.mbid)]
    else:
        for name in namen(args):
            _, kandidaten = mb_suche(name, 1)
            if kandidaten:
                proben.append((name, kandidaten[0]["id"]))
            else:
                print(f"  {name}: keine MBID in MusicBrainz — uebersprungen")

    if not proben:
        print("Keine MBID — nichts zu messen.")
        return 1

    if args.kandidaten:
        print("LISTENBRAINZ — WELCHER PFAD LEBT? (roh gemessen, nicht aus der Doku)")
        name, mbid = proben[0]
        print(f"  Probe-MBID: {mbid}  ({name})\n")
        for beschriftung, adresse, felder in lb_kandidaten(mbid):
            status, daten, _ = holen(adresse, felder)
            form = type(daten).__name__
            groesse = len(daten) if isinstance(daten, (list, dict, str)) else "?"
            print(f"  {beschriftung:<34} -> HTTP {status}  {form}[{groesse}]")
            print(f"      {kurz(daten, 160)}")
            time.sleep(0.3)
        print()

    if args.alle_algorithmen:
        # Bringt ein anderer Algorithmus mehr? Das ist die einzige Stellschraube,
        # die der Endpunkt hat — wer sie nicht durchprobiert, haelt „leer" fuer
        # eine Eigenschaft des Dienstes statt fuer eine Eigenschaft der Wahl.
        print("LISTENBRAINZ — bringt ein anderer algorithm= mehr?\n")
        for name, mbid in proben:
            print(f"── {name}  ({mbid})")
            for alg in ALGORITHMEN:
                status, daten, _ = holen(
                    f"{LABS}/similar-artists/json",
                    {"artist_mbids": mbid, "algorithm": alg},
                )
                liste = daten
                if isinstance(liste, list) and liste and isinstance(liste[0], list):
                    liste = liste[-1]
                anzahl = len(liste) if isinstance(liste, list) else f"HTTP {status}"
                kurzname = alg.replace("session_based_", "")
                print(f"   {anzahl!s:>4}  {kurzname}")
                time.sleep(0.3)
            print()

    print("LISTENBRAINZ/LABS — aehnliche Interpreten je Name")
    print(f"  URL   {LABS}/similar-artists/json?artist_mbids=<MBID>&algorithm=<ALG>")
    print(f"  ALG   {args.algorithmus}\n")

    for name, mbid in proben:
        status, daten, _ = holen(
            f"{LABS}/similar-artists/json",
            {"artist_mbids": mbid, "algorithm": args.algorithmus},
        )
        if args.roh:
            print(f"── {name} ({mbid})")
            roh_aus(status, daten)
            continue
        print(f"── {name}  ({mbid})")
        if status != 200:
            print(f"   HTTP {status}: {kurz(daten, 200)}")
            fehler += 1
            continue
        treffer = daten
        # Die Labs-Antwort ist mal eine Liste von Treffern, mal eine Liste aus
        # zwei Listen (Kopf + Treffer). Beide Formen hier abfangen, statt sich
        # auf eine zu verlassen.
        if isinstance(treffer, list) and treffer and isinstance(treffer[0], list):
            treffer = treffer[-1]
        if not isinstance(treffer, list) or not treffer:
            print(f"   0 aehnliche Interpreten — Antwort: {kurz(daten, 120)}")
            continue
        felder = sorted(treffer[0].keys()) if isinstance(treffer[0], dict) else []
        print(f"   {len(treffer)} aehnliche, Felder: {', '.join(felder)}")
        werte = [
            t.get("score") for t in treffer
            if isinstance(t, dict) and isinstance(t.get("score"), (int, float))
        ]
        if werte:
            print(f"   score von {min(werte)} bis {max(werte)}  (roher Zaehler, NICHT 0..1)")
        for eintrag in treffer[: args.grenze]:
            if not isinstance(eintrag, dict):
                continue
            print(
                f"       · {eintrag.get('score')!s:>7}  "
                f"{eintrag.get('name') or eintrag.get('artist_name')!r}"
            )
        print()

    print(f"BILANZ: {'alles beantwortet' if fehler == 0 else f'{fehler} Probe(n) ohne Antwort'}")
    return 1 if fehler else 0


# ── Deezer ──────────────────────────────────────────────────────────────────


def deezer_suche(name):
    status, daten, _ = holen(f"{DEEZER}/search/artist", {"q": name})
    if status != 200 or not isinstance(daten, dict):
        return status, []
    return status, daten.get("data", [])


def cmd_deezer(args):
    """Suche, /related und /albums — plus Kopfzeilen statt Fluten."""
    print("DEEZER — Suche, aehnliche Interpreten, Alben")
    print(f"  Basis {DEEZER}  (ohne Zugangsdaten)\n")
    fehler = 0

    if args.kopfzeilen:
        # Rate-Limit HOEFLICH messen: EINE Anfrage, dann die Kopfzeilen lesen.
        # Wer die dokumentierten 50/5 s durch Fluten nachweist, hat sie
        # verbraucht und dem Betreiber nichts als Last hinterlassen.
        status, _, kopfe = holen(f"{DEEZER}/search/artist", {"q": "Nena"})
        print(f"  Eine Anfrage -> HTTP {status}. Kopfzeilen der Antwort:")
        for schluessel in sorted(kopfe):
            print(f"      {schluessel}: {kopfe[schluessel]}")
        print()

    for name in namen(args):
        status, treffer = deezer_suche(name)
        if args.roh:
            roh_aus(status, treffer)
            continue
        print(f"── {name}")
        if status != 200:
            print(f"   HTTP {status}")
            fehler += 1
            continue
        if not treffer:
            print("   0 Treffer — Deezer kennt diesen Namen nicht")
            fehler += 1
            continue
        erster = treffer[0]
        print(
            f"   {len(treffer)} Treffer. [1] id {erster.get('id')}  "
            f"{erster.get('name')!r}  {erster.get('nb_album')} Alben, "
            f"{erster.get('nb_fan')} Fans"
        )
        kennung = erster.get("id")

        st, daten, _ = holen(f"{DEEZER}/artist/{kennung}/related")
        verwandte = daten.get("data", []) if isinstance(daten, dict) else []
        gesamt = daten.get("total") if isinstance(daten, dict) else None
        print(f"   /related -> HTTP {st}, total {gesamt}, {len(verwandte)} gelesen")
        for eintrag in verwandte[: args.grenze]:
            print(f"       · {eintrag.get('name')!r}  ({eintrag.get('nb_fan')} Fans)")
        if st == 200 and not verwandte:
            print("       KEINE — /related antwortet, kennt aber niemanden")

        st, daten, _ = holen(f"{DEEZER}/artist/{kennung}/albums", {"limit": args.grenze_rg})
        alben = daten.get("data", []) if isinstance(daten, dict) else []
        genau = {"leer": 0, "jahr": 0, "tag": 0}
        upc = 0
        for album in alben:
            datum = (album.get("release_date") or "").strip()
            genau["leer" if not datum else "tag" if len(datum) == 10 else "jahr"] += 1
            if album.get("upc"):
                upc += 1
        print(
            f"   /albums -> HTTP {st}, total {daten.get('total') if isinstance(daten, dict) else '?'}, "
            f"{len(alben)} gelesen"
        )
        if alben:
            print(
                f"       release_date: {genau['tag']} taggenau, {genau['jahr']} unvollstaendig, "
                f"{genau['leer']} leer;  UPC in {upc} von {len(alben)}"
            )
            print(f"       Felder je Album: {', '.join(sorted(alben[0].keys()))}")
            for album in alben[:3]:
                print(f"       · {album.get('release_date') or '—':<11}{album.get('title')!r}")
            # UPC: die Liste unter /artist/<id>/albums fuehrt ihn NICHT. Wer ihn
            # als Schluessel gegen MusicBrainz braucht, muss je Album ein
            # zweites Mal abrufen — bei 290 Alben sind das 290 Anfragen.
            st, einzeln, _ = holen(f"{DEEZER}/album/{alben[0]['id']}")
            if isinstance(einzeln, dict):
                print(
                    f"       /album/{alben[0]['id']} -> HTTP {st}, upc "
                    f"{einzeln.get('upc') or 'FEHLT'}, label {einzeln.get('label')!r}"
                )
        print()

    print(f"BILANZ: {'alles beantwortet' if fehler == 0 else f'{fehler} Probe(n) ohne Treffer'}")
    return 1 if fehler else 0


# ── Last.fm ─────────────────────────────────────────────────────────────────


def cmd_lastfm(args):
    """OHNE Schluessel nicht abrufbar. Was messbar IST: die Fehlerform.

    Es wird KEIN Schluessel erfunden und niemand angemeldet. Gemessen wird nur,
    was ein Plugin sieht, wenn der Schluessel fehlt oder falsch ist — genau
    das ist der Fall, den ein Plugin-Bauer sauber behandeln muss.
    """
    print("LAST.FM — ohne Schluessel nicht abrufbar; die Fehlerform IST messbar")
    print(f"  Basis {LASTFM}\n")

    faelle = [
        ("ohne api_key", {"method": "artist.getSimilar", "artist": "Nena", "format": "json"}),
        (
            "mit erfundenem api_key",
            {
                "method": "artist.getSimilar",
                "artist": "Nena",
                "api_key": "0" * 32,
                "format": "json",
            },
        ),
        (
            "getInfo, erfundener Schluessel",
            {
                "method": "artist.getInfo",
                "artist": "Bibi Blocksberg",
                "api_key": "0" * 32,
                "format": "json",
            },
        ),
    ]
    for beschriftung, felder in faelle:
        status, daten, _ = holen(LASTFM, felder)
        code = daten.get("error") if isinstance(daten, dict) else None
        text = daten.get("message") if isinstance(daten, dict) else kurz(daten, 100)
        print(f"  {beschriftung:<30} -> HTTP {status}  error={code}  {text!r}")
        time.sleep(0.3)

    print("""
AUS DER DOKU (last.fm/api, nachgelesen 2026-09-06):
  artist.getSimilar  Pflicht: artist ODER mbid, PLUS api_key.
                     Optional: limit, autocorrect[0|1].
                     Antwort: similarartists.artist[] mit name, mbid, match,
                     url, image[], streamable.
                     match ist laut Doku „a similarity value between 0 (not
                     similar) and 1 (very similar)" — also 0..1, anders als
                     der rohe Zaehler der ListenBrainz-Labs.
  artist.getInfo     Pflicht: artist ODER mbid, PLUS api_key.
                     Optional: lang, autocorrect, username.
                     Antwort enthaelt mbid, tags, bio (summary+content),
                     stats.listeners und stats.playcount.
  Fehlercodes        6 = Invalid parameters (api_key fehlt),
                     10 = Invalid API key.
  ACHTUNG: Die MBID kommt zwar mit, ist bei Last.fm aber oft LEER — sie taugt
  nicht als Schluessel, ueber den man verlaesslich auf MusicBrainz zurueck
  kommt. Wer die Bruecke braucht, baut sie ueber den NAMEN.
""")
    return 0


# ── Bilanz ──────────────────────────────────────────────────────────────────


def cmd_bilanz(args):
    """Die harte Frage in einer Tabelle: was liefert wer fuer Kinderserien?"""
    print("BILANZ — vier Kinderserien gegen zwei Popmusiker (Kontrolle)\n")
    zeilen = []
    for name in namen(args):
        sorte = "kontrolle" if name in KONTROLLE else "kinder"

        _, mb_treffer = mb_suche(name, 3)
        mbid = mb_treffer[0]["id"] if mb_treffer else None
        mb_score = mb_treffer[0].get("score") if mb_treffer else 0

        lb_anzahl = "—"
        if mbid:
            status, daten, _ = holen(
                f"{LABS}/similar-artists/json",
                {"artist_mbids": mbid, "algorithm": args.algorithmus},
            )
            liste = daten
            if isinstance(liste, list) and liste and isinstance(liste[0], list):
                liste = liste[-1]
            lb_anzahl = len(liste) if isinstance(liste, list) else f"HTTP {status}"

        _, dz_treffer = deezer_suche(name)
        dz_id = dz_treffer[0]["id"] if dz_treffer else None
        dz_related = "—"
        beispiel = ""
        if dz_id:
            st, daten, _ = holen(f"{DEEZER}/artist/{dz_id}/related")
            verwandte = daten.get("data", []) if isinstance(daten, dict) else []
            dz_related = len(verwandte) if st == 200 else f"HTTP {st}"
            beispiel = ", ".join(e.get("name", "?") for e in verwandte[:3])

        zeilen.append((sorte, name, mb_score, lb_anzahl, dz_related, beispiel))
        print(
            f"  [{sorte:<9}] {name:<24} MB score {mb_score!s:>3}  "
            f"LB aehnliche {lb_anzahl!s:>4}  DZ related {dz_related!s:>4}"
        )
        if beispiel:
            print(f"                {'':<24} DZ nennt: {beispiel}")

    kinder = [z for z in zeilen if z[0] == "kinder"]
    kontrolle = [z for z in zeilen if z[0] == "kontrolle"]

    def zaehlen(gruppe, spalte):
        return sum(1 for z in gruppe if isinstance(z[spalte], int) and z[spalte] > 0)

    print("\n" + "=" * 66)
    # Die Spalten sind (sorte, name, mb_score, lb_anzahl, dz_related, beispiel) —
    # also 2, 3, 4. Der erste Entwurf zaehlte 3, 4, 5 und meldete deshalb
    # „0/2 Kontrolle bei Deezer", obwohl daneben 20 Namen standen. Eine Bilanz,
    # die der Zeile darueber widerspricht, ist der einzige Grund, warum das
    # aufgefallen ist — Bilanzen gehoeren gegen die Rohzeilen gelesen.
    if kinder:
        print(
            f"  Kinderserien: {zaehlen(kinder, 2)}/{len(kinder)} in MusicBrainz gefunden, "
            f"{zaehlen(kinder, 3)}/{len(kinder)} mit ListenBrainz-Aehnlichen, "
            f"{zaehlen(kinder, 4)}/{len(kinder)} mit Deezer-/related"
        )
    if kontrolle:
        print(
            f"  Kontrolle:    {zaehlen(kontrolle, 2)}/{len(kontrolle)} MB / "
            f"{zaehlen(kontrolle, 3)}/{len(kontrolle)} LB / "
            f"{zaehlen(kontrolle, 4)}/{len(kontrolle)} DZ"
        )
    print("  Liefert die Kontrolle und die Kinderserien nicht, liegt es NICHT")
    print("  am Endpunkt, sondern am Bestand — das ist die Antwort fuers Plugin.")
    return 0


# ── Aufruf ──────────────────────────────────────────────────────────────────


def main():
    zerleger = argparse.ArgumentParser(
        description=(
            "Misst die Fremdquellen fuer ein Plugin „aehnliche Interpreten“ — "
            "MusicBrainz, ListenBrainz/Labs, Deezer, Last.fm. Aendert nichts."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    zerleger.add_argument(
        "--name",
        action="append",
        help="Interpret/Serie; mehrfach moeglich. Ohne Angabe: die eingebaute "
        "Stichprobe (vier Kinderserien + zwei Popmusiker als Kontrolle).",
    )
    zerleger.add_argument("--roh", action="store_true", help="unveraenderte Antwort ausgeben")
    zerleger.add_argument("--grenze", type=int, default=5, help="Zeilen je Liste (Standard 5)")
    zerleger.add_argument(
        "--grenze-rg", type=int, default=25, dest="grenze_rg",
        help="Release-Groups bzw. Alben, die gelesen werden (Standard 25)",
    )
    zerleger.add_argument(
        "--algorithmus", default=ALGORITHMUS,
        help="ListenBrainz-Labs algorithm= (Pflichtparameter dort)",
    )
    unter = zerleger.add_subparsers(dest="befehl", required=True)

    p = unter.add_parser("musicbrainz", help="Suche, Tags, Release-Groups")
    p.set_defaults(funktion=cmd_musicbrainz)

    p = unter.add_parser("listenbrainz", help="welcher Pfad lebt, und was liefert er")
    p.add_argument("--mbid", help="statt Namenssuche direkt eine MBID messen")
    p.add_argument(
        "--kandidaten", action="store_true",
        help="alle Kandidaten-Pfade einmal fragen (die Entdeckung)",
    )
    p.add_argument(
        "--alle-algorithmen", action="store_true", dest="alle_algorithmen",
        help="jeden bekannten algorithm=-Wert gegen dieselbe MBID halten",
    )
    p.set_defaults(funktion=cmd_listenbrainz)

    p = unter.add_parser("deezer", help="Suche, /related, /albums")
    p.add_argument(
        "--kopfzeilen", action="store_true",
        help="Rate-Limit aus den Kopfzeilen lesen statt durch Fluten messen",
    )
    p.set_defaults(funktion=cmd_deezer)

    p = unter.add_parser("lastfm", help="Fehlerform ohne Schluessel + Doku-Fakten")
    p.set_defaults(funktion=cmd_lastfm)

    p = unter.add_parser("bilanz", help="alle Quellen je Name in einer Tabelle")
    p.set_defaults(funktion=cmd_bilanz)

    p = unter.add_parser("algorithmen", help="die bekannten algorithm=-Werte auflisten")
    p.set_defaults(funktion=lambda a: (
        [print(f"  {x}") for x in ALGORITHMEN], 0)[1])

    args = zerleger.parse_args()
    return args.funktion(args)


if __name__ == "__main__":
    sys.exit(main())
