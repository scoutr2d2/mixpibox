#!/usr/bin/env python3
"""Das Wissenspaket PFLEGEN — was `wiki-schau.py` nicht sieht, weil es im Text
nicht steht, sondern in den FELDERN.

ALLE ZAHLEN IN DIESEM TEXT sind der Stand vom 07.08.2026 (561 Eintraege) und
altern wie jede Zustandsaussage. Was gilt, sagt der Lauf, nicht diese Zeilen.

WOZU DIESES ZWEITE WERKZEUG
    `tools/wiki-schau.py` prueft den ROHTEXT: doppelte ids, doppelte
    Schluessel, Verweise in `[[..]]`/`[..]`. Das ist die eine Haelfte.
    Die andere Haelfte steht in den Feldern eines Eintrags, und die faellt
    durch jede Textpruefung:

      * `related: [a, b, c]` — eine YAML-LISTE. Die Textpruefung sucht
        `[[a]]` und `[a]`; `[a, b, c]` sieht fuer sie wie keiner von beiden
        aus (das Komma bricht das Muster). Von 440 Zielen in `related` und
        `siehe` fielen bis heute 438 durch; die zwei, die geprueft wurden,
        stehen ZUFAELLIG allein in ihrer Liste und sahen damit aus wie `[a]`.
        Vier Ziele gehen ins Leere.
      * `siehe: [a, b]` — dieselbe Bauart, dieselbe Luecke.
      * `kind:` fehlt — die Datei bleibt gueltig, der Eintrag ist aber fuer
        jeden Filter nach Art UNSICHTBAR. Der Installer laedt `signature`
        gegen Logzeilen, `config` gegen Dateien; wer keine Art traegt, wird
        nie geladen. 14 Eintraege sind so.
      * `kind: signature` OHNE `match:` — eine Signatur IST ihr Muster.
        Ohne `match` kann sie nie ausloesen. Sie liegt im maschinellen Fach
        und ist doch nur fuer Menschen da. 19 Eintraege sind so.

    Kurz: `wiki-schau.py` beantwortet „ist die Datei heil?", dieses Werkzeug
    „taugt der Inhalt fuer den, der ihn maschinell liest?".

    Die Textpruefung wird NICHT nachgebaut. Dieses Werkzeug LAEDT
    `wiki-schau.py` und gibt dessen Befunde mit aus — sonst muesste man zwei
    Sachen laufen lassen und wuerde die zweite vergessen.

DIE BOX DAZUNEHMEN (--gegen-box)
    Der Satz unten — „ob `mupi_powerled ist aus` heute noch stimmt, weiss
    nur die Box" — ist eine Aufforderung, und `--gegen-box` folgt ihr: der
    Lauf liest LESEND ueber ssh, was auf der Box steht (is-active UND
    is-enabled je Dienst, die Konfigschluessel ohne Geheimnisse, welche
    Ablagen wirklich liegen) und legt den Messwert neben jeden Eintrag, der
    davon spricht. Er DEUTET die Behauptung nicht — warum nicht, steht bei
    BOX_MESSEN, und es ist die Lehre aus einem verworfenen Entwurf.
    HART faerbt nur die eine Form ohne Spielraum: ein Eintrag sagt, es gebe
    eine Ablage nicht, und sie liegt da (07.08.2026 fand das
    `profile.json GIBT ES NICHT` in `ablage-besitz-gemessen-e18-stufe2` —
    die Datei ist seit dem 07.08. da).
    Ohne die Box laeuft alles andere weiter; ein Stand laesst sich mit
    `--stand-schreiben` ablegen und spaeter mit `--stand` wieder vorlegen.

WAS ES NICHT KANN, UND WARUM DAS HIER STEHT
    Es beurteilt keinen INHALT. Ob „mupi_powerled ist aus" heute noch
    stimmt, weiss nur die Box. Was dieses Werkzeug tun kann, ist die FRAGE
    stellen: der Abschnitt HALTBARKEIT sammelt die Eintraege, die eine
    Zustandsaussage machen („steht auf", „ist aus", „gibt es nicht",
    „enabled"), und ordnet sie nach dem juengsten Datum, das im Eintrag
    steht — aelteste zuerst. Das ist keine Fehlerliste, das ist eine
    Nachlese-Reihenfolge. Wer eine Stunde Zeit hat, faengt oben an.

    URSACHEN VERFALLEN NICHT, ZUSTAENDE SCHON. Ein Eintrag, der erklaert
    WARUM `freq_list` die Box verschwinden laesst, gilt in zwei Jahren noch.
    Ein Eintrag, der sagt WAS auf der Box eingestellt ist, ist ab dem
    naechsten Schreibzugriff eine Behauptung. Beide sehen im Wiki gleich
    aus. Der Marker-Zaehler trennt sie grob — mehr kann er nicht, und mehr
    soll er nicht vortaeuschen.

WARUM ES NICHT IN tools/pruefen.sh HAENGT
    Weil es heute ROT ist (Stand beim Bau, 07.08.2026: 4 leere Verweise in
    `related`, 14 Eintraege ohne Art, 19 Signaturen ohne Muster, 82 ohne
    Quelle). „Eine Messung, die dauerhaft rot steht, wird nicht mehr
    gelesen" — dieselbe Lektion wie in Commit 2aedc4a9. Erst wenn die
    harten Befunde auf null sind, gehoert `--pruefen` in die Kette.

AUFRUF
    tools/wiki-pflege.py                 alles: harte Befunde und weiche Listen
    tools/wiki-pflege.py --kurz          nur die Zahlen und die harten Befunde
    tools/wiki-pflege.py --haltbarkeit   nur die Nachlese-Reihenfolge
    tools/wiki-pflege.py --pruefen       still, Ende 1 bei HARTEM Befund
    tools/wiki-pflege.py --datei <pfad>  ein anderes pack.yaml
    tools/wiki-pflege.py --gegen-box     den Messwert der Box danebenlegen
    tools/wiki-pflege.py --gegen-box dietpi@<ip> --stand-schreiben stand.json
    tools/wiki-pflege.py --stand stand.json      ohne Box, mit altem Stand
    MUPI_WIKI=<pfad> tools/wiki-pflege.py

HART heisst: es ist ohne Kenntnis des Inhalts entscheidbar und immer falsch
(Verweis ins Leere, fehlende Pflichtangabe, Art ohne das, was die Art
verspricht). WEICH heisst: es ist ein Hinweis, den ein Mensch beurteilen
muss (fehlende Quelle, Insellage, Schlagwort-Drift, Aehnlichkeit,
Haltbarkeit). Nur HART faerbt `--pruefen` rot.
"""

