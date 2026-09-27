#!/usr/bin/env python3
"""Befragt die GraphQL-Schnittstelle der ARD Audiothek — wiederholbar, ohne Geraet.

WOZU: E4/A1 im BACKLOG fragt, OB und WIE die ARD Audiothek angebunden werden
kann. Diese Fragen beantwortet man nicht aus Dokumentation, sondern indem man
die Schnittstelle fragt — und zwar immer wieder, denn sie ist NICHT dokumentiert
und kann sich aendern. Deshalb ein Werkzeug und keine Reihe von curl-Zeilen.

Die entscheidende Frage ist die HALTBARKEIT: eine Tonadresse der ARD hat eine
Verweildauer (`availableTo`). Laeuft sie ab, wird die Datei entfernt. Ein
data.json-Eintrag mit fest eingebackener Tonadresse ist dann tot. Der Unterbefehl
`haltbarkeit` misst genau das — er haelt `availableTo` gegen den tatsaechlichen
HTTP-Status der Datei.

WAS ES AENDERT: nichts. Ausschliesslich POST /graphql (nur Lesefelder) und
HTTP-Bereichsanfragen (die ersten 1024 Byte) auf die Tonadressen. Kein Zugriff
auf die Box, keine Zugangsdaten, keine Dateien werden geschrieben.

GEMESSEN AM 2026-08-04 (Arbeitsplatz, ohne Box):
  * KEIN Schluessel noetig. POST ohne jeden Kopfzeilen-Zusatz -> 200, auch mit
    erfundenem Bearer-Merkmal. Introspektion ist offen.
    Access-Control-Allow-Origin: * — anders als Deezer ist das KEIN Hindernis.
    20 Anfragen hintereinander: 20x 200, keine Drosselung.
  * `Item.audios[].url` ist eine feste Adresse beim Ausspielpartner
    (z. B. wdrmedien-a.akamaihd.net/...MP3-128.mp3), kein Merkmal, kein Ablauf
    in der Adresse selbst, keine Umleitung. ffprobe: reines MP3, und die Dauer
    (319,99 s) deckt sich mit dem Feld `duration` (319) der Schnittstelle.
  * ABER: OHNE Bedingung listet die Schnittstelle Folgen WEITER, deren Ton
    laengst weg ist. Item 16657073 ("Willi, der Kater..."): availableTo lag am
    2026-06-29, die Adresse antwortete am 2026-08-04 mit 404.
  * MIT `condition:{isPublished:true, itemType:EPISODE}` verschwindet genau
    diese Folge aus der Liste. Gegenprobe am aeltesten Ende zweier Sendungen
    (MausZoom ab 150, MausHoerspiel ab 180): 27 von 27 Folgen abrufbar.
  * Die Bedingung aendert die Anzahl drastisch — MausZoom: 1951 roh, 168
    gefiltert, waehrend `numberOfElements` 915 behauptet. Keine der drei Zahlen
    taugt als „so viele Folgen hat die Kachel"; zaehlen muss man selbst.

AUFRUF:
    tools/ard-audiothek-probe.py schema
    tools/ard-audiothek-probe.py zugang
    tools/ard-audiothek-probe.py suche 'Die Maus'
    tools/ard-audiothek-probe.py sendung 81889970 --anzahl 5
    tools/ard-audiothek-probe.py folge 16543875
    tools/ard-audiothek-probe.py kategorien
    tools/ard-audiothek-probe.py haltbarkeit 81889970 --anzahl 12 --ab 180
    tools/ard-audiothek-probe.py kachel 81889970 --anzahl 3

Mit --roh gibt jeder Unterbefehl die unveraenderte Antwort aus (fuer neue Felder).

Rueckgabe: 0 = alles beantwortet, 1 = mindestens eine Probe fiel durch.
"""

import argparse
import json
import sys
import urllib.error
import urllib.request

ENDPUNKT = "https://api.ardaudiothek.de/graphql"
ZEITGRENZE = 30

# Die redaktionelle Kategorie "Fuer Kinder" — der Einstieg, der fuer eine
# MuPiBox ueberhaupt in Frage kommt (gemessen 2026-08-04).
KINDER_KATEGORIE = "42914714"


