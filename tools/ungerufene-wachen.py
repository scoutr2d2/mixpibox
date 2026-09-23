#!/usr/bin/env python3
"""UNGERUFENE WACHEN — welches Werkzeug faellt ein Urteil, das niemand abholt?

WARUM ES DAS GIBT (25.08.2026, Doku-Lauf): die vier Laeufe davor fanden je EINE
ungerufene Wache und hingen sie ein — `stilnamen-pruefen.py` (seit 08.08. rot,
Fehlalarm), `grenzruf-verb-deckung.py` (zwei Fehlalarme),
`sonden-riegel-deckung.py`, `antworttext-ausgewertet.py` (gab bei jedem Fund
trotzdem 0 zurueck). Jedes Mal war der Fund ein ZUFALL beim Danebenschauen,
und jedes Mal lautete der Satz danach „eine Wache, die nirgends laeuft, ist
keine". Vier Mal denselben Fund von Hand zu machen ist eine fehlende Wache.

Diese hier stellt die Frage systematisch, und zwar in der einzigen Form, die
sich nicht in Namen ausdruecken laesst — die Namenssuche `*deckung*` /
`*pruefen*` / `*halten*` hat schon einmal die halbe Verwandtschaft uebersehen
(dc2bfc21). Gefragt wird nach dem VERHALTEN:

    Ein Werkzeug, dessen AUSGANG von einem Fund abhaengt, behauptet damit
    „ich bin eine Wache". Wer es dann nicht ruft, hat eine Wache im Baum,
    die nie rot werden kann.

WAS ROT WIRD, und wo die Wache bewusst aufhoert
    (1) Das Werkzeug urteilt: sein Ausgang kann aus EIGENER Logik ungleich 0
        werden — woertlich (`exit 1`) oder gerechnet (`sys.exit(main())`,
        `process.exit(fehler ? 1 : 0)`, `exit $rc`). Wer nur druckt, ist ein
        Messgeraet, keine Wache. Die Formen stehen bei `urteilt()`.
    (2) Es ist von KEINEM Laeufer aus erreichbar — auch nicht ueber Ecken:
        ruft `pruefen.sh` ein Werkzeug, das seinerseits ein zweites ruft, ist
        das zweite gedeckt. Ohne diese Huelle waere die Haelfte des
        Werkzeugkastens falsch rot.
    (3) Es steht nicht in BEKANNT. Dort liegt, was aus einem GENANNTEN Grund
        nicht in einen Laeufer gehoert — eine Sonde, die die eingeschaltete
        Box braucht, eine Mutationsprobe, die Quelldateien umschreibt, eine
        Einmalmessung zu einem Vorschlag. Der Grund steht dabei, denn eine
        Ausnahmeliste ohne Gruende ist in drei Wochen eine Muellhalde.

DER BLINDE FLECK IM AUSGANGSMUSTER IST ZU — geschlossen am 19.09.2026
    Bis dahin erkannte `urteilt()` nur den WOERTLICHEN Ausgang `sys.exit(1)`,
    `process.exit(1)`, `exit 1` — und uebersah damit die in diesem Baum
    HAEUFIGSTE Form: `sys.exit(main())` mit `return 1` in `main()`, in den
    .mjs-Werkzeugen `process.exit(fehler ? 1 : 0)`. Der Fall war nicht
    theoretisch: `skriptweg-sandkasten.py` und `skriptweg-rueckweg-luecken.py`
    hingen genau so in keinem Laeufer, starben beim E42-Umzug des Boxhelfers
    mit einem ValueError und meldeten neun Tage lang gar nichts — waehrend
    DIESE Wache daneben gruen sagte.

    NACHGEMESSEN AM 19.09.2026 an den 559 von git verfolgten Werkzeugen mit den
    fuenf Endungen: 116 erkannte das alte Muster, 363 weitere koennen fallen und
    waren unsichtbar, 80 urteilen wirklich nicht. Der blinde Fleck war also
    dreimal so gross wie das, was die Wache sah.

    WARUM DIE ENGE REGEL AUFGEGEBEN WURDE: die alte Fassung hielt sie
    absichtlich eng, weil die Erweiterung „auf einen Schlag 89 statt 0 Luecken"
    meldete und die 89 erst einzeln durch BEKANNT gehen sollten. Das war ehrlich
    gegen gruen getauscht — und der Tausch hat die zwei Skriptweg-Wachen neun
    Tage gekostet, die genau in diesem Fleck lagen. Eine Wache, die zu WENIG
    meldet, ist die schlechtere Nullnummer: bei der zu lauten sieht man, dass
    Arbeit offen ist, bei der stillen nicht. Die Zahl steht jetzt da; sie
    einzeln abzutragen (einhaengen oder mit Grund nach BEKANNT) ist Arbeit fuer
    mehrere Sitzungen und nicht mehr die Aufgabe dieser Wache.

DER ZWEITE BLINDE FLECK IST AUCH ZU — PROSA ZAEHLT NICHT MEHR ALS RUF
(geschlossen am 19.09.2026, am selben Tag wie das Ausgangsmuster)
    Bis dahin galt ein Werkzeug als gerufen, sobald sein NAME irgendwo in einer
    nicht auskommentierten Zeile stand — auch mitten in einem Satz. Der Fall
    war nicht theoretisch: `systemkurve-gleich.py` einzuhaengen liess prompt
    auch `weiterhoeren-schwellen-gleich.py` als gedeckt gelten, allein weil
    deren Name in Zeile 19 jenes Docstrings steht. Jene Wache lief nirgends und
    war ROT (ihr Gegenstand `merkposition.ts` fiel am 05.09. mit der alten
    Oberflaeche) — die Ratsche haette eine KAPUTTE Wache als „laeuft"
    eingefroren. Sie ist am 19.09.2026 foermlich gefallen; wer sie sucht,
    findet sie nur noch in der Geschichte.
    `rufe()` verlangt jetzt die AUSFUEHRUNGSSTELLUNG; wie sie je Sorte
    aussieht und warum dort keine Liste von Verben steht, erklaert der lange
    Kommentar ueber `rufe()`.
    GEMESSEN, BEIDE RICHTUNGEN, an allen Kanten des Baums: 228 Nennungen
    zaehlen nicht mehr (Docstrings, `print()`-Hinweise, `echo`-Saetze und
    Ausnahme-/Deckungslisten), 0 echte Rufe gehen verloren — 55 Werkzeuge
    verlieren die Erreichbarkeit, und jede der 66 Fundstellen, die sie bis
    dahin getragen hat, ist einzeln angesehen. Zwei davon waren echte Rufe ueber
    eine Variable (`importlib` in rueckstands-zahl-pruefen.py und
    newdesign-mitlieferung-deckung.py); sie haben die BINDUNGS-Regel erzwungen.
    Erreichbar sind damit 193 statt 248 Werkzeuge, und die drei Meldungen
    „BEKANNT, ABER GERUFEN" (mixpi-wartung.sh, welche-box.sh,
    units-decken-sich.sh) sind weg: sie waren genau dieser Fehlalarm.

WO DIESE WACHE WEITER BLIND IST — gemessen am 19.09.2026, nicht vermutet
    (a) EIN RUF, DER SEINEN PFAD ERST BAUT, BLEIBT UNSICHTBAR: `WURZEL /
        "tools" / "x.py"` (drei Stuecke) oder eine ganze Kommandozeile in EINER
        Zeichenkette (`run("python3 tools/x.py", shell=True)`) trifft kein
        Textmuster. Nachgezaehlt: die drei `shell=True`-Stellen im Baum
        (grundmessung.py, mupi-ton.py, wiki-pflege.py) uebergeben Variablen,
        keine Werkzeugpfade — heute kostet dieser Fleck nichts. Die
        Gegenrichtung ist teurer als die Blindheit: wer hier grosszuegig
        raet, meldet nichts; wer zu eng liest, meldet einen Fehlalarm und
        sperrt die Ratsche gegen eine Verbesserung.
    (b) `set -e` OHNE eigenes `exit` ist auch ein Urteil — das Skript stirbt am
        ersten roten Befehl. Als Merkmal wuerde es fast jedes Shell-Werkzeug
        treffen und steht darum nicht in `urteilt()`.
    (c) EIN HIER-DOKUMENT der Schale (`<<'PY' … PY`) ist Prosa oder fremder
        Quelltext, wird aber wie nackter Code gelesen. Nachgezaehlt: genau
        zwei Werkzeugnamen stehen in diesem Baum in einem Hier-Dokument
        (librespot-mitlesen.sh:88, taster-wache-am-geraet.sh:65) — beide in
        einer Kommentarzeile, also ohnehin draussen. Ein eigener Riegel dafuer
        waere heute Aufwand ohne Gegenstand.

DIE ANDERE RICHTUNG, damit die Liste nicht verrottet: ein BEKANNT-Eintrag, den
es nicht mehr gibt oder der inzwischen doch in einem Laeufer haengt, wird
EBENFALLS rot. Sonst wuechse hier still eine Liste mit Namen von Dateien, die
seit Monaten geloescht sind (llmwiki: `gegenprobe-statt-gruen-glauben`).

UND DIE SELBSTPRUEFUNG: findet die Wache gar keinen Laeufer oder darin keinen
einzigen Werkzeugruf, meldet sie das als FEHLER statt gruen. Wer `pruefen.sh`
umbenennt, bekaeme sonst eine Wache, die alles fuer gedeckt haelt.

DIE RATSCHE — warum die offenen Wachen ein EINGEFRORENER BESTAND sind und
kein gruenes Gewissen (19.09.2026)
    Mit den zwei geschlossenen blinden Flecken meldet der volle Bericht 250
    Luecken (Bilanz vom 19.09.2026: 484 Werkzeuge mit Urteil, davon 177 im
    Laeufer, 57 mit Grund draussen, 250 offen).
    Damit war die Wache im selben Zug keine mehr: eine dauerrote Wache verdeckt
    den 251. Fund genauso zuverlaessig, wie die blinde vorher den 10. verdeckt
    hat (llmwiki: dauerrote-wache-ist-keine). Die Zahl ist richtig und bleibt
    stehen — was fehlte, war ein Urteil, das jemand liest.

    GEBAUT NACH `tools/shellcheck-ratsche.sh`, nicht neu erfunden: dort tragen
    118 Shell-Dateien hunderte Bestandsbefunde, und die Hausregel heisst „der
    Bestand darf schlecht sein, er darf nur nicht SCHLECHTER werden". Dieselbe
    Regel hier, dieselben Schalter (`--pruefen` / `--einfrieren`), dieselbe
    Baseline-Form (`tools/ungerufene-wachen-baseline.txt`).

    EINGEFROREN WIRD DER ZUSTAND JE WERKZEUG, nicht die Zahl der Luecken. Das
    ist der Punkt, an dem eine Zahl-Ratsche blind waere: faellt eine Wache aus
    ihrem Laeufer und wird gleichzeitig eine andere eingehaengt, bleibt die
    Summe gleich — und genau der Rost-Fall, um den es geht, ginge durch. Die drei
    Zustaende sind `laeufer` / `bekannt` / `offen`, sie haben einen RANG, und die
    Ratsche blockt, wenn ein Rang sinkt. Damit fangen beide Richtungen mit EINEM
    Vergleich:
      (a) ein NEUES Werkzeug mit Urteil, das nirgends haengt — unbekannt gilt
          als Rang 1, `offen` ist 0, also rot. Neue Wachen muessen eingehaengt
          oder begruendet sein, genau wie neue Skripte bei shellcheck sauber
          sein muessen.
      (b) ein Werkzeug, das als `laeufer` eingefroren ist und aus seinem Laeufer
          gefallen ist — Rang 2 auf 0, rot. Auch der Weg ueber `bekannt`
          (Rang 1) blockt: wer eine laufende Wache still entschuldigt, statt sie
          zu reparieren, bekommt kein Gruen.

    OHNE BASELINE-DATEI bricht `--pruefen` MIT ANLEITUNG ab (Rueckgabe 2) statt
    durchzuwinken — dieselbe Lehre, die im Kopf der shellcheck-Ratsche fuer
    fehlendes shellcheck steht.

Aufruf aus dem Wurzelverzeichnis:
    python3 tools/ungerufene-wachen.py              der volle, ehrliche Bericht
                                                    samt Bilanzzeile; Exit 1,
                                                    solange irgendetwas offen
                                                    ist (also auf Dauer)
    python3 tools/ungerufene-wachen.py --pruefen    DAS URTEIL fuer die Laeufer:
                                                    gruen beim eingefrorenen
                                                    Bestand, rot bei
                                                    Verschlechterung
    python3 tools/ungerufene-wachen.py --einfrieren Baseline neu schreiben
                                                    (nach bewusster Aenderung)
    python3 tools/ungerufene-wachen.py --alle       zusaetzlich die BEKANNT-Liste
                                                    mit ihren Gruenden
Rueckgabe: 0 = in Ordnung, 1 = Befund, 2 = Abbruch (Baseline fehlt/unlesbar).
IN EINEN LAEUFER GEHOERT `--pruefen`. Ohne Schalter waere der Schritt ab dem
19.09.2026 dauerhaft rot.
"""

