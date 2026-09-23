#!/usr/bin/env node
/**
 * ANTWORTET `stop` WIRKLICH ERST, WENN DIE PAUSE DURCH IST? — am ECHTEN Dienst.
 *
 * WOZU: BACKLOG E24/O2. `stop()` in spotify-control.ts wartet seit dem
 * 04.08.2026 auf `spotifyApi.pause()`, bevor der Dienst 200 antwortet, und legt
 * das Ergebnis ins Feld `angehalten`. Bis hierher ist das GELESEN, nicht
 * GEMESSEN — und der Unterschied ist genau der, den dieses Projekt schon
 * mehrfach bezahlt hat.
 *
 * WAS DIESES WERKZEUG ANDERS MACHT ALS EIN TEST: Es startet den WIRKLICHEN
 * Dienst (src/backend-player/src/spotify-control.ts, mit tsx) und spricht ihn
 * ueber HTTP an. Damit ist nicht nur `stop()` geprueft, sondern die ganze
 * Kette, an der die Reparatur haengt: der Verteiler ist `async`, sein einziges
 * `await` steht im richtigen Zweig, `res.send` kommt DANACH, und das Feld
 * ueberlebt den Weg durch express.
 *
 * WAS ERSETZT WIRD, UND WARUM DAS EHRLICH BLEIBT — drei Module, keines davon
 * das gepruefte:
 *   spotify-web-api-node   eine Attrappe, deren `pause()` nach einer
 *                          EINSTELLBAREN Zeit fertig wird (oder nie, oder mit
 *                          Fehler). Genau darum geht es; die echte Bibliothek
 *                          wuerde ein Spotify-Konto brauchen.
 *   mplayer/mpv-wrapper    eine Attrappe, die nichts spawnt. Sonst startete
 *                          hier ein echter mplayer und machte Krach.
 *   config/*.json          aus config/templates/ gefuellt. Die echten Dateien
 *                          im Baum sind leer und gehoeren root.
 * Der Verteiler, `stop()`, die Zeitschranke und express sind ECHT.
 *
 * AUFRUF
 *   node tools/anhalten-am-dienst.mjs
 *   node tools/anhalten-am-dienst.mjs --pruefen   # Rueckgabewert 1 bei Abweichung
 *   node tools/anhalten-am-dienst.mjs --port 5099
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const WURZEL = path.join(HIER, '..')
const PRUEFEN = process.argv.includes('--pruefen')
const PORT = Number(process.argv[process.argv.indexOf('--port') + 1]) || 5099

/** Die Frist im Dienst — GELESEN, nicht abgeschrieben. Stuende die Zahl hier
 *  noch einmal, bliebe diese Pruefung gruen, wenn jemand sie dort aendert. */
const QUELLE = await import('node:fs').then((fs) =>
  fs.readFileSync(path.join(WURZEL, 'src/backend-player/src/spotify-control.ts'), 'utf8'),
)
const FRIST_MS = Number((QUELLE.match(/const ANHALTE_FRIST_MS = (\d+)/) || [])[1])
if (!Number.isFinite(FRIST_MS)) {
  console.error('ANHALTE_FRIST_MS steht nicht in spotify-control.ts — wurde die Reparatur entfernt?')
  process.exit(1)
}

const arbeit = mkdtempSync(path.join(tmpdir(), 'mupi-anhalten-'))

/**
 * DIE VORSCHALTUNG: drei Module umbiegen, bevor der Dienst geladen wird.
 *
 * `Module._load` ist die Stelle, durch die JEDER `require` geht — auch die,
 * die tsx aus einer .ts-Datei erzeugt. Ein Loader-Hook waere feiner, aber der
 * Dienst ist ein SKRIPT (kein Modul), und `Module._load` erwischt ihn ohne
 * Umbau am Quelltext. Am geprueften Code wird nichts geaendert.
 */
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

/** Wie lange die Attrappe fuer eine Pause braucht — in Millisekunden.
 *  -1 heisst: sie wird NIE fertig. -2 heisst: sie scheitert. */
let pauseMs = Number(process.env.PROBE_PAUSE_MS || 0)

/** Eine Attrappe der Spotify-Bibliothek. Sie kann genau so viel, wie der
 *  Dienst von ihr verlangt — jede Methode ist ein Versprechen. */
