#!/usr/bin/env python3
"""DOKU-PFADE — zeigt die Doku noch auf Dateien, die es gibt?

WARUM ES DAS GIBT (23.08.2026): `tools/doku-luecken-probe.sh` fuehrt zwoelf
Wachen, und alle zwoelf fragen DIESELBE Frage in eine Richtung — steht der
Name aus dem Code irgendwo in einem Handbuch? Keine fragt die Gegenrichtung:
GIBT ES NOCH, WORAUF DIE DOKU ZEIGT?

Der Unterschied ist nicht akademisch. Ein Handbuch, das ein neues Plugin nicht
nennt, ist unvollstaendig — der Leser merkt es und sucht weiter. Ein
Wiki-Eintrag, der zum Nachmessen `tools/rechte-am-geraet.sh <adresse>`
empfiehlt, ist SCHLIMMER als unvollstaendig: der Leser tippt es ab, bekommt
"No such file", und weiss nun weder, ob die Messung je stattfand, noch wie er
sie wiederholt. Genau dieser Fall stand im Paket (`endpunkt-ohne-sudo-\
schaltet-nichts-und-sagt-ok`) — in einem Eintrag, der schon eine Korrektur
einer falschen Zustandsaussage traegt.

── DREI FUNDE BEIM ERSTEN LAUF ────────────────────────────────────────────
  tools/rechte-am-geraet.sh          gibt es nirgends im Baum
  src/backend-api/src/mitschnittliste.ts  -> plugins/mixpi-mitschnitt/liste.mjs
  scripts/mupibox/mqtt.py            -> scripts/mqtt/mqtt.py  (vertauscht)
  scripts/mupi-lautstaerke.sh        -> scripts/mupibox/mupi-lautstaerke.sh

Der zweite ist der lehrreiche: die Warteliste aus E66 ist aus dem KERN in ein
PLUGIN gewandert. Wer dem Wiki folgt, sucht ein Stueck Architektur an dem Ort,
an dem es nicht mehr wohnt — und schliesst daraus womoeglich, dass es es nicht
mehr gibt.

── DIE ZWEITE KLASSE: MEHRDEUTIG STATT TOT ────────────────────────────────
Am 10.08.2026 sind `remote-step-installer/` und `llmwiki/` per `git subtree`
in den Hauptbaum gezogen (siehe ZUGEZOGEN.md, STILLGELEGT.md im alten Repo).
Damit wurde ein `tools/qr.py`, das im alten, EIGENEN Installer-Repo eindeutig
war, im Hauptbaum zweideutig: `tools/` gibt es hier auch — mit 440 anderen
Dateien und ohne qr.py. Siebzehn solcher Pfade standen im Paket.

Das ist keine Kosmetik, sondern die Umzugs-Schuld: ein Pfad, der auf den
falschen echten Ordner zeigt, faellt niemandem auf. Er wird abgetippt, findet
nichts, und der Leser haelt den Eintrag fuer alt. Deshalb ist MEHRDEUTIG hier
eine Luecke und keine Warnung.

── WARUM ES EINE AUSNAHMELISTE BRAUCHT, UND WARUM SIE BEGRUENDET IST ───────
Drei Sorten Pfad stehen zu Recht in der Doku, ohne im Baum zu liegen:
  * PLATZHALTER aus Anleitungen (`plugins/mupibox-meinequelle` entsteht erst,
    wenn der Leser das Geruest-Werkzeug aufruft),
  * LAUFZEITABLAGE (`server/config/*.json` legt die Box an; der Ordner ist
    im Baum leer und wird von git nicht gefuehrt),
  * FREMDER QUELLTEXT (`src/http-manager.js` gehoert der Bibliothek
    spotify-web-api-node und liegt unter node_modules).
Eine Wache ohne diese Liste meldete 21 statt 4 und waere nach dem zweiten Lauf
Rauschen. Jeder Eintrag traegt darum den Grund neben sich — wer ihn nicht
begruenden kann, hat einen Fund und keine Ausnahme.

Aufruf aus dem Wurzelverzeichnis:  python3 tools/doku-pfade-pruefen.py
Rueckgabe: 0 = keine Luecke, 1 = mindestens eine.
"""

import os
import re
import subprocess
import sys
from collections import defaultdict

import yaml

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(WURZEL)

WIKI = "llmwiki/pack.yaml"
# ── WARUM HIER FUENF DATEIEN STEHEN UND NICHT DREI ─────────────────────────
# Bis zum 25.08.2026 las diese Wache nur die ersten drei. `BACKLOG.md` war nie
# dabei, und genau dort ueberlebte `scripts/mupi-lautstaerke.sh` (richtig:
# `scripts/mupibox/…`) die Korrektur, die der Wiki-Eintrag
# `doku-zeigt-auf-dateien-die-es-nicht-gibt` fuer die Handbuecher ausgeloest
# hatte — dieselbe Wache, dieselbe Datei, andere Ablage, ewig gruen.
# `dokumentation/benutzerhandbuch.html` fehlte aus demselben Grund; es meldete
# beim Einhaengen null tote Pfade, das ist die guenstige Haelfte des Befunds.
# llmwiki: `eine-wache-die-eine-ablage-nicht-kennt-meldet-dort-ewig-gruen`.
# ── 27.08.2026: KEINE NAMENSLISTE MEHR, SONDERN DIE SORTE ─────────────────
# Bis heute standen hier SIEBEN Dateien, je eine pro Lauf nachgetragen (drei,
# dann fuenf, dann sieben). Im Baum liegen **49 getrackte `.md`** — die Liste
# deckte 14 % der Prosa ab und wuchs genau dort, wo zufaellig ein Fund lag.
# `MODERNIZATION.md` ist der Tier-A-Einstieg fuer jeden Neuzugang und war nie
# dabei; dort ueberlebte in 8 („Decisive code references") die
# `.js`-Behauptung ueber `backend-player`, die zwei Laeufe in Folge an je zwei
# anderen Stellen korrigiert hatten. Deshalb jetzt die SORTE statt der Namen:
# jede Prosadatei, die `git ls-files` meldet. llmwiki:
# `wache-auf-sorte-nicht-auf-pfad`, `bauanleitung-ist-eine-vierte-sorte-datei`.
#
# `git ls-files` und NICHT `glob`: dieselbe Lehre wie bei
# `simulationsrezept-pruefen.py` — im Arbeitsbaum liegt Ruecklass, der nicht
# zum Repo gehoert (llmwiki: der Fund, dass `os.path.exists` nicht der Baum ist).
PROSA_ZUSATZ = (
    # Kein `.md` und trotzdem Prosa. Das Benutzerhandbuch ist das einzige, das
    # ein Betreiber wirklich liest; die `docker-compose.yml` ist seit dem
    # 26.08. dabei, weil ihre KOMMENTARE gelesen werden wie ein Handbuch (dort
    # sass eine Reparatur "in spotify-control.js", die es so nicht mehr gibt).
    "dokumentation/benutzerhandbuch.html",
    "harness/docker-compose.yml",
)

