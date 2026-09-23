const express = require('express')
const http = require('node:http')
const https = require('node:https')
const path = require('node:path')
const dns = require('node:dns')
const SpotifyWebApi = require('spotify-web-api-node')
const fortschritt = require('./fortschritt')
// Die Wiedergabe-Maschine wird UNTEN gewählt (mplayer oder mpv) — erst dort
// steht die Konfiguration bereit. Siehe `playerEngine`.
// VORLESEN LAEUFT UEBER PIPER, nicht mehr ueber Google. Warum, was am Geraet
// gemessen wurde und was Piper NICHT kann (Japanisch): siehe sprechen.ts.
const sprechen = require('./sprechen') as typeof import('./sprechen')
// Die ADRESSE aus einem Stream-Befehl (jellyfin, ard, …) — nach Position
// zerlegt statt nach Zeichenkette gesucht. Begruendung und die Sorte, die das
// alte Zerlegen verfehlt: befehlspfad.ts / befehlspfad.spec.ts.
const { abAusName, adresseAusPfad, dateiPfadErlaubt, medienPfadAus, titelAusName, verbAusPfad } =
  require('./befehlspfad') as typeof import('./befehlspfad')
// EIN VERSPRECHEN ABWARTEN, ABER NICHT ENDLOS. Gebraucht von `stop()` — dort
// steht auch, was das Nicht-Abwarten gekostet hat. Die Messungen, die die
// Obergrenze noetig machen (134,8 s an der Box bei totem Netz), stehen im
// Kopf von zeitschranke.ts.
const { mitZeitschranke } = require('./zeitschranke') as typeof import('./zeitschranke')
// DER PAPIERKORB DER MEDIENLISTE. Was hier geloescht wird, sind TONDATEIEN,
// und es gibt keine Sicherung davon (mupibox-sicherung.py nimmt /media nicht
// auf). Was die alte Stelle stattdessen traf — abgeschnittene Titel, ganze
// Kategorien, und eine Shell, aus der ein Anfuehrungszeichen ausbrach —,
// steht im Kopf von loeschen.ts.
const { MEDIEN_WURZEL, loeschgliedAusUrl, loeschenAusfuehren } = require('./loeschen') as typeof import('./loeschen')
// PEGEL — vier Frequenzbaender fuer die Wellen-Anzeige (BACKLOG.md E99). Der
// Abgriff selbst (pw-record am PipeWire-Monitor, Goertzel je Band, keine
// Allokation je Chunk) steht REIN in pegel.ts und ist dort geprueft. Hier
// wird nur an- und abgeschaltet (writeplayerstatePlay/-Pause, die EINE
// Stelle, die auf "spielt"/"Pause" schaltet) und das Ergebnis additiv in
// die Zustands-Antwort gemischt (/state, /local).
const { pegelStarten, pegelStoppen, pegelLesen } = require('./pegel') as typeof import('./pegel')
const { sollFremdePauseSenden } = require('./fremdlage') as typeof import('./fremdlage')
const { imStummenFenster } = require('./cue-fahren') as typeof import('./cue-fahren')
const { erzeugeCueSchalter } = require('./cue-schalter') as typeof import('./cue-schalter')
/** Die Rechnung der +/- Tasten — samt der Begruendung, warum sie maxVolume
 *  NICHT mehr kennt (lautstaerke-stufe.ts, Betreiber-Meldung 05.09.2026). */
const { LAUTSTAERKE_SCHRITT, naechsteStufe } = require('./lautstaerke-stufe') as typeof import('./lautstaerke-stufe')
const fs = require('node:fs')
const childProcess = require('node:child_process')

/**
 * DIE GERAETEWAHL LIEGT IM BACKEND — und wird hier NICHT nachgebaut.
 *
 * Bis zum 2026-08-02 gab es zwei Meinungen ueber dieselbe Geraeteliste:
 * `bereitschaftUrteil` im Backend (der Waechter, den die Oberflaeche VOR jedem
 * Spotify-Start fragt) sagte nein, sobald der Boxname nicht namensgenau in der
 * Liste stand — waehrend `geraetAufloesen` hier auf `geraete[0]` zurueckfiel
 * und spielte. Die Oberflaeche verbot damit etwas, das funktioniert haette.
 * Jetzt fragen beide dieselbe Funktion.
 *
 * ALS `typeof import(...)` GETYPT, nicht als `require` ins Blaue: so prueft
 * `tsc --noEmit` diese Stelle wirklich mit, ohne dass die Datei zum Modul wird
 * (sie ist ein Skript, und alles hier oben haengt daran).
 */
const { geraetWaehlen } =
  require('../../backend-api/src/spotify-web') as typeof import('../../backend-api/src/spotify-web')

// Force IPv4 for DNS lookups to avoid EAI_AGAIN errors on Raspberry Pi
// This fixes issues where IPv6 is misconfigured or not supported
dns.setDefaultResultOrder('ipv4first')

let configBasePath = './config'
//let networkConfigBasePath = '/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config'
if (process.env.NODE_ENV === 'development') {
  configBasePath = '../config'
  //networkConfigBasePath = '../../backend-api/config'
}

const muPiBoxConfig = require(`${configBasePath}/mupiboxconfig.json`)
const config = require(`${configBasePath}/config.json`)

const log = require('console-log-level')({ level: config.server.logLevel })

// Lautstaerke NICHT mehr direkt ueber amixer: das Werkzeug erkennt selbst, ob
// ALSA oder PipeWire laeuft. Damit wird der Stapelwechsel eine Sache der Box
// und nicht eine Aenderung an vier Programmen. Fehlt es (alte Installation),
// faellt alles auf amixer zurueck — die Box bleibt bedienbar.
const LAUTSTAERKE_WERKZEUG = '/usr/local/bin/mupibox/mupi-lautstaerke.sh'
const lautstaerkeLies = `test -x ${LAUTSTAERKE_WERKZEUG} && ${LAUTSTAERKE_WERKZEUG} get || /usr/bin/amixer sget Master`
const lautstaerkeSetz = (v: number | string) =>
  `test -x ${LAUTSTAERKE_WERKZEUG} && ${LAUTSTAERKE_WERKZEUG} set ${v} || /usr/bin/amixer -q sset Master ${v}%`
/** Lautstaerke aus der Ausgabe lesen — blanke Zahl ODER amixers `[64%]`. */
const lautstaerkeAusText = (text: string): number | null => {
  const roh = (text || '').trim()
  const m = /\[(\d{1,3})%\]/.exec(roh)
  if (m) return Number(m[1])
  return /^\d{1,3}$/.test(roh) ? Number(roh) : null
}

/** Schrittweise lauter/leiser — das Werkzeug rechnet den neuen Wert selbst. */
const lautstaerkeSetzRelativ = (delta: number) => {
  const richtung = delta >= 0 ? 'up' : 'down'
  const betrag = Math.abs(delta)
  const zeichen = delta >= 0 ? '+' : '-'
  return `test -x ${LAUTSTAERKE_WERKZEUG} && ${LAUTSTAERKE_WERKZEUG} ${richtung} ${betrag} || /usr/bin/amixer -q sset Master ${betrag}%${zeichen}`
}

// Safety net (B2): the playback ENGINE must never die because some Spotify call
// rejected unhandled (e.g. unconfigured/expired credentials — several legacy
// fire-and-forget spotifyApi calls lack a .catch). Node 22 would exit the
// process, killing local/radio/rss playback too. Log and keep running instead.
process.on('unhandledRejection', (reason) => {
  log.warn(`Unhandled promise rejection (ignored): ${(reason as Error)?.message ?? reason}`)
})

/*set up express router and set headers for cross origin requests*/
const app = express()
// INTERNAL service — stays plain HTTP. The backend-api serves the app + /api and
// reverse-proxies /player -> here over localhost HTTP (it terminates TLS on :8443
// itself), so a cert in /etc/mupibox/tls belongs to the BACKEND-API, not to this
// port. Serving https here silently broke the /player proxy with 502 Bad Gateway
// (the proxy speaks http to :5005) -> the SDK could not fetch its OAuth token ->
// no Spotify playback. Opt into https only for a STANDALONE player via
// MUPIBOX_PLAYER_TLS=1.
const _tlsDir = process.env.MUPIBOX_TLS_DIR || '/etc/mupibox/tls'
const _useTls =
  process.env.MUPIBOX_PLAYER_TLS === '1' && fs.existsSync(`${_tlsDir}/cert.pem`) && fs.existsSync(`${_tlsDir}/key.pem`)
const server = _useTls
  ? https.createServer(
      { cert: fs.readFileSync(`${_tlsDir}/cert.pem`), key: fs.readFileSync(`${_tlsDir}/key.pem`) },
      app,
    )
  : http.createServer(app)
// Wiedergabe-Maschine: `mupibox.playerEngine` in mupiboxconfig.json.
// VORGABE BLEIBT MPLAYER. mpv ist der Nachfolger (mpv-wrapper.ts, JSON-IPC
// statt Slave-Modus) und behebt baulich zwei Fehler des alten Weges — ein
// Pfad mit %20 verlor seine Anführungszeichen, ein Dateiname mit % warf eine
// Ausnahme. Umgestellt wird trotzdem erst, wenn es AM GERÄT gehört wurde:
// hier hängt die Musik dran, und ein Fehlgriff ist eine stumme Box.
// Ein unbekannter Wert fällt still auf mplayer zurück — lieber der bewährte
// Weg als gar keiner.
const playerEngine = String(muPiBoxConfig.mupibox?.playerEngine || 'mplayer').toLowerCase()
const createPlayer = playerEngine === 'mpv' ? require('./mpv-wrapper') : require('./mplayer-wrapper')
// Ohne Zeitstempel: `nowDate` entsteht erst weiter unten.
log.info(`[Spotify Control] Wiedergabe-Maschine: ${playerEngine === 'mpv' ? 'mpv' : 'mplayer'}`)
const player = createPlayer()

/* ══ DER ZUSTANDSNAME IST DIE MASCHINE, DIE WIRKLICH LAEUFT ═══════════════
 *
 * Betreiber, 04.09.2026, beim Mitlesen einer Messung: „ähm warum mplayer?"
 * Berechtigt: `/local` meldete `currentPlayer: 'mplayer'`, waehrend im
 * PipeWire-Graphen ein Knoten `mpv` stand und auch wirklich mpv lief
 * (`playerEngine: "mpv"`). Das Feld war bei der alten Antwort
 * stehengeblieben — es sagte „Datei-Spieler" und klang wie „mplayer".
 *
 * Jetzt traegt es den Namen der Maschine, die tatsaechlich spielt. Weil
 * mplayer eine WEITERHIN WAEHLBARE Maschine ist (konfiguration.ts bietet sie
 * an), sind beide Werte echt — es ist keine Umbenennung, sondern eine
 * Unterscheidung, die vorher fehlte.
 *
 * WER FRAGT „SPIELT EINE DATEI?", FRAGT `istDateiSpieler` — nicht auf einen
 * Namen vergleichen. Sonst faellt beim naechsten Maschinenwechsel wieder
 * eine Stelle heraus, und zwar still: ein Vergleich, der nie zutrifft, sieht
 * aus wie „spielt gerade nichts".
 */
const DATEI_SPIELER = playerEngine === 'mpv' ? 'mpv' : 'mplayer'
function istDateiSpieler(wert: unknown): boolean {
  return wert === 'mplayer' || wert === 'mpv'
}
// ── WAS DER AUFSATZ ZU MELDEN HAT, MUSS AUCH JEMAND HOEREN ────────────────
// Beide Aufsaetze geben Meldungen ueber ein Ereignis 'stderr' ab. Bis zum
// 06.08.2026 hat sie NIEMAND abgenommen — ein EventEmitter wirft dafuer
// nicht, er verwirft still. Damit fielen drei Meldungen ins Nichts, und alle
// drei sind die Sorte, die man spaeter im Dunkeln sucht:
//
//   * „loadfile mit force-media-title abgelehnt — noch einmal ohne
//     Titelnamen" (F1). Der Rueckfall rettet den TON auf einem aelteren mpv,
//     und die Kommentare dort sagen ausdruecklich „Gemeldet wird es trotzdem".
//     Wurde es nicht. Auf so einer Box waeren ALLE Folgennamen wieder falsch
//     gewesen, ohne eine einzige Zeile im Protokoll.
//   * „roher Befehl ohne Entsprechung uebergangen" (exec bei mpv).
//   * „mpv laesst sich nicht starten: …" — die Box bleibt stumm, und der
//     einzige Hinweis darauf stand in diesem Ereignis.
//
// mpv laeuft mit `--msg-level=all=warn` UND `--no-terminal`; ueber den echten
// Fehlerkanal des Prozesses kommt damit nichts an (am Geraet nachgemessen,
// 05.08.2026: mpv mit --no-terminal schreibt selbst bei einer Adresse, die es
// nicht oeffnen kann, NULL Byte nach stderr). Was hier ankommt, sind
// ausschliesslich die drei Meldungen des Aufsatzes von oben — jede einzelne
// davon ist ein Fehlschlag, keine Randbemerkung.
//
// ── UND DESHALB `log.error` UND NICHT `log.warn` ──────────────────────────
// Mit `log.warn` war dieser Hoerer auf der Box GENAUSO STUMM wie gar keiner,
// und das ist gemessen, nicht befuerchtet (05.08.2026):
//
//   config/config.json des Abspieldienstes  ->  "logLevel": "error"
//   console-log-level bei level 'error'     ->  info und warn geben NICHTS aus
//
// Die Gegenprobe steht im journal: die Zeile „Wiedergabe-Maschine: …" eine
// Zeile weiter oben (`log.info`) erscheint dort seit jeher NICHT — waehrend
// die schlichten `console.log`-Zeilen („track name is …") jederzeit da sind.
// Der Rueckfall haette also auf einer Box mit aelterem mpv bei JEDEM Titel
// feuern koennen, ohne eine einzige Spur zu hinterlassen; genau das, was der
// Kommentar oben ausschliessen wollte.
//
// KEIN LAERM: im Regelfall kommt hier nichts an (siehe oben). Und wer
// `logLevel` auf 'error' stellt, will Fehler sehen — das hier SIND welche.
player.on('stderr', (s: any) => {
  const t = String(s ?? '').trim()
  if (t) log.error(`[Spotify Control] Player: ${t}`)
})

app.use(express.urlencoded({ extended: true }))
app.use(express.json())
app.use((_req: any, res: any, next: any) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept')
  next()
})

const spotifyApi = new SpotifyWebApi({
  clientId: config.spotify.clientId,
  clientSecret: config.spotify.clientSecret,
  refreshToken: config.spotify.refreshToken,
})

/* sets and refreshes access token every hour */
// A failing Spotify auth (e.g. no/invalid credentials) must not crash the whole
// player: refreshToken() rejects on failure, and these fire-and-forget calls
// left the rejection unhandled -> Node 22 exits the process (B2 finding). Catch
// it so the generic mplayer path (local/radio/rss) keeps working without Spotify.
refreshToken().catch((err: any) => log.warn(`Initial Spotify token refresh failed: ${err?.message ?? err}`))
setInterval(
  () => {
    refreshToken().catch((err: any) => log.warn(`Spotify token refresh failed: ${err?.message ?? err}`))
  },
  1000 * 60 * 60,
)

// Bounded "Device not found" retry (see handleSpotifyError): a freshly
// (re)connected Web-SDK device may not be targetable for a moment.
const DEVICE_RETRY_MAX = 5
const DEVICE_RETRY_DELAY_MS = 1200
let deviceRetry = 0

/**
 * Wann und wo der letzte Spotify-Start ausgeloest wurde.
 *
 * Braucht `fortschritt.richtig`, um Spotifys verspaetete Antworten zu
 * erkennen: die Schnittstelle meldet nach einem Start noch Sekunden lang die
 * Position des VORIGEN Stuecks (am Geraet gemessen: 105 s statt 0,9 s), und
 * die Fortschrittsleiste schnellte dadurch von hinten nach vorn.
 */
let startpunkt: { seit: number; ab: number } = { seit: 0, ab: 0 }

const apiAccessToken: { accessToken: string | null; expires: number } = {
  accessToken: null,
  expires: Date.now(),
}

player.on('percent_pos', (val: any) => {
  //console.log('track progress is', val);
  currentMeta.progressTime = val
})
// Absolute track time for the full-width status strip (elapsed / duration /
// "ends at HH:MM"): mplayer reports time_pos + length in seconds.
player.on('time_pos', (val: any) => {
  currentMeta.timePos = val
})
player.on('length', (val: any) => {
  currentMeta.duration = val
})
setInterval(() => {
  player.getProps(['percent_pos', 'time_pos', 'length'])
}, 1000)

/* ══ LEERLAUF IST KEINE WIEDERGABE (E109) ══════════════════════════════════
 *
 * Betreiber-Fund (31.08.2026, Minuten nach der E108-Auslieferung): „beim
 * stop springen die titel". Am Geraet zerlegt (Sonden B/A/C, datei- wie
 * m3u-Weg): der TON stoppt sauber — aber `playing` stand nach JEDEM
 * mpv-Stop dauerhaft wieder auf true. Der Hergang: `stop()` schreibt
 * playing=false, eine Sekunde spaeter fragt der Takt unten `pause` ab, und
 * mpvs `pause` ist im IDLE false — der Hoerer machte daraus „spielt". Mit
 * leerem Titel/leerer Nummer daneben sprang die Anzeige.
 *
 * `idle-active` ist die ehrliche Auskunft und GEWINNT: solange mpv leer
 * laeuft, bleibt playing aus, egal was der pause-Poll sagt. Der
 * mplayer-Aufsatz kennt die Eigenschaft nicht und meldet sie nie —
 * `mpvLeerlauf` bleibt dort false, alles wie bisher. */
let mpvLeerlauf = false
player.on('idle_active', (val: any) => {
  mpvLeerlauf = val === true
  if (mpvLeerlauf) currentMeta.playing = false
})
player.on('pause', (val: any) => {
  if (mpvLeerlauf) return
  currentMeta.playing = !val
})
setInterval(() => {
  // Die Stelle in der Warteschlange MITFRAGEN. Sie ist die einzige ehrliche
  // Quelle fuer "Titel n von m" - siehe den Kommentar am metadata-Ereignis.
  // `idle_active` steht mit dabei: beobachtet wird es ohnehin, aber der
  // Poll traegt es auch dann, wenn ein Beobachter-Ereignis verlorenging.
  player.getProps(['pause', 'playlist_pos', 'playlist_count', 'idle_active'])
}, 1000)

/**
 * Titelnummer und Gesamtzahl - von mpv erfragt, nicht gezaehlt.
 *
 * GEMESSEN AM GERAET (2026-07-28), Album mit 12 Titeln, gestartet wie die
 * Oberflaeche es tut: gemeldet wurde "Titel 3 von 0", richtig war "1 von 12".
 * Die Nummer entstand durch Hochzaehlen bei JEDEM metadata-Ereignis, und mpv
 * meldet fuer EINE Datei mehrere; die Gesamtzahl wurde nie gesetzt.
 *
 * `mplayerZaehlt` haelt den alten Weg fuer den mplayer-Aufsatz offen: der
 * kennt diese Eigenschaften nicht, meldet sie also nie, und dort soll die
 * Anzeige nicht schlechter werden als vorher.
 */
let mplayerZaehlt = true
player.on('playlist_pos', (val: any) => {
  const n = Number(val)
  if (!Number.isFinite(n) || n < 1) return
  mplayerZaehlt = false
  currentMeta.currentTracknr = n
})
player.on('playlist_count', (val: any) => {
  const n = Number(val)
  if (!Number.isFinite(n) || n < 1) return
  currentMeta.totalTracks = n
})

