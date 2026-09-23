#!/usr/bin/env node
/**
 * WECHSELT DER DIENST DIE TONMASCHINE WIRKLICH? — am ECHTEN Abspieldienst.
 *
 * WOZU: Am 05.08.2026 wurde an der Box .169 gemessen, dass zwei Toene zugleich
 * klingen koennen (tools/dienstwechsel-am-geraet.mjs, Sorten
 * `nachzuegler-mitten` und `nachzuegler-danach`). Die Ursache lag im
 * Abspieldienst: er hat den Dienstwechsel NIRGENDS vollzogen. Sechs Zweige
 * ueberschrieben `currentMeta.currentPlayer`, und keiner hielt die andere
 * Maschine an — angehalten wurde nur, weil die Oberflaeche vorher ein `stop`
 * schickte.
 *
 * DIESES WERKZEUG PRUEFT DIE REPARATUR AN DER STELLE, AN DER SIE SITZT, und
 * zwar OHNE die Box anzufassen: Es startet den WIRKLICHEN Dienst
 * (src/backend-player/src/spotify-control.ts mit tsx) und spricht ihn ueber
 * HTTP an. Ersetzt sind nur die beiden Aussenwelten:
 *
 *   spotify-web-api-node   Attrappe; ihr `pause()` braucht eine EINSTELLBARE
 *                          Zeit — daran ist zu sehen, ob abgewartet wird.
 *   mplayer/mpv-wrapper    Attrappe, die nichts spawnt, aber JEDEN Aufruf
 *                          MITSCHREIBT. Das ist der Unterschied zu
 *                          tools/anhalten-am-dienst.mjs: dort tut die Attrappe
 *                          nichts, hier sagt sie, WAS verlangt wurde. Ohne das
 *                          liesse sich „mpv wurde angehalten" nicht von „es
 *                          ist nichts passiert" unterscheiden — und genau
 *                          dieser Unterschied ist der Befund.
 *
 * Der Verteiler, `tonmaschineUebernehmen`, `stop()`, die Zeitschranke und
 * express sind ECHT.
 *
 * DIE FUENF FAELLE
 *   1  Spotify laeuft, ein ARD-Start kommt OHNE vorheriges `stop`
 *      -> die Pause geht hinaus UND wird abgewartet; danach 'mplayer'
 *   2  mpv laeuft, ein Spotify-Start kommt OHNE vorheriges `stop`
 *      -> `stop` am Spieler; danach 'spotify'
 *   3  Spotify laeuft, ein NACHZUEGLER (`ardqueue`) trifft ein
 *      -> KEIN `queue` am Spieler; 'spotify' bleibt stehen
 *      (der gemeldete Fehler: `queue` ist in mpv `append-play` und FAENGT AN
 *      ZU SPIELEN, wenn nichts laeuft)
 *   4  es laeuft NICHTS, ein `ardqueue` trifft ein
 *      -> `queue` geht durch (append-play startet), UND der Dienst fuehrt
 *      danach 'mplayer' — sonst faende ein spaeteres `stop` nichts anzuhalten
 *   5  GEGENPROBE mpv -> mpv: KEIN `stop` am Spieler
 *      Eine Reparatur, die hier anhielte, kaufte sich die Sauberkeit mit
 *      einer Luecke Stille zwischen zwei Folgen derselben Sendung.
 *
 * AUFRUF
 *   node tools/dienstwechsel-am-dienst.mjs
 *   node tools/dienstwechsel-am-dienst.mjs --pruefen   # 1 bei Abweichung
 *   node tools/dienstwechsel-am-dienst.mjs --port 5098
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const WURZEL = path.join(HIER, '..')
const PRUEFEN = process.argv.includes('--pruefen')
const PORT = Number(process.argv[process.argv.indexOf('--port') + 1]) || 5098

const arbeit = mkdtempSync(path.join(tmpdir(), 'mupi-dienstwechsel-'))
const TAGEBUCH = path.join(arbeit, 'spieler.log')

const vorschaltung = path.join(arbeit, 'vorschaltung.cjs')
writeFileSync(
  vorschaltung,
  `
const Module = require('node:module')
const fs = require('node:fs')
const echt = Module._load

const KONFIG = ${JSON.stringify({
    spotify: { clientId: '', clientSecret: '', accessToken: '', refreshToken: '', redirectUri: '', deviceId: '' },
    server: { port: String(PORT), logLevel: 'error' },
    ttsLanguage: '',
  })}
const MUPI = ${JSON.stringify({
    mupibox: { host: 'ProbeBox', playerEngine: 'mpv', maxVolume: '100', startVolume: '40' },
    telegram: { active: false, token: '', chatId: '' },
    spotify: {},
  })}

const TAGEBUCH = ${JSON.stringify(TAGEBUCH)}
const schreibe = (was, wer, args) => {
  try {
    fs.appendFileSync(TAGEBUCH, JSON.stringify({ was, wer, args: args.map(String).slice(0, 2), t: Date.now() }) + '\\n')
  } catch {}
}

function FakeSpotify() {}
const sofort = () => Promise.resolve({ body: {} })
FakeSpotify.prototype.setAccessToken = function () {}
FakeSpotify.prototype.refreshAccessToken = function () {
  return Promise.reject(new Error('Probe: keine Zugangsdaten'))
}
FakeSpotify.prototype.getMyDevices = function () {
  return Promise.resolve({ body: { devices: [{ id: 'probe-1', name: 'ProbeBox', is_active: true }] } })
}
FakeSpotify.prototype.transferMyPlayback = sofort
FakeSpotify.prototype.play = function () { schreibe('spotify', 'play', []); return sofort() }
FakeSpotify.prototype.seek = sofort
FakeSpotify.prototype.setShuffle = sofort
FakeSpotify.prototype.setVolume = sofort
FakeSpotify.prototype.skipToNext = sofort
FakeSpotify.prototype.skipToPrevious = sofort
FakeSpotify.prototype.pause = function () {
  schreibe('spotify', 'pause', [])
  const ms = Number(process.env.PROBE_PAUSE_MS || 0)
  return new Promise((f) => setTimeout(() => f({ body: {} }), ms))
}

/** Eine Wiedergabe-Maschine, die nichts spawnt — aber alles aufschreibt. */
const { EventEmitter } = require('node:events')
function fakePlayer() {
  const e = new EventEmitter()
  for (const m of ['exec','getProps','seek','seekPercent','play','playList','queue','queueList','stop','playPause','volume','titelPos','pause','next','previous','setVolume','close']) {
    e[m] = function () { schreibe('spieler', m, Array.from(arguments)) }
  }
  return e
}

