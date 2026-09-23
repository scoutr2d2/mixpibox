#!/usr/bin/env node
/**
 * DIE BILDER DER VERWALTUNG FUER DIE README — ohne Box, ohne ng serve.
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 * Das Gegenstueck zu tools/schirmbilder-readme.mjs: jenes bildet den
 * Kinderschirm ab, dieses die Verwaltung unter /admin. Gefahren wird gegen
 * `tools/admin-vorschau.mjs` — den Stub, der das Backend SPIELT (er umgeht
 * keine Anmeldung, es gibt dort keine) und die GEBAUTE Verwaltung ausliefert.
 *
 * VORHER BAUEN: `npm run build:frontend-admin`. Fehlt der Bau, sagt es das und
 * hoert auf, statt Bilder einer leeren Seite zu machen.
 *
 * ══ WAS ES NICHT TUT ═══════════════════════════════════════════════════════
 *   * Es raeumt nicht auf: es nimmt IMMER die ganze Reihe auf. Welche Bilder
 *     die README zeigt, entscheidet die README — die uebrigen loescht man.
 *   * Es misst nichts und aendert nichts — es zeigt. Die messenden Werkzeuge
 *     der Verwaltung heissen admin-schirmfolge.mjs und verwaltung-*.mjs.
 *   * Es faellt nicht um: eine Seite, die es nicht gibt, wird ausgelassen und
 *     genannt.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *     node tools/schirmbilder-verwaltung.mjs
 *     node tools/schirmbilder-verwaltung.mjs --bilder /tmp/probe --breite 1280
 */
import { spawn } from 'node:child_process'
import { access, mkdir, writeFile } from 'node:fs/promises'
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
const BREITE = Number(opt('breite', '1100'))
const HOEHE = Number(opt('hoehe', '760'))
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

// DER BAU MUSS DA SEIN. Ohne ihn liefert die Vorschau eine leere Seite aus,
// und vier Bilder von nichts sehen aus wie vier Bilder.
try {
  await access(join(WURZEL, 'src', 'deploy', 'www-admin', 'index.html'))
} catch {
  console.log('  src/deploy/www-admin fehlt — erst `npm run build:frontend-admin`.')
  process.exit(1)
}

let vorschau = null
process.on('exit', () => {
  try {
    vorschau?.kill()
  } catch {
    /* schon weg */
  }
})
const port = await freierPort()
const ZIEL = `http://127.0.0.1:${port}/admin/`
vorschau = spawn(process.execPath, ['tools/admin-vorschau.mjs', '--port', String(port)], {
  cwd: WURZEL,
  stdio: 'ignore',
})
vorschau.unref()
{
  const bis = Date.now() + 15000
  for (;;) {
    try {
      const r = await fetch(ZIEL)
      if (r.ok) break
    } catch {
      /* noch nicht da */
    }
    if (Date.now() > bis) throw new Error('tools/admin-vorschau.mjs kam nicht hoch')
    await warte(200)
  }
}
console.log(`ZIEL: ${ZIEL}`)

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

// WELCHE SEITEN. Sechs, die zusammen zeigen, was die Verwaltung ist: der
// Einstieg, die Medien (der Alltag), die Profile, die Spiele, der Ton und die
// Kinderzeit. Mehr waere eine Bildergalerie, weniger verschwiege die Breite.
const SEITEN = [
  ['10-verwaltung', ''],
  ['11-verwaltung-medien', 'medien'],
  ['12-verwaltung-profile', 'kinderzeit'],
  ['13-verwaltung-spiele', 'spiele'],
  ['14-verwaltung-ton', 'ton'],
  ['15-verwaltung-aufzeichnen', 'aufzeichnen'],
]

const browser = await eigenerBrowser({ fenster: `${BREITE},${HOEHE}` })
if (!browser) {
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}
let ws = null
let gemacht = 0
try {
  await mkdir(BILDER, { recursive: true })
  ws = new WebSocket(await browser.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', {
    width: BREITE,
    height: HOEHE,
    deviceScaleFactor: 1,
    mobile: false,
  })
  const ev = async (e) =>
    (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.value

  for (const [name, weg] of SEITEN) {
    await send(ws, 'Page.navigate', { url: ZIEL + weg })
    await warte(2200)
    const leer = await ev(`(document.body.innerText || '').trim().length < 20`)
    if (leer) {
      console.log(`  ausgelassen: ${weg || '(Einstieg)'} — Seite blieb leer`)
      continue
    }
    const s = await send(ws, 'Page.captureScreenshot', { format: 'png' })
    await writeFile(join(BILDER, `${name}.png`), Buffer.from(s.data, 'base64'))
    gemacht += 1
    console.log(`  Bild: screenshots/${name}.png`)
  }
  console.log(`\n${gemacht} Bild(er) in ${BILDER}.`)
} finally {
  try {
    ws?.close()
  } catch {
    /* egal */
  }
  try {
    await browser.zu()
  } catch {
    /* egal */
  }
}