# ── WAS DIE SORTE AUSSCHLIESST, UND WAS DAS KOSTET ────────────────────────
# `AUDIT-*.md` sind MOMENTAUFNAHMEN mit Datum im Dateinamen. Sie nennen
# Vorschlaege (`tools/wachen_lib.py`), Zwischenstaende und Pfade, deren
# Abwesenheit ihr Befund IST. Nachgemessen am 27.08.2026: 27 der 30 toten
# Pfade der ersten breiten Fassung standen in ihnen — eine Wache, die sie
# einfordert, meldet dauerhaft rot und wird zu Recht ignoriert
# (llmwiki: `dauerrote-wache-ist-keine`). Die Zahl der uebersprungenen Dateien
# wird darum GEMELDET und nicht verschwiegen: ein stiller Ausschluss liest
# sich wie Deckung.
MOMENTAUFNAHME = re.compile(r"(^|/)AUDIT-\d{4}-\d{2}-\d{2}\.md$")


def _prosadateien():
    """Jede getrackte Prosadatei — nicht eine gepflegte Namensliste."""
    aus = subprocess.run(
        ["git", "ls-files", "-z"], capture_output=True, text=True, check=True
    ).stdout.split("\0")
    md = [p for p in aus if p.endswith(".md")]
    uebersprungen = [p for p in md if MOMENTAUFNAHME.search(p)]
    dateien = [p for p in md if p not in uebersprungen]
    dateien += [p for p in PROSA_ZUSATZ if p in aus]
    return sorted(dateien), uebersprungen


HANDBUECHER, MOMENTAUFNAHMEN = _prosadateien()

# ── WAS EINE ABGELEITETE LISTE KOSTET (27.08.2026, in der Gegenprobe gemessen)
# Eine Namensliste kann man nicht versehentlich leeren, eine Ableitung schon.
# Die Gegenprobe (Endung auf `.gibtsnicht` gedreht, also KEINE Prosadatei mehr)
# meldete weiter „KEINE LUECKE": das Wissenspaket liefert allein genug Pfade,
# damit `geprueft > 0` bleibt, und der Wachhund weiter unten schweigt. Ein
# Ausfall der ganzen zweiten Quelle waere unsichtbar gewesen.
#
# Darum dieser Riegel — und ABSICHTLICH keine Mindestzahl: eine festgenagelte
# Zahl (llmwiki `tests-duerfen-keine-zahlen-festnageln`) waere beim naechsten
# neuen `README.md` falsch. Geprueft wird, dass die sechs Ablagen, die es seit
# Jahren gibt und die die frueheren Fassungen von Hand fuehrten, in der
# Ableitung WIRKLICH ankommen.
KERN = (
    "README.md",
    "plugins/README.md",
    "dokumentation/mixpibox.md",
    "BACKLOG.md",
    "dokumentation/benutzerhandbuch.html",
    "harness/README.md",
)

# Die Ordner, unter denen ein Pfad AUSSERDEM liegen darf. Das leere Praefix
# steht zuerst, damit ein Treffer an der Wurzel immer gewinnt.
WEITERE_WURZELN = [
    "",
    "remote-step-installer/",
    "src/backend-api/",
    "src/backend-player/",
    "src/frontend-admin/",
    "src/",
]

# Nur Pfade, die mit einem dieser Ordner beginnen, werden ueberhaupt geprueft.
# Ein `/opt/mupibox-tools/touch-bridge.py` ist ein Pfad AUF DER BOX und hat im
# Baum nichts verloren; eine Wache, die ihn einfordert, meldet ewig rot.
#
# ── 27.08.2026: DIE ZWEITE LISTE, UND SIE WAR DIE TEURERE ─────────────────
# Neun Namen, von Hand gepflegt wie `HANDBUECHER` darueber — und beim
# Verbreitern der ersten faellt auf, dass sie allein NICHTS geheilt haette:
# `NewDesign/` (261 getrackte Dateien, die ganze zweite Oberflaeche) stand
# nicht darin, `themes/` (65) auch nicht. Der Pack-Eintrag
# `laufende-vorschau-teilt-zustand` schickte seit dem 03.08.2026 zum
# Nachmessen in `NewDesign/stil.css` — die Datei hiess NIE so, sie heisst
# `app.css`. Die Quelle wurde die ganze Zeit gelesen; unsichtbar war der Pfad.
# **Eine Wache hat mehr als eine Blindstelle, und die gelesene Quelle
# beweist nichts ueber den gelesenen Pfad.**
#
# Darum auch hier die SORTE: jedes oberste Verzeichnis, das `git ls-files`
# meldet. Ein `/opt/...` oder `~/...` faengt das Muster ohnehin nicht ab
# (der Blick zurueck verbietet `/`, `.` und `-` davor), und ein Verzeichnis,
# das es im Baum gibt, ist per Definition ein Ort, auf den die Doku zeigen
# darf. Dotted Ordner (`.github`, `.claude`) bleiben draussen: dort steht
# kein Fliesstext, und `.claude/worktrees/` ist fremder Ruecklass.
def _oberste():
    aus = subprocess.run(
        ["git", "ls-files", "-z"], capture_output=True, text=True, check=True
    ).stdout.split("\0")
    ordner = {p.split("/")[0] for p in aus if "/" in p and not p.startswith(".")}
    # `server` liegt nicht im Baum (Laufzeitablage der Box), gehoert aber seit
    # der ersten Fassung dazu — siehe LAUFZEIT weiter unten.
    return tuple(sorted(ordner | {"server"}))