player.on('metadata', (val: any) => {
  console.log('track metadata is', val)
  //currentMeta.currentTracknr = parseInt(val.Comment?.split(',').pop(), 10);
  // NUR NOCH FUER mplayer: dort gibt es playlist-pos nicht. Mit mpv liefert
  // der Player die Stelle selbst, und Hochzaehlen waere schlicht falsch -
  // gezaehlt wuerden Ereignisse, nicht Titel.
  if (mplayerZaehlt) {
    currentMeta.currentTracknr = Number(currentMeta.currentTracknr) + 1
  }
  log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Current Tracknr: ${currentMeta.currentTracknr}`)
  // 'ard' STEHT HIER MIT (04.08.2026, E4/A5): der Titel einer ARD-Folge kommt
  // vom Befehl, nicht aus der Datei. Die Ausspielpartner der ARD liefern
  // MP3-Merkmale, die den Sendungsnamen tragen ("MausZoom — Kindernachrichten")
  // statt den Folgentitel — genau die Doppelung, die `titleClean` in ard.ts
  // wegnimmt. Ohne diese Zeile schriebe der erste Metadaten-Ruf sie zurueck.
  // 'datei' (E108) steht mit in der Reihe: der Titel einer Misch-Spur kommt
  // aus dem Befehl (force-media-title), nicht aus dem Datei-Tag — sonst
  // ueberschriebe der erste Metadaten-Ruf den gewaehlten Namen.
  if (
    currentMeta.currentType !== 'rss' &&
    currentMeta.currentType !== 'radio' &&
    currentMeta.currentType !== 'jellyfin' &&
    currentMeta.currentType !== 'ard' &&
    currentMeta.currentType !== 'datei'
  ) {
    currentMeta.currentTrackname = val.Title
  }
})
player.on('track-change', () => player.getProps(['metadata']))

// ── F1: DER TITELNAME GEHT JETZT MIT ──────────────────────────────────────
// GEMESSEN (05./06.08.2026 an der Box, mpv 0.40.0, zweimal an verschiedenen
// Quellen): `currentTracknr`, `duration` und `timePos` folgen einem Uebergang
// von selbst, `currentTrackname` NIE. Er wird oben ALLEIN aus dem Befehl
// gesetzt — rueckt mpv selbst weiter, bleibt er stehen. Ab dem zweiten Titel
// stand im Player also dauerhaft der falsche Name; seit das Cover der
// Position folgt, widerspricht sich die Anzeige sogar sichtbar (Bild von
// Folge N unter dem Namen von Folge 1).
//
// WARUM NICHT `metadata`: dort steht bei der ARD die Doppelung
// „Zu Besuch | Die Maus zum Hoeren (…)", die `titleClean` in ard.ts gerade
// wegnimmt. Deshalb schliesst der metadata-Hoerer oben 'ard' aus, und das
// bleibt so. Statt mpv zu FRAGEN, bekommt es den Namen beim Einreihen GESAGT
// (`force-media-title`, siehe `ladeBefehl` in mpv-protokoll.ts) und meldet ihn
// am Uebergang von selbst zurueck.
//
// DIE WEICHE STEHT AUF DEN BEIDEN TYPEN, DENEN WIR DEN NAMEN AUCH MITGEBEN.
// Bei 'local' kommt der Name aus der Datei und ist dort richtig; bei
// 'radio'/'rss' gibt es nur einen einzigen Eintrag und `media-title` traegt
// den ICY-Text des Senders. Ohne diese Weiche schriebe der Hoerer beides um.
//
// Der leere und der fehlende Wert kommen hier gar nicht erst an: mpv schiebt
// ZWISCHEN zwei Titeln `media-title = null`, und der Wrapper schluckt das
// (darfGemeldetWerden). Die Pruefung steht hier trotzdem — ein toter Dienst
// ist zu teuer, um an genau einer Schicht zu haengen (siehe filename).
player.on('media_title', (val: any) => {
  if (typeof val !== 'string' || !val) return
  // 'datei' (E108) gehoert zu den Typen, denen der Name MITGEGEBEN wird —
  // ohne diesen Eintrag kaeme force-media-title beim automatischen
  // Weiterruecken der Mischliste nie an, und ab Titel 2 stuende dauerhaft
  // der Name von Titel 1 (exakt der F1-Fehler von oben).
  if (
    currentMeta.currentType !== 'jellyfin' &&
    currentMeta.currentType !== 'ard' &&
    currentMeta.currentType !== 'datei'
  )
    return
  currentMeta.currentTrackname = val
})
player.on('track-change', () => player.getProps(['media_title']))

//player.on('length', console.log)
//player.on('track-change', () => player.getProps(['length']))

player.on('filename', (val: any) => {
  console.log('track name is', val)
  // Zweite Absicherung gegen die Absturzschleife vom 2026-07-27: mpv meldet
  // filename/path im Leerlauf als null, und `null.split` beendet den Prozess.
  // Der Wrapper schluckt das inzwischen (darfGemeldetWerden), aber ein toter
  // Dienst ist zu teuer, um an genau einer Schicht zu haengen.
  if (typeof val !== 'string') return
  if (!currentMeta.currentTrackname) {
    currentMeta.currentTrackname = val
      .split('.mp3')[0]
      .split('.flac')[0]
      .split('.wma')[0]
      .split('.wav')[0]
      .split('.m4a')[0]
  }
})
player.on('track-change', () => player.getProps(['filename']))

player.on('path', (val: any) => {
  console.log('track path is', val)
  if (typeof val !== 'string') return // siehe filename-Hoerer
  // UND HIER IST 'ard' NICHT KOSMETIK: `val.split('/')[7]` ist auf den
  // Verzeichnisbaum lokaler Aufnahmen gemuenzt. Auf eine Akamai-Adresse
  // angewendet steht danach ein Zahlenordner als „Album" in der Oberflaeche —
  // dieselbe Falle, wegen der rss/radio/jellyfin schon hier stehen.
  // 'datei' (E108) ebenfalls: das Album einer Misch-Spur steht im Befehl
  // (`:title:artist:`-Schwanz), und Index 7 eines freien Dateipfads ist
  // irgendein Segment — dieselbe Falle wie bei der Akamai-Adresse.
  if (
    currentMeta.currentType !== 'rss' &&
    currentMeta.currentType !== 'radio' &&
    currentMeta.currentType !== 'jellyfin' &&
    currentMeta.currentType !== 'ard' &&
    currentMeta.currentType !== 'datei'
  ) {
    currentMeta.album = val.split('/')[7]
  }
})
player.on('track-change', () => player.getProps(['path']))

player.on('track-change', () => {
  if (
    muPiBoxConfig.telegram.active &&
    //network.onlinestate === 'online' &&
    muPiBoxConfig.telegram.token.length > 1 &&
    muPiBoxConfig.telegram.chatId.length > 1 &&
    (currentMeta.currentType === 'rss' || currentMeta.currentType === 'radio')
  )
    cmdCall('/usr/bin/python3 /usr/local/bin/mupibox/telegram_Track_RSS_Radio.py')
  if (
    muPiBoxConfig.telegram.active &&
    //network.onlinestate === 'online' &&
    muPiBoxConfig.telegram.token.length > 1 &&
    muPiBoxConfig.telegram.chatId.length > 1 &&
    currentMeta.currentType === 'local'
  )
    cmdCall('/usr/bin/python3 /usr/local/bin/mupibox/telegram_Track_Local.py')
})

// Lautstaerke im Sekundentakt nachlesen.
//
// HIER STAND EIN `throw e` IM RUECKRUF — und das beendet in Node den ganzen
// Prozess. Am Geraet erlebt (2026-07-27): sobald die Ausgabe auf Bluetooth
// stand, endete `amixer sget Master | grep 'Right:'` mit Code 1 (der
// softvol-Regler meldet dann keine "Right:"-Zeile), der Dienst starb, pm2
// startete neu, eine Sekunde spaeter dasselbe. Ergebnis: eine Absturzschleife
// alle ~20 s, in der KEIN Befehl mehr ankam — Pause, Stop, Titelwechsel, alles
// lief ins Leere. Der sichtbare Fehler war „der Knopf wird gruen und dann
// wieder rot": die Oberflaeche schaltet optimistisch um, die naechste Abfrage
// holt den alten Zustand zurueck.
//
// Eine Lautstaerke, die sich nicht auslesen laesst, ist ein Schoenheitsfehler.
// Ein toter Wiedergabedienst ist keiner. Deshalb: nie werfen, letzten
// bekannten Wert behalten, und nur gelegentlich meckern (sonst schreibt es
// sekuendlich das Protokoll voll).
let volumeFehlerZaehler = 0
setInterval(() => {
  const exec = require('node:child_process').exec
  exec(lautstaerkeLies, (e: any, stdout: any, _stderr: any) => {
    if (e) {
      if (volumeFehlerZaehler++ % 60 === 0) {
        log.debug(
          `${new Date().toLocaleString()}: [Spotify Control] Lautstaerke nicht lesbar (${volumeFehlerZaehler}x): ${e.message}`,
        )
      }
      return
    }
    volumeFehlerZaehler = 0
    // ZWEI Formate moeglich: das Werkzeug liefert eine blanke Zahl ("64"),
    // der amixer-Rueckfall die Form `[64%]`. Beides annehmen — sonst meldet
    // der Player 0, obwohl die Lautstaerke stimmt (genau so passiert).
    currentMeta.volume = lautstaerkeAusText(String(stdout || '')) ?? currentMeta.volume
  })
}, 1000)

let activeDevice: string | null = null

const nowDate = new Date()
const volumeStart = 99
let playerstate = ''
let spotifyRunning = false
let date = ''
const counter = {
  countgetMyCurrentPlaybackState: 0,
  countgetMyCurrentPlaybackStateHTTP: 0,
  countfreshAccessToken: 0,
  countsetAccessToken: 0,
  counterror: 0,
  counterrorAccessToken: 0,
  counterrorInvalidID: 0,
  counterrorNoActivDevice: 0,
  countgetAlbum: 0,
  countgetArtist: 0,
  countgetMyDevices: 0,
  countpause: 0,
  countplay: 0,
  countseek: 0,
  countsetShuffle: 0,
  countsetVolume: 0,
  countskipToNext: 0,
  countskipToPrevious: 0,
  counterrorToManyRequest: 0,
  counttransferMyPlayback: 0,
}
// The live player state, serialized as-is to GET /local. Several numeric-ish
// fields are reset to '' on stop and hold a number during playback, so they are
// genuinely a number|string union (kept faithful to the legacy behaviour).
interface CurrentMeta {
  activeSpotifyId: string
  currentPlayer: string
  currentType: string
  playing: boolean
  pause: boolean
  album: string
  path: string
  currentTrackname: string
  currentTracknr: number | string
  totalTracks: number | string
  progressTime: number | string
  timePos: number
  duration: number
  volume: number
  recording: boolean
}
const currentMeta: CurrentMeta = {
  activeSpotifyId: '',
  currentPlayer: '',
  currentType: '',
  playing: false,
  pause: false,
  album: '',
  path: '',
  currentTrackname: '',
  currentTracknr: 0,
  totalTracks: '',
  progressTime: '',
  timePos: 0,
  duration: 0,
  volume: 0,
  recording: false,
}

/** EIN Protokolleintrag, wenn der Pegel-Abgriff ausfaellt — siehe pegel.ts. */
const pegelProtokoll = (text: string) => log.warn(`${nowDate.toLocaleString()}: [Spotify Control] ${text}`)

function writeplayerstatePlay() {
  playerstate = 'play'
  // PEGEL AN — DIE EINE STELLE, DIE AUF "SPIELT" SCHALTET (BACKLOG E99).
  // Idempotent: laeuft der Abgriff schon, tut dieser Aufruf nichts.
  pegelStarten(pegelProtokoll)
  fs.writeFile('/tmp/playerstate', playerstate, (err: any) => {
    if (err) {
      console.error(err)
      return
    }
    log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Write play to /tmp/playerstate`)
  })
}

function writeplayerstatePause() {
  // Der Startpunkt gilt nur, solange wirklich gespielt wird. Ohne dieses
  // Loeschen wuerde `spieltWirklich` eine ECHTE Pause kurz nach dem Start als
  // veraltete Meldung abtun - ein Knopf, der eine gedrueckte Pause ignoriert,
  // waere schlimmer als einer, der kurz flackert.
  startpunktLoeschen()
  playerstate = 'pause'
  // PEGEL AUS — DIE EINE STELLE, DIE AUF "PAUSE/STOPP" SCHALTET (BACKLOG E99).
  // Idempotent, setzt sofort [0,0,0,0]; siehe pegel.ts.
  pegelStoppen()
  fs.writeFile('/tmp/playerstate', playerstate, (err: any) => {
    if (err) {
      console.error(err)
      return
    }
    log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Write play to /tmp/playerstate`)
  })
}

function writeCounter() {
  if (date === '') {
    const now = new Date()
    date = `${now.getFullYear()}_${now.getMonth() + 1}_${now.getDate()}_${now.getHours()}_${now.getMinutes()}_${now.getSeconds()}`
  }
  // FRUEHER /home/dietpi/.pm2/logs/. Das Verzeichnis gehoerte pm2 und entsteht
  // auf einer frisch aufgesetzten Box gar nicht mehr (llmwiki
  // mupi-startzeiten-gemessen: die Dienste laufen als systemd-Units, pm2 wird
  // nicht mehr installiert). Der Schreibversuch waere dann bei JEDEM Aufruf
  // fehlgeschlagen und haette das Journal mit ENOENT gefuellt.
  // /tmp passt ohnehin besser: den Zaehler liest niemand, er dient beim
  // Nachsehen am Geraet, und der Dateiname traegt schon die Startzeit — er ist
  // also von Haus aus je Lauf einer und darf mit dem Neustart verschwinden.
  const pathCounter = `/tmp/mupibox-zaehler-${date}.json`
  fs.writeFile(pathCounter, JSON.stringify(counter), (err: any) => {
    if (err) {
      console.error(err)
      return
    }
    //log.debug(nowDate.toLocaleString() + ": [Spotify Control] Write Counter to " + pathCounter);
  })
}

async function refreshToken() {
  return new Promise((resolve, reject) => {
    refreshTokenApi()
      .then((accessToken: string | null) => {
        setAccessToken(accessToken)
        resolve(accessToken)
      })
      .catch(() => reject())
  })
}

async function refreshTokenApi() {
  // The modern /spotify login is secret-LESS (Authorization Code + PKCE): with no
  // client secret configured, refresh via grant_type=refresh_token & client_id
  // only. The classic (admin spotify.php) flow keeps a secret → spotify-web-api-
  // node's Basic-auth refresh. Branch on which credentials the config carries.
  if (!config.spotify.clientSecret) {
    return pkceRefreshApi()
  }
  return spotifyApi.refreshAccessToken().then(
    (data: any) => {
      apiAccessToken.accessToken = data.body.access_token
      apiAccessToken.expires = Date.now() + data.body.expires_in * 1000
      return apiAccessToken.accessToken
    },
    (err: any) => {
      log.debug(`${nowDate.toLocaleString()}: Could not refresh access token`, err)
      throw err
    },
  )
}

// Live Spotify credentials for the PKCE refresh: the /spotify login saves the
// refresh token to the canonical /etc/mupibox/mupiboxconfig.json at RUNTIME
// (backend-api POST /api/spotify/config) — long after this process require()d
// its boot config. Read the canonical file FRESH on every refresh (then the
// local config copy, then the boot snapshot), so a reconnect works without a
// player restart and the sim's read-only seed config no longer yields empty
// credentials. (Spotify does not rotate PKCE refresh tokens on refresh —
// verified — so the disk copy stays authoritative.)
function freshSpotifyCreds(): { clientId: string; refreshToken: string } {
  const candidates = [
    // The modern /spotify PKCE login (backend-api POST /api/spotify/config) persists
    // {clientId, refreshToken} — with the `streaming` scope the Web Playback SDK
    // needs — into the backend-api's OWN config.json, and on a locked-down box it
    // CANNOT write the canonical /etc file (root/uid-33), so that stays a stale
    // legacy token. Read the backend-api config FIRST so playback uses the fresh
    // token; fall back to the canonical + our own boot config.
    '/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config/config.json',
    '/etc/mupibox/mupiboxconfig.json',
    `${configBasePath}/mupiboxconfig.json`,
  ]
  for (const p of candidates) {
    try {
      const sp = JSON.parse(fs.readFileSync(p, 'utf8'))?.spotify
      if (sp?.refreshToken && sp?.clientId) return { clientId: sp.clientId, refreshToken: sp.refreshToken }
    } catch (_e) {
      // missing/unreadable/invalid file → try the next source
    }
  }
  return { clientId: config.spotify.clientId || '', refreshToken: config.spotify.refreshToken || '' }
}

// Secret-less PKCE refresh (public client): POST the refresh token + client_id to
// Spotify's token endpoint directly. spotify-web-api-node's refresh sends the
// client secret (Basic auth), which a PKCE-issued token rejects. spotifyApi is
// still used for the actual API calls (via setAccessToken); only the refresh
// differs. Node's global fetch (server-side, no CORS).
async function pkceRefreshApi(): Promise<string> {
  const creds = freshSpotifyCreds()
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: creds.refreshToken,
    client_id: creds.clientId,
  }).toString()
  const resp = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    log.debug(`${nowDate.toLocaleString()}: PKCE token refresh failed: ${resp.status} ${text}`)
    throw new Error(`spotify_refresh_${resp.status}`)
  }
  const data: any = await resp.json()
  // Eine 200er Antwort OHNE Token ist kein Erfolg. Ohne diese Pruefung liefe
  // der Aufrufer mit null weiter und scheiterte erst irgendwo tief in einem
  // API-Aufruf — mit einer Meldung, die nichts mit der Ursache zu tun hat.
  const neu = typeof data?.access_token === 'string' ? data.access_token : ''
  if (!neu) {
    log.debug(`${nowDate.toLocaleString()}: PKCE token refresh returned no access_token`)
    throw new Error('spotify_refresh_no_token')
  }
  apiAccessToken.accessToken = neu
  apiAccessToken.expires = Date.now() + (data.expires_in ?? 3600) * 1000
  // Spotify may rotate the refresh token — keep the running session on the newest
  // one (persisting it across restarts is a follow-up).
  if (data.refresh_token) config.spotify.refreshToken = data.refresh_token
  return neu
}

function setAccessToken(token: string | null) {
  log.debug(`${nowDate.toLocaleString()}: The access token has been refreshed!`)
  counter.countfreshAccessToken++
  if (config.server.logLevel === 'debug') {
    writeCounter()
  }
  spotifyApi.setAccessToken(token)
  counter.countsetAccessToken++
  if (config.server.logLevel === 'debug') {
    writeCounter()
  }
  if (currentMeta.activeSpotifyId.includes('spotify:') && !spotifyRunning) {
    playMe()
  }
}

/*called in all error cases*/
/*token expired and no_device error are handled explicitly*/
function handleSpotifyError(err: any, from: string, _extra?: string) {
  if (err.body.error?.status === 401) {
    log.debug(`${nowDate.toLocaleString()}: access token expired, refreshing...`)
    log.debug(`${nowDate.toLocaleString()}: Error from: ${from}`)
    counter.counterrorAccessToken++
    if (config.server.logLevel === 'debug') {
      writeCounter()
    }
    if (currentMeta.activeSpotifyId !== '0') {
      refreshToken()
    }
  } else if (err.body.error?.status === 400) {
    log.debug(`${nowDate.toLocaleString()}: invalid id`)
    log.debug(`${nowDate.toLocaleString()}: Error from: ${from}`)
    log.debug(`${nowDate.toLocaleString()}: ${err}`)
    counter.counterrorInvalidID++
    if (config.server.logLevel === 'debug') {
      writeCounter()
    }
    if (currentMeta.activeSpotifyId !== '0') {
      setActiveDevice()
    }
  } else if (err.body.error?.status === 429) {
    log.debug(`${nowDate.toLocaleString()}: To many requests on th spotify web api`)
    log.debug(`${nowDate.toLocaleString()}: Error from: ${from}`)
    log.debug(`${nowDate.toLocaleString()}: ${err}`)
    counter.counterrorToManyRequest++
    if (config.server.logLevel === 'debug') {
      writeCounter()
    }
    //setTimeout(function(){
    //
    //},2000)
  } else if (err.toString().includes('NO_ACTIVE_DEVICE')) {
    log.debug(`${nowDate.toLocaleString()}: no active device, setting the first one found to active`)
    log.debug(`${nowDate.toLocaleString()}: Error from: ${from}`)
    log.debug(`${nowDate.toLocaleString()}: playID: ${currentMeta.activeSpotifyId}`)
    counter.counterrorNoActivDevice++
    if (config.server.logLevel === 'debug') {
      writeCounter()
    }
    if (currentMeta.activeSpotifyId !== '0') {
      // Kennung neu holen und ABSPIELEN - nicht uebernehmen (siehe playMe).
      activeDevice = null
      if (currentMeta.activeSpotifyId.includes('spotify:')) geraetAufloesen(playMe)
      else geraetAufloesen(() => undefined)
    }
  } else if (err.toString().includes('Device not found')) {
    // A just-(re)connected Web-SDK device can take a moment before Spotify
    // Connect can target it. Retry the play on the REAL device (playMe uses
    // activeDevice) a few times with a delay. The legacy code passed the
    // spotify URI (currentMeta.activeSpotifyId) as device_id — which can never
    // succeed — and re-entered this handler on its own error: an infinite
    // request loop against the Web API.
    log.debug(`${nowDate.toLocaleString()}: Device not found (retry ${deviceRetry + 1}/${DEVICE_RETRY_MAX}): ${err}`)
    log.debug(`${nowDate.toLocaleString()}: Error from: ${from}`)
    counter.counterror++
    if (config.server.logLevel === 'debug') {
      writeCounter()
    }
    if (deviceRetry < DEVICE_RETRY_MAX && currentMeta.activeSpotifyId.includes('spotify:')) {
      deviceRetry++
      // Die gemerkte Kennung ist verbrannt (librespot neu gestartet = neue
      // Kennung). Verwerfen, damit der naechste Versuch sie neu aufloest -
      // sonst laufen alle Wiederholungen in dieselbe tote Kennung.
      activeDevice = null
      setTimeout(() => playMe(), DEVICE_RETRY_DELAY_MS)
    } else {
      log.debug(`${nowDate.toLocaleString()}: Device still not found after ${DEVICE_RETRY_MAX} retries, giving up`)
      deviceRetry = 0
    }
  } else {
    log.debug(`${nowDate.toLocaleString()}: an error occured: ${err}`)
    log.debug(`${nowDate.toLocaleString()}: ${err}`)
    log.debug(`${nowDate.toLocaleString()}: Error from: ${from}`)
    counter.counterror++
    if (config.server.logLevel === 'debug') {
      writeCounter()
    }
  }
}

/** Der Geraetename der Box (mupibox.host) — das librespot-Geraet heisst so. */
function boxDeviceName(): string {
  try {
    const mc = JSON.parse(fs.readFileSync('/etc/mupibox/mupiboxconfig.json', 'utf8'))
    return String(mc?.mupibox?.host || '').trim()
  } catch {
    return ''
  }
}

/**
 * Die eigene Box in Spotifys Geraeteliste finden und merken - ohne Uebernahme.
 *
 * Bewusst getrennt von setActiveDevice(): jenes uebernimmt die Wiedergabe
 * (transferMyPlayback), was ein frisch gestartetes librespot lahmlegt (siehe
 * Kommentar in playMe). Zum Abspielen genuegt die Kennung.
 *
 * WELCHES Geraet es ist, entscheidet `geraetWaehlen` (spotify-web.ts, rein und
 * geprueft) — dieselbe Funktion, die der Waechter vor dem Abspielen fragt.
 * HIER STAND `geraete[0]` ALS RUECKFALL, und der hatte zwei Gesichter: bei
 * einem umbenannten Boxnamen war er richtig (librespot meldet bis zum Neustart
 * den alten Namen), bei fremden Geraeten in der Liste schickte er die
 * Wiedergabe ins Nachbarzimmer. Jetzt faellt er nur noch zurueck, wenn es
 * NICHTS ANDERES gibt.
 */
function geraetAufloesen(danach: () => void) {
  spotifyApi.getMyDevices().then(
    (data: any) => {
      counter.countgetMyDevices++
      if (config.server.logLevel === 'debug') {
        writeCounter()
      }
      const wahl = geraetWaehlen(data.body.devices || [], boxDeviceName())
      // OHNE KENNUNG IST ES KEIN GERAET. Spotify darf `id` null lassen, und
      // vorher landete dieses null unbesehen in `activeDevice` — der folgende
      // Abspielbefehl ging dann mit `device_id: undefined` hinaus und traf
      // irgendetwas oder nichts.
      const kennung = wahl.geraet?.id
      if (!kennung) {
        log.debug(
          `${nowDate.toLocaleString()}: [Spotify Control] ${
            wahl.wie === 'keine-geraete'
              ? 'Keine Geraete - spielt librespot?'
              : `Kein brauchbares Geraet (${wahl.wie}), Boxname "${boxDeviceName()}" - es wird nicht geraten`
          }`,
        )
        return
      }
      activeDevice = kennung
      log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Geraet (${wahl.wie}): ${activeDevice}`)
      danach()
    },
    (err: any) => {
      log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Geraeteliste nicht lesbar: ${err}`)
      handleSpotifyError(err, 'getMyDevices')
    },
  )
}

/**
 * NUR DAS EIGENE GERAET WIRD GESTEUERT (14.08.2026).
 *
 * Jeder Spieler-Befehl ohne device_id wirkt auf das AKTIVE Geraet des
 * Kontos — und das ist die Soundbar im Wohnzimmer, sobald dort jemand hoert.
 * Die Box war damit eine Fernbedienung fuer fremde Lautsprecher: Play/Pause/
 * Weiter auf der Box steuerte das Wohnzimmer (Betreiber, 14.08.2026: "ich
 * will nicht auf anderen lautsprechern spielen"). Deshalb traegt ab jetzt
 * JEDER Befehl die eigene Kennung — und wo sie fehlt, wird NICHT gesendet:
 * lieber still mit lesbarem Grund als Ton im falschen Zimmer (dieselbe
 * Regel, mit der geraetWaehlen schon nicht raet).
 *
 * DER GEWOLLTE NEBENEFFEKT beim Fortsetzen: play({device_id}) HOLT eine
 * gerade anderswo laufende Wiedergabe auf die Box ZURUECK — Spotify
 * transferiert den laufenden Zusammenhang auf das genannte Geraet. Genau
 * das gewuenschte "er soll sich das Abspielen wieder holen". Die andere
 * Richtung bleibt offen: Fremde duerfen weiter AUF die Box werfen
 * (librespot/Connect); nur nach draussen steuert die Box nie.
 */
function eigeneKennung(was: string): { device_id: string } | null {
  if (activeDevice) return { device_id: activeDevice }
  log.warn(
    `${nowDate.toLocaleString()}: [Spotify Control] ${was}: kein eigenes Geraet aufgeloest — ` +
      'der Befehl wird NICHT an das aktive (womoeglich fremde) Geraet gesendet',
  )
  // Fuer den naechsten Versuch schon einmal nachschlagen — der Fehlgriff
  // heilt sich damit beim folgenden Tastendruck von selbst.
  geraetAufloesen(() => undefined)
  return null
}

/*queries all devices and transfers playback to the box's own librespot device*/
function setActiveDevice() {
  // If activeDevice is not set, get available devices and pick the box's own
  if (!activeDevice || activeDevice === '') {
    spotifyApi.getMyDevices().then(
      (data: any) => {
        counter.countgetMyDevices++
        if (config.server.logLevel === 'debug') {
          writeCounter()
        }
        // DIESELBE WAHL WIE OBEN. NAME VOR REIHENFOLGE: devices[0] war frueher
        // richtig, weil die Box meist das einzige Geraet war. Heute stehen dort
        // auch Geister (ein Browser-Tab vom Rechner, das Telefon der Eltern) —
        // landete die Wiedergabe auf so einem, "spielte" Spotify unsichtbar
        // woanders. Und hier waere das schlimmer als in geraetAufloesen: es
        // folgt eine UEBERNAHME, die Wiedergabe zoege also aktiv dorthin um.
        const wahl = geraetWaehlen(data.body.devices || [], boxDeviceName())
        const kennung = wahl.geraet?.id
        if (!kennung) {
          log.debug(`${nowDate.toLocaleString()}: [Spotify Control] No usable device found (${wahl.wie})`)
          return
        }
        activeDevice = kennung
        log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Selected device (${wahl.wie}): ${activeDevice}`)
        // Now transfer playback to the selected device
        transferPlaybackToActiveDevice()
      },
      (err: any) => {
        log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Error getting devices: ${err}`)
        handleSpotifyError(err, 'getMyDevices')
      },
    )
  } else {
    // activeDevice is already set, proceed with transfer
    transferPlaybackToActiveDevice()
  }
}

function transferPlaybackToActiveDevice() {
  spotifyApi.transferMyPlayback([activeDevice]).then(
    () => {
      counter.counttransferMyPlayback++
      if (config.server.logLevel === 'debug') {
        writeCounter()
      }
      log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Transfering playback to ${activeDevice}`)
      if (currentMeta.activeSpotifyId.includes('spotify:')) {
        if (currentMeta.pause) {
          play()
        } else {
          playMe()
        }
      }
    },
    (err: any) => {
      handleSpotifyError(err, 'transferMyPlayback')
    },
  )
}