import datetime
import re
import subprocess
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
WERKZEUGE = WURZEL / "tools"

# ── Die Laeufer ─────────────────────────────────────────────────────────────
# NUR diese beiden. `package.json` und die Testlaeufer rufen keine Werkzeuge,
# und alles andere hier aufzunehmen hiesse, jede Doku-Erwaehnung als Deckung
# zu zaehlen — genau der Irrtum, der `antworttext-ausgewertet.py` drei Wochen
# unsichtbar gehalten hat: es stand in der README.
LAEUFER = ["tools/pruefen.sh", "tools/doku-luecken-probe.sh"]

ENDUNGEN = (".py", ".sh", ".mjs", ".ts", ".js")

# ── Die Ratsche ─────────────────────────────────────────────────────────────
# Gebaut nach `tools/shellcheck-ratsche.sh` — dasselbe Muster, dieselbe
# Hausregel, und bewusst KEIN eigenes erfunden.
BASELINE = WERKZEUGE / "ungerufene-wachen-baseline.txt"


def kurzpfad(pfad: Path) -> str:
    """Der Pfad relativ zur Wurzel, ohne daran zu sterben.

    `relative_to` wirft, sobald der Pfad ausserhalb liegt — und eine Wache, die
    beim ANZEIGEN eines Dateinamens abstuerzt, verliert ihr Urteil an einer
    Nebensache. Aufgefallen am 19.09.2026, als die Gegenprobe `BASELINE` in den
    Scratchpad umbog.
    """
    try:
        return str(pfad.relative_to(WURZEL))
    except ValueError:
        return str(pfad)

# Die drei Zustaende, die ein Werkzeug MIT URTEIL haben kann, als RANG. Die
# Ratsche blockt, wenn ein Rang SINKT — das ist die ganze Regel, und sie faellt
# mit einem Vergleich statt mit einer Fallunterscheidung je Uebergang.
#   2 gedeckt      — von einem Laeufer aus erreichbar
#   1 entschuldigt — steht mit GENANNTEM Grund in BEKANNT
#   0 ungedeckt    — urteilt, haengt nirgends, niemand sagt warum
RANG = {"laeufer": 2, "bekannt": 1, "offen": 0}

