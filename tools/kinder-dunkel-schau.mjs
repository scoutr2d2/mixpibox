#!/usr/bin/env node
/**
 * DIE NEUEN SCHIRME IM DUNKELN ANSEHEN — Kinder-Seite und Profilfenster.
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 * Am 07.08.2026 sind zwei Lagen dazugekommen (Admin · System · Benutzer und die
 * erste Zeile des Profilfensters). Beide sind HELL gemessen worden. Hell und
 * dunkel sind in dieser Oberflaeche aber nicht dieselbe Datei mit anderen
 * Zahlen — `mupibox_neu_licht_v1` schaltet ganze Farbsaetze um, und ein
 * Gefahrknopf, der hell rot und dunkel braun ist, faellt in keiner Messung
 * auf, die nur eine der beiden Seiten kennt.
 *
 * ES MISST NICHTS, ES ZEIGT. Vier Bilder, damit ein Mensch sie ansieht — das
 * hat an diesem Bereich schon vier Fehler gefunden, die kein Zahlenwerk sah.
 * Die Aussagen ueber Groessen und Riegel stehen in kinder-seite-schau.mjs und
 * ich-bearbeiten-schau.mjs und werden hier nicht wiederholt.
 *
 *   node tools/kinder-dunkel-schau.mjs --bilder /tmp/dunkel
 *   node tools/kinder-dunkel-schau.mjs --ziel http://127.0.0.1:9611/neu/ --bilder /tmp/dunkel
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
const BILDER = opt('bilder') || join(WURZEL, 'tools', 'bilder-dunkel')
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
try {
  await mkdir(BILDER, { recursive: true })
  ws = new WebSocket(await browser.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })
  const ev = async (e) =>
    (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.value
  const bild = async (name) => {
    const s = await send(ws, 'Page.captureScreenshot', { format: 'png' })
    await writeFile(join(BILDER, `${name}.png`), Buffer.from(s.data, 'base64'))
    console.log(`  Bild: ${join(BILDER, `${name}.png`)}`)
  }
  const stand = async (w) => {
    await fetch(new URL(`/vorschau/${w}`, ZIEL)).catch(() => null)
    await warte(120)
  }
  const tippen = async (name) => {
    await ev(`(() => {
      for (const z of document.querySelectorAll('#fach-zeilen .fach-zeile')) {
        const n = z.querySelector('.zeile-name')
        if (!n || !n.textContent.trim().startsWith(${JSON.stringify(name)})) continue
        const k = z.querySelector('.zeile-tat')
        if (k && !k.disabled) { k.click(); return true }
        if (z.tagName === 'BUTTON') { z.click(); return true }
      }
      return false })()`)
    await warte(700)
  }
  const tippenWort = async (wort) => {
    await ev(`(() => {
      for (const k of document.querySelectorAll('#fach-zeilen .zeile-tat')) {
        if (!k.textContent.trim().startsWith(${JSON.stringify(wort)}) || k.disabled) continue
        k.click(); return true
      }
      return false })()`)
    await warte(700)
  }

  // DAS DUNKEL WIRD VOR DEM LADEN GESETZT: index.html liest den Schluessel in
  // einem Einzeiler VOR app.js, damit nichts aufblitzt.
  await stand('sperre-aus')
  await stand('profil-liam')
  await send(ws, 'Page.navigate', { url: ZIEL })
  await warte(1500)
  await ev(`localStorage.setItem('mupibox_neu_licht_v1','dunkel')`)
  await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
  await warte(2400)

  console.log('\n── Das Profilfenster im Dunkeln ──')
  await ev(`document.getElementById('ich').click()`)
  await warte(900)
  await bild('d1-ich-fenster')

  console.log('\n── Die Seite „Kinder" im Dunkeln ──')
  await ev(`document.getElementById('ich-fenster').hidden = true`)
  await adminAuf(ev, { warteMs: 1100 })
  await ev(`document.querySelector('#eltern-faecher [data-fach="system"]').click()`)
  await warte(700)
  await tippen('Benutzer')
  await bild('d2-kinder-liste')
  await tippen('Kalea')
  await bild('d3-kalea-blatt')
  await tippenWort('Löschen')
  await bild('d4-loeschfrage')
  console.log('\nfertig — die vier Bilder gehoeren ANGESEHEN, nicht gezaehlt.')
} finally {
  try {
    ws?.close()
  } catch {
    /* egal */
  }
  await browser.schliessen?.()
}
process.exit(0)
