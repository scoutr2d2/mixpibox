#!/usr/bin/env node
/**
 * Die NEUE Oberflaeche ansehen, ohne eine Box zu haben.
 *
 * WOZU: `NewDesign/index.html` laesst sich zwar mit Doppelklick oeffnen, aber
 * ueber `file://` scheitert JEDER Abruf — die Seite bleibt beim „wird geladen"
 * stehen. Wer etwas an ihr aendert, muesste sonst jedes Mal bauen und auf die
 * Box schieben, nur um zu sehen, ob ein Bild an der richtigen Stelle steht.
 * Das dauert Minuten und man macht es deshalb nicht.
 *
 * Hier laeuft in einer Sekunde ein Server mit ERFUNDENEN Antworten, der genau
 * die Endpunkte bedient, die die Seite braucht. Man sieht sofort, was man
 * gebaut hat — und kann den Zustand umschalten, um beide Faelle zu pruefen.
 *
 * WAS ES NICHT TUT
 *   * Es spielt nichts ab und redet mit keiner Box. Alle Antworten sind
 *     erfunden; ein Tipp auf eine Kachel bewegt nichts.
 *   * Es ersetzt KEINE Pruefung auf dem Geraet. Ob es auf 800x480 hinter
 *     Chromium taugt, sagt nur die Box.
 *   * Es taugt nicht als Server fuer irgendetwas anderes. Reine Vorschau,
 *     nur auf der Rueckschleife.
 *
 * AUFRUF
 *     node tools/neu-vorschau.mjs                # http://localhost:8299/neu/
 *     node tools/neu-vorschau.mjs --port 9000
 *
 * ZUSTAND UMSCHALTEN, waehrend es laeuft:
 *     curl localhost:8299/vorschau/nachricht-eine  # eine Nachricht liegt an
 *     curl localhost:8299/vorschau/nachricht-zwei  # zwei (die aeltere zuerst)
 *     curl localhost:8299/vorschau/nachricht-keine # wieder keine
 *     curl localhost:8299/vorschau/spielt        # MixPi singt
 *     curl localhost:8299/vorschau/pause         # angehalten
 *     curl localhost:8299/vorschau/still         # nichts laeuft
 *     curl localhost:8299/vorschau/spotify       # Spotify spielt Werk 1, Titel 7
 *     curl localhost:8299/vorschau/mpv-weiter      # mpv rueckt eine Folge vor
 *     curl localhost:8299/vorschau/mpv-erste      # zurueck auf Folge 1
 *     curl localhost:8299/vorschau/laeuft-aus     # /player/local OHNE das
 *                                    Start-Gedaechtnis `laeuft` (alter Server)
 *     curl localhost:8299/vorschau/laeuft-an      # wieder mit (der Alltag)
 *     curl localhost:8299/vorschau/spotify-weiter  # naechster Titel (anderes
 *                                                  # item.uri, anderes Cover)
 *     curl localhost:8299/vorschau/spotify-lose  # ein Titel, der zu KEINEM
 *                                                # ganzen Album gehoert
 *     curl localhost:8299/vorschau/nachlauf      # mpv spielt, /player/state
 *                                                # traegt noch den ALTEN Spotify-
 *                                                # Zusammenhang (siehe unten)
 *     curl localhost:8299/vorschau/kontext-spotify:album:<id>   # anderer
 *                                                # context.uri, z. B. der einer
 *                                                # zweiten Quelle
 *     curl localhost:8299/vorschau/kontext-standard             # zurueck
 *     curl localhost:8299/vorschau/doppelt-an    # dieselbe Playlist steht
 *                                                # ZWEIMAL im Katalog (music +
 *                                                # audiobook), EIN Schluessel
 *     curl localhost:8299/vorschau/doppelt-aus   # wieder einfach
 *     curl localhost:8299/vorschau/alben-{voll|leer|angeschnitten}
 *     curl localhost:8299/vorschau/ohne-cover    # Werke ohne Coverangabe
 *     curl localhost:8299/vorschau/leer          # Bibliothek ist leer
 *     curl localhost:8299/vorschau/kaputt        # /api/werke antwortet mit 500
 *     curl localhost:8299/vorschau/fehlt         # /api/werke gibt es nicht (404)
 *     curl localhost:8299/vorschau/voll          # wieder normal
 *     curl localhost:8299/vorschau/inhalt-{voll|leer|kaputt|fehlt}
 *     curl localhost:8299/vorschau/kinderzeit    # Abspielen mit 403 abgelehnt
 *     curl localhost:8299/vorschau/abgelehnt     # Abspielen misslingt allgemein
 *     curl localhost:8299/vorschau/ok            # Abspielen geht wieder
 *     curl localhost:8299/vorschau/anhalten-{bestaetigt|nichts-zu-tun|
 *          fehlgeschlagen|frist-abgelaufen|alt}  # wie `stop` ausgeht; `alt`
 *                                                # laesst das Feld ganz weg
 *     curl localhost:8299/vorschau/verlauf-leer  # „Weiterhoeren" hat nichts
 *     curl localhost:8299/vorschau/sperre-aus     # Eltern-Bereich geht ohne
 *                                                # Frage auf (die VORGABE)
 *     curl localhost:8299/vorschau/sperre-pin     # Ziffernfeld; die PIN ist
 *                                                # 2468 (die des Entwurfs)
 *     curl localhost:8299/vorschau/sperre-rechnen # Rechenaufgabe
 *     curl localhost:8299/vorschau/sperre-geste   # die vier Ecken im
 *                                                 # Uhrzeigersinn
 *     curl localhost:8299/vorschau/sperre-fehlt   # der Schluessel steht GAR
 *                                                 # NICHT in der Konfiguration
 *                                                 # — der Fall der Box .169
 *     curl localhost:8299/vorschau/sperre-leer    # der Schluessel steht da,
 *                                                 # aber leer
 *     curl localhost:8299/vorschau/sperre-kaputt  # /api/config antwortet 500
 *                                                # -> laut Vertrag „aus"
 *     curl localhost:8299/vorschau/bt-{getrennt|verbunden|aus|weg}
 *     curl localhost:8299/vorschau/bt-suche-kaputt # die Suche misslingt (503)
 *     curl localhost:8299/vorschau/bt-zurueck    # Kopplungen wieder loesen und
 *                                                # die Suche vergessen
 *     curl localhost:8299/vorschau/bt-tat-kaputt   # Koppeln/Verbinden sagt
 *                                                # nein — mit HTTP 200 und
 *                                                # ok:false, wie die Box
 *     curl localhost:8299/vorschau/verlauf-voll  # wieder mit Eintraegen
 *     curl localhost:8299/vorschau/frei-an       # ein freigeschalteter Interpret
 *                                                # OHNE eigene Werke (Alin Coen)
 *     curl localhost:8299/vorschau/frei-aus      # wieder nur die Automatik
 *     curl localhost:8299/vorschau/nein-an       # „Kiddinx" abgelehnt, faellt raus
 *     curl localhost:8299/vorschau/nein-aus      # Ablehnung zuruecknehmen
 *     curl localhost:8299/vorschau/disko-aus     # Interpretenseite ohne Diskografie
 *     curl localhost:8299/vorschau/disko-an      # mit Alben und Singles
 *     curl localhost:8299/vorschau/top-weg       # „Beliebteste Titel" faellt aus
 *     curl localhost:8299/vorschau/top-da        # wieder da
 *     curl localhost:8299/vorschau/profil-gast   # niemand gewaehlt (Normalfall)
 *     curl localhost:8299/vorschau/profil-liam   # ein Kind ist angemeldet
 *     curl localhost:8299/vorschau/profil-allein # NUR der Gast — der heutige
 *                                                # Stand der Box; die Auswahl
 *                                                # zeigt dann keine Profilreihe
 *     curl localhost:8299/vorschau/figuren-keine # der Figurenordner ist leer
 *                                                # (VORGABE, so steht es heute)
 *     curl localhost:8299/vorschau/figuren-da    # zehn Figuren, die es gibt
 *     curl localhost:8299/vorschau/figuren-viele # der ECHTE Ordner (78 Stueck)
 *     curl localhost:8299/vorschau/figuren-fehlt # zehn Namen ohne Datei — das
 *                                                # <img> schlaegt fehl und die
 *                                                # Silhouette muss stehen
 *     curl localhost:8299/vorschau/wlan-wps-kaputt   # WPS laesst sich nicht
 *                                                # starten (503)
 *     curl localhost:8299/vorschau/wlan-zurueck  # nach einem geprobten
 *                                                # Wechsel wieder am alten Netz
 *     curl localhost:8299/vorschau/netz-{gut|mittel|schwach}   # Funkbalken
 *     curl localhost:8299/vorschau/netz-kabel    # Kabel hat Vorrang
 *     curl localhost:8299/vorschau/netz-ohne-internet  # Netz da, Wolke durch
 *     curl localhost:8299/vorschau/netz-weg      # /api/netzwerk faellt aus
 *     curl localhost:8299/vorschau/hat-{akku|laedt}    # MuPiHAT vorhanden
 *     curl localhost:8299/vorschau/hat-weg       # Box OHNE MuPiHAT
 *     curl localhost:8299/vorschau/akkuverlauf-voll   # sieben Tage mit
 *                                                # Laden, Entladen und den
 *                                                # Naechten, in denen die Box
 *                                                # AUS war (die Luecken)
 *     curl localhost:8299/vorschau/akkuverlauf-flach  # Box haengt durchgehend
 *                                                # am Netz: die Kurve ist eine
 *                                                # Gerade bei 100 %, und die
 *                                                # Kapazitaet ist unbekannt
 *     curl localhost:8299/vorschau/akkuverlauf-duenn  # zwei Messpunkte — zu
 *                                                # wenig fuer eine Kurve
 *     curl localhost:8299/vorschau/akkuverlauf-leer   # gar kein Messwert
 *     curl localhost:8299/vorschau/akkuverlauf-fehlt  # der Weg antwortet 404 —
 *                                                # eine Box mit aelterem Server
 *     curl localhost:8299/vorschau/akku-15       # Fuellstand in Prozent
 *     curl localhost:8299/vorschau/name-mitbox   # „VorschauBox" -> zwei Zeilen
 *     curl localhost:8299/vorschau/name-ohnebox  # „MixPiZwei"   -> eine Zeile
 *     curl localhost:8299/vorschau/name-lang     # ein Name, der umbrechen muss
 *     curl localhost:8299/vorschau/fassung-unsauber  # Bau aus geaendertem Baum
 *     curl localhost:8299/vorschau/fassung-sauber    # zurueck zum Regelfall
 *     curl localhost:8299/vorschau/schlummer-an  # ein Schlummer-Timer laeuft
 *     curl localhost:8299/vorschau/schlummer-aus # keiner laeuft
 *     curl localhost:8299/vorschau/vorlesen-aus       # die Box schweigt (Vorgabe)
 *     curl localhost:8299/vorschau/vorlesen-antippen  # ein Tipp spricht, dann Musik
 *     curl localhost:8299/vorschau/spiele-aus        # die Spielecke bleibt zu
 *     curl localhost:8299/vorschau/start-letztes     # letztes Profil macht weiter
 *     curl localhost:8299/vorschau/gast-aus          # Gast ab -> Kaltstart fragt
 *     curl localhost:8299/vorschau/start-fragen      # „Wer hoert?" (Vorgabe)
 *     curl localhost:8299/vorschau/gestartet         # was ueber /api/spielen lief
 *     curl localhost:8299/vorschau/gestartet-leeren
 *     curl localhost:8299/vorschau/spiele-an         # und wieder auf (Vorgabe)
 *     curl localhost:8299/vorschau/spielstimme-an    # der Spielbereich spricht
 *     curl localhost:8299/vorschau/spielstimme-aus   # er schweigt (Vorgabe)
 *     curl localhost:8299/vorschau/nurspiel-memory   # nur „Paare" ist an ->
 *                                                    # die Taste startet es ohne Auswahl
 *     curl localhost:8299/vorschau/alle-spiele       # alle vier wieder an (Vorgabe)
 *     curl localhost:8299/vorschau/kein-spiel        # jedes einzeln aus ->
 *                                                    # die Tuer bleibt zu
 *     curl localhost:8299/vorschau/app-aus-malen     # „Malen" faellt aus der
 *                                                    # Schublade
 *     curl localhost:8299/vorschau/app-aus-alle      # die Schublade bleibt leer
 *     curl localhost:8299/vorschau/alle-apps         # alle sechs wieder (Vorgabe)
 *     curl localhost:8299/vorschau/vorlesen-lernen    # erst Silben, dann der
 *                                                     # zweite Tipp spielt
 *     curl localhost:8299/vorschau/vorlesen-ohne-piper # eingeschaltet, aber
 *                                                     # `bereit: false`
 *     curl localhost:8299/vorschau/gesprochen         # was gesagt wurde + Daempfung
 *     curl localhost:8299/vorschau/gesprochen-leeren
 *     curl localhost:8299/vorschau/kz-an         # Kinderzeit scharf, Konto halb weg
 *     curl localhost:8299/vorschau/kz-aus        # Kinderzeit aus (Vorgabe)
 *     curl localhost:8299/vorschau/kz-knapp      # nur noch 3 Minuten uebrig
 *     curl localhost:8299/vorschau/kz-leer       # aufgebraucht (0 Minuten)
 *     curl localhost:8299/vorschau/kz-gesperrt   # heute gesperrter Wochentag,
 *                                                # Guthaben trotzdem voll
 *     curl localhost:8299/vorschau/kz-zufrueh    # Fenster geht erst spaeter auf
 *     curl localhost:8299/vorschau/kz-offen      # scharf, heute aber ohne Grenze
 *     curl localhost:8299/vorschau/kz-nur-fenster # nur ein Fenster, kein Konto
 *     curl localhost:8299/vorschau/dauer-da      # Titellisten mit Laenge
 *     curl localhost:8299/vorschau/dauer-weg     # ohne Laenge (lokale Alben)
 *     curl localhost:8299/vorschau/dauer-null    # Laenge 0 — etwas anderes als „fehlt“
 *     curl localhost:8299/vorschau/licht-da      # Schirmhelligkeit: Panel da
 *     curl localhost:8299/vorschau/licht-weg     # kein Panel (da:false)
 *     curl localhost:8299/vorschau/licht-geklemmt # Anzeige 20 %, Schirm schwarz
 *     curl localhost:8299/vorschau/licht-stur    # das Setzen scheitert (500)
 *     curl localhost:8299/vorschau/licht-unlesbar # Geraet da, Wert nicht lesbar
 *     curl localhost:8299/vorschau/licht-35      # auf 35 % stellen
 *       (VERWALTUNG, Seite „Kinderzeit". NICHT zu verwechseln mit
 *        /vorschau/kinderzeit — das laesst den ABSPIELBEFEHL an 403 scheitern
 *        und sagt nichts ueber die Regeln.)
 *     curl localhost:8299/vorschau/schlummer-stur # laeuft und laesst sich
 *                                                 # NICHT abbrechen (POST 500)
 *       (VERWALTUNG, Seite „Kinderzeit": die Karte sieht in allen Faellen
 *        voellig anders aus — Zahlenfeld und „Timer starten" gegen „Ein Timer
 *        laeuft" und „Timer abbrechen"; „stur" ist der einzige Fall, in dem
 *        der Fehlerzweig des Abbrechens ueberhaupt zu sehen ist)
 *
 * DIE GANZE LAGE LESEN UND WIEDER HINLEGEN — fuer Werkzeuge, die sich eine
 * schon laufende Vorschau LEIHEN und sie nicht verstellt zuruecklassen duerfen:
 *     curl localhost:8299/vorschau/lage             # Schnappschuss (GET)
 *     curl -X POST --data @lage.json localhost:8299/vorschau/lage   # hinlegen
 * Der bequeme Weg dorthin ist `tools/leihgabe.mjs` (`vorschauLeihen`), nicht
 * der Aufruf von Hand.
 *
 * WAS DIE SEITE MELDET, steht auf der Konsole: `POST /api/weiterhoeren <- …`
 * zeigt Titelnummer und Sekunden, so wie sie hinausgehen. Das ist die einzige
 * Stelle, an der eine vertauschte Einheit VOR der Box auffaellt.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Die Steuerbefehle, die der echte Verteiler kennt (spotify-control.ts).
 * Namen mit Doppelpunkt sind VORSAETZE (`tracknr:3`, `setvolume:40`).
 * Gegenprobe und Herkunft: `tools/player-befehle.py`.
 */
const BEKANNTE_BEFEHLE = new Set([
  'play',
  'pause',
  'stop',
  'next',
  'previous',
  '+5',
  '-5',
  'seek+30',
  'seek-30',
  'setvolume:',
  'seekpos:',
  'shuffleon',
  'shuffleoff',
  'albumstop',
  'tracknr:',
  'spotify:',
  'shutoff',
  'reboot',
  'index',
  'networkrestart',
  'enablewifi',
  'clearresume',
  'maxresume',
  'recordon',
  'recordoff',
])

const HIER = fileURLToPath(new URL('.', import.meta.url))
const SEITE = join(HIER, '..', 'NewDesign')

/**
 * DIE STARTBEFEHLE — AUS DEM VERTEILER GELESEN, NICHT ABGESCHRIEBEN.
 *
 * Ein Startbefehl heisst nicht `play`, sondern traegt sein VERB im Pfad:
 * `radio/<adresse>/…`, `jellyfin/<adresse>/…`, `ard/<adresse>/…`. Der Name am
 * Ende ist bei ihnen der Titel, taugt also nicht zum Vergleich.
 *
 * HIER STAND DIESE LISTE BIS ZUM 04.08.2026 VON HAND, und sie war beim
 * sechsten Dienst prompt unvollstaendig: `ard`/`ardqueue` fehlten. Die Folge
 * ist die schlimmste, die eine Attrappe haben kann — sie sagt NEIN, wo die
 * Box JA sagt. Ein richtig gebauter ARD-Start bekam hier 400 und die Meldung
 * „Das hat gerade nicht geklappt", also einen Fehlalarm an genau der Stelle,
 * an der jemand einen echten Fehler sucht. Dieselbe Bauart wie
 * [attrappe-luegt-durch-weglassen], nur andersherum.
 *
 * Gelesen werden beide Formen, mit denen der Verteiler auf ein Verb prueft —
 * dieselben zwei, die auch `tools/player-befehle.py` liest (`dir_zweige`).
 *
 * LAUT SCHEITERN, NICHT AUSWEICHEN: Ohne Verteiler gaebe es nur die Wahl
 * zwischen einer zweiten Liste (die wieder veraltet) und „alles erlauben"
 * (dann prueft die Attrappe wieder nichts). Beides ist schlechter als ein
 * Abbruch beim Start.
 */
const START = (() => {
  const datei = join(HIER, '..', 'src/backend-player/src/spotify-control.ts')
  const text = readFileSync(datei, 'utf8')
  const verben = new Set()
  for (const m of text.matchAll(/verb\s*===\s*'([^']+)'/g)) verben.add(m[1])
  for (const m of text.matchAll(/command\.dir\.includes\('([^']+)'\)/g)) verben.add(m[1].replace(/\/$/, ''))
  if (verben.size < 5) {
    throw new Error(
      `spotify-control.ts: nur ${verben.size} Startverben gefunden — hat der Verteiler seine Form geaendert?`,
    )
  }
  return [...verben]
})()

const port = Number(process.argv[process.argv.indexOf('--port') + 1]) || 8299

/**
 * JEDER SPIELERBEFEHL MIT ZEITSTEMPEL — abrufbar unter /vorschau/befehle.
 *
 * WARUM ES DAS SEIT 03.08.2026 GIBT: Der gemeldete Fehler „es spielt, zeigt
 * aber keinen Fortschritt und der Knopf bleibt auf play" liegt NICHT in dem,
 * WAS die Oberflaeche schickt, sondern WIE SCHNELL HINTEREINANDER. Am Geraet
 * gemessen ([[weiterhoeren-stop-und-start-im-wettlauf]]): `stop` und der
 * Startbefehl gehen in `weiterSpielen` ohne Abstand hinaus; `stop()` im
 * Abspieldienst ruft `spotifyApi.pause()` und wartet das Versprechen NICHT ab.
 * Zwei Netzaufrufe an Spotify, rund 10 ms auseinander — und mal gewinnt der
 * eine, mal der andere.
 *
 * Eine Attrappe, die Befehle nur quittiert, kann das nicht fangen. Sie muss
 * die ABSTAENDE festhalten. Wieder [attrappe-luegt-durch-weglassen]: diesmal
 * fehlte weder ein Feld noch eine Sorte, sondern die ZEIT ZWISCHEN zwei
 * richtigen Befehlen.
 *
 * Es sind bewusst nur die letzten hundert: die Vorschau laeuft stundenlang,
 * und ein unbegrenztes Protokoll waere ein Leck.
 */
const BEFEHLSPROTOKOLL = []
const BEFEHLE_HOECHSTENS = 100

/**
 * JEDER SATZ, DEN DIE BOX SPRECHEN WUERDE — abrufbar unter /vorschau/gesprochen.
 *
 * WARUM DAS SEIN MUSS (04.08.2026): Die neue Oberflaeche hat bis heute
 * ueberhaupt nicht gesprochen. Ob sie es jetzt tut, laesst sich am Bildschirm
 * NICHT sehen — Sprache ist der einzige Ausgang dieser Box, der kein Pixel
 * bewegt. Eine Attrappe, die `/api/vorlesen/sprich` nur mit 200 quittiert,
 * bewiese, dass etwas abgerufen wurde, aber nicht WAS gesagt wird. Und genau
 * das war der Wunsch des Benutzers: die Stimme soll sagen, was der Tipp TUT.
 *
 * MITGESCHRIEBEN WIRD AUCH DIE DAEMPFUNG (`/api/ton/daempfen`). Sie ist die
 * Halbe, die man vergisst: Ein an ohne aus laesst die Musik fuer immer leise,
 * und das faellt erst am Geraet auf — dann aber als „die Box ist kaputt".
 */
/**
 * DIE WERKLISTE DER ATTRAPPE — dieselben Kennungen wie im Server
 * (`SPIELE_WERKE` in src/backend-api/src/spiele.ts).
 *
 * Sie steht hier NOCHMAL und nicht als Import: Die Vorschau laeuft ohne
 * gebauten Server und soll das auch. Dafuer wacht `tools/spiele-liste-
 * deckung.py` darueber, dass die beiden Listen dieselben Kennungen tragen —
 * zwei Orte, eine Wahrheit, und eine Wache dazwischen.
 */
const APP_WERKE_VORSCHAU = [
  { id: 'memory', name: 'Memory', was: 'Kartenpaare aus der Bibliothek.' },
  { id: 'puzzle', name: 'Puzzle', was: 'Ein Bild in Teilen.' },
  { id: 'rechnen', name: 'Rechnen', was: 'Plus und Minus.' },
  { id: 'uhr', name: 'Uhr', was: 'Zeiger stellen und ablesen.' },
  { id: 'lesen', name: 'Lesen', was: 'Woerter mitlesen.' },
  { id: 'malen', name: 'Malen', was: 'Eine leere Flaeche und ein Stift.' },
]

const SPIEL_WERKE_VORSCHAU = [
  { id: 'schlange', name: 'Schlange', was: 'Der Klassiker mit dem Steuerkreuz.' },
  { id: 'memory', name: 'Paare', was: 'Zwoelf Karten, sechs Paare.' },
  { id: 'dreigewinnt', name: 'Drei gewinnt', was: 'Drei in einer Reihe gegen die Box.' },
  { id: 'farben', name: 'Farben merken', was: 'Die Folge nachtippen.' },
]

/** Was GET/PUT /api/spiele antwortet — an einer Stelle, damit beide gleich sind. */
function spieleAntwort() {
  const spiele = {}
  for (const w of SPIEL_WERKE_VORSCHAU) spiele[w.id] = !lage.nurSpiel || lage.nurSpiel === w.id
  const apps = {}
  for (const w of APP_WERKE_VORSCHAU) apps[w.id] = lage.appAus !== w.id && lage.appAus !== 'alle'
  return {
    an: lage.spiele !== 'aus',
    vorlesen: lage.spielstimme === 'an',
    spiele,
    apps,
    werke: SPIEL_WERKE_VORSCHAU,
    appWerke: APP_WERKE_VORSCHAU,
  }
}

const SPRECHPROTOKOLL = []
/**
 * JEDER START — abrufbar unter /vorschau/gestartet.
 *
 * WOZU ES DAS BRAUCHT (19.09.2026): Es gab schon ein Befehlsprotokoll, aber
 * das haelt SPIELERBEFEHLE fest (/player/…). Ein Tipp auf eine Kachel geht
 * jedoch ueber `POST /api/spielen` und erzeugt keinen einzigen davon. Eine
 * Messung, die „es wurde nichts gestartet" am Befehlsprotokoll pruefte,
 * konnte deshalb GAR NICHT scheitern — sie sah in ein Buch, in dem dieser
 * Vorgang nie steht. Genau so blieb eine Gegenprobe zweimal gruen.
 */
const SPIELPROTOKOLL = []
const DAEMPFUNG = []

/** Was die Vorschau gerade vorgibt. Ueber /vorschau/... umschaltbar. */
// `fremd: false` STEHT HIER AUSDRUECKLICH und nicht bloss als fehlendes Feld —
// wie jeder andere Hebel dieser Zeile auch. Diese Lage wird NICHT von selbst
// zurueckgesetzt: wer `mpv-fremd` umlegt, legt es mit `mpv-eigen` selbst
// wieder um, sonst laeuft der Zustand in den naechsten Testfall hinein.
/**
 * WAS AN NACHRICHTEN LIEGT — umschaltbar ueber `/vorschau/nachricht-<was>`.
 *
 * Die ZEITEN sind relativ zum Start der Vorschau und nicht fest: die Karte
 * zeigt keine Uhrzeit, aber die REIHENFOLGE haengt daran (gezeigt wird die
 * AELTESTE ungelesene). Feste Zahlen wuerden sie zwar auch ordnen — nur
 * saehe man einem Lauf dann nicht an, dass die Reihenfolge ueberhaupt
 * geprueft wird.
 */
const NACHRICHTEN = []

function nachrichtenSetzen(was) {
  NACHRICHTEN.length = 0
  const jetzt = Date.now()
  if (was === 'keine') return
  // DIE AELTERE STEHT HINTEN, weil die echte Liste neueste zuerst liefert.
  // Eine Attrappe, die schon so sortiert, wie die Oberflaeche es haben will,
  // prueft deren Sortierung nicht mehr.
  if (was === 'zwei') {
    NACHRICHTEN.push(
      { id: 'v2', weg: 'matrix', absender: '@mama:server.example', absenderName: 'Mama',
        text: 'Zweite: wir sind gleich da.', zeit: jetzt - 60_000, gelesen: false, gesprochen: true },
      { id: 'v1', weg: 'signal', absender: '+491700000000', absenderName: 'Papa',
        text: 'Erste: gute Nacht!', zeit: jetzt - 600_000, gelesen: false, gesprochen: true },
    )
    return
  }
  NACHRICHTEN.push({
    id: 'v1', weg: 'matrix', absender: '@mama:server.example', absenderName: 'Mama',
    text: 'In zehn Minuten gibt es Essen!', zeit: jetzt - 60_000, gelesen: false, gesprochen: true,
  })
}

const lage = {
  /**
   * DIE HALTEDAUER DES AUSSCHALT-KNOPFS, als Zeichenkette wie auf der Box.
   *
   * `mupiboxconfig.json` fuehrt `timeout.pressDelay` als STRING ("2"), und
   * `feldNachAussen` gibt ihn so weiter. Hier eine Zahl zu fuehren waere die
   * bequeme Attrappe: die Oberflaeche bekaeme etwas, das sie auf keiner Box
   * je sieht, und ein `Number(f.wert)`, das an einem String scheitert, faende
   * hier niemand.
   */
  druckdauer: '2',
  spielt: 'spielt',
  fremd: false,
  spotifyTitel: 0,
  mpvTitel: 3,
  /**
   * Liefert /player/local das Feld `laeuft` (Start-Gedaechtnis des Servers,
   * laufendes-werk.ts)? 'an' ist der Alltag seit 12.09.2026; 'aus' ist der
   * aeltere Server — die Oberflaeche muss dann auf ihre Seiten-Gedaechtnisse
   * zurueckfallen, und NUR mit diesem Schalter laesst sich der Rueckfall
   * ueberhaupt noch messen.
   */
  laeuftServer: 'an',
  /**
   * WAS der Server sich gemerkt hat — GEKOPPELT an den /api/spielen-Stub,
   * nicht hingeschrieben: Der erste Wurf nannte hier starr „Die Maus", und
   * tools/marke-ohne-eigenen-start.mjs startete die ARD-Sendung — die
   * Oberflaeche markierte daraufhin das FALSCHE Werk, und zwar mit dem
   * staerksten Beweis. Eine Attrappe, die sich nicht wie der Server an den
   * eigenen Start haelt, prueft nicht zu wenig, sie prueft das Gegenteil.
   * Der Startwert ist „Die Maus" (vorschau:0), weil genau sie der
   * /player/local-Grundzustand dieser Vorschau seit jeher als laufend meldet.
   */
  gestartet: { werk: 'vorschau:0', quelle: 'lokal', titel: null },
  kontext: 'standard',
  cover: true,
  liste: 'voll',
  spieler: 'ok',
  inhalt: 'voll',
  verlauf: 'voll',
  bt: 'getrennt',
  /**
   * Das WLAN-Fach des Eltern-Bereichs:
   *   ok                  alles gut
   *   weg                 der Suchlauf antwortet nicht (503)
   *   falsch              das Passwort wird abgelehnt (400 mit Grund)
   *   ungesichert         verbinden gelingt, aber OHNE Totmannschalter —
   *                       der Fall, in dem es keinen automatischen Rueckweg
   *                       gibt und die Oberflaeche das sagen muss
   *   bestaetigen-kaputt  die Bestaetigung kommt nicht an
   *
   * `kommtnicht` und `ungesichert` gelten auch fuer den Weg OHNE Passwort
   * (`/api/netzwerk/gespeichert/verbinden`, 13.09.2026) — es ist derselbe
   * Wechsel mit derselben Rueckfall-Sicherung, also derselbe Hebel.
   */
  wlan: 'ok',
  /**
   * Das VPN-Fach des Eltern-Bereichs (E30, 13.09.2026):
   *   ok               eingerichtet; ob der Tunnel steht, sagt VPN_STAND
   *   werkzeug-fehlt   wireguard-tools ist nicht installiert — die Seite
   *                    darf dann NUR das sagen, keine Schalter
   *   leer             Werkzeug da, aber kein Heimweg eingerichtet — die
   *                    frisch aufgesetzte Box; der Text muss zur Verwaltung
   *                    zeigen, denn hier gibt es keinen Datei-Upload
   *   nie              Tunnel an, aber die Gegenstelle antwortet nicht
   *                    (falscher Endpunkt/Schluessel/Freigabe): urteil 'nie'
   *   stand            Tunnel an, Handschlag ist ALT (Heimnetz weg)
   *   schalten-kaputt  POST /api/vpn/aktiv scheitert (503 mit Grund)
   *   weg              GET /api/vpn antwortet nicht (503)
   */
  vpn: 'ok',
  /**
   * UEBER WELCHEN WEG DIE BOX ERREICHBAR IST — die Lage der Funkschalter.
   *
   * SIE IST NICHT DER ZUSTAND DER SENDER (der steht in `FUNK_STAND`), sondern
   * die Antwort auf die einzige Frage, die ueber „Knopf oder kein Knopf"
   * entscheidet: kommt nach dem Abschalten noch jemand an die Box?
   *
   *   nur-wlan   VORGABE UND DER ALLTAGSFALL DIESER BOX: alles laeuft ueber
   *              wlan0, eth0 hat keine Adresse. `ausErlaubt: false`,
   *              `vonDerBox: false` — dort gehoert KEIN Knopf hin, sondern
   *              der Grund als Satz. Ein Knopf, der 409 kassiert, ist
   *              schlechter als keiner.
   *   kabel      eth0 traegt. Abschalten erlaubt, die Rueckfrage MUSS die
   *              Adresse nennen — und dazusagen, dass eine ueber WLAN
   *              gefuehrte Sitzung trotzdem abreisst.
   *   vorort     kein zweiter Weg, aber der Aufruf kommt von der Box selbst.
   *              Erlaubt NUR, wenn die Anfrage `vorOrt: true` mitschickt.
   *
   * Die Vorgabe ist mit Absicht die STRENGSTE: wer nur den bequemen Fall
   * ansieht, misst eine Oberflaeche mit Knoepfen, die es an dieser Box gar
   * nicht geben darf.
   */
  funk: 'nur-wlan',
  /**
   * WELCHE EINGABEGERAETE AM BUS HAENGEN (`GET /api/eingabegeraete`):
   *   keine    nichts angeschlossen — DER STAND DER BOX, also die Vorgabe
   *   pad      ein Controller
   *   fb       eine Fernbedienung
   *   beide    je eines
   *
   * Die Oberflaeche macht daraus die zwei Zeichen in der Kopfzeile
   * (`st-pad`, `st-fb`). Sie misst AM EINGABE-BUS und nicht an der
   * Bluetooth-Kopplung — ein gekoppeltes Geraet, das kein Eingabegeraet
   * stellt, steuert nichts, und ein Zeichen dafuer waere eine falsche
   * Beruhigung (NewDesign/app.js, `eingabeHolen`).
   */
  eingabe: 'keine',
  /**
   * WAS DIE BOX BEIM KALTSTART TUT (`GET /api/start`, 20.09.2026):
   *   'fragen'   nach dem Kaltstart kommt „Wer hoert?" — DER BESTAND
   *   'letztes'  das zuletzt gewaehlte Profil macht weiter
   *
   * `fragen` als Vorgabe, weil der Server es ebenso haelt. Eine Attrappe,
   * die hier `letztes` voreinstellte, beschriebe einen Zustand, den keine
   * Box hat — und jede Messung am Startverhalten waere eine Aussage ueber
   * eine Fassung, die es nicht gibt.
   */
  start: 'fragen',
  /**
   * IST DER GAST ABGESCHALTET (`gastAktiv` in der Profil-Antwort)?
   *
   * BIS ZUM 20.09.2026 SCHICKTE DIESE ATTRAPPE DAS FELD GAR NICHT — und
   * damit war der KALTSTART hier nie vorfuehrbar: Die Oberflaeche zeigt ihr
   * „Wer hoert?"-Fenster nur, wenn `gastAktiv === false` ankommt. Eine
   * ganze Verhaltensklasse (die Anmeldung samt Schloss) lag also ausserhalb
   * dessen, was sich an der Vorschau messen liess, ohne dass es auffiel.
   *
   * 'an' bleibt die Vorgabe: so verhaelt sich eine frisch aufgesetzte Box.
   */
  gast: 'an',
  /**
   * DIE SCHLANGE DER FERNBEDIENUNG (`/api/fernbedienung/anweisung`).
   *
   * Die Oberflaeche fragt sie im Takt ab und FUEHRT AUS, was sie bekommt;
   * der echte Server ENTNIMMT dabei (sonst liefe dieselbe Anweisung in jedem
   * Takt erneut) und ueberspringt Verfallenes. Beides bildet die Attrappe
   * nach, denn genau daran haengt, ob ein Werkzeug einen Tastendruck
   * vorfuehren kann, ohne dass er sich wiederholt.
   */
  fernAnweisungen: [],
  /**
   * Die Unterseite „Dienste" der Gruppe „Medien":
   *   ok            beide eingerichtet und erreichbar
   *   spotify-weg   Spotify eingerichtet, api.spotify.com antwortet nicht
   *   jellyfin-weg  Jellyfin eingerichtet, der Server antwortet nicht
   *   leer          nichts eingerichtet — die frisch aufgesetzte Box
   *   unpruefbar    Spotify antwortet mit einem Fehler; `/api/spotify/bereit`
   *                 sagt dann ausdruecklich `bereit: true, grund:
   *                 'nicht-pruefbar'`, und die Zeile darf das NICHT als
   *                 „bereit" ausgeben (server.ts, ausfuehrlich begruendet)
   */
  musikdienste: 'ok',
  /**
   * Was `POST /api/reboot`, `/api/shutdown` und `/api/oberflaeche/neuladen`
   * antworten:
   *   ok       200 (die Box nimmt es an)
   *   kaputt   500 (der Aufruf misslingt — dann darf am Schirm NICHT stehen,
   *            dass die Box neu startet)
   */
  strom: 'ok',
  /** Wie oft in diesem Lauf ein Neustart/Ausschalten ANGEFORDERT wurde. Die
   *  Vorschau startet natuerlich nichts neu; sie zaehlt nur mit, damit ein
   *  Werkzeug pruefen kann, dass genau EINE Anforderung hinausgeht. */
  stromRufe: [],
  /**
   * Das Medien-Fach:
   *   voll      vier Eintraege
   *   weg       die Liste antwortet nicht (503)
   *   gesperrt  data.json ist gerade gesperrt — Aendern und Loeschen geben 409
   */
  medien: 'voll',
  laut: 40,
  maxLaut: 60,
  alben: 'voll',
  platz: 'an',
  disko: 'an',
  top: 'da',
  profil: 'liam',
  // WELCHE FIGUREN ES GIBT. `keine` ist der HEUTIGE Stand der Box: der
  // Betreiber hat noch keine erzeugt. Das ist deshalb kein Randfall, sondern
  // die Vorgabe — wer nur den vollen Fall ansieht, misst eine Oberflaeche,
  // die es an der Box (noch) nicht gibt.
  //   keine   der Ordner ist leer  -> nur „Kein Bild" steht zur Wahl
  //   da      zehn Figuren, die es WIRKLICH gibt (die Maskottchen aus
  //           bilder/) — dafuer zeigt `ordner` hier auf `bilder`
  //   fehlt   zehn Namen, die es NICHT gibt -> jedes <img> schlaegt fehl.
  //           Der Fall, um den es beim „ein fehlendes Bild darf nichts
  //           zerbrechen" wirklich geht.
  figuren: 'keine',
  /** Was zuletzt ueber POST /api/profil/figur gewaehlt wurde. */
  figurGewaehlt: null,
  /**
   * DIE LISTE, WIE SIE `PUT /api/profile` HINTERLASSEN HAT — oder `null`.
   *
   * SOLANGE SIE `null` IST, ANTWORTET DIE ATTRAPPE WIE BISHER: aus
   * `lage.profil` gebaut, drei feste Kinder. Erst wenn die Seite „Kinder"
   * (Admin-Menue, 07.08.2026) wirklich geschrieben hat, gilt das Geschriebene.
   * So bleibt jede vorhandene Aussage ueber die Vorschau gueltig und der neue
   * Weg trotzdem vorfuehrbar.
   *
   * `/vorschau/profil-<gast|liam|kalea|allein>` setzt sie zurueck — sonst
   * traegt eine Messung, die etwas angelegt hat, ihr Ergebnis in die naechste
   * ([[vorschau-wird-geliehen]]).
   */
  profileGeschrieben: null,
  netz: 'gut',
  hat: 'akku',
  akku: 64,
  akkuverlauf: 'voll',
  verschmolzen: 'aus',
  doppelt: 'aus',
  marke: 'bewegt',
  name: 'mitbox',
  fassung: 'sauber',
  schlummer: 'aus',
  vorlesen: 'aus',
  /**
   * DARF GESPIELT WERDEN (Schalter auf der Vorlesen-Seite, 19.09.2026)?
   *   'an'  die Spielecke laesst sich oeffnen — DER STAND JEDER BOX HEUTE
   *   'aus' die Anweisung `spielecke` tut nichts mehr
   *
   * `an` als Vorgabe, weil der Server es ebenso haelt: der Schluessel fehlt
   * in jeder bestehenden vorlesen.json, und `nicht gesagt` heisst dort
   * `an`. Eine Attrappe, die hier `aus` voreinstellte, beschriebe einen
   * Zustand, den keine Box hat.
   */
  spiele: 'an',
  /**
   * SPRICHT DER SPIELBEREICH (Schalter auf der Spiele-Seite, 20.09.2026)?
   *   'aus' still — DER STAND JEDER BOX HEUTE, und die Vorgabe im Server
   *   'an'  Ansage von Spielnamen, Karten, Farben, Ausgang
   *
   * `aus` als Vorgabe, weil `spieleNormalisieren` mit `=== true` arbeitet:
   * eine Attrappe, die hier spraeche, beschriebe einen Zustand, den keine
   * Box hat.
   */
  spielstimme: 'aus',
  /**
   * NUR EIN EINZIGES SPIEL eingeschaltet — leer heisst alle.
   *
   * Damit laesst sich beides vorfuehren, was die Einzelschalter ausmachen:
   * die AUSWAHL (mehrere an) und der DIREKTE START (genau eines an).
   */
  nurSpiel: '',
  /**
   * WELCHE TIPP-APP DER SCHUBLADE ABGESCHALTET IST — leer heisst keine,
   * 'alle' heisst jede. Andersherum als bei `nurSpiel`, und das mit Absicht:
   * Bei der Schublade ist der interessante Fall „eine fehlt in der Leiste",
   * bei der Spielecke „nur eine steht zur Wahl".
   */
  appAus: '',
  sperre: 'aus',
  anhalten: 'bestaetigt',
  // Steht ein Dienst still? Das Info-Kaestchen im Fach „Box" benennt den
  // ersten stehenden — der Fall war ohne diesen Schalter nicht vorzufuehren.
  dienste: 'laufen',
  // Wie gross die Bibliothek ist — 'wenige' (vier Eintraege, der Regelfall
  // dieser Attrappe) oder 'viele' (28 wie an der Box). Siehe MEDIEN_VIELE.
  medienZahl: 'wenige',
  /**
   * DIE BELOHNUNGS-VIDEOS (20.09.2026):
   *   'voll'         zwei Freigaben mit Rest — der Regelfall
   *   'leer'         nichts freigegeben; die Reihe faellt ganz weg
   *   'aufgebraucht' eine Freigabe mit Rest 0 — sie steht NICHT auf dem
   *                  Kinderschirm, und ein Start wird mit Grund abgewiesen
   */
  videos: 'voll',
  videoLauf: '',
}

/**
 * Die Freigaben der Attrappe — VERAENDERLICH, weil Verbrauchen sie aendert.
 *
 * Sie wird bei jedem Umschalten neu gebaut: eine Messung, die zweimal
 * dasselbe fahren will, bekommt sonst beim zweiten Mal den Rest des ersten.
 */
/**
 * EIN WINZIGES, ECHTES MP4 (2 s schwarz, 160x90, H.264 + AAC, 4.400 B).
 * Gebaut mit ffmpeg, hier als base64 abgelegt — siehe `/vorschau/probe.mp4`.
 * Es hat eine DAUER, und das ist der Punkt: die Oberflaeche rechnet den
 * gesehenen Anteil aus `currentTime / duration`, und ohne Dauer waere jede
 * Messung am Zaehler wertlos.
 */
const PROBE_MP4_B64 =
  'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAp3bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAABWIgAArEQAAQAA' +
  'AQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAwAABg10cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAArEQAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAA' +
  'AAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAKAAAABaAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAKxEAAAEAAABAAAAAAWF' +
  'bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAyAAAAZABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRl' +
  'b0hhbmRsZXIAAAAFMG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAA' +
  'AQAABPBzdGJsAAAAwHN0c2QAAAAAAAAAAQAAALBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAKAAWgBIAAAASAAAAAAA' +
  'AAABFExhdmM2My4xLjEwMSBsaWJ4MjY0AAAAAAAAAAAAAAAAGP//AAAANmF2Y0MBZAAL/+EAGWdkAAus2UKN+TARAAADAAEA' +
  'AAMAMg8UKZYBAAZo6+PLIsD9+PgAAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAAFygAAAAAAAAAGHN0dHMAAAAAAAAA' +
  'AQAAADIAAAIAAAAAFHN0c3MAAAAAAAAAAQAAAAEAAAGgY3R0cwAAAAAAAAAyAAAAAQAABAAAAAABAAAKAAAAAAEAAAQAAAAA' +
  'AQAAAAAAAAABAAACAAAAAAEAAAoAAAAAAQAABAAAAAABAAAAAAAAAAEAAAIAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAA' +
  'AQAAAgAAAAABAAAKAAAAAAEAAAQAAAAAAQAAAAAAAAABAAACAAAAAAEAAAoAAAAAAQAABAAAAAABAAAAAAAAAAEAAAIAAAAA' +
  'AQAACgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAABAAAKAAAAAAEAAAQAAAAAAQAAAAAAAAABAAACAAAAAAEAAAoAAAAA' +
  'AQAABAAAAAABAAAAAAAAAAEAAAIAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAABAAAKAAAAAAEAAAQAAAAA' +
  'AQAAAAAAAAABAAACAAAAAAEAAAoAAAAAAQAABAAAAAABAAAAAAAAAAEAAAIAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAA' +
  'AQAAAgAAAAABAAAEAAAAAMRzdHNjAAAAAAAAAA8AAAABAAAAAQAAAAEAAAACAAAAAgAAAAEAAAADAAAAAQAAAAEAAAAJAAAA' +
  'AgAAAAEAAAAKAAAAAQAAAAEAAAAPAAAAAgAAAAEAAAAQAAAAAQAAAAEAAAAVAAAAAgAAAAEAAAAWAAAAAQAAAAEAAAAbAAAA' +
  'AgAAAAEAAAAcAAAAAQAAAAEAAAAiAAAAAgAAAAEAAAAjAAAAAQAAAAEAAAAoAAAAAgAAAAEAAAApAAAAAQAAAAEAAADcc3Rz' +
  'egAAAAAAAAAAAAAAMgAAAuQAAAAQAAAADQAAAAwAAAAMAAAAFgAAAA8AAAAMAAAADAAAABYAAAAPAAAADAAAAAwAAAAWAAAA' +
  'DwAAAAwAAAAMAAAAFgAAAA8AAAAMAAAADAAAABYAAAAPAAAADAAAAAwAAAAWAAAADwAAAAwAAAAMAAAAFgAAAA8AAAAMAAAA' +
  'DAAAABYAAAAPAAAADAAAAAwAAAAVAAAADwAAAAwAAAAMAAAAFQAAAA8AAAAMAAAADAAAABUAAAAPAAAADAAAAAwAAAAVAAAA' +
  'vHN0Y28AAAAAAAAAKwAACqcAAA2eAAANvwAADc8AAA3fAAAN+QAADgwAAA4cAAAOLAAADlUAAA5lAAAOdQAADo8AAA6iAAAO' +
  'sgAADtgAAA7rAAAO+wAADwsAAA8lAAAPOAAAD1QAAA9uAAAPgQAAD5EAAA+hAAAPuwAAD9oAAA/qAAAQBAAAEBcAABAnAAAQ' +
  'NwAAEFAAABBvAAAQfwAAEJgAABCrAAAQuwAAEMsAABDzAAARAwAAERMAAAOVdHJhawAAAFx0a2hkAAAAAwAAAAAAAAAAAAAA' +
  'AgAAAAAAAKwAAAAAAAAAAAAAAAABAQAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAA' +
  'JGVkdHMAAAAcZWxzdAAAAAAAAAABAACsAAAABAAAAQAAAAADDW1kaWEAAAAgbWRoZAAAAAAAAAAAAAAAAAAAViIAALAAVcQA' +
  'AAAAAC1oZGxyAAAAAAAAAABzb3VuAAAAAAAAAAAAAAAAU291bmRIYW5kbGVyAAAAArhtaW5mAAAAEHNtaGQAAAAAAAAAAAAA' +
  'ACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAnxzdGJsAAAAfnN0c2QAAAAAAAAAAQAAAG5tcDRhAAAAAAAA' +
  'AAEAAAAAAAAAAAABABAAAAAAViIAAAAAADZlc2RzAAAAAAOAgIAlAAIABICAgBdAFQAAAAABDYgAAALrBYCAgAUTiFblAAaA' +
  'gIABAgAAABRidHJ0AAAAAAABDYgAAALrAAAAGHN0dHMAAAAAAAAAAQAAACwAAAQAAAAAKHN0c2MAAAAAAAAAAgAAAAEAAAAB' +
  'AAAAAQAAACsAAAACAAAAAQAAAMRzdHN6AAAAAAAAAAAAAAAsAAAAEwAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAE' +
  'AAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAE' +
  'AAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAC8' +
  'c3RjbwAAAAAAAAArAAANiwAADbsAAA3LAAAN2wAADfUAAA4IAAAOGAAADigAAA5RAAAOYQAADnEAAA6LAAAOngAADq4AAA7U' +
  'AAAO5wAADvcAAA8HAAAPIQAADzQAAA9QAAAPagAAD30AAA+NAAAPnQAAD7cAAA/WAAAP5gAAEAAAABATAAAQIwAAEDMAABBM' +
  'AAAQawAAEHsAABCUAAAQpwAAELcAABDHAAAQ7wAAEP8AABEPAAARKAAAABpzZ3BkAQAAAHJvbGwAAAACAAAAAf//AAAAHHNi' +
  'Z3AAAAAAcm9sbAAAAAEAAAAsAAAAAQAAAGF1ZHRhAAAAWW1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAA' +
  'AAAAAAAALGlsc3QAAAAkqXRvbwAAABxkYXRhAAAAAQAAAABMYXZmNjMuMS4xMDEAAAAIZnJlZQAABpFtZGF0AAACrgYF//+q' +
  '3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NSByMzIyMiBiMzU2MDVhIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAt' +
  'IENvcHlsZWZ0IDIwMDMtMjAyNSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFj' +
  'PTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4w' +
  'MDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFk' +
  'em9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTMgbG9va2FoZWFkX3RocmVhZHM9' +
  'MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFp' +
  'bmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEg' +
  'b3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTI1IHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9' +
  'MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBx' +
  'cHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAALmWIhAA7//73Tr8Cm1TCKgOSVwr2yqQmWblTfD7GshdEUH9X' +
  '2gXoBVAAI8Dq/IHcAExhdmM2My4xLjEwMQACMEAOAAAADEGaJGxDv/6plgDmgAAAAAlBnkJ4hf8A84EBGCAHAAAACAGeYXRC' +
  'vwFTARggBwAAAAgBnmNqQr8BUwEYIAcAAAASQZpoSahBaJlMCHf//qmWAOaBARggBwAAAAtBnoZFESwv/wDzgQEYIAcAAAAI' +
  'AZ6ldEK/AVMBGCAHAAAACAGep2pCvwFTARggBwAAABJBmqxJqEFsmUwId//+qZYA5oAAAAALQZ7KRRUsL/8A84EBGCAHAAAA' +
  'CAGe6XRCvwFTARggBwAAAAgBnutqQr8BUwEYIAcAAAASQZrwSahBbJlMCHf//qmWAOaBARggBwAAAAtBnw5FFSwv/wDzgQEY' +
  'IAcAAAAIAZ8tdEK/AVMBGCAHAAAACAGfL2pCvwFTAAAAEkGbNEmoQWyZTAh3//6plgDmgAEYIAcAAAALQZ9SRRUsL/8A84EB' +
  'GCAHAAAACAGfcXRCvwFTARggBwAAAAgBn3NqQr8BUwEYIAcAAAASQZt4SahBbJlMCHf//qmWAOaBARggBwAAAAtBn5ZFFSwv' +
  '/wDzgAEYIAcAAAAIAZ+1dEK/AVMAAAAIAZ+3akK/AVMBGCAHAAAAEkGbvEmoQWyZTAh3//6plgDmgAEYIAcAAAALQZ/aRRUs' +
  'L/8A84EBGCAHAAAACAGf+XRCvwFTARggBwAAAAgBn/tqQr8BUwEYIAcAAAASQZvgSahBbJlMCHf//qmWAOaBARggBwAAAAtB' +
  'nh5FFSwv/wDzgAAAAAgBnj10Qr8BUwEYIAcAAAAIAZ4/akK/AVMBGCAHAAAAEkGaJEmoQWyZTAh3//6plgDmgAEYIAcAAAAL' +
  'QZ5CRRUsL/8A84EBGCAHAAAACAGeYXRCvwFTARggBwAAAAgBnmNqQr8BUwEYIAcAAAARQZpoSahBbJlMCG///qeEAccBGCAH' +
  'AAAAC0GehkUVLC//APOBAAAACAGepXRCvwFTARggBwAAAAgBnqdqQr8BUwEYIAcAAAARQZqsSahBbJlMCG///qeEAccBGCAH' +
  'AAAAC0GeykUVLC//APOBARggBwAAAAgBnul0Qr8BUwEYIAcAAAAIAZ7rakK/AVMBGCAHAAAAEUGa8EmoQWyZTAhf//6MsAbl' +
  'AAAAC0GfDkUVLC//APOBARggBwAAAAgBny10Qr8BUwEYIAcAAAAIAZ8vakK/AVMBGCAHAAAAEUGbMUmoQWyZTAhX//44QBow' +
  'ARggBwEYIAc='

let VIDEOS = []
function videosSetzen(art) {
  /**
   * JEDE FREIGABE TRAEGT `id`, `abSek`, `bisSek`, `teil` UND `laengeSek` —
   * genau wie die echte Antwort seit dem 20.09.2026. Eine Attrappe, die den
   * Schnitt nicht kennt, prueft den Vertrag von gestern und bleibt gruen,
   * waehrend die Box ein ganzes Video statt eines Stuecks spielt.
   */
  const ganz = (v) => ({ ...v, id: v.kennung, abSek: 0, bisSek: 0, teil: '', laengeSek: v.dauerSek })
  const eins = ganz({
    kennung: 'Y3JpZDovL3dkci5kZS9wcm9iZS0x',
    name: 'Klima-Maus Teil 6',
    sendung: 'Die Maus',
    bild: '',
    dauerSek: 1626,
    anzahl: 3,
    verbraucht: 1,
    rest: 2,
    laufVerbraucht: '',
  })
  const zwei = ganz({
    kennung: 'Y3JpZDovL3dkci5kZS9wcm9iZS0y',
    name: 'Zeitreisen mit der Maus - Die 90er-Jahre',
    sendung: 'Die Maus',
    bild: '',
    dauerSek: 2640,
    anzahl: 1,
    verbraucht: 0,
    rest: 1,
    laufVerbraucht: '',
  })
  /**
   * EIN STUECK — und zwar EINE SEKUNDE des zwei Sekunden langen Probevideos.
   *
   * Die Zahlen sind so klein, weil die Messung sonst 27 Minuten dauert. Sie
   * sind trotzdem echt: `bisSek: 1` heisst, dass der Schirm bei Sekunde 1
   * anhalten MUSS, obwohl die Datei weiterlaeuft — und dass 0,9 Sekunden
   * bereits die Schwelle sind, weil sie gegen die STUECKLAENGE rechnet und
   * nicht gegen die Dauer der Datei.
   */
  const stueck = {
    kennung: 'Y3JpZDovL3dkci5kZS9wcm9iZS0x',
    id: 't0-1-probe',
    name: 'Klima-Maus Teil 6',
    sendung: 'Die Maus',
    bild: '',
    dauerSek: 2,
    abSek: 0,
    bisSek: 1,
    teil: 'Teil 1',
    laengeSek: 1,
    anzahl: 2,
    verbraucht: 0,
    rest: 2,
    laufVerbraucht: '',
  }
  /**
   * DASSELBE STUECK, ABER HINTEN — und nur dafuer da, dass der SPRUNG
   * messbar wird.
   *
   * Bei `abSek: 0` sieht ein Schirm, der gar nicht springt, genauso aus wie
   * einer, der richtig springt. Erst ein Stueck, das bei Sekunde 1 ANFAENGT,
   * trennt die beiden Faelle.
   */
  const stueckHinten = {
    ...stueck,
    id: 't1-2-probe',
    abSek: 1,
    bisSek: 2,
    teil: 'Teil 2',
    laengeSek: 1,
  }
  if (art === 'leer') VIDEOS = []
  else if (art === 'aufgebraucht') VIDEOS = [{ ...eins, anzahl: 1, verbraucht: 1, rest: 0 }]
  else if (art === 'stueck') VIDEOS = [stueck]
  else if (art === 'stueck-hinten') VIDEOS = [stueckHinten]
  else VIDEOS = [eins, zwei]
}
videosSetzen('voll')
function videoListe() {
  return VIDEOS
}

/**
 * OB EINE PIN GESETZT IST — und WELCHE.
 *
 * Sie steht hier VERAENDERLICH und nicht als Festwert, weil das Setzen einer
 * PIN seit dem 06.08.2026 an der Box passiert (`POST
 * /api/konfiguration/einstellungs-pin`). Eine Attrappe, die das Setzen
 * quittiert und danach weiter gegen 2468 prueft, haette den ganzen Weg gruen
 * gemeldet, ohne dass die neue PIN je gegolten haette.
 *
 * 2468 IST DIE PIN DES ENTWURFS (MixPiBox-standalone.html, `pinSub`) — damit
 * niemand sie fuer eine echte haelt, die irgendwo auf einer Box steht.
 */
const PIN_STAND = { gesetzt: '2468' }

/**
 * DIE ZUGAENGE DER ANBIETER — veraenderlich, seit sie an der Box eingerichtet
 * werden.
 *
 * ══ WOZU ES DIESEN BLOCK GIBT (06.08.2026) ═══════════════════════════════
 * Unter „Medien → Dienste" liegen seit heute zwei Einrichtungsseiten. Sie
 * lesen `GET /api/konfiguration` und `GET /api/spotify/config` und schreiben
 * ueber `POST /api/konfiguration` bzw. `POST /api/spotify/config`. Eine
 * Attrappe, die das Schreiben nur quittiert, laesst den ganzen Weg gruen
 * aussehen, ohne dass je gemessen waere, ob die Oberflaeche den neuen Stand
 * auch ANZEIGT — derselbe Grund wie bei der Sperrart eine Ebene weiter unten.
 *
 * ══ DIE GEHEIMNISSE STEHEN HIER UND GEHEN NICHT HINAUS ═══════════════════
 * `apiKey` und `refreshToken` stehen als Zeichenkette im Speicher dieser
 * Attrappe — damit „gesetzt / nicht gesetzt" ueberhaupt umschlagen kann. Sie
 * verlassen sie NIE: `GET /api/konfiguration` gibt fuer ein Feld der Art
 * `geheim` nur `gesetzt` heraus (wortgleich zu `feldNachAussen`,
 * konfiguration.ts), und `GET /api/spotify/config` nur ein Boolean
 * (server.ts). Wer hier einen Wert durchreichte, machte die Vorschau blind
 * fuer genau den Fehler, den die Oberflaeche machen kann.
 *
 * DIE WERTE SIND DIE DER BOX .169, ABGESCHRIEBEN AM 06.08.2026
 * (`curl :8200/api/konfiguration`, `curl :8200/api/spotify/config`):
 *     jellyfinServer     "http://192.168.178.199:8899"
 *     jellyfinSchluessel gesetzt: false   ← an dieser Box steht wirklich keiner
 *     spotifyClientId    art "text" (KEIN Geheimnis — PKCE, kein Secret)
 * Die Client-ID ist eine ERFUNDENE 32er-Folge und nicht die der Box: sie ist
 * zwar kein Geheimnis, gehoert aber trotzdem nicht in ein Werkzeug im Baum.
 */
const ZUGANG = {
  jellyfinServer: 'http://192.168.178.199:8899',
  // AN DER BOX .169 STEHT HIER KEINER (`gesetzt: false`, gemessen). Die
  // Vorschau setzt trotzdem einen — sonst waere der Zweig „ein Schlüssel ist
  // hinterlegt" samt Loeschknopf und Rueckfrage gar nicht zu sehen, und genau
  // der traegt das Geheimnis. Wer den leeren Fall braucht, nimmt
  // `curl localhost:<port>/vorschau/musikdienste-leer`.
  jellyfinApiKey: 'jellyfinschluesseldervorschau32z',
  spotifyClientId: 'aaaaaaaabbbbbbbbccccccccdddddddd',
  spotifyRefreshToken: 'AQD-vorschau-erneuerungsmerkmal',
}

/**
 * DER STAND DER DARSTELLUNG — veraenderlich, seit die Box ihn selbst schreibt.
 *
 * `themen` ist absichtlich NICHT leer: `PUT /api/darstellung` ersetzt
 * `aktuell` ganz und rettet `themen` nur, wenn sie mitkommen. Mit einem
 * leeren Themenordner waere der teuerste Fehler dieses Weges — „das
 * Umschalten hat die selbst gebauten Themen geloescht" — in der Vorschau
 * gar nicht zu bemerken.
 */
/**
 * Welche Sorte Songtext `/api/songtext` liefert: 'synchron' (Vorgabe),
 * 'unsynchron' oder 'leer'. Ueber /vorschau/songtext-<art> umschaltbar.
 */
let SONGTEXT_ART = 'synchron'

const DARSTELLUNG = {
  geschrieben: false,
  aktuell: {
    kachelForm: 'abgerundet',
    kachelRand: false,
    kachelRandFarbe: '#ffffff',
    kachelRandBreite: 6,
    bezeichnung: true,
    statusLeiste: true,
    miniPlayer: 1,
    bilder: 1,
    tasten: 1,
    abstandAlben: 24,
    startseite: 'audiobook',
    platzBeimBlaettern: false,
    diskografie: false,
    ruhigeMarke: false,
    verschmelzen: false,
    // Die Wellen-Regler (E99-Feinschliff): drei Stufen, 2 = bisheriger Stand.
    wellenHub: 2,
    wellenTempo: 2,
    // WER HIER DIE BUEHNE BEWOHNT (E129). Sie fehlte in dieser Attrappe ganz,
    // und damit stand `buehneSetzen` immer auf „aus": die Buehne war in der
    // Vorschau NICHT ZU SEHEN und ihr Inhalt nicht zu pruefen — auch nicht
    // der Songtext, der der Grund fuer sie war. Ueber /vorschau/buehne-*
    // umschaltbar, damit ein Test jeden Bewohner ansteuern kann.
    buehne: 'wellen',
    // DIE GROESSEN-FAKTOREN (E113). LEER UND NICHT `{cover: 1, titel: 1}` —
    // genau so steht es in der ausgelieferten darstellung.json
    // (remote-step-installer/dateien/darstellung.json). Eine Attrappe, die
    // hier schon Werte haette, verstellte die Frage, um die es geht: dass
    // eine Box OHNE diese Schluessel beim bisherigen Stand landet.
    skalen: {},
  },
  themen: { 'MuPiBox Classic': { miniPlayer: 0, bilder: 1.8 } },
}

/**
 * DIE GANZE LAGE AUF EINMAL — lesen (`GET /vorschau/lage`) und wieder
 * hinlegen (`POST /vorschau/lage`).
 *
 * WOFUER, seit 04.08.2026: Neunzehn Messwerkzeuge leihen sich eine schon
 * laufende Vorschau, statt eine eigene zu starten — die Regel „eine laufende
 * Vorschau wird NICHT angefasst" steht in jedem von ihnen. Was in keinem
 * stand: dass sie die geliehene Vorschau auch WIEDER HINLEGEN muessen.
 * tools/marke-tanzt.mjs lief seine zwei Faelle in der Reihenfolge
 * `marke-bewegt`, `marke-ruhig` durch und ging nach dem letzten heim; die
 * Vorschau stand danach dauerhaft auf `marke-ruhig`, und
 * tools/raster-marke-schau.mjs meldete daran zwei Fehler, die es nicht gab
 * („die Marke im Raster bewegt sich nicht"). Am selben Tag stand eine
 * verwaiste Vorschau zwei Stunden lang auf `einstellungssperre: pin`, obwohl
 * die Vorgabe `aus` ist — der Eltern-Bereich verlangte dort eine PIN, die
 * niemand gestellt hatte.
 *
 * ZURUECKGELEGT WIRD, WAS VORHER DA WAR — nicht die Vorgabe. Wer die Vorgaben
 * wiederherstellte, raeumte dem Eigentuemer der Vorschau seine eigene Lage ab;
 * das waere derselbe Schaden, nur in die andere Richtung.
 *
 * MIT DABEI IST ALLES KLEBRIGE, nicht nur `lage`: die Freischaltungen
 * (`frei-*`, `nein-*`) liegen in ABLAGE, die Kinderzeit in KINDERZEIT, und das
 * Ergebnis einer Bluetooth-Suche steht in BT_GEFUNDEN/BT_ANGENOMMEN. Ein
 * Schnappschuss, der nur `lage` mitnimmt, waere genau die Sorte Luege durch
 * Weglassen, vor der die Attrappe an anderer Stelle warnt: Er saehe vollstaendig
 * aus und liesse drei Felder stehen.
 *
 * DIE DREI FELDER NEBEN `lage` SIND AUSSERDEM DAS ERKENNUNGSZEICHEN. Der
 * Umschalter unten hat einen Auffangzweig, der alles Unbekannte als
 * Spielzustand nimmt und mit `{ lage }` antwortet — eine Vorschau aus einem
 * aelteren Stand quittiert `/vorschau/lage` also mit HTTP 200 und einem
 * Rumpf, der ein Feld `lage` traegt. `vorschauLeihen` in tools/leihgabe.mjs
 * unterscheidet den echten Schnappschuss genau an `ablage`, `kinderzeit` und
 * `bt`; ohne sie haelt es die Vorschau fuer neu und legt beim Aufraeumen
 * `lage.spielt = 'lage'` hin.
 *
 * DIE PROTOKOLLE GEHOEREN NICHT DAZU (BEFEHLSPROTOKOLL, SPRECHPROTOKOLL,
 * DAEMPFUNG). Sie sind Mitschrift, kein Zustand — sie zurueckzurollen hiesse,
 * dem Eigentuemer Zeilen zu loeschen, die wirklich passiert sind. Wer sie
 * leeren will, hat dafuer `/vorschau/befehle-leeren` und
 * `/vorschau/gesprochen-leeren`.
 */
function schnappschuss() {
  return {
    lage: { ...lage },
    ablage: { frei: [...ABLAGE.frei], abgelehnt: [...ABLAGE.abgelehnt] },
    kinderzeit: structuredClone(KINDERZEIT),
    bt: { gefunden: BT_GEFUNDEN, angenommen: [...BT_ANGENOMMEN] },
    // ══ UND DIE ZUGAENGE — NACHGETRAGEN AM 06.08.2026 ══════════════════════
    // Sie kamen am selben Tag dazu wie die zwei Einrichtungsseiten und fehlten
    // hier. Das war genau die Sorte Luege durch Weglassen, vor der der Absatz
    // oben warnt, und sie hat auch sofort zugeschlagen:
    // tools/dienst-einrichten-schau.mjs LOESCHT den Jellyfin-Schluessel (Punkt
    // 5b, mit Absicht — Loeschen, das nur angezeigt wird, sieht genauso aus).
    // Ein zweiter Lauf gegen dieselbe geliehene Vorschau fand danach „Kein
    // Schlüssel hinterlegt" und meldete einen Fehler, den es nicht gab —
    // wortgleich zu dem Fall mit `marke-ruhig`, der diesen Schnappschuss
    // ueberhaupt erst erzwungen hat.
    //
    // ES STEHT EIN GEHEIMNIS DARIN, UND DAS IST HIER RICHTIG: Der
    // Schnappschuss verlaesst den Rechner nicht — er geht von einem Werkzeug
    // in dieselbe Attrappe zurueck, in der die Werte ohnehin liegen. Wer ihn
    // je in eine Datei schreibt, schreibt ein Erneuerungsmerkmal mit.
    zugang: { ...ZUGANG },
    // ══ UND DIE DARSTELLUNG — NACHGETRAGEN AM 31.08.2026 ═══════════════════
    // Dieselbe Luege durch Weglassen, zum dritten Mal zugeschlagen: nach
    // einem `PUT /api/darstellung` traegt die Vorschau
    // `DARSTELLUNG.geschrieben` und serviert fortan die geschriebene Fassung
    // — die Lage-Schalter (`/vorschau/marke-*`, `verschmolzen-an`) erreichen
    // `aktuell` nie mehr, und das Zuruecklegen heilte es nicht, weil dieses
    // Feld hier fehlte. In der grossen Probe kostete das drei Phantom-Rots
    // in EINEM Lauf (marke-tanzt, marke-grenzfaelle, verschmelzung-befehle):
    // ein frueher Schritt schrieb, drei spaete massen die Fassung von
    // gestern. [[geschriebene-darstellung-macht-lage-schalter-taub]]
    darstellung: structuredClone(DARSTELLUNG),
  }
}

/** Einen Schnappschuss wieder hinlegen. Fehlende Teile bleiben, wie sie sind —
 *  ein Werkzeug, das nur `lage` gelesen hat, soll nicht die Kinderzeit leeren. */
function schnappschussSetzen(s) {
  if (s?.lage) Object.assign(lage, s.lage)
  // DIE FREIGABEN WERDEN NEU GEBAUT und nicht nur der Name der Lage gesetzt:
  // `lage.videos` sagt WELCHE Lage, die Zaehler stehen aber in VIDEOS, und
  // die hat der Lauf davor womoeglich verbraucht. Ohne diese Zeile bekaeme
  // das naechste Werkzeug „voll" auf dem Papier und einen Rest von 0 in der
  // Antwort — genau die halb zurueckgelegte Leihgabe, gegen die leihgabe.mjs
  // gebaut ist.
  if (s?.lage?.videos) videosSetzen(s.lage.videos)
  if (s?.ablage) Object.assign(ABLAGE, { frei: [...(s.ablage.frei || [])], abgelehnt: [...(s.ablage.abgelehnt || [])] })
  if (s?.kinderzeit) Object.assign(KINDERZEIT, structuredClone(s.kinderzeit))
  if (s?.bt) {
    BT_GEFUNDEN = !!s.bt.gefunden
    BT_ANGENOMMEN.clear()
    for (const m of s.bt.angenommen || []) BT_ANGENOMMEN.add(m)
  }
  // FELD FUER FELD UND NICHT ALS GANZES: Ein Werkzeug aus einem aelteren Stand
  // schickt `zugang` gar nicht mit — dann bleibt alles stehen (die Regel ganz
  // oben). Schickt es einen halben, bleibt der Rest ebenfalls stehen, statt
  // dass ein `undefined` den Jellyfin-Schluessel stillschweigend loescht.
  if (s?.zugang) for (const k of Object.keys(ZUGANG)) if (typeof s.zugang[k] === 'string') ZUGANG[k] = s.zugang[k]
  // Die Darstellung ganz zuruecklegen — samt `geschrieben`: nur so greifen
  // die Lage-Schalter danach wieder (siehe den Kasten im Schnappschuss).
  if (s?.darstellung) Object.assign(DARSTELLUNG, structuredClone(s.darstellung))
}

/**
 * WIE `stop` AUSGEHEN KANN — alle FUENF Sorten, nicht nur die schoene.
 *
 * Seit dem 04.08.2026 antwortet der Abspieldienst auf `stop` erst, wenn
 * Spotify die Pause bestaetigt hat, und legt das Ergebnis ins Feld
 * `angehalten` (BACKLOG E24/O2, spotify-control.ts `AnhalteAusgang`). Die
 * Oberflaeche entscheidet daran, ob sie vor dem Start noch selbst Abstand
 * halten muss (`anhaltenUndAbstand` in NewDesign/app.js).
 *
 * DIE FUENFTE SORTE IST DIE WICHTIGSTE UND HEISST 'alt': ein Abspieldienst,
 * der das Feld GAR NICHT kennt. Sie ist kein Hirngespinst — server.js und
 * spotify-control.js liegen auf der Box in zwei verschiedenen Ordnern und
 * lassen sich einzeln erneuern (llmwiki spotify-control-liegt-woanders). Ohne
 * sie waere diese Attrappe genau das, wovor [attrappe-luegt-durch-weglassen]
 * warnt: Sie stellte nur die Welt, in der die Reparatur schon ueberall
 * angekommen ist, und der Rueckfallweg der Oberflaeche liefe nie.
 *
 * Umschalten: curl localhost:8299/vorschau/anhalten-{bestaetigt|nichts-zu-tun|
 *             fehlgeschlagen|frist-abgelaufen|alt}
 */
const ANHALTE_SORTEN = new Set(['bestaetigt', 'nichts-zu-tun', 'fehlgeschlagen', 'frist-abgelaufen', 'alt'])

/* ══ DER ERFUNDENE AKKUVERLAUF ═══════════════════════════════════════════
 *
 * Er stellt einen Tagesablauf nach, den es an einer Box wirklich gibt, und
 * zwar mit den Uebergaengen, um die es geht:
 *
 *   06:50 die Box geht an. Der Pack ist voll (im Aus wird nichts verbraucht).
 *   09:00 bis 19:00 wird gehoert — der Strom ist NEGATIV, der Stand faellt
 *         von 100 auf 34 Prozent.
 *   19:00 bis 21:30 haengt sie am Ladegeraet — der Strom ist POSITIV.
 *   21:30 bis 23:10 ist sie voll und steht am Netz: Ruhe, fast kein Strom.
 *   23:10 bis 06:50 ist sie AUS. Es gibt keine Messwerte — DIE LUECKE.
 *
 * DIE LUECKE IST DER GRUND FUER DIESE FUNKTION. An einer Box waere sie nur
 * herzustellen, indem man sie eine Woche lang jeden Abend ausschaltet.
 *
 * KEIN ZUFALL IM STAND, nur im Strom: Ein verrauschter Prozentwert saehe aus
 * wie ein Messfehler, und eine Anzeige, die dagegen geprueft wird, koennte
 * einen echten Zackenverlauf nicht mehr von einem erfundenen unterscheiden.
 * Der Strom schwankt dagegen wirklich (jeder Titelwechsel), und die
 * Abschnittsbildung des Servers beruhigt genau das — ohne Rauschen bliebe
 * diese Beruhigung ungeprueft.
 */
const AKKUVERLAUF_SORTEN = new Set(['voll', 'flach', 'duenn', 'leer', 'fehlt'])

function akkuRoh(sorte, stunden, jetzt) {
  if (sorte === 'leer') return []
  const punkte = []
  if (sorte === 'duenn') {
    // ZWEI PUNKTE, EINE MINUTE AUSEINANDER. Genau unter der Schwelle, ab der
    // die Oberflaeche zeichnet — der Fall, in dem sie den SATZ zeigen muss.
    for (const versatz of [120000, 60000]) {
      const t = jetzt - versatz
      punkte.push({ t, v: 8120, i: -430, p: 71 })
    }
    return punkte
  }
  const von = jetzt - stunden * 3600000
  for (let t = Math.ceil(von / 60000) * 60000; t <= jetzt; t += 60000) {
    if (sorte === 'flach') {
      punkte.push({ t, v: 8380, i: 6, p: 100 })
      continue
    }
    const d = new Date(t)
    const std = d.getHours() + d.getMinutes() / 60
    // DIE NACHT: die Box ist aus, es gibt nichts zu messen.
    if (std >= 23.17 || std < 6.83) continue
    // Ein Sinus mit einer krummen Periode, damit sich das Muster nicht mit
    // dem Minutentakt deckt und die Beruhigung des Servers etwas zu tun hat.
    const zappel = Math.round(70 * Math.sin(t / 137000))
    let p
    let i
    if (std < 9) {
      p = 100
      i = 5 + Math.round(zappel / 20)
    } else if (std < 19) {
      p = 100 - 66 * ((std - 9) / 10)
      i = -430 + zappel
    } else if (std < 21.5) {
      p = 34 + 66 * ((std - 19) / 2.5)
      i = 880 + Math.round(zappel / 3)
    } else {
      p = 100
      i = 6 + Math.round(zappel / 20)
    }
    punkte.push({ t, v: Math.round(6800 + 16 * p), i, p: Math.max(0, Math.min(100, Math.round(p))) })
  }
  return punkte
}

/* Die drei Rechnungen des Servers — abgeschrieben aus akkuverlauf.ts, damit
 * die Attrappe dieselben Abschnitte bildet wie die Box. Eine eigene Rechnung
 * hier waere eine Anzeige, die gegen Daten geprueft wird, die es nirgends
 * gibt. */
const AKKU_RUHE_SCHWELLE = 20
const akkuArt = (mA) => (mA > AKKU_RUHE_SCHWELLE ? 'laden' : mA < -AKKU_RUHE_SCHWELLE ? 'entladen' : 'ruhe')

function akkuAbschnitte(reihe, mindest = 2) {
  const raus = []
  let lauf = []
  const schliessen = () => {
    if (lauf.length < mindest) return
    const mA = Math.round(lauf.reduce((s, x) => s + x.i, 0) / lauf.length)
    raus.push({
      art: akkuArt(mA),
      von: lauf[0].t,
      bis: lauf[lauf.length - 1].t,
      vonProzent: lauf[0].p,
      bisProzent: lauf[lauf.length - 1].p,
      mA,
    })
  }
  for (const x of reihe) {
    if (!lauf.length || akkuArt(x.i) === akkuArt(lauf[lauf.length - 1].i)) {
      lauf.push(x)
      continue
    }
    schliessen()
    lauf = [x]
  }
  schliessen()
  return raus
}

function akkuAusduennen(reihe, max) {
  if (max <= 0) return []
  if (reihe.length <= max) return [...reihe]
  const schritt = reihe.length / max
  const raus = []
  for (let i = 0; i < max; i++) raus.push(reihe[Math.floor(i * schritt)])
  const letzter = reihe[reihe.length - 1]
  if (raus[raus.length - 1].t !== letzter.t) raus[raus.length - 1] = letzter
  return raus
}

function akkuHochrechnen(punkt, kapazitaetMah) {
  if (!punkt || !kapazitaetMah || Math.abs(punkt.i) <= AKKU_RUHE_SCHWELLE) return null
  const anteil = punkt.i < 0 ? punkt.p / 100 : (100 - punkt.p) / 100
  const stunden = (kapazitaetMah * anteil) / Math.abs(punkt.i)
  return Number.isFinite(stunden) ? Math.round(stunden * 60) : null
}


/**
 * DIE BLUETOOTH-GERAETE DER VORSCHAU — und warum es mehr als eines sein muss.
 *
 * Bis zum 04.08.2026 stand hier EIN Geraet, und zwar immer dasselbe: gekoppelt
 * und je nach Lage verbunden oder nicht. Fuer das Zeichen in der Kopfzeile
 * genuegte das. Der Eltern-Bereich zeigt aber eine LISTE, und in einer Liste
 * gibt es drei Sorten Zeile — verbunden, gekoppelt-aber-nicht-verbunden, und
 * gefunden-aber-noch-nicht-gekoppelt. Jede traegt einen anderen Knopf.
 *
 * DIE LEHRE VOM 03.08. ([attrappe-gruen-geraet-rot-loser-titel]): Die Frage
 * ist nicht „stelle ich den Fall?", sondern „welche SORTEN gibt es, und stelle
 * ich von jeder eine?" Deshalb liegt hier auch ein NAMENLOSES Geraet — die
 * Oberflaeche filtert es weg, und ohne ein solches liesse sich nie sehen, ob
 * der Filter ueberhaupt greift.
 */
const BT_STAMM = {
  mac: '7C:96:D2:89:35:CC',
  name: 'Teufel ROCKSTER Cross',
  gekoppelt: true,
  vertraut: true,
  art: 'lautsprecher',
  codec: 'sbc',
}

/** Was eine Suche zutage foerdert. Vor der ersten Suche steht nichts davon da. */
const BT_FUNDE = [
  { mac: '00:1A:7D:DA:71:13', name: 'Kopfhörer Lina', art: 'kopfhoerer' },
  { mac: '38:F9:D3:12:0B:A4', name: 'Papas Handy', art: 'telefon' },
  // OHNE NAMEN: ein Thermometer, eine Steckdose, ein Auto im Hof. Die
  // Oberflaeche blendet solche Zeilen aus; ohne diese hier waere das eine
  // ungeprueft behauptete Eigenschaft.
  { mac: '4C:65:A8:D0:1E:77', name: '4C-65-A8-D0-1E-77', namenlos: true },
]

/**
 * DIE NACHBARSCHAFT — abgeschrieben von .169 am 06.08.2026, nicht ausgedacht.
 *
 * Warum echte Namen: „gastfreundlicheFRITZ!Box" ist 24 Zeichen lang und
 * „ShellyPlugSG3-B08184A5D930" 26 — an denen entscheidet sich, ob eine
 * `.zeile-name` abgeschnitten wird. Erfundene Kurznamen haetten das verdeckt.
 * Ein OFFENES Netz ist dabei (die Steckdose), weil es der einzige Fall ist,
 * in dem die Oberflaeche OHNE Tastatur verbindet.
 */
// `bekannt` STEHT HIER NICHT MEHR (13.09.2026): es kommt im Scan-Stub aus
// GESPEICHERT — der einen Quelle, die auch das Vergessen kuerzt. Solange es
// hier als Feld stand, sagte der Scan nach einem „Vergessen" weiter
// „gespeichert", und die Oberflaeche suchte eine Kennung, die es nicht mehr
// gab (gemessen in der Vorschau am selben Tag).
const WLAN_NETZE = [
  { ssid: 'ganznahamnetzNight', signalDbm: -61, stufe: 'mittel', band: '5 GHz', sicherheit: 'wpa', verschluesselung: 'WPA2/WPA3', wps: true },
  { ssid: 'gastfreundlicheFRITZ!Box', signalDbm: -59, stufe: 'gut', band: '5 GHz', sicherheit: 'wpa', verschluesselung: 'WPA2/WPA3', wps: false },
  { ssid: 'ShellyPlugSG3-B08184A5D930', signalDbm: -59, stufe: 'gut', band: '2,4 GHz', sicherheit: 'offen', verschluesselung: 'offen', wps: false },
  { ssid: 'FRITZ!Box 6690 TB', signalDbm: -60, stufe: 'gut', band: '5 GHz', sicherheit: 'wpa', verschluesselung: 'WPA2/WPA3', wps: false },
  { ssid: 'homey', signalDbm: -74, stufe: 'schwach', band: '2,4 GHz', sicherheit: 'wpa', verschluesselung: 'WPA2', wps: false },
]

/** In welchem Netz die Attrappen-Box haengt und ob ein Wechsel offen ist. */
const WLAN_STAND = { verbunden: 'ganznahamnetzNight', wechsel: null }

/**
 * DIE GESPEICHERTEN NETZE (E115 am Geraet, 13.09.2026) — die eine Quelle,
 * gegen die auch `bekannt` im Scan gerechnet wird. Zwei Listen, die beide
 * „kennt die Box schon" beantworten, liefen auseinander, sobald das
 * Vergessen nur eine pflegt.
 *
 * Die Kennungen sind mit Absicht NICHT 0,1,2: wpa_supplicant vergibt Nummern
 * mit Luecken, und eine Oberflaeche, die heimlich mit dem Index arbeitet
 * statt mit der Kennung, fiele hier sofort auf.
 *
 * `BahnhofsWLAN-unterwegs` steht in KEINEM Scan: das ist der Fall, fuer den
 * der Abschnitt gebaut ist (verstecktes oder gerade abwesendes Netz) — und
 * `homey` ist gespeichert UND sichtbar, der Vergessen-Fall in Reichweite.
 */
const GESPEICHERT_START = [
  { id: 0, ssid: 'ganznahamnetzNight', abgeschaltet: false },
  { id: 3, ssid: 'BahnhofsWLAN-unterwegs', abgeschaltet: false },
  { id: 7, ssid: 'homey', abgeschaltet: false },
]
const GESPEICHERT = GESPEICHERT_START.map((n) => ({ ...n }))

/**
 * DER VPN-HEIMWEG (E30) — Felder wortgleich zum Server (vpn.ts), Werte vom
 * Geraet abgeschrieben (Box .62, 12.09.2026: werkzeugDa true, kern
 * als-modul-da), nicht ausgedacht. `einheit` schreibt der /aktiv-Stub um —
 * wie WLAN_STAND ist das ZUSTAND, kein Lagen-Schalter.
 */
const VPN_STAND = {
  werkzeugDa: true,
  kern: 'als-modul-da',
  konfiguration: {
    adressen: ['192.168.178.201/24'],
    endpunkt: 'xyz1abcd2efg3hij.myfritz.net:57459',
    erlaubteNetze: ['192.168.178.0/24'],
    gegenstelle: 'nZ0…kQ= (gekuerzt)',
    keepalive: 25,
    mtu: null,
    hinweise: [],
    uebernommen: '2026-09-12T16:20:00.000Z',
  },
  einheit: { aktiv: false, beimStart: false },
}

/* ══ FUNK: OB DIE SENDER LAUFEN — und das ist NICHT `lage.funk` ═══════════
 *
 * ZWEI DINGE, DIE MAN LEICHT IN EIN FELD WIRFT und die auseinandergehen:
 *   FUNK_STAND   ob Bluetooth und WLAN gerade AN sind. Das aendert sich
 *                waehrend eines Laufs, weil die Oberflaeche es schaltet.
 *   lage.funk    ueber welchen WEG die Box erreichbar ist. Das ist die Lage,
 *                die ein Werkzeug vorher einstellt und die kein Knopf aendert.
 * Der Unterschied ist der ganze Sinn dieser Seite: derselbe Zustand („WLAN
 * laeuft") heisst am Kabel „darf aus" und ohne Kabel „darf NICHT aus".
 */
const FUNK_STAND = { bluetooth: true, wlan: true }

/**
 * WAS AN FUNK-BEFEHLEN HEREINKAM — mit `vorOrt`, und das ist der Punkt.
 *
 * `vorOrt: true` ist die einzige Angabe, mit der die Oberflaeche sagt „ich
 * laufe auf dem Schirm der Box". Schickt sie es nicht mit, lehnt der ECHTE
 * Server mit 409 ab (funk.ts, `vonDerBox`) — hier wird es mitgeschrieben,
 * damit ein Werkzeug das nachsehen kann, ohne an einer Box zu schalten.
 * Ausserdem faellt so auf, wenn ein zweiter Tipp einen zweiten Befehl
 * hinausschickt; genau daraus wurde am Server die Einbahnstrasse.
 */
const FUNK_RUFE = []

/** Die Wege nach draussen, so wie `/api/funk` sie beschreibt. */
function funkWege() {
  const kabel = lage.funk === 'kabel'
  return [
    {
      name: 'eth0',
      funk: false,
      adresse: kabel ? '192.168.178.169' : '',
      // `null` und NICHT `false`: bei einer heruntergefahrenen Schnittstelle
      // ist `carrier` nicht lesbar, und „weiss nicht" ist etwas anderes als
      // „kein Kabel" (funk.ts, `Weg.kabel`). Eine Attrappe, die hier `false`
      // schriebe, praegte einen Fall, den die Box so nie liefert.
      kabel: kabel ? true : null,
      zustand: kabel ? 'up' : 'down',
      traegt: kabel,
      eigenstaendig: true,
    },
    {
      name: 'wlan0',
      funk: true,
      adresse: FUNK_STAND.wlan ? '192.168.178.170' : '',
      kabel: null,
      zustand: FUNK_STAND.wlan ? 'up' : 'down',
      traegt: FUNK_STAND.wlan,
      // Ein WLAN zaehlt NIE als Rueckweg: „Funk aus" nimmt es mit.
      eigenstaendig: false,
    },
  ]
}

/**
 * Darf der Funk aus? Dieselbe Reihenfolge wie `funkAusFreigabe` in funk.ts —
 * Kabel schlaegt Vor-Ort, denn es stimmt auch, wenn niemand danebensteht.
 *
 * `vorOrtGewuenscht` ist das, was die Oberflaeche MITGESCHICKT hat. Ohne das
 * Feld hilft auch `lage.funk === 'vorort'` nicht: der echte Server verlangt
 * beides (Loopback UND `vorOrt: true`), damit ein Klick in einer alten
 * Oberflaeche die Box nicht aus dem Netz nimmt.
 */
function funkFreigabe(vorOrtGewuenscht = false) {
  const rueck = funkWege().find((w) => w.eigenstaendig && w.traegt) || null
  if (rueck)
    return {
      erlaubt: true,
      ueber: rueck,
      nurVorOrt: false,
      grund: `Die Box bleibt über ${rueck.adresse} (${rueck.name}) erreichbar. Wer diese Seite gerade über WLAN bedient, verliert sie trotzdem.`,
    }
  if (lage.funk === 'vorort' && vorOrtGewuenscht === true)
    return {
      erlaubt: true,
      ueber: null,
      nurVorOrt: true,
      grund:
        'Kein zweiter Weg — erlaubt nur, weil der Aufruf von der Box selbst kommt. Wieder einschalten geht dann auch nur dort.',
    }
  return {
    erlaubt: false,
    ueber: null,
    nurVorOrt: false,
    grund: 'Die Box hängt nur am WLAN. Ausschalten macht sie unerreichbar.',
  }
}

/**
 * DIE BIBLIOTHEK — dieselbe Form wie `/api/medien` sie liefert, samt
 * `schluessel`, `dienst` und `art`. Vier Eintraege reichen: einer je Dienst,
 * einer mit sehr langem Titel (an dem der Umbruch der Loesch-Rueckfrage
 * haengt) und einer ohne Interpret.
 */
const MEDIEN = [
  { type: 'spotify', category: 'audiobook', title: 'Hello Kitty - Alle Hörspiele', artist: 'EUROPA Hörspiele & Kinderlieder', playlistid: '1DYD', schluessel: 'spotify:1DYD', dienst: 'spotify', art: 'playlist' },
  { type: 'jellyfin-album', category: 'music', title: 'HAMM', artist: 'Kapelle Petra', id: '7d9a', schluessel: 'jellyfin:7d9a', dienst: 'jellyfin', art: 'album' },
  { type: 'spotify', category: 'music', title: 'Lichterkinder (Komplett) | Alle Lieder der Lichterkinder', artist: 'Lichterkinder', playlistid: '2GRi', schluessel: 'spotify:2GRi', dienst: 'spotify', art: 'playlist' },
  { type: 'radio', category: 'other', title: 'Kiraka', artist: '', id: 'https://wdr-kiraka-live.icecast.wdr.de/wdr/kiraka/live/mp3/128/stream.mp3', schluessel: 'radio:kiraka', dienst: 'radio', art: 'album' },
]

/**
 * EINE BIBLIOTHEK IN DER GROESSE DER ECHTEN — `/vorschau/bibliothek-viele`.
 *
 * WOZU: Seit dem 07.08.2026 waehlt man hier aus, was ein Kind sehen darf, und
 * die Entscheidung fuer eine FLACHE Liste mit Suche (statt eines
 * Interpretenbaums) haengt an genau einer Zahl — wie dicht die Bibliothek
 * wirklich ist. Mit vier Eintraegen laesst sich das nicht ansehen: die Liste
 * rollt nicht einmal, und die Suche findet immer alles.
 *
 * DIE MASSE SIND GEMESSEN UND NICHT GEGRIFFEN (Box .169, `GET /api/medien`,
 * 07.08.2026, lesend): 28 Eintraege, 20 verschiedene Interpreten, davon 15 mit
 * genau EINEM Werk; 15 audiobook, 11 music, 2 other; 24 spotify, 2 jellyfin,
 * 2 ard. DIE TITEL SIND ERFUNDEN — es geht um die Gestalt, nicht um den
 * Bestand eines fremden Wohnzimmers.
 *
 *     curl localhost:<port>/vorschau/bibliothek-viele
 *     curl localhost:<port>/vorschau/bibliothek-wenige   # zurueck zu den vier
 *
 * NICHT `medien-viele`: `was.startsWith('medien-')` faengt weiter oben ALLES
 * mit diesem Anfang ab und setzte `lage.medien = 'viele'` — die Bibliothek
 * bliebe klein, und die Verwaltung haette stillschweigend einen Zustand, den
 * es nicht gibt. Beim ersten Anlauf am 07.08.2026 genau so passiert.
 */
const VIELE_NAMEN = [
  ['Bibi Blocksberg', 5, 'audiobook', 'spotify'],
  ['Die drei ???', 3, 'audiobook', 'spotify'],
  ['Benjamin Blümchen', 2, 'audiobook', 'spotify'],
  ['Rolf Zuckowski', 2, 'music', 'spotify'],
  ['Die Maus', 1, 'audiobook', 'ard'],
  ['WDR', 1, 'other', 'ard'],
  ['Kapelle Petra', 1, 'music', 'jellyfin'],
  ['Das Lumpenpack', 1, 'music', 'jellyfin'],
  ['Lichterkinder', 1, 'music', 'spotify'],
  ['Der Grüffelo', 1, 'audiobook', 'spotify'],
  ['Pettersson und Findus', 1, 'audiobook', 'spotify'],
  ['Conni', 1, 'audiobook', 'spotify'],
  ['Leo Lausemaus', 1, 'audiobook', 'spotify'],
  ['Sandmännchen', 1, 'audiobook', 'spotify'],
  ['Volker Rosin', 1, 'music', 'spotify'],
  ['Simone Sommerland', 1, 'music', 'spotify'],
  ['Die Zauberflöte für Kinder', 1, 'music', 'spotify'],
  ['Ritter Rost', 1, 'audiobook', 'spotify'],
  ['Es war einmal … der Mensch', 1, 'audiobook', 'spotify'],
  ['Unknown', 1, 'music', 'spotify'],
]
const MEDIEN_VIELE = []
for (const [interpret, wieViele, kategorie, dienst] of VIELE_NAMEN) {
  for (let i = 1; i <= wieViele; i++) {
    const nr = MEDIEN_VIELE.length
    const titel = wieViele > 1 ? `${interpret} — Folge ${i}` : interpret === 'Unknown' ? 'External Playback' : interpret
    MEDIEN_VIELE.push({
      type: dienst === 'jellyfin' ? 'jellyfin-album' : dienst,
      category: kategorie,
      title: titel,
      artist: interpret,
      id: `viele${String(nr).padStart(2, '0')}`,
      schluessel: `${dienst}:viele${String(nr).padStart(2, '0')}`,
      dienst,
      art: 'album',
    })
  }
}
/** Welche Bibliothek gerade gilt. `MEDIEN` bleibt der Regelfall. */
const medienListe = () => (lage.medienZahl === 'viele' ? MEDIEN_VIELE : MEDIEN)

/** Hat schon jemand gesucht? Vor der Suche kennt die Box nur das Gekoppelte. */
let BT_GEFUNDEN = false
/** Welche der Funde inzwischen gekoppelt wurden. */
const BT_ANGENOMMEN = new Set()

function btGeraete() {
  const stamm = { ...BT_STAMM }
  if (lage.bt === 'verbunden') {
    stamm.verbunden = true
    // AKKUSTAND UND CODEC gibt es nur bei einer bestehenden Verbindung — vorher
    // weiss die Box sie gar nicht. Eine Attrappe, die sie immer mitschickt,
    // liesse die Zeile „gekoppelt" reicher aussehen, als sie je ist.
    stamm.akku = 72
  }
  const gefunden = BT_GEFUNDEN
    ? BT_FUNDE.map((g) => (BT_ANGENOMMEN.has(g.mac) ? { ...g, gekoppelt: true, verbunden: true } : { ...g }))
    : []
  return [stamm, ...gefunden]
}

/**
 * DIE KINDERZEIT — Regeln und Tageskonto.
 *
 * SEIT DEM GEGENLESEN AM 03.08.2026 ueberhaupt vorhanden. Vorher kannte die
 * Attrappe /api/kinderzeit nicht, die Seite meldete dauerhaft „Die Regeln
 * konnten nicht geladen werden.", und den Normalfall hat dort nie jemand
 * gesehen. Das faellt seit dem Umzug des Schlummer-Timers auf diese Seite ins
 * Gewicht: wer ihn ansehen will, kann die Seite sonst nur kaputt ansehen.
 *
 * VORGABE IST „AUS", wie beim echten Server (kinderzeit.ts, regelnVorgabe) —
 * eine Attrappe, die scharfe Regeln vorgaukelt, wo die Vorgabe „alles offen"
 * ist, waere schon wieder eine eigene Meinung.
 *     curl localhost:8299/vorschau/kz-an   # Regeln scharf, 45 min/Tag, halb weg
 *     curl localhost:8299/vorschau/kz-aus  # zurueck zur Vorgabe
 */
const KZ_TAGE = ['so', 'mo', 'di', 'mi', 'do', 'fr', 'sa']
const kzVorgabe = () => ({
  aktiv: false,
  nachsichtMin: 5,
  tage: Object.fromEntries(KZ_TAGE.map((t) => [t, { frei: true, ab: '', bis: '', minuten: 0 }])),
})
const KINDERZEIT = { regeln: kzVorgabe(), verbrauchtMin: 0, bonusMin: 0 }

/**
 * DAS HINTERGRUNDLICHT DES SCHIRMS — vier Lagen, umschaltbar.
 *
 * `lage`: 'da' | 'weg' | 'geklemmt' | 'stur'. Die ausfuehrliche Begruendung,
 * warum es GENAU diese vier sein muessen, steht bei der Route
 * `/api/schirm/helligkeit` weiter unten.
 *
 * `prozent` haelt, was zuletzt gesetzt wurde — ein PUT muss sich im naechsten
 * GET wiederfinden, sonst prueft man einen Regler, der nichts merkt.
 */
const LICHT = { lage: 'da', prozent: 60 }

/**
 * OB DIE TITELLISTEN EINE LAENGE MITSCHICKEN.
 *
 * `da: true` ist der Regelfall (Spotify, Jellyfin, ARD). `/vorschau/dauer-weg`
 * nimmt sie weg und stellt damit den LOKALEN Fall nach: die playlist.m3u kennt
 * nur Dateinamen, `dauerMs` fehlt dort. Die Kinderzeit-Passung muss beide
 * Faelle unterscheiden — „passt nicht" und „weiss ich nicht" sind zwei Dinge.
 */
const DAUER = { da: true, null: false }

/**
 * DIE SYSTEM-AKTIONEN, abgeschrieben von backend-api/src/system.ts (AKTIONEN).
 *
 * AN EINER STELLE, seit dem Gegenlesen am 03.08.2026: Sie werden von GET
 * /api/system ausgeliefert UND von POST /api/system/:id auf Gueltigkeit
 * geprueft. Zwei Listen waeren eine zu viel — dann boete die Vorschau einen
 * Knopf an, den ihr eigener zweiter Zweig mit 400 abweist.
 *
 * `bereich` entscheidet, WO der Knopf steht: 'medien' auf der Medienseite
 * (dorthin ist „Medien neu einlesen" am 03.08.2026 gewandert), 'box' auf der
 * Systemseite. Die Angabe kommt beim echten Server vom Eintrag, nicht von der
 * Oberflaeche — deshalb steht sie auch hier am Eintrag.
 */
const SYSTEM_AKTIONEN = [
  {
    id: 'medien-neu',
    titel: 'Medien neu einlesen',
    hinweis: 'Liest die Musikdateien neu ein. Nötig, wenn neue Dateien nicht auftauchen.',
    einschneidend: false,
    bereich: 'medien',
  },
  {
    id: 'drehung-zurueck',
    titel: 'Bildschirm-Drehung zurücknehmen',
    hinweis: 'Stellt die zuletzt bewährte Boot-Konfiguration wieder her und startet neu.',
    einschneidend: true,
    bereich: 'box',
  },
  {
    id: 'neustart',
    titel: 'Box neu starten',
    hinweis: 'Die Box fährt herunter und wieder hoch. Das dauert etwa eine Minute.',
    einschneidend: true,
    bereich: 'box',
  },
  {
    id: 'herunterfahren',
    titel: 'Box ausschalten',
    hinweis: 'Die Box fährt herunter. Zum Einschalten muss jemand am Gerät sein.',
    einschneidend: true,
    bereich: 'box',
  },
]

/**
 * DREI SORTEN BOXNAME, und die Oberflaeche behandelt sie verschieden.
 *
 * Die Marke unten links teilt am Wortende „Box" auf zwei Zeilen. Ein Name
 * ohne dieses Ende steht einzeilig da; ein sehr langer muss umbrechen, ohne
 * die 88 px breite Spalte zu sprengen. Wer nur den ersten Fall stellt, prueft
 * die Regel nicht, sondern nur ihren Regelfall — [attrappe-gruen-geraet-rot-
 * loser-titel].
 *
 * `mitbox` ist der Standard, damit die uebliche Messung den Normalfall der
 * Box trifft (dort heisst sie „MixPiBox").
 */
const BOXNAMEN = {
  mitbox: 'VorschauBox',
  ohnebox: 'MixPiZwei',
  lang: 'Kinderzimmer Erdgeschoss Box',
}

const TYPEN = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  // .mjs MUSS text/javascript sein: Browser pruefen den MIME-Typ von
  // ES-Modulen STRENG und verweigern octet-stream ohne laute Meldung — die
  // Spotify-Anmeldeseite (E118/1a) blieb hier stumm bei "Frage die Box...".
  // Die echte Box liefert .mjs richtig (express.static/mime-db); nur diese
  // Tabelle kannte die Endung nicht.
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
}

/**
 * ZWEI FELDER, DIE MAN LEICHT VERWECHSELT — und ich habe es prompt getan:
 *
 *   `art`             die Art der Sammlung: 'album' | 'playlist' | 'show' | ...
 *   `quellen[].dienst` der Dienst:          'lokal' | 'spotify' | 'jellyfin' | ...
 *
 * Beim ersten Anlauf stand in `art` der DIENST. Folge: `abspielBefehl()`
 * (damals in app.js, heute `startPlan` im Server) fand
 * fuer jede Spotify-Kachel keine passende Art, gab null zurueck, und der Tipp
 * bewegte nichts. Beim Pruefen der Titelkarte sah das aus, als griffen die
 * Fehlerwege nicht — dabei war nur nie etwas gestartet worden.
 *
 * Dieselbe Lehre wie oben bei /player/local: eine Attrappe, die dem Vertrag
 * nicht folgt, prueft nichts und schickt den Suchenden an die falsche Stelle.
 */
const WERKE = [
  { titel: 'Die Maus', interpret: 'WDR', kategorie: 'audiobook', art: 'album', dienst: 'lokal' },
  { titel: 'Bibi Blocksberg', interpret: 'Kiddinx', kategorie: 'audiobook', art: 'playlist', dienst: 'spotify' },
  { titel: 'Rolf Zuckowski', interpret: 'Rolf', kategorie: 'music', art: 'album', dienst: 'lokal' },
  { titel: 'Benjamin Bluemchen', interpret: 'Kiddinx', kategorie: 'audiobook', art: 'album', dienst: 'jellyfin' },
  { titel: 'Kinderlieder', interpret: 'Verschiedene', kategorie: 'music', art: 'album', dienst: 'lokal' },
  { titel: 'Die drei ???', interpret: 'Europa', kategorie: 'audiobook', art: 'album', dienst: 'spotify' },
  // ALLE FUENF DIENSTE, DIE ES GIBT — dazu einer, den es nicht gibt.
  //
  // Bis 2026-08-02 kannte diese Liste nur lokal/spotify/jellyfin. Wer die
  // Dienst-Zeichen an ihr geprueft haette, haette drei von fuenf gesehen und
  // Radio, Podcast und den Fall „unbekannter Dienst" fuer erledigt gehalten,
  // ohne sie je gesehen zu haben. Genau die Sorte Luege durch Weglassen, die
  // im Wissenspaket unter [attrappe-luegt-durch-weglassen] steht.
  //
  // `art` folgt werke.ts artVon(): Radio und RSS bekommen dort eine EIGENE
  // Art, weil ihre Stream-Adresse in `id` steht und sie sonst wie ein Album
  // aussaehen. `anderes` ist der ehrliche Wert fuer einen unbekannten Typ —
  // die Oberflaeche darf dafuer KEIN Zeichen zeigen.
  { titel: 'Kinderradio', interpret: 'Sender', kategorie: 'other', art: 'radio', dienst: 'radio' },
  { titel: 'Gute Nacht Geschichten', interpret: 'Kinderfunk', kategorie: 'audiobook', art: 'rss', dienst: 'rss' },
  { titel: 'Rätselhaftes', interpret: '', kategorie: 'music', art: 'anderes', dienst: 'anderes' },
  // ZWEIMAL „External Playback" — der gemeldete Fehler „ich sehe noch Unknown".
  //
  // Der echte Eintrag liegt auf der Box (gemessen 2026-08-02): MuPiBox'
  // Markierung fuer Wiedergabe vom Telefon, OHNE `id` und OHNE `playlistid`,
  // Interpret „Unknown". `medienSchluessel` baut ihm deshalb
  // `spotify:t:unknown|external playback`.
  //
  // ZWEI, nicht einer: Bei einem faellt nur der Untertitel auf. Erst ab zwei
  // baute die Startseite frueher ein REGAL „Unknown" — und genau das war der
  // Fall, den die Oberflaeche nie prueft, weil auf der Box heute nur einer
  // liegt. Wer hier nichts sieht, hat den Beweis; wer „Unknown" sieht, hat
  // den Rueckfall.
  {
    titel: 'External Playback',
    interpret: 'Unknown',
    kategorie: 'music',
    art: 'album',
    dienst: 'spotify',
    ohneKennung: true,
  },
  {
    titel: 'External Playback 2',
    interpret: 'Unknown',
    kategorie: 'music',
    art: 'album',
    dienst: 'spotify',
    ohneKennung: true,
  },
  // BEIM ANBIETER GELOESCHT — `fehlt: true`, wie es /api/werke liefert.
  //
  // Der echte Fall von der Box (2026-07-29): „DAS PUMMELEINHORN" gibt es bei
  // Spotify nicht mehr, api.spotify.com antwortet mit seinem eigenen 404.
  // Ohne diese Zeile prueft eine Messung „graut die Kachel aus?" wieder
  // einmal das Nichts — die Attrappe lieferte das Feld gar nicht erst, und
  // „keine tote Kachel zu sehen" hiesse genau nichts
  // ([attrappe-luegt-durch-weglassen]).
  {
    titel: 'Das Pummeleinhorn',
    interpret: 'Hörspiel',
    kategorie: 'audiobook',
    art: 'playlist',
    dienst: 'spotify',
    fehlt: true,
  },
  // EIN INTERPRET IN ZWEI KATEGORIEN — ohne ihn prueft die Interpreten-Reihe
  // wieder das Nichts ([attrappe-luegt-durch-weglassen]).
  //
  // BIS 03.08.2026 WAR JEDER ERKANNTE INTERPRET DIESER LISTE REIN
  // „audiobook": WDR, Kiddinx (zweimal), Europa und Hörspiel. Wer daran misst,
  // ob die Reihe der Auswahl folgt, sieht unter „Hörbuch" alle und unter
  // „Musik" keinen — und JEDE Filterregel sieht dabei richtig aus, auch eine,
  // die schlicht die Kategorie der ERSTEN Zeile eines Interpreten nimmt. Der
  // Fall, um den es wirklich geht, entsteht gar nicht erst.
  //
  // KIDDINX IST DER RICHTIGE TRAEGER: Der Verlag hat auf der Box Hoerspiele
  // („Bibi Blocksberg", „Benjamin Bluemchen") UND Liederalben — genau die
  // Gestalt, an der sich „ein Werk genuegt" von „alle Werke" unterscheidet.
  // Unter „Musik" muss die runde Kachel „Kiddinx" also stehen bleiben, obwohl
  // zwei seiner drei Werke Hoerspiele sind; unter „Radio" muss sie weg.
  //
  // ANGEHAENGT, NICHT EINGESCHOBEN: `kennungFuer` und der Werkschluessel
  // haengen am laufenden Index. Ein Einschub in der Mitte gaebe jedem
  // dahinter einen neuen Schluessel, und jedes Messwerkzeug, das einen davon
  // nennt, zeigte danach auf ein anderes Werk.
  { titel: 'Kiddinx Kinderlieder', interpret: 'Kiddinx', kategorie: 'music', art: 'album', dienst: 'lokal' },
  // DIE ARD — der SECHSTE Dienst, nachgetragen am 04.08.2026 (BACKLOG E4/A7).
  //
  // Ohne diese Zeile passierte hier zum wiederholten Mal, wovor
  // [attrappe-luegt-durch-weglassen] warnt: Die Dienst-Plakette fuer `ard`
  // war gebaut, aber JEDES Werkzeug, das an dieser Vorschau misst
  // (raster-marke-schau, lane-marken-schau, marke-grenzfaelle, …), haette
  // fuenf von sechs Zeichen gesehen und die Sache fuer geprueft gehalten.
  // Genau derselbe Satz steht schon weiter oben ueber Radio und RSS — die
  // Attrappe wird nicht einmal ehrlich, sondern bei jedem neuen Dienst wieder.
  //
  // `art: 'show'` folgt werke.ts artVon(): eine Sendung ist eine Folgenreihe
  // und traegt ihre Kennung in `id`, saehe also sonst wie ein Album aus.
  //
  // ANGEHAENGT UND NICHT EINGESCHOBEN — siehe den Absatz eine Zeile hoeher.
  { titel: 'MausHörspiel kurz', interpret: 'Die Maus', kategorie: 'audiobook', art: 'show', dienst: 'ard' },
  // DER SIEBTE DIENST — EIN MEDIEN-PLUGIN (E87), nachgetragen am 29.08.2026.
  //
  // DERSELBE BEFUND WIE BEI DER ARD AM 04.08.2026: `dienstVon()` kennt
  // 'plugin' laengst (backend-api/src/medien.ts), aber diese Vorschau fuehrte
  // keine einzige Kachel damit — und tools/kachel-spielt-je-dienst.mjs kann
  // einen Dienst ohne Werk gar nicht erst antippen. Ohne diese Zeile bliebe
  // 'plugin' fuer immer ungemessen, ganz gleich, was app.js fuer diesen
  // Dienst tut oder nicht tut.
  //
  // `art: 'show'` folgt werke.ts artVon(): Plugin-Inhalt ist eine Folgenreihe
  // genau wie eine ARD-Sendung (`dienst === 'plugin'` -> `'show'`).
  //
  // ANGEHAENGT UND NICHT EINGESCHOBEN — siehe den Absatz zwei hoeher.
  { titel: 'Hörspielarchiv', interpret: 'Freies Archiv', kategorie: 'audiobook', art: 'show', dienst: 'plugin' },
]

/**
 * DIE ZWEITEN AUSGABEN — dasselbe Album noch einmal aus dem anderen Dienst.
 *
 * SIE STEHEN NUR UNTER `/vorschau/verschmolzen-an` in der Liste, und das ist
 * Absicht: ohne den Schalter sieht diese Vorschau aus wie die Box VOR dem
 * ersten Abgleich. Es geht um den ABSTAND der drei Zahlen, nicht um ihre
 * Hoehe — dieselbe Gestalt wie auf der Box (26 -> 24,
 * tools/verschmelzung-probe.mjs, 2026-08-03).
 *
 * NACHGEMESSEN AM 03.08.2026, nachdem WERKE um „Kiddinx Kinderlieder" wuchs
 * (curl gegen die laufende Vorschau, `/api/werke`):
 *
 *     ohne Schalter                    13 Werke
 *     verschmolzen-an, ohne Abfrage    15 Werke   (die zweiten Ausgaben)
 *     verschmolzen-an, verschmelzen=1  13 Werke   (wieder zusammengefuehrt)
 *
 * HIER STAND DIESELBE ZAHLENREIHE SCHON EINMAL, und sie war falsch: Sie nannte
 * 13/15/13, waehrend die Liste zwoelf Werke trug (also 12/14/12). Irgendwann
 * war ein Werk entfallen und der Kommentar mitgezogen worden — eine Zahl in
 * einem Kommentar altert lautlos. Wer eine Zeile hinzufuegt oder wegnimmt,
 * misst nach, statt zu rechnen.
 *
 * DIE BEIDEN FAELLE SIND ABSICHTLICH VERSCHIEDEN HERUM, denn nur dann zeigt
 * sich der Unterschied, an dem alles haengt:
 *
 *   „Die drei ???"       fuehrt der SPOTIFY-Eintrag (er steht in der Liste
 *                        vorn), gespielt wird ueber JELLYFIN. Identitaet und
 *                        Bevorzugung fallen also AUSEINANDER — das ist der
 *                        Fall „Das Lumpenpack" von der Box.
 *   „Benjamin Bluemchen" fuehrt der JELLYFIN-Eintrag, gespielt wird ebenfalls
 *                        ueber Jellyfin. Beides faellt zusammen — der Fall
 *                        „Kapelle Petra".
 *
 * Ohne den ersten Fall prueft eine Messung nur den bequemen und meldet „geht".
 */
const PARTNER = [
  { zu: 5, dienst: 'jellyfin' },
  { zu: 3, dienst: 'spotify' },
]

/**
 * Der laufende Index einer zweiten Ausgabe — DIESELBE Rechnung wie `rohListe`.
 *
 * SIE STAND ZWEIMAL DA, einmal gerechnet und einmal als Zeichenkette
 * (`'vorschau:13'` in WEITER). Beim Anhaengen eines dreizehnten Werks am
 * 03.08.2026 rutschte die gerechnete Zahl auf 14, die geschriebene blieb bei
 * 13 — und die gemerkte Stelle „Kapelle Petra" haette auf ein Werk gezeigt,
 * das es nicht gibt. Genau die Sorte Fehler, die als „die Reihe ist eben
 * kuerzer" durchgeht. Deshalb rechnet es jetzt eine Stelle fuer alle.
 */
const partnerIndex = (n) => WERKE.length + n

/** Die Bevorzugung des Servers (verschmelzung.ts QUELLEN_REIHENFOLGE).
 *  ABGESCHRIEBEN, nicht neu gewaehlt — eine zweite Reihenfolge hier hiesse,
 *  gegen eine andere Box zu messen als die, die es gibt. */
const QUELLEN_REIHENFOLGE = ['lokal', 'jellyfin', 'spotify']
const rang = (d) => {
  const i = QUELLEN_REIHENFOLGE.indexOf(d)
  return i >= 0 ? i : QUELLEN_REIHENFOLGE.length
}

/**
 * Taugt der Interpret? — dieselbe Frage wie `interpretTaugt` in werke.ts.
 *
 * DIE REGEL GEHOERT DEM SERVER, hier steht nur ihr Abbild: Die Attrappe
 * ERSETZT den Server, also muss sie liefern, was er liefert. Faellt sie hier
 * weg, zeigt die Vorschau ein „Unknown", das es auf der Box nicht mehr gibt —
 * und man repariert etwas, das heil ist.
 */
function interpretTaugtVorschau(w, kennung) {
  if (!w.interpret) return false
  if (w.dienst === 'lokal') return true
  if (!kennung || kennung.startsWith('t:')) return false
  if (w.dienst !== 'spotify') return true
  return /^[A-Za-z0-9]{22}$/.test(kennung)
}

/**
 * Eine Kennung, die zum Dienst passt.
 *
 * Radio und RSS tragen eine ADRESSE, keine Id (werke.ts artVon sagt das
 * ausdruecklich). Ihnen eine `jf-7` zu geben hiesse, die Oberflaeche gegen
 * etwas zu pruefen, das die Box nie liefert.
 */
function kennungFuer(dienst, i, w) {
  // OHNE KENNUNG: `medienSchluessel` baut dann einen Ersatz aus Interpret und
  // Titel — so sieht der echte „External Playback"-Eintrag der Box aus.
  if (w?.ohneKennung) return `t:${String(w.interpret || '').toLowerCase()}|${String(w.titel || '').toLowerCase()}`
  if (dienst === 'spotify') return `vorschau${String(i).padStart(2, '0')}ABCDEFGHIJKLM`.slice(0, 22)
  if (dienst === 'radio') return `http://stream.example.invalid/kinder${i}.mp3`
  if (dienst === 'rss') return `http://feed.example.invalid/podcast${i}.xml`
  if (dienst === 'lokal') return `hoerbuch/vorschau/${i}`
  // Die ARD fuehrt reine ZIFFERNFOLGEN (gemessen: 81889970 = „MausHoerspiel
  // kurz"). Eine `jf-14` haette hier keine Kennung nachgeahmt, sondern eine
  // erfunden, die es bei diesem Dienst nicht gibt.
  if (dienst === 'ard') return `8188997${i}`
  // EIN PLUGIN TRAEGT `<plugin-kennung>:<rest>` (pluginKennungAus,
  // backend-api/src/medien.ts) — erfunden, aber in der Form, die ein echtes
  // Plugin wie mixpi-archive auch liefert.
  if (dienst === 'plugin') return `mixpi-archive:vorschau${i}`
  return `jf-${i}`
}

/** Der normalisierte Kern eines Namens — wie `normal()` in medien.ts. */
function kern(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * WEN SPOTIFY ALS INTERPRETEN KENNT — EINE Liste fuer beide Endpunkte.
 *
 * Sie speist `/api/spotify/web/search` UND die Erkennung in
 * `/api/interpreten`. Zwei Listen liefen auseinander, und dann zeigte die
 * Vorschau eine runde Kachel, deren Tipp sie selbst mit „Zu diesem
 * Interpreten weiss Spotify hier nichts" abweist.
 *
 * NICHT ALLE Interpreten aus WERKE stehen darin, und das ist der Punkt:
 * „Verschiedene", „Sender", „Kinderfunk" und „Rolf" sind Ersteller und Label —
 * genau die Sorte, die auf der Box in `versteckt` landet (dort 7 von 16,
 * gemessen 03.08.2026 mit tools/interpreten-erkennung.mjs). Eine Attrappe, in
 * der JEDER erkannt wird, koennte den Knopf „freischalten" nie vorfuehren.
 */
const ECHTE_INTERPRETEN = ['WDR', 'Kiddinx', 'Europa', 'Hörspiel']

/**
 * DIE KENNUNG MUSS AUSSEHEN WIE EINE: 22 Zeichen aus Buchstaben und Ziffern.
 *
 * Hier stand einmal `art-kiddinx` — und die Oberflaeche lehnte den Tipp auf
 * die runde Kachel prompt ab („Zu diesem Interpreten weiss Spotify hier
 * nichts"), waehrend die Box es getan haette. Wieder eine Attrappe, die etwas
 * anderes liefert als das Geraet.
 */
function kennungBauen(name) {
  return `art${String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')}ABCDEFGHIJKLMNOPQRSTUV`.slice(0, 22)
}

/**
 * Die Kennung der ERKENNUNG — `null`, wenn Spotify den Namen nicht als
 * Interpreten fuehrt (`interpretAusTreffern`: OHNE KENNUNG KEIN JA).
 *
 * NICHT DIESELBE FRAGE WIE IN DER SUCHE, und das war hier eine Zeile lang
 * vermischt: die Suche gab `interpretKennung(n)` aus und lieferte damit fuer
 * „Alin Coen" `id: null` — ausgerechnet fuer den Fall, um den es geht.
 * `suchtrefferAus` (interpreten.ts) laesst so eine Zeile gar nicht durch, die
 * Verwaltung haette also nie einen Knopf „freischalten" zu sehen bekommen.
 * WER IN DER SUCHE STEHT, HAT EINE KENNUNG — sonst waere er kein Suchtreffer.
 * Erkannt zu werden ist die zweite, engere Frage (namensgenau).
 */
function interpretKennung(name) {
  if (
    !ECHTE_INTERPRETEN.some(
      (n) =>
        n.toLowerCase() ===
        String(name || '')
          .trim()
          .toLowerCase(),
    )
  ) {
    return null
  }
  return kennungBauen(name)
}

/**
 * Die Umbiegung aufs Coverfach — `bildDurchgereicht` (interpretenseite.ts).
 *
 * IN DER ABLAGE STEHT DIE ROHE CDN-ADRESSE, in der Reihe nie. Die Attrappe
 * hielt die fertig umgebogene Adresse vor und lieferte sie an BEIDEN Stellen
 * aus; damit haette die Verwaltung nie bemerkt, dass `frei[].bild` roh ist und
 * nicht in ein `<img src>` gehoert.
 */
function bildDurchgereicht(roh) {
  const u = String(roh || '').trim()
  if (!u) return null
  return u.startsWith('/api/') ? u : `/api/bild/extern?u=${encodeURIComponent(u)}`
}

/**
 * DIE FREISCHALTUNGEN — die Attrappe von config/interpreten.json.
 *
 * Sie liegt im Arbeitsspeicher und wird ueber `/vorschau/frei-*` und
 * `/vorschau/nein-*` gestellt. Die POST-Endpunkte schreiben ebenfalls hierhin,
 * damit die Verwaltungsoberflaeche im Entwicklungsbetrieb gegen dieselbe
 * Wahrheit arbeitet wie die Box.
 *
 * ALIN COEN steht nicht in WERKE — und genau deshalb ist sie der Fall, um den
 * es geht: ein freigeschalteter Interpret OHNE eigene Werke. Vor dem 03.08.2026
 * konnte so jemand in der Reihe gar nicht vorkommen, weil die Reihe ihre
 * Eintraege aus den Werken nahm.
 */
const ABLAGE = { frei: [], abgelehnt: [] }

const FREI_OHNE_WERKE = {
  schluessel: 'alin coen',
  id: kennungBauen('Alin Coen'),
  name: 'Alin Coen',
  quelle: 'suche',
  // ROH, so wie es in config/interpreten.json steht. Die Umbiegung macht
  // `bildDurchgereicht`, und zwar erst beim Bauen der Reihe — an EINER Stelle.
  bild: 'https://i.scdn.co/image/alincoen',
}

/**
 * Die Liste, aus der die Kacheln entstehen.
 *
 * OHNE SCHALTER sind es die dreizehn von jeher. Mit `verschmolzen-an` kommen
 * die zweiten Ausgaben (PARTNER) HINTEN dazu — hinten, weil die Bibliothek der
 * Box hinten waechst (`[...liste, e]`) und deshalb der VORDERE Eintrag der
 * aeltere und damit fuehrende ist (verschmelzung.ts). Wer sie vorn einfuegte,
 * bekaeme in der Vorschau eine andere Identitaet als auf der Box.
 */
function rohListe() {
  const liste = WERKE.map((w, i) => ({ w, i }))
  // DER DOPPELTE SCHLUESSEL — auf der Box gemessen, nicht ausgedacht
  // ([medienschluessel-kollision-gleiche-playlistid]): dieselbe `playlistid`
  // steht dort ZWEIMAL in data.json, einmal unter `music` und einmal unter
  // `audiobook`. `category` geht in den Schluessel nicht ein, also liefert
  // /api/werke ZWEI Werke mit demselben `schluessel`.
  //
  // ES IST DER LAUFENDE INDEX `1`, DER HIER ZAEHLT und nicht die Position in
  // der Liste: `kennungFuer` und der Schluessel haengen an ihm. Ein Eintrag mit
  // eigenem Index waere ein anderer Fall (zwei Werke, zwei Schluessel, eine
  // Playlist) — den gibt es auf der Box nicht, und die Attrappe soll die Box
  // zeigen und nicht eine Verwandte davon.
  //
  // NUR UNTER `/vorschau/doppelt-an`, aus demselben Grund wie bei PARTNER:
  // ohne den Schalter zaehlen alle vorhandenen Messwerkzeuge weiter dieselben
  // dreizehn Kacheln.
  if (lage.doppelt === 'an') liste.push({ w: { ...WERKE[1], kategorie: 'music' }, i: 1 })
  if (lage.verschmolzen !== 'an') return liste
  return [
    ...liste,
    ...PARTNER.map((p, n) => ({ w: { ...WERKE[p.zu], dienst: p.dienst }, i: WERKE.length + n, partnerZu: p.zu })),
  ]
}

/**
 * @param zusammen `verschmelzen=1` aus dem Abfrageteil — GENAU wie im Server.
 *   Der Schalter der Darstellung entscheidet ueber den Abfrageteil, der
 *   Abfrageteil ueber diese Antwort. Wer hier `lage.verschmolzen` allein
 *   auswertete, kaeme nie an den Fall „Schalter an, Abfrage aus" heran — und
 *   der ist der Rueckweg, wenn etwas schiefgeht.
 */
function werke(zusammen) {
  const roh = rohListe()
  const gebaut = roh.map(({ w, i }) => {
    const kennung = kennungFuer(w.dienst, i, w)
    const taugt = interpretTaugtVorschau(w, kennung)
    return {
      ...w,
      ohneKennung: undefined,
      schluessel: w.ohneKennung ? `${w.dienst}:${kennung}` : `vorschau:${i}`,
      // OHNE Cover heisst hier: der Server der Box wuerde 404 schicken und die
      // Kachel zeigte ihren Anfangsbuchstaben. Genau das ist zu sehen.
      bild: lage.cover ? `/api/bild/vorschau:${i}` : null,
      // ECHT AUSSEHENDE KENNUNGEN, keine `kennung-0`.
      //
      // Eine Spotify-Id ist 22 Zeichen aus Buchstaben und Ziffern. Die
      // Oberflaeche prueft das inzwischen (sie unterscheidet daran ein
      // Medium von einem Platzhalter wie „External Playback"), und mit
      // `kennung-0` fiel in der Vorschau JEDES Werk durch — die
      // Interpreten-Reihe blieb leer, und es sah nach einem Fehler in der
      // Oberflaeche aus. Eine Attrappe, die sich Kennungen ausdenkt, prueft
      // wieder einmal das Nichts.
      quellen: [{ dienst: w.dienst, kennung }],
      // WIE IM SERVER (werke.ts): normalisiert, nur wenn ein Interpret
      // dasteht — UND nur, wenn hinter ihm etwas Abspielbares liegt.
      // „Kiddinx" traegt hier zwei Werke, daraus wird ein Regal; „Unknown"
      // traegt ebenfalls zwei und darf trotzdem KEINS ergeben.
      interpret: taugt ? w.interpret : undefined,
      interpretSchluessel: taugt ? kern(w.interpret) || undefined : undefined,
    }
  })

  // DAS ZUSAMMENLEGEN — dieselbe Rechnung wie `verschmelzeWerke()`, nur so
  // weit, wie diese Vorschau sie braucht: der fuehrende Eintrag behaelt
  // Schluessel und Bild, die Quelle des Partners kommt dazu, und danach werden
  // die Quellen SORTIERT. `quellen[0]` ist damit die bevorzugte — genau das
  // liest die Oberflaeche (`quelleVon`), und genau darum geht es hier.
  const geschluckt = new Set()
  if (zusammen && lage.verschmolzen === 'an') {
    for (const { i, partnerZu } of roh) {
      if (partnerZu === undefined) continue
      const fuehrend = gebaut.find((g) => g.schluessel === `vorschau:${partnerZu}`)
      const partner = gebaut.find((g) => g.schluessel === `vorschau:${i}`)
      if (!fuehrend || !partner) continue
      fuehrend.quellen = [...fuehrend.quellen, ...partner.quellen].sort((a, b) => rang(a.dienst) - rang(b.dienst))
      fuehrend.auchSchluessel = [partner.schluessel]
      fuehrend.stufe = 'locker'
      geschluckt.add(partner.schluessel)
    }
  }
  const alle = []
  for (const g of gebaut) if (!geschluckt.has(g.schluessel)) alle.push(g)

  // ── DIE AUSWAHL DES AKTIVEN PROFILS ───────────────────────────────────
  // WIE IM SERVER (`auswahlFiltern`): eine LEERE Auswahl filtert NICHT — sie
  // heisst „alles". Diese eine Zeile ist die ganze Regel, die dafuer sorgt,
  // dass eine bestehende Box nach dem Update genau dasselbe zeigt wie vorher.
  const gewaehlt = auswahlVon(profilStand().aktiv)
  const heraus = gewaehlt.length ? alle.filter((g) => gewaehlt.includes(g.schluessel)) : alle

  return {
    // DER FINGERABDRUCK AENDERT SICH, WENN SICH DIE ANTWORT AENDERT.
    //
    // Bis 02.08.2026 stand hier die feste Zeichenkette `vorschau-1`. Damit war
    // in dieser Vorschau der ganze Zweig „Stand geaendert -> Raster neu malen"
    // TOT: `werkeHolen` steigt bei gleichem Stand aus (app.js), also lief
    // `zeichnen()` nach dem ersten Laden nie wieder. Wer daran gemessen haette,
    // ob ein Neuaufbau eine offene Lane ordentlich schliesst, haette „ja"
    // gemeldet, ohne dass je einer stattfand — [attrappe-luegt-durch-weglassen].
    //
    // WIE IM SERVER: dort ist es Anzahl + mtime von activedata.json
    // (`werkeStand`), also „was drinsteht" plus „wann es sich zuletzt aenderte".
    // Hier sind es die Anzahl und die Schalter, die diese Antwort ueberhaupt
    // veraendern — mehr braucht es nicht, und weniger luegt. `verschmolzen`
    // MUSS mit hinein: sonst bliebe der Stand beim Umlegen gleich, `werkeHolen`
    // stiege aus, und das Raster zeigte weiter die alte Kachelzahl.
    // DIE AUSWAHL GEHOERT IN DEN FINGERABDRUCK, wie an der Box
    // (`auswahlStempel`): sonst bliebe er beim Profilwechsel gleich,
    // `werkeHolen` stiege aus, und die Seite liesse das Regal des VORIGEN
    // Kindes stehen. Genau der Fall, den ein Stand ohne Profil verdeckt.
    stand: `vorschau-${heraus.length}-${lage.liste}-${lage.cover ? 'mit' : 'ohne'}-${lage.verschmolzen}${zusammen ? '-eins' : ''}-${profilStand().aktiv}-${gewaehlt.length}`,
    werke: heraus,
    // WAS EIN LEERES REGAL ERKLAERT — dieselben drei Zahlen wie `auswahlStand`
    // in auswahl.ts. Ohne sie kann die Startseite „die Box ist leer" nicht von
    // „fuer dieses Kind ist etwas gewaehlt, wovon nichts da ist" unterscheiden.
    auswahl: { gewaehlt: gewaehlt.length, vorrat: alle.length, sichtbar: heraus.length },
  }
}

// ── Die gemerkten Stellen — EINE Liste, zwei Verbraucher ──────────────────
//
// SIE STAND BIS 2026-08-02 IN `/api/weiterhoeren` EINGESCHLOSSEN. Damit konnte
// `/api/werke/<s>/alben` gar nichts von ihr wissen — und genau das ist die
// Auskunft, die den BLAUEN Play-Knopf in den Lanes traegt. Eine Attrappe, die
// zwei Antworten aus zwei Erfindungen baut, laesst sich widerspruchsfrei nie
// pruefen: Der Knopf saesse auf einem Album, in dem gar keine Stelle liegt.
// Im Server kommen beide Antworten aus derselben resume.json; hier aus
// derselben Liste. [attrappe-luegt-durch-weglassen]

/**
 * Wo die ARD-Sendung in WERKE steht, und welche Folge gemerkt ist.
 *
 * AUSGERECHNET STATT ABGESCHRIEBEN: Die Liste waechst hinten, und eine
 * hingeschriebene 9 zeigte nach dem naechsten Dienst auf ein fremdes Werk.
 * Die Folgenkennung folgt derselben Formel wie in `/inhalt` weiter unten —
 * beide muessen dieselbe nennen, sonst faerbt der blaue Knopf eine Kachel,
 * hinter der keine Stelle liegt.
 */
const ARD_INDEX = WERKE.findIndex((w) => w.dienst === 'ard')
const ARD_FOLGE_NR = 1
const ARD_FOLGE = `1660000${ARD_FOLGE_NR}`

/**
 * Die Kennung eines LOKALEN Titels — dieselbe Form wie der Ordner-Zweig des
 * Servers (/inhalt, server.ts): `<albumordner>#<nr>`, mit ABSOLUTEM Pfad.
 *
 * MIT LEERZEICHEN, mit Absicht („Die Maus", „WDR" sind Ordnernamen): genau an
 * ihnen zerbrach die Marke, bis `kennungsWort` (app.js) die Kennungsteile
 * kodierte — `data-spielt` ist eine leerzeichengetrennte Liste. Eine Attrappe,
 * deren Pfade keine Leerzeichen tragen, koennte diesen Fall nie messen und
 * waere gruen auf die gefaehrlichste Art.
 *
 * EINE Formel fuer beide Ausgaben (/inhalt-Titel UND `laeuft` an
 * /player/local): die Oberflaeche vergleicht die beiden Seiten miteinander,
 * und zwei Formeln liefen genau dann auseinander, wenn es darauf ankommt.
 */
const lokaleTitelId = (w, nr) => `/home/dietpi/MuPiBox/media/${w.kategorie}/${w.interpret}/${w.titel}#${nr}`

/**
 * Die Server-Auskunft „was laeuft" — aus dem Start-Gedaechtnis des Stubs
 * (`lage.gestartet`), nach dem Vertrag von laufendes-werk.ts.
 *
 * MIT gemerkter Liste kommt der Titel aus ihr (dieselben Objekte, die der
 * /api/spielen-Stub aus `inhaltAntwort` geholt hat). OHNE Liste — der
 * Grundzustand „Die Maus", gemerkt seit dem Hochfahren — gilt fuer ein
 * lokales Werk dieselbe Kennungsformel wie in /inhalt (`lokaleTitelId`),
 * sonst nur das Werk. Genau wie der echte Server: Titel nur, wenn er sich
 * belegen laesst.
 */
function laeuftAuskunft(g, nr) {
  const t = Array.isArray(g.titel) ? g.titel[nr - 1] : null
  if (t) {
    return {
      werk: g.werk,
      quelle: g.quelle,
      titelNr: nr,
      titelId: t.id == null ? '' : String(t.id),
      titelUri: t.uri == null ? '' : String(t.uri),
      titelName: String(t.titel || ''),
      titelQuelle: String(t.quelle || g.quelle || ''),
    }
  }
  const w = /^vorschau:(\d+)$/.exec(String(g.werk))
  const werkRoh = w ? WERKE[Number(w[1])] : null
  if (werkRoh && werkRoh.dienst === 'lokal') {
    return {
      werk: g.werk,
      quelle: 'lokal',
      titelNr: nr,
      titelId: lokaleTitelId(werkRoh, nr),
      titelUri: '',
      titelName: `Folge ${nr} — Eine ziemlich lange Geschichte mit Titel`,
      titelQuelle: 'lokal',
    }
  }
  return { werk: g.werk, quelle: g.quelle, titelNr: null, titelId: '', titelUri: '', titelName: '', titelQuelle: '' }
}

/**
 * DIE NAMEN DER FOLGEN — echte Sorte, nicht „Folge 3".
 *
 * WOZU (06.08.2026): Seit die Weiterhoeren-Kachel den FOLGENNAMEN zeigt statt
 * „Titel 2", entscheidet dieser Text, was auf dem Schirm steht. Eine Attrappe
 * mit „Folge 2 — Eine ziemlich lange Geschichte mit Titel" pruefte dabei
 * nichts: der Name saehe wie die Nummer aus, und ein Werkzeug koennte die
 * beiden Faelle gar nicht auseinanderhalten.
 *
 * SIE SIND VERSCHIEDEN LANG, und das ist Absicht: der lange Name ist der Fall,
 * an dem die Plakette ueber die Kachel hinauswuechse, wenn die CSS-Deckelung
 * fehlt.
 */
const ARD_FOLGEN_TITEL = [
  'Fälschung',
  'Der Schneemann taut',
  'Wie kommt der Strom in die Steckdose? Die Maus erklärt es',
  'Willi, der Kater',
  'Der Bär',
]
const ardFolgenTitel = (i) => ARD_FOLGEN_TITEL[i % ARD_FOLGEN_TITEL.length]

const weiterZeile = (i, extra) => ({
  key: `${WERKE[i].dienst}:kennung-${i}`,
  titel: WERKE[i].titel,
  interpret: WERKE[i].interpret,
  typ: WERKE[i].dienst,
  titelNr: 0,
  positionMs: null,
  positionProzent: null,
  anteil: null,
  zuletzt: 1785500000000 - i * 100000,
  schluessel: `vorschau:${i}`,
  bild: `/api/bild/vorschau:${i}`,
  ...extra,
})

/** Eine gemerkte Stelle OHNE Werk — sie steht in resume.json, ist aber
 *  nicht startbar. Auf der Box sind das die „Pummeleinhorn"-Zeilen. */
const weiterOhneWerk = (titel, zuletzt) => ({
  key: `spotify:weg-${zuletzt}`,
  titel,
  interpret: '',
  typ: 'spotify',
  titelNr: 2,
  positionMs: 30_000,
  positionProzent: null,
  anteil: 0.2,
  zuletzt,
})

/** Die gemerkten Stellen — als FUNKTION, nicht als Konstante.
 *  Sie haengen seit `verschmolzen-an` an der Lage, und die wird zur Laufzeit
 *  umgelegt. Eine beim Laden festgeschriebene Liste haette den Schalter still
 *  ueberhoert. */
const VERSCHMOLZEN = () => lage.verschmolzen === 'an'
const WEITER_ROH = () => [
  // DIE DREI NEUESTEN STELLEN FUEHREN AUF NICHTS — der Fall von der Box.
  // Sie kosten im Sechser-Fenster drei Plaetze, ohne je eine Kachel zu
  // werden. Wer danach in „Hoerbuch" oder im Regal „Kiddinx" steht, sah
  // vor dem 02.08.2026 weniger, als gemerkt ist.
  weiterOhneWerk('Pummeleinhorns Abenteuer - Der Wurzelwicht', 1785500300000),
  weiterOhneWerk('Hello Kitty - Alle Hoerspiele', 1785500200000),
  weiterOhneWerk('Vom Sternenreich zur Erde (Folge 1)', 1785500100000),
  // Spotify-PLAYLIST („Bibi Blocksberg"), Titel 4, 1:32 hinein
  // (Millisekunden!). Das ist zugleich die einzige Zeile, die in einer Lane
  // sichtbar wird: Werk 1 ist die einzige aufklappbare Playlist mit einer
  // gemerkten Stelle. Versatz 3 liegt im ERSTEN Album der Attrappe
  // („Das Eischneerodelfest", Versaetze 0..9) — dort muss der blaue Knopf
  // stehen, und nur dort.
  weiterZeile(1, { titelNr: 4, positionMs: 92_500, anteil: 92.5 / 240 }),
  // Lokal ueber mpv: Titelnummer und PROZENT.
  weiterZeile(0, { titelNr: 3, positionProzent: 41.5, anteil: 0.415 }),
  // MUSIK — der einzige Eintrag, der NICHT `audiobook` ist.
  //
  // Er ist die Gegenprobe zum gemeldeten Fehler: Steht das Kind in
  // „Hörbuch", darf genau diese Kachel nicht mehr dastehen; in „Musik"
  // dagegen nur noch sie. Ohne ihn prueft die Reihe gegen eine Auswahl,
  // in der ohnehin alles liegt.
  weiterZeile(2, { titelNr: 5, positionProzent: 30, anteil: 0.3 }),
  // DER ZWEITE „Kiddinx" — und damit die Gegenprobe fuers REGAL. Er liegt
  // ausserhalb des Sechser-Fensters: wer nur sechs Zeilen holt, sieht im
  // Regal „Kiddinx" nur eines der beiden gemerkten Werke.
  //
  // MIT `verschmolzen-an` HAENGT DIE STELLE AM GESCHLUCKTEN EINTRAG, und das
  // ist der ehrliche Fall: `istWeiterhoerbar` (weiterhoeren.ts) laesst
  // JELLYFIN gar nicht in die Reihe — eine gemerkte Stelle zu einem
  // Jellyfin-Album gibt es auf der Box nicht. Was es gibt, ist eine ueber
  // SPOTIFY gemerkte Stelle zu einem Album, dessen Kachel nach dem
  // Verschmelzen unter dem JELLYFIN-Schluessel steht („Kapelle Petra"). Genau
  // die steht hier: der Schluessel der ZWEITEN Ausgabe von WERKE[3]
  // (`partnerIndex(1)`), und den kennt `/api/werke` nach dem Verschmelzen
  // nicht mehr.
  VERSCHMOLZEN()
    ? {
        key: `spotify:kennung-${partnerIndex(1)}`,
        titel: WERKE[3].titel,
        interpret: WERKE[3].interpret,
        typ: 'spotify',
        titelNr: 6,
        positionMs: 61_000,
        positionProzent: null,
        anteil: 0.31,
        zuletzt: 1785500000000 - 3 * 100000,
        schluessel: `vorschau:${partnerIndex(1)}`,
        bild: `/api/bild/vorschau:${partnerIndex(1)}`,
      }
    : weiterZeile(3, { titelNr: 6, positionMs: 61_000, anteil: 0.31 }),
  // Titel 1 eines Albums: WEDER Plakette NOCH Balken. „Folge 1" sagt
  // nichts, und ein halbvoller Balken hiesse hier „das Album ist zur
  // Haelfte durch", waehrend es gerade erst angefangen hat.
  //
  // MIT `verschmolzen-an` TRAEGT DIESE ZEILE DEN GANZEN FALL 4 DES AUFTRAGS:
  // Werk 5 („Die drei ???") wird dann ueber JELLYFIN gespielt, die Stelle ist
  // aber ueber SPOTIFY gemerkt worden — Millisekunden, wo mpv Prozent will
  // ([resume-lokal-ist-prozent-nicht-sekunden]). Erst ab Titel 4 ist auch der
  // TITELSPRUNG zu sehen; bei 1 wird er uebersprungen und die Messung zeigte
  // nur die halbe Frage.
  weiterZeile(
    5,
    VERSCHMOLZEN() ? { titelNr: 4, positionMs: 45_000, anteil: 0.5 } : { titelNr: 1, positionMs: 45_000, anteil: 0.5 },
  ),
  // Podcast-Folge: keine Nummer, nur Prozent -> Balken.
  weiterZeile(7, { positionProzent: 62, anteil: 0.62 }),
  // DIE ARD — nachgetragen am 05.08.2026, und wieder aus dem Grund, den
  // [attrappe-luegt-durch-weglassen] beschreibt: Der Weiterhoeren-Weg der ARD
  // war gebaut (weiterhoeren.ts `resumeardfolge`), aber jedes Werkzeug, das
  // hier misst, haette fuenf von sechs Diensten gesehen.
  //
  // `folge` IST DAS FELD, AUF DAS ES ANKOMMT. Die Oberflaeche springt NICHT
  // auf `titelNr` — die Folgenliste einer Sendung rollt, und die Nummer gilt
  // nur fuer die Liste, in der sie entstanden ist. Sie sucht diese KENNUNG in
  // der frisch geholten Liste (`ardSendungAb` in NewDesign/app.js). Eine
  // Attrappe ohne `folge` liesse den Weg wortlos beim Anfang landen.
  //
  // SIE STEHT NORMALERWEISE AUSSERHALB DES SECHSER-FENSTERS, und das ist die
  // Wahrheit und kein Versehen: drei Zeilen fuehren auf nichts (siehe ganz
  // oben), und der Deckel ist 6. Wer die ARD-Zeile MESSEN will, holt sie mit
  // `curl localhost:8299/vorschau/verlauf-ard` nach vorn — dann und nur dann
  // traegt sie den juengsten Zeitpunkt. So bleibt die Vorgabe unveraendert
  // (kein anderes Werkzeug verliert seine Zeile), und die Messung hat trotzdem
  // einen Weg. Vorbild: `kontext-…` und `alben-…`.
  // `folgeTitel` KAM AM 06.08.2026 DAZU — und wieder war es dieselbe Falle.
  // Die Kachel sagt seitdem den NAMEN der Folge statt „Titel 2"; ohne dieses
  // Feld haette jedes Werkzeug weiterhin „Titel 2" gesehen und das fuer die
  // Wahrheit gehalten. Der Name ist derselbe wie in `/inhalt` unten — er MUSS
  // es sein, sonst prueft niemand, ob die beiden zusammenpassen.
  weiterZeile(ARD_INDEX, {
    titelNr: 2,
    positionProzent: 41.5,
    anteil: 0.415,
    folge: ARD_FOLGE,
    folgeTitel: ardFolgenTitel(1),
    ...(lage.verlauf === 'ard' ? { zuletzt: 1785500400000 } : {}),
  }),
  // Aus der Bibliothek genommen: bleibt gemerkt, ist aber nicht startbar.
  weiterOhneWerk('Laengst geloescht', 1),
]

/**
 * Die gemerkte Stelle zu EINEM Werk — die Vorlage fuer `weiterAb`.
 *
 * NUR DIE ZUORDNUNG, NICHT DIE REGEL. Ob aus einer Stelle ein blauer Knopf
 * wird, entscheidet `src/backend-api/src/lane-weiter.ts` und ist dort geprueft
 * (lane-weiter.spec.ts). Hier wird nachgeahmt, was der Server daraus MACHT —
 * damit die Oberflaeche das Feld ueberhaupt zu sehen bekommt. Eine Vorschau,
 * die `weiterAb` gar nicht liefert, zeigt nie einen blauen Knopf, und man
 * haelt das fuer ein Ergebnis.
 */
function weiterStelleFuer(schluessel) {
  if (lage.verlauf === 'leer') return null
  const z = WEITER_ROH().find((x) => x.schluessel === schluessel)
  if (!z) return null
  const nr = Number(z.titelNr)
  if (!Number.isFinite(nr) || nr < 1) return null
  const ms = Number(z.positionMs)
  return { titelNr: Math.round(nr), positionMs: Number.isFinite(ms) && ms > 0 ? Math.round(ms) : 0 }
}

/**
 * Die Antwort von /player/local.
 *
 * DIE FELDNAMEN SIND NICHT ERFUNDEN, sondern abgelesen aus
 * `now-playing.ts:39-57` — dort steht, was die Oberflaeche wirklich liest:
 * `currentPlayer === 'mplayer'`, `playing`, `currentTrackname`, `album`,
 * `path`, `timePos`, `duration`.
 *
 * Beim ersten Versuch standen hier `title`/`state`/`position`, wie man sie
 * erwarten wuerde. Die Seite zeigte daraufhin gar keinen Player — und das sah
 * aus wie ein Fehler in der Seite, war aber einer in der Attrappe. Eine
 * Vorschau, deren Antworten nicht dem Vertrag folgen, prueft nichts.
 */
function lokal() {
  if (lage.spielt === 'still') return { currentPlayer: 'mplayer', playing: false, currentTrackname: '' }
  // BEI SPOTIFY MUSS MPV SCHWEIGEN. `jetztLaeuft` gibt LOKAL den Vorrang
  // (now-playing.ts toNowPlaying) — meldete mpv hier weiter einen Titel,
  // saehe die Oberflaeche den Spotify-Zustand nie an, und der Zweig fuer den
  // laufenden Titel in der Lane liesse sich nicht messen.
  //
  // `currentPlayer` STAND HIER AUF 'mplayer', UND DAS WAR FALSCH. Am Geraet
  // gemessen (Box .169, 03.08.2026, und schon in llmwiki
  // [attrappe-gruen-geraet-rot-loser-titel] notiert): waehrend Spotify spielt,
  // meldet /player/local `currentPlayer: "spotify"`. Der falsche Wert fiel
  // nie auf, weil `jetztLaeuft` mit `playing: false` und leerem
  // `currentTrackname` ohnehin in den Spotify-Zweig faellt — er wurde nie
  // GELESEN. Seit `weiterSpielen` an genau diesem Feld entscheidet, ob es vor
  // dem Start eine Atempause braucht, wird er gelesen, und dann waere die
  // Attrappe der Grund, warum die Reparatur „nicht wirkt".
  if (lage.spielt === 'spotify')
    return { currentPlayer: 'spotify', playing: true, currentTrackname: '', volume: lage.laut }
  // ══ EINE FREMDE WIEDERGABE — `curl localhost:8299/vorschau/mpv-fremd` ═════
  //
  // WOZU (06.08.2026, beim Gegenlesen): Es gibt an der Box einen zweiten und
  // einen dritten Weg, mpv anzuwerfen — die klassische Oberflaeche auf
  // demselben Schirm, ein Telefon, die PHP-Verwaltung. Dann ERSETZT mpv die
  // Warteschlange, und `currentTracknr` zaehlt in einer Liste, von der die
  // neue Oberflaeche nichts weiss. Solange diese Attrappe IMMER dasselbe Werk
  // meldete, liess sich die Frage „zeigt die Leiste dann noch das Bild der
  // vorigen Sendung?" gar nicht stellen — wieder die Sorte
  // [attrappe-luegt-durch-weglassen]: der fehlende Fall.
  //
  // GEMELDET WIRD EIN WERK, DAS ES IN DER LISTE WIRKLICH GIBT („Kiddinx
  // Kinderlieder", lokal). Ein erfundener Name faende in der Coverkarte
  // nichts, und dann waere nicht zu unterscheiden, ob die Oberflaeche richtig
  // umschaltet oder bloss nichts findet.
  if (lage.fremd) {
    return {
      currentPlayer: 'mplayer',
      playing: lage.spielt === 'spielt' || lage.spielt === 'nachlauf',
      currentTrackname: 'Kiddinx — Lied 2',
      album: 'Kiddinx',
      path: '/home/dietpi/MuPiBox/media/music/Kiddinx/Kiddinx Kinderlieder/02.mp3',
      timePos: 12,
      duration: 180,
      currentTracknr: lage.mpvTitel,
      totalTracks: 9,
      volume: lage.laut,
    }
  }
  // EIN LIED, BEI DEM INTERPRET UND ALBUM VERSCHIEDEN SIND.
  //
  // WOZU EIN EIGENER ZUSTAND: In allen anderen lokalen Zustaenden hier sind
  // beide gleich ("Die Maus"/"Die Maus", "Kiddinx"/"Kiddinx"). Damit laesst
  // sich nicht pruefen, ob die Oberflaeche den INTERPRETEN oder die
  // UNTERZEILE verschickt — beide Wege lieferten dasselbe Wort, und ein Test
  // darauf waere gruen, ohne etwas zu zeigen. Genau dieser Unterschied ist
  // der Fehler, den der Songtext-Zeuge fangen soll.
  if (lage.spielt === 'lied') {
    return {
      currentPlayer: 'mplayer',
      playing: true,
      currentTrackname: 'Rolf Zuckowski - Der Bewegungsbaer',
      album: 'Bewegungshits',
      path: '/home/dietpi/MuPiBox/media/music/Rolf Zuckowski/Bewegungshits/03.mp3',
      timePos: 30,
      duration: 150,
      currentTracknr: 3,
      totalTracks: 12,
      volume: lage.laut,
    }
  }
  // BEI `nachlauf` SPIELT MPV — und zwar GLEICHZEITIG mit einem Spotify-
  // Zustand, der noch dasteht (siehe `dienst()`). Genau darum geht es dort.
  //
  // ══ DAS START-GEDAECHTNIS DES SERVERS (`laeuft`, 12.09.2026) ═════════════
  //
  // Der echte Server merkt sich bei jedem /api/spielen, welches Werk er
  // angeworfen hat, und haengt die Zuordnung an GENAU DIESE Antwort
  // (laufendes-werk.ts). Sie ist der Grund, warum die Marke ein Neuladen der
  // Seite ueberlebt — tools/marke-ohne-eigenen-start.mjs, Fall 2, misst das.
  // Die Kennung folgt derselben Formel wie die /inhalt-Titel unten
  // (`lokaleTitelId`); zwei Formeln liefen auseinander.
  //
  // NICHT bei `lage.fremd`: ein fremder Start am Proxy raeumt das Gedaechtnis
  // des echten Servers (server.ts), also liefert auch die Attrappe dann
  // keines — sonst prueften die Fremd-Faelle einen Zustand, den es nie gibt.
  return {
    currentPlayer: 'mplayer',
    playing: lage.spielt === 'spielt' || lage.spielt === 'nachlauf',
    currentTrackname: 'Folge 3 — Die Maus',
    album: 'Die Maus',
    path: '/home/dietpi/MuPiBox/media/maus/folge3.mp3',
    ...(lage.laeuftServer === 'an' && lage.gestartet
      ? { laeuft: laeuftAuskunft(lage.gestartet, lage.mpvTitel) }
      : {}),
    timePos: 421,
    duration: 1320,
    // DIE STELLE IN DER WARTESCHLANGE. Sie fehlte hier bis 2026-08-02, und
    // damit meldete die Oberflaeche beim Merken der Weiterhoeren-Stelle
    // `titelNr: 0` — also „von vorn". Wer daran geprueft haette, haette den
    // ganzen Titelsprung fuer kaputt gehalten, dabei fehlte nur das Feld.
    // Herkunft: spotify-control.ts currentMeta.currentTracknr/totalTracks,
    // von mpv erfragt (playlist_pos/playlist_count), nicht gezaehlt.
    // ── SEIT 06.08.2026 VERSTELLBAR: `curl localhost:8299/vorschau/mpv-weiter`
    //
    // WARUM (wieder [attrappe-luegt-durch-weglassen], jetzt in der Sorte
    // „fehlender ZEITLICHER VERLAUF" wie schon bei `spotify-weiter`): Bei mpv
    // gibt es keinen `item.uri`, an dem man einen Titelwechsel ablesen kann —
    // die einzige Auskunft ist DIESE Nummer. Solange sie hier festgenagelt
    // war, liess sich „folgt das Cover der laufenden Folge?" gar nicht
    // stellen: Ein Werkzeug haette eine Anzeige gesehen, die sich nicht
    // bewegt, und das fuer ein Ergebnis gehalten — waehrend die Frage nie
    // gestellt wurde.
    //
    // AM GERAET GEMESSEN (Box .169, 06.08.2026) ist genau das der Alltag: Am
    // Titelende zaehlt `currentTracknr` OHNE jeden Befehl von aussen weiter.
    currentTracknr: lage.mpvTitel,
    totalTracks: 12,
    // `currentMeta.volume` — die Oberflaeche liest die Lautstaerke aus DIESER
    // Antwort, nicht aus einer eigenen. Fehlte sie hier, blieben die
    // Lautstaerke-Tasten ohne Stand und der Balken auf 0.
    volume: lage.laut,
  }
}

/**
 * DIE TITEL, DURCH DIE `/vorschau/spotify-weiter` schaltet.
 *
 * WARUM ES SIE GIBT: Bis zum 03.08.2026 konnte diese Vorschau nur EINEN
 * Spotify-Zustand. Zwei aufeinanderfolgende /player/state mit VERSCHIEDENEM
 * `item.uri` — also genau das, was beim Weiterschalten passiert — liessen
 * sich damit gar nicht stellen. Wer „zieht die Anzeige beim Titelwechsel
 * nach?" daran gemessen hat, hat nichts gemessen: wieder
 * [attrappe-luegt-durch-weglassen], diesmal fehlte kein Feld, sondern der
 * ZEITLICHE VERLAUF.
 *
 * JEDER TITEL BRINGT SEIN EIGENES BILD MIT (`album.images`). Auch das fehlte
 * vorher, und es fehlte folgenreich: `coverAdresse()` liest bei Spotify
 * ausschliesslich `item.album.images[0].url`. Ohne dieses Feld faellt sie auf
 * „was von hier aus gestartet wurde" zurueck, und das aendert sich beim
 * Weiterschalten NIE. Das Cover haette in der Vorschau also selbst dann
 * stillgestanden, wenn die Oberflaeche alles richtig macht.
 *
 * Die Adressen zeigen auf /api/bild/vorschau:<n>; die Vorschau leitet sie
 * alle auf dasselbe Maskottchen um. Das genuegt: geprueft wird, ob die
 * Oberflaeche eine ANDERE Adresse einsetzt, nicht welche Pixel ankommen.
 */
const SPOTIFY_TITEL = [
  {
    name: 'Kapitel 7: Das Eischneerodelfest',
    uri: 'spotify:track:alb0-6',
    track_number: 7,
    duration_ms: 240_000,
    artists: [{ name: 'Vorschau' }],
    album: { name: 'Das Eischneerodelfest', images: [{ url: '/api/bild/vorschau:1' }] },
    progress_ms: 61_000,
  },
  {
    name: 'Kapitel 8: Der Schneemann taut',
    uri: 'spotify:track:alb0-7',
    track_number: 8,
    duration_ms: 198_000,
    artists: [{ name: 'Zweiter Interpret' }],
    album: { name: 'Der Schneemann taut', images: [{ url: '/api/bild/vorschau:2' }] },
    progress_ms: 3_000,
  },
  {
    // DER DRITTE SCHRITT VERLAESST DAS ALBUM — und das ist der Grund, warum es
    // ihn gibt. Die beiden ersten Titel liegen beide in `alb0`; solange die
    // Vorschau nur zwischen ihnen schaltet, kann sie den Fall gar nicht
    // stellen, in dem die Marke „spielt gerade" aus der GEOEFFNETEN Titel-Lane
    // herauswandert. Genau dieser Fall tritt an der Box alle zehn bis dreizehn
    // Titel ein: Am Ende eines Albums laeuft der naechste Titel in `alb1`
    // weiter — und wer die Titelliste von `alb0` offen hat, sieht die Marke
    // verschwinden. Wieder [attrappe-luegt-durch-weglassen], diesmal fehlte
    // die ALBUMGRENZE (nachgetragen am 03.08.2026 beim Gegenlesen).
    //
    // `spotify:track:alb1-10` ist der ERSTE Titel des zweiten Albums, siehe
    // `album('Der Wurzelwicht', 'alb1', 10, 11)` weiter unten. Der
    // Zusammenhang (`context.uri`) bleibt auch hier derselbe — es ist
    // dieselbe Playlist, nur ein anderes Album darin.
    name: 'Kapitel 1: Der Wurzelwicht',
    uri: 'spotify:track:alb1-10',
    track_number: 1,
    duration_ms: 212_000,
    artists: [{ name: 'Vorschau' }],
    album: { name: 'Der Wurzelwicht', images: [{ url: '/api/bild/vorschau:3' }] },
    progress_ms: 1_000,
  },
  {
    // DER VIERTE GEHOERT ZU KEINEM GANZEN ALBUM — er steht unter den `lose`.
    //
    // WARUM ES IHN GIBT (03.08.2026): Genau dieser Fall lief an der Box und
    // war hier nicht zu stellen. Die Playlist „EMMA6 - Complete" beginnt mit
    // zwoelf einzelnen Titeln; die Box spielte einen davon. Das Raster trug
    // die Marke, die Album- und die Titel-Lane trugen keine — nicht weil der
    // Vergleich falsch war, sondern weil ein loser Titel in der Album-Lane gar
    // keine Kachel hatte. Alle drei bisherigen Marken-Werkzeuge meldeten
    // trotzdem „keine Abweichung": sie spielten immer einen Titel AUS EINEM
    // ALBUM. Wieder [attrappe-luegt-durch-weglassen] — diesmal fehlte weder
    // ein Feld noch der zeitliche Verlauf, sondern eine ganze SORTE von Titel.
    //
    // ER IST NUR UEBER `/vorschau/spotify-lose` ZU ERREICHEN und nicht ueber
    // `spotify-weiter`: Die drei Titel darueber bilden einen Rundlauf, den
    // andere Werkzeuge abschreiten (tools/lane-marke-wandert.mjs). Ein
    // vierter Halt darin haette deren Messung verschoben.
    name: 'Introsong',
    uri: 'spotify:track:lose-23',
    track_number: 1,
    duration_ms: 154_000,
    artists: [{ name: 'Vorschau' }],
    album: { name: 'Introsong', images: [{ url: '/api/bild/vorschau:4' }] },
    progress_ms: 12_000,
  },
]

/** Wie viele der Titel oben `spotify-weiter` durchlaeuft — die losen Titel
 *  dahinter gehoeren NICHT zum Rundlauf (siehe Kommentar dort). */
const SPOTIFY_RUNDLAUF = 3
/** Der Platz des losen Titels in `SPOTIFY_TITEL`. */
const SPOTIFY_LOSE = 3

/**
 * Herkunft: now-playing.ts:63 ff. — der Spotify-Zweig liest `item`.
 *
 * `item: null` WAR DIE GANZE ANTWORT, und damit war der Spotify-Zweig dieser
 * Vorschau tot: `jetztLaeuft` steigt ohne `item.name` aus, `laufendesWerk`
 * ohne `context.uri`. Wer daran „laeuft der richtige Titel?" gemessen hat, hat
 * das Nichts geprueft — [attrappe-luegt-durch-weglassen]. Seit dem 02.08.2026
 * gibt es die Lage `spotify`, und sie meldet einen VOLLSTAENDIGEN Zustand:
 *
 *   context.uri   die Playlist von Werk 1 („Bibi Blocksberg"), damit
 *                 `laufendesWerk()` sie ueber die Kennung wiederfindet
 *   item.uri      Versatz 6 des ersten Albums — ABSICHTLICH ein ANDERER
 *                 Titel als die gemerkte Stelle (Versatz 3). Nur so laesst
 *                 sich pruefen, dass „das laeuft gerade" und „hier geht es
 *                 weiter" NICHT gleich aussehen.
 *   track_number  die Nummer im ALBUM (7) und nicht in der Playlist — genau
 *                 die Falle aus [weiterhoeren-playlist-position]. Wer sich
 *                 auf sie stuetzt, markiert die falsche Kachel.
 */
function dienst() {
  if (lage.spielt === 'spotify' || lage.spielt === 'nachlauf') {
    const kennung = kennungFuer('spotify', 1, WERKE[1])
    const { progress_ms, ...stueck } = SPOTIFY_TITEL[lage.spotifyTitel % SPOTIFY_TITEL.length]
    return {
      // BEI `nachlauf` MELDET SPOTIFY SELBST, DASS ES NICHT SPIELT — und
      // traegt seinen Zusammenhang und sein `item` trotzdem weiter. Genau so
      // verhaelt sich /player/state, wenn librespot schweigt und in Wahrheit
      // mpv spielt ([spotify-nachlauf-muster]); der Kommentar an
      // `laufendesWerkMitBeweis` in NewDesign/app.js nennt denselben Fall als
      // Grund fuer seine Bremse. Ohne diese Lage laesst er sich nicht messen:
      // die Vorschau kannte bis 03.08.2026 nur „Spotify spielt" ODER „item:
      // null" — der Zustand DAZWISCHEN, in dem zwei Quellen widersprechen,
      // war nicht zu stellen ([attrappe-luegt-durch-weglassen]).
      is_playing: lage.spielt === 'spotify',
      // DER ZUSAMMENHANG BLEIBT DERSELBE — auch beim Weiterschalten. So
      // verhaelt sich die Box: gemessen am 03.08.2026 mit
      // tools/spotify-weiterschalten.py, 5 von 5 next blieben in derselben
      // Playlist. Eine Vorschau, die hier die Playlist wechselte, wuerde eine
      // Ursache vorspiegeln, die es nicht gibt.
      //
      // `lage.kontext` schiebt einen ANDEREN unter. Gebraucht wird das fuer
      // verschmolzene Werke: dort liegt die Spotify-Quelle auf `quellen[1]`,
      // und ihr `context.uri` steht in keiner der festen Lagen.
      context: { uri: lage.kontext === 'standard' ? `spotify:playlist:${kennung}` : lage.kontext },
      item: stueck,
      progress_ms,
    }
  }
  return { is_playing: lage.spielt === 'spielt', item: null }
}

async function datei(res, pfad) {
  try {
    const inhalt = await readFile(pfad)
    res.setHeader('Content-Type', TYPEN[extname(pfad)] || 'application/octet-stream')
    res.setHeader('Cache-Control', 'no-store')
    res.end(inhalt)
  } catch {
    res.statusCode = 404
    res.end('nicht da')
  }
}

/**
 * `stand` ist seit 03.08.2026 da und war vorher stillschweigend verschluckt:
 * `jsonAus(res, {error:'sucheLeer'}, 400)` antwortete mit 200. Eine Attrappe,
 * die den ERFOLGSFALL auch dann meldet, wenn sie einen Fehler meint, laesst
 * jede Fehlerbehandlung der Oberflaeche ungeprueft.
 */
/**
 * DER PROFILSTAND — an EINER Stelle gebaut, von drei Zweigen gelesen
 * (`GET /api/profile`, `POST /api/profil/aktiv`, `POST /api/profil/figur`).
 *
 * WARUM NICHT DREIMAL HINGESCHRIEBEN: Genau das war der Fall, den die
 * Oberflaeche danach nicht mehr pruefen kann. Sie uebernimmt den Stand AUS DER
 * ANTWORT auf `profil/figur` — antwortete dieser Zweig mit einer anderen
 * Liste als der GET, saehe man nach dem Waehlen ein Bild, das nach dem
 * Neuladen wieder weg ist, und wuesste nicht, ob die Oberflaeche oder die
 * Attrappe luegt.
 *
 * HIER TRUG LIAM `mixpi-winkt.png` — EINEN NAMEN OHNE DATEI, mit der
 * Begruendung, so sehe man bei jedem Lauf die Silhouette statt eines leeren
 * Bildzeichens. Das war eine Lage, DIE ES AN DER BOX NICHT GIBT: `GET
 * /api/profile` nennt dort seit dem 05.08.2026 nur Figuren, zu denen eine
 * Datei existiert (server.ts, „Eine Figur, die es nicht gibt, wird nicht
 * genannt"; gepruef in figuren.integration.spec.ts). Ein Name ohne Datei kommt
 * dort gar nicht erst bis zur Oberflaeche. Liam traegt deshalb jetzt eine
 * Figur, die im Ordner LIEGT — welche Lage daraus wird, entscheidet
 * `/vorschau/figuren-*`, genau wie an der Box der Ordner entscheidet.
 */
const FIGUREN_ECHTE = [
  'mixpi-hoert.png',
  'mixpi-spielt.png',
  'mixpi-schlaeft.png',
  'mixpi-sucht.png',
  'mixpi-farben.png',
  'mixpi-gestalten.png',
  'mixpi-blase.png',
  'mixpi-passwort.png',
  'mixpi-fehler.png',
  'mixpi-kein-bild.png',
]

/**
 * WAS `GET /api/figuren` GERADE NENNEN WUERDE — an einer Stelle, weil zwei
 * Zweige dieselbe Frage stellen. Liefe das auseinander, koennte diese
 * Attrappe ein Profil mit einer Figur nennen, die sie im selben Atemzug nicht
 * kennt: genau die Lage, die es an der Box nicht gibt.
 */
function figurenLage() {
  // ── `viele`: DER ORDNER, WIE ER SEIT DEM 08.08.2026 WIRKLICH AUSSIEHT ────
  //
  // 78 freigestellte Figuren liegen in NewDesign/bilder/figuren, und die
  // Vorschau liefert genau diesen Ordner ohnehin statisch aus. Eine
  // Attrappe, die dazu zehn Namen nennt, kann die Frage nicht beantworten,
  // fuer die sie gebraucht wird: ob die Bildwahl bei ACHTZIG Bildern noch
  // bedienbar ist (die Gruppierung, Betreiber 08.08.2026).
  //
  // GELESEN, NICHT ABGESCHRIEBEN: Eine Liste von 78 Namen im Quelltext waere
  // am naechsten Tag falsch. Wer eine Figur dazulegt, sieht sie hier sofort
  // — so wie an der Box, wo ebenfalls der Ordner entscheidet.
  if (lage.figuren === 'viele') {
    let dateien = []
    try {
      dateien = readdirSync(join(SEITE, 'bilder/figuren'))
        .filter((n) => /\.png$/i.test(n))
        .sort()
    } catch {
      // Kein Ordner, keine Figuren — dasselbe, was die Box dann sagt.
    }
    return { ordner: 'bilder/figuren', figuren: dateien, uebergangen: [] }
  }
  if (lage.figuren === 'da') return { ordner: 'bilder', figuren: FIGUREN_ECHTE, uebergangen: [] }
  if (lage.figuren === 'fehlt') {
    return { ordner: 'bilder/figuren', figuren: FIGUREN_ECHTE, uebergangen: ['Brille.PNG', 'foto.jpg'] }
  }
  return { ordner: 'bilder/figuren', figuren: [], uebergangen: [] }
}

/**
 * DIE SCHLOESSER DER PROFILE (14.08.2026) — kennung -> { art, kanon }.
 *
 * DIE ATTRAPPE MERKT SICH DEN KLARTEXT, und das ist hier richtig: sie prueft
 * die REGELN (401 ohne, 403 falsch, Gast nie, alt vor neu), nicht die
 * Verschluesselung — bcrypt gehoert dem echten Server und seiner
 * Integrations-Spec. Nach draussen gehen wie dort nur `geschuetzt` und
 * `passwortArt` (profilMitSchloss unten), nie das Geheimnis.
 */
const PASSWOERTER = new Map()

/**
 * Aussehen je Profil (Farbsatz, Licht), fluechtig wie die Passwoerter oben:
 * die Vorschau stellt die REGELN nach, nicht die Ablage — darstellung.json
 * je Bereich gehoert dem echten Server und seiner Integrations-Spec.
 */
const AUSSEHEN = new Map()

/** Ein Profil, wie es die Antwort traegt: mit Schloss-Auskunft, ohne Geheimnis. */
function profilMitSchloss(p) {
  const s = p.kennung === 'gast' ? undefined : PASSWOERTER.get(p.kennung)
  return { ...p, geschuetzt: !!s, ...(s ? { passwortArt: s.art } : {}) }
}

/** Der Stand samt Schloss-Auskunft je Profil — die Form JEDER Antwort. */
function profilStand() {
  const s = profilStandRoh()
  // `gastAktiv` GEHOERT IN JEDE ANTWORT, nicht nur wenn es false ist: die
  // Oberflaeche prueft ausdruecklich auf `=== false`, und ein fehlendes Feld
  // ist dort „unbekannt", nicht „an". Der echte Server schickt es immer
  // (profile.ts: `gastAktiv: stand.gastAktiv !== false`).
  return { ...s, gastAktiv: lage.gast !== 'aus', profile: s.profile.map(profilMitSchloss) }
}

function profilStandRoh() {
  // WAS GESCHRIEBEN WURDE, GILT. Der Zweig steht VOR allem anderen: eine
  // Attrappe, die eine Umbenennung annimmt und danach den alten Namen nennt,
  // ist schlimmer als eine, die das Schreiben gar nicht kann.
  if (lage.profileGeschrieben) {
    const liste = lage.profileGeschrieben
    const aktiv = liste.some((p) => p.kennung === lage.profil) ? lage.profil : 'gast'
    return { profile: liste, aktiv }
  }
  const gewaehlt = lage.figurGewaehlt
  const figurVon = (kennung, vorgabe) =>
    gewaehlt !== null && kennung === (lage.profil === 'allein' ? 'gast' : lage.profil) ? gewaehlt : vorgabe
  if (lage.profil === 'allein') {
    return { profile: [{ kennung: 'gast', name: 'Gast', figur: figurVon('gast', ''), angelegt: 0 }], aktiv: 'gast' }
  }
  return {
    profile: [
      { kennung: 'gast', name: 'Gast', figur: figurVon('gast', ''), angelegt: 0 },
      { kennung: 'liam', name: 'Liam', figur: figurVon('liam', 'mixpi-sucht.png'), angelegt: 1754000000000 },
      { kennung: 'kalea', name: 'Kalea', figur: figurVon('kalea', 'mixpi-hoert.png'), angelegt: 1754100000000 },
    ],
    aktiv: lage.profil,
  }
}

/**
 * DIE WANDERUNG — dieselbe wie in server.ts, und NUR im GET.
 *
 * WAS SIE TUT: Eine Figur, die `GET /api/figuren` nicht nennt, wird zu LEER.
 * Der echte Server macht das, weil er den Ordner liest; hier ist der Ordner
 * `lage.figuren`.
 *
 * WARUM SIE HIER FEHLTE UND WAS DAS KOSTETE: Ohne sie antwortete diese
 * Attrappe im REGELFALL (`figuren-keine` — der heutige Stand der Box, der
 * Ordner ist leer) mit „Liam hat mixpi-winkt.png". Die Oberflaeche baute
 * daraus einen Pfad, holte sich eine 404 und liess die Silhouette stehen. An
 * der Box haette derselbe Zustand LEER ergeben und damit das Standardbild.
 * Die Vorschau zeigte also den NOTFALL, wo die Box den Regelfall zeigt —
 * und zwei Pruefwerkzeuge (`rueckweg-schau.mjs`, `ich-zeichen-schau.mjs`)
 * meldeten gruen ueber eine Lage, die es nicht geben kann
 * ([[attrappe-luegt-durch-weglassen]]).
 *
 * NUR IM GET, UND DAS IST KEIN VERSEHEN: Der echte Server filtert in
 * `GET /api/profile`, aber NICHT in den Antworten von `POST /api/profil/aktiv`
 * und `POST /api/profil/figur` — die geben `profilStand` ungefiltert zurueck.
 * Eine Attrappe, die an dieser Stelle ordentlicher waere als die Box, machte
 * den Unterschied unsichtbar, statt ihn messbar zu halten.
 */
function profilStandGefiltert() {
  const da = new Set(figurenLage().figuren)
  const stand = profilStand()
  return { ...stand, profile: stand.profile.map((p) => (p.figur && !da.has(p.figur) ? { ...p, figur: '' } : p)) }
}

/* ══ DIE AUSWAHL JE KIND — was ein Kind von der Bibliothek sehen darf ══════
 *
 * SEIT DEM 07.08.2026 GIBT ES SIE (auswahl.ts, `ABLAGE_AUSWAHL`). Ohne sie in
 * dieser Attrappe waere der neue Schirm „Medien für Liam" nicht vorzufuehren:
 * Er holt beim Aufschlagen `GET /api/profil/auswahl`, bekaeme eine 404 und
 * stuende dauerhaft auf „lässt sich nicht laden" — man saehe also nur den
 * Notfall und nie den Regelfall ([[attrappe-luegt-durch-weglassen]]).
 *
 * DIE REGEL IST DIE DES SERVERS UND KEINE EIGENE MEINUNG:
 *   leere Liste  = KEINE Einschraenkung, das Kind sieht alles
 *   Gast         = bekommt NIE eine (400 `gastOhneAuswahl`)
 *   unbekanntes Profil = 400
 *
 * ── EINE NAHT, DIE MAN KENNEN MUSS ────────────────────────────────────────
 * `MEDIEN` (die Verwaltungsliste) und `WERKE` (die Startseite) sind in dieser
 * Attrappe ZWEI Fixtures mit VERSCHIEDENEN Schluesseln (`spotify:1DYD` gegen
 * `vorschau:3`) — an der Box ist es dieselbe Liste. Wer hier also im Fach
 * „Kinder" etwas auswaehlt, bekommt auf der Startseite ein LEERES Regal.
 * Das ist kein Fehler dieser Attrappe, sondern genau die dritte nicht
 * verhandelbare Lage („ein leeres Regal sagt, warum") — und sie laesst sich
 * so ueberhaupt erst ansehen. Den NORMALFALL stellt
 *     curl localhost:<port>/vorschau/auswahl-passt
 * her: er legt dem aktiven Profil die ersten drei WERKE-Schluessel in die
 * Auswahl, die Startseite zeigt dann drei Kacheln statt aller.
 *     curl localhost:<port>/vorschau/auswahl-weg    # wieder ohne Auswahl
 */
const AUSWAHL = new Map()

/** Die Auswahl eines Kindes — immer eine Liste, nie `undefined`. */
function auswahlVon(kennung) {
  const w = AUSWAHL.get(kennung)
  return Array.isArray(w) ? w : []
}

function jsonAus(res, wert, stand = 200) {
  // DERSELBE FEHLER, EINE EBENE TIEFER — gefunden am 06.08.2026.
  //
  // Der Zusatz `stand` (03.08.2026) hat die Attrappe nicht geheilt, sondern
  // die Fallgrube nur verlegt: Sieben Zweige setzten weiterhin
  // `res.statusCode = 503` und riefen dann `jsonAus(res, …)` OHNE dritten
  // Wert. Der Vorgabewert 200 hat die Zahl darauf ueberschrieben. Der Rumpf
  // sagte „ok: false", der Statuscode sagte „alles gut" — und die Oberflaeche
  // prueft `a.ok`, also den Statuscode. Damit war z. B. `bt-suche-kaputt` eine
  // Lage, die sich zwar STELLEN, aber nicht ERLEBEN liess: die Suche gelang.
  //
  // REPARIERT WIRD DER FEHLER HIER NICHT, ER WIRD NUR LAUT. Das ist Absicht
  // und war eine Entscheidung: Ein `stand = res.statusCode` an dieser Stelle
  // haette den Fall geheilt — und damit die sieben ausgebesserten Aufrufe
  // UNPRUEFBAR gemacht. Wer einen davon zurueckdreht, saehe weiter 503, die
  // Rotprobe bliebe gruen, und die Zusicherung waere wieder eine, die niemand
  // eingeloest hat. Die Zahl gehoert an den Aufruf; hier steht nur der
  // Stolperdraht fuer den naechsten, der es anders schreibt.
  if (res.statusCode !== 200 && stand === 200) {
    console.warn(
      `  STATUS VERSCHLUCKT: der Zweig hat ${res.statusCode} gesetzt, jsonAus bekam ihn nicht mit — ` +
        'die Zahl gehoert als DRITTER WERT an jsonAus(res, wert, stand).',
    )
  }
  res.statusCode = stand
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(wert))
}

/**
 * Eine wirklich abspielbare WAV-Datei aus Stille.
 *
 * 44 Byte Kopf, danach Nullen. Chromium spielt das ab und meldet `ended` —
 * und genau darauf wartet die Oberflaeche. Der Kopf ist bewusst von Hand
 * gebaut: eine Abhaengigkeit fuer 44 Byte waere die falsche Rechnung, und die
 * Vorschau soll ohne `npm install` starten.
 *
 * KEINE ZWISCHENSPEICHER-KOEPFE: Die echte Box schickt `Cache-Control:
 * public, max-age=604800` (derselbe Satz klingt immer gleich). Hier waere das
 * ein Messfehler — der zweite Tipp auf dieselbe Kachel kaeme dann gar nicht
 * mehr am Server an, und das Sprechprotokoll haette eine Luecke, die wie ein
 * fehlender Aufruf aussieht.
 */
function wavAus(res, sekunden) {
  const rate = 8000
  const daten = Math.max(1, Math.round(rate * sekunden))
  const b = Buffer.alloc(44 + daten)
  b.write('RIFF', 0)
  b.writeUInt32LE(36 + daten, 4)
  b.write('WAVEfmt ', 8)
  b.writeUInt32LE(16, 16) // Laenge des fmt-Blocks
  b.writeUInt16LE(1, 20) // PCM
  b.writeUInt16LE(1, 22) // ein Kanal
  b.writeUInt32LE(rate, 24)
  b.writeUInt32LE(rate, 28) // Byte je Sekunde (8 Bit, ein Kanal)
  b.writeUInt16LE(1, 32) // Bytes je Block
  b.writeUInt16LE(8, 34) // Bit je Probe
  b.write('data', 36)
  b.writeUInt32LE(daten, 40)
  b.fill(128, 44) // 128 ist die Ruhelage bei 8-Bit-PCM, nicht 0
  res.statusCode = 200
  res.setHeader('Content-Type', 'audio/wav')
  res.setHeader('Cache-Control', 'no-store')
  res.end(b)
}

/**
 * Eine GROBE Silbentrennung — und sie sagt selbst, dass sie grob ist.
 *
 * DIE ECHTE REGEL STEHT IN src/backend-api/src/vorlesen.ts und hat dort 45
 * Tests (sch/ch/ck als ein Laut, das H immer als Mitlaut, `st` seit 1996
 * trennbar). Sie hier abzuschreiben waere eine ZWEITE Wahrheit ueber die
 * deutsche Trennung, und die waere schlechter als das Original — beim ersten
 * Auseinanderlaufen suchte man den Fehler in der falschen Datei.
 *
 * WAS DIE VORSCHAU BEWEISEN KANN, ist deshalb ausdruecklich nur der WEG: dass
 * die Oberflaeche `/api/vorlesen/silben` fragt und die Antwort GROSS
 * einblendet. Ob „Pum-me-lein-horn" richtig getrennt ist, entscheidet
 * `node --test` auf vorlesen.spec.ts — nicht dieser Server.
 */
function grobTrennen(text) {
  return String(text)
    .split(/(\s+)/)
    .map((w) => (/\s/.test(w) ? w : w.replace(/([aeiouäöü])([bcdfgklmnprstvwz])([aeiouäöü])/gi, '$1-$2$3')))
    .join('')
}

const server = createServer(async (req, res) => {
  // Mitschreiben, WAS die Seite abruft. Beim Pruefen der Titelkarte stand ein
  // Werk im Kopf, das niemand gestartet hatte - ohne dieses Protokoll waere
  // das eine Vermutung geblieben.
  if (process.env.VORSCHAU_LAUT) console.log(`${req.method} ${req.url}`)
  const u = new URL(req.url, 'http://x')
  const p = decodeURIComponent(u.pathname)

  // ── /farben.css — der Farbkanal der neuen Oberflaeche (E118/1c) ─────────
  // index.html bindet ihn VOR app.css; der ECHTE Server liefert bei
  // fehlender Datei 200 mit LEEREM Blatt (der neutrale Zustand ist kein
  // Fehler). Eine Attrappe, die hier 404 gaebe, haengte an jede Seite eine
  // rote Konsolenzeile — und die e2e-Nachlesen zaehlen Konsolenmeldungen.
  if (p === '/farben.css') {
    res.setHeader('Content-Type', 'text/css; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    return res.end('')
  }

  // ── /api/taster/strom — der Austaster-Ring lauscht per EventSource ──────
  // Ein offener, stiller Strom ist der Vertrag im Ruhezustand (Ereignisse
  // kommen nur beim Druecken). 404 liesse EventSource endlos neu verbinden
  // — je Versuch eine Konsolenzeile.
  if (p === '/api/taster/strom') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    })
    res.write(': attrappe, still\n\n')
    return
  }

  if (p.startsWith('/vorschau/')) {
    const was = p.slice('/vorschau/'.length)
    // DAS BEFEHLSPROTOKOLL — lesen und leeren. Es steht GANZ VORN, weil der
    // Auffangzweig unten alles Uebrige als Spielzustand nimmt.
    if (was === 'befehle') return jsonAus(res, { befehle: BEFEHLSPROTOKOLL })
    // WER DIE BUEHNE BEWOHNT (E129) — vor dem Auffangzweig, sonst nimmt der
    // ihn als Spielzustand. Die Seite muss danach neu geladen werden: die
    // Darstellung wird beim Start EINMAL gelesen.
    if (was.startsWith('buehne-')) {
      DARSTELLUNG.aktuell.buehne = was.slice('buehne-'.length)
      return jsonAus(res, { buehne: DARSTELLUNG.aktuell.buehne })
    }
    // Welche Sorte Songtext die Attrappe liefert: synchron (Vorgabe),
    // unsynchron oder gar keiner. Getrennt vom Bewohner der Buehne, weil es
    // zwei Fragen sind — WO der Text steht und WAS fuer einer es ist.
    if (was.startsWith('songtext-')) {
      SONGTEXT_ART = was.slice('songtext-'.length)
      return jsonAus(res, { songtext: SONGTEXT_ART })
    }
    if (was === 'befehle-leeren') {
      BEFEHLSPROTOKOLL.length = 0
      return jsonAus(res, { befehle: [] })
    }
    // WAS DIE BOX GESAGT HAETTE — lesen und leeren. Steht neben dem
    // Befehlsprotokoll, weil es dieselbe Frage fuer den zweiten Ausgang der
    // Box beantwortet: Ton geht ueber /player, Sprache ueber /api/vorlesen.
    // WER HAT NEUSTART/AUSSCHALTEN GERUFEN — lesen. Steht aus demselben Grund
    // VORN wie das Befehlsprotokoll: der Auffangzweig ganz unten nimmt alles
    // Uebrige als Spielzustand, und ein `/vorschau/strom-rufe` weiter hinten
    // haette `lage.spielt = 'strom-rufe'` gesetzt — das Werkzeug, das nur
    // nachsehen wollte, haette die Vorschau kaputtgemacht.
    if (was === 'strom-rufe') return jsonAus(res, { rufe: lage.stromRufe })
    // NACHRICHTEN — vor dem Auffangzweig, der alles Uebrige als Spielzustand
    // nimmt. Jedes Umschalten baut die Liste NEU: sonst bekaeme ein zweiter
    // Messlauf die schon weggetippten Nachrichten des ersten.
    if (was.startsWith('nachricht-')) {
      nachrichtenSetzen(was.slice('nachricht-'.length))
      return jsonAus(res, { nachrichten: NACHRICHTEN.length })
    }
    // DIE BELOHNUNGS-VIDEOS — vor dem Auffangzweig, der alles Uebrige als
    // Spielzustand nimmt. Jedes Umschalten baut die Liste NEU: sonst
    // bekaeme ein zweiter Messlauf den Verbrauch des ersten.
    if (was.startsWith('videos-')) {
      lage.videos = was.slice('videos-'.length)
      videosSetzen(lage.videos)
      return jsonAus(res, { videos: lage.videos, liste: VIDEOS.length })
    }
    // EIN VIDEO, DAS WIRKLICH SPIELT — und zwar aus der Vorschau selbst.
    //
    // Es ist das kleinste gueltige MP4, das ein Browser abspielt: ein
    // Einzelbild, schwarz, eine Sekunde. Es liegt als base64 IM Werkzeug und
    // nicht als Datei daneben, weil eine Attrappe ohne Anhaengsel auskommen
    // soll — und weil eine Binaerdatei im Baum niemand pflegt.
    if (was === 'probe.mp4') {
      const daten = Buffer.from(PROBE_MP4_B64, 'base64')
      /**
       * BEREICHE MUESSEN SEIN — sonst SPRINGT CHROMIUM NICHT.
       *
       * GEMESSEN AM 20.09.2026, und es hat eine halbe Stunde gekostet: die
       * Wache meldete „er ist nicht auf Sekunde 1 gesprungen", und der Fehler
       * lag in der ATTRAPPE. Ohne `accept-ranges` gilt die Quelle als nicht
       * spulbar, `currentTime = 1` verpufft lautlos, und das Stueck laeuft
       * von vorn. Der echte Sender liefert `Accept-Ranges: bytes` (an
       * api.ardmediathek.de nachgemessen) — eine Attrappe, die das nicht tut,
       * misst eine Box, die es nicht gibt.
       */
      const roh = String(req.headers.range || '')
      const treffer = /^bytes=(\d*)-(\d*)$/.exec(roh)
      if (treffer) {
        const von = treffer[1] ? Number(treffer[1]) : 0
        const bis = treffer[2] ? Math.min(Number(treffer[2]), daten.length - 1) : daten.length - 1
        if (von <= bis && von < daten.length) {
          const teil = daten.subarray(von, bis + 1)
          res.writeHead(206, {
            'content-type': 'video/mp4',
            'content-length': String(teil.length),
            'content-range': `bytes ${von}-${bis}/${daten.length}`,
            'accept-ranges': 'bytes',
            'cache-control': 'no-store',
          })
          return res.end(teil)
        }
      }
      res.writeHead(200, {
        'content-type': 'video/mp4',
        'content-length': String(daten.length),
        'accept-ranges': 'bytes',
        'cache-control': 'no-store',
      })
      return res.end(daten)
    }
    // WAS NOCH IM FERNBEDIENUNGS-FACH LIEGT — NACHSEHEN OHNE ZU NEHMEN.
    //
    // `GET /api/fernbedienung/anweisung` entnimmt (so haelt es der echte
    // Server, und so muss es sein). Ein Werkzeug, das damit nachsehen
    // wollte, ob die SEITE eine Anweisung schon geholt hat, nimmt sie ihr
    // damit weg — und misst dann, dass nichts passiert ist. Genau diese
    // Zweideutigkeit hat am 19.09.2026 eine Gegenprobe auf der falschen
    // Zeile rot werden lassen: „das Spiel blieb zu" kann heissen, dass der
    // Schalter wirkt, ODER dass der Tastendruck nie ankam.
    //
    // VORN, wie die anderen Protokolle: sonst faenge `anweisungen` unten im
    // Auffangzweig und setzte `lage.spielt`.
    // WAS GESTARTET WURDE — lesen, und getrennt davon leeren. VORN wie die
    // anderen Protokolle, sonst faengt der Auffangzweig es als Spielzustand.
    if (was === 'gestartet') return jsonAus(res, { gestartet: SPIELPROTOKOLL })
    if (was === 'gestartet-leeren') {
      SPIELPROTOKOLL.length = 0
      return jsonAus(res, { gestartet: [] })
    }
    if (was === 'anweisungen') {
      return jsonAus(res, { offen: lage.fernAnweisungen.map((a) => a.was) })
    }
    // WAS AN FUNK-BEFEHLEN HEREINKAM — lesen und leeren. VORN, aus demselben
    // Grund wie `strom-rufe`: der Auffangzweig ganz unten nimmt alles Uebrige
    // als Spielzustand, und ein `/vorschau/funk-rufe` weiter hinten fiele in
    // den Zweig `funk-` und stellte die LAGE auf „rufe" um. Das Werkzeug, das
    // nur nachsehen wollte, haette die Vorschau verstellt.
    if (was === 'funk-rufe') return jsonAus(res, { rufe: FUNK_RUFE, stand: { ...FUNK_STAND } })
    if (was === 'funk-rufe-leeren') {
      FUNK_RUFE.length = 0
      return jsonAus(res, { rufe: [] })
    }
    if (was === 'gesprochen') return jsonAus(res, { gesprochen: SPRECHPROTOKOLL, daempfung: DAEMPFUNG })
    if (was === 'gesprochen-leeren') {
      SPRECHPROTOKOLL.length = 0
      DAEMPFUNG.length = 0
      return jsonAus(res, { gesprochen: [], daempfung: [] })
    }
    // DIE LAGE LESEN UND WIEDER HINLEGEN — siehe `schnappschuss()`.
    //
    // STEHT VORN, aus demselben Grund wie das Befehlsprotokoll: der
    // Auffangzweig ganz unten nimmt alles Uebrige als SPIELZUSTAND. Ein
    // `/vorschau/lage` weiter unten hiesse `lage.spielt = 'lage'` — die
    // Vorschau meldete danach weder Wiedergabe noch Stille, und das Werkzeug,
    // das nur nachsehen wollte, haette die Vorschau kaputtgemacht.
    if (was === 'lage') {
      if (req.method !== 'POST') return jsonAus(res, schnappschuss())
      let roh = ''
      for await (const stueck of req) roh += stueck
      try {
        schnappschussSetzen(JSON.parse(roh))
      } catch (e) {
        return jsonAus(res, { ok: false, fehler: String(e.message || e) }, 400)
      }
      return jsonAus(res, { ok: true, ...schnappschuss() })
    }
    // TEIL DER KETTE, NICHT DAVOR. Beim ersten Anlauf stand hier ein eigenes
    // `if` ohne `else` — der Aufruf setzte `lage.vorlesen` und fiel danach
    // weiter bis in den Auffangzweig ganz unten, der alles Uebrige als
    // SPIELZUSTAND nimmt. `lage.spielt` hiess anschliessend
    // „vorlesen-antippen", die Attrappe meldete „nichts laeuft", und die
    // Gegenprobe „waehrend der Wiedergabe wird nicht vorproduziert" schlug
    // fehl. Das sah aus wie ein Fehler in der Oberflaeche und war einer hier.
    // Dieselbe Falle steht weiter unten schon einmal beschrieben
    // („`spotify-weiter` MUSS VOR dem Auffangzweig stehen") — sie ist also
    // nicht neu, nur wieder zugeschnappt.
    // `spiele-` MUSS VOR dem `vorlesen-`-Zweig UND vor dem Auffangzweig
    // stehen: `spiele-aus` faenge sonst unten als Spielzustand und setzte
    // `lage.spielt = 'spiele-aus'` — das Werkzeug haette die Vorschau
    // verstellt statt einen Schalter umgelegt.
    // `start-` VOR dem Auffangzweig, sonst faenge `start-letztes` unten als
    // Spielzustand und setzte `lage.spielt` — das Werkzeug haette die
    // Vorschau verstellt statt einen Schalter umgelegt.
    // `spielstimme-` und `nurspiel-` VOR `spiele-`: sie beissen sich nicht
    // (kein gemeinsames Praefix), stehen aber trotzdem hier oben, weil der
    // Auffangzweig ganz unten JEDEN unbekannten Namen als Spielzustand
    // nimmt — siehe die Falle, die gleich darueber beschrieben ist.
    if (was.startsWith('spielstimme-')) lage.spielstimme = was.slice('spielstimme-'.length)
    else if (was.startsWith('nurspiel-')) lage.nurSpiel = was.slice('nurspiel-'.length)
    else if (was === 'alle-spiele') lage.nurSpiel = ''
    // KEIN EINZIGES SPIEL AN — eine Kennung, die es nicht gibt, schaltet
    // damit jedes aus. Der Fall gehoert vorfuehrbar: Wer den Bereich
    // anlaesst und jedes Spiel einzeln abschaltet, hat ihn abgeschaltet,
    // und die Tuer muss das genauso sehen.
    else if (was === 'kein-spiel') lage.nurSpiel = 'gibtsnicht'
    else if (was.startsWith('app-aus-')) lage.appAus = was.slice('app-aus-'.length)
    else if (was === 'alle-apps') lage.appAus = ''
    else if (was.startsWith('start-')) lage.start = was.slice('start-'.length)
    else if (was.startsWith('gast-')) lage.gast = was.slice('gast-'.length)
    else if (was.startsWith('spiele-')) lage.spiele = was.slice('spiele-'.length)
    else if (was.startsWith('vorlesen-')) lage.vorlesen = was.slice('vorlesen-'.length)
    else if (was === 'ohne-cover') lage.cover = false
    else if (was === 'mit-cover') lage.cover = true
    else if (['voll', 'leer', 'kaputt', 'fehlt'].includes(was)) lage.liste = was
    else if (was.startsWith('inhalt-')) lage.inhalt = was.slice('inhalt-'.length)
    // `alben-` FEHLTE, obwohl `lage.alben` seit jeher dasteht und ausgewertet
    // wird: Die drei Faelle „voll / leer / angeschnitten" liessen sich gar
    // nicht einstellen. Ein Schalter, den es nur im Kopf der Datei gibt.
    else if (was.startsWith('alben-')) lage.alben = was.slice('alben-'.length)
    else if (was.startsWith('verlauf-')) lage.verlauf = was.slice('verlauf-'.length)
    // `verschmolzen-an` legt die zweiten Ausgaben in die Liste UND schaltet das
    // Darstellungsfeld. Beides zusammen, weil die Box es auch zusammen hat:
    // ohne Zuordnungen ist der Schalter folgenlos, ohne Schalter fragt die
    // Oberflaeche gar nicht erst mit `verschmelzen=1`.
    else if (was.startsWith('verschmolzen-')) lage.verschmolzen = was.slice('verschmolzen-'.length)
    else if (was.startsWith('doppelt-')) lage.doppelt = was.slice('doppelt-'.length)
    else if (was.startsWith('marke-')) lage.marke = was.slice('marke-'.length)
    // Der Schlummer-Timer hat ZWEI Ansichten, und nur eine davon zeigt einen
    // Knopf zum Abbrechen. Ohne diesen Schalter saehe man nie die zweite.
    else if (was.startsWith('schlummer-')) lage.schlummer = was.slice('schlummer-'.length)
    // DIE EINSTELLUNGSSPERRE HAT VIER SORTEN, nicht zwei — und die vierte ist
    // die, an der man sich schneidet:
    //   aus      Vorgabe. Der Eltern-Bereich geht ohne Frage auf.
    //   pin      Ziffernfeld, geprueft vom Backend (hier: 2468).
    //   rechnen  Rechenaufgabe, geprueft in der Oberflaeche selbst.
    //   kaputt   /api/config antwortet GAR NICHT (500). Das ist kein
    //            Sonderfall, sondern der Alltag einer Box, deren Backend
    //            gerade hochfaehrt — und der VERTRAG sagt dann „aus", weil
    //            eine Box, die sich selbst aussperrt, nicht mehr erreichbar
    //            ist. Ohne diesen Schalter liesse sich genau der Satz nicht
    //            pruefen, auf dem die ganze Sperre steht.
    else if (was.startsWith('sperre-')) lage.sperre = was.slice('sperre-'.length)
    // DIE BEIDEN NEUEN FAECHER HATTEN IHRE SCHALTER NUR IM KOPF DER DATEI:
    // `lage.wlan` und `lage.medien` waren beschrieben und ausgewertet, aber
    // ueber keinen Weg zu setzen — ein Aufruf `/vorschau/wlan-falsch` fiel bis
    // in den Auffangzweig ganz unten durch und setzte `lage.spielt`. Damit war
    // nicht nur der Schalter wirkungslos, sondern die Vorschau hinterher
    // kaputt (dieselbe Falle wie bei `vorlesen-`, drei Absaetze hoeher).
    else if (was.startsWith('dienste-')) lage.dienste = was.slice('dienste-'.length)
    else if (was.startsWith('musikdienste-')) lage.musikdienste = was.slice('musikdienste-'.length)
    // DER GENAUE NAME VOR DEM PRAEFIX. Stuende `strom-` zuerst, verschluckte
    // `startsWith` das `strom-zaehler-weg` und setzte `lage.strom` auf
    // „zaehler-weg" — ein Schalter, der still etwas anderes tut als sein Name
    // sagt, ist genau die Falle, die weiter oben schon einmal zugeschnappt
    // ist (`wlan-falsch` fiel bis in den Auffangzweig durch).
    else if (was === 'strom-zaehler-weg') lage.stromRufe = []
    else if (was.startsWith('strom-')) lage.strom = was.slice('strom-'.length)
    // ══ DER EINZIGE WEG ZURUECK ZUM VERBUNDENEN NETZ ═══════════════════════
    //
    // `WLAN_STAND.verbunden` wird von `POST /api/netzwerk/verbinden`
    // UMGESCHRIEBEN und von keinem `/vorschau/…` je wieder hergestellt. Wer
    // einen WLAN-Wechsel geprobt hat, misst danach eine Box OHNE Netz — und
    // zwar in allem, was `/api/netzwerk` liest: der Adresse im Info-Gitter,
    // dem Funkbalken oben rechts, der Unterzeile des Punktes „WLAN". Genau
    // das ist am 06.08.2026 passiert: das Info-Gitter zeigte „Adresse keine",
    // und die Aussage „die Adresse stimmt" ging leer durch, weil beide Seiten
    // nichts hatten. Ein Vergleich von nichts mit nichts ist keine Messung.
    //
    // ES STEHT VOR DEM PRAEFIX `wlan-`, damit `startsWith` es nicht
    // verschluckt — dieselbe Falle wie bei `strom-zaehler-weg` weiter oben.
    else if (was === 'wlan-zurueck') {
      Object.assign(WLAN_STAND, { verbunden: 'ganznahamnetzNight', wechsel: null })
      // AUCH DIE GESPEICHERTEN NETZE ZURUECK: das Vergessen kuerzt die Liste,
      // und kein anderer /vorschau/-Weg stellt sie wieder her — dieselbe
      // Falle wie bei `WLAN_STAND.verbunden` direkt darueber.
      GESPEICHERT.length = 0
      for (const n of GESPEICHERT_START) GESPEICHERT.push({ ...n })
    }
    else if (was.startsWith('wlan-')) lage.wlan = was.slice('wlan-'.length)
    // ══ VPN: ZUSTAND UND LAGE, dieselbe Trennung wie beim Funk ══════════════
    // `vpn-zurueck` stellt den ZUSTAND her (Einheit aus, Lage ok) und steht
    // VOR dem Praefix, damit `startsWith` es nicht als Lage „zurueck"
    // verschluckt — die Falle von `strom-zaehler-weg`, sie schnappt bei jedem
    // neuen Schalter neu zu.
    else if (was === 'vpn-zurueck') {
      Object.assign(VPN_STAND.einheit, { aktiv: false, beimStart: false })
      lage.vpn = 'ok'
    } else if (was.startsWith('vpn-')) lage.vpn = was.slice('vpn-'.length)
    // ══ DIE SENDER STELLEN — und die drei genauen Namen VOR dem Praefix ═════
    //
    // `funk-flug` und `funk-zurueck` sind ZUSTAENDE (FUNK_STAND), `funk-kabel`
    // und `funk-vorort` sind LAGEN (lage.funk). Stuende `funk-` zuerst,
    // verschluckte `startsWith` die beiden ersten und setzte `lage.funk` auf
    // „flug" — eine Lage, die es nicht gibt, und `funkFreigabe` faende weder
    // Kabel noch Vor-Ort. Dieselbe Falle wie bei `strom-zaehler-weg` und
    // `wlan-zurueck` weiter oben; sie schnappt bei jedem neuen Schalter neu zu.
    else if (was === 'funk-flug') Object.assign(FUNK_STAND, { bluetooth: false, wlan: false })
    else if (was === 'funk-bt-aus') FUNK_STAND.bluetooth = false
    else if (was === 'funk-zurueck') {
      Object.assign(FUNK_STAND, { bluetooth: true, wlan: true })
      lage.funk = 'nur-wlan'
      FUNK_RUFE.length = 0
    } else if (was.startsWith('funk-')) lage.funk = was.slice('funk-'.length)
    else if (was.startsWith('medien-')) lage.medien = was.slice('medien-'.length)
    // DIE KINDERZEIT hat zwei Ansichten, die nichts miteinander zu tun haben:
    // „aus" heisst, die Box verhaelt sich wie immer und die Tabelle ist leer;
    // „an" heisst Fenster, Kontingent und ein Tageskonto, das schon halb weg
    // ist. Auf derselben Seite steht seit dem 03.08.2026 der Schlummer-Timer —
    // ohne diesen Schalter saehe man ihn nur neben einer leeren Tabelle.
    else if (was === 'kz-aus') Object.assign(KINDERZEIT, { regeln: kzVorgabe(), verbrauchtMin: 0, bonusMin: 0 })
    else if (was === 'kz-an') {
      const r = kzVorgabe()
      r.aktiv = true
      for (const t of KZ_TAGE) r.tage[t] = { frei: t !== 'so', ab: '07:00', bis: '19:30', minuten: 45 }
      Object.assign(KINDERZEIT, { regeln: r, verbrauchtMin: 22, bonusMin: 0 })
    }
    // ── DIE KNAPPE LAGE, und sie fehlte ────────────────────────────────────
    // `kz-an` liefert 23 Minuten Rest — eine ruhige Zahl. Die Anzeige oben in
    // der Mitte wechselt aber UNTER FUENF MINUTEN die Farbe, und der Filter
    // „passt noch in die Kinderzeit" faengt genau dort an, Titel zu
    // kennzeichnen. Ohne diesen Schalter praegte jede Messung den ruhigen Fall
    // und hielte ihn fuer beide. Das Fenster ist bewusst WEIT (bis 23:59) —
    // sonst haenge es davon ab, wie spaet es beim Messen gerade ist, und die
    // knappe Zahl kaeme mal vom Guthaben und mal vom Fenster.
    else if (was === 'kz-knapp') {
      const r = kzVorgabe()
      r.aktiv = true
      for (const t of KZ_TAGE) r.tage[t] = { frei: true, ab: '00:00', bis: '23:59', minuten: 45 }
      Object.assign(KINDERZEIT, { regeln: r, verbrauchtMin: 42, bonusMin: 0 })
    }
    // UND DIE LAGE, IN DER ES VORBEI IST. Sie ist etwas anderes als „knapp":
    // dort steht „Schluss" statt einer Zahl, und der Filter verwirft ALLES.
    else if (was === 'kz-leer') {
      const r = kzVorgabe()
      r.aktiv = true
      for (const t of KZ_TAGE) r.tage[t] = { frei: true, ab: '00:00', bis: '23:59', minuten: 45 }
      Object.assign(KINDERZEIT, { regeln: r, verbrauchtMin: 45, bonusMin: 0 })
    }
    /*
     * ── DIE ZWEI LAGEN, IN DENEN GUTHABEN DA IST UND TROTZDEM NICHTS GEHT ──
     *
     * Sie sind der eigentliche Pruefstein fuer die Restzeit oben in der Mitte
     * und fuer die Kinderzeit-Passung, denn nur hier gehen die beiden Quellen
     * AUSEINANDER: Das Tagesguthaben sagt „45 Minuten", der Server sagt
     * „heute gar nicht" bzw. „noch nicht". Wer nur `restMin` und `fensterBis`
     * liest, sieht den Widerspruch nicht.
     *
     * `kz-gesperrt`  heute ist ein gesperrter Wochentag (`frei: false`), das
     *                Guthaben ist unangetastet und das Fenster weit offen.
     * `kz-zufrueh`   das Fenster geht erst SPAETER heute auf.
     *
     * DIE ZEITEN SIND RELATIV ZUM AUFRUF gerechnet und nicht fest
     * hingeschrieben. Feste „18:00 bis 20:00" waeren je nach Tageszeit der
     * Messung mal 'zuFrueh', mal 'frei', mal 'zuSpaet' — ein Schalter, der
     * vormittags etwas anderes stellt als abends, prueft nichts.
     */
    /*
     * ── SCHARF, ABER HEUTE OHNE GRENZE ────────────────────────────────────
     * Die Kinderzeit IST eingeschaltet, dieser Wochentag hat aber weder ein
     * Fenster noch ein Guthaben (`minuten: 0` heisst am Server ausdruecklich
     * „unbegrenzt", nicht „null Minuten" — kinderzeit.ts, `erlaubtMin`).
     * Der Stand ist dann `erlaubt: true, restMin: null, fensterBis: ''`, und
     * das ist etwas ANDERES als `kz-aus`: Dort gelten gar keine Regeln, hier
     * gelten sie und sagen heute nichts.
     * Es ist der Fall, in dem eine Anzeige gern „∞" oder „noch 0 min"
     * hinschreibt — beides waere falsch, und ohne diesen Schalter faellt es
     * nie auf.
     */
    else if (was === 'kz-offen') {
      const r = kzVorgabe()
      r.aktiv = true
      for (const t of KZ_TAGE) r.tage[t] = { frei: true, ab: '', bis: '', minuten: 0 }
      Object.assign(KINDERZEIT, { regeln: r, verbrauchtMin: 0, bonusMin: 0 })
    }
    /*
     * ── NUR EIN FENSTER, KEIN MINUTENKONTO ────────────────────────────────
     * Die haeufigste Elternregel ueberhaupt: „nur zwischen 7 und 19:30", ohne
     * Stoppuhr. Der Stand ist dann `restMin: null` UND `fensterBis` gesetzt —
     * die eine Grenze zaehlt, die andere gibt es nicht.
     * ER MUSS EIGENS DASTEHEN: `kz-offen` hat gar keine Grenze, `kz-an` hat
     * beide. Nur hier faellt auf, ob ein `null` versehentlich als Null
     * mitrechnet und die kleinere von beiden wird.
     */
    else if (was === 'kz-nur-fenster') {
      const r = kzVorgabe()
      r.aktiv = true
      for (const t of KZ_TAGE) r.tage[t] = { frei: true, ab: '00:00', bis: '23:59', minuten: 0 }
      Object.assign(KINDERZEIT, { regeln: r, verbrauchtMin: 0, bonusMin: 0 })
    } else if (was === 'kz-gesperrt') {
      const r = kzVorgabe()
      r.aktiv = true
      for (const t of KZ_TAGE) r.tage[t] = { frei: false, ab: '00:00', bis: '23:59', minuten: 45 }
      Object.assign(KINDERZEIT, { regeln: r, verbrauchtMin: 0, bonusMin: 0 })
    } else if (was === 'kz-zufrueh') {
      const hhmm = (minutenAbJetzt) => {
        const d = new Date(Date.now() + minutenAbJetzt * 60000)
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
      }
      const r = kzVorgabe()
      r.aktiv = true
      // +60/+180 und nicht +1/+2: Die Messung darf nicht daran haengen, dass
      // waehrenddessen die Minute umspringt. Ueber Mitternacht hinaus kippt es
      // (dann waere `ab` kleiner als jetzt) — deshalb schiebt es der Fall
      // notfalls in den frueheren Morgen, was dieselbe Lage ist.
      for (const t of KZ_TAGE) r.tage[t] = { frei: true, ab: hhmm(60), bis: hhmm(180), minuten: 45 }
      Object.assign(KINDERZEIT, { regeln: r, verbrauchtMin: 0, bonusMin: 0 })
    }
    // DER BOXNAME IST SEIT 03.08.2026 EINE SORTE MIT ZWEI AUSPRAEGUNGEN, und
    // nur eine davon war je zu sehen. Die Marke unten links teilt den Namen am
    // Wortende „Box" auf zwei Zeilen; endet er nicht darauf, bleibt er
    // einzeilig. Ohne diesen Schalter praegte jede Messung nur den geteilten
    // Fall — genau das Muster aus [attrappe-gruen-geraet-rot-loser-titel]:
    // eine ganze SORTE von Daten, die es auf jeder Box geben kann und die
    // keine Pruefung je stellt.
    //   /vorschau/name-mitbox    „VorschauBox"  -> „Vorschau" / „Box"
    //   /vorschau/name-ohnebox   „MixPiZwei"    -> eine Zeile, keine Teilung
    //   /vorschau/name-lang      ein Name, der in 88 px nicht in eine Zeile
    //                            passt — die teure Ausnahme
    //
    // DER STANDARDFALL IST BEWUSST „VorschauBox" UND NICHT „MixPiBox
    // Vorschau" (so hiess er bis 03.08.2026): Der alte Name endete NICHT auf
    // „Box" und haette die Teilung deshalb NIE ausgeloest. Man haette den
    // ungeteilten Fall gemessen und fuer den geteilten gehalten. Er
    // unterscheidet sich weiterhin vom Rueckfall in index.html („MixPi"/
    // „Box"), damit sichtbar bleibt, OB gesetzt wurde.
    else if (was.startsWith('name-')) lage.name = was.slice('name-'.length)
    // DIE FUSSZEILE HAT ZWEI SORTEN, und die zweite fehlte bis 03.08.2026:
    // `herkunft.unsauber` zaehlt die beim Bauen geaenderten, nicht
    // eingecheckten Dateien. Ist sie groesser als 0, beschreibt der Commit den
    // ausgelieferten Stand NICHT mehr — die Fusszeile haengt dann ein Plus an
    // („103 · d95f86e+"). Die Attrappe meldete stets `unsauber: 0`; wer
    // dagegen gemessen haette, haette den sauberen Fall gesehen und fuer beide
    // gehalten (dritte Sorte aus [attrappe-luegt-durch-weglassen]).
    //   /vorschau/fassung-unsauber   4 geaenderte Dateien -> Plus
    //   /vorschau/fassung-sauber     zurueck zum Regelfall
    else if (was.startsWith('fassung-')) lage.fassung = was.slice('fassung-'.length)
    // ══ UND DIE KOPPLUNGEN WIEDER LOESEN ═══════════════════════════════════
    //
    // DIESELBE LUECKE WIE BEI `wlan-zurueck`: `POST /api/bluetooth/:mac/koppeln`
    // legt die Kennung in BT_ANGENOMMEN, und KEIN `/vorschau/bt-…` nimmt sie
    // je wieder heraus. Die `bt-`-Schalter stellen den ADAPTER und die eine
    // Stammverbindung, nicht die Liste der gekoppelten Geraete. Wer einmal
    // gekoppelt hat, findet im naechsten Lauf kein Geraet mehr, das sich
    // koppeln liesse — gemessen am 06.08.2026, die Aussage „ein noch nicht
    // gekoppeltes Geraet steht in der Liste" fiel im zweiten Lauf um.
    //
    // VOR DEM PRAEFIX `bt-`, sonst verschluckt `startsWith` es.
    else if (was === 'bt-zurueck') {
      BT_ANGENOMMEN.clear()
      BT_GEFUNDEN = false
      lage.bt = 'getrennt'
    } else if (was.startsWith('bt-')) lage.bt = was.slice('bt-'.length)
    // Die GEGENPROBE zur Interpretenseite: `disko-aus` muss die Reihen „Alben"
    // und „Singles und EPs" verschwinden lassen, `top-weg` einen benannten
    // Ausfall erzeugen. Ohne beides prueft eine ruhige Messung nichts.
    // DIE DREI FAELLE DER INTERPRETEN-REIHE, und jeder braucht seinen Schalter:
    //   frei-an     ein Freigeschalteter OHNE eigene Werke steht in der Reihe
    //   nein-an     „Kiddinx" ist abgelehnt und faellt heraus, obwohl Spotify
    //               ihn kennt und zwei Werke unter ihm stehen
    //   frei-aus/nein-aus  zurueck zur reinen Automatik (der Stand von vor
    //               diesem Feature — die Gegenprobe, ohne die man nicht sieht,
    //               dass sich ueberhaupt etwas geaendert hat)
    // DIE VIER LAGEN DES HINTERGRUNDLICHTS. VOR dem Auffangzweig, sonst
    // stuende `lage.spielt = 'licht-weg'` da und die Vorschau spielte nichts
    // mehr — derselbe Grund wie bei `strom-rufe`.
    else if (was === 'dauer-da') Object.assign(DAUER, { da: true, null: false })
    else if (was === 'dauer-weg') Object.assign(DAUER, { da: false, null: false })
    // ── UND DIE DRITTE SORTE: EINE LAENGE, DIE 0 IST ───────────────────────
    // Kein erfundener Fall. Ein Dienst, der eine Folge noch nicht fertig
    // eingelesen hat, schickt `duration_ms: 0` — das ist etwas anderes als
    // „kein Feld". Die Passung muss beide gleich behandeln und SCHWEIGEN:
    // „0:00" an einer Kachel waere eine Laenge, die es nicht gibt, und
    // „passt" waere sie erst recht (null Minuten passen immer).
    else if (was === 'dauer-null') Object.assign(DAUER, { da: true, null: true })
    else if (was.startsWith('licht-')) {
      const wohin = was.slice('licht-'.length)
      if (['da', 'weg', 'geklemmt', 'stur', 'unlesbar'].includes(wohin)) LICHT.lage = wohin
      else if (/^\d+$/.test(wohin)) {
        LICHT.prozent = Math.min(100, Math.max(20, Number(wohin)))
        LICHT.lage = 'da'
      }
    } else if (was === 'frei-an') ABLAGE.frei = [FREI_OHNE_WERKE]
    else if (was === 'frei-aus') ABLAGE.frei = []
    else if (was === 'nein-an') ABLAGE.abgelehnt = [{ schluessel: 'kiddinx', name: 'Kiddinx' }]
    else if (was === 'nein-aus') ABLAGE.abgelehnt = []
    else if (was.startsWith('disko-')) lage.disko = was.slice('disko-'.length)
    else if (was.startsWith('top-')) lage.top = was.slice('top-'.length)
    else if (was.startsWith('profil-')) {
      lage.profil = was.slice('profil-'.length)
      // UND DAS GESCHRIEBENE WEG. Ohne diese Zeile traege eine Messung, die
      // ein Kind angelegt hat, ihr Ergebnis in die naechste hinueber — genau
      // die klebrige Lage, gegen die tools/leihgabe.mjs geschrieben wurde.
      lage.profileGeschrieben = null
      lage.figurGewaehlt = null
      // UND DIE AUSWAHLEN MIT. Sie haengen an Kennungen; bliebe die Auswahl von
      // „liam" stehen, waehrend die Profilliste zurueckgesetzt wird, saehe die
      // naechste Messung eine Einschraenkung, die sie nicht gesetzt hat.
      AUSWAHL.clear()
    }
    // ── DIE AUSWAHL, DIE ZU DEN WERKEN PASST ─────────────────────────────
    // Warum es diesen Schalter ueberhaupt braucht, steht bei `AUSWAHL`: hier
    // sind Verwaltungsliste und Startseite zwei Fixtures mit verschiedenen
    // Schluesseln. Ohne ihn liesse sich nur der LEERE Fall ansehen.
    else if (was === 'auswahl-passt') {
      AUSWAHL.set(
        profilStand().aktiv,
        werke(false)
          .werke.slice(0, 3)
          .map((w) => w.schluessel),
      )
    } else if (was === 'auswahl-weg') AUSWAHL.delete(profilStand().aktiv)
    else if (was === 'bibliothek-viele') lage.medienZahl = 'viele'
    else if (was === 'bibliothek-wenige') lage.medienZahl = 'wenige'
    else if (was.startsWith('figuren-')) lage.figuren = was.slice('figuren-'.length)
    else if (was.startsWith('netz-')) lage.netz = was.slice('netz-'.length)
    // `akku-<zahl>` VOR `hat-`: der Fuellstand ist eine Zahl, kein Zustand.
    else if (was.startsWith('akku-')) lage.akku = Math.max(0, Math.min(100, Number(was.slice('akku-'.length)) || 0))
    // `akkuverlauf-` VOR `hat-` UND VOR `verlauf-`: das erste Wort teilt sich
    // den Anfang mit `hat-` nicht, wohl aber `verlauf-leer` (das gehoert dem
    // WEITERHOEREN und ist etwas ganz anderes). Ein eigener Praefix statt
    // eines zweiten Wertes von `verlauf` — sonst schaltete `verlauf-leer` die
    // Akkukurve mit ab, und niemand saehe den Zusammenhang.
    else if (was.startsWith('akkuverlauf-')) {
      const sorte = was.slice('akkuverlauf-'.length)
      if (!AKKUVERLAUF_SORTEN.has(sorte)) {
        console.warn(`  UNBEKANNTE AKKUVERLAUF-SORTE: ${sorte}  (bekannt: ${[...AKKUVERLAUF_SORTEN].join(', ')})`)
        return jsonAus(res, { ok: false, unbekannt: sorte, bekannt: [...AKKUVERLAUF_SORTEN] }, 400)
      }
      lage.akkuverlauf = sorte
    } else if (was.startsWith('hat-')) lage.hat = was.slice('hat-'.length)
    else if (['ok', 'kinderzeit', 'abgelehnt'].includes(was)) lage.spieler = was
    // WIE `stop` AUSGEHT — siehe ANHALTE_SORTEN. Ein unbekanntes Wort wird
    // ABGEWIESEN statt uebernommen: sonst stellte die Attrappe stillschweigend
    // eine Lage, die es an der Box nicht gibt, und die Pruefung darueber waere
    // wertlos.
    else if (was.startsWith('anhalten-')) {
      const sorte = was.slice('anhalten-'.length)
      if (!ANHALTE_SORTEN.has(sorte)) {
        console.warn(`  UNBEKANNTE ANHALTE-SORTE: ${sorte}  (bekannt: ${[...ANHALTE_SORTEN].join(', ')})`)
        return jsonAus(res, { ok: false, unbekannt: sorte, bekannt: [...ANHALTE_SORTEN] }, 400)
      }
      lage.anhalten = sorte
    }
    // `spotify-weiter` MUSS VOR dem Auffangzweig stehen. Der letzte `else`
    // nimmt alles Uebrige als Spielzustand — `lage.spielt` waere danach
    // 'spotify-weiter', und die Vorschau meldete gar keine Wiedergabe mehr.
    else if (was === 'spotify-weiter')
      lage.spotifyTitel = lage.spotifyTitel >= SPOTIFY_RUNDLAUF ? 0 : (lage.spotifyTitel + 1) % SPOTIFY_RUNDLAUF
    // `mpv-weiter` MUSS AUS DEMSELBEN GRUND VOR den Auffangzweig. Es stellt
    // den Fall, den es bei mpv wirklich gibt: die Warteschlange rueckt von
    // selbst eine Folge weiter. Der Rundlauf endet bei `totalTracks`.
    else if (was === 'mpv-weiter') lage.mpvTitel = (lage.mpvTitel % 12) + 1
    else if (was === 'mpv-erste') lage.mpvTitel = 1
    else if (was === 'laeuft-an') lage.laeuftServer = 'an'
    else if (was === 'laeuft-aus') lage.laeuftServer = 'aus'
    // Das Start-Gedaechtnis zurueck auf den Grundzustand („Die Maus" laeuft
    // seit dem Einschalten). Der echte Server verwuerfe einen Widerspruch
    // zwischen Gedaechtnis und currentTrackname selbst (Namenskern in
    // laufendes-werk.ts); diese Attrappe erfindet ihre /local-Namen aber frei
    // — wer nach einem gestellten Start (z.B. der ARD-Faelle von
    // marke-ohne-eigenen-start) wieder den Grundzustand messen will, stellt
    // ihn hiermit ausdruecklich her, statt sich auf eine Pruefung zu
    // verlassen, die es hier nicht gibt.
    else if (was === 'gestartet-grund') lage.gestartet = { werk: 'vorschau:0', quelle: 'lokal', titel: null }
    // `mpv-fremd` / `mpv-eigen` — AUCH VOR den Auffangzweig, aus demselben
    // Grund. Sie stellen die fremde Wiedergabe (siehe `lokal()`), ohne
    // `lage.spielt` anzuruehren: es soll weiter etwas LAUFEN, nur eben etwas
    // anderes.
    else if (was === 'mpv-fremd') lage.fremd = true
    else if (was === 'mpv-eigen') lage.fremd = false
    // `spotify-lose` MUSS EBENFALLS VOR den Auffangzweig, und aus demselben
    // Grund. Es stellt den Titel, der zu KEINEM ganzen Album gehoert.
    else if (was === 'spotify-lose') {
      lage.spielt = 'spotify'
      lage.spotifyTitel = SPOTIFY_LOSE
    }
    // `kontext-` MUSS VOR dem Auffangzweig stehen, aus demselben Grund wie
    // `spotify-weiter`: sonst landete `spotify:album:…` in `lage.spielt`.
    else if (was.startsWith('kontext-')) lage.kontext = was.slice('kontext-'.length)
    else {
      // Beim Umschalten AUF Spotify wieder beim ersten Titel anfangen, sonst
      // haengt der Zustand von der Reihenfolge frueherer Messungen ab.
      if (was === 'spotify') lage.spotifyTitel = 0
      lage.spielt = was
    }
    jsonAus(res, { lage })
    return
  }

  // WAS DIE SEITE MELDET, WIRD MITGESCHRIEBEN statt nur quittiert.
  //
  // Bei „Weiterhoeren" ist genau das die interessante Frage: schickt die
  // Oberflaeche SEKUNDEN (so lautet der Vertrag) und die richtige, 1-basierte
  // Titelnummer? Eine Attrappe, die stumm `ok` sagt, beantwortet sie nicht —
  // und eine vertauschte Einheit faellt sonst erst auf der Box auf, wo sie wie
  // „der Sprung geht ins Nichts" aussieht.
  //
  // STEHT VOR den GET-Zweigen: die pruefen nur den Pfad und wuerden ein POST
  // sonst als Abfrage beantworten.
  // Der Wartungsmodus-Takt (app.js, alle 10 s) fragt diesen Pfad. Ohne den
  // Stub warf jede Vorschau-Sitzung 404-Konsolenmeldungen, und die Wachen,
  // die "schweigt in der Konsole" pruefen, wurden rot (29.08.2026, Nachlese
  // zum Rueckweg im Abschlusslauf). Die Attrappe wartet nie.
  // ── ZWEI ROUTEN, DIE HIER FEHLTEN — UND WAS DAS KOSTETE ───────────────
  //
  // Bis zum 19.09.2026 kannte die Attrappe weder `/api/eingabegeraete` noch
  // `/api/fernbedienung/anweisung`. Beide gibt es im echten Server
  // (server.ts), und die Oberflaeche ruft beide — die zweite IM TAKT.
  //
  // WAS DAS ANRICHTETE: nichts, was ein Kind gemerkt haette (beide Aufrufer
  // fangen den Fehler ab und zeigen dann eben kein Zeichen). Aber jede
  // Messung mit Browser gegen diese Vorschau schleppte einen Strom von
  // 404-Meldungen mit — 203 Stueck in einem einzigen Lauf von
  // tools/rueckweg-nachlese.mjs. Und DEREN Sinn ist es, eine stille Ausnahme
  // zu finden, die im 250-ms-Takt liefe. Genau die waere in diesem Rauschen
  // nicht mehr aufgefallen: eine Wache, die dauerhaft rot ist, ist keine
  // [[dauerrote-wache-ist-keine]].
  //
  // Eine Attrappe, die eine Route NICHT kennt, sagt nicht „diese Route gibt
  // es nicht" — sie sagt „hier ist eine Luecke in mir". Deshalb wacht seit
  // heute tools/vorschau-routen-deckung.mjs darueber, dass jede Route, die
  // NewDesign/app.js ruft, hier auch beantwortet wird.
  if (p === '/api/eingabegeraete') {
    const pad = lage.eingabe === 'pad' || lage.eingabe === 'beide'
    const fb = lage.eingabe === 'fb' || lage.eingabe === 'beide'
    return jsonAus(res, {
      controller: pad ? ['8BitDo Lite 2 gamepad'] : [],
      fernbedienungen: fb ? ['MX Remote Consumer Control'] : [],
    })
  }
  if (p === '/api/fernbedienung/anweisung') {
    if (req.method === 'POST') {
      let roh = ''
      for await (const stueck of req) roh += stueck
      console.log(`  ${p} <- ${roh}`)
      let rumpf = {}
      try {
        rumpf = JSON.parse(roh || '{}')
      } catch {
        /* wie ueberall hier: unlesbarer Koerper zaehlt als leerer */
      }
      const was = typeof rumpf.was === 'string' ? rumpf.was : ''
      if (!was) return jsonAus(res, { error: 'wasFehlt' }, 400)
      // Vorne herausfallen lassen wie der Server: die juengste Absicht
      // zaehlt, eine Minute alter Tastendruecke soll niemand nachspielen.
      lage.fernAnweisungen.push({ was, zeit: Date.now() })
      while (lage.fernAnweisungen.length > 6) lage.fernAnweisungen.shift()
      return jsonAus(res, { ok: true })
    }
    // ABHOLEN HEISST ENTNEHMEN, und Verfallenes wird uebersprungen statt
    // ausgeliefert — beides wie in server.ts begruendet.
    const jetzt = Date.now()
    let a = lage.fernAnweisungen.shift()
    while (a && jetzt - a.zeit > 5000) a = lage.fernAnweisungen.shift()
    return jsonAus(res, { was: a ? a.was : null })
  }

  if (p === '/api/wartung') {
    return jsonAus(res, { aktiv: false })
  }

  // ── Nachrichten AN die Box (21.09.2026) ───────────────────────────────
  //
  // Die Karte auf dem Kinderschirm (`#nachricht`) fragt alle fuenf Sekunden
  // hier nach. OHNE DIESEN ZWEIG antwortet die Attrappe 404, `nachrichtenHolen`
  // faengt das still ab — und die Karte ist in der Vorschau UNSICHTBAR. Wer
  // an ihr arbeitet, sieht dann nichts und haelt sie fuer kaputt.
  //
  // VORGABE IST LEER, und das ist der Alltag: die meisten Boxen haben keine
  // Nachricht liegen. Die Faelle kommen ueber Umschalter dazu —
  // `/vorschau/nachricht-eine`, `-zwei`, `-keine`.
  if (p === '/api/nachrichten') {
    return jsonAus(res, {
      nachrichten: NACHRICHTEN,
      ungelesen: NACHRICHTEN.filter((n) => !n.gelesen).length,
      vorlesen: true,
    })
  }

  // „Hab ich gesehen." DIE ATTRAPPE MERKT ES SICH WIRKLICH — sonst kaeme
  // dieselbe Karte beim naechsten Takt zurueck, und das Nachruecken der
  // zweiten Nachricht liesse sich hier gar nicht ansehen.
  if (req.method === 'POST' && p === '/api/nachrichten/gelesen') {
    let roh = ''
    for await (const stueck of req) roh += stueck
    let id = ''
    try {
      id = String(JSON.parse(roh).id || '')
    } catch {
      // Ein kaputter Rumpf ist hier kein Grund zu scheitern: der echte
      // Server antwortet 400, und diesen Fall prueft die Integrationsprobe.
    }
    const treffer = NACHRICHTEN.find((n) => n.id === id)
    const geaendert = !!treffer && !treffer.gelesen
    if (treffer) treffer.gelesen = true
    console.log(`  ${p} <- ${id} (geaendert: ${geaendert})`)
    return jsonAus(res, { ok: true, geaendert })
  }

  // ── Songtext fuer die Buehne (E129 + E84/B2) ──────────────────────────
  //
  // DREI ANTWORTEN, weil es drei Faelle gibt und die Buehne alle drei
  // verschieden behandeln muss. Der Interpret entscheidet, welcher kommt —
  // so laesst sich jeder Fall aus einem Test ansteuern, ohne dass die
  // Attrappe einen Zustand mitschleppt.
  //
  // DIE ZWEI FORMEN SIND ABSICHTLICH GETRENNT (siehe plugins/README.md):
  // `zeilen` traegt Zeitmarken und laeuft mit, `absaetze` nicht. Wer nur
  // `zeilen` liest, sieht beim unsynchronen Fall eine leere Buehne — und das
  // sieht genauso aus wie „nichts gefunden". Genau dafuer ist der zweite
  // Fall hier.
  if (p === '/api/songtext') {
    const interpret = String(u.searchParams.get('interpret') || '')
    if (SONGTEXT_ART === 'unsynchron' || /unsynchron/i.test(interpret)) {
      return jsonAus(res, {
        zeilen: [],
        absaetze: ['Erste Zeile ohne Marke', 'Zweite Zeile ohne Marke', 'Dritte'],
        synchron: false,
        quelle: 'vorschau',
      })
    }
    if (SONGTEXT_ART === 'leer' || /ohnetext/i.test(interpret)) {
      return jsonAus(res, { zeilen: [], absaetze: [], synchron: false, grund: 'nichts-gefunden' })
    }
    return jsonAus(res, {
      zeilen: [
        { zeitMs: 0, text: 'Erste Zeile' },
        { zeitMs: 5000, text: 'Zweite Zeile' },
        { zeitMs: 10000, text: 'Dritte Zeile' },
      ],
      absaetze: [],
      synchron: true,
      quelle: 'vorschau',
    })
  }

  if (req.method === 'POST' && (p === '/api/weiterhoeren' || p === '/api/gespielt')) {
    let roh = ''
    for await (const stueck of req) roh += stueck
    console.log(`  ${p} <- ${roh}`)
    return jsonAus(res, { status: 'ok' })
  }

  // Der /api/spielen-Stub steht WEITER UNTEN, hinter `inhaltAntwort` — er
  // legt seit E95/V die Titelliste bei und braucht dafuer die Funktion.

  // ── UMSCHALTEN UND BILD AUSSUCHEN ──────────────────────────────────────
  //
  // BEIDE ANTWORTEN MIT DEM GANZEN STAND, wie der echte Server. Die
  // Oberflaeche uebernimmt ihn aus der Antwort statt den eben getippten Wert
  // hinzuschreiben — eine Attrappe, die nur `{status:'ok'}` schickt, liesse
  // genau das ungeprueft (`attrappe-luegt-durch-weglassen`).
  //
  // `profil/aktiv` FUEHRT IN DER OBERFLAECHE ZU EINEM NEULADEN. In der
  // Vorschau faellt die Wahl danach auf `lage.profil` zurueck — das ist
  // richtig so und zeigt, dass der Wechsel wirklich vom SERVER kommt.
  /**
   * DIE GANZE LISTE SCHREIBEN — der Weg der Seite „Kinder" (Admin-Menue).
   *
   * DIE REGELN SIND DIE AUS profile.ts, NACHGESTELLT UND NICHT ABGESCHRIEBEN:
   * der Gast steht immer voran und laesst sich nicht wegnehmen, hoechstens
   * zwoelf Profile, eine Kennung muss ins Muster passen, doppelte fallen weg —
   * und ein Eintrag OHNE Feld `figur` erbt die abgelegte Figur
   * (`figurenBewahren`). Eine Attrappe, die hier grosszuegiger waere als der
   * Server, liesse die Oberflaeche gegen Regeln pruefen, die es nicht gibt.
   */
  if (req.method === 'PUT' && p === '/api/profile') {
    let roh = ''
    for await (const stueck of req) roh += stueck
    console.log(`  PUT /api/profile <- ${roh.slice(0, 400)}`)
    let rumpf = {}
    try {
      rumpf = JSON.parse(roh || '{}')
    } catch {
      /* eine kaputte Meldung darf die Vorschau nicht anhalten */
    }
    const vorher = profilStand().profile
    const bekannt = new Map(vorher.map((x) => [x.kennung, x.figur]))
    const ein = Array.isArray(rumpf) ? rumpf : Array.isArray(rumpf.profile) ? rumpf.profile : []
    const aus = [vorher.find((x) => x.kennung === 'gast') || { kennung: 'gast', name: 'Gast', figur: '', angelegt: 0 }]
    const gesehen = new Set(['gast'])
    for (const e of ein) {
      if (aus.length >= 12) break
      if (!e || typeof e !== 'object' || !/^[a-z0-9-]{1,24}$/.test(String(e.kennung))) continue
      const name = typeof e.name === 'string' ? e.name.trim().slice(0, 40) : ''
      const figur = Object.hasOwn(e, 'figur') ? String(e.figur || '') : (bekannt.get(e.kennung) ?? '')
      const eintrag = { kennung: e.kennung, name: name || e.kennung, figur, angelegt: Number(e.angelegt) || 0 }
      if (e.kennung === 'gast') {
        aus[0] = eintrag
        continue
      }
      if (gesehen.has(e.kennung)) continue
      gesehen.add(e.kennung)
      aus.push(eintrag)
    }
    // DER ELTERN-AUSWEG (14.08.2026): ein Eintrag MIT `passwort: null`
    // entfernt das Schloss; einer OHNE das Feld laesst es stehen (die
    // Map lebt neben der Liste). Und wessen Profil geht, dessen Schloss
    // geht mit — sonst faende ein neues Kind gleicher Kennung es vor.
    for (const e of ein) {
      if (e && typeof e === 'object' && Object.hasOwn(e, 'passwort') && e.passwort === null) {
        PASSWOERTER.delete(String(e.kennung))
      }
    }
    for (const k of [...PASSWOERTER.keys()]) {
      if (!aus.some((x) => x.kennung === k)) PASSWOERTER.delete(k)
    }
    lage.profileGeschrieben = aus
    if (!aus.some((x) => x.kennung === lage.profil)) lage.profil = 'gast'
    return jsonAus(res, profilStand())
  }

  /**
   * NUR DER NAME, NUR DES AKTIVEN — der Weg des Profilfensters (`#ich`).
   *
   * Es steht VOR der Sperre und darf deshalb keine Liste schicken; der
   * Besitzer kommt vom Server. Ein leerer Name wird abgewiesen (400), damit
   * niemand versehentlich die Kennung als Namen dastehen sieht.
   */
  if (req.method === 'POST' && p === '/api/profil/name') {
    let roh = ''
    for await (const stueck of req) roh += stueck
    console.log(`  ${p} <- ${roh}`)
    let rumpf = {}
    try {
      rumpf = JSON.parse(roh || '{}')
    } catch {
      /* siehe oben */
    }
    const name = typeof rumpf.name === 'string' ? rumpf.name.trim().slice(0, 40) : ''
    if (!name) return jsonAus(res, { error: 'leererName' }, 400)
    const stand = profilStand()
    lage.profileGeschrieben = stand.profile.map((x) => (x.kennung === stand.aktiv ? { ...x, name } : x))
    return jsonAus(res, profilStand())
  }

  /**
   * AUSSEHEN JE PROFIL (15.08.2026) — der Endpunkt fehlte hier, und die
   * Nachlese zum Rueckweg zaehlte zwoelf 404-Konsolenmeldungen auf dem Weg:
   * die Oberflaeche meldet Farbsatz und Licht seit dem Darstellung-je-
   * Profil-Block an den Server. Die Regeln des echten Endpunkts, kurz
   * nachgestellt: GET traegt {profil, eigen, farbe, licht}; POST setzt NUR
   * die genannten Schluessel, prueft das Licht gegen hell/dunkel und die
   * Farbe nur gegen die FORM (kurzer CSS-tauglicher Bezeichner).
   */
  if (p === '/api/profil/aussehen') {
    const stand = profilStandRoh()
    const eintrag = AUSSEHEN.get(stand.aktiv) || {}
    if (req.method === 'GET') {
      return jsonAus(res, {
        profil: stand.aktiv,
        eigen: AUSSEHEN.has(stand.aktiv),
        farbe: eintrag.farbe || '',
        licht: eintrag.licht || '',
      })
    }
    if (req.method === 'POST') {
      let roh = ''
      for await (const stueck of req) roh += stueck
      console.log(`  ${p} <- ${roh}`)
      let rumpf = {}
      try {
        rumpf = JSON.parse(roh || '{}')
      } catch {
        /* eine kaputte Meldung darf die Vorschau nicht anhalten */
      }
      const nennt = (k) => Object.hasOwn(rumpf, k)
      if (nennt('licht') && rumpf.licht !== 'hell' && rumpf.licht !== 'dunkel') {
        return jsonAus(res, { ok: false, error: 'lichtUnbekannt' }, 400)
      }
      if (nennt('farbe') && (typeof rumpf.farbe !== 'string' || !/^[a-z0-9-]{0,24}$/.test(rumpf.farbe))) {
        return jsonAus(res, { ok: false, error: 'farbeUnbrauchbar' }, 400)
      }
      AUSSEHEN.set(stand.aktiv, {
        ...eintrag,
        ...(nennt('farbe') ? { farbe: rumpf.farbe } : {}),
        ...(nennt('licht') ? { licht: rumpf.licht } : {}),
      })
      const neu = AUSSEHEN.get(stand.aktiv)
      return jsonAus(res, { ok: true, profil: stand.aktiv, eigen: true, farbe: neu.farbe || '', licht: neu.licht || '' })
    }
  }

  /**
   * DAS EIGENE SCHLOSS (14.08.2026) — die Regeln des Servers, nachgestellt:
   * nur der Aktive, nie der Gast, aendern/entfernen erst mit dem alten.
   * Antworten tragen wie ueberall den ganzen Stand (mit `geschuetzt`,
   * `passwortArt` — nie dem Geheimnis).
   */
  if ((req.method === 'POST' || req.method === 'DELETE') && p === '/api/profil/passwort') {
    let roh = ''
    for await (const stueck of req) roh += stueck
    console.log(`  ${req.method} ${p} <- ${roh.replace(/"(neu|alt)":"[^"]*"/g, '"$1":"…"')}`)
    let rumpf = {}
    try {
      rumpf = JSON.parse(roh || '{}')
    } catch {
      /* eine kaputte Meldung darf die Vorschau nicht anhalten */
    }
    const stand = profilStandRoh()
    if (stand.aktiv === 'gast' && req.method === 'POST') return jsonAus(res, { error: 'gastOhnePasswort' }, 400)
    const schloss = PASSWOERTER.get(stand.aktiv)
    if (req.method === 'DELETE') {
      if (!schloss) return jsonAus(res, { error: 'keinPasswort' }, 400)
      if (typeof rumpf.alt !== 'string' || rumpf.alt !== schloss.kanon) {
        return jsonAus(res, { error: 'altFalsch', art: schloss.art }, 403)
      }
      PASSWOERTER.delete(stand.aktiv)
      return jsonAus(res, profilStand())
    }
    const art = ['zeichen', 'zahlen', 'farben', 'muster'].find((a) => a === rumpf.art)
    const neu = typeof rumpf.neu === 'string' ? rumpf.neu : ''
    if (!art) return jsonAus(res, { error: 'unbekannteArt' }, 400)
    if (neu.length < 3 || neu.length > 64) return jsonAus(res, { error: 'zuKurzOderZuLang' }, 400)
    if (schloss && (typeof rumpf.alt !== 'string' || rumpf.alt !== schloss.kanon)) {
      return jsonAus(res, { error: 'altFalsch', art: schloss.art }, 403)
    }
    PASSWOERTER.set(stand.aktiv, { art, kanon: neu })
    return jsonAus(res, profilStand())
  }

  if (req.method === 'POST' && (p === '/api/profil/aktiv' || p === '/api/profil/figur')) {
    let roh = ''
    for await (const stueck of req) roh += stueck
    console.log(`  ${p} <- ${roh}`)
    let rumpf = {}
    try {
      rumpf = JSON.parse(roh || '{}')
    } catch {
      /* eine kaputte Meldung darf die Vorschau nicht anhalten */
    }
    if (p === '/api/profil/aktiv') {
      // NICHT MEHR GEGEN EINE FESTE DREIERLISTE: seit die Seite „Kinder"
      // anlegen kann, gibt es Kennungen, die es beim Start noch nicht gab. Wer
      // hier weiter drei Namen abfragte, wiese ein eben angelegtes Kind ab —
      // und das saehe aus wie ein Fehler der Oberflaeche.
      if (!profilStand().profile.some((x) => x.kennung === rumpf.kennung)) {
        return jsonAus(res, { error: 'unbekanntesProfil' }, 400)
      }
      // EIN GESCHUETZTES PROFIL OEFFNET NUR SEIN PASSWORT — dieselben
      // Antworten wie der Server (401 ohne, 403 falsch, samt `art`). Der
      // Wechsel auf das AKTIVE und auf Ungeschuetzte (allen voran der Gast:
      // Abmelden ist immer frei) laeuft ohne Frage durch.
      const schloss = PASSWOERTER.get(rumpf.kennung)
      if (schloss && rumpf.kennung !== profilStandRoh().aktiv) {
        if (typeof rumpf.passwort !== 'string' || !rumpf.passwort) {
          return jsonAus(res, { error: 'passwortNoetig', art: schloss.art }, 401)
        }
        if (rumpf.passwort !== schloss.kanon) {
          return jsonAus(res, { error: 'passwortFalsch', art: schloss.art }, 403)
        }
      }
      lage.profil = rumpf.kennung
      // DIE GEWAEHLTE FIGUR GEHOERT DEM VORIGEN KIND. Sie beim Wechsel
      // stehenzulassen hiesse, dem neuen das Bild des alten anzuziehen —
      // und der einzige Ort, an dem man das saehe, waere der Kopf.
      lage.figurGewaehlt = null
    } else {
      lage.figurGewaehlt = typeof rumpf.figur === 'string' ? rumpf.figur : ''
      // UND IN DER GESCHRIEBENEN LISTE, falls es eine gibt: `figurVon` unten
      // greift nur im ungeschriebenen Fall. Ohne diese Zeile naehme die
      // Attrappe die Wahl an und zeigte danach die alte — der Fehler, den sie
      // bei `profilStand()` schon einmal vermieden hat.
      if (lage.profileGeschrieben) {
        const wer = profilStand().aktiv
        lage.profileGeschrieben = lage.profileGeschrieben.map((x) =>
          x.kennung === wer ? { ...x, figur: lage.figurGewaehlt } : x,
        )
      }
    }
    return jsonAus(res, profilStand())
  }

  if (p === '/api/werke') {
    // Die Zustaende der Startseite lassen sich nur so pruefen: leer und kaputt
    // treten im Alltag selten auf und genau deshalb sieht sie niemand an.
    if (lage.liste === 'kaputt') {
      res.statusCode = 500
      res.end('kaputt')
      return
    }
    if (lage.liste === 'leer') return jsonAus(res, { stand: 'leer-1', werke: [] })
    // Ab hier faellt die Entscheidung ueber den ABFRAGETEIL, nicht ueber die
    // Lage — wie im Server (server.ts /api/werke).
    if (lage.liste === 'fehlt') {
      res.statusCode = 404
      res.end()
      return
    }
    return jsonAus(res, werke(u.searchParams.get('verschmelzen') === '1'))
  }
  // Die Titelliste hinter einer Kachel. Der echte Endpunkt fragt Spotify bzw.
  // Jellyfin; hier stehen erfundene Titel, damit die Karte pruefbar ist, ohne
  // dass ein Dienst erreichbar sein muss.
  //
  // ALS FUNKTION, WEIL SEIT E95/V ZWEI STELLEN SIE BRAUCHEN — dieselbe
  // Bauart wie `inhaltFuerEintrag` im echten Server: der GET-Zweig unten und
  // der /api/spielen-Stub (der die Liste als `titel` in seine Antwort legt,
  // wie es der echte Server beim /inhalt-Weg tut; ohne sie bliebe
  // `laufendeFolgen` in der Oberflaeche leer, und fuenf Folgen-Anzeige-Tests
  // in tools/e2e/neu-oberflaeche.test.mjs massen NICHTS — Attrappe-luegt-
  // durch-Weglassen, gefunden 31.08.2026 beim Stufe-2-Umbau).
  const inhaltAntwort = (schlRoh, verschmolzen, wunschQuelle) => {
    if (lage.inhalt === 'fehlt') return { status: 501, body: { error: 'nochNichtGebaut', dienst: 'lokal' } }
    if (lage.inhalt === 'kaputt') return { status: 502, body: { error: 'Spotify 503' } }
    if (lage.inhalt === 'leer') return { status: 200, body: { schluessel: schlRoh, dienst: 'spotify', titel: [] } }
    const n = 14
    // JELLYFIN BEKOMMT `befehl`/`anhaengen`, SONST TUT DIE KACHEL NICHTS.
    //
    // Ein Jellyfin-ALBUM hat keinen Ein-Befehl-Start: `spielen()` faellt auf
    // `albumSpielen()` durch, das hier die Titel holt und dann
    // `titel.filter((t) => t.befehl)` bildet. Ohne diese beiden Felder ist die
    // Liste leer, die Oberflaeche meldet „Dieses Album hat keine abspielbaren
    // Titel" und schickt NICHTS — in tools/interpretseite-befehle.mjs stand
    // dafuer lange nur „(keiner)", und das sah aus wie ein Werk, das eben
    // keinen Spotify-Befehl braucht. Vierter Fall von
    // [attrappe-luegt-durch-weglassen], gefunden am 2026-08-02.
    //
    // Die Form ist die des Servers (server.ts `jfBefehle`):
    //     jellyfin/<kodierte Stromadresse>/<titel>:title:artist:<interpret>
    //     jfqueue/<dasselbe>                      zum Anhaengen
    // WELCHER EINTRAG STECKT DAHINTER — der fuehrende oder der bevorzugte?
    //
    // WIE IM SERVER (`eintragZurBevorzugtenQuelle`): Ohne `verschmelzen=1`
    // entscheidet der SCHLUESSEL, mit `verschmelzen=1` die BEVORZUGUNG, und
    // `quelle=<dienst>` fragt ausdruecklich nach einer bestimmten (das
    // Ausweichen). Ohne diese drei Zeilen antwortete die Vorschau immer mit
    // dem fuehrenden Eintrag — und die Reparatur saehe hier aus wie kaputt.
    const schl = decodeURIComponent(schlRoh)
    const nr = /^vorschau:(\d+)$/.exec(schl)
    let dienst = nr && rohListe()[Number(nr[1])] ? rohListe()[Number(nr[1])].w.dienst : 'spotify'
    if (verschmolzen) {
      const werk = (werke(true).werke || []).find((x) => x.schluessel === schl)
      const wunsch = wunschQuelle || ''
      const q = werk && (wunsch ? (werk.quellen || []).find((x) => x.dienst === wunsch) : werk.quellen[0])
      if (wunsch && !q) return { status: 404, body: { error: 'nichtGefunden' } }
      if (q) dienst = q.dienst
    }
    /* ══ DIE LOKALE SCHWESTERSPUR JE TITEL (E112, 31.08.2026) ═══════════════
     *
     * Der echte Server stempelt je Titel BEIDE Felder (titelkarte.ts):
     *
     *     quelle    der Dienst, aus dem DIESER Titel kaeme
     *     quellen   alle, die ihn nachweislich haben — ['lokal','spotify'],
     *               wenn im Albumordner eine vollstaendige Spur mit passendem
     *               Namen liegt (`lokaleSchwesterSpuren` + `spurNamePasst`)
     *
     * BIS HEUTE TRUG DIESE ATTRAPPE NUR `quelle`, und `quellen` gar nicht.
     * Wer die neue Herkunfts-Anzeige der Titelliste (E112) dagegen gemessen
     * haette, haette NIE zwei Plaketten gesehen und die Sache fuer erledigt
     * gehalten — der vierte Fall von [attrappe-luegt-durch-weglassen] in
     * dieser Datei, diesmal beim Feld, um das es ueberhaupt geht.
     *
     * JEDER ZWEITE TITEL HAT EINE SCHWESTER, nicht alle und nicht keiner: Nur
     * dann zeigt eine Messung den UNTERSCHIED zwischen „liegt auch hier" und
     * „gibt es nur dort". Eine Attrappe, in der alle Titel gleich sind, misst
     * bei einer gemischten Liste genau nichts.
     *
     * NUR MIT `verschmolzen`, wie im Server: Ohne Verschmelzung sieht er gar
     * nicht erst im Albumordner nach (`const spuren = mischen ? … : null`),
     * und `quellen` ist dann die einelementige Wahrheit des eigenen Dienstes.
     *
     * BEIDE SERVER-WEGE SIND NACHGEBAUT, weil sie sich in dem unterscheiden,
     * worum es geht:
     *
     *   titelQuellenStempeln  (lokal, Spotify, ARD, Plugin) — stempelt NUR.
     *       Der Weg zum Ton bleibt das ganze Album; `quelle` ist der eigene
     *       Dienst, auch wenn daneben eine lokale Spur liegt. Spotify mischt
     *       nicht titelweise, weil ein Maschinenwechsel 1-2 s Stille kostet
     *       ([dienste-umschalten]).
     *   titelMischen          (Jellyfin) — mischt WIRKLICH. lokal und Jellyfin
     *       laufen beide ueber mpv, also gewinnt je Titel die eingestellte
     *       Reihenfolge (Vorgabe QUELLEN_REIHENFOLGE: lokal zuerst), und der
     *       Befehl wird durch `datei/…` ERSETZT.
     *
     * DER ZWEITE MUSS MIT, so ungern eine Attrappe Befehle umschreibt: Unter
     * `verschmolzen-an` fuehren BEIDE zweiten Ausgaben dieser Vorschau
     * („Die drei ???", „Benjamin Bluemchen") den Jellyfin-Eintrag. Bliebe der
     * Mischfall draussen, gaebe es in dieser Vorschau ueberhaupt kein
     * gemischtes Album — und die neue Herkunfts-Anzeige haette nichts zu
     * zeigen. Genau die Sorte Luecke, die als „geprueft" durchgeht.
     */
    // LOKALE TITEL TRAGEN SEIT 12.09.2026 EINE KENNUNG (server.ts, Ordner-
    // Zweig von /inhalt): ohne sie gibt `folgeKennung` (app.js) '' zurueck,
    // die Kachel traegt kein `data-spielt`, und die Marke haette am lokalen
    // Titel nie einen Traeger. Formel und Warum beim `lokaleTitelId` oben —
    // dieselbe Formel speist das `laeuft`-Feld von /player/local.
    const werkRoh = nr && rohListe()[Number(nr[1])] ? rohListe()[Number(nr[1])].w : null
    const lokalId = (i) => (dienst === 'lokal' && werkRoh ? { id: lokaleTitelId(werkRoh, i + 1) } : {})
    const MISCH_ORDNER = '/media/vorschau/mischalbum'
    const quellenFuer = (i) => {
      if (dienst === 'lokal') return { quelle: 'lokal', quellen: ['lokal'] }
      // JEDER ZWEITE — siehe Kasten oben.
      const lokalDa = verschmolzen && i % 2 === 0
      if (!lokalDa) return { quelle: dienst, quellen: [dienst] }
      if (dienst !== 'jellyfin') return { quelle: dienst, quellen: ['lokal', dienst] }
      // Die Befehlsform ist die von `titelMischen`: Pfad kodiert, dann der
      // `:title:artist:`-Schwanz wie bei `jf` darunter. Der Ordner ist
      // erfunden, seine GESTALT nicht — auf der Box ist es der Albumordner
      // unter dem Medienverzeichnis.
      const datei = encodeURIComponent(`${MISCH_ORDNER}/${String(i + 1).padStart(2, '0')} Folge ${i + 1}.mp3`)
      const schwanz = `${datei}/${encodeURIComponent(`Folge ${i + 1}`)}:title:artist:${encodeURIComponent('Pruefung')}`
      return {
        quelle: 'lokal',
        quellen: ['lokal', 'jellyfin'],
        befehl: `datei/${schwanz}`,
        anhaengen: `dateiqueue/${schwanz}`,
      }
    }
    const jf = (i) => {
      if (dienst !== 'jellyfin') return {}
      const strom = encodeURIComponent(`http://jellyfin.vorschau:8096/Audio/jf-${i}/stream?static=true&api_key=geheim`)
      const schwanz = `${strom}/${encodeURIComponent(`Folge ${i + 1}`)}:title:artist:${encodeURIComponent('Pruefung')}`
      return { befehl: `jellyfin/${schwanz}`, anhaengen: `jfqueue/${schwanz}` }
    }
    // DIE ARD GENAUSO, und aus demselben Grund: ohne `befehl` faellt jede
    // Folge aus `titel.filter((t) => t.befehl)` und die Kachel meldet „keine
    // abspielbaren Titel". Die Form ist die des Servers (ard.ts abspielWeg):
    //     ard/<kodierte Tonadresse>/<titel>:title:artist:<interpret>
    //     ardqueue/<dasselbe>                zum Anhaengen
    // Die Adresse ist hier erfunden, aber eine NACKTE MP3 — genau das liefert
    // die Audiothek (gemessen 04.08.2026), und nur so misst ein Werkzeug den
    // Weg, den die Box wirklich geht.
    //
    // `id` UND `weiterAb` GEHOEREN DAZU, seit die Folgen-Lane sie liest
    // (05.08.2026). `id` ist die FOLGENKENNUNG — ohne sie faende
    // `ardSendungAb` in NewDesign/app.js die gesuchte Folge nie und liesse
    // die Sendung wortlos von vorn anfangen; ein Werkzeug haette dabei eine
    // aufgeklappte Lane gesehen und die Sache fuer geprueft gehalten. Und
    // `weiterAb` traegt hier PROZENT, nicht Millisekunden: eine ARD-Folge
    // laeuft ueber mpv ([resume-lokal-ist-prozent-nicht-sekunden]).
    const ard = (i) => {
      if (dienst !== 'ard') return {}
      const ton = encodeURIComponent(`https://wdrmedien-a.akamaihd.net/vorschau/folge${i}_MP3-128.mp3`)
      const schwanz = `${ton}/${encodeURIComponent(`Folge ${i + 1}`)}:title:artist:${encodeURIComponent('Pruefung')}`
      const kennung = `1660000${i}`
      const stelle = WEITER_ROH().find((z) => z.schluessel === schl && z.folge === kennung)
      return {
        id: kennung,
        // DER NAME DER FOLGE, und er ueberschreibt den allgemeinen „Folge N —
        // …" darunter. Er muss derselbe sein wie in `/api/weiterhoeren`
        // (`folgeTitel`), sonst prueft niemand, ob die Kachel und die Lane
        // dieselbe Folge meinen.
        titel: ardFolgenTitel(i),
        // DAS BILD JE FOLGE — nachgetragen am 06.08.2026, und ohne es waere
        // Punkt 5 des Auftrags unpruefbar gewesen: `coverAdresse` schlaegt das
        // Cover zur laufenden Warteschlangennummer in GENAU DIESER Liste nach.
        // Fehlte das Feld, faende sie nichts, fiele auf das Werkbild zurueck —
        // und ein Werkzeug haette ein stehendes Bild gesehen und es fuer das
        // Ergebnis gehalten. Der echte Server liefert es (`f.bild` im
        // ard-Zweig von /inhalt).
        bild: `/api/bild/vorschau:${ARD_INDEX}?folge=${i}`,
        befehl: `ard/${schwanz}`,
        anhaengen: `ardqueue/${schwanz}`,
        weiterAb: stelle ? { titelNr: i + 1, positionProzent: stelle.positionProzent, folge: kennung } : null,
      }
    }
    // EIN GENERISCHES MEDIEN-PLUGIN GENAUSO (E87), aus demselben Grund wie bei
    // ARD und Jellyfin: ohne `befehl` faellt jede Folge aus
    // `titel.filter((t) => t.befehl)`, und die Kachel meldete „keine
    // abspielbaren Titel" — genau das, was tools/kachel-spielt-je-dienst.mjs
    // als STUMM zaehlt. Die Form ist die des Servers (server.ts, Zweig
    // 'plugin' von /inhalt):
    //     plugin/<kodierte Tonadresse>/<titel>:title:artist:<interpret>
    //     pluginqueue/<dasselbe>                zum Anhaengen
    const plugin = (i) => {
      if (dienst !== 'plugin') return {}
      const ton = encodeURIComponent(`https://archiv.example.invalid/vorschau/stueck${i}.mp3`)
      const schwanz = `${ton}/${encodeURIComponent(`Folge ${i + 1}`)}:title:artist:${encodeURIComponent('Pruefung')}`
      return { befehl: `plugin/${schwanz}`, anhaengen: `pluginqueue/${schwanz}` }
    }
    return {
      status: 200,
      body: {
        schluessel: schlRoh,
        dienst,
        // Der Server sagt es mit; ohne das Feld haelt die Lane eine
        // abgeschnittene Liste fuer die ganze.
        vollstaendig: true,
        titel: Array.from({ length: n }, (_, i) => ({
          nr: i + 1,
          titel: `Folge ${i + 1} — Eine ziemlich lange Geschichte mit Titel`,
          interpret: 'Pruefung',
          // OHNE LAENGE, WENN `/vorschau/dauer-weg` GESTELLT IST. Das ist der
          // Fall der LOKALEN Alben am echten Server: die playlist.m3u kennt nur
          // Dateinamen, und `dauerMs` fehlt dort ausdruecklich (server.ts bei
          // /inhalt). Ohne diesen Schalter praegte jede Messung den Fall „Laenge
          // bekannt" und haelt ihn fuer beide — dieselbe Luecke wie beim
          // Boxnamen und beim Fassungsstand.
          ...(DAUER.da ? { dauerMs: DAUER.null ? 0 : (600 + i * 37) * 1000 } : {}),
          ...lokalId(i),
          ...jf(i),
          ...ard(i),
          ...plugin(i),
          // E108/E112: der Server stempelt je Titel die QUELLE (die Plakette
          // am Player liest sie aus `laufendeFolgen`, die Titelliste zeigt sie
          // seit E112 je Kachel) UND alle vorhandenen (`quellen`).
          //
          // GANZ ZULETZT, und das ist die ganze Wirkung des Mischfalls: Im
          // Jellyfin-Zweig ERSETZT `quellenFuer` den Befehl, den `jf(i)` zwei
          // Zeilen darueber gesetzt hat, durch `datei/…` — genau so herum tut
          // es der Server (`titelMischen` bekommt die fertige Gewinner-Liste
          // und schreibt obendrauf). Stuende die Zeile oben, gaebe es den
          // Stempel ohne seine Folge.
          ...quellenFuer(i),
        })),
      },
    }
  }
  const inhalt = /^\/api\/werke\/(.+)\/inhalt$/.exec(p)
  if (inhalt) {
    /* FEHLT DER SCHALTER GANZ, GILT DIE DARSTELLUNG — nicht „aus".
     *
     * NACHGEZOGEN AM 31.08.2026 (E112). Der echte Server tut das seit E95
     * ausdruecklich (server.ts bei /api/werke/:schluessel/inhalt:
     * „`verschmelzen=0` oder `=1` uebersteuert IMMER … FEHLT DIE QUERY GANZ …
     * gilt derselbe Schalter, den auch die Verwaltung zeigt"), und genau
     * dieser Fall ist der haeufige: Weder die Folgen-Lane noch die neue
     * Titel-Lane (`albumTitelLaneOeffnen`) haengen einen Abfrageteil an.
     *
     * Hier stand `=== '1'`, also der Stand VOR E95. Damit antwortete die
     * Attrappe auf genau die Abrufe, die die Oberflaeche wirklich macht,
     * immer unverschmolzen — und eine Messung der Herkunfts-Plaketten haette
     * nie mehr als EINE Quelle je Titel gesehen, auch mit `verschmolzen-an`.
     * Die Lage-Schalter waeren dagewesen, gewirkt haetten sie nicht. */
    const schalter = u.searchParams.get('verschmelzen')
    const zusammen = schalter === null ? lage.verschmolzen === 'an' : schalter === '1'
    const a = inhaltAntwort(inhalt[1], zusammen, u.searchParams.get('quelle') || '')
    return jsonAus(res, a.body, a.status)
  }

  // DIE SPIELFUNKTION (E95/V Stufe 2): seit dem Umbau schickt die Seite fuer
  // jeden Abspielwunsch EINEN POST hierher statt Befehle an /player zu bauen.
  // Die Attrappe bleibt DUENN — Echo plus Protokoll, wie /api/weiterhoeren:
  // WAS gespielt wuerde (Quelle, Befehl, Folge, Sprung) entscheidet der echte
  // Server, und die Wahrheiten dazu prueft spielen.integration.spec.ts.
  // EINE Spiegelung traegt sie trotzdem, wie der echte Server: bei Werken der
  // /inhalt-Bauart (ARD, Plugin, Jellyfin-Album) liegt die TITELLISTE bei —
  // daraus setzt die Oberflaeche `laufendeFolgen` (Cover je Folge, Name,
  // spielt-Marke), und ohne sie massen fuenf Folgen-Anzeige-Tests nichts.
  if (req.method === 'POST' && p === '/api/spielen') {
    let roh = ''
    for await (const stueck of req) roh += stueck
    console.log(`  POST /api/spielen <- ${roh}`)
    let rumpf = {}
    try {
      rumpf = JSON.parse(roh)
    } catch {
      /* dann eben leer — die Antwort unten sagt trotzdem ok */
    }
    if (!rumpf.schluessel) return jsonAus(res, { fehler: 'schluessel fehlt' }, 400)
    const schl = String(rumpf.schluessel)
    const werk = (werke(true).werke || []).find((x) => x.schluessel === schl)
    const q0 = werk && Array.isArray(werk.quellen) && werk.quellen[0] ? werk.quellen[0].dienst : ''
    const inhaltBauart = q0 === 'ard' || q0 === 'plugin' || (q0 === 'jellyfin' && werk?.art === 'album')
    const liste = inhaltBauart ? inhaltAntwort(schl, true, '') : null
    const titel = liste && liste.status === 200 && Array.isArray(liste.body.titel) ? liste.body.titel : null
    // DAS START-GEDAECHTNIS, wie im echten Server (laufendes-werk.ts): der
    // Stub merkt sich, WAS er gestartet hat, und /player/local nennt es als
    // `laeuft`. Die Titel kommen aus derselben inhaltAntwort wie die Kacheln
    // — zwei Listen liefen genau dann auseinander, wenn es darauf ankommt.
    // Fuer Werke ohne inhalt-Bauart holt die Merkung die Liste selbst nach
    // (der echte Server tut es beim E111-inhalt-Weg ebenso); bleibt sie leer,
    // nennt `laeuft` nur das Werk.
    const gemerkteListe = titel || (() => {
      const l = inhaltAntwort(schl, true, '')
      return l && l.status === 200 && Array.isArray(l.body.titel) ? l.body.titel : null
    })()
    lage.gestartet = { werk: schl, quelle: q0 || 'lokal', titel: gemerkteListe }
    SPIELPROTOKOLL.push({ t: Date.now(), werk: schl, quelle: q0 || 'lokal' })
    if (SPIELPROTOKOLL.length > 50) SPIELPROTOKOLL.shift()
    return jsonAus(res, {
      ergebnis: 'ok',
      schluessel: schl,
      ...(q0 ? { dienst: q0 } : {}),
      gestartetNr: Math.max(1, Math.round(Number(rumpf.titelNr) || 0) || 1),
      ...(titel && titel.length ? { titel } : {}),
    })
  }

  // Der Verlauf. Der echte Endpunkt ergaenzt je Eintrag den WERK-Schluessel,
  // damit die Kachel startbar ist - hier genauso, sonst pruefte die Vorschau
  // etwas anderes als die Box (dieselbe Lehre wie bei /player/local).
  if (p === '/api/gespielt') {
    if (lage.verlauf === 'leer') return jsonAus(res, { zuletzt: [], haeufigste: [] })
    const bau = (i, anzahl) => ({
      key: `spotify:kennung-${i}`,
      title: WERKE[i].titel,
      artist: WERKE[i].interpret,
      type: WERKE[i].dienst,
      category: WERKE[i].kategorie,
      anzahl,
      zuletzt: 1785500000000 - i * 100000,
      schluessel: `vorschau:${i}`,
      bild: `/api/bild/vorschau:${i}`,
    })
    const h = [bau(5, 13), bau(1, 12), bau(3, 4), bau(0, 3)]
    // EINER OHNE WERK: was aus der Bibliothek genommen wurde, bleibt im
    // Verlauf stehen - die Oberflaeche muss ihn aussortieren, nicht anzeigen.
    h.push({ key: 'spotify:weg', title: 'Laengst geloescht', type: 'spotify', anzahl: 9, zuletzt: 1 })
    return jsonAus(res, { zuletzt: h, haeufigste: h })
  }

  // „Weiterhoeren". Der echte Endpunkt liefert die Zeilen fertig gefiltert und
  // sortiert; hier genauso.
  //
  // ALLE FAELLE, DIE DIE OBERFLAECHE UNTERSCHEIDET — sonst luegt diese
  // Attrappe wieder durch WEGLASSEN (llmwiki attrappe-luegt-durch-weglassen):
  //
  //   positionMs + titelNr > 1   Spotify mitten im Album  -> Plakette „Folge N"
  //   positionProzent, ohne Nr   eine Podcast-Folge       -> Balken
  //   lokal mit Titelnummer      mpv-Warteschlange        -> Plakette, und der
  //                                                          Tipp geht ueber
  //                                                          tracknr: + seekpos:
  //   titelNr === 1              zweideutig               -> WEDER noch
  //   ohne `schluessel`          aus der Bibliothek raus  -> muss WEGFALLEN
  //   MEHRERE KATEGORIEN         Musik neben Hoerbuch     -> muss sich beim
  //                                                          Filtern trennen
  //
  // Ohne den letzten Fall saehe man nie, ob die Oberflaeche ihn aussortiert;
  // ohne den Prozent-Fall waere der Balken nie zu sehen, und ohne den
  // lokalen Fall nie der Weg ueber drei Befehle. Die 1 ist der stillste Fall
  // und deshalb der, den man sonst nie zu Gesicht bekaeme.
  //
  // DIE KATEGORIE-ZEILE KAM AM 02.08.2026 DAZU, und sie ist der Beleg fuer
  // [attrappe-luegt-durch-weglassen] in Reinform: bis dahin waren ALLE fuenf
  // Zeilen `audiobook`. Der gemeldete Fehler („ich bin im Hoerspiel und sehe
  // einen Musiktitel") konnte in dieser Vorschau also gar nicht entstehen —
  // wer die Reihe hier gegen die Kategorie geprueft haette, haette „stimmt
  // schon" gemeldet, ohne dass je ein Musiktitel dabei gewesen waere.
  //
  // UND SIE HAT BIS 02.08.2026 EINE ZWEITE SACHE VERSCHWIEGEN: den DECKEL.
  // Der echte Endpunkt sortiert nach `zuletzt` und schneidet auf `?max=` ab
  // (`Math.max(1, Math.min(20, …))` in server.ts). Diese Attrappe gab immer
  // ALLE Zeilen heraus, egal was gefragt war — also konnte hier nie auffallen,
  // dass eine Zeile die Seite gar nicht erreicht. Gemessen an der Box
  // (192.168.178.169, 2026-08-02, nur gelesen): resume.json haelt 9 Stellen,
  // `?max=6` liefert 6 Zeilen, `?max=20` sieben. Die siebte sah die Seite nie.
  //
  // DESHALB STEHEN HIER NEUN ZEILEN, DREI DAVON UNSTARTBAR UND GANZ OBEN.
  // Genau so sieht es auf der Box aus (dort sind vier der sieben Zeilen ohne
  // Werk). Damit belegen sie im Sechser-Fenster den Platz von drei startbaren
  // Zeilen — und das ist der Fall, den keine Messung zeigte, solange die
  // Attrappe den Deckel nicht kannte.
  if (p === '/api/weiterhoeren') {
    if (lage.verlauf === 'leer') return jsonAus(res, { weiter: [] })
    // WIE DER ECHTE ENDPUNKT: nach `zuletzt` sortieren und auf `?max=` kappen
    // (server.ts /api/weiterhoeren, Grenzen 1..20). Ohne diese zwei Zeilen
    // luegt die Vorschau ueber den Deckel — siehe den Absatz darueber.
    const max = Math.max(1, Math.min(20, Number(u.searchParams.get('max')) || 6))
    // ── DIE AUSWAHL GILT AUCH HIER ────────────────────────────────────
    // WIE IM SERVER: `/api/weiterhoeren` wird mitgefiltert. Ohne diese zwei
    // Zeilen zeigte die Vorschau ein Kind, dessen Regal leer ist und ueber dem
    // trotzdem fuenf Kacheln „Weiterhören" stehen — also genau den Fehler, den
    // niemand bauen wollte, vorgefuehrt als sei er der Normalzustand.
    const nurDiese = auswahlVon(profilStand().aktiv)
    const roh = nurDiese.length ? WEITER_ROH().filter((z) => nurDiese.includes(z.schluessel)) : WEITER_ROH()
    const zeilen = [...roh].sort((a, b) => b.zuletzt - a.zuletzt).slice(0, max)
    if (u.searchParams.get('verschmelzen') !== '1') return jsonAus(res, { weiter: zeilen })
    // WIE IM SERVER: geschluckter Schluessel -> fuehrender, dazu `quelle` (der
    // Dienst, der gleich spielt) und die Stelle in DESSEN Einheit
    // (`fortsetzenMit`, weiterhoeren.ts). Eine Vorschau, die nur den Schluessel
    // umschreibt und die Millisekunden stehen laesst, zeigte ein `seekpos:`
    // mit 61000 — und man haelt den gemessenen Unsinn fuer den Bestand.
    const alle = werke(true).werke || []
    const fuehrend = new Map()
    const bevorzugt = new Map()
    for (const w of alle) {
      if (w.quellen?.[0]?.dienst) bevorzugt.set(w.schluessel, w.quellen[0].dienst)
      for (const k of w.auchSchluessel || []) fuehrend.set(k, w.schluessel)
    }
    const ueberMpv = (d) => d === 'lokal' || d === 'jellyfin' || d === 'rss'
    return jsonAus(res, {
      weiter: zeilen.map((z) => {
        if (!z.schluessel) return z
        const s = fuehrend.get(z.schluessel) || z.schluessel
        const dienst = bevorzugt.get(s)
        if (!dienst) return { ...z, schluessel: s, bild: `/api/bild/${s}` }
        const stelle =
          dienst === 'spotify'
            ? { positionMs: z.positionMs, positionProzent: null }
            : ueberMpv(dienst)
              ? {
                  positionMs: null,
                  positionProzent:
                    z.positionProzent !== null
                      ? z.positionProzent
                      : z.anteil !== null
                        ? Math.round(Math.max(0, Math.min(1, z.anteil)) * 1000) / 10
                        : null,
                }
              : { positionMs: null, positionProzent: null }
        return { ...z, ...stelle, quelle: dienst, schluessel: s, bild: `/api/bild/${s}` }
      }),
    })
  }

  // Bluetooth. DREI Lagen, umschaltbar - die mittlere ist die, um die es geht:
  // gekoppelt, aber nicht verbunden (der Lautsprecher ist aus).
  if (p === '/api/bluetooth') {
    if (lage.bt === 'weg') {
      res.statusCode = 502
      res.end()
      return
    }
    if (lage.bt === 'aus') return jsonAus(res, { adapter: { an: false }, geraete: [] })
    return jsonAus(res, { adapter: { an: true }, geraete: btGeraete() })
  }

  // ── Bluetooth HANDELN, nicht nur ansehen ────────────────────────────────
  //
  // BIS ZUM 04.08.2026 KONNTE DIESE ATTRAPPE NUR LESEN. Solange nur das
  // Zeichen in der Kopfzeile daran hing, genuegte das; mit dem Eltern-Bereich
  // haengen jetzt drei Knoepfe je Zeile daran, und ein Knopf, dessen Wirkung
  // niemand nachstellen kann, ist ein ungeprueftes Stueck Oberflaeche.
  //
  // DIE ANTWORTEN SIND VOM SERVER ABGESCHRIEBEN, nicht ausgedacht: `suche`
  // gibt `{ ok, sekunden, geraete }`, eine Aktion `{ ok, meldung, geraete }`,
  // und ein Fehlschlag traegt `grund` (server.ts). Wer hier `error` statt
  // `grund` schriebe, saehe eine Oberflaeche, die im Fehlerfall nichts sagt —
  // und suchte den Fehler in der Oberflaeche.
  if (req.method === 'POST' && p === '/api/bluetooth/suche') {
    let roh = ''
    for await (const stueck of req) roh += stueck
    if (lage.bt === 'suche-kaputt') {
      return jsonAus(res, { ok: false, error: 'Die Suche ist fehlgeschlagen', grund: 'kein Adapter' }, 503)
    }
    // NICHT ZWOELF SEKUNDEN WARTEN. Die echte Box blockiert so lange, hier
    // waere es nur Wartezeit fuer jede Messung. Was die Suche AENDERT, ist der
    // Punkt: es kommen Geraete dazu, die vorher nicht dastanden.
    BT_GEFUNDEN = true
    console.log(`  Bluetooth-Suche <- ${roh}`)
    return jsonAus(res, { ok: true, sekunden: 12, geraete: btGeraete() })
  }

  if (req.method === 'POST' && /^\/api\/bluetooth\/[^/]+\/[^/]+$/.test(p)) {
    // Rumpf leerlesen — die echte Box nimmt hier ohnehin nur `{}`. Wer ihn
    // stehen laesst, blockiert bei manchen Node-Fassungen die naechste Antwort
    // auf derselben Verbindung.
    for await (const stueck of req) void stueck
    const [, , , mac, aktion] = p.split('/')
    if (lage.bt === 'tat-kaputt') {
      // GENAU SO ANTWORTET DIE BOX, wenn bluetoothctl nein sagt: HTTP 200 und
      // `ok: false`. Wer nur auf den Statuscode sieht, haelt das fuer Erfolg —
      // deshalb prueft die Oberflaeche BEIDES, und deshalb steht dieser Fall
      // hier.
      return jsonAus(res, { ok: false, meldung: 'Das Gerät antwortet nicht. Eingeschaltet?', geraete: btGeraete() })
    }
    if (aktion === 'trennen') lage.bt = 'getrennt'
    if (aktion === 'verbinden' || aktion === 'koppeln') {
      if (mac === BT_STAMM.mac) lage.bt = 'verbunden'
      else BT_ANGENOMMEN.add(mac)
    }
    console.log(`  Bluetooth ${aktion} ${mac}`)
    return jsonAus(res, { ok: true, meldung: '', geraete: btGeraete() })
  }

  // ── WLAN im Eltern-Bereich: suchen, wechseln, BESTAETIGEN ────────────────
  //
  // DIE FELDER SIND AM GERAET ABGELESEN (06.08.2026, curl gegen .169), nicht
  // ausgedacht — `stufe`, `verschluesselung`, `bekannt` und `verbunden` sind
  // genau die Namen, die die Oberflaeche liest.
  //
  // DER TOTMANNSCHALTER IST DER GRUND, WARUM ES DIESE ATTRAPPE GIBT. Der
  // gefaehrliche Teil eines WLAN-Wechsels ist nicht das Verbinden, sondern die
  // Minute danach: `verbinden` setzt einen Wecker auf 150 s, und NUR
  // `bestaetigen` schreibt die Aenderung fest. Am echten Geraet ist dieser
  // Ablauf nicht zu ueben, ohne die Box vom Netz zu nehmen — hier schon.
  if (p === '/api/netzwerk/scan') {
    if (lage.wlan === 'weg') {
      res.statusCode = 503
      res.end()
      return
    }
    return jsonAus(res, {
      ok: true,
      frisch: true,
      schnittstelle: 'wlan0',
      netze: WLAN_NETZE.map((n) => ({
        ...n,
        verbunden: n.ssid === WLAN_STAND.verbunden,
        // `bekannt` kommt AUSSCHLIESSLICH aus GESPEICHERT — derselben Liste,
        // die das Fach unten zeigt und die das Vergessen kuerzt (13.09.2026).
        // Ein zweites Flag daneben war die zweite Wahrheit: nach einem
        // „Vergessen" blieb der Scan bei „gespeichert", und die Oberflaeche
        // suchte eine Kennung, die es nicht mehr gab.
        bekannt: n.ssid === WLAN_STAND.verbunden || GESPEICHERT.some((g) => g.ssid === n.ssid),
      })),
    })
  }

  // ── Die gespeicherten Netze (E115 am Geraet, 13.09.2026) ─────────────────
  //
  // WORTGLEICH ZUM SERVER: GET liefert { ok, schnittstelle, netze }, das
  // Verbinden traegt dieselben Felder wie /netzwerk/verbinden (der Wechsel
  // dahinter ist derselbe), und das Vergessen des AKTUELLEN Netzes ist ein
  // 409 mit dem Satz des Servers — die Oberflaeche zeigt ihn woertlich.
  if (p === '/api/netzwerk/gespeichert') {
    if (lage.wlan === 'weg') {
      res.statusCode = 503
      res.end()
      return
    }
    return jsonAus(res, {
      ok: true,
      schnittstelle: 'wlan0',
      netze: GESPEICHERT.map((g) => ({ ...g, aktuell: g.ssid === WLAN_STAND.verbunden })),
    })
  }

  if (req.method === 'POST' && p === '/api/netzwerk/gespeichert/verbinden') {
    let roh = ''
    for await (const stueck of req) roh += stueck
    let rumpf = {}
    try {
      rumpf = JSON.parse(roh || '{}')
    } catch {
      rumpf = {}
    }
    const ziel = GESPEICHERT.find((g) => g.id === Number(rumpf.kennung))
    if (!ziel) return jsonAus(res, { ok: false, error: 'Netzkennung: unbekannt' }, 400)
    console.log(`  WLAN gespeichert verbinden <- kennung=${ziel.id} (${ziel.ssid})`)
    if (ziel.ssid === WLAN_STAND.verbunden)
      return jsonAus(res, { ok: true, schonVerbunden: true, ssid: ziel.ssid, amGeraet: false, bestaetigenBis: 0, gesichert: true, hinweis: `Die Box haengt bereits in „${ziel.ssid}".` })
    const gesichert = lage.wlan !== 'ungesichert'
    WLAN_STAND.wechsel = { ssid: ziel.ssid, bis: Date.now() + 150000, gesichert }
    // Derselbe gefaehrlichste Fall wie beim Passwort-Weg (Begruendung dort):
    // `kommtnicht` heisst, die Box haengt danach an GAR KEINEM Netz.
    if (lage.wlan !== 'kommtnicht') WLAN_STAND.verbunden = ziel.ssid
    else WLAN_STAND.verbunden = ''
    return jsonAus(res, {
      ok: true,
      schonVerbunden: false,
      ssid: ziel.ssid,
      gesichert,
      amGeraet: false,
      bestaetigenBis: 150,
      hinweis: gesichert
        ? `Wechsel auf „${ziel.ssid}" eingeleitet. Traegt er nicht, stellt die Box das vorherige Netz wieder her.`
        : 'ACHTUNG: Der Totmannschalter liess sich nicht stellen. Es gibt keinen automatischen Rueckweg.',
    })
  }

  if (req.method === 'POST' && p === '/api/netzwerk/gespeichert/vergessen') {
    let roh = ''
    for await (const stueck of req) roh += stueck
    let rumpf = {}
    try {
      rumpf = JSON.parse(roh || '{}')
    } catch {
      rumpf = {}
    }
    const nr = GESPEICHERT.findIndex((g) => g.id === Number(rumpf.kennung))
    if (nr < 0) return jsonAus(res, { ok: false, error: 'Netzkennung: unbekannt' }, 400)
    if (GESPEICHERT[nr].ssid === WLAN_STAND.verbunden)
      return jsonAus(
        res,
        {
          ok: false,
          error:
            'Die Box hängt gerade in diesem Netz. Erst auf ein anderes Netz wechseln, dann vergessen — sonst nimmt sie sich selbst vom Netz.',
        },
        409,
      )
    const [weg] = GESPEICHERT.splice(nr, 1)
    console.log(`  WLAN vergessen: ${weg.ssid} (Kennung ${weg.id})`)
    return jsonAus(res, {
      ok: true,
      ssid: weg.ssid,
      netze: GESPEICHERT.map((g) => ({ ...g, aktuell: g.ssid === WLAN_STAND.verbunden })),
    })
  }

  // ══ WPS — DIE ROUTE, DIE HIER GEFEHLT HAT ═══════════════════════════════
  //
  // DIE ZEILE „Per WPS-Taste verbinden" IST AM 06.08.2026 GEBAUT WORDEN, DIE
  // ATTRAPPE DAZU NICHT. Ein Tipp darauf lief gegen diesen Server ins 404;
  // die Oberflaeche meldete brav „WPS liess sich nicht starten", und das
  // 120-Sekunden-Fenster — der eigentliche Sinn der Zeile — war gegen die
  // Vorschau NIE zu sehen. Gruen war trotzdem alles: die Werkzeuge fragten,
  // OB die Zeile dasteht, nicht was ein Tipp bewirkt. Gefunden hat es
  // tools/admin-nichts-verloren.mjs.
  //
  // WORTGLEICH ZUM SERVER (server.ts, `/api/netzwerk/wps`): `fensterSek: 120`
  // im Erfolgsfall, sonst 503 mit `error`. Die 120 stehen NICHT hier als
  // huebsche Zahl, sondern weil die Oberflaeche sie anzeigt — eine Attrappe
  // mit einer anderen Zahl misst eine Anzeige, die es so nicht gibt.
  //
  //     curl localhost:8299/vorschau/wlan-wps-kaputt   # wpa_supplicant sagt nein
  //     curl localhost:8299/vorschau/wlan-normal       # wieder gut
  if (req.method === 'POST' && p === '/api/netzwerk/wps') {
    for await (const stueck of req) void stueck
    if (lage.wlan === 'wps-kaputt')
      return jsonAus(res, { ok: false, error: 'wpa_supplicant meldet: FAIL' }, 503)
    console.log('  WPS gestartet (Fenster 120 s)')
    return jsonAus(res, { ok: true, fensterSek: 120 })
  }

  if (p === '/api/netzwerk/watchdog') {
    if (!WLAN_STAND.wechsel) return jsonAus(res, { ok: true, scharf: false })
    const rest = Math.max(0, Math.round((WLAN_STAND.wechsel.bis - Date.now()) / 1000))
    if (!rest) {
      // ABGELAUFEN HEISST ZURUECKGEROLLT — genau das tut netz-watchdog.py.
      WLAN_STAND.wechsel = null
      return jsonAus(res, { ok: true, scharf: false })
    }
    return jsonAus(res, { ok: true, scharf: true, restSek: rest, frist: 150, grund: `WLAN ${WLAN_STAND.wechsel.ssid}` })
  }

  if (req.method === 'POST' && p === '/api/netzwerk/verbinden') {
    let roh = ''
    for await (const stueck of req) roh += stueck
    let rumpf = {}
    try {
      rumpf = JSON.parse(roh || '{}')
    } catch {
      rumpf = {}
    }
    // DAS PASSWORT WIRD NICHT PROTOKOLLIERT, auch nicht in der Attrappe. Eine
    // Vorschau, die es mitschreibt, ist die vierte Stelle, an der es landet —
    // und die einzige, an der niemand danach sucht.
    console.log(`  WLAN verbinden <- ssid=${String(rumpf.ssid ?? '')} (Passwort ${rumpf.psk ? 'gesetzt' : 'leer'})`)
    if (lage.wlan === 'falsch') {
      // WORTGLEICH ZUM SERVER (netzwerk.ts, `pruefePsk`): der Grund nennt die
      // REGEL, nie den Wert.
      return jsonAus(res, { ok: false, error: 'Passwort: muss 8 bis 63 Zeichen haben' }, 400)
    }
    const gesichert = lage.wlan !== 'ungesichert'
    WLAN_STAND.wechsel = { ssid: String(rumpf.ssid ?? ''), bis: Date.now() + 150000, gesichert }
    // ══ DER GEFAEHRLICHSTE FALL, UND ER FEHLTE HIER ═══════════════════════
    // `verbinden` MELDET Erfolg, sobald wpa_supplicant den Auftrag angenommen
    // hat — die Anmeldung selbst kann danach immer noch scheitern (falsches
    // Passwort, Netz ausser Reichweite, Router weg). `select_network` hat das
    // ALTE Netz dabei schon abgeschaltet: die Box haengt dann an GAR KEINEM.
    // Bis zum 06.08.2026 stellte diese Attrappe nur die schoene Welt und
    // schrieb `verbunden` sofort um; die Oberflaeche konnte den Fall also gar
    // nicht falsch machen, weil er nie vorkam.
    //   /vorschau/wlan-kommtnicht  der Wechsel gelingt NICHT
    if (lage.wlan !== 'kommtnicht') WLAN_STAND.verbunden = String(rumpf.ssid ?? '')
    else WLAN_STAND.verbunden = ''
    return jsonAus(res, {
      ok: true,
      gesichert,
      bestaetigenBis: 150,
      hinweis: gesichert
        ? 'Bitte bestaetigen, solange die Box erreichbar ist — sonst wird zurueckgerollt.'
        : 'ACHTUNG: Der Totmannschalter liess sich nicht stellen. Es gibt keinen automatischen Rueckweg.',
    })
  }

  if (req.method === 'POST' && p === '/api/netzwerk/bestaetigen') {
    for await (const stueck of req) void stueck
    if (lage.wlan === 'bestaetigen-kaputt') return jsonAus(res, { ok: false, error: 'Bestaetigung fehlgeschlagen' }, 503)
    WLAN_STAND.wechsel = null
    console.log('  WLAN-Wechsel bestaetigt')
    return jsonAus(res, { ok: true })
  }

  // ── Der VPN-Heimweg im Eltern-Bereich (E30, 13.09.2026) ──────────────────
  //
  // WORTGLEICH ZUM SERVER (vpn.ts): GET /api/vpn liefert { werkzeugDa, kern,
  // konfiguration, einheit, tunnel } — und das URTEIL steht im Feld, es wird
  // hier wie dort NICHT von der Oberflaeche gerechnet. POST /api/vpn/aktiv
  // nimmt { an } ODER { beimStart } und antwortet mit { einheit, tunnel }.
  //
  //     curl localhost:8299/vorschau/vpn-werkzeug-fehlt
  //     curl localhost:8299/vorschau/vpn-leer
  //     curl localhost:8299/vorschau/vpn-nie
  //     curl localhost:8299/vorschau/vpn-stand
  //     curl localhost:8299/vorschau/vpn-zurueck
  if (p === '/api/vpn' && req.method === 'GET') {
    if (lage.vpn === 'weg') {
      res.statusCode = 503
      res.end()
      return
    }
    const werkzeugDa = lage.vpn !== 'werkzeug-fehlt'
    const konfiguration = werkzeugDa && lage.vpn !== 'leer' ? VPN_STAND.konfiguration : null
    const an = !!(konfiguration && VPN_STAND.einheit.aktiv)
    const tunnel = !an
      ? { da: false }
      : lage.vpn === 'nie'
        ? { da: true, endpunkt: konfiguration.endpunkt, erlaubteNetze: konfiguration.erlaubteNetze, handschlagVorSek: null, urteil: 'nie', empfangen: 0, gesendet: 148 }
        : lage.vpn === 'stand'
          ? { da: true, endpunkt: konfiguration.endpunkt, erlaubteNetze: konfiguration.erlaubteNetze, handschlagVorSek: 4230, urteil: 'stand', empfangen: 52104, gesendet: 30988 }
          : { da: true, endpunkt: konfiguration.endpunkt, erlaubteNetze: konfiguration.erlaubteNetze, handschlagVorSek: 12, urteil: 'steht', empfangen: 52104, gesendet: 30988 }
    return jsonAus(res, {
      werkzeugDa,
      kern: werkzeugDa ? 'als-modul-da' : 'unbekannt',
      konfiguration,
      einheit: { aktiv: an, beimStart: !!(konfiguration && VPN_STAND.einheit.beimStart) },
      tunnel,
    })
  }

  if (req.method === 'POST' && p === '/api/vpn/aktiv') {
    let roh = ''
    for await (const stueck of req) roh += stueck
    let rumpf = {}
    try {
      rumpf = JSON.parse(roh || '{}')
    } catch {
      rumpf = {}
    }
    if (lage.vpn === 'schalten-kaputt')
      return jsonAus(res, { ok: false, error: 'systemctl meldet: Job for wg-quick@wg0.service failed' }, 503)
    if (lage.vpn === 'werkzeug-fehlt' || lage.vpn === 'leer')
      return jsonAus(res, { ok: false, error: 'Keine VPN-Konfiguration hinterlegt' }, 409)
    if (typeof rumpf.an === 'boolean') VPN_STAND.einheit.aktiv = rumpf.an
    if (typeof rumpf.beimStart === 'boolean') VPN_STAND.einheit.beimStart = rumpf.beimStart
    console.log(`  VPN geschaltet <- ${JSON.stringify(rumpf)} -> einheit ${JSON.stringify(VPN_STAND.einheit)}`)
    const an = VPN_STAND.einheit.aktiv
    return jsonAus(res, {
      ok: true,
      einheit: { ...VPN_STAND.einheit },
      tunnel: an
        ? // FRISCH EINGESCHALTET HEISST „NOCH KEIN HANDSCHLAG" — wie am
          // Geraet: die erste Antwort der Gegenstelle braucht Sekunden, und
          // die Oberflaeche muss den Fall „nie, aber normal" zeigen koennen.
          { da: true, endpunkt: VPN_STAND.konfiguration.endpunkt, erlaubteNetze: VPN_STAND.konfiguration.erlaubteNetze, handschlagVorSek: null, urteil: 'nie', empfangen: 0, gesendet: 0 }
        : { da: false },
    })
  }

  // ── Die Verwaltung im Eltern-Bereich ────────────────────────────────────
  //
  // NUR DIE DREI WEGE, DIE DAS FACH WIRKLICH GEHT: lesen mit `q`, aendern ueber
  // den Schluessel, loeschen ueber den Schluessel. `POST /api/medien` (anlegen)
  // fehlt hier absichtlich — das Fach kann es nicht, und eine Attrappe, die
  // mehr kann als die Oberflaeche, verleitet zum Bauen ohne Messen.
  if (p === '/api/medien' && req.method === 'GET') {
    if (lage.medien === 'weg') {
      res.statusCode = 503
      res.end()
      return
    }
    const q = u.searchParams.get('q') || ''
    const eben = (s) =>
      String(s ?? '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
    const teile = eben(q).split(' ').filter(Boolean)
    const bestand = medienListe()
    const treffer = bestand.filter((e) => {
      const heu = `${eben(e.title)} ${eben(e.artist)} ${eben(e.category)} ${e.dienst}`
      return teile.every((t) => heu.includes(t))
    })
    return jsonAus(res, {
      eintraege: treffer,
      gesamt: bestand.length,
      kategorien: ['music', 'audiobook', 'other'],
      dienste: [...new Set(bestand.map((e) => e.dienst))].sort(),
    })
  }

  if (/^\/api\/medien\/[^/]+$/.test(p) && (req.method === 'PATCH' || req.method === 'DELETE')) {
    let roh = ''
    for await (const stueck of req) roh += stueck
    const schluessel = decodeURIComponent(p.slice('/api/medien/'.length))
    // GEAENDERT UND GELOESCHT WIRD IN DER LISTE, DIE GERADE GILT — sonst
    // meldete die Vorschau bei `bibliothek-viele` „gespeichert" und aenderte die
    // vier Eintraege daneben.
    const bestand = medienListe()
    const i = bestand.findIndex((e) => e.schluessel === schluessel)
    if (i < 0) return jsonAus(res, { error: 'nichtGefunden' }, 404)
    // DIE SPERRDATEI IST KEIN RANDFALL: die Box schreibt data.json selbst,
    // wenn ein Kind etwas anhoert. Die Oberflaeche sagt dazu einen eigenen
    // Satz, und der ist nur mit dieser Lage zu sehen.
    if (lage.medien === 'gesperrt') return jsonAus(res, { error: 'gesperrt' }, 409)
    if (req.method === 'DELETE') {
      console.log(`  Medien loeschen ${schluessel}`)
      bestand.splice(i, 1)
      return jsonAus(res, { ok: true })
    }
    let patch = {}
    try {
      patch = JSON.parse(roh || '{}')
    } catch {
      patch = {}
    }
    // NUR DIE FELDER, DIE `aenderungAnwenden` (medien.ts) durchlaesst — sonst
    // liesse sich hier eine Kennung verbiegen, die der Server nie annehmen
    // wuerde.
    if (typeof patch.title === 'string' && patch.title.trim()) bestand[i].title = patch.title.trim()
    if (typeof patch.artist === 'string') bestand[i].artist = patch.artist.trim()
    if (['music', 'audiobook', 'other'].includes(patch.category)) bestand[i].category = patch.category
    console.log(`  Medien aendern ${schluessel} <- ${Object.keys(patch).join(', ')}`)
    return jsonAus(res, { ok: true })
  }

  // ── Netz und Akku: die drei Zeichen rechts oben ──────────────────────────
  //
  // HIER FEHLTE BIS ZUR GESAMTPRUEFUNG (2026-08-02) BEIDES, und das ist die
  // dritte Sorte aus [attrappe-luegt-durch-weglassen]: `netzHolen()` und
  // `hatHolen()` verstecken ihre Anzeige, wenn der Abruf misslingt — genau das
  // tat die Vorschau, indem sie 404 schickte. Die Balken, die Wolke und das
  // Akkuzeichen waren deshalb hier NIE zu sehen. Wer die Kopfzeile aendert
  // (Boxname, Hoehe, Abstaende), misst sie ohne die drei Zeichen, die rechts
  // daneben stehen — und haelt es fuer geprueft.
  //
  // Die Felder sind aus dem Server abgeschrieben, nicht erfunden:
  // `/api/netzwerk` (server.ts) liefert schnittstellen/wlan/internet,
  // `/api/mupihat` die Felder des Treibers plus `Bat_SOC_fein`.
  /* ══ FUNK AN UND AUS — die vier Wege aus server.ts (ab ~2166) ════════════
   *
   * ══ WARUM DIESE ATTRAPPE UEBERHAUPT SEIN MUSS ═════════════════════════════
   * An der ECHTEN Box laesst sich dieser Schirm nicht pruefen: sie haengt an
   * genau einem Faden (wlan0), am Bluetooth haengt ein Lautsprecher, und ein
   * einziger Tipp auf „WLAN ausschalten" beendet die Sitzung, in der man
   * misst. Die drei Lagen, um die es geht (erlaubt · nicht erlaubt · vor Ort),
   * unterscheiden sich ausserdem in etwas, das man an einer Box gar nicht
   * einstellen kann, ohne ein Netzwerkkabel zu stecken.
   *
   * ══ DIE FALLE, DIE HIER NACHGESTELLT WIRD ════════════════════════════════
   * DER AUS-WEG ANTWORTET SOFORT UND SCHALTET ERST 600 MS SPAETER. Das ist am
   * Server Absicht (die Antwort muesste sonst ueber die Verbindung laufen, die
   * gerade weggeht) — und es ist die Falle fuer die Oberflaeche: gibt sie die
   * Knoepfe gleich wieder frei, laedt sie zum zweiten Tippen ein, und aus dem
   * Schalter wurde eine Einbahnstrasse. Eine Attrappe, die sofort umschaltet,
   * liesse den Fehler NICHT auftreten — sie waere genau das, wovor
   * [attrappe-luegt-durch-weglassen] warnt, nur in der Zeitachse.
   * `FUNK_RUFE` schreibt deshalb JEDEN Aufruf mit; ein zweiter Ruf ist der
   * Beweis, dass der Nachlauf fehlt.
   */
  if (p === '/api/funk') {
    const f = funkFreigabe(false)
    const wege = funkWege()
    return jsonAus(res, {
      bluetooth: { an: FUNK_STAND.bluetooth, vorhanden: true },
      wlan: {
        an: FUNK_STAND.wlan,
        name: 'wlan0',
        vorhanden: true,
        adresse: wege.find((w) => w.name === 'wlan0').adresse,
      },
      // Flugmodus ist kein eigener Zustand, sondern eine Aussage ueber beide.
      flug: !FUNK_STAND.wlan && FUNK_STAND.bluetooth === false,
      wege,
      zweiterWeg: f.ueber,
      ausErlaubt: f.erlaubt,
      grund: f.grund,
      // Loopback ist ein HINWEIS, kein Beweis: der Server sagt damit nur, ob
      // die Oberflaeche „ich stehe davor" ueberhaupt anbieten darf.
      vonDerBox: lage.funk === 'vorort',
      schaltweg: 'ifupdown',
    })
  }

  if (req.method === 'POST' && p.startsWith('/api/funk/')) {
    let roh = ''
    for await (const stueck of req) roh += stueck
    let k = {}
    try {
      k = JSON.parse(roh || '{}')
    } catch {
      k = {}
    }
    const was = p.slice('/api/funk/'.length)
    const an = k.an === true ? true : k.an === false ? false : null
    FUNK_RUFE.push({ was, an, vorOrt: k.vorOrt === true, zeit: Date.now() })
    console.log(`  Funk ${was} <- ${roh}`)
    if (an === null) return jsonAus(res, { ok: false, error: 'an muss true oder false sein' }, 400)

    // ── BLUETOOTH: schlicht, sofort, ohne Bedingung ──────────────────────
    // Es kappt keinen Weg zur Box. Der ECHTE Server schaltet hier synchron
    // und antwortet erst danach — deshalb hier auch kein Nachlauf.
    if (was === 'bluetooth') {
      FUNK_STAND.bluetooth = an
      return jsonAus(res, {
        ok: true,
        an,
        hinweis: an
          ? 'Gekoppelte Geraete verbinden sich nicht von selbst — der Lautsprecher muss ggf. neu verbunden werden.'
          : 'Der gekoppelte Lautsprecher ist damit getrennt.',
      })
    }

    if (was !== 'wlan' && was !== 'flug') return jsonAus(res, { ok: false, error: 'unbekannt' }, 404)

    // ── EINSCHALTEN FRAGT NIE NACH und wird nie abgelehnt ────────────────
    // `flug` ist andersherum gemeint als `wlan`: `an: true` heisst dort
    // FUNKSTILLE. Wer das verwechselt, baut einen Schalter, der das Gegenteil
    // tut — deshalb steht die Umkehrung hier in einer eigenen Zeile.
    const schaltetAb = was === 'flug' ? an === true : an === false
    if (!schaltetAb) {
      if (was === 'wlan') {
        FUNK_STAND.wlan = true
        return jsonAus(res, { ok: true, an: true, adresse: '192.168.178.170', hinweis: 'WLAN ist wieder an, Adresse 192.168.178.170.' })
      }
      Object.assign(FUNK_STAND, { bluetooth: true, wlan: true })
      return jsonAus(res, {
        ok: true,
        flug: false,
        wlan: { an: true, adresse: '192.168.178.170' },
        bluetooth: { an: true },
        hinweis: 'Funk ist wieder an, die Box ist unter 192.168.178.170 erreichbar.',
      })
    }

    // ── UND JETZT DIE BEDINGUNG ──────────────────────────────────────────
    // 409 ist keine Warnung, sondern die Bedingung: danach kaeme niemand mehr
    // an die Box, um es zurueckzunehmen.
    const f = funkFreigabe(k.vorOrt === true)
    if (!f.erlaubt) return jsonAus(res, { ok: false, error: f.grund, wege: funkWege(), zweiterWeg: null }, 409)

    // ERST ANTWORTEN, DANN SCHALTEN — und die 600 ms sind der Punkt.
    if (was === 'wlan') jsonAus(res, { ok: true, an: false, ueber: f.ueber, nurVorOrt: f.nurVorOrt, hinweis: f.grund })
    else jsonAus(res, { ok: true, flug: true, ueber: f.ueber, nurVorOrt: f.nurVorOrt, hinweis: f.grund })
    setTimeout(() => {
      if (was === 'flug') FUNK_STAND.bluetooth = false
      FUNK_STAND.wlan = false
    }, 600)
    return
  }

  if (p === '/api/netzwerk') {
    if (lage.netz === 'weg') {
      res.statusCode = 502
      res.end()
      return
    }
    // SEIT 06.08.2026 SAGT DIESE ANTWORT DASSELBE WIE DER SUCHLAUF.
    // Sie ist die Quelle, an der die Oberflaeche „es hat geklappt" von „es
    // sieht so aus" unterscheidet (NewDesign/app.js, `netzStandHolen`) — eine
    // Attrappe, die hier einen festen Fantasienamen meldet, waehrend
    // `/api/netzwerk/scan` nebenan ein anderes Netz als verbunden fuehrt,
    // haette genau diese Unterscheidung unpruefbar gemacht.
    const wlanAn = lage.netz !== 'kabel' && !!WLAN_STAND.verbunden
    return jsonAus(res, {
      hostname: 'mixpibox',
      // ── DIE FORM DER ADRESSEN IST VON DER BOX ABGELESEN (06.08.2026) ────
      // Hier standen Zeichenketten (`['192.168.178.169']`). Die echte Box
      // liefert OBJEKTE mit Familie und Praefix:
      //     {"familie":"v4","adresse":"192.168.178.169","praefix":24}
      // und daneben zwei v6-Adressen. Solange hier Zeichenketten standen,
      // haette jede Messung an der Adresse den falschen Zweig geprueft — und
      // die v6-Adressen, die auf der Box mitkommen und NICHT gezeigt werden
      // sollen, gab es in der Vorschau gar nicht.
      schnittstellen: [
        {
          name: 'eth0',
          funk: false,
          aktiv: lage.netz === 'kabel',
          adressen:
            lage.netz === 'kabel' ? [{ familie: 'v4', adresse: '192.168.178.169', praefix: 24 }] : [],
        },
        {
          name: 'wlan0',
          funk: true,
          aktiv: wlanAn,
          adressen: wlanAn
            ? [
                { familie: 'v4', adresse: '192.168.178.170', praefix: 24 },
                { familie: 'v6', adresse: 'fd03:c0a8:58f1:0:8aa2:9eff:fe48:f64f', praefix: 64 },
              ]
            : [],
        },
      ],
      // −55 gut, −70 mittel, −80 schwach: die drei Stufen von
      // netzstatus.component.ts, damit alle drei ueberhaupt vorfuehrbar sind.
      wlan: wlanAn
        ? {
            ssid: WLAN_STAND.verbunden,
            signal: { gut: -55, mittel: -70, schwach: -80 }[lage.netz] ?? -55,
            frequenzMhz: 2437,
          }
        : null,
      // Verbunden UND trotzdem kein Weg nach draussen — der aergerliche Fall,
      // fuer den die Wolke ueberhaupt da ist. OHNE NETZ GIBT ES IHN NICHT:
      // wer an keinem WLAN haengt, kommt auch nirgendwohin.
      internet: wlanAn && lage.netz !== 'ohne-internet',
    })
  }

  // Der MuPiHAT ist Zubehoer. `hat-weg` ist der Normalfall einer Box OHNE ihn:
  // der Server antwortet dann `[]` (seit der Gesamtpruefung — vorher schickte
  // er GAR NICHTS und die Abfrage blieb offen). Die Oberflaeche blendet das
  // Akkuzeichen aus, und genau das soll man hier sehen koennen.
  /* ══ DER AKKUVERLAUF — die Lage, die man an einer Box nicht herstellt ═══
   *
   * WARUM DIESE ATTRAPPE SEIN MUSS: Die Kurve zeigt SIEBEN TAGE. Um sie an
   * einem Geraet zu pruefen, muesste man eine Woche warten — und um die
   * LUECKEN zu pruefen (die Naechte, in denen die Box aus war), muesste man
   * sie eine Woche lang jeden Abend ausschalten. Genau die Luecke ist aber
   * die Zeile, wegen der die Kurve nicht luegt.
   *
   * DIE VIER LAGEN SIND DIE VIER FAELLE, IN DENEN DIE ANZEIGE VERSCHIEDEN
   * AUSSIEHT — nicht vier Zufallsdaten:
   *   voll    Laden, Entladen, Ruhe UND naechtliche Luecken
   *   flach   die Box haengt durchgehend am Netz: eine Gerade bei 100 %, und
   *           die Kapazitaet ist unbekannt (der Zweig „wie lange noch, kann
   *           die Box nicht sagen")
   *   duenn   zwei Punkte — die Oberflaeche muss den SATZ zeigen und nicht
   *           einen Strich am rechten Rand
   *   leer    kein einziger Messwert
   * `fehlt` ist keine Lage der Daten, sondern des WEGES: HTTP 404, wie eine
   * Box mit aelterem Server. Auch dafuer hat die Oberflaeche einen eigenen
   * Satz, und ohne diese Lage waere er ungeprueft.
   *
   * DIE ZAHLEN SIND AUS akkuverlauf.ts ABGESCHRIEBEN, nicht erfunden:
   * RUHE_SCHWELLE 20 mA, `abschnitte` mit mindestens zwei Punkten je
   * Abschnitt, `ausduennen` auf 600. Eine Attrappe, die ihre Abschnitte
   * anders bildet als der Server, prueft eine Anzeige gegen Daten, die es an
   * keiner Box gibt.
   */
  if (p === '/api/mupihat/verlauf') {
    if (lage.hat === 'weg') return jsonAus(res, [])
    if (lage.akkuverlauf === 'fehlt') return jsonAus(res, { fehler: 'unbekannter Weg' }, 404)
    const stunden = Math.max(1, Math.min(168, Number(u.searchParams.get('stunden')) || 24))
    const jetzt = Date.now()
    const roh = akkuRoh(lage.akkuverlauf, stunden, jetzt)
    const flach = lage.akkuverlauf === 'flach'
    // ── OHNE KAPAZITAET GIBT ES KEINE RESTZEIT, UND DAS IST EIN EIGENER FALL
    // Er gehoert zu `flach` (die Box haengt am Netz und hat nie eine Entladung
    // gesehen) UND zu `duenn` (sie zeichnet seit zwei Minuten auf). Beide
    // Lagen sind an einer Box echt, und beide fuehren die Oberflaeche in den
    // Zweig „Wie lange noch, kann die Box nicht sagen". Ohne ihn stuende dort
    // eine Zahl, die aus einer Kapazitaet gerechnet waere, die niemand kennt.
    const ohneKapazitaet = flach || lage.akkuverlauf === 'duenn'
    const letzter = roh[roh.length - 1] || null
    const kapazitaet = ohneKapazitaet ? null : 8200
    return jsonAus(res, {
      punkte: akkuAusduennen(roh, 600),
      abschnitte: akkuAbschnitte(roh),
      jetzt: letzter,
      restMinuten: akkuHochrechnen(letzter, kapazitaet),
      kapazitaetMah: kapazitaet,
      kapazitaetAufkleber: ohneKapazitaet ? null : 10000,
      gelernt: ohneKapazitaet
        ? { rMilliOhm: null, rPaare: 0, kapazitaetMah: null, kapazitaetHub: 0, ladungMah: 0, stand: 'nichts' }
        : { rMilliOhm: 74, rPaare: 31, kapazitaetMah: 8200, kapazitaetHub: 62, ladungMah: 41200, stand: 'brauchbar' },
      stunden,
      gesamt: roh.length,
    })
  }

  if (p === '/api/mupihat') {
    if (lage.hat === 'weg') return jsonAus(res, [])
    const laedt = lage.hat === 'laedt'
    return jsonAus(res, {
      BatteryConnected: 1,
      Bat_SOC: `${lage.akku}%`,
      Bat_SOC_fein: lage.akku,
      Charger_Status: laedt ? 'Fast Charging' : 'Not Charging',
      Vbat: 3820,
      Ibat: laedt ? 900 : -420,
    })
  }

  if (p === '/api/data') return jsonAus(res, WERKE)
  // DIE DARSTELLUNG. Hier stand ein Platzhalter, der `{}` lieferte — und
  // `anwenden()` steigt bei fehlendem `aktuell` aus. Folge: ALLES, was an der
  // Darstellung haengt, war in der Vorschau nie eingeschaltet, und eine Probe
  // auf „Platz beim Blaettern" meldete „ruhig", weil die Sache gar nicht lief.
  // Eine Attrappe, die mit leerer Hand antwortet, prueft still das Nichts.
  // Ein VOLLSTAENDIGES Album — mit einem Titel MEHR als die Playlist zeigt.
  // Genau darum geht es beim Weg ueber den Interpreten: Die Playlist ist eine
  // Auswahl, das Album ist ganz. Eine Attrappe, die beide gleich gross macht,
  // koennte den Unterschied nicht vorfuehren.
  // DIE INTERPRETENSEITE — fertig zusammengestellt, so wie /api/interpret/<id>
  // sie liefert (interpretenseite.ts baut sie im Server, nicht die Seite).
  //
  // HIER STAND FRUEHER `/api/spotify/web/artists/<id>/albums` mit ZWEI Alben
  // ohne `release_date` und ohne `album_group`. Die Oberflaeche fragt diesen
  // Pfad nicht mehr; die Attrappe traegt ihn deshalb auch nicht mehr — ein
  // Endpunkt, den niemand ruft, macht nur glauben, es sei etwas geprueft.
  //
  // GENUG DATEN, und das ist der Punkt: 5 Alben und 15 Singles wie bei Alin
  // Coen an der echten Box (2026-08-02 gemessen). Mit zwei Eintraegen rollt
  // keine Reihe waagerecht, und die Wechselwirkung mit „Platz beim Blaettern"
  // traete gar nicht auf — genau die dritte Sorte Luege aus
  // [attrappe-luegt-durch-weglassen].
  const interpret = /^\/api\/interpret\/([^/]+)$/.exec(p)
  if (interpret) {
    const disko = u.searchParams.get('diskografie') === '1'
    const name = u.searchParams.get('name') || 'Kiddinx'
    const gesucht = kern(name)
    // „In deiner Box" kommt aus DENSELBEN Werken, die /api/werke liefert —
    // sonst zeigte die Vorschau eine Bibliothek, die es nicht gibt.
    const eigene = WERKE.map((w, i) => ({ w, i })).filter(
      ({ w, i }) => interpretTaugtVorschau(w, kennungFuer(w.dienst, i, w)) && kern(w.interpret) === gesucht,
    )
    const bild = (n) => (lage.cover ? `/api/bild/extern?u=${encodeURIComponent(`https://i.scdn.co/image/${n}`)}` : null)
    const reihen = []
    if (eigene.length) {
      reihen.push({
        id: 'box',
        titel: 'In deiner Box',
        eintraege: eigene.map(({ w, i }) => ({
          kennung: kennungFuer(w.dienst, i, w),
          titel: w.titel,
          bild: lage.cover ? `/api/bild/vorschau:${i}` : null,
          schluessel: `vorschau:${i}`,
        })),
      })
    }
    if (lage.top !== 'weg') {
      reihen.push({
        id: 'top',
        titel: 'Beliebteste Titel',
        eintraege: Array.from({ length: 10 }, (_, i) => ({
          kennung: `top${i}`,
          titel: `Beliebter Titel ${i + 1} mit einem langen Namen`,
          unter: `Album ${1 + (i % 5)}`,
          bild: bild(`top-${i}`),
          albumKennung: `album${1 + (i % 5)}vorschauABCDEFGHIJKL`.slice(0, 22),
          titelNr: (i % 12) + 1,
        })),
      })
    }
    if (disko) {
      reihen.push({
        id: 'alben',
        titel: 'Alben',
        eintraege: Array.from({ length: 5 }, (_, i) => ({
          kennung: `alb${i}vorschauABCDEFGHIJ`.slice(0, 22),
          titel: `Album ${5 - i} (nur Diskografie)`,
          unter: `${2021 - i * 2} · ${9 + i} Titel`,
          bild: bild(`alb-${i}`),
        })),
        // ABGESCHNITTEN — und zwar hier IMMER, denn genau das ist an der Box
        // der Normalfall: Spotify gibt je Abruf hoechstens 50 heraus, „Die
        // drei ???" fuehrt 308 Alben (2026-08-02 gemessen). Eine Attrappe, die
        // nur den bequemen Fall zeigt, liesse die Zahl „5 von 308" nie
        // erscheinen — dritte Sorte aus [attrappe-luegt-durch-weglassen].
        gesamt: 308,
      })
      reihen.push({
        id: 'singles',
        titel: 'Singles und EPs',
        eintraege: Array.from({ length: 15 }, (_, i) => ({
          kennung: `sin${i}vorschauABCDEFGHIJ`.slice(0, 22),
          titel: `Single ${15 - i}`,
          unter: `${2024 - i} · 1 Titel`,
          bild: bild(`sin-${i}`),
        })),
      })
      // SAMMLUNGEN (Spotifys „Compilations") — eigene Zusammenstellungen des
      // Interpreten, nicht `appears_on`. GEMESSEN an der Box (2026-08-02):
      // Rolf Zuckowski 44, Alin Coen 0. Die Vorschau zeigt sie, weil es sonst
      // wieder eine Reihe gaebe, die nur an der Box zu sehen ist.
      reihen.push({
        id: 'sammlungen',
        titel: 'Sammlungen',
        eintraege: Array.from({ length: 6 }, (_, i) => ({
          kennung: `sam${i}vorschauABCDEFGHIJ`.slice(0, 22),
          titel: `Sammlung ${6 - i}`,
          unter: `${2019 - i} · ${18 + i} Titel`,
          bild: bild(`sam-${i}`),
        })),
      })
    }
    return jsonAus(res, {
      kopf: {
        name,
        bild: bild(`artist-${interpret[1]}`),
        // Zwei Genres, wie der Server sie schneidet — nicht vier.
        genres: ['kinderhoerspiel', 'german pop'],
        // FOLLOWER, nicht „monatliche Hoerer": die Web-API kennt die gar nicht.
        follower: 54602,
      },
      reihen,
      // GEGENPROBE eingebaut: `/vorschau/top-weg` laesst die beliebtesten
      // Titel ausfallen. Ohne einen benannten Ausfall liesse sich nicht
      // zeigen, dass die Seite den Ausfall SAGT statt zu schweigen.
      ausfaelle: lage.top === 'weg' ? ['top'] : [],
    })
  }

  // ── DIE RUNDE INTERPRETEN-REIHE ───────────────────────────────────────────
  //
  // SIE MUSS HIER STEHEN, sonst prueft eine Messung wieder das Nichts
  // ([attrappe-luegt-durch-weglassen]). Seit 03.08.2026 holt NewDesign/app.js
  // die Reihe von `/api/interpreten` statt sie selbst zu bauen; ohne diesen
  // Zweig antwortete die Vorschau mit 404, die Seite liesse die alte (leere)
  // Reihe stehen — und wer hinsieht, haelt „keine runden Kacheln" fuer ein
  // Ergebnis der Oberflaeche statt fuer eine Luecke in dieser Datei.
  //
  // DER FALL, UM DEN ES GEHT, IST DER FREIGESCHALTETE OHNE EIGENE WERKE.
  // `/vorschau/frei-an` legt „Alin Coen" dazu — jemanden, von dem in WERKE
  // keine einzige Zeile steht. Nur an ihm zeigt sich, ob die Kachel auch ohne
  // Bibliothekseintrag steht und auf die Diskografie fuehrt.
  if (p === '/api/interpreten') {
    const zusammen = u.searchParams.get('verschmelzen') === '1'
    const nach = new Map()
    // `werke()` gibt `{stand, werke}` zurueck, KEINE Liste. Hier stand
    // `for (const w of werke(zusammen))` — und das warf beim ersten Abruf
    // „werke is not a function or its return value is not iterable" und riss
    // den ganzen Vorschauserver mit. Wer danach hinsah, fand eine Seite ohne
    // runde Kacheln und haette das fuer ein Ergebnis der Oberflaeche halten
    // koennen. Genau der Fehler, vor dem [attrappe-luegt-durch-weglassen]
    // warnt, nur lauter: die Attrappe log nicht durch Weglassen, sie starb.
    for (const w of werke(zusammen).werke || []) {
      if (!w.interpretSchluessel) continue
      if (!nach.has(w.interpretSchluessel)) {
        nach.set(w.interpretSchluessel, { schluessel: w.interpretSchluessel, name: w.interpret, werke: [] })
      }
      nach.get(w.interpretSchluessel).werke.push(w)
    }
    const reihe = []
    const versteckt = []
    for (const g of nach.values()) {
      const frei = ABLAGE.frei.find((f) => f.schluessel === g.schluessel)
      const eintrag = {
        schluessel: g.schluessel,
        name: g.name,
        // DIE ERKENNUNG IST DIESELBE LISTE wie unter /api/spotify/web/search
        // (ECHTE_INTERPRETEN). Zwei Listen liefen auseinander, und dann zeigte
        // die Vorschau eine Kachel, deren Tipp sie selbst abweist.
        id: frei ? frei.id : interpretKennung(g.name),
        bild: (frei && frei.bild ? bildDurchgereicht(frei.bild) : null) || g.werke.find((w) => w.bild)?.bild || null,
        anzahl: g.werke.length,
        werke: g.werke.map((w) => w.schluessel),
        herkunft: frei ? 'frei' : 'bibliothek',
      }
      // ABGELEHNT SCHLAEGT ALLES — dieselbe Rangfolge wie `interpretenReihe`
      // im Server (interpreten.ts). Wer sie hier anders herum baut, prueft die
      // Oberflaeche gegen eine Box, die es nicht gibt.
      if (ABLAGE.abgelehnt.some((a) => a.schluessel === g.schluessel)) {
        versteckt.push({ ...eintrag, grund: 'abgelehnt' })
      } else if (frei || eintrag.id) {
        reihe.push(eintrag)
      } else {
        versteckt.push({ ...eintrag, id: null, grund: 'nichtErkannt' })
      }
    }
    for (const f of ABLAGE.frei.filter((x) => !nach.has(x.schluessel))) {
      reihe.push({ ...f, bild: bildDurchgereicht(f.bild), anzahl: 0, werke: [], herkunft: 'frei' })
    }
    return jsonAus(res, { reihe, versteckt, frei: ABLAGE.frei, abgelehnt: ABLAGE.abgelehnt })
  }

  // Die Interpretensuche der VERWALTUNG. Sie steht hier, weil die
  // Verwaltungsoberflaeche sich im Entwicklungsbetrieb hierher weiterleiten
  // laesst — und weil eine Attrappe, die nur die halbe Schnittstelle kennt,
  // beim naechsten Umbau als „gibt es nicht" missverstanden wird.
  if (p === '/api/interpreten/suche') {
    const q = (u.searchParams.get('q') || '').trim()
    if (!q) return jsonAus(res, { error: 'sucheLeer' }, 400)
    const treffer = [...ECHTE_INTERPRETEN, 'Alin Coen', 'Rolf Zuckowski']
      .filter((n) => n.toLowerCase().includes(q.toLowerCase()))
      .map((n) => ({
        // JEDER SUCHTREFFER HAT EINE KENNUNG, siehe `interpretKennung`. Stand
        // hier die Erkennungskennung, bekam „Alin Coen" `null` — und
        // `suchtrefferAus` haette die Zeile im Server verworfen.
        id: kennungBauen(n),
        name: n,
        bild: lage.cover ? bildDurchgereicht(`https://i.scdn.co/image/${kern(n)}`) : null,
        bildRoh: `https://i.scdn.co/image/${kern(n)}`,
        genres: ['kinderlieder'],
        follower: 12345,
        urteil: ABLAGE.frei.some((f) => f.schluessel === kern(n))
          ? 'frei'
          : ABLAGE.abgelehnt.some((a) => a.schluessel === kern(n))
            ? 'abgelehnt'
            : 'offen',
      }))
    return jsonAus(res, { treffer })
  }

  if (req.method === 'POST' && p.startsWith('/api/interpreten/')) {
    let roh = ''
    for await (const stueck of req) roh += stueck
    console.log(`  ${p} <- ${roh}`)
    const b = roh ? JSON.parse(roh) : {}
    const name = String(b.name || '').trim()
    const s = kern(name)
    const was = p.slice('/api/interpreten/'.length)
    if (was === 'zuruecksetzen') {
      ABLAGE.frei = []
      ABLAGE.abgelehnt = []
    } else if (s) {
      ABLAGE.frei = ABLAGE.frei.filter((f) => f.schluessel !== s)
      ABLAGE.abgelehnt = ABLAGE.abgelehnt.filter((a) => a.schluessel !== s)
      if (was === 'frei') {
        ABLAGE.frei.unshift({ schluessel: s, id: String(b.id || ''), name, quelle: b.quelle || 'hand', bild: b.bild })
      } else if (was === 'abgelehnt') {
        ABLAGE.abgelehnt.unshift({ schluessel: s, name })
      }
    }
    return jsonAus(res, ABLAGE)
  }

  if (p === '/api/spotify/web/search') {
    const q = (u.searchParams.get('q') || '').trim()
    const treffer = ECHTE_INTERPRETEN.filter((n) => n.toLowerCase() === q.toLowerCase())
    return jsonAus(res, { artists: { items: treffer.map((n) => ({ name: n, id: interpretKennung(n) })) } })
  }

  if (/^\/api\/spotify\/album\/[^/]+$/.test(p)) {
    const kennung = p.split('/').pop()
    const n = 12
    return jsonAus(res, {
      id: kennung,
      name: 'Das Eischneerodelfest',
      total_tracks: n,
      images: [{ url: '/api/bild/vorschau:1' }],
      tracks: {
        total: n,
        items: Array.from({ length: n }, (_, i) => ({
          track_number: i + 1,
          name: i === 0 ? 'Intro (NUR im Album)' : `Kapitel ${i}: Das Eischneerodelfest`,
          // SPOTIFY NENNT DIE DAUER AN JEDEM TITEL, und das fehlte hier bis zum
          // 07.08.2026. Die Kinderzeit-Passung liest genau dieses Feld; ohne es
          // haette die Vorschau NUR den Fall „Laenge unbekannt" gekannt und
          // man haette den geprueft und fuer beide gehalten. Die Laengen sind
          // gestaffelt (4 bis 15 Minuten), damit bei einer Restzeit von ein
          // paar Minuten wirklich ein Teil passt und ein Teil nicht — eine
          // Liste, in der alles oder nichts passt, prueft die Grenze nicht.
          ...(DAUER.da ? { duration_ms: DAUER.null ? 0 : (240 + i * 60) * 1000 } : {}),
        })),
      },
    })
  }

  // ── Der Sprechweg ───────────────────────────────────────────────────────
  //
  // DIE FELDNAMEN SIND ABGELESEN, nicht erwartet: server.ts:5809-5816 liefert
  // `{ einstellungen, stimmen, bereit }`, und die Oberflaeche prueft BEIDES —
  // `bereit` false heisst „Piper fehlt", dann darf sie gar nicht erst warten.
  // Eine Attrappe, die nur `einstellungen` schickt, liesse die Seite still auf
  // 'aus' fallen, und man haette „spricht nicht" gemessen und fuer einen
  // Fehler der Seite gehalten.
  //   curl localhost:8299/vorschau/vorlesen-{aus|antippen|lernen}
  //   curl localhost:8299/vorschau/vorlesen-ohne-piper   # installiert? nein
  /* ══ DER SPIELBEREICH HAT SEIT DEM 20.09.2026 EINE EIGENE ROUTE ═══════
   *
   * Er stand einen Tag lang in der Antwort von `/api/vorlesen`. Betreiber:
   * „ich moechte den spiel bereich seperat einschalten koennen." Die
   * Attrappe zieht mit — eine Gegenstelle, die eine Route noch in der alten
   * Form fuehrt, macht jede Messung daran zur Aussage ueber eine Fassung,
   * die es nicht mehr gibt.
   */
  /* DIE KENNMARKE (20.09.2026) — UND SIE SAGT AUSDRUECKLICH, DASS SIE ES
   * NICHT IST.
   *
   * Erst stand hier `box: 'mixpibox'`, damit sich tools/box-finden.py daran
   * vorfuehren laesst. DAS WAR EIN FEHLER, und zwar genau der, gegen den
   * jenes Werkzeug gebaut wurde: Eine Vorschau auf Port 8200 haette sich als
   * Box ausgegeben, und der Finder haette `127.0.0.1` gemeldet — eine
   * Verwechslung, die im eigenen Haus entsteht statt im fremden Netz. Beim
   * ersten Lauf ist sie prompt im Zwischenspeicher gelandet.
   *
   * Die Attrappe traegt die Route weiter (die FORM gehoert nachgebildet),
   * nennt sich aber `mixpibox-vorschau`. Der Finder verlangt genau
   * `mixpibox` — damit ist sie fuer ihn, was sie ist: keine Box. */
  if (p === '/api/box') {
    return jsonAus(res, {
      box: 'mixpibox-vorschau',
      name: 'MixPiBox-Vorschau',
      quelle: 'http://git.local:3000/achim/box.git',
      commit: '0000000000000000000000000000000000000000',
      zweig: 'vorschau',
      gebautAm: '2026-09-20T00:00:00Z',
      adressen: ['127.0.0.1'],
    })
  }

  if (p === '/api/start') {
    if (req.method === 'PUT') {
      let roh = ''
      for await (const stueck of req) roh += stueck
      console.log(`  ${p} <- ${roh}`)
      let rumpf = {}
      try {
        rumpf = JSON.parse(roh || '{}')
      } catch {
        /* unlesbarer Koerper zaehlt als leerer */
      }
      lage.start = rumpf.modus === 'letztes' ? 'letztes' : 'fragen'
      return jsonAus(res, { modus: lage.start })
    }
    return jsonAus(res, { modus: lage.start === 'letztes' ? 'letztes' : 'fragen' })
  }

  /* EIN SCHLOSS PRUEFEN, OHNE ZU WECHSELN — die Gegenstelle zu
   * `POST /api/profil/anmelden` (20.09.2026). Sie bildet die drei Antworten
   * nach, an denen die Oberflaeche ihr Verhalten festmacht: kein Schloss
   * (200, geschuetzt:false), Passwort fehlt (401), Passwort falsch (403).
   * Ohne die Unterscheidung von 401 und 403 liesse sich „noch einmal, das
   * war nicht richtig" nicht vorfuehren. */
  if (req.method === 'POST' && p === '/api/profil/anmelden') {
    let roh = ''
    for await (const stueck of req) roh += stueck
    console.log(`  ${p} <- ${roh}`)
    let rumpf = {}
    try {
      rumpf = JSON.parse(roh || '{}')
    } catch {
      /* unlesbarer Koerper zaehlt als leerer */
    }
    const kennung = String(rumpf.kennung || '')
    const stand = profilStand()
    const ziel = stand.profile.find((x) => x.kennung === kennung)
    if (!ziel) return jsonAus(res, { error: 'unbekanntesProfil', kennung }, 400)
    const s = kennung === 'gast' ? undefined : PASSWOERTER.get(kennung)
    if (!s) return jsonAus(res, { ok: true, geschuetzt: false })
    const eingabe = typeof rumpf.passwort === 'string' ? rumpf.passwort : ''
    if (!eingabe) return jsonAus(res, { error: 'passwortNoetig', art: s.art }, 401)
    if (eingabe !== s.kanon) return jsonAus(res, { error: 'passwortFalsch', art: s.art }, 403)
    return jsonAus(res, { ok: true, geschuetzt: true })
  }

  /* ══ DIE BELOHNUNGS-VIDEOS (20.09.2026) ═══════════════════════════════
   *
   * DREI WEGE, und die Attrappe haelt dieselbe ENTSCHEIDUNGSLAGE wie der
   * echte Server — nicht nur dieselbe Form:
   *
   *   /api/video/kind      nur, was noch Rest hat
   *   /api/video/start     403 mit Grund, wenn nichts uebrig ist; sonst eine
   *                        Laufkennung und eine Adresse
   *   /api/video/gesehen   zaehlt erst ab 90 % und je Lauf nur einmal
   *
   * DIE ADRESSE ZEIGT AUF EIN WINZIGES MP4 IN DER VORSCHAU SELBST. Ein Ruf
   * an die echte ARD waere in einer Browser-Messung ein Netzweg nach
   * draussen — langsam, von der Tagesform der Mediathek abhaengig und in
   * einem Testlauf ohne Internet rot.
   *
   * Umschalten:  curl localhost:<port>/vorschau/videos-{voll|leer|aufgebraucht|stueck|stueck-hinten}
   *               `stueck` ist EINE Sekunde des zwei Sekunden langen
   *               Probevideos — der Schirm muss dort anhalten.
   */
  if (p === '/api/video/kind') {
    return jsonAus(res, { profil: 'gast', videos: videoListe().filter((v) => v.rest > 0) })
  }

  if (p === '/api/video/start' && req.method === 'POST') {
    let roh = ''
    for await (const stueck of req) roh += stueck
    console.log(`  POST /api/video/start <- ${roh}`)
    let rumpf = {}
    try {
      rumpf = JSON.parse(roh || '{}')
    } catch {
      /* unlesbarer Koerper zaehlt als leerer */
    }
    // UEBER DIE id, mit der Videokennung als Rueckfall — dieselbe Regel wie
    // `videoZeileAus` im echten Server.
    const zeile = String(rumpf.id || rumpf.kennung || '')
    const v = videoListe().find((x) => x.id === zeile)
    if (!v) return jsonAus(res, { videofreigabe: true, erlaubt: false, grund: 'unbekannt', rest: 0 }, 403)
    if (v.rest <= 0) return jsonAus(res, { videofreigabe: true, erlaubt: false, grund: 'aufgebraucht', rest: 0 }, 403)
    lage.videoLauf = `lauf-${Date.now()}`
    return jsonAus(res, {
      profil: 'gast',
      id: v.id,
      kennung: v.kennung,
      lauf: lage.videoLauf,
      adresse: '/vorschau/probe.mp4',
      name: v.name,
      dauerSek: v.dauerSek,
      abSek: v.abSek,
      bisSek: v.bisSek,
      teil: v.teil,
      laengeSek: v.laengeSek,
      rest: v.rest,
    })
  }

  if (p === '/api/video/gesehen' && req.method === 'POST') {
    let roh = ''
    for await (const stueck of req) roh += stueck
    console.log(`  POST /api/video/gesehen <- ${roh}`)
    let rumpf = {}
    try {
      rumpf = JSON.parse(roh || '{}')
    } catch {
      /* unlesbarer Koerper zaehlt als leerer */
    }
    const zeile2 = String(rumpf.id || rumpf.kennung || '')
    const v = videoListe().find((x) => x.id === zeile2)
    if (!v) return jsonAus(res, { grund: 'unbekannt', rest: 0 })
    const lauf = String(rumpf.lauf || '')
    if (lauf && v.laufVerbraucht === lauf) return jsonAus(res, { grund: 'schonGezaehlt', rest: v.rest })
    // NUR EIN STUECK RECHNET UEBER SEKUNDEN — genau wie `anteilAus` im Kern,
    // und aus demselben Grund: bei einem Stueck gehoert die Laenge dem
    // Server, bei einem ganzen Video der Datei (`dauerSek` aus der Suche
    // kann falsch sein). Wer das hier anders macht, macht die Attrappe zu
    // einer zweiten Wahrheit, und die Wache misst dann sie statt der Box.
    const sek = Number(rumpf.sekunden)
    const ausSekunden =
      Number.isFinite(sek) && sek >= 0 && v.laengeSek > 0 ? Math.min(1, sek / v.laengeSek) : Number.NaN
    const stueckhaft = v.abSek > 0 || v.bisSek > 0
    const anteil = stueckhaft && Number.isFinite(ausSekunden) ? ausSekunden : Number(rumpf.anteil)
    if (!(anteil >= 0.9)) return jsonAus(res, { grund: 'zuWenigGesehen', rest: v.rest })
    if (v.rest <= 0) return jsonAus(res, { grund: 'aufgebraucht', rest: 0 })
    v.verbraucht += 1
    v.rest -= 1
    v.laufVerbraucht = lauf
    return jsonAus(res, { grund: 'gezaehlt', rest: v.rest })
  }

  if (p === '/api/spiele') {
    if (req.method === 'PUT') {
      let roh = ''
      for await (const stueck of req) roh += stueck
      console.log(`  ${p} <- ${roh}`)
      let rumpf = {}
      try {
        rumpf = JSON.parse(roh || '{}')
      } catch {
        /* wie ueberall hier: unlesbarer Koerper zaehlt als leerer */
      }
      lage.spiele = rumpf.an === false ? 'aus' : 'an'
      lage.spielstimme = rumpf.vorlesen === true ? 'an' : 'aus'
      // NUR DER FALL „GENAU EINES AN" wird gemerkt — mehr braucht die Lage
      // nicht, und eine Attrappe, die eine ganze Tabelle fuehrt, taeuscht
      // eine Genauigkeit vor, die ihr niemand nachprueft.
      const wahl = (rumpf.spiele && typeof rumpf.spiele === 'object' && rumpf.spiele) || {}
      const an = SPIEL_WERKE_VORSCHAU.filter((w) => wahl[w.id] !== false)
      lage.nurSpiel = an.length === 1 ? an[0].id : ''
      // Und fuer die Schublade der Gegenfall: gemerkt wird die EINE, die
      // fehlt — mehr braucht die Lage nicht.
      const appWahl = (rumpf.apps && typeof rumpf.apps === 'object' && rumpf.apps) || {}
      const appAus = APP_WERKE_VORSCHAU.filter((w) => appWahl[w.id] === false)
      lage.appAus = appAus.length === APP_WERKE_VORSCHAU.length ? 'alle' : (appAus[0]?.id ?? '')
      return jsonAus(res, spieleAntwort())
    }
    return jsonAus(res, spieleAntwort())
  }

  if (p === '/api/vorlesen') {
    const modus = ['antippen', 'lernen'].includes(lage.vorlesen) ? lage.vorlesen : 'aus'
    return jsonAus(res, {
      einstellungen: { modus, stimme: 'de_DE-ramona-low', interpret: true, tempo: 2 },
      stimmen: [{ id: 'de_DE-ramona-low', sprache: 'de_DE', spracheName: 'Deutsch', name: 'Ramona', guete: 'einfach' }],
      bereit: lage.vorlesen !== 'ohne-piper',
    })
  }

  if (p === '/api/vorlesen/sprich') {
    const text = u.searchParams.get('text') || ''
    const abspielen = u.searchParams.get('abspielen') === '1'
    SPRECHPROTOKOLL.push({ t: Date.now(), text, silben: u.searchParams.get('silben') === '1', abspielen })
    // E123: `abspielen=1` — die echte Box spielt selbst und antwortet nur
    // mit der Dauer. Die Attrappe spielt natuerlich nichts; sie antwortet in
    // derselben FORM, damit die Oberflaeche denselben Weg geht wie am
    // Geraet. Eine kurze Dauer, damit keine Messung vier Sekunden wartet.
    if (abspielen) return jsonAus(res, { ok: true, dauerMs: 120 })
    // EINE ECHTE, ABSPIELBARE WAV-DATEI — kurz und still.
    //
    // Warum nicht einfach 200 mit leerem Rumpf: Die Oberflaeche haengt am
    // `ended`-Ereignis eines <audio>. Kommt es nie, loest erst der Zaun nach
    // 4 s aus, und JEDE Messung dauerte vier Sekunden — sie waere gruen, aber
    // sie beschriebe den Fehlerfall. Das ist genau die Sorte Attrappe, die in
    // die falsche Richtung luegt.
    return wavAus(res, 0.12)
  }

  if (p === '/api/vorlesen/silben') {
    const text = u.searchParams.get('text') || ''
    return jsonAus(res, { text, silben: grobTrennen(text) })
  }

  if (req.method === 'POST' && p === '/api/ton/daempfen') {
    let roh = ''
    for await (const stueck of req) roh += stueck
    const an = !!(roh ? JSON.parse(roh) : {}).an
    DAEMPFUNG.push({ t: Date.now(), an })
    console.log(`  Daempfung ${an ? 'AN' : 'aus'}`)
    return jsonAus(res, { status: 'ok' })
  }

  // ══ DIE DARSTELLUNG — LESEN UND SEIT 06.08.2026 AUCH SCHREIBEN ═══════
  //
  // DIE FELDER SIND VON EINER ECHTEN BOX ABGELESEN, nicht ausgedacht.
  //
  // Beim ersten Versuch stand hier nur `platzBeimBlaettern`. Folge:
  // `anwenden()` lief zwar, setzte aber fuer alles Uebrige seine
  // Ausweichwerte — und die Kacheln wurden RUND, weil `kachelForm` weder
  // 'eckig' noch 'abgerundet' war. Eine Vorschau, die anders aussieht als
  // das Geraet, fuehrt beim Beurteilen in die Irre.
  //
  // ── ES SCHREIBT WIRKLICH, UND ES SCHREIBT `aktuell` GANZ ──────────────
  // Genau wie die Box (server.ts, PUT /api/darstellung): `aktuell` wird
  // ERSETZT, nicht zusammengefuegt. Das ist die Falle, um die es geht — wer
  // in der Oberflaeche nur das eine geaenderte Feld schickte, loeschte alles
  // andere. Eine Attrappe, die freundlich zusammenfuegt, haette genau diesen
  // Fehler zugedeckt und ihn erst an der Box sichtbar werden lassen.
  // `themen` wird wie am Server ergaenzt und nicht ersetzt.
  if (p === '/api/darstellung' && req.method === 'PUT') {
    let roh = ''
    for await (const stueck of req) roh += stueck
    let koerper = null
    try {
      koerper = JSON.parse(roh || '{}')
    } catch {
      koerper = null
    }
    const a = koerper && koerper.aktuell && typeof koerper.aktuell === 'object' ? koerper.aktuell : null
    if (!a) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
      return res.end(JSON.stringify({ ok: false, error: 'kein aktuell' }))
    }
    // WIE VIELE FELDER ANKOMMEN, STEHT AUF DER KONSOLE. Das ist die Zahl, an
    // der man sieht, ob die Oberflaeche den ganzen Stand zusammengefuegt hat
    // oder nur ihr eines Feld schickt — der teure Fehler dieses Weges.
    console.log(`  PUT /api/darstellung <- ${Object.keys(a).length} Felder, ${Object.keys(DARSTELLUNG.themen).length} Themen`)
    DARSTELLUNG.aktuell = a
    DARSTELLUNG.geschrieben = true
    if (koerper.themen && typeof koerper.themen === 'object')
      DARSTELLUNG.themen = { ...koerper.themen, ...DARSTELLUNG.themen }
    return jsonAus(res, { ok: true })
  }

  if (p === '/api/darstellung') {
    // DIE LAGE-SCHALTER GEWINNEN NUR, SOLANGE NIEMAND GESCHRIEBEN HAT. Danach
    // gilt der geschriebene Stand — sonst spraenge ein eben umgelegter
    // Schalter beim naechsten Abgleich zurueck, und das saehe genauso aus wie
    // „die Oberflaeche schreibt nicht".
    if (!DARSTELLUNG.geschrieben) {
      DARSTELLUNG.aktuell = {
        ...DARSTELLUNG.aktuell,
        platzBeimBlaettern: lage.platz !== 'aus',
        diskografie: lage.disko === 'an',
        // SECHSTE Sorte derselben Luege: Ohne dieses Feld faellt
        // `pruefen()` in darstellung.service.ts auf den STANDARD zurueck,
        // und der ist false — die Marke BEWEGT sich. Die Vorschau koennte
        // den Schalter also nie im Zustand „stillgestellt" zeigen: man
        // haette gemessen, dass sich etwas bewegt, und das fuer den Beweis
        // gehalten, dass der Schalter wirkt. Umschalten: /vorschau/marke-ruhig
        ruhigeMarke: lage.marke === 'ruhig',
        // OHNE DIESES FELD FRAGT DIE OBERFLAECHE NIE MIT `verschmelzen=1`.
        // `pruefen()` in darstellung.service.ts faellt bei einem fehlenden Feld
        // auf den STANDARD zurueck, und der ist AUS — die Vorschau haette also
        // das Verschmelzen nie gezeigt, egal was in der Liste steht. Fuenfte
        // Sorte [attrappe-luegt-durch-weglassen].
        verschmelzen: lage.verschmolzen === 'an',
      }
    }
    return jsonAus(res, { aktuell: DARSTELLUNG.aktuell, themen: DARSTELLUNG.themen })
  }
  if (p === '/api/oberflaeche/stand') return jsonAus(res, { oberflaeche: 'neu' })
  if (p === '/player/local') return jsonAus(res, lokal())
  if (p === '/player/state') return jsonAus(res, dienst())

  // DER FALL, um den es hier geht: kein Cover -> 404, damit die Kachel ihren
  // Buchstaben zeigt. So verhaelt sich die Box, wenn nie eines hinterlegt war.
  if (p.startsWith('/api/bild/')) {
    if (!lage.cover) {
      res.statusCode = 404
      res.end()
      return
    }
    res.statusCode = 302
    res.setHeader('Location', '/neu/bilder/mixpi-kein-bild.png')
    res.end()
    return
  }

  // Die Konfiguration — die Oberflaeche liest daraus `mupibox.maxVolume` (um
  // den Lauter-Knopf am Anschlag abzublenden) und seit 2026-08-02 auch
  // `mupibox.host` fuer den Kopftitel. Der Lautstaerkewert ist hier
  // absichtlich NIEDRIG (60): Bei 100 laesst sich der Anschlag gar nicht
  // vorfuehren, und genau er ist der Teil, der ein Kind schuetzt.
  // Die Alben einer Playlist — erfunden, aber in der Form des Servers:
  // Album mit `stuecke`, dazu lose Titel. Zwei Alben und drei lose genuegen,
  // um beide Lanes und den Hinweis zu sehen.
  if (/^\/api\/werke\/[^/]+\/alben$/.test(p)) {
    if (lage.alben === 'leer') return jsonAus(res, { alben: [], lose: [], vollstaendig: true })
    // DIE GEMERKTE STELLE DES WERKS, aus derselben Liste wie /api/weiterhoeren.
    // Ohne sie liefert diese Antwort nie ein `weiterAb`, in der Vorschau
    // erschiene nie ein blauer Knopf — und das saehe aus wie ein Ergebnis.
    const stelle = weiterStelleFuer(decodeURIComponent(p.split('/')[3] || ''))
    /** Wie im Server: Treffer auf GENAU diesem Titel und mitten im Titel. */
    const abTitel = (versatz) => (stelle && stelle.titelNr === versatz + 1 && stelle.positionMs > 0 ? stelle : null)
    /** Wie im Server: Treffer irgendwo im Album — der Anfang bei 0 ms zaehlt nicht. */
    const abAlbum = (versaetze) => {
      if (!stelle) return null
      const ziel = stelle.titelNr - 1
      if (!versaetze.includes(ziel)) return null
      if (ziel === Math.min(...versaetze) && stelle.positionMs <= 0) return null
      return stelle
    }
    const album = (n, kennung, ab, anzahl) => {
      const stuecke = Array.from({ length: anzahl }, (_, i) => ({
        nr: i + 1,
        titel: `Kapitel ${i + 1}: ${n}`,
        versatz: ab + i,
        // DIE STUECK-KENNUNG FEHLTE HIER, und damit war der DAUERHAFTE
        // Laufend-Punkt in der Lane nicht zu sehen: Die Oberflaeche erkennt
        // den laufenden Titel an `item.uri` aus /player/state. Ohne dieses
        // Feld traf nie eine Kachel zu.
        uri: `spotify:track:${kennung}-${ab + i}`,
        weiterAb: abTitel(ab + i),
      }))
      return {
        kennung,
        titel: n,
        interpret: 'Vorschau',
        bild: `/api/bild/vorschau:1`,
        anzahl,
        ersterVersatz: ab,
        stuecke,
        weiterAb: abAlbum(stuecke.map((s) => s.versatz)),
      }
    }
    // SECHS Alben, nicht zwei: Erst dann rollt die Album-Reihe waagerecht, und
    // erst dann laesst sich das Durchklicken so pruefen, wie es am Geraet
    // passiert. Mit zwei Kacheln passt alles ins Bild und die haelfte der
    // Wechselwirkungen tritt gar nicht auf.
    const namen = [
      'Das Eischneerodelfest',
      'Der Wurzelwicht',
      'Marshmallowbeeren',
      'Kekszellent',
      'Wuchtiger Wachomat',
      'Die Buntbisonbahn',
    ]
    let ab = 0
    const viele = namen.map((n, i) => {
      const a = album(n, `alb${i}`, ab, 10 + (i % 3))
      ab += 10 + (i % 3)
      return a
    })
    return jsonAus(res, {
      alben: viele,
      // JEDER LOSE TITEL BRINGT SEIN EIGENES BILD MIT — hier stand bis zum
      // 03.08.2026 `bild: null`, und das war wieder ein Weglassen mit Folgen:
      // Die Kachel „Einzelne Titel" nimmt das Bild des ersten losen Titels,
      // und in der Titel-Lane traegt jeder seines. Beides ist gegen `null`
      // nicht zu messen. Auf der Box haben sie eines (nachgesehen an der
      // Playlist „EMMA6 - Complete", 03.08.2026): es sind Singles, jede mit
      // eigenem Cover — anders als die Stuecke eines Albums, die gar kein
      // `bild` mitbringen und sich das des Albums teilen.
      lose: [
        {
          nr: 1,
          titel: 'Introsong',
          versatz: 23,
          uri: 'spotify:track:lose-23',
          bild: '/api/bild/vorschau:4',
          weiterAb: abTitel(23),
        },
        {
          nr: 2,
          titel: 'Ein einzelner Titel',
          versatz: 24,
          uri: 'spotify:track:lose-24',
          bild: '/api/bild/vorschau:5',
          weiterAb: abTitel(24),
        },
      ],
      vollstaendig: lage.alben !== 'angeschnitten',
    })
  }

  if (p === '/api/profile') {
    // DIESER ZWEIG MUSS DA SEIN, und er antwortet absichtlich NICHT mit dem
    // Gast. Diese Attrappe hat schon zweimal durch WEGLASSEN getaeuscht (bei
    // `host` und bei `quellen[].dienst`): fehlt ein Endpunkt, faellt die
    // Oberflaeche auf ihren Rueckfall zurueck — hier waere das genau `gast`,
    // und man saehe „mupibox_p_gast_…" im Speicher und hielte den Namensraum
    // fuer bewiesen, ohne dass je eine Kennung angekommen waere.
    // Mit `liam` steht im localStorage `mupibox_p_liam_neu_zuletzt_v1`, sobald
    // etwas gestartet wurde — und nur dann hat es wirklich funktioniert.
    // `/vorschau/profil-gast` schaltet auf den Normalfall zurueck.
    //
    // `profil-allein` IST DER HEUTIGE STAND DER BOX und deshalb kein Randfall:
    // dort steht nur `gast`, und die Auswahl zeigt dann KEINE Profilreihe. Wer
    // nur den Zwei-Kinder-Fall ansieht, prueft eine Oberflaeche, die es an der
    // Box noch gar nicht gibt.
    //
    // GEFILTERT WIE AN DER BOX: Eine Figur, zu der es keine Datei gibt, wird
    // hier NICHT genannt (`profilStandGefiltert`, dort steht die Begruendung).
    // Wer die Silhouette sehen will, stellt `/vorschau/figuren-fehlt` — dann
    // NENNT der Figurenordner die Namen, aber die Dateien liegen nicht da.
    // Das ist die Lage, die es an der Box wirklich geben kann.
    return jsonAus(res, profilStandGefiltert())
  }

  // ── DIE AUSWAHL EINES KINDES ───────────────────────────────────────────
  // Die Regeln sind abgeschrieben und nicht neu erfunden (server.ts, die zwei
  // Routen unter `/api/profil/auswahl`). Eine Attrappe, die grosszuegiger
  // waere als der Server, liesse die Oberflaeche gegen Regeln pruefen, die es
  // nicht gibt — beim Gast waere das der Fall, der am meisten kostet.
  if (p === '/api/profil/auswahl' && (req.method === 'GET' || req.method === 'PUT')) {
    const stand = profilStand()
    let kennung = u.searchParams.get('profil') || ''
    let werke = null
    if (req.method === 'PUT') {
      let roh = ''
      for await (const stueck of req) roh += stueck
      let rumpf = {}
      try {
        rumpf = JSON.parse(roh || '{}')
      } catch {
        /* eine kaputte Meldung darf die Vorschau nicht anhalten */
      }
      if (typeof rumpf.profil === 'string' && rumpf.profil) kennung = rumpf.profil
      const liste = Array.isArray(rumpf) ? rumpf : Array.isArray(rumpf.werke) ? rumpf.werke : []
      werke = [...new Set(liste.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim()))]
    }
    if (!kennung) kennung = stand.aktiv
    if (!stand.profile.some((x) => x.kennung === kennung)) return jsonAus(res, { error: 'profilUnbekannt' }, 400)
    if (kennung === 'gast') {
      // DER GAST BEKOMMT NIE EINE — beim LESEN ist das kein Fehler (er sieht
      // alles), beim SCHREIBEN schon. Genau so trennt es der Server.
      if (req.method === 'GET') return jsonAus(res, { profil: kennung, gast: true, alle: true, werke: [] })
      return jsonAus(res, { error: 'gastOhneAuswahl' }, 400)
    }
    if (werke) {
      if (werke.length) AUSWAHL.set(kennung, werke)
      else AUSWAHL.delete(kennung)
      console.log(`  Auswahl ${kennung} <- ${werke.length} Schluessel`)
    }
    const jetzt = auswahlVon(kennung)
    return jsonAus(res, { profil: kennung, gast: false, alle: jetzt.length === 0, werke: jetzt })
  }

  // ── DIE FIGUREN ────────────────────────────────────────────────────────
  //
  // GEFUNDEN, NICHT AUFGEZAEHLT: auf der Box liest `GET /api/figuren` den
  // Ordner `bilder/figuren/`. Hier wird das nachgestellt — mit dem
  // Unterschied, dass `ordner` im Fall `da` auf `bilder` zeigt, wo wirklich
  // zehn PNG liegen. Nur so sieht man im Browser echte Bilder, ohne dass
  // jemand vorher `tools/maskottchen-bauen.py --figuren` laufen laesst.
  //
  // `uebergangen` GEHOERT MIT IN DIE ATTRAPPE. Das Feld nennt Dateien, die im
  // Ordner liegen und durchfallen (`Brille.PNG`, `foto.jpg`) — weglassen
  // hiesse, den Fall nie zu sehen, in dem der Betreiber sein Bild sucht.
  // DIESELBE QUELLE WIE DIE WANDERUNG in `GET /api/profile` — `figurenLage()`.
  // Zwei Listen, die dasselbe meinen, waeren genau der Fehler, den diese
  // Attrappe bei `profilStand()` schon einmal vermieden hat.
  if (p === '/api/figuren') return jsonAus(res, figurenLage())

  // ══ DIE DIENSTE ═══════════════════════════════════════════════════════
  //
  // Die Namen und Titel sind von der Box .169 abgelesen (`curl /api/dienste`,
  // 06.08.2026), nicht ausgedacht — das Info-Kaestchen benennt den ERSTEN
  // stehenden Dienst, und ein erfundener Name haette dort gestanden, ohne dass
  // es auffaellt. `/vorschau/dienst-steht` legt einen still: der Fall, in dem
  // das Kaestchen warnt, ist sonst nicht vorzufuehren.
  if (p === '/api/dienste') {
    // ── DIE HAELFTE DIESER BOX IST ABGESCHALTET, UND DAS IST NORMAL ─────
    // GEMESSEN an .169: von 33 Diensten laufen 13. Die uebrigen 20 sind
    // ABSICHTLICH aus (Lüfter, VNC, Telegram, MQTT, DietPi-Übersicht), und
    // vier weitere sind eingeschaltet und trotzdem `inactive`, weil sie
    // EINMAL laufen und fertig sind. Eine Attrappe, in der alles laeuft,
    // haette den teuersten Fehler dieses Kaestchens zugedeckt: „nicht aktiv"
    // als Problem zu lesen und auf einer heilen Box dauerhaft rot zu stehen.
    const alle = [
      ['bluetooth.service', 'Bluetooth', 'an'],
      ['mupibox-server.service', 'MuPiBox Backend (server.js)', 'an'],
      ['mupibox-player.service', 'MuPiBox Player (spotify-control.js)', 'an'],
      ['mupi_hat.service', 'MuPiHAT (Akku, Lüfter)', 'an'],
      ['librespot.service', 'Spotify-Wiedergabe', 'an'],
      ['mupi_check_internet.service', 'Internet-Prüfung', 'an'],
      // absichtlich abgeschaltet — darf NIE warnen
      ['fan.service', 'Lüfter', 'aus'],
      ['telegram.service', 'Telegram-Nachrichten', 'aus'],
      ['novnc.service', 'Bildschirm im Browser (noVNC)', 'aus'],
      // eingeschaltet, einmal gelaufen, fertig — darf ebenso wenig warnen
      ['mupi_wlan_rueckroll.service', 'MuPiBox: WLAN-Aenderung zuruecksetzen', 'durch'],
    ]
    return jsonAus(res, {
      dienste: alle.map(([name, titel, art], i) => {
        // `dienste-steht` legt den ERSTEN wirklich still — mit `failed`, dem
        // einzigen Wort, das die Oberflaeche als Stoerung liest.
        const gestoert = lage.dienste === 'steht' && i === 0
        const aktiv = art === 'an' && !gestoert
        return {
          name,
          titel,
          beschreibung: titel,
          aktiv,
          eingeschaltet: art !== 'aus',
          zustand: gestoert ? 'failed' : aktiv ? 'active' : 'inactive',
          abschnitt: 'normal',
        }
      }),
    })
  }

  // ══ DIE MUSIKDIENSTE — EINGERICHTET UND ERREICHBAR SIND ZWEI FRAGEN ═══
  //
  // DIE FORM IST VON DER BOX .169 ABGESCHRIEBEN (`curl :8200/api/musikdienste`,
  // 06.08.2026) und nicht ausgedacht:
  //     {"spotify":{"eingerichtet":true,"erreichbar":true},
  //      "jellyfin":{"eingerichtet":true,"erreichbar":true,
  //                  "server":"http://192.168.178.199:8899"}}
  // Ein erfundener Feldname haette die Unterzeile still auf „nicht
  // eingerichtet" fallen lassen, und das saehe aus wie eine Auskunft.
  if (p === '/api/musikdienste') {
    const l = lage.musikdienste
    const leer = l === 'leer'
    // ── „EINGERICHTET" KOMMT AUS `ZUGANG` UND NICHT AUS DER LAGE ───────
    // Seit dem 06.08.2026 kann man den Jellyfin-Server AN DER BOX loeschen
    // (Medien → Dienste → Jellyfin). Bliebe diese Zeile eine Festlegung, sagte
    // die Probe danach weiter „eingerichtet und erreichbar" — die Vorschau
    // widerspraeche der Seite, die zwei Zeilen darueber „nicht eingetragen"
    // schreibt, und man saehe der Oberflaeche nicht an, welche von beiden
    // luegt. DIE FORM IST WEITER DIE DER BOX (`spEingerichtet` prueft dort
    // ausdruecklich NUR die clientId, nicht das Erneuerungsmerkmal —
    // server.ts).
    const jfServer = leer ? '' : ZUGANG.jellyfinServer
    const spDa = !leer && ZUGANG.spotifyClientId !== ''
    return jsonAus(res, {
      spotify: { eingerichtet: spDa, erreichbar: spDa && l !== 'spotify-weg' },
      jellyfin: {
        eingerichtet: jfServer !== '',
        erreichbar: jfServer !== '' && l !== 'jellyfin-weg',
        server: jfServer,
      },
    })
  }

  /* ══ DER SPOTIFY-ZUGANG — LESEN GIBT EIN BOOLEAN, SONST NICHTS ══════════
   *
   * DIE FORM IST DIE DER BOX .169 (`curl :8200/api/spotify/config`,
   * 06.08.2026): `{"deviceName":"MixPiBox","eingerichtet":true}`. Kein
   * `clientId`, kein `refreshToken` — seit BACKLOG E15 mit Absicht, und der
   * Kommentar am Server sagt warum: „Ein BOOLEAN, kein gekuerzter Wert. „Die
   * ersten sechs Zeichen" waere hilfreich beim Suchen und zugleich der Anfang
   * eines Geheimnisses."
   *
   * `eingerichtet` IST EIN UND AUS BEIDEN Werten und nicht dasselbe wie das
   * `eingerichtet` von `/api/musikdienste` (dort reicht die clientId). Genau
   * diesen Unterschied zeigt die Einrichtungsseite an, und ohne ihn hier waere
   * er nicht messbar.
   */
  if (p === '/api/spotify/config') {
    return jsonAus(res, {
      deviceName: 'MixPiBox',
      eingerichtet: ZUGANG.spotifyClientId !== '' && ZUGANG.spotifyRefreshToken !== '',
    })
  }

  /* Das Erneuerungsmerkmal setzen — BEIDE Werte, sonst 400 mit TEXT.
   *
   * WORTGLEICH ZUR BOX, und das ist der Punkt: `res.status(400).send('clientId
   * and refreshToken required')` ist eine TEXT-Antwort, kein JSON. Eine
   * Attrappe, die hier `{ok:false}` schickte, verdeckte den Fehler, den die
   * Oberflaeche machen kann — auf eine JSON-Antwort zu warten, die nie kommt,
   * und dann jeden Eingabefehler als „Die Box antwortet nicht" auszugeben.
   */
  if (req.method === 'POST' && p === '/api/spotify/config') {
    let roh = ''
    for await (const stueck of req) roh += stueck
    let b = {}
    try {
      b = JSON.parse(roh || '{}') || {}
    } catch {
      b = {}
    }
    const clientId = typeof b.clientId === 'string' ? b.clientId.trim() : ''
    const merkmal = typeof b.refreshToken === 'string' ? b.refreshToken.trim() : ''
    if (!clientId || !merkmal) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
      return res.end('clientId and refreshToken required')
    }
    // WIEDER OHNE WERTE AUF DER KONSOLE — nur die Laengen. Ein
    // Erneuerungsmerkmal im Vorschau-Protokoll waere ein Dauerzugang in einer
    // Datei, die niemand als Geheimnisspeicher fuehrt.
    console.log(`  Spotify-Zugang gesetzt (ID ${clientId.length} Zeichen, Merkmal ${merkmal.length} Zeichen)`)
    ZUGANG.spotifyClientId = clientId
    ZUGANG.spotifyRefreshToken = merkmal
    return jsonAus(res, { ok: true })
  }

  // `/api/spotify/bereit` — und der Fall, um dessentwillen es ihn gibt:
  // „nicht pruefbar" ist KEINE Ablehnung (server.ts). Ohne diesen Zweig laesst
  // sich nicht messen, ob die Oberflaeche den Unterschied auch hinschreibt.
  if (p === '/api/spotify/bereit') {
    if (lage.musikdienste === 'unpruefbar')
      return jsonAus(res, { bereit: true, grund: 'nicht-pruefbar', status: 429, name: 'MixPiBox' })
    if (lage.musikdienste === 'leer') return jsonAus(res, { bereit: false, grund: 'kein-zugang', name: '' })
    return jsonAus(res, { bereit: true, name: 'MixPiBox', geraete: 1 })
  }

  // ══ NEU LADEN, NEU STARTEN, AUSSCHALTEN ═══════════════════════════════
  //
  // ES WIRD NICHTS NEU GESTARTET UND NICHTS AUSGESCHALTET. Die Vorschau
  // ZAEHLT nur mit, wer gerufen hat — genau das ist die Aussage, die ein
  // Werkzeug braucht: geht bei EINEM Tipp auf „Ja, ausschalten" GENAU EIN
  // Aufruf hinaus, und geht bei „Abbrechen" KEINER?
  //
  // UND SIE ANTWORTEN MIT TEXT, NICHT MIT JSON — wortgleich zur Box
  // (server.ts: `res.status(200).send('ok')`). Eine Attrappe, die hier
  // `{ok:true}` schickte, verdeckte genau den Fehler, den die Oberflaeche
  // machen kann: auf eine JSON-Antwort zu warten, die nie kommt, und dann
  // jeden gelungenen Neustart als Fehlschlag anzuzeigen.
  if (req.method === 'POST' && (p === '/api/reboot' || p === '/api/shutdown' || p === '/api/oberflaeche/neuladen')) {
    lage.stromRufe.push(p)
    console.log(`  POST ${p} <- Ruf ${lage.stromRufe.length} (die Vorschau tut nichts davon)`)
    if (lage.strom === 'kaputt') {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      return res.end('error')
    }
    if (p === '/api/oberflaeche/neuladen') return jsonAus(res, { status: 'ok', angefordert: lage.stromRufe.length })
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    return res.end('ok')
  }

  // ══ DIE SPERRART SETZEN — DER WEG DER VERWALTUNG ══════════════════════
  //
  // ES SCHREIBT WIRKLICH (in `lage.sperre`), und das ist der Punkt: eine
  // Attrappe, die nur `{ok:true}` sagt, laesst den ganzen Weg gruen aussehen,
  // ohne dass jemals gemessen waere, ob die Oberflaeche den neuen Stand auch
  // ANZEIGT. Wer hier umstellt und danach den Bereich neu oeffnet, bekommt
  // das andere Tor — genau wie an der Box.
  //
  // UND ES VERWEIGERT „pin" OHNE PIN, wortgleich zu `pruefeKonfig`
  // (src/backend-api/src/konfiguration.ts). Das ist die Wache, hinter der
  // niemand sich aussperrt; eine Vorschau, die sie nicht hat, koennte den
  // einzigen Weg in die Falle nicht vorfuehren.
  if (req.method === 'POST' && p === '/api/konfiguration') {
    let roh = ''
    for await (const stueck of req) roh += stueck
    let aend = {}
    try {
      aend = (JSON.parse(roh || '{}') || {}).aenderungen || {}
    } catch {
      aend = {}
    }

    // ══ DIE ZUGAENGE DER ANBIETER ═════════════════════════════════════════
    //
    // SIE SCHREIBEN WIRKLICH (in `ZUGANG`), und sie pruefen wortgleich zum
    // Server (`pruefeUrl` und `pruefeFeld`/`geheim`, konfiguration.ts). Zwei
    // Regeln sind dabei die, um deretwillen es diesen Zweig ueberhaupt gibt:
    //
    //   LEER HEISST LOESCHEN, nicht „unveraendert". Genau das ist Punkt 3 der
    //   nicht verhandelbaren Liste, und es ist die Regel, gegen die eine
    //   Oberflaeche am leisesten verstoesst: wer die Tastatur abbricht und
    //   trotzdem etwas schickt, nimmt der Box den Zugang, und gemerkt wird es
    //   erst, wenn ein Kind etwas abspielen will. Die Vorschau BESTAETIGT das
    //   Loeschen hier, damit ein Werkzeug es sehen kann.
    //
    //   EINE ADRESSE OHNE SCHEMA IST EIN FEHLER, kein Wert. Der Server
    //   antwortet dann 400 mit „Jellyfin-Server: keine gültige Adresse (mit
    //   http:// oder https://)" — eine Attrappe, die alles annimmt, liesse
    //   nicht messen, ob die Oberflaeche den Grund auch hinschreibt.
    //
    // DER WERT STEHT NICHT AUF DER KONSOLE. Nur die Feld-Kennung und ob etwas
    // gesetzt oder geloescht wurde — dieselbe Regel wie bei der PIN weiter
    // unten. Eine Vorschau, die einen API-Schluessel in ihr Protokoll
    // schreibt, ist genau das Leck, gegen das die Oberflaeche daneben
    // aufpasst.
    const nein = (text) => {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: text }))
    }
    const zugangsFelder = ['jellyfinServer', 'jellyfinSchluessel', 'spotifyClientId']
    if (zugangsFelder.some((f) => f in aend)) {
      const geaendert = []
      if ('jellyfinServer' in aend) {
        const t = String(aend.jellyfinServer ?? '').trim().replace(/\/+$/, '')
        if (t !== '') {
          let u = null
          try {
            u = new URL(t)
          } catch {
            u = null
          }
          if (!u || (u.protocol !== 'http:' && u.protocol !== 'https:'))
            return nein('Jellyfin-Server: keine gültige Adresse (mit http:// oder https://)')
        }
        ZUGANG.jellyfinServer = t
        geaendert.push({ id: 'jellyfinServer', neustart: false })
      }
      if ('jellyfinSchluessel' in aend) {
        const t = String(aend.jellyfinSchluessel ?? '').trim()
        if (t.length > 500) return nein('Jellyfin API-Schlüssel: zu lang')
        ZUGANG.jellyfinApiKey = t
        geaendert.push({ id: 'jellyfinSchluessel', neustart: false, nachher: t ? '(gesetzt)' : '(gelöscht)' })
      }
      if ('spotifyClientId' in aend) {
        const t = String(aend.spotifyClientId ?? '').trim()
        // `text` ohne `leerErlaubt` — leer ist hier ein FEHLER und kein
        // Loeschen. Wortgleich zu `pruefeFeld` (konfiguration.ts).
        if (t === '') return nein('Spotify Client-ID: leer')
        if (t.length > 64) return nein('Spotify Client-ID: länger als 64 Zeichen')
        ZUGANG.spotifyClientId = t
        geaendert.push({ id: 'spotifyClientId', neustart: false })
      }
      console.log(`  Zugang geaendert: ${geaendert.map((g) => g.id).join(', ')}`)
      return jsonAus(res, { ok: true, geaendert, neustartNoetig: false })
    }

    // ══ DIE HALTEDAUER DES AUSSCHALT-KNOPFS ═══════════════════════════════
    //
    // SIE KLEMMT WIE DER SERVER UND NICHT BEQUEMER. `konfiguration.ts` prueft
    // ein Feld der Art `zahl` gegen `min`/`max` und antwortet sonst 400 mit
    // „<Titel>: kleiner als <min>" bzw. „groesser als <max>". Eine Attrappe,
    // die 0 annaehme, liesse die Oberflaeche gruen aussehen, waehrend sie auf
    // der Box eine Box baut, die beim kuerzesten Antippen ausgeht — genau die
    // Sackgasse, gegen die dieses Feld eine Untergrenze hat.
    if ('druckdauer' in aend) {
      const n = Number.parseInt(String(aend.druckdauer ?? ''), 10)
      if (!Number.isFinite(n)) return nein('Haltedauer der Taste (Sekunden): keine Zahl')
      if (n < 2) return nein('Haltedauer der Taste (Sekunden): kleiner als 2')
      if (n > 5) return nein('Haltedauer der Taste (Sekunden): größer als 5')
      console.log(`  Haltedauer: ${lage.druckdauer} -> ${n}`)
      lage.druckdauer = String(n)
      return jsonAus(res, { ok: true, geaendert: [{ id: 'druckdauer' }], neustartNoetig: false })
    }

    const art = String(aend.einstellungssperre ?? '')
    if (!['aus', 'rechnen', 'pin', 'geste'].includes(art)) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
      return res.end(JSON.stringify({ ok: false, error: `Sperre vor den Einstellungen: ${art}` }))
    }
    if (art === 'pin' && PIN_STAND.gesetzt === '') {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
      return res.end(
        JSON.stringify({
          ok: false,
          error: 'Sperre auf „PIN" gestellt, aber keine PIN gesetzt — die Box käme in keine Einstellung mehr',
        }),
      )
    }
    console.log(`  Sperrart: ${lage.sperre} -> ${art}`)
    lage.sperre = art
    return jsonAus(res, { ok: true, geaendert: [{ id: 'einstellungssperre' }], neustartNoetig: false })
  }

  // ══ DIE PIN SETZEN ════════════════════════════════════════════════════
  //
  // DIE ZIFFERN WERDEN NICHT MITGESCHRIEBEN. Auf der Konsole steht die LAENGE
  // und sonst nichts — eine Vorschau, die die PIN in ihr Protokoll schreibt,
  // waere genau das Leck, gegen das die Oberflaeche daneben aufpasst.
  if (req.method === 'POST' && p === '/api/konfiguration/einstellungs-pin') {
    let roh = ''
    for await (const stueck of req) roh += stueck
    let pin = ''
    try {
      pin = String((JSON.parse(roh || '{}') || {}).pin ?? '')
    } catch {
      pin = ''
    }
    // Wortgleich zu `pruefeEinstellungsPin` (konfiguration.ts): nur Ziffern,
    // 4 bis 8, leer heisst loeschen.
    if (pin !== '' && (!/^[0-9]+$/.test(pin) || pin.length < 4 || pin.length > 8)) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
      return res.end(JSON.stringify({ ok: false, error: 'PIN: 4 bis 8 Ziffern' }))
    }
    if (pin === '' && lage.sperre === 'pin') {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
      return res.end(
        JSON.stringify({ ok: false, error: 'Sperre auf „PIN" gestellt, aber keine PIN gesetzt' }),
      )
    }
    PIN_STAND.gesetzt = pin
    console.log(`  Einstellungs-PIN ${pin === '' ? 'gelöscht' : `gesetzt (${pin.length} Ziffern)`}`)
    return jsonAus(res, { ok: true, gesetzt: pin !== '' })
  }

  if (p === '/api/config') {
    // `host` MUSS hier mit. Diese Attrappe hat schon mehrfach durch WEGLASSEN
    // getaeuscht: fehlt ein Feld, misst man den Rueckfall der Oberflaeche und
    // haelt ihn fuer das Ergebnis. Seit 2026-08-02 setzt die Oberflaeche den
    // Namen der Box aus `mupibox.host` — der Name unterscheidet sich hier
    // absichtlich vom Rueckfall in index.html, sonst saehe man nicht, OB
    // gesetzt wurde. Umschalten: /vorschau/name-{mitbox|ohnebox|lang}
    // DIE SPERRE STEHT HIER MIT, seit es den Eltern-Bereich in der neuen
    // Oberflaeche gibt (04.08.2026). Sie fehlte vorher, und das war genau die
    // Sorte Luecke aus [attrappe-luegt-durch-weglassen]: `sperrModus()` faellt
    // bei einem fehlenden Feld auf "aus" zurueck — die Vorschau haette den
    // Bereich also IMMER offen gezeigt, und niemand haette bemerkt, dass das
    // Tor gar nicht gebaut ist.
    //
    // `kaputt` antwortet mit 500 statt mit einem Feld: eine Box, die ihre
    // Konfiguration nicht lesen kann, ist ein anderer Fall als eine, die "aus"
    // sagt — auch wenn beide am Ende durchlassen.
    if (lage.sperre === 'kaputt') {
      res.statusCode = 500
      res.end('kaputt')
      return
    }
    const mupibox = {
      host: BOXNAMEN[lage.name] || BOXNAMEN.mitbox,
      maxVolume: lage.maxLaut,
      startVolume: 40,
      einstellungssperre: lage.sperre,
    }
    // ── `fehlt` IST NICHT `aus`, UND DAS IST DER GANZE PUNKT DIESER LAGE ────
    //
    // Bis zum 06.08.2026 kannte die Vorschau `aus|rechnen|pin|kaputt` — aber
    // keinen Fall OHNE den Schluessel. Genau der ist der haeufigste auf einer
    // echten Box: an .169 fehlt `mupibox.einstellungssperre` in
    // /etc/mupiboxconfig.json ganz, weil ihre Konfiguration aelter ist als das
    // Feld. Solange die Vorschau ihn nicht stellen konnte, war die Vorgabe von
    // `sperrModus` schlicht nicht am Schirm messbar — man mass „aus sagt aus"
    // und hielt es fuer eine Aussage ueber den fehlenden Schluessel.
    //
    // `/vorschau/sperre-fehlt` laesst den Schluessel WEG, statt ihn leer zu
    // setzen. „leer" ist noch einmal ein dritter Fall (`sperre-leer`), und die
    // drei duerfen nicht zusammenfallen: dass sie heute dieselbe Antwort
    // bekommen, ist eine ENTSCHEIDUNG und keine Selbstverstaendlichkeit.
    if (lage.sperre === 'fehlt') delete mupibox.einstellungssperre
    if (lage.sperre === 'leer') mupibox.einstellungssperre = ''
    return jsonAus(res, { mupibox })
  }

  // ── Das Tor: die PIN pruefen lassen ──────────────────────────────────────
  //
  // DIE ECHTE BOX VERGLEICHT GEGEN EINEN bcrypt-HASH und schickt nur ja oder
  // nein zurueck (server.ts, /api/einstellungen/pin-pruefen). Sie bremst
  // ausserdem absichtlich nach Fehlversuchen und laesst immer nur EINE
  // Pruefung gleichzeitig laufen. Hier steht die Antwort, nicht die Bremse:
  // eine Vorschau, die fuenf Sekunden wartet, prueft nichts, sie hindert nur.
  //
  // 2468 ist die PIN DES ENTWURFS (MixPiBox-standalone.html, `pinSub`) — damit
  // niemand sie fuer eine echte haelt, die irgendwo auf einer Box steht.
  if (req.method === 'POST' && p === '/api/einstellungen/pin-pruefen') {
    let roh = ''
    for await (const stueck of req) roh += stueck
    let pin = ''
    try {
      pin = String((JSON.parse(roh || '{}') || {}).pin || '')
    } catch {
      pin = ''
    }
    // Nur wenn die Sperre WIRKLICH auf "pin" steht. Stuende sie auf "aus" und
    // laege noch eine PIN von frueher in der Datei, oeffnete dieser Weg sonst
    // eine Tuer, die gar nicht mehr gemeint ist — die echte Box prueft genau
    // das, und die Vorschau muss es mitpruefen, sonst misst man einen Weg, den
    // es auf der Box nicht gibt.
    // GEGEN DEN GESETZTEN STAND, nicht gegen eine feste Zahl — siehe
    // `PIN_STAND`. Ein leerer Stand sagt zu JEDER Eingabe nein, wortgleich
    // zur echten Box: `passwortStimmt` weist einen leeren Hash immer ab.
    const ok = lage.sperre === 'pin' && PIN_STAND.gesetzt !== '' && pin === PIN_STAND.gesetzt
    console.log(`  PIN-Pruefung: ${ok ? 'ja' : 'nein'} (Sperre ${lage.sperre})`)
    return jsonAus(res, { ok })
  }

  // ── DIE LAUFENDE FASSUNG ────────────────────────────────────────────────
  //
  // Die Marke unten links zeigt sie („ganz unten eine laufende versionsnr
  // klein"). Sie kommt aus `herkunft` — dem Stempel, den src/deploy.sh beim
  // Bauen neben server.js legt. Die Form hier ist die der ECHTEN Antwort,
  // gemessen an der Box am 03.08.2026 (`urteil`, `installiert`, `angeboten`,
  // `grund`, `kanal`, `herkunft`, `angebotsQuelle`, `feedFehler`).
  //
  // DIE ZAHLEN SIND ABSICHTLICH ANDERE als die der Box: 777 eigene Commits
  // und ein Commit, der mit „abcdef7" anfaengt. Wer sie auf dem Schirm sieht,
  // weiss, dass er die Vorschau misst und nicht ein Ueberbleibsel.
  if (p === '/api/spotify/laeuft') {
    // Der 2-s-Takt des Schirms fragt, was von aussen auf der Box laeuft.
    // Die Vorschau hat kein Spotify — die ehrliche Antwort ist die
    // Leerantwort des echten Servers (aktiv: false), nicht ein 404, der die
    // Konsole der Nachlese vollschreibt (17 Meldungen je Lauf, 13.08.2026).
    return jsonAus(res, { aktiv: false, aufDieserBox: false })
  }

  if (p === '/api/aktualisierung') {
    return jsonAus(res, {
      urteil: 'eigenbau',
      installiert: '1.0.0',
      angeboten: '4.2.4',
      grund: 'Diese Box läuft ein selbst gebautes Abbild.',
      kanal: 'stable',
      herkunft: {
        quelle: 'https://github.com/splitti/MuPiBox.git',
        commit: 'abcdef7890123456789012345678901234567890',
        zweig: 'main',
        version: '1.0.0',
        eigeneCommits: 777,
        // NICHT FEST 0: Ein Bau aus einem geaenderten Baum ist an dieser Box
        // der haeufigere Fall als der saubere, und die Fusszeile behandelt ihn
        // anders (`fassungBeschriften`, Plus am Commit).
        unsauber: lage.fassung === 'unsauber' ? 4 : 0,
        gebautAm: '2026-08-03T09:00:00Z',
      },
      angebotsQuelle: 'https://github.com/splitti/MuPiBox.git',
      feedFehler: '',
    })
  }

  /**
   * DIE SYSTEMLAGE — gebraucht wird davon in der Verwaltung heute nur EINES:
   * die Aktionsliste samt `bereich`.
   *
   * WOZU DIESER ZWEIG: Seit dem 03.08.2026 holt die MEDIENSEITE diese Liste,
   * um „Medien neu einlesen" zu zeigen (die Aktion traegt `bereich: 'medien'`).
   * Ohne den Zweig faellt der Abruf durch, die Karte erscheint nicht, und die
   * Vorschau zeigt eine Medienseite, die es so auf keiner Box gibt — eine
   * Attrappe, die durch WEGLASSEN taeuscht [attrappe-gruen-geraet-rot-loser-titel].
   *
   * MITGELIEFERT WERDEN BEIDE SORTEN VON AKTION, sanft und einschneidend, und
   * beide Bereiche. Nur so sieht man auch, dass die Systemseite die eine NICHT
   * mehr zeigt und die Medienseite die andere nicht.
   */
  /**
   * EINE SYSTEM-AKTION AUSLOESEN — seit dem Gegenlesen am 03.08.2026.
   *
   * WARUM DAS FEHLTE UND WARUM ES JETZT ZAEHLT: „Medien neu einlesen" ist am
   * 03.08.2026 von der Systemseite auf die MEDIENSEITE gewandert. Die Karte
   * war danach zu sehen — der KNOPF aber nicht zu druecken: die Attrappe
   * kannte nur GET /api/system, jedes POST endete in ihrem 404-Zweig. Die
   * Seite meldete dann „Die Box hat nicht geantwortet.", und das sieht aus wie
   * ein Fehler der Seite. Genau die falsche Richtung, in die eine Attrappe
   * luegen kann ([[attrappe-luegt-durch-weglassen]]).
   *
   * ES WIRD NICHTS GETAN, auch nicht so getan. Der echte Server fuehrt hier
   * ein Skript aus (server.ts, POST /api/system/:id gegen AKTIONEN); die
   * Vorschau antwortet nur so, wie er antwortet, und schreibt es auf die
   * Konsole. Eine unbekannte Kennung bekommt 400 — dasselbe wie dort, und der
   * Zweig, der in der Oberflaeche „Diese Aktion gibt es nicht." heisst.
   */
  if (p.startsWith('/api/system/') && req.method === 'POST') {
    const id = p.slice('/api/system/'.length)
    console.log(`  ${p} <- (Aktion, es passiert nichts)`)
    if (!SYSTEM_AKTIONEN.some((a) => a.id === id)) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
      return res.end(JSON.stringify({ ok: false, error: 'unbekannte Aktion' }))
    }
    return jsonAus(res, { ok: true })
  }

  if (p === '/api/system') {
    return jsonAus(res, {
      laufzeitSekunden: 268344,
      speicherGesamt: 8 * 1024 * 1024 * 1024,
      speicherFrei: 5 * 1024 * 1024 * 1024,
      last: [0.31, 0.24, 0.19],
      kerne: 4,
      modell: 'Raspberry Pi 5 Model B Rev 1.0',
      temperatur: 48,
      platte: { gesamt: 31000000000, benutzt: 12000000000, frei: 17400000000, prozent: 41 },
      rechner: 'MixPiBox',
      aktionen: SYSTEM_AKTIONEN,
    })
  }

  /**
   * DER SCHLUMMER-TIMER — seit dem 03.08.2026 auf der Kinderzeit-Seite.
   *
   * ZWEI SORTEN, und die Seite sieht in beiden voellig anders aus: laeuft
   * keiner, steht dort ein Zahlenfeld und „Timer starten"; laeuft einer, steht
   * dort nur „Ein Timer laeuft" und „Timer abbrechen". Wer nur die erste
   * stellt, hat den halben Knopf nie gesehen.
   *     curl localhost:8299/vorschau/schlummer-an
   *     curl localhost:8299/vorschau/schlummer-aus
   */
  /**
   * DIE KINDERZEIT-REGELN UND IHR STAND.
   *
   * WARUM SIE HIER FEHLTEN UND WAS DAS KOSTETE (Gegenlesen 03.08.2026): Die
   * Attrappe kannte /api/kinderzeit gar nicht — 404. Die Seite meldete
   * deshalb IMMER „Die Regeln konnten nicht geladen werden.", und in genau
   * diesem Zustand hat sie noch nie jemand im Normalfall gesehen. Seit der
   * Schlummer-Timer dort steht, ist das nicht mehr egal: Wer den Timer
   * ansehen will, kann die Seite ohne diesen Zweig nur kaputt ansehen.
   *
   * Die Form ist die des Servers, abgelesen und nicht erfunden:
   *   Regeln  { aktiv, tage: { mo..so: { frei, ab, bis, minuten } }, nachsichtMin }
   *           — kinderzeit.ts, regelnVorgabe()/tagFrei()
   *   Stand   { erlaubt, grund, restMin, fensterAb, fensterBis, aktiv,
   *             verbrauchtMin, bonusMin } — server.ts, GET /api/kinderzeit/stand
   * PUT antwortet mit den Regeln, die der Server daraus gemacht hat; genau
   * darauf verlaesst sich die Seite (sie uebernimmt die Antwort).
   */
  if (p === '/api/kinderzeit') {
    if (req.method === 'PUT') {
      let roh = ''
      for await (const stueck of req) roh += stueck
      console.log(`  ${p} <- ${roh}`)
      try {
        const b = JSON.parse(roh)
        if (b && typeof b === 'object') KINDERZEIT.regeln = b
      } catch {
        // Unfug wird nicht uebernommen — der echte Server biegt ihn zurecht.
      }
      return jsonAus(res, KINDERZEIT.regeln)
    }
    return jsonAus(res, KINDERZEIT.regeln)
  }

  /*
   * ── DER STAND, JETZT MIT ALLEN SECHS GRUENDEN ──────────────────────────
   *
   * HIER STANDEN NUR ZWEI: 'aus' und 'aufgebraucht' (plus 'frei'). Das
   * Tagesfenster (`ab`/`bis`) wurde zwar MITGELIEFERT, aber nie AUSGEWERTET —
   * und der gesperrte Wochentag (`frei: false`) ueberhaupt nicht. Diese
   * Attrappe konnte also 'tagGesperrt', 'zuFrueh' und 'zuSpaet' gar nicht
   * hervorbringen.
   *
   * WAS DAS KOSTETE: Genau in diesen drei Lagen sagt der Server „nein" und
   * liefert TROTZDEM `restMin` und `fensterBis` mit (kinderzeit.ts, `lage`
   * wird VOR den drei Abweisungen gebaut). Wer die Restzeit oben in der Mitte
   * nur aus diesen beiden Feldern rechnet, schreibt an einem gesperrten
   * Sonntag „noch 45 min" hin. Das war hier nicht zu sehen — nicht weil es
   * niemand gemessen haette, sondern weil die Attrappe die Lage nicht kannte,
   * in der es schiefgeht. [[attrappe-luegt-durch-weglassen]]
   *
   * ABGESCHRIEBEN AUS kinderzeit.ts `pruefen()`, in derselben REIHENFOLGE —
   * sie ist dort ausdruecklich Absicht, weil sie bestimmt, WAS die Box sagt.
   */
  if (p === '/api/kinderzeit/stand') {
    const r = KINDERZEIT.regeln
    const heute = r.tage[['so', 'mo', 'di', 'mi', 'do', 'fr', 'sa'][new Date().getDay()]]
    const zeitMin = (w) => {
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(w ?? '').trim())
      if (!m) return null
      return Number(m[1]) > 23 || Number(m[2]) > 59 ? null : Number(m[1]) * 60 + Number(m[2])
    }
    const jetzt = new Date()
    const nun = jetzt.getHours() * 60 + jetzt.getMinutes()
    const ab = zeitMin(heute.ab)
    const bis = zeitMin(heute.bis)
    const erlaubtMin = heute.minuten > 0 ? heute.minuten + KINDERZEIT.bonusMin : 0
    const rest = erlaubtMin > 0 ? Math.max(0, erlaubtMin - KINDERZEIT.verbrauchtMin) : null
    // `lage` steht VOR den Abweisungen — genau wie am Server. Restzeit und
    // Fenster fahren also auch in einem „nein" mit.
    const lage = { restMin: rest, fensterBis: heute.bis, fensterAb: heute.ab }
    const urteil = !r.aktiv
      ? { erlaubt: true, grund: 'aus', restMin: null, fensterBis: '', fensterAb: '' }
      : !heute.frei
        ? { erlaubt: false, grund: 'tagGesperrt', ...lage }
        : ab !== null && nun < ab
          ? { erlaubt: false, grund: 'zuFrueh', ...lage }
          : bis !== null && nun >= bis
            ? { erlaubt: false, grund: 'zuSpaet', ...lage }
            : rest !== null && rest <= 0
              ? { erlaubt: false, grund: 'aufgebraucht', ...lage }
              : { erlaubt: true, grund: 'frei', ...lage }
    return jsonAus(res, {
      ...urteil,
      aktiv: r.aktiv,
      verbrauchtMin: KINDERZEIT.verbrauchtMin,
      bonusMin: KINDERZEIT.bonusMin,
    })
  }

  if (p === '/api/kinderzeit/bonus' && req.method === 'POST') {
    let roh = ''
    for await (const stueck of req) roh += stueck
    console.log(`  ${p} <- ${roh}`)
    let n = 0
    try {
      n = Number(JSON.parse(roh || '{}').minuten) || 0
    } catch {
      n = 0
    }
    KINDERZEIT.bonusMin = Math.max(0, KINDERZEIT.bonusMin + n)
    return jsonAus(res, { bonusMin: KINDERZEIT.bonusMin })
  }

  if (p === '/api/kinderzeit/zuruecksetzen' && req.method === 'POST') {
    KINDERZEIT.verbrauchtMin = 0
    KINDERZEIT.bonusMin = 0
    return jsonAus(res, { ok: true })
  }

  /* ══ DIE BILDSCHIRMHELLIGKEIT ══════════════════════════════════════════════
   *
   * Nachgebaut nach server.ts (GET/PUT /api/schirm/helligkeit), und zwar mit
   * ALLEN VIER LAGEN, die es dort gibt — sonst misst man nur die eine, die man
   * zufaellig getroffen hat:
   *
   *   /vorschau/licht-da        Panel vorhanden, 60 % (der Regelfall)
   *   /vorschau/licht-weg       KEIN Panel: `da:false` + Grund. Die Oberflaeche
   *                             darf dann keinen Regler zeigen, sondern muss
   *                             den Grund hinschreiben.
   *   /vorschau/licht-geklemmt  Der Rohwert liegt UNTER der Untergrenze: die
   *                             Anzeige sagt 20 %, der Schirm ist schwarz.
   *                             `geklemmt:true`, `prozentEcht:0`. In dieser
   *                             Lage steht der Regler schon ganz links — ein
   *                             Zug auf 20 loest gar kein `change` aus und
   *                             schickt nichts. Genau dafuer braucht es einen
   *                             KNOPF, und genau deshalb muss dieser Fall
   *                             vorfuehrbar sein.
   *   /vorschau/licht-stur      Das Schreiben scheitert (500). Ein Regler, der
   *                             sich bewegen laesst und still nichts tut, waere
   *                             die schlimmste der vier Lagen.
   *
   * DIE GRENZEN KOMMEN AUS DER ANTWORT und stehen nur HIER als Zahl. Wer sie in
   * der Oberflaeche noch einmal hinschreibt, hat zwei Untergrenzen — die Bauart,
   * an der dieses Projekt schon dreimal gebrochen ist.
   */
  if (p === '/api/schirm/helligkeit') {
    const grenzen = { min: 20, max: 100, schritt: 5 }
    if (LICHT.lage === 'weg') {
      if (req.method === 'PUT') {
        // 409 und nicht 500: die Anfrage war in Ordnung, die Hardware kann es
        // nur nicht. Genau so antwortet server.ts.
        res.writeHead(409, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ ok: false, error: 'Kein Hintergrundlicht gefunden', da: false }))
      }
      return jsonAus(res, {
        da: false,
        grund: 'Kein Hintergrundlicht gefunden',
        prozent: null,
        geraet: null,
        ...grenzen,
      })
    }
    if (req.method === 'PUT') {
      let roh = ''
      for await (const stueck of req) roh += stueck
      console.log(`  ${p} <- ${roh}`)
      let wunsch = null
      try {
        wunsch = Number(JSON.parse(roh || '{}').prozent)
      } catch {
        wunsch = null
      }
      if (!Number.isFinite(wunsch) || wunsch < grenzen.min || wunsch > grenzen.max) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ ok: false, error: 'prozent muss zwischen 20 und 100 liegen' }))
      }
      if (LICHT.lage === 'stur') {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ ok: false, error: 'Die Helligkeit ließ sich nicht setzen' }))
      }
      LICHT.prozent = wunsch
      LICHT.lage = 'da'
      return jsonAus(res, { ok: true, prozent: wunsch, roh: Math.round((wunsch / 100) * 255), geraet: '10-0045', gespeichert: true })
    }
    const geklemmt = LICHT.lage === 'geklemmt'
    /*
     * ── DAS GERAET IST DA UND SAGT NICHTS ───────────────────────────────
     * server.ts kennt diesen Zweig ausdruecklich: `roh === null` (die Datei
     * im sysfs liess sich nicht lesen) ergibt `prozent: null` UND
     * `prozentEcht: null`, waehrend `da: true` bleibt. Das ist etwas anderes
     * als „kein Hintergrundlicht" (`da: false`) — der Regler DARF hier
     * stehen, er weiss nur nicht, wo er steht.
     * ER FEHLTE HIER, und mit ihm die Lage, in der ein `Number(null)` sich
     * in eine glatte 0 verwandelt und die Zeile „Jetzt 0 %" behauptet.
     */
    const unlesbar = LICHT.lage === 'unlesbar'
    return jsonAus(res, {
      da: true,
      geraet: '10-0045',
      prozent: unlesbar ? null : geklemmt ? grenzen.min : LICHT.prozent,
      prozentEcht: unlesbar ? null : geklemmt ? 0 : LICHT.prozent,
      geklemmt: unlesbar ? false : geklemmt,
      roh: unlesbar ? null : geklemmt ? 0 : Math.round((LICHT.prozent / 100) * 255),
      maxRoh: 255,
      rohMin: 51,
      gemerktProzent: unlesbar || geklemmt ? null : LICHT.prozent,
      schirmAus: false,
      ...grenzen,
    })
  }

  if (p === '/api/schlummer') {
    if (req.method === 'POST') {
      // DER KOERPER WIRD GELESEN, UND ZWAR SEIT DEM GEGENLESEN AM 03.08.2026.
      //
      // Vorher setzte JEDES POST `an` — auch `{ stopp: true }`. Die Folge war
      // genau die Sorte Attrappe, vor der das Wiki warnt: die Seite meldete
      // „Der Timer wurde abgebrochen", zeigte wieder das Zahlenfeld, und die
      // Attrappe sagte beim naechsten GET weiter „laeuft". Ein Neuladen holte
      // den Timer zurueck, den man gerade abgestellt zu haben glaubte.
      //
      // WAS DAS TEUER MACHT: Die Fassung vom 03.08.2026 hat am Abbrechen
      // ausdruecklich etwas GERADEGEZOGEN (nur melden, was gelungen ist) —
      // und ausgerechnet dieser Zweig war gegen die Attrappe gar nicht
      // vorfuehrbar, weil sie ihn nicht kannte. Sie prueft still das Nichts
      // ([[attrappe-luegt-durch-weglassen]]).
      //
      // Der echte Server unterscheidet an derselben Stelle
      // (server.ts, POST /api/schlummer: `koerper?.stopp === true` -> pkill).
      let roh = ''
      for await (const stueck of req) roh += stueck
      let b = {}
      try {
        b = roh ? JSON.parse(roh) : {}
      } catch {
        // Unfug im Koerper ist kein Grund abzustuerzen — er zaehlt als „starten".
      }
      console.log(`  ${p} <- ${roh}`)
      // DIE STURE BOX: sie nimmt keinen Befehl an, der Timer laeuft weiter.
      //
      // Der WICHTIGSTE der drei Faelle, und der einzige, der ohne diesen Zweig
      // gar nicht vorzufuehren war. Genau er war die Aenderung vom 03.08.2026:
      // vorher meldete die Seite „Der Timer wurde abgebrochen" auch beim
      // Fehlschlag — die Box schaltet dann trotzdem ab, mitten in der
      // Geschichte, und der einzige Knopf, der das noch verhindern koennte,
      // ist verschwunden. Eine Attrappe, die nur gelingen kann, haette diesen
      // Zweig nie gezeigt.
      //     curl localhost:8299/vorschau/schlummer-stur
      if (lage.schlummer === 'stur') {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
        return res.end(JSON.stringify({ ok: false, error: 'Die Box antwortet nicht' }))
      }
      if (b.stopp === true) {
        lage.schlummer = 'aus'
        return jsonAus(res, { ok: true, laeuft: false })
      }
      lage.schlummer = 'an'
      return jsonAus(res, { ok: true, laeuft: true, minuten: b.minuten })
    }
    // „stur" heisst: ein Timer LAEUFT, er laesst sich nur nicht abstellen.
    const laeuft = lage.schlummer === 'an' || lage.schlummer === 'stur'
    return jsonAus(res, {
      laeuft,
      restSekunden: laeuft ? 900 : null,
      maxMinuten: 600,
    })
  }

  if (p === '/api/konfiguration') {
    // WOZU DIESER ZWEIG: Die Suche der Verwaltung holt sich die Felder der
    // Konfigurationsseite HIER, weil deren Titel erst zur Laufzeit entstehen
    // (FELDER in src/backend-api/src/konfiguration.ts). Ohne diesen Zweig
    // faende die Vorschau kein einziges Konfigurationsfeld — und man haette
    // wieder eine Attrappe, die durch WEGLASSEN taeuscht.
    //
    // Die Form ist die des Servers (server.ts, GET /api/konfiguration): jedes
    // Feld mit id/art/titel/hinweis/neustart, Geheimnisse NUR als `gesetzt`.
    // Die Auswahl hier sind echte Titel aus der Feldliste — wer sie aendert,
    // misst die Suche an etwas, was es auf keiner Box gibt.
    return jsonAus(res, {
      felder: [
        {
          id: 'host',
          art: 'text',
          titel: 'Name der Box',
          hinweis: 'Zugleich der Name bei Spotify Connect.',
          neustart: true,
          wert: 'MixPiBox',
          auswahl: [],
        },
        {
          id: 'startVolume',
          art: 'zahl',
          titel: 'Lautstärke beim Einschalten',
          hinweis: 'In Prozent.',
          neustart: false,
          wert: 40,
          auswahl: [],
        },
        {
          id: 'maxVolume',
          art: 'zahl',
          titel: 'Höchste Lautstärke',
          hinweis: 'Weiter dreht die Box nicht auf.',
          neustart: false,
          wert: 70,
          auswahl: [],
        },
        {
          id: 'idleShutdown',
          art: 'zahl',
          titel: 'Ausschalten nach … Minuten Nichtstun',
          hinweis: '0 schaltet nie ab.',
          neustart: false,
          wert: 0,
          auswahl: [],
        },
        // DIE HALTEDAUER — die Zahl hinter der Seite „Knopf zum Ausschalten".
        // `wert` ist ein STRING, weil die Box einen liefert (siehe `lage`).
        {
          id: 'druckdauer',
          art: 'zahl',
          titel: 'Haltedauer der Taste (Sekunden)',
          hinweis:
            'Wie lange die Taste gedrückt werden muss. Ganze Sekunden. Ab 6 Sekunden schaltet der MuPiHAT selbst hart ab — deshalb höchstens 5.',
          neustart: false,
          wert: lage.druckdauer,
          auswahl: [],
        },
        // ── DIE DREI FELDER DER EINRICHTUNGSSEITEN ────────────────────
        // ART UND FORM SIND DIE DER BOX (konfiguration.ts, FELDER) und nicht
        // die bequeme: `spotifyClientId` ist `text` MIT `wert` — bis zum
        // 06.08.2026 stand hier `geheim` mit `gesetzt`, und damit haette die
        // Einrichtungsseite die ID nie anzeigen koennen, obwohl die Box sie
        // offen herausgibt (gemessen an .169). Eine Attrappe, die strenger
        // tut als die Box, verdeckt eine Zeile, die dastehen soll.
        {
          id: 'spotifyClientId',
          art: 'text',
          titel: 'Spotify Client-ID',
          hinweis: 'Kein Geheimnis — die Anmeldung läuft ohne Client-Secret (PKCE).',
          neustart: false,
          wert: ZUGANG.spotifyClientId,
          auswahl: [],
        },
        {
          id: 'jellyfinServer',
          art: 'url',
          titel: 'Jellyfin-Server',
          hinweis: 'Vollständige Adresse mit http:// oder https:// und Port. Leer = nicht eingerichtet.',
          neustart: false,
          wert: ZUGANG.jellyfinServer,
          auswahl: [],
        },
        {
          id: 'jellyfinSchluessel',
          art: 'geheim',
          titel: 'Jellyfin API-Schlüssel',
          hinweis: 'Wird nie angezeigt — nur gesetzt oder gelöscht.',
          neustart: false,
          gesetzt: ZUGANG.jellyfinApiKey !== '',
          auswahl: [],
        },
        {
          id: 'anmeldung',
          art: 'schalter',
          titel: 'Anmeldung für die Verwaltung',
          hinweis: 'Ohne Passwort kommt jeder im Netz herein.',
          neustart: false,
          wert: false,
          auswahl: [],
        },
      ],
      spotify: { angemeldet: false, anmeldeWeg: '/spotify', httpsPort: 8443 },
    })
  }

  if (p.startsWith('/player/')) {
    // Die Kinderzeit antwortet mit 403 UND einem Urteil - der Server schickt
    // den Grund ausdruecklich mit, damit die Oberflaeche dem Kind sagen kann,
    // WARUM (server.ts:636-646). Genau dieser Zweig ist sonst nur auf einer
    // Box mit abgelaufener Zeit zu sehen.
    if (lage.spieler === 'kinderzeit') {
      res.statusCode = 403
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ erlaubt: false, grund: 'kontingent', restMinuten: 0 }))
      return
    }
    if (lage.spieler === 'abgelehnt') {
      res.statusCode = 500
      res.end('nein')
      return
    }

    // KENNT DIE BOX DIESEN BEFEHL UEBERHAUPT?
    //
    // Bis zum 01.08.2026 antwortete diese Attrappe auf JEDEN Spielerbefehl mit
    // {ok:true}. Damit war sie in genau dem Punkt blind, der am schwersten zu
    // sehen ist: Die echte Box quittiert einen UNBEKANNTEN Befehl ebenfalls mit
    // 200. Ihr Verteiler (spotify-control.ts, der Auffang-Zuhoerer am
    // Dateiende) vergleicht der Reihe nach gegen bekannte Namen — passt keiner,
    // faellt der Aufruf durch, ohne dass irgendwo etwas steht.
    //
    // Genau so ging `playpause` monatelang ins Leere: Die neuen Knoepfe
    // schickten ihn, alles antwortete 200, und die Musik lief weiter. Eine
    // Attrappe, die schweigend zustimmt, haette das nie gezeigt — sie haette
    // den Fehler sogar BESTAETIGT.
    //
    // Hier ist sie deshalb STRENGER als die Box. Das ist Absicht: Wer beim
    // Bauen einen Befehl erfindet, soll es sofort merken, statt es am Geraet
    // zu suchen. Die Liste stammt aus dem Verteiler; `tools/player-befehle.py`
    // liest sie dort aus und zeigt Abweichungen.
    const befehl = decodeURIComponent(p.split('/').filter(Boolean).pop() || '')
    const kern = befehl.includes(':') ? `${befehl.split(':')[0]}:` : befehl
    // MITSCHREIBEN, BEVOR ueber Gueltigkeit entschieden wird: auch ein
    // abgelehnter Befehl ist ein Befehl, und die Reihenfolge soll vollstaendig
    // sein. Der ganze Pfad steht dabei, nicht nur das letzte Glied — bei
    // `spotify/now/spotify:album:…:2:87225` steckt die Stelle darin.
    BEFEHLSPROTOKOLL.push({ t: Date.now(), befehl, pfad: p })
    if (BEFEHLSPROTOKOLL.length > BEFEHLE_HOECHSTENS) BEFEHLSPROTOKOLL.shift()
    if (!BEKANNTE_BEFEHLE.has(befehl) && !BEKANNTE_BEFEHLE.has(kern) && !START.some((s) => p.includes(`/${s}/`))) {
      console.warn(`  UNBEKANNTER SPIELERBEFEHL: ${befehl}  (die echte Box antwortet hier still 200 und tut NICHTS)`)
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ ok: false, unbekannt: befehl, hinweis: 'tools/player-befehle.py zeigt die gueltigen' }))
      return
    }
    // LAUTSTAERKE WIRKLICH VERAENDERN statt nur zu quittieren. Sonst zeigte
    // die Vorschau bei jedem Tipp denselben Stand, und die Tasten liessen
    // sich hier gar nicht pruefen — eine Attrappe, die immer dasselbe sagt,
    // beweist nichts.
    if (befehl === '+5' || befehl === '-5') {
      lage.laut = Math.max(0, Math.min(100, lage.laut + (befehl === '+5' ? 5 : -5)))
      console.log(`  Lautstaerke -> ${lage.laut}`)
    }
    // UND `setvolume:N` GENAUSO (03.09.2026). Der Vorsatz stand seit jeher in
    // der Liste der gueltigen Befehle und wurde nur QUITTIERT — der Regler im
    // Kissen und die Wischgeste schicken aber genau ihn. Damit war der ganze
    // Regler-Weg hier nicht pruefbar: Die Vorschau meldete im Sekundentakt
    // weiter den alten Wert, der Regler sprang zurueck, und das sah exakt aus
    // wie der Fehler, den der Betreiber am selben Tag am GERAET gemeldet hat
    // („die Lautstärke springt beim Wechsel"). Beim Nachmessen der Behebung
    // war nicht mehr zu unterscheiden, ob die Behebung wirkt oder die
    // Attrappe schweigt — genau die Sorte Zeuge, vor der das Haus warnt
    // ([[attrappe-luegt-durch-weglassen]]).
    if (befehl.startsWith('setvolume:')) {
      const n = Number(befehl.slice('setvolume:'.length))
      if (Number.isFinite(n)) {
        lage.laut = Math.max(0, Math.min(100, Math.round(n)))
        console.log(`  Lautstaerke gesetzt -> ${lage.laut}`)
      }
    }
    // `stop` ANTWORTET IN DER FORM DER ECHTEN BOX, nicht in der bequemen.
    //
    // Alle anderen Befehle bekommen hier seit jeher `{ok:true}` — der echte
    // Dienst schickt `{status:'ok', error:'none'}`. Das war folgenlos, solange
    // die Oberflaeche nur `antwort.ok` (also den HTTP-Rang) ansah. Seit dem
    // 04.08.2026 LIEST sie bei `stop` den Koerper (`angehalten`, E24/O2), und
    // ab da waere eine erfundene Form genau die Sorte Attrappenluege, die
    // dieses Projekt schon zweimal bezahlt hat.
    //
    // 'alt' laesst das Feld WEG statt es auf 'alt' zu setzen — ein alter
    // Dienst kennt es nicht, und „kennt es nicht" ist etwas anderes als
    // „meldet etwas Unbekanntes".
    if (befehl === 'stop') {
      return jsonAus(res, {
        status: 'ok',
        error: 'none',
        ...(lage.anhalten === 'alt' ? {} : { angehalten: lage.anhalten }),
      })
    }
    return jsonAus(res, { ok: true })
  }

  // Die Seite selbst. /neu/ ist der Pfad, unter dem die Box sie ausliefert -
  // damit dieselben absoluten Adressen greifen wie dort.
  let rest = p.startsWith('/neu') ? p.slice(4) : p
  if (rest === '' || rest === '/') rest = '/index.html'
  const ziel = join(SEITE, normalize(rest).replace(/^(\.\.[/\\])+/, ''))
  if (!ziel.startsWith(SEITE)) {
    res.statusCode = 403
    res.end('nein')
    return
  }
  await datei(res, ziel)
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Vorschau: http://localhost:${port}/neu/`)
  console.log(
    `Umschalten: curl localhost:${port}/vorschau/{spielt|pause|still|ohne-cover|mit-cover|voll|leer|kaputt|fehlt}`,
  )
})