function pause() {
  if (
    muPiBoxConfig.telegram.active &&
    //network.onlinestate === 'online' &&
    muPiBoxConfig.telegram.token.length > 1 &&
    muPiBoxConfig.telegram.chatId.length > 1
  )
    cmdCall('/usr/bin/python3 /usr/local/bin/mupibox/telegram_send_message.py "Pause"')
  currentMeta.pause = true
  if (currentMeta.currentPlayer === 'spotify') {
    const geraet = eigeneKennung('pause')
    if (!geraet) return
    spotifyApi.pause(geraet).then(
      () => {
        counter.countpause++
        if (config.server.logLevel === 'debug') {
          writeCounter()
        }
        log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Playback paused`)
        writeplayerstatePause()
      },
      (err: any) => {
        handleSpotifyError(err, 'pause')
      },
    )
  } else if (istDateiSpieler(currentMeta.currentPlayer)) {
    if (player.pauseAn) {
      // ABSOLUT statt Umschalter (15.08.2026): `cycle pause` hinter dem
      // Merkfeld `playing` kann kippen — einmal auseinander, pausiert das
      // naechste „Pause" ausgerechnet NICHT, und mpvs pause-Eigenschaft
      // ueberlebt dann sogar den naechsten Titel (klebrig, siehe Wrapper).
      player.pauseAn()
      writeplayerstatePause()
    } else if (currentMeta.playing) {
      player.playPause()
      //currentMeta.playing = false;
      writeplayerstatePause()
    }
  }
}

/**
 * WIE LANGE `stop` HOECHSTENS AUF SPOTIFY WARTET.
 *
 * DAS IST EINE OBERGRENZE, KEINE WARTEZEIT — im Alltag kostet sie nichts.
 * Gemessen am 04.08.2026 von der Box .169 aus (tools/pause-zeitschranke-messen.mjs,
 * fuenf Runden `PUT /v1/me/player/pause`): Rundlauf 76 bis 93 ms, davon
 * 46 bis 59 ms TLS. Die Frist ist also das Sechzehnfache des gemessenen
 * Schlimmsten — reichlich Luft fuer ein muedes WLAN.
 *
 * WARUM ES SIE UEBERHAUPT BRAUCHT: `spotifyApi.pause()` hat KEINE eigene
 * Frist. http-manager.js der Bibliothek ruft `.timeout()` nirgends auf, und
 * ohne diesen Aufruf setzt superagent keine. Es entscheidet dann allein der
 * Kern, und der laesst sich Zeit (ebenfalls 04.08.2026 gemessen):
 *
 *     Wirt nimmt an und SCHWEIGT               laeuft nach 201 s noch
 *     Adresse geroutet, aber tot — AUF DER BOX 134,8 s
 *
 * Die 134,8 s sind genau die sechs Wiederholungen des Verbindungsaufbaus
 * (`tcp_syn_retries=6` auf der Box). Und `stop` geht bei JEDEM Kacheltipp
 * hinaus — ohne Schranke haette ein DSL-Ausfall jeden Antipper zwei Minuten
 * lang haengen lassen. Das waere schlimmer als der Fehler, der hier repariert
 * wird.
 *
 * DIE ZAHL IST NICHT NEU ERFUNDEN: 1500 ms stehen in diesem Projekt schon
 * zweimal fuer „zwei Spotify-Befehle brauchen Abstand" (`springen.loslassen`
 * und `SPOTIFY_ATEMPAUSE_MS` in NewDesign/app.js). Hier bedeuten sie etwas
 * Besseres — die Oberflaeche SASS diese Zeit ab, dieser Dienst wartet nur, bis
 * er sie braucht.
 */
const ANHALTE_FRIST_MS = 1500

/** Zwischenspeicher der fremden Lage fuer /state und /local (2 s, s. u.). */
const fremdeLageMerk: { wert: { spielt: boolean; titel: string; interpret: string } | null; zeit: number } = {
  wert: null,
  zeit: 0,
}

/**
 * Die lokale Spielstand-Auskunft des Servers — mit kurzer Frist und 2-s-
 * Zwischenspeicher: /state wird alle 250 ms gefragt, und die Auskunft
 * selbst liest nur den ohnehin gehaltenen WebSocket-Stand (E75).
 * Scheitert sie (Server gerade im Tausch), gilt „keine fremde Wiedergabe"
 * — exakt das Verhalten vor E104, nie schlechter.
 */
async function fremdeLageHolen(fristMs = 600): Promise<{ spielt: boolean; titel: string; interpret: string } | null> {
  const jetzt = Date.now()
  if (jetzt - fremdeLageMerk.zeit < 2000) return fremdeLageMerk.wert
  fremdeLageMerk.zeit = jetzt
  try {
    // Die Frist ist ein PARAMETER: fuer die /state-Verzierung reichen 600 ms
    // (fehlt die Auskunft, fehlt eben das Feld), aber der STOPP darf so
    // lange warten wie die Pause selbst — ohne lokalen soloist-Draht geht
    // /laeuft ueber die Web-API, und die brauchte am 30.08.2026 regelmaessig
    // laenger als 600 ms: der erste Ernstfall-Stopp kehrte deshalb WORTLOS
    // um, waehrend der Geist weiterspielte.
    const a = await fetch('http://127.0.0.1:8200/api/spotify/laeuft', { signal: AbortSignal.timeout(fristMs) })
    if (!a.ok) {
      fremdeLageMerk.wert = null
      return null
    }
    const s = (await a.json()) as { spielt?: boolean; aufDieserBox?: boolean; titel?: string; interpret?: string }
    fremdeLageMerk.wert = sollFremdePauseSenden(s)
      ? { spielt: true, titel: String(s.titel ?? ''), interpret: String(s.interpret ?? '') }
      : null
  } catch {
    log.debug(`${nowDate.toLocaleString()}: [Spotify Control] E104: laeuft-Auskunft nicht zu bekommen (${fristMs} ms)`)
    fremdeLageMerk.wert = null
  }
  return fremdeLageMerk.wert
}

/**
 * E104: Soloists EIGENER Steuerkanal — der einzige, der den gemessenen
 * Ernstfall wirklich trifft. Am 30.08.2026 am lebenden Geist bewiesen:
 * die Geraeteliste des WEB-API-Kontos enthielt nur eine fremde Soundbar
 * und KEINE MixPiBox — Soloist meldet sich mit einem EIGENEN Schluessel
 * an, und dessen Konto muss nicht das der Web-API sein. Eine
 * Web-API-Pause kann diese Wiedergabe also prinzipiell nie erreichen;
 * `soloist ctl pause` hielt sie im Handversuch augenblicklich an.
 * `-D` zeigt auf das StateDirectory der Unit (dort liegt die
 * WebSocket-Portdatei, siehe llmwiki soloist-erste-messung).
 */
function soloistPause(): Promise<boolean> {
  return new Promise((fertig) => {
    childProcess.execFile(
      '/usr/local/bin/soloist',
      ['ctl', 'pause', '-D', '/var/lib/soloist'],
      { timeout: ANHALTE_FRIST_MS },
      (err: unknown) => fertig(!err),
    )
  })
}

/** E104: fremde Spotify-Wiedergabe AUF DIESER BOX anhalten (Begruendung oben). */
async function fremdeWiedergabeAnhalten(): Promise<void> {
  fremdeLageMerk.zeit = 0 // frisch fragen — ein Stopp verdient die Wahrheit von jetzt
  const lage = await fremdeLageHolen(ANHALTE_FRIST_MS)
  if (!lage?.spielt) return
  // ERST DER VENDOR-KANAL (Begruendung an `soloistPause`), DANN nachmessen:
  // hat er getroffen, ist hier Schluss. Nur wenn danach immer noch etwas
  // spielt (andere Engine, ctl nicht da), versucht es der Web-API-Weg.
  if (await soloistPause()) {
    fremdeLageMerk.zeit = 0
    const danach = await fremdeLageHolen(ANHALTE_FRIST_MS)
    if (!danach?.spielt) {
      log.info(
        `${nowDate.toLocaleString()}: [Spotify Control] E104: fremde Wiedergabe per soloist ctl angehalten (${lage.titel})`,
      )
      fremdeLageMerk.wert = null
      writeplayerstatePause()
      return
    }
  }
  // DAS GERAET WIRD AUFGELOEST WIE IM SPOTIFY-ZWEIG (E40/F2-Muster): ein
  // frisch getauschter Player kennt sein eigenes Geraet noch nicht
  // (`activeDevice` leer), und eine Pause ohne Geraet starb beim ersten
  // Ernstfall leise (30.08.2026 am lebenden Geist gemessen — Antwort 200,
  // Konto spielte weiter). `geraetAufloesen` waehlt am NAMEN das
  // box-eigene Geraet; ein fremdes trifft es nie.
  let geraet = eigeneKennung('stop-fremd')
  if (!geraet) {
    const nachschlag = await mitZeitschranke(
      new Promise<void>((gefunden) => geraetAufloesen(gefunden)),
      ANHALTE_FRIST_MS,
    )
    if (nachschlag.art === 'fertig' && activeDevice) geraet = { device_id: activeDevice }
  }
  if (!geraet) {
    log.warn(
      `${nowDate.toLocaleString()}: [Spotify Control] E104: kein eigenes Geraet aufloesbar — fremde Wiedergabe bleibt stehen`,
    )
    return
  }
  log.info(
    `${nowDate.toLocaleString()}: [Spotify Control] E104: fremde Spotify-Wiedergabe wird angehalten (${lage.titel})`,
  )
  try {
    await mitZeitschranke(
      spotifyApi.pause(geraet).then(
        () => {
          fremdeLageMerk.wert = null
          writeplayerstatePause()
        },
        (err: any) => {
          handleSpotifyError(err, 'stop-fremd')
          throw err
        },
      ),
      ANHALTE_FRIST_MS,
    )
  } catch (err) {
    // handleSpotifyError hat protokolliert, falls die ABLEHNUNG von Spotify
    // kam; ein frueher Wurf (z. B. im Wrapper) stuende sonst NIRGENDS.
    log.warn(
      `${nowDate.toLocaleString()}: [Spotify Control] E104: Pause nicht bestaetigt: ${(err as Error)?.message ?? err}`,
    )
  }
}

/**
 * Wie das Anhalten ausging. Der Wert geht in die Antwort auf `stop` — die
 * Oberflaeche kann daran ablesen, ob sie noch selbst Abstand halten muss.
 */
type AnhalteAusgang = 'nichts-zu-tun' | 'bestaetigt' | 'fehlgeschlagen' | 'frist-abgelaufen'

/**
 * ANHALTEN — UND ERST DANN ANTWORTEN.
 *
 * DAS WAR DER FEHLER (BACKLOG E24, llmwiki weiterhoeren-stop-und-start-im-wettlauf,
 * am Geraet gemessen 03.08.2026): Diese Funktion rief `spotifyApi.pause()` und
 * wartete das Versprechen NICHT ab. Der Befehl antwortete sofort 200; die
 * Oberflaeche schickte unmittelbar danach den Startbefehl, und zwei Netzaufrufe
 * waren rund zehn Millisekunden auseinander zu Spotify unterwegs. Kam die
 * Pause als ZWEITE an, meldete `/player/state` einundzwanzig Sekunden lang
 * `is_playing:false, progress_ms:0` — waehrend librespot spielte. Drei von
 * vier Runden gingen so aus.
 *
 * Die Oberflaeche hat das mit einer festen Atempause von 1500 ms zugedeckt.
 * Das war die Reparatur am Symptom: sie kostet die Zeit IMMER, sie steht nur
 * im Weiterhoeren-Weg (der gewoehnliche Kacheltipp hatte denselben Wettlauf,
 * ungedeckt), und sie muesste in JEDE Oberflaeche geschrieben werden, die
 * diesen Dienst anspricht. Hier ist die Ursache, hier gehoert die Reparatur
 * hin — dann sind beide Wege auf einmal geheilt.
 *
 * WAS *NICHT* ABGEWARTET WIRD: der eigene Zustand. `currentPlayer` und die
 * uebrigen Felder werden SOFORT geleert, vor dem Warten. Zwei Gruende, beide
 * ernst:
 *   * `/player/local` muss augenblicklich „hier laeuft nichts" sagen. Die
 *     Oberflaeche fragt das VOR dem `stop`, um zu entscheiden, ob ueberhaupt
 *     Spotify lief.
 *   * Kaeme waehrend des Wartens ein ZWEITES `stop` herein (ein Kind tippt
 *     nach), fuende es `currentPlayer` noch auf 'spotify' und schickte eine
 *     zweite Pause. Genau die Sorte zweiter Aufruf, um die es hier geht.
 *
 * @returns wie es ausging — siehe `AnhalteAusgang`
 */
async function stop(): Promise<AnhalteAusgang> {
  if (
    muPiBoxConfig.telegram.active &&
    //network.onlinestate === 'online' &&
    muPiBoxConfig.telegram.token.length > 1 &&
    muPiBoxConfig.telegram.chatId.length > 1
  )
    cmdCall('/usr/bin/python3 /usr/local/bin/mupibox/telegram_send_message.py "Stop"')
  return anhaltenNachSpieler()
}

/**
 * ANHALTEN, WAS GERADE SPIELT — ohne Telegram, ohne Meinung darueber, WARUM.
 *
 * ABGETRENNT AM 05.08.2026, weil es ZWEI Anlaesse gibt und bisher nur einer
 * bedient wurde: den Knopf `stop` — und den DIENSTWECHSEL, der bis dahin gar
 * nicht anhielt (siehe `tonmaschineUebernehmen`). Dieselbe Arbeit an zwei
 * Stellen zu schreiben, waere genau die Bauart, die dieses Projekt schon
 * dreimal bezahlt hat (llmwiki drei-orte-eine-anzeige).
 *
 * Die Telegram-Zeile bleibt bei `stop`: sie meldet dem Elternteil „gestoppt",
 * und ein Wechsel von Spotify auf die ARD ist kein Stopp.
 */
async function anhaltenNachSpieler(): Promise<AnhalteAusgang> {
  // ══ E104: DIE STEUER-BLINDHEIT SCHLIESSEN ═══════════════════════════════
  // Spotify kann auf DIESER Box spielen, ohne dass dieser Dienst es je
  // angestossen hat: Connect-Resume nach einem soloist-Neustart, die App
  // eines Elternteils, ein frisch getauschter Player mit leerer
  // Buchfuehrung. Drei am 30.08.2026 gemessene Gesichter derselben Falle —
  // unstoppbar („ich kann nicht mehr stoppen"), unsichtbar, und nicht
  // verdraengbar („wenn ich ard sound anfange zu spielen stoppt es spotify
  // nicht"). Die Wahrheit haelt der Server: seine SpielstandQuelle (E75)
  // haengt am lokalen soloist-WebSocket und faellt selbst auf die Web-API
  // zurueck. VOR den Zweigen gefragt, NUR wenn die eigene Buchfuehrung
  // nicht ohnehin gleich pausiert — und angehalten wird ausschliesslich,
  // was AUF DIESER BOX spielt (fremde Geraete beruehrt weiterhin niemand).
  if (currentMeta.currentPlayer !== 'spotify') await fremdeWiedergabeAnhalten()
  if (currentMeta.currentPlayer === 'spotify') {
    /* ══ OHNE GERAET WIRD ERST AUFGELOEST, DANN PAUSIERT (E40/F2) ═══════════
     *
     * BIS ZUM 16.08.2026 stand hier: Zustand raeumen, „bestaetigt" melden —
     * OHNE eine Pause zu schicken. Die Begruendung („nichts Eigenes
     * anzuhalten") uebersah, dass librespot LOKAL weiterspielt, waehrend die
     * Buchfuehrung schon leer ist. Und mit leerer Buchfuehrung lief jeder
     * WEITERE stop in den nichts-lief-Zweig: die Wiedergabe war UNSTOPPBAR —
     * kein Knopf der Box traf sie mehr.
     *
     * Deshalb wird das eigene Geraet jetzt NACHGESCHLAGEN, mit eigener
     * Frist, und dann regulaer pausiert. Spielt librespot, ist es bei
     * Spotify als Geraet angemeldet — der Nachschlag findet es also genau
     * dann, wenn es darauf ankommt. Ein FREMDES Geraet wird weiterhin nie
     * beruehrt (geraetWaehlen raet nicht).
     */
    let geraet = eigeneKennung('stop')
    if (!geraet) {
      const nachschlag = await mitZeitschranke(
        new Promise<void>((gefunden) => geraetAufloesen(gefunden)),
        // geraetAufloesen ruft bei JEDEM Fehlweg (keine Geraete, Liste nicht
        // lesbar) seinen Rueckruf NICHT — das Versprechen hinge dann fuer
        // immer. Die Frist ist hier also kein Komfort, sondern die einzige
        // Tuer nach draussen.
        ANHALTE_FRIST_MS,
      )
      if (nachschlag.art === 'fertig' && activeDevice) {
        geraet = { device_id: activeDevice }
      }
    }
    if (!geraet) {
      // Immer noch keins. Geraeumt wird wie bisher — ein dauerhaft auf
      // „spotify" stehender Zustand liesse die Oberflaeche ewig „spielt"
      // zeigen —, aber gemeldet wird EHRLICH: pausiert wurde nichts. Die
      // Oberflaeche haelt dann ihren Abstand, und der naechste Tastendruck
      // trifft ein inzwischen aufgeloestes Geraet (eigeneKennung hat den
      // Nachschlag angestossen).
      currentMeta.currentPlayer = ''
      currentMeta.activeSpotifyId = ''
      currentMeta.pause = false
      spotifyRunning = false
      return 'fehlgeschlagen'
    }
    // Das Versprechen wird FESTGEHALTEN, nicht nur ausgeloest. Der Rumpf ist
    // unveraendert der von vorher — nur dass jetzt jemand zusieht, wie es
    // ausgeht.
    const angehalten = spotifyApi.pause(geraet).then(
      () => {
        counter.countpause++
        if (config.server.logLevel === 'debug') {
          writeCounter()
        }
        log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Playback stopped`)
        writeplayerstatePause()
      },
      (err: any) => {
        handleSpotifyError(err, 'stop')
        // WEITERGEREICHT, nicht verschluckt: der Aufrufer soll „bestaetigt"
        // von „fehlgeschlagen" unterscheiden koennen. `mitZeitschranke` faengt
        // die Ablehnung auf — sie wird nie zur `unhandledRejection`.
        throw err
      },
    )

    currentMeta.currentPlayer = ''
    currentMeta.activeSpotifyId = ''
    currentMeta.pause = false
    spotifyRunning = false

    const ausgang = await mitZeitschranke(angehalten, ANHALTE_FRIST_MS)
    if (ausgang.art === 'fertig') return 'bestaetigt'
    if (ausgang.art === 'gescheitert') {
      // DER EINZIGE AUSGANG, BEI DEM WIRKLICH ETWAS SCHIEFGING — und bis zum
      // 05.08.2026 der einzige, der KEINE Zeile hinterliess: `frist-abgelaufen`
      // protokolliert seit jeher, `gescheitert` warf den Grund weg.
      //
      // Und der Grund ist hier oft nicht der, den man erwartet:
      // `handleSpotifyError` greift als Erstes auf `err.body.error` zu, bei
      // einem NACKTEN Netzfehler aus superagent gibt es aber kein `.body`.
      // Dann steht hier ein TypeError statt ETIMEDOUT. Auch das ist eine
      // Auskunft — aber nur, wenn sie jemand aufschreibt.
      log.warn(
        `${nowDate.toLocaleString()}: [Spotify Control] stop: die Pause ist gescheitert: ${
          (ausgang.fehler as Error)?.message ?? ausgang.fehler
        }`,
      )
      return 'fehlgeschlagen'
    }
    // ABGELAUFEN heisst NICHT „abgebrochen". Die Pause ist weiter unterwegs
    // und kann noch ankommen — abgewartet wird sie nur nicht mehr. Damit ist
    // in genau diesem Fall der alte Wettlauf zurueck. Das ist bewusst so:
    // wer 1,5 s auf die Pause wartet, hat ein Netz, in dem der Start ohnehin
    // nicht besser laeuft, und zwei Minuten Haenger waeren der schlechtere
    // Tausch. Die Oberflaeche erfaehrt es (siehe die Antwort unten) und kann
    // dann ihrerseits Abstand halten.
    log.info(
      `${nowDate.toLocaleString()}: [Spotify Control] stop: Spotify hat innerhalb von ${ANHALTE_FRIST_MS} ms nicht bestaetigt`,
    )
    return 'frist-abgelaufen'
  }
  if (istDateiSpieler(currentMeta.currentPlayer)) {
    player.stop()
    //currentMeta.playing = false;
    writeplayerstatePause()
    currentMeta.currentTrackname = ''
    currentMeta.progressTime = ''
    currentMeta.album = ''
    currentMeta.path = ''
    currentMeta.currentTracknr = ''
    currentMeta.totalTracks = ''
    currentMeta.currentPlayer = ''
    currentMeta.pause = false
    spotifyRunning = false
    log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Playback stopped`)
    // mpv/mplayer laufen HIER auf der Box. `player.stop()` ist ein Zeilenbefehl
    // durch die Rohrleitung, kein Netzaufruf — es gibt kein Versprechen, auf
    // das man warten koennte, und keinen Wettlauf ueber das Netz. Deshalb
    // dieselbe Antwort wie frueher, sofort.
    return 'bestaetigt'
  }
  // NICHTS LIEF. Dann schickt diese Funktion auch nichts — und die Oberflaeche
  // braucht keinen Abstand zu halten. Das ist genau die Lage, in der die drei
  // Kontrollaeufe aus einer ruhenden Box heraus fehlerfrei waren
  // (llmwiki weiterhoeren-stop-und-start-im-wettlauf, „Gegenproben").
  return 'nichts-zu-tun'
}

/** Die beiden Tonmaschinen dieser Box. `''` heisst: es spielt keine. */
type Tonmaschine = 'spotify' | 'mplayer' | 'mpv'

/**
 * DER EINE ORT, AN DEM DIE TONMASCHINE DEN BESITZER WECHSELT.
 *
 * ══ DER FEHLER, DEN ES BESEITIGT ══════════════════════════════════════════
 * GEMELDET am 04./05.08.2026, woertlich: „und es kann sein das der titel
 * weiterspielt wenn man den dienst wechselt" und, nachgeschoben: „das ton
 * problem gilt fuer alle dienste untereinander".
 *
 * Auf dieser Box stehen ZWEI Tonmaschinen nebeneinander, die nichts
 * voneinander wissen: librespot (Spotify) und mpv (lokal, Jellyfin, Radio,
 * RSS, ARD). Bis zum 05.08.2026 hat der Abspieldienst den Wechsel zwischen
 * ihnen NIRGENDS vollzogen. Es gab sechs Zweige, die `currentMeta.currentPlayer`
 * einfach ueberschrieben — `library`, `radio`, `rss`, `jellyfin`, `ard` und
 * `useSpotify` — und KEINER hielt die andere Maschine an. Angehalten wurde
 * ausschliesslich, weil die OBERFLAECHE vorher brav ein `stop` schickte.
 *
 * Das ist genau die Bauart aus llmwiki [[drei-orte-eine-anzeige]], nur eine
 * Etage tiefer: EINE Sache (welche Maschine spielt), an SECHS Stellen
 * geschrieben, und die Absicherung dagegen liegt in einem ANDEREN Programm —
 * in ZWEI anderen sogar (NewDesign/app.js und player.service.ts), die beide
 * ihre eigene Kopie des `stop` fuehren.
 *
 * ══ WAS ES GEKOSTET HAT, AM GERAET GEMESSEN (05.08.2026, Box .169) ════════
 * tools/dienstwechsel-am-geraet.mjs, Sorte `nachzuegler-danach`:
 *
 *     ARD-Sendung laeuft (30 Folgen), Wechsel auf Spotify,
 *     danach EIN Anhaeng-Befehl der alten Sendung:
 *         Ausgang 0,5099 -> 0,8439   mpv SPIELT   currentPlayer: spotify
 *         mpv angehalten:  0,4958    — es klang WEITER
 *
 * Zwei Toene zugleich, und der Dienst meldete dabei `spotify`. Ein `stop`
 * hielt daraufhin nur Spotify an; die ARD-Folge lief weiter und war ueber die
 * Oberflaeche NICHT MEHR ABZUSTELLEN. Genau der gemeldete Satz.
 *
 * ══ WARUM HIER UND NICHT IN DER OBERFLAECHE ══════════════════════════════
 * Die Oberflaechen schicken ihr `stop` weiter — es kostet nichts und haelt
 * die Anzeige sauber. Aber es darf nicht mehr die EINZIGE Absicherung sein:
 * eine dritte Oberflaeche, ein alter Stand, ein vergessener Zweig, und die
 * Box spielt zweistimmig. Ab hier kann sie das nicht mehr, weil der Wechsel
 * dort stattfindet, wo die Maschinen stehen.
 *
 * ══ WAS ES KOSTET ════════════════════════════════════════════════════════
 * Im Regelfall NICHTS: die Oberflaeche hat schon `stop` geschickt,
 * `currentPlayer` steht auf `''`, und diese Funktion setzt nur das Feld.
 * Wird doch angehalten, gilt fuer Spotify dieselbe Obergrenze wie bei `stop`
 * (ANHALTE_FRIST_MS, im Alltag 76 bis 93 ms Rundlauf) und fuer mpv der
 * Zeilenbefehl durch die Rohrleitung (0,25 s bis zur Stille, gemessen mit
 * tools/stop-wirkt-am-geraet.mjs).
 */
async function tonmaschineUebernehmen(neu: Tonmaschine): Promise<void> {
  const alt = currentMeta.currentPlayer
  if (alt && alt !== neu) {
    log.info(`${nowDate.toLocaleString()}: [Spotify Control] Dienstwechsel: ${alt} -> ${neu}, halte ${alt} an`)
    // `anhaltenNachSpieler` raeumt `currentPlayer` selbst auf — es wird gleich
    // darunter neu gesetzt. Beim Spotify-Zweig wird ABGEWARTET, aus demselben
    // Grund wie bei `stop`: sonst laeuft die Pause mit dem naechsten Befehl um
    // die Wette (llmwiki weiterhoeren-stop-und-start-im-wettlauf).
    await anhaltenNachSpieler()
  }
  currentMeta.currentPlayer = neu
}

/**
 * Den Startpunkt loeschen.
 *
 * MUSS bei Pause und Stopp passieren: sonst wuerde `spieltWirklich` eine echte
 * Pause kurz nach dem Start als "veraltete Meldung" abtun - und ein Knopf, der
 * eine gedrueckte Pause ignoriert, ist schlimmer als einer, der kurz flackert.
 */
function startpunktLoeschen(): void {
  startpunkt = { seit: 0, ab: 0 }
}

function play() {
  if (currentMeta.currentPlayer === 'spotify') {
    // MIT KENNUNG: laeuft die Wiedergabe gerade woanders (jemand hat sie im
    // Wohnzimmer uebernommen), HOLT dieses play() sie auf die Box zurueck —
    // Spotify transferiert bei device_id den laufenden Zusammenhang.
    const geraet = eigeneKennung('play')
    if (!geraet) return
    spotifyApi.play(geraet).then(
      () => {
        counter.countplay++
        if (config.server.logLevel === 'debug') {
          writeCounter()
        }
        log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Playback started`)
        deviceRetry = 0 // success — reset the Device-not-found retry budget
        currentMeta.pause = false
        writeplayerstatePlay()
      },
      (err: any) => {
        handleSpotifyError(err, 'play')
      },
    )
    if (
      muPiBoxConfig.telegram.active &&
      //network.onlinestate === 'online' &&
      muPiBoxConfig.telegram.token.length > 1 &&
      muPiBoxConfig.telegram.chatId.length > 1
    )
      cmdCall('/usr/bin/python3 /usr/local/bin/mupibox/telegram_send_message.py "Continue playing"')
    //if (muPiBoxConfig.telegram.active && muPiBoxConfig.telegram.token.length > 1 && muPiBoxConfig.telegram.chatId.length > 1) cmdCall('/usr/bin/python3 /usr/local/bin/mupibox/telegram_Track_Spotify.py');
  } else if (istDateiSpieler(currentMeta.currentPlayer)) {
    if (player.pauseAus || !currentMeta.playing) {
      // Wie bei pause(): absolut, wenn die Maschine es kann — ein „Weiter",
      // das wegen eines verdrehten Merkfelds pausiert, gibt es so nicht mehr.
      if (player.pauseAus) player.pauseAus()
      else player.playPause()
      currentMeta.pause = false
      //currentMeta.playing = true;
      writeplayerstatePlay()
      if (
        muPiBoxConfig.telegram.active &&
        //network.onlinestate === 'online' &&
        muPiBoxConfig.telegram.token.length > 1 &&
        muPiBoxConfig.telegram.chatId.length > 1
      )
        cmdCall('/usr/bin/python3 /usr/local/bin/mupibox/telegram_send_message.py "Continue playing"')
      // if (muPiBoxConfig.telegram.active && muPiBoxConfig.telegram.token.length > 1 && muPiBoxConfig.telegram.chatId.length > 1 && (currentMeta.currentType === 'rss' || currentMeta.currentType === 'radio')) cmdCall('/usr/bin/python3 /usr/local/bin/mupibox/telegram_Track_Local.py');
      // if (muPiBoxConfig.telegram.active && muPiBoxConfig.telegram.token.length > 1 && muPiBoxConfig.telegram.chatId.length > 1 && currentMeta.currentType === 'local') cmdCall('/usr/bin/python3 /usr/local/bin/mupibox/telegram_Track_RSS_Radio.py');
    }
  }
}