OBERSTE = _oberste()

# Derselbe Riegel wie `KERN` fuer die Prosaliste, und aus derselben Gegenprobe:
# `_oberste()` auf die leere Menge gedreht meldete WEITER gruen. Der Wachhund
# unten (`geprueft == 0`) reicht nicht — es blieben ein paar `server/…`-Treffer
# uebrig, und eine Handvoll genuegt ihm. **Eine Ableitung braucht ihren eigenen
# Riegel; der Wachhund der Nachbarliste faengt sie nicht.**
KERN_ORDNER = ("src", "tools", "plugins", "dokumentation", "scripts", "llmwiki")

PFAD = re.compile(r"(?<![\w/.-])((?:" + "|".join(re.escape(o) for o in OBERSTE) + r")/[A-Za-z0-9_@./+-]*[A-Za-z0-9_+-])")

# Siehe Kopfteil: jede Zeile traegt ihren Grund. NICHT als Sammelbecken fuer
# Unbequemes benutzen — ein Pfad, der hier landet, wird nie wieder geprueft.
AUSNAHMEN = {
    "plugins/mupibox-meinequelle": "Platzhalter der Geruest-Anleitung, entsteht erst beim Aufruf",
    "plugins/mupibox-meinequelle/index.spec.mjs": "dito",
    "plugins/mupibox-": "abgeschnittener Prosa-Rumpf aus plugins/README.md",
    "plugins/x": "Platzhalter in einer Befehlszeile",
    "src/meine.integration.spec.ts": "Platzhalter (`meine…`) in einer Aufrufanleitung",
    "src/http-manager.js": "gehoert der Bibliothek spotify-web-api-node (node_modules)",
    "src/audio_backend/rodio.rs": "gehoert dem fremden Projekt librespot",
    "src/app": "Rumpf einer Wegangabe, kein Dateiverweis",
    "remote-step-installer/dateien/systemd": (
        "der Eintrag soloist-fehlte-in-beiden-schalen-wegen sagt SELBST, dass es "
        "dieses Verzeichnis nicht gibt — die Nennung ist die Korrektur"
    ),
    # ── EIN SCHRAEGSTRICH IN PROSA HEISST „ODER" (27.08.2026) ──────────────
    # Erst durch die Verbreiterung auf alle Prosadateien und alle obersten
    # Ordner sichtbar: die haeufigste Nicht-Datei mit einem Schraegstrich ist
    # kein Pfad, sondern eine Aufzaehlung oder ein deutsches Kompositum. Sie
    # sehen einem Pfad zum Verwechseln aehnlich und stehen mitten im Satz.
    # Eine generische Regel dafuer gibt es nicht — `tools/archiv` und
    # `src/gemeinsam` sind ebenso endungslos und ZU RECHT gemeldet —, also je
    # Fall mit Grund. Wer hier etwas eintraegt, liest den Satz vorher.
    "autosetup/update": "zwei Ausrollwege (autosetup ODER update), Trennzeichen",
    "config/sysinfo/diagnose/shutdown": "Aufzaehlung der SSE-Wege des Kerns, kein Ort",
    "src/dest/mode": "die drei Rezept-Schluessel als Synonyme zu von/nach/modus",
    "autosetup/make-boot-sd-Kette": "Kompositum: die Kette rund um make-boot-sd",
    "config/templates-Vorlagen": "Kompositum: Vorlagen aus config/templates",
    # Kein Kompositum, sondern ein Vorschlag mit Fragezeichen daneben
    # („Ein neuer Ordner `src/gemeinsam/`, den beide Frontends importieren —
    # oder ein Server-Endpunkt?"). Wie `plugins/mupibox-meinequelle`: der Ort
    # entsteht erst, wenn jemand die offene Frage entscheidet.
    "src/gemeinsam": "offene Entscheidung in NEUE-OBERFLAECHE-PLAN.md, nichts gebaut",
}

# Laufzeitablage: die Box legt sie an, git fuehrt sie nicht. Als PRAEFIX
# geprueft, weil je Profil eigene Dateien dazukommen.
LAUFZEIT = ("server/config/", "server/profile/")

# ── DERSELBE NAME OBEN IM BAUM UND UNTEN AUF DER BOX (27.08.2026) ─────────
# `config/` ist beides. Im Baum liegen darunter GENAU DREI Ordner
# (`config/services`, `config/templates`, `config/.nano`) — alles andere, was
# die Doku `config/…` nennt, ist die LAUFENDE Ablage der Box
# (`config/data.json`, `config/kinderzeit.json`, die Sicherungskopien vor dem
# Aufraeumen). Die Verbreiterung von OBERSTE meldete sie prompt alle: zehn
# tote und vier „mehrdeutige", von denen keiner ein Fund war — der
# mehrdeutige Zweig zeigte sogar auf `src/backend-api/config/…`, den Ort im
# Baum, den der Leser gerade NICHT meint. Ein Ordnername im Baum belegt nicht,
# dass ein Pfad darunter einen Ort im Baum meint.
LAUFZEIT_AUSSER = ("config/services/", "config/templates/", "config/.nano")