# EIN WERKZEUG, DAS DIE BASELINE NICHT KENNT, WIRD WIE RANG 1 BEHANDELT: neu
# heisst eingehaengt ODER mit Grund entschuldigt. Damit faengt der Rang-Vergleich
# den Fall (a) „neue Wache haengt nirgends" ohne eine zweite Regel — genauso wie
# die shellcheck-Ratsche mit `soll=${soll:-0}` verlangt, dass NEUE Skripte
# sauber sind.
RANG_UNBEKANNT = 1

# ── Was aus GENANNTEM Grund in keinen Laeufer gehoert ───────────────────────
# Stand 25.08.2026. Wer hier etwas eintraegt, schreibt den Grund dazu; wer
# einen Grund nicht in einen Satz bekommt, hat wahrscheinlich eine Wache vor
# sich, die eingehaengt gehoert.
BEKANNT: dict[str, str] = {
    # ── Ausgehaengt, weil sie flattert ─────────────────────────────────────
    #
    # KEIN DAUERZUSTAND, SONDERN EINE SCHULD. Wer sie wieder einhaengt, muss
    # sie vorher DREIMAL hintereinander gleich gruen bekommen und die vierte
    # Ursache benennen koennen (die Grenzen stehen im Kopf des Werkzeugs).
    "auswahl-sagt-sich-an.mjs": (
        "flattert (20.09.2026: dreimal gelaufen, dreimal ein anderes Ergebnis ohne Codeaenderung) "
        "— drei Ursachen behoben, die vierte offen: Messabschnitte beeinflussen sich ueber "
        "liegengebliebene Tastendruecke und die geliehene Vorschau. Eine Wache, die mal rot und mal "
        "gruen ist, verbraucht das Vertrauen der naechsten echten Meldung. Von Hand: "
        "node tools/auswahl-sagt-sich-an.mjs"
    ),
    # ── Braucht das INTERNET und einen fremden Dienst ──────────────────────
    #
    # Eine Wache, die rot wird, weil jemandes WLAN klemmt oder die ARD gerade
    # umbaut, lehrt niemanden etwas — sie verbraucht nur das Vertrauen der
    # naechsten echten Meldung. Was AM BAUM haengt, ist bei diesen Sachen
    # ueber Zeugen gegen eine gekuerzte echte Antwort gedeckt
    # (plugins/mixpi-mediathek/ard.fixture.json, 33 Zeugen); diese Probe
    # beantwortet die andere Frage: stimmt die FORM beim Dienst noch?
    "mediathek-probe.mjs": (
        "faehrt mixpi-mediathek gegen die ECHTE ARD (api.ardmediathek.de) und braucht dafuer "
        "das Internet. Von Hand vor dem Ausliefern: node tools/mediathek-probe.mjs — und "
        "`--vorlage-erneuern` macht die Alterung der Zeugen-Vorlage sichtbar"
    ),
    # ── Braucht die eingeschaltete Box ─────────────────────────────────────
    "ausschalter-am-geraet.sh": "baut den Ausschalter am ECHTEN Geraet auf und wieder ab",
    "dietpi-txt-vergleich.sh": "liest die dietpi.txt PER SSH von der Box",
    "dienstwechsel-am-geraet.mjs": "misst den Dienstwechsel am TON der Box",
    "f1-vorlesen-ueberschreibt-schau.mjs": "Ansage am Geraet, Gegenprobe zu F1",
    "geraetewahl-abgleich.mjs": "haelt zwei Entscheidungen ueber DIESELBE Geraeteliste der Box nebeneinander",
    "mitmessen.mjs": "sieht live zu, waehrend jemand die Box bedient — kein Urteil auf Vorrat",
    "mpv-titelquelle-am-geraet.mjs": "fragt mpv auf der Box selbst",
    "pause-zeitschranke-messen.mjs": "misst eine Wartezeit gegen die echte Spotify-Anbindung",
    "resume-skripte-messen.py": "faehrt die Resume-Skripte am Geraet nach",
    "sprechwege-am-geraet.sh": "beide Sprechwege am Geraet",
    "stelle-je-dienst-am-geraet.mjs": "schreibt und liest gemerkte Stellen auf der Box",
    "stop-wirkt-am-geraet.mjs": "misst am TON, ob es nach `stop` still wird",
    "taster-wache-am-geraet.sh": "der Helfer am echten Taster",
    # Die zwei standen bis E118/1e im Windschatten der geloeschten
    # taster-ring-vorfuehrung.mjs (alte Oberflaeche); sie selbst messen am
    # Geraet bzw. an einer geoeffneten Seite und gehoeren in keinen Laeufer.
    "taster-druck-mitschnitt.sh": "schreibt echte Tasterdruecke am Geraet mit (die 27-Druecke-Messung)",
    # 06.09.2026 (AUDIT-2026-09-06 Rang 11): erst durch das Committen der
    # D1-Messwerkzeuge ueberhaupt sichtbar geworden — vorher lag es untracked
    # und damit auch fuer DIESE Wache im Dunkeln.
    "neu-oberflaeche-speicherprobe.mjs": (
        "faehrt eine LAUFENDE Oberflaeche ueber Minuten und misst mit — braucht "
        "eine offene Seite und Zeit, gehoert in keinen Laeufer"
    ),
    "taster-ring-messen.mjs": "misst den Austaster-Ring im offenen Browser gegen echte Druecke",
    "tonweg-durchgang.py": "misst, wie viel Ton am Ausgang der Box ankommt",
    "tonweg-pegel.mjs": "Pegel an jeder Station des Signalwegs der Box",
    "units-decken-sich.sh": "haelt die Units der Box gegen die Installationswege",
    "weiterhoeren-am-geraet.mjs": "faehrt den Weiterhoeren-Tipp auf der Box nach",
    "weiterhoeren-stellen.mjs": "liest die gemerkten Stellen der Box",
    # AM 19.09.2026 ERLEDIGT: dieser Eintrag und `mixpi-wartung.sh` wurden als
    # „BEKANNT, ABER GERUFEN" gemeldet, weil die Erreichbarkeitskette an zwei
    # Prosa-Nennungen hing (Docstring in newdesign-kopieren.py:16,
    # print()-Hinweis in ausliefern.py:1223). Seit `rufe()` die
    # Ausfuehrungsstellung verlangt, ist die Meldung weg — die Eintraege waren
    # richtig, AUDIT-2026-09-19 Rang 9 haette zwei gute Ausnahmen ausgetragen.
    "welche-box.sh": "fragt, mit WELCHER Box man gerade redet — eine Auskunft, kein Urteil",
    "jellyfin-weiterreicher-probe.sh": "spielt ueber den Jellyfin-Weiterreicher der Box (BACKLOG E15/S2)",
    "schirm-auf-null.mjs": "--ziel zeigt auf die echte Box; der Sandkastenteil ist der kleinere",
    "schirm-auf-null-api.mjs": "dasselbe ueber PUT /api/schirm/helligkeit an der Box",
    "mixpi-wartung.sh": "SCHALTET den Sperr-Schirm der echten Box (POST /api/wartung) — ein Eingriff auf Zuruf, kein Urteil; ohne Box endet es mit 2",
    # ── Browser + Vorschau ─────────────────────────────────────────────────
    # OFFEN: das ist der naechste Stapel. Diese gehoeren nicht in den schnellen
    # Teil, sondern in den Vorschau-Block weiter oben — jede einzeln nachgemessen,
    # denn eine Vorschau wird geliehen und trifft sonst still den Haupt-Baum.
    "akkukurve-farben.mjs": "Browser + eigene Vorschau; achtzehn Staende am gerenderten Bild",
    "akkukurve-grenzfaelle.mjs": "Browser + eigene Vorschau (--ziel)",
    "blaettern-schau.mjs": "Browser + Vorschau; Vollbild-Blaettern nachgemessen",
    "bruecke-schau.mjs": "Browser + Vorschau am echten Bestand",
    "eltern-bildergalerie.mjs": "Browser + eigene Vorschau; legt Bilder zum ANSEHEN ab",
    "farbwaehler-gegenlesen.mjs": "Browser + Vorschau; fuenf Fragen an den Farbwaehler",
    "sprich-knopf-ecke.mjs": "Browser + eigene Vorschau; misst die Ecke des Vorlese-Zeichens am gerenderten Cover",
    "farbwaehler-verwaltung-probe.mjs": "Browser; vom Klick bis in die Themendatei",
    "farbwaehler-wirkung.mjs": "Browser + Vorschau; was ein Farbwert wirklich faerbt",
    "ich-zeichen-schau.mjs": "Browser; das Zeichen „wer hoert\"",
    "kopfmitte-laeuft.mjs": "Browser + geliehene Vorschau; misst die Uhr ueber 250 ms",
    "kopfmitte-wahrheit.mjs": "Browser; Uhrzeit, Restzeit und Kinderzeit gegen die Wahrheit",
    "licht-regler-rufe.mjs": "Browser + geliehene Vorschau + Admin-Weg",
    "meta-interpret-schau.mjs": "Browser + Vorschau am echten Bestand",
    "plugin-fach-schau.mjs": "Browser an der Verwaltung der BOX",
    "plugin-seite-schau.mjs": "Browser an der Verwaltung der BOX",
    "schirm-helligkeit-loch.mjs": "Browser + eigener Server auf eigenem Port",
    "schirm-regler-ansehen.mjs": "legt ein BILD des Helligkeitsabschnitts ab — zum Ansehen, nicht zum Urteilen",
    "admin-vorschau.mjs": "IST die Vorschau, nicht ihr Pruefer: ein `listen()`-Server, der bis Strg-C laeuft — in einem Laeufer haenge er bis zum Timeout",
    # ── Geht ins Internet ──────────────────────────────────────────────────
    # Ein Laeufer, der von einer fremden Schnittstelle abhaengt, wird rot,
    # wenn dort jemand anders etwas umbaut — das ist kein Befund ueber uns.
    "archive-probe.mjs": "fragt das Internet Archive",
    "ard-modul-probe.ts": "haelt das ARD-Modul gegen die ECHTE Schnittstelle (BACKLOG E4)",
    "ard-sender-probe.mjs": "fragt die ARD-Audiothek nach Live-Sendern",
    # ── Aendert Quelldateien, misst einen Vorschlag, oder braucht ein Paket ─
    "gegenlesen-mutationen-namensriegel.sh": "MUTIERT src/backend-api/*.ts und setzt zurueck; in einem Laeufer stuende bei Abbruch ein veraenderter Baum",
    "plugin-gegenprobe.sh": "macht die Plugin-Tests absichtlich rot; 104 s und mutiert dabei den Baum",
    "leerer-schacht-filter-probe.py": "Einmalmessung zu einem VORSCHLAG (size==0 nach blockiert), kein Dauerurteil",
    "loeschen-sandkasten.ts": "faehrt die ALTE Loesch-Fassung wirklich aus, um ihren Fehlgriff zu zeigen; die neue bewacht durchkommen-loeschen.ts",
    "verlauf-takt-rechnen.mjs": "rechnet einen Messtakt durch, bevor eine Zeile faellt — eine Entscheidungshilfe",
    "suchbestand-drift.mjs": "druckt den Bestand der Verwaltungssuche als LISTE; das Urteil faellt ein Mensch",
    "interpret-freigeschaltet-seite.mjs": "eine Einzelfrage aus dem Bau der Freischaltung, kein Dauerurteil",
    "dienstwechsel-am-dienst.mjs": "startet den echten Abspieldienst mit Tonmaschine — nicht hermetisch genug fuer den schnellen Teil",
    "update-frische-box-probe.sh": "braucht `zip`; ohne das Paket bricht sie jetzt mit 2 ab statt einen roten Schritt zu melden",
}

