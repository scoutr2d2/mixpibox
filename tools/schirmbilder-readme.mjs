#!/usr/bin/env node
/**
 * DIE BILDER FUER DIE README AUFNEHMEN — von der laufenden Oberflaeche, ohne Box.
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 * Die README auf GitHub soll zeigen, WIE die Box aussieht. Im Baum lagen dafuer
 * bis zum 23.09.2026 nur die Schirmbilder des URSPRUNGS (`screenshots/`,
 * Angular-Oberflaeche, Themes, Spotify-Suche) — sie zeigen eine Oberflaeche,
 * die es hier seit E118/1e nicht mehr gibt. Ein Bild, das etwas anderes zeigt
 * als das, was man bekommt, ist schlimmer als kein Bild.
 *
 * ES MISST NICHTS, ES ZEIGT. Aufgenommen wird gegen `tools/neu-vorschau.mjs`
 * (die Attrappe, die keine Box braucht) in genau der Groesse des Geraets:
 * 800 x 480. Wer die Oberflaeche aendert, ruft es neu und die README stimmt
 * wieder.
 *
 * ══ WAS ES NICHT TUT ═══════════════════════════════════════════════════════
 *   * Es faellt nicht um. Was es nicht findet, laesst es aus und sagt es —
 *     eine halbe Bilderreihe ist besser als ein Abbruch ohne Bilder.
 *   * Es fasst eine SCHON LAUFENDE Vorschau nicht an (`--ziel` uebergeben),
 *     und die eigene raeumt es hinter sich weg (siehe tools/leihgabe.mjs).
 *   * Es raeumt nicht auf: es nimmt IMMER die ganze Reihe auf. Welche Bilder
 *     die README zeigt, entscheidet die README — die uebrigen loescht man.
 *   * Es beschreibt die Bilder nicht. Wer sie in die README haengt, schreibt
 *     die Bildunterschrift selbst.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *     node tools/schirmbilder-readme.mjs
 *     node tools/schirmbilder-readme.mjs --bilder /tmp/probe
 *     node tools/schirmbilder-readme.mjs --ziel http://127.0.0.1:8299/neu/
 */
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { adminAuf } from './admin-weg.mjs'
import { eigenerBrowser, freierPort } from './leihgabe.mjs'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  return i < 0 ? v : argv[i + 1]
}
const BILDER = opt('bilder') || join(WURZEL, 'screenshots')
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

let vorschau = null
let ZIEL = opt('ziel')
process.on('exit', () => {
  try {
    vorschau?.kill()
  } catch {
    /* schon weg */
  }
})
if (!ZIEL) {
  const p = await freierPort()
  ZIEL = `http://127.0.0.1:${p}/neu/`
  vorschau = spawn(process.execPath, ['tools/neu-vorschau.mjs', '--port', String(p)], {
    cwd: WURZEL,
    stdio: 'ignore',
  })
  vorschau.unref()
  const bis = Date.now() + 10000
  for (;;) {
    try {
      await fetch(`http://127.0.0.1:${p}/api/werke`)
      break
    } catch {
      if (Date.now() > bis) throw new Error('tools/neu-vorschau.mjs kam nicht hoch')
      await warte(150)
    }
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

const browser = await eigenerBrowser({ fenster: '800,480' })
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
    width: 800,
    height: 480,
    deviceScaleFactor: 1,
    mobile: false,
  })
  const ev = async (e) =>
    (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.value
  const bild = async (name) => {
    const s = await send(ws, 'Page.captureScreenshot', { format: 'png' })
    await writeFile(join(BILDER, `${name}.png`), Buffer.from(s.data, 'base64'))
    gemacht += 1
    console.log(`  Bild: screenshots/${name}.png`)
  }

  await send(ws, 'Page.navigate', { url: ZIEL })
  await warte(2600)

  // 1. DER KINDERSCHIRM, wie ihn ein Kind sieht.
  await bild('01-kinderschirm')

  // 2. DER GROSSE SPIELER. Der Knopf am Mini-Player oeffnet ihn; er ist die
  //    Ansicht, in der ein Kind Titel, Fortschritt und Lautstaerke sieht.
  const spieler = await ev(`(() => { const k = document.querySelector('#mp [data-auf]'); if (!k) return false; k.click(); return true })()`)
  await warte(1400)
  if (spieler) await bild('02-spieler')
  else console.log('  ausgelassen: grosser Spieler (kein #mp [data-auf])')

  // 3. DIE SCHUBLADE mit den Apps (Spiele). Sie zieht sich sonst mit einer
  //    Wischgeste auf; fuer ein Bild genuegt die Klasse, die genau das tut.
  await ev(`(() => { const g = document.getElementById('gross'); if (g) g.hidden = true })()`)
  await warte(400)
  const schub = await ev(`(() => { document.body.classList.add('sch-offen'); return document.body.classList.contains('sch-offen') })()`)
  await warte(900)
  if (schub) await bild('03-schublade')
  else console.log('  ausgelassen: Schublade')
  await ev(`document.body.classList.remove('sch-offen')`)
  await warte(500)

  // 4. DER ELTERN-BEREICH — derselbe Weg wie im echten Betrieb (langes Halten
  //    und Tor), hier ueber den gemeinsamen Helfer aus admin-weg.mjs.
  try {
    await adminAuf(ev, { warteMs: 1100 })
    await bild('04-eltern')
  } catch (e) {
    console.log(`  ausgelassen: Eltern-Bereich (${e.message})`)
  }

  console.log(`\n${gemacht} Bild(er) in ${BILDER}. Sie gehoeren ANGESEHEN, bevor sie in die README wandern.`)
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
