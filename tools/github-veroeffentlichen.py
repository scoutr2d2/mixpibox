#!/usr/bin/env python3
"""EINEN KURATIERTEN STAND NACH GITHUB VEROEFFENTLICHEN — ohne die Geschichte umzuschreiben.

WOZU
Der Fork liegt vollstaendig auf den eigenen Ablagen (NAS, Maschinen): jede
Fassung, jedes Rohrender, jedes CAD-Modell, 420 MB im Arbeitsbaum und 670 MB
Geschichte. Nach GitHub soll davon nur das, was man WIRKLICH braucht.
Betreiber, 23.09.2026: „die modelle muessen nicht mit, nur software und
wichtige bestandteile wie icons, aber auch nicht die sourcen, nur das benutzte
muss auf github. auf die lokalen nas und maschinen git repos geht alles."

WARUM NICHT EINFACH `git push github main`
Weil die GESCHICHTE die Dateien traegt, nicht der Arbeitsbaum. Ein `.gitignore`
von heute entfernt kein Modell aus dem Commit von gestern — gepusht wuerden
trotzdem alle Blobs. Und die Geschichte umzuschreiben (filter-repo) waere der
teuerste aller Wege: jede Kennung aendert sich, und die anderen Ablagen (nas,
origin) haetten danach ein anderes Repo vor sich.

DER WEG STATTDESSEN: ein EIGENER Zweig `veroeffentlichung`, dessen erster
Commit elternlos ist. Sein Baum zeigt auf die SCHON VORHANDENEN Blobs des
Arbeitsstands — es wird nichts kopiert und nichts neu gepackt. Gepusht werden
dann genau die Objekte, die dieser eine Baum braucht. Jede weitere
Veroeffentlichung haengt einen Commit an, sodass GitHub eine Reihe von
Veroeffentlichungen sieht (und der naechste Push nur das Geaenderte traegt).

WAS ES NICHT TUT
  * Es fasst den Arbeitsbaum NICHT an: kein checkout, kein Loeschen, kein Stash.
    Gearbeitet wird ueber einen eigenen Index in /tmp.
  * Es pusht nur mit `--push`, nie mit `--force`, und nie auf `origin`/`nas`.
  * Es entscheidet nichts selbst: was draussen bleibt, steht in
    `tools/github-ausschluss.txt` — mit Grund, Zeile fuer Zeile.

AUFRUF
    python3 tools/github-veroeffentlichen.py                 # Trockenlauf
    python3 tools/github-veroeffentlichen.py --liste         # jede Datei einzeln
    python3 tools/github-veroeffentlichen.py --bauen         # Commit anlegen
    python3 tools/github-veroeffentlichen.py --bauen --push  # und hochladen
    python3 tools/github-veroeffentlichen.py --fern github --zweig main
    python3 tools/github-veroeffentlichen.py --baum-ohne-aufnahme "<Grund>"   # nur Baum ohne Lokales

DER OHNE-AUFNAHME-SCHUTZ IST PFLICHT (29.09.2026, Audit vom 28.09., §1b Rang 4)
Zwei lokale Dateien tragen die Zusage „GitHub ohne Aufnahme": der Patch
`tools/github-ohne-aufnahme.patch` (nimmt die Verdrahtung der Erweiterung aus
dem Kern) und `tools/github-lokal-muster.txt` (Leck-Muster, die selbst nicht
hinaus sollen). Bis zum 29.09. waren beide STILL OPTIONAL: fehlte der Patch,
ging der ungepatchte Stand hinaus, und die Berichtszeile schwieg, weil sie nur
bei mehr als 0 Pfaden erschien; fehlte die Musterdatei, lief die Leck-Wache
mit einem Muster weniger. Jetzt bricht JEDER Lauf ab (auch der Trockenlauf,
damit die Doku-Probe es meldet), wenn eine der beiden fehlt oder leer ist.

Der Abbruch haengt an nichts im Baum — nicht am Ordner der Erweiterung, nicht
an einem Namen. Eine Bedingung „nur wenn der Plugin-Ordner da ist" verschwaende
genau dann, wenn jemand die Erweiterung umbenennt, und die Verdrahtung ginge
weiter still hinaus. Vorbei kommt nur ein ausdruecklicher Schalter fuer einen
Baum, der GAR NICHTS Lokales traegt (ein Klon von GitHub):
    --baum-ohne-aufnahme "<Grund, mindestens drei Woerter>"
Er wird verweigert, sobald die Haus-Ausschlussliste in diesem Baum auch nur
eine Datei zurueckhielte: das Merkmal ist die SORTE „Baum mit Lokalem", und es
wird staerker, je mehr Lokales drin liegt, nicht schwaecher. Und er wird
verweigert, wenn Patch und Muster da sind — kein Schalter fuer jeden Aufruf.

WAS DER SCHUTZ NICHT FINDET — die bekannte Restluecke (nachgemessen 29.09.2026)
Der Patch kennt nur die Verdrahtung, die es beim Erzeugen gab. NEUE
Verdrahtung in einer Datei, die er nicht aendert, geht unveraendert hinaus, und
die zwei lokalen Muster fangen sie nicht auf: sie suchen BESCHREIBUNGSTEXT,
keine Verdrahtung — ein Aufnahme-Wort und einen Dienstnamen als ganze Woerter
in EINER Zeile, ohne Punkt dazwischen, hoechstens 60 Zeichen auseinander
(Aufnahme-Wort zuerst) bzw. 40 (Dienstname zuerst). Durch gehen damit: jeder
Import und Pfad der Erweiterung ohne Dienstnamen daneben; Bezeichner, in denen
beide Woerter zusammenkleben (camelCase, snake_case — kein Wortrand);
Member-Zugriffe (der Punkt beendet das Fenster); Komposita wie
Aufnahme+Funktion; abgetrennte Verbteile („zeichnet ... auf", „schneidet ...
mit"); ein Zeilenumbruch zwischen beiden Woertern; englische Woerter ausser
recording/record. Wer Verdrahtung ergaenzt, erneuert den Patch (--patch-aus);
das faengt keine Wache ab. Auch die Installationswache nicht: ein Import der
zurueckgehaltenen Erweiterung ist fuer sie kein fehlender Pfad.

DIE WACHE DARIN (und der Grund, warum das Werkzeug ueberhaupt eines ist statt
einer Befehlszeile): Bevor irgendetwas gebaut wird, liest es die
INSTALLATIONSREZEPTE und `autosetup/autosetup.sh` und prueft, dass JEDE Quelle,
die sie aus dem Repo holen, im veroeffentlichten Stand auch WIRKLICH liegt. Ein
Ausschluss, der die Installation aushebelt, faellt damit hier auf — und nicht
erst auf der Karte eines Fremden, wo er sich als „diese Schritte laufen ins
Leere" meldet.
"""
import argparse
import fnmatch
import os
import re
import subprocess
import sys
import tempfile

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUSSCHLUSS = os.path.join(WURZEL, "tools", "github-ausschluss.txt")
ZWEIG_LOKAL = "veroeffentlichung"


