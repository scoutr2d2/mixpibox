#!/usr/bin/env node
/**
 * BEWEGTE BILDER FUER DIE README — was ein Standbild nicht zeigen kann.
 *
 * Betreiber 27.09.2026: „kann man auch gifs erzeugen? gerade beim scrollen
 * wenn alles auf die seite geht oder auch die wellen".
 *
 * ══ WAS ES AUFNIMMT ════════════════════════════════════════════════════════
 *   screenshots/30-blaettern.gif  Platzmachen beim Blaettern: beim Rollen
 *                                 fahren Leiste und Kissen weg, in Ruhe
 *                                 kommen sie zurueck (platzBeimBlaettern)
 *   screenshots/31-wellen.gif     die Buehne ueber den Spieltasten im
 *                                 grossen Spieler, Stellung „Wellen"
 *
 * ══ WIE — DERSELBE WEG WIE schirmbilder-readme.mjs ═════════════════════════
 * Gegen `tools/neu-vorschau.mjs` (die Attrappe, keine Box, erfundene Daten)
 * in Geraetegroesse 800 x 480, ueber den eigenen Browser aus leihgabe.mjs.
 * Gefilmt wird mit `Page.startScreencast`: jedes Bild kommt mit Zeitstempel,
 * `ffmpeg` setzt sie mit ihren ECHTEN Abstaenden zusammen (concat mit
 * `duration`) — ein festes Bildtempo haette Ruckler geglaettet oder
 * gestreckt, und das GIF zeigte eine Bewegung, die es nicht gibt.
 *
 * WARUM NICHT AN DER ECHTEN BOX: Rollen heisst Eingaben schicken, und die
 * Box gehoert einem Kind (siehe tools/box-schirm-foto.py: „ES SENDET NIE
 * EINE EINGABE"). Die Vorschau laeuft dasselbe app.js.
 *
 * DER SCHALTER platzBeimBlaettern steht in der Attrappe auf aus. Er wird
 * mit `PUT /api/darstellung` an DIESER, eigens gestarteten Vorschau gesetzt
 * — an keiner Box, und die Vorschau endet mit dem Werkzeug.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *     node tools/readme-gifs.mjs
 *     node tools/readme-gifs.mjs --bilder /tmp/probe --breite 640
 *     node tools/readme-gifs.mjs --pruefen   # dazu Rollstand, platz-machen
 *                                            # und Lage des Kissens je Schritt
 *
 * Braucht ffmpeg. Ohne Browser oder ffmpeg: „uebersprungen", Rueckgabe 0.
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { eigenerBrowser, freierPort } from './leihgabe.mjs'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  return i < 0 ? v : argv[i + 1]
}
const BILDER = opt('bilder') || join(WURZEL, 'screenshots')
const BREITE = Number(opt('breite', '640'))
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) {
  console.log('  kein ffmpeg — uebersprungen')
  process.exit(0)
}

// ── Die eigene Vorschau ─────────────────────────────────────────────────
const port = await freierPort()
const basis = `http://127.0.0.1:${port}`
const vorschau = spawn(process.execPath, ['tools/neu-vorschau.mjs', '--port', String(port)], {
  cwd: WURZEL,
  stdio: 'ignore',
})
process.on('exit', () => {
  try {
    vorschau.kill()
  } catch {
    /* schon weg */
  }
})
for (const bis = Date.now() + 10000; ; ) {
  try {
    await fetch(`${basis}/api/werke`)
    break
  } catch {
    if (Date.now() > bis) throw new Error('tools/neu-vorschau.mjs kam nicht hoch')
    await warte(150)
  }
}

// ── Das Protokoll ───────────────────────────────────────────────────────
let lfd = 0
const send = (ws, m, p = {}) =>
  new Promise((ok, no) => {
    const i = ++lfd
    ws.send(JSON.stringify({ id: i, method: m, params: p }))
    const h = (r) => {
      const x = JSON.parse(r)
      if (x.id !== i) return
      ws.off('message', h)
      x.error ? no(new Error(x.error.message)) : ok(x.result)
    }
    ws.on('message', h)
  })