function FakeSpotify() {}
const sofort = () => Promise.resolve({ body: {} })
FakeSpotify.prototype.setAccessToken = function () {}
FakeSpotify.prototype.refreshAccessToken = function () {
  // ABGELEHNT, wie ohne Zugangsdaten in Wirklichkeit auch. Der Dienst faengt
  // das ausdruecklich ab ("A failing Spotify auth must not crash the player").
  return Promise.reject(new Error('Probe: keine Zugangsdaten'))
}
FakeSpotify.prototype.getMyDevices = function () {
  return Promise.resolve({ body: { devices: [{ id: 'probe-1', name: 'ProbeBox', is_active: true }] } })
}
FakeSpotify.prototype.transferMyPlayback = sofort
FakeSpotify.prototype.play = sofort
FakeSpotify.prototype.seek = sofort
FakeSpotify.prototype.setShuffle = sofort
FakeSpotify.prototype.setVolume = sofort
FakeSpotify.prototype.skipToNext = sofort
FakeSpotify.prototype.skipToPrevious = sofort
FakeSpotify.prototype.pause = function () {
  const ms = Number(process.env.PROBE_PAUSE_MS || 0)
  if (ms === -1) return new Promise(() => {})            // kommt nie zurueck
  if (ms === -2) return Promise.reject(new Error('Probe: Pause gescheitert'))
  return new Promise((f) => setTimeout(() => f({ body: {} }), ms))
}

/** Eine Wiedergabe-Maschine, die nichts spawnt. */
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

const warte = (ms) => new Promise((f) => setTimeout(f, ms))

/** Was der Dienst ueber sich selbst sagt. `/local` ist ein EIGENER Zuhoerer
 *  ohne Raum davor — `/probe/local` liefe in den Befehlsverteiler und meldete
 *  nichts. */
const lage = () => fetch(`http://127.0.0.1:${PORT}/local`).then((r) => r.json())

let fehler = 0
const sagen = (gut, text) => {
  console.log(`  ${gut ? 'OK  ' : 'FEHL'}  ${text}`)
  if (!gut) fehler++
}

/** Der Weg zu tsx im Hauptverzeichnis — NICHT ueber `npx`, siehe unten. */
const TSX = path.join(WURZEL, 'node_modules/.bin/tsx')

/**
 * DEN DIENST STARTEN UND IHN AUCH WIRKLICH WIEDER LOSWERDEN.
 *
 * DAS WAR DER ERSTE FEHLGRIFF DIESES WERKZEUGS, und er ist die Sorte, die eine
 * Messung LEISE verdirbt: gestartet wurde ueber `npx`, beendet wurde `npx`.
 * Der Enkel (node) lebte weiter und hielt den Port. Die drei folgenden
 * Durchgaenge starteten zwar neue Dienste, die scheiterten still an
 * EADDRINUSE — geantwortet hat weiter der ERSTE, mit dessen alter
 * Pausendauer. Auf dem Bildschirm sah das aus wie „die Frist bindet nicht",
 * also wie ein Fehler in der Reparatur.
 *
 * Zwei Lehren, beide hier eingebaut:
 *   * tsx DIREKT starten, nicht durch npx — ein Prozess weniger dazwischen.
 *   * `detached` und die ganze PROZESSGRUPPE abwuergen (`kill(-pid)`).
 *   * UND ABWARTEN, bis der Port wirklich frei ist. Ein `kill` ist eine Bitte,
 *     kein Vollzug.
 */