def git(*args, **kw):
    """git aufrufen und die Ausgabe zurueckgeben (Fehler werden geworfen)."""
    r = subprocess.run(["git", "-C", WURZEL, *args], capture_output=True, text=True, **kw)
    if r.returncode != 0:
        raise SystemExit(f"  ABBRUCH: git {' '.join(args)} -> {r.stderr.strip()}")
    return r.stdout


def muster_lesen(pfad):
    """Die Ausschlussliste lesen -> [(muster, grund)] in Dateireihenfolge."""
    raus = []
    with open(pfad, encoding="utf-8") as f:
        for zeile in f:
            zeile = zeile.rstrip("\n")
            if not zeile.strip() or zeile.lstrip().startswith("#"):
                continue
            muster, _, grund = zeile.partition("#")
            muster = muster.strip()
            if muster:
                raus.append((muster, grund.strip()))
    return raus


def passt(pfad, muster):
    """Deckt `muster` den Pfad ab? Ein Verzeichnis-Muster deckt alles darunter.

    REIN, damit es sich testen laesst — und weil genau hier ein Fehler teuer
    waere: ein zu weites Muster laesst still etwas Wichtiges weg.
    """
    m = muster.rstrip("/")
    if pfad == m or pfad.startswith(m + "/"):
        return True
    if fnmatch.fnmatch(pfad, muster) or fnmatch.fnmatch(pfad, muster + "/*"):
        return True
    # Ein Muster mit Platzhalter darf auch einen Ordner treffen (AUDIT-*.md
    # trifft keine Ordner, aber z.B. `bin/librespot/dev_*` schon).
    return fnmatch.fnmatch(pfad, m + "/*")


def dateien_lesen():
    """Alle GETRACKTEN Dateien -> [(mode, sha, pfad)].

    Bewusst `git ls-files -s` und nicht der Arbeitsbaum: veroeffentlicht wird,
    was im Index steht — sonst wanderte unversehentlich etwas Unversioniertes
    mit, und eine Aenderung, die nur im Arbeitsbaum liegt, fiele stillschweigend
    heraus.
    """
    raus = []
    for zeile in git("ls-files", "-s").splitlines():
        kopf, _, pfad = zeile.partition("\t")
        mode, sha, _stufe = kopf.split()
        raus.append((mode, sha, pfad))
    return raus


# ══ DIE WACHE: WAS DIE INSTALLATION AUS DEM REPO HOLT ═══════════════════════
#
# Die Rezepte holen Dateien ueber `${MUPI_REPO:-$HOME/Downloads/mixpibox}/<pfad>`,
# autosetup.sh ueber `${MUPI_SRC}/<pfad>`. Beides wird hier eingesammelt und
# gegen den veroeffentlichten Stand gehalten. Ein Pfad, der dort gebraucht wird
# und hier fehlt, ist ein Ausschluss zu viel.
RE_REZEPT = re.compile(r"\$\{MUPI_REPO:-[^}]*\}/([A-Za-z0-9_./-]+)")
RE_AUTOSETUP = re.compile(r"\$\{MUPI_SRC\}/([A-Za-z0-9_./-]+)")


def pflichtpfade(blobs=None):
    """Was Rezepte und autosetup aus dem Repo holen -> {pfad: quelle}.

    `blobs` ({pfad: sha}) liest die Rezepte aus dem VEROEFFENTLICHTEN Stand
    statt von der Platte — noetig, seit der Ohne-Aufnahme-Patch Rezepte
    aendert (27.09.2026): sonst verlangte die Wache Dateien, die der
    veroeffentlichte Stand gar nicht mehr installiert.
    """
    noetig = {}
    kandidaten = [
        os.path.join("remote-step-installer", "recipes", n)
        for n in ("mupibox.yaml", "mupibox-app.yaml", "perf-tune.yaml")
    ] + [os.path.join("autosetup", "autosetup.sh"),
         os.path.join("scripts", "make-boot-sd.sh")]
    for rel in kandidaten:
        if blobs is not None:
            if rel not in blobs:
                continue
            text = subprocess.run(["git", "-C", WURZEL, "cat-file", "-p", blobs[rel]],
                                  capture_output=True, text=True, errors="replace").stdout
        else:
            voll = os.path.join(WURZEL, rel)
            if not os.path.isfile(voll):
                continue
            text = open(voll, encoding="utf-8", errors="replace").read()
        for re_ in (RE_REZEPT, RE_AUTOSETUP):
            for treffer in re_.findall(text):
                # NORMALISIEREN, SONST MELDET DIE WACHE GESPENSTER: In
                # autosetup.sh steht `cp ... ${MUPI_SRC}/config/fernbedienungen/.`
                # — der Punkt ist die cp-Schreibweise fuer „der Ordner selbst",
                # nicht Teil des Pfades. Ohne normpath sucht die Wache nach
                # „config/fernbedienungen/." und findet es nie: ein roter Punkt,
                # der auf nichts zeigt (gefunden beim ersten Lauf, 23.09.2026).
                p = os.path.normpath(treffer)
                # Variablen im Pfad (z.B. `${VARIANTE}`) sind hier schon raus,
                # weil das Muster nur harmlose Zeichen zulaesst. Ein Pfad, der
                # aus dem Repo herausfuehrt, wird nicht geprueft.
                if p.startswith("..") or os.path.isabs(p):
                    continue
                noetig.setdefault(p, rel)
    return noetig


# ══ BILDQUELLEN, DIE TROTZ AUSSCHLUSS MITMUESSEN ════════════════════════════
#
# `NewDesign/bilder/quellen/` sind 117 KI-Rohrender, 126 MB — Quellmaterial,
# das nicht auf GitHub gehoert. ABER: 34 davon werden NAMENTLICH gebraucht, und
# das faellt beim Ausschliessen nicht auf.
#
#   * `NewDesign/maskottchen.json` nennt je Zustand ein `quelle`-Feld (25 Namen)
#     und wird SELBST auf die Karte ausgeliefert; `tools/maskottchen-bauen.py`
#     liest daraus `quellordner` und erzeugt die Figuren daraus neu.
#   * `remote-step-installer/tools/sdstart-bilder.py` fuehrt eine Tabelle mit
#     den Bildern des SD-Assistenten (Willkommen, WLAN, Karte, Fertig, …) und
#     ist zugleich die Wache darueber, dass die ausgelieferten Bilder noch zu
#     ihren Quellen passen. Fehlen die Quellen, meldet sie ROT — ein Klon von
#     GitHub lieferte also eine Wache aus, die garantiert falsch steht.
#
# GEFUNDEN von der Gegenprobe der Inventur am 23.09.2026, die genau diesen
# pauschalen Ausschluss widerlegt hat. Statt 34 Dateinamen in die
# Ausschlussliste zu schreiben (die dann beim naechsten Maskottchen veraltet),
# werden sie HIER GEMESSEN und zurueckgeholt. Wer ein Bild in maskottchen.json
# eintraegt, muss nichts weiter tun.
RE_PNG = re.compile(r"[\'\"]([A-Za-z0-9_.()\- ]+\.png)[\'\"]")