luecken: list[str] = []

PRUEFEN = "--pruefen" in sys.argv
EINFRIEREN = "--einfrieren" in sys.argv


def sag(*args: object) -> None:
    """Der ausfuehrliche Bericht — unter `--pruefen` und `--einfrieren` still.

    Die Zahl wird dabei NICHT versteckt: `--pruefen` druckt seine eigene
    Bilanzzeile, und der Aufruf ohne Schalter zeigt weiter alles.
    """
    if not (PRUEFEN or EINFRIEREN):
        print(*args)


def text_von(pfad: Path) -> str:
    try:
        return pfad.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""


def ohne_kommentare(inhalt: str, suffix: str) -> str:
    """Nur die Zeilen, die WIRKLICH ausgefuehrt werden.

    DER GANZE PUNKT DIESER FUNKTION: ein Kommentar, der eine Ausgangsform oder
    einen Werkzeugnamen ZITIERT, ist kein Urteil und kein Ruf. Sie entstand an
    der Ruf-Achse — `pruefen.sh` erklaert ueber jedem Schritt in einem
    Kommentarblock, WARUM es ihn gibt, und nennt dabei reihenweise andere
    Werkzeuge; eine erste Fassung dieser Wache las das mit und meldete
    `sicherung-ohne-ssh-ring.ts` als gedeckt, obwohl es nur in einem Kommentar
    steht. Seit dem 19.09.2026 bringt `rufe()` seinen eigenen Abtaster mit
    (Kommentare, Zeichenketten UND Klammern); gebraucht wird diese Funktion
    hier noch von `urteilt()`.

    DER BLOCKKOMMENTAR NUR FUER JS/TS, und das ist kein Schoenheitsfehler: in
    einem Shell-Skript steht `"$BAU"/*` und weiter unten irgendwo `*/`, und
    ein `/\\*.*?\\*/` ueber DOTALL frisst dazwischen alles. Genau so hat diese
    Wache in ihrer zweiten Fassung `dienste-doku-deckung.sh` als ungerufen
    gemeldet, obwohl der Ruf in `doku-luecken-probe.sh:238` steht.

    UND DIE FORTSETZUNGSZEILE `*` GENAUSO NUR FUER JS/TS — am 19.09.2026
    gemessen, als `urteilt()` auf diese Funktion umgestellt wurde: in einem
    Shell-Skript ist eine Zeile, die mit `*` beginnt, der ALLES-Zweig eines
    `case`. `durchkommen-leerlauf.sh:56` lautet
    `*) echo "..." >&2; exit 1 ;;` — mit der alten Regel verschwand das `exit 1`
    im angeblichen Kommentar, und das Werkzeug fiel aus der Wachen-Liste. Ein
    `//` kommt in Shell ebenfalls nicht als Kommentar vor, schadet dort aber
    nicht.
    """
    js = suffix in (".mjs", ".ts", ".js")
    ohne_block = re.sub(r"/\*.*?\*/", "", inhalt, flags=re.S) if js else inhalt
    anfaenge = ("#", "//", "*") if js else ("#",)
    zeilen = []
    for zeile in ohne_block.splitlines():
        if zeile.lstrip().startswith(anfaenge):
            continue
        zeilen.append(zeile)
    return "\n".join(zeilen)