# ── Grundlage ───────────────────────────────────────────────────────────────


def fragen(abfrage: str, variablen: dict | None = None, kopfzeilen: dict | None = None) -> dict:
    """Eine GraphQL-Abfrage stellen. Wirft bei Transportfehlern, nicht bei GraphQL-Fehlern."""
    rumpf = json.dumps({"query": abfrage, "variables": variablen or {}}).encode()
    kopf = {"Content-Type": "application/json"}
    kopf.update(kopfzeilen or {})
    anfrage = urllib.request.Request(ENDPUNKT, data=rumpf, headers=kopf, method="POST")
    with urllib.request.urlopen(anfrage, timeout=ZEITGRENZE) as antwort:
        return json.load(antwort)


def ausgeben(daten) -> None:
    print(json.dumps(daten, indent=2, ensure_ascii=False))


def meldet_fehler(antwort: dict) -> bool:
    if antwort.get("errors"):
        print("  GraphQL-Fehler:", file=sys.stderr)
        for f in antwort["errors"]:
            print("   ", f.get("message"), file=sys.stderr)
        return True
    return False


def kopf_pruefen(adresse: str) -> tuple[int, str, str]:
    """Holt die ersten 1024 Byte. HEAD meidet das Werkzeug bewusst — die
    Ausspielpartner der ARD beantworten HEAD nicht durchgehend gleich wie GET,
    und die Frage ist, ob der ABSPIELER etwas bekommt, nicht ob HEAD antwortet."""
    anfrage = urllib.request.Request(adresse, headers={"Range": "bytes=0-1023"})
    try:
        with urllib.request.urlopen(anfrage, timeout=ZEITGRENZE) as antwort:
            return antwort.status, antwort.headers.get("Content-Type", ""), ""
    except urllib.error.HTTPError as fehler:
        return fehler.code, fehler.headers.get("Content-Type", ""), fehler.reason
    except Exception as fehler:  # DNS, TLS, Zeitgrenze
        return 0, "", str(fehler)


# ── Bruchstuecke der Abfragen ───────────────────────────────────────────────
# Bewusst als Konstanten: A4 soll DIESE Felder in ein Modul giessen. Was hier
# nicht steht, hat auch im Modul nichts verloren.

# DIE FALLE, die den ersten Anlauf gekostet hat (2026-08-04): ohne diese
# Bedingung liefert `items` zur HAELFTE Eintraege mit LEERER audios-Liste.
# Gemessen: 60 neueste Folgen ohne Bedingung -> 40 ohne Ton. Dieselben 60 mit
# `isPublished:true` -> 0 ohne Ton. Die tonlosen sind Vorab-Dubletten (gleicher
# Text, Titel = blosser Sendungsname). itemType kommt dazu, weil sonst
# EVENT_LIVESTREAM und SECTION zwischen den Folgen stehen — beides nichts, was
# auf einer Kachel als „Folge" gelten darf.
NUR_ECHTE_FOLGEN = "condition:{isPublished:true, itemType:EPISODE}"

FELDER_SENDUNG = """
  id
  coreId
  title
  synopsis
  numberOfElements
  image { url url1X1 }
  publicationService { title }
  sharingUrl
"""

FELDER_FOLGE = """
  id
  title
  titleClean
  duration
  publishDate
  synopsis
  image { url url1X1 }
  audios { url downloadUrl allowDownload mimeType }
  audioList { href availableFrom availableTo audioCodec audioBitrate distributionType }
"""


# ── Unterbefehle ────────────────────────────────────────────────────────────


def befehl_schema(args) -> int:
    """Welche Wurzelfelder gibt es? Zeigt, ob sich die Schnittstelle geaendert hat."""
    antwort = fragen(
        "{ __schema { queryType { fields { name description } } } }"
    )
    if meldet_fehler(antwort):
        return 1
    felder = antwort["data"]["__schema"]["queryType"]["fields"]
    if args.roh:
        ausgeben(antwort)
        return 0
    print(f"{len(felder)} Wurzelfelder. Die fuer eine MuPiBox brauchbaren:")
    wichtig = {"search", "programSet", "item", "editorialCategory", "editorialCategories",
               "programSets", "items", "show", "homescreen", "editorialCollection"}
    for f in felder:
        marke = "*" if f["name"] in wichtig else " "
        print(f" {marke} {f['name']}")
    return 0