import argparse
import collections
import datetime
import importlib.util
import itertools
import json
import pathlib
import re
import sys

try:
    import yaml
except ImportError:  # pragma: no cover
    sys.exit("PyYAML fehlt: pip install pyyaml")

HIER = pathlib.Path(__file__).resolve().parent


# ═══ Die Textpruefung leihen statt nachbauen ═══════════════════════════════
def wiki_schau_laden():
    """`tools/wiki-schau.py` als Modul. Der Bindestrich verbietet `import`.

    Faellt es aus (nicht da, kaputt), laeuft dieses Werkzeug weiter und sagt
    es — die Feldpruefung haengt nicht an der Textpruefung.
    """
    pfad = HIER / "wiki-schau.py"
    if not pfad.is_file():
        return None
    spec = importlib.util.spec_from_file_location("wiki_schau", pfad)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


# ═══ Was eine Art verspricht ═══════════════════════════════════════════════
#
# NICHT AUSGEDACHT, SONDERN AM BESTAND ABGELESEN (561 Eintraege, 07.08.2026).
# Gefordert wird nur, was die Art AUSMACHT — nicht, was die Mehrheit zufaellig
# mitfuehrt. Eine `falle` ohne `match` ist in Ordnung (31 sind so und meinen
# es); eine `signature` ohne `match` ist keine Signatur.
ART_BRAUCHT = {
    # kind:        (Felder, von denen JEDES da sein muss,
    #               Feldgruppen, von denen je EINES da sein muss)
    "signature": (["match"], []),
    "config": (["file", "fix"], [["present", "absent", "present_all"]]),
    "optim": ([], [["current", "better", "gain", "how"]]),
    "perf": (["action"], []),
}

# Pflicht fuer JEDEN Eintrag. `id` und `title` traegt heute jeder; `kind`
# fehlt 14 Mal — und genau die sind fuer jeden Filter nach Art unsichtbar.
IMMER = ("id", "title", "kind")

# Felder, in denen ein Verweis auf einen anderen Eintrag als LISTE steht.
VERWEISFELDER = ("related", "siehe")

# ═══ Zustandsaussagen ══════════════════════════════════════════════════════
#
# Jeder Marker steht fuer eine Aussage, die morgen anders sein kann. Sie sind
# absichtlich grob: der Zaehler ordnet die Nachlese, er entscheidet nichts.
MARKER = {
    "gibt es nicht": r"gibt es (heute )?nicht|existiert nicht",
    "ist aus/an": r"\bist (heute )?(aus|an|abgeschaltet|eingeschaltet|aktiv|inaktiv)\b",
    "steht auf": r"steht (heute )?(auf|bei)\b",
    "laeuft": r"\bl[aä]uft\b",
    "systemd-Wort": r"\b(enabled|disabled|inactive|is-active|is-enabled)\b",
    "heute/derzeit": r"\b(heute|derzeit|zurzeit|aktuell|momentan|inzwischen|bislang|bisher)\b",
    "noch nicht": r"\bnoch (nicht|keine|kein|immer)\b",
    "auf der Box liegt": r"auf der Box (liegt|steht|gibt)|am Ger[aä]t (liegt|steht)",
    "Stand <Datum>": r"\bStand[: ] ?[0-9]",
    "es gibt nur/genau": r"\bes gibt (nur|genau|heute)\b",
}
MARKER_RE = {k: re.compile(v, re.I) for k, v in MARKER.items()}

