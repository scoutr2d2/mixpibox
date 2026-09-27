#!/usr/bin/env python3
"""Die EINE Stelle, die sichert — und die zurueckspielt (BACKLOG E29/B1,B2,B3).

WARUM ES DAS GIBT
Am 04.08.2026 lagen auf der Box 99 beiseite gelegte Dateien, 163,1 MB, von
26.07. bis 04.08. Jede einzelne war richtig, als sie entstand; weggeraeumt hat
sie nie jemand. Das ist kein Platzproblem — die Konfiguration der Box ist
42 KB — sondern ein Disziplinproblem: es gab keine Stelle, die sichert, also
sicherte jeder von Hand, und jeder anders.

Und es gibt den Beleg, dass es weh tut: conf_update.sh loeschte bei JEDEM
Update den Schluessel `mediaCheckTimer`. Aus `sleep ${CHECK_TIMER}` wurde
`sleep null`, aus der Warteschleife eine Dauerschleife, und niemand sah es.
Ein Stand von vorher haette das in Minuten geklaert
([[conf-update-loescht-schluessel-den-noch-jemand-liest]]).

WAS HINEIN GEHOERT UND WAS NICHT — eine LISTE, kein `*.json`
Die Liste unten ist absichtlich namentlich. Ein `server/config/*.json` wuerde
jede kuenftige Datei stillschweigend einsammeln — auch eine, die Schluessel
enthaelt. Was weder auf der Ja- noch auf der Nein-Liste steht, wird GEMELDET
und NICHT mitgenommen. Lieber eine Frage im Bericht als eine Ueberraschung im
Archiv.

DIE ZUGANGSDATEN (E29/B6) — ZWEI LAGEN, und die Vorgabe ist die vorsichtige
Der Betreiber hat am 05.08.2026 entschieden: Zugangsdaten sollen mit, aber
NICHT im Klartext, und die Verschluesselung ist OPTIONAL mit einem Passwort.
Daraus folgen genau zwei Lagen — eine dritte („Klartext") gibt es absichtlich
nicht, sie waere eine Fussangel fuer spaeter:

    weglassen        die Vorgabe. Ohne Passwort geht kein Geheimnis ins
                     Archiv; der Stand sagt namentlich, was fehlt.
    verschluesselt   `--anlegen --mit-zugangsdaten`. Die elf Stellen aus
                     GEHEIM wandern in EINEN Behaelter (`zugangsdaten.gpg`),
                     verschluesselt mit AES256-OCB (echtes AEAD: ein falsches
                     Passwort scheitert LAUT und spielt nicht Unsinn ein).

NUR DIE GEHEIMNISSE SIND VERSCHLUESSELT, NIE DAS GANZE ARCHIV. Wer das Passwort
verliert, bekommt Bibliothek, gemerkte Stellen, Kinderzeit und Darstellung
trotzdem zurueck — nur WLAN und die Musikdienste nicht. Waere das ganze Archiv
verschluesselt, fiele der Rueckweg ohne SSH (E29/B3), und die woechentliche
Selbstprobe koennte nichts mehr pruefen.

WER TIPPT DAS PASSWORT — die Frage, die die Form bestimmt. `--anlegen` laeuft
selbsttaetig (Zeitgeber, Pfad-Wachhund, jede Auslieferung) und `--von-karte`
beim Booten als root: in beiden ist NIEMAND da, der etwas eingeben koennte.
Ein Passwort, das sie trotzdem erreichte, muesste auf der Box liegen — dann
waere es Theater statt Schutz. Also: Zugangsdaten kommen nur in einen Stand,
den jemand VON HAND angestossen hat, und der Rueckweg von der Karte spielt
alles andere ein und meldet namentlich, was verschluesselt danebenliegt.

DIE UMKEHRUNG BEIM ZURUECKSPIELEN IST DER HEIKLE TEIL. Ein Schluessel, der
nicht zurueckgeholt werden kann, wird NIE geschrieben — auch nicht als
Platzhalter. Er behaelt den Wert, der GERADE auf der Box steht. Andernfalls
loeschte eine Wiederherstellung genau die Zugangsdaten, die sie aus Vorsicht
nicht mitgenommen hat. Die Rangfolge steht in `wiederherstellen`.

AUFRUF
    mupibox-sicherung.py --anlegen [--grund text] [--wenn-anders] [--behalten]
                                   [--mit-zugangsdaten]
    mupibox-sicherung.py --liste [--json]
    mupibox-sicherung.py --zeigen <stand|neueste>
    mupibox-sicherung.py --pruefen [<stand|neueste>]
    mupibox-sicherung.py --wiederherstellen <stand|neueste> [--trocken]
                                   [--mit-zugangsdaten]
    mupibox-sicherung.py --probe          # Rueckweg gegen ein Testverzeichnis
    mupibox-sicherung.py --auf-karte      # Staende auf die FAT-Partition
    mupibox-sicherung.py --aufs-nas       # Staende zusaetzlich aufs Netzlaufwerk
    mupibox-sicherung.py --von-karte      # Rueckweg OHNE SSH (siehe unten)
    mupibox-sicherung.py --ernten <pfad>… # Altlasten in einen Stand aufnehmen
    mupibox-sicherung.py --selbsttest

DAS PASSWORT KOMMT NIE AUS DER BEFEHLSZEILE. `ps` zeigt Argumente jedem
Benutzer. Drei Wege, in dieser Reihenfolge:
    MUPIBOX_SICHERUNG_PW=…   Umgebungsvariable (fuer Skripte)
    ueber stdin              wenn die Eingabe keine Tastatur ist
    Eingabe                  sonst wird gefragt (beim Anlegen zweimal)

DER RUECKWEG OHNE SSH, Schritt fuer Schritt (E29/B3)
  1. Box ausschalten, Karte in einen beliebigen Rechner. Es meldet sich eine
     kleine FAT-Partition (~127 MB) — Windows, macOS und Linux koennen sie
     alle lesen.
  2. Im Ordner `mupibox-sicherung/` liegen die letzten Staende und ein
     LIESMICH.txt mit genau dieser Anleitung.
  3. Eine Textdatei `mupibox-wiederherstellen.txt` in das WURZELVERZEICHNIS der
     FAT-Partition legen (Notepad, TextEdit, egal). Inhalt: EINE Zeile mit dem
     Dateinamen des Standes — oder das Wort `neueste`.
  4. Karte zurueck, Box einschalten. Vor dem Server laeuft
     mupibox-wiederherstellung.service, spielt zurueck und benennt die
     Textdatei in `.erledigt-<zeit>.txt` um (damit sie NICHT bei jedem Start
     wieder losgeht).
  5. Der Befund steht danach als `mupibox-wiederherstellen-bericht.txt` auf
     derselben Partition — auch wenn der Bildschirm schwarz bleibt.
  Absichtlich reicht es NICHT, ein Archiv auf die Karte zu kopieren. Erst die
  Textdatei loest aus. Eine Sicherung, die man versehentlich einspielt, waere
  ein neuer Weg, Daten zu verlieren.
"""

from __future__ import annotations

import argparse
import fnmatch
import getpass
import gzip
import grp
import hashlib
import io
import json
import os
import pwd
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
from datetime import datetime

# ── Wo was liegt ───────────────────────────────────────────────────────────
BOX = "/home/dietpi/.mupibox/Sonos-Kids-Controller-master"
STAENDE = "/home/dietpi/.mupibox/sicherungen"
KARTE = "/boot/firmware"                       # die FAT-Partition, von jedem
KARTE_ORDNER = "mupibox-sicherung"             # Rechner lesbar
MARKE = "mupibox-wiederherstellen.txt"
BERICHT = "mupibox-wiederherstellen-bericht.txt"

# Solange diese Datei da ist, laeuft gerade eine Wiederherstellung.
# /run ist beim naechsten Start von selbst leer — eine Sperre, die einen
# Absturz ueberlebt, waere schlimmer als keine.
SPERRE = "/run/mupibox-sicherung-laeuft"
SPERRE_GILT = 600.0    # s — danach gilt sie als vergessen, nicht als gueltig

BEHALTEN = 10          # Staende im Haus
KARTE_BEHALTEN = 3     # Staende auf der Karte (127 MB Partition, ~12 KB je Stand)

# Der Behaelter fuer die Zugangsdaten liegt NEBEN den Dateien im selben
# Archiv — nicht als Chiffrat IN den .json-Dateien. Drei Gruende, jeder in
# diesem Skript belegbar:
#   * `konfig_pruefen` naehme ein Chiffrat als gueltiges interfacelogin
#     .password an — die Pruefung, die eine ausgesperrte Box verhindert,
#     ginge durch, und die Box waere trotzdem ausgesperrt.
#   * `probe()` verglich Chiffrat mit Chiffrat und meldete BESTANDEN.
#   * Ein Zurueckspielen OHNE Passwort schriebe das Chiffrat in die laufende
#     Konfiguration — genau der Schaden, gegen den
#     [[sicherung-ausgelassene-schluessel-nie-schreiben]] geschrieben wurde.
BEHAELTER = "zugangsdaten.gpg"
PW_UMGEBUNG = "MUPIBOX_SICHERUNG_PW"

# Zwei Baeume, zwei Wurzeln. Der Name im Archiv ist der Pfad OHNE fuehrenden
# Schraegstrich — damit ein Archiv nie ins Wurzelverzeichnis entpacken kann,
# auch nicht mit einem falsch gebauten tar.
BAEUME = {
    "etc/mupibox": "/etc/mupibox",
    "server/config": BOX + "/server/config",
}

# ── Was hinein gehoert (E29) ───────────────────────────────────────────────
# fnmatch-Muster je Baum. Absichtlich namentlich, siehe Kopf.
HINEIN = {
    # bt-adapter steht hier, weil der erste echte Lauf an der Box ihn als
    # „nicht eingeordnet" gemeldet hat — genau dafuer gibt es die dritte
    # Spalte. Es ist die MAC des gewaehlten Bluetooth-Adapters: Box-Zustand,
    # nirgends sonst vorhanden, und ohne ihn greift die Box nach dem
    # Zurueckspielen womoeglich zum falschen Funkteil.
    # `fernbedienung.json` kam am 06.09.2026 dazu, am selben Abend, an dem die
    # Fernbedienung und der Xbox-Controller angeschlossen wurden — und sie
    # gehoert aus demselben Grund hierher wie `klang.json`: WAS DARIN STEHT,
    # IST GEMESSEN. Welcher Code welche Taste ist, stand in keinem Datenblatt;
    # es wurde Taste fuer Taste am Geraet abgelesen (`fernbedienung.py --roh`),
    # inklusive der Erkenntnis, dass das Steuerkreuz des Controllers gar keine
    # Taste ist, sondern eine Achse. Ohne diese Datei ist die Box nach dem
    # Zurueckspielen nicht kaputt — die Fernbedienung tut nur einfach nichts
    # mehr, ohne Meldung, und der ganze Messabend waere noch einmal faellig.
    "etc/mupibox": ["mupiboxconfig.json", "bt-adapter", "mixpi-wlan-adapter", "fernbedienung.json"],
    "server/config": [
        "data.json",                    # die Bibliothek — das IST die Box
        "resume.json",                  # gemerkte Stellen
        "darstellung.json",
        "kinderzeit.json",
        # Das Netzlaufwerk (E28/N6-N9): Adresse, Freigabe, Anmeldename,
        # Einhaengepunkt — Boxzustand, nirgends sonst vorhanden, und ohne die
        # Datei weiss nach einer Wiederherstellung niemand mehr, wohin die
        # Staende gespiegelt wurden. Das PASSWORT steht nicht darin (es liegt
        # in /etc/mupibox/nas-zugang und ist oben ausdruecklich DRAUSSEN).
        "nas.json",
        # DAS VERZEICHNIS DER KINDER — wer es ist, wie es heisst, welche Figur
        # es hat, wer gerade dran ist. Es ist die EINZIGE Stelle, an der ein
        # Kind ueberhaupt EXISTIERT; sein Bestand liegt in `profile/<kennung>/`,
        # aber nur `profile.json` sagt, dass es diese Kennung gibt.
        #
        # SIE FEHLTE HIER, UND DAS WAR DER TEUERSTE EINZELNE VERLUST IM GANZEN
        # STAND (gemessen 07.08.2026, Sandkasten mit dem Aufbau der Box .169:
        # sichern, alles wegraeumen, zurueckspielen, Datei fuer Datei zaehlen —
        # `server/config/profile.json` kam als einzige Ablage nicht wieder).
        # Das Skript hat es sogar GESAGT („! nicht eingeordnet, NICHT
        # gesichert: server/config/profile.json") — nur steht diese Zeile auf
        # stdout eines Werkzeugs, das ab heute niemand mehr von Hand aufruft.
        #
        # WAS OHNE SIE PASSIERT, und warum es nicht auffaellt: nach dem
        # Zurueckspielen liest server.ts `profile.json`, findet nichts und
        # nimmt `standNormalisieren(null)` — das ist der Gast, allein. Die
        # Ordner `profile/kalea/` mit Verlauf, Zeitkonto, Listen und AUSWAHL
        # liegen vollstaendig da und sind von der Oberflaeche aus nicht mehr
        # erreichbar. Keine Fehlermeldung, keine Luecke, kein rotes Feld: das
        # Kind ist einfach nicht mehr da. Und wer es neu anlegt, bekommt seine
        # Sachen nur zurueck, wenn der Name zufaellig dieselbe Kennung ergibt.
        #
        # KEINE GEHEIMNISSE DARIN (Kennung, Name, Figur, Zeitpunkt, `aktiv`) —
        # deshalb steht sie in keiner Zeile von GEHEIM.
        "profile.json",
        # DIE PLUGIN-EINSTELLUNGEN (E35, 14.08.2026): Adresse, Benutzer und
        # Passwort jedes Plugins — z. B. der Navidrome-Zugang. Sie FEHLTE
        # hier (gefunden bei der Neuinstallations-Pruefung 15.08.2026):
        # nach dem Zurueckspielen waeren alle Plugins stumm auf Vorgabe,
        # ohne Meldung — dieselbe Verlustklasse wie einst profile.json.
        # Die geheimen Felder darin streicht GEHEIM (siehe unten).
        "plugin-einstellungen.json",
        # Equalizer, Versatz je Bluetooth-Box und die Ueberall-Auswahl
        # (15.08.2026). Ohne diese Datei ist die Box nach dem Zurueckspielen
        # nicht kaputt, aber anders eingestellt als eingemessen — und wer den
        # Versatz je Box einmal mit den Ohren abgeglichen hat, will das nicht
        # noch einmal tun.
        "klang.json",
        # Welche ARD-Sendung ihren Jingle ueberspringt und wie weit
        # (15.08.2026). Die Zahl ist GEMESSEN — nach dem Zurueckspielen
        # noch einmal eine Minute je Sendung zu messen waere vermeidbare
        # Arbeit, und ohne die Datei springt die Box wieder mitten in den
        # Jingle.
        "ard-vorspann.json",
        # DIE DREI FLACHEN FORMEN BLEIBEN STEHEN. Sie sind seit dem 05.08.2026
        # nicht mehr die laufende Form (siehe die drei Muster mit `profile/`
        # darunter), aber eine Box, die noch nicht neu gestartet hat, hat sie
        # noch — und eine Sicherung, die den Bestand einer solchen Box liegen
        # laesst, waere genau der Verlust, gegen den hier gebaut wird.
        "kinderzeit-verbrauch.*.json",  # je Profil (E18 Stufe 1)
        "gespielt.*.json",              # je Profil (E18 Stufe 1)
        "listen.json",                  # eigene Listen, box-weit (vor E18/S2)
        # ══ DREI, DIE AM 20.08.2026 „NICHT EINGEORDNET" GEMELDET WURDEN ═════
        # Genau die Zeile, die einst bei profile.json niemand las (siehe oben).
        # Diesmal wurde sie gelesen — beim Anlegen eines Standes vor dem Umbau
        # der Interpreten-Kennung.
        #
        # interpreten.json  DIE ENTSCHEIDUNGEN DER BOX UEBER IHRE INTERPRETEN:
        #   heute `abgelehnt` und `frei` (welche Zusammenlegung jemand
        #   verworfen bzw. erlaubt hat), kuenftig die box-eigene Kennung. Sie
        #   steht NIRGENDWO sonst — Spotify kennt sie nicht, data.json auch
        #   nicht. Geht sie verloren, kommen abgelehnte Verschmelzungen alle
        #   wieder, und niemand weiss, warum die Box ploetzlich Interpreten
        #   zusammenwirft, die jemand ausdruecklich getrennt hat.
        "interpreten.json",
        # albumstop.json  wo ein Album enden soll — eine Entscheidung, die
        #   jemand je Album getroffen hat, nicht aus den Dateien ableitbar.
        "albumstop.json",
        # profile/*/verlauf.json  was ein Kind gehoert hat. Dieselbe Klasse wie
        #   `gespielt.*.json` daneben, nur die neuere Form. NICHT zu verwechseln
        #   mit `systemverlauf.jsonl` (Telemetrie ueber die MASCHINE) — die
        #   gehoert ausdruecklich NICHT in den Stand, weil sie nach einem
        #   Kartenschaden ein Geraet beschreibt, das es nicht mehr gibt.
        "profile/*/verlauf.json",
        # ══ DER ZUSTAND DER PLUGINS (20.08.2026) ════════════════════════════
        # plugin-daten/<kennung>/  EIN Eintrag fuer ALLE Plugins, auch die, die
        #   es noch nicht gibt. Genau das ist der Punkt: Bis heute hatte ein
        #   Plugin keinen zugewiesenen Ort fuer seinen Zustand — jedes haette
        #   sich einen Pfad gesucht, und diese Liste haette keinen davon
        #   gekannt. Das ist die Bauart, an der oben schon profile.json
        #   verlorenging.
        #
        #   DER WIRT LEGT DEN ORDNER AN (plugin-wirt.ts, `datenWurzel`) und
        #   reicht ihn dem Plugin als `kontext.datenOrdner`. Wer dort schreibt,
        #   ist gesichert; wer sich einen eigenen Pfad ausdenkt, nicht — und
        #   genau deshalb steht es in beiden Dateien als Kommentar.
        "plugin-daten/*",
        # DER BEREICH — ein Ordner je Profil (E18 Stufe 2). Die Liste dieser
        # drei fuehrt src/backend-api/src/profile.ts (`BEREICH_ABLAGEN`); wer
        # sie dort erweitert, muss sie HIER nachziehen, sonst faellt die neue
        # Ablage aus der Sicherung. `tools/bereich-sicherung-deckung.py` misst
        # genau das nach und ist der Grund, dass es hier nicht wieder
        # auseinanderlaeuft.
        # SEIT E18 STUFE 4 (07.08.2026) HAT JEDES KIND EINE MEDIENAUSWAHL. Sie
        # ist der einzige Ort, an dem steht, WAS ein Kind sehen darf — geht sie
        # verloren, kippt das Kind still von "nur diese sechs" auf "alles", weil
        # eine leere Auswahl "alles" bedeutet. Kein Fehler, keine Meldung: das
        # Kind sieht nach dem Zurueckspielen die ganze Box.
        "profile/*/auswahl.json",
        # WIE ES FUER DIESES KIND AUSSIEHT (15.08.2026): Farbsatz, hell/dunkel,
        # Indikatoren, Kachelform. Seit heute je Profil (BEREICH_ABLAGEN in
        # profile.ts) — die box-weite `darstellung.json` oben bleibt daneben
        # stehen und traegt die THEMEN und den Rueckfall fuer Profile ohne
        # eigene Wahl. Fehlte diese Zeile, saehe nach dem Zurueckspielen jedes
        # Kind wieder aus wie die Box: kein Fehler, keine Meldung, nur die
        # eigene Wahl weg. `tools/bereich-sicherung-deckung.py` besteht darauf.
        "profile/*/darstellung.json",
        "profile/*/gespielt.json",
        "profile/*/kinderzeit-verbrauch.json",
        "profile/*/listen.json",
        # SEIT E18 STUFE 3 (05.08.2026) LIEGEN AUCH DIE GEMERKTEN STELLEN JE
        # KIND. `resume.json` oben trifft seitdem nur noch die BRUECKE — einen
        # Verweis, der als Verweis eingesammelt wird und keinen Inhalt traegt.
        # Ohne diese Zeile fielen die gemerkten Stellen aus der Sicherung
        # heraus, und das faellt erst beim ZURUECKSPIELEN auf. Am Modul
        # nachgemessen (05.08.2026, mit dem echten Bestand von .169):
        # `profile/gast/resume.json` landete in `unbekannt`, nicht in `dabei`.
        "profile/*/resume.json",
        # WELCHE VIDEOS DIESES KIND NOCH ANSCHAUEN DARF (20.09.2026). Eine
        # Belohnung, die ein Elternteil vergeben hat, und ein Zaehler, den
        # niemand rekonstruieren kann: Faellt die Datei aus der Sicherung,
        # steht nach dem Zurueckspielen "nichts freigegeben" — und das Kind
        # hat verloren, was es sich verdient hat, ohne dass es irgendwo eine
        # Meldung gibt. Die Regel dazu steht in videofreigabe.ts.
        "profile/*/videofreigaben.json",
        "verschmelzung.json",
        "monitor.json",
        "network.json",
        "offline_data.json",
        "offline_resume.json",
        "verfuegbarkeit.json",
        "vorlesen.json",
        "wlan.json",
        "config.json",
        "akkuverlauf.json",             # die Messreihe — siehe BEIWERK
    ],
}

# ── Was mitgeht, aber NICHT mitredet ───────────────────────────────────────
# BEIWERK ist eine Datei, die in den Stand gehoert, aber keine EINSTELLUNG
# ist. Sie zaehlt deshalb nicht bei der Frage „hat sich etwas geaendert?".
#
# WARUM ES DIESE ZWEITE SPALTE UEBERHAUPT GIBT — gemessen, nicht vermutet
# (tools/sicherung-geheim-vorpruefung.py Abschnitt C/D/E, .169, 05.08.2026):
#   Groesse    ist NICHT das Problem. akkuverlauf.json wiegt roh 189,6 KB,
#              im Stand kostet sie 11,5 KB -> 42,0 KB (Faktor 3,7); an ihrer
#              Obergrenze (akkuverlauf.ts, MAX_PUNKTE = 10080 = sieben Tage
#              im Minutentakt) 82,4 KB. Auf der Karte macht das 0,60 % des
#              freien Platzes, im Haus 1,1 MB. Beides folgenlos.
#   Kennung    IST das Problem. Der Server schreibt die Reihe alle zehn
#              Minuten (server.ts, AKKU_SCHREIB_JE=10). Zaehlte sie in die
#              `inhalt_kennung`, waere die IMMER anders — `--wenn-anders`
#              unterdrueckte NIE mehr einen Lauf, jeder Anstoss legte einen
#              vollen Stand an, und das Kontingent von 10 rollte durch.
#              Damit fiele genau die Vorkehrung aus
#              [[aufraeum-sicherung-vor-der-entscheidung]]: folgenlose
#              Staende verdraengten den einen, auf den es ankommt.
# Die Reihe geht also MIT, bleibt aber aus der Kennung heraus. Ein Stand ist
# dann etwas aelter als die letzte Messung — das ist bei einer Messreihe der
# unschaedliche Teil, beim Kontingent waere es der schaedliche.
#
# ZWEITE FOLGE, die leicht untergeht: `jsonfile.writeFile` schreibt auf die
# ZIELDATEI, akkuverlauf.json hat also dasselbe Nullbyte-Fenster wie
# data.json (siehe inhalt_klage). Eine Messreihe darf aber NIEMALS die
# Sicherung der Bibliothek verhindern — deshalb faellt ein unlesbares
# Beiwerk aus dem Stand heraus, statt ihn zu verweigern.
BEIWERK = {
    "server/config/akkuverlauf.json":
        "Messreihe des Akkus (akkuverlauf.ts) — geht mit, zaehlt aber nicht "
        "als Aenderung der Konfiguration",
}

# Was ausdruecklich DRAUSSEN bleibt — mit Begruendung, die im Stand landet.
DRAUSSEN = {
    "server/config": [
        ("coverspeicher", "Zwischenspeicher — nachladbar, 10 MB (E29)"),
        # ACHTUNG, DIESE ZEILE TRIFFT NICHTS UND SOLL ES AUCH NICHT. Sie hat
        # schon einmal den Eindruck erweckt, die Sicherung kenne die Sperre
        # des Servers. Sie tut es nicht: die Sperrdatei liegt in /tmp
        # (server.ts, `lockBasePath`), nicht in server/config, und gefragt
        # wird sie hier nirgends. Was die Sicherung STATTDESSEN tut, steht in
        # stand_bauen_stabil — zweimal lesen und vergleichen.
        (".data.lock", "Sperrdatei — liegt in Wahrheit in /tmp; dieses Muster "
                       "ist nur ein Schutz fuer den Fall, dass sie je hierher "
                       "zieht"),
        ("*.bak", "Altlast der Praxis von Hand — E29/B5 raeumt sie weg"),
        ("*.vor-*", "Altlast der Praxis von Hand — E29/B5 raeumt sie weg"),
        ("data-vor-aufraeumen-*", "Altlast der Praxis von Hand — E29/B5"),
        ("*.alt", "Altlast der Praxis von Hand — E29/B5"),
        ("active_*", "Verweis, kein Inhalt — steht unter `verweise` im Stand"),
    ],
    "etc/mupibox": [
        ("*.bak", "Altlast — E29/B5"),
        ("*.bak-*", "Altlast — E29/B5"),
        ("*.vor-*", "Altlast — E29/B5"),
        ("tls", "Schluesselmaterial (E15) — nicht in eine Sicherung"),
        # DIE ANMELDUNG AM NETZLAUFWERK (E28/N8). Sie steht aus demselben
        # Grund hier wie `tls`: eine Sicherung, die auf DIESES Netzlaufwerk
        # gespiegelt wird (--aufs-nas), traegt sonst den Schluessel zu dem
        # Ort mit, an dem sie liegt. Was die Box dafuer braucht, steht in
        # nas.json (Adresse, Freigabe, Anmeldename) — das Passwort nicht.
        # Nach einer Wiederherstellung ist das Netzlaufwerk deshalb
        # eingerichtet, aber noch nicht angemeldet; der Bericht sagt es.
        ("nas-zugang", "Passwort des Netzlaufwerks (E28/N8) — nicht in eine Sicherung"),
    ],
}