# ── Die AUSFUEHRUNGSSTELLUNG je SORTE ───────────────────────────────────────
# GEFRAGT IST WIEDER DIE SORTE, NICHT DER WORTLAUT — dasselbe Prinzip wie bei
# `urteilt()`, nur an der anderen Achse. Bis zum 19.09.2026 galt ein Werkzeug
# als gerufen, sobald sein NAME irgendwo in einer nicht-auskommentierten Zeile
# stand. Damit zaehlte PROSA als Ruf, und das war kein theoretischer Fehler:
# `systemkurve-gleich.py` einzuhaengen liess prompt auch
# `weiterhoeren-schwellen-gleich.py` als gedeckt gelten — allein deshalb, weil
# deren Name in Zeile 19 des Docstrings von systemkurve-gleich.py steht
# („Dieselbe Vorkehrung wie …"). Jene Wache war ROT und lief nirgends; die
# Ratsche haette eine kaputte Wache als „laeuft" eingefroren. (Sie ist am
# 19.09.2026 gefallen — der Satz in systemkurve-gleich.py:19 steht noch da und
# zeigt damit auf ein Werkzeug, das es nicht mehr gibt.)
#
# WARUM HIER KEINE LISTE VON VERBEN STEHT. Der naheliegende Riegel waere
# `subprocess.run|spawn|execSync|npx|…` — und er waere in dem Moment veraltet,
# in dem jemand `Popen`, `execa` oder den naechsten Starter benutzt; das
# Werkzeug fiele dann falsch in „ungerufen", und die Ratsche wuerde rot ueber
# eine Verbesserung. Genauso wenig taugt „Zeichenketten ausschliessen": der
# HAEUFIGSTE echte Ruf in diesem Baum steht selbst in einer Zeichenkette
# (`subprocess.run(["bash", "tools/mixpi-wartung.sh", …])`,
# mixpi-box-altlasten.py:170).
#
# DAS MERKMAL IST DIE STELLUNG, und die definiert die Sorte selbst:
#
#   .sh   — der Pfad steht als eigenes WORT einer Kommandozeile. In der Schale
#           IST die Wortstellung das Verb: `bash tools/x.sh`, `tools/x.sh`,
#           `[ -x tools/x.sh ]`, `"$WURZEL/tools/x.py"`. Prosa traegt die
#           Schale in Anfuehrungszeichen MIT Leerzeichen
#           (`echo "… tools/x.py …"`) und in Hier-Dokumenten.
#           Die Kommandoersetzung `$( … )` INNERHALB einer Zeichenkette ist
#           wieder Code, kein Satz — `BOX="$(bash tools/welche-box.sh)"` ist
#           ein Ruf (mixpi-wartung.sh:25).
#   .py /
#   .mjs /
#   .ts /
#   .js   — der Pfad wird als GANZER WERT WEITERGEREICHT: ein Literal, in dem
#           nichts als ein Pfad steht, und zwar an einer der drei Stellen, an
#           denen ein Wert die Stelle verlaesst —
#             * in der Argumentliste eines RUFS (eine `(`, vor der ein Name
#               steht; die Klammer darf zeilenweit offen sein),
#             * hinter `import … from` / `require(` — ein Import FUEHRT das
#               Modul aus,
#             * als BINDUNG an einen Namen (`ZAEHLER = WURZEL / "tools/x.py"`).
#           Darum steht hier kein einziger Starter-Name im Muster — so wenig
#           wie `main` in `URTEILSFORMEN`.
#
# WARUM DIE BINDUNG MITZAEHLT, und warum eine SAMMLUNG nicht — am 19.09.2026
# an allen 236 wegfallenden Kanten nachgemessen, nicht vermutet:
#   `rueckstands-zahl-pruefen.py:85` bindet `ZAEHLER = WURZEL /
#   "tools/admin-abschnitte-deckung.py"` und laedt das Werkzeug 97 Zeilen
#   spaeter per `importlib.util.spec_from_file_location(…, ZAEHLER)`. Dasselbe
#   in `newdesign-mitlieferung-deckung.py:74`. Wer die Bindung nicht zaehlt,
#   meldet diese beiden als ungerufen — ein Fehlalarm, und in der Ratsche ein
#   Rangsturz ueber eine Verbesserung. Ein Pfad, der an einen Namen geht,
#   verlaesst die Stelle als WERT; was danach mit ihm geschieht, sieht kein
#   Textmuster mehr.
#   Umgekehrt ist ein Element einer SAMMLUNG (`[…]`, `{…}`) ausserhalb einer
#   Ruf-Klammer ein Datenfeld: die Ausnahmelisten in `doku-pfade-pruefen.py`,
#   die Deckungs-Register `WAPPEN_HALTEN.pruefer` (admin-weg.mjs:89) und
#   `LICHT_PRUEFER` (licht-weg.mjs:71). Die NENNEN einen Pruefer, sie rufen
#   ihn nicht — genau der Unterschied, um den es hier geht.
#
# BEIDE TEILE ZUSAMMEN, und beide werden gebraucht:
#   `b.frage("… tools/mixpi-box-altlasten.py (erst ohne, dann mit --wirklich).")`
#   (ausliefern.py:1223) steht sehr wohl in einer Argumentliste — nur ist der
#   Pfad dort ein Satzteil. `AUSNAHMEN = {"tools/werkzeug-inventur.py": …}`
#   ist umgekehrt ein sauberes Wort — aber ein Datenfeld, kein Ruf.
WERKZEUGPFAD = re.compile(r"tools/([A-Za-z0-9._-]+\.(?:py|sh|mjs|ts|js))")
NACHBARMODUL = re.compile(r"\./([A-Za-z0-9._-]+\.(?:mjs|ts|js))")

# Was die Sorte an Zeichenketten und Kommentaren kennt. Ein Treffer wird
# IMMER als Ganzes verschluckt — genau deshalb stolpert der Abtaster weder
# ueber ein `#` in einer Zeichenkette noch ueber eine Klammer in einem
# Kommentar.
ABTASTER: dict[str, re.Pattern[str]] = {
    ".py": re.compile(
        r"(?P<komm>\#[^\n]*)"
        r"|(?P<text>[rRbBuUfF]{0,3}(?:"
        r'"""(?:\\.|(?!""").)*"""'
        r"|'''(?:\\.|(?!''').)*'''"
        r'|"(?:\\.|[^"\\\n])*"'
        r"|'(?:\\.|[^'\\\n])*'"
        r"))"
        # DIE GESCHWEIFTE KLAMMER NUR HIER, und das ist eine Sorten-Sache:
        # in Python ist `{…}` IMMER eine Sammlung (Dict, Menge, Ableitung),
        # in JS waere sie meistens ein BLOCK — dort wuerde sie jede Bindung
        # innerhalb einer Funktion verschlucken. Ohne sie zaehlte
        # `AUSNAHMEN = {"tools/x.py": "Grund"}` einzeilig als Ruf.
        r"|(?P<klammer>[()\[\]{}])",
        re.S,
    ),
    ".sh": re.compile(
        # Das `#` der Schale beginnt nur am Wortanfang — `${x#y}` ist keiner.
        r"(?P<komm>(?<![^\s])\#[^\n]*)"
        r'|(?P<text>"(?:\\.|[^"\\])*"'
        r"|'[^']*'"
        r")",
        re.S,
    ),
    ".mjs": re.compile(
        r"(?P<komm>//[^\n]*|/\*.*?\*/)"
        r'|(?P<text>"(?:\\.|[^"\\\n])*"'
        r"|'(?:\\.|[^'\\\n])*'"
        r"|`(?:\\.|[^`\\])*`"
        r")"
        r"|(?P<klammer>[()\[\]])",
        re.S,
    ),
}
ABTASTER[".ts"] = ABTASTER[".mjs"]
ABTASTER[".js"] = ABTASTER[".mjs"]