def bildquellen_noetig():
    """Welche Dateien unter bilder/quellen/ werden namentlich gebraucht?"""
    noetig = set()
    mk = os.path.join(WURZEL, "NewDesign", "maskottchen.json")
    if os.path.isfile(mk):
        import json as _json
        karte = _json.load(open(mk, encoding="utf-8"))
        ordner = karte.get("quellordner", "bilder/quellen/")

        def sammeln(o):
            if isinstance(o, dict):
                q = o.get("quelle")
                if isinstance(q, str) and q:
                    noetig.add("NewDesign/" + ordner + q)
                for v in o.values():
                    sammeln(v)
            elif isinstance(o, list):
                for v in o:
                    sammeln(v)
        sammeln(karte)
    sd = os.path.join(WURZEL, "remote-step-installer", "tools", "sdstart-bilder.py")
    if os.path.isfile(sd):
        text = open(sd, encoding="utf-8", errors="replace").read()
        for name in RE_PNG.findall(text):
            kand = "NewDesign/bilder/quellen/" + name
            if os.path.exists(os.path.join(WURZEL, kand)):
                noetig.add(kand)
    return noetig


# ══ DIE WACHE IN DIE ANDERE RICHTUNG: WAS NICHT HINAUS DARF ═════════════════
#
# Bis zum 23.09.2026 fragte dieses Werkzeug nur „fehlt etwas, das die
# Installation braucht?" — die Frage „ist etwas drin, das nicht hinaus darf?"
# stellte nichts. Die gegnerische Nachpruefung fand daraufhin im
# veroeffentlichten Baum einen ECHTEN Jellyfin-API-Schluessel (in einer
# Testdatei, samt Serveradresse) und die BSSID des Heim-WLANs (ueber
# oeffentliche WLAN-Ortungsdatenbanken auf eine Hausadresse aufloesbar). Beides
# haette ein Mensch vorher sehen muessen — und hat es nicht.
#
# Geprueft wird der INHALT der Blobs, die hinausgehen — nicht der Arbeitsbaum.
# Ein Treffer bricht ab. Was absichtlich so aussieht, steht in der
# Ausnahmeliste, mit Grund — und seit dem 29.09.2026 je (datei, muster).
LECK_MUSTER = [
    # (name, muster) — Muster laufen ueber den Text jedes Blobs
    ("API-Schluessel als Parameter", re.compile(r"(?i)(api_key|apikey|x-emby-token|access_token|client_secret)[=\": ]+[a-z0-9]{24,}")),
    ("Bearer-Token", re.compile(r"Bearer\s+[A-Za-z0-9._-]{30,}")),
    ("privater Schluessel", re.compile(r"-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----")),
    # NUR QUOTIERTE LITERALE: `psk="…"` wie in wpa_supplicant.conf. Eine
    # Code-Zuweisung `psk = psk_aus(…)` ist kein Schluessel — die erste Fassung
    # meldete zwei davon (sdwlan.py, einrichtung-schirm.py) als Leck.
    ("WLAN-Schluessel", re.compile(r"(?m)^\s*#?\s*(psk|wpa_passphrase|passphrase)\s*[=:]\s*[\"'](?!HIER|<|\$|\{)[^\"'\s]{8,}[\"']")),
    ("bcrypt-Abdruck", re.compile(r"\$2[aby]\$\d{2}\$(?!abcdef)[A-Za-z0-9./]{20,}")),
    # DIE BSSID STEHT HIER NICHT MEHR, AUCH NICHT HALB. Die erste Fassung
    # (23.09.2026) schrieb sie aus; die zweite nannte noch das Herstellerpraefix
    # des Routers — die halbe BSSID ging mit diesem Werkzeug hinaus, und die
    # SSID desselben Netzes stand in keinem Muster. Seit dem 29.09.2026 stehen
    # SSID, BSSID und ein generisches MAC-Muster in tools/github-lokal-muster.txt
    # (Audit 28.09.2026 §1b Rang 1): die SORTE statt des einen Werts.
    ("Spotify-Zugang", re.compile(r"(?i)(spotify[_-]?(client[_-]?secret|refresh[_-]?token))[=\": ]+[a-z0-9_-]{20,}")),
]
# JE (DATEI, MUSTER), NIE DATEIWEIT (29.09.2026). Bis dahin hiess ein Eintrag
# „diese Datei wird gar nicht abgetastet" — ausgerechnet dieses Werkzeug stand
# darin, und ein echter Schluessel hier ginge ungeprueft hinaus. Ein Paar
# befreit nur SEIN Muster; alle anderen tasten die Datei weiter ab. Ein Paar,
# das nichts mehr befreit, bricht die Veroeffentlichung ab — eine Ausnahme
# ohne Anlass ist eine offene Tuer fuer den naechsten echten Wert derselben
# Sorte. Leer, weil heute keine Datei eine braucht: das Werkzeug traegt seine
# Muster, ohne sich selbst zu treffen, und die WLAN-Vorlage faellt mit ihrem
# Platzhalter HIER-DAS-KENNWORT unter die Ausnahme IM Muster.
LECK_AUSNAHMEN = {
    # ("pfad/zur/datei", "Name des Musters"): "Grund",
}


# ══ ZUSAETZLICHE MUSTER, DIE SELBST NICHT HINAUS SOLLEN (27.09.2026) ═════════
#
# Manche Wortfolgen sollen nicht nach GitHub — dann darf auch das Muster, das
# sie findet, nicht hinaus (seit dem 29.09.2026 auch SSID, BSSID und das
# generische MAC-Muster). Sie stehen deshalb in `tools/github-lokal-muster.txt`,
# und diese Datei steht in der Ausschlussliste. Liegt sie nicht da, laeuft nur
# der Selbsttest mit den Mustern oben (so auf GitHub); eine VEROEFFENTLICHUNG
# bricht dann ab (schutz_luecken/schutz_pruefen) — bis zum 29.09.2026 lief sie
# still mit einem Muster weniger. Format je Zeile:
#     muster: <name> | <regulaerer Ausdruck>
#     treffer: <text, den das Muster davor finden MUSS>
#     kein: <text, den es NICHT finden darf>
LOKAL_MUSTER = os.path.join(WURZEL, "tools", "github-lokal-muster.txt")


def lokale_muster_lesen(pfad=LOKAL_MUSTER):
    """-> [(name, muster, [(text, erwartet, zeilennummer), ...])], leer ohne Datei."""
    if not os.path.exists(pfad):
        return []
    raus = []
    with open(pfad, encoding="utf-8") as f:
        for nr, zeile in enumerate(f, 1):
            zeile = zeile.rstrip("\n")
            art, _, rest = zeile.partition(":")
            rest = rest.strip()
            if art == "muster":
                name, _, ausdruck = rest.partition("|")
                raus.append((name.strip(), re.compile(ausdruck.strip()), []))
            elif art in ("treffer", "kein") and raus:
                raus[-1][2].append((rest, art == "treffer", nr))
    return raus


LECK_MUSTER += [(n, m) for n, m, _f in lokale_muster_lesen()]