# ── Die Zugangsdaten (E29/B6) — weggelassen oder verschluesselt ────────────
# Zeiger: /schluessel/schluessel, `*` steht fuer jedes Element einer Liste.
# Diese Stellen gehen ohne `--mit-zugangsdaten` GAR NICHT ins Archiv und
# mit `--mit-zugangsdaten` NUR in den verschluesselten Behaelter. In den
# .json-Dateien des Archivs stehen sie in keinem Fall.
#
# DIE MASSGEBLICHE LISTE STEHT WOANDERS, und das ist der Grund, warum diese
# hier am 07.08.2026 gewachsen ist: `ohneGeheimnisse()` in
# src/backend-api/src/konfiguration.ts streicht genau die Werte, die aus dem
# Backend NIE hinausgehen duerfen. Seit es /api/sicherung gibt, ist eine
# Sicherung ein WEG NACH DRAUSSEN wie jeder andere — sie geht als Download in
# einen Browser, ueber eine Verbindung, die im Heimnetz ohne Anmeldung
# offensteht. Was dort gestrichen wird und hier mitgeht, ist ein Leck.
# Nachgemessen wird der Abgleich in tools/sicherung-was-geht-hinaus.ts,
# Ring 1: er baut eine Konfiguration mit gezeichneten Werten, legt einen Stand
# OHNE Zugangsdaten an und durchsucht die rohen Bytes nach jeder Marke.
GEHEIM = {
    # DIE PLUGIN-EINSTELLUNGEN: je Plugin ein Objekt, darin die Felder aus
    # seinem Manifest. Geheim ist heute genau EIN Feldname im ganzen Bestand
    # (`passwort`, Subsonic/Navidrome — nachgesehen in plugins/*/plugin.json).
    # WER EINEM NEUEN PLUGIN EIN geheim-FELD MIT ANDEREM NAMEN GIBT, MUSS ES
    # HIER NACHZIEHEN — sonst liegt es im Klartext in der Sicherung. Der
    # ehrliche Dauer-Fix waere, die Feldarten aus den Manifesten zu lesen;
    # bis dahin steht der Name hier und dieser Satz daneben.
    "server/config/plugin-einstellungen.json": [
        ("/*/passwort", "Plugin-Passwoerter (Felder der Art geheim, z. B. Navidrome)"),
    ],
    "etc/mupibox/mupiboxconfig.json": [
        ("/spotify/clientSecret", "Spotify-Geheimnis"),
        ("/spotify/accessToken", "Spotify-Zugang (laeuft ohnehin ab)"),
        ("/spotify/refreshToken", "Spotify-Dauerzugang — der eigentliche Schluessel"),
        # Spotify-Anmeldung von Hand. Sie steht in derselben Gruppe wie die
        # Token und wird von ohneGeheimnisse() mitgestrichen — wer sie hat,
        # hat das Konto selbst und nicht nur einen ablaufenden Zugang.
        ("/spotify/username", "Spotify-Benutzername — Teil der Anmeldung"),
        ("/spotify/password", "Spotify-Passwort im Klartext"),
        ("/interfacelogin/password", "Passwort der Verwaltung"),
        # DIE PIN VOR DEN EINSTELLUNGEN DER BOX. Sie steht als bcrypt-Hash da,
        # und ein Hash ist kein Klartext — aber sie ist VIER ZIFFERN lang, und
        # vier Ziffern sind aus einem Hash in Sekunden zurueckgerechnet. Genau
        # mit diesem Satz streicht konfiguration.ts sie aus /api/config; eine
        # Sicherung, die sie unverschluesselt mitnimmt, macht diesen Strich
        # wieder zunichte. Der Riegel, der ein Kind aus den Einstellungen
        # heraushaelt, gehoert nicht in eine Datei im Download-Ordner.
        ("/mupibox/einstellungsPin", "PIN vor den Einstellungen — vier Ziffern, "
                                     "aus dem Hash in Sekunden zurueckgerechnet"),
        ("/telegram/token", "Telegram-Schluessel"),
        ("/mqtt/password", "MQTT-Passwort"),
        ("/jellyfin/apikey", "Jellyfin-Schluessel"),
        ("/jellyfin/apiKey", "Jellyfin-Schluessel (andere Schreibweise)"),
        # DIE SOLOIST-SCHLUESSEL (spak_). Bis 22.08.2026 fehlten beide hier —
        # jede Sicherung im Download-Ordner trug sie im Klartext, waehrend
        # /api/stroeme sie muehsam maskiert (stromNachAussen). Ein spak_ ist
        # ein voller Wiedergabe-Zugang zum Spotify-Konto der Familie.
        ("/spotify/soloistApiKey", "Soloist-Schluessel (spak_) — Wiedergabe-Zugang zum Konto"),
        # Der ZWEITZUGANG fuer den Mitschnitt (eigenes Konto, zwei Stroeme
        # parallel — tools/box/zweitzugang-probe.py). An der Geraete-Gegenprobe
        # vom 22.08.2026 aufgefallen: er war der letzte spak_ im Archiv.
        ("/spotify/soloistApiKeyMitschnitt", "Soloist-Zweitzugang fuer den Mitschnitt (spak_)"),
        ("/spotify/stroeme/*/schluessel", "Soloist-Schluessel je Strom (spak_)"),
    ],
    "server/config/config.json": [
        ("/spotify/clientSecret", "Spotify-Geheimnis"),
        ("/spotify/refreshToken", "Spotify-Dauerzugang"),
    ],
    "server/config/wlan.json": [
        ("/*/pw", "WLAN-Passwort im Klartext — der Hausschluessel"),
    ],
}

# Was NICHT als geheim gilt, obwohl es so aussieht — damit die Entscheidung
# sichtbar ist und nicht als Versehen durchgeht.
BEWUSST_DRIN = {
    "etc/mupibox/mupiboxconfig.json": [
        ("/spotify/clientId", "Kennung der Anwendung, kein Schluessel — ohne "
                              "clientSecret nutzlos, und ohne sie ist die "
                              "Wiederherstellung unnoetig unvollstaendig"),
    ],
    "server/config/wlan.json": [
        ("/*/ssid", "Netzname — ohne ihn weiss niemand, welches Netz fehlt"),
    ],
}


# ── Zeiger in JSON (klein gehalten, `*` fuer Listen) ────────────────────────
def zeiger_teile(zeiger: str) -> list[str]:
    return [t for t in zeiger.split("/") if t != ""]


def zeiger_gehen(obj, teile: list[str]):
    """Liefert (behaelter, schluessel)-Paare fuer den letzten Schritt."""
    if not teile:
        return []
    kopf, rest = teile[0], teile[1:]
    if kopf == "*":
        if not isinstance(obj, list):
            return []
        treffer = []
        for element in obj:
            treffer.extend(zeiger_gehen(element, rest) if rest else [(obj, obj.index(element))])
        return treffer
    if not rest:
        if isinstance(obj, dict):
            return [(obj, kopf)] if kopf in obj else []
        return []
    if isinstance(obj, dict) and kopf in obj:
        return zeiger_gehen(obj[kopf], rest)
    return []


def zeiger_lesen(obj, zeiger: str):
    return [b[k] for b, k in zeiger_gehen(obj, zeiger_teile(zeiger))]


def zeiger_stellen(obj, teile: list[str], pfad: str = "") -> list[tuple[str, object]]:
    """Wie `zeiger_gehen`, aber mit dem KONKRETEN Zeiger je Fundstelle.

    -> [("/1/pw", <wert>), …]

    WARUM DAS GEBRAUCHT WIRD, obwohl es zeiger_gehen schon fast tut: der
    Behaelter muss die Werte spaeter wieder an DIESELBE Stelle legen. Bei
    `/*/pw` genuegt dafuer die Reihenfolge NICHT — hat der zweite von drei
    WLAN-Eintraegen kein `pw`, sind es zwei Werte fuer drei Plaetze, und wer
    sie der Reihe nach zurueckschreibt, haengt das Passwort ans falsche Netz.
    Ein Netz mit fremdem Passwort ist schlimmer als eines ohne: es verbindet
    nicht und sieht dabei vollstaendig aus.
    """
    if not teile:
        return []
    kopf, rest = teile[0], teile[1:]
    if kopf == "*":
        if not isinstance(obj, list):
            return []
        treffer: list[tuple[str, object]] = []
        for i, element in enumerate(obj):
            if rest:
                treffer.extend(zeiger_stellen(element, rest, f"{pfad}/{i}"))
            else:
                treffer.append((f"{pfad}/{i}", element))
        return treffer
    if not rest:
        if isinstance(obj, dict) and kopf in obj:
            return [(f"{pfad}/{kopf}", obj[kopf])]
        return []
    if isinstance(obj, dict) and kopf in obj:
        return zeiger_stellen(obj[kopf], rest, f"{pfad}/{kopf}")
    return []


def zeiger_setzen(obj, zeiger: str, wert) -> bool:
    """Legt `wert` an eine KONKRETE Stelle (kein `*`). -> True bei Erfolg.

    ES WIRD NIE EIN LISTENPLATZ ERFUNDEN. Steht im Behaelter `/2/pw`, die
    zurueckgespielte wlan.json hat aber nur zwei Eintraege, dann gehoert
    dieses Passwort zu einem Netz, das es nicht mehr gibt — es anzuhaengen
    hiesse, ein WLAN zu erfinden. Fehlende ZWISCHEN-Woerterbuecher werden
    dagegen angelegt: `/spotify/refreshToken` muss auch dann ankommen, wenn
    `spotify` in der gesicherten Datei leer geraeumt wurde.
    """
    teile = zeiger_teile(zeiger)
    if not teile or "*" in teile:
        return False
    ziel = obj
    for t in teile[:-1]:
        if isinstance(ziel, list):
            if not t.isdigit() or not 0 <= int(t) < len(ziel):
                return False
            ziel = ziel[int(t)]
        elif isinstance(ziel, dict):
            if t not in ziel:
                ziel[t] = {}
            elif not isinstance(ziel[t], (dict, list)):
                return False        # da steht etwas anderes — nicht ueberbauen
            ziel = ziel[t]
        else:
            return False
    letzt = teile[-1]
    if isinstance(ziel, list):
        if not letzt.isdigit() or not 0 <= int(letzt) < len(ziel):
            return False
        ziel[int(letzt)] = wert
        return True
    if isinstance(ziel, dict):
        ziel[letzt] = wert
        return True
    return False


def zeiger_entfernen(obj, zeiger: str) -> int:
    """Entfernt den Schluessel ganz — KEIN Platzhalter.

    Ein Platzhalter waere die schlechtere Wahl: er sieht wie ein Wert aus.
    Genau daran ist `sleep null` gescheitert — ein Wert, den niemand gesetzt
    hat, den aber jeder liest.
    """
    weg = 0
    for behaelter, schluessel in zeiger_gehen(obj, zeiger_teile(zeiger)):
        if isinstance(behaelter, dict) and schluessel in behaelter:
            del behaelter[schluessel]
            weg += 1
    return weg


def _listen_zuordnung(zl: list, ql: list, schluessel: str) -> list[tuple[int, int]]:
    """Welcher Eintrag im Ziel ist DERSELBE wie welcher in der Quelle?

    NICHT UEBER DEN LISTENPLATZ — das war ein echter Fehler und ist am
    05.08.2026 beim Gegenlesen aufgefallen (tools/e29b6-adversarisch.py,
    Punkt G). Der Fall, an dem es zerbrach:

        im Stand (aelter)    [ {ssid: A}, {ssid: B} ]     pw ist ausgelassen
        auf der Box (heute)  [ {ssid: B, pw: <B>} ]       A wurde entfernt
        Platz fuer Platz  -> [ {ssid: A, pw: <B>}, {ssid: B} ]

    Das Passwort von B haengt danach an Netz A, und B hat gar keines. Genau
    das, was zeiger_stellen fuer den Weg MIT Behaelter verhindert — nur eben
    auf dem Weg OHNE, und der ist die Vorgabe und laeuft bei jedem
    Zurueckspielen von der Karte. Es faellt auch nicht auf: die Datei sieht
    vollstaendig aus, die Box verbindet nur nicht mehr.

    Erkannt wird ein Eintrag deshalb an seinem UEBRIGEN Inhalt (bei wlan.json
    ist das die `ssid`, die bewusst mitgeht — siehe BEWUSST_DRIN). Nur wenn
    genau EIN Eintrag der Quelle in allen diesen Feldern uebereinstimmt, gilt
    er als derselbe. Zwei Treffer (zwei Netze gleichen Namens) sind kein
    Treffer: raten waere hier teurer als liegen lassen, denn was nicht
    uebernommen wird, nennt der Bericht namentlich.

    NUR wenn sich an KEINEM Eintrag irgendein Merkmal findet (eine Liste aus
    blossen Werten etwa), bleibt der Platz — und auch dann nur, wenn beide
    Listen gleich lang sind. Sonst ist der Platz eine Vermutung.
    """
    def merkmale(e) -> dict:
        return {k: v for k, v in e.items()
                if k != schluessel and isinstance(v, (str, int, float, bool))}

    mit_merkmal = [i for i, e in enumerate(zl)
                   if isinstance(e, dict) and merkmale(e)]
    if not mit_merkmal:
        return [(i, i) for i in range(len(zl))] if len(zl) == len(ql) else []
    paare = []
    for i in mit_merkmal:
        m = merkmale(zl[i])
        treffer = [j for j, q in enumerate(ql)
                   if isinstance(q, dict) and all(q.get(k) == v
                                                  for k, v in m.items())]
        if len(treffer) == 1:
            paare.append((i, treffer[0]))
    return paare


def zeiger_uebernehmen(ziel, quelle, zeiger: str) -> bool:
    """Traegt den Wert aus `quelle` an derselben Stelle in `ziel` ein.

    Damit behaelt ein ausgelassener Schluessel beim Zurueckspielen den Wert,
    der GERADE auf der Box steht. -> True, wenn etwas uebernommen wurde.
    """
    teile = zeiger_teile(zeiger)
    if "*" in teile:
        # Listen: NICHT Platz fuer Platz, sondern Eintrag zu Eintrag —
        # Begruendung und der Fall, an dem es zerbrach, in _listen_zuordnung.
        vorne = teile[: teile.index("*")]
        hinten = teile[teile.index("*") + 1:]
        zl = _tief(ziel, vorne)
        ql = _tief(quelle, vorne)
        if not isinstance(zl, list) or not isinstance(ql, list):
            return False
        getan = False
        for i, j in _listen_zuordnung(zl, ql, hinten[0] if hinten else ""):
            getan |= zeiger_uebernehmen(zl[i], ql[j], "/" + "/".join(hinten))
        return getan
    behaelter_z = _tief(ziel, teile[:-1])
    behaelter_q = _tief(quelle, teile[:-1])
    if isinstance(behaelter_z, dict) and isinstance(behaelter_q, dict) \
            and teile[-1] in behaelter_q:
        behaelter_z[teile[-1]] = behaelter_q[teile[-1]]
        return True
    return False


def _tief(obj, teile):
    for t in teile:
        if isinstance(obj, dict) and t in obj:
            obj = obj[t]
        else:
            return None
    return obj


# ── Der Behaelter: das Einzige, was verschluesselt wird ────────────────────
#
# ES WIRD HIER KEINE KRYPTOGRAPHIE ERFUNDEN. Salz, S2K, Nonce, Pruefmarke und
# eine Fassungsnummer sind der Teil, an dem man sich schneidet — gpg bringt
# ihn fertig mit, `cryptography` und node geben nur Bausteine und ueberlassen
# einem den Behaelter. Gemessen an .169 (tools/krypto-vorrat-schau.py,
# 05.08.2026): python3-cryptography FEHLT, `openssl enc` kann KEIN AEAD (ein
# falsches Passwort liefert dort Muell statt eines Fehlers — genau der Fall,
# der ausgeschlossen werden muss), age fehlt. gpg 2.4.7 ist da und kann OCB.
#
# `--force-ocb` ist der Schalter, der aus MDC echtes AEAD macht:
#     --symmetric                :symkey enc packet: version 4, aead 0
#     --symmetric --force-ocb    :symkey enc packet: version 5, aead 2  (OCB)
# GEMESSEN, beide Richtungen: falsches Passwort -> rc=2 und NULL Byte
# Ausgabe; EIN verdrehtes Byte -> rc=2, NULL Byte, „gcry_cipher_checktag
# failed". Es scheitert also laut, statt Unsinn einzuspielen.
#
# PREIS, ehrlich: SEIPD v2/OCB liest erst GnuPG >= 2.4. Die Box hat 2.4.7,
# heutiges Gpg4win auch — ein altes 2.2 auf einem fremden Rechner nicht.
#
# UND DIE GEFAEHRLICHSTE STELLE IST NICHT DAS VERFAHREN, SONDERN DAS PAKET:
# gnupg ist auf .169 nur ANGEWEHT (Recommends von build-essential, letzter
# Zweig der Kette `sq | sqop | … | gnupg`) und steht in KEINER Paketliste.
# Deshalb steht es jetzt namentlich in autosetup.sh, und deshalb schlaegt
# `--probe` Alarm, wenn ein Stand einen Behaelter traegt und gpg fehlt
# ([[e29b7-gpg-kann-doch-aead-und-gnupg-ist-nur-angeweht]]).
GPG_GEMEINSAM = ["--batch", "--yes", "--quiet", "--no-tty",
                 # Der Agent darf sich das Passwort NICHT merken, und er darf
                 # kein Eingabefenster suchen (es gibt keines).
                 "--no-symkey-cache", "--pinentry-mode", "loopback"]
GPG_PACKEN = ["--symmetric", "--force-ocb", "--cipher-algo", "AES256",
              "--s2k-mode", "3", "--s2k-digest-algo", "SHA512",
              "--s2k-count", "65011712"]


def gpg_pfad() -> str | None:
    return shutil.which("gpg")


def _kind_umgebung(heim: str) -> dict[str, str]:
    """Die Umgebung fuer gpg — OHNE das Passwort.

    GEGENGELESEN AM 05.08.2026 UND DABEI GEFUNDEN: ein `{**os.environ}`
    reicht `MUPIBOX_SICHERUNG_PW` an jedes Kind weiter. Gemessen an .169,
    indem waehrend eines echten `--anlegen --mit-zugangsdaten` jeder eigene
    Prozess in /proc abgetastet wurde (tools/e29b6-adversarisch.py, Punkt A):
    das Passwort stand in `/proc/<gpg>/environ`. Die Befehlszeile war sauber
    — nur eben nicht die Umgebung daneben.

    WARUM DAS ZAEHLT, obwohl `/proc/<pid>/environ` nur dem Eigentuemer
    gehoert: derselbe Benutzer ist hier auch der Server und der
    Abspieldienst. Und die Muehe mit `--passphrase-fd` ist genau dafuer
    gemacht, dass das Passwort NICHT in einem Feld liegt, das ein anderer
    Vorgang desselben Benutzers auslesen kann. Ein Leck neben der
    verriegelten Tuer.

    WAS DAMIT NICHT BEHOBEN IST, und das gehoert dazu: im EIGENEN Prozess
    bleibt es stehen, wenn jemand den Weg ueber die Umgebungsvariable
    waehlt. `unsetenv` aendert `/proc/self/environ` unter Linux nicht — der
    Block stammt aus dem execve. Wer das nicht will, gibt das Passwort ueber
    stdin oder die Tastatur ein; nur dort steht es in KEINER Umgebung
    (gemessen, ebenfalls Punkt A).
    """
    umgebung = {k: v for k, v in os.environ.items() if k != PW_UMGEBUNG}
    umgebung["GNUPGHOME"] = heim
    umgebung["LC_ALL"] = "C"
    return umgebung


def _gpg(argv: list[str], passwort: str, eingabe: bytes) -> tuple[int, bytes, bytes]:
    """gpg in einem WEGWERF-Heim; das Passwort geht ueber einen eigenen fd.

    VIER DINGE, DIE HIER NICHT ANDERS GEHEN:
      * NICHT IN DIE BEFEHLSZEILE. `ps` zeigt Argumente jedem Benutzer auf
        der Box — ein `--passphrase geheim` waere oeffentlich. Also ein
        vererbter Dateizeiger (`pass_fds`), den nur das Kind sieht.
      * NICHT IN DIE UMGEBUNG DES KINDES. Siehe _kind_umgebung — das war
        beim Gegenlesen der einzige Fund, und er hat die Muehe mit dem
        Dateizeiger daneben zunichte gemacht.
      * NICHT AUF DIE PLATTE. Klartext geht ueber stdin hinein und ueber
        stdout heraus; es entsteht keine Datei, die jemand vergessen kann.
      * EIN EIGENES GNUPGHOME. Sonst fasst gpg den Schluesselbund des
        Benutzers an (bei `sudo` waere das /root/.gnupg) und laesst einen
        Agenten stehen. Beides wird hier angelegt und wieder weggeraeumt.
    """
    gpg = gpg_pfad()
    if not gpg:
        return 127, b"", b"gpg ist auf dieser Box nicht installiert"
    with tempfile.TemporaryDirectory(prefix="mupibox-gpg-") as tmp:
        heim = os.path.join(tmp, "heim")
        os.mkdir(heim, 0o700)
        lesen, schreiben_fd = os.pipe()
        try:
            os.write(schreiben_fd, passwort.encode("utf-8"))
        finally:
            os.close(schreiben_fd)
        try:
            fertig = subprocess.run(
                [gpg, "--homedir", heim, *GPG_GEMEINSAM,
                 "--passphrase-fd", str(lesen), *argv],
                input=eingabe, capture_output=True, pass_fds=(lesen,),
                env=_kind_umgebung(heim))
        finally:
            os.close(lesen)
            subprocess.run([shutil.which("gpgconf") or "gpgconf",
                            "--homedir", heim, "--kill", "all"],
                           capture_output=True, check=False,
                           env=_kind_umgebung(heim))
        return fertig.returncode, fertig.stdout, fertig.stderr


def behaelter_packen(klartext: bytes, passwort: str) -> bytes:
    rc, aus, fehler = _gpg(GPG_PACKEN, passwort, klartext)
    if rc != 0 or not aus:
        raise SystemExit("Der Behaelter fuer die Zugangsdaten liess sich "
                         "nicht verschluesseln (gpg rc=%d): %s"
                         % (rc, fehler.decode("utf-8", "replace").strip()))
    return aus


def behaelter_auspacken(behaelter: bytes, passwort: str) -> bytes:
    """-> Klartext. Wirft SystemExit, wenn die Echtheitspruefung nicht haelt.

    HIER DARF NICHTS „HALB" GELINGEN. Ein falsches Passwort und ein
    verdrehtes Byte geben beide rc=2 und null Byte; wer das durchliesse,
    schriebe Muell in die Konfiguration der Box.
    """
    rc, aus, fehler = _gpg(["--decrypt"], passwort, behaelter)
    if rc != 0 or not aus:
        raise SystemExit(
            "Die Zugangsdaten liessen sich NICHT oeffnen (gpg rc=%d): %s\n"
            "Entweder ist das Passwort falsch, oder der Behaelter ist "
            "beschaedigt. Es wurde NICHTS eingespielt.\n"
            "Ohne `--mit-zugangsdaten` spielt derselbe Stand alles andere "
            "zurueck." % (rc, fehler.decode("utf-8", "replace").strip()))
    return aus


def behaelter_kopf(behaelter: bytes) -> str | None:
    """Was fuer ein Paket ist das — OHNE Passwort? -> Zeile oder None.

    Die woechentliche Probe hat kein Passwort und kann den Behaelter deshalb
    nicht oeffnen. Sie kann aber pruefen, ob gpg ihn ueberhaupt noch als
    verschluesseltes Paket erkennt — und vor allem, ob es gpg noch GIBT.
    Genau das ist der Ausfall, den sonst erst der Ernstfall zeigt.
    """
    gpg = gpg_pfad()
    if not gpg:
        return None
    with tempfile.TemporaryDirectory(prefix="mupibox-gpgschau-") as tmp:
        heim = os.path.join(tmp, "heim")
        os.mkdir(heim, 0o700)
        try:
            # `--pinentry-mode loopback` IST HIER PFLICHT, nicht Schmuck.
            # `--list-packets` will die Sitzung entschluesseln, findet kein
            # Passwort und WARTET dann auf ein Eingabefenster, das es auf
            # einer Box ohne Bildschirm nie geben wird. GEMESSEN, gleiche
            # Datei, gleicher Rechner:
            #     ohne loopback   60,4 s   (Zeitueberschreitung des Agenten)
            #     mit  loopback    0,005 s
            # Beide Male rc=2 und dieselbe Kopfzeile — der Unterschied ist
            # NUR die Wartezeit. In der woechentlichen Probe waeren das 60 s
            # geschenkte Laufzeit in einer Unit mit TimeoutStartSec.
            fertig = subprocess.run(
                [gpg, "--homedir", heim, "--batch", "--no-tty",
                 "--pinentry-mode", "loopback", "--list-packets"],
                input=behaelter, capture_output=True,
                env=_kind_umgebung(heim))
        finally:
            subprocess.run([shutil.which("gpgconf") or "gpgconf",
                            "--homedir", heim, "--kill", "all"],
                           capture_output=True, check=False,
                           env=_kind_umgebung(heim))
    text = (fertig.stdout + fertig.stderr).decode("utf-8", "replace")
    # ZWEI SCHREIBWEISEN, beide gemessen (05.08.2026) — wer nur eine kennt,
    # baut einen Pruefer, der auf dem einen Rechner blind ist:
    #   Box .169, gpg 2.4.7   „gpg: AES256.OCB encrypted session key"
    #   Arbeitsplatz, 2.4.9   „:symkey enc packet: version 5, …, aead 2, …"
    for zeile in text.splitlines():
        if "encrypted session key" in zeile or "symkey enc packet" in zeile:
            return zeile.replace("gpg: ", "").strip()
    return None


