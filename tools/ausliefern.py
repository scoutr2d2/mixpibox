#!/usr/bin/env python3
"""EIN Ausrollweg vom Arbeitsrechner auf die Box — der sichert, statt beiseitezulegen.

WOZU ES DAS GIBT (BACKLOG E29/B5)
Am 05.08.2026 lagen auf der Box 99 beiseite gelegte Dateien, 163 MB. Abgeraeumt.
Binnen weniger Stunden waren es wieder 18 (21,7 MB) — allein aus den
Auslieferungen EINER Nacht. Kein Skript erzeugt sie. Sie entstehen VON HAND:
jede Auslieferung legt `server.js.vor-<stempel>`, `spotify-control.js.vor-<stempel>`,
`www.alt` und `www-admin.alt` an, weil es keinen Weg gibt, der es besser macht.

Dieser Weg macht es besser. Er legt GENAU EINE Rueckdreh-Erzeugung an, unter
einem FESTEN Namen (`….zurueck`), und die naechste Auslieferung ueberschreibt
sie. Aus einer wachsenden Halde wird ein konstanter Rueckweg. Und er stoesst
vor dem Tausch die Sicherung der NUTZERDATEN an
(`mupibox-sicherung.py --anlegen`), statt eine weitere `.vor`-Datei zu erzeugen.

WARUM `src/deploy_on_device.sh` NICHT MEHR TAUGT — vier Gruende, alle am Geraet
nachgesehen (05.08.2026), jeder einzeln toedlich:
  1. `pm2 restart server spotify-control` — auf der Box laeuft KEIN pm2 mehr.
     Beide Dienste kommen aus systemd (mupibox-server.service /
     mupibox-player.service), pm2 hat eine leere Prozessliste.
  2. `mv …/server/config/*.json /tmp/user_data_backup/` — dieses Verzeichnis
     existiert nicht und wird nirgends angelegt. Der erste `mv` scheitert,
     und weil kein `set -e` da ist, laeuft `rm -rf www` TROTZDEM weiter.
     Zusatz: /tmp ist auf dieser Box tmpfs (RAM). Ein Neustart zwischen Hin-
     und Rueckschieben loescht die Konfiguration. Und `active_data.json` /
     `active_resume.json` sind Verweise — verschoben waeren sie kaputt.
  3. `mv …/www/cover` und `…/www/active_theme.css` — beide gibt es in `www`
     nicht mehr. Die Cover liegen in `server/config/coverspeicher`.
  4. `rm -rf www` und DANACH kopieren — genau andersherum als [[ausliefern-regeln]].
Es hat ausserdem ein `read -p` und laeuft damit nie unbeaufsichtigt. Aufgerufen
hat es zuletzt niemand: der einzige Verweis darauf ist ein Kommentar in
`mupictl:87`.

DIE LUECKE BEIM TAUSCH — und warum es sie hier nicht gibt
Zweimal stand der Kiosk nach einer Auslieferung auf einer weissen JSON-Seite
([[mupi-kiosk-haengt-auf-json-nach-deploy]]). Ursache: `mv www www.alt && mv
www.neu www` sind ZWEI Umbenennungen, und dazwischen gibt es `www` nicht. Das
Fenster ist Millisekunden gross — aber die Auslieferung ist der Anlass fuer das
Neuladen, also trifft es sich.
Die bisherige Antwort war, `www` zu einem VERWEIS zu machen. Das ist hier nicht
noetig: ext4 kann ZWEI Verzeichnisse in EINEM Schritt vertauschen
(`renameat2(RENAME_EXCHANGE)`). Am Geraet nachgemessen (05.08.2026, aarch64,
/home/dietpi auf ext4): rc 0, Inhalte getauscht. Es gibt also keinen Augenblick,
in dem `www` fehlt — ohne den Verzeichnisbaum umzubauen, ohne dass `unzip -o`
aus autosetup/update in einen Verweis hineinschreibt.
Ist `www` auf einer Box DOCH ein Verweis, bricht dieser Weg ab statt zu raten.

WAS DIESER WEG NICHT GLAUBT
* NICHT dem Rueckgabewert von `npm run build`. `esbuild` endet mit 0, obwohl es
  nicht schreiben konnte ([[esbuild-schreibfehler-endet-mit-null]]), und die
  WASM-Fassung stuerzt mit „RangeError: Invalid array length" ab, sobald stderr
  auf eine DATEI zeigt — dann bleibt die ALTE `server.js` unberuehrt liegen und
  wuerde ausgeliefert. Deshalb: stderr laeuft hier immer durch eine PIPE (das
  allein verhindert den Absturz), und danach wird der ZEITSTEMPEL jeder
  Bauausgabe geprueft. Ist eine aelter als der Baubeginn, ist Schluss.
* NICHT dem Rueckgabewert von `mupibox-sicherung.py --anlegen`. Der ist in DREI
  Lagen 0, in zweien entsteht nichts (laufende Wiederherstellung; `--wenn-anders`
  ohne Aenderung). Deshalb wird der Stand ueber `--liste --json` NACHGEWIESEN.
* NICHT HTTP 200. Server (8200) und Abspieldienst (5005) antworten auf jeden
  Pfad mit 200. Nachgemessen wird die WIRKUNG: die md5 der ausgelieferten
  Dateien am Geraet, und ob die ausgelieferte Seite den NEUEN `main-*.js`
  nennt (in `GET /`, `GET /admin/` und `GET /api/oberflaeche/stand`).

ABLAUF (jeder Schritt vor dem Tausch bricht ab, ohne etwas angefasst zu haben)
   1 Umgebung: Box erreichbar, Verzeichnisse da, Sicherungswerkzeug da, sudo -n
   2 Bauen (stderr durch eine Pipe), danach Zeitstempel aller vier Ausgaben
   3 Paket lokal schnueren, `node --check`, index.html, Baumhash
   4 Den LAUFENDEN Stand messen und vergleichen — Gleiches wird nicht getauscht
   5 Ins Zwischenlager der Box hochladen (nicht in den Betriebsordner)
   6 Am Geraet pruefen: index.html, `node --check`, md5 gegen den Arbeitsrechner
   7  --probe endet hier: Zwischenlager raeumen, Bericht, nichts getauscht
   8 Sicherung anstossen (bis zu drei Versuche) und ueber --liste NACHWEISEN
   9 Tauschen: Baeume mit RENAME_EXCHANGE, Dateien mit harter Verknuepfung +
     `rename(2)`. Rueckweg unter FESTEM Namen `….zurueck` (genau eine Erzeugung)
     — und unmittelbar danach die STANDWACHE stellen (siehe unten)
  10 Nur die betroffenen Dienste neu starten (systemd, NICHT pm2)
  11 Nachmessen: md5 am Geraet, Dienst laeuft und bleibt laufen, Wirkung ueber HTTP
  12 Zwischenlager raeumen, Altlasten MELDEN (nicht loeschen)

DAS FUENFTE ZIEL: `scripts` (seit 08.08.2026)
Bis dahin kannte dieser Weg vier Ziele, und `scripts/` war keines. Wer eine
Datei unter scripts/ reparierte, hatte sie im BAUM repariert — auf der Box lag
weiter die alte. Gemessen am 08.08.2026: von 91 Skriptdateien waren 10 anders
und 16 gar nicht da, darunter der fehlende Lautstaerke-Boden und die fehlende
Startkarenz. Vier Reparaturen mussten in einer Nacht von Hand kopiert werden.
Es folgt derselben Bauart wie die vier oben — Zwischenlager, Hash, unteilbarer
Tausch, Nachpruefung, EIN Rueckweg unter festem Namen — aber Datei fuer Datei
statt als Baum, und mit vier gemessenen Unterschieden (Begruendung bei ZIELE):
  * kein Tausch des Verzeichnisses: dort liegen auch Dateien aus anderen Wegen,
    ein RENAME_EXCHANGE des Ordners wuerde sie loeschen
  * `rename(2)` statt `cp`: bash liest sein Skript waehrend der Ausfuehrung nach
  * Rechte und Eigentuemer werden AM ZIEL gemessen (dort gemischt dietpi/root)
  * neu gestartet wird nur, was diese Datei ausfuehrt UND jetzt `active` ist
Es steht NICHT in der Vorgabe von --nur und laeuft nur allein.

AUFRUF
    tools/ausliefern.py --probe                # alles pruefen, nichts tauschen
    tools/ausliefern.py                        # bauen, pruefen, tauschen
    tools/ausliefern.py --nur server,player    # nur die zwei Dienste
    tools/ausliefern.py --ohne-bau             # nimmt src/deploy, wie es liegt
    tools/ausliefern.py --erzwingen            # auch tauschen, was gleich ist
    tools/ausliefern.py --zurueckdrehen        # die eine Rueckdreh-Erzeugung zurueck
    tools/ausliefern.py --json                 # Bericht als JSON (fuer Skripte)
    tools/ausliefern.py --nur scripts --probe  # zeigt, WAS es taete, tut nichts
    tools/ausliefern.py --nur scripts          # Skripte auf die Box
    tools/ausliefern.py --nur scripts --zurueckdrehen [--probe]

RUECKGABEWERTE — sprechend, damit ein unbeaufsichtigter Lauf auswertbar ist
    0  fertig (auch: es gab nichts zu tun)
    1  Aufruf oder Umgebung — Box nicht erreichbar, Verzeichnis fehlt
    2  Bau fehlgeschlagen                      — NICHTS angefasst
    3  Pruefung vor dem Tausch fehlgeschlagen  — NICHTS angefasst
    4  Sicherung nicht nachweisbar             — NICHTS angefasst
    5  Tausch fehlgeschlagen                   — teilweise getauscht, Rueckweg liegt
    6  nach dem Tausch: Dienst oder Wirkung nicht in Ordnung
    7  Probelauf hat etwas beanstandet
Ein ABRISS (Zeitueberschreitung, Verbindung weg) meldet den Wert der Phase, in
der er traf — nicht pauschal 1. Beim Gegenlesen am 05.08.2026 meldete ein
Abriss MITTEN IM TAUSCH noch `1`, und `1` sagt oben ausdruecklich „NICHTS
angefasst": ein unbeaufsichtigter Aufrufer waere ueber einen halb getauschten
`www` hinweggelaufen. Jetzt ist es 5 bzw. 6.

DIE STANDWACHE — DER RUECKWEG OHNE MENSCH (seit 10.08.2026)
Bis hierher endete jeder Fehlerfall bei einem Satz: „Zurueck mit:
tools/ausliefern.py --zurueckdrehen". Der Satz setzt jemanden voraus, der ihn
LIEST. Zwei Faelle haben genau den nicht: der Lauf reisst ab (WLAN weg, Deckel
zu, Akku leer) — dann wird nichts mehr gemeldet und nichts mehr gemessen, aber
getauscht ist getauscht. Oder er laeuft nachts, und bis morgens jemand
hinsieht, ist Kindergartenzeit.
Deshalb bekommt die BOX eine Frist, nicht der Arbeitsrechner. Schritt 9 stellt
sie unmittelbar nach dem Tausch und VOR dem Neustart; auf der Box sieht
`mupibox-standwache.py` jede Minute nach und dreht nach Ablauf ohne jedes Zutun
zurueck. Laeuft dieser Weg normal durch, entwarnt Schritt 12 selbst — die Wache
ist der Boden, nicht der Hauptweg. Die ganze Herleitung samt der drei Faelle,
in denen so ein Automat SCHADEN wuerde, steht im Kopf von
`scripts/box/mupibox-standwache.py`.

DER RUECKWEG MISST SICH NACH. `--zurueckdrehen` vergleicht die Hashes vor und
nach dem Vertauschen und meldet 5, wenn sich am Ziel nichts geruehrt hat. Sind
Ziel und Rueckweg DERSELBE Inode (das entsteht, wenn ein Lauf zwischen
`os.link` und `os.replace` abreisst — die Box lag am 05.08.2026 genau so da),
ist das Vertauschen wirkungslos; frueher meldete er dafuer Erfolg.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
BAU = WURZEL / "src" / "deploy"

# ══ KEINE FESTE ADRESSE MEHR (20.09.2026) ════════════════════════════════
#
# HIER STAND `dietpi@192.168.178.169`, und diese Adresse ist seit Wochen TOT
# — das Wissenspaket fuehrt sie ausdruecklich als solche. Wer `ausliefern.py`
# ohne `--box` rief, bekam also eine Zeitueberschreitung und musste selbst
# herausfinden, wohin. Genau die Frage, die der Betreiber nicht mehr stellen
# will: „es gibt immer wieder die frage welche ip".
#
# OHNE `--box` WIRD JETZT GESUCHT (tools/box-finden.py): gemerkter Fund,
# dann die mDNS-Namen, zuletzt ein Suchlauf — und jeder Treffer muss sich an
# `GET /api/box` als MixPiBox AUSWEISEN. Eine falsche Box zu beliefern waere
# schlimmer als gar keine.
BOX_VORGABE = None
APPDIR = "/home/dietpi/.mupibox/Sonos-Kids-Controller-master"
PLAYERDIR = "/home/dietpi/.mupibox/spotifycontroller-main"
LAGER = "/home/dietpi/.mupibox/.ausliefern"
# Was der Skript-Tausch angerichtet hat — damit der Rueckweg nur das zurueck-
# nimmt, was er selbst gab, und nicht fremde Kopien von Hand. Bewusst NICHT in
# einem der Skriptverzeichnisse: dort waere er selbst eine fremde Datei.
MERKZETTEL = "/home/dietpi/.mupibox/.ausliefern-skripte.json"
# Holt den Kiosk-Browser heim: beendet ihn gezielt (pkill -x, nicht -f) und
# stoesst die getty-Kette an, die ihn neu startet. Misst das Wiederkommen
# selbst und endet rot, wenn die Kette nicht uebernimmt.
KIOSK_HEIM = "/usr/local/bin/mupibox/mupi-kiosk-heim.sh"
SICHERUNG = "/usr/local/bin/mupibox/mupibox-sicherung.py"
HTTP_PORT = 8200

# Rueckgabewerte, siehe Kopf.
RC_OK, RC_UMGEBUNG, RC_BAU, RC_PRUEFUNG, RC_SICHERUNG, RC_TAUSCH, RC_NACHHER, RC_PROBE = 0, 1, 2, 3, 4, 5, 6, 7


# ── Die vier Ziele ───────────────────────────────────────────────────────────
#
# ZWEI VERSCHIEDENE ORTE, und das ist die teuerste Falle dieses Projekts:
# server.js liegt bei der Oberflaeche, spotify-control.js in einem EIGENEN
# Ordner — und genau von dort startet der Dienst (WorkingDirectory der Unit).
# Wer es neben server.js legt, aendert eine Datei, die niemand ausfuehrt
# ([[spotify-control-liegt-woanders]]). Am 28.07.2026 blieben so zwei
# Korrekturen wirkungslos, und gesucht wurde stundenlang im Code.
ZIELE: dict[str, dict] = {
    # ── Das sechste Ziel: der Herkunftsstempel ───────────────────────────────
    #
    # WOZU. Die Box liest `herkunft.json` NEBEN server.js (server.ts:3832) und
    # baut darauf die ganze Aktualisierungs-Auskunft: Woher stammt der Code?
    # Wie weit ist er von seiner Quelle weg? Ist der Baum sauber gewesen?
    # Genau daran haengt der Unterschied zwischen "es gibt eine neuere
    # Fassung" und "hier wird gleich dein Fork durch etwas anderes ersetzt".
    #
    # WAS OHNE DIESES ZIEL GESCHAH, und zwar seit es die Seite gibt:
    # geschrieben wird die Datei von src/deploy.sh, ausgeliefert wird sie ueber
    # deploy.zip beim Kartenlauf — und von DIESEM Weg gar nicht (`grep -c
    # herkunft` in dieser Datei war 0). Nach jeder naechtlichen Auslieferung
    # trug die Box also den Stempel des letzten KARTENLAUFS und behauptete
    # damit etwas ueber Code, den es dort laengst nicht mehr gab.
    #
    # SIE STEHT IN DER VORGABE VON `--nur`, anders als `scripts`: Ein Stempel,
    # den man extra anfordern muss, ist beim naechsten Mal wieder falsch.
    "herkunft": {
        "art": "datei",
        "quelle": lambda: BAU / "herkunft.json",
        "ziel": f"{APPDIR}/herkunft.json",
        # KEIN Dienst. Der Server liest die Datei bei jeder Anfrage neu
        # (herkunftLesen() in server.ts) — ein Neustart dafuer waere ein
        # Neustart des Abspielens fuer eine Textzeile.
        "dienst": None,
        "beschreibung": "Herkunftsstempel (herkunft.json)",
    },
    "server": {
        "art": "datei",
        "quelle": lambda: BAU / "server.js",
        "ziel": f"{APPDIR}/server.js",
        "dienst": "mupibox-server.service",
        "beschreibung": "Backend (server.js)",
    },
    "player": {
        "art": "datei",
        "quelle": lambda: BAU / "spotify-control.js",
        "ziel": f"{PLAYERDIR}/spotify-control.js",
        "dienst": "mupibox-player.service",
        "beschreibung": "Abspieldienst (spotify-control.js)",
    },
    # ── Das siebte Ziel: das Plugin-Laufwerk ─────────────────────────────────
    #
    # WOZU. Ein worker_thread braucht eine EIGENE Datei auf der Platte; das
    # Laufwerk darf deshalb nicht in server.js hineingebuendelt werden und ist
    # ein zweiter esbuild-Ausgang. Es liegt NEBEN server.js — plugin-wirt.ts
    # sucht es dort (`path.join(__dirname, 'plugin-laufwerk.js')`).
    #
    # WARUM ES EIN EIGENES ZIEL BRAUCHT UND NICHT „kommt mit server.js": es ist
    # eine getrennte Datei, und dieser Weg tauscht Datei fuer Datei. Ohne
    # diesen Eintrag laege auf der Box eine frische server.js neben einem
    # Laufwerk von gestern — oder gar keinem. Und das faellt NICHT auf: der
    # Server startet tadellos und laedt einfach kein Plugin, mit einer Zeile im
    # Journal. Dieselbe stille Sorte Fehler wie beim fehlenden scripts/-Ziel.
    #
    # DERSELBE DIENST WIE `server`: server.js liest die Datei beim Starten der
    # Worker. `dienste` weiter unten ist eine MENGE — die Unit wird also einmal
    # neu gestartet, auch wenn beide Ziele tauschen.
    "laufwerk": {
        "art": "datei",
        "quelle": lambda: BAU / "plugin-laufwerk.js",
        "ziel": f"{APPDIR}/plugin-laufwerk.js",
        "dienst": "mupibox-server.service",
        "beschreibung": "Plugin-Laufwerk (plugin-laufwerk.js)",
    },
    # ── Die Plugins selbst ───────────────────────────────────────────────────
    #
    # WOZU. Das Laufwerk oben ist der MOTOR; hier liegen die Plugins. Ohne
    # diesen Eintrag kommen sie nur von Hand auf die Box — und genau das ist
    # der Fehler, den dieses Haus schon viermal gefunden hat: etwas liegt
    # fertig auf der Box, funktioniert, und steht in keinem Repo. Die Sicherung
    # (`/api/sicherung`) traegt `server/config` und `etc/mupibox`, NICHT
    # `/home/dietpi/.mupibox/plugins`. Stirbt die Karte, waeren sie weg.
    #
    # QUELLE IST DER BAUM, NICHT `src/deploy`: Plugins werden nicht gebaut. Es
    # sind zwei Dateien je Ordner, so wie sie im Repo liegen.
    #
    # ES IST EIN BAUM-TAUSCH, und das heisst: was auf der Box liegt und NICHT
    # im Repo steht, verschwindet. Das ist Absicht. Die Einstellungen bleiben —
    # sie stehen in `plugin-einstellungen.json` neben der Konfiguration, nicht
    # im Plugin-Ordner. Ein abgeschaltetes Plugin bleibt abgeschaltet.
    #
    # Die `.spec.mjs` kommen mit. Sie stoeren nicht (der Wirt liest nur
    # `plugin.json`) und ersparen die Sonderbehandlung.
    "plugins": {
        "art": "baum",
        "quelle": lambda: WURZEL / "plugins",
        "ziel": "/home/dietpi/.mupibox/plugins",
        "dienst": "mupibox-server.service",
        "beschreibung": "Plugins (plugins/)",
    },
    "www": {
        "art": "baum",
        "quelle": lambda: BAU / "www",
        "ziel": f"{APPDIR}/www",
        "dienst": None,
        "beschreibung": "Box-Oberflaeche (www)",
    },
    "admin": {
        "art": "baum",
        "quelle": lambda: BAU / "www-admin",
        "ziel": f"{APPDIR}/www-admin",
        "dienst": None,
        "beschreibung": "Verwaltung (www-admin)",
    },
    # ── Das fuenfte Ziel: scripts/ ───────────────────────────────────────────
    #
    # WOZU. Bis zum 08.08.2026 kannte dieser Weg vier Ziele, und `scripts/` war
    # keines. Der einzige Weg dorthin war `autosetup.sh` (frische Karte) oder
    # `update/start_mupibox_update.sh` (Update) — beides laeuft nachts nicht.
    # Gemessen am 08.08.2026 (tools/baum-gegen-box.py, sha256 gegen die Box):
    # von 91 Skriptdateien im Baum waren 10 inhaltlich ANDERS und 16 gar nicht
    # da. Alle zehn waren Reparaturen dieser Woche. Vier davon (Startbild,
    # Sicherung, Medien-Einlesen, Knopflicht) mussten VON HAND kopiert werden.
    #
    # SCHLIMMER: die Verwaltung wird JEDE Nacht ausgeliefert und machte
    # Aussagen ueber Schutz, den es auf der Box nicht gab. `mupi-lautstaerke.sh`
    # hat dort in Zeile 129 `[ "$h" -lt 1 ] && h=100` — kein Boden, sondern ein
    # Rueckfall: wer „Hoechste Lautstaerke" auf 0 stellt, WEIL er die Box still
    # haben will, bekommt die LAUTESTE moegliche Box.
    #
    # WARUM DIESES ZIEL ANDERS GEBAUT IST ALS DIE VIER OBEN — die Gruende sind
    # gemessen, nicht vermutet (alle Zahlen vom 08.08.2026 an dieser Box):
    #
    #  1. ES IST KEIN BAUM, DEN MAN TAUSCHT. Unter /usr/local/bin/mupibox lagen
    #     88 Eintraege, aber nur ein Teil kommt aus dem Baum. Fremd sind unter
    #     anderem force-dsi-output.sh, init-alsa-softvol.sh, mupihat-eingang.py
    #     und (in /opt/mupibox-tools) netz-watchdog.py — sie stammen aus anderen
    #     Wegen. Ein RENAME_EXCHANGE des ganzen Verzeichnisses wuerde sie
    #     LOESCHEN. /usr/local/bin traegt zusaetzlich mupi-check, mupi-ton und
    #     bt-wechsel. Deshalb: Datei fuer Datei, jede fuer sich unteilbar.
    #
    #  2. DIE DATEIEN LAUFEN GERADE, und bei bash ist das besonders heikel:
    #     bash liest das Skript WAEHREND der Ausfuehrung nach — nach Byte-Offset
    #     im offenen Deskriptor. Ein `cp` schreibt in DENSELBEN Inode; die
    #     laufende Schleife liest danach an ihrem alten Offset in neuem Text
    #     weiter und fuehrt Bruchstuecke aus. `os.replace` haengt dagegen einen
    #     NEUEN Inode an den Namen; der laufende Prozess behaelt seinen alten
    #     offenen Inode und laeuft SEINE Fassung sauber zu Ende.
    #     Nachgewiesen in tools/skriptweg-sandkasten.py, mit Gegenprobe.
    #     DER PREIS: `rename` ersetzt auch VERWEISE (genau daran ist
    #     remove_max_resume.sh schon einmal teuer geworden — der Tausch kappte
    #     eine Bruecke). Deshalb wird ein Ziel, das ein Verweis ist, NICHT
    #     angefasst, sondern gemeldet. Raten waere hier falsch.
    #
    #  3. RECHTE UND EIGENTUEMER STEHEN NICHT IM BAUM. Im git steht nur das
    #     x-Bit. Auf der Box sind alle Dateien 755, aber der Eigentuemer ist
    #     GEMISCHT: dietpi:dietpi fuer die alten, root:root fuer die spaeter
    #     dazugekommenen (mupi-lautstaerke.sh, librespot-*, telegram_*.py,
    #     mupibox-sicherung.py …). Deshalb wird der Wert AM ZIEL gemessen und
    #     genau so wieder gesetzt — nicht 755/dietpi geraten.
    #
    #  4. NUR DIE BETROFFENEN DIENSTE. Ein getauschtes Skript wirkt erst beim
    #     naechsten Lauf. Welcher Dienst das ist, wird aus dem ExecStart der
    #     Units GEMESSEN (nicht aus einer Tabelle), und neu gestartet wird nur,
    #     was JETZT `active` ist. Ein `inactive` Dienst wird NICHT angestossen —
    #     ihn zu starten waere eine Zustandsaenderung, die niemand bestellt hat,
    #     und mupi_mqtt/mupi_telegram liegen genau so da.
    #
    # NICHT IN DER VORGABE VON --nur. Wer scripts/ ausliefern will, muss es
    # ausdruecklich sagen (`--nur scripts`). Ein naechtlicher Lauf soll nicht
    # ploetzlich 26 Skripte mitschieben.
    "scripts": {
        "art": "skripte",
        "quelle": lambda: WURZEL / "scripts",
        "ziel": "/usr/local/bin/mupibox",   # Leitordner (Platzmessung, Meldung)
        "dienst": None,                      # ergibt sich je Datei aus der Messung
        "beschreibung": "Skripte auf der Box (scripts/ → /usr/local/bin/mupibox, "
                        "/usr/local/bin, /opt/mupibox-tools)",
    },
}

# ── Wohin unter scripts/ was gehoert ─────────────────────────────────────────
#
# ABGELESEN aus autosetup/autosetup.sh:545-593 und update/start_mupibox_update.sh
# :784-809 — und danach an der Box GEGENGEPRUEFT. Diese Tabelle sagt nur, wo eine
# Datei laut Einrichtung hingehoert; WO SIE WIRKLICH LIEGT, entscheidet die
# Messung (siehe `ziel_bestimmen`). Wo beides auseinanderlaeuft, gewinnt die
# Messung und der Unterschied wird gemeldet.
SKRIPT_ORTE = ["/usr/local/bin/mupibox", "/usr/local/bin", "/opt/mupibox-tools"]

SKRIPT_ORDNER = {
    "mupibox": "/usr/local/bin/mupibox",
    "bluetooth": "/usr/local/bin/mupibox",
    "wled": "/usr/local/bin/mupibox",
    "telegram": "/usr/local/bin/mupibox",
    "mupihat": "/usr/local/bin/mupibox",
    "fan": "/usr/local/bin/mupibox",
    "wifi": "/usr/local/bin/mupibox",
    "mqtt": "/usr/local/bin/mupibox",
    "box": "/opt/mupibox-tools",
    # MIXPI: alles Neue dieser Box traegt das Praefix (Betreiber, 21.08.2026).
    # Der ORT bleibt /usr/local/bin/mupibox - dort suchen die Units, und ein
    # zweiter Skriptordner waere eine Stelle mehr, an der etwas verschwindet.
    "mixpi": "/usr/local/bin/mupibox",
}

# Aus scripts/librespot/ gehen NUR diese zwei mit (autosetup.sh:575/576).
SKRIPT_EINZELN = {
    "librespot/librespot-waechter.sh": "/usr/local/bin/mupibox",
    # E42: die zweite Tonmaschine. Die Units dazu (systemd/soloist*) kommen
    # NICHT hier: auf die LAUFENDE Box legt sie scripts/systemd/einrichten.sh,
    # auf frische Karten und per mupibox.de-Update seit dem 22.08.2026 die
    # beiden Schalen-Wege (autosetup.sh, start_mupibox_update.sh). Siehe
    # SKRIPT_AUSSEN.
    "soloist/soloist-start.sh": "/usr/local/bin/mupibox",
    "soloist/soloist-updater.sh": "/usr/local/bin/mupibox",
    # E104: die Anmeldewache — heilt den nach Boot-Fehlanmeldung stummen
    # Soloist (30.08.2026: "login failed" 16 s nach Boot, danach fuer immer
    # unangemeldet bei 16 % CPU; der Schluessel war die ganze Zeit gueltig).
    "soloist/soloist-anmeldewache.sh": "/usr/local/bin/mupibox",
    "librespot/librespot-konto.py": "/usr/local/bin/mupibox",
    # DER ORT STEHT FEST (16.08.2026): /usr/local/bin/mupibox, gestartet von
    # der eigenen Unit mupi_offtrigger.service (bis 29.08.2026 hiess der
    # Handweg-Zwilling mupi_taster; die Familie ist zusammengelegt) - NICHT
    # postboot.d, dort schreibt
    # das Update hinein und niemand merkt, wenn zwei Fassungen laufen.
    # off_trigger.sh erwartet die Wache fest unter diesem Pfad (Zeile 311).
    "OnOffShim/off_trigger.sh": "/usr/local/bin/mupibox",
    "OnOffShim/taster_wache.py": "/usr/local/bin/mupibox",
}

# WAS DIESER WEG AUSDRUECKLICH NICHT TRAEGT — und warum. Es steht hier
# aufgeschrieben statt weggelassen: eine Datei, die stillschweigend fehlt, sieht
# aus wie eine, an die niemand gedacht hat.
SKRIPT_AUSSEN = {
    "systemd/soloist.service":
        "Units legen einrichten.sh (laufende Box) und seit 22.08.2026 die "
        "beiden Schalen-Wege (autosetup/update), nicht dieser Weg.",
    "systemd/soloist-updater.service":
        "Units legen einrichten.sh und die Schalen-Wege.",
    "systemd/mixpi-wlan-adapter.service":
        "Units legt NUR scripts/systemd/einrichten.sh (dort in DIENSTE): "
        "Adapterwahl ist Geraeteausstattung, gehoert nicht auf jede Box.",
    "systemd/soloist-updater.timer":
        "Units legen einrichten.sh und die Schalen-Wege.",
    "systemd/soloist-anmeldewache.service":
        "Units legen einrichten.sh und die Schalen-Wege (E104).",
    "systemd/soloist-anmeldewache.timer":
        "Units legen einrichten.sh und die Schalen-Wege (E104).",
    "systemd/librespot-engine.conf":
        "Drop-In an librespot.service - legen einrichten.sh und die "
        "Schalen-Wege nach /etc/systemd/system/librespot.service.d/engine.conf.",
    "chromium-autostart.sh":
        "gehoert nach /var/lib/dietpi/dietpi-software/installed/ — ausserhalb der "
        "drei gemessenen Orte, und DietPi schreibt dort selbst hinein.",
    "led/led_control.c":
        "wird auf der Box mit gcc zu 'led_control' uebersetzt (autosetup.sh:711). "
        "Eine Quelldatei, die uebersetzt werden muss, ist keine Kopie.",

    "OnOffShim/poweroff.sh":
        "gehoert nach /usr/lib/systemd/system-shutdown/ — Systemverzeichnis.",

    "librespot/librespot-start.sh": "ruft niemand auf (autosetup.sh:555).",
    "librespot/README.md": "Text, kein Skript.",
    "hwdetect/hwdetect.sh": "kein Einrichtungsweg legt es auf die Box.",
    "hwdetect/hat-apply.sh": "kein Einrichtungsweg legt es auf die Box.",
    "online/install_rtl88x2bu.sh": "kein Einrichtungsweg legt es auf die Box.",
    "flash-mupibox-sd.sh": "laeuft am Arbeitsrechner, nicht auf der Box.",
    "make-boot-sd.sh": "laeuft am Arbeitsrechner, nicht auf der Box.",
    "gen-selfsigned-cert.sh": "kein Einrichtungsweg legt es auf die Box.",
}

SKRIPT_UEBERGEHEN = {"__pycache__", "templates"}


def paketname(name: str) -> str:
    """Wie ein Baum im Paket und im Zwischenlager heisst.

    WARUM ES DIESE FUNKTION GIBT: dieselbe Zuordnung stand DREIMAL im Code,
    jedes Mal als `"www" if n == "www" else "www-admin"`. Solange es genau
    zwei Baeume gab, war das richtig. Beim dritten (`plugins`) hiess das
    Paket dann `www-admin` — es wurde also der falsche Ordner eingepackt,
    und der Tauscher meldete am Geraet "Zwischenlager fehlt", ohne dass
    irgendwo ein Tippfehler zu sehen war.

    Die Namen der beiden Oberflaechen bleiben, wie sie sind: sie stammen
    aus dem Bau, nicht aus dem Ziel. Alles andere heisst wie sein
    Zielverzeichnis.
    """
    if name == "www":
        return "www"
    if name == "admin":
        return "www-admin"
    return Path(ZIELE[name]["ziel"]).name


# ── Der Teil, der AUF DER BOX laeuft ─────────────────────────────────────────
#
# Absichtlich hier eingebettet statt als zweite Datei: ein Ausrollweg, dessen
# zwei Haelften auseinanderlaufen koennen, ist genau die Sorte Fehler, die man
# erst am Geraet merkt. Er wird bei jedem Lauf frisch ins Zwischenlager
# geschrieben; auf der Box bleibt davon nichts liegen.
# ══ DER TAUSCHER WOHNT JETZT IN EINER DATEI ═════════════════════════════════
#
# Hier stand er als 646-zeilige Zeichenkette. Das war bequem (eine Datei zum
# Ausliefern) und hatte einen Preis, der erst beim Nachdenken ueber einen
# Rueckweg auffiel:
#
# ER WIRD NACH JEDEM LAUF WEGGERAEUMT (`rm -rf {LAGER}`, weiter unten). Auf
# der Box liegt danach KEIN Programm mehr, das die `.zurueck`-Dateien
# zurueckdrehen koennte. Der Rueckweg existiert also nur, solange ein Laptop
# danebensteht und ihn wieder hochlaedt — genau dann nicht, wenn man ihn
# braucht (nachts, nach einer Auslieferung, die den Server zerlegt hat).
#
# ALS DATEI KANN ER AUF DER BOX WOHNEN: `--nur scripts` legt ihn nach
# /usr/local/bin/mupibox, und von dort kann ihn eine Wache rufen. Der Inhalt
# ist Zeichen fuer Zeichen derselbe wie zuvor (beim Umzug mit sha256
# gegengelesen); dieser Weg laedt ihn weiterhin frisch hoch, damit ein Lauf
# nie von einem alten Stand auf der Box abhaengt.
TAUSCHER = WURZEL / "scripts" / "box" / "mupibox-tauscher.py"
try:
    BOXHELFER = TAUSCHER.read_text(encoding="utf-8")
except OSError as _e:                                    # pragma: no cover
    raise SystemExit(f"Der Tauscher fehlt: {TAUSCHER} ({_e})")


# ── Kleinkram ────────────────────────────────────────────────────────────────

def jetzt() -> str:
    return time.strftime("%Y%m%d-%H%M%S")


class Bericht:
    """Sammelt, was gesagt werden muss — auf dem Schirm sofort, als JSON am Ende."""

    def __init__(self, als_json: bool) -> None:
        self.als_json = als_json
        self.zeilen: list[str] = []
        self.daten: dict = {"schritte": [], "warnungen": [], "fehler": [], "fragen": []}

    def sag(self, text: str = "") -> None:
        self.zeilen.append(text)
        if not self.als_json:
            print(text, flush=True)

    def schritt(self, nr: str, text: str) -> None:
        self.daten["schritte"].append({"schritt": nr, "text": text})
        self.sag(f"[{nr}] {text}")

    def warnung(self, text: str) -> None:
        self.daten["warnungen"].append(text)
        self.sag(f"    ! {text}")

    def fehler(self, text: str) -> None:
        self.daten["fehler"].append(text)
        self.sag(f"    X {text}")

    def frage(self, text: str) -> None:
        """Was dem Betreiber gehoert, wird aufgeschrieben, nicht entschieden."""
        self.daten["fragen"].append(text)
        self.sag(f"    ? {text}")

    def ende(self, rc: int) -> int:
        self.daten["rueckgabe"] = rc
        return rc

    def ausgeben(self) -> None:
        """Die JSON-Ausgabe faellt ERST hier, nach dem Aufraeumen. Frueher schrieb
        `ende()` sie, und alles, was danach im `finally` noch gesagt wurde, ging
        verloren — ausgerechnet die Warnung, dass das Zwischenlager stehen
        blieb, weil der Tausch in der Mitte abriss. Sie fehlte genau dem
        unbeaufsichtigten Aufrufer, der sie braucht."""
        if self.als_json and not getattr(self, "_ausgegeben", False):
            self._ausgegeben = True
            print(json.dumps(self.daten, indent=1, ensure_ascii=False))


def md5_datei(pfad: Path) -> str:
    h = hashlib.md5()
    with open(pfad, "rb") as f:
        for brocken in iter(lambda: f.read(1 << 20), b""):
            h.update(brocken)
    return h.hexdigest()


def baumhash_lokal(wurzel: Path) -> dict:
    """Muss Zeichen fuer Zeichen dasselbe rechnen wie `baumhash` im Boxhelfer —
    sonst meldet der Vergleich einen Unterschied, den es nicht gibt."""
    if not wurzel.is_dir():
        return {"da": False}
    zeilen: list[str] = []
    anzahl = 0
    bytes_ = 0
    for ordner, unter, dateien in os.walk(wurzel):
        unter.sort()
        for d in sorted(dateien):
            p = Path(ordner) / d
            rel = os.path.relpath(p, wurzel)
            if p.is_symlink():
                zeilen.append(rel + " -> " + os.readlink(p))
                continue
            zeilen.append(rel + " " + md5_datei(p))
            anzahl += 1
            bytes_ += p.stat().st_size
    return {
        "da": True,
        "hash": hashlib.md5("\n".join(zeilen).encode()).hexdigest(),
        "dateien": anzahl,
        "bytes": bytes_,
        "index": (wurzel / "index.html").is_file(),
    }


# ── E94-Schutz: die Lautstaerke ueberlebt den Dienst-Neustart ────────────────
# Am 29.08.2026 stand die Box nach dem Neustart der Auslieferung ploetzlich
# auf 100 ("ui das war laut" - der Betreiber sass daneben; env-librespot
# traegt LIBRESPOT_INITIAL_VOLUME=100, BACKLOG E94). Bis die Wurzel gefasst
# ist, gilt: VOR dem Neustart die Master-Lautstaerke lesen, DANACH messen und
# noetigenfalls wiederherstellen - und beide Werte ins Protokoll, damit der
# naechste Vorfall die Wurzel nachweist statt sie zu vermuten.
LAUTSTAERKE_LESEN = ("test -x /usr/local/bin/mupibox/mupi-lautstaerke.sh "
                     "&& /usr/local/bin/mupibox/mupi-lautstaerke.sh get "
                     "|| /usr/bin/amixer -M sget Master")


def _prozent_aus(text: str) -> int | None:
    """Die Zahl aus `get` (blank) ODER aus amixers `[64%]` — sonst None."""
    import re as _re
    m = _re.search(r"\[(\d{1,3})%\]", text) or _re.search(r"^\s*(\d{1,3})\s*$", text, _re.M)
    return int(m.group(1)) if m else None


def lautstaerke_lesen(box) -> int | None:
    p = box.lauf(LAUTSTAERKE_LESEN, zeitlimit=15)
    return _prozent_aus(p.stdout or "") if p.returncode == 0 else None


def lautstaerke_schuetzen(box, b, vorher: int | None) -> None:
    """Nach dem Neustart: messen, protokollieren, noetigenfalls zurueckstellen."""
    if vorher is None:
        b.sag("    Lautstaerke: vor dem Neustart nicht lesbar - kein Schutz moeglich (E94)")
        return
    nachher = lautstaerke_lesen(box)
    if nachher == vorher:
        b.sag(f"    Lautstaerke: {vorher}% - vom Neustart unberuehrt")
        return
    box.lauf("test -x /usr/local/bin/mupibox/mupi-lautstaerke.sh "
             f"&& /usr/local/bin/mupibox/mupi-lautstaerke.sh set {vorher} "
             f"|| /usr/bin/amixer -q -M sset Master {vorher}%", zeitlimit=15)
    danach = lautstaerke_lesen(box)
    b.sag(f"    Lautstaerke: der Neustart stellte {vorher}% auf "
          f"{nachher if nachher is not None else '?'}% - wiederhergestellt auf "
          f"{danach if danach is not None else '?'}% (E94-Nachweis)")


class Box:
    """Alles, was ueber SSH geht. Eine gemeinsame Verbindung (ControlMaster),
    damit ein Lauf nicht an zwanzig Anmeldungen haengt."""

    def __init__(self, ziel: str, arbeitsordner: Path, zeitlimit: int) -> None:
        self.ziel = ziel
        self.host = ziel.split("@")[-1]
        self.zeitlimit = zeitlimit
        self.sock = arbeitsordner / "ssh.sock"
        self.gemeinsam = [
            "-o", "BatchMode=yes",
            "-o", "ConnectTimeout=10",
            "-o", "ControlMaster=auto",
            "-o", f"ControlPath={self.sock}",
            "-o", "ControlPersist=120",
        ]

    def lauf(self, befehl: str, eingabe: str | None = None, zeitlimit: int | None = None):
        return subprocess.run(
            ["ssh", *self.gemeinsam, self.ziel, befehl],
            input=eingabe, capture_output=True, text=True,
            timeout=zeitlimit or self.zeitlimit,
        )

    def hoch(self, ort: Path, dorthin: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["scp", *self.gemeinsam, "-q", str(ort), f"{self.ziel}:{dorthin}"],
            capture_output=True, text=True, timeout=self.zeitlimit,
        )

    def helfer(self, modus: str, auftrag: dict, zeitlimit: int | None = None,
               sudo: bool = False) -> dict:
        # `sudo` ist fuer das Ziel `scripts` noetig und NUR dafuer:
        # /usr/local/bin/mupibox gehoert root (755), dietpi darf dort keine
        # Datei anlegen oder umhaengen. Die vier anderen Ziele liegen unter
        # /home/dietpi und kommen ohne aus — sie bekommen es deshalb auch nicht.
        vorn = "sudo -n " if sudo else ""
        p = self.lauf(f"{vorn}python3 {LAGER}/helfer.py {modus}",
                      eingabe=json.dumps(auftrag), zeitlimit=zeitlimit)
        if p.returncode != 0 or not p.stdout.strip():
            raise RuntimeError(f"Helfer '{modus}' scheiterte (rc={p.returncode}): "
                               f"{(p.stderr or p.stdout).strip()[:600]}")
        return json.loads(p.stdout)

    def zu(self) -> None:
        subprocess.run(["ssh", *self.gemeinsam, "-O", "exit", self.ziel],
                       capture_output=True, text=True)


def http(host: str, pfad: str, zeitlimit: int = 8) -> tuple[int, str]:
    try:
        with urllib.request.urlopen(f"http://{host}:{HTTP_PORT}{pfad}", timeout=zeitlimit) as a:
            return a.status, a.read(200000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except Exception:  # noqa: BLE001
        return 0, ""


# ── Schritt 2: bauen ─────────────────────────────────────────────────────────

def herkunft_stempeln(b: "Bericht") -> bool:
    """`src/deploy/herkunft.json` schreiben — dieselben Felder wie src/deploy.sh.

    WARUM HIER UND NICHT DURCH deploy.sh: `npm run build` ruft deploy.sh nicht
    auf (nachgesehen am 08.08.2026: nach einem vollen Bau lag keine
    herkunft.json in src/deploy). Wer diesen Weg fahrt, baut also, ohne zu
    stempeln — und lieferte den Stempel des letzten Kartenlaufs aus.

    DIE FELDER SIND NICHT FREI GEWAEHLT. server.ts liest sie namentlich
    (Herkunft in aktualisierung.ts), und `eigeneCommits`/`unsauber` sind die
    beiden, an denen das Urteil „eigenbau" haengt. Ein fehlendes Feld macht aus
    einem Eigenbau still eine Box unbekannter Herkunft.

    `unsauber` ZAEHLT OHNE UNVERFOLGTE DATEIEN (`grep -v "^??"`), genau wie in
    deploy.sh: In diesem Baum liegen dauernd Quellbilder und Messwerkzeuge
    herum, die niemanden etwas angehen. Sonst waere jede Auslieferung
    „unsauber" und die Angabe damit wertlos.
    """
    def git(*args: str) -> str:
        try:
            p = subprocess.run(["git", "-C", str(WURZEL), *args],
                               capture_output=True, text=True, timeout=30)
            return p.stdout.strip() if p.returncode == 0 else ""
        except Exception:
            return ""

    version = ""
    try:
        version = json.loads((WURZEL / "package.json").read_text()).get("version", "")
    except Exception:
        pass
    schmutz = [z for z in git("status", "--porcelain").splitlines() if not z.startswith("??")]
    eigene = git("rev-list", "--count", "@{upstream}..HEAD")
    stempel = {
        "quelle": git("remote", "get-url", "origin"),
        "commit": git("rev-parse", "HEAD"),
        "zweig": git("rev-parse", "--abbrev-ref", "HEAD"),
        "version": version,
        "eigeneCommits": int(eigene) if eigene.isdigit() else 0,
        "unsauber": len(schmutz),
        "gebautAm": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    try:
        BAU.mkdir(parents=True, exist_ok=True)
        (BAU / "herkunft.json").write_text(json.dumps(stempel, indent=2) + "\n")
    except OSError as e:
        b.warnung(f"Herkunftsstempel liess sich nicht schreiben: {e}")
        return False
    kurz = (stempel["commit"] or "?")[:8]
    b.sag(f"    Herkunft: {stempel['quelle'] or 'unbekannt'} @ {kurz} ({stempel['zweig']})"
            + (f", {stempel['eigeneCommits']} eigene Commits" if stempel["eigeneCommits"] else "")
            + (f", {stempel['unsauber']} Datei(en) geaendert" if stempel["unsauber"] else ""))
    return True


def bauen(b: Bericht, arbeitsordner: Path) -> bool:
    """Baut und PRUEFT DEN ZEITSTEMPEL. Der Rueckgabewert allein beweist hier gar
    nichts: esbuild endet mit 0, obwohl es nicht schreiben konnte, und die
    WASM-Fassung stuerzt ab, ohne die alte Ausgabe anzufassen. Beides fuehrt zu
    'alte server.js ausgeliefert, Reparatur wirkt angeblich nicht'."""
    erwartet = [BAU / "server.js", BAU / "spotify-control.js",
                # KEIN www/browser/index.html mehr: der Angular-Bau der alten
                # Box-Oberflaeche ist mit E118/1e gefallen; www/ traegt nur
                # noch neu/ aus dem Kopierschritt (erwartet_da unten).
                BAU / "www-admin" / "index.html",
                # Das Plugin-Laufwerk ist der zweite esbuild-Ausgang von
                # backend-api. Es gehoert in die FRISCHE-Liste und nicht nur in
                # die Da-Liste: eine alte Datei neben einer neuen server.js ist
                # genau der Fall, den diese Pruefung verhindern soll.
                BAU / "plugin-laufwerk.js"]
    # Die NEUE Box-Oberflaeche kopiert seit E118/1b tools/newdesign-kopieren.py
    # (unten, nach dem npm-Lauf) — nicht mehr die Angular-Asset-Regel der
    # alten App. Sie liegt deshalb NEBEN browser/ (BAU/www/neu), und
    # paket_schnueren nimmt sie beim Abflachen mit. NUR DA-SEIN wird
    # geprueft, nicht Frische: kopiert wird samt Quell-Zeitstempel
    # (copy2), die Datei ist nach jedem Lauf frisch und traegt trotzdem das
    # Datum ihrer letzten Bearbeitung. In der Frische-Liste oben hat genau
    # diese Zeile am 14.08.2026 zwei Auslieferungen zu Unrecht abgebrochen —
    # der erste eigene Lauf des Checks war seine Gegenprobe.
    erwartet_da = [BAU / "www" / "neu" / "index.html"]

    for versuch in (1, 2):
        beginn = time.time() - 1  # eine Sekunde Luft fuer grobe Zeitstempel
        # stderr laeuft durch eine PIPE, und das ist kein Zufall: zeigt stderr
        # auf eine DATEI, wirft esbuild-wasm 'RangeError: Invalid array length'
        # und schreibt nichts. Am 05.08.2026 nachgemessen, vier Varianten.
        p = subprocess.run(["npm", "run", "build"], cwd=WURZEL,
                           capture_output=True, text=True, timeout=1800)
        log = arbeitsordner / f"bau-{versuch}.log"
        log.write_text((p.stdout or "") + (p.stderr or ""))

        # Die neue Oberflaeche kommt aus dem EIGENEN Kopierschritt (E118/1b),
        # nicht mehr aus dem Angular-Bau. VOR der Da-Pruefung, damit sie das
        # Ergebnis dieses Laufs prueft und nicht einen Altbestand.
        kopie = subprocess.run(
            [sys.executable, str(WURZEL / "tools" / "newdesign-kopieren.py"), str(BAU / "www" / "neu")],
            capture_output=True, text=True, timeout=120)
        if kopie.returncode != 0:
            b.fehler("NewDesign liess sich nicht kopieren: "
                     + (kopie.stdout or kopie.stderr).strip()[:300])
            return False

        veraltet = [d for d in erwartet if not d.exists() or d.stat().st_mtime < beginn]
        veraltet += [d for d in erwartet_da if not d.exists()]
        text = (p.stdout or "") + (p.stderr or "")
        if "Permission denied" in text:
            for zeile in text.splitlines():
                if "Permission denied" in zeile:
                    b.warnung("esbuild konnte etwas nicht schreiben: " + zeile.strip()[:200])
        if "RangeError: Invalid array length" in text:
            b.warnung("esbuild-wasm ist abgestuerzt (RangeError) — obwohl stderr eine Pipe ist.")

        if not veraltet:
            b.sag(f"    Bau {versuch}: rc={p.returncode}, alle {len(erwartet)} Ausgaben frisch. Protokoll: {log}")
            return True

        b.warnung(f"Bau {versuch}: rc={p.returncode}, aber diese Ausgaben sind AELTER als der "
                  f"Baubeginn: {', '.join(str(d.relative_to(WURZEL)) for d in veraltet)}")
        if versuch == 1:
            b.sag("    Noch einmal bauen — genau dafuer ist dieser zweite Anlauf da.")
    b.fehler("Der Bau hat die Ausgaben nicht erneuert. Nichts angefasst.")
    b.fehler("  Verdaechtig: die root-eigene src/backend-api/backend-api.esbuild-meta.json "
             "(esbuild meldet 'Permission denied' und endet trotzdem mit 0).")
    return False


# ── Schritt 3: Paket schnueren ───────────────────────────────────────────────

def paket_schnueren(b: Bericht, arbeitsordner: Path, namen: list[str]) -> dict | None:
    """Legt das Paket so hin, wie es auf der Box liegen muss. Das `browser/` aus
    dem Angular-Bau muss dabei eine Ebene hoch — die Box-Oberflaeche setzt
    outputPath als Zeichenkette, dann schiebt der Builder ein browser/
    dazwischen. Die Verwaltung nutzt die Objektform und liegt schon flach."""
    paket = arbeitsordner / "paket"
    paket.mkdir(exist_ok=True)
    stand: dict = {}

    for name in namen:
        z = ZIELE[name]
        quelle = z["quelle"]()
        if z["art"] == "datei":
            if not quelle.is_file() or quelle.stat().st_size == 0:
                b.fehler(f"{name}: {quelle} fehlt oder ist leer.")
                return None
            ziel = paket / quelle.name
            shutil.copy2(quelle, ziel)
            # JSON ist kein JS-Modul: `node --check` prueft CommonJS-Syntax
            # und faellt ueber jede .json (Unexpected token ':'). Der
            # Herkunftsstempel bekommt deshalb die Pruefung, die zu ihm
            # passt — beide Pruefungen stellen dieselbe Frage: "ist die
            # Datei heil, BEVOR sie auf die Box geht?"
            if ziel.suffix == ".json":
                try:
                    json.loads(ziel.read_text())
                    pruefwort = "json ok"
                except ValueError as e:
                    b.fehler(f"{name}: kein gueltiges JSON: {str(e)[:200]}")
                    return None
            else:
                p = subprocess.run(["node", "--check", str(ziel)], capture_output=True, text=True)
                if p.returncode != 0:
                    b.fehler(f"{name}: node --check schlaegt schon hier fehl: "
                             f"{(p.stderr or p.stdout).strip()[:300]}")
                    return None
                pruefwort = "node --check ok"
            stand[name] = {"da": True, "hash": md5_datei(ziel), "bytes": ziel.stat().st_size}
            b.sag(f"    {name}: {ziel.stat().st_size} B, {pruefwort}, md5 {stand[name]['hash'][:12]}")
        else:
            ziel = paket / paketname(name)
            if ziel.exists():
                shutil.rmtree(ziel)
            if not quelle.is_dir():
                b.fehler(f"{name}: {quelle} fehlt.")
                return None
            browser = quelle / "browser"
            if browser.is_dir():
                # erst alles neben browser/ (3rdpartylicenses.txt,
                # prerendered-routes.json), dann browser/* darueber
                shutil.copytree(quelle, ziel, symlinks=True,
                                ignore=shutil.ignore_patterns("browser"))
                shutil.copytree(browser, ziel, symlinks=True, dirs_exist_ok=True)
            else:
                shutil.copytree(quelle, ziel, symlinks=True)
            # WAS EIN BAUM ENTHALTEN MUSS, haengt davon ab, WAS ER IST. Fuer
            # www und admin ist es `index.html` — fehlt sie, laege dort eine
            # tote Oberflaeche. Ein Plugin-Ordner hat nie eine; seine
            # Entsprechung ist mindestens ein Unterordner mit `plugin.json`,
            # denn genau danach sucht der Wirt.
            if name == "plugins":
                plugins = [u for u in ziel.iterdir() if (u / "plugin.json").is_file()]
                if not plugins:
                    b.fehler(f"{name}: kein einziger Ordner mit plugin.json — der Wirt faende nichts.")
                    return None
                b.sag(f"    {len(plugins)} Plugin(s): {', '.join(sorted(u.name for u in plugins))}")
            else:
                # SEIT E118/1e liegt die EINE Box-Oberflaeche unter www/neu/ —
                # die index.html an der www-WURZEL war die der geloeschten
                # Angular-App. Der erste Ausliefer-Probelauf nach dem Schnitt
                # (05.09.2026, Box .62) ist genau hier stehengeblieben.
                index = ziel / ("neu/index.html" if name == "www" else "index.html")
                if not index.is_file():
                    b.fehler(f"{name}: {index.relative_to(ziel)} fehlt im Paket — das waere eine tote Oberflaeche.")
                    return None
            stand[name] = baumhash_lokal(ziel)
            # NICHT PAUSCHAL "index.html da": bei einem Plugin-Baum gibt es
            # keine, und die Zeile behauptete es trotzdem. Eine Meldung, die
            # etwas Falsches bestaetigt, ist schlimmer als keine — sie
            # beruhigt genau dort, wo man hinsehen sollte.
            hat_index = "index.html da, " if (ziel / "index.html").is_file() else ""
            b.sag(f"    {name}: {stand[name]['dateien']} Dateien, "
                  f"{stand[name]['bytes'] >> 10} KB, {hat_index}"
                  f"Baumhash {stand[name]['hash'][:12]}")
    return stand


def buendelname(index_html: Path) -> str | None:
    """Der `main-*.js` aus der index.html — die Zeichenkette, ueber die sich
    NACH dem Tausch beweisen laesst, dass wirklich der neue Stand ausgeliefert
    wird. Sie ueberlebt das Minifizieren, weil Angular sie in den Dateinamen
    schreibt."""
    try:
        text = index_html.read_text(errors="replace")
    except OSError:
        return None
    import re
    treffer = re.findall(r"main-[A-Za-z0-9]+\.js", text)
    return treffer[0] if treffer else None


# ── Schritt 8: Sicherung ─────────────────────────────────────────────────────

def sicherung_anlegen(b: Bericht, box: Box, grund: str) -> bool:
    """Stoesst die EINE Stelle an, die sichert — statt eine weitere .vor-Datei
    zu erzeugen. Zwei gemessene Eigenheiten bestimmen den Code hier:

    (1) `--anlegen` gibt in DREI Lagen 0 zurueck, in zweien entsteht NICHTS
        (laufende Wiederherstellung; `--wenn-anders` ohne Aenderung). Der
        Rueckgabewert taugt also nicht als Beweis — der Stand wird ueber
        `--liste --json` NACHGEWIESEN.
    (2) Schreibt gerade jemand an data.json, VERWEIGERT die Sicherung (rc=1) —
        richtig so, aber unter Last traf das etwa jeden fuenften Lauf. Deshalb
        drei Versuche.

    NIEMALS `--behalten`: das heftet den Stand an, und angeheftete Staende
    fallen nicht unters Kontingent. Sonst baut ausgerechnet dieses Werkzeug
    dieselbe Halde an einem neuen Ort."""
    # DIE REFERENZUHR IST DIE DER BOX, nicht die des Arbeitsrechners
    # (30.08.2026): `erzeugt` stammt von der Box, und deren Uhr ging heute
    # frueh 17 s nach (NTP war aus, nach dem naechtlichen Stromlos-Sein nie
    # gesynct). Mit `time.time() - 2` vom Arbeitsrechner galt darum KEIN
    # Stand als frisch - drei Versuche, drei Sicherungen, Abbruch vor dem
    # Tausch, und die Meldung zeigte auf die falsche Verdaechtige
    # (Wiederherstellung/data.json). Wer zwei Uhren vergleicht, muss sie
    # von derselben Wand nehmen.
    try:
        beginn = float((box.lauf("date +%s", zeitlimit=15).stdout or "").strip()) - 2
    except ValueError:
        beginn = time.time() - 2
    for versuch in (1, 2, 3):
        p = box.lauf(f"python3 {SICHERUNG} --anlegen --grund {json.dumps(grund)}", zeitlimit=120)
        ausgabe = ((p.stdout or "") + (p.stderr or "")).strip()
        try:
            liste = json.loads(box.lauf(f"python3 {SICHERUNG} --liste --json", zeitlimit=60).stdout or "[]")
        except json.JSONDecodeError:
            liste = []
        frisch = None
        for stand in liste:
            try:
                gebaut = time.mktime(time.strptime(stand["erzeugt"][:19], "%Y-%m-%dT%H:%M:%S"))
            except (KeyError, ValueError):
                continue
            if gebaut >= beginn:
                frisch = stand
                break
        if frisch:
            b.sag(f"    Stand nachgewiesen: {frisch['name']} "
                  f"({frisch.get('dateien')} Dateien, {frisch.get('bytes')} B, "
                  f"{frisch.get('ausgelassen')} Schluessel ausgelassen)")
            return True
        b.warnung(f"Versuch {versuch}: rc={p.returncode}, aber kein frischer Stand in der Liste. "
                  f"Ausgabe: {ausgabe[:200]}")
        time.sleep(3)
    return False


# ── Schritt 11: nachmessen ───────────────────────────────────────────────────

def dienst_zustand(box: Box, dienst: str) -> dict:
    """Als Schluessel=Wert lesen, NICHT ueber `--value` und Zeilenposition:
    systemd gibt die Eigenschaften in seiner eigenen Reihenfolge aus (gemessen:
    NRestarts zuerst, ActiveState an dritter Stelle), und ein leerer Wert
    verschiebt jede Zaehlung."""
    p = box.lauf("systemctl show -p ActiveState -p SubState -p NRestarts "
                 f"-p ExecMainStartTimestampMonotonic {dienst}")
    felder = {}
    for zeile in (p.stdout or "").splitlines():
        if "=" in zeile:
            k, _, v = zeile.partition("=")
            felder[k.strip()] = v.strip()
    return {
        "roh": " ".join(f"{k}={v}" for k, v in sorted(felder.items())),
        "aktiv": felder.get("ActiveState") == "active" and felder.get("SubState") == "running",
        "kennung": (felder.get("NRestarts"), felder.get("ExecMainStartTimestampMonotonic")),
    }


def nachmessen(b: Bericht, box: Box, host: str, getauscht: list[str],
               soll: dict, buendel: dict, mitgenommen: dict | None = None) -> bool:
    """Beweise nur ueber die WIRKUNG. HTTP 200 beweist hier gar nichts: Server
    (8200) und Abspieldienst (5005) antworten auf JEDEN Pfad mit 200."""
    heil = True
    # Was beim Tausch aus dem laufenden Baum uebernommen wurde, steht
    # absichtlich im Baum und nicht im Paket (siehe modus_tauschen) — es darf
    # den Hashvergleich nicht zum Fehlalarm machen.
    mitgenommen = mitgenommen or {}

    # (a) Liegt am Ziel wirklich, was hier gebaut wurde?
    ist = box.helfer("messen", {"ziele": [
        {"name": n, "art": ZIELE[n]["art"], "ziel": ZIELE[n]["ziel"], "ausser": mitgenommen.get(n, [])} for n in getauscht
    ]}, zeitlimit=300)
    for name in getauscht:
        a, s = ist.get(name, {}), soll.get(name, {})
        if a.get("hash") == s.get("hash") and a.get("hash"):
            b.sag(f"    {name}: am Geraet identisch mit dem Bau ({a['hash'][:12]})")
        else:
            b.fehler(f"{name}: am Geraet steht {a.get('hash')}, gebaut wurde {s.get('hash')}")
            heil = False

    # (b) Laufen die Dienste — und BLEIBEN sie laufen? Ein Dienst, der alle
    #     20 s neu startet, meldet zwischendurch 'active'.
    dienste = sorted({ZIELE[n]["dienst"] for n in getauscht if ZIELE[n]["dienst"]})
    if dienste:
        time.sleep(6)
        for d in dienste:
            erst = dienst_zustand(box, d)
            time.sleep(5)
            zweit = dienst_zustand(box, d)
            aktiv = erst["aktiv"] and zweit["aktiv"]
            # Ein Dienst, der alle 20 s neu startet, meldet zwischendurch
            # 'active' — genau so sah der Abspieldienst nach dem Umschalten auf
            # mpv aus. Deshalb zaehlt nicht der Zustand, sondern dass sich
            # Neustartzaehler UND Startzeitpunkt dazwischen NICHT bewegen.
            stabil = erst["kennung"] == zweit["kennung"]
            if aktiv and stabil:
                b.sag(f"    {d}: aktiv und ueber 5 s hinweg stabil ({zweit['roh']})")
            else:
                b.fehler(f"{d}: nicht in Ordnung — vorher [{erst['roh']}] nachher [{zweit['roh']}]")
                p = box.lauf(f"sudo -n journalctl -u {d} -n 25 --no-pager")
                for zeile in (p.stdout or "").strip().splitlines()[-12:]:
                    b.sag("      | " + zeile)
                heil = False

    # (c) Die Wirkung an der Oberflaeche: nennt die ausgelieferte Seite den
    #     NEUEN main-*.js? Das ist die Zeichenkette, die das Minifizieren
    #     ueberlebt — und der Unterschied zwischen '200' und 'es wirkt'.
    for name, pfad in (("www", "/"), ("admin", "/admin/")):
        if name not in getauscht or not buendel.get(name):
            continue
        for _ in range(20):
            code, text = http(host, pfad)
            if code == 200 and buendel[name] in text:
                b.sag(f"    {pfad}: liefert {buendel[name]} aus")
                break
            time.sleep(2)
        else:
            code, text = http(host, pfad)
            b.fehler(f"{pfad}: nennt {buendel[name]} NICHT (HTTP {code}, {len(text)} B)")
            heil = False
    if "www" in getauscht and buendel.get("www"):
        code, text = http(host, "/api/oberflaeche/stand")
        if buendel["www"] in text:
            b.sag(f"    /api/oberflaeche/stand: {text.strip()[:80]} — die Box laedt selbst neu")
        else:
            b.warnung(f"/api/oberflaeche/stand meldet {text.strip()[:80]}, erwartet war {buendel['www']}")
    return heil


# ── Die Standwache stellen ───────────────────────────────────────────────────
#
# WOZU. Bis hierher endete jeder Rueckweg bei einem Satz: „NICHT IN ORDNUNG.
# Zurueck mit: tools/ausliefern.py --zurueckdrehen". Der Satz setzt einen
# Menschen voraus, der ihn liest. Zwei Faelle haben genau den nicht:
#
#   * Der Lauf REISST AB (WLAN weg, Deckel zu, Akku leer). Dann wird nichts
#     mehr gemeldet und nichts mehr gemessen. Getauscht ist trotzdem.
#   * Der Lauf ist NACHTS. Bis morgens jemand hinsieht, ist Kindergartenzeit.
#
# Deshalb bekommt die BOX die Frist, nicht der Arbeitsrechner: dieser Weg
# stellt sie unmittelbar nach dem Tausch — und ZWAR VOR DEM NEUSTART, denn ab
# dem Tausch steht dort ein Stand, den noch niemand gemessen hat.
# `mupibox-standwache.py` sieht dann jede Minute nach und dreht ohne jedes
# Zutun zurueck, falls binnen der Frist niemand beweist, dass es laeuft.
#
# Laeuft dieser Weg normal durch und misst alles heil nach, ENTWARNT er selbst
# (Schritt 11). Die Wache ist der Boden, nicht der Hauptweg.
STANDWACHE = "/opt/mupibox-tools/mupibox-standwache.py"
WACHE_ORT = "/var/lib/mupibox/stand"
WACHE_FRIST_S = 600


def wache_stellen(b: Bericht, box: Box, getauscht: list[str], auftrag_ziele: list[dict],
                  buendel: dict, stempel: str) -> bool:
    """Vor dem Neustart. Gibt zurueck, ob eine Frist wirklich steht."""
    p = box.lauf(f"test -x {STANDWACHE} && echo da")
    if "da" not in (p.stdout or ""):
        b.warnung(f"Die Standwache liegt nicht auf der Box ({STANDWACHE}). Es wird "
                  f"KEINE Frist gestellt — ein abgerissener Lauf bliebe unbemerkt.")
        b.warnung("  Nachholen mit: tools/ausliefern.py --nur scripts")
        return False

    # DIE KENNUNGEN VOR DEM NEUSTART. Ohne sie koennte die Wache 20 s spaeter
    # den ALTEN, noch laufenden Prozess sehen, ihn fuer den neuen halten und
    # entwarnen — und zwei Sekunden darauf startet der Dienst in einen kaputten
    # server.js. Ein Neustart, der noch nicht geschehen ist, darf keinen
    # Freispruch begruenden.
    dienste = sorted({ZIELE[n]["dienst"] for n in getauscht if ZIELE[n]["dienst"]})
    vorher = {d: list(dienst_zustand(box, d)["kennung"]) for d in dienste}

    # WAS DIE WACHE MESSEN SOLL. Nicht HTTP 200 — der Server antwortet auf jeden
    # Pfad mit 200 — sondern der Name des ausgelieferten Buendels.
    wirkung = []
    if "www" in getauscht and buendel.get("www"):
        wirkung.append({"pfad": "/", "hat": buendel["www"]})
    if "admin" in getauscht and buendel.get("admin"):
        wirkung.append({"pfad": "/admin/", "hat": buendel["admin"]})
    if "server" in getauscht:
        # Hier zaehlt nur, DASS geantwortet wird: faellt server.js aus, kommt
        # gar keine Antwort mehr, und genau das ist der Fall, gegen den die
        # Frist steht.
        wirkung.append({"pfad": "/api/oberflaeche/stand", "hat": ""})

    auftrag = {
        "von": f"ausliefern.py auf {os.uname().nodename}",
        "stempel": stempel,
        "frist_s": WACHE_FRIST_S,
        "ziele": [z for z in auftrag_ziele if z["name"] in getauscht],
        "dienste": dienste,
        "dienste_vorher": vorher,
        "wirkung": wirkung,
    }

    # DER TAUSCHER ZIEHT MIT. Das Zwischenlager wird nach jedem Lauf geraeumt
    # (`rm -rf {LAGER}` im finally) — der Tauscher laege danach nur noch unter
    # /opt/mupibox-tools, und ausgerechnet der koennte gerade selbst ersetzt
    # werden. Die gestellte Frist traegt deshalb IHRE Fassung bei sich: genau
    # die, die eben getauscht hat.
    p = box.lauf(f"sudo -n install -d -m 755 -o root -g root {WACHE_ORT} && "
                 f"sudo -n install -m 755 -o root -g root {LAGER}/helfer.py "
                 f"{WACHE_ORT}/tauscher.py")
    if p.returncode != 0:
        b.warnung(f"Der Tauscher liess sich nicht neben die Frist legen: "
                  f"{(p.stderr or p.stdout).strip()[:200]}")
        b.warnung(f"  Die Wache faellt dann auf {STANDWACHE.rsplit('/', 1)[0]}"
                  f"/mupibox-tauscher.py zurueck.")

    p = box.lauf(f"sudo -n {STANDWACHE} --stellen", eingabe=json.dumps(auftrag),
                 zeitlimit=60)
    if p.returncode != 0:
        b.warnung(f"Die Frist liess sich nicht stellen: "
                  f"{(p.stderr or p.stdout).strip()[:300]}")
        return False
    try:
        antwort = json.loads(p.stdout)
    except ValueError:
        antwort = {"frist_bis": "?"}
    b.sag(f"    Standwache gestellt bis {antwort.get('frist_bis')} — laeuft sie ab, "
          f"ohne dass jemand nachmisst, dreht die BOX von selbst zurueck.")

    # EINE FRIST, DIE NIEMAND ABWARTET, IST SCHLIMMER ALS KEINE: man verlaesst
    # sich darauf. Also wird nachgesehen, ob der Zeitgeber wirklich laeuft.
    p = box.lauf("systemctl is-active mupibox-standwache.timer")
    if (p.stdout or "").strip() != "active":
        b.warnung("ABER: mupibox-standwache.timer laeuft NICHT — die Frist wuerde "
                  "nie ablaufen, weil niemand nachsieht.")
        b.warnung("  Einschalten mit: sudo systemctl enable --now mupibox-standwache.timer")
        return False
    return True


def wache_entwarnen(b: Bericht, box: Box) -> None:
    """Nachgemessen und heil — die Frist entfaellt. Der Rueckweg unter
    ….zurueck bleibt liegen; entwarnen heisst nicht wegwerfen."""
    p = box.lauf(f"sudo -n {STANDWACHE} --entwarnen", zeitlimit=60)
    if p.returncode == 0:
        b.sag("    Standwache entwarnt (nachgemessen, es laeuft).")
    else:
        b.warnung(f"Die Standwache liess sich nicht entwarnen: "
                  f"{(p.stderr or p.stdout).strip()[:200]}")
        b.warnung("  Sie dreht dann nach Ablauf der Frist zurueck, obwohl alles "
                  "in Ordnung ist. Von Hand: "
                  f"ssh <box> sudo {STANDWACHE} --entwarnen")


def altlasten_melden(b: Bericht, box: Box) -> None:
    """MELDEN, nicht loeschen. Was hier liegt, sind die Rueckwege von Hand aus
    der Zeit vor diesem Werkzeug — sie wegzuraeumen ist eine Entscheidung des
    Betreibers, nicht die eines Ausrollwegs."""
    p = box.lauf(
        f"for d in {APPDIR} {PLAYERDIR}; do "
        f"ls -d $d/*.vor* $d/*.alt $d/*.kaputt $d/*.rel $d/*.f1-fassung-* 2>/dev/null; done")
    # Die gefaehrlichste Altlast ist keine .vor-Datei, sondern eine Kopie am
    # FALSCHEN Ort: neben server.js liegt eine spotify-control.js, die NIEMAND
    # ausfuehrt (der Dienst startet aus spotifycontroller-main). Wer sie
    # aendert, aendert nichts — genau so blieben am 28.07.2026 zwei
    # Korrekturen wirkungslos [[spotify-control-liegt-woanders]].
    q = box.lauf(f"test -f {APPDIR}/spotify-control.js && "
                 f"md5sum {APPDIR}/spotify-control.js {PLAYERDIR}/spotify-control.js")
    zeilen = (q.stdout or "").split()
    if len(zeilen) >= 3:
        gleich = zeilen[0] == zeilen[2]
        b.warnung(f"{APPDIR}/spotify-control.js liegt am FALSCHEN Ort und wird von "
                  f"niemandem ausgefuehrt ({'gleicher' if gleich else 'ANDERER'} Inhalt "
                  f"als der laufende). Wer dort etwas aendert, aendert nichts.")

    funde = [z for z in (p.stdout or "").strip().splitlines() if z]
    if not funde:
        return
    g = box.lauf("du -sc " + " ".join(f"'{f}'" for f in funde) + " 2>/dev/null | tail -1")
    summe = (g.stdout or "").split()[0] if (g.stdout or "").split() else "?"
    b.warnung(f"{len(funde)} Altstaende aus der Zeit von Hand liegen noch da ({summe} KB):")
    for f in funde:
        b.sag("      " + f)
    b.frage("Sollen diese Altstaende weg? Dieser Weg loescht sie NICHT von selbst — "
            "sie sind die Rueckwege von frueher. Wegraeumen tut sie "
            "tools/mixpi-box-altlasten.py (erst ohne, dann mit --wirklich).")


# ── Das Ziel `scripts`: der Weg fuer Datei-fuer-Datei ────────────────────────

def sha256_datei(pfad: Path) -> str:
    h = hashlib.sha256()
    with open(pfad, "rb") as f:
        for brocken in iter(lambda: f.read(1 << 20), b""):
            h.update(brocken)
    return h.hexdigest()


def skript_kandidaten() -> tuple[list[dict], list[tuple[str, str]]]:
    """Welche Datei unter scripts/ gehoert wohin — und welche gehoert NICHT
    hierher. Beide Listen werden gemeldet; eine Datei, die stillschweigend
    fehlt, sieht aus wie eine, an die niemand gedacht hat."""
    wurzel = WURZEL / "scripts"
    dabei: list[dict] = []
    aussen: list[tuple[str, str]] = []
    for p in sorted(wurzel.rglob("*")):
        if not p.is_file() or p.is_symlink():
            continue
        rel = p.relative_to(wurzel).as_posix()
        if any(t in SKRIPT_UEBERGEHEN for t in p.relative_to(wurzel).parts):
            continue
        if p.suffix == ".pyc":
            continue
        if rel in SKRIPT_AUSSEN:
            aussen.append((rel, SKRIPT_AUSSEN[rel]))
            continue
        if rel in SKRIPT_EINZELN:
            dabei.append({"rel": rel, "name": p.name, "quelle": p,
                          "kanon": SKRIPT_EINZELN[rel] + "/" + p.name})
            continue
        teile = p.relative_to(wurzel).parts
        ordner = teile[0] if len(teile) > 1 else ""
        if ordner in SKRIPT_ORDNER:
            dabei.append({"rel": rel, "name": p.name, "quelle": p,
                          "kanon": SKRIPT_ORDNER[ordner] + "/" + p.name})
        else:
            aussen.append((rel, "kein Eintrag in SKRIPT_ORDNER/SKRIPT_EINZELN/"
                                "SKRIPT_AUSSEN — neu im Baum? Dann hier eintragen."))
    return dabei, aussen


def ziel_bestimmen(k: dict, funde: list[dict], units: list[dict]) -> dict:
    """WO LIEGT DIE DATEI WIRKLICH — und darf sie angefasst werden?

    Die Reihenfolge ist die ganze Entscheidung:
      1. Nennt eine Unit einen Pfad mit diesem Namen, GEWINNT DIESER PFAD.
         Was ausgefuehrt wird, ist die Wahrheit; die Tabelle ist nur eine
         Absicht. Weicht sie ab, wird das gemeldet — es ist derselbe Fehler
         wie 'spotify-control liegt woanders', und der hat schon einmal zwei
         Korrekturen wirkungslos gemacht.
      2. Sonst: liegt sie an GENAU EINEM der drei Orte, ist es dieser.
      3. Liegt sie an MEHREREN, wird nichts getan. Welche der Kopien laeuft,
         weiss dieser Weg nicht — und die falsche zu aendern aendert nichts.
      4. Liegt sie nirgends, ist sie NEU. Dann gibt es keine gemessenen Rechte,
         nur geratene — deshalb nur mit --auch-neue.
    """
    e: dict = {"rel": k["rel"], "name": k["name"], "kanon": k["kanon"]}
    echte = [f for f in funde]
    unit_pfade = sorted({p for u in units for p in u["pfade"]
                         if os.path.basename(p) == k["name"]})

    # ══ DIE UNIT ZUERST — SIE IST DER GRUND, WARUM ES REGEL 1 GIBT ═════════
    #
    # Hier stand die Mehrfach-Pruefung VOR der Unit-Abfrage und brach mit
    # `return` ab. Der Code widersprach damit seinem eigenen Kopftext: „Nennt
    # eine Unit einen Pfad mit diesem Namen, GEWINNT DIESER PFAD." Genau im
    # Fall, fuer den diese Regel gemacht ist — die Datei liegt mehrfach —, kam
    # sie nie zum Zug.
    #
    # GEMESSEN AM 11.08.2026 auf der frisch aufgesetzten Box: Das Startbild lag
    # an ZWEI Orten (/usr/local/bin/ und /usr/local/bin/mupibox/), und
    # `mupibox-boot-splash.service` nannte unmissverstaendlich den ersten.
    # ausliefern.py verweigerte trotzdem mit „welcher laeuft, weiss dieser Weg
    # nicht" — obwohl die Antwort in der Unit stand, die es selbst schon
    # eingelesen hatte.
    #
    # MEHRDEUTIG BLEIBT MEHRDEUTIG, wenn KEINE Unit entscheidet oder wenn
    # mehrere Units verschiedene Pfade nennen. Dann ist die Verweigerung
    # richtig: es gibt keine Wahrheit, nur zwei Kandidaten.
    if len(unit_pfade) == 1:
        e["ziel"] = unit_pfade[0]
        if len(echte) > 1:
            # Die anderen Kopien bleiben liegen — und das gehoert gesagt.
            # Wer sie spaeter bearbeitet, aendert nichts, und genau dieser
            # Irrtum hat hier schon einmal zwei Korrekturen verschluckt.
            e["schlaefer"] = [f["pfad"] for f in echte if f["pfad"] != e["ziel"]]
        if e["ziel"] != k["kanon"]:
            e["abweichender_ort"] = True
    elif len(unit_pfade) > 1:
        e["lage"] = "mehrdeutig"
        e["orte"] = unit_pfade
        return e
    elif len(echte) > 1:
        e["lage"] = "mehrdeutig"
        e["orte"] = [f["pfad"] for f in echte]
        return e
    elif echte:
        e["ziel"] = echte[0]["pfad"]
        if e["ziel"] != k["kanon"]:
            e["abweichender_ort"] = True
    else:
        e["ziel"] = k["kanon"]
        e["lage"] = "neu"
        return e

    fund = next((f for f in echte if f["pfad"] == e["ziel"]), None)
    if fund is None:
        # Die Unit nennt einen Pfad, an dem gar nichts liegt.
        e["lage"] = "neu"
        return e
    if fund.get("verweis"):
        e["lage"] = "verweis"
        e["zeigt_auf"] = fund.get("zeigt_auf")
        return e
    if fund.get("nlink_fremd", 0) > 0:
        e["lage"] = "verknuepft"
        e["nlink"] = fund["nlink"]
        return e
    e["modus"], e["uid"], e["gid"] = fund["modus"], fund["uid"], fund["gid"]
    e["rechte"] = f"{fund['modus']} {fund['nutzer']}:{fund['gruppe']}"
    e["sha_box"] = fund["sha"]
    e["lage"] = "gleich" if fund["sha"] == k["sha"] else "anders"
    return e


def skript_dienste(ziel: str, units: list[dict]) -> list[dict]:
    """Welche Units fuehren GENAU DIESE Datei aus. Gemessen, nicht getippt."""
    return [u for u in units if ziel in u["pfade"]]


def skripte_lauf(b: Bericht, box: Box, a, arbeitsordner: Path,
                 stand: dict, raeumen: dict) -> int:
    """Derselbe Ablauf wie oben — Zwischenlager, Hash, unteilbarer Tausch,
    Nachpruefung, Rueckweg — nur ohne Bau (es gibt nichts zu uebersetzen) und
    ohne HTTP-Wirkung (kein Skript beantwortet Anfragen)."""

    # ── 2/9 Was der Baum anbietet ────────────────────────────────────────────
    b.schritt("2/9", "Kandidaten aus dem Baum bilden")
    kandidaten, aussen = skript_kandidaten()
    for k in kandidaten:
        k["sha"] = sha256_datei(k["quelle"])
    b.sag(f"    {len(kandidaten)} Dateien mit einem Ort, {len(aussen)} ohne.")
    for rel, grund in aussen:
        b.sag(f"      ausserhalb: {rel} — {grund}")

    # ── 3/9 Wie es an der Box aussieht ───────────────────────────────────────
    b.schritt("3/9", "Lage an der Box messen (Ort, Rechte, Eigentuemer, ausfuehrende Dienste)")
    lage = box.helfer("skripte_lage",
                      {"orte": SKRIPT_ORTE, "namen": sorted({k["name"] for k in kandidaten})},
                      zeitlimit=300, sudo=True)
    fehlende_orte = [o for o, da in lage["orte_da"].items() if not da]
    if fehlende_orte:
        b.fehler(f"Diese Zielorte gibt es auf der Box nicht: {fehlende_orte}")
        return b.ende(RC_UMGEBUNG)
    units = lage["units"]
    # OHNE DIESE SCHRANKE WAERE DIE MESSUNG STILL FALSCH GEWESEN. Am 08.08.2026
    # brach `systemctl show` an einer Vorlage ab; statt 213 Units kamen 5 an,
    # und der Bericht sagte fuer JEDE Datei „kein Dienst — wirkt beim naechsten
    # Aufruf". Das ist kein Fehler, den man sieht: es ist eine plausible
    # Auskunft. Genau die haette dazu gefuehrt, dass touch-bridge.py und
    # check_network.sh getauscht und ihre Dienste NICHT neu gestartet werden.
    erwartet, gelesen = lage.get("units_erwartet", 0), lage.get("units_gelesen", 0)
    if erwartet and gelesen < erwartet * 0.8:
        b.fehler(f"Die Dienst-Zuordnung ist unvollstaendig: {gelesen} von {erwartet} "
                 f"Units gelesen. Dann liesse sich nicht sagen, was neu starten muss — "
                 f"und 'kein Dienst' sieht aus wie eine Antwort. Abbruch, nichts angefasst.")
        return b.ende(RC_UMGEBUNG)
    b.sag(f"    {gelesen} von {erwartet} Units gelesen, {lage['frei_bytes'] >> 20} MB frei, "
          f"Helfer laeuft als uid {lage['als']}.")

    einteilung = [ziel_bestimmen(k, lage["lage"].get(k["name"], []), units) for k in kandidaten]
    nach_lage: dict[str, list[dict]] = {}
    for e in einteilung:
        nach_lage.setdefault(e["lage"], []).append(e)

    # ── 4/9 Einteilen ────────────────────────────────────────────────────────
    b.schritt("4/9", "Einteilen: was ist gleich, was anders, was darf nicht angefasst werden")
    b.sag(f"    gleich       {len(nach_lage.get('gleich', [])):3d}")
    b.sag(f"    ANDERS       {len(nach_lage.get('anders', [])):3d}  <- im Baum repariert, auf der Box alt")
    b.sag(f"    NEU          {len(nach_lage.get('neu', [])):3d}  <- liegt dort noch gar nicht")
    b.sag(f"    verweigert   {len(nach_lage.get('verweis', [])) + len(nach_lage.get('mehrdeutig', [])) + len(nach_lage.get('verknuepft', [])):3d}")
    b.sag("")

    for e in nach_lage.get("anders", []):
        dienste = skript_dienste(e["ziel"], units)
        wer = ", ".join(f"{u['unit']} [{u['aktiv']}]" for u in dienste) or "kein Dienst — wirkt beim naechsten Aufruf"
        b.sag(f"    ANDERS  {e['rel']:44s} -> {e['ziel']}")
        b.sag(f"            Rechte am Ziel: {e['rechte']} · {wer}")

    # WO EINE DATEI LAEUFT UND WO DIE EINRICHTUNG SIE HINLEGT, kann
    # auseinanderlaufen — und das ist die teuerste Falle dieses Projekts
    # ("spotify-control liegt woanders"). Die Meldung hing bisher IM ANDERS-Zweig
    # und schwieg deshalb genau dann, wenn der Inhalt zufaellig noch passte. Auf
    # dieser Box ist das mupibox-boot-splash.py: die Unit nennt
    # /usr/local/bin/, die Tabelle /usr/local/bin/mupibox/, der Inhalt ist
    # gleich — und niemand erfuhr davon. Beim naechsten Mal waere er es nicht
    # mehr. Eine Abweichung des ORTES haengt nicht am Inhalt.
    for e in einteilung:
        if e.get("schlaefer"):
            b.warnung(f"{e['name']}: liegt ausserdem unter {e['schlaefer']}. "
                      f"Ausgeliefert wird nach {e['ziel']} — das nennt die Unit. "
                      f"Die andere Kopie fuehrt niemand aus; wer sie aendert, aendert nichts.")
        if e.get("abweichender_ort"):
            b.warnung(f"{e['name']} [{e['lage']}]: laeuft aus {e['ziel']}, die "
                      f"Einrichtung sieht {e['kanon']} vor. Ausgeliefert wird dorthin, "
                      f"wo es LAEUFT — eine Datei am anderen Ort fuehrt niemand aus.")
    for e in nach_lage.get("neu", []):
        b.sag(f"    NEU     {e['rel']:44s} -> {e['ziel']} (noch nicht da)")
    for e in nach_lage.get("verweis", []):
        b.fehler(f"{e['rel']}: {e['ziel']} ist ein VERWEIS auf {e.get('zeigt_auf')}. "
                 f"Ein rename wuerde den Verweis ersetzen statt sein Ziel — genau so "
                 f"kappte remove_max_resume.sh schon einmal eine Bruecke. Von Hand entscheiden.")
    for e in nach_lage.get("verknuepft", []):
        b.fehler(f"{e['rel']}: {e['ziel']} haengt an {e['nlink']} Namen (harte Verknuepfung). "
                 f"Nach einem rename traegt der andere Name weiter den ALTEN Inhalt. "
                 f"Von Hand entscheiden.")
    for e in nach_lage.get("mehrdeutig", []):
        b.fehler(f"{e['rel']}: liegt an mehreren Orten {e['orte']} — welcher laeuft, "
                 f"weiss dieser Weg nicht. Die falsche zu aendern aendert nichts.")

    verweigert = (nach_lage.get("verweis", []) + nach_lage.get("verknuepft", [])
                  + nach_lage.get("mehrdeutig", []))
    zu_tun = list(nach_lage.get("anders", []))
    if a.auch_neue:
        for e in nach_lage.get("neu", []):
            # Kein gemessener Wert vorhanden — also der Wert, der an diesem Ort
            # ueberall gilt (gemessen: alle Dateien 755). Der Eigentuemer wird
            # vom Verzeichnis genommen, nicht geraten.
            e["modus"] = "0755"
            e["uid"], e["gid"] = 0, 0
            e["rechte"] = "0755 root:root (geraten — es gab nichts zu messen)"
            zu_tun.append(e)
    elif nach_lage.get("neu"):
        b.frage(f"{len(nach_lage['neu'])} Dateien liegen auf der Box noch gar nicht. "
                f"Fuer sie gibt es keine gemessenen Rechte, nur geratene — deshalb "
                f"bleiben sie liegen. Mit --auch-neue gehen sie als 0755 root:root mit.")

    if not zu_tun:
        b.sag("")
        b.sag("Nichts zu tun: die Box traegt bereits genau diese Skripte.")
        return b.ende(RC_PROBE if verweigert else RC_OK)

    # ── 5/9 Hochladen ────────────────────────────────────────────────────────
    b.schritt("5/9", f"Ins Zwischenlager hochladen ({LAGER}/skripte) — die Betriebsorte bleiben unberuehrt")
    lager_lokal = arbeitsordner / "skripte"
    lager_lokal.mkdir(exist_ok=True)
    nach_rel = {k["rel"]: k for k in kandidaten}
    for e in zu_tun:
        k = nach_rel[e["rel"]]
        # Unter dem NAMEN am Ziel ablegen, nicht unter dem Baumpfad: so ist im
        # Lager auf einen Blick zu sehen, was wohin geht.
        shutil.copyfile(k["quelle"], lager_lokal / e["name"])
        e["sha"] = k["sha"]
    tar = arbeitsordner / "skripte.tgz"
    subprocess.run(["tar", "czf", str(tar), "-C", str(arbeitsordner), "skripte"], check=True)
    if box.hoch(tar, f"{LAGER}/skripte.tgz").returncode != 0:
        b.fehler("Hochladen fehlgeschlagen.")
        return b.ende(RC_PRUEFUNG)
    p = box.lauf(f"tar xzf {LAGER}/skripte.tgz -C {LAGER} && rm -f {LAGER}/skripte.tgz", zeitlimit=300)
    if p.returncode != 0:
        b.fehler(f"Entpacken auf der Box fehlgeschlagen: {(p.stderr or '')[:200]}")
        return b.ende(RC_PRUEFUNG)
    b.sag(f"    {len(zu_tun)} Dateien liegen im Zwischenlager.")

    # ── 6/9 Am Geraet pruefen ────────────────────────────────────────────────
    b.schritt("6/9", "Am Geraet pruefen: sha256 gegen den Baum, bash -n / Python-Syntax")
    auftrag = [{"name": e["rel"], "quelle": f"{LAGER}/skripte/{e['name']}",
                "sha": e["sha"], "ziel": e["ziel"], "modus": e["modus"],
                "uid": e["uid"], "gid": e["gid"]} for e in zu_tun]
    pruef = box.helfer("skripte_pruefen", {"dateien": auftrag}, zeitlimit=600, sudo=True)
    if pruef["beanstandet"]:
        for m in pruef["beanstandet"]:
            b.fehler(m)
        b.fehler("Abbruch VOR dem Tausch — an den Betriebsorten wurde nichts angefasst.")
        return b.ende(RC_PRUEFUNG)
    b.sag(f"    {len(auftrag)} Dateien: sha256 stimmt mit dem Baum ueberein, Syntax in Ordnung.")

    # Welche Dienste danach neu starten — GEMESSEN, und nur die aktiven.
    aktiv, schlafend = [], []
    for e in zu_tun:
        for u in skript_dienste(e["ziel"], units):
            (aktiv if u["aktiv"] == "active" else schlafend).append((u["unit"], e["rel"]))
    neustarten = sorted({u for u, _ in aktiv})
    b.sag("")
    if neustarten:
        b.sag(f"    Neu zu starten waeren: {', '.join(neustarten)}")
    for u, rel in sorted(set(schlafend)):
        b.sag(f"    {u} ist nicht aktiv ({rel}) — wird NICHT angestossen. Die neue "
              f"Fassung gilt bei seinem naechsten Start.")
    ohne_dienst = [e["rel"] for e in zu_tun if not skript_dienste(e["ziel"], units)]
    if ohne_dienst:
        b.sag(f"    Ohne eigenen Dienst (wirken beim naechsten Aufruf): {len(ohne_dienst)} Dateien")

    # ── 7/9 Probelauf endet hier ─────────────────────────────────────────────
    if a.probe:
        b.schritt("7/9", "PROBELAUF: hier ist Schluss. Es wurde NICHTS getauscht.")
        b.sag(f"    Getauscht worden waere: {', '.join(e['rel'] for e in zu_tun)}")
        return b.ende(RC_PROBE if (b.daten["fehler"] or verweigert) else RC_OK)

    # ── 8/9 Sicherung und Tausch ─────────────────────────────────────────────
    #
    # WARUM HIER UEBERHAUPT GESICHERT WIRD, obwohl kein Skript Nutzerdaten IST:
    # data_clean.sh, remove_max_resume.sh und m3u_generator.sh schreiben bei
    # ihrem naechsten Lauf IN die Nutzerdaten. Eine neue Fassung, die sich anders
    # verhaelt, trifft sie also — nur eben spaeter.
    b.schritt("8/9", "Sicherung anstossen und tauschen (rename je Datei, unteilbar)")
    if not sicherung_anlegen(b, box, f"vor Skript-Auslieferung ({len(zu_tun)} Dateien)"):
        b.fehler("Kein Stand nachweisbar. Abbruch VOR dem Tausch — nichts angefasst.")
        return b.ende(RC_SICHERUNG)
    raeumen["ja"] = False
    stand["phase"] = "tausch"
    tausch = box.helfer("skripte_tauschen",
                        {"dateien": auftrag, "merkzettel": MERKZETTEL,
                         "stempel": time.strftime("%Y-%m-%dT%H:%M:%S")},
                        zeitlimit=600, sudo=True)
    stand["phase"] = "nach"
    raeumen["ja"] = not tausch["fehler"]
    for m in tausch["fehler"]:
        b.fehler(m)
    for f in tausch.get("fremde_beiseite", []):
        b.warnung(f"{f['war']} war KEINE Rueckdreh-Erzeugung dieses Weges (sie steht "
                  f"nicht im Merkzettel) — sie ist nach {f['jetzt']} beiseite gelegt, "
                  f"nicht geloescht. Von Hand entscheiden, was damit geschieht.")
    b.sag(f"    Getauscht: {len(tausch['getauscht'])} von {len(auftrag)}")
    b.sag("    Rueckweg liegt je Datei unter ….zurueck (GENAU EINE Erzeugung).")
    if tausch["fehler"]:
        b.fehler("Teilweise getauscht. Zurueck mit: tools/ausliefern.py --nur scripts --zurueckdrehen")
        return b.ende(RC_TAUSCH)

    # ── 9/9 Dienste und Nachmessen ───────────────────────────────────────────
    b.schritt("9/9", "Nur die betroffenen, JETZT laufenden Dienste neu starten — und nachmessen")
    getauscht_rel = set(tausch["getauscht"])
    wirklich = sorted({u for u, rel in aktiv if rel in getauscht_rel})
    heil = True
    if wirklich and not a.ohne_neustart:
        laut_vorher = lautstaerke_lesen(box)
        p = box.lauf("sudo -n systemctl restart " + " ".join(wirklich), zeitlimit=180)
        if p.returncode != 0:
            b.fehler(f"Neustart scheiterte: {(p.stderr or p.stdout).strip()[:300]}")
            heil = False
        else:
            b.sag(f"    Neu gestartet: {', '.join(wirklich)}")
        lautstaerke_schuetzen(box, b, laut_vorher)
    elif wirklich:
        b.warnung(f"--ohne-neustart: {', '.join(wirklich)} laufen weiter mit der alten "
                  f"Fassung, bis sie von selbst neu starten.")

    # (a) Liegt am Ziel wirklich, was hier im Baum steht?
    nach = box.helfer("skripte_lage",
                      {"orte": SKRIPT_ORTE, "namen": sorted({e["name"] for e in zu_tun})},
                      zeitlimit=300, sudo=True)
    for e in zu_tun:
        fund = next((f for f in nach["lage"].get(e["name"], []) if f["pfad"] == e["ziel"]), None)
        if fund and fund.get("sha") == e["sha"]:
            if fund.get("modus") != e["modus"] or fund.get("uid") != e["uid"]:
                b.warnung(f"{e['rel']}: Inhalt stimmt, aber Rechte stehen jetzt auf "
                          f"{fund.get('modus')} {fund.get('nutzer')}:{fund.get('gruppe')} "
                          f"statt {e['rechte']}.")
            else:
                b.sag(f"    {e['rel']}: am Geraet identisch mit dem Baum ({e['sha'][:12]}), "
                      f"Rechte unveraendert {e['rechte']}")
        else:
            b.fehler(f"{e['rel']}: am Geraet steht {(fund or {}).get('sha')}, "
                     f"im Baum {e['sha']}")
            heil = False

    # (b) Laufen die neu gestarteten Dienste — und BLEIBEN sie laufen?
    if wirklich and not a.ohne_neustart:
        time.sleep(6)
        for d in wirklich:
            erst = dienst_zustand(box, d)
            time.sleep(5)
            zweit = dienst_zustand(box, d)
            if erst["aktiv"] and zweit["aktiv"] and erst["kennung"] == zweit["kennung"]:
                b.sag(f"    {d}: aktiv und ueber 5 s hinweg stabil ({zweit['roh']})")
            else:
                b.fehler(f"{d}: nicht in Ordnung — vorher [{erst['roh']}] nachher [{zweit['roh']}]")
                q = box.lauf(f"sudo -n journalctl -u {d} -n 25 --no-pager")
                for zeile in (q.stdout or "").strip().splitlines()[-12:]:
                    b.sag("      | " + zeile)
                heil = False

    b.sag("")
    if heil:
        b.sag(f"FERTIG. Ausgeliefert: {len(tausch['getauscht'])} Skripte.")
        return b.ende(RC_OK)
    b.sag("NICHT IN ORDNUNG. Zurueck mit: tools/ausliefern.py --nur scripts --zurueckdrehen")
    return b.ende(RC_NACHHER)


def skripte_zurueckdrehen(b: Bericht, box: Box, a, stand: dict) -> int:
    """Der Rueckweg fuer scripts/. Er fragt NICHT den Arbeitsrechner, was
    ausgeliefert wurde — er liest an der Box, wo eine `….zurueck` liegt. Ein
    Rueckweg, der ein Gedaechtnis auf dem anderen Rechner braucht, ist keiner."""
    b.schritt("—", "Zurueckdrehen: jede Datei mit einer ….zurueck wieder vertauschen")
    kandidaten, _ = skript_kandidaten()
    lage = box.helfer("skripte_lage",
                      {"orte": SKRIPT_ORTE, "namen": sorted({k["name"] for k in kandidaten})},
                      zeitlimit=300, sudo=True)
    units = lage["units"]
    # DIESELBE SCHRANKE WIE AUF DEM HINWEG. Sie fehlte hier — und gerade hier
    # waere sie noch teurer: bleibt die Dienst-Zuordnung leer, meldet dieser Weg
    # „zurueckgedreht", waehrend der Dienst weiter die Fassung ausfuehrt, von der
    # man gerade weg wollte. Zurueckdrehen ist der Griff nach einer Reissleine;
    # sie darf nicht ins Leere greifen.
    erwartet, gelesen = lage.get("units_erwartet", 0), lage.get("units_gelesen", 0)
    if erwartet and gelesen < erwartet * 0.8:
        b.fehler(f"Die Dienst-Zuordnung ist unvollstaendig: {gelesen} von {erwartet} "
                 f"Units gelesen. Dann liesse sich nicht sagen, was nach dem "
                 f"Zurueckdrehen neu starten muss. Abbruch, nichts angefasst.")
        return b.ende(RC_UMGEBUNG)
    # Nur Ziele, an denen wirklich eine Rueckdreh-Erzeugung liegt.
    p = box.lauf("for d in " + " ".join(SKRIPT_ORTE) +
                 "; do [ -d $d ] && find $d -maxdepth 1 -name '*.zurueck'; done 2>/dev/null")
    rueckwege = {z.strip()[: -len(".zurueck")] for z in (p.stdout or "").splitlines() if z.strip()}
    # NUR ZURUECKNEHMEN, WAS DIESER WEG GEGEBEN HAT. Am 08.08.2026 lagen auf
    # dieser Box `….zurueck`-Dateien aus Kopien VON HAND — unter anderem zu
    # mupibox-sicherung.py, das in derselben Nacht repariert worden war. Wer
    # blind jede gefundene Rueckdreh-Erzeugung vertauscht, nimmt fremde
    # Reparaturen mit zurueck. Deshalb entscheidet der Merkzettel, den der
    # Tausch auf der Box hinterlaesst — und nicht der Fund im Verzeichnis.
    p = box.lauf(f"cat {MERKZETTEL} 2>/dev/null")
    try:
        zettel = json.loads(p.stdout or "{}")
    except json.JSONDecodeError:
        zettel = {}
    eintraege = zettel.get("eintraege")
    if eintraege is None:                       # Merkzettel aus der ersten Fassung
        eintraege = [{"ziel": z, "sha": None, "neu": False} for z in (zettel.get("ziele") or [])]
    eintraege = [e for e in eintraege if isinstance(e, dict) and e.get("ziel")]
    meine = {e["ziel"] for e in eintraege}
    if zettel.get("stempel"):
        b.sag(f"    Merkzettel vom {zettel['stempel']}: {len(meine)} Dateien.")

    kanon = {k["name"]: k for k in kandidaten}
    dabei, fremd = [], []
    for ziel in sorted(rueckwege):
        if os.path.basename(ziel) not in kanon:
            fremd.append((ziel, "gehoert zu keiner Datei aus scripts/"))
        elif ziel not in meine:
            fremd.append((ziel, "steht nicht im Merkzettel — nicht von diesem Weg"))
        else:
            dabei.append({"name": ziel, "ziel": ziel})
    for ziel, grund in fremd:
        b.warnung(f"{ziel}.zurueck: {grund}. Uebersprungen — von Hand entscheiden.")

    # WAS DIESER WEG ANGELEGT HAT, WO VORHER NICHTS LAG (--auch-neue). Dazu gibt
    # es keine ….zurueck — die Suche nach '*.zurueck' findet davon nichts, und
    # die erste Fassung hat solche Dateien deshalb weder zurueckgenommen noch
    # ERWAEHNT. Ein Rueckweg, der schweigend die Haelfte stehen laesst, ist
    # gefaehrlicher als einer, der gar nichts tut.
    entfernen = [{"ziel": e["ziel"], "sha": e.get("sha")}
                 for e in eintraege if e.get("neu") and e["ziel"] not in rueckwege]

    if not dabei and not entfernen:
        b.sag("    Es liegt keine Rueckdreh-Erzeugung aus diesem Weg da. Nichts zu tun.")
        return b.ende(RC_OK)
    for d in dabei:
        dienste = skript_dienste(d["ziel"], units)
        b.sag(f"    {d['ziel']}  <- {d['ziel']}.zurueck"
              + (f"  ({', '.join(u['unit'] + ' [' + u['aktiv'] + ']' for u in dienste)})" if dienste else ""))
    for d in entfernen:
        b.sag(f"    {d['ziel']}  -> WIRD ENTFERNT (lag vor diesem Weg nicht da; "
              f"nur solange sie unveraendert ist)")
    if a.probe:
        b.sag("")
        b.sag("PROBELAUF: hier ist Schluss. Es wurde NICHTS vertauscht und NICHTS entfernt.")
        return b.ende(RC_OK)

    stand["phase"] = "tausch"
    befund = box.helfer("skripte_zurueck",
                        {"dateien": dabei, "entfernen": entfernen,
                         "merkzettel": MERKZETTEL,
                         "stempel": time.strftime("%Y-%m-%dT%H:%M:%S")},
                        zeitlimit=600, sudo=True)
    stand["phase"] = "nach" if not befund["fehler"] else "tausch"
    for n in befund["ohne_rueckweg"]:
        b.warnung(f"{n}: keine Rueckdreh-Erzeugung — uebersprungen.")
    for n in befund["ohne_wirkung"]:
        b.fehler(f"{n}: Ziel und Rueckweg sind DIESELBE Datei (ein Inode). Das "
                 f"Vertauschen waere wirkungslos — hier gibt es nichts, wohin man "
                 f"zurueck koennte.")
    for m in befund["fehler"]:
        b.fehler(m)

    for ziel in befund.get("entfernt", []):
        b.sag(f"    {ziel}: entfernt — sie lag vor diesem Weg nicht da.")
        for u in skript_dienste(ziel, units):
            b.warnung(f"{u['unit']} [{u['aktiv']}] fuehrt {ziel} aus, und die Datei ist "
                      f"jetzt weg. Sie war es vor diesem Weg auch. NICHT neu gestartet — "
                      f"ein Neustart wuerde jetzt scheitern.")
    for n in befund.get("nicht_entfernt", []):
        b.warnung(f"{n['ziel']}: NICHT entfernt ({n['grund']}). Sie stammt aus diesem "
                  f"Weg, bleibt aber liegen — der Stand von vorher ist damit nicht "
                  f"vollstaendig wiederhergestellt.")

    if not befund["zurueck"]:
        schlimm = befund["fehler"] or befund["ohne_wirkung"] or befund.get("nicht_entfernt")
        if befund.get("entfernt"):
            b.sag(f"    Entfernt: {len(befund['entfernt'])} Dateien, nichts zu vertauschen.")
        return b.ende(RC_TAUSCH if schlimm else RC_OK)
    b.sag(f"    Zurueckgedreht: {len(befund['zurueck'])} Dateien")

    heil = (not befund["fehler"] and not befund["ohne_wirkung"]
            and not befund.get("nicht_entfernt"))
    nach = box.helfer("skripte_lage",
                      {"orte": SKRIPT_ORTE, "namen": sorted({os.path.basename(z) for z in befund["zurueck"]})},
                      zeitlimit=300, sudo=True)
    for ziel in befund["zurueck"]:
        fund = next((f for f in nach["lage"].get(os.path.basename(ziel), [])
                     if f["pfad"] == ziel), None)
        alt = befund["vorher"].get(ziel)
        neu = (fund or {}).get("sha")
        if neu and neu != alt:
            b.sag(f"    {ziel}: jetzt {neu[:12]} (vorher {str(alt)[:12]}) — der Rueckweg hat gewirkt")
        else:
            b.fehler(f"{ziel}: steht weiter auf {str(neu)[:12]} — der Rueckweg hat NICHTS bewirkt.")
            heil = False

    wirklich = sorted({u["unit"] for z in befund["zurueck"] for u in skript_dienste(z, units)
                       if u["aktiv"] == "active"})
    if wirklich and not a.ohne_neustart:
        # DEN RUECKGABEWERT LESEN. Er wurde hier weggeworfen und der Bericht
        # meldete „Neu gestartet" auch dann, wenn kein Dienst angefasst worden
        # war. Auf dem Hinweg wird er geprueft; hier stand die Zusage ohne
        # Deckung — und ein Dienst, der weiterlaeuft, fuehrt die Fassung aus,
        # von der man gerade weg wollte.
        p = box.lauf("sudo -n systemctl restart " + " ".join(wirklich), zeitlimit=180)
        if p.returncode != 0:
            b.fehler(f"Neustart nach dem Zurueckdrehen scheiterte: "
                     f"{(p.stderr or p.stdout).strip()[:300]}. Die Dateien sind zurueck, "
                     f"die Dienste fuehren aber weiter die neue Fassung aus.")
            heil = False
        else:
            b.sag(f"    Neu gestartet: {', '.join(wirklich)}")
    elif wirklich:
        b.warnung(f"--ohne-neustart: {', '.join(wirklich)} laufen weiter mit der Fassung, "
                  f"die eben zurueckgedreht wurde.")
    b.warnung("Die Rueckdreh-Erzeugungen halten jetzt den Stand, der eben lief — "
              "ein zweites --zurueckdrehen tauscht wieder hin und her.")
    return b.ende(RC_OK if heil else RC_TAUSCH)


# ── Hauptlauf ────────────────────────────────────────────────────────────────

def rc_nach_phase(b: Bericht, stand: dict) -> int:
    """Welchen Rueckgabewert darf ein Abriss melden? Das haengt daran, ob der
    Betriebsordner schon offen war. `1` heisst laut Kopf „NICHTS angefasst" —
    das darf nach dem Beginn des Tauschs niemand mehr behaupten."""
    if stand["phase"] == "tausch":
        b.fehler("Der Abriss traf den TAUSCH SELBST. Es kann teilweise getauscht sein — "
                 "nachsehen mit tools/ausliefern-gegenlesen.py, zurueck mit "
                 "tools/ausliefern.py --zurueckdrehen.")
        return RC_TAUSCH
    if stand["phase"] == "nach":
        b.fehler("Getauscht war schon; der Abriss traf das Nachmessen.")
        return RC_NACHHER
    return RC_UMGEBUNG


def main() -> int:
    t = argparse.ArgumentParser(
        description="Bauen, pruefen, sichern, tauschen — der eine Ausrollweg auf die Box.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Rueckgabe: 0 fertig  1 Umgebung  2 Bau  3 Pruefung  4 Sicherung  "
               "5 Tausch  6 danach  7 Probelauf beanstandet")
    t.add_argument("--box", default=BOX_VORGABE, help="dietpi@<adresse>; ohne Angabe wird gesucht")
    # `scripts` steht ABSICHTLICH nicht in der Vorgabe: ein naechtlicher Lauf
    # soll nicht ploetzlich 26 Skripte mitschieben, die niemand angesehen hat.
    # `laufwerk` steht SEHR WOHL in der Vorgabe, anders als `scripts`: es gehoert
    # zu server.js wie das Schloss zum Schluessel. Eine frische server.js neben
    # einem Laufwerk von gestern faellt NICHT auf — die Box startet tadellos und
    # laedt still kein Plugin.
    t.add_argument("--nur", default="server,player,laufwerk,plugins,www,admin,herkunft",
                   help="Kommaliste aus server,player,laufwerk,www,admin,herkunft — oder 'scripts' allein")
    t.add_argument("--probe", action="store_true",
                   help="alles pruefen, NICHTS tauschen (auch keine Sicherung)")
    t.add_argument("--ohne-bau", action="store_true", help="src/deploy nehmen, wie es liegt")
    t.add_argument("--erzwingen", action="store_true",
                   help="auch tauschen, was sich nicht unterscheidet")
    t.add_argument("--zurueckdrehen", action="store_true",
                   help="die eine Rueckdreh-Erzeugung wieder einsetzen")
    t.add_argument("--json", action="store_true")
    t.add_argument("--zeitlimit", type=int, default=180, help="Sekunden je SSH-Aufruf")
    t.add_argument("--auch-neue", action="store_true",
                   help="nur bei --nur scripts: auch Dateien anlegen, die auf der Box "
                        "noch gar nicht liegen (Rechte sind dann geraten, nicht gemessen)")
    t.add_argument("--ohne-neustart", action="store_true",
                   help="nur bei --nur scripts: getauscht wird, aber kein Dienst angefasst")
    a = t.parse_args()

    b = Bericht(a.json)
    namen = [n.strip() for n in a.nur.split(",") if n.strip()]
    unbekannt = [n for n in namen if n not in ZIELE]
    if unbekannt or not namen:
        b.fehler(f"Unbekanntes Ziel: {unbekannt or 'keins angegeben'}. Erlaubt: {list(ZIELE)}")
        rc = b.ende(RC_UMGEBUNG)
        b.ausgeben()
        return rc
    # `scripts` laeuft ALLEIN, und das ist keine Bequemlichkeit: die vier
    # anderen Ziele bauen erst (npm), liegen unter /home/dietpi und brauchen
    # kein sudo; scripts baut nichts, liegt unter root-eigenen Verzeichnissen
    # und tauscht Datei fuer Datei. Ein gemeinsamer Lauf haette zwei Ablaeufe
    # in einem Rumpf — und der Rueckgabewert koennte nicht mehr sagen, welche
    # Haelfte ihn gemeldet hat.
    if "scripts" in namen and len(namen) > 1:
        b.fehler("'scripts' laeuft allein: `--nur scripts`. Zusammen mit "
                 f"{[n for n in namen if n != 'scripts']} geht es nicht.")
        rc = b.ende(RC_UMGEBUNG)
        b.ausgeben()
        return rc
    skripte = namen == ["scripts"]
    if (a.auch_neue or a.ohne_neustart) and not skripte:
        b.fehler("--auch-neue und --ohne-neustart gelten nur fuer `--nur scripts`.")
        rc = b.ende(RC_UMGEBUNG)
        b.ausgeben()
        return rc

    # ── OHNE `--box`: SUCHEN STATT RATEN ──────────────────────────────────
    #
    # Der SSH-Benutzer gehoert dazu — `ausliefern.py --box 192.168.178.62`
    # scheitert, weil dann der lokale Benutzername genommen wird. Der Finder
    # liefert nur die Adresse; `dietpi@` kommt hier davor.
    if not a.box:
        finder = Path(__file__).resolve().parent / "box-finden.py"
        try:
            lauf = subprocess.run(
                [sys.executable, str(finder), "--nur-adresse"],
                capture_output=True,
                text=True,
                timeout=180,
            )
        except (OSError, subprocess.SubprocessError) as e:
            b.fehler(f"Die Box liess sich nicht suchen ({e}). Mit --box dietpi@<adresse> angeben.")
            rc = b.ende(RC_UMGEBUNG)
            b.ausgeben()
            return rc
        gefunden = lauf.stdout.strip().splitlines()
        if lauf.returncode != 0 or not gefunden:
            b.fehler(
                "Keine Box gefunden — es wurde nichts ausgeliefert.\n"
                "  python3 tools/box-finden.py  sagt, was geprueft wurde.\n"
                "  Oder von Hand:  --box dietpi@<adresse>"
            )
            rc = b.ende(RC_UMGEBUNG)
            b.ausgeben()
            return rc
        a.box = f"dietpi@{gefunden[-1].strip()}"
        b.sag(f"Box gefunden: {a.box}")

    stempel = jetzt()
    arbeitsordner = Path(tempfile.mkdtemp(prefix=f"ausliefern-{stempel}-"))
    box = Box(a.box, arbeitsordner, a.zeitlimit)
    # Das Zwischenlager wird am Ende IMMER geraeumt — auch nach einem Abbruch.
    # Ein Werkzeug gegen Altlasten, das selbst welche hinterlaesst, ist der
    # Anfang derselben Halde noch einmal. EINE Ausnahme: bricht der Tausch in
    # der Mitte ab, kann im Lager der ALTE Inhalt eines Baumes liegen — der
    # wird dann nicht angefasst und ausdruecklich genannt.
    raeumen = {"ja": True}
    # WIE WEIT SIND WIR? Ein Abriss VOR dem Tausch ist etwas voellig anderes als
    # einer MITTENDRIN, und der Rueckgabewert muss das sagen. Frueher fing der
    # aeussere `except` beides ab und meldete 1 — im Kopf dieser Datei steht bei
    # 1 aber ausdruecklich „NICHTS angefasst". Ein unbeaufsichtigter Aufrufer
    # haette daraufhin weitergemacht, waehrend `www` halb getauscht dalag.
    stand = {"phase": "vor"}
    b.sag(f"Ausliefern nach {a.box} — Stempel {stempel}")
    b.sag(f"Arbeitsordner: {arbeitsordner}")
    b.sag("")

    try:
        # ── 1 Umgebung ───────────────────────────────────────────────────────
        b.schritt("1/9" if skripte else "1/12", "Umgebung pruefen")
        p = box.lauf(f"test -d {APPDIR} && test -d {PLAYERDIR} && test -x {SICHERUNG} "
                     f"&& sudo -n true && echo BEREIT")
        if "BEREIT" not in (p.stdout or ""):
            b.fehler(f"Box nicht bereit: rc={p.returncode} {(p.stderr or p.stdout).strip()[:300]}")
            b.fehler(f"  Erwartet: {APPDIR}, {PLAYERDIR}, {SICHERUNG} (ausfuehrbar), sudo -n ohne Passwort.")
            return b.ende(RC_UMGEBUNG)
        b.sag("    Verzeichnisse, Sicherungswerkzeug und sudo -n sind da.")
        box.lauf(f"rm -rf {LAGER} && mkdir -p {LAGER}")
        helferdatei = arbeitsordner / "helfer.py"
        helferdatei.write_text(BOXHELFER)
        if box.hoch(helferdatei, f"{LAGER}/helfer.py").returncode != 0:
            b.fehler("Der Boxhelfer liess sich nicht hochladen.")
            return b.ende(RC_UMGEBUNG)

        # ── Das fuenfte Ziel geht seinen eigenen Weg ─────────────────────────
        if skripte:
            if a.zurueckdrehen:
                return skripte_zurueckdrehen(b, box, a, stand)
            if not a.ohne_bau:
                b.sag("    (kein Bau: unter scripts/ gibt es nichts zu uebersetzen.)")
            return skripte_lauf(b, box, a, arbeitsordner, stand, raeumen)

        # ── Rueckweg statt Auslieferung ──────────────────────────────────────
        if a.zurueckdrehen:
            b.schritt("—", "Zurueckdrehen: die eine Rueckdreh-Erzeugung wieder einsetzen")
            messauftrag = {"ziele": [
                {"name": n, "art": ZIELE[n]["art"], "ziel": ZIELE[n]["ziel"]} for n in namen]}
            # VORHER messen. Ohne das laesst sich hinterher nicht sagen, ob der
            # Rueckweg gewirkt hat — und ein Rueckweg, den nie jemand
            # nachgemessen hat, ist keiner.
            vorher = box.helfer("messen", messauftrag, zeitlimit=300)
            auftrag = {"ziele": [{
                "name": n, "art": ZIELE[n]["art"], "ziel": ZIELE[n]["ziel"],
                "zurueck": ZIELE[n]["ziel"] + ".zurueck"} for n in namen]}
            stand["phase"] = "tausch"
            befund = box.helfer("zurueckdrehen", auftrag, zeitlimit=600)
            stand["phase"] = "nach" if not befund["fehler"] else "tausch"
            for n in befund["ohne_rueckweg"]:
                b.warnung(f"{n}: es liegt keine Rueckdreh-Erzeugung da — uebersprungen.")
            for n in befund.get("ohne_wirkung", []):
                b.fehler(f"{n}: Ziel und Rueckweg sind DIESELBE Datei (ein Inode). Das "
                         f"Vertauschen waere wirkungslos — hier gibt es nichts, wohin "
                         f"man zurueck koennte. Frueher meldete dieser Weg dafuer Erfolg.")
            for f in befund["fehler"]:
                b.fehler(f)
            if not befund["zurueck"]:
                return b.ende(RC_TAUSCH if (befund["fehler"] or befund.get("ohne_wirkung"))
                              else RC_OK)
            dienste = sorted({ZIELE[n]["dienst"] for n in befund["zurueck"] if ZIELE[n]["dienst"]})
            if dienste:
                box.lauf("sudo -n systemctl restart " + " ".join(dienste), zeitlimit=120)
            b.sag(f"    Zurueckgedreht: {', '.join(befund['zurueck'])}")

            # DIE FRIST ABRAEUMEN, UND ZWAR HIER. Von Hand zurueckgedreht heisst:
            # der Grund fuer die Frist ist erledigt. Bliebe sie stehen, koennte
            # die Standwache spaeter ein ZWEITES Mal vertauschen — und weil der
            # Rueckweg in beide Richtungen fuehrt, laege danach wieder der
            # Stand da, den man gerade weggedreht hat. Ein Rueckweg, der einen
            # im Kreis fuehrt, ist keiner.
            wache_entwarnen(b, box)

            # NACHHER messen: hat sich am Ziel wirklich etwas geaendert?
            nachher = box.helfer("messen", messauftrag, zeitlimit=300)
            heil = not befund["fehler"] and not befund.get("ohne_wirkung")
            for n in befund["zurueck"]:
                alt, neu = vorher.get(n, {}).get("hash"), nachher.get(n, {}).get("hash")
                if neu and alt != neu:
                    b.sag(f"    {n}: am Geraet jetzt {str(neu)[:12]} (vorher {str(alt)[:12]}) "
                          f"— der Rueckweg hat gewirkt")
                else:
                    b.fehler(f"{n}: am Geraet steht weiter {str(neu)[:12]} — der Rueckweg "
                             f"hat NICHTS bewirkt, obwohl er Erfolg meldete.")
                    heil = False
            if dienste:
                for d in dienste:
                    z1 = dienst_zustand(box, d)
                    time.sleep(5)
                    z2 = dienst_zustand(box, d)
                    if z1["aktiv"] and z2["aktiv"] and z1["kennung"] == z2["kennung"]:
                        b.sag(f"    {d}: aktiv und ueber 5 s hinweg stabil")
                    else:
                        b.fehler(f"{d}: nach dem Zurueckdrehen nicht in Ordnung — "
                                 f"[{z1['roh']}] / [{z2['roh']}]")
                        heil = False
            b.warnung("Die Rueckdreh-Erzeugung haelt jetzt den Stand, der eben lief — "
                      "ein zweites --zurueckdrehen tauscht wieder hin und her.")
            return b.ende(RC_OK if heil else RC_TAUSCH)

        # ── 2 Bauen ──────────────────────────────────────────────────────────
        if a.ohne_bau:
            b.schritt("2/12", "Bauen uebersprungen (--ohne-bau) — src/deploy wird genommen, wie es liegt")
            b.warnung("Ungeprueft ist damit, ob src/deploy zum aktuellen Quelltext passt.")
        else:
            b.schritt("2/12", "Bauen (npm run build, stderr durch eine Pipe)")
            if not bauen(b, arbeitsordner):
                return b.ende(RC_BAU)

        # DER STEMPEL ENTSTEHT AUCH BEI --ohne-bau. Er beschreibt den QUELLBAUM,
        # nicht die Bauausgabe; wer src/deploy nimmt, wie es liegt, soll trotzdem
        # sehen, aus welchem Stand er ausliefert. Und `npm run build` ruft
        # src/deploy.sh nicht auf — ohne diesen Aufruf gaebe es die Datei nie.
        herkunft_stempeln(b)

        # ── 3 Paket ──────────────────────────────────────────────────────────
        b.schritt("3/12", "Paket schnueren und lokal pruefen")
        soll = paket_schnueren(b, arbeitsordner, namen)
        if soll is None:
            return b.ende(RC_PRUEFUNG)
        paket = arbeitsordner / "paket"
        buendel = {}
        for n, ordner in (("www", "www"), ("admin", "www-admin")):
            if n in namen:
                buendel[n] = buendelname(paket / ordner / "index.html")
                if not buendel[n]:
                    b.warnung(f"{n}: in der index.html steht kein main-*.js — "
                              f"die Wirkung laesst sich danach nur ueber md5 belegen.")

        # ── 4 Vergleich mit dem laufenden Stand ──────────────────────────────
        b.schritt("4/12", "Den laufenden Stand messen und vergleichen")
        ist = box.helfer("messen", {"ziele": [
            {"name": n, "art": ZIELE[n]["art"], "ziel": ZIELE[n]["ziel"]} for n in namen
        ]}, zeitlimit=300)
        zu_tun = []
        for n in namen:
            gleich = ist.get(n, {}).get("hash") == soll[n].get("hash") and ist.get(n, {}).get("hash")
            if gleich and not a.erzwingen:
                b.sag(f"    {n}: unveraendert — wird NICHT getauscht (kein Neustart, kein Rueckweg verbraucht)")
            else:
                zu_tun.append(n)
                b.sag(f"    {n}: {'ERZWUNGEN' if gleich else 'unterscheidet sich'} → wird getauscht")
        if not zu_tun:
            b.sag("")
            b.sag("Nichts zu tun: die Box hat bereits genau diesen Stand.")
            return b.ende(RC_OK)

        # ── 5 Hochladen ins Zwischenlager ────────────────────────────────────
        b.schritt("5/12", f"Ins Zwischenlager hochladen ({LAGER}) — der Betriebsordner bleibt unberuehrt")
        braucht = 0
        for n in zu_tun:
            if ZIELE[n]["art"] == "datei":
                quelle = paket / Path(ZIELE[n]["ziel"]).name
                if box.hoch(quelle, f"{LAGER}/{quelle.name}").returncode != 0:
                    b.fehler(f"{n}: hochladen fehlgeschlagen.")
                    return b.ende(RC_PRUEFUNG)
                braucht += quelle.stat().st_size
            else:
                ordner = paketname(n)
                tar = arbeitsordner / f"{ordner}.tgz"
                subprocess.run(["tar", "czf", str(tar), "-C", str(paket), ordner], check=True)
                if box.hoch(tar, f"{LAGER}/{tar.name}").returncode != 0:
                    b.fehler(f"{n}: hochladen fehlgeschlagen.")
                    return b.ende(RC_PRUEFUNG)
                p = box.lauf(f"tar xzf {LAGER}/{tar.name} -C {LAGER} && rm -f {LAGER}/{tar.name}",
                             zeitlimit=300)
                if p.returncode != 0:
                    b.fehler(f"{n}: entpacken auf der Box fehlgeschlagen: {(p.stderr or '')[:200]}")
                    return b.ende(RC_PRUEFUNG)
                braucht += soll[n]["bytes"]
            b.sag(f"    {n}: liegt im Zwischenlager")

        # ── 6 Am Geraet pruefen ──────────────────────────────────────────────
        b.schritt("6/12", "Am Geraet pruefen: index.html, node --check, md5 gegen den Arbeitsrechner")
        auftrag_ziele = [{
            "name": n, "art": ZIELE[n]["art"], "ziel": ZIELE[n]["ziel"],
            "neu": f"{LAGER}/{paketname(n)}",
            # Was am Geraet vorhanden sein MUSS, damit der Tausch nicht in
            # eine tote Oberflaeche fuehrt. Nur die beiden Oberflaechen haben
            # eine index.html; bei allem anderen entscheidet der Hash.
            # SEIT E118/1e traegt www seine Seite unter neu/ — die Wurzel-index
            # gehoerte der geloeschten Angular-App (gleiche Stelle wie beim
            # Schnueren, Zeile ~898).
            "muss_enthalten": "neu/index.html" if n == "www" else ("index.html" if n == "admin" else None),
            "zurueck": ZIELE[n]["ziel"] + ".zurueck",
        } for n in zu_tun]
        befund = box.helfer("pruefen", {"ziele": auftrag_ziele, "appdir": APPDIR,
                                        "braucht_bytes": braucht}, zeitlimit=600)
        for n in zu_tun:
            e = befund["ziele"].get(n, {}).get("stand", {})
            if e.get("hash") != soll[n].get("hash"):
                befund["beanstandet"].append(
                    f"{n}: im Zwischenlager steht {e.get('hash')}, gebaut wurde {soll[n].get('hash')}")
        if befund["beanstandet"]:
            for m in befund["beanstandet"]:
                b.fehler(m)
            b.fehler("Abbruch VOR dem Tausch — am Betriebsordner wurde nichts angefasst.")
            return b.ende(RC_PRUEFUNG)
        b.sag(f"    Alles geprueft. {befund['frei_bytes'] >> 20} MB frei.")
        for n in zu_tun:
            e = befund["ziele"][n]["stand"]
            b.sag(f"    {n}: md5 stimmt mit dem Arbeitsrechner ueberein"
                  + (f", {e.get('dateien')} Dateien"
                     + (", index.html da" if e.get("index") else "")
                     if ZIELE[n]["art"] == "baum" else ""))

        # ── 7 Probelauf endet hier ───────────────────────────────────────────
        if a.probe:
            b.schritt("7/12", "PROBELAUF: hier ist Schluss. Es wurde NICHTS getauscht.")
            b.sag(f"    Zwischenlager geraeumt. Getauscht worden waere: {', '.join(zu_tun)}")
            altlasten_melden(b, box)
            return b.ende(RC_PROBE if b.daten["fehler"] else RC_OK)

        # ── 8 Sicherung ──────────────────────────────────────────────────────
        b.schritt("8/12", "Sicherung der Nutzerdaten anstossen (mupibox-sicherung.py --anlegen)")
        if not sicherung_anlegen(b, box, f"vor Auslieferung {stempel} ({','.join(zu_tun)})"):
            b.fehler("Kein Stand nachweisbar. Abbruch VOR dem Tausch — nichts angefasst.")
            b.fehler("  Moegliche Gruende: eine Wiederherstellung laeuft gerade (dann gibt "
                     "--anlegen 0 zurueck und legt nichts an), oder jemand schreibt "
                     "dauerhaft an data.json.")
            return b.ende(RC_SICHERUNG)

        # ── 9 Tausch ─────────────────────────────────────────────────────────
        b.schritt("9/12", "Tauschen — Baeume in EINEM Schritt (renameat2), Dateien atomar")
        raeumen["ja"] = False   # ab hier koennte im Lager der ALTE Inhalt liegen
        stand["phase"] = "tausch"
        tausch = box.helfer("tauschen", {"ziele": auftrag_ziele}, zeitlimit=600)
        stand["phase"] = "nach"
        raeumen["ja"] = not tausch["fehler"]
        for m in tausch["fehler"]:
            b.fehler(m)
        b.sag(f"    Getauscht: {', '.join(tausch['getauscht']) or 'nichts'}")
        b.sag(f"    Rueckweg liegt unter ….zurueck (GENAU EINE Erzeugung, "
              f"die naechste Auslieferung ersetzt sie).")
        # DIE FRIST WIRD HIER GESTELLT, NICHT SPAETER. Ab diesem Punkt steht auf
        # der Box ein Stand, den noch niemand gemessen hat — und ab hier kann
        # dieser Lauf jederzeit abreissen, ohne dass jemand davon erfaehrt.
        # Auch beim TEILWEISEN Tausch (gleich darunter der Abbruch): gerade
        # dann ist ein Rueckweg, den die Box selbst geht, das Nuetzlichste.
        if tausch["getauscht"]:
            wache_stellen(b, box, tausch["getauscht"], auftrag_ziele, buendel, stempel)
        if tausch["fehler"]:
            b.fehler("Teilweise getauscht. Zurueck mit: tools/ausliefern.py --zurueckdrehen")
            b.fehler("  Oder auf der Box sofort: "
                     f"sudo {STANDWACHE} --jetzt-zurueck")
            return b.ende(RC_TAUSCH)

        # ── 10 Dienste ───────────────────────────────────────────────────────
        dienste = sorted({ZIELE[n]["dienst"] for n in tausch["getauscht"] if ZIELE[n]["dienst"]})
        if dienste:
            b.schritt("10/12", "Dienste neu starten (systemd — NICHT pm2, das laeuft hier nicht mehr)")
            laut_vorher = lautstaerke_lesen(box)
            p = box.lauf("sudo -n systemctl restart " + " ".join(dienste), zeitlimit=180)
            if p.returncode != 0:
                b.fehler(f"Neustart scheiterte: {(p.stderr or p.stdout).strip()[:300]}")
                return b.ende(RC_NACHHER)
            b.sag(f"    Neu gestartet: {', '.join(dienste)}")
            lautstaerke_schuetzen(box, b, laut_vorher)
        else:
            b.schritt("10/12", "Kein Dienst betroffen — die Oberflaeche wird von der Platte geliefert.")

        # ── 10b Den Kiosk neu laden ──────────────────────────────────────────
        #
        # WOZU (Betreiber am Geraet, 04.09.2026): „ein weisses feld und ich habe
        # kein front end mehr". Gemessen war das Backend dabei kerngesund —
        # /neu/ antwortete mit HTTP 200 und 96 kB, app.js mit 1,48 MB, node
        # --check sauber. Der Kiosk-Browser hielt nur eine Seite, deren Dateien
        # unter ihm ausgetauscht worden waren: `cog` lief seit vier Stunden auf
        # http://localhost:8200/neu/, das www-Verzeichnis wurde um 15:00 ersetzt,
        # und WebKit laedt von sich aus nicht nach. Uebrig blieb Weiss.
        #
        # WWW HAT KEINEN DIENST (ZIELE[...]["dienst"] is None), und genau
        # deshalb fiel es durch: Schritt 10 startet nur Dienste neu, und fuer
        # die Oberflaeche gab es niemanden, der sie anstoesst. Das Ausrollen
        # war „fertig", der Schirm war weiss.
        #
        # KEIN ABBRUCH, WENN ES NICHT KLAPPT: Getauscht ist zu diesem Zeitpunkt
        # schon; ein Fehlschlag hier macht die Lieferung nicht kaputt, er laesst
        # nur den Schirm stehen. Deshalb eine WARNUNG mit dem Handgriff dazu —
        # abzubrechen haette niemandem geholfen und den Rueckweg verwirrt.
        if "www" in tausch["getauscht"]:
            b.schritt("10b/12", "Den Kiosk neu laden — sonst haelt er die alte, jetzt fehlende Seite")
            p_kiosk = box.lauf(f"sudo -n {KIOSK_HEIM}", zeitlimit=90)
            if p_kiosk.returncode == 0:
                b.sag("    " + ((p_kiosk.stdout or "").strip().splitlines() or ["Kiosk neu geladen."])[-1])
            else:
                b.warnung("Der Kiosk kam nicht von selbst zurueck — der Schirm koennte weiss bleiben.")
                b.warnung(f"  Von Hand: ssh <box> sudo {KIOSK_HEIM}")

        # ── 11 Nachmessen ────────────────────────────────────────────────────
        b.schritt("11/12", "Nachmessen — ueber die Wirkung, nicht ueber HTTP 200")
        # Was der Tausch aus dem laufenden Baum uebernommen hat, gehoert nicht
        # in den Hashvergleich — es steht absichtlich nicht im Paket.
        mitgenommen: dict[str, list[str]] = {}
        for eintrag in tausch.get("mitgenommen", []):
            ziel_, _, name_ = eintrag.partition("/")
            mitgenommen.setdefault(ziel_, []).append(name_)
        if mitgenommen:
            b.sag("    Aus dem laufenden Baum uebernommen (nicht im Paket): "
                  + ", ".join(f"{z_}/{n_}" for z_, ns_ in mitgenommen.items() for n_ in ns_))
        if "index.html" in mitgenommen.get("www", []):
            # SEIT E118/1e hat www keine Wurzel-index mehr — eine uebernommene
            # ist der Nachlass der geloeschten Angular-App. Sie ist nicht nur
            # Ballast: express liefert sie VOR dem Catch-all aus und verdeckt
            # damit den Redirect / -> /neu/. Genau so sah die erste
            # Auslieferung nach dem Schnitt (05.09.2026, Box .62) an der
            # Wurzel wieder die alte Oberflaeche. Aufgeraeumt wird bewusst
            # nicht von hier aus (Uebernahmen sind der Nutzerdaten-Schutz
            # des Tauschers) — dafuer gibt es das benannte Werkzeug.
            b.warnung("www: die ALTE Wurzel-index.html wurde aus dem laufenden "
                      "Baum uebernommen — sie verdeckt den Redirect / -> /neu/.")
            b.warnung("  Raeumen am Geraet: tools/box/mixpi-angular-nachlass.py "
                      "(erst Probe, dann --wirklich).")
        heil = nachmessen(b, box, box.host, tausch["getauscht"], soll, buendel, mitgenommen)

        # ── 12 Aufraeumen ────────────────────────────────────────────────────
        b.schritt("12/12", "Zwischenlager raeumen und Altlasten melden")
        altlasten_melden(b, box)
        b.sag("")
        if heil:
            # ENTWARNEN ERST HIER, nach dem Nachmessen. Frueher waere es ein
            # Freispruch auf Verdacht.
            wache_entwarnen(b, box)
            b.sag(f"FERTIG. Ausgeliefert: {', '.join(tausch['getauscht'])}.")
            b.sag("Es ist KEINE neue .vor-Datei entstanden.")
            return b.ende(RC_OK)
        # NICHT ENTWARNT. Die Frist bleibt absichtlich stehen: wer jetzt den
        # Rechner zuklappt, hat trotzdem eine Box, die sich selbst zurueckdreht.
        b.sag("NICHT IN ORDNUNG.")
        b.sag("  Sofort zurueck:  tools/ausliefern.py --zurueckdrehen")
        b.sag(f"  Oder auf der Box: sudo {STANDWACHE} --jetzt-zurueck")
        b.sag("  Oder gar nichts tun: die Standwache dreht nach Ablauf der Frist "
              "von selbst zurueck.")
        return b.ende(RC_NACHHER)

    except subprocess.TimeoutExpired as e:
        b.fehler(f"Zeitueberschreitung: {e}")
        return b.ende(rc_nach_phase(b, stand))
    except Exception as e:  # noqa: BLE001
        b.fehler(f"Unerwartet: {e!r}")
        return b.ende(rc_nach_phase(b, stand))
    finally:
        if raeumen["ja"]:
            box.lauf(f"rm -rf {LAGER}")
        else:
            b.warnung(f"Das Zwischenlager {LAGER} bleibt stehen: der Tausch brach in der "
                      f"Mitte ab, dort koennte der ALTE Inhalt eines Baumes liegen.")
        box.zu()
        b.sag(f"(Arbeitsordner bleibt liegen: {arbeitsordner})")
        b.ausgeben()


if __name__ == "__main__":
    sys.exit(main())