// DAS FENSTER IST HOEHER ALS DER SCHIRM, mit Absicht: der Screencast filmt
// die echte Fensterflaeche, nicht die emulierte. Bei 800,480 blieben nach dem
// Fensterrahmen nur ~338 px — das Kissen unten war nie im Bild (gemessen am
// ersten GIF: 640x270 statt 640x384). Die Seite selbst bleibt 800 x 480.
const browser = await eigenerBrowser({ fenster: '800,700' })
if (!browser) {
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}
const ws = new WebSocket(await browser.seite())
await new Promise((r) => ws.on('open', r))

await send(ws, 'Runtime.enable')
await send(ws, 'Page.enable')
await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })
const ev = async (e) =>
  (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.value

/** Filmt, waehrend `tat` laeuft, und schreibt daraus ein GIF. */
async function filmen(name, tat) {
  const ordner = await mkdtemp(join(tmpdir(), 'readme-gif-'))
  const bilder = []
  const h = (roh) => {
    const x = JSON.parse(roh)
    if (x.method !== 'Page.screencastFrame') return
    bilder.push({ zeit: x.params.metadata.timestamp, daten: x.params.data })
    send(ws, 'Page.screencastFrameAck', { sessionId: x.params.sessionId }).catch(() => {})
  }
  ws.on('message', h)
  await send(ws, 'Page.startScreencast', { format: 'png', maxWidth: 800, maxHeight: 1000, everyNthFrame: 1 })
  await tat()
  await send(ws, 'Page.stopScreencast')
  ws.off('message', h)
  if (bilder.length < 2) {
    console.log(`  ${name}: zu wenige Bilder (${bilder.length}) — uebersprungen`)
    return
  }
  // concat mit echten Abstaenden; das letzte Bild steht eine halbe Sekunde.
  const zeilen = []
  for (let i = 0; i < bilder.length; i++) {
    const datei = join(ordner, `b${String(i).padStart(4, '0')}.png`)
    await writeFile(datei, Buffer.from(bilder[i].daten, 'base64'))
    const dauer = i + 1 < bilder.length ? Math.max(0.02, bilder[i + 1].zeit - bilder[i].zeit) : 0.5
    zeilen.push(`file '${datei}'`, `duration ${dauer.toFixed(3)}`)
  }
  zeilen.push(`file '${join(ordner, `b${String(bilder.length - 1).padStart(4, '0')}.png`)}'`)
  await writeFile(join(ordner, 'liste.txt'), `${zeilen.join('\n')}\n`)
  const ziel = join(BILDER, `${name}.gif`)
  const r = spawnSync(
    'ffmpeg',
    [
      '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(ordner, 'liste.txt'),
      '-vf', `crop=min(iw\\,800):min(ih\\,480):0:0,fps=15,scale=${BREITE}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`,
      '-loop', '0', ziel,
    ],
    { stdio: 'inherit' },
  )
  await rm(ordner, { recursive: true, force: true })
  if (r.status === 0) console.log(`  GIF: ${ziel} (${bilder.length} Bilder)`)
}

/**
 * Felder der Darstellung an DIESER Vorschau setzen. Die Attrappe ERSETZT
 * `aktuell` im Ganzen (wie die Oberflaeche es schickt): erst den Stand
 * holen, dann die Felder darin setzen.
 */
async function darstellungSetzen(felder) {
  const stand = await (await fetch(`${basis}/api/darstellung`)).json()
  await fetch(`${basis}/api/darstellung`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ aktuell: { ...(stand.aktuell ?? {}), ...felder } }),
  })
}

/**
 * Rollen im Kachelraster, weich wie ein Finger. NICHT ueber
 * `Input.dispatchMouseEvent` (mouseWheel): im kopflosen Browser kam davon
 * nichts im Raster an — das erste GIF zeigte 110 gleiche Bilder. `scrollBy`
 * mit `smooth` loest dieselben Rollereignisse aus, auf die
 * `platzBeimBlaettern.geruehrt()` hoert.
 */
