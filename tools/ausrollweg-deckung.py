#!/usr/bin/env python3
"""
Deckt auf, was IM REPO LIEGT, aber ueber KEINEN Ausrollweg auf eine Box kommt.

WOZU
Am 04.08.2026 wurden nacheinander DREI Befunde derselben Bauart gefunden, jeder
einzeln und jeder von Hand:

    librespot-waechter.service   Unit lag da, kein Weg rollte sie aus
    librespot-waechter.sh        Skript lag da, kein Weg rollte es aus
    librespot-konto.py           der Waechter ruft es — kein Weg brachte es hin

Drei Funde, drei Anlaeufe, und jedes Mal war es Zufall. Dieses Werkzeug stellt
die Frage EINMAL fuer alles: welche Datei unter config/services/ und scripts/
wird von autosetup.sh bzw. update/start_mupibox_update.sh ueberhaupt angefasst?

DIE FEHLERKLASSE, um die es geht, ist nicht "eine Datei fehlt". Sie ist:
DIE BOX BIETET EINEN SCHALTER AN, DER INS LEERE ZEIGT. Genau so wurde
mupi_fan.service gefunden: die Verwaltung fuehrt den Luefter als ganz normale
Wahlmoeglichkeit (src/backend-api/src/dienste.ts sagt das sogar ausdruecklich —
ein "abgeloest" daran waere "eine Falschauskunft, die jemanden davon abhaelt,
den Luefter einzuschalten"), und der PHP-Admin ruft `systemctl enable
mupi_fan.service`. Auf einer frischen Karte gibt es diese Unit nicht. Der
Schalter meldet keinen Fehler — exec() wirft die Ausgabe weg. Das Kind hat
einen heissen Pi und die Eltern haben einen Schalter, der aussieht, als waere
er an.

WAS "NICHT AUSGEROLLT" HIER NICHT HEISST
Nicht jede Datei gehoert auf die Box. Drei Sorten sind ausdruecklich in
Ordnung, und sie werden hier BENANNT statt stillschweigend uebergangen:
  * Absichtlich entfernt  — der Weg macht `rm /etc/systemd/system/<Unit>`
    (mupi_change_checker: der Update-Weg raeumt sie weg).
  * Abgeloest             — dienste.ts fuehrt sie unter ABGELOEST samt Beleg
    (spotifyd: das Programm ist auf keiner Box installiert).
  * Anleitung/Werkzeug    — README.md und Skripte, die niemand aufruft.

KOPIERT IST NICHT AUFGERUFEN — die zweite Etage derselben Fehlerklasse
Beim Gegenlesen am 04.08.2026 fiel auf, dass dieses Werkzeug in seiner ersten
Fassung `scripts/mupibox/` auf beiden Wegen als "rollt aus" meldete und dabei
etwas uebersah: dhcp-schneller.sh WURDE kopiert, aber nur autosetup.sh rief es
auch auf. Der Update-Weg legte ein Einrichtungsskript ab, das nie lief — fuer
eine laufende Box genau so wirkungslos, als waere es gar nicht angekommen.
Deshalb pruefen wir Einrichtungsskripte getrennt: nicht "wird die Datei
angefasst?", sondern "wird sie AUFGERUFEN?" (Abschnitt 3, Liste AUFRUF_NOETIG).

ANGELEGT IST NICHT EINGESCHALTET — die dritte Etage (04.08.2026, BACKLOG E11c)
Beim Ausrollen der Boot-Animation fiel die naechste Stufe derselben Frage auf:
eine Unit kann sauber unter /etc/systemd/system/ liegen und trotzdem NIE
laufen, weil niemand `systemctl enable` sagt. Vor der Box ist das nicht zu
unterscheiden von "gar nicht da" — der Schirm bleibt schwarz. Abschnitt 4
prueft deshalb die Liste EINGESCHALTET_NOETIG, und dazu die Gegenrichtung:
`systemctl enable` auf eine Unit, die keine frische Karte hat, laeuft ins Leere
und meldet nichts.

Die drei Etagen in einem Satz:
    1. Kommt die Datei auf die Box?          (Abschnitte 1 und 2)
    2. Wird sie AUFGERUFEN?                  (Abschnitt 3)
    3. Wird die Unit EINGESCHALTET?          (Abschnitt 4)

AUFRUF
    python3 tools/ausrollweg-deckung.py            volle Tabelle
    python3 tools/ausrollweg-deckung.py --pruefen  nur Befunde, fuer pruefen.sh

RUECKGABE: 0 = alles gedeckt oder begruendet, 1 = mindestens ein Loch.
"""

import os
import re
import sys

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ══ ES SIND DREI WEGE, NICHT ZWEI (berichtigt 19.08.2026, E48) ══════════════
#
# Die DietPi-Inventur hat den Fehler dieses Werkzeugs selbst gefunden: es
# meldete `scripts/soloist/` als „kein Ausrollweg fasst das an", obwohl
# tools/ausliefern.py die Skripte seit dem 19.08. traegt und das Rezept die
# Units legt. Es kannte schlicht nur die beiden Schalen-Wege.
#
# Ein Werkzeug, das eine Luecke meldet, die keine ist, wird nach dem dritten
# Mal nicht mehr gelesen — und dann meldet es die ECHTE Luecke an niemanden.
# DIE ZWEI WEGE, DIE EINE KARTE BAUEN. Nur fuer sie gilt die Regel „angelegt
# ist nicht eingeschaltet": sie richten eine Box von Grund auf ein, und was
# sie nicht enable-n, laeuft nie.
WEGE = [
    ("autosetup", "autosetup/autosetup.sh"),
    ("update", "update/start_mupibox_update.sh"),
]