DATUM = re.compile(r"(\d{4})-(\d{2})-(\d{2})|(\d{2})\.(\d{2})\.(\d{4})")


def juengstes_datum(text):
    """Das SPAETESTE Datum im Eintrag — das ist sein Stand.

    Warum das spaeteste und nicht das aus `source`: viele Eintraege sind
    nachgetragen worden ("ergaenzt 05.08."), und der Nachtrag ist der Stand.
    Jahreszahlen ausserhalb 2024..2030 werden verworfen; sonst faengt sich
    die Pruefung Versionsnummern und Ports ein.
    """
    best = None
    for m in DATUM.finditer(text):
        try:
            if m.group(1):
                d = datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            else:
                d = datetime.date(int(m.group(6)), int(m.group(5)), int(m.group(4)))
        except ValueError:
            continue
        if not 2024 <= d.year <= 2030:
            continue
        if best is None or d > best:
            best = d
    return best


# ═══ Aehnlichkeit ══════════════════════════════════════════════════════════
def wortmenge(s, mindest=4):
    return {w for w in re.findall(r"[a-zäöüß0-9]+", (s or "").lower()) if len(w) >= mindest}


def jaccard(a, b):
    return len(a & b) / len(a | b) if (a or b) else 0.0


def haeufige_id_teile(ids, anteil=0.05):
    """Wortteile, die in mehr als `anteil` aller ids vorkommen.

    Aus den DATEN erhoben und nicht von Hand gelistet: `mupi-` steckt in
    hunderten ids und wuerde jede Aehnlichkeitsrechnung nach oben luegen.
    Eine Handliste hier waere der erste Teil dieser Datei, der veraltet.
    """
    z = collections.Counter()
    for i in ids:
        z.update(set(i.split("-")))
    grenze = max(2, int(len(ids) * anteil))
    return {w for w, n in z.items() if n > grenze}


# Ein Fenster von 8 Woertern. Kuerzer faengt sich stehende Wendungen
# („an der Box gemessen"), laenger verpasst umformulierte Absaetze.
FENSTER = 8


# ═══ Gegen die Box messen ══════════════════════════════════════════════════
#
# WAS HIER NICHT PASSIERT, UND WARUM DAS DIE HAUPTSACHE IST
#     Der erste Entwurf wollte die BEHAUPTUNG lesen: steht neben
#     `mupi_powerled` ein „aus", und laeuft der Dienst, ist das ein Befund.
#     Am echten Bestand gemessen liefert das 30 Zeilen, von denen 26 falsch
#     sind — „laeuft" im Satz daneben gehoert einem anderen Dienst, „nicht"
#     verneint etwas ganz anderes, und `mupibox-alsa-init ist disabled` ist
#     WAHR (is-enabled=disabled) und sieht neben is-active=active nur falsch
#     aus. Umgekehrt steht der eine Eintrag, der heute wirklich falsch ist,
#     in einer Komma-AUFZAEHLUNG („`mupi_vnc`, `mupi_novnc`, …,
#     `mupi_powerled`" unter der Ueberschrift „absichtlich aus") — die
#     Nachbarschaftsprobe sieht ihn nie. Viel Laerm, kein Fund: genau die
#     Sorte Messung, die nach zwei Laeufen niemand mehr liest.
#
#     Deshalb wird die Behauptung NICHT gedeutet. Es wird der MESSWERT
#     danebengelegt: „dieser Eintrag vom 30.07. spricht ueber
#     mupi_powerled — der steht heute auf active/enabled." Kein Urteil,
#     keine Fehlzeile, und der Mensch braucht eine Zeile statt einer
#     Sitzung an der Box. Sortiert wird nach dem Alter des Eintrags,
#     aeltester zuerst.
#
# EINE SACHE IST DOCH ENTSCHEIDBAR: „es gibt die Datei nicht" ist eine
#     Aussage ohne Spielraum. Liegt sie da, ist der Satz falsch — egal, was
#     drumherum steht. Nur diese Form faerbt HART.
#
# is-enabled IST NICHT is-active. `mupibox-alsa-init` ist disabled und
#     laeuft trotzdem (ein anderer zieht ihn); `mupi_mqtt` ist enabled und
#     ist tot. Wer die zwei zusammenwirft, erfindet Befunde. Der Stand
#     traegt darum beide, und die Nachlese zeigt beide.