async function rollen(dy) {
  await ev(`document.getElementById('buehne').scrollBy({ top: ${dy}, behavior: 'smooth' })`)
  await warte(900)
  if (argv.includes('--pruefen'))
    console.log(
      await ev(
        `JSON.stringify({ oben: document.getElementById('buehne').scrollTop, platz: document.body.classList.contains('platz-machen'), kissen: (() => { const r = document.getElementById('mp')?.getBoundingClientRect(); return r && [r.x|0, r.y|0, r.width|0, r.height|0] })(), fenster: [innerWidth, innerHeight] })`,
      ),
    )
}

try {
  await mkdir(BILDER, { recursive: true })

  // 1. PLATZMACHEN BEIM BLAETTERN
  await darstellungSetzen({ platzBeimBlaettern: true })
  await send(ws, 'Page.navigate', { url: `${basis}/neu/` })
  await warte(3000)
  if (argv.includes('--pruefen'))
    console.log(await ev(`JSON.stringify({ sicht: document.visibilityState, fokus: document.hasFocus(), klassen: document.body.className })`))
  await filmen('30-blaettern', async () => {
    await warte(700)
    await rollen(330)
    await rollen(330)
    await warte(500)
    await rollen(-660)
    await warte(4500) // Ruhezeit: Leiste und Kissen kommen zurueck
  })

  // 2. DIE WELLEN IM GROSSEN SPIELER
  //
  // DIE ATTRAPPE LIEFERT KEINEN PEGEL. Die Wellen lesen `pegel` (vier Baender
  // 0..1) aus der Antwort von /player/local; ohne das Feld bleibt die
  // Leinwand flach (app.js, wellenAusZustandFuettern). Fuer die Aufnahme
  // wird die Antwort IM BROWSER abgefangen und um einen erfundenen, weich
  // schwankenden Pegel ergaenzt — die Vorschau selbst bleibt unberuehrt.
  // Und die Wellen fuettert app.js nur mit `statusWellen` (body.status-wellen).
  await darstellungSetzen({ statusWellen: true })
  await send(ws, 'Fetch.enable', { patterns: [{ urlPattern: '*/player/local*', requestStage: 'Response' }] })
  const t0 = Date.now()
  const pegelHoerer = async (roh) => {
    const x = JSON.parse(roh)
    if (x.method !== 'Fetch.requestPaused') return
    const { requestId } = x.params
    try {
      const k = await send(ws, 'Fetch.getResponseBody', { requestId })
      const j = JSON.parse(k.base64Encoded ? Buffer.from(k.body, 'base64').toString() : k.body)
      const t = (Date.now() - t0) / 1000
      j.pegel = [0.9, 1.7, 2.9, 4.3].map((f, i) => +(0.35 + 0.3 * Math.sin(t * f + i) * Math.sin(t * 0.7 + i * 2)).toFixed(3))
      await send(ws, 'Fetch.fulfillRequest', {
        requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify(j)).toString('base64'),
      })
    } catch {
      await send(ws, 'Fetch.continueRequest', { requestId }).catch(() => {})
    }
  }
  ws.on('message', pegelHoerer)
  await send(ws, 'Page.navigate', { url: `${basis}/neu/` })
  await warte(3000)
  const auf = await ev(`(() => { const k = document.querySelector('#mp [data-auf]'); if (!k) return false; k.click(); return true })()`)
  if (!auf) {
    console.log('  31-wellen: kein Mini-Player zum Aufziehen — uebersprungen')
  } else {
    // VORLAUF: die Wellen laufen als Foerderband von rechts nach links ein.
    // Nach 9 s war erst ein Drittel gefuellt (gemessen am GIF) — der Puffer
    // fasst 60 Werte, und die Attrappe wird etwa viermal je Sekunde gefragt.
    await warte(18000)
    await filmen('31-wellen', () => warte(5000))
  }
  ws.off('message', pegelHoerer)
  await send(ws, 'Fetch.disable')
} finally {
  ws.close()
  await browser.schliessen()
  vorschau.kill()
}