# DIE UEBRIGEN DREI — sie zaehlen NUR bei der Frage „kommt die Datei ueberhaupt
# irgendwo an?", nicht bei der Einschalt-Regel.
#
# Sie kamen am 19.08.2026 dazu (E48), weil dieses Werkzeug `scripts/soloist/`
# als „kein Ausrollweg fasst das an" meldete, obwohl ausliefern.py die Skripte
# traegt und das Rezept die Units legt. Es kannte nur die beiden oben.
#
# WARUM SIE NICHT IN `WEGE` STEHEN: `ausliefern` beliefert eine LAUFENDE Box —
# dort ist die Unit laengst eingeschaltet, ein enable waere sinnlos. Wer sie
# derselben Regel unterwirft, bekommt drei Meldungen fuer denselben Sachverhalt
# und liest das Werkzeug nach dem dritten Mal nicht mehr.
WEGE_NUR_DECKUNG = [
    ("rezept", "remote-step-installer/recipes/mupibox-app.yaml"),
    ("ausliefern", "tools/ausliefern.py"),
    ("einrichten", "scripts/systemd/einrichten.sh"),
]

# ── DER WEG, DER HEUTE DIE KARTEN BAUT ──────────────────────────────────────
#
# `WEGE` oben nennt sich „DIE ZWEI WEGE, DIE EINE KARTE BAUEN". Das stimmte,
# als es nur autosetup.sh gab. Eine frische Karte entsteht heute ueber den
# remote-step-installer — und der stand in WEGE_NUR_DECKUNG, also ausdruecklich
# NICHT unter der Regel „angelegt ist nicht eingeschaltet". Was das kostet, hat
# der 31.08.2026 dreimal gezeigt: die vier Bluetooth-Skripte, die Sammelkopie
# mit 8 von 17 Verzeichnissen und `loginctl enable-linger` fehlten alle GENAU
# auf diesem Weg, und jedes Mal fand es ein Mensch, keine Wache.
#
# DIE UNGLEICHHEIT, um die es hier geht, ist keine Feinheit, sondern der
# ganze blinde Fleck: das Rezept kopiert `config/services` PAUSCHAL
#     - src: .../config/services   ->   install -m 644 mupi-svc/services/*.service
# waehrend es jede Unit aus `scripts/systemd/` EINZELN benennen muss. Eine Unit,
# die dort dazukommt, ist damit auf einer frischen Karte per Vorgabe NICHT
# dabei, und keine Etage darueber hat danach gefragt.
#
# ZWEI SCHRAENKUNGEN, beide am Rezept nachgemessen und nicht geraten:
# * die Pauschalzeile nimmt nur `*.service` — `.timer` und `.path` aus
#   config/services muessen ebenfalls einzeln stehen (so entstand E29: die
#   ausloesenden .path/.timer der Sicherung kamen nie an, Audit 13.08.2026).
# * gemessen wird gegen BEIDE Rezepte, nicht nur mupibox-app.yaml — eine Unit
#   darf auch im Grundrezept stehen.
REZEPTE = [
    "remote-step-installer/recipes/mupibox-app.yaml",
    "remote-step-installer/recipes/mupibox.yaml",
]
# Die Pauschalzeile, auf die sich die Ausnahme oben stuetzt. Sie wird zur
# Laufzeit nachgelesen: aendert das Rezept sie, faellt die Annahme auf, statt
# still weiterzugelten — eine Ausnahme, die ihre eigene Grundlage nicht mehr
# findet, ist eine Falschauskunft.
REZEPT_PAUSCHAL = re.compile(
    r"install\s+-m\s+\d+\s+mupi-svc/services/\*(\.\w+)\s"
)
REZEPT_PAUSCHAL_QUELLE = "config/services"

# Verzeichnisse unter scripts/, die NICHT auf die Box gehoeren, mit Grund.
# Sie stehen hier, damit der naechste Leser nicht dieselbe Frage neu stellt.
SCRIPTS_MIT_GRUND = {
    "hwdetect": "laeuft beim SD-Bestuecken, nicht auf der Box (scripts/make-boot-sd.sh)",
    "online": "wird von Hand aufgerufen, wenn ein RTL88x2BU-Stick dranhaengt",
}

# Dateien, die absichtlich im Repo bleiben und nicht ausgerollt werden.
DATEIEN_MIT_GRUND = {
    "librespot/README.md": "Anleitung, kein Programm",
    "librespot/librespot-start.sh": "ruft niemand auf — librespot.service startet direkt",
    "systemd/einrichten.sh": "der Handweg selbst — wird per scp + sudo bash gefahren, nicht ausgerollt",
}

# ══ ZWEI QUELLORDNER FUER UNITS — UND KEINE UNIT DARF IN BEIDEN LIEGEN ══════
#
# Seit E42 liegen Units an ZWEI Orten: config/services/ (der alte Vorrat) und
# scripts/systemd/ (die E42-/MixPi-Units, dort neben einrichten.sh). Das ist
# in Ordnung, SOLANGE jede Unit genau EINE Quelle hat: die librespot-Frage vom
# 22.08.2026 („die Unit kommt aus drei Quellen") loest sich genau dadurch,
# dass alle Wege DIESELBE Repo-Datei kopieren. Zwei Dateien gleichen Namens in
# beiden Ordnern waeren der Rueckfall — zwei Fassungen, die auseinanderlaufen,
# und welche gewinnt, haengt von der Reihenfolge der Kopierbloecke ab.
# Abschnitt 1 prueft beide Ordner und meldet Doppelgaenger als Befund.
UNIT_QUELLEN = ["config/services", "scripts/systemd"]