# `$( … )` und Rueckwaertsstriche in einer Zeichenkette der Schale: EINE Ebene
# Verschachtelung reicht fuer diesen Baum und ist nachgemessen — tiefer kommt
# hier nichts vor.
UNTERSCHALE = re.compile(r"\$\((?:[^()]|\([^()]*\))*\)|`[^`]*`")

# Die Einbinde-Woerter sind SCHLUESSELWOERTER der Sorte, keine Starter-Namen:
# ein Import fuehrt das Modul aus, und ohne ihn waere jedes .mjs-Hilfsmodul
# (`from './leihgabe.mjs'`) falsch rot.
EINBINDEN = re.compile(r"\b(?:import|from|require)\b")

# Ein Gleichheitszeichen, das WIRKLICH bindet — nicht `==`, `!=`, `<=`, `>=`,
# `+=` und nicht der Pfeil `=>` einer JS-Funktion.
BINDUNG = re.compile(r"(?<![=!<>+\-*/%&|^:])=(?![=>])")


def kettenkern(roh: str) -> str:
    """Der Inhalt eines Zeichenketten-Literals, ohne Praefix und Klammerung."""
    kern = roh.lstrip("rRbBuUfF")
    for rand in ('"""', "'''", '"', "'", "`"):
        if kern.startswith(rand):
            kern = kern[len(rand):]
            if kern.endswith(rand):
                kern = kern[: -len(rand)]
            break
    return kern


def rufe(inhalt: str, selbst: str, suffix: str = "") -> set[str]:
    """Die Werkzeuge, die dieses hier AUSFUEHRT — nicht die, die es nennt.

    Der Abtaster laeuft EINMAL ueber die Datei und weiss dabei dreierlei: wo
    ein Kommentar steht, wo eine Zeichenkette anfaengt und aufhoert, und wie
    tief die Klammern gerade stehen. Der Klammerstapel merkt sich je Klammer,
    ob vor ihr ein NAME stand — das unterscheidet die Argumentliste eines Rufs
    von einem Datenfeld, und zwar ueber Zeilengrenzen hinweg (viele Rufe in
    diesem Baum stehen mehrzeilig).

    Was NICHT mehr zaehlt und vorher zaehlte, steht im Kopf unter „DIE
    AUSFUEHRUNGSSTELLUNG je SORTE".
    """
    suffix = suffix or Path(selbst).suffix
    abtaster = ABTASTER.get(suffix)
    if abtaster is None:
        return set()
    schale = suffix == ".sh"
    gefunden: set[str] = set()
    stapel: list[bool] = []
    pos = 0
    for treffer in abtaster.finditer(inhalt):
        if schale and treffer.start() > pos:
            # NACKTER CODE DER SCHALE: dort IST der Pfad ein Kommandowort.
            gefunden |= set(WERKZEUGPFAD.findall(inhalt[pos:treffer.start()]))
        pos = treffer.end()
        art = treffer.lastgroup
        if art == "komm":
            continue
        if art == "klammer":
            zeichen = treffer.group()
            if zeichen in "([{":
                davor = inhalt[max(0, treffer.start() - 40):treffer.start()].rstrip()
                stapel.append(zeichen == "(" and bool(davor) and (davor[-1].isalnum() or davor[-1] in "_)]"))
            elif stapel:
                stapel.pop()
            continue
        kern = kettenkern(treffer.group())
        if schale:
            for stueck in UNTERSCHALE.findall(kern):
                gefunden |= set(WERKZEUGPFAD.findall(stueck))
            kern = UNTERSCHALE.sub(" ", kern)
        if any(z.isspace() for z in kern):
            continue  # ein Satz, kein Wort — Prosa
        namen = set(WERKZEUGPFAD.findall(kern)) | set(NACHBARMODUL.findall(kern))
        if not namen:
            continue
        if schale or any(stapel):
            gefunden |= namen
            continue
        zeilenanfang = inhalt.rfind("\n", 0, treffer.start()) + 1
        vorlauf = inhalt[zeilenanfang:treffer.start()]
        if EINBINDEN.search(vorlauf):
            gefunden |= namen
        elif not stapel and BINDUNG.search(vorlauf):
            # Eine BINDUNG an einen Namen, ausserhalb jeder Sammlung: der Pfad
            # verlaesst die Stelle als Wert (siehe Kopf dieser Wache).
            gefunden |= namen
    if schale and pos < len(inhalt):
        gefunden |= set(WERKZEUGPFAD.findall(inhalt[pos:]))
    gefunden.discard(selbst)
    return gefunden


# ── Die Ausgangsformen je SORTE ─────────────────────────────────────────────
# GEFRAGT IST DIE SORTE, NICHT DER WORTLAUT, und das Merkmal haengt bewusst
# weder an einem Dateinamen noch an einer Textaehnlichkeit: es ist die Frage,
# ob der Ausgang dieses Prozesses aus eigener Logik ungleich 0 werden kann.
# Zwei Formen genuegen dafuer, und die zweite ist die, die bis zum 19.09.2026
# fehlte:
#
#   FUND     — ein Ausgang mit dem Literal 1. In diesem Baum ist 1 der
#              Fund-Code.
#   RECHNEND — der Ausgangswert ist ein AUSDRUCK statt eines Literals:
#              `sys.exit(main())`, `raise SystemExit(main())`,
#              `raise SystemExit(f"...")` (String-Argument heisst Ausgang 1),
#              `process.exit(fehler ? 1 : 0)`, `process.exitCode = ...`,
#              `exit $rc`. Wer seinen Ausgangswert AUSRECHNET, laesst ihn von
#              einem Fund abhaengen — unabhaengig davon, wie die gerufene
#              Funktion heisst. Genau darum steht hier kein `main` im Muster:
#              haenge man es an den Namen `main()`, verschwaende das Merkmal
#              mit dem naechsten `haupt()`.
#
# WAS BEWUSST NICHT ZAEHLT, und das ist keine Textaehnlichkeit sondern eine
# Konvention dieses Baums: ein Ausgang mit einem Literal 2..9 ist hier der
# ABBRUCH, nicht der Fund. Die BEKANNT-Liste sagt es selbst („ohne das Paket
# bricht sie jetzt mit 2 ab statt einen roten Schritt zu melden", „ohne Box
# endet es mit 2"). Am 19.09.2026 nachgezaehlt: 22 Werkzeuge haben NUR so einen
# Ausgang — `command -v jq || exit 2`, `process.exit(2)` bei unerreichbarer Box,
# `process.exit(130)` nach Strg-C. Die urteilen nicht, die geben auf. Wer sie
# mitzaehlt, meldet einen Messfuehler als Wache.
#
# Die Sorte kommt aus der ENDUNG, nicht aus dem Inhalt: `process.exit` in einer
# .py-Datei waere ein Tippfehler, `sys.exit` in einer .sh-Datei ein Zitat.
URTEILSFORMEN: dict[str, tuple[str, ...]] = {
    ".py": (
        r"(?<![\w.])(?:sys\.)?exit\(\s*1\s*\)",
        r"raise\s+SystemExit\s*\(\s*1\s*\)",
        # rechnend: alles ausser einem Zahlen-Literal, None und dem leeren Ruf
        r"(?<![\w.])(?:sys\.)?exit\(\s*(?![\s)]|\d+\s*\)|None\s*\))",
        r"raise\s+SystemExit\s*\(\s*(?![\s)]|\d+\s*\))",
    ),
    ".sh": (
        r"(?<![\w-])exit\s+1(?![\d])",
        # rechnend: `exit $rc`, `exit "$?"`, `exit $((…))`
        r"(?<![\w-])exit\s+(?:\"?\$|\(\()",
    ),
    ".mjs": (
        r"process\.exit\(\s*1\s*\)",
        r"process\.exitCode\s*=\s*1(?![\d])",
        r"process\.exit\(\s*(?![\s)]|\d+\s*\))",
        r"process\.exitCode\s*=\s*(?!\s*\d)",
    ),
}
URTEILSFORMEN[".ts"] = URTEILSFORMEN[".mjs"]
URTEILSFORMEN[".js"] = URTEILSFORMEN[".mjs"]