# ── DIE MEDIATHEK GEHOERT DEM BETREIBER, NICHT DEM BAUM (30.08.2026) ──────
# Derselbe Fall wie `config/` eine Etage weiter: `media/` ist beides. Im Baum
# liegen darunter GENAU ZWEI Ordner (`media/images`, `media/sound` — Logos und
# Signaltoene, mitgeliefert). Alles andere unter `media/` ist die SAMMLUNG des
# Betreibers auf der Box (`/home/dietpi/MuPiBox/media/<kategorie>/<interpret>/`):
# die Kategorieordner `audiobook`, `music` und was der Mitschnitt sonst anlegt.
# Kein Ordner davon kann je im Baum liegen — er entsteht erst, wenn jemand
# Musik aufspielt oder aufnimmt.
#
# Aufgefallen am E105-Eintrag (`quelle-kennt-ihre-kategorie-selbst`): dessen
# Beweisweg NENNT beide Ordner, weil genau ihr Unterschied der Fund war
# (`media/audiobook/Alin Coen` traegt die Aufnahmen, `media/music/Alin Coen`
# fehlt). Die Wache meldete beide tot — und haette das bei jedem Lauf getan,
# also `dauerrote-wache-ist-keine`.
#
# Die Ausnahme haengt an der SORTE, nicht an den zwei Namen: welche
# media-Unterordner der Baum fuehrt, wird aus `git ls-files` GELESEN. Kommt
# morgen ein mitgeliefertes `media/themes/` dazu, prueft die Wache es sofort
# wieder; und ein Tippfehler in `media/images/…` bleibt ein Fund.
def _medien_im_baum():
    aus = subprocess.run(
        ["git", "ls-files", "-z", "media"], capture_output=True, text=True, check=True
    ).stdout.split("\0")
    return {p.split("/")[1] for p in aus if p.count("/") >= 2}


MEDIEN_IM_BAUM = _medien_im_baum()

# Riegel wie bei KERN/OBERSTE: eine leere Ableitung wuerde die ganze Mediathek
# durchwinken und dabei gruen aussehen. Die zwei mitgelieferten Ordner sind
# seit der ersten Fassung da; sind sie weg, ist die Ableitung kaputt.
if not MEDIEN_IM_BAUM:
    print("  WARNUNG: kein getrackter media-Unterordner gefunden — git ls-files media ist leer?")


def _mediathek(p):
    """Sammlung des Betreibers (media/<kategorie>/…), die git nie fuehrt?"""
    if not p.startswith("media/"):
        return False
    # Auch OHNE dritte Stufe: `media/audiobook` allein ist genauso wenig im
    # Baum wie `media/audiobook/<interpret>/…` — der Kategorieordner selbst
    # entsteht erst auf der Box.
    teile = p.split("/")
    return len(teile) >= 2 and teile[1] not in MEDIEN_IM_BAUM


def _laufzeit(p):
    if p.startswith(LAUFZEIT):
        return True
    if _mediathek(p):
        return True
    return p.startswith("config/") and not p.startswith(LAUFZEIT_AUSSER)


# ── WAS DER BAU ANLEGT, KANN DER BAUM NIE HABEN (30.08.2026) ──────────────
# Der Eintrag `newdesign-kopierregel-nimmt-alles-mit-was-niemand-austraegt`
# vom 30.08. nennt als MESSERGEBNIS drei Pfade im gebauten Buendel:
#
#     src/deploy/www/browser/neu/wellen-messseite.html
#     src/deploy/www/browser/neu/schriften/Readme.md
#     src/deploy/www/browser/neu/bilder/figuren/LIESMICH.md
#
# Diese Wache meldete sie prompt als TOT — und wird das bei jedem Lauf tun,
# denn `src/deploy` steht in `.gitignore` (Zeile „Temporary deploy files"):
# der Ordner entsteht beim Bau und ist danach wieder weg. Ein Pfad dorthin
# ist strukturell nie im Baum, egal ob der Satz drumherum stimmt. Genau die
# Sorte Befund, die llmwiki `dauerrote-wache-ist-keine` beschreibt — und die
# den naechsten echten Fund im Rauschen begraebt.
#
# Es waere leicht gewesen, die drei Namen unter AUSNAHMEN_JE_QUELLE zu
# haengen. Das waere eine Ausnahme AUF DEN PFAD gewesen und haette den
# naechsten Bau-Pfad wieder gemeldet — dieselbe Lehre wie bei der
# Namensliste weiter oben (llmwiki `wache-liest-sieben-von-neunundvierzig-\
# prosadateien`). Das Merkmal ist nicht der Name, sondern: **git fuehrt den Ort
# nicht, weil ihn ein Bau oder eine Laufzeit anlegt.** Das steht in
# `.gitignore` und wird von dort GELESEN statt hier nachgebaut — faellt
# `src/deploy` je aus der Ignorierliste, meldet die Wache wieder.
#
# Dieselbe Not wie `LAUFZEIT` daruber, nur eine Quelle weiter: dort die
# Ablage der Box, hier die Ablage des Baus. Die Zahl der so uebersprungenen
# Pfade wird GEMELDET (siehe unten) — ein stiller Ausschluss liest sich wie
# Deckung, und das ist die Lehre der Momentaufnahmen-Zeile weiter oben.
_ignoriert_gemerkt = {}
BAUABLAGE = set()


def _bauablage(p):
    """Fuehrt git diesen Ort absichtlich nicht (Bau- oder Laufzeitablage)?"""
    if p not in _ignoriert_gemerkt:
        _ignoriert_gemerkt[p] = (
            subprocess.run(
                ["git", "check-ignore", "-q", "--", p],
                capture_output=True,
            ).returncode
            == 0
        )
    if _ignoriert_gemerkt[p]:
        BAUABLAGE.add(p)
        return True
    return False

