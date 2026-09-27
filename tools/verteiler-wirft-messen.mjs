#!/usr/bin/env node
/**
 * WAS PASSIERT, WENN IM BEFEHLSVERTEILER ETWAS WIRFT? — am ECHTEN Dienst.
 *
 * WOZU: Beim Gegenlesen von BACKLOG E24/O2 (05.08.2026). Die Reparatur an
 * `stop()` hat den Befehlsverteiler in spotify-control.ts von
 *
 *     app.use((req, res) => { … })          <- vorher, synchron
 *     app.use(async (req, res) => { … })    <- nachher, wegen `await stop()`
 *
 * umgestellt. Das ist nicht folgenlos: express 4 faengt einen SYNCHRONEN Wurf
 * aus einem Zuhoerer ab (Layer.handle_request hat ein try/catch) und antwortet
 * 500. Ein abgelehntes VERSPRECHEN aus einem `async`-Zuhoerer faengt express 4
 * NICHT — es gibt kein `Promise.catch` im Router. Dann geht gar keine Antwort
 * hinaus, und der Aufrufer wartet, bis er selbst aufgibt.
 *
 * UND ES GIBT ETWAS ZU WERFEN. Der Verteiler ruft `decodeURIComponent` direkt
 * (Zweig `radio`, spotify-control.ts) und ueber `deleteLocal`. Ein einzelnes
 * `%` im Pfad ist ein URIError — genau die Sorte, gegen die befehlspfad.ts
 * ausdruecklich abgesichert ist („ES WIRD NIE GEWORFEN"), im Verteiler selbst
 * aber nicht.
 *
 * WAS GEMESSEN WIRD, IN DIESER REIHENFOLGE:
 *   1. der GESUNDE Fall — antwortet der Dienst ueberhaupt?
 *   2. `radio/%`        — ein URIError mitten im Verteiler
 *   3. lebt er danach weiter, oder haengt nur diese eine Anfrage?
 *
 * Der Aufbau ist derselbe wie in tools/anhalten-am-dienst.mjs, samt seiner
 * beiden dort festgehaltenen Fehlgriffe (tsx DIREKT starten, die ganze
 * Prozessgruppe abwuergen). Ersetzt werden nur drei Module: die
 * Spotify-Bibliothek, die Wiedergabe-Maschine und die leeren, root gehoerenden
 * Konfigdateien. Der Verteiler und express sind ECHT.
 *
 * AUFRUF
 *   node tools/verteiler-wirft-messen.mjs
 *   node tools/verteiler-wirft-messen.mjs --pruefen   # Rueckgabewert 1 bei Abweichung
 *   node tools/verteiler-wirft-messen.mjs --geduld 6000 --port 5098
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const WURZEL = path.join(HIER, '..')
const PRUEFEN = process.argv.includes('--pruefen')
const PORT = Number(process.argv[process.argv.indexOf('--port') + 1]) || 5098
/** Wie lange auf eine Antwort gewartet wird, bevor sie als AUSGEBLIEBEN gilt.
 *  Grosszuegig: ein haengender Verteiler soll nicht mit einem langsamen
 *  verwechselt werden. */
const GEDULD = Number(process.argv[process.argv.indexOf('--geduld') + 1]) || 5000

const arbeit = mkdtempSync(path.join(tmpdir(), 'mupi-verteiler-'))
const warte = (ms) => new Promise((f) => setTimeout(f, ms))

let fehler = 0
const sagen = (gut, text) => {
  console.log(`  ${gut ? 'OK  ' : 'FEHL'}  ${text}`)
  if (!gut) fehler++
}