function next() {
  if (currentMeta.currentPlayer === 'spotify') {
    const geraet = eigeneKennung('next')
    if (!geraet) return
    spotifyApi.skipToNext(geraet).then(
      () => {
        counter.countskipToNext++
        if (config.server.logLevel === 'debug') {
          writeCounter()
        }
        log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Skip to next`)
      },
      (err: any) => {
        handleSpotifyError(err, 'next')
      },
    )
  } else if (istDateiSpieler(currentMeta.currentPlayer)) {
    //currentMeta.currentTracknr = currentMeta.currentTracknr + 1;
    //log.debug(nowDate.toLocaleString() + ': [Spotify Control] Current Tracknr: ' + currentMeta.currentTracknr);
    player.next()
  }
}

function previous() {
  if (currentMeta.currentPlayer === 'spotify') {
    const geraet = eigeneKennung('previous')
    if (!geraet) return
    spotifyApi.skipToPrevious(geraet).then(
      () => {
        counter.countskipToPrevious++
        if (config.server.logLevel === 'debug') {
          writeCounter()
        }
        log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Skip to previous`)
      },
      (err: any) => {
        handleSpotifyError(err, 'previous')
      },
    )
  } else if (istDateiSpieler(currentMeta.currentPlayer)) {
    if (Number(currentMeta.currentTracknr) > 1) {
      currentMeta.currentTracknr = Number(currentMeta.currentTracknr) - 2
    }
    log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Current Tracknr: ${currentMeta.currentTracknr}`)
    player.previous()
  }
}

function shuffleon() {
  spotifyApi.setShuffle(true).then(
    () => {
      counter.countsetShuffle++
      if (config.server.logLevel === 'debug') {
        writeCounter()
      }
      log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Toggle Shuffle`)
    },
    (err: any) => {
      handleSpotifyError(err, 'shuffleon')
    },
  )
}