def ist_aead(kopf: str | None) -> bool:
    """Steht in dieser Kopfzeile ein AEAD-Paket — oder nur MDC?

    `aead 0` bzw. eine Zeile ohne OCB waere die alte Fassung: verschluesselt
    schon, aber ohne Pruefung IM Verfahren. Ein falsches Passwort faellt dort
    nicht zwingend auf, und genau das soll ausgeschlossen sein.
    """
    if not kopf:
        return False
    gross = kopf.upper()
    if any(w in gross for w in ("OCB", "EAX", "GCM")):
        return True
    for teil in kopf.split(","):
        teil = teil.strip()
        if teil.startswith("aead ") and teil[5:].strip() not in ("", "0"):
            return True
    return False


def passwort_holen(zweck: str, bestaetigen: bool = False) -> str:
    """Das Passwort — aus der Umgebung, von stdin oder von der Tastatur.

    NIE AUS DER BEFEHLSZEILE (`ps`), NIE AUF DIE KARTE, NIE INS JOURNAL. Wer
    es irgendwo ablegt, hat Theater gebaut statt Schutz.

    DIE DREI WEGE SIND NICHT GLEICH SICHER, und das gehoert hierher statt in
    eine Fussnote (gemessen 05.08.2026, tools/e29b6-adversarisch.py Punkt A):

      Tastatur  am dichtesten. Steht in keiner Umgebung, in keinem argv.
      stdin     ebenso dicht — gemessen: waehrend des ganzen Laufs stand das
                Passwort in KEINEM Prozess, auch nicht im eigenen.
      Umgebung  bequem, aber es steht danach in `/proc/<dieser Lauf>/environ`,
                bis der Lauf endet. An die KINDER wird es nicht mehr
                weitergereicht (_kind_umgebung), aber aus dem eigenen Block
                bekommt man es nicht mehr heraus: `unsetenv` aendert
                /proc/self/environ unter Linux nicht.
                Wer den Weg waehlt, sollte wissen, dass jeder Vorgang
                DESSELBEN Benutzers ihn waehrenddessen lesen kann — auf
                dieser Box sind das Server und Abspieldienst.
    """
    aus_umgebung = os.environ.get(PW_UMGEBUNG)
    if aus_umgebung:
        return aus_umgebung
    if not sys.stdin.isatty():
        zeile = sys.stdin.readline()
        if not zeile.strip():
            raise SystemExit(
                f"Kein Passwort auf der Eingabe. Entweder {PW_UMGEBUNG} "
                f"setzen oder es ueber stdin hereingeben.")
        return zeile.rstrip("\n")
    eins = getpass.getpass(f"Passwort {zweck}: ")
    if not eins:
        raise SystemExit("Leeres Passwort — abgebrochen.")
    if bestaetigen:
        if getpass.getpass("noch einmal:              ") != eins:
            raise SystemExit("Die beiden Eingaben waren nicht gleich — "
                             "abgebrochen, es wurde nichts angelegt.")
    return eins


# ── Die Pruefungen aus [[mupi-konfiguration-schreiben]] ─────────────────────
def konfig_pruefen(d: dict) -> list[str]:
    """Was die Box unbrauchbar macht — VOR dem Schreiben, nicht danach.

    Diese Liste ist nicht erfunden; sie steht so im Wiki, und der letzte
    Punkt hat einen ganzen Abend gekostet.
    """
    schlimm = []
    anmeldung = d.get("interfacelogin") or {}
    if anmeldung.get("state") in (True, "true") and not anmeldung.get("password"):
        schlimm.append("interfacelogin.state=an bei LEEREM Passwort — "
                       "danach kaeme niemand mehr in die Verwaltung")
    mupi = d.get("mupibox") or {}
    # DIE SPERRE OHNE PIN steht hier ABSICHTLICH NICHT, obwohl sie in dieselbe
    # Reihe gehoerte. Sie wird eine Etage weiter oben AUFGELOEST statt hier
    # beklagt (`wiederherstellen`, Abschnitt 1b): ein Nein waere die
    # schlimmere Sackgasse — die Bibliothek bliebe weg, weil eine PIN fehlt.
    # Zwei Fassungen derselben Absicherung waeren eine zu viel; die eine wuerde
    # eines Tages verschaerft und die andere nicht.
    if not str(mupi.get("audioDevice") or "").strip():
        schlimm.append("mupibox.audioDevice ist leer — die Box waere stumm")
    try:
        start = float(mupi.get("startVolume", 0) or 0)
        maxi = float(mupi.get("maxVolume", 100) or 100)
        if start > maxi:
            schlimm.append(f"startVolume ({start:g}) > maxVolume ({maxi:g})")
    except (TypeError, ValueError):
        schlimm.append("startVolume/maxVolume sind keine Zahlen")
    timer = mupi.get("mediaCheckTimer", "__fehlt__")
    if timer in ("__fehlt__", None, "null", ""):
        schlimm.append("mupibox.mediaCheckTimer fehlt — change_checker.sh "
                       "setzt den Wert in `sleep` ein: `sleep null` faellt "
                       "sofort durch, und aus der Warteschleife wird eine "
                       "Dauerschleife (belegt, 03.08.2026)")
    return schlimm


# ── Einsammeln ─────────────────────────────────────────────────────────────
def passt(name: str, muster: list[str]) -> bool:
    return any(fnmatch.fnmatch(name, m) for m in muster)


def tiefe_wurzeln(baum: str) -> list[str]:
    """Welche UNTERORDNER eines Baums betreten werden — abgeleitet, nicht gepflegt.

    Ein Muster mit einem `/` (z. B. `profile/*/gespielt.json`) sagt zweierlei:
    was gesichert wird, UND dass dafuer ein Unterordner betreten werden muss.
    Beides aus derselben Zeile zu lesen ist Absicht — eine zweite Liste
    „welche Ordner betreten wir" liefe irgendwann auseinander, und dann faende
    man ein Muster, das auf nichts zeigt, weil niemand hineinsieht.

    NUR DIESE ORDNER WERDEN BETRETEN. `coverspeicher` bleibt damit aussen vor,
    ohne dass es jemand extra verbieten muss: es steht in keinem Muster.
    """
    return sorted({m.split("/", 1)[0] for m in HINEIN.get(baum, []) if "/" in m})