# ── DIE STELLE, DIE DEN FEHLER BESCHREIBT, IST NICHT DER FEHLER ────────────
# Beim ersten Lauf meldete diese Wache genau den Eintrag rot, der ihre Funde
# DOKUMENTIERT: er zaehlt die toten und die mehrdeutigen Pfade auf, damit man
# sie wiedererkennt. `pack-verweise.py` kennt dieselbe Not und loest sie ueber
# Backticks („was zitiert ist, ist nicht gemeint") — hier geht das nicht, weil
# echte Pfade genauso in Backticks stehen.
#
# Deshalb JE QUELLE, nicht je Pfad: ein Eintrag darf die Pfade nennen, deren
# Tod er beschreibt, und NUR diese. Taucht `scripts/mupibox/mqtt.py` irgendwo
# sonst wieder auf, meldet die Wache weiterhin rot. Eine pauschale Ausnahme
# fuer den ganzen Eintrag waere ein Loch, das mit ihm mitwaechst.
#
# llmwiki `halbe-pruefung-meldet-wie-eine-ganze`: eine Wache, die beim
# BESCHREIBEN eines Fehlers rot wird, erzieht dazu, sie wegzuschauen.
AUSNAHMEN_JE_QUELLE = {
    # Dieselbe Not, ein Eintrag weiter: die Lektion vom 29.08. protokolliert
    # ihre eigene GEGENPROBE — den erfundenen Pfad, der weiter gemeldet werden
    # MUSS, damit die neue `/-`-Regel nicht als blinde Wache durchgeht. Der
    # Name sagt es selbst („gibt-es-nicht-wirklich"); er wird nie existieren.
    "llmwiki:kompositum-am-schraegstrich-ist-kein-pfad": {
        "tools/gibt-es-nicht-wirklich.py",
    },
    # 30.08.2026, dieselbe Not eine Wache weiter — und diesmal erzeugt vom
    # eigenen Beweis: der Eintrag protokolliert die GEGENPROBE zur neuen
    # `_bauablage`-Regel und muss dafuer die drei Pfade nennen, an denen
    # geprueft wurde, dass `check-ignore` sie NICHT trifft. Zwei davon sind
    # echte Funde frueherer Laeufe, der dritte existiert absichtlich nie.
    # Genau darum stehen sie hier je Pfad: taucht einer anderswo wieder auf,
    # meldet die Wache weiter rot.
    "llmwiki:pfad-in-die-bauablage-ist-nie-im-baum": {
        "tools/gibt-es-nicht-wirklich.py",
        "scripts/mupi-lautstaerke.sh",
        "NewDesign/stil.css",
    },
    "llmwiki:doku-zeigt-auf-dateien-die-es-nicht-gibt": {
        "scripts/mupi-lautstaerke.sh",
        "scripts/mupibox/mqtt.py",
        "src/backend-api/src/mitschnittliste.ts",
        "src/app/seiten/darstellung.ts",
        "src/auth.integration.spec.ts",
        "src/server.ts",
        "src/spotify-control.ts",
        "src/test.ts",
        "tools/qr.py",
    },
    # Dieselbe Not wie oben, eine Ablage weiter: die beiden Eintraege vom
    # 25.08. beschreiben, WELCHE Pfade im BACKLOG tot bzw. mehrdeutig waren.
    # Ohne diese Zeilen meldet die Wache ihre eigene Fundbeschreibung rot.
    "llmwiki:eine-wache-die-eine-ablage-nicht-kennt-meldet-dort-ewig-gruen": {
        "scripts/mupi-lautstaerke.sh",
        "src/backend-api/src/.server-leck-probe.16211.ts",
        "tools/werkzeug-inventur.py",
        "tools/archiv",
        # Die vier MEHRDEUTIGEN (qr, einrichtung-ap, einrichtung-schirm,
        # kleiner-dhcp) stehen im Eintrag BEWUSST ohne `tools/`-Vorsatz: eine
        # Ausnahmeliste ist Text im Baum, und `ungerufene-wachen.py` zaehlte
        # die vier Namen prompt als "von einem Laeufer erreichbar" (130 -> 134).
        # Eine Wache, die Pfade AUFZAEHLT, faelscht die Messung der naechsten.
    },
    "llmwiki:vorschlag-wird-still-erfuellt-unter-anderem-namen": {
        "tools/werkzeug-inventur.py",
        "tools/archiv",
    },
    # 27.08.2026, eine vierte Not derselben Art, aber aus UMBENENNUNG statt
    # aus Loeschung: beide Eintraege erzaehlen, dass ein Werkzeug seinen
    # Namen gewechselt hat, und muessen den ALTEN nennen, damit man den
    # Zusammenhang wiederfindet. Der Nachfolger heisst
    # `tools/paket-angaben-nachziehen.py` und wird von der Wache normal
    # geprueft; nur der abgelegte Name ist hier ausgenommen, und nur in
    # diesen zwei Quellen.
    "llmwiki:kopfzeilenzahl-driftet-weil-die-wache-vor-dem-anhaengen-laeuft": {
        "tools/kopfzeile-nachziehen.py",
    },
    "llmwiki:umfangsangabe-stand-an-drei-orten-die-wache-kannte-einen": {
        "tools/kopfzeile-nachziehen.py",
    },
    # 26.08.2026, wieder dieselbe Not: der Eintrag beschreibt ein npm-Skript,
    # das seit einem Jahr auf eine geloeschte Datei zeigt — und muss dafuer
    # den toten Befehl WOERTLICH zitieren, sonst findet ihn niemand, der nach
    # `pbjs` oder `spotify-proto.js` sucht. Der Tod DIESES Pfades ist der
    # Inhalt des Eintrags, nicht sein Fehler. Faellt `build-proto` aus
    # `src/backend-player/package.json` (BACKLOG, „Aufraeumen"), faellt diese
    # Zeile mit — bis dahin haelt sie die Beschreibung gruen, ohne dass
    # `src/spotify-proto.js` irgendwo SONST unbemerkt auftauchen darf.
    "llmwiki:skript-das-niemand-ruft-verrottet-lautlos": {
        "src/spotify-proto.js",
    },
    # 27.08.2026, erst durch die Verbreiterung sichtbar: derselbe Fall wie
    # `remote-step-installer/dateien/systemd` weiter oben. Der Eintrag
    # beschreibt einen VERWORFENEN Entwurf („Der erste Entwurf … DAS WAERE
    # FALSCH GEWESEN") und muss die Vorlage dafuer benennen. Dass es sie nicht
    # gibt, IST das Ergebnis; gebaut wurde stattdessen
    # `scripts/mupibox/dhcp-schneller.sh`, und das liegt da.
    "llmwiki:dhclient-conf-nicht-ersetzen": {
        "config/templates/dhclient-mupibox.conf",
    },
    # Der Eintrag, der DIESE Verbreiterung beschreibt, muss ihre Funde
    # woertlich nennen — sonst findet sie niemand, der nach dem toten Namen
    # sucht. Wie immer je Pfad: taucht einer davon anderswo wieder auf, meldet
    # die Wache weiter rot.
    "llmwiki:wache-liest-sieben-von-neunundvierzig-prosadateien": {
        "NewDesign/stil.css",  # Fund 2: hiess nie so, heisst app.css
        "src/backend-player/src/spotify-control.js",  # Fund 1: MODERNIZATION 8
        "autosetup/enable_mupihat.sh",  # liegt unter scripts/mupihat/
        "src/styles.css",  # der mehrdeutige aus ADMIN-BOARD-ANALYSE.md
        "tools/wachen_lib.py",  # Beispiel: Vorschlag aus einem AUDIT-*
        "tools/archiv",  # dito
        "tools/eltern-masse-",  # Beispiel: der abgeschnittene Umbruch
    },
    "dokumentation/mixpibox.md": {
        "src/spotify-proto.js",  # dito, Abschnitt 7.4 zitiert denselben Befehl
        # 27.08.2026, Abschnitt 7.11: er beschreibt, WAS diese Wache gefunden
        # hat und was sie absichtlich nicht liest — und muss die vier Pfade
        # dafuer woertlich nennen. Dieselbe Not wie beim Wiki-Eintrag oben,
        # nur eine Ablage weiter; je Pfad und nicht pauschal, damit ein
        # Wiederauftauchen anderswo weiter rot meldet.
        "NewDesign/stil.css",  # der Fund selbst: hiess nie so, heisst app.css
        "src/backend-player/src/spotify-control.js",  # der Fund in MODERNIZATION 8
        "tools/wachen_lib.py",  # Beispiel fuer einen Vorschlag aus einem AUDIT-*
        "tools/archiv",  # dito
    },
    # Dritter Vorschlagspfad derselben Art (26.08.2026): der Kritiker-Lauf
    # SCHLAEGT `tools/wachen_lib.py` VOR (geteiltes Geruest statt neun
    # Regex-Fassungen fuer server.ts). Der Eintrag sagt das woertlich
    # („Vorschlag im Audit"), gebaut ist nichts. Faellt der Vorschlag oder
    # wird er gebaut, faellt diese Zeile mit — und bis dahin gilt, was
    # llmwiki `vorschlag-wird-still-erfuellt-unter-anderem-namen` lehrt:
    # nachsehen, ob er inzwischen UNTER ANDEREM NAMEN dasteht.
    "llmwiki:der-waechter-der-wachen-erkennt-nur-den-woertlichen-ausgang": {
        "tools/wachen_lib.py",
    },
    # 31.08.2026: EIN PFAD IM ZITIERTEN npm-SKRIPT IST PAKETRELATIV.
    # Der Eintrag begruendet die Fehlalarm-Bauart „das Ziel ist EINGABE statt
    # Befehl" am Beispiel `esbuild src/server.ts --bundle` — und das ist ein
    # WOERTLICHES Zitat aus `src/backend-api/package.json:8`, wo npm im
    # Paketordner laeuft und `src/server.ts` genau richtig ist. Dieselbe Not
    # wie CONTAINER_RELATIV weiter unten (compose: `command:` gilt im
    # Container), nur eine Ablage weiter — und anders als dort NICHT als Regel
    # zu haben: in Fliesstext steht kein Schluessel davor, an dem man die
    # Paketrelativitaet erkennen koennte. Den Pfad im Zitat auf
    # `src/backend-api/src/server.ts` zu verlaengern waere die schlechtere
    # Reparatur: dann faende niemand das Zitat mehr in der package.json wieder.
    # Je Pfad und je Quelle, damit ein `src/server.ts` anderswo weiter rot
    # meldet — das ist der mehrdeutige Pfad der Umzugs-Schuld vom 10.08.
    "llmwiki:wache-las-nur-prosa-die-anweisung-stand-im-print": {
        "src/server.ts",
    },
    # Und derselbe Pfad ein drittes Mal, im Eintrag, der DIESE Ausnahme
    # begruendet: er muss den gemeldeten Pfad woertlich nennen (im `match:`
    # und in der Gegenprobe), sonst findet ihn niemand, der den Fund sucht.
    # Ohne diese Zeile meldet die Wache ihre eigene Fundbeschreibung rot -
    # llmwiki `halbe-pruefung-meldet-wie-eine-ganze`.
    "llmwiki:paketrelativer-pfad-im-zitat-sieht-aus-wie-umzugsschuld": {
        "src/server.ts",
    },
    # Drei Nennungen in BACKLOG.md, die genau deshalb dastehen, WEIL es die
    # Datei nicht (mehr) gibt. Auch hier je Pfad, nicht pauschal fuer die
    # Datei: BACKLOG.md ist die groesste Quelle der Wache, ein Freibrief fuer
    # sie waere ein Loch, das mit ihr mitwaechst.
    "BACKLOG.md": {
        # E71/A1 ist als FERTIG abgehakt; der Punkt beschreibt das Entfernen
        # dieser Sondierungskopie. Ihre Abwesenheit IST das Ergebnis.
        "src/backend-api/src/.server-leck-probe.16211.ts",
        # E71/A3 Schritt 1 und 3: ein VORSCHLAG von 2026-08-20. Schritt 1 ist
        # unter dem Namen tools/ungerufene-wachen.py gebaut (Nachtrag im Punkt
        # sagt das ausdruecklich), tools/archiv/ steht noch aus. Faellt der
        # Punkt, faellt die Ausnahme mit.
        "tools/werkzeug-inventur.py",
        "tools/archiv",
    },
}