# Wird UEBER STDIN an `python3 -` auf der Box gefuettert. Sie schreibt dort
# KEINE Datei (kein /tmp-Rest, nichts aufzuraeumen) — das Ergebnis kommt
# ueber stdout zurueck. Nur Lesen: is-active/is-enabled, eine Konfigdatei,
# ein Verzeichnislisting.
BOX_MESSEN = r'''
import json, os, glob, subprocess
def sh(c):
    try:
        return subprocess.run(c, shell=True, capture_output=True, text=True, timeout=60).stdout
    except Exception:
        return ""
s = {"gemessen": sh("date -Is").strip(), "host": sh("hostname").strip(),
     "dienste": {}, "schluessel": {}, "dateien": {}}
namen = set()
for z in sh("systemctl list-unit-files --no-legend --no-pager").splitlines():
    t = z.split()
    if t and t[0].endswith(".service"):
        namen.add(t[0][:-8])
for n in sorted(namen):
    if not any(x in n for x in ("mupi", "librespot", "spotify", "kiosk", "shairport", "pipewire", "bluetooth")):
        continue
    s["dienste"][n] = {"aktiv": sh("systemctl is-active " + n).strip(),
                       "an": sh("systemctl is-enabled " + n).strip()}
# Geheimnisse werden NICHT mitgeschrieben: der Stand landet sonst als Datei
# im Arbeitsbaum und irgendwann in einem Commit.
GEHEIM = ("token", "secret", "password", "passwort", "pin", "clientid", "key")
try:
    d = json.load(open("/etc/mupibox/mupiboxconfig.json"))
    def w(p, o):
        for k, v in o.items():
            pf = (p + "." + k).lstrip(".")
            if isinstance(v, dict):
                w(pf, v)
            elif isinstance(v, list):
                s["schluessel"][pf] = "<%d Eintraege>" % len(v)
            elif any(g in k.lower() for g in GEHEIM):
                s["schluessel"][pf] = "<nicht mitgeschrieben>"
            else:
                s["schluessel"][pf] = v
    w("", d)
except Exception as e:
    s["schluessel"]["FEHLER"] = str(e)
basis = "/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config"
for p in glob.glob(basis + "/*") + glob.glob(basis + "/profile/*/*"):
    s["dateien"][os.path.relpath(p, basis)] = os.path.getsize(p) if os.path.isfile(p) else "<ordner>"
print(json.dumps(s, ensure_ascii=False))
'''

# „Es gibt sie nicht" — die einzige Form ohne Spielraum. `fehlt` steht
# ABSICHTLICH nicht dabei: „wenn ihre Datei fehlt" beschreibt einen FALL,
# keinen Zustand, und lieferte allein vier falsche Zeilen.
GIBT_ES_NICHT = r"(?:GIBT ES NICHT|gibt es (?:heute |derzeit )?nicht|existiert nicht|gibt es noch nicht)"


def stand_holen(ziel):
    """Den Stand der Box ueber ssh lesen. Nur Lesen, keine Datei dort."""
    import subprocess
    roh = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", ziel, "python3 -"],
        input=BOX_MESSEN, capture_output=True, text=True, timeout=180)
    if roh.returncode != 0 or not roh.stdout.strip():
        raise RuntimeError(f"{ziel}: {roh.stderr.strip()[:300] or 'keine Antwort'}")
    return json.loads(roh.stdout)


def gegen_stand(eintraege, stand):
    """(harte Befunde, Nachleseliste) aus dem Vergleich mit einem Stand."""
    dienste = stand.get("dienste") or {}
    dateien = stand.get("dateien") or {}
    schluessel = stand.get("schluessel") or {}
    # Kurzname -> Groesse; `profile/kalea/resume.json` ist auch `resume.json`
    da = {}
    for pfad, groesse in dateien.items():
        if isinstance(groesse, int):
            da.setdefault(pfad.split("/")[-1], []).append(pfad)

    hart, nachlese = [], []
    for e in eintraege:
        text = " ".join(yaml.safe_dump(e, allow_unicode=True, sort_keys=False).split())
        beruehrt = []

        for name, st in sorted(dienste.items()):
            if re.search(r"(?<![\w.-])" + re.escape(name) + r"(?![\w-])", text):
                beruehrt.append(f"{name} = {st['aktiv']}/{st['an']}")

        for kurz, pfade in sorted(da.items()):
            if not re.search(r"(?<![\w./-])" + re.escape(kurz), text):
                continue
            beruehrt.append(f"{kurz} liegt da ({', '.join(sorted(pfade))})")
            m = re.search("`?" + re.escape(kurz) + r"`?\s*(?:\([^)]*\)\s*)?" + GIBT_ES_NICHT, text)
            if m:
                hart.append(f"{e.get('id')}   sagt „{m.group(0)}\" — sie liegt da: "
                            f"{', '.join(sorted(pfade))}")

        for key, wert in sorted(schluessel.items()):
            if str(wert).startswith("<"):
                continue
            if re.search(r"`" + re.escape(key.split('.')[-1]) + r"`", text):
                beruehrt.append(f"{key} = {wert!r}")

        # DIE BEIDEN HAELFTEN MUESSEN SICH TREFFEN. Ein Eintrag, der
        # `bluetooth` nur ERWAEHNT (der haengende Installationsschritt), sagt
        # nichts ueber den heutigen Zustand — er gehoert nicht in die
        # Nachlese, sonst ertrinkt der eine Eintrag, der wirklich behauptet,
        # `mupi_powerled` sei aus. Verlangt wird beides: eine
        # ZUSTANDSAUSSAGE (dieselben Marker wie die Haltbarkeit) UND eine
        # Beruehrung mit etwas Gemessenem.
        if beruehrt and any(r.search(text) for r in MARKER_RE.values()):
            nachlese.append({"id": e.get("id"), "titel": e.get("title"),
                             "datum": juengstes_datum(text), "beruehrt": beruehrt})

    nachlese.sort(key=lambda h: (h["datum"] or datetime.date(1970, 1, 1), -len(h["beruehrt"])))
    return hart, nachlese