URTEIL_MUSTER = {suffix: re.compile("|".join(formen)) for suffix, formen in URTEILSFORMEN.items()}


def urteilt(inhalt: str, suffix: str) -> bool:
    """Kann der Ausgang dieses Werkzeugs aus eigener Logik ungleich 0 werden?

    UEBER `ohne_kommentare()`, nicht ueber den Rohtext: ein Kommentar, der eine
    Ausgangsform ZITIERT, ist kein Urteil — derselbe Irrtum wie beim Zaehlen der
    Rufe, nur an der anderen Achse. Gemessen am 19.09.2026: `units-decken-sich.sh`
    begruendet in Zeile 96 woertlich, warum dort KEIN `exit 1` steht („haette das
    Werkzeug unbrauchbar gemacht"); der alten Fassung war genau dieser Satz das
    Urteilsmerkmal. Sein echtes Urteil steht in Zeile 108 und heisst
    `exit $fehler` — die rechnende Form, die diese Fassung sieht.
    """
    muster = URTEIL_MUSTER.get(suffix)
    if muster is None:
        return False
    return bool(muster.search(ohne_kommentare(inhalt, suffix)))


# ── Erreichbarkeit von den Laeufern aus, ueber Ecken ────────────────────────
inhalte = {p.name: text_von(p) for p in WERKZEUGE.iterdir() if p.is_file() and p.suffix in ENDUNGEN}

# NUR WAS GIT KENNT. Ein Werkzeug, das gerade nebenan entsteht, ist noch keine
# ungerufene Wache — es ist Arbeit im Gang. Waere es hier rot, meldete dieser
# Schritt bei jeder zweiten Sitzung einen Fund ueber eine Datei, die es morgen
# vielleicht gar nicht mehr gibt (llmwiki: `eigene-hunks-schuetzt-nicht-vor-fremdem-schreiber` —
# dieselbe Trennlinie, andere Richtung). Antwortet git nicht, wird NICHT
# gefiltert: lieber zu viel melden als still die halbe Liste verschlucken.
try:
    verzeichnet = subprocess.run(
        ["git", "-C", str(WURZEL), "ls-files", "tools"],
        capture_output=True, text=True, timeout=20, check=True,
    ).stdout.split()
    bekannt_bei_git = {Path(z).name for z in verzeichnet}
    if bekannt_bei_git:
        ungezaehlt = sorted(set(inhalte) - bekannt_bei_git)
        inhalte = {n: t for n, t in inhalte.items() if n in bekannt_bei_git}
except (OSError, subprocess.SubprocessError):
    ungezaehlt = []

erreicht: set[str] = set()
rand: list[str] = []
laeufer_da = 0
for rel in LAEUFER:
    pfad = WURZEL / rel
    if not pfad.exists():
        luecken.append(f"LAEUFER FEHLT: {rel} — die Wache haelt sonst alles fuer gedeckt")
        continue
    laeufer_da += 1
    name = pfad.name
    erreicht.add(name)
    rand.extend(rufe(text_von(pfad), name))

if laeufer_da and not rand:
    luecken.append(
        "KEIN EINZIGER WERKZEUGRUF in den Laeufern gefunden — die Suche greift nicht mehr "
        "(Schreibweise geaendert?). Gruen waere hier gelogen."
    )

while rand:
    name = rand.pop()
    if name in erreicht:
        continue
    erreicht.add(name)
    rand.extend(rufe(inhalte.get(name, ""), name))

# ── Erste Richtung: urteilt, aber niemand ruft es ───────────────────────────
sag("── Werkzeuge, die ein Urteil faellen und in keinem Laeufer haengen ──")
offen: list[str] = []
for name in sorted(inhalte):
    if name in erreicht or name in BEKANNT:
        continue
    if not urteilt(inhalte[name], Path(name).suffix):
        continue
    zeilen = len(inhalte[name].splitlines())
    offen.append(name)
    luecken.append(f"UNGERUFENE WACHE: tools/{name} ({zeilen} Zeilen) urteilt ueber den Ausgang, laeuft aber nirgends")
    sag(f"  UNGERUFENE WACHE: `tools/{name}` ({zeilen} Zeilen) — urteilt, laeuft nirgends")

# ── Zweite Richtung: die Ausnahmeliste gegen die Wirklichkeit ───────────────
sag("── Die BEKANNT-Liste gegen den Baum ──")
for name, grund in sorted(BEKANNT.items()):
    if not (WERKZEUGE / name).exists():
        luecken.append(f"BEKANNT ZEIGT INS LEERE: tools/{name} gibt es nicht mehr — Eintrag austragen")
        sag(f"  BEKANNT ZEIGT INS LEERE: `tools/{name}` gibt es nicht mehr")
    elif name in erreicht:
        luecken.append(f"BEKANNT, ABER GERUFEN: tools/{name} haengt inzwischen in einem Laeufer — Eintrag austragen")
        sag(f"  BEKANNT, ABER GERUFEN: `tools/{name}` — Eintrag austragen")

if "--alle" in sys.argv:
    sag("── Was aus genanntem Grund draussen bleibt ──")
    for name, grund in sorted(BEKANNT.items()):
        sag(f"  {name}: {grund}")
    if ungezaehlt:
        sag("── Was git noch nicht kennt und darum nicht mitgezaehlt wurde ──")
        for name in ungezaehlt:
            sag(f"  {name}")

# ── Die Volkszaehlung, und zwar IN BEIDEN FAELLEN ───────────────────────────
# Bis zum 19.09.2026 druckte die Wache diese Zahl NUR im gruenen Ausgang. Wer
# sie rot vorfand, erfuhr „9 LUECKE(N)" und nicht, aus wie vielen Wachen die 9
# kommen — AUDIT-2026-09-19 musste die Bezugsgroesse darum selbst schaetzen und
# schrieb eine Zahl hin, die niemand nachrechnen konnte. Eine Wache, deren
# Bilanz beim Rotwerden verschwindet, macht ihren eigenen Befund unlesbar.
#
# NUR was es wirklich gibt. `erreicht` sammelt NAMEN, nicht Dateien: nennt ein
# Laeufer (oder eine Ausnahmeliste darin) ein `tools/x.py`, das nie gebaut
# wurde, stand es bis zum 25.08.2026 in dieser Zahl. Gemessen an genau dem
# Fall: `doku-pfade-pruefen.py` bekam eine Ausnahme fuer den VORSCHLAG
# `tools/werkzeug-inventur.py` (E71/A3) - und die Zahl stieg von 130 auf 131,
# ohne dass ein Werkzeug dazugekommen waere. Fuer das URTEIL bleibt `erreicht`
# unveraendert richtig: wer genannt wird, ist gerufen.
wirklich_da = {n for n in erreicht if (WERKZEUGE / n).exists()}
wachen = {n for n, t in inhalte.items() if urteilt(t, Path(n).suffix)}
bilanz = (
    f"BILANZ: {len(wachen & erreicht)} von {len(wachen)} Werkzeugen mit Urteil haengen in einem "
    f"Laeufer, {len(wachen & set(BEKANNT))} bleiben aus genanntem Grund draussen (--alle zeigt "
    f"sie), {len(offen)} haengen nirgends."
)
sag(bilanz)
sag(
    f"        {len(wirklich_da)} Werkzeuge sind von den Laeufern aus erreichbar, "
    f"{len(inhalte)} sind insgesamt von git verfolgt."
)