luecken = []


def quellen():
    """Jede Doku-Stelle als (Herkunft, Text)."""
    paket = yaml.safe_load(open(WIKI, encoding="utf-8"))
    # NICHT paket["entries"] blind: bei der Gegenprobe (Schluessel umbenannt)
    # flog ein KeyError mit Rueckverfolgung heraus. Ein Absturz meldet zwar
    # auch rot, aber `doku-luecken-probe.sh` fischt aus der Ausgabe die Zeilen
    # mit FEHLT/WARNUNG — und haette gar nichts anzuzeigen gehabt.
    if not isinstance(paket, dict) or "entries" not in paket:
        print(f"  WARNUNG: {WIKI} hat keinen Schluessel `entries` — Paketformat geaendert?")
        luecken.append("paketformat")
        return
    for e in paket["entries"]:
        text = "\n".join(str(v) for v in e.values() if isinstance(v, str))
        yield f"llmwiki:{e.get('id')}", text
    for datei in HANDBUECHER:
        if os.path.exists(datei):
            yield datei, _lesen(datei)


# ── EIN PFAD IM ABBILD HAT ZWEI WAHRHEITEN ────────────────────────────────
# Dieselbe Falle, die `abbild-pfade-pruefen.py` fuer die `Dockerfile` gemessen
# hat, nur eine Datei weiter. In einer `docker-compose.yml` sind NICHT alle
# Pfade Baumpfade: was hinter `command:`, `working_dir:`, `dockerfile:` oder
# `context:` steht, gilt IM CONTAINER — `npx tsx src/spotify-control.ts` laeuft
# in `/app/src/backend-player`, dort ist `src/spotify-control.ts` richtig. Beim
# Einhaengen meldete die Wache genau diese zwei prompt als MEHRDEUTIG.
#
# Es ist eine REGEL, keine Namensliste: eine Ausnahme je Pfad haette die zwei
# Namen stillgelegt und den naechsten container-relativen Pfad wieder gemeldet.
# Die BIND-MOUNTS unter `volumes:` bleiben absichtlich drin — deren linke Seite
# IST ein Baumpfad, und genau dort sitzt das tote `../AdminInterface/www`.
CONTAINER_RELATIV = re.compile(r"^\s*(command|working_dir|dockerfile|context)\s*:")