def inhalt_klage(im_archiv: str, roh: bytes) -> str | None:
    """Ist das ein Inhalt — oder ein Wimpernschlag? -> Klage oder None.

    WARUM DAS HIER STEHT, und warum eine Pruefsumme dagegen nichts hilft.
    Zwei Wege schreiben data.json. `medienAendern` und `darstellungSchreiben`
    legen daneben und benennen um — da gibt es nie eine halbe Datei.
    `POST /api/add` (server.ts) ruft `jsonfile.writeFile` auf die ZIELDATEI:
    die wird beim Oeffnen auf 0 gekuerzt und erst danach gefuellt.

    GEMESSEN (tools/data-json-schreibfenster.sh, .169, 4000 Schreibvorgaenge
    in der echten Groesse von 8 KB): ein gleichzeitiger Leser sah die Datei in
    20,8 % der Versuche mit NULL BYTES. Nicht halb — leer.

    UND EINE LEERE DATEI IST DAS SCHLIMMSTE, WAS PASSIEREN KANN, weil sie
    widerspruchsfrei ist: ihre Pruefsumme stimmt, das Archiv oeffnet sich,
    `--pruefen` sagt OK, `--probe` besteht. Der Fehler zeigt sich erst in dem
    Augenblick, in dem jemand den Stand einspielt — und dann ist die
    Bibliothek weg. Genau die „halbe data.json, die schlimmer ist als keine".
    Belegt Ende zu Ende in tools/sicherung-grenzfaelle.py (G5).

    Geprueft wird nur, was `.json` heisst; `bt-adapter` ist eine MAC-Adresse.
    """
    if not im_archiv.endswith(".json"):
        return None
    if not roh.strip():
        return (f"{im_archiv}: beim Lesen LEER (0 B) — so sieht eine Datei "
                f"WAEHREND eines Schreibvorgangs aus, nicht danach")
    try:
        json.loads(roh.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as e:
        return f"{im_archiv}: kein gueltiges JSON ({type(e).__name__}: {e})"
    return None


def klagen_ueber(inhalte: dict[str, bytes]) -> list[str]:
    """Was ist ein HARTER Halt? BEIWERK ist keiner.

    Eine Klage stoppt alles: `--anlegen` legt keinen Stand an,
    `--wiederherstellen` schreibt nicht, `--probe` faellt durch. Das ist
    richtig fuer die Bibliothek und falsch fuer eine Messreihe. Wuerde
    akkuverlauf.json mitzaehlen, koennte ein Nullbyte-Fenster im Akkuverlauf
    die Sicherung der BIBLIOTHEK verhindern — ein neuer Weg, Daten zu
    verlieren, gebaut aus einer Vorsichtsmassnahme. Beiwerk faellt deshalb
    schon in `stand_bauen` aus dem Stand heraus und wird dort benannt.
    """
    return [k for k in (inhalt_klage(p, inhalte[p])
                        for p in sorted(inhalte) if p not in BEIWERK) if k]


def bestandsaufnahme() -> dict:
    """Was liegt da, und in welche Spalte gehoert es? Rein lesend."""
    dabei, nicht_dabei, unbekannt, verweise = [], [], [], {}
    for baum, wurzel in BAEUME.items():
        if not os.path.isdir(wurzel):
            continue
        tief = tiefe_wurzeln(baum)
        # ── Erst die BEREICHE (E18 Stufe 2): ein Ordner je Profil.
        #
        # WARUM UEBERHAUPT: seit dem 05.08.2026 liegt, was einem Kind gehoert,
        # in `server/config/profile/<kennung>/`. Die flache Aufnahme darunter
        # betritt keinen Unterordner — die Muster `gespielt.*.json` und
        # `kinderzeit-verbrauch.*.json` zeigten danach auf NICHTS, und der
        # Ordner selbst landete in der dritten Spalte („nicht eingeordnet").
        # Eine Sicherung, die genau das nicht mitnimmt, was einem Kind gehoert,
        # faellt erst beim Zurueckspielen auf — und dann ist es weg.
        # Nachgemessen von `tools/bereich-sicherung-deckung.py`.
        for unter in tief:
            wurzel_tief = os.path.join(wurzel, unter)
            if not os.path.isdir(wurzel_tief):
                continue
            for hier, ordner, dateien in os.walk(wurzel_tief):
                ordner.sort()
                for name in sorted(dateien):
                    voll = os.path.join(hier, name)
                    rel = os.path.relpath(voll, wurzel)
                    im_archiv = f"{baum}/{rel}"
                    if os.path.islink(voll):
                        verweise[im_archiv] = os.readlink(voll)
                        continue
                    if passt(rel, HINEIN.get(baum, [])):
                        dabei.append({"pfad": im_archiv, "quelle": voll,
                                      "bytes": os.path.getsize(voll)})
                    else:
                        # KEINE dritte Spalte fuer den Bereich. Was ein Profil
                        # dort ablegt und hier nicht steht, ist ausdruecklich
                        # nicht gesichert — und das gehoert gesagt, sonst waere
                        # es genau der stille Verlust von oben.
                        unbekannt.append({
                            "pfad": im_archiv,
                            "bytes": os.path.getsize(voll),
                            "warum": "liegt im BEREICH eines Profils, steht "
                                     "aber in keinem Muster von HINEIN — wird "
                                     "NICHT mitgesichert. Die Liste der "
                                     "profilgebundenen Ablagen fuehrt "
                                     "src/backend-api/src/profile.ts "
                                     "(BEREICH_ABLAGEN).",
                        })
        # ── Und dann die flache Ebene, wie bisher.
        for name in sorted(os.listdir(wurzel)):
            voll = os.path.join(wurzel, name)
            im_archiv = f"{baum}/{name}"
            if name in tief and os.path.isdir(voll):
                continue  # oben schon durchgegangen
            if os.path.islink(voll):
                verweise[im_archiv] = os.readlink(voll)
                continue
            draussen = next(
                (grund for m, grund in DRAUSSEN.get(baum, []) if fnmatch.fnmatch(name, m)),
                None)
            if passt(name, HINEIN.get(baum, [])):
                dabei.append({"pfad": im_archiv, "quelle": voll,
                              "bytes": os.path.getsize(voll) if os.path.isfile(voll) else 0})
            elif draussen:
                dabei_gr = os.path.getsize(voll) if os.path.isfile(voll) else None
                nicht_dabei.append({"pfad": im_archiv, "bytes": dabei_gr,
                                    "warum": draussen})
            else:
                unbekannt.append({
                    "pfad": im_archiv,
                    "bytes": os.path.getsize(voll) if os.path.isfile(voll) else None,
                    "warum": "steht auf KEINER der beiden Listen — wird NICHT "
                             "mitgesichert. Wer sie braucht, traegt sie in "
                             "HINEIN ein; wer sie nicht braucht, in DRAUSSEN.",
                })
    return {"dabei": dabei, "nicht_dabei": nicht_dabei,
            "unbekannt": unbekannt, "verweise": verweise}


def entgeheimen(im_archiv: str, roh: bytes) -> tuple[bytes, list[dict], list[dict]]:
    """-> (Inhalt fuers Archiv, was ausgelassen wurde, die WERTE dazu).

    DIE DRITTE RUECKGABE IST DER GEFAEHRLICHE TEIL, und sie ist absichtlich
    ein eigener Wert und kein Feld in der zweiten: `ausgelassen` landet in
    stand.json, in LIESMICH.txt und im Bericht der Wiederherstellung. Was
    Werte traegt, darf dort NIE hineingeraten — auch nicht durch ein
    `dict`, das jemand spaeter unbesehen durchreicht. Die Trennung an dieser
    Stelle IST die Vorkehrung; der Selbsttest durchsucht das fertige Archiv
    zusaetzlich roh nach den Werten.

    Die dritte Liste traegt je Fund `{zeiger, stelle, wert}`: `zeiger` ist
    der Eintrag aus GEHEIM (mit `*`), `stelle` die konkrete Fundstelle
    (`/1/pw`). Ohne die konkrete Stelle liesse sich ein `/*/pw` nicht
    verlaesslich zurueckschreiben (siehe zeiger_stellen).
    """
    zeiger = GEHEIM.get(im_archiv)
    if not zeiger:
        return roh, [], []
    try:
        d = json.loads(roh.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        # Kein JSON? Dann kann hier nichts sauber entfernt werden — und eine
        # Datei, von der wir wissen, dass Schluessel drinstehen, geht dann
        # GAR NICHT mit. Im Zweifel weglassen, nicht streuen.
        return b"", [{"zeiger": "(ganze Datei)",
                      "warum": "unlesbar als JSON, koennte Schluessel enthalten"}], []
    ausgelassen, werte = [], []
    for z, warum in zeiger:
        gefunden = zeiger_stellen(d, zeiger_teile(z))
        if not gefunden:
            continue
        leer = all(v in (None, "", []) for _, v in gefunden)
        for stelle, wert in gefunden:
            if wert in (None, "", []):
                continue      # ein leerer Wert ist kein Geheimnis
            werte.append({"zeiger": z, "stelle": stelle, "wert": wert,
                          "datei": im_archiv})
        zeiger_entfernen(d, z)
        ausgelassen.append({"zeiger": z, "warum": warum,
                            "war_leer": leer, "datei": im_archiv})
    text = json.dumps(d, indent=4, ensure_ascii=False) + "\n"
    return text.encode("utf-8"), ausgelassen, werte


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def liesmich(stand: dict) -> str:
    z = ["MuPiBox — Stand der Konfiguration",
         "=" * 60,
         f"erzeugt   {stand['erzeugt']}",
         f"Grund     {stand['grund']}",
         f"Box       {stand.get('host', '?')}",
         "",
         "WAS DRIN IST"]
    for d in stand["dateien"]:
        z.append(f"  {d['bytes']:>8}  {d['pfad']}")
    zug = stand.get("zugangsdaten") or {}
    drin = {(f["datei"], f["zeiger"]) for f in zug.get("felder", [])}
    if zug:
        z += ["",
              "WAS VERSCHLUESSELT DABEI IST (Zugangsdaten)",
              f"  {zug.get('bytes', 0):>8}  {zug.get('behaelter', BEHAELTER)}",
              "Diese Felder liegen NICHT im Klartext im Archiv, sondern in",
              "dem Behaelter oben — verschluesselt mit einem Passwort, das",
              "jemand beim Anlegen von Hand vergeben hat:"]
        for f in zug.get("felder", []):
            z.append(f"  - {f['datei']}{f['zeiger']}  — {f['warum']}")
        z += ["",
              f"  Verfahren:  {zug.get('verfahren', '?')}",
              "  Das Passwort steht NIRGENDS — nicht auf dieser Karte, nicht",
              "  auf der Box, nicht im Journal. Wer es verloren hat, bekommt",
              "  trotzdem ALLES ANDERE zurueck: Bibliothek, gemerkte Stellen,",
              "  Kinderzeit, Darstellung. Nur WLAN und die Musikdienste",
              "  muessen dann von Hand neu eingegeben werden.",
              "",
              "  MIT Passwort zurueckspielen (braucht SSH — es muss jemand",
              "  tippen koennen):",
              "    sudo /usr/local/bin/mupibox/mupibox-sicherung.py \\",
              "         --wiederherstellen <stand> --mit-zugangsdaten",
              "  Der Weg ueber die Karte spielt alles ANDERE ein und nennt",
              "  im Bericht, welche Felder verschluesselt liegen geblieben",
              "  sind.",
              "",
              "  Von Hand zu oeffnen (auf einem beliebigen Rechner mit",
              "  GnuPG >= 2.4):",
              f"    tar xzf <stand>.tar.gz {zug.get('behaelter', BEHAELTER)}",
              f"    gpg --decrypt {zug.get('behaelter', BEHAELTER)}"]
    fehlt = [a for a in stand["ausgelassen"]
             if (a.get("datei"), a.get("zeiger")) not in drin]
    if fehlt:
        z += ["", "WAS FEHLT — UND ZWAR MIT ABSICHT"]
        if zug:
            z += ["Diese Felder waren beim Anlegen leer oder liessen sich",
                  "nicht mitnehmen; sie sind AUCH IM BEHAELTER NICHT drin:"]
        else:
            z += ["Zugangsdaten gehen nur mit einem Passwort mit",
                  "(`--anlegen --mit-zugangsdaten`). Dieser Stand wurde OHNE",
                  "angelegt — er ist also KEIN vollstaendiger Abzug der Box:"]
        for a in fehlt:
            leer = "  (war ohnehin leer)" if a.get("war_leer") else ""
            z.append(f"  - {a['datei']}{a['zeiger']}  — {a['warum']}{leer}")
        z += ["",
              "Beim Zurueckspielen wird KEINER dieser Schluessel geschrieben.",
              "Er behaelt den Wert, der auf der Box gerade steht. Steht dort",
              "keiner, muss er von Hand neu eingegeben werden — der Bericht",
              "der Wiederherstellung sagt dann genau, welcher."]
    if stand.get("bewusst_drin"):
        # DIE ANDERE HAELFTE DERSELBEN EHRLICHKEIT. Dass clientId und ssid
        # MIT gehen, ist eine getroffene Entscheidung — sie stand bisher nur
        # in stand.json und damit nirgends, wo sie jemand ohne Werkzeug sieht.
        z += ["", "WAS TROTZ SEINES AUSSEHENS KEIN GEHEIMNIS IST (und mitgeht)"]
        for b in stand["bewusst_drin"]:
            z.append(f"  - {b['datei']}{b['zeiger']} — {b['warum']}")
    if stand["nicht_dabei"]:
        z += ["", "WAS BEWUSST DRAUSSEN BLEIBT"]
        for n in stand["nicht_dabei"]:
            z.append(f"  - {n['pfad']} — {n['warum']}")
    if stand["unbekannt"]:
        z += ["", "WAS NIEMAND EINGEORDNET HAT (bitte ansehen!)"]
        for u in stand["unbekannt"]:
            z.append(f"  - {u['pfad']}")
    if stand["verweise"]:
        z += ["", "VERWEISE (welches Profil aktiv war)"]
        for k, v in stand["verweise"].items():
            z.append(f"  {k} -> {v}")
    z += ["", "ZURUECKSPIELEN OHNE SSH",
          "  1. Karte in einen beliebigen Rechner; die kleine FAT-Partition",
          "     meldet sich unter Windows, macOS und Linux.",
          f"  2. Eine Textdatei {MARKE} ins WURZELVERZEICHNIS",
          "     dieser Partition legen. Inhalt: EINE Zeile — der Dateiname",
          "     des gewuenschten Standes, oder das Wort `neueste`.",
          "  3. Karte zurueck, Box einschalten. Der Befund steht danach als",
          f"     {BERICHT} auf derselben Partition.",
          "  Ein Archiv allein loest NICHTS aus. Erst die Textdatei.",
          "",
          "ZURUECKSPIELEN MIT SSH",
          "  sudo /usr/local/bin/mupibox/mupibox-sicherung.py \\",
          "       --wiederherstellen neueste --trocken   # erst ansehen",
          "  sudo /usr/local/bin/mupibox/mupibox-sicherung.py \\",
          "       --wiederherstellen neueste",
          ""]
    return "\n".join(z) + "\n"


# ── Anlegen ────────────────────────────────────────────────────────────────
def stand_bauen(grund: str) -> tuple[dict, dict[str, bytes], list[dict]]:
    """-> (stand, inhalte, geheimnisse).

    Die dritte Rueckgabe traegt die WERTE der ausgelassenen Schluessel und
    wird nur von `--anlegen --mit-zugangsdaten` weiterverwendet. Sie steht
    NICHT in `stand` — siehe entgeheimen.
    """
    auf = bestandsaufnahme()
    inhalte: dict[str, bytes] = {}
    dateien, ausgelassen, geheim = [], [], []
    for d in auf["dabei"]:
        with open(d["quelle"], "rb") as f:
            roh = f.read()
        inhalt, weg, werte = entgeheimen(d["pfad"], roh)
        if inhalt == b"" and weg:
            auf["nicht_dabei"].append({"pfad": d["pfad"], "bytes": len(roh),
                                       "warum": weg[0]["warum"]})
            ausgelassen.extend(weg)
            continue
        # BEIWERK darf den Stand nicht verhindern (siehe klagen_ueber): eine
        # Messreihe, die genau im Schreibfenster erwischt wurde, faellt aus
        # DIESEM Stand heraus und wird benannt — die Bibliothek geht mit.
        if d["pfad"] in BEIWERK:
            klage = inhalt_klage(d["pfad"], inhalt)
            if klage:
                auf["nicht_dabei"].append(
                    {"pfad": d["pfad"], "bytes": len(roh),
                     "warum": f"diesmal nicht lesbar ({klage}) — Beiwerk "
                              f"haelt die Sicherung nicht auf"})
                continue
        inhalte[d["pfad"]] = inhalt
        ausgelassen.extend(weg)
        geheim.extend(werte)
        dateien.append({"pfad": d["pfad"], "bytes": len(inhalt),
                        "sha256": sha(inhalt),
                        "geaendert": datetime.fromtimestamp(
                            os.path.getmtime(d["quelle"])).isoformat(timespec="seconds")})
    # DIE KENNUNG BEANTWORTET EINE FRAGE: „hat sich die KONFIGURATION
    # geaendert?" Beiwerk aendert sich von selbst und gehoert deshalb nicht
    # hinein (Herleitung samt Messung bei BEIWERK). Nebenwirkung, die zaehlt:
    # aeltere Staende, die noch gar kein Beiwerk kannten, behalten damit
    # genau dieselbe Kennung — `--wenn-anders` vergleicht ueber die
    # Umstellung hinweg richtig.
    kennung = sha("\n".join(f"{d['pfad']}:{d['sha256']}"
                            for d in sorted(dateien, key=lambda x: x["pfad"])
                            if d["pfad"] not in BEIWERK).encode())
    stand = {
        "format": 1,
        "erzeugt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "grund": grund,
        "host": os.uname().nodename,
        "werkzeug": "mupibox-sicherung.py (BACKLOG E29/B1)",
        "dateien": dateien,
        "verweise": auf["verweise"],
        "ausgelassen": ausgelassen,
        "bewusst_drin": [{"datei": k, "zeiger": z, "warum": w}
                         for k, v in BEWUSST_DRIN.items() for z, w in v],
        "nicht_dabei": auf["nicht_dabei"],
        "unbekannt": auf["unbekannt"],
        "inhalt_kennung": kennung,
    }
    return stand, inhalte, geheim


def stand_bauen_stabil(grund: str, versuche: int = 5, pause: float = 0.05
                       ) -> tuple[dict, dict[str, bytes], list[dict], list[str], bool]:
    """Lesen, bis sich zweimal hintereinander dasselbe zeigt.

    -> (stand, inhalte, geheimnisse, klagen, stabil)

    ZWEI FEHLER, EIN MITTEL. Die Sicherung haelt keine Sperre und fragt auch
    keine — `.data.lock` des Servers liegt in /tmp und wird hier nirgends
    gelesen. Daraus folgen zwei verschiedene Schaeden, gemessen in
    tools/sicherung-grenzfaelle.py:

      G1a  EINE Datei wird mitten im Schreiben erwischt (leer oder halb).
      G1c  ZWEI Dateien stammen aus ZWEI Zeitpunkten. Ein Stand ist naemlich
           kein Schnappschuss: die 18 Dateien werden NACHEINANDER gelesen.
           Wer dazwischen speichert, bekommt einen Stand, den es nie gab —
           und genau daran ist am 04.08. schon einmal eine Box von 25 auf 20
           Eintraege gefallen ([[sicherung-mitten-in-der-wiederherstellung]]).

    Eine Sperre waere das saubere Mittel, aber sie muesste auf BEIDEN Seiten
    stehen, und die andere Seite ist der Server. Das hier ist das, was die
    Sicherung ALLEIN tun kann: zweimal lesen und vergleichen. Aendert sich
    zwischen zwei Durchgaengen nichts, hat mit hoher Wahrscheinlichkeit
    waehrend keines der beiden jemand geschrieben — und die Kennung deckt
    alle EINSTELLUNGEN ab, also auch den Fall zweier Zeitpunkte. BEIWERK
    steht absichtlich nicht darin: der Akkuverlauf aendert sich alle zehn
    Minuten von selbst, und mit ihm in der Kennung waere kein Stand jemals
    „stabil" — die Schleife liefe fuenfmal umsonst und vermerkte danach
    `unruhig`, obwohl niemand etwas geaendert hat.

    KLAGEN SIND ETWAS ANDERES ALS UNRUHE, und die Unterscheidung ist wichtig:
      * Klage  = eine Datei ist LEER oder unlesbar. Das ist ein harter Halt;
                 so ein Stand darf gar nicht erst entstehen.
      * unstabil = es aendert sich etwas (jemand hoert gerade). Das ist kein
                 Grund, GAR NICHT zu sichern — kein Stand ist schlechter als
                 ein leicht unscharfer. Es wird vermerkt, nicht verweigert.
    """
    vorige_kennung = None
    stand: dict = {}
    inhalte: dict[str, bytes] = {}
    geheim: list[dict] = []
    klagen: list[str] = []
    for lauf in range(max(2, versuche)):
        if lauf:
            time.sleep(pause)
        stand, inhalte, geheim = stand_bauen(grund)
        klagen = klagen_ueber(inhalte)
        if klagen:
            # Eine leere Datei sagt nichts ueber die naechste Runde aus —
            # der Vergleich faengt danach wieder bei null an.
            vorige_kennung = None
            continue
        if vorige_kennung is not None and vorige_kennung == stand["inhalt_kennung"]:
            return stand, inhalte, geheim, [], True
        vorige_kennung = stand["inhalt_kennung"]
    if not klagen:
        stand["unruhig"] = ("waehrend des Lesens hat sich etwas geaendert — "
                            "dieser Stand kann Dateien aus zwei Zeitpunkten "
                            "tragen")
    return stand, inhalte, geheim, klagen, False


def name_bauen(stand: dict, behalten: bool) -> str:
    zeit = datetime.fromisoformat(stand["erzeugt"]).strftime("%Y%m%d-%H%M%S")
    grund = "".join(c if c.isalnum() or c == "-" else "-" for c in stand["grund"])[:24]
    halt = ".behalten" if behalten else ""
    return f"mupibox-sicherung-{zeit}-{grund}{halt}.tar.gz"


def schreiben(pfad: str, stand: dict, inhalte: dict[str, bytes],
              behaelter: bytes | None = None) -> None:
    """Danebenlegen und umbenennen ([[ausliefern-regeln]]) — auch hier.

    Ein halb geschriebenes Archiv sieht aus wie ein Stand und ist keiner.

    `behaelter` ist der verschluesselte Klumpen mit den Zugangsdaten. Er
    kommt als eigener Eintrag NEBEN die Dateien und steht bewusst NICHT in
    `stand["dateien"]`: dort haengen Ziel, Pruefung und der Byte-Vergleich
    der Probe dran, und fuer einen Klumpen, der nirgendwohin geschrieben
    wird, waere jedes davon falsch. Seine Pruefsumme steht stattdessen in
    `stand["zugangsdaten"]["sha256"]` und wird in `stand_oeffnen` geprueft.
    """
    os.makedirs(os.path.dirname(pfad), exist_ok=True)
    _dietpi_zurueckgeben(os.path.dirname(pfad))
    neben = pfad + ".imbau"
    with open(neben, "wb") as roh:
        with tarfile.open(fileobj=roh, mode="w:gz") as t:
            def dazu(name: str, daten: bytes):
                info = tarfile.TarInfo(name)
                info.size = len(daten)
                info.mtime = int(time.time())
                info.mode = 0o600      # der Stand traegt Bibliothek und Netz
                t.addfile(info, io.BytesIO(daten))
            dazu("stand.json", json.dumps(stand, indent=2,
                                          ensure_ascii=False).encode("utf-8"))
            dazu("LIESMICH.txt", liesmich(stand).encode("utf-8"))
            for name in sorted(inhalte):
                dazu(name, inhalte[name])
            if behaelter:
                dazu((stand.get("zugangsdaten") or {}).get("behaelter",
                                                           BEHAELTER),
                     behaelter)
        roh.flush()
        os.fsync(roh.fileno())
    os.chmod(neben, 0o600)
    os.replace(neben, pfad)
    _dietpi_zurueckgeben(pfad)
    _sync_verzeichnis(os.path.dirname(pfad))


class Sperre:
    """Waehrend einer Wiederherstellung darf NIEMAND einen Stand anlegen.

    DAS IST KEIN GEDANKENSPIEL, sondern am 04.08.2026 an der Box passiert und
    der Grund, warum es diese Klasse gibt:

      23:35:39  mupibox-wiederherstellung.service faengt an und schreibt die
                Dateien in alphabetischer Reihenfolge. `etc/mupibox/…` kommt
                VOR `server/config/data.json`.
      23:35:40  mupibox-sicherung.path sieht mupiboxconfig.json sich aendern
                und legt pflichtschuldig einen Stand an — mit der NEUEN
                Konfiguration und der ALTEN, noch kaputten Bibliothek.
      danach    dieser Stand ist der juengste. Wer «neueste» sagt, bekommt
                eine Box, die es nie gegeben hat: halb zurueckgespielt.

    Ein Stand aus einem Zwischenzustand ist schlimmer als kein Stand, weil er
    wie ein gueltiger aussieht. Also: waehrend der Wiederherstellung wird
    nicht gesichert — und wer es versucht, bekommt das gesagt und faellt
    NICHT durch (der Zeitgeber soll deswegen nicht als "failed" dastehen).
    """

    def __enter__(self):
        try:
            with open(SPERRE, "w") as f:
                f.write(f"{os.getpid()} {time.time()}\n")
        except OSError:
            pass                      # ohne Schreibrecht auf /run lieber weiter
        return self

    def __exit__(self, *_):
        try:
            os.remove(SPERRE)
        except OSError:
            pass
        return False

    @staticmethod
    def gilt() -> bool:
        try:
            alter = time.time() - os.path.getmtime(SPERRE)
        except OSError:
            return False
        # Eine vergessene Sperre darf das Sichern nicht auf Dauer abstellen.
        return alter < SPERRE_GILT


def _dietpi_zurueckgeben(pfad: str) -> None:
    """Was root im Haus von dietpi anlegt, gehoert danach dietpi.

    Der Rueckweg von der Karte laeuft als root (die FAT-Partition gehoert root,
    und /etc/mupibox will geschrieben werden). Er legt dabei einen Stand
    „vorher" an — und der laege sonst als root in /home/dietpi/.mupibox. Beim
    naechsten selbsttaetigen Lauf als dietpi liesse er sich nicht mehr
    ausraeumen: die Auslese scheiterte still, und die Zahl der Staende wuechse
    wieder ins Unbegrenzte. Also genau der Zustand, gegen den E29 angetreten
    ist — eingeschleppt durch den Rueckweg selbst.
    """
    if os.geteuid() != 0 or not pfad.startswith("/home/dietpi/"):
        return
    try:
        p = pwd.getpwnam("dietpi")
        os.chown(pfad, p.pw_uid, p.pw_gid)
    except (KeyError, OSError):
        pass


def _sync_verzeichnis(verz: str) -> None:
    # Ohne das steht die Sicherung nur im Zwischenspeicher — und genau daran
    # ist hier schon einmal eine Wiederherstellung gescheitert
    # ([[mupi-stromausfall-bootdateien]]).
    try:
        fd = os.open(verz, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    except OSError:
        pass


# ── Die Auslese: welche Staende fallen weg? ────────────────────────────────
def auslese(staende: list[str], behalten: int) -> list[str]:
    """Rein, damit sie ohne Box pruefbar ist — und sie MUSS geprueft werden.

    Der Fehler, den sie nicht machen darf, steht im Wiki
    ([[aufraeum-sicherung-vor-der-entscheidung]]): drei folgenlose Sicherungen
    verdraengten die eine, auf die es ankam. Zwei Vorkehrungen dagegen:
      * `.behalten` faellt NIE — was jemand angeheftet hat, bleibt;
      * folgenlose Staende entstehen gar nicht erst (`--wenn-anders`
        vergleicht die Inhalts-Kennung und legt dann nichts an).
    Die Auslese zaehlt `.behalten` NICHT gegen das Kontingent: sonst
    verdraengten fuenf angeheftete Staende alle laufenden.
    """
    fest = [s for s in staende if ".behalten." in s]
    lose = sorted((s for s in staende if ".behalten." not in s), reverse=True)
    return sorted(lose[behalten:]) if behalten >= 0 else []


def staende_lesen(verz: str | None = None) -> list[str]:
    # `verz: str = STAENDE` waere eine Falle: ein Vorgabewert wird beim
    # DEFINIEREN ausgerechnet, nicht beim Aufrufen. Wer STAENDE nachtraeglich
    # umbiegt — der Selbsttest tut genau das — bekaeme trotzdem den alten
    # Pfad, und zwar lautlos: die Funktion faende dort nichts und meldete
    # „kein Stand vorhanden". Im Betrieb faellt das nie auf, weil STAENDE nie
    # umgesetzt wird; beim Pruefen kostet es eine Stunde.
    verz = verz or STAENDE
    if not os.path.isdir(verz):
        return []
    return sorted((n for n in os.listdir(verz)
                   if n.startswith("mupibox-sicherung-") and n.endswith(".tar.gz")),
                  reverse=True)


def stand_waehlen(wunsch: str, verz: str = STAENDE) -> str:
    alle = staende_lesen(verz)
    if not alle:
        raise SystemExit(f"kein Stand in {verz} — erst `--anlegen`")
    if wunsch in ("neueste", "neuester", "letzte", ""):
        return alle[0]
    if wunsch in alle:
        return wunsch
    treffer = [a for a in alle if wunsch in a]
    if len(treffer) == 1:
        return treffer[0]
    raise SystemExit(f"kein eindeutiger Stand fuer «{wunsch}». Vorhanden:\n  "
                     + "\n  ".join(alle))


def stand_oeffnen(pfad: str) -> tuple[dict, dict[str, bytes]]:
    with tarfile.open(pfad, "r:gz") as t:
        namen = t.getnames()
        for n in namen:
            if n.startswith("/") or ".." in n.split("/"):
                raise SystemExit(f"Archiv enthaelt einen unmoeglichen Pfad: {n}")
        stand = json.loads(t.extractfile("stand.json").read().decode("utf-8"))
        inhalte = {}
        for d in stand["dateien"]:
            roh = t.extractfile(d["pfad"]).read()
            if sha(roh) != d["sha256"]:
                raise SystemExit(f"{pfad}: {d['pfad']} stimmt nicht mit der "
                                 f"Pruefsumme im Stand ueberein")
            inhalte[d["pfad"]] = roh
        # DER BEHAELTER STEHT NICHT IN `dateien` — seine Pruefsumme muss
        # deshalb HIER von Hand geprueft werden. Ohne diese Zeilen faende
        # `--pruefen` einen beschaedigten Behaelter nie, und der Ausfall
        # zeigte sich erst dann, wenn jemand die Zugangsdaten braucht.
        zug = stand.get("zugangsdaten") or {}
        if zug:
            name = zug.get("behaelter", BEHAELTER)
            try:
                roh = t.extractfile(name).read()
            except (KeyError, AttributeError):
                raise SystemExit(
                    f"{pfad}: der Stand sagt, er trage Zugangsdaten in "
                    f"«{name}» — der Eintrag fehlt im Archiv.")
            if zug.get("sha256") and sha(roh) != zug["sha256"]:
                raise SystemExit(f"{pfad}: {name} stimmt nicht mit der "
                                 f"Pruefsumme im Stand ueberein")
    # DEN STROM ZU ENDE LESEN — sonst wird die Pruefsumme des gzip-Stroms NIE
    # geprueft. `tarfile` haelt am Ende-Merkmal des tar an und ruehrt den
    # Abspann des gzip nicht mehr an; und die sha256 oben decken nur die
    # Dateien ab, die in `dateien` STEHEN — LIESMICH.txt und die Fuellbytes
    # gehoeren nicht dazu.
    #
    # GEMESSEN, bevor diese vier Zeilen da waren
    # (tools/stand-bitdreher-deckung.py, jedes einzelne Byte umgedreht):
    #     12 KB-Stand:   286 von 12077 Stellen blieben unbemerkt  (2,4 %)
    #      1,7 KB-Stand: 208 von  1711 Stellen blieben unbemerkt  (12,2 %)
    # Genau daran hat auch der Selbsttest gewuerfelt: er dreht das Byte in
    # der MITTE um, und ob die Mitte in einem blinden Fleck liegt, haengt an
    # der Groesse des Archivs. Vier gruene Laeufe, ein roter, gleiche Fassung.
    #
    # `--pruefen` und die woechentliche `--probe` sind das EINZIGE, was
    # zwischen einer muede gewordenen Karte und einem stillen Datenverlust
    # steht. Ein Pruefer mit blinden Flecken ist schlimmer als keiner: er
    # sagt BESTANDEN.
    with gzip.open(pfad, "rb") as g:
        while g.read(1 << 16):
            pass
    return stand, inhalte


def behaelter_lesen(pfad: str, stand: dict) -> bytes | None:
    """Den verschluesselten Klumpen aus dem Archiv holen — mehr nicht.

    Eigene Funktion und nicht ein dritter Rueckgabewert von `stand_oeffnen`:
    fast alle Aufrufer wollen ihn gar nicht, und was niemand in der Hand
    hat, kann niemand versehentlich weiterreichen.
    """
    zug = stand.get("zugangsdaten") or {}
    if not zug:
        return None
    with tarfile.open(pfad, "r:gz") as t:
        datei = t.extractfile(zug.get("behaelter", BEHAELTER))
        return datei.read() if datei else None


def geheim_aus_stand(pfad: str, stand: dict, passwort: str) -> dict[str, list[dict]]:
    """-> {archivpfad: [{zeiger, stelle, wert}, …]} — oder es wirft.

    Der einzige Weg vom Behaelter zu den Werten. Er wirft lieber, als etwas
    Halbes zurueckzugeben: ein falsches Passwort darf keine Konfiguration
    anfassen.
    """
    roh = behaelter_lesen(pfad, stand)
    if roh is None:
        return {}
    klar = behaelter_auspacken(roh, passwort)
    try:
        d = json.loads(klar.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as e:
        raise SystemExit(f"Der Behaelter liess sich oeffnen, sein Inhalt ist "
                         f"aber kein gueltiges JSON ({e}).")
    nach: dict[str, list[dict]] = {}
    for f in d.get("felder", []):
        nach.setdefault(f["datei"], []).append(f)
    return nach


# ── Zurueckspielen ─────────────────────────────────────────────────────────
def rest_heil(rest: str) -> bool:
    """Darf dieser Rest an eine Wurzel geheftet werden?

    BIS ZUM 05.08.2026 STAND HIER `"/" in rest` — jeder Unterordner war
    verboten, und das war die ganze Absicherung gegen einen Archiveintrag, der
    aus dem Baum hinausfuehrt. Mit den BEREICHEN (`profile/<kennung>/…`) gibt
    es Unterordner nun wirklich, also muss die Absicherung genauer werden statt
    zu verschwinden: geprueft wird jetzt JEDES STUECK des Pfades.

    Ein Archiv ist Fremdes. Es kann von einer anderen Box stammen, von einer
    aelteren Fassung, oder jemand hat daran gedreht — `..` darin ist kein
    theoretischer Fall, sondern der Weg, mit dem man aus `server/config`
    heraus in `/etc` schreibt.
    """
    if not rest or rest.startswith("/") or "\\" in rest:
        return False
    stuecke = rest.split("/")
    return all(s not in ("", ".", "..") for s in stuecke)


def ziel_von(im_archiv: str) -> str | None:
    for baum, wurzel in BAEUME.items():
        if im_archiv.startswith(baum + "/"):
            rest = im_archiv[len(baum) + 1:]
            if not rest_heil(rest):
                return None
            return os.path.join(wurzel, rest)
    return None


def atomar_schreiben(ziel: str, daten: bytes) -> None:
    """.neu danebenlegen -> fsync -> umbenennen. Rechte bleiben, wie sie waren.

    [[mupi-konfiguration-schreiben]]: Umbenennen im selben Dateisystem ist
    atomar. Danach gibt es entweder die alte oder die neue Fassung, nie eine
    halbe — wichtig auf einer Box, der schon einmal mitten im Schreiben der
    Strom ausging.
    """
    stat = os.stat(ziel) if os.path.exists(ziel) else None
    neben = ziel + ".neu"
    with open(neben, "wb") as f:
        f.write(daten)
        f.flush()
        os.fsync(f.fileno())
    if stat:
        os.chmod(neben, stat.st_mode & 0o7777)
        try:
            os.chown(neben, stat.st_uid, stat.st_gid)
        except PermissionError:
            pass
    else:
        os.chmod(neben, 0o664)
        try:
            uid = pwd.getpwnam("dietpi").pw_uid
            gid = (grp.getgrnam("www-data").gr_gid if "/etc/mupibox/" in ziel
                   else pwd.getpwnam("dietpi").pw_gid)
            os.chown(neben, uid, gid)
        except (KeyError, PermissionError):
            pass
    os.replace(neben, ziel)
    _sync_verzeichnis(os.path.dirname(ziel))


def wiederherstellen(stand: dict, inhalte: dict[str, bytes], *, trocken: bool,
                     wurzel_ersatz: dict | None = None,
                     trotzdem: bool = False,
                     geheim: dict[str, list[dict]] | None = None) -> list[str]:
    """-> Bericht als Zeilen. Wirft SystemExit, wenn es NICHT schreiben darf.

    `geheim` sind die AUFGESCHLOSSENEN Zugangsdaten (geheim_aus_stand). Fehlt
    es, laeuft alles genau wie bisher: die ausgelassenen Schluessel behalten
    den Wert der Box, und was auch dort fehlt, wird namentlich gemeldet.

    DIE RANGFOLGE JE SCHLUESSEL, und sie ist der ganze Punkt:
      1. der entschluesselte Wert aus dem Archiv — nur, wenn ein Passwort da
         war UND die Echtheitspruefung gehalten hat;
      2. sonst der Wert, der JETZT auf der Box steht (das bisherige
         Verhalten);
      3. sonst: gemeldet, aber NICHT geschrieben — auch nicht als
         Platzhalter ([[sicherung-ausgelassene-schluessel-nie-schreiben]]).
    """
    z = [f"Stand vom {stand['erzeugt']}  (Grund: {stand['grund']})"]
    baeume = wurzel_ersatz or BAEUME

    def ziel(p):
        # DIESELBE PRUEFUNG WIE IN `ziel_von` — ueber `rest_heil`, nicht
        # nachgebaut. Zwei Fassungen derselben Absicherung sind eine Fassung
        # zu viel: die eine wird eines Tages verschaerft und die andere nicht.
        for baum, wurzel in baeume.items():
            if p.startswith(baum + "/"):
                rest = p[len(baum) + 1:]
                if not rest_heil(rest):
                    return None
                return os.path.join(wurzel, rest)
        return None

    # 1. Ausgelassene Schluessel fuellen — Rangfolge siehe Dokumentation oben.
    fehlend, uebernommen, eingespielt = [], [], []
    fertig: dict[str, bytes] = {}
    for pfad, roh in inhalte.items():
        auslassungen = [a for a in stand["ausgelassen"] if a.get("datei") == pfad]
        if not auslassungen:
            fertig[pfad] = roh
            continue
        neu = json.loads(roh.decode("utf-8"))
        jetzt = {}
        zpfad = ziel(pfad)
        if zpfad and os.path.exists(zpfad):
            try:
                jetzt = json.loads(open(zpfad, "rb").read().decode("utf-8"))
            except ValueError:
                jetzt = {}
        aus_behaelter = (geheim or {}).get(pfad, [])
        for a in auslassungen:
            if a["zeiger"] == "(ganze Datei)":
                continue
            gesetzt = 0
            for f in aus_behaelter:
                if f.get("zeiger") != a["zeiger"]:
                    continue
                if zeiger_setzen(neu, f["stelle"], f["wert"]):
                    gesetzt += 1
            if gesetzt:
                eingespielt.append(f"{pfad}{a['zeiger']}"
                                   + (f" ({gesetzt}x)" if gesetzt > 1 else ""))
            elif jetzt and zeiger_uebernehmen(neu, jetzt, a["zeiger"]):
                uebernommen.append(f"{pfad}{a['zeiger']}")
            elif not a.get("war_leer"):
                fehlend.append(f"{pfad}{a['zeiger']}  ({a['warum']})")
        fertig[pfad] = (json.dumps(neu, indent=4, ensure_ascii=False)
                        + "\n").encode("utf-8")

    if eingespielt:
        z.append("Zugangsdaten AUS DEM STAND eingespielt (Behaelter geoeffnet): "
                 + ", ".join(eingespielt))
    if uebernommen:
        z.append("Ausgelassene Schluessel behalten den Wert der Box: "
                 + ", ".join(uebernommen))
    # DER BEHAELTER LAG DA, ES FEHLTE NUR DAS PASSWORT. Das ist der Fall des
    # Rueckwegs von der Karte (dort kann niemand etwas eingeben), und er MUSS
    # namentlich gesagt werden — sonst steht jemand vor einer Box, die
    # aussieht wie vorher, und wundert sich ueber das fehlende WLAN.
    zug = stand.get("zugangsdaten") or {}
    if zug and geheim is None:
        z.append(f"!! {len(zug.get('felder', []))} Feld(er) liegen "
                 f"VERSCHLUESSELT im Stand und wurden NICHT eingespielt — "
                 f"dazu braucht es das Passwort:")
        for f in zug.get("felder", []):
            z.append(f"     {f['datei']}{f['zeiger']}  ({f['warum']})")
        z.append("   Nachholen (es muss jemand tippen koennen):")
        z.append("     sudo /usr/local/bin/mupibox/mupibox-sicherung.py \\")
        z.append("          --wiederherstellen <stand> --mit-zugangsdaten")
    if fehlend:
        z.append("!! DIESE MUESSEN VON HAND NEU EINGEGEBEN WERDEN — sie waren "
                 "nicht in der Sicherung und stehen auch nicht auf der Box:")
        z += [f"     {f}" for f in fehlend]

    # 1b. DIE SPERRE OHNE PIN — aufgeloest, NICHT abgelehnt.
    #
    #     Seit dem 07.08.2026 ist `einstellungsPin` ein Geheimnis: ohne
    #     `--mit-zugangsdaten` faehrt sie nicht im Archiv mit (sie ist vier
    #     Ziffern, und der bcrypt-Hash daneben ist in Sekunden
    #     zurueckgerechnet — konfiguration.ts streicht sie aus genau diesem
    #     Grund aus /api/config). Damit kann ein Stand, der die Sperre auf
    #     „pin" stellt, auf eine Box ohne PIN treffen. Frisch aufgesetzt nach
    #     dem Kartentod ist genau der Fall, fuer den es das Zurueckspielen
    #     ueberhaupt gibt.
    #
    #     DIE WAHL, DIE HIER GETROFFEN WIRD: nicht ablehnen. Ein „geht nicht"
    #     waere die schlimmere Sackgasse — die Bibliothek bliebe weg, weil
    #     eine PIN fehlt. Eine Sperre, zu der es keine PIN gibt, sperrt
    #     ohnehin niemanden aus ausser dem Elternteil: die Pruefung vergleicht
    #     gegen einen leeren Hash und sagt zu JEDER Eingabe nein. Sie wird
    #     deshalb auf „aus" gestellt und das laut gesagt — wiederherstellbar
    #     mit zwei Handgriffen in der Verwaltung, waehrend das Gegenteil
    #     (Sperre an, keine PIN) am Bildschirm der Box nicht mehr aufgeht.
    konf_roh = fertig.get("etc/mupibox/mupiboxconfig.json")
    if konf_roh:
        kd = json.loads(konf_roh.decode("utf-8"))
        km = kd.get("mupibox") or {}
        if str(km.get("einstellungssperre") or "").strip().lower() == "pin" \
                and not str(km.get("einstellungsPin") or "").strip():
            km["einstellungssperre"] = "aus"
            kd["mupibox"] = km
            fertig["etc/mupibox/mupiboxconfig.json"] = (
                json.dumps(kd, indent=4, ensure_ascii=False) + "\n").encode("utf-8")
            z.append("!! Die Sperre vor den Einstellungen stand im Stand auf "
                     "«PIN», es gibt aber keine PIN (weder im Stand noch auf "
                     "der Box). Sie wurde auf «aus» gestellt — sonst kaeme "
                     "die Box in keine Einstellung mehr, auch nicht ins WLAN. "
                     "Bitte in der Verwaltung eine neue PIN setzen.")

    # 2. Die Pruefungen, die eine unbrauchbare Box verhindern — NACH dem
    #    Stopfen, denn erst dann steht da, was wirklich geschrieben wuerde.
    konf = fertig.get("etc/mupibox/mupiboxconfig.json")
    if konf:
        schlimm = konfig_pruefen(json.loads(konf.decode("utf-8")))
        if schlimm and not trotzdem:
            raise SystemExit("NICHT geschrieben — dieser Stand wuerde die Box "
                             "unbrauchbar machen:\n  - " + "\n  - ".join(schlimm)
                             + "\n(mit --trotzdem laesst sich das uebergehen, "
                               "aber dann bitte wissen, warum.)")
        for s in schlimm:
            z.append(f"!! uebergangen (--trotzdem): {s}")

    # 2b. Der Fall, den KEINE Pruefsumme sieht: ein Stand, der eine leere oder
    #     unlesbare Datei traegt. Er kann aus der Zeit vor `stand_bauen_stabil`
    #     stammen oder von Hand gebaut worden sein — das Archiv ist heil, sein
    #     INHALT ist es nicht. Hier ist die letzte Stelle, an der das noch
    #     auffallen kann; danach steht die Leere auf der Box.
    kaputt = klagen_ueber(fertig)
    if kaputt and not trotzdem:
        raise SystemExit(
            "NICHT geschrieben — dieser Stand traegt Dateien ohne Inhalt:\n  - "
            + "\n  - ".join(kaputt)
            + "\nEr entstand vermutlich mitten in einem Schreibvorgang. Ein "
              "aelterer Stand ist hier fast sicher der bessere: `--pruefen` "
              "nennt alle vorhandenen.\n(mit --trotzdem laesst sich das "
              "uebergehen — dann ist die betroffene Datei danach leer.)")
    for k in kaputt:
        z.append(f"!! uebergangen (--trotzdem): {k}")

    # 3. Schreiben.
    for pfad in sorted(fertig):
        zpfad = ziel(pfad)
        if not zpfad:
            z.append(f"  uebersprungen (kein Ziel): {pfad}")
            continue
        # AUF DER BOX STEHT DORT EIN VERWEIS — DANN WIRD DORT NICHT
        # GESCHRIEBEN. (Befund 07.08.2026, im Sandkasten nachgestellt.)
        #
        # Beim EINSAMMELN ist ein Verweis nie Inhalt: `bestandsaufnahme` legt
        # ihn unter `verweise` ab und geht weiter. Beim ZURUECKSPIELEN galt
        # diese Regel nicht — `atomar_schreiben` legt daneben und benennt um,
        # und `os.replace` ersetzt einen Verweis durch eine gewoehnliche
        # Datei. Gemessen: `server/config/resume.json`, auf der Box ein
        # Verweis auf `profile/<aktiv>/resume.json`, lag danach als 34-Byte-
        # Datei da.
        #
        # WAS DARAUS FOLGT, ist nicht bloss ein falscher Dateityp. server.ts
        # (`resumeBrueckeRichten`) findet beim naechsten Lesen am alten Ort
        # eine ECHTE Datei, haelt ihren Inhalt fuer die juengere Wahrheit und
        # schiebt sie per `link`+`rename` IN den Bereich des aktiven Kindes —
        # ueber die gerade zurueckgespielten gemerkten Stellen hinweg. Der
        # Sicherheitsabzug `resume.json.vorher` greift dabei NUR, wenn die
        # ankommende Datei eine leere Liste ist; hier ist sie es nicht. Der
        # Bestand des Kindes waere also nicht nur ueberschrieben, sondern
        # ohne Abzug ueberschrieben — und das durch einen Vorgang, den jemand
        # angestossen hat, um Bestand zu RETTEN.
        #
        # WARUM NICHT DURCH DEN VERWEIS HINDURCH SCHREIBEN: dann landete der
        # box-weite Stand aus dem Archiv in `profile/<aktiv>/resume.json` und
        # loeschte genau das, was dieselbe Wiederherstellung eine Zeile vorher
        # dorthin geschrieben hat. Nichts anfassen und es SAGEN ist die
        # einzige Antwort, bei der nichts verloren geht.
        if os.path.islink(zpfad):
            try:
                wohin = os.readlink(zpfad)
            except OSError:
                wohin = "?"
            z.append(f"  Verweis auf der Box (NICHT ueberschrieben): "
                     f"{zpfad} -> {wohin}")
            continue
        gleich = (os.path.exists(zpfad)
                  and open(zpfad, "rb").read() == fertig[pfad])
        marke = "=" if gleich else ">"
        z.append(f"  {marke} {zpfad}  ({len(fertig[pfad])} B)")
        if not trocken and not gleich:
            os.makedirs(os.path.dirname(zpfad), exist_ok=True)
            atomar_schreiben(zpfad, fertig[pfad])

    for k, v in (stand.get("verweise") or {}).items():
        z.append(f"  Verweis (NICHT angefasst): {k} -> {v}")
    if trocken:
        z.append("TROCKEN — nichts geschrieben.")
    else:
        os.sync()
    return z


# ── Die Karte ──────────────────────────────────────────────────────────────
def karte_ordner() -> str:
    return os.path.join(KARTE, KARTE_ORDNER)


def auf_karte(sagen=print) -> int:
    if not os.path.isdir(KARTE):
        sagen(f"{KARTE} gibt es nicht — keine FAT-Partition, nichts zu tun")
        return 1
    ziel = karte_ordner()
    try:
        os.makedirs(ziel, exist_ok=True)
    except PermissionError:
        sagen(f"{ziel} braucht root — `sudo` davor")
        return 1
    alle = staende_lesen()
    fest = [s for s in alle if ".behalten." in s]
    lose = [s for s in alle if ".behalten." not in s][:KARTE_BEHALTEN]
    sollen = sorted(set(fest + lose), reverse=True)
    for name in sollen:
        z = os.path.join(ziel, name)
        if not os.path.exists(z):
            shutil.copy2(os.path.join(STAENDE, name), z)
            sagen(f"  auf die Karte: {name}")
    for name in sorted(os.listdir(ziel)):
        if name.endswith(".tar.gz") and name not in sollen:
            os.remove(os.path.join(ziel, name))
            sagen(f"  von der Karte: {name}")
    if sollen:
        stand, _ = stand_oeffnen(os.path.join(STAENDE, sollen[0]))
        # DAS LIESMICH BESCHREIBT DEN JUENGSTEN STAND — auf der Karte liegen
        # aber mehrere, und der mit den Zugangsdaten ist fast nie der
        # juengste (er entsteht von Hand, die anderen taeglich). Ohne diese
        # Uebersicht stuende jemand vor drei Archiven und wuesste nicht,
        # welches das WLAN enthaelt.
        uebersicht = ["", "=" * 60,
                      "WELCHER STAND LIEGT HIER — UND WAS TRAEGT ER"]
        for name in sollen:
            try:
                s_k, _ = stand_oeffnen(os.path.join(ziel, name))
            except (SystemExit, Exception):                       # noqa: BLE001
                uebersicht.append(f"  {name}  — laesst sich NICHT oeffnen!")
                continue
            felder = (s_k.get("zugangsdaten") or {}).get("felder", [])
            uebersicht.append(
                f"  {name}"
                + (f"\n      + {len(felder)} Zugangsdaten, VERSCHLUESSELT "
                   f"(Passwort noetig)" if felder else ""))
        uebersicht += ["",
                       "Ein Archiv allein loest nichts aus — erst die",
                       f"Textdatei {MARKE} im Wurzelverzeichnis.", ""]
        with open(os.path.join(ziel, "LIESMICH.txt"), "w", encoding="utf-8") as f:
            f.write(liesmich(stand) + "\n".join(uebersicht) + "\n")
    os.sync()
    sagen(f"{len(sollen)} Stand/Staende auf {ziel}")
    return 0


# ── Das Netzlaufwerk (E29/B4, E28/N6-N9) ───────────────────────────────────
# WOHIN EINE SICHERUNG GEHOERT, war seit dem 04.08.2026 offen: im Haus liegen
# die Staende auf DERSELBEN Karte wie die Box. Stirbt die Karte, ist beides
# weg — die Box und ihr Rueckweg. Der Betreiber hat am 20.09.2026 entschieden:
# die vorhandenen Staende werden zusaetzlich auf ein Netzlaufwerk gespiegelt,
# per SMB3 mit eigenem Nutzer.
#
# DREI REGELN, UND JEDE HAT EINEN GRUND IN DIESEM BAUM:
#
# 1. DIE KARTE BLEIBT DIE WAHRHEIT. Das NAS ist eine ZWEITE Kopie, nie die
#    einzige. Schlaegt die Spiegelung fehl, ist die Sicherung im Haus trotzdem
#    da — deshalb endet dieser Schritt nie einen Sicherungslauf (die Unit ruft
#    ihn mit `-`). Der Rueckweg ohne SSH (B3) laeuft weiter ueber die
#    FAT-Partition; ein NAS hilft niemandem, dessen Bildschirm schwarz bleibt.
#
# 2. ES WIRD NEBENAN GESCHRIEBEN UND DANN UMBENANNT — nie unter dem
#    endgueltigen Namen wachsen gelassen. tmpfs/Karte -> NAS ist ein KOPIEREN
#    ueber Dateisystemgrenzen; wer den Zielnamen sofort vergibt, hat fuer die
#    Dauer der Uebertragung eine unvollstaendige Datei, die vollstaendig
#    aussieht (E28/N10, dieselbe Regel wie [[ausliefern-regeln]]).
#
# 3. OHNE GEWAEHLTEN ORT PASSIERT NICHTS, und es faellt auch nichts zurueck
#    (E28/N15). Fehlt nas.json oder steht `spiegeln` auf false, sagt dieser
#    Schritt genau das und endet mit 0 — eine Einstellung, die niemand
#    getroffen hat, ist kein Fehler.
NAS_JSON = BOX + "/server/config/nas.json"
NAS_ORDNER = "mupibox-sicherung"   # Unterordner AUF der Freigabe
NAS_BEHALTEN = 30                  # mehr als auf der Karte — dort ist Platz
NAS_FRIST = 60.0                   # s fuer den ganzen Spiegellauf
# Wo ein Einhaengepunkt liegen darf — dieselbe Wurzel wie in
# src/backend-api/src/netzlaufwerk.ts (ERLAUBTE_WURZEL). Umgelenkt wird sie
# NUR vom Selbsttest, der kein echtes Netzlaufwerk hat.
NAS_WURZEL = "/mnt/"


def nas_ziel(sagen=print) -> str | None:
    """Der Ordner auf dem Netzlaufwerk — oder None, mit gesagtem Grund."""
    try:
        with open(NAS_JSON, encoding="utf-8") as f:
            konfig = json.load(f)
    except FileNotFoundError:
        sagen("kein Netzlaufwerk eingerichtet (nas.json fehlt) — nichts zu tun")
        return None
    except (OSError, ValueError) as e:
        sagen(f"nas.json ist nicht lesbar: {e}")
        return None
    if not konfig.get("spiegeln"):
        sagen("Netzlaufwerk eingerichtet, aber die Spiegelung der Sicherungen "
              "ist AUS — nichts zu tun")
        return None
    punkt = konfig.get("einhaengepunkt")
    if not isinstance(punkt, str) or not punkt.startswith(NAS_WURZEL):
        sagen(f"nas.json nennt keinen brauchbaren Einhaengepunkt: {punkt!r}")
        return None
    return os.path.join(punkt, NAS_ORDNER)


def aufs_nas(sagen=print) -> int:
    """Die Staende zusaetzlich auf das Netzlaufwerk legen (E29/B4)."""
    ziel = nas_ziel(sagen)
    if ziel is None:
        return 0                      # kein Ort gewaehlt ist kein Fehler
    ende = time.monotonic() + NAS_FRIST

    # DER ERSTE ZUGRIFF HAENGT DAS LAUFWERK EIN (automount) und darf deshalb
    # dauern — aber nicht ewig. Haengt es, ist das hier die Stelle, an der man
    # es merkt, und nicht der Tonweg: dort liegt nie ein Netzlaufwerk (N6).
    try:
        os.makedirs(ziel, exist_ok=True)
    except OSError as e:
        sagen(f"{ziel} nicht erreichbar — Netzlaufwerk aus oder Anmeldung "
              f"abgelehnt: {e}")
        return 1

    alle = staende_lesen()
    fest = [s for s in alle if ".behalten." in s]
    lose = [s for s in alle if ".behalten." not in s][:NAS_BEHALTEN]
    sollen = sorted(set(fest + lose), reverse=True)

    neu = 0
    for name in sollen:
        if time.monotonic() > ende:
            sagen(f"Frist von {NAS_FRIST:.0f} s aufgebraucht — Rest beim "
                  f"naechsten Lauf")
            return 1
        z = os.path.join(ziel, name)
        if os.path.exists(z):
            continue
        # Regel 2: nebenan schreiben, DANN umbenennen. Das Umbenennen laeuft
        # innerhalb der Freigabe und ist ein einziger Schritt.
        behelf = os.path.join(ziel, f".{name}.teil-{os.getpid()}")
        try:
            shutil.copy2(os.path.join(STAENDE, name), behelf)
            os.replace(behelf, z)
        except OSError as e:
            sagen(f"  {name} nicht uebertragen: {e}")
            try:
                os.unlink(behelf)
            except OSError:
                pass
            return 1
        neu += 1
        sagen(f"  aufs Netzlaufwerk: {name}")

    weg = 0
    try:
        vorhanden = sorted(os.listdir(ziel))
    except OSError as e:
        sagen(f"{ziel} nicht mehr lesbar: {e}")
        return 1
    for name in vorhanden:
        # Fremde Dateien bleiben unangetastet — auf einer Freigabe liegt
        # womoeglich mehr als unsere Staende.
        if name.endswith(".tar.gz") and name not in sollen:
            try:
                os.remove(os.path.join(ziel, name))
                weg += 1
            except OSError as e:
                sagen(f"  {name} nicht entfernt: {e}")
    # Liegengebliebene Behelfsnamen eines abgebrochenen Laufs.
    for name in vorhanden:
        if name.startswith(".") and ".teil-" in name:
            try:
                os.remove(os.path.join(ziel, name))
            except OSError:
                pass

    bericht = {
        "wann": datetime.now().isoformat(timespec="seconds"),
        "ziel": ziel,
        "staende": len(sollen),
        "neu": neu,
        "entfernt": weg,
    }
    try:
        atomar_schreiben(os.path.join(STAENDE, "nas-spiegel.json"),
                         (json.dumps(bericht, ensure_ascii=False, indent=2)
                          + "\n").encode("utf-8"))
    except OSError:
        pass                          # der Bericht ist Beiwerk, nicht der Zweck
    sagen(f"{len(sollen)} Stand/Staende auf {ziel} ({neu} neu, {weg} entfernt)")
    return 0


def von_karte(sagen=print) -> int:
    """Der Rueckweg ohne SSH. Laeuft beim Start, VOR dem Server."""
    marke = os.path.join(KARTE, MARKE)
    if not os.path.exists(marke):
        sagen("keine Marke auf der Karte — nichts zu tun")
        return 0
    zeilen = [f"MuPiBox — Wiederherstellung von der Karte",
              f"gefahren am {datetime.now().astimezone().isoformat(timespec='seconds')}",
              ""]
    ergebnis = 0
    try:
        wunsch = ""
        for zeile in open(marke, encoding="utf-8", errors="replace"):
            zeile = zeile.strip()
            if zeile and not zeile.startswith("#"):
                wunsch = zeile
                break
        zeilen.append(f"Marke sagt: «{wunsch or 'neueste'}»")
        verz = karte_ordner() if os.path.isdir(karte_ordner()) else STAENDE
        name = stand_waehlen(wunsch or "neueste", verz)
        zeilen.append(f"gewaehlt:   {name}  (aus {verz})")

        # ZUERST den JETZIGEN Zustand sichern. Ein Rueckweg, der selbst keinen
        # Rueckweg hat, ist eine Falle: wer den falschen Stand waehlt, haette
        # sonst nichts mehr, worauf er zurueck koennte.
        #
        # Die Sperre kommt DAVOR und nicht danach: sonst legte der
        # Pfad-Wachhund waehrend des Zurueckspielens einen Stand aus dem
        # Zwischenzustand an (siehe Klasse Sperre — genau so passiert).
        with Sperre():
            # Der Stand „vorher" traegt KEINE Zugangsdaten: hier laeuft
            # niemand mit einer Tastatur mit, und ein Passwort, das dieser
            # Weg trotzdem erreichte, laege auf der Box. Es entsteht dadurch
            # auch kein Verlust — die Wiederherstellung loescht die Werte
            # der Box nie (siehe die Rangfolge in `wiederherstellen`).
            stand_j, inhalte_j, _, klagen_j, _ = stand_bauen_stabil("vor-wiederherstellung")
            vorher = os.path.join(STAENDE, name_bauen(stand_j, True))
            schreiben(vorher, stand_j, inhalte_j)
            zeilen.append(f"vorher gesichert als {os.path.basename(vorher)}")
            # ANDERS ALS BEI `--anlegen` wird hier trotz Klage geschrieben:
            # das ist der EINZIGE Weg zurueck, wenn gleich der falsche Stand
            # eingespielt wird. Verweigern hiesse, den Rueckweg des Rueckwegs
            # zu streichen, weil er unvollstaendig ist. Er wird stattdessen
            # benannt — und `--wiederherstellen` verweigert ihn spaeter von
            # sich aus, solange niemand `--trotzdem` sagt.
            for k in klagen_j:
                zeilen.append(f"  ACHTUNG, dieser Stand «vorher» ist "
                              f"unvollstaendig: {k}")

            stand, inhalte = stand_oeffnen(os.path.join(verz, name))
            zeilen += wiederherstellen(stand, inhalte, trocken=False)
        zeilen.append("")
        zeilen.append("FERTIG.")
    except SystemExit as e:
        zeilen.append(f"ABGEBROCHEN: {e}")
        ergebnis = 1
    except Exception as e:                                       # noqa: BLE001
        zeilen.append(f"FEHLER: {type(e).__name__}: {e}")
        ergebnis = 1

    zeilen += ["",
               "Die Marke wurde umbenannt, damit die Wiederherstellung nicht",
               "bei jedem Start wieder losgeht. Wer sie noch einmal fahren",
               f"will, legt {MARKE} erneut an."]
    text = "\n".join(zeilen) + "\n"
    try:
        with open(os.path.join(KARTE, BERICHT), "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        stempel = datetime.now().strftime("%Y%m%d-%H%M%S")
        os.replace(marke, os.path.join(KARTE, f"mupibox-wiederherstellen.erledigt-{stempel}.txt"))
        os.sync()
    except OSError as e:
        sagen(f"Bericht liess sich nicht auf die Karte schreiben: {e}")
    sagen(text)
    return ergebnis


# ── Die Probe: den Rueckweg fahren, ohne die Box anzufassen ────────────────
def probe(sagen=print) -> int:
    """B3: „Eine Sicherung, die nie zurueckgespielt wurde, ist keine."

    Deshalb faehrt die Probe den ECHTEN Weg — dieselbe Funktion, dieselben
    Pruefungen — nur gegen ein Wegwerf-Verzeichnis. Danach wird Byte fuer Byte
    verglichen. Das ist der Unterschied zu „das Archiv laesst sich oeffnen":
    geoeffnet hat man noch nichts wiederhergestellt.
    """
    alle = staende_lesen()
    if not alle:
        sagen("kein Stand vorhanden — nichts zu proben")
        return 1
    name = alle[0]
    # DAS HIER MUSS EIN SATZ WERDEN UND KEIN TRACEBACK. stand_oeffnen wirft
    # SystemExit (falsche Pruefsumme, unmoeglicher Pfad im Archiv) UND
    # gewoehnliche Ausnahmen: ein einziger Bit-Dreher im Archiv gibt
    # BadGzipFile, eine abgeschnittene Datei EOFError. Ohne diese Zeilen stand
    # der Python-Traceback in PROBE.txt auf der Karte — ausgerechnet in der
    # Datei, die jemand OHNE SSH und ohne Python liest, um zu erfahren, ob
    # seine Sicherung noch taugt. `--pruefen` macht es seit jeher richtig
    # (dieselbe Fangzeile, gleicher Grund); die Probe fiel dabei durchs Raster.
    # Nachgestellt mit einem verdrehten Byte in der Mitte des Archivs.
    try:
        stand, inhalte = stand_oeffnen(os.path.join(STAENDE, name))
    except (SystemExit, Exception) as e:                         # noqa: BLE001
        sagen(f"PROBE FEHLGESCHLAGEN: {name} laesst sich nicht oeffnen — "
              f"{type(e).__name__}: {e}")
        sagen("Dieser Stand ist NICHT zurueckspielbar. Ein aelterer kann es "
              "noch sein: `mupibox-sicherung.py --pruefen` sagt, welcher.")
        return 1
    # DIE PROBE MUSS DEN INHALT ANSEHEN, NICHT NUR DIE HUELLE. Ein Stand mit
    # einer leeren data.json laesst sich tadellos oeffnen, tadellos
    # zurueckspielen und Byte fuer Byte vergleichen — er besteht diese Probe,
    # und er loescht trotzdem die Bibliothek. Ohne diese Zeilen sagte
    # PROBE.txt auf der Karte woechentlich BESTANDEN ueber einen Stand, der
    # das Gegenteil von brauchbar ist.
    kaputt = klagen_ueber(inhalte)
    if kaputt:
        sagen(f"PROBE FEHLGESCHLAGEN: {name} laesst sich zwar oeffnen, traegt "
              f"aber Dateien OHNE INHALT:")
        for k in kaputt:
            sagen(f"  - {k}")
        sagen("So ein Stand entsteht, wenn genau waehrend eines "
              "Schreibvorgangs gesichert wird. Einspielen wuerde die "
              "betroffene Datei LEEREN. `--pruefen` nennt die uebrigen "
              "Staende; einer davon ist der bessere.")
        return 1
    with tempfile.TemporaryDirectory(prefix="mupibox-probe-") as tmp:
        ersatz = {baum: os.path.join(tmp, baum.replace("/", "_"))
                  for baum in BAEUME}
        for w in ersatz.values():
            os.makedirs(w, exist_ok=True)
        # Die ausgelassenen Schluessel koennen hier nicht gestopft werden (das
        # Testverzeichnis ist leer) — der Rueckweg muss also OHNE sie sauber
        # durchlaufen. Genau das ist der Fall, der auf einer frischen Karte
        # eintritt, und deshalb wird er hier geprueft und nicht der bequeme.
        try:
            bericht = wiederherstellen(stand, inhalte, trocken=False,
                                       wurzel_ersatz=ersatz, trotzdem=True)
        except SystemExit as e:
            sagen(f"PROBE FEHLGESCHLAGEN beim Schreiben: {e}")
            return 1
        schlecht = 0
        for pfad, roh in inhalte.items():
            baum = pfad.rsplit("/", 1)[0] if pfad.count("/") > 1 else pfad.split("/")[0]
            for b, w in ersatz.items():
                if pfad.startswith(b + "/"):
                    ziel = os.path.join(w, pfad[len(b) + 1:])
                    break
            else:
                continue
            if not os.path.exists(ziel):
                sagen(f"  FEHLT   {pfad}")
                schlecht += 1
                continue
            da = open(ziel, "rb").read()
            if pfad in GEHEIM:
                # Diese Datei wird beim Zurueckspielen neu erzeugt (die
                # ausgelassenen Schluessel werden eingesetzt) — hier zaehlt,
                # dass sie gueltiges JSON ist und die Nicht-Geheimnisse traegt.
                gleich = json.loads(da.decode()) == json.loads(roh.decode())
            else:
                gleich = da == roh
            if not gleich:
                sagen(f"  ANDERS  {pfad}")
                schlecht += 1
        sagen("\n".join("  " + b for b in bericht))
        sagen(f"\nProbe an {name}: {len(inhalte) - schlecht} von {len(inhalte)} "
              f"Dateien deckungsgleich zurueckgespielt")

    # ── Der Behaelter. Die Probe hat kein Passwort — und soll auch keines
    #    haben. Sie kann aber zwei Dinge pruefen, und das zweite ist das
    #    wichtigere:
    #      * ist der Klumpen noch ein AEAD-Paket (die Pruefsumme hat
    #        stand_oeffnen schon geprueft),
    #      * GIBT ES GPG UEBERHAUPT NOCH. gnupg ist auf dieser Box nur
    #        angeweht (Recommends einer Alternativenkette,
    #        [[e29b7-gpg-kann-doch-aead-und-gnupg-ist-nur-angeweht]]).
    #        Faellt es bei irgendeinem Update heraus, sind alle
    #        verschluesselten Staende unlesbar — und ohne diese Zeilen merkte
    #        es niemand bis zum Ernstfall. Genau dafuer laeuft die Probe.
    #
    # GESUCHT WIRD NICHT IM JUENGSTEN STAND, SONDERN IM JUENGSTEN MIT
    # BEHAELTER. Der juengste ist fast immer ein selbsttaetiger und hat gar
    # keine Zugangsdaten; wer nur ihn ansieht, prueft die Verschluesselung
    # NIE und merkt es nicht — ein Pruefer mit blindem Fleck, der BESTANDEN
    # sagt. Genau die Sorte, gegen die stand_oeffnen schon einmal nachgebaut
    # werden musste.
    for kandidat in staende_lesen():
        pfad_k = os.path.join(STAENDE, kandidat)
        try:
            st_k, _ = stand_oeffnen(pfad_k)
        except (SystemExit, Exception):                          # noqa: BLE001
            continue
        zug = st_k.get("zugangsdaten") or {}
        if not zug:
            continue
        if not gpg_pfad():
            sagen(f"PROBE FEHLGESCHLAGEN: {kandidat} traegt "
                  f"{len(zug.get('felder', []))} verschluesselte Zugangsdaten, "
                  f"aber auf dieser Box gibt es KEIN gpg mehr. Der Behaelter "
                  f"ist damit nicht mehr zu oeffnen.")
            sagen("  Abhilfe:  sudo apt-get install -y gnupg")
            return 1
        kopf = behaelter_kopf(behaelter_lesen(pfad_k, st_k) or b"")
        if not ist_aead(kopf):
            sagen(f"PROBE FEHLGESCHLAGEN: {zug.get('behaelter', BEHAELTER)} in "
                  f"{kandidat} ist kein AEAD-verschluesseltes gpg-Paket "
                  f"({kopf or 'gpg erkennt gar kein Paket'}).")
            return 1
        sagen(f"  Zugangsdaten: {kandidat} traegt "
              f"{len(zug.get('felder', []))} Feld(er) im Behaelter, gpg "
              f"erkennt ihn ({kopf}).")
        sagen("  Ob das PASSWORT noch stimmt, kann diese Probe nicht sagen — "
              "dafuer muesste es auf der Box liegen, und dann waere es "
              "keines mehr.")
        break
    return 1 if schlecht else 0


# ── Ernten: Altlasten in einen Stand aufnehmen (E29/B5) ────────────────────
def ernten(pfade: list[str], sagen=print) -> int:
    """Bevor eine beiseite gelegte Datei faellt, kommt ihr Inhalt hier hinein.

    Nur so darf B5 ueberhaupt loeschen. Es gilt dieselbe Regel wie sonst:
    was Zugangsdaten enthaelt, wird entgeheimt — eine Altlast ist kein Grund,
    laxer zu sein, im Gegenteil (die acht mupiboxconfig-Fassungen auf der Box
    trugen ZWEI verschiedene Spotify-Dauerzugaenge).
    """
    inhalte, dateien, ausgelassen = {}, [], []
    for p in pfade:
        if not os.path.isfile(p):
            sagen(f"  uebersprungen (keine Datei): {p}")
            continue
        roh = open(p, "rb").read()
        im_archiv = "altlast/" + p.lstrip("/").replace("/", "_")
        # Fuer die Entgeheimung zaehlt, WORAUS die Altlast entstand.
        vorlage = ("etc/mupibox/mupiboxconfig.json" if "mupiboxconfig.json" in p
                   else "server/config/config.json" if "/config.json" in p
                   else "server/config/wlan.json" if "wlan.json" in p
                   else None)
        if vorlage:
            # Die dritte Rueckgabe (die WERTE) wird hier absichtlich
            # weggeworfen: eine Ernte ist ein Blick zurueck auf Dateien, die
            # gleich geloescht werden, und sie laeuft als Schritt des
            # Aufraeumens ohne jemanden, der ein Passwort eingeben koennte.
            # Die alten Schluessel gehen damit mit der Altlast unter — das
            # ist gewollt; der laufende Stand hat die gueltigen.
            inhalt, weg, _ = entgeheimen(vorlage, roh)
            for w in weg:
                w["datei"] = im_archiv
            ausgelassen.extend(weg)
        else:
            inhalt = roh
        if not inhalt:
            sagen(f"  NICHT geerntet (unlesbar, koennte Schluessel tragen): {p}")
            continue
        inhalte[im_archiv] = inhalt
        dateien.append({"pfad": im_archiv, "bytes": len(inhalt),
                        "sha256": sha(inhalt), "herkunft": p,
                        "geaendert": datetime.fromtimestamp(
                            os.path.getmtime(p)).isoformat(timespec="seconds")})
    if not dateien:
        sagen("nichts zu ernten")
        return 1
    stand = {
        "format": 1,
        "erzeugt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "grund": "altlasten-ernte",
        "host": os.uname().nodename,
        "werkzeug": "mupibox-sicherung.py --ernten (BACKLOG E29/B5)",
        "dateien": dateien,
        "verweise": {},
        "ausgelassen": ausgelassen,
        "bewusst_drin": [],
        "nicht_dabei": [],
        "unbekannt": [],
        "hinweis": "KEIN Stand der Box, sondern der Inhalt beiseite gelegter "
                   "Dateien, bevor sie weggeraeumt wurden. --wiederherstellen "
                   "kann damit NICHTS anfangen (kein Ziel); zum Nachsehen "
                   "einfach mit tar auspacken.",
        "inhalt_kennung": sha("".join(sorted(d["sha256"] for d in dateien)).encode()),
    }
    ziel = os.path.join(STAENDE, name_bauen(stand, True))
    schreiben(ziel, stand, inhalte)
    sagen(f"{len(dateien)} Altlast(en) geerntet nach {ziel}")
    return 0


# ── Befehle ────────────────────────────────────────────────────────────────
def zugangsdaten_behaelter(geheim: list[dict], passwort: str
                           ) -> tuple[bytes, dict]:
    """-> (verschluesselter Klumpen, was davon in stand.json darf).

    DIE ZWEITE RUECKGABE IST DIE GRENZE. Alles, was hier zurueckkommt, wird
    in stand.json geschrieben, in LIESMICH.txt gedruckt und im Bericht
    genannt — deshalb wird sie hier Feld fuer Feld NEU GEBAUT und nicht aus
    `geheim` gefiltert. Ein Filter uebersieht ein Feld, das jemand spaeter
    hinzufuegt; eine Neubildung kann das nicht.
    """
    klar = json.dumps({
        "format": 1,
        "erzeugt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "felder": [{"datei": g["datei"], "zeiger": g["zeiger"],
                    "stelle": g["stelle"], "wert": g["wert"]} for g in geheim],
    }, ensure_ascii=False).encode("utf-8")
    klumpen = behaelter_packen(klar, passwort)
    warum = {(d, z): w for d, v in GEHEIM.items() for z, w in v}
    gesehen, felder = set(), []
    for g in geheim:
        schl = (g["datei"], g["zeiger"])
        if schl in gesehen:
            continue
        gesehen.add(schl)
        felder.append({"datei": g["datei"], "zeiger": g["zeiger"],
                       "warum": warum.get(schl, "Zugangsdatum")})
    return klumpen, {
        "behaelter": BEHAELTER,
        "verfahren": "gpg --symmetric --force-ocb --cipher-algo AES256 "
                     "(OCB/AEAD, zu oeffnen ab GnuPG 2.4)",
        "bytes": len(klumpen),
        "sha256": sha(klumpen),
        "stellen": len(geheim),
        "felder": felder,
    }


def anlegen(grund: str, wenn_anders: bool, behalten: bool, sagen=print,
            mit_zugangsdaten: bool = False) -> int:
    if Sperre.gilt():
        sagen("Eine Wiederherstellung laeuft gerade — kein Stand. Ein Stand "
              "aus einem Zwischenzustand saehe gueltig aus und waere es nicht.")
        return 0
    passwort = None
    if mit_zugangsdaten:
        # ZUERST DAS PASSWORT, DANN LESEN. Wer erst die Konfiguration
        # einsammelt und dann fragt, haelt die Geheimnisse waehrend der
        # Eingabe im Speicher — und bricht der Benutzer ab, war das Lesen
        # umsonst. Ausserdem faellt ein fehlendes gpg so sofort auf.
        if not gpg_pfad():
            sagen("gpg ist auf dieser Box nicht installiert — ohne das kann "
                  "kein Behaelter angelegt werden.\n"
                  "  sudo apt-get install -y gnupg")
            return 1
        passwort = passwort_holen("fuer die Zugangsdaten in diesem Stand",
                                  bestaetigen=True)
    stand, inhalte, geheim, klagen, stabil = stand_bauen_stabil(grund)
    if klagen:
        # OHNE INHALT WIRD NICHT GESICHERT. Ein Stand mit einer leeren
        # data.json ist kein halber Stand, sondern eine geladene Waffe: er
        # besteht jede Pruefung und loescht beim Einspielen die Bibliothek.
        # Kein Stand ist ein sichtbares Loch — dieser hier waere unsichtbar.
        sagen("KEIN Stand angelegt — beim Lesen war etwas unvollstaendig:")
        for k in klagen:
            sagen(f"  - {k}")
        sagen("Das ist der Normalfall, wenn genau jetzt geschrieben wird "
              "(POST /api/add kuerzt data.json beim Oeffnen auf 0). Der "
              "naechste Lauf holt es nach; wer nicht warten will, ruft "
              "`--anlegen` gleich noch einmal auf.")
        return 1
    if not stabil:
        sagen("HINWEIS: waehrend des Lesens hat sich etwas geaendert — dieser "
              "Stand kann Dateien aus zwei Zeitpunkten tragen (vermerkt als "
              "`unruhig`). Ein leicht unscharfer Stand ist besser als keiner.")
    # `--wenn-anders` darf einen Stand MIT Zugangsdaten nie unterdruecken:
    # der letzte Stand hat sie womoeglich gar nicht, und „unveraendert" waere
    # dann eine Aussage ueber die Konfiguration, nicht ueber den Behaelter.
    if wenn_anders and not mit_zugangsdaten:
        for name in staende_lesen():
            try:
                alt, _ = stand_oeffnen(os.path.join(STAENDE, name))
            except (SystemExit, tarfile.TarError, OSError, ValueError):
                continue
            if alt.get("inhalt_kennung") == stand["inhalt_kennung"]:
                sagen(f"unveraendert gegenueber {name} — kein neuer Stand.")
                return 0
            break
    klumpen = None
    if mit_zugangsdaten:
        if not geheim:
            sagen("  ! keine Zugangsdaten gefunden — der Stand entsteht OHNE "
                  "Behaelter (auf dieser Box ist offenbar nichts gesetzt).")
        else:
            klumpen, stand["zugangsdaten"] = zugangsdaten_behaelter(geheim,
                                                                    passwort)
        # EIN STAND MIT ZUGANGSDATEN WIRD ANGEHEFTET, und zwar nicht aus
        # Bequemlichkeit: er entsteht nur von Hand und damit selten,
        # waehrend selbsttaetige Staende taeglich nachruecken. Ohne das
        # Anheften verdraengten sie ihn nach spaetestens zehn Laeufen —
        # genau der Fehler aus [[aufraeum-sicherung-vor-der-entscheidung]],
        # nur teurer.
        behalten = True
    ziel = os.path.join(STAENDE, name_bauen(stand, behalten))
    schreiben(ziel, stand, inhalte, klumpen)
    zug = stand.get("zugangsdaten") or {}
    sagen(f"{ziel}  ({os.path.getsize(ziel)} B, {len(stand['dateien'])} Dateien, "
          + (f"{zug['stellen']} Zugangsdaten VERSCHLUESSELT in "
             f"{zug['behaelter']}, " if zug else "")
          + f"{len(stand['ausgelassen']) - len(zug.get('felder', []))} "
            f"Schluessel ausgelassen)")
    if zug:
        sagen("  Das Passwort steht nirgends. Ohne es kommt alles ANDERE "
              "trotzdem zurueck; nur diese Felder nicht:")
        for f in zug["felder"]:
            sagen(f"    {f['datei']}{f['zeiger']}")
    for u in stand["unbekannt"]:
        sagen(f"  ! nicht eingeordnet, NICHT gesichert: {u['pfad']}")
    for name in auslese(staende_lesen(), BEHALTEN):
        os.remove(os.path.join(STAENDE, name))
        sagen(f"  ausgelesen (zu alt): {name}")
    return 0


def liste(als_json: bool, sagen=print) -> int:
    alle = staende_lesen()
    if als_json:
        aus = []
        for n in alle:
            try:
                s, _ = stand_oeffnen(os.path.join(STAENDE, n))
            except Exception:                                    # noqa: BLE001
                aus.append({"name": n, "fehler": "laesst sich nicht oeffnen"})
                continue
            aus.append({"name": n, "erzeugt": s["erzeugt"], "grund": s["grund"],
                        "dateien": len(s["dateien"]),
                        "ausgelassen": len(s["ausgelassen"]),
                        "zugangsdaten": len((s.get("zugangsdaten")
                                             or {}).get("felder", [])),
                        "bytes": os.path.getsize(os.path.join(STAENDE, n))})
        sagen(json.dumps(aus, indent=2, ensure_ascii=False))
        return 0
    if not alle:
        sagen(f"kein Stand in {STAENDE}")
        return 1
    sagen(f"{len(alle)} Stand/Staende in {STAENDE}")
    for n in alle:
        gr = os.path.getsize(os.path.join(STAENDE, n))
        halt = "  [angeheftet]" if ".behalten." in n else ""
        # Welcher Stand die Zugangsdaten traegt, ist die Frage, die im
        # Ernstfall zuerst kommt — sie darf nicht erst aus stand.json
        # herausgegraben werden muessen.
        try:
            s, _ = stand_oeffnen(os.path.join(STAENDE, n))
            zug = (s.get("zugangsdaten") or {}).get("felder", [])
        except (SystemExit, Exception):                          # noqa: BLE001
            zug = []
        halt += f"  [+{len(zug)} Zugangsdaten, verschluesselt]" if zug else ""
        sagen(f"  {gr:>7} B  {n}{halt}")
    fallen = auslese(alle, BEHALTEN)
    if fallen:
        sagen(f"\nbeim naechsten Anlegen faellt weg: {', '.join(fallen)}")
    return 0


def zeigen(wunsch: str, sagen=print) -> int:
    name = stand_waehlen(wunsch)
    stand, _ = stand_oeffnen(os.path.join(STAENDE, name))
    sagen(liesmich(stand))
    return 0


def pruefen(wunsch: str, sagen=print) -> int:
    namen = staende_lesen() if wunsch in ("", "alle") else [stand_waehlen(wunsch)]
    schlecht = 0
    for n in namen:
        try:
            stand, inhalte = stand_oeffnen(os.path.join(STAENDE, n))
            # Heil ist nicht dasselbe wie brauchbar: die Pruefsumme einer
            # LEEREN Datei stimmt genauso. Wer hier nur die Huelle prueft,
            # bekommt ein „OK" ueber einen Stand, der die Bibliothek loescht.
            kaputt = klagen_ueber(inhalte)
            if kaputt:
                sagen(f"  LEER  {n}: {'; '.join(kaputt)}")
                schlecht += 1
                continue
            unruhig = "  (unruhig gelesen)" if stand.get("unruhig") else ""
            zug = (stand.get("zugangsdaten") or {}).get("felder", [])
            mit = f", {len(zug)} Zugangsdaten verschluesselt" if zug else ""
            sagen(f"  OK    {n}  ({len(inhalte)} Dateien, "
                  f"{len(stand['ausgelassen']) - len(zug)} ausgelassen"
                  f"{mit}){unruhig}")
        # SystemExit MUSS mit gefangen werden: stand_oeffnen wirft ihn bei
        # einer falschen Pruefsumme, und `except Exception` faengt ihn NICHT
        # (SystemExit haengt an BaseException). Ohne diese Zeile brach
        # `--pruefen` beim ersten kaputten Archiv ab und sagte ueber alle
        # folgenden nichts — ausgerechnet dann, wenn man es wissen will.
        except (SystemExit, Exception) as e:                     # noqa: BLE001
            sagen(f"  KAPUTT {n}: {e}")
            schlecht += 1
    return 1 if schlecht else 0


# ── Selbsttest ─────────────────────────────────────────────────────────────
def selbsttest() -> int:
    ok = bad = 0

    def chk(name, bedingung):
        nonlocal ok, bad
        print(("  OK    " if bedingung else "  FEHLT ") + name)
        ok += bool(bedingung)
        bad += (not bedingung)

    # ── Die Auslese. Der Fehler, den sie nicht machen darf, ist belegt.
    lauf = [f"mupibox-sicherung-2026080{i}-120000-selbsttaetig.tar.gz"
            for i in range(1, 10)]
    chk("weniger als das Kontingent -> nichts faellt",
        auslese(lauf[:3], 10) == [])
    chk("mehr als das Kontingent -> die AELTESTEN fallen",
        auslese(lauf, 3) == sorted(lauf)[:6])
    fest = "mupibox-sicherung-20260726-120000-vor-update.behalten.tar.gz"
    chk("ein angehefteter Stand faellt NIE, auch als aeltester nicht",
        fest not in auslese([fest] + lauf, 2))
    chk("angeheftete zaehlen NICHT gegen das Kontingent",
        len(auslese([fest] * 0 + [fest] + lauf, 9)) == 0)
    chk("Kontingent 0 -> alles Lose faellt",
        auslese(lauf, 0) == sorted(lauf))

    # ── Die Pruefungen, die eine unbrauchbare Box verhindern.
    gut = {"mupibox": {"audioDevice": "hw:0,0", "startVolume": "40",
                       "maxVolume": "80", "mediaCheckTimer": "300"},
           "interfacelogin": {"state": False, "password": ""}}
    chk("eine heile Konfiguration wird nicht beanstandet", konfig_pruefen(gut) == [])
    import copy
    d = copy.deepcopy(gut); d["interfacelogin"] = {"state": True, "password": ""}
    chk("Anmeldung AN ohne Passwort -> abgelehnt (sonst kommt niemand mehr rein)",
        any("interfacelogin" in s for s in konfig_pruefen(d)))
    d = copy.deepcopy(gut); d["mupibox"]["audioDevice"] = ""
    chk("leeres audioDevice -> abgelehnt (stumme Box)",
        any("audioDevice" in s for s in konfig_pruefen(d)))
    d = copy.deepcopy(gut); d["mupibox"]["startVolume"] = "90"
    chk("startVolume > maxVolume -> abgelehnt",
        any("startVolume" in s for s in konfig_pruefen(d)))
    d = copy.deepcopy(gut); del d["mupibox"]["mediaCheckTimer"]
    chk("mediaCheckTimer fehlt -> abgelehnt (`sleep null`, belegt 03.08.2026)",
        any("mediaCheckTimer" in s for s in konfig_pruefen(d)))
    d = copy.deepcopy(gut); d["mupibox"]["mediaCheckTimer"] = "null"
    chk("mediaCheckTimer als Zeichenkette «null» -> ebenfalls abgelehnt",
        any("mediaCheckTimer" in s for s in konfig_pruefen(d)))

    # ── Die Sperre. Sie steht hier, weil ihr Fehlen an der echten Box einen
    #    halb zurueckgespielten Stand erzeugt hat, der wie ein gueltiger
    #    aussah (Herleitung in der Klasse Sperre).
    global SPERRE
    alt_sperre = SPERRE
    with tempfile.TemporaryDirectory(prefix="mupibox-sperre-") as tmp:
        SPERRE = os.path.join(tmp, "laeuft")
        try:
            chk("ohne Sperre darf gesichert werden", not Sperre.gilt())
            with Sperre():
                chk("waehrend einer Wiederherstellung gilt die Sperre", Sperre.gilt())
                # NICHT „…und das Verzeichnis ist leer" pruefen: auf einer
                # echten Box liegen dort Staende, und der Test faellt dann aus
                # dem falschen Grund durch. Gezaehlt wird die AENDERUNG.
                vorher_n = len(staende_lesen())
                rc = anlegen("test", False, False, sagen=lambda *_: None)
                chk("--anlegen legt dann NICHTS an und faellt trotzdem nicht durch",
                    rc == 0 and len(staende_lesen()) == vorher_n)
            chk("danach ist die Sperre weg", not Sperre.gilt())
            with open(SPERRE, "w") as f:
                f.write("vergessen\n")
            os.utime(SPERRE, (time.time() - SPERRE_GILT - 60,) * 2)
            chk("eine VERGESSENE Sperre stellt das Sichern nicht auf Dauer ab",
                not Sperre.gilt())
        finally:
            SPERRE = alt_sperre

    # ── Die Zeiger — und die eine Eigenschaft, auf die alles ankommt:
    #    entfernen loescht, uebernehmen holt zurueck, Typ bleibt Typ.
    q = {"spotify": {"clientId": "abc", "refreshToken": "GEHEIM"},
         "mupibox": {"startVolume": "40"}}
    kopie = json.loads(json.dumps(q))
    chk("Zeiger findet den Wert", zeiger_lesen(q, "/spotify/refreshToken") == ["GEHEIM"])
    chk("Zeiger entfernt genau einen Schluessel",
        zeiger_entfernen(kopie, "/spotify/refreshToken") == 1
        and "refreshToken" not in kopie["spotify"]
        and kopie["spotify"]["clientId"] == "abc")
    chk("uebernehmen holt den Wert der Box zurueck",
        zeiger_uebernehmen(kopie, q, "/spotify/refreshToken")
        and kopie["spotify"]["refreshToken"] == "GEHEIM")
    chk("uebernehmen erfindet nichts, wenn die Box den Schluessel nicht hat",
        not zeiger_uebernehmen(kopie, {"spotify": {}}, "/spotify/refreshToken"))
    chk("ZAHL ALS ZEICHENKETTE bleibt Zeichenkette (jq -r liest sie so)",
        isinstance(json.loads(json.dumps(kopie))["mupibox"]["startVolume"], str))

    liste_q = [{"ssid": "Netz", "pw": "geheim"}, {"ssid": "Zweit", "pw": "auch"}]
    lk = json.loads(json.dumps(liste_q))
    chk("Listen-Zeiger `*` entfernt in JEDEM Eintrag",
        zeiger_entfernen(lk, "/*/pw") == 2
        and all("pw" not in e for e in lk) and lk[0]["ssid"] == "Netz")
    chk("Listen-Zeiger `*` holt in JEDEM Eintrag zurueck",
        zeiger_uebernehmen(lk, liste_q, "/*/pw")
        and [e["pw"] for e in lk] == ["geheim", "auch"])
    # DIESE PRUEFUNG HIESS EINMAL `… in (True, False)` UND PRUEFTE DAMIT
    # NICHTS — jeder Rueckgabewert bestand sie, auch der falsche. Genau
    # darunter hat der Fehler aus [[_listen_zuordnung]] ueberlebt. Jetzt wird
    # gefragt, WOHIN der Wert ging.
    kurz = [{"ssid": "Netz", "pw": "vonNetz"}]
    lk2 = json.loads(json.dumps([{"ssid": "Netz"}, {"ssid": "Zweit"}]))
    zeiger_uebernehmen(lk2, kurz, "/*/pw")
    chk("kuerzere Liste auf der Box: der Wert geht an SEIN Netz",
        lk2[0].get("pw") == "vonNetz" and "pw" not in lk2[1])

    # DER FALL, AN DEM DER PLATZ-FUER-PLATZ-WEG ZERBRACH (Gegenlesen
    # 05.08.2026): das erste Netz ist von der Box verschwunden.
    weg = [{"ssid": "B", "pw": "gehoert-zu-B"}]
    lk3 = json.loads(json.dumps([{"ssid": "A"}, {"ssid": "B"}]))
    zeiger_uebernehmen(lk3, weg, "/*/pw")
    chk("ein Passwort landet NIE an einem fremden Netz",
        "pw" not in lk3[0] and lk3[1].get("pw") == "gehoert-zu-B")
    chk("das fremde Netz bekommt auch keinen leeren Platzhalter",
        set(lk3[0]) == {"ssid"})

    # Zwei Netze gleichen Namens: kein Treffer ist besser als der falsche.
    doppelt = [{"ssid": "X", "pw": "eins"}, {"ssid": "X", "pw": "zwei"}]
    lk4 = json.loads(json.dumps([{"ssid": "X"}]))
    zeiger_uebernehmen(lk4, doppelt, "/*/pw")
    chk("zwei gleiche Namen -> lieber nichts uebernehmen als raten",
        "pw" not in lk4[0])

    # Und der Rueckfall: eine Liste ohne jedes Merkmal darf noch ueber den
    # Platz gehen — aber nur bei gleicher Laenge.
    chk("merkmalslose Liste, gleiche Laenge -> Platz gilt",
        _listen_zuordnung([{}, {}], [{}, {}], "pw") == [(0, 0), (1, 1)])
    chk("merkmalslose Liste, andere Laenge -> gar nichts",
        _listen_zuordnung([{}, {}], [{}], "pw") == [])

    # ── Die KONKRETEN Stellen. Ohne sie haengte ein `/*/pw` beim
    #    Zurueckspielen am falschen Netz — der Fehler, den man nicht sieht.
    drei = [{"ssid": "A", "pw": "eins"}, {"ssid": "B"}, {"ssid": "C", "pw": "drei"}]
    chk("`*` liefert die STELLE, nicht nur den Wert",
        zeiger_stellen(drei, zeiger_teile("/*/pw")) == [("/0/pw", "eins"),
                                                        ("/2/pw", "drei")])
    ohne = json.loads(json.dumps(drei))
    zeiger_entfernen(ohne, "/*/pw")
    chk("und zurueck an DIESELBE Stelle — nicht der Reihe nach",
        zeiger_setzen(ohne, "/0/pw", "eins")
        and zeiger_setzen(ohne, "/2/pw", "drei")
        and [e.get("pw") for e in ohne] == ["eins", None, "drei"])
    chk("ein Listenplatz, den es nicht mehr gibt, wird NICHT erfunden",
        not zeiger_setzen([{"ssid": "A"}], "/7/pw", "x"))
    leergeraeumt = {"spotify": {}}
    chk("ein leer geraeumtes Zwischen-Woerterbuch nimmt den Wert trotzdem",
        zeiger_setzen(leergeraeumt, "/spotify/refreshToken", "ZURUECK")
        and leergeraeumt["spotify"]["refreshToken"] == "ZURUECK")
    chk("ein fehlendes Zwischen-Woerterbuch wird angelegt",
        zeiger_setzen({}, "/telegram/token", "T") is True)
    chk("wo etwas anderes steht, wird NICHT ueberbaut",
        not zeiger_setzen({"spotify": "kein-woerterbuch"},
                          "/spotify/refreshToken", "x"))
    chk("`*` ist keine konkrete Stelle und wird abgelehnt",
        not zeiger_setzen([{"ssid": "A"}], "/*/pw", "x"))

    # ── Entgeheimen: geht der Schluessel wirklich NICHT ins Archiv?
    roh = json.dumps({"spotify": {"clientId": "abc", "refreshToken": "GEHEIM",
                                  "clientSecret": "AUCHGEHEIM"},
                      "interfacelogin": {"state": False, "password": "HASH"},
                      "mupibox": {"host": "MixPiBox"}}).encode()
    inhalt, weg, werte = entgeheimen("etc/mupibox/mupiboxconfig.json", roh)
    chk("kein Dauerzugang im Archiv", b"GEHEIM" not in inhalt)
    chk("kein Geheimnis im Archiv", b"AUCHGEHEIM" not in inhalt)
    chk("kein Verwaltungspasswort im Archiv", b"HASH" not in inhalt)
    chk("clientId bleibt drin (bewusste Entscheidung, siehe BEWUSST_DRIN)",
        b"abc" in inhalt)
    chk("alles Uebrige bleibt unangetastet", b"MixPiBox" in inhalt)
    chk("jeder ausgelassene Schluessel wird BENANNT",
        {a["zeiger"] for a in weg} ==
        {"/spotify/refreshToken", "/spotify/clientSecret", "/interfacelogin/password"})
    chk("die WERTE kommen getrennt heraus — und vollstaendig",
        {w["wert"] for w in werte} == {"GEHEIM", "AUCHGEHEIM", "HASH"})
    chk("die Liste `ausgelassen` traegt KEINEN Wert (sie landet in stand.json)",
        not any("wert" in a for a in weg))
    wlan = json.dumps([{"category": "wifi", "ssid": "Zuhause", "pw": "S3hrGeheim"}]).encode()
    inhalt, weg, werte = entgeheimen("server/config/wlan.json", wlan)
    chk("kein WLAN-Passwort im Archiv", b"S3hrGeheim" not in inhalt)
    chk("der Netzname bleibt (sonst weiss niemand, welches Netz fehlt)",
        b"Zuhause" in inhalt)
    chk("das WLAN-Passwort kommt mit seiner Stelle heraus",
        [(w["stelle"], w["wert"]) for w in werte] == [("/0/pw", "S3hrGeheim")])
    inhalt, weg, werte = entgeheimen("server/config/data.json", b'{"a":1}')
    chk("eine Datei ohne Schluessel geht unveraendert durch",
        inhalt == b'{"a":1}' and weg == [] and werte == [])
    inhalt, weg, werte = entgeheimen("server/config/wlan.json", b"kein json")
    chk("unlesbare Datei mit bekannten Schluesseln geht GAR NICHT mit",
        inhalt == b"" and len(weg) == 1 and werte == [])
    leerfeld = json.dumps({"spotify": {"refreshToken": ""},
                           "telegram": {"token": "T"}}).encode()
    _, weg, werte = entgeheimen("etc/mupibox/mupiboxconfig.json", leerfeld)
    chk("ein LEERES Feld kommt nicht in den Behaelter (es ist kein Geheimnis)",
        [w["zeiger"] for w in werte] == ["/telegram/token"]
        and any(a["zeiger"] == "/spotify/refreshToken" and a["war_leer"]
                for a in weg))

    # ── Einordnung: was gehoert hinein, was nicht
    chk("data.json gehoert hinein", passt("data.json", HINEIN["server/config"]))
    chk("gespielt je Profil gehoert hinein",
        passt("gespielt.gast.json", HINEIN["server/config"]))
    chk("akkuverlauf.json gehoert HINEIN (Entscheidung 05.08.2026)",
        passt("akkuverlauf.json", HINEIN["server/config"]))
    chk("… steht aber als BEIWERK gefuehrt",
        "server/config/akkuverlauf.json" in BEIWERK)
    chk("… und ist damit aus der Kennung heraus — sonst unterdrueckte "
        "`--wenn-anders` nie mehr etwas",
        sha("\n".join(f"{d['pfad']}:{d['sha256']}"
                      for d in sorted([{"pfad": "server/config/data.json",
                                        "sha256": "aa"},
                                       {"pfad": "server/config/akkuverlauf.json",
                                        "sha256": "bb"}],
                                      key=lambda x: x["pfad"])
                      if d["pfad"] not in BEIWERK).encode())
        == sha("server/config/data.json:aa".encode()))
    chk("eine LEERE Messreihe darf die Sicherung nicht aufhalten",
        klagen_ueber({"server/config/akkuverlauf.json": b"",
                      "server/config/data.json": b"[]"}) == [])
    chk("… eine leere Bibliothek dagegen schon",
        len(klagen_ueber({"server/config/data.json": b""})) == 1)
    chk("Altlasten gehoeren NICHT hinein",
        not passt("data.json.vor-titelputz-20260804T222712", HINEIN["server/config"])
        and not passt("data-vor-aufraeumen-2026-08-03T15-58-17.json",
                      HINEIN["server/config"]))
    chk("der Coverspeicher gehoert NICHT hinein",
        not passt("coverspeicher", HINEIN["server/config"]))

    # ── Ziele: ein Archiv darf NIE ausserhalb der beiden Baeume schreiben
    chk("Ziel im Konfigurationsbaum stimmt",
        ziel_von("server/config/data.json") == BOX + "/server/config/data.json")
    chk("Ziel im /etc-Baum stimmt",
        ziel_von("etc/mupibox/mupiboxconfig.json") == "/etc/mupibox/mupiboxconfig.json")
    chk("«..» im Archiv fuehrt nirgendwohin",
        ziel_von("server/config/../../../etc/passwd") is None)
    # HIER STAND BIS ZUM 05.08.2026 „ein Unterverzeichnis fuehrt nirgendwohin".
    # Das war die Absicherung — und zugleich der Grund, warum der BEREICH eines
    # Profils (`profile/<kennung>/…`) gar nicht erst zurueckgespielt werden
    # konnte. Die Absicherung ist nicht weggefallen, sie ist genauer geworden:
    # geprueft wird jetzt jedes STUECK des Pfades (`rest_heil`).
    chk("der Bereich eines Profils findet sein Ziel",
        ziel_von("server/config/profile/gast/gespielt.json")
        == BOX + "/server/config/profile/gast/gespielt.json")
    chk("«..» MITTEN im Pfad fuehrt nirgendwohin",
        ziel_von("server/config/profile/../../etc/passwd") is None)
    chk("«..» als letztes Stueck fuehrt nirgendwohin",
        ziel_von("server/config/profile/..") is None)
    chk("ein «.» im Pfad fuehrt nirgendwohin",
        ziel_von("server/config/./data.json") is None)
    chk("ein doppelter Schraegstrich fuehrt nirgendwohin",
        ziel_von("server/config/profile//gespielt.json") is None)
    chk("ein absoluter Rest fuehrt nirgendwohin",
        ziel_von("server/config//etc/passwd") is None)
    chk("ein Rueckstrich fuehrt nirgendwohin",
        ziel_von("server/config/..\\..\\etc") is None)
    chk("ein fremder Baum fuehrt nirgendwohin",
        ziel_von("etc/passwd") is None and ziel_von("/etc/passwd") is None)

    # ── Der Bereich wird wirklich EINGESAMMELT — und der Coverspeicher nicht.
    chk("die drei Bereichs-Ablagen stehen in HINEIN",
        all(passt(f"profile/gast/{d}", HINEIN["server/config"])
            for d in ("gespielt.json", "kinderzeit-verbrauch.json",
                      "listen.json")))
    chk("betreten wird genau «profile» — und sonst kein Unterordner",
        tiefe_wurzeln("server/config") == ["profile"])
    chk("der Coverspeicher wird NICHT betreten",
        "coverspeicher" not in tiefe_wurzeln("server/config"))
    chk("eine fremde Datei IM Bereich zaehlt nicht als eingesammelt",
        not passt("profile/gast/heimlich.json", HINEIN["server/config"]))

    # ── Der ganze Weg: anlegen -> oeffnen -> zurueckspielen, gegen ein
    #    Wegwerf-Verzeichnis. Ohne diesen Test ist alles oben nur Theorie.
    with tempfile.TemporaryDirectory(prefix="mupibox-selbsttest-") as tmp:
        e, s = os.path.join(tmp, "etc"), os.path.join(tmp, "srv")
        os.makedirs(e); os.makedirs(s)
        konf = {"mupibox": {"audioDevice": "hw:0,0", "startVolume": "40",
                            "maxVolume": "80", "mediaCheckTimer": "300",
                            # Die PIN vor den Einstellungen der Box. Sie steht
                            # hier, weil sie bis zum 07.08.2026 UNVERSCHLUESSELT
                            # im Archiv landete — und ein Stand geht seit
                            # /api/sicherung als Download aus dem Haus.
                            "einstellungssperre": "aus",
                            "einstellungsPin": "PINHASH"},
                "interfacelogin": {"state": True, "password": "BCRYPTHASH"},
                "spotify": {"clientId": "abc", "refreshToken": "DAUERZUGANG",
                            "username": "SPOTIFYBENUTZER",
                            "password": "SPOTIFYWORT"}}
        wlan_q = [{"category": "wifi", "ssid": "Zuhause", "pw": "HAUSSCHLUESSEL"},
                  {"category": "wifi", "ssid": "OhnePasswort"},
                  {"category": "wifi", "ssid": "Ferien", "pw": "FERIENWORT"}]
        with open(os.path.join(e, "mupiboxconfig.json"), "w") as f:
            json.dump(konf, f, indent=4)
        with open(os.path.join(s, "data.json"), "w") as f:
            json.dump([{"title": "Bibi"}], f)
        with open(os.path.join(s, "wlan.json"), "w") as f:
            json.dump(wlan_q, f, indent=4)
        # Beiwerk: die Messreihe geht mit, redet aber bei der Kennung nicht mit.
        with open(os.path.join(s, "akkuverlauf.json"), "w") as f:
            json.dump([{"t": 1, "v": 7000, "i": -600, "p": 55}], f)
        # DER BEREICH EINES KINDES (E18 Stufe 2). Zwei Profile, damit auch das
        # `*` im Muster wirklich gefragt wird, und eine Datei, die NICHT in
        # HINEIN steht — sie darf gemeldet, aber nicht eingesammelt werden.
        # Ausserdem der Coverspeicher: er liegt daneben und muss draussen
        # bleiben, obwohl jetzt Ordner betreten werden.
        for kind, wieoft in (("gast", 7), ("liam", 3)):
            b = os.path.join(s, "profile", kind)
            os.makedirs(b)
            with open(os.path.join(b, "gespielt.json"), "w") as f:
                json.dump([{"key": f"spotify:{kind}", "anzahl": wieoft}], f)
            with open(os.path.join(b, "kinderzeit-verbrauch.json"), "w") as f:
                json.dump({"tag": "2026-08-05", "sekunden": 60, "bonusMin": 0}, f)
            with open(os.path.join(b, "listen.json"), "w") as f:
                json.dump([{"id": kind, "name": f"Liste {kind}"}], f)
        with open(os.path.join(s, "profile", "gast", "heimlich.json"), "w") as f:
            json.dump({"nicht": "in HINEIN"}, f)
        # DAS VERZEICHNIS DER KINDER. Ohne diese Datei gibt es die Bereiche
        # oben zwar noch, aber kein Kind, dem sie gehoeren.
        with open(os.path.join(s, "profile.json"), "w") as f:
            json.dump({"profile": [
                {"kennung": "gast", "name": "Gast", "figur": "", "angelegt": 0},
                {"kennung": "liam", "name": "Liam", "figur": "baer",
                 "angelegt": 1786085015068}],
                "aktiv": "liam"}, f, indent=2)
        # DIE BRUECKE (E18 Stufe 3): am alten Ort steht ein VERWEIS auf den
        # Bestand des aktiven Kindes. Sie liegt hier, damit der Selbsttest
        # ueberhaupt einen Verweis kennt — bis zum 07.08.2026 kam in keinem
        # Sandkasten einer vor, und deshalb ist niemandem aufgefallen, was
        # beim Zurueckspielen mit ihm geschieht.
        os.symlink("profile/liam/resume.json", os.path.join(s, "resume.json"))
        with open(os.path.join(s, "profile", "liam", "resume.json"), "w") as f:
            json.dump([{"id": "spotify:album:liam", "progress": 42}], f)
        os.makedirs(os.path.join(s, "coverspeicher"))
        with open(os.path.join(s, "coverspeicher", "a.jpg"), "wb") as f:
            f.write(b"nachladbar")
        global BAEUME
        alt_baeume = BAEUME
        BAEUME = {"etc/mupibox": e, "server/config": s}
        try:
            stand, inhalte, geheim = stand_bauen("selbsttest")
            archiv = os.path.join(tmp, "stand.tar.gz")
            schreiben(archiv, stand, inhalte)
            chk("das Archiv liegt und laesst sich pruefen",
                os.path.getsize(archiv) > 0
                and stand_oeffnen(archiv)[0]["grund"] == "selbsttest")
            roh = open(archiv, "rb").read()
            chk("KEIN Dauerzugang im fertigen Archiv (roh durchsucht)",
                b"DAUERZUGANG" not in __import__("gzip").decompress(roh))
            chk("KEIN Verwaltungspasswort im fertigen Archiv",
                b"BCRYPTHASH" not in __import__("gzip").decompress(roh))
            chk("KEIN WLAN-Passwort im fertigen Archiv",
                b"HAUSSCHLUESSEL" not in __import__("gzip").decompress(roh))
            # DIE DREI, DIE BIS ZUM 07.08.2026 MITFUHREN. Gemessen wurde es an
            # tools/sicherung-was-geht-hinaus.ts: derselbe Weg, der die
            # Sicherung herausgibt, streicht sie an /api/config ausdruecklich
            # (ohneGeheimnisse in konfiguration.ts).
            chk("KEINE Einstellungs-PIN im fertigen Archiv",
                b"PINHASH" not in __import__("gzip").decompress(roh))
            chk("KEIN Spotify-Benutzername im fertigen Archiv",
                b"SPOTIFYBENUTZER" not in __import__("gzip").decompress(roh))
            chk("KEIN Spotify-Passwort im fertigen Archiv",
                b"SPOTIFYWORT" not in __import__("gzip").decompress(roh))
            chk("LIESMICH.txt sagt, WAS fehlt",
                "refreshToken" in liesmich(stand))
            chk("LIESMICH.txt sagt auch, was BEWUSST mitgeht",
                "clientId" in liesmich(stand))
            chk("die Messreihe ist mit im Stand",
                "server/config/akkuverlauf.json" in inhalte)

            # ── DER BEREICH: das, wofuer diese Aenderung da ist.
            chk("beide Bereiche sind vollstaendig im Stand",
                all(f"server/config/profile/{k}/{d}" in inhalte
                    for k in ("gast", "liam")
                    for d in ("gespielt.json", "kinderzeit-verbrauch.json",
                              "listen.json")))
            chk("eine fremde Datei im Bereich geht NICHT mit",
                "server/config/profile/gast/heimlich.json" not in inhalte)
            chk("… wird aber GEMELDET, statt still liegenzubleiben",
                any(u["pfad"] == "server/config/profile/gast/heimlich.json"
                    for u in stand["unbekannt"]))
            chk("der Coverspeicher wird NICHT betreten",
                not any(p.startswith("server/config/coverspeicher")
                        for p in inhalte))
            chk("der Bereich steht NICHT mehr als «nicht eingeordnet» da",
                not any(u["pfad"] == "server/config/profile"
                        for u in stand["unbekannt"]))

            # ── DAS VERZEICHNIS DER KINDER (Befund 07.08.2026).
            #    Es fehlte in HINEIN und landete damit in `unbekannt`. Der
            #    Stand trug jeden Bereich vollstaendig — nur nicht die eine
            #    Datei, die sagt, dass es diese Kinder gibt. Nach dem
            #    Zurueckspielen stand die Box mit dem Gast allein da und die
            #    Ordner der uebrigen lagen unerreichbar daneben.
            chk("das Verzeichnis der Kinder ist im Stand",
                "server/config/profile.json" in inhalte)
            chk("… und steht NICHT mehr als «nicht eingeordnet» da",
                not any(u["pfad"] == "server/config/profile.json"
                        for u in stand["unbekannt"]))

            # ── DIE BRUECKE ist ein VERWEIS und wird als solcher gefuehrt.
            chk("der Verweis am alten Ort geht als Verweis in den Stand",
                stand["verweise"].get("server/config/resume.json")
                == "profile/liam/resume.json")
            chk("… und NICHT als Inhalt (sonst stuende der Bestand zweimal drin)",
                "server/config/resume.json" not in inhalte)
            chk("die WERTE liegen getrennt bereit (fuer --mit-zugangsdaten)",
                {g["wert"] for g in geheim} >= {"DAUERZUGANG", "BCRYPTHASH",
                                                "HAUSSCHLUESSEL", "FERIENWORT"})

            # Die entscheidende Umkehrung: die Box hat den Schluessel noch,
            # das Archiv nicht — nach dem Zurueckspielen muss er DA sein.
            gelesen, inh = stand_oeffnen(archiv)
            konf["mupibox"]["startVolume"] = "99"       # etwas kaputtmachen
            with open(os.path.join(e, "mupiboxconfig.json"), "w") as f:
                json.dump(konf, f, indent=4)
            wiederherstellen(gelesen, inh, trocken=False)
            jetzt = json.load(open(os.path.join(e, "mupiboxconfig.json")))
            chk("zurueckgespielt: die Aenderung ist rueckgaengig",
                jetzt["mupibox"]["startVolume"] == "40")
            chk("zurueckgespielt: der ausgelassene Dauerzugang steht NOCH da",
                jetzt["spotify"]["refreshToken"] == "DAUERZUGANG")
            chk("zurueckgespielt: das Verwaltungspasswort steht NOCH da",
                jetzt["interfacelogin"]["password"] == "BCRYPTHASH")
            chk("zurueckgespielt: Typ blieb Zeichenkette",
                isinstance(jetzt["mupibox"]["startVolume"], str))

            # ── DER BEREICH ZURUECK. Der Weg hinein allein beweist nichts:
            #    bis zum 05.08.2026 haette `ziel()` jeden Unterordner
            #    verworfen — das Archiv haette den Verlauf getragen und ihn
            #    beim Zurueckspielen wortlos uebersprungen. Deshalb wird hier
            #    WIRKLICH geloescht und WIRKLICH nachgesehen.
            verlauf_weg = os.path.join(s, "profile", "liam", "gespielt.json")
            os.remove(verlauf_weg)
            import shutil as _sh
            _sh.rmtree(os.path.join(s, "profile", "gast"))
            wiederherstellen(gelesen, inh, trocken=False)
            chk("zurueckgespielt: Liams Verlauf ist wieder da",
                os.path.exists(verlauf_weg)
                and json.load(open(verlauf_weg))[0]["anzahl"] == 3)
            chk("zurueckgespielt: ein GANZ fehlender Bereich wird neu angelegt",
                os.path.isdir(os.path.join(s, "profile", "gast"))
                and json.load(open(os.path.join(
                    s, "profile", "gast", "gespielt.json")))[0]["anzahl"] == 7)
            chk("zurueckgespielt: auch die eigenen Listen des Kindes",
                json.load(open(os.path.join(
                    s, "profile", "liam", "listen.json")))[0]["name"]
                == "Liste liam")

            # ── UND DAS KIND SELBST. Der Bestand oben ist wertlos, solange
            #    niemand mehr weiss, dass es Liam gibt.
            os.remove(os.path.join(s, "profile.json"))
            wiederherstellen(gelesen, inh, trocken=False)
            verz = json.load(open(os.path.join(s, "profile.json")))
            chk("zurueckgespielt: das Kind steht wieder im Verzeichnis",
                any(p["kennung"] == "liam" and p["name"] == "Liam"
                    for p in verz["profile"]))
            chk("zurueckgespielt: auch seine Figur und wer dran war",
                verz["aktiv"] == "liam"
                and any(p["figur"] == "baer" for p in verz["profile"]))

            # ── DIE BRUECKE UEBERLEBT DAS ZURUECKSPIELEN ALS VERWEIS.
            #    Gegenprobe zum Befund: ein Stand aus der Zeit VOR E18/S3
            #    traegt `server/config/resume.json` als echte Datei. Traefe
            #    sie auf den Verweis dieser Box, ersetzte `os.replace` ihn —
            #    und server.ts schoebe den fremden Inhalt anschliessend ueber
            #    die gemerkten Stellen des aktiven Kindes.
            bruecke = os.path.join(s, "resume.json")
            chk("zurueckgespielt: die Bruecke ist noch ein Verweis",
                os.path.islink(bruecke))
            alt = json.loads(json.dumps(gelesen))
            alt_inh = dict(inh)
            alt_inh["server/config/resume.json"] = b'[{"id":"von-frueher"}]\n'
            alt["dateien"] = alt["dateien"] + [
                {"pfad": "server/config/resume.json", "bytes": 22,
                 "sha256": sha(alt_inh["server/config/resume.json"])}]
            bericht_v = wiederherstellen(alt, alt_inh, trocken=False)
            chk("ein Stand mit einer ECHTEN Datei am Ort der Bruecke "
                "ersetzt den Verweis NICHT", os.path.islink(bruecke))
            chk("… und die gemerkten Stellen des Kindes bleiben unberuehrt",
                json.load(open(os.path.join(
                    s, "profile", "liam", "resume.json")))[0]["id"]
                == "spotify:album:liam")
            chk("… und es steht im Bericht, statt still zu geschehen",
                any("Verweis auf der Box (NICHT ueberschrieben)" in zz
                    for zz in bericht_v))

            # Und die Verweigerung: eine Box, auf der der Schluessel FEHLT,
            # darf nach dem Zurueckspielen nicht ausgesperrt sein.
            konf2 = json.loads(json.dumps(konf))
            del konf2["interfacelogin"]["password"]
            with open(os.path.join(e, "mupiboxconfig.json"), "w") as f:
                json.dump(konf2, f, indent=4)
            verweigert = False
            try:
                wiederherstellen(gelesen, inh, trocken=False)
            except SystemExit:
                verweigert = True
            chk("Anmeldung an + Passwort weder im Stand noch auf der Box "
                "-> NICHT geschrieben", verweigert)

            # ── DIE SPERRE OHNE PIN: aufgeloest, nicht abgelehnt.
            #    Seit die PIN ein Geheimnis ist, kann ein Stand mit
            #    `einstellungssperre=pin` auf eine Box ohne PIN treffen — der
            #    Fall „Karte gestorben, Box neu aufgesetzt". Ein „geht nicht"
            #    waere hier die schlimmere Sackgasse (die Bibliothek bliebe
            #    weg), eine Sperre ohne PIN die andere (die Box kaeme in keine
            #    Einstellung mehr, auch nicht ins WLAN).
            konf3 = json.loads(json.dumps(konf))
            konf3["mupibox"]["startVolume"] = "40"   # das Kaputtgemachte von oben
            konf3["mupibox"]["einstellungssperre"] = "pin"
            with open(os.path.join(e, "mupiboxconfig.json"), "w") as f:
                json.dump(konf3, f, indent=4)
            st_pin, inh_pin, _ = stand_bauen("pin-probe")
            konf4 = json.loads(json.dumps(konf3))
            konf4["mupibox"]["einstellungsPin"] = ""       # frische Box: keine PIN
            with open(os.path.join(e, "mupiboxconfig.json"), "w") as f:
                json.dump(konf4, f, indent=4)
            bericht_pin = wiederherstellen(st_pin, inh_pin, trocken=False)
            nach_pin = json.load(open(os.path.join(e, "mupiboxconfig.json")))
            chk("Sperre «pin» ohne PIN: das Zurueckspielen laeuft trotzdem durch",
                nach_pin["mupibox"]["startVolume"] == "40")
            chk("… die Sperre steht danach auf «aus» statt unbedienbar auf «pin»",
                nach_pin["mupibox"]["einstellungssperre"] == "aus")
            chk("… und der Bericht sagt es laut",
                any("Sperre vor den Einstellungen" in z for z in bericht_pin))
            # Die Gegenprobe: hat die Box eine PIN, bleibt die Sperre stehen.
            konf5 = json.loads(json.dumps(konf3))
            with open(os.path.join(e, "mupiboxconfig.json"), "w") as f:
                json.dump(konf5, f, indent=4)
            wiederherstellen(st_pin, inh_pin, trocken=False)
            nach_pin2 = json.load(open(os.path.join(e, "mupiboxconfig.json")))
            chk("Gegenprobe: mit PIN auf der Box bleibt die Sperre auf «pin»",
                nach_pin2["mupibox"]["einstellungssperre"] == "pin"
                and nach_pin2["mupibox"]["einstellungsPin"] == "PINHASH")
            # Die Lage wieder so hinstellen, wie sie vor diesem Absatz war:
            # konf2 (ohne Verwaltungspasswort) — darauf baut, was danach kommt.
            with open(os.path.join(e, "mupiboxconfig.json"), "w") as f:
                json.dump(konf2, f, indent=4)

            # Trocken schreibt nicht.
            with open(os.path.join(s, "data.json"), "w") as f:
                f.write("[]")
            wiederherstellen(gelesen, inh, trocken=True, trotzdem=True)
            chk("--trocken fasst nichts an", open(os.path.join(s, "data.json")).read() == "[]")

            # ══ DER VERSCHLUESSELTE BEHAELTER (E29/B6) ══════════════════════
            # Ohne gpg laesst sich hier nichts behaupten — dann steht es als
            # UNGEPRUEFT da und faellt NICHT still unter den Tisch.
            with open(os.path.join(s, "data.json"), "w") as f:
                json.dump([{"title": "Bibi"}], f)
            if not gpg_pfad():
                print("  ---   gpg fehlt: der Behaelter konnte NICHT geprueft "
                      "werden (das ist ein Befund, kein bestandener Test)")
            else:
                # Eine eigene Ausgangslage fuer diesen Abschnitt: die
                # Anmeldung steht AUS. Sonst schlaegt beim Zurueckspielen
                # ohne Passwort zu Recht `konfig_pruefen` zu (Anmeldung an +
                # leeres Passwort), und der Test maesse dann jene Wache statt
                # des Behaelters.
                konf_g = {"mupibox": {"audioDevice": "hw:0,0",
                                      "startVolume": "40", "maxVolume": "80",
                                      "mediaCheckTimer": "300"},
                          "interfacelogin": {"state": False,
                                             "password": "BCRYPTHASH"},
                          "spotify": {"clientId": "abc",
                                      "refreshToken": "DAUERZUGANG"}}
                with open(os.path.join(e, "mupiboxconfig.json"), "w") as f:
                    json.dump(konf_g, f, indent=4)
                st_g, inh_g, geheim_g = stand_bauen("mit-zugangsdaten")
                klumpen, kopf = zugangsdaten_behaelter(geheim_g, "richtig")
                st_g["zugangsdaten"] = kopf
                arch_g = os.path.join(tmp, "mit-geheim.tar.gz")
                schreiben(arch_g, st_g, inh_g, klumpen)
                platt = gzip.decompress(open(arch_g, "rb").read())
                chk("mit Behaelter: KEIN Geheimnis im Klartext im Archiv",
                    all(x not in platt for x in
                        (b"DAUERZUGANG", b"BCRYPTHASH", b"HAUSSCHLUESSEL",
                         b"FERIENWORT")))
                chk("mit Behaelter: stand.json nennt die Felder, aber keinen Wert",
                    all("wert" not in f for f in kopf["felder"])
                    and {(f["datei"], f["zeiger"]) for f in kopf["felder"]} ==
                    {("etc/mupibox/mupiboxconfig.json", "/spotify/refreshToken"),
                     ("etc/mupibox/mupiboxconfig.json", "/interfacelogin/password"),
                     ("server/config/wlan.json", "/*/pw")})
                chk("mit Behaelter: BEIDE WLAN-Passwoerter sind drin, nicht nur eins",
                    kopf["stellen"] == 4)
                chk("LIESMICH.txt sagt jetzt, was VERSCHLUESSELT dabei ist",
                    "VERSCHLUESSELT DABEI" in liesmich(st_g)
                    and "Passwort" in liesmich(st_g))
                chk("der Behaelter ist ein AEAD-Paket (gpg erkennt ihn)",
                    ist_aead(behaelter_kopf(klumpen)))
                chk("… und `aead 0` waere KEINS (der Pruefer ist nicht blind)",
                    not ist_aead(":symkey enc packet: version 4, aead 0, s2k 3"))

                st_g2, inh_g2 = stand_oeffnen(arch_g)
                chk("der Behaelter wird beim Oeffnen mitgeprueft (Pruefsumme)",
                    st_g2["zugangsdaten"]["sha256"] == sha(klumpen))
                # UND DIE PRUEFUNG MUSS AUCH ZUSCHLAGEN. Der Behaelter steht
                # nicht in `dateien`; ohne die Handpruefung in stand_oeffnen
                # deckte ihn nur die gzip-Pruefsumme ab, und die hat blinde
                # Flecken (tools/stand-bitdreher-deckung.py).
                st_falsch = json.loads(json.dumps(st_g))
                st_falsch["zugangsdaten"]["sha256"] = "00" * 32
                arch_f = os.path.join(tmp, "behaelter-falsch.tar.gz")
                schreiben(arch_f, st_falsch, inh_g, klumpen)
                gemerkt_fehler = False
                try:
                    stand_oeffnen(arch_f)
                except SystemExit:
                    gemerkt_fehler = True
                chk("… und ein beschaedigter Behaelter faellt dabei AUF",
                    gemerkt_fehler)
                st_ohne = json.loads(json.dumps(st_g))
                arch_o = os.path.join(tmp, "behaelter-fehlt.tar.gz")
                schreiben(arch_o, st_ohne, inh_g)      # Klumpen weggelassen
                gemerkt_fehler = False
                try:
                    stand_oeffnen(arch_o)
                except SystemExit:
                    gemerkt_fehler = True
                chk("… und ein FEHLENDER Behaelter ebenso (kein Traceback)",
                    gemerkt_fehler)

                # Die Box vergisst alles — genau der Ernstfall.
                nackt = json.loads(json.dumps(konf_g))
                nackt["spotify"].pop("refreshToken", None)
                nackt["interfacelogin"].pop("password", None)
                with open(os.path.join(e, "mupiboxconfig.json"), "w") as f:
                    json.dump(nackt, f, indent=4)
                with open(os.path.join(s, "wlan.json"), "w") as f:
                    json.dump([{"category": "wifi", "ssid": "Zuhause"},
                               {"category": "wifi", "ssid": "OhnePasswort"},
                               {"category": "wifi", "ssid": "Ferien"}], f)

                # 1. OHNE Passwort: alles andere kommt, und es wird GESAGT.
                bericht = wiederherstellen(st_g2, inh_g2, trocken=False)
                text = "\n".join(bericht)
                nach = json.load(open(os.path.join(e, "mupiboxconfig.json")))
                chk("ohne Passwort: das Uebrige ist trotzdem da",
                    nach["mupibox"]["startVolume"] == "40")
                chk("ohne Passwort: der Dauerzugang wird NICHT erfunden",
                    "refreshToken" not in nach["spotify"])
                chk("ohne Passwort: der Bericht NENNT die Felder namentlich",
                    "VERSCHLUESSELT" in text and "refreshToken" in text)
                chk("ohne Passwort: der Bericht sagt, wie man sie nachholt",
                    "--mit-zugangsdaten" in text)

                # 2. FALSCHES Passwort: laut scheitern, nichts anfassen.
                laut = False
                try:
                    geheim_aus_stand(arch_g, st_g2, "falsch")
                except SystemExit:
                    laut = True
                chk("falsches Passwort scheitert LAUT (AEAD, kein Unsinn)", laut)
                verdreht = bytearray(klumpen)
                verdreht[len(verdreht) // 2] ^= 0xFF
                laut = False
                try:
                    behaelter_auspacken(bytes(verdreht), "richtig")
                except SystemExit:
                    laut = True
                chk("ein verdrehtes Byte im Behaelter scheitert ebenso laut", laut)

                # 3. MIT Passwort: alles kommt zurueck — an die richtige Stelle.
                auf = geheim_aus_stand(arch_g, st_g2, "richtig")
                bericht = wiederherstellen(st_g2, inh_g2, trocken=False,
                                           geheim=auf)
                nach = json.load(open(os.path.join(e, "mupiboxconfig.json")))
                netze = json.load(open(os.path.join(s, "wlan.json")))
                chk("mit Passwort: der Dauerzugang ist wieder da",
                    nach["spotify"]["refreshToken"] == "DAUERZUGANG")
                chk("mit Passwort: das Verwaltungspasswort ist wieder da",
                    nach["interfacelogin"]["password"] == "BCRYPTHASH")
                chk("mit Passwort: JEDES WLAN-Passwort steht am RICHTIGEN Netz",
                    [n.get("pw") for n in netze] == ["HAUSSCHLUESSEL", None,
                                                     "FERIENWORT"])
                chk("mit Passwort: der Bericht sagt, dass es aus dem Stand kam",
                    "AUS DEM STAND" in "\n".join(bericht))

                # 4. Und der Wert der BOX schlaegt nichts, was im Behaelter
                #    steht — aber er faengt auf, was dort fehlt.
                st_leerbeh, inh_leerbeh = stand_oeffnen(archiv)
                bericht = wiederherstellen(st_leerbeh, inh_leerbeh,
                                           trocken=False)
                chk("ein Stand OHNE Behaelter verhaelt sich wie bisher",
                    "Ausgelassene Schluessel behalten den Wert der Box"
                    in "\n".join(bericht))

                # Aufraeumen fuer die folgenden Tests.
                with open(os.path.join(e, "mupiboxconfig.json"), "w") as f:
                    json.dump(konf, f, indent=4)
                with open(os.path.join(s, "wlan.json"), "w") as f:
                    json.dump(wlan_q, f, indent=4)

            # Dieselbe Lage zweimal -> dieselbe Kennung. Das ist die Vorkehrung
            # gegen den Fehler aus [[aufraeum-sicherung-vor-der-entscheidung]]:
            # folgenlose Staende entstehen gar nicht erst und koennen deshalb
            # auch nichts verdraengen.
            with open(os.path.join(s, "data.json"), "w") as f:
                json.dump([{"title": "Bibi"}], f)
            s1, _, _ = stand_bauen("selbsttest")
            s2, _, _ = stand_bauen("selbsttest")
            chk("gleicher Inhalt -> gleiche Kennung (kein Leerlauf-Stand)",
                s2["inhalt_kennung"] == s1["inhalt_kennung"])
            # UND DIE MESSREIHE DARF DARAN NICHTS AENDERN — sonst legte jeder
            # Anstoss einen Stand an und das Kontingent rollte durch.
            with open(os.path.join(s, "akkuverlauf.json"), "w") as f:
                json.dump([{"t": 2, "v": 7100, "i": -600, "p": 56}], f)
            s1b, i1b, _ = stand_bauen("selbsttest")
            chk("die Messreihe aendert die Kennung NICHT (`--wenn-anders` haelt)",
                s1b["inhalt_kennung"] == s1["inhalt_kennung"])
            chk("… sie ist aber im Stand (der neue Punkt ist mit)",
                b'"t": 2' in i1b["server/config/akkuverlauf.json"]
                or b'"t":2' in i1b["server/config/akkuverlauf.json"])
            with open(os.path.join(s, "data.json"), "w") as f:
                json.dump([{"title": "Benjamin"}], f)
            s3, _, _ = stand_bauen("selbsttest")
            chk("anderer Inhalt -> andere Kennung",
                s3["inhalt_kennung"] != s1["inhalt_kennung"])

            # Eine LEERE Messreihe haelt die Sicherung nicht auf — sie faellt
            # aus DIESEM Stand heraus und wird benannt.
            open(os.path.join(s, "akkuverlauf.json"), "wb").close()
            s5, i5, _ = stand_bauen("selbsttest")
            chk("leere Messreihe: der Stand entsteht trotzdem",
                "server/config/data.json" in i5)
            chk("leere Messreihe: sie ist NICHT im Stand, und es steht da",
                "server/config/akkuverlauf.json" not in i5
                and any(n["pfad"].endswith("akkuverlauf.json")
                        for n in s5["nicht_dabei"]))
            with open(os.path.join(s, "akkuverlauf.json"), "w") as f:
                json.dump([{"t": 1, "v": 7000, "i": -600, "p": 55}], f)

            # Eine unbekannte Datei wird gemeldet, nicht heimlich mitgenommen.
            with open(os.path.join(s, "neuartig.json"), "w") as f:
                f.write("{}")
            s4, i4, _ = stand_bauen("selbsttest")
            chk("unbekannte Datei wird GEMELDET",
                any(u["pfad"].endswith("neuartig.json") for u in s4["unbekannt"]))
            chk("unbekannte Datei wird NICHT mitgesichert",
                "server/config/neuartig.json" not in i4)

            # ── Die Probe (E29/B3), und der Fall, der wirklich zaehlt.
            # Sie laeuft seit mupibox-sicherungsprobe.timer WOECHENTLICH, und
            # ihr Urteil landet als PROBE.txt auf der FAT-Partition — dort
            # liest es jemand OHNE SSH und ohne Python. Also darf ein kaputtes
            # Archiv keinen Traceback erzeugen, sondern muss einen Satz geben.
            # Gemessen mit EINEM verdrehten Byte, so wie es eine muede Karte
            # macht: vorher stand der Traceback in PROBE.txt.
            global STAENDE
            alt_staende = STAENDE
            STAENDE = os.path.join(tmp, "staende")
            os.makedirs(STAENDE, exist_ok=True)
            try:
                gelegt = os.path.join(
                    STAENDE, "mupibox-sicherung-20260805-000000-selbsttest.tar.gz")
                shutil.copy2(archiv, gelegt)
                chk("Probe an einem heilen Stand geht durch",
                    probe(sagen=lambda *_: None) == 0)

                b = bytearray(open(gelegt, "rb").read())
                b[len(b) // 2] ^= 0xFF
                with open(gelegt, "wb") as f:
                    f.write(bytes(b))
                gesagt: list[str] = []
                schlecht = probe(sagen=gesagt.append)
                text = "\n".join(gesagt)
                chk("ein Bit-Dreher im Archiv -> die Probe faellt durch",
                    schlecht == 1)
                chk("… und meldet ihn als SATZ, nicht als Traceback",
                    "laesst sich nicht oeffnen" in text
                    and "Traceback" not in text)
                chk("… und sagt, wie man den naechsten brauchbaren Stand findet",
                    "--pruefen" in text)
                chk("`--pruefen` nennt denselben Stand KAPUTT",
                    pruefen("alle", sagen=lambda *_: None) == 1)

                os.remove(gelegt)
                chk("gar kein Stand -> die Probe meldet das und stuerzt nicht ab",
                    probe(sagen=lambda *_: None) == 1)

                # ── DIE PROBE UND DER BEHAELTER. Sie hat kein Passwort und
                # soll keines haben — pruefen kann sie trotzdem zweierlei:
                # dass der Klumpen noch ein AEAD-Paket ist, und dass es gpg
                # ueberhaupt noch GIBT. Das zweite ist der eigentliche Wert:
                # gnupg ist auf der Box nur angeweht, und faellt es heraus,
                # merkte es sonst erst der Ernstfall.
                if gpg_pfad():
                    gelegt_g = os.path.join(
                        STAENDE,
                        "mupibox-sicherung-20260805-020000-geheim.tar.gz")
                    shutil.copy2(arch_g, gelegt_g)
                    # UND DAVOR EIN JUENGERER STAND OHNE BEHAELTER — genau die
                    # Lage auf einer echten Box: der taegliche Lauf ist immer
                    # juenger als der eine, den jemand von Hand mit Passwort
                    # angelegt hat. Wer nur den juengsten ansieht, prueft die
                    # Verschluesselung NIE und sagt trotzdem BESTANDEN.
                    gelegt_neu = os.path.join(
                        STAENDE,
                        "mupibox-sicherung-20260806-030000-selbsttaetig.tar.gz")
                    shutil.copy2(archiv, gelegt_neu)
                    gesagt = []
                    rc_g = probe(sagen=gesagt.append)
                    text = "\n".join(gesagt)
                    chk("die Probe besteht auch an einem Stand MIT Behaelter",
                        rc_g == 0)
                    chk("… und findet ihn AUCH, wenn ein juengerer Stand "
                        "ohne Behaelter davorliegt",
                        "Zugangsdaten:" in text and "geheim.tar.gz" in text)
                    chk("… und sagt, dass sie ihn nur ansehen, nicht oeffnen kann",
                        "Passwort" in text)
                    # Und der Ausfall, um den es geht: gpg ist weg.
                    alt_which = shutil.which
                    shutil.which = lambda name, *r, **k: (
                        None if name == "gpg" else alt_which(name, *r, **k))
                    try:
                        gesagt = []
                        rc_g = probe(sagen=gesagt.append)
                    finally:
                        shutil.which = alt_which
                    chk("ohne gpg faellt die Probe an so einem Stand DURCH",
                        rc_g == 1)
                    chk("… und nennt die Abhilfe beim Namen",
                        "gnupg" in "\n".join(gesagt))
                    os.remove(gelegt_g)
                    os.remove(gelegt_neu)

                # ── DIE LEERE DATEI. Der Fall, an dem jede Pruefsumme
                # vorbeischaut, weil an einer leeren Datei nichts falsch ist.
                # Gemessen wurde er nicht am Reissbrett: `POST /api/add`
                # schreibt data.json mit `jsonfile.writeFile` auf die
                # ZIELDATEI, und ein gleichzeitiger Leser sah sie in 20,8 %
                # der Versuche mit NULL BYTES
                # (tools/data-json-schreibfenster.sh, 4000 Schreibvorgaenge,
                # echte Groesse). Der ganze Schadensweg steht in
                # tools/sicherung-grenzfaelle.py (G5).
                chk("eine leere Datei wird als solche erkannt",
                    inhalt_klage("server/config/data.json", b"") is not None)
                chk("… ebenso eine, in der nur Leerraum steht",
                    inhalt_klage("server/config/data.json", b"  \n") is not None)
                chk("… ebenso eine halb geschriebene",
                    inhalt_klage("server/config/data.json", b'[{"a": 1') is not None)
                chk("eine heile JSON-Datei wird NICHT beanstandet",
                    inhalt_klage("server/config/data.json", b'[{"a": 1}]') is None)
                chk("bt-adapter ist kein JSON und wird deshalb nicht geprueft",
                    inhalt_klage("etc/mupibox/bt-adapter", b"AA:BB:CC") is None)

                # Und jetzt der ganze Weg: leer erwischt -> KEIN Stand.
                leer_datei = os.path.join(s, "data.json")
                gemerkt = open(leer_datei, "rb").read()
                open(leer_datei, "wb").close()
                vorher_n = len(staende_lesen())
                gesagt = []
                rc = anlegen("im-wimpernschlag", False, False, sagen=gesagt.append)
                chk("data.json leer erwischt -> KEIN Stand, und der "
                    "Rueckgabewert sagt es",
                    rc == 1 and len(staende_lesen()) == vorher_n)
                chk("… und die Meldung nennt die Datei beim Namen",
                    any("data.json" in g for g in gesagt))

                # Ein Stand, der die Leere SCHON traegt (aus der Zeit vor
                # dieser Pruefung), darf nicht mehr eingespielt werden.
                st_leer, inh_leer, _ = stand_bauen("leerer-stand")
                gelegt2 = os.path.join(
                    STAENDE, "mupibox-sicherung-20260805-010000-leer.tar.gz")
                schreiben(gelegt2, st_leer, inh_leer)
                chk("`--pruefen` nennt einen Stand mit leerer Datei NICHT «OK»",
                    pruefen("alle", sagen=lambda *_: None) == 1)
                chk("`--probe` besteht an so einem Stand NICHT mehr",
                    probe(sagen=lambda *_: None) == 1)
                verweigert = False
                try:
                    wiederherstellen(st_leer, inh_leer, trocken=False,
                                     trotzdem=False)
                except SystemExit:
                    verweigert = True
                chk("`--wiederherstellen` schreibt eine leere Datei NICHT",
                    verweigert)
                with open(leer_datei, "wb") as f:
                    f.write(gemerkt)
                os.remove(gelegt2)

                # Die Unruhe: zwei Zeitpunkte in einem Stand. Sie ist KEIN
                # Grund zu verweigern — kein Stand waere schlechter als ein
                # unscharfer —, aber sie muss dranstehen.
                st, inh, geh, klagen, stabil = stand_bauen_stabil(
                    "ruhig", versuche=3, pause=0.001)
                chk("bei ruhiger Lage gilt der Stand als stabil",
                    stabil and not klagen and "unruhig" not in st)
                chk("… und die Werte liegen auch dort getrennt bereit",
                    any(g["wert"] == "DAUERZUGANG" for g in geh))

                # ── DAS PASSWORT DARF NIRGENDS LIEGENBLEIBEN. Die einzige
                # Stelle, an der es in einem Prozess auftaucht, ist der
                # vererbte Dateizeiger — nicht die Befehlszeile.
                chk("das Passwort steht in KEINEM gpg-Argument",
                    not any("pass" in x and "-fd" not in x
                            for x in GPG_GEMEINSAM + GPG_PACKEN))
                chk("der Agent darf es sich nicht merken",
                    "--no-symkey-cache" in GPG_GEMEINSAM)

                # … UND AUCH NICHT IN DER UMGEBUNG DES KINDES. Das war der
                # eine Fund beim Gegenlesen (05.08.2026): die Befehlszeile
                # war sauber, `/proc/<gpg>/environ` nicht. Gemessen wurde es
                # mit tools/e29b6-adversarisch.py Punkt A; hier steht die
                # Regel, damit sie nicht wieder still verlorengeht.
                os.environ[PW_UMGEBUNG] = "NICHT-WEITERREICHEN"
                try:
                    kind = _kind_umgebung("/tmp/heim-gibt-es-nicht")
                finally:
                    os.environ.pop(PW_UMGEBUNG, None)
                chk("das Passwort wird NICHT an gpg weitergereicht "
                    "(/proc/<gpg>/environ)",
                    PW_UMGEBUNG not in kind
                    and "NICHT-WEITERREICHEN" not in kind.values())
                chk("… und die Umgebung des Kindes bleibt sonst brauchbar",
                    kind.get("GNUPGHOME") == "/tmp/heim-gibt-es-nicht"
                    and kind.get("LC_ALL") == "C")
            finally:
                STAENDE = alt_staende
        finally:
            BAEUME = alt_baeume

    # ── Die Spiegelung aufs Netzlaufwerk (E29/B4). Gemessen wird das, was
    #    ohne ein echtes NAS messbar IST: wann sie nichts tut, was sie
    #    kopiert, unter welchem Namen, und was sie NICHT anfasst.
    # STAENDE ist weiter oben in dieser Funktion schon als global erklaert.
    global NAS_JSON, NAS_WURZEL
    alt_json, alt_wurzel, alt_staende = NAS_JSON, NAS_WURZEL, STAENDE
    with tempfile.TemporaryDirectory(prefix="mupibox-nas-") as tmp:
        try:
            NAS_JSON = os.path.join(tmp, "nas.json")
            NAS_WURZEL = tmp                     # es gibt hier kein /mnt
            STAENDE = os.path.join(tmp, "staende")
            freigabe = os.path.join(tmp, "freigabe")
            os.makedirs(STAENDE)
            os.makedirs(freigabe)
            stand = "mupibox-sicherung-20260920-120000-selbsttaetig.tar.gz"
            with open(os.path.join(STAENDE, stand), "wb") as f:
                f.write(b"kein echtes Archiv, aber eine echte Datei")

            still: list[str] = []
            chk("ohne nas.json wird nicht gespiegelt — und es ist kein Fehler",
                aufs_nas(still.append) == 0
                and any("nas.json fehlt" in z for z in still))

            def schreib_konfig(**felder):
                with open(NAS_JSON, "w", encoding="utf-8") as f:
                    json.dump(felder, f)

            still = []
            schreib_konfig(einhaengepunkt=freigabe, spiegeln=False)
            chk("Spiegelung AUS -> nichts passiert, Rueckgabe 0",
                aufs_nas(still.append) == 0
                and not os.path.isdir(os.path.join(freigabe, NAS_ORDNER)))

            still = []
            schreib_konfig(einhaengepunkt="/home/dietpi/MuPiBox", spiegeln=True)
            chk("ein Einhaengepunkt ausserhalb der Wurzel wird abgelehnt",
                aufs_nas(still.append) == 0
                and any("Einhaengepunkt" in z for z in still))

            still = []
            schreib_konfig(einhaengepunkt=freigabe, spiegeln=True)
            ergebnis = aufs_nas(still.append)
            ziel = os.path.join(freigabe, NAS_ORDNER)
            dort = sorted(os.listdir(ziel)) if os.path.isdir(ziel) else []
            chk("ein neuer Stand landet auf der Freigabe", ergebnis == 0 and stand in dort)
            chk("… und KEIN Behelfsname bleibt liegen (E28/N10)",
                not any(".teil-" in d for d in dort))

            # Ein zweiter Lauf darf nichts noch einmal uebertragen.
            still = []
            chk("ein zweiter Lauf kopiert nichts erneut",
                aufs_nas(still.append) == 0
                and not any("aufs Netzlaufwerk" in z for z in still))

            # Was lokal weg ist, faellt auch dort — Fremdes aber nicht.
            fremd = os.path.join(ziel, "urlaubsfotos.zip")
            with open(fremd, "wb") as f:
                f.write(b"gehoert jemand anderem")
            os.remove(os.path.join(STAENDE, stand))
            still = []
            aufs_nas(still.append)
            chk("ein zurueckgezogener Stand faellt auch auf der Freigabe",
                not os.path.exists(os.path.join(ziel, stand)))
            chk("… eine fremde Datei auf derselben Freigabe aber NICHT",
                os.path.exists(fremd))

            # Ziel nicht erreichbar: das IST ein Fehler, und er wird gemeldet.
            still = []
            schreib_konfig(einhaengepunkt=os.path.join(tmp, "gibt-es-nicht"),
                           spiegeln=True)
            chk("ein Einhaengepunkt unter der Wurzel, den es nicht gibt, "
                "legt NICHTS an (kein stiller Rueckfall, E28/N15)",
                aufs_nas(still.append) in (0, 1)
                and not os.path.exists(os.path.join(tmp, "gibt-es-nicht",
                                                    NAS_ORDNER, stand)))
        finally:
            NAS_JSON, NAS_WURZEL, STAENDE = alt_json, alt_wurzel, alt_staende

    print(f"\nSicherung: {ok} bestanden, {bad} fehlgeschlagen")
    return 1 if bad else 0


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(
        description="Sichern und Zurueckspielen der MuPiBox-Konfiguration "
                    "(BACKLOG E29)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__.split("AUFRUF")[-1])
    p.add_argument("--anlegen", action="store_true")
    p.add_argument("--grund", default="von-hand")
    p.add_argument("--wenn-anders", action="store_true",
                   help="nichts anlegen, wenn sich seit dem letzten Stand "
                        "nichts geaendert hat")
    p.add_argument("--behalten", action="store_true",
                   help="diesen Stand anheften — er faellt der Auslese nie zum Opfer")
    p.add_argument("--mit-zugangsdaten", action="store_true",
                   help="beim Anlegen: die Zugangsdaten VERSCHLUESSELT "
                        "mitnehmen (fragt nach einem Passwort und heftet den "
                        "Stand an). Beim Wiederherstellen: sie wieder "
                        "einspielen (fragt nach demselben Passwort).")
    p.add_argument("--liste", action="store_true")
    p.add_argument("--zeigen", metavar="STAND")
    p.add_argument("--pruefen", nargs="?", const="alle", metavar="STAND")
    p.add_argument("--wiederherstellen", metavar="STAND")
    p.add_argument("--trocken", action="store_true")
    p.add_argument("--trotzdem", action="store_true",
                   help="die Pruefungen uebergehen, die eine unbrauchbare Box "
                        "verhindern — nur mit Grund")
    p.add_argument("--probe", action="store_true")
    p.add_argument("--auf-karte", action="store_true")
    p.add_argument("--aufs-nas", action="store_true",
                   help="Staende zusaetzlich auf das Netzlaufwerk (E29/B4)")
    p.add_argument("--von-karte", action="store_true")
    p.add_argument("--ernten", nargs="+", metavar="PFAD")
    p.add_argument("--selbsttest", action="store_true")
    p.add_argument("--json", action="store_true")
    a = p.parse_args(argv[1:])

    if a.selbsttest:
        return selbsttest()
    if a.anlegen:
        return anlegen(a.grund, a.wenn_anders, a.behalten,
                       mit_zugangsdaten=a.mit_zugangsdaten)
    if a.liste:
        return liste(a.json)
    if a.zeigen:
        return zeigen(a.zeigen)
    if a.pruefen:
        return pruefen(a.pruefen)
    if a.probe:
        return probe()
    if a.auf_karte:
        return auf_karte()
    if a.aufs_nas:
        return aufs_nas()
    if a.von_karte:
        return von_karte()
    if a.ernten:
        return ernten(a.ernten)
    if a.wiederherstellen:
        name = stand_waehlen(a.wiederherstellen)
        pfad = os.path.join(STAENDE, name)
        stand, inhalte = stand_oeffnen(pfad)
        # DAS PASSWORT WIRD VOR DEM SCHREIBEN GEFRAGT, NICHT MITTENDRIN. Ein
        # Tippfehler soll eine Absage sein, kein halb zurueckgespielter Baum.
        geheim = None
        if a.mit_zugangsdaten:
            if not (stand.get("zugangsdaten") or {}):
                raise SystemExit(
                    f"{name} traegt gar keine Zugangsdaten — `--liste` zeigt, "
                    f"welcher Stand welche hat. Ohne die Option spielt dieser "
                    f"Stand alles andere zurueck.")
            geheim = geheim_aus_stand(pfad, stand,
                                      passwort_holen("fuer diesen Stand"))
        if a.trocken:
            print("\n".join(wiederherstellen(stand, inhalte, trocken=True,
                                             trotzdem=a.trotzdem,
                                             geheim=geheim)))
            return 0
        with Sperre():
            # Der Rueckweg braucht selbst einen Rueckweg — und der wird auch
            # dann geschrieben, wenn er unvollstaendig ist (Begruendung in
            # von_karte). Gesagt wird es aber.
            j, ij, _, klagen_j, _ = stand_bauen_stabil("vor-wiederherstellung")
            vorher = os.path.join(STAENDE, name_bauen(j, True))
            schreiben(vorher, j, ij)
            print(f"vorher gesichert als {os.path.basename(vorher)}")
            for k in klagen_j:
                print(f"  ACHTUNG, dieser Stand «vorher» ist unvollstaendig: {k}")
            print("\n".join(wiederherstellen(stand, inhalte, trocken=False,
                                             trotzdem=a.trotzdem,
                                             geheim=geheim)))
        return 0
    p.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