# Units, die MIT ABSICHT nur der Handweg (scripts/systemd/einrichten.sh) legt:
# Geraeteausstattung, die nicht an jede Box gehoert. Wer hier etwas eintraegt,
# sagt damit: diese Unit haengt an Hardware oder an einem Messaufbau, den der
# Betreiber je Box bewusst einrichtet. Geprueft wird trotzdem — dass der
# Handweg sie WIRKLICH kennt (DIENSTE-Zeile), sonst ist der Grund eine
# Falschauskunft.
NUR_HANDWEG_MIT_GRUND = {
    # mupi_taster/mupi_knopflicht standen hier bis 29.08.2026: die Handweg-
    # Zwillinge sind abgebaut, einrichten.sh legt seither die kanonischen
    # mupi_offtrigger/mupi_powerled aus config/services — die der Ausrollweg
    # ohnehin deckt.
    "netzabriss-sonde.service": "Messaufbau der WLAN-Abriss-Jagd, gehoert nicht auf jede Box",
    "mixpi-wlan-adapter.service": "Adapterwahl wlan0/wlan1: nur sinnvoll, wo ein zweiter Stick steckt",
}

# UNITS, DIE EIN AUSROLLWEG EINSCHALTEN DARF, OHNE SIE MITZUBRINGEN.
#
# Die Gegenprobe in Abschnitt 4 fragt: was schaltet ein Weg ein, das auf einer
# frischen Karte gar nicht liegt? Genau eine Antwort ist harmlos — eine Unit,
# die das BETRIEBSSYSTEM mitbringt (smbd, ein dietpi-Dienst aus dem Abbild).
# Die steht dann hier, mit Grund. Wer eintraegt, sagt: „die liegt auf jeder
# frischen Karte, bevor unser Skript laeuft" — eine pruefbare Behauptung.
#
# BIS ZUM 27.08.2026 STAND HIER STATTDESSEN EIN NAMENSFILTER:
#
#     if not unit.startswith(("mupi_", "mupibox-", "librespot", "soloist", "mixpi-")):
#         continue
#
# und darueber der Satz, fremde Units erkenne man am fehlenden Hauspraefix
# („smbd, dietpi-*"). Das ist zweimal falsch. Erstens ist es eine Namenssuche
# durch die Hintertuer, dieselbe Blindstelle, die am selben Tag aus
# tools/umgebungsvariablen-deckung.py geflogen ist: geprueft wird, wer sich an
# die Konvention haelt; wer abweicht, ist unsichtbar. Zweitens stimmt die
# Beispielbegruendung nicht — dietpi-dashboard.service liegt in
# config/services/, wir bringen sie selbst mit. FUENF unserer 42 ausgerollten
# Units tragen kein Hauspraefix: dietpi-dashboard, pulseaudio, spotifyd,
# systemd-user-sessions, wifi-powersave-off. Fuer die war die Gegenprobe blind.
#
# Gemessen (erfundene `systemctl enable`-Zeile, autosetup):
#   mupibox-neuling.service        alter Filter MELDET   ohne Filter MELDET
#   kioskwache.service             alter Filter STILL    ohne Filter MELDET
#   wifi-powersave-off-neu.service alter Filter STILL    ohne Filter MELDET
#   dietpi-neu.service             alter Filter STILL    ohne Filter MELDET
#
# Die Liste ist LEER, und das ist gemessen, keine Bequemlichkeit: heute
# erreicht keine einzige eingeschaltete Unit diese Stelle — jede liegt in einem
# Quellordner oder wird namentlich kopiert. Eine leere Ausnahmeliste ist die
# ehrliche Fassung eines Filters, der nichts auszuschliessen hat.
FREMD_MIT_GRUND: dict = {}

# BEKANNTE LOECHER MIT NUMMER — gemeldet, aber nicht rot.
#
# Warum diese Unterscheidung sein muss: dieses Werkzeug laeuft in
# tools/pruefen.sh. Eine Pruefung, die IMMER rot ist, liest nach zwei Wochen
# niemand mehr — und dann faellt der naechste ECHTE Befund darin nicht auf.
# Was hier steht, muss im BACKLOG mit derselben Nummer stehen; wer es
# eintraegt, ohne es dort zu haben, macht aus einer Pruefung eine Ausrede.
BEKANNT_OFFEN = {
    "scripts/box/": "BACKLOG E12/X5 — es fehlt nicht nur der Weg, es fehlt auch die Unit",
}

# EINRICHTUNGSSKRIPTE: kopieren reicht nicht, sie muessen LAUFEN.
#
# Die meisten Dateien unter scripts/ sind Werkzeuge, die spaeter jemand oder
# etwas aufruft — fuer die genuegt "liegt auf der Box". Diese hier sind anders:
# sie stellen bei der Installation EINMAL etwas um und tun danach nie wieder
# etwas. Werden sie nur kopiert, ist die Umstellung nicht passiert, und man
# sieht es an nichts.
#
# WER HIER ETWAS EINTRAEGT, entscheidet damit: dieses Skript gehoert in BEIDE
# Wege. Das ist eine Aussage ueber laufende Boxen — der Update-Weg ist der
# einzige, der sie je erreicht. Umgekehrt gehoert hier NICHTS hin, was auf
# einer laufenden Box Schaden anrichten koennte, wenn es beim Update laeuft;
# beide Eintraege unten sind wiederholbar und haben einen Rueckweg.
AUFRUF_NOETIG = {
    "dhcp-schneller.sh": (
        "haengt drei Zeilen an dhclient.conf an (BACKLOG E5/B1, 4,96 s "
        "gemessen). Wiederholbar, Rueckweg --zuruecknehmen"
    ),
    "piper-einrichten.sh": (
        "legt venv und Stimme an (BACKLOG E12/X9). Ueberspringt, was da ist"
    ),
    "fehlerbild-anhaengen.sh": (
        "legt die OnFailure-Zusatzstuecke neben die Dienste (BACKLOG E11c/S3). "
        "Wiederholbar, Rueckweg --zuruecknehmen"
    ),
    "mixpi-plugins-nachziehen.sh": (
        "zieht die Erweiterungen versioniert nach (fassung aus plugin.json) — "
        "das alte `cp -rn` liess sie fuer immer auf dem Erststand. Wiederholbar"
    ),
}