function shuffleoff() {
  spotifyApi.setShuffle(false).then(
    () => {
      counter.countsetShuffle++
      if (config.server.logLevel === 'debug') {
        writeCounter()
      }
      log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Toggle Shuffle`)
    },
    (err: any) => {
      handleSpotifyError(err, 'shuffleoff')
    },
  )
}

/* ══ DAS PIPEWIRE-CUE AN SEINER EINZIGEN STELLE (E114 Stufe 3b) ═══════════
 *
 * Betreiber, 04.09.2026: „ich will das es lokal spielt deshalb haben wir den
 * wechsel drin." Der Maschinenwechsel mpv -> Spotify kostet 1-2 s Stille;
 * das Cue legt den Spotify-Zweig fuer die Dauer des Starts stumm, sodass
 * Anlauf und Puffern in einem Fenster liegen, in dem niemand zuhoert.
 *
 * EIN Schalter fuer den ganzen Dienst, nicht einer je Aufruf: Nur so kann
 * der Signalgriff unten ueberhaupt etwas aufdecken, und nur so kann ein
 * zweiter Start nicht ein zweites Fenster ueber dem ersten oeffnen (die
 * Sicherung dagegen sitzt in `cue-schalter.ts`).
 */
const cueSchalter = erzeugeCueSchalter({
  protokoll: (text: string) => log.debug(`${nowDate.toLocaleString()}: [Spotify Control] ${text}`),
})

/* DER SIGNALGRIFF, den der Rueckverbinde-Zwang nicht ersetzen kann.
 *
 * Wird der Dienst im stummen Fenster beendet, stirbt mit ihm die Uhr, die
 * zurueckverbinden wuerde — die Box bliebe stumm, und niemand kaeme darauf,
 * dass eine PipeWire-Kante fehlt.
 *
 * `once` UND WIEDER AUSLOESEN, nicht `process.exit()`: Ein eigener Horcher
 * auf SIGTERM ERSETZT in Node das Standardverhalten. Bliebe er stehen,
 * haette `systemctl stop` keine Wirkung mehr und liefe in sein Timeout, bis
 * systemd SIGKILL nachschiebt — aus einer Aufraeumhilfe waere ein Dienst
 * geworden, den man nicht mehr sauber beenden kann. Deshalb: einmal
 * aufdecken, Horcher ist damit weg, dasselbe Signal noch einmal an sich
 * selbst schicken — dann greift wieder die Vorgabe, mit dem richtigen
 * Beendigungsstatus fuer systemd.
 */
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    cueSchalter.klar()
    process.kill(process.pid, signal)
  })
}

/**
 * Den Spotify-Startbefehl absetzen — im stummen Fenster, wenn eines zu haben
 * ist.
 *
 * DIE EINZIGE NAHT, an der das Cue in den Ton greift. Ohne `MIXPI_CUE=1`
 * ist das hier Zeichen fuer Zeichen der bisherige Aufruf, nur einen
 * Promise-Schritt tiefer: `imStummenFenster` fragt zuerst den Schalter und
 * ruft ohne ihn weder `pw-dump` noch `pw-link`.
 *
 * WARUM HIER UND NICHT UM `playMe` HERUM: Das Fenster soll den START
 * umschliessen und das Puffern danach — nicht die Geraetesuche davor. Die
 * kann Sekunden dauern (`geraetAufloesen` holt die Geraeteliste), und so
 * lange stumm zu sein hiesse, die Stille zu verlaengern statt sie zu
 * verbergen.
 */
function spielAbsetzen(optionen: unknown): Promise<unknown> {
  return imStummenFenster(() => spotifyApi.play(optionen), { schalter: cueSchalter }).then((r) => r.wert)
}

function playMe() {
  // GERAET KENNEN, BEVOR GESPIELT WIRD - ABER NICHT UEBERNEHMEN.
  //
  // Nach einem Boxstart ist activeDevice leer; der Abspielbefehl ginge ohne
  // device_id raus und Spotify antwortet NO_ACTIVE_DEVICE. Also vorher die
  // Geraeteliste holen und die eigene Box heraussuchen.
  //
  // NICHT uebernehmen (transferMyPlayback): das ist am Geraet gemessen der
  // sichere Weg in die Stille. Eine Uebernahme auf ein frisch gestartetes
  // librespot laesst dieses einen leeren Zusammenhang laden ("context is not
  // available. type: Default"), es landet in einem kaputten Zustand, und der
  // folgende Abspielbefehl bekommt 403. Ohne Uebernahme, nur mit device_id,
  // spielt derselbe Befehl sofort - Spotify aktiviert das Geraet dabei selbst.
  if (!activeDevice) {
    geraetAufloesen(playMe)
    return
  }
  log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Spotify play ${currentMeta.activeSpotifyId}`)
  // Loose legacy arithmetic on the split string parts — kept as `any` to
  // preserve the original coercion behaviour verbatim.
  let resumeOffset: any = currentMeta.activeSpotifyId.split(':')[3]
  log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Spotify resume ${resumeOffset}`)
  if (resumeOffset > 0) resumeOffset--
  log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Spotify offset ${resumeOffset}`)
  const resumeProgess: any = currentMeta.activeSpotifyId.split(':')[4]
  const tmp: string[] = currentMeta.activeSpotifyId.split(':')
  const contextUri = `${tmp[0]}:${tmp[1]}:${tmp[2]}`

  // Prepare play options with device_id if available
  const playOptions: any = {
    offset: { position: resumeOffset },
    position_ms: resumeProgess,
  }

  // OHNE EIGENES GERAET WIRD NICHT GESTARTET. Hier stand "if (activeDevice)"
  // — und ohne Kennung ging der Startbefehl ans AKTIVE Geraet des Kontos:
  // war das die Soundbar im Wohnzimmer, spielte das Hoerspiel des Kindes
  // dort (Betreiber, 14.08.2026). Lieber still mit lesbarem Grund als Ton
  // im falschen Zimmer — dieselbe Regel wie in eigeneKennung/geraetWaehlen.
  const startGeraet = eigeneKennung('playMe')
  if (!startGeraet) return
  playOptions.device_id = startGeraet.device_id
  log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Playing on device: ${startGeraet.device_id}`)

  if (contextUri.split(':')[1] === 'episode') {
    playOptions.uris = [contextUri]
    spielAbsetzen(playOptions).then(
      (_data: any) => {
        counter.countplay++
        if (config.server.logLevel === 'debug') {
          writeCounter()
        }
        log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Playback started`)
        deviceRetry = 0 // success — reset the Device-not-found retry budget
        writeplayerstatePlay()
        spotifyRunning = true
        if (
          muPiBoxConfig.telegram.active &&
          //network.onlinestate === 'online' &&
          muPiBoxConfig.telegram.token.length > 1 &&
          muPiBoxConfig.telegram.chatId.length > 1
        )
          cmdCall('/usr/bin/python3 /usr/local/bin/mupibox/telegram_send_message.py "Start playing spotify"')
        //if (muPiBoxConfig.telegram.active && muPiBoxConfig.telegram.token.length > 1 && muPiBoxConfig.telegram.chatId.length > 1) cmdCall('/usr/bin/python3 /usr/local/bin/mupibox/telegram_Track_Spotify.py');
      },
      (err: any) => {
        log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Playback error${err}`)
        handleSpotifyError(err, 'playMe')
      },
    )
    // spotifyApi.setVolume(volumeStart).then(function () {
    //   log.debug(nowDate.toLocaleString() + ': [Spotify Control] Setting volume to '+ 99);
    //   counter.countsetVolume++;
    //   if (config.server.logLevel === 'debug'){writeCounter();}
    //   }, function(err) {
    //   handleSpotifyError(err,"setVolume");
    // });
  } else {
    playOptions.context_uri = contextUri
    spielAbsetzen(playOptions).then(
      (_data: any) => {
        log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Playback started`)
        deviceRetry = 0 // success — reset the Device-not-found retry budget
        counter.countplay++
        if (config.server.logLevel === 'debug') {
          writeCounter()
        }
        writeplayerstatePlay()
        spotifyRunning = true
        if (
          muPiBoxConfig.telegram.active &&
          //network.onlinestate === 'online' &&
          muPiBoxConfig.telegram.token.length > 1 &&
          muPiBoxConfig.telegram.chatId.length > 1
        )
          cmdCall('/usr/bin/python3 /usr/local/bin/mupibox/telegram_send_message.py "Start playing spotify"')
        //if (muPiBoxConfig.telegram.active && muPiBoxConfig.telegram.token.length > 1 && muPiBoxConfig.telegram.chatId.length > 1) cmdCall('/usr/bin/python3 /usr/local/bin/mupibox/telegram_Track_Spotify.py');
      },
      (err: any) => {
        log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Playback error${err}`)
        handleSpotifyError(err, 'playMe')
      },
    )
    // spotifyApi.setVolume(volumeStart).then(function () {
    //   counter.countsetVolume++;
    //   if (config.server.logLevel === 'debug'){writeCounter();}
    //   log.debug(nowDate.toLocaleString() + ': [Spotify Control] Setting volume to '+ 99);
    //   }, function(err) {
    //   handleSpotifyError(err,"setVolume");
    // });
  }
}

function playList(playedList: string) {
  // JE SEGMENT dekodiert, nicht decodeURI auf das Ganze: decodeURI laesst
  // `%2C` (Komma) und Verwandte stehen, und der m3u-Pfad zeigte dann auf
  // einen Ordner, den es nie gab — Buchfuehrung „spielt", Ton keiner. Die
  // Messung steht an `medienPfadAus` (befehlspfad.ts, 31.08.2026).
  const playedTitelmod = medienPfadAus(playedList)
  //playedTitelmod = playedTitel.replace(/%20/g," ");
  log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Starting currentMeta.playing:${playedTitelmod}`)
  //currentMeta.playing = true;
  writeplayerstatePlay()
  player.playList(`/home/dietpi/MuPiBox/media/${playedTitelmod}/playlist.m3u`)
  player.setVolume(volumeStart)
  log.debug(`${nowDate.toLocaleString()}: /home/dietpi/MuPiBox/media/${playedTitelmod}/playlist.m3u`)
  currentMeta.currentTracknr = 0
  currentMeta.path = playedTitelmod

  if (
    muPiBoxConfig.telegram.active &&
    //network.onlinestate === 'online' &&
    muPiBoxConfig.telegram.token.length > 1 &&
    muPiBoxConfig.telegram.chatId.length > 1
  )
    cmdCall('/usr/bin/python3 /usr/local/bin/mupibox/telegram_send_message.py "Start playing local"')
  //if (muPiBoxConfig.telegram.active && muPiBoxConfig.telegram.token.length > 1 && muPiBoxConfig.telegram.chatId.length > 1) cmdCall('/usr/bin/python3 /usr/local/bin/mupibox/telegram_Track_Local.py');

  setTimeout(() => {
    // `currentMeta.path` ist seit dem medienPfadAus-Umbau KLARTEXT — ein
    // weiteres decodeURIComponent hier war die zweite Dekodier-Stufe, die
    // den Ordner fand, waehrend der m3u-Pfad daneben griff (und sie wuerfe
    // bei einem literalen `%` im Namen eine URIError in den Dienst).
    const cmdtotalTracks = `find "/home/dietpi/MuPiBox/media/${currentMeta.path}" -type f -name "*.mp3" -or -name "*.flac" -or -name "*.m4a" -or -name "*.wma" -or -name "*.wav"| wc -l`
    console.log(cmdtotalTracks)
    const exec = require('node:child_process').exec
    exec(cmdtotalTracks, (e: any, stdout: any, stderr: any) => {
      // NICHT werfen: ein Wurf im exec-Rueckruf beendet den ganzen Dienst
      // (siehe die Lautstaerke-Abfrage oben). `find` scheitert hier
      // zuverlaessig, sobald es das Medienverzeichnis nicht gibt — und dann
      // waere die Box wegen einer Titelzaehlung stumm.
      if (e) {
        log.debug(`${new Date().toLocaleString()}: [Spotify Control] Titel nicht zaehlbar: ${e.message}`)
        return
      }
      currentMeta.totalTracks = Number.parseInt(stdout.split(/\r?\n/)[0], 10)
      console.log('stdout', stdout)
      console.log('stderr', stderr)
    })
  }, 500)
}

/* "Play next": append an album to the running local playlist (no interruption).
   Falls back to a normal playList start when nothing local is running.

   DER RUECKFALL IST EIN START, ALSO EIN DIENSTWECHSEL. Bis zum 05.08.2026
   setzte er `currentPlayer` einfach auf 'mplayer' und liess librespot laufen —
   „Als naechstes spielen" auf ein lokales Album machte die Box waehrend einer
   Spotify-Wiedergabe zweistimmig. Jetzt geht er durch den einen Ort
   (`tonmaschineUebernehmen`), und die Fallunterscheidung steht VOR dem
   Wechsel: danach hiesse `currentPlayer` immer 'mplayer', und das Anhaengen
   waere nie wieder ein Anhaengen. */
async function queueAlbum(playedList: string) {
  if (!istDateiSpieler(currentMeta.currentPlayer) || !currentMeta.playing) {
    await tonmaschineUebernehmen('mplayer')
    currentMeta.currentType = 'local'
    playList(playedList)
    return
  }
  // Dieselbe Zerlegung wie in `playList` — je Segment dekodiert, siehe dort.
  const rel = medienPfadAus(playedList)
  player.queueList(`/home/dietpi/MuPiBox/media/${rel}/playlist.m3u`)
  log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Queued next: ${rel}`)
  // Extend the visible playlist length by the queued album's track count.
  setTimeout(() => {
    const cmd = `find "/home/dietpi/MuPiBox/media/${rel}" -type f -name "*.mp3" -or -name "*.flac" -or -name "*.m4a" -or -name "*.wma" -or -name "*.wav"| wc -l`
    const exec = require('node:child_process').exec
    exec(cmd, (e: any, stdout: any) => {
      if (e instanceof Error) {
        log.warn(`queue count failed: ${e.message}`)
        return
      }
      const add = Number.parseInt(stdout.split(/\r?\n/)[0], 10)
      if (!Number.isNaN(add)) currentMeta.totalTracks = (Number(currentMeta.totalTracks) || 0) + add
    })
  }, 500)
}

/**
 * Einen Text sprechen — ueber Piper auf DIESER Box, ohne Umweg und ohne Datei.
 *
 * Frueher stand hier `playFile`: es spielte eine MP3 aus
 * `/home/dietpi/MuPiBox/tts_files`, die `downloadTTS` zuvor bei Google geholt
 * hatte. Beides ist weg (Begruendung und Messung: sprechen.ts).
 *
 * KEINE DATEI, KEIN VERZEICHNIS, KEIN EIGENER ZWISCHENSPEICHER. Die
 * Abspielmaschine bekommt die Server-Adresse und holt sich den Ton selbst — am
 * Geraet geprueft (04.08.2026, Box .169): mpv wie mplayer spielen
 * `http://127.0.0.1:8200/api/vorlesen/sprich?text=…` anstandslos ab. Damit
 * verschwindet die Fehlerklasse, an der die alte Fassung starb: ein fehlendes
 * Ablageverzeichnis kann nicht mehr stumm machen, weil es keines mehr gibt.
 * Zwischengespeichert wird trotzdem — aber EINMAL, im Server (~/.mupibox/
 * vorlesen-cache), gemeinsam mit der Oberflaeche.
 */
const VORLESEN_PORT = Number(process.env.MUPIBOX_HTTP_PORT) || 8200

/**
 * Einmal (und danach hoechstens minuetlich) nachfragen, ob der Server
 * ueberhaupt sprechen kann — und wenn nicht, es LAUT sagen.
 *
 * `autosetup.sh` installiert Piper NICHT; auf einer frischen Box gibt es
 * keine Stimme. Ohne diese Frage bliebe die Box still, ohne dass irgendwo
 * stuende warum — genau der stille Fehler, den dieser Umbau beseitigt hat.
 *
 * Der Zaehler laeuft ab, damit eine spaeter nachgeladene Stimme greift, ohne
 * dass jemand den Dienst neu startet. Und die Meldung kommt nur bei einem
 * WECHSEL des Zustands: eine Zeile pro Ereignis, kein Protokoll voller
 * Wiederholungen.
 */
const VORLESEN_NACHFRAGE_MS = 60_000
let vorlesenBereit: boolean | null = null
let vorlesenGefragt = 0

async function vorlesenBereitPruefen(): Promise<boolean> {
  const jetzt = Date.now()
  if (vorlesenBereit === true) return true
  if (vorlesenBereit !== null && jetzt - vorlesenGefragt < VORLESEN_NACHFRAGE_MS) return false
  vorlesenGefragt = jetzt
  try {
    const a = await fetch(sprechen.sprechBereitAdresse(VORLESEN_PORT), {
      signal: AbortSignal.timeout(3000),
    })
    const { bereit, stimmen } = sprechen.bereitAus(await a.json())
    if (bereit !== vorlesenBereit) {
      if (bereit) {
        log.info(`${nowDate.toLocaleString()}: [Spotify Control] Vorlesen bereit (${stimmen} Stimmen).`)
      } else {
        log.warn(
          `${nowDate.toLocaleString()}: [Spotify Control] Vorlesen NICHT moeglich: ` +
            `Piper fehlt oder es liegt keine Stimme auf der Box (${stimmen} gefunden). ` +
            'Einrichten unter Verwaltung -> Vorlesen. Die Box bleibt bis dahin bei Ansagen still.',
        )
      }
    }
    vorlesenBereit = bereit
    return bereit
  } catch (e) {
    // Der Server antwortet nicht. Das ist etwas ANDERES als „keine Stimme" —
    // und es waere falsch, deswegen dauerhaft aufzugeben: er koennte gerade
    // neu starten. Also merken wir uns kein Nein, sondern versuchen es.
    log.warn(
      `${nowDate.toLocaleString()}: [Spotify Control] Vorlesen: Server nicht erreichbar (${e}) — Versuch trotzdem.`,
    )
    vorlesenBereit = null
    return true
  }
}

function sprichText(text: string) {
  const adresse = sprechen.sprechAdresse(text, VORLESEN_PORT)
  log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Vorlesen: ${text}`)
  writeplayerstatePlay()
  // ── DIE ANSAGE DARF DEN FOLGENNAMEN NICHT WEGSCHREIBEN ───────────────────
  // AM GERAET GEMESSEN (06.08.2026, tools/f1-vorlesen-ueberschreibt-schau.mjs,
  // mit Gegenprobe gegen die Fassung von vor F1):
  //
  //   vor der Ansage    currentTrackname = "Faelschung"
  //   nach der Ansage   currentTrackname = "sprich?text=Bibi Blocksberg"
  //
  // WIE ES DAZU KAM. Der media_title-Hoerer schaltet auf `currentType`, und
  // sein Kommentar sagt warum: „die Weiche steht auf den beiden Typen, denen
  // wir den Namen AUCH MITGEBEN". Genau das stimmte fuer diesen Aufruf nicht.
  // `sprichText` laedt eine ganz andere Datei in DASSELBE mpv, ohne Namen und
  // ohne `currentType` anzufassen — mpv meldet daraufhin den Titel der Ansage,
  // die Weiche steht weiter auf 'ard', und der Hoerer schreibt ihn hin.
  //
  // VOR F1 KONNTE DAS NICHT PASSIEREN: `media-title` wurde nicht beobachtet,
  // und der `filename`-Hoerer schreibt nur, wenn ueberhaupt noch kein Name
  // dasteht (`if (!currentMeta.currentTrackname)`). Der neue Hoerer hatte
  // diese Schranke nicht.
  //
  // DIE ANSAGE BEKOMMT DESHALB EINEN NAMEN MIT — und zwar den, der ohnehin
  // schon in der Anzeige steht. Damit traegt auch dieser Eintrag einen Namen,
  // den WIR gewaehlt haben, die Aussage des Hoerers ist wieder wahr, und die
  // Titelzeile steht waehrend der Ansage still. Das ist genau das Verhalten
  // von vor F1, nur nicht mehr aus Versehen.
  //
  // WAS DAMIT NICHT ABGEDECKT IST, ausdruecklich: steht GAR KEIN Name in der
  // Anzeige, geht auch keiner mit, und mpv meldet wie bisher die Adresse. Dann
  // war die Zeile aber vorher leer — es geht nichts verloren, es kommt nur
  // etwas Haessliches hin. Ein Fall dafuer ist an dieser Box nicht gebaut:
  // `currentTrackname` und `currentType` werden in denselben Zeilen gesetzt.
  const stand = String(currentMeta.currentTrackname || '')
  player.play(adresse, stand || undefined)
  // LAUTSTAERKE AUSDRUECKLICH GESETZT, nicht vergessen — das Wissenspaket
  // verlangt es ([mupi-vorlesen-lautstaerke]): „Lautstaerke ist nichts
  // Globales auf dieser Box. Wer einen neuen Tonweg dazunimmt, muss ihn
  // ausdruecklich anbinden."
  //
  // Es ist `volumeStart` — DERSELBE Wert wie bei jedem anderen Weg durch
  // diese Maschine (Album, Radio, Jellyfin). Der eigentliche Regler ist ALSA;
  // die Ansage klingt damit genau so laut wie die Musik, und das ist gewollt.
  // Der Fall „die Ansage bruellt" aus dem Wissenspaket war ein ANDERER Weg
  // (der Kiosk-Browser startet ein <audio> immer bei 1.0) und ist dort
  // behoben.
  //
  // DIE ANGEHAENGTE `tts.volume` AUS /api/sonos WIRD BEWUSST NICHT ANGEWENDET
  // (siehe sprechen.ts): sie wurde noch nie angewendet, und was „40" dort
  // bedeuten soll — Anteil der Musiklautstaerke? absoluter mpv-Wert? — steht
  // nirgends. Sie hier auf gut Glueck zu deuten hiesse, die Ansage ueber
  // Nacht leiser oder lauter zu machen, ohne dass jemand es bestellt hat.
  // Das ist eine Frage an den Benutzer, keine Vermutung fuer den Code.
  player.setVolume(volumeStart)
}

/**
 * Einen Strom starten — mit dem Titelnamen, wenn der Befehl einen trug.
 *
 * `titel` reist als Datei-Option in mpvs Warteschlangeneintrag (F1, siehe
 * `ladeBefehl` in mpv-protokoll.ts). WAHLFREI, und zwar aus zwei Gruenden:
 * `sprichText` hat keinen Titel, und der mplayer-Aufsatz kennt das zweite
 * Argument gar nicht — dort faellt es folgenlos ins Leere.
 */
function playURL(playedURL: string, titel?: string, ab = 0) {
  log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Starting currentMeta.playing:${playedURL}`)
  //currentMeta.playing = true;
  writeplayerstatePlay()
  // `ab` ist der VORSPANN-SPRUNG (Sekunden). Er geht als Datei-Option an mpv
  // und gilt damit auch fuer das automatische Weiterruecken; mplayer kennt
  // ihn nicht und uebergeht ihn.
  player.play(playedURL, titel, ab)
  player.setVolume(volumeStart)
  log.debug(`${nowDate.toLocaleString()}: ${playedURL}`)
  if (
    muPiBoxConfig.telegram.active &&
    //network.onlinestate === 'online' &&
    muPiBoxConfig.telegram.token.length > 1 &&
    muPiBoxConfig.telegram.chatId.length > 1
  )
    cmdCall('/usr/bin/python3 /usr/local/bin/mupibox/telegram_send_message.py "Start playing stream"')
  //if (muPiBoxConfig.telegram.active && muPiBoxConfig.telegram.token.length > 1 && muPiBoxConfig.telegram.chatId.length > 1) cmdCall('/usr/bin/python3 /usr/local/bin/mupibox/telegram_Track_RSS_Radio.py');
}