Module._load = function (anfrage, eltern, istHaupt) {
  if (/config\\/config\\.json$/.test(anfrage)) return KONFIG
  if (/config\\/mupiboxconfig\\.json$/.test(anfrage)) return MUPI
  if (anfrage === 'spotify-web-api-node') return FakeSpotify
  if (anfrage === './mplayer-wrapper' || anfrage === './mpv-wrapper') return fakePlayer
  return echt.apply(this, arguments)
}
`,
  'utf8',
)

const warte = (ms) => new Promise((f) => setTimeout(f, ms))
const lage = () => fetch(`http://127.0.0.1:${PORT}/local`).then((r) => r.json())

let fehler = 0
const sagen = (gut, text) => {
  console.log(`  ${gut ? 'OK  ' : 'FEHL'}  ${text}`)
  if (!gut) fehler++
}

/** Was der Spieler (und Spotify) seit dem letzten Schnitt zu tun bekam. */
let gelesen = 0
function tagebuchSeitSchnitt() {
  let roh = ''
  try {
    roh = readFileSync(TAGEBUCH, 'utf8')
  } catch {
    return []
  }
  const zeilen = roh.split('\n').filter(Boolean)
  const neu = zeilen.slice(gelesen)
  gelesen = zeilen.length
  return neu.map((z) => JSON.parse(z))
}
const schnitt = () => tagebuchSeitSchnitt()

const TSX = path.join(WURZEL, 'node_modules/.bin/tsx')