def _lesen(datei):
    text = open(datei, encoding="utf-8").read()
    if not datei.endswith((".yml", ".yaml")):
        return text
    # Zeilentreu leeren statt loeschen, damit Zeilennummern stimmen, falls die
    # Wache spaeter welche meldet.
    return "\n".join("" if CONTAINER_RELATIV.match(z) else z for z in text.splitlines())


def aufloesen(p):
    """Wo der Pfad WIRKLICH liegt — oder None."""
    for w in WEITERE_WURZELN:
        if os.path.exists(w + p):
            return w + p
    return None


tot = defaultdict(set)
mehrdeutig = {}
geprueft = 0

for herkunft, text in quellen():
    for m in PFAD.finditer(text):
        p = m.group(1).rstrip(".,);:")
        # Muster und Auslassungen sind keine Dateiverweise. Der Blick auf das
        # NAECHSTE Zeichen ist noetig, weil das Muster bei `scripts/systemd/
        # soloist-updater.*` genau vor dem Stern endet — der Fund saehe dann
        # aus wie ein toter Pfad und war nur eine Sammelangabe.
        rest = text[m.end() : m.end() + 2]
        if "..." in p or "*" in p or "<" in p or p.endswith("/") or rest.startswith(("*", ".*")):
            continue
        # ── EIN UMBRUCH IST KEIN DATEINAME (27.08.2026) ───────────────────
        # `NewDesign/index.html` schreibt „(tools/eltern-masse-\n  messen.mjs)".
        # Der Bindestrich am Zeilenende ist die Trennung, nicht das Ende des
        # Pfades; ohne diese Zeile meldet die Wache `tools/eltern-masse-` tot,
        # waehrend `tools/eltern-masse-messen.mjs` danebenliegt. Erst beim
        # Verbreitern auf `NewDesign/` sichtbar geworden.
        if p.endswith("-") and rest.startswith(("\n", "\r")):
            continue
        # ── EIN KOMPOSITUM AM SCHRAEGSTRICH IST KEIN PFAD (29.08.2026) ────
        # Deutsche Prosa haengt die Sache direkt an den Ordner: „autosetup.sh
        # schiebt den scripts/-Ordner WHOLESALE nach /usr/local/bin". Das
        # Muster liest daraus `scripts/-Ordner` und meldet ihn tot, waehrend
        # `scripts/` seit jeher im Baum liegt.
        # Anders als bei `config/templates-Vorlagen` braucht das KEINE
        # Einzelausnahme: ein Segment, das direkt hinter dem Schraegstrich mit
        # `-` beginnt, ist im Baum unmoeglich — `git ls-files | grep '/-'`
        # zaehlt null. Die Regel gilt damit der SORTE, nicht dem einen Pfad,
        # und faengt die sieben Geschwister in der Prosa gleich mit
        # (`tools/-Inventur`, `tools/-Dateien`, `api/-Pfade`, `func/-Dateien`,
        # `player/-Antworten`, `documentation/-Umzug`, `ard/-Befehl`).
        if "/-" in p:
            continue
        # Was das Muster abschneidet, weil es dort aufhoert: eine Klammer-
        # Aufzaehlung (`config/services/mupibox-{server,player}.service`) und
        # ein Platzhalter (`config/data-vor-aufraeumen-<ISO>.json`). Der
        # `<`-Test oben sieht nur IN den Treffer, nicht dahinter.
        if rest.startswith(("{", "<")):
            continue
        # Ein Schraegstrich am ENDE meint das Verzeichnis als Sache, nicht die
        # Datei — `media/nachrichten/` ist die Ablage, die der Empfaenger erst
        # anlegt. Vor dem Verbreitern auf `media/` gab es den Fall nicht.
        if rest.startswith("/"):
            continue
        if p in AUSNAHMEN or _laufzeit(p) or _bauablage(p):
            continue
        if p in AUSNAHMEN_JE_QUELLE.get(herkunft, ()):
            continue
        geprueft += 1
        echt = aufloesen(p)
        if echt is None:
            tot[p].add(herkunft)
        elif echt != p:
            mehrdeutig.setdefault(p, (echt, set()))[1].add(herkunft)

