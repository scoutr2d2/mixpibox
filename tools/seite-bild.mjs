#!/usr/bin/env node
/**
 * EINE SEITE ABFOTOGRAFIEREN — in fester Groesse, nur lesend.
 *
 * Betreiber 27.09.2026: Bilder fuer die README „von der echten box" — dort
 * vor allem der Theme-Gestalter (/neu/gestalter/), der eine Arbeitsflaeche
 * fuer den Rechner ist und im schmalen Browserfenster nur halb zu sehen war.
 *
 * ES KLICKT NICHTS — ausser, `--klick SELEKTOR` verlangt es ausdruecklich
 * (Text-Filter: `--klick '.chip.fest' --text Kopfleiste` klickt das erste
 * passende Element, dessen Text das Wort enthaelt). Gedacht fuer die eigene
 * Vorschau, um ein Blatt aufzuklappen; an einer Box nie auf einen Knopf, der
 * schreibt („Auf der Box anwenden").
 *
 * AUFRUF
 *     node tools/seite-bild.mjs http://192.168.178.62:8200/neu/gestalter/ --ziel bild.png
 *     node tools/seite-bild.mjs URL --ziel bild.png --groesse 1440x900 --warten 4000
 *     node tools/seite-bild.mjs URL --ziel bild.png --klick '.chip.fest' --text Kopfleiste
 */
import { writeFile } from 'node:fs/promises'
import WebSocket from 'ws'
import { eigenerBrowser } from './leihgabe.mjs'

const argv = process.argv.slice(2)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  return i < 0 ? v : argv[i + 1]
}
const url = argv.find((a) => /^https?:\/\//.test(a))
const ziel = opt('ziel')
if (!url || !ziel) {
  console.error('Aufruf: node tools/seite-bild.mjs URL --ziel bild.png [--groesse 1440x900] [--warten 4000]')
  process.exit(2)
}
const [breite, hoehe] = opt('groesse', '1440x900').split('x').map(Number)
const warten = Number(opt('warten', '4000'))
const klick = opt('klick')
const klickText = opt('text', '')

const browser = await eigenerBrowser({ fenster: `${breite},${hoehe + 200}` })
if (!browser) {
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}
let lfd = 0
const ws = new WebSocket(await browser.seite())
await new Promise((r) => ws.on('open', r))
const send = (m, p = {}) =>
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
try {
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: breite, height: hoehe, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url })
  await new Promise((r) => setTimeout(r, warten))
  if (klick) {
    const r = await send('Runtime.evaluate', {
      expression: `(() => { const e = [...document.querySelectorAll(${JSON.stringify(klick)})].find((x) => x.textContent.includes(${JSON.stringify(klickText)})); if (!e) return false; e.click(); return true })()`,
      returnByValue: true,
    })
    if (r?.result?.value !== true) console.log(`  --klick: nichts gefunden fuer ${klick} ${klickText}`)
    await new Promise((r2) => setTimeout(r2, 800))
  }
  const s = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile(ziel, Buffer.from(s.data, 'base64'))
  console.log(`  Bild: ${ziel} (${breite}x${hoehe})`)
} finally {
  ws.close()
  await browser.schliessen()
}