async function dienstStarten(pauseMs) {
  try {
    await fetch(`http://127.0.0.1:${PORT}/local`, { signal: AbortSignal.timeout(600) })
    throw new Error(`auf Port ${PORT} antwortet schon jemand — mit --port einen anderen waehlen`)
  } catch (e) {
    if (String(e.message || '').includes('antwortet schon jemand')) throw e
  }

  const kind = spawn(TSX, ['--require', vorschaltung, 'src/backend-player/src/spotify-control.ts'], {
    cwd: WURZEL,
    env: { ...process.env, NODE_ENV: 'probe', PROBE_PAUSE_MS: String(pauseMs) },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  const gemurmel = []
  kind.stdout.on('data', (d) => gemurmel.push(String(d)))
  kind.stderr.on('data', (d) => gemurmel.push(String(d)))

  let da = false
  for (let i = 0; i < 60 && !da; i++) {
    await warte(500)
    try {
      await fetch(`http://127.0.0.1:${PORT}/local`, { signal: AbortSignal.timeout(800) })
      da = true
    } catch {
      /* noch nicht */
    }
  }
  if (!da) {
    try {
      process.kill(-kind.pid, 'SIGKILL')
    } catch {
      /* schon tot */
    }
    throw new Error(`der Dienst kam nicht hoch:\n${gemurmel.join('')}`)
  }
  return kind
}

async function dienstBeenden(kind) {
  try {
    process.kill(-kind.pid, 'SIGKILL')
  } catch {
    /* schon tot */
  }
  // Ein `kill` ist eine Bitte, kein Vollzug — auf den freien Port warten.
  for (let i = 0; i < 40; i++) {
    await warte(100)
    try {
      await fetch(`http://127.0.0.1:${PORT}/local`, { signal: AbortSignal.timeout(300) })
    } catch {
      return
    }
  }
}

// ── Die Befehle, wortgleich wie die Oberflaechen sie schicken ─────────────
const RAUM = 'probe'
const befehl = (pfad) => fetch(`http://127.0.0.1:${PORT}/${RAUM}/${pfad}`).then((r) => r.json())
const SPOTIFY_START = 'now/spotify:album:4aawyAB9vmqN3uQ7FjRGTy:0:0'
const ARD_START = `ard/${encodeURIComponent('http://example.invalid/folge1.mp3')}/Folge%201:title:artist:Die%20Maus`
const ARD_ANHAENGEN = `ardqueue/${encodeURIComponent('http://example.invalid/folge2.mp3')}/Folge%202:title:artist:Die%20Maus`
const ARD_START2 = `ard/${encodeURIComponent('http://example.invalid/folge3.mp3')}/Folge%203:title:artist:Die%20Maus`

console.log(`Der echte Abspieldienst auf Port ${PORT}, Attrappen fuer Spotify und die Wiedergabe-Maschine.\n`)

let kind = null
try {
  // 200 ms Pausendauer: lang genug, um „abgewartet" von „sofort" zu trennen.
  kind = await dienstStarten(200)

  // ── Fall 1 ──────────────────────────────────────────────────────────────
  console.log('Fall 1 — Spotify laeuft, ein ARD-Start kommt OHNE vorheriges `stop`:')
  await befehl(SPOTIFY_START)
  await warte(300)
  sagen((await lage()).currentPlayer === 'spotify', "der Dienst fuehrt 'spotify'")
  schnitt()
  const t1 = Date.now()
  await befehl(ARD_START)
  const dauer1 = Date.now() - t1
  const log1 = schnitt()
  sagen(
    log1.some((z) => z.was === 'spotify' && z.wer === 'pause'),
    'die Spotify-Pause ging hinaus — der Wechsel haelt die andere Maschine an',
  )
  sagen(dauer1 >= 200, `und wurde ABGEWARTET (${dauer1} ms >= 200 ms Pausendauer)`)
  sagen((await lage()).currentPlayer === 'mplayer', "danach fuehrt der Dienst 'mplayer'")

  // ── Fall 2 ──────────────────────────────────────────────────────────────
  console.log('\nFall 2 — mpv laeuft, ein Spotify-Start kommt OHNE vorheriges `stop`:')
  schnitt()
  await befehl(SPOTIFY_START)
  await warte(300)
  const log2 = schnitt()
  sagen(
    log2.some((z) => z.was === 'spieler' && z.wer === 'stop'),
    'mpv wurde angehalten',
  )
  sagen((await lage()).currentPlayer === 'spotify', "danach fuehrt der Dienst 'spotify'")

  // ── Fall 3 — DER GEMELDETE FEHLER ───────────────────────────────────────
  console.log('\nFall 3 — Spotify laeuft, ein NACHZUEGLER (`ardqueue`) trifft ein:')
  schnitt()
  await befehl(ARD_ANHAENGEN)
  await warte(200)
  const log3 = schnitt()
  sagen(
    !log3.some((z) => z.was === 'spieler' && z.wer === 'queue'),
    'KEIN `queue` an mpv — ein Anhaengen startet keine zweite Tonmaschine',
  )
  sagen((await lage()).currentPlayer === 'spotify', "'spotify' bleibt stehen — der Nachzuegler wurde verworfen")

  // ── Fall 4 ──────────────────────────────────────────────────────────────
  console.log('\nFall 4 — es laeuft NICHTS, ein `ardqueue` trifft ein:')
  await befehl('stop')
  await warte(300)
  sagen((await lage()).currentPlayer === '', 'der Dienst fuehrt nichts')
  schnitt()
  await befehl(ARD_ANHAENGEN)
  await warte(200)
  const log4 = schnitt()
  sagen(
    log4.some((z) => z.was === 'spieler' && z.wer === 'queue'),
    '`queue` geht durch — hier gibt es nichts zu ueberlagern',
  )
  sagen(
    (await lage()).currentPlayer === 'mplayer',
    "und der Dienst fuehrt danach 'mplayer' — `append-play` startet die Wiedergabe, ein spaeteres `stop` muss sie finden",
  )

  // ── Fall 5 — Gegenprobe ─────────────────────────────────────────────────
  console.log('\nFall 5 — Gegenprobe mpv -> mpv (zweite Folge derselben Sendung):')
  await befehl('stop')
  await befehl(ARD_START)
  await warte(200)
  schnitt()
  await befehl(ARD_START2)
  await warte(200)
  const log5 = schnitt()
  sagen(
    !log5.some((z) => z.was === 'spieler' && z.wer === 'stop'),
    'KEIN `stop` am Spieler — `loadfile … replace` raeumt selbst auf, ein Halt waere nur Stille',
  )
  sagen(
    !log5.some((z) => z.was === 'spotify' && z.wer === 'pause'),
    'und keine Spotify-Pause, obwohl Spotify vorher einmal lief',
  )
} finally {
  if (kind) await dienstBeenden(kind)
  rmSync(arbeit, { recursive: true, force: true })
}

console.log(fehler ? `\n${fehler} Abweichung(en)` : '\nkeine Abweichung')
if (PRUEFEN && fehler) process.exit(1)