# DROP-INS: dieselbe Frage wie bei Units, nur eine Ablage tiefer. Das
# Engine-Drop-In haengt die ExecCondition an librespot.service — ohne es
# laufen nach dem Umschalten auf Soloist BEIDE Tonmaschinen um dieselbe
# Senke. Es ist keine Unit (Abschnitt 1 sieht es nicht) und kein Skript
# (Abschnitt 3 auch nicht), also hier: beide Schalen-Wege muessen die
# Quelldatei ablegen.
DROPINS_NOETIG = {
    "scripts/systemd/librespot-engine.conf": (
        "der Engine-Schalter (E42): ExecCondition an librespot.service — "
        "ohne ihn laufen nach dem Umschalten beide Tonmaschinen zugleich"
    ),
}

# ANGELEGT IST NICHT EINGESCHALTET — die DRITTE Etage derselben Fehlerklasse.
#
# Etage 1 war "die Datei liegt im Repo, kein Weg bringt sie hin" (der
# librespot-Waechter). Etage 2 war "der Weg kopiert sie, ruft sie aber nie auf"
# (dhcp-schneller.sh, Abschnitt 3). Etage 3 fand sich am 04.08.2026 bei E11c:
# eine Unit kann sauber unter /etc/systemd/system/ liegen und trotzdem NIE
# LAUFEN, weil niemand `systemctl enable` sagt. Fuer den Menschen vor der Box
# ist das nicht zu unterscheiden von "gar nicht da".
#
# WAS HIER NICHT HINEINGEHOERT: alles, was absichtlich nur ANGELEGT wird.
# mupi_fan.service ist das Musterbeispiel — ein Luefter gehoert nicht an jede
# Box, die Unit ist mit Absicht inert. Wer hier etwas eintraegt, sagt damit:
# DAS MUSS AUF JEDER BOX LAUFEN.
EINGESCHALTET_NOETIG = {
    "mupibox-boot-splash.service": (
        "sonst bleibt der Schirm die gemessenen 19 bis 24 s schwarz "
        "(BACKLOG E11c/S2, tools/grundmessung.py)"
    ),
    "mupibox-kioskwache.timer": (
        "der einzige Waechter ueber dem Kiosk — der hat keine Unit, an die "
        "sich OnFailure haengen liesse (BACKLOG E11c/S4)"
    ),
    # NACHGETRAGEN 08.08.2026, nachdem dieses Werkzeug seine eigene dritte
    # Etage bei genau der Unit uebersprungen hat, um die es gerade geht:
    # nimmt man `systemctl enable mupi_offtrigger.service` aus
    # update/start_mupibox_update.sh heraus, blieb es GRUEN. Geprueft wurde
    # nur, ob die Unit KOPIERT wird — und „angelegt ist nicht eingeschaltet"
    # ist die Etage darueber. Beim Ausschalter faellt sie besonders teuer aus:
    # eine Unit unter /etc/systemd/system/, die niemand einschaltet, ist vor
    # der Box nicht davon zu unterscheiden, dass es sie gar nicht gibt — der
    # Knopf tut in beiden Faellen nichts, und der Betreiber schaltet weiter
    # hart aus.
    "mupi_offtrigger.service": (
        "sonst gibt es kein weiches Ausschalten am Knopf und die Box haengt "
        "an der 6-Sekunden-Notabschaltung der Platine"
    ),
    # E42 (22.08.2026): der Engine-Schalter muss den Neustart ueberleben.
    # soloist.service wird enabled, aber NIE gestartet — die ExecCondition
    # entscheidet. Ohne enable wirkt der Schalter in der Verwaltung genau bis
    # zum naechsten Neustart, dann ist die Box still und librespot disabled.
    "soloist.service": (
        "sonst gilt der Engine-Schalter nur bis zum naechsten Neustart "
        "(enabled, nie gestartet — die ExecCondition entscheidet)"
    ),
    "soloist-updater.timer": (
        "der 90-Tage-Verfall: ohne den Timer stirbt Soloist drei Monate "
        "nach dem Bau, und niemand weiss warum"
    ),
    # 22.08.2026: der Update-Weg STOPPTE und STARTETE beide, legte sie aber
    # nie — und enable stand nur in autosetup. Ohne diese beiden Dienste ist
    # die Box keine Box; sie MUESSEN auf jeder laufen.
    "mupibox-server.service": (
        "der Backend-Dienst (Port 8200) — ohne ihn zeigt die Box nichts an"
    ),
    "mupibox-player.service": (
        "der Abspieldienst (Port 5005) — ohne ihn spielt nichts ausser Spotify"
    ),
}

# Units, die mit ABSICHT nur angelegt und nicht eingeschaltet werden — hier
# benannt, damit niemand sie fuer ein Versehen haelt und "repariert".
NUR_ANGELEGT_MIT_GRUND = {
    "mupi_fan.service": "ein Luefter gehoert nicht an jede Box; die Verwaltung schaltet ihn ein",
    "mupi_splash.service": "abgeloest von mupibox-boot-splash — beide zugleich stritten um /dev/fb0",
    "mupibox-fehlerbild@.service": "Vorlage; systemd startet sie ueber OnFailure, sie wird nie enabled",
    "mupibox-kioskwache.service": "haengt am Zeitgeber mupibox-kioskwache.timer",
}