/*seek 30 secends back or forward*/
/**
 * ZWEI GETRENNTE BEWEGUNGEN — absolut und relativ.
 *
 * Vorher tat das EINE Funktion `seek(progress)`, und sie unterschied die
 * beiden Faelle an der GROESSE des Wertes: `> 1` hiess „springe dorthin",
 * alles andere hiess „dreissig Sekunden vor bzw. zurueck". Das ist eine
 * Ueberladung, die nur solange traegt, wie niemand an den Anfang will:
 *
 *   Regler ganz nach links  ->  `seekpos:0`  ->  0 ist nicht `> 1`
 *                           ->  DREISSIG SEKUNDEN ZURUECK statt an den Anfang.
 *
 * Dieselbe Falle liegt bei `seekpos:1`. Sie betraf auch die bestehende
 * Oberflaeche (now-playing-bar.component.ts:1904 klemmt auf 0..100 und darf
 * also 0 schicken) — dort war es nur nie jemandem aufgefallen.
 *
 * Getrennte Funktionen koennen sich nicht verwechseln. Die Aufrufer sagen
 * jetzt, WAS sie meinen, statt es durch die Zahl anzudeuten.
 *
 * DIE EINHEIT BLEIBT JE ABSPIELER VERSCHIEDEN, und das ist kein Versehen sondern
 * die Schnittstelle der beiden Maschinen:
 *     Spotify   Millisekunden   (spotifyApi.seek nimmt position_ms)
 *     mplayer   PROZENT         (mpv: `seek <n> absolute-percent`)
 * Beide Oberflaechen rechnen das entsprechend um; wer hier etwas aendert,
 * muss beide mitnehmen.
 */
function seekAbsolut(ziel: number | string) {
  const n = Number(ziel)
  if (!Number.isFinite(n) || n < 0) return
  log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Springe auf ${n}`)
  if (currentMeta.currentPlayer === 'spotify') {
    // Spotify nimmt keine gebrochenen Millisekunden.
    //
    // DER SPRUNG WIRKT NUR IM ANGEHALTENEN ZUSTAND — am Geraet gemessen und
    // in llmwiki spotify-vorwaerts-spulen-wirkungslos festgehalten. Ein
    // Umweg (anhalten, springen, weiterspielen) wurde HIER versucht und
    // wieder ENTFERNT: Er half nicht (0 von 4 Treffern, auch mit 1,5 s
    // Atempausen) und kostete drei Sekunden Stille. Von Hand als DREI
    // getrennte Box-Befehle trifft dieselbe Abfolge dagegen — der Unterschied
    // liegt also nicht in den Wartezeiten. Wer das aufloest, gehoert in den
    // Wiki-Eintrag.
    seekOhneUmweg(Math.round(n))
    return
  }

  if (istDateiSpieler(currentMeta.currentPlayer)) {
    player.seekPercent(Math.max(0, Math.min(100, n)))
  }
}

/**
 * Der Sprung OHNE den Umweg ueber Anhalten und Weiterspielen.
 *
 * Rueckfall fuer den Fall, dass sich der Wiedergabezustand nicht erfragen
 * laesst. Bei angehaltener Wiedergabe trifft er ohnehin; bei laufender bleibt
 * es beim gemeldeten Stand — schlechter als der Umweg, aber besser als gar
 * kein Versuch.
 */
function seekOhneUmweg(ziel: number) {
  const geraet = eigeneKennung('seekOhneUmweg')
  if (!geraet) return
  spotifyApi.seek(ziel, geraet).then(
    () => {
      counter.countseek++
      if (config.server.logLevel === 'debug') writeCounter()
    },
    (err: any) => {
      // AUF `warn`, NICHT AUF `debug`. `handleSpotifyError` schreibt auf
      // debug, und die Box laeuft auf logLevel 'error' — ein misslungener
      // Sprung verschwand damit spurlos. Genau dieses Schweigen hat beim
      // Suchen nach „vorwaerts spulen wirkt nicht" die meiste Zeit gekostet.
      const st = err && (err.statusCode || err.status)
      log.warn(`Sprung auf ${ziel} ms misslungen: ${st ?? '?'} ${err?.message ?? err}`)
      handleSpotifyError(err, 'seek')
    },
  )
}

/** Dreissig Sekunden vor oder zurueck. */
function seekRelativ(vorwaerts: boolean) {
  seek(vorwaerts ? 1 : 0)
}

function seek(progress: number | string) {
  let currentProgress = 0
  let targetProgress = 0
  log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Setting progress to ${progress}`)
  if (currentMeta.currentPlayer === 'spotify') {
    if (Number(progress) > 1) {
      const geraet = eigeneKennung('seek')
      if (!geraet) return
      spotifyApi.seek(progress, geraet).then(
        () => {
          counter.countseek++
          if (config.server.logLevel === 'debug') {
            writeCounter()
          }
          log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Progress is ${progress}`)
        },
        (err: any) => {
          handleSpotifyError(err, 'seek')
        },
      )
    } else {
      spotifyApi
        .getMyCurrentPlaybackState()
        .then((data: any) => {
          counter.countgetMyCurrentPlaybackState++
          if (config.server.logLevel === 'debug') {
            writeCounter()
          }
          currentProgress = data.body.progress_ms
          log.debug(
            `${nowDate.toLocaleString()}: [Spotify Control]Current progress for active device is ${currentProgress}`,
          )
          if (progress) targetProgress = currentProgress + 30000
          else targetProgress = currentProgress - 30000
        })
        .then(
          () => {
            spotifyApi.seek(targetProgress).then(
              () => {
                counter.countseek++
                if (config.server.logLevel === 'debug') {
                  writeCounter()
                }
                log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Setting progress to ${targetProgress}`)
              },
              (err: any) => {
                handleSpotifyError(err, 'seek')
              },
            )
          },
          (err: any) => {
            handleSpotifyError(err, 'seek')
          },
        )
    }
  } else if (istDateiSpieler(currentMeta.currentPlayer)) {
    if (Number(progress) > 1) {
      player.seekPercent(progress)
    } else {
      if (progress) player.seek(+30)
      else player.seek(-30)
    }
  }
}

/**
 * Einen lokalen Albumordner loeschen — und SAGEN, wie es ausging.
 *
 * Die Entscheidung, WAS geloescht werden darf, steht vollstaendig in
 * loeschen.ts; dort steht auch, was die alte Fassung dieser Funktion
 * angerichtet hat. Hier bleibt nur: das rohe Glied aus der URL holen (NICHT
 * ueber `path.parse(...).name` — das schnitt „Folge 12. Der Ausflug" auf
 * „Folge 12"), loeschen lassen, und den Ausgang protokollieren.
 *
 * PROTOKOLLIERT WIRD SICHTBAR. Vorher ging jeder Fehlschlag nach `log.debug`,
 * und in der Vorgabe steht `logLevel` nicht auf `debug` — ein Loeschen, das
 * nichts traf, hinterliess also KEINE Spur. Ein Erfolg uebrigens auch nicht,
 * und das ist beim Loeschen von Tondateien das Falsche: wer nachsehen will,
 * was verschwunden ist, hat nur diese Zeile.
 */
async function deleteLocal(url: string): Promise<import('./loeschen').Loeschausgang> {
  const glied = loeschgliedAusUrl(url)
  const ausgang = await loeschenAusfuehren(glied, MEDIEN_WURZEL)
  if (ausgang.ok) {
    log.info(`${new Date().toLocaleString()}: [Spotify Control] geloescht: ${ausgang.pfad}`)
  } else {
    log.warn(`${new Date().toLocaleString()}: [Spotify Control] NICHT geloescht (${ausgang.grund}) — url: ${url}`)
  }
  return ausgang
}

function cmdCall(cmd: string) {
  log.debug(`${nowDate.toLocaleString()}: [Spotify Control]Cmd  ${cmd}`)
  return new Promise((resolve, reject) => {
    childProcess.exec(cmd, (error: any, standardOutput: any, standardError: any) => {
      if (error) {
        log.debug(`${nowDate.toLocaleString()}: [Spotify Control]error ${error}`)
        reject()
        return
      }
      if (standardError) {
        log.debug(`${nowDate.toLocaleString()}: [Spotify Control]StandardError ${standardError}`)
        reject(standardError)
        return
      }
      log.debug(`${nowDate.toLocaleString()}: [Spotify Control]StandardOutput ${standardOutput}`)
      resolve(standardOutput)
    })
  })
}

/*gets available devices, searches for the active one and returns its volume*/
function setVolumeTo(raw: string) {
  // Absolute ALSA volume (0-100) — used by the now-playing bar's volume slider.
  const target = Math.max(0, Math.min(100, Number.parseInt(raw, 10) || 0))
  currentMeta.volume = target
  if (process.env.NODE_ENV === 'development') {
    // Dev/sim host has no ALSA mixer; keep the optimistic currentMeta value.
    log.debug(`${nowDate.toLocaleString()}: [Spotify Control] setvolume ${target}% (dev: amixer skipped)`)
    return
  }
  const exec = require('node:child_process').exec
  exec(lautstaerkeSetz(target), (e: any) => {
    if (e instanceof Error) log.warn(`setvolume failed: ${e.message}`)
  })
}

/**
 * Eine Stufe lauter (`volume` wahr) oder leiser — der Weg der +/- Tasten.
 *
 * ══ HIER STAND EIN ZWEITER DECKEL (behoben 05.09.2026) ═════════════════════
 *
 * Betreiber: „die knoepfe volumen in dem grossen player und auch im
 * titelbild [gehen] nicht bis 100 prozent ... nur bis ca 50, der
 * schieberegler vom miniplayer geht bis 100." An der Box gemessen:
 * `maxVolume` = 55.
 *
 * Der Code verglich `currentMeta.volume` (NUTZERSKALA 0..100) gegen
 * `mupibox.maxVolume` (Grenze der KARTE) und rief bei Gleichstand
 * `lautstaerkeSetz(maxVolume)` — also „setze auf 55" in der Nutzerskala, was
 * das Werkzeug zu 55 % von 55 macht. Zwei Deckel uebereinander.
 *
 * DIE GRENZE STEHT SEIT DER TON-SERIE IN `mupi-lautstaerke.sh`, das die
 * Nutzerskala 0..100 selbst auf 0..maxVolume abbildet. Der absolute Weg
 * (`setVolumeTo`) und die Oberflaeche (`grenzeAus` in NewDesign/app.js)
 * waren darauf schon umgestellt; nur dieser Weg nicht. Deshalb rechnet er
 * jetzt nur noch in der Nutzerskala und ueberlaesst dem Werkzeug die
 * Umrechnung — `naechsteStufe` traegt die Rechnung samt Test.
 */
async function setVolume(volume: number) {
  const volumeUp = lautstaerkeSetzRelativ(LAUTSTAERKE_SCHRITT)
  const volumeDown = lautstaerkeSetzRelativ(-LAUTSTAERKE_SCHRITT)
  // Zweite Stelle mit demselben `throw e` im Rueckruf wie oben im
  // Sekundentakt — sie haette den Dienst beim naechsten Lautstaerke-Befehl
  // erneut umgebracht. Gleiche Behandlung: melden, nicht sterben.

  const exec = require('node:child_process').exec
  exec(lautstaerkeLies, (e: any, stdout: any, _stderr: any) => {
    if (e) {
      log.debug(`${new Date().toLocaleString()}: [Spotify Control] Lautstaerke nicht lesbar: ${e.message}`)
      return
    }
    currentMeta.volume = lautstaerkeAusText(String(stdout || '')) ?? currentMeta.volume
  })

  // DER BEFEHL GEHT IMMER HINAUS, auch am oberen Ende: das Werkzeug kennt
  // die Grenze der Karte und laesst es dort einfach dabei. Ein Abbruch hier
  // waere wieder die zweite Meinung ueber dieselbe Frage.
  await cmdCall(volume ? volumeUp : volumeDown)
  currentMeta.volume = naechsteStufe(currentMeta.volume, volume ? 1 : -1)
}

async function transferPlayback(id: string) {
  await spotifyApi.transferMyPlayback([id]).then(
    () => {
      counter.counttransferMyPlayback++
      if (config.server.logLevel === 'debug') {
        writeCounter()
      }
      log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Transfering playback to ${id}`)
    },
    (err: any) => {
      log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Transfering playback error.`)
      handleSpotifyError(err, id, 'transferPlayback')
    },
  )
}

async function useSpotify(command: any) {
  currentMeta.currentPlayer = 'spotify'
  currentMeta.currentType = 'spotify'
  const dir = command.dir
  const newdevice = dir.split('/')[1]

  log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Stored device: ${activeDevice}, Requested: ${newdevice}`)

  // Update active device (will be used in playMe() via device_id parameter)
  if (newdevice !== 'current') {
    activeDevice = newdevice
    log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Device set to: ${activeDevice}`)
  } else {
    // Reset device to let Spotify use the currently active device
    activeDevice = null
    log.debug(
      `${nowDate.toLocaleString()}: [Spotify Control] Using current active Spotify device (no device_id specified)`,
    )
  }

  currentMeta.activeSpotifyId = command.name
  deviceRetry = 0 // fresh command — fresh Device-not-found retry budget
  // WANN wir gestartet haben, und AB WO. Ohne das laesst sich eine veraltete
  // Meldung von Spotify nicht von einer echten unterscheiden - siehe
  // fortschritt.ts.
  //
  // HIER STAND DIE RECHNUNG SELBST, und sie war falsch: das letzte Glied wurde
  // als SEKUNDEN gelesen und mit 1000 malgenommen, waehrend `playMe()`
  // dasselbe Glied unveraendert als `position_ms` weitergibt. Die Einheit
  // gehoert deshalb an EINE gepruefte Stelle (fortschritt.startpunktAus), wo
  // sie festgenagelt ist.
  startpunkt = fortschritt.startpunktAus(command.name, Date.now())
  playMe()
}

/*endpoint to return all spotify connect devices on the network*/
/*only used if sonos-kids-player is modified*/
app.get('/getDevices', (_req: any, res: any) => {
  spotifyApi.getMyDevices().then(
    (data: any) => {
      counter.countgetMyDevices++
      if (config.server.logLevel === 'debug') {
        writeCounter()
      }
      const availableDevices = data.body.devices
      log.debug(`${nowDate.toLocaleString()}: [Spotify Control] Getting available devices...`)
      res.send(availableDevices)
    },
    (err: any) => {
      handleSpotifyError(err, 'getMyDevicesHTTP')
    },
  )
})

/*endpoint transfer a playback to a specific device*/
/*only used if sonos-kids-player is modified*/
app.get('/setDevice', (req: any, _res: any) => {
  transferPlayback(req.query.id)
})

/*endpoint to return all state information*/
/*only used if sonos-kids-player is modified*/
/**
 * E99 v4 — DER PEGELSTROM (30.08.2026, Betreiber: "wir brauchen einen fast
 * update process fuer das zeichnen vom graph. und es soll entkoppelt sein
 * von anderen events."): Bisher ritt `pegel` auf dem Zustands-Poll — vier
 * Werte je Sekunde, und jede Bedienung (der Lautstaerke-Tipp!) stiess
 * ausser der Reihe nach. Hier fliesst NUR der Pegel, im 100-ms-Takt des
 * Lieferanten (pegel.ts rechnet ohnehin in 100-ms-Fenstern), als
 * Server-Sent Events durch den pipenden /player-Proxy (server.ts:
 * `playerRes.pipe(res)`, nichts puffert). Die Oberflaeche haengt sich mit
 * EventSource daran und ist vom restlichen Zustandsgeschehen entkoppelt.
 * Laeuft der Lieferant nicht (Pause/Stopp), fliessen Nullen — fuer den
 * Zeichner ist das ehrliche Stille, seine Stille-Pause greift wie gehabt.
 */
app.get('/pegelstrom', (req: any, res: any) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  res.write('\n')
  const takt = setInterval(() => {
    res.write(`data: ${JSON.stringify(pegelLesen() ?? [0, 0, 0, 0])}\n\n`)
  }, 100)
  req.on('close', () => clearInterval(takt))
})