# ══ DER OHNE-AUFNAHME-PATCH (27.09.2026) ══════════════════════════════════════
#
# Betreiber: die Aufnahme-Erweiterung bleibt lokal — „aber nur fuer github"
# soll sie verschwinden, samt ihrer Verdrahtung im Kern (Tonweg, zweiter
# Strom, Vorlage, Verwaltungsseite). Die Erweiterung selbst haelt die
# Ausschlussliste zurueck; die Verdrahtung steckt aber in Dateien, die hinaus
# MUESSEN. Deshalb ein Patch, der NUR hier wirkt: er wird im Zwischenindex auf
# den kuratierten Stand angewendet, der Arbeitsbaum bleibt unberuehrt.
#
# ER ENTSTEHT AUS EINEM ZWEIG: `github-ohne-aufnahme` traegt ueber `main` den
# Commit, der die Verdrahtung entfernt (mit gruenen Tests auf diesem Stand).
#     python3 tools/github-veroeffentlichen.py --patch-aus github-ohne-aufnahme
# schreibt daraus tools/github-ohne-aufnahme.patch (selbst ausgeschlossen).
# Passt er nicht mehr auf `main`, bricht die Veroeffentlichung ab: dann den
# Zweig auf `main` neu aufsetzen, Tests laufen lassen, Patch erneuern. Fehlt er
# oder ist er leer, bricht sie seit dem 29.09.2026 ebenso ab (schutz_pruefen).
PATCH_OHNE = os.path.join(WURZEL, "tools", "github-ohne-aufnahme.patch")


def _rel(pfad):
    return os.path.relpath(pfad, WURZEL)


def schutz_luecken(patch=PATCH_OHNE, muster_pfad=LOKAL_MUSTER):
    """Was am Ohne-Aufnahme-Schutz fehlt -> [text mit Anleitung], leer = vollstaendig.

    „Da" heisst: die Datei liegt vor UND traegt etwas. Ein leerer Patch schuetzt
    so wenig wie ein fehlender (`--patch-aus` schreibt ihn leer, wenn der Zweig
    nichts Eigenes aendert), eine Musterdatei ohne `muster:`-Zeile so wenig wie
    keine. Umbenannt heisst hier ebenfalls „fehlt" — dann die Konstante
    nachziehen, nicht den Schutz aussetzen.
    """
    luecken = []
    rp = _rel(patch)
    erneuern = ("Zweig github-ohne-aufnahme auf main neu aufsetzen, pruefen, dann  "
                "python3 tools/github-veroeffentlichen.py --patch-aus github-ohne-aufnahme")
    if not os.path.exists(patch):
        luecken.append(f"{rp} fehlt (umbenannt? dann PATCH_OHNE nachziehen) -> {erneuern}")
    elif not open(patch, encoding="utf-8", errors="replace").read().strip():
        luecken.append(f"{rp} ist leer -> {erneuern}")
    rm = _rel(muster_pfad)
    if not os.path.exists(muster_pfad):
        luecken.append(f"{rm} fehlt -> aus der Geschichte zurueckholen:  git log --oneline -- {rm}")
    elif not lokale_muster_lesen(muster_pfad):
        luecken.append(f"{rm} traegt kein Muster (keine Zeile  muster: <name> | <ausdruck>)")
    return luecken


def lokales_im_baum(alle, noetig):
    """Was die HAUS-Ausschlussliste in diesem Baum zurueckhielte -> [pfad].

    Bewusst die Hausliste, nicht die per --ausschluss gegebene: sonst machte
    eine leere Probe-Liste aus dem eigenen Baum einen „Baum ohne Lokales".
    Namentlich gebrauchte Bildquellen zaehlen nicht — sie gehen ohnehin mit.
    """
    haus = muster_lesen(AUSSCHLUSS)
    return [p for _m, _s, p in alle
            if p not in noetig and any(passt(p, m) for m, _g in haus)]


def schutz_pruefen(luecken, grund, lokales):
    """-> True, wenn der Schutz ausdruecklich ausgesetzt ist; False, wenn er steht.

    Alles andere ist ein Abbruch (SystemExit). Die Texte bleiben kurz, weil
    doku-luecken-probe.sh vom Trockenlauf nur die letzten sechs Zeilen zeigt.
    """
    schalter = "--baum-ohne-aufnahme"
    if grund is None:
        if not luecken:
            return False
        raise SystemExit(
            "  ABBRUCH: der Ohne-Aufnahme-Schutz ist unvollstaendig — ohne ihn ginge die\n"
            "  Verdrahtung der lokalen Aufnahme-Erweiterung mit nach GitHub.\n"
            + "".join(f"    - {l}\n" for l in luecken)
            + f'  Nur ein Baum GANZ ohne Lokales (Klon von GitHub) nimmt stattdessen  {schalter} "<Grund>".')
    if not luecken:
        raise SystemExit(f"  ABBRUCH: {schalter} ohne Anlass — Patch und Muster liegen da, der Schutz "
                         "laeuft. Den Schalter weglassen.")
    if len(grund.split()) < 3:
        raise SystemExit(f"  ABBRUCH: {schalter} braucht eine Begruendung in mindestens drei Woertern, "
                         f"warum dieser Baum keine Aufnahme traegt (bekommen: {grund!r}).")
    if lokales:
        beispiele = ", ".join(lokales[:3]) + (" ..." if len(lokales) > 3 else "")
        raise SystemExit(
            f"  ABBRUCH: {schalter} gilt nur fuer einen Baum ohne Lokales — die Ausschlussliste\n"
            f"  haelt hier {len(lokales)} Dateien zurueck ({beispiele}).\n"
            "  Das ist ein Baum mit Lokalem, und genau der braucht den Schutz:\n"
            + "".join(f"    - {l}\n" for l in luecken).rstrip("\n"))
    return True


def patch_aus_zweig(zweig, ziel=PATCH_OHNE):
    """Den Patch als das schreiben, was `zweig` SELBST aendert.

    DREI PUNKTE, nicht zwei: `HEAD zweig` naehme alles mit, was auf main seit
    dem Abzweigen dazukam — und der Patch naehme es beim Veroeffentlichen
    still wieder zurueck.
    """
    # WAS DIE AUSSCHLUSSLISTE OHNEHIN ZURUECKHAELT, GEHOERT NICHT IN DEN PATCH:
    # im Zweig liegt z.B. die Erweiterung geloescht (damit ihre Tests den
    # veroeffentlichten Stand abbilden) — im Zwischenindex gibt es sie gar
    # nicht, und `git apply` scheiterte an der Loeschung.
    muster = muster_lesen(AUSSCHLUSS)
    pfade = [p for p in git("diff", "--name-only", "--no-renames", f"HEAD...{zweig}").splitlines()
             if p and not any(passt(p, m) for m, _g in muster)]
    if not pfade:
        text = ""
    else:
        text = git("diff", "--binary", "--no-renames", f"HEAD...{zweig}", "--", *pfade)
    with open(ziel, "w", encoding="utf-8") as f:
        f.write(text)
    return text.count("\ndiff --git ") + (1 if text.startswith("diff --git ") else 0)