// ── Die Vorschaltung: dieselbe wie in anhalten-am-dienst.mjs ────────────────
const vorschaltung = path.join(arbeit, 'vorschaltung.cjs')
writeFileSync(
  vorschaltung,
  `
const Module = require('node:module')
const echt = Module._load

const KONFIG = ${JSON.stringify({
    spotify: { clientId: '', clientSecret: '', accessToken: '', refreshToken: '', redirectUri: '', deviceId: '' },
    server: { port: String(PORT), logLevel: 'error' },
    ttsLanguage: '',
  })}
const MUPI = ${JSON.stringify({
    mupibox: { host: 'ProbeBox', playerEngine: 'mplayer', maxVolume: '100', startVolume: '40' },
    telegram: { active: false, token: '', chatId: '' },
    spotify: {},
  })}

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
FakeSpotify.prototype.play = sofort
FakeSpotify.prototype.pause = sofort
FakeSpotify.prototype.seek = sofort
FakeSpotify.prototype.setShuffle = sofort
FakeSpotify.prototype.setVolume = sofort
FakeSpotify.prototype.skipToNext = sofort
FakeSpotify.prototype.skipToPrevious = sofort

const { EventEmitter } = require('node:events')
function fakePlayer() {
  const e = new EventEmitter()
  const nichts = () => {}
  for (const m of ['exec','getProps','seek','seekPercent','play','playList','queue','queueList','stop','playPause','volume','titelPos','pause']) {
    e[m] = nichts
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

const TSX = path.join(WURZEL, 'node_modules/.bin/tsx')

async function dienstStarten() {
  try {
    await fetch(`http://127.0.0.1:${PORT}/local`, { signal: AbortSignal.timeout(600) })
    throw new Error(`auf Port ${PORT} antwortet schon jemand — mit --port einen anderen waehlen`)
  } catch (e) {
    if (String(e.message || '').includes('antwortet schon jemand')) throw e
  }

  const kind = spawn(TSX, ['--require', vorschaltung, 'src/backend-player/src/spotify-control.ts'], {
    cwd: WURZEL,
    env: { ...process.env, NODE_ENV: 'probe' },
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
    console.log(gemurmel.join('').split('\n').slice(-12).join('\n'))
    throw new Error(`der Dienst kam auf Port ${PORT} nicht hoch`)
  }

  return {
    gemurmel,
    async beenden() {
      try {
        process.kill(-kind.pid, 'SIGKILL')
      } catch {
        /* schon tot */
      }
      for (let i = 0; i < 25; i++) {
        await warte(200)
        try {
          await fetch(`http://127.0.0.1:${PORT}/local`, { signal: AbortSignal.timeout(400) })
        } catch {
          return
        }
      }
      throw new Error(`Port ${PORT} wurde nicht frei — ein Dienst laeuft noch`)
    },
  }
}

/**
 * Einen ROHEN Pfad schicken und messen, OB und WANN etwas zurueckkommt.
 *
 * ROH heisst: `fetch` darf den Pfad nicht anfassen. Ein einzelnes `%` ist
 * genau das, was gemessen werden soll — wuerde es unterwegs zu `%25`, ginge
 * die Messung ins Leere. `new Request` mit einer fertigen Zeichenkette laesst
 * es stehen (nachgesehen 05.08.2026: `new URL('http://h/a/%').pathname` ist
 * '/a/%').
 */
async function anfrage(pfad) {
  const start = Date.now()
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}${pfad}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(GEDULD),
    })
    let koerper = null
    try {
      koerper = await r.text()
    } catch {
      /* egal */
    }
    return { ms: Date.now() - start, code: r.status, koerper, geantwortet: true }
  } catch (e) {
    return { ms: Date.now() - start, geantwortet: false, grund: String(e.name || e.message) }
  }
}

console.log(`Geduld: ${GEDULD} ms — was laenger braucht, gilt als AUSGEBLIEBEN.\n`)

const dienst = await dienstStarten()
try {
  // ── 1. DER GESUNDE FALL ────────────────────────────────────────────────
  console.log('Fall 1 — ein gewoehnlicher Befehl (`stop`, es laeuft nichts):')
  const gesund = await anfrage('/probe/stop')
  console.log(`  Antwort nach ${gesund.ms} ms: ${gesund.code} ${gesund.koerper}`)
  sagen(gesund.geantwortet, 'der Dienst antwortet ueberhaupt — sonst waere alles Folgende wertlos')

  // ── 2. EIN URIError MITTEN IM VERTEILER ────────────────────────────────
  // `path.parse('/probe/radio/%')` gibt dir='/probe/radio', name='%'. Der
  // Zweig `verb === 'radio'` ruft `decodeURIComponent(command.name)` — und
  // `decodeURIComponent('%')` wirft URIError.
  console.log('\nFall 2 — `radio/%`: decodeURIComponent wirft mitten im Verteiler:')
  const wurf = await anfrage('/probe/radio/%')
  if (wurf.geantwortet) {
    console.log(`  Antwort nach ${wurf.ms} ms: ${wurf.code}`)
  } else {
    console.log(`  KEINE Antwort nach ${wurf.ms} ms (${wurf.grund})`)
  }
  sagen(
    wurf.geantwortet,
    'es kommt eine Antwort zurueck (500 waere recht) — ein `async`-Zuhoerer ohne Auffangnetz laesst express 4 stumm',
  )

  // ── 3. UND DANACH? ─────────────────────────────────────────────────────
  console.log('\nFall 3 — lebt der Dienst danach weiter?')
  const danach = await anfrage('/probe/stop')
  console.log(
    danach.geantwortet ? `  Antwort nach ${danach.ms} ms: ${danach.code}` : `  KEINE Antwort (${danach.grund})`,
  )
  sagen(danach.geantwortet, 'der Dienst antwortet weiter — es haengt hoechstens die EINE Anfrage')
} finally {
  await dienst.beenden()
  rmSync(arbeit, { recursive: true, force: true })
}

console.log(fehler ? `\n${fehler} Abweichung(en).` : '\nKeine Abweichung.')
if (PRUEFEN && fehler) process.exit(1)