async function dienstStarten(pauseMs) {
  // Ist der Port belegt, wird NICHT gemessen. Lieber laut abbrechen als gegen
  // einen fremden Dienst messen.
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

  // Warten, bis der Dienst antwortet. Nicht blind schlafen: tsx braucht beim
  // ersten Lauf mehrere Sekunden, danach fast keine.
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
    async beenden() {
      try {
        process.kill(-kind.pid, 'SIGKILL')
      } catch {
        /* schon tot */
      }
      // Bis der Port wieder frei ist — hoechstens fuenf Sekunden.
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
 * Einen Befehl schicken und die DAUER bis zur Antwort messen.
 *
 * DER RAUM HEISST `probe` UND DIE DOPPELPUNKTE BLEIBEN ROH. Beides ist beim
 * ersten Anlauf schiefgegangen und beides ist lehrreich: Der Verteiler prueft
 * `command.name.includes('spotify:')` auf dem UNDEKODIERTEN `req.url` — ein
 * kodiertes `%3A` trifft ihn NICHT, und der Dienst blieb auf `currentPlayer:
 * ''` stehen. Die Oberflaechen schicken die Doppelpunkte ebenfalls roh
 * (`${SPIELER}/${RAUM}/${befehl}` in NewDesign/app.js).
 */
async function befehl(pfad) {
  const start = Date.now()
  const r = await fetch(`http://127.0.0.1:${PORT}/probe/${pfad}`, { headers: { accept: 'application/json' } })
  let koerper = null
  try {
    koerper = await r.json()
  } catch {
    /* nicht jede Antwort ist JSON */
  }
  return { ms: Date.now() - start, code: r.status, koerper }
}

/**
 * Einen Fall messen: Dienst mit einer bestimmten Pausendauer starten, Spotify
 * „laufen lassen", `stop` schicken.
 *
 * NEU GESTARTET WIRD JEDES MAL, weil `PROBE_PAUSE_MS` beim Start feststeht und
 * `currentPlayer` sonst vom vorigen Fall stehenbliebe.
 */
async function fall(name, pauseMs, erwartung) {
  const dienst = await dienstStarten(pauseMs)

  try {
    // SPOTIFY „LAUFEN LASSEN": `useSpotify` setzt `currentPlayer` auf 'spotify',
    // sobald ein Befehl `spotify:` im Namen traegt. Ohne diesen Schritt ginge
    // `stop()` in den Zweig „nichts zu tun" — und die Messung waere wertlos.
    await befehl('now/spotify:album:probe123:0:0')
    await warte(300)
    const spielt = String((await lage()).currentPlayer || '')

    console.log(`\n${name}`)
    sagen(spielt === 'spotify', `der Dienst fuehrt vor dem Halt 'spotify' (gemeldet: '${spielt}')`)

    const a = await befehl('stop')
    console.log(`  Antwort nach ${a.ms} ms: ${JSON.stringify(a.koerper)}`)
    await erwartung(a)
    return a
  } finally {
    await dienst.beenden()
  }
}

console.log(`ANHALTE_FRIST_MS aus spotify-control.ts: ${FRIST_MS} ms`)

try {
  // ── DER ALLTAG: Spotify antwortet flott. ──────────────────────────────
  // 250 ms sind reichlich mehr als die an der Box gemessenen 76 bis 93 ms und
  // trotzdem klar von 0 zu unterscheiden.
  await fall('Fall 1 — Spotify bestaetigt nach 250 ms:', 250, (a) => {
    sagen(a.koerper?.angehalten === 'bestaetigt', "das Feld `angehalten` meldet 'bestaetigt'")
    sagen(a.ms >= 200, `die Antwort kam NICHT vor der Pause (${a.ms} ms >= 200 ms) — das ist die ganze Reparatur`)
    sagen(a.ms < FRIST_MS, `und sie sass die Frist nicht ab (${a.ms} ms < ${FRIST_MS} ms)`)
  })

  // ── DER AUSFALL: die Pause kommt NIE zurueck. ─────────────────────────
  // Ohne Zeitschranke haenge hier jeder Kacheltipp — an der Box gemessen
  // 134,8 s (tools/pause-zeitschranke-messen.mjs, 04.08.2026).
  await fall('Fall 2 — die Pause kommt NIE zurueck (totes Netz):', -1, (a) => {
    sagen(a.koerper?.angehalten === 'frist-abgelaufen', "das Feld `angehalten` meldet 'frist-abgelaufen'")
    sagen(
      a.ms >= FRIST_MS - 200 && a.ms < FRIST_MS + 1500,
      `die Antwort kam nach rund ${FRIST_MS} ms (gemessen ${a.ms} ms) — die Frist bindet`,
    )
  })

  // ── DER FEHLER: die Pause scheitert. ──────────────────────────────────
  await fall('Fall 3 — die Pause scheitert:', -2, async (a) => {
    sagen(a.koerper?.angehalten === 'fehlgeschlagen', "das Feld `angehalten` meldet 'fehlgeschlagen'")
    sagen(a.ms < 800, `und zwar SOFORT (${a.ms} ms) — ein Fehler ist ein Ende, kein Warten`)
    // UND DER DIENST LEBT NOCH. Das ist keine Selbstverstaendlichkeit: die
    // Attrappe lehnt hier mit einem NACKTEN Error ab, ohne `.body` — und
    // `handleSpotifyError` greift als Erstes auf `err.body.error` zu. Was
    // dabei geworfen wird, landet in der Ablehnung, die `mitZeitschranke`
    // auffaengt. Faenge sie niemand, waere es eine `unhandledRejection`.
    // Genau diese Sorte Ablehnung kommt bei totem Netz aus superagent.
    await warte(300)
    let lebt = false
    try {
      await lage()
      lebt = true
    } catch {
      /* tot */
    }
    sagen(lebt, 'der Dienst antwortet danach weiter — ein Netzfehler bringt ihn nicht um')
  })

  // ── DIE GEGENPROBE: es lief gar nichts. ───────────────────────────────
  // Hier wird `useSpotify` NICHT geschickt; `stop` darf dann nicht warten.
  {
    const dienst = await dienstStarten(-1)
    try {
      console.log('\nFall 4 — es lief nichts (Gegenprobe):')
      const a = await befehl('stop')
      console.log(`  Antwort nach ${a.ms} ms: ${JSON.stringify(a.koerper)}`)
      sagen(a.koerper?.angehalten === 'nichts-zu-tun', "das Feld `angehalten` meldet 'nichts-zu-tun'")
      sagen(a.ms < 800, `und zwar sofort (${a.ms} ms), obwohl die Attrappe NIE antworten wuerde`)
    } finally {
      await dienst.beenden()
    }
  }

  // ── DIE LUECKE: ZWEIMAL TIPPEN, WAEHREND DIE ERSTE PAUSE NOCH LAEUFT. ──
  //
  // WARUM DAS HIERHER GEHOERT (05.08.2026, beim Gegenlesen von E24/O2): Der
  // Quelltext von `stop()` begruendet ausdruecklich, warum `currentPlayer`
  // SOFORT geleert wird — „kaeme waehrend des Wartens ein ZWEITES `stop`
  // herein (ein Kind tippt nach), fuende es `currentPlayer` noch auf 'spotify'
  // und schickte eine zweite Pause". Das stimmt, hat aber eine Kehrseite, die
  // nirgends steht: das zweite `stop` meldet dann 'nichts-zu-tun' und ist
  // SOFORT zurueck. Die Oberflaeche liest das als „nichts mehr unterwegs",
  // haelt keinen Abstand — und die ERSTE Pause ist sehr wohl noch unterwegs.
  //
  // Das ist genau der Wettlauf aus E24, nur eine Ebene hoeher. KEIN Rueckschritt
  // (vor der Reparatur raste jeder einzelne Tipp), aber der Rest, der bleibt.
  // Gemessen wird er, damit er nicht als „erledigt" gilt.
  {
    const dienst = await dienstStarten(900)
    try {
      console.log('\nFall 5 — nachgetippt, waehrend die erste Pause noch laeuft:')
      await befehl('now/spotify:album:probe123:0:0')
      await warte(300)

      const erstes = befehl('stop')
      await warte(200) // das Kind tippt nach, die erste Pause laeuft noch
      const zweites = await befehl('stop')
      console.log(`  zweites stop: Antwort nach ${zweites.ms} ms: ${JSON.stringify(zweites.koerper)}`)
      const a = await erstes
      console.log(`  erstes  stop: Antwort nach ${a.ms} ms: ${JSON.stringify(a.koerper)}`)

      sagen(a.koerper?.angehalten === 'bestaetigt', "das ERSTE stop wartet die Pause ab ('bestaetigt')")
      sagen(
        zweites.koerper?.angehalten === 'nichts-zu-tun' && zweites.ms < 300,
        `das ZWEITE meldet '${zweites.koerper?.angehalten}' nach ${zweites.ms} ms — DIE LUECKE: die erste Pause ist ` +
          'da noch unterwegs, und die Oberflaeche haelt auf dieses Wort hin KEINEN Abstand',
      )
    } finally {
      await dienst.beenden()
    }
  }

  console.log(`\n${fehler ? `${fehler} Abweichung(en)` : 'keine Abweichung'}`)
} catch (e) {
  console.error('FEHLER:', e.message)
  fehler++
} finally {
  rmSync(arbeit, { recursive: true, force: true })
}

process.exit(PRUEFEN && fehler ? 1 : 0)