def lies(pfad: str) -> str:
    try:
        with open(os.path.join(WURZEL, pfad), encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return ""


def ohne_kommentar(text: str) -> str:
    """
    Kommentarzeilen zaehlen NICHT als Ausrollen.

    Das ist keine Feinheit: in autosetup.sh steht seit dem 04.08.2026 ein
    langer Kommentarblock, in dem `librespot-konto.py` und `scripts/box`
    namentlich vorkommen. Wer stumpf grept, haelt beide fuer erledigt — den
    einen zu Recht, den anderen nicht.
    """
    return "\n".join(z for z in text.splitlines() if not z.lstrip().startswith("#"))


def abgeloeste_dienste() -> set:
    """Was dienste.ts unter ABGELOEST fuehrt — samt Beleg, hier nur die Namen."""
    text = lies("src/backend-api/src/dienste.ts")
    schnitt = text.split("export const ABGELOEST", 1)
    if len(schnitt) < 2:
        return set()
    # Bis zur naechsten Ausfuhr auf oberster Ebene lesen.
    block = re.split(r"\n(?:export |})", schnitt[1], maxsplit=1)[0]
    return set(re.findall(r"'([\w.-]+\.service)':", block))


def units_die_die_verwaltung_anbietet() -> set:
    """
    Welche Units kann jemand ueber die Oberflaeche einschalten?

    Zwei Quellen, weil es ZWEI Verwaltungen gibt (E6 laeuft noch): die feste
    Liste in AdminInterface/www/backend.php und jedes `systemctl enable` im
    PHP-Admin. Der Angular-Weg filtert nach Praefix und listet damit alles,
    was auf der Box existiert — er kann hier nichts beitragen, weil er die
    Liste vom Geraet holt und nicht aus dem Quelltext.
    """
    namen = set()
    php = lies("AdminInterface/www/backend.php") + lies("AdminInterface/www/mupi.php")
    namen |= set(re.findall(r"'([\w-]+\.service)'", php))
    namen |= set(re.findall(r"systemctl (?:enable|disable) ([\w-]+\.service)", php))
    return namen


def eingeschaltete_units(text: str) -> set:
    """Welche Units schaltet dieser Weg ein? -> Menge voller Unit-Namen.

    ZWEI SCHREIBWEISEN, und beide muessen mit, sonst faellt der halbe Bestand
    still durch:

      * einzeln:  `systemctl enable mupibox-boot-splash.service`
      * in einer Schleife:
            for service in mupi_wifi mupi_check_internet …; do
                systemctl enable ${service}.service

    Die Schleife ist die gefaehrlichere von beiden, und die Schleife wird hier
    WOERTLICH nachgebildet, nicht wohlwollend gelesen: sie haengt `.service`
    an JEDEN Eintrag an. Wer einen Timer hineinschreibt, laesst systemd nach
    "mupibox-kioskwache.timer.service" suchen — die gibt es nicht, und
    `systemctl enable` sagt dazu nichts, was in `>&3` noch auffiele.

    Beim Bauen dieses Abschnitts am 04.08.2026 hat genau das den Unterschied
    gemacht: eine erste Fassung ergaenzte ".service" nur, wenn kein Punkt im
    Namen stand — und meldete die Falle deshalb als in Ordnung. Ein Werkzeug,
    das den Fehler nachbaut, den es sucht, ist keines. Die Gegenprobe steht
    seither in der Pruefung: Timer in die Schleife schreiben, Werkzeug muss
    ROT werden.
    """
    namen = set()
    # `(?:--[\w-]+\s+)*` schluckt Optionen wie `--now`. OHNE DAS fing die
    # Namensgruppe die Option selbst: `systemctl enable --now mupibox-server`
    # lieferte "--now" als Unit-Namen — der Bindestrich steht in der
    # Zeichenklasse. Gefunden am 22.08.2026, als mupibox-server.service in
    # EINGESCHALTET_NOETIG kam und autosetup rot wurde, OBWOHL dort ein
    # `enable --now` steht. tools/units-decken-sich.sh war am 14.08. in
    # exakt dieselbe Falle gelaufen und traegt denselben Vermerk.
    for treffer in re.findall(r"systemctl\s+enable\s+(?:--[\w-]+\s+)*([\w@.-]+)", text):
        namen.add(treffer if "." in treffer else treffer + ".service")
    for kopf, rumpf in re.findall(r"for\s+service\s+in\s+([^;\n]+)(.{0,400})",
                                  text, re.S):
        # Was haengt der Rumpf an? Fast immer ".service" — aber nachsehen,
        # statt es zu wissen.
        anhang = ".service" if "${service}.service" in rumpf else ""
        for wort in kopf.split():
            if wort in ("do", ";"):
                continue
            namen.add(wort + anhang)
    return namen


def deckung(name: str, texte: dict) -> dict:
    """Was tut jeder Weg mit dieser Unit? Beide Quellordner zaehlen."""
    quellen = "|".join(re.escape(q) for q in UNIT_QUELLEN)
    stand = {}
    for weg, text in texte.items():
        if re.search(rf"(?:{quellen})/{re.escape(name)}\b", text):
            stand[weg] = "rollt aus"
        elif re.search(rf"rm\s+/etc/systemd/system/{re.escape(name)}\b", text):
            stand[weg] = "raeumt weg"
        else:
            stand[weg] = "—"
    return stand


def im_rezept(name: str, quelle: str, rezepte_text: str) -> bool:
    """Legt der Installer-Weg diese Unit auf eine frische Karte?

    Gefragt wird nach dem ZIEL, nicht nach der Quelle — sonst meldet dieses
    Werkzeug Luecken, die keine sind. Genau so passierte es beim Bau am
    31.08.2026: `mupibox-bt-reconnect.timer` galt als ungedeckt, weil das
    Rezept sie aus `remote-step-installer/tools/` nimmt statt aus
    `config/services/`. Beide Fassungen sind inhaltsgleich (nachgemessen), die
    Unit kommt an — der Befund war reiner Quellpfad-Aberglaube. Auf der Box
    entscheidet, was in /etc/systemd/system landet.

    DREI WEGE also, alle am Rezept nachgelesen (siehe REZEPTE):
    1. das Rezept legt sie unter ihrem Namen nach /etc/systemd/system;
    2. es benennt sie mit einem der bekannten Quellpfade;
    3. sie liegt in dem Ordner, den das Rezept pauschal kopiert, UND traegt
       die Endung, die die Pauschalzeile mitnimmt.

    Die Pauschalzeile wird dabei WIRKLICH GESUCHT, nicht angenommen. Findet
    sie sich nicht mehr, gelten nur noch Weg 1 und 2 — dann meldet dieses
    Werkzeug lieber zu viel als eine Deckung, die es nicht mehr gibt.
    """
    if re.search(rf"/etc/systemd/system/{re.escape(name)}\b", rezepte_text):
        return True
    quellen = "|".join(re.escape(q) for q in UNIT_QUELLEN)
    if re.search(rf"(?:{quellen})/{re.escape(name)}\b", rezepte_text):
        return True
    if quelle != REZEPT_PAUSCHAL_QUELLE:
        return False
    treffer = REZEPT_PAUSCHAL.search(rezepte_text)
    return bool(treffer) and name.endswith(treffer.group(1))


def handweg_dienste() -> set:
    """Welche Units richtet scripts/systemd/einrichten.sh ein?

    einrichten.sh nennt seine Units NICHT mit Quellpfad, sondern ueber die
    DIENSTE-Zeile (`DIENSTE=(mupi_offtrigger …)`) plus einzelne install-Zeilen
    (`${HIER}/soloist-updater.timer`). Ein Pfad-Grep sieht beides nicht —
    deshalb wird hier gelesen, was das Skript wirklich tut.
    """
    text = ohne_kommentar(lies("scripts/systemd/einrichten.sh"))
    namen = set()
    treffer = re.search(r"DIENSTE=\(([^)]*)\)", text)
    if treffer:
        namen |= {wort + ".service" for wort in treffer.group(1).split()}
    namen |= set(re.findall(r"\$\{HIER\}/([\w.-]+\.(?:service|timer|path))", text))
    return namen


def main() -> int:
    still = "--pruefen" in sys.argv
    texte = {name: ohne_kommentar(lies(pfad)) for name, pfad in WEGE}
    zusatz = {name: ohne_kommentar(lies(pfad)) for name, pfad in WEGE_NUR_DECKUNG}
    # BEIDE Rezepte, und OHNE Kommentare: die Rezepte begruenden ihre Schritte
    # ausfuehrlich, und ein Unit-Name in einer Begruendung ist kein Ausrollen.
    rezepte_text = "\n".join(ohne_kommentar(lies(pfad)) for pfad in REZEPTE)
    abgeloest = abgeloeste_dienste()
    angeboten = units_die_die_verwaltung_anbietet()
    befunde = []
    bekannt = []
    zeilen = []

    # ── 1. Units — aus BEIDEN Quellordnern ──────────────────────────────────
    #
    # Seit E42 liegen Units auch unter scripts/systemd/ (Herleitung bei
    # UNIT_QUELLEN). Bis zum 22.08.2026 sah dieser Abschnitt nur
    # config/services/ — die Soloist-Units fielen damit STILL durch alle vier
    # Etagen: keine Zeile in der Tabelle, kein Befund, nichts. Ein Werkzeug,
    # das eine ganze Quelldatei-Klasse nicht kennt, meldet deren Luecken an
    # niemanden.
    unit_endungen = (".service", ".timer", ".path")
    unit_quellen = {}
    for quelle in UNIT_QUELLEN:
        for name in sorted(os.listdir(os.path.join(WURZEL, quelle))):
            # In scripts/systemd/ liegen auch einrichten.sh und das
            # Engine-Drop-In — Units sind nur die drei Endungen.
            if not name.endswith(unit_endungen):
                continue
            if name in unit_quellen:
                befunde.append(
                    f"{name}: liegt in {unit_quellen[name]}/ UND {quelle}/ — "
                    f"zwei Quellen laufen auseinander, und welche auf der Box "
                    f"landet, entscheidet die Reihenfolge der Kopierbloecke. "
                    f"Eine muss weg."
                )
                continue
            unit_quellen[name] = quelle
    handweg = handweg_dienste()
    for name in sorted(unit_quellen):
        stand = deckung(name, texte)
        anmerkung = "" if unit_quellen[name] == "config/services" else "Quelle scripts/systemd/. "
        if name in abgeloest:
            anmerkung += "abgeloest (dienste.ts, mit Beleg)"
        elif name in NUR_ANGELEGT_MIT_GRUND:
            anmerkung += "nur angelegt: " + NUR_ANGELEGT_MIT_GRUND[name]
        elif name in NUR_HANDWEG_MIT_GRUND:
            anmerkung += "nur Handweg: " + NUR_HANDWEG_MIT_GRUND[name]
        gedeckt = any(v == "rollt aus" for v in stand.values())
        weggeraeumt = any(v == "raeumt weg" for v in stand.values())
        zeilen.append(
            f"  {name:<34} {stand['autosetup']:<11} {stand['update']:<11} {anmerkung}"
        )

        # Handweg-Units brauchen keinen Schalen-Weg — aber der Grund darf
        # keine Falschauskunft sein: einrichten.sh muss sie WIRKLICH kennen
        # (DIENSTE-Zeile oder install-Zeile). Sonst laege die Unit im Repo
        # und KEIN Weg, auch kein Handweg, braechte sie je auf eine Box.
        if name in NUR_HANDWEG_MIT_GRUND:
            if name not in handweg:
                befunde.append(
                    f"{name}: als 'nur Handweg' begruendet, aber "
                    f"scripts/systemd/einrichten.sh kennt die Unit gar nicht — "
                    f"der Grund ist eine Falschauskunft, kein Weg legt sie."
                )
            continue

        # ── DIE VIERTE ETAGE: „auf einer frischen Karte" ist nicht „auf der
        #    Box des Betreibers" ───────────────────────────────────────────
        #
        # HIER STAND NUR `any(...)`, UND DAS WAR DAS LOCH. Eine Unit, die
        # autosetup.sh ausrollt und der Update-Weg nicht, ging gruen durch —
        # obwohl sie damit AUF KEINER LAUFENDEN BOX ANKOMMT. autosetup laeuft
        # beim Bespielen einer frischen Karte, sonst nie; wer eine Box hat und
        # sie aktualisiert, bekommt genau nichts.
        #
        # GEFUNDEN AM 08.08.2026 an mupi_offtrigger.service: die Unit wurde am
        # 07.08. gebaut, autosetup.sh nahm sie auf, der Update-Weg nicht. Die
        # Tabelle zeigte brav „rollt aus / —", dieses Werkzeug wurde gruen, und
        # der Ausschalter des Betreibers blieb der, den es nie gab. Ein
        # Werkzeug, das die Luecke ANZEIGT und trotzdem gruen wird, haelt
        # nichts — es macht die Luecke nur amtlich.
        #
        # DIE ANDERE RICHTUNG IST ERLAUBT UND BLEIBT ES: nur im Update-Weg und
        # nicht in autosetup zu stehen heisst „das raeumt einen alten Stand
        # weg" (mupi_change_checker) und ist damit richtig. Gemeldet wird
        # deshalb nur die eine Richtung.
        if (
            stand["autosetup"] == "rollt aus"
            and stand["update"] == "—"
            and name not in abgeloest
            and name not in NUR_ANGELEGT_MIT_GRUND
        ):
            befunde.append(
                f"{name}: autosetup.sh rollt die Unit aus, "
                f"update/start_mupibox_update.sh NICHT. Sie kommt damit nur auf "
                f"frisch bespielte Karten — auf keine laufende Box. Wer "
                f"aktualisiert, bekommt sie nie."
            )

        # ── DIE FUENFTE ETAGE: „auf einer frischen Karte" heisst HEUTE das
        #    Rezept, nicht mehr autosetup.sh ───────────────────────────────
        #
        # Herleitung und die zwei nachgemessenen Schraenkungen stehen oben bei
        # REZEPTE. Gefunden am 31.08.2026 an soloist-anmeldewache.service/
        # .timer: die Tabelle zeigte „rollt aus / rollt aus", das Werkzeug war
        # gruen — und das Rezept nimmt beide nicht mit. Seit der Sammelkopie
        # desselben Tages kommt das SKRIPT der Wache auf jede frische Box
        # (scripts/soloist/ steht in der Kopierschleife), der TAKT nicht. Die
        # Selbstheilung gegen den nach dem Start stummen Soloist laeuft dort
        # also nie, und nichts daran sieht kaputt aus.
        if (
            name not in abgeloest
            and name not in NUR_ANGELEGT_MIT_GRUND
            and not im_rezept(name, unit_quellen[name], rezepte_text)
        ):
            befunde.append(
                f"{name}: kein Rezept des remote-step-installer legt die Unit "
                f"an. Auf einer frisch bespielten Karte gibt es sie nicht — "
                f"autosetup.sh und der Update-Weg helfen dort nicht, die laufen "
                f"nicht mit."
            )

        if gedeckt or weggeraeumt or name in abgeloest:
            continue
        # Ungedeckt. Schlimm wird es erst, wenn die Verwaltung sie anbietet.
        if name in angeboten:
            befunde.append(
                f"{name}: kein Ausrollweg legt die Unit an — aber die Verwaltung "
                f"bietet sie zum Einschalten an. Auf einer frischen Karte laeuft "
                f"`systemctl enable {name}` ins Leere, und zwar ohne Meldung."
            )
        else:
            befunde.append(f"{name}: kein Ausrollweg legt die Unit an.")

    # ── 2. Skriptverzeichnisse ──────────────────────────────────────────────
    scripts_dir = os.path.join(WURZEL, "scripts")
    for eintrag in sorted(os.listdir(scripts_dir)):
        pfad = os.path.join(scripts_dir, eintrag)
        if not os.path.isdir(pfad):
            continue
        beruehrt = {
            weg: bool(re.search(rf"scripts/{re.escape(eintrag)}/", text))
            for weg, text in texte.items()
        }
        grund = SCRIPTS_MIT_GRUND.get(eintrag, "")
        zeilen.append(
            f"  scripts/{eintrag+'/':<26} "
            f"{'rollt aus' if beruehrt['autosetup'] else '—':<11} "
            f"{'rollt aus' if beruehrt['update'] else '—':<11} {grund}"
        )
        if any(beruehrt.values()) or grund:
            # Verzeichnis wird angefasst — dann Datei fuer Datei nachsehen,
            # denn genau hier lag der konto.py-Fehler: das Verzeichnis kam
            # vor, die eine noetige Datei darin nicht.
            for datei in sorted(os.listdir(pfad)):
                schluessel = f"{eintrag}/{datei}"
                if schluessel in DATEIEN_MIT_GRUND or grund:
                    continue
                # Units aus scripts/systemd/ prueft Abschnitt 1 (mit
                # Handweg-Ausnahmen), das Engine-Drop-In der eigene
                # Abschnitt unten — hier waere jede Meldung ein Doppel.
                if eintrag == "systemd" and (
                    datei.endswith(unit_endungen) or datei in {
                        q.rsplit("/", 1)[1] for q in DROPINS_NOETIG
                    }
                ):
                    continue
                if re.search(rf"scripts/{re.escape(eintrag)}/\*", texte["autosetup"]):
                    continue  # das Sternchen nimmt alles mit
                if not any(
                    re.search(rf"scripts/{re.escape(schluessel)}\b", t)
                    for t in list(texte.values()) + list(zusatz.values())
                ):
                    befunde.append(
                        f"scripts/{schluessel}: liegt im Repo, kein Weg bringt es auf die Box."
                    )
            continue
        if any(re.search(rf"scripts/{re.escape(eintrag)}/", t) for t in zusatz.values()):
            continue  # einer der drei uebrigen Wege bringt es hin
        text = (
            f"scripts/{eintrag}/: kein Ausrollweg fasst dieses Verzeichnis an "
            f"({', '.join(sorted(os.listdir(pfad)))})."
        )
        nummer = BEKANNT_OFFEN.get(f"scripts/{eintrag}/")
        (bekannt if nummer else befunde).append(
            f"{text} {nummer}" if nummer else text
        )

    # ── 3. Einrichtungsskripte: werden sie AUFGERUFEN? ──────────────────────
    #
    # Gesucht wird der Aufrufpfad, nicht der Dateiname: `chmod 755
    # /usr/local/bin/mupibox/*` nennt keines dieser Skripte, und `mv
    # ${MUPI_SRC}/scripts/mupibox/* …` nennt sie auch nicht einzeln. Ein
    # Treffer auf /usr/local/bin/mupibox/<name> im kommentarfreien Text ist
    # also tatsaechlich ein Aufruf.
    for skript, zweck in sorted(AUFRUF_NOETIG.items()):
        gerufen = {
            weg: bool(re.search(rf"/usr/local/bin/mupibox/{re.escape(skript)}\b", text))
            for weg, text in texte.items()
        }
        zeilen.append(
            f"  {skript+' (Aufruf)':<34} "
            f"{'ruft auf' if gerufen['autosetup'] else '—':<11} "
            f"{'ruft auf' if gerufen['update'] else '—':<11} {zweck}"
        )
        for weg, ja in gerufen.items():
            if ja:
                continue
            befunde.append(
                f"{skript}: {weg} kopiert es, ruft es aber NICHT auf — "
                f"{zweck}. Kopiert ist nicht eingerichtet."
            )

    # ── 3b. Drop-Ins: legen beide Schalen-Wege sie ab? ──────────────────────
    #
    # Herleitung bei DROPINS_NOETIG. Gesucht wird der Dateiname der Quelle im
    # kommentarfreien Text — ein Weg, der sie ablegt, muss sie beim Namen
    # nennen (`mv …/librespot-engine.conf …/engine.conf`).
    for quelle_pfad, zweck in sorted(DROPINS_NOETIG.items()):
        dateiname = quelle_pfad.rsplit("/", 1)[1]
        gelegt = {
            weg: bool(re.search(rf"{re.escape(dateiname)}\b", text))
            for weg, text in texte.items()
        }
        zeilen.append(
            f"  {dateiname + ' (Drop-In)':<34} "
            f"{'rollt aus' if gelegt['autosetup'] else '—':<11} "
            f"{'rollt aus' if gelegt['update'] else '—':<11} {zweck}"
        )
        for weg, ja in gelegt.items():
            if ja:
                continue
            befunde.append(
                f"{dateiname}: {weg} legt das Drop-In nicht ab — {zweck}."
            )

    # ── 4. Units: werden sie EINGESCHALTET? ─────────────────────────────────
    #
    # Die dritte Etage (Herleitung bei EINGESCHALTET_NOETIG). Angelegt zu sein
    # heisst nicht zu laufen — und fuer den Menschen vor der Box ist eine Unit,
    # die nie startet, dasselbe wie eine, die es nicht gibt.
    eingeschaltet = {weg: eingeschaltete_units(text) for weg, text in texte.items()}
    for unit, zweck in sorted(EINGESCHALTET_NOETIG.items()):
        an = {weg: unit in menge for weg, menge in eingeschaltet.items()}
        zeilen.append(
            f"  {unit+' (an)':<34} "
            f"{'schaltet an' if an['autosetup'] else '—':<11} "
            f"{'schaltet an' if an['update'] else '—':<11} {zweck}"
        )
        for weg, ja in an.items():
            if ja:
                continue
            befunde.append(
                f"{unit}: {weg} legt die Unit an, schaltet sie aber NICHT ein — "
                f"{zweck}. Angelegt ist nicht eingeschaltet."
            )

    # Die Gegenprobe: was wird eingeschaltet, ohne dass es diesen Weg je
    # erreicht? Ein `systemctl enable` auf eine Unit, die auf einer frischen
    # Karte fehlt, meldet nichts Sichtbares und laesst genau den Eindruck
    # zurueck, alles sei in Ordnung.
    vorhandene = set(unit_quellen)
    for weg, menge in eingeschaltet.items():
        for unit in sorted(menge):
            if unit in vorhandene:
                continue
            if deckung(unit, texte)[weg] == "rollt aus":
                continue
            if unit in FREMD_MIT_GRUND:
                continue
            befunde.append(
                f"{unit}: {weg} ruft `systemctl enable` — aber keine Unit "
                f"dieses Namens liegt in config/services/. Auf einer frischen "
                f"Karte laeuft der Befehl ins Leere, und zwar ohne Meldung."
            )

    if not still:
        print(f"  {'Datei':<34} {'autosetup':<11} {'update':<11} Anmerkung")
        print("\n".join(zeilen))
        print()

    if bekannt:
        print("BEKANNT OFFEN — steht mit Nummer im BACKLOG, hier nur zur Erinnerung:")
        for b in bekannt:
            print(f"  * {b}")

    if befunde:
        print("UNGEDECKT — im Repo, aber auf keiner frischen Karte:")
        for b in befunde:
            print(f"  * {b}")
        return 1

    if not still:
        print("Jede Unit und jedes Skript hat einen Weg auf die Box — oder einen Grund.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