app.get('/state', (_req: any, res: any) => {
  if (currentMeta.currentPlayer === 'spotify') {
    spotifyApi
      .getMyCurrentPlaybackState({
        additional_types: 'episode,track',
      })
      .then(
        (data: any) => {
          counter.countgetMyCurrentPlaybackStateHTTP++
          if (config.server.logLevel === 'debug') {
            writeCounter()
          }
          let state = data.body
          if (Object.keys(state).length === 0) {
            state = {
              item: {
                album: {
                  name: '',
                  total_tracks: '',
                },
                name: '',
                track_number: '',
              },
              currently_playing_type: '',
            }
          }
          // Spotifys Antwort hinkt nach einem Start mehrere Sekunden hinterher
          // und meldet noch die Position des VORIGEN Stuecks. Die Regel dagegen
          // steht in fortschritt.ts: weiter als die Zeit seit dem Startbefehl
          // kann ein Stueck nicht sein.
          // NACHLAUF VON SPOTIFY - eine Stelle fuer alle Felder.
          //
          // Nach einem Startbefehl hinkt nicht ein Feld hinterher, sondern die
          // GANZE Antwort: Titel, Dauer und Kontext waren beim Wechsel 0,2 s
          // lang noch die des vorigen Stuecks (systematisch gemessen). Wer das
          // je Feld ausbessert, wird bei jedem neuen Feld erneut ueberrascht.
          //
          // Der Beweis steht in der Antwort selbst: wir wissen, WAS wir
          // befohlen haben. Meldet Spotify einen anderen Kontext, ist alles
          // darin von vorher. Sichtbar log-en - so faellt ein neues Feld auf,
          // ohne dass es jemand meldet.
          const jetztMs = Date.now()
          const veraltet = fortschritt.zustandVeraltet(
            state?.context?.uri,
            currentMeta.activeSpotifyId,
            startpunkt,
            jetztMs,
          )
          if (veraltet) {
            log.debug(
              `${nowDate.toLocaleString()}: [Spotify Control] Antwort noch vom vorigen Stueck ` +
                `(gemeldet ${state?.context?.uri}, befohlen ${currentMeta.activeSpotifyId})`,
            )
          }

          // Die beiden Felder, die dabei SICHTBAR luegen, werden richtiggestellt:
          // die Position sprang bis zu 103 s zurueck, der Abspiel-Knopf auf
          // "abspielen". Titel und Dauer hinken rund eine Sekunde nach - das
          // faellt kaum auf und laesst sich hier nicht ehrlich erfinden.
          if (state.is_playing === false && fortschritt.spieltWirklich(false, startpunkt, jetztMs)) {
            state = { ...state, is_playing: true }
          }
          if (typeof state.progress_ms === 'number') {
            const echt = fortschritt.richtig(state.progress_ms, startpunkt, jetztMs)
            if (echt !== state.progress_ms) {
              state = { ...state, progress_ms: echt }
            }
          }
          // PEGEL ADDITIV, NIE EIN EIGENER KANAL (BACKLOG E99): `pegel:
          // undefined` verschwindet beim Senden von selbst — `JSON.stringify`
          // laesst jeden Schluessel mit dem Wert `undefined` weg. Das IST der
          // Mechanismus fuer "Feld fehlt ganz, wenn der Abgriff nicht
          // verfuegbar ist" (pegelLesen() liefert dann `undefined`); die
          // Oberflaeche behandelt fehlend wie "Funktion nicht da".
          res.send({ ...state, pegel: pegelLesen() })
        },
        (err: any) => {
          handleSpotifyError(err, 'stateHTTP')
        },
      )
  } else {
    const state = {
      item: {
        album: {
          name: '',
          total_tracks: '',
        },
        name: '',
        track_number: '',
      },
      currently_playing_type: '',
    }
    // Additiv wie im Spotify-Zweig oben — dieselbe Begruendung dort.
    // `fremd` (E104) ebenfalls additiv und NUR in diesem Zweig: spielt der
    // Dienst selbst Spotify, ist nichts fremd; hier dagegen sieht die
    // Oberflaeche, dass die Box toent, obwohl die Buchfuehrung leer ist.
    fremdeLageHolen().then(
      (fremd) => res.send({ ...state, pegel: pegelLesen(), ...(fremd ? { fremd } : {}) }),
      () => res.send({ ...state, pegel: pegelLesen() }),
    )
  }
})

/*endpoint to return all local metainformation*/
/*only used if sonos-kids-player is modified*/
/* ══ `spielerArt` — DAMIT DIE ANTWORT SICH SELBST ERKLAERT ════════════════
 *
 * Betreiber, 04.09.2026: „ich denke es stiftet jedes mal verwirrung auch
 * wenn man direkt in den code schaut."
 *
 * `currentPlayer` nennt die MASCHINE ('spotify', 'mplayer', 'mpv') und ist
 * damit ehrlich — aber wer nur wissen will „Datei oder Spotify?", muss
 * wissen, dass ZWEI der drei Namen dasselbe bedeuten. Genau daran ist heute
 * eine Messung falsch gelesen worden.
 *
 * `spielerArt` beantwortet diese Frage direkt: 'spotify', 'datei' oder ''
 * (nichts laeuft). Wer sie stellt, braucht keine Namensliste mehr.
 *
 * ABGELEITET, NICHT GESPEICHERT, und das ist der ganze Punkt: Ein zweites
 * FELD im Zustand koennte gegen `currentPlayer` auseinanderlaufen — genau
 * die Bauart, die als E110 (zwei Wahrheiten ueber ein Werk) und E111 (zwei
 * Listen derselben Quelle) schon zweimal bezahlt wurde. Hier gibt es
 * weiterhin EINE Wahrheit; `spielerArt` ist nur ihre lesbare Form und kann
 * per Konstruktion nicht abweichen.
 */
function spielerArtAus(wert: unknown): 'spotify' | 'datei' | '' {
  if (wert === 'spotify') return 'spotify'
  return istDateiSpieler(wert) ? 'datei' : ''
}

app.get('/local', (_req: any, res: any) => {
  // Additiv wie bei /state — siehe die Begruendung dort. `fremd` (E104) nur,
  // wenn die eigene Buchfuehrung NICHT Spotify spielt (sonst ist es eigen).
  const art = { spielerArt: spielerArtAus(currentMeta.currentPlayer) }
  if (currentMeta.currentPlayer === 'spotify') {
    res.send({ ...currentMeta, ...art, pegel: pegelLesen() })
    return
  }
  fremdeLageHolen().then(
    (fremd) => res.send({ ...currentMeta, ...art, pegel: pegelLesen(), ...(fremd ? { fremd } : {}) }),
    () => res.send({ ...currentMeta, ...art, pegel: pegelLesen() }),
  )
})

/* Embedded ID3v2 APIC cover of an mp3 (per-track thumbnails in the cover-flip
   track picker). Reads only the first 1 MB (the tag sits at the file start),
   caches per file path. Minimal parser: v2.3 (plain BE sizes) + v2.4 (syncsafe). */
const COVER_READ_BYTES = 1024 * 1024
const coverCache = new Map()
function extractEmbeddedCover(file: string) {
  if (coverCache.has(file)) return coverCache.get(file)
  let out = null
  try {
    const fd = fs.openSync(file, 'r')
    const raw = Buffer.alloc(COVER_READ_BYTES)
    const n = fs.readSync(fd, raw, 0, COVER_READ_BYTES, 0)
    fs.closeSync(fd)
    const b = raw.subarray(0, n)
    if (b.length > 10 && b.toString('latin1', 0, 3) === 'ID3') {
      const ver = b[3]
      const syncsafe = (o: number) =>
        ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f)
      const tagEnd = Math.min(syncsafe(6) + 10, b.length)
      let off = 10
      if (b[5] & 0x40) off += (ver === 4 ? syncsafe(10) : b.readUInt32BE(10)) + 4
      while (off + 10 <= tagEnd) {
        const id = b.toString('latin1', off, off + 4)
        if (!/^[A-Z0-9]{4}$/.test(id)) break
        const size = ver === 4 ? syncsafe(off + 4) : b.readUInt32BE(off + 4)
        if (size <= 0 || off + 10 + size > b.length) break
        if (id === 'APIC') {
          let p = off + 10
          const enc = b[p]
          p += 1
          const mimeEnd = b.indexOf(0, p)
          const mime = b.toString('latin1', p, mimeEnd) || 'image/jpeg'
          p = mimeEnd + 1
          p += 1 // picture type
          if (enc === 1 || enc === 2) {
            while (p + 1 < b.length && !(b[p] === 0 && b[p + 1] === 0)) p += 2
            p += 2
          } else {
            while (p < b.length && b[p] !== 0) p += 1
            p += 1
          }
          out = { mime, data: Buffer.from(b.subarray(p, off + 10 + size)) }
          break
        }
        off += 10 + size
      }
    }
  } catch {
    /* no cover -> null */
  }
  if (coverCache.size > 100) coverCache.clear()
  coverCache.set(file, out)
  return out
}

/* Per-track cover image for the track picker (nr = 1-based playlist index). */
app.get('/trackcover/:nr', (req: any, res: any) => {
  try {
    const q = typeof req.query.a === 'string' ? req.query.a : ''
    const p = q || currentMeta.path
    if (!p || decodeURIComponent(p).includes('..')) {
      res.status(404).end()
      return
    }
    const m3u = `/home/dietpi/MuPiBox/media/${decodeURIComponent(p)}/playlist.m3u`
    const lines = fs
      .readFileSync(m3u, 'utf8')
      .split(/\r?\n/)
      .filter((l: string) => l.trim() && !l.startsWith('#'))
    const idx = Number.parseInt(req.params.nr, 10) - 1
    if (!(idx >= 0 && idx < lines.length)) {
      res.status(404).end()
      return
    }
    const pic = extractEmbeddedCover(lines[idx])
    if (!pic) {
      res.status(404).end()
      return
    }
    res.set('Content-Type', pic.mime)
    res.set('Cache-Control', 'public, max-age=86400')
    res.send(pic.data)
  } catch {
    res.status(404).end()
  }
})

/* Track list of a LOCAL album (cover-flip track picker): ?a=<path> names an
   album explicitly (browse without playing), default = the running album. */
app.get('/tracklist', (req: any, res: any) => {
  try {
    const q = typeof req.query.a === 'string' ? req.query.a : ''
    const p = q || currentMeta.path
    if (!p || decodeURIComponent(p).includes('..')) {
      res.json({ tracks: [] })
      return
    }
    const m3u = `/home/dietpi/MuPiBox/media/${decodeURIComponent(p)}/playlist.m3u`
    const lines = fs
      .readFileSync(m3u, 'utf8')
      .split(/\r?\n/)
      .filter((l: string) => l.trim() && !l.startsWith('#'))
    const tracks = lines.map((l: string, i: number) => ({ nr: i + 1, name: path.parse(l).name }))
    res.json({ tracks })
  } catch (err) {
    log.warn(`tracklist failed: ${(err as Error)?.message ?? err}`)
    res.json({ tracks: [] })
  }
})

app.get('/spotify/token', (_req: any, res: any) => {
  const accessTokenData = apiAccessToken
  const refreshToken = refreshTokenApi

  if (accessTokenData.accessToken !== null && accessTokenData.expires > Date.now()) {
    res.send(accessTokenData.accessToken)
  } else {
    refreshToken()
      .then(() => res.send(accessTokenData.accessToken))
      .catch((err: any) => res.status(500).send(`Error refreshing token: ${err}`))
  }
})

/*sonos-kids-controller sends commands via http get and uses path names for encoding*/
/*commands are as defined in sonos-kids-controller and mapped spotify calls*/
//
// SEIT DEM 04.08.2026 `async` — WEGEN GENAU EINES ZWEIGES: `stop`. Er wartet
// jetzt ab, bis Spotify die Pause bestaetigt hat, bevor hier unten geantwortet
// wird (BACKLOG E24/O2; die Begruendung steht an `stop()`).
//
// FUER ALLE ANDEREN BEFEHLE AENDERT SICH NICHTS, und das ist kein Zufall,
// sondern wie `async` arbeitet: Eine asynchrone Funktion laeuft bis zum ERSTEN
// `await` ganz gewoehnlich durch. Wo keines steht — also in jedem Zweig ausser
// `stop` —, wird `res.send` unten im selben Zug erreicht wie vorher.
/**
 * DAS AUFFANGNETZ UNTER DEM VERTEILER — express 4 hat keins fuer Versprechen.
 *
 * WARUM ES SEIT DEM 05.08.2026 HIER STEHT (beim Gegenlesen von E24/O2
 * gefunden und gemessen, tools/verteiler-wirft-messen.mjs): Der Verteiler war
 * bis zur Reparatur an `stop()` SYNCHRON. Express 4 fasst einen synchronen
 * Zuhoerer in ein try/catch (Layer.handle_request) und antwortet auf einen Wurf
 * mit 500. Ein `async`-Zuhoerer gibt statt dessen ein VERSPRECHEN zurueck, und
 * darauf sieht der Router von express 4 nirgends hin. Ein Wurf wurde damit zu
 * einer stillen Ablehnung: KEINE Antwort, und der Aufrufer wartet, bis er selbst
 * aufgibt — `spielerBefehl` in NewDesign/app.js hat keine Frist, die Kachel
 * bliebe also fuer immer am Leuchten.
 *
 * GEMESSEN AM WIRKLICHEN DIENST (`GET /<raum>/radio/%`, 05.08.2026):
 *
 *     Verteiler synchron (Stand vor E24/O2)    Antwort 500 nach 6 ms
 *     Verteiler `async`, ohne dieses Netz      KEINE Antwort nach 5000 ms
 *     Verteiler `async`, mit diesem Netz       Antwort 500 nach wenigen ms
 *
 * UND ES GIBT ETWAS ZU WERFEN, das kein Angriff ist: der Verteiler ruft
 * `decodeURIComponent` selbst (Zweige `radio`, `jellyfin`, `ard`, `rss`) und
 * ueber `deleteLocal`. Ein einzelnes `%` im Namen wirft dort URIError — genau
 * die Sorte, gegen die befehlspfad.ts ausdruecklich absichert („ES WIRD NIE
 * GEWORFEN") und die dieses Projekt an mpv-protokoll.ts schon einmal bezahlt
 * hat („50% off.mp3").
 *
 * 500 IST HIER DIE RICHTIGE ANTWORT, nicht 200: die Oberflaeche liest bei
 * `stop` den Koerper und faellt bei einer Antwort, die nicht `ok` ist, auf die
 * feste Atempause zurueck (`anhaltenUndAbstand`). Ein geschoenter Erfolg
 * naehme ihr genau diese Entscheidung ab.
 */
app.use((req: any, res: any) => {
  befehlVerteilen(req, res).catch((fehler: unknown) => {
    log.error(
      `${new Date().toLocaleString()}: [Spotify Control] Verteiler: ${(fehler as Error)?.stack ?? fehler} (url: ${req.url})`,
    )
    // NUR WENN NOCH NICHTS HINAUS IST. Ein Zweig, der schon geantwortet und
    // DANACH geworfen hat, bekaeme sonst „Cannot set headers after they are
    // sent" obendrauf — und im Protokoll staende der falsche Fehler.
    if (!res.headersSent) res.status(500).send({ status: 'error', error: 'intern' })
  })
})