# ── Der Zustand JE WERKZEUG, das eine Ratsche braucht ───────────────────────
# NICHT nur die Luecken einfrieren, sondern den Zustand je Werkzeug — sonst ist
# der Rost-Fall unsichtbar. Friere man nur die ZAHL 250 ein, koennte eine Wache
# aus ihrem Laeufer fallen und eine andere eingehaengt werden, und die Ratsche
# saehe weiter 250. Genau der Fall, um den es geht: „eine Wache, die niemand
# ruft, ist keine Wache" — sie rostet unbemerkt.
#
# BEKANNT SCHLAEGT ERREICHT, und diese Regel hat sich am 19.09.2026 bezahlt
# gemacht: `mixpi-wartung.sh`, `welche-box.sh` und `units-decken-sich.sh` galten
# bis dahin faelschlich als erreicht (Prosa-Nennung). Weil sie in der Baseline
# als `bekannt` stehen und nicht als `laeufer`, hat das Schliessen genau dieses
# Fehlalarms die Ratsche NICHT rot gemacht. Eine Wache, die eine Verbesserung
# bestraft, wird abgeschaltet — die Regel bleibt darum stehen.
def zustand(name: str) -> str:
    if name in BEKANNT:
        return "bekannt"
    if name in erreicht:
        return "laeufer"
    return "offen"


jetzt = {n: zustand(n) for n in wachen}

if EINFRIEREN:
    zeilen = [
        "# UNGERUFENE-WACHEN-BASELINE — je Zeile: <zustand> <werkzeug>",
        "#",
        "#   laeufer  von einem Laeufer aus erreichbar (Rang 2, gedeckt)",
        "#   bekannt  steht mit GENANNTEM Grund in BEKANNT (Rang 1, entschuldigt)",
        "#   offen    urteilt, haengt nirgends, niemand sagt warum (Rang 0)",
        "#",
        "# Die Ratsche blockt, wenn ein Rang SINKT. Ein Werkzeug, das hier fehlt,",
        "# gilt als Rang 1: neue Wachen muessen eingehaengt oder begruendet sein.",
        f"# Eingefroren am {datetime.date.today():%Y-%m-%d}. "
        "Neu einfrieren: python3 tools/ungerufene-wachen.py --einfrieren",
    ]
    zeilen += [f"{zustand_} tools/{name}" for name, zustand_ in sorted(jetzt.items())]
    BASELINE.write_text("\n".join(zeilen) + "\n", encoding="utf-8")
    verteilung = {z: sum(1 for v in jetzt.values() if v == z) for z in RANG}
    print(
        f"Baseline eingefroren: {len(jetzt)} Werkzeuge mit Urteil — "
        f"{verteilung['laeufer']} laeufer, {verteilung['bekannt']} bekannt, {verteilung['offen']} offen."
    )
    print(f"  {kurzpfad(BASELINE)}")
    sys.exit(0)

if PRUEFEN:
    # KEIN FALSCH-GRUEN OHNE BASELINE. Dieselbe Lehre wie im Kopf der
    # shellcheck-Ratsche fuer fehlendes shellcheck: eine Wache, die bei
    # fehlendem Werkzeug gruen ist, prueft nichts und sieht dabei aus, als
    # pruefte sie. Abbruch mit 2 — die Abbruch-Kennung dieses Baums, nicht die
    # Fund-Kennung 1.
    if not BASELINE.exists():
        print(f"Baseline fehlt: {kurzpfad(BASELINE)}", file=sys.stderr)
        print("Die Ratsche kann ohne eingefrorenen Bestand nichts vergleichen.", file=sys.stderr)
        print("Einmal einfrieren:  python3 tools/ungerufene-wachen.py --einfrieren", file=sys.stderr)
        print("Danach den vollen Bericht lesen:  python3 tools/ungerufene-wachen.py", file=sys.stderr)
        sys.exit(2)
    frueher: dict[str, str] = {}
    try:
        for zeile in BASELINE.read_text(encoding="utf-8").splitlines():
            if not zeile.strip() or zeile.lstrip().startswith("#"):
                continue
            teile = zeile.split()
            if len(teile) != 2 or teile[0] not in RANG:
                raise ValueError(f"unlesbare Zeile: {zeile!r}")
            frueher[teile[1].removeprefix("tools/")] = teile[0]
    except (OSError, ValueError) as fehler:
        print(f"Baseline unlesbar ({kurzpfad(BASELINE)}): {fehler}", file=sys.stderr)
        print("Neu einfrieren:  python3 tools/ungerufene-wachen.py --einfrieren", file=sys.stderr)
        sys.exit(2)
    if not frueher:
        print(f"Baseline enthaelt keinen Eintrag ({kurzpfad(BASELINE)}).", file=sys.stderr)
        print("Neu einfrieren:  python3 tools/ungerufene-wachen.py --einfrieren", file=sys.stderr)
        sys.exit(2)

    schlechter: list[str] = []
    besser: list[str] = []
    for name in sorted(jetzt):
        war = frueher.get(name)
        ist = jetzt[name]
        rang_war = RANG_UNBEKANNT if war is None else RANG[war]
        if RANG[ist] < rang_war:
            woher = "ist neu" if war is None else f"war `{war}`"
            schlechter.append(f"{name} — {woher}, ist jetzt `{ist}`")
        elif RANG[ist] > rang_war:
            besser.append(f"{name} — {'ist neu' if war is None else f'war `{war}`'}, ist jetzt `{ist}`")

    # Die Selbstpruefung der Wache gilt auch hier: waere `pruefen.sh` umbenannt,
    # kaeme der Rangsturz zwar von selbst — aber ein greifendes Suchmuster oder
    # ein fehlender Laeufer sollen NAMENTLICH blocken, nicht nur als Nebenwirkung.
    strukturell = [z for z in luecken if z.startswith(("LAEUFER FEHLT", "KEIN EINZIGER"))]

    print(bilanz)
    print(
        f"RATSCHE: {len(frueher)} Werkzeuge eingefroren in {kurzpfad(BASELINE)}; "
        f"{len(schlechter)} schlechter, {len(besser)} besser."
    )
    if besser and not schlechter:
        for zeile in besser:
            print(f"  besser: {zeile}")
        print("  Baseline nachziehen:  python3 tools/ungerufene-wachen.py --einfrieren")
    if not schlechter and not strukturell:
        print("Die Ratsche haelt: der eingefrorene Bestand ist nicht schlechter geworden.")
        sys.exit(0)
    print()
    for zeile in strukturell:
        print(f"  {zeile}")
    for zeile in schlechter:
        print(f"  SCHLECHTER: {zeile}")
    print()
    print(f"{len(schlechter) + len(strukturell)} VERSCHLECHTERUNG(EN).")
    print("Eine Wache gehoert in einen Laeufer (meist tools/pruefen.sh) — oder mit")
    print("GENANNTEM Grund in die BEKANNT-Liste in tools/ungerufene-wachen.py.")
    print("Ist die Verschlechterung gewollt:  python3 tools/ungerufene-wachen.py --einfrieren")
    sys.exit(1)

print()
if luecken:
    # ALLE Lueckenzeilen noch einmal, auch die, die in keinen der beiden
    # Abschnitte gehoeren (fehlender Laeufer, greifendes Suchmuster). Die
    # standen vorher NUR in der Zahl — eine Gegenprobe zeigte einen Lauf, der
    # „1 LUECKE(N)" meldete und nirgends sagte, welche.
    for zeile in luecken:
        print(f"  {zeile}")
    print()
    print(f"{len(luecken)} LUECKE(N).")
    print("Das URTEIL steht in der Ratsche:  python3 tools/ungerufene-wachen.py --pruefen")
    sys.exit(1)

print("Keine ungerufene Wache.")