def schnipsel(text):
    """Alle 8-Wort-Fenster eines Koerpers, als Hashes.

    WOZU: Die Titel-Aehnlichkeit findet nur Doppelungen, die auch gleich
    HEISSEN. `ablage-besitz-gemessen-e18-stufe2` und
    `resume-wege-gemessen-e18-stufe3` tragen verschiedene Namen und
    wiederholen doch denselben Absatz ueber die zwei Sperrdateien in /tmp —
    das findet nur, wer in die Koerper sieht. Zwei Eintraege, die WORTGLEICH
    dasselbe sagen, sind entweder eine Doppelung oder eine kuenftige
    Widerspruchsstelle: geaendert wird spaeter nur einer von beiden.
    """
    w = re.findall(r"[a-zäöüß0-9_./-]+", (text or "").lower())
    return {hash(tuple(w[i:i + FENSTER])) for i in range(max(0, len(w) - FENSTER + 1))}


# ═══ Die Pruefung ══════════════════════════════════════════════════════════
def pruefen(pfad):
    roh = pfad.read_text(encoding="utf-8")
    daten = yaml.safe_load(roh) or {}
    eintraege = daten.get("entries") or []
    ids = [e.get("id") for e in eintraege]
    bekannt = {i for i in ids if i}

    hart = []   # (Ueberschrift, [Zeilen])
    weich = []

    # ── HART 1: Verweise ins Leere in den LISTENFELDERN ────────────────────
    leer = []
    krumm = []
    ziele = 0
    for e in eintraege:
        for feld in VERWEISFELDER:
            wert = e.get(feld)
            if wert is None:
                continue
            if isinstance(wert, str):
                wert = [wert]
            if not isinstance(wert, list):
                krumm.append(f"{e.get('id')}: {feld} ist weder Liste noch Text ({type(wert).__name__})")
                continue
            for ziel in wert:
                ziele += 1
                if ziel not in bekannt:
                    leer.append(f"{e.get('id')}   {feld}: -> {ziel}")
    if leer:
        hart.append((
            f"VERWEIS INS LEERE in {'/'.join(VERWEISFELDER)} — {len(leer)} von {ziele} Zielen "
            "(die Textpruefung sieht Listen nicht):", leer))
    if krumm:
        hart.append(("VERWEISFELD MIT FALSCHER FORM:", krumm))

    # ── HART 2: Pflichtangaben ────────────────────────────────────────────
    for feld in IMMER:
        fehlt = [str(e.get("id") or f"(Eintrag Nr. {n})")
                 for n, e in enumerate(eintraege, 1) if not e.get(feld)]
        if fehlt:
            hinweis = {
                "kind": " — fuer jeden Filter nach Art unsichtbar, der Installer laedt sie nie",
                "id": " — auf ihn kann nichts verweisen",
                "title": " — er hat keinen Namen in der Uebersicht",
            }.get(feld, "")
            hart.append((f"OHNE {feld}: {len(fehlt)} {'Eintrag' if len(fehlt) == 1 else 'Eintraege'}{hinweis}", fehlt))

    # ── HART 3: Die Art verspricht etwas, das nicht da ist ────────────────
    for art, (pflicht, gruppen) in ART_BRAUCHT.items():
        treffer = []
        for e in eintraege:
            if e.get("kind") != art:
                continue
            fehlt = [f for f in pflicht if not e.get(f)]
            for g in gruppen:
                if not any(e.get(f) for f in g):
                    fehlt.append("|".join(g))
            if fehlt:
                treffer.append(f"{e.get('id')}   fehlt: {', '.join(fehlt)}")
        if treffer:
            warum = {
                "signature": "eine Signatur IST ihr Muster — ohne `match` loest sie nie aus",
                "config": "eine Config-Regel ohne Datei/Bedingung laesst sich nicht anwenden",
                "optim": "eine Optimierung ohne Vorher/Nachher ist eine Meinung",
                "perf": "ohne `action` kann niemand sie ausfuehren",
            }.get(art, "")
            hart.append((f"kind: {art} — {len(treffer)} unvollstaendig ({warum}):", treffer))

    # ── WEICH 1: ohne Quelle ──────────────────────────────────────────────
    ohne_quelle = [str(e.get("id")) for e in eintraege if not e.get("source")]
    if ohne_quelle:
        weich.append((
            f"OHNE QUELLE: {len(ohne_quelle)} von {len(eintraege)} — nicht nachpruefbar, "
            "und beim naechsten Zweifel nicht wiederherstellbar:", ohne_quelle))

    # ── WEICH 2: Inseln ───────────────────────────────────────────────────
    # Ein Eintrag, auf den nichts zeigt und der auf nichts zeigt, wird nur
    # gefunden, wer schon weiss, dass es ihn gibt.
    eingang = collections.Counter()
    for e in eintraege:
        for feld in VERWEISFELDER:
            wert = e.get(feld) or []
            if isinstance(wert, str):
                wert = [wert]
            if isinstance(wert, list):
                eingang.update(z for z in wert if z in bekannt)
    txt_verweise = set()
    modul = wiki_schau_laden()
    if modul:
        for _, ziel, _ in modul.verweise(roh):
            if ziel in bekannt:
                txt_verweise.add(ziel)
    inseln = []
    for e in eintraege:
        i = e.get("id")
        raus = any(e.get(f) for f in VERWEISFELDER)
        koerper = str(e.get("body") or "")
        raus = raus or "[[" in koerper
        if not raus and not eingang[i] and i not in txt_verweise:
            inseln.append(f"{i}   ({e.get('kind') or 'ohne Art'})")
    if inseln:
        weich.append((
            f"INSEL: {len(inseln)} {'Eintrag' if len(inseln) == 1 else 'Eintraege'} ohne Verweis hinein UND hinaus — "
            "auffindbar nur ueber Volltext:", inseln))

    # ── WEICH 3: Schlagwort-Drift ─────────────────────────────────────────
    schlag = collections.Counter()
    nicht_text = []
    for e in eintraege:
        for t in (e.get("tags") or []):
            if not isinstance(t, str):
                nicht_text.append(f"{e.get('id')}: {t!r} ({type(t).__name__})")
            schlag[str(t)] += 1
    if nicht_text:
        weich.append((
            f"SCHLAGWORT IST KEIN TEXT: {len(nicht_text)} Stellen — YAML macht aus `2026` eine "
            "ZAHL, aus `'2026'` einen Text; beide Formen stehen in der Datei. "
            "tools/wiki-suche.py biegt das ab (`str(t).lower()`), jeder andere Leser mit "
            "`'2026' in tags` findet sie nicht:",
            nicht_text[:12] + ([f"... und {len(nicht_text) - 12} weitere"] if len(nicht_text) > 12 else [])))
    # dasselbe Wort in zwei Schreibweisen
    nach_form = collections.defaultdict(set)
    for t in schlag:
        nach_form[t.lower().replace("-", "").replace("_", "")].add(t)
    doppelform = [f"{' / '.join(sorted(v))}" for v in nach_form.values() if len(v) > 1]
    if doppelform:
        weich.append((
            f"SCHLAGWORT IN ZWEI SCHREIBWEISEN: {len(doppelform)} — wer nach der einen sucht, "
            "verfehlt die andere:", doppelform))
    einmal = sorted(t for t, n in schlag.items() if n == 1)
    if einmal:
        weich.append((
            f"SCHLAGWORT NUR EINMAL VERGEBEN: {len(einmal)} von {len(schlag)} — "
            "ordnet nichts, kostet aber beim Suchen Zeit:", einmal))

    # ── WEICH 4: Art-Drift ────────────────────────────────────────────────
    arten = collections.Counter(e.get("kind") for e in eintraege if e.get("kind"))
    selten = [f"{k} ({n}x): " + ", ".join(e.get("id") for e in eintraege if e.get("kind") == k)
              for k, n in sorted(arten.items(), key=lambda x: x[1]) if n <= 3]
    if selten:
        weich.append((
            f"ART NUR EIN- BIS DREIMAL VERGEBEN — {len(arten)} Arten insgesamt; "
            "wer nach `falle` filtert, findet `gotcha` nicht:", selten))

    # ── WEICH 5: Aehnlichkeit (moegliche Doppelung) ───────────────────────
    haeufig = haeufige_id_teile([i for i in ids if i])
    paare = []
    vorbereitet = [(e.get("id"),
                    wortmenge(e.get("title")),
                    {w for w in (e.get("id") or "").split("-") if len(w) >= 4 and w not in haeufig})
                   for e in eintraege if e.get("id")]
    for (ia, ta, ka), (ib, tb, kb) in itertools.combinations(vorbereitet, 2):
        if len(ta) < 2 or len(tb) < 2:
            continue
        jt, jk = jaccard(ta, tb), jaccard(ka, kb)
        if jt >= 0.5 or jk >= 0.6:
            paare.append((round(max(jt, jk), 2), ia, ib))
    paare.sort(reverse=True)
    if paare:
        weich.append((
            f"AEHNLICH IM NAMEN — {len(paare)} Paare, die dieselbe Sache zweimal erzaehlen "
            "KOENNTEN (Titel- bzw. id-Ueberschneidung; nur ein Mensch entscheidet das):",
            [f"{s}   {a}   ||   {b}" for s, a, b in paare]))

    # ── WEICH 6: wortgleiche Passage in zwei Koerpern ─────────────────────
    koerper = [(e.get("id"), schnipsel(e.get("body"))) for e in eintraege if e.get("body")]
    gleich = []
    for (ia, sa), (ib, sb) in itertools.combinations(koerper, 2):
        ue = len(sa & sb)
        if ue >= 15:
            gleich.append((ue, ia, ib))
    gleich.sort(reverse=True)
    if gleich:
        weich.append((
            f"WORTGLEICHE PASSAGE — {len(gleich)} Paare teilen sich einen ganzen Absatz "
            "(Zahl = uebereinstimmende 8-Wort-Fenster). Wer spaeter EINEN davon berichtigt, "
            "hinterlaesst einen Widerspruch:",
            [f"{n:4d}   {a}   ||   {b}" for n, a, b in gleich]))

    # ── Haltbarkeit ───────────────────────────────────────────────────────
    haltbarkeit = []
    for e in eintraege:
        text = yaml.safe_dump(e, allow_unicode=True, sort_keys=False)
        treffer = [k for k, r in MARKER_RE.items() if r.search(text)]
        if not treffer:
            continue
        haltbarkeit.append({
            "id": e.get("id"),
            "titel": e.get("title"),
            "datum": juengstes_datum(text),
            "marker": treffer,
        })
    # aelteste zuerst; ohne Datum ganz nach oben (nichts sagt, wann das galt)
    haltbarkeit.sort(key=lambda h: (h["datum"] or datetime.date(1970, 1, 1), -len(h["marker"])))

    zahlen = {
        "fassung": daten.get("version"),
        "eintraege": len(eintraege),
        "verweisziele": ziele,
        "mit_datum": sum(1 for h in haltbarkeit if h["datum"]),
    }
    return hart, weich, haltbarkeit, zahlen