async function befehlVerteilen(req: any, res: any) {
  const command = path.parse(req.url)
  // The command VERB is the path segment right after the room (`/<room>/<verb>/…`).
  // Match on it precisely rather than `dir.includes(...)`, so a stream URL that
  // happens to contain a verb word (e.g. a `jellyfin.example.com` host) can't
  // trigger the wrong branch.
  // Zerlegt wird in befehlspfad.ts — dort steht die MESSUNG, die zeigt, dass
  // dieser Unterschied kein Feinschliff ist (podcast-mp3.dradio.de).
  const verb = verbAusPfad(command.dir)
  log.debug(`${nowDate.toLocaleString()}: [Spotify Control]name: ${command.name}`)
  log.debug(`${nowDate.toLocaleString()}: [Spotify Control]dir: ${command.dir}`)
  /*this is the first command to be received. It always includes the device id encoded in between two /*/
  /*check this if we need to transfer the playback to a new device*/
  if (command.name.includes('spotify:')) {
    // ERST DIE ANDERE MASCHINE, DANN DIESE — siehe `tonmaschineUebernehmen`.
    // `useSpotify` setzt `currentPlayer` selbst; das ist jetzt eine
    // Wiederholung und keine Entscheidung mehr.
    await tonmaschineUebernehmen('spotify')
    useSpotify(command)
  }

  if (command.dir.includes('library')) {
    await tonmaschineUebernehmen('mplayer')
    currentMeta.currentType = 'local'
    playList(command.name)
  }

  // ── DIESE DREI ZWEIGE SCHALTEN SEIT DEM 04.08.2026 AUF DAS VERB ───────────
  // Sie standen auf `command.dir.includes(...)`, und das ist nachweislich
  // falsch, sobald ein Dienst FREMDE Adressen durchreicht. Gemessen mit
  // tools/ard-modul-probe.ts (Unterbefehl `zweige`):
  //
  //   * Die ARD liefert alles von Deutschlandfunk/Deutschlandradio ueber
  //     `podcast-mp3.dradio.de` — „dradio" enthaelt „radio". Jede
  //     Kakadu-Folge (das Kinderhoerspiel des Deutschlandfunks) zog damit
  //     ZUSAETZLICH den Radio-Zweig: currentType kurz auf 'radio', also
  //     Endlosstrom ohne Dauer und ohne Springen, und
  //     `dir.split('radio/').pop()` fand kein „radio/" und gab den GANZEN
  //     Pfad als Adresse an playURL.
  //   * `ardqueue` und `jfqueue` ENTHALTEN „queue" — beide zogen also auch
  //     den Zweig fuer das LOKALE Anhaengen und schoben eine
  //     `…/media/Titel/title/artist/Interpret/playlist.m3u` in die
  //     Warteschlange, die es nicht gibt.
  //
  // `library` und `deletelocal` bleiben ABSICHTLICH bei `includes`: dort ist
  // das Wort nicht das Verb. Die Oberflaechen schicken
  // `musicsearch/library/album/…` (media-provider.ts, NewDesign app.js), das
  // Verb ist also `musicsearch`. Wer diese Zeilen „einheitlich" mitzieht,
  // legt die lokale Bibliothek still.
  if (verb === 'queue') {
    // "Play next": append the album to the running mplayer playlist WITHOUT
    // interrupting the current playback; with nothing running, just start it.
    await queueAlbum(command.name)
  }

  if (verb === 'radio') {
    await tonmaschineUebernehmen('mplayer')
    currentMeta.currentType = 'radio'
    const parts = decodeURIComponent(command.name).split(':title:artist:')
    currentMeta.currentTrackname = parts[0]
    currentMeta.album = parts[1]
    playURL(adresseAusPfad(command.dir))
  }

  if (verb === 'rss') {
    await tonmaschineUebernehmen('mplayer')
    currentMeta.currentType = 'rss'
    const parts = decodeURIComponent(command.name).split(':title:artist:')
    currentMeta.currentTrackname = parts[0]
    currentMeta.album = parts[1]
    playURL(adresseAusPfad(command.dir))
  }

  if (verb === 'jellyfin') {
    // Jellyfin (B3): a media stream URL played through the generic mplayer path
    // — same mechanism as radio, but as a FINITE track (currentType 'jellyfin'
    // keeps duration/seek instead of radio's endless-stream handling).
    await tonmaschineUebernehmen('mplayer')
    currentMeta.currentType = 'jellyfin'
    const parts = decodeURIComponent(command.name).split(':title:artist:')
    currentMeta.currentTrackname = parts[0]
    currentMeta.album = parts[1]
    // Zerlegt wie alle anderen Stroeme auch. Dass das den Normalfall NICHT
    // aendert, haelt befehlspfad.spec.ts ausdruecklich fest — der Test rechnet
    // beide Wege nebeneinander aus. Gewonnen ist eine einzige Stelle, an der
    // eine Adresse aus einem Befehl geholt wird.
    //
    // `parts[0]` GEHT JETZT AUCH AN DEN ABSPIELER (F1) — bisher stand er nur
    // in `currentMeta` und blieb dort stehen, sobald mpv weiterrueckte.
    playURL(adresseAusPfad(command.dir), parts[0])
  }

  if (verb === 'datei') {
    /* EINE LOKALE SPUR ALS EINZELTITEL (E108) — der Baustein der Mischliste:
     * „Titel 1 lokal, Titel 2 Jellyfin" laeuft in EINER mpv-Warteschlange,
     * Datei neben Stromadresse. `musicsearch/library` kann das nicht — es
     * spielt GANZE Alben ueber die playlist.m3u
     *
     * Hier kommt ein VOLLER Dateipfad an, und deshalb steht davor der Zaun
     * (`dateiPfadErlaubt`, befehlspfad.ts — dort die Begruendung samt dem
     * Proxy-Weg, ueber den solche Befehle aus dem ganzen Netz eintreffen).
     * Abgewiesen wird MIT EIGENER ANTWORT statt des gemeinsamen `ok` unten:
     * ein Befehl, der nichts spielt, darf nicht als Erfolg zurueckgehen
     * (dasselbe Argument wie bei `deletelocal`).
     *
     * BAUGLEICH ZU `jellyfin`/`plugin`, mit EIGENEM `currentType` — 'datei'
     * statt 'local', obwohl die Quelle lokal liegt: 'local' schaltet die
     * metadata-/path-Hoerer auf „Titel und Album aus dem DATEIPFAD lesen"
     * (m3u-Weg), und der Name dieses Titels reist hier bereits als
     * Datei-Option mit (`playURL` -> ladeBefehl). Und 'jellyfin' waere eine
     * Falschaussage — dieselbe Begruendung wie am plugin-Zweig darunter. */
    const pfad = adresseAusPfad(command.dir)
    if (!dateiPfadErlaubt(pfad)) {
      log.warn(`${nowDate.toLocaleString()}: [Spotify Control] datei abgewiesen (Zaun): ${pfad}`)
      res.status(400).send({ status: 'error', error: 'pfadUnzulaessig' })
      return
    }
    await tonmaschineUebernehmen('mplayer')
    currentMeta.currentType = 'datei'
    const parts = decodeURIComponent(command.name).split(':title:artist:')
    currentMeta.currentTrackname = parts[0]
    currentMeta.album = parts[1]
    // `ab` wie bei `plugin`: ein Mitschnitt einer Quelle mit Vorspann traegt
    // den Vorspann in der Datei — der Befehlsbauer darf ihn ueberspringen.
    playURL(pfad, parts[0], abAusName(command.name))
  }

  if (verb === 'plugin') {
    /* PLUGIN-INHALT (E87) — baugleich zu `ard` und `jellyfin`, und das ist
     * der Punkt: ein Plugin liefert eine Adresse und einen Namen, sonst
     * nichts. Was dahinter fuer ein Dienst steckt, geht den Abspieler nichts
     * an; er bekommt einen ENDLICHEN Strom mit Dauer und Sprungmarke.
     *
     * EIN EIGENES VERB UND NICHT `jellyfin` MITBENUTZT, obwohl der Zweig
     * identisch aussieht: `currentType` steht in jeder Auskunft dieses
     * Dienstes (/state, Telegram, die Wiedergabeleiste). „jellyfin" fuer
     * einen Archive.org-Mitschnitt waere eine Falschaussage, die genau dann
     * auffaellt, wenn jemand einem Fehler nachgeht. */
    await tonmaschineUebernehmen('mplayer')
    currentMeta.currentType = 'plugin'
    const parts = decodeURIComponent(command.name).split(':title:artist:')
    currentMeta.currentTrackname = parts[0]
    currentMeta.album = parts[1]
    playURL(adresseAusPfad(command.dir), parts[0], abAusName(command.name))
  }

  if (verb === 'jfqueue' || verb === 'ardqueue' || verb === 'pluginqueue' || verb === 'dateiqueue') {
    // Append one more stream URL to the running playlist (used to play a whole
    // album/Sendung: play the first track, then queue the rest). No interruption.
    // BEIDE VERBEN, EIN ZWEIG: das Anhaengen ist dienstblind — es bekommt eine
    // fertige Adresse und reicht sie an den Abspieler. Ein zweiter Zweig mit
    // demselben Rumpf waere eine zweite Stelle, an der derselbe Fehler
    // repariert werden muesste.
    //
    // `dateiqueue` (E108) haengt eine lokale DATEI statt einer Stromadresse an
    // — derselbe Rumpf, plus der Zaun des datei-Zweigs: ein voller Dateipfad
    // braucht die Grenze, eine Stromadresse nicht. Abgewiesen wird mit
    // eigener Antwort, siehe den datei-Zweig oben.
    if (verb === 'dateiqueue' && !dateiPfadErlaubt(adresseAusPfad(command.dir))) {
      log.warn(
        `${nowDate.toLocaleString()}: [Spotify Control] dateiqueue abgewiesen (Zaun): ${adresseAusPfad(command.dir)}`,
      )
      res.status(400).send({ status: 'error', error: 'pfadUnzulaessig' })
      return
    }
    //
    // ── EIN ANHAENGEN DARF NIE EINE ZWEITE TONMASCHINE STARTEN ─────────────
    // DAS WAR DER GEMELDETE FEHLER (05.08.2026, am Ton gemessen mit
    // tools/dienstwechsel-am-geraet.mjs, Sorten `nachzuegler-mitten` und
    // `nachzuegler-danach`): `player.queue()` ist in mpv
    // `loadfile <adresse> append-play` — und APPEND-PLAY FAENGT AN ZU SPIELEN,
    // wenn nichts laeuft. Nach einem Wechsel auf Spotify laeuft in mpv nichts.
    //
    // Und solche Befehle kommen NACH dem Wechsel noch an, ohne dass jemand
    // etwas falsch macht: Eine ARD-Sendung mit 30 Folgen wird als EIN Tipp
    // gestartet, aber als 30 Befehle geschickt (`albumSpielen`). Tippt ein Kind
    // waehrenddessen eine Spotify-Kachel, laeuft die Schleife weiter — ihre
    // Nachzuegler trafen bis zum 05.08.2026 auf die schon gewechselte Box und
    // starteten mpv neben librespot. Gemessen: Ausgang 0,5099 -> 0,8439, beide
    // Maschinen hoerbar, `currentPlayer` meldete dabei `spotify`.
    //
    // DER SCHADEN WAR GROESSER ALS „ZWEI TOENE": weil der Zweig `currentPlayer`
    // NICHT anfasste, blieb dort `spotify` stehen. Das naechste `stop` hielt
    // also nur Spotify an — die ARD-Folge lief weiter und war ueber die
    // Oberflaeche gar nicht mehr abzustellen.
    //
    // DREI LAGEN, DREI ANTWORTEN:
    if (currentMeta.currentPlayer === 'spotify') {
      // Spotify besitzt gerade den Ton. Dieser Befehl gehoert zu einem Tipp,
      // der ueberholt wurde — er wird VERWORFEN. Anhaengen kann man nur an
      // etwas, das noch laeuft.
      log.info(
        `${nowDate.toLocaleString()}: [Spotify Control] ${verb} verworfen: Spotify spielt — ein Anhaengen darf keine zweite Tonmaschine starten`,
      )
    } else {
      // Entweder laeuft mpv schon (Normalfall: erster Titel, dann der Rest),
      // oder es laeuft gar nichts — dann startet `append-play` die Wiedergabe.
      // In BEIDEN Faellen muss `currentPlayer` danach 'mplayer' sagen, sonst
      // findet `stop` nichts zum Anhalten.
      //
      // ── DER NAME DIESER FOLGE REIST MIT (F1) ────────────────────────────
      // Er steht schon im Befehl und wurde bis zum 06.08.2026 einfach
      // weggeworfen: benutzt war nur `command.dir`.
      //
      //     ardqueue/<Adresse>/Zu Besuch:title:artist:Die Maus
      //                        ^^^^^^^^^ das hier
      //
      // ZERLEGT WIE IN DEN ZWEIGEN OBEN, absichtlich Zeichen fuer Zeichen
      // gleich: schnitte das Anhaengen anders als der Startbefehl, hiesse die
      // erste Folge anders als die zweite, und dieser Unterschied faellt erst
      // an einem Titel auf, den niemand als Testfall haette. Der EINE
      // Unterschied — `titelAusName` wirft nicht — ist in befehlspfad.ts
      // begruendet.
      //
      // `currentMeta.currentTrackname` wird hier NICHT gesetzt — dieser
      // Befehl reiht ein, er spielt nicht. Der Name gilt erst, wenn mpv den
      // Eintrag erreicht, und genau das meldet der media_title-Hoerer.
      player.queue(adresseAusPfad(command.dir), titelAusName(command.name), abAusName(command.name))
      currentMeta.currentPlayer = DATEI_SPIELER
    }
  }

  // ── ARD Audiothek (BACKLOG E4/A5, 04.08.2026) ─────────────────────────────
  // WARUM NICHT DAS jellyfin-VERB MITBENUTZT: es waere ein Wort, das luegt —
  // und `currentType` ist keine Beschriftung, sondern eine Weiche. An ihr
  // haengen die beiden Hoerer oben (metadata/path), die bei 'local' den Titel
  // und das Album aus der DATEI ziehen. Fuer eine http-Adresse ergaebe das
  // Unsinn: `val.split('/')[7]` eines Akamai-Pfades stuende dann als Album in
  // der Oberflaeche. Genau deshalb steht 'ard' dort jetzt mit in der Reihe.
  //
  // WAS HIER NICHT PASSIERT: aufloesen. Die Tonadresse der ARD hat eine
  // Verweildauer und wird deshalb erst kurz vor dem Abspielen geholt — das tut
  // der backend-api (ard.ts + /api/werke/:schluessel/inhalt). Der Abspieler
  // bekommt eine fertige, frische Adresse und spielt sie, wie er Jellyfin
  // spielt. Es ist dieselbe nackte MP3-Strecke (am 04.08.2026 mit ffprobe
  // belegt: reines MP3, Dauer wie im Feld `duration`) — kein neuer Abspieler.
  if (verb === 'ard') {
    await tonmaschineUebernehmen('mplayer')
    currentMeta.currentType = 'ard'
    const parts = decodeURIComponent(command.name).split(':title:artist:')
    currentMeta.currentTrackname = parts[0]
    currentMeta.album = parts[1]
    // Der Folgenname geht mit in die Warteschlange — siehe den jellyfin-Zweig.
    // UND DER VORSPANN-SPRUNG: er steht als `:ab:N` im Namen (abAusName,
    // rein + getestet) und wird hier nur weitergereicht.
    playURL(adresseAusPfad(command.dir), parts[0], abAusName(command.name))
  }

  // VORLESEN. Geprueft wird das VERB, wie bei den anderen Zweigen auch — und
  // nicht mehr `command.dir.includes('say/')`. Das war schlicht falsch:
  // `path.parse('/current/say/Hallo').dir` ist `/current/say`, OHNE
  // Schraegstrich am Ende. Der Zweig feuerte nur, weil die Oberflaeche die
  // Lautstaerke anhaengt (`…/Hallo/40`); wer in `/api/sonos` kein `tts.volume`
  // stehen hat, dessen Box blieb still — ohne eine Zeile im Protokoll.
  // Zerlegung und Nachweis: sprechen.ts / sprechen.spec.ts.
  //
  // UND DANACH IST SCHLUSS — `return`, nicht durchfallen. Sonst laeuft der
  // Befehl weiter in die Kette unten, die auf `command.name` schaltet, und
  // `command.name` ist bei einem Sprechbefehl DER GESPROCHENE TEXT. Eine
  // Kachel namens „stop" haette also ihren Namen gesagt UND die Wiedergabe
  // angehalten; „reboot" haette die Box neu gestartet.
  //
  // Bisher fiel das nicht auf, weil der Zweig nur mit angehaengter
  // Lautstaerke feuerte — dann ist `command.name` die Zahl. Wer die schlichte
  // Form zum Laufen bringt (und das tut dieser Umbau), macht diese Falle
  // scharf. Deshalb steht sie hier zu.
  if (verb === 'say') {
    const text = sprechen.sprechTextAus(req.url)
    if (text) {
      void vorlesenBereitPruefen().then((bereit) => {
        if (bereit) sprichText(text)
      })
    }
    res.send({ status: 'ok', error: 'none' })
    return
  }

  // LOESCHEN ANTWORTET SELBST — und faellt nicht in die Kette darunter.
  //
  // Zwei Gruende, hier abzubiegen. Erstens ist `command.name` fuer diesen
  // Zweig unbrauchbar (`path.parse` schneidet den Titel am letzten Punkt ab);
  // gelesen wird deshalb `req.url`. Zweitens ist die gemeinsame Antwort ganz
  // unten ein festes `{status:'ok'}` — und ein Loeschen, das nichts getroffen
  // hat, darf nicht als Erfolg zurueckgehen. Der Grund geht mit hinaus,
  // damit ihn eine Oberflaeche anzeigen KANN; die heutige wirft ihn noch weg
  // (player.service.ts `sendRequest` schluckt Fehler), aber sie muss dann
  // wenigstens nicht raten, und im Protokoll steht die Zeile ohnehin.
  if (command.dir.includes('deletelocal')) {
    const ausgang = await deleteLocal(req.url)
    if (ausgang.ok) res.send({ status: 'ok', error: 'none', geloescht: ausgang.pfad })
    else res.status(400).send({ status: 'error', error: ausgang.grund })
    return
  }

  // Wie das Anhalten ausging — nur bei `stop` gesetzt, sonst bleibt es weg.
  let angehalten: AnhalteAusgang | null = null

  if (command.name === 'pause') pause()
  else if (command.name === 'play') play()
  // DAS EINZIGE `await` IN DIESER KETTE. Erst wenn Spotify die Pause bestaetigt
  // hat (oder die Frist abgelaufen ist), geht die Antwort hinaus — damit der
  // Startbefehl, den die Oberflaeche gleich danach schickt, NACH der Pause bei
  // Spotify ankommt und nicht mit ihr um die Wette laeuft. E24/O2.
  else if (command.name === 'stop') angehalten = await stop()
  else if (command.name === 'next') next()
  else if (command.name === 'previous') previous()
  else if (command.name === '+5') setVolume(1)
  else if (command.name === '-5') setVolume(0)
  else if (command.name === 'shuffleon') shuffleon()
  else if (command.name === 'shuffleoff') shuffleoff()
  else if (command.name === 'shutoff') cmdCall('sudo su - -c "/usr/local/bin/mupibox/./shutdown.sh &"')
  else if (command.name === 'clearresume') cmdCall('sudo bash /usr/local/bin/mupibox/clearresume.sh')
  else if (command.name === 'maxresume') cmdCall('sudo bash /usr/local/bin/mupibox/remove_max_resume.sh')
  else if (command.name === 'networkrestart') cmdCall('sudo service ifup@wlan0 stop && sudo service ifup@wlan0 start')
  else if (command.name === 'reboot') cmdCall('sudo su - -c "/usr/local/bin/mupibox/./restart.sh &"')
  else if (command.name === 'index') cmdCall('sudo bash /usr/local/bin/mupibox/add_index.sh')
  else if (command.name === 'seek+30') seekRelativ(true)
  else if (command.name === 'seek-30') seekRelativ(false)
  else if (command.name === 'recordon') {
    // Recording STATE only for now — the actual capture pipeline lands with the
    // recorder integration (MODERNIZATION.md B5). The UI reflects this flag.
    currentMeta.recording = true
    log.info(`${nowDate.toLocaleString()}: [Spotify Control] recording ON (stub — capture pipeline pending)`)
  } else if (command.name === 'recordoff') {
    currentMeta.recording = false
    log.info(`${nowDate.toLocaleString()}: [Spotify Control] recording OFF`)
  } else if (command.name.includes('tracknr:')) {
    // Jump to playlist track N (cover-flip track picker). mplayer only knows
    // relative playlist steps, so send the delta from the current track. The
    // metadata handler adds +1 on the resulting track change — pre-set N-1.
    const target = Number.parseInt(command.name.split(':')[1], 10)
    if (!Number.isNaN(target) && istDateiSpieler(currentMeta.currentPlayer)) {
      // ABSOLUT, WENN DIE TONMASCHINE ES KANN (mpv), sonst wie bisher relativ.
      //
      // WARUM DIESE VERZWEIGUNG NOETIG WAR: Der relative Weg ruft
      // `player.exec('pt_step')`. Im mpv-Aufsatz ist `exec` ein bewusstes
      // Loch — es meldet eine Zeile nach stderr und tut NICHTS (mpv-wrapper,
      // Abschnitt „roher Befehl ohne Entsprechung"). Der Dienst antwortete
      // trotzdem mit `{status:'ok'}`, und die Oberflaeche hielt den Sprung
      // fuer gelungen. Auf einer mpv-Box tat ein Tipp auf einen Titel also
      // NICHTS, ohne dass irgendwo ein Fehler stand.
      //
      // Der absolute Sprung ist ausserdem der richtigere: Die Differenz
      // stimmt nur, solange `currentTracknr` mit der Wirklichkeit
      // uebereinstimmt — nach `stop`, nach einem Fehlschlag oder nach einem
      // Titelwechsel von selbst tut sie das nicht, und der Sprung landet
      // daneben.
      if (typeof player.titelPos === 'function') {
        currentMeta.currentTracknr = target
        player.titelPos(target)
        writeplayerstatePlay()
      } else {
        const delta = target - (Number(currentMeta.currentTracknr) || 1)
        if (delta !== 0) {
          // Der Metadaten-Zweig zaehlt beim folgenden Titelwechsel +1 dazu -
          // deshalb hier N-1 vorsetzen. Beim absoluten Weg oben entfaellt das,
          // weil mpv die Nummer selbst meldet.
          currentMeta.currentTracknr = target - 1
          player.exec('pt_step', [delta])
          writeplayerstatePlay()
        }
      }
    }
  } else if (command.name.includes('setvolume:')) setVolumeTo(command.name.split(':')[1])
  else if (command.name.includes('seekpos:')) {
    // ABSOLUT, immer. Frueher ging das durch `seek()`, und ein Ziel von 0
    // landete dort im Relativ-Zweig — siehe die Begruendung an seekAbsolut.
    seekAbsolut(command.name.split(':')[1])
  } else if (command.name === 'albumstop') cmdCall('bash /usr/local/bin/mupibox/albumstop.sh')
  else if (command.name === 'enablewifi')
    cmdCall(
      "sudo sed -i -e 's/dtoverlay=disable-wifi//g' /boot/config.txt && sudo head -n -1 /boot/config.txt > /tmp/config.txt && sudo mv /tmp/config.txt /boot/config.txt && sudo su - -c '/usr/local/bin/mupibox/restart.sh &'",
    )

  /*   else if (command.name.includes("jumpto:")){
    let offsetTrackNr = command.name.split(':')[1];
    jumpTo(offsetTrackNr);
  } */

  // `angehalten` STEHT NUR BEI `stop` DABEI, und das ist Absicht: ein Feld,
  // das in jeder Antwort mit `null` herumsteht, wird gelesen, als bedeute es
  // etwas. Die Oberflaeche fragt danach — fehlt es, hat sie einen alten
  // Abspieldienst vor sich und haelt weiter selbst Abstand (NewDesign/app.js,
  // `SPOTIFY_ATEMPAUSE_MS`). Genau dieser Rueckfall ist der Grund, ueberhaupt
  // etwas mitzuschicken: server.js und spotify-control.js liegen auf der Box in
  // ZWEI VERSCHIEDENEN Ordnern (llmwiki spotify-control-liegt-woanders), man
  // kann also sehr wohl eine neue Oberflaeche neben einem alten Dienst haben.
  const resp = { status: 'ok', error: 'none', ...(angehalten ? { angehalten } : {}) }
  res.send(resp)
}

/**
 * NUR AUF DER RUECKSCHLEIFE — und das ist eine Kinderzeit-Frage, keine Kosmetik.
 *
 * ══ WAS VORHER OFFENSTAND ═══════════════════════════════════════════════════
 *
 * Hier stand `server.listen(config.server.port)` ohne Adresse, und Node hoert
 * dann auf ALLEN Schnittstellen. Damit konnte JEDES Geraet im WLAN
 *
 *     curl http://<box>:5005/current/spotify/now/spotify:album:…
 *
 * absetzen — und die Kinderzeit ist an dieser Adresse nicht: sie sitzt im
 * BACKEND-API (`app.use('/player', …)` samt `istStartbefehl`, und seit dem
 * 14.08.2026 zusaetzlich in `spielweg.ts`). Wer den Proxy umgeht, umgeht sie
 * mit. Ein Kind mit einem Telefon im selben Netz brauchte keine Luecke im
 * Programm, nur die Portnummer.
 *
 * ══ WARUM ES TROTZDEM KEIN EINZEILER WAR ════════════════════════════════════
 *
 * Vier Stuecke auf der Box riefen den Dienst ueber die AUSSENADRESSE an, nicht
 * ueber die Schleife — gemessen am 14.08.2026:
 *
 *     mupibox.host                    = "MixPiBox"
 *     $(hostname) loest auf zu          2001:9e8:…  (oeffentliches IPv6)
 *
 *   scripts/mqtt/mqtt.py                :5005/pause, :5005/play
 *   scripts/telegram/telegram_receiver.py  dito
 *   scripts/mupibox/get_deviceid.sh     :5005/getDevices
 *   scripts/mupibox/set_deviceid.sh     dito
 *
 * Alle vier laufen AUF der Box und sind mit auf 127.0.0.1 umgestellt. Wer
 * diese Zeile aendert, ohne dort nachzusehen, legt Telegram und die
 * Haussteuerung still — und zwar leise, denn beide melden einen Fehlschlag
 * nur im Journal.
 *
 * ══ WAS DAMIT NICHT KAPUTTGEHT ══════════════════════════════════════════════
 *
 *   * Home Assistant spricht MQTT und nicht diesen Port (homeassistant/).
 *   * `mupictl --device X forward` tunnelt ueber SSH nach localhost — der
 *     Tunnel endet also AUF der Box und trifft die Schleife.
 *   * Das backend-api bleibt unveraendert offen: es liefert die Oberflaechen
 *     aus und MUSS aus dem Netz erreichbar sein. Dort sitzt die Kinderzeit.
 */
server.listen(config.server.port, '127.0.0.1')
console.log(
  `${nowDate.toLocaleString()}: [mupibox-backend-player] Server started at ${_useTls ? 'https' : 'http'}://127.0.0.1:${config.server.port} (nur Rueckschleife)`,
)