def patch_anwenden(drin, patch=PATCH_OHNE, fehlen_erlaubt=False):
    """-> (neues drin, Anzahl geaenderter Pfade) oder SystemExit, wenn er fehlt oder nicht passt.

    FEHLEN IST KEIN „nichts zu tun": bis zum 29.09.2026 gab diese Funktion
    ohne Datei still den ungepatchten Stand zurueck. `main` prueft vorher mit
    schutz_pruefen; der Abbruch HIER haelt auch jeden anderen Rufer auf. Nur
    ein ausdruecklich ausgesetzter Schutz (fehlen_erlaubt) kommt ohne durch.
    """
    if not os.path.exists(patch):
        if fehlen_erlaubt:
            return drin, 0
        raise SystemExit(f"  ABBRUCH: {_rel(patch)} fehlt — ohne ihn ginge die Verdrahtung "
                         "der lokalen Aufnahme-Erweiterung mit hinaus.")
    with tempfile.TemporaryDirectory(prefix="ghpatch-") as tmp:
        umg = dict(os.environ, GIT_INDEX_FILE=os.path.join(tmp, "index"))
        ein = "".join(f"{mode} {sha}\t{pfad}\n" for mode, sha, pfad, _g in drin)
        subprocess.run(["git", "-C", WURZEL, "update-index", "--index-info"],
                       input=ein, capture_output=True, text=True, env=umg, check=True)
        r = subprocess.run(["git", "-C", WURZEL, "apply", "--cached", patch],
                           capture_output=True, text=True, env=umg)
        if r.returncode != 0:
            raise SystemExit(
                "  ABBRUCH: der Ohne-Aufnahme-Patch passt nicht mehr auf diesen Stand.\n"
                f"  {r.stderr.strip()}\n"
                "  Zweig github-ohne-aufnahme auf main neu aufsetzen, Tests, dann\n"
                "  python3 tools/github-veroeffentlichen.py --patch-aus github-ohne-aufnahme")
        aus = subprocess.run(["git", "-C", WURZEL, "ls-files", "-s"],
                             capture_output=True, text=True, env=umg, check=True).stdout
    vorher = {p: (m, s_) for m, s_, p, _g in drin}
    neu = []
    for zeile in aus.splitlines():
        kopf, pfad = zeile.split("\t", 1)
        mode, sha, _stufe = kopf.split()
        neu.append((mode, sha, pfad, None))
    danach = {p: (m, s_) for m, s_, p, _g in neu}
    anders = {p for p in set(vorher) | set(danach) if vorher.get(p) != danach.get(p)}
    return neu, len(anders)


def leck_funde(pfad, text, muster=None, ausnahmen=None):
    """Einen Text gegen die Muster halten -> ([(name, zeile, fund)], {genutzte Paare}). Rein.

    Eine Ausnahme befreit nur ihr (pfad, name)-Paar; ein Pfad allein als
    Schluessel befreit nichts — die alte dateiweite Form ginge damit nicht
    still weiter, sondern fiele als Treffer auf.
    """
    muster = LECK_MUSTER if muster is None else muster
    ausnahmen = LECK_AUSNAHMEN if ausnahmen is None else ausnahmen
    funde, genutzt = [], set()
    for name, m in muster:
        f = m.search(text)
        if not f:
            continue
        if (pfad, name) in ausnahmen:
            genutzt.add((pfad, name))
            continue
        funde.append((name, text.count("\n", 0, f.start()) + 1, f.group(0)[:60]))
    return funde, genutzt


def lecks_suchen(drin):
    """Jeden veroeffentlichten Blob gegen LECK_MUSTER halten -> ([(pfad, name, zeile, fund)], {genutzte Paare})."""
    funde, genutzt = [], set()
    for _mode, sha, pfad, _g in drin:
        # Binaeres ueberspringen: Bilder, Archive, Binaerstaende.
        if pfad.endswith((".png", ".jpg", ".jpeg", ".woff2", ".zip", ".tgz", ".gz",
                          ".wav", ".mp3", ".ico", ".skp", ".stl", ".f3z", ".xcf")) \
                or pfad.startswith("bin/librespot/") or pfad.startswith("bin/fbv/"):
            continue
        r = subprocess.run(["git", "-C", WURZEL, "cat-file", "-p", sha],
                           capture_output=True)
        try:
            text = r.stdout.decode("utf-8")
        except UnicodeDecodeError:
            continue
        f, g = leck_funde(pfad, text)
        funde += [(pfad, *e) for e in f]
        genutzt |= g
    return funde, genutzt


def ausnahmen_maengel(ausnahmen=None, muster=None):
    """Was an LECK_AUSNAHMEN zu breit oder falsch ist -> [text], leer = in Ordnung. Rein.

    Zu breit: ein Schluessel ohne Muster (die alte dateiweite Form), ein
    Platzhalter in Pfad oder Name, ein Ordner statt einer Datei. Falsch: ein
    Muster, das es nicht gibt — der Tippfehler befreit nichts, taeuscht aber
    eine begruendete Ausnahme vor. Doppelte Musternamen machten ein Paar
    mehrdeutig.
    """
    ausnahmen = LECK_AUSNAHMEN if ausnahmen is None else ausnahmen
    muster = LECK_MUSTER if muster is None else muster
    namen = [n for n, _m in muster]
    maengel = [f"Mustername doppelt: {n!r}" for n in sorted(set(namen)) if namen.count(n) > 1]
    for s in ausnahmen:
        if not (isinstance(s, tuple) and len(s) == 2 and all(isinstance(x, str) and x for x in s)):
            maengel.append(f"{s!r} ist kein (datei, muster)-Paar")
            continue
        pfad, name = s
        if any(z in pfad + name for z in "*?[") or pfad.endswith("/"):
            maengel.append(f"{s!r}: Platzhalter oder Ordner statt einer Datei und eines Musters")
        if name not in namen:
            maengel.append(f"{s!r}: ein Muster {name!r} gibt es nicht")
    return maengel


# ══ WER STEHT AUF DEM COMMIT? ═══════════════════════════════════════════════
#
# Die beiden ersten Veroeffentlichungen (23.09.2026) trugen die git-Identitaet
# dieses Rechners — und die ist die DIENSTLICHE des Betreibers (Name mit
# Abteilungskuerzel, Firmen-E-Mail). Auf einem privaten GitHub-Konto ist das
# falsch, und GitHub konnte den Commit nicht einmal dem Konto zuordnen.
#
# Deshalb entscheidet nicht `git config`, sondern die Gegenstelle: der
# Kontoname aus der URL (github.com/<konto>/<repo>) und dessen noreply-Adresse
# `<konto>@users.noreply.github.com` — die GitHub selbst fuer Commits ohne
# oeffentliche E-Mail vorsieht und dem Konto zuordnet. `--autor "Name <mail>"`
# setzt etwas anderes.
def konto_der_gegenstelle(fern):
    """Der Kontoname aus der URL der Gegenstelle -> str oder ''."""
    r = subprocess.run(["git", "-C", WURZEL, "remote", "get-url", fern],
                       capture_output=True, text=True)
    m = re.search(r"github\.com[:/]([^/]+)/", r.stdout or "")
    return m.group(1) if m else ""