print(
    f"── {len(HANDBUECHER)} Prosadateien gelesen, {len(MOMENTAUFNAHMEN)} Momentaufnahmen "
    "(AUDIT-*.md) uebersprungen: sie nennen Vorschlaege und vergangene Staende ──"
)
for k in KERN:
    if k not in HANDBUECHER:
        print(f"  WARNUNG: {k} kam in der Ableitung nicht an — git ls-files oder die Endungen geaendert?")
        luecken.append(f"kern/{k}")
for o in KERN_ORDNER:
    if o not in OBERSTE:
        print(f"  WARNUNG: Ordner {o}/ fehlt in OBERSTE — die Ableitung aus git ls-files ist kaputt")
        luecken.append(f"kern-ordner/{o}")
if BAUABLAGE:
    print(
        f"── {len(BAUABLAGE)} Pfad(e) uebersprungen, weil .gitignore den Ort fuehrt "
        "(Bau- oder Laufzeitablage, nie im Baum) ──"
    )
    for p in sorted(BAUABLAGE):
        print(f"  IGNORIERT: {p}")
print("── Pfade, auf die die Doku zeigt und die es nicht gibt ──")
# DIE WICHTIGSTE PRUEFUNG DER DATEI: findet die Wache GAR KEINEN Pfad, hat
# sich das Muster oder das Paketformat geaendert — dann meldet sie sonst gruen
# und ueberlebt jede Umbenennung. llmwiki: gegenprobe-statt-gruen-glauben.
if geprueft == 0:
    print(f"  WARNUNG: kein einziger Pfad in {WIKI} und den Handbuechern gefunden — Format geaendert?")
    luecken.append("kein-pfad")
# ── GESCHICHTE IST KEIN TOTER PFAD (E118/1e, 05.09.2026) ──────────────────
# Mit der alten Oberflaeche fielen ganze Baeume DOKUMENTIERT (der
# Loeschungs-Commit verweist auf dokumentation/ALT-UEBERNAHMEN.md, die die
# Fundstellen GERADE DESHALB woertlich nennt). Journale und das Wissenspaket
# erzaehlen weiter von diesen Pfaden — das ist ihr Zweck, kein Befund. Wer
# sie umschriebe, verfaelschte Geschichte; wer sie ewig rot meldete, beguebe
# den naechsten echten Fund (llmwiki: dauerrote-wache-ist-keine).
# In AKTIV-Doku (README, mixpibox.md, benutzerhandbuch, docs/) bleibt jede
# Nennung eines gefallenen Pfades ein ECHTER Befund.
GEFALLEN = ("src/frontend-box/", "themes/", "AdminInterface/",
            "tools/antworttext-ausgewertet.py", "tools/beide-oberflaechen-vorschau.mjs",
            "tools/box-seiten-deckung.py", "tools/eltern-bereich-inventur.mjs",
            "tools/mupi-variablen-abgleich.mjs", "tools/mupi-variablen-abgleich.test.mjs",
            "tools/taster-ring-vorfuehrung.mjs", "tools/wappen-hinweis-probe.mjs",
            # 06.09.2026, AUDIT-2026-09-06 Rang 11: in
            # tools/box/renderer-speicher-verlauf.py aufgegangen (samt `--hier`
            # und VmHWM). BACKLOG.md erzaehlt weiter von der Messung, die es
            # DAMALS gefahren hat — das ist Geschichte, kein toter Verweis.
            "tools/kiosk-speicher-verlauf.py")
GESCHICHTSQUELLEN = ("llmwiki:", "BACKLOG.md", "dokumentation/ALT-UEBERNAHMEN.md",
                     "MODERNIZATION.md", "NewDesign/MASKOTTCHEN.md")
def _gefallen(p):
    return any(p == g or p.startswith(g) for g in GEFALLEN)
def _nur_geschichte(fundorte):
    return all(any(f.startswith(q) for q in GESCHICHTSQUELLEN) for f in fundorte)
geschichte = 0
for p in sorted(tot):
    wer = sorted(tot[p])
    if _gefallen(p) and _nur_geschichte(wer):
        geschichte += 1
        continue
    print(f"  TOT: {p}   (genannt in {', '.join(wer[:3])})")
    luecken.append(f"tot/{p}")
if geschichte:
    print(f"  ({geschichte} gefallene Pfade nur in Journalen/Wiki genannt — Geschichte, kein Befund)")

print("── Pfade, die nur unter einem ANDEREN Ordner liegen (Umzug 10.08.) ──")
for p in sorted(mehrdeutig):
    echt, wer = mehrdeutig[p]
    print(f"  MEHRDEUTIG: {p} -> {echt}   (genannt in {', '.join(sorted(wer)[:2])})")
    luecken.append(f"mehrdeutig/{p}")

print()
if not luecken:
    print("KEINE LUECKE.")
    sys.exit(0)
print(f"{len(luecken)} LUECKE(N).")
sys.exit(1)