def block_drucken(befunde, grenze):
    """`grenze` = 0 heisst: alles.

    WARUM UEBERHAUPT GEKUERZT WIRD: die weiche Liste „Schlagwort nur einmal
    vergeben" hat 181 Zeilen. Ungekuerzt schiebt sie alles andere aus dem
    Bild, und was man scrollen muss, liest man nicht. Die ZAHL steht in der
    Ueberschrift und ist der eigentliche Befund; die Beispiele darunter
    sollen nur zeigen, wovon die Rede ist.
    """
    for ueberschrift, zeilen in befunde:
        print(ueberschrift)
        zeige = zeilen if not grenze else zeilen[:grenze]
        for z in zeige:
            print(f"    {z}")
        if len(zeige) < len(zeilen):
            print(f"    ... und {len(zeilen) - len(zeige)} weitere (--alles zeigt sie)")
        print()


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--datei", help="Pfad zu pack.yaml oder zum Wiki-Repo")
    p.add_argument("--pruefen", action="store_true", help="still; Ende 1 bei HARTEM Befund")
    p.add_argument("--kurz", action="store_true", help="nur Zahlen und harte Befunde")
    p.add_argument("--alles", action="store_true", help="lange Listen ungekuerzt")
    p.add_argument("--haltbarkeit", action="store_true",
                   help="nur die Nachlese-Reihenfolge der Zustandsaussagen")
    p.add_argument("--zeigen", type=int, default=40,
                   help="wie viele Zeilen der Haltbarkeitsliste (0 = alle)")
    p.add_argument("--gegen-box", nargs="?", const="dietpi@192.168.178.169", metavar="ZIEL",
                   help="den Stand LESEND von der Box holen und danebenlegen")
    p.add_argument("--stand", metavar="DATEI",
                   help="einen frueher gespeicherten Stand nehmen (statt --gegen-box)")
    p.add_argument("--stand-schreiben", metavar="DATEI",
                   help="den geholten Stand als JSON ablegen (ohne Geheimnisse)")
    a = p.parse_args()

    modul = wiki_schau_laden()
    if modul is None:
        print("tools/wiki-schau.py fehlt — die Textpruefung entfaellt, die Feldpruefung laeuft")
        pfad = pathlib.Path(a.datei or "").expanduser()
        if pfad.is_dir():
            pfad = pfad / "pack.yaml"
        if not pfad.is_file():
            return 1
    else:
        try:
            pfad = modul.wiki_finden(a.datei)
        except FileNotFoundError as e:
            print(e)
            return 1
        if pfad is None:
            # Kein Fehler: das Wissenspaket ist ein eigenes Repo nebenan.
            print("Wissenspaket nicht gefunden (llmwiki_mupibox/pack.yaml neben diesem Repo, "
                  "oder MUPI_WIKI setzen) — uebersprungen")
            return 0

    try:
        hart, weich, haltbarkeit, zahlen = pruefen(pfad)
    except yaml.YAMLError as e:
        print(f"{pfad}: nicht einmal gueltiges YAML\n{e}")
        return 1

    # ── Der Stand der Box, wenn einer verlangt ist ────────────────────────
    stand = None
    if a.stand:
        stand = json.loads(pathlib.Path(a.stand).read_text(encoding="utf-8"))
    elif a.gegen_box:
        try:
            stand = stand_holen(a.gegen_box)
        except Exception as e:  # Box aus, Netz weg, kein Schluessel
            print(f"Stand der Box nicht zu holen ({e}) — der Rest laeuft trotzdem\n")
    if stand and a.stand_schreiben:
        pathlib.Path(a.stand_schreiben).write_text(
            json.dumps(stand, indent=1, ensure_ascii=False), encoding="utf-8")

    nachlese = []
    if stand:
        eintraege = (yaml.safe_load(pfad.read_text(encoding="utf-8")) or {}).get("entries") or []
        box_hart, nachlese = gegen_stand(eintraege, stand)
        if box_hart:
            # In `hart` einreihen, damit `--pruefen` daran rot wird.
            hart.append(("SAGT „GIBT ES NICHT\" — UND SIE LIEGT DA "
                         f"({len(box_hart)}; die einzige Form ohne Spielraum):", box_hart))

    if a.haltbarkeit:
        print("HALTBARKEIT — Zustandsaussagen, aelteste zuerst. KEINE Fehlerliste:")
        print("eine Ursache gilt weiter, ein Zustand gilt bis zum naechsten Schreibzugriff.")
        print(f"{len(haltbarkeit)} von {zahlen['eintraege']} Eintraegen machen mindestens eine.\n")
        for h in (haltbarkeit if a.zeigen == 0 else haltbarkeit[:a.zeigen]):
            d = h["datum"].isoformat() if h["datum"] else "ohne Datum"
            print(f"  {d}  [{len(h['marker'])}]  {h['id']}")
            print(f"              {h['titel']}")
            print(f"              {', '.join(h['marker'])}")
        return 0

    if not a.pruefen:
        print(f"Wissenspaket — {pfad}")
        print(f"Fassung {zahlen['fassung']}, {zahlen['eintraege']} Eintraege, "
              f"{zahlen['verweisziele']} Ziele in related/siehe")
        print()

        if modul:
            text_befunde, _ = modul.pruefen(pfad)
            if text_befunde:
                print("── aus wiki-schau.py (Textpruefung) ──")
                print("\n".join(text_befunde))
                print()

        print("══ HART — ohne Kenntnis des Inhalts entscheidbar ══")
        print()
        if hart:
            block_drucken(hart, 0 if a.alles or not a.kurz else 5)
        else:
            print("nichts.\n")

        if not a.kurz:
            print("══ WEICH — ein Mensch muss entscheiden ══")
            print()
            block_drucken(weich, 0 if a.alles else 15)

            print("══ HALTBARKEIT ══")
            print(f"{len(haltbarkeit)} Eintraege machen eine Zustandsaussage, "
                  f"{zahlen['mit_datum']} davon mit Datum.")
            print("Die zehn aeltesten (ganze Liste mit --haltbarkeit):")
            for h in haltbarkeit[:10]:
                d = h["datum"].isoformat() if h["datum"] else "ohne Datum"
                print(f"  {d}  [{len(h['marker'])}]  {h['id']}")
            print()

        if stand:
            print(f"══ GEGEN DIE BOX ══  {stand.get('host')}, gemessen {stand.get('gemessen')}")
            print(f"{len(stand.get('dienste') or {})} Dienste, "
                  f"{len(stand.get('schluessel') or {})} Schluessel, "
                  f"{len(stand.get('dateien') or {})} Ablagen gelesen.")
            print(f"{len(nachlese)} Eintraege machen eine Zustandsaussage UND sprechen ueber "
                  "etwas, das gerade gemessen wurde.")
            print("KEIN URTEIL — der Messwert steht daneben, aeltester Eintrag zuerst. "
                  "is-active/is-enabled sind ZWEI Angaben:")
            for h in (nachlese if a.zeigen == 0 else nachlese[:a.zeigen]):
                d = h["datum"].isoformat() if h["datum"] else "ohne Datum"
                print(f"  {d}  {h['id']}")
                print(f"              {h['titel']}")
                for b in h["beruehrt"][:6]:
                    print(f"              · {b}")
                if len(h["beruehrt"]) > 6:
                    print(f"              · … und {len(h['beruehrt']) - 6} weitere")
            if a.zeigen and len(nachlese) > a.zeigen:
                print(f"  … und {len(nachlese) - a.zeigen} weitere (--zeigen 0 zeigt alle)")

    if hart:
        if a.pruefen:
            for ueberschrift, zeilen in hart:
                print(ueberschrift)
                for z in zeilen:
                    print(f"    {z}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