def commit_identitaet(fern, vorgabe=""):
    """(name, mail) fuer Autor UND Committer des Veroeffentlichungs-Commits."""
    if vorgabe:
        m = re.match(r"\s*(.+?)\s*<([^>]+)>\s*$", vorgabe)
        if not m:
            raise SystemExit("  ABBRUCH: --autor braucht die Form  Name <mail>")
        return m.group(1), m.group(2)
    konto = konto_der_gegenstelle(fern)
    if not konto:
        raise SystemExit(f"  ABBRUCH: aus der URL von '{fern}' ist kein GitHub-Konto zu lesen — --autor setzen")
    return konto, f"{konto}@users.noreply.github.com"


def groesse(shas):
    """Summe der Blob-Groessen in Byte — gemessen, nicht geschaetzt."""
    if not shas:
        return 0
    ein = "\n".join(shas) + "\n"
    aus = subprocess.run(["git", "-C", WURZEL, "cat-file", "--batch-check=%(objectsize)"],
                         input=ein, capture_output=True, text=True)
    return sum(int(z) for z in aus.stdout.split() if z.isdigit())


def mb(n):
    return f"{n / 1_000_000:.1f} MB"


# ══ SELBSTTEST DER MUSTERLOGIK ══════════════════════════════════════════════
#
# WARUM HIER UND NICHT IN tools/: `passt()` ist der Ort, an dem ein Fehler still
# teuer wird. Ein zu weites Muster laesst etwas Wichtiges weg, ein zu enges
# schleppt 130 MB Rohrender mit — beides sieht man dem Trockenlauf nicht an,
# wenn man nicht genau hinsieht. Der Test laeuft mit `--selbsttest` und haengt
# in `tools/doku-luecken-probe.sh` mit drin.
def ganzes_plugin_raus(pfad, raus_pfade, veroeffentlicht):
    """Liegt `pfad` in einem Plugin-Ordner, der GANZ zurueckgehalten wird?"""
    teile = pfad.split("/")
    if len(teile) < 3 or teile[0] != "plugins":
        return False
    praefix = "/".join(teile[:2]) + "/"
    return not any(p.startswith(praefix) for p in veroeffentlicht)


def selbsttest():
    faelle = [
        # (pfad, muster, erwartet)
        ("3D-Design/v1/x.skp", "3D-Design/", True),
        ("3D-Designs/x.md", "3D-Design/", False),          # Praefix, aber anderer Ordner
        ("NewDesign/bilder/quellen/a.png", "NewDesign/bilder/quellen/", True),
        ("NewDesign/bilder/figuren/a.png", "NewDesign/bilder/quellen/", False),
        ("AUDIT-2026-09-20.md", "AUDIT-*.md", True),
        ("dokumentation/AUDIT-alt.md", "AUDIT-*.md", False),   # nur in der Wurzel
        ("bin/librespot/0.5.0/librespot-64bit", "bin/librespot/0.5.0/", True),
        ("bin/librespot/0.8.0/librespot-arm64", "bin/librespot/0.5.0/", False),
        ("bin/librespot/dev_0.6_20250305/x", "bin/librespot/dev_*", True),
        ("bin/nodejs/deploy.zip", "bin/librespot/", False),
        ("README.md", "README.md", True),
    ]
    schlecht = 0
    for pfad, muster, erwartet in faelle:
        ist = passt(pfad, muster)
        gut = ist is erwartet
        schlecht += (not gut)
        print(("  OK   " if gut else "  FAIL ") + f"{muster!r} deckt {pfad!r} -> {ist} (erwartet {erwartet})")
    # Die lokalen Muster bringen ihre Faelle selbst mit (beide Richtungen).
    # Gezeigt wird die ZEILE des Falls, nicht sein Text: die Treffer-Faelle
    # tragen das Geheimnis selbst (die SSID), und diese Ausgabe landet bei
    # einem Fehler ganz in der Doku-Probe — und von dort in der naechsten
    # Buchung (29.09.2026, llmwiki audit-buchung-ist-veroeffentlichungs-inhalt).
    gesamt = len(faelle)
    for name, muster, texte in lokale_muster_lesen():
        for text, erwartet, nr in texte:
            ist = bool(muster.search(text))
            gut = ist is erwartet
            schlecht += (not gut)
            gesamt += 1
            print(("  OK   " if gut else "  FAIL ") + f"{name}: {_rel(LOKAL_MUSTER)}:{nr} "
                  f"({'treffer' if erwartet else 'kein'}) -> {ist}")
    # Die Ausnahmen der Leck-Wache: je (datei, muster), nie dateiweit.
    maengel = ausnahmen_maengel()
    gesamt += 1
    schlecht += bool(maengel)
    for m in maengel:
        print(f"  FAIL LECK_AUSNAHMEN: {m}")
    if not maengel:
        print(f"  OK   LECK_AUSNAHMEN: {len(LECK_AUSNAHMEN)} Paare, jedes (datei, muster), Mustername eindeutig")
    print(f"\n{gesamt - schlecht}/{gesamt} bestanden")
    return 1 if schlecht else 0


