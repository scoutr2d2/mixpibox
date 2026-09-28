#!/usr/bin/env node
/**
 * WO STEHEN DIE TASTEN DES KISSENS BEIM EIN- UND AUSFAHREN? — ueber die Zeit.
 *
 * Betreiber 27.09.2026: „beim einfahren rutscht der player nach rechts aber
 * beim ausfahren bleiben die tasten stehen ich haette es gerne wie beim
 * ausfahren". Ein Standbild zeigt das nicht; es braucht die Lage der
 * Pause-Taste alle ~16 ms waehrend der 220-ms-Bewegung.
 *
 * WARUM EIN EIGENER KOPFLOSER BROWSER: im Browser-Pane der Desktop-App
 * drosselt Chromium Zeitgeber und requestAnimationFrame, solange das Pane
 * verdeckt ist — dort kamen 1 bis 3 Werte statt 30.
 *
 * OHNE ADRESSE STARTET ES SEINE EIGENE ATTRAPPE (28.09.2026) — so haengt es
 * in `tools/pruefen.sh`. Bis dahin verlangte es eine URL, an der jemand von
 * Hand `platzBeimBlaettern` eingeschaltet hatte, und lief darum in keinem
 * Laeufer: der Wunsch des Betreibers war einmal gemessen und danach
 * unbewacht. Jetzt: `tools/neu-vorschau.mjs` auf einem freien Port (dasselbe
 * Muster wie `gestalter-schau.mjs`), `platzBeimBlaettern` per
 * PUT /api/darstellung an, messen, Attrappe beenden.
 *
 * MIT ADRESSE misst es dort — an der Box oder einer fremden Vorschau. Dann
 * muss `platzBeimBlaettern` dort anstehen (sonst faehrt nichts ein, und das
 * Werkzeug meldet genau das).
 *
 * AUFRUF
 *     node tools/kissen-einfahren-messen.mjs                            # eigene Attrappe
 *     node tools/kissen-einfahren-messen.mjs http://127.0.0.1:8392/neu/
 * Ausgabe: je Richtung die Spanne der x-Lage der Pause-Taste; 0 = steht still.
 * Rueckgabe 1, wenn eine Richtung mehr als 2 px wandert oder nichts einfaehrt;
 * ohne Browser auf dem Rechner 0 („uebersprungen"), wie die anderen
 * Browser-Schritte in pruefen.sh.
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { eigenerBrowser, freierPort } from './leihgabe.mjs'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let url = process.argv.find((a) => /^https?:\/\//.test(a))
let attrappe = null
// Ein Kind, das den Elternprozess ueberlebt, hielte den Port — und in
// pruefen.sh laeuft das naechste Werkzeug schon.
process.on('exit', () => attrappe?.kill())
if (!url) {
  const port = await freierPort()
  let meldung = ''
  attrappe = spawn(process.execPath, [path.join(WURZEL, 'tools/neu-vorschau.mjs'), '--port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  attrappe.stderr.on('data', (d) => (meldung += d))
  await new Promise((gut, schlecht) => {
    const t = setTimeout(() => schlecht(new Error(`Attrappe startet nicht\n${meldung}`)), 15000)
    attrappe.stdout.on('data', (d) => {
      if (String(d).includes('Vorschau:')) {
        clearTimeout(t)
        gut()
      }
    })
  })
  const basis = `http://127.0.0.1:${port}`
  const darstellung = await (await fetch(`${basis}/api/darstellung`)).json()
  const antwort = await fetch(`${basis}/api/darstellung`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ aktuell: { ...darstellung.aktuell, platzBeimBlaettern: true } }),
  })
  if (!antwort.ok) {
    console.log(`  Attrappe nimmt platzBeimBlaettern nicht an (${antwort.status})`)
    process.exit(1)
  }
  url = `${basis}/neu/`
}
const browser = await eigenerBrowser({ fenster: '800,700' })
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
const ev = async (e) =>
  (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.value

let schlecht = false
try {
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url })
  await new Promise((r) => setTimeout(r, 4500))
  const ergebnis = await ev(`(async () => {
    const b = document.getElementById('buehne')
    const k = () => Math.round(document.querySelector('.mp-haupt').getBoundingClientRect().left)
    const messen = async (ms) => { const w = []; const t0 = performance.now(); while (performance.now() - t0 < ms) { w.push(k()); await new Promise((r) => setTimeout(r, 16)) } return w }
    const vor = k()
    b.scrollBy({ top: 150, behavior: 'smooth' })
    const ein = await messen(450)
    const eingefahren = document.body.classList.contains('platz-machen')
    await new Promise((r) => setTimeout(r, 3000))
    const aus = await messen(450)
    return { vor, eingefahren, ein, aus }
  })()`)
  if (!ergebnis?.eingefahren) {
    console.log('  NICHT eingefahren — steht platzBeimBlaettern an?')
    schlecht = true
  } else {
    for (const [wort, w] of [
      ['einfahren', ergebnis.ein],
      ['ausfahren', ergebnis.aus],
    ]) {
      const spanne = Math.max(...w) - Math.min(...w)
      console.log(`  ${wort}: x ${Math.min(...w)}..${Math.max(...w)} (Spanne ${spanne} px, ${w.length} Werte)`)
      if (spanne > 2) schlecht = true
    }
  }
} finally {
  ws.close()
  await browser.schliessen()
}
process.exit(schlecht ? 1 : 0)