def befehl_zugang(args) -> int:
    """Braucht die Schnittstelle einen Schluessel? Die Deezer-Frage.

    Prueft drei Faelle: nackte Anfrage, Anfrage mit erfundenem Bearer-Merkmal,
    Introspektion. Eine Schnittstelle mit Schluesselzwang scheitert beim ersten.
    """
    faelle = [
        ("ohne jede Kopfzeile", None),
        ("mit erfundenem Bearer-Merkmal", {"Authorization": "Bearer unsinn-kein-echtes-merkmal"}),
        ("mit eigenem User-Agent", {"User-Agent": "MuPiBox-Probe/1"}),
    ]
    alles_gut = True
    for name, kopf in faelle:
        try:
            antwort = fragen("{ programSet(id:\"81889970\"){ title } }", kopfzeilen=kopf)
            titel = (antwort.get("data") or {}).get("programSet", {}).get("title")
            ok = bool(titel) and not antwort.get("errors")
            print(f"  {'OK  ' if ok else 'FEHL'} {name}: {titel!r}")
            alles_gut &= ok
        except urllib.error.HTTPError as fehler:
            print(f"  FEHL {name}: HTTP {fehler.code}")
            alles_gut = False
    # Die CORS-Kopfzeile entscheidet, ob auch der Kiosk-Browser direkt darf.
    anfrage = urllib.request.Request(
        ENDPUNKT, data=b'{"query":"{__typename}"}',
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(anfrage, timeout=ZEITGRENZE) as antwort:
        herkunft = antwort.headers.get("Access-Control-Allow-Origin")
    print(f"  Access-Control-Allow-Origin: {herkunft!r}"
          f"  ({'auch der Browser der Box darf direkt' if herkunft == '*' else 'nur ueber den Server'})")
    return 0 if alles_gut else 1


def befehl_suche(args) -> int:
    """Gibt es eine Suche, und wie sieht ein Treffer aus?"""
    abfrage = """
    query($q:String, $n:Int){
      search(query:$q, limit:$n, type:All){
        programSets { totalCount nodes { %s } }
        items { totalCount nodes { id title duration publishDate programSet { id title } } }
      }
    }""" % FELDER_SENDUNG
    antwort = fragen(abfrage, {"q": args.begriff, "n": args.anzahl})
    if meldet_fehler(antwort):
        return 1
    if args.roh:
        ausgeben(antwort)
        return 0
    such = antwort["data"]["search"]
    ps = such["programSets"]
    print(f"Sendungen: {ps['totalCount']} Treffer insgesamt")
    for k in ps["nodes"]:
        print(f"  [{k['id']}] {k['title']}  ({k['numberOfElements']} Folgen"
              f", {(k.get('publicationService') or {}).get('title')})")
        if k.get("synopsis"):
            print(f"        {k['synopsis'][:110]}")
    it = such["items"]
    print(f"Einzelfolgen: {it['totalCount']} Treffer insgesamt")
    for k in it["nodes"]:
        ps_titel = (k.get("programSet") or {}).get("title")
        print(f"  [{k['id']}] {k['title']}  ({k['duration']}s, aus {ps_titel!r})")
    return 0


def befehl_sendung(args) -> int:
    """Alles, was eine Kachel braucht — samt Folgen mit Dauer und Tonadresse."""
    abfrage = """
    query($id:ID!, $n:Int){
      programSet(id:$id){
        %s
        items(first:$n, orderBy:PUBLISH_DATE_DESC, %s){ nodes { %s } }
      }
    }""" % (FELDER_SENDUNG, NUR_ECHTE_FOLGEN, FELDER_FOLGE)
    antwort = fragen(abfrage, {"id": args.id, "n": args.anzahl})
    if meldet_fehler(antwort):
        return 1
    if args.roh:
        ausgeben(antwort)
        return 0
    s = antwort["data"]["programSet"]
    if not s:
        print(f"Keine Sendung mit der Kennung {args.id}", file=sys.stderr)
        return 1
    print(f"{s['title']}  [{s['id']}]  coreId={s['coreId']}")
    print(f"  Bild:  {(s.get('image') or {}).get('url1X1')}")
    print(f"  Text:  {(s.get('synopsis') or '')[:200]}")
    print(f"  Folgen insgesamt: {s['numberOfElements']}")
    for f in s["items"]["nodes"]:
        print(f"  [{f['id']}] {f['title']}  {f['duration']}s  {f['publishDate'][:10]}")
        for t in (f.get("audios") or [])[:1]:
            print(f"        Ton: {t['url']}  ({t['mimeType']}, Herunterladen erlaubt: {t['allowDownload']})")
        for a in (f.get("audioList") or [])[:1]:
            print(f"        Verweildauer: {a['availableFrom']} bis {a['availableTo']}")
    return 0


def befehl_folge(args) -> int:
    abfrage = "query($id:ID!){ item(id:$id){ %s programSet { id title } } }" % FELDER_FOLGE
    antwort = fragen(abfrage, {"id": args.id})
    if meldet_fehler(antwort):
        return 1
    ausgeben(antwort["data"]["item"])
    return 0


def befehl_kategorien(args) -> int:
    """Die redaktionellen Kategorien — der Weg zu 'Fuer Kinder' ohne Suchbegriff."""
    antwort = fragen("{ editorialCategories(first:60){ nodes { id title } } }")
    if meldet_fehler(antwort):
        return 1
    for k in antwort["data"]["editorialCategories"]["nodes"]:
        marke = "*" if k["id"] == KINDER_KATEGORIE else " "
        print(f" {marke} [{k['id']}] {k['title']}")
    return 0


def befehl_haltbarkeit(args) -> int:
    """DIE Frage fuer A5: haelt eine eingebackene Tonadresse?

    Holt N Folgen einer Sendung und ruft JEDE Tonadresse wirklich ab. Dann
    haelt es das Ergebnis gegen `availableTo`. Wenn abgelaufene Folgen 404
    liefern, ist bewiesen: die Adresse gehoert NICHT in data.json, sondern
    muss beim Abspielen frisch geholt werden.
    """
    abfrage = """
    query($id:ID!, $n:Int, $ab:Int){
      programSet(id:$id){
        title
        items(first:$n, offset:$ab, orderBy:PUBLISH_DATE_DESC, %s){
          nodes { id title audios { url } audioList { availableTo } }
        }
      }
    }""" % NUR_ECHTE_FOLGEN
    antwort = fragen(abfrage, {"id": args.id, "n": args.anzahl, "ab": args.ab})
    if meldet_fehler(antwort):
        return 1
    s = antwort["data"]["programSet"]
    if not s:
        print(f"Keine Sendung mit der Kennung {args.id}", file=sys.stderr)
        return 1
    print(f"Haltbarkeit der Tonadressen von {s['title']!r}\n")
    print(f"{'Folge':<10} {'availableTo':<26} {'HTTP':<6} {'Inhaltstyp':<14} Titel")
    tot = 0
    for f in s["items"]["nodes"]:
        adressen = [t["url"] for t in (f.get("audios") or []) if t.get("url")]
        bis = next((a["availableTo"] for a in (f.get("audioList") or []) if a.get("availableTo")), "-")
        if not adressen:
            print(f"{f['id']:<10} {bis:<26} {'-':<6} {'ohne Ton':<14} {f['title'][:40]}")
            tot += 1
            continue
        status, typ, _ = kopf_pruefen(adressen[0])
        spielbar = status in (200, 206) and typ.startswith("audio")
        if not spielbar:
            tot += 1
        print(f"{f['id']:<10} {bis:<26} {status:<6} {typ[:14]:<14} {f['title'][:40]}")
    gesamt = len(s["items"]["nodes"])
    print(f"\n{gesamt - tot} von {gesamt} Folgen sind abrufbar, {tot} nicht.")
    if tot:
        print("BEFUND: die Schnittstelle listet Folgen, deren Ton weg ist.")
        print("        -> Tonadresse NIE in data.json einbacken, und availableTo pruefen.")
    return 0


def befehl_kachel(args) -> int:
    """Der Entwurf fuer A5: wie saehe der data.json-Eintrag aus?

    Bewusst nur ein VORSCHLAG als Ausgabe — nichts wird geschrieben. Der
    Entwurf backt die Tonadresse absichtlich NICHT ein (siehe `haltbarkeit`),
    sondern merkt sich die Kennungen der ARD.
    """
    abfrage = """
    query($id:ID!, $n:Int){
      programSet(id:$id){
        %s
        items(first:$n, orderBy:PUBLISH_DATE_DESC, %s){ nodes { %s } }
      }
    }""" % (FELDER_SENDUNG, NUR_ECHTE_FOLGEN, FELDER_FOLGE)
    antwort = fragen(abfrage, {"id": args.id, "n": args.anzahl})
    if meldet_fehler(antwort):
        return 1
    s = antwort["data"]["programSet"]
    if not s:
        return 1
    # Die Bildadresse enthaelt eine Platzhalterstelle {width} — wer sie
    # unveraendert speichert, bekommt ein totes Bild.
    bild = (s.get("image") or {}).get("url1X1") or ""
    eintrag = {
        "id": f"ard-{s['id']}",
        "artist": (s.get("publicationService") or {}).get("title") or "ARD Audiothek",
        "title": s["title"],
        "type": "ard",
        "ardSendung": s["id"],
        "cover": bild.replace("{width}", "512"),
        "category": "audiobook",
    }
    print("Entwurf des data.json-Eintrags (NICHT geschrieben):")
    ausgeben(eintrag)
    print("\nDie Folgen dahinter (werden beim Abspielen frisch aufgeloest):")
    for f in s["items"]["nodes"]:
        bis = next((a["availableTo"] for a in (f.get("audioList") or []) if a.get("availableTo")), "-")
        print(f"  {f['id']}  {f['duration']:>5}s  bis {bis[:10]}  {f['title'][:50]}")
    return 0


# ── Einstieg ────────────────────────────────────────────────────────────────


def main() -> int:
    zerleger = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    zerleger.add_argument("--roh", action="store_true", help="unveraenderte Antwort ausgeben")
    unter = zerleger.add_subparsers(dest="befehl", required=True)

    unter.add_parser("schema", help="Wurzelfelder der Schnittstelle")
    unter.add_parser("zugang", help="Braucht es einen Schluessel?")
    unter.add_parser("kategorien", help="redaktionelle Kategorien, u. a. 'Fuer Kinder'")

    p = unter.add_parser("suche", help="Suche nach Sendungen und Folgen")
    p.add_argument("begriff")
    p.add_argument("--anzahl", type=int, default=5)

    for name, hilfe in [("sendung", "eine Sendung samt Folgen"),
                        ("haltbarkeit", "Tonadressen wirklich abrufen"),
                        ("kachel", "Entwurf eines data.json-Eintrags")]:
        p = unter.add_parser(name, help=hilfe)
        p.add_argument("id")
        p.add_argument("--anzahl", type=int, default=5)
        # --ab greift nur bei `haltbarkeit`: um AELTERE Folgen zu erwischen, denn
        # dort sitzen die abgelaufenen. Die neuesten sind fast immer abrufbar.
        p.add_argument("--ab", type=int, default=0, help="Folgen ueberspringen (nur haltbarkeit)")

    p = unter.add_parser("folge", help="eine einzelne Folge im Rohzustand")
    p.add_argument("id")

    args = zerleger.parse_args()
    befehle = {
        "schema": befehl_schema, "zugang": befehl_zugang, "suche": befehl_suche,
        "sendung": befehl_sendung, "folge": befehl_folge, "kategorien": befehl_kategorien,
        "haltbarkeit": befehl_haltbarkeit, "kachel": befehl_kachel,
    }
    try:
        return befehle[args.befehl](args)
    except urllib.error.HTTPError as fehler:
        print(f"HTTP {fehler.code} von {ENDPUNKT}: {fehler.reason}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