def main():
    ap = argparse.ArgumentParser(
        description="Kuratierten Stand nach GitHub veroeffentlichen",
        epilog="Ohne tools/github-ohne-aufnahme.patch oder tools/github-lokal-muster.txt bricht jeder "
               "Lauf ab. Restluecke: NEUE Verdrahtung in Dateien, die der Patch nicht kennt, faengt "
               "keine Wache — die lokalen Muster suchen nur Beschreibungstext (Aufnahme-Wort und "
               "Dienstname in einer Zeile, 60/40 Zeichen). Einzelheiten im Kopf des Werkzeugs.")
    ap.add_argument("--bauen", action="store_true", help="Commit auf dem Zweig anlegen")
    ap.add_argument("--push", action="store_true", help="danach hochladen (setzt --bauen voraus)")
    ap.add_argument("--liste", action="store_true", help="jede veroeffentlichte Datei einzeln zeigen")
    ap.add_argument("--fern", default="github", help="Name der Gegenstelle (Vorgabe: github)")
    ap.add_argument("--zweig", default="main", help="Zweig auf der Gegenstelle (Vorgabe: main)")
    ap.add_argument("--nachricht", default="", help="Commit-Nachricht (sonst wird eine gebaut)")
    ap.add_argument("--autor", default="",
                    help='Identitaet des Commits als "Name <mail>" (Vorgabe: GitHub-Konto der Gegenstelle + noreply-Adresse)')
    ap.add_argument("--ausschluss", default=AUSSCHLUSS,
                    help="andere Ausschlussliste (fuer Proben; Vorgabe: tools/github-ausschluss.txt)")
    ap.add_argument("--patch-aus", default="", metavar="ZWEIG",
                    help="tools/github-ohne-aufnahme.patch aus dem, was ZWEIG seit dem Abzweigen aendert, erneuern und beenden")
    ap.add_argument("--selbsttest", action="store_true",
                    help="nur die reinen Teile pruefen (Musterlogik) und beenden")
    ap.add_argument("--baum-ohne-aufnahme", default=None, metavar="GRUND",
                    help="Ohne-Aufnahme-Schutz aussetzen, NUR fuer einen Baum ganz ohne Lokales "
                         "(Klon von GitHub); verweigert, sobald die Ausschlussliste hier etwas "
                         "zurueckhielte oder Patch und Muster da sind")
    a = ap.parse_args()
    if a.push:
        a.bauen = True                       # --push ohne --bauen tat still nichts
    if a.fern in ("origin", "nas", "upstream"):
        ap.error(f"'{a.fern}' ist eine der eigenen Ablagen (oder der Ursprung) — dorthin geht der ganze Baum, nicht ein Auszug")

    if a.selbsttest:
        return selbsttest()
    if a.patch_aus:
        n = patch_aus_zweig(a.patch_aus)
        print(f"{os.path.relpath(PATCH_OHNE, WURZEL)}: {n} Dateien aus {a.patch_aus}")
        return 0

    muster = muster_lesen(a.ausschluss)
    alle = dateien_lesen()

    drin, raus = [], []
    for mode, sha, pfad in alle:
        grund = next((g or "(ohne Grund)" for m, g in muster if passt(pfad, m)), None)
        (raus if grund else drin).append((mode, sha, pfad, grund))

    # Namentlich gebrauchte Bildquellen zurueckholen (siehe bildquellen_noetig).
    noetig = bildquellen_noetig()
    zurueck = [e for e in raus if e[2] in noetig]
    if zurueck:
        raus = [e for e in raus if e[2] not in noetig]
        drin += [(m, s, p, None) for m, s, p, _g in zurueck]

    # Der Ohne-Aufnahme-Schutz ist Pflicht — geprueft, BEVOR irgendetwas
    # gezaehlt, gedruckt oder gebaut wird. Die Hausliste wird nur gelesen, wenn
    # jemand den Schalter setzt (siehe lokales_im_baum). Eigener Name, weil die
    # Schleifen weiter unten `grund` fuer den Ausschlussgrund benutzen.
    schalter_grund = a.baum_ohne_aufnahme
    lokales = lokales_im_baum(alle, noetig) if schalter_grund is not None else []
    ausgesetzt = schutz_pruefen(schutz_luecken(), schalter_grund, lokales)

    # Der Ohne-Aufnahme-Patch — VOR allen Zaehlungen und Wachen, damit beide
    # den Stand pruefen, der wirklich hinausgeht.
    drin, gepatcht = patch_anwenden(drin, fehlen_erlaubt=ausgesetzt)

    g_drin = groesse([s for _m, s, _p, _g in drin])
    g_raus = groesse([s for _m, s, _p, _g in raus])

    print("── Was nach GitHub ginge ──────────────────────────────────────────")
    if zurueck:
        print(f"  zurueckgeholt   : {len(zurueck):5d} Dateien   {mb(groesse([s for _m, s, _p, _g in zurueck])):>10s}"
              f"   (namentlich gebraucht: maskottchen.json / sdstart-bilder.py)")
    print(f"  veroeffentlicht : {len(drin):5d} Dateien   {mb(g_drin):>10s}")
    print(f"  zurueckgehalten : {len(raus):5d} Dateien   {mb(g_raus):>10s}")
    # IMMER GEDRUCKT, auch bei 0: die Zeile belegt, dass der Schritt lief. Bis
    # zum 29.09.2026 erschien sie nur bei mehr als 0 — ein Leser konnte
    # „Patch fehlte" nicht von „Patch-Schritt gibt es nicht" unterscheiden.
    print(f"  Ohne-Aufnahme-Patch: {gepatcht} Pfade geaendert oder entfernt"
          + (f" — SCHUTZ AUSGESETZT, Baum ohne Aufnahme: {schalter_grund}" if ausgesetzt
             else f"   ({_rel(PATCH_OHNE)})"))
    print(f"  lokale Leck-Muster: {len(lokale_muster_lesen())}   ({_rel(LOKAL_MUSTER)})")
    print()

    # Je Top-Pfad, damit man auf einen Blick sieht, wo das Gewicht liegt.
    je_top = {}
    for _m, sha, pfad, grund in drin + raus:
        top = pfad.split("/")[0]
        e = je_top.setdefault(top, {"drin": 0, "raus": 0, "shas_drin": [], "shas_raus": []})
        if grund:
            e["raus"] += 1
            e["shas_raus"].append(sha)
        else:
            e["drin"] += 1
            e["shas_drin"].append(sha)
    print("── Je Top-Pfad ────────────────────────────────────────────────────")
    zeilen = []
    for top, e in je_top.items():
        zeilen.append((groesse(e["shas_drin"]), top, e))
    for gd, top, e in sorted(zeilen, reverse=True):
        gr = groesse(e["shas_raus"])
        hinweis = f"   (zurueck: {e['raus']} Dateien, {mb(gr)})" if e["raus"] else ""
        print(f"  {mb(gd):>10s}  {e['drin']:5d}  {top}{hinweis}")
    print()

    print("── Zurueckgehalten, mit Grund ─────────────────────────────────────")
    je_grund = {}
    for _m, sha, pfad, grund in raus:
        je_grund.setdefault(grund, []).append((pfad, sha))
    for grund, eintraege in sorted(je_grund.items(), key=lambda x: -len(x[1])):
        gs = groesse([s for _p, s in eintraege])
        print(f"  {len(eintraege):4d} Dateien  {mb(gs):>10s}  {grund}")
    print()

    # ── DIE WACHE ──────────────────────────────────────────────────────────
    veroeffentlicht = {p for _m, _s, p, _g in drin}
    ordner = {os.path.dirname(p) for p in veroeffentlicht}
    for p in list(ordner):
        teile = p.split("/")
        for i in range(1, len(teile) + 1):
            ordner.add("/".join(teile[:i]))
    fehlt = []
    blobs = {p: s_ for _m, s_, p, _g in drin}
    pflicht = pflichtpfade(blobs)
    for pfad, quelle in sorted(pflicht.items()):
        if pfad in veroeffentlicht or pfad in ordner:
            continue
        # Nur melden, was es im Repo ueberhaupt gibt — ein Rezept darf auf etwas
        # zeigen, das erst beim Bau entsteht (z.B. eine erzeugte Datei).
        if os.path.exists(os.path.join(WURZEL, pfad)):
            fehlt.append((pfad, quelle))
    # ORDNER-PFLICHTEN GELTEN GANZ: autosetup und die Rezepte kopieren
    # `scripts/`, `plugins/`, `config/templates/` als GANZE Ordner. Eine
    # einzige ueberlebende Datei darin genuegte der Wache bisher — obwohl der
    # Ausschluss einer Datei darunter auf der Box fehlen wuerde. Deshalb: liegt
    # eine zurueckgehaltene Datei unter einem Pflicht-Ordner, ist das ein Fehler.
    #
    # EINE AUSNAHME, UND NUR EINE (27.09.2026): unter `plugins/` ist die
    # Einheit der Installation das einzelne Plugin — mixpi-plugins-nachziehen.sh
    # zieht jedes fuer sich nach. Fehlt ein Plugin GANZ, hat die Box es eben
    # nicht; kaputt waere nur ein HALBES. Zurueckgehalten werden darf also ein
    # ganzer Plugin-Ordner, nie ein Teil davon.
    pflicht_ordner = {p for p in pflicht if os.path.isdir(os.path.join(WURZEL, p))}
    raus_pfade = {p for _m, _s, p, _g in raus}
    for _m, _s, pfad, grund in raus:
        for po in pflicht_ordner:
            if pfad == po or pfad.startswith(po + "/"):
                if ganzes_plugin_raus(pfad, raus_pfade, veroeffentlicht):
                    continue
                fehlt.append((pfad, f"liegt unter dem Pflicht-Ordner {po}, den die Installation ganz kopiert"))
    print("── Wache: holt die Installation etwas, das nicht mitkaeme? ────────")
    if fehlt:
        for pfad, quelle in fehlt:
            print(f"  FEHLT  {pfad}   (gebraucht von {quelle})")
        print()
        print("  ABBRUCH: ein Ausschluss wuerde die Installation aushebeln.")
        return 1
    print(f"  alle {len(pflicht)} Quellen der Rezepte/autosetup sind dabei.")
    print()

    print("── Wache: geht etwas hinaus, das nicht hinaus darf? ────────────────")
    lecks, genutzt = lecks_suchen(drin)
    # Der Fund nur ANGESCHNITTEN (29.09.2026): Datei und Zeile reichen zum
    # Finden. Der volle Wert in dieser Ausgabe landete sonst per Kopieren in
    # der naechsten Buchung — so ist die SSID von vier auf sechs Stellen
    # gewachsen (llmwiki audit-buchung-ist-veroeffentlichungs-inhalt).
    if lecks:
        for pfad, name, zeile, fund in lecks:
            print(f"  LECK   {pfad}:{zeile}  {name}: {fund[:6]!r}…")
        print()
        print("  ABBRUCH: erst entfernen oder in LECK_AUSNAHMEN begruenden.")
        return 1
    ohne_anlass = sorted(set(LECK_AUSNAHMEN) - genutzt, key=repr)
    if ohne_anlass:
        for s in ohne_anlass:
            print(f"  AUSNAHME OHNE ANLASS  {s!r}")
        print()
        print("  ABBRUCH: diese Paare befreien nichts mehr — aus LECK_AUSNAHMEN streichen.")
        return 1
    print(f"  {len(drin)} Blobs gegen {len(LECK_MUSTER)} Muster gehalten, kein Treffer.")
    print()

    if a.liste:
        for _m, _s, pfad, _g in sorted(drin, key=lambda x: x[2]):
            print(f"  {pfad}")
        print()

    if not a.bauen:
        print("Trockenlauf. Mit --bauen wird der Commit angelegt.")
        return 0

    # ── DEN BAUM BAUEN, OHNE DEN ARBEITSBAUM ANZUFASSEN ────────────────────
    kopf = git("rev-parse", "HEAD").strip()
    zweig_da = subprocess.run(["git", "-C", WURZEL, "rev-parse", "--verify", "-q", ZWEIG_LOKAL],
                              capture_output=True, text=True).returncode == 0
    eltern = git("rev-parse", ZWEIG_LOKAL).strip() if zweig_da else ""

    with tempfile.TemporaryDirectory(prefix="ghveroeff-") as tmp:
        idx = os.path.join(tmp, "index")
        umg = dict(os.environ, GIT_INDEX_FILE=idx)
        ein = "".join(f"{mode} {sha}\t{pfad}\n" for mode, sha, pfad, _g in drin)
        r = subprocess.run(["git", "-C", WURZEL, "update-index", "--index-info"],
                           input=ein, capture_output=True, text=True, env=umg)
        if r.returncode != 0:
            raise SystemExit(f"  ABBRUCH: update-index -> {r.stderr.strip()}")
        baum = subprocess.run(["git", "-C", WURZEL, "write-tree"],
                              capture_output=True, text=True, env=umg).stdout.strip()

    if eltern:
        alter_baum = git("rev-parse", f"{ZWEIG_LOKAL}^{{tree}}").strip()
        if alter_baum == baum:
            print(f"Nichts zu tun: der Zweig {ZWEIG_LOKAL} traegt diesen Stand schon ({eltern[:8]}).")
            return 0

    nachricht = a.nachricht or (
        f"Veroeffentlichung aus {kopf[:8]}\n\n"
        f"Kuratierter Stand: {len(drin)} Dateien ({mb(g_drin)}).\n"
        f"Zurueckgehalten: {len(raus)} Dateien ({mb(g_raus)}) — Quellmaterial und\n"
        f"unbenutzte Binaerstaende; die Gruende stehen in tools/github-ausschluss.txt.\n"
        f"Die vollstaendige Geschichte liegt auf den eigenen Ablagen, nicht hier.\n"
    )
    name, mail = commit_identitaet(a.fern, a.autor)
    umg_id = dict(os.environ, GIT_AUTHOR_NAME=name, GIT_AUTHOR_EMAIL=mail,
                  GIT_COMMITTER_NAME=name, GIT_COMMITTER_EMAIL=mail)
    befehl = ["git", "-C", WURZEL, "commit-tree", baum, "-m", nachricht] + (["-p", eltern] if eltern else [])
    r = subprocess.run(befehl, capture_output=True, text=True, env=umg_id)
    if r.returncode != 0:
        raise SystemExit(f"  ABBRUCH: commit-tree -> {r.stderr.strip()}")
    commit = r.stdout.strip()
    print(f"Commit als: {name} <{mail}>")
    git("update-ref", f"refs/heads/{ZWEIG_LOKAL}", commit)
    print(f"Commit {commit[:8]} auf {ZWEIG_LOKAL}"
          + (f" (auf {eltern[:8]})" if eltern else " (elternlos, erste Veroeffentlichung)"))

    if not a.push:
        print(f"\nHochladen mit:  git push {a.fern} {ZWEIG_LOKAL}:{a.zweig}")
        return 0

    fernen = git("remote").split()
    if a.fern not in fernen:
        print(f"  ABBRUCH: die Gegenstelle '{a.fern}' gibt es nicht. Anlegen mit:\n"
              f"      git remote add {a.fern} https://github.com/<benutzer>/<repo>.git")
        return 1
    print(f"\nHochladen nach {a.fern} {ZWEIG_LOKAL}:{a.zweig} …")
    r = subprocess.run(["git", "-C", WURZEL, "push", a.fern, f"{ZWEIG_LOKAL}:{a.zweig}"],
                       capture_output=True, text=True)
    sys.stdout.write(r.stdout)
    sys.stderr.write(r.stderr)
    return r.returncode


if __name__ == "__main__":
    sys.exit(main())
