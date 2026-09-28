#!/usr/bin/env node
/**
 * WAS KOSTET DIE OBERFLAECHE IM LEERLAUF? — Hauptfaden-Arbeit ueber die Zeit.
 *
 * Betreiber 27.09.2026: „mach mal eine untersuchung ob es auf einem raspi 3
 * mit 1gb laufen koennte". Am Geraet (.62, Pi 5) zeigte die ERSTE Messung
 * 185 % eines Kerns fuer Chromium — ein Uebergang, wie die Reihe danach zeigte
 * (drei Messungen mit Abstand: 14, 6, 6 %). Welche Einstellung was kostet,
 * misst dieses Werkzeug an derselben Seite unter verschiedenen Darstellungen
 * — in einem eigenen kopflosen Browser, gegen die Vorschau (keine Box, keine
 * Einstellung auf einem Geraet wird angefasst).
 *
 * GRENZE: gemessen wird der HAUPTFADEN. Glas (backdrop-filter) und Wellen
 * kosten vor allem im Compositor/GPU-Prozess — das bildet ein kopfloser
 * Browser mit Software-Rasterung nicht ab. Ergebnis 27.09.2026: die bewegte
 * Spielt-Marke ist der teuerste Hauptfaden-Posten (~+70 %).
 *
 * GEMESSEN wird `Performance.getMetrics` vor und nach einer Ruhezeit:
 * TaskDuration (Arbeit des Hauptfadens in s) und LayoutCount/RecalcStyle —
 * relativ zur Ruhezeit. Absolute Zahlen sind die des Arbeitsrechners, nicht
 * die eines Pi; der VERGLEICH der Einstellungen untereinander traegt.
 *
 * AUFRUF
 *     node tools/kiosk-last-messen.mjs http://127.0.0.1:8392 [--sekunden 15]
 * Die Vorschau muss laufen; das Werkzeug setzt ihre Darstellung per PUT
 * nacheinander auf die Proben und am Ende auf den Ausgangsstand zurueck.
 */
import WebSocket from 'ws'
import { eigenerBrowser } from './leihgabe.mjs'

const argv = process.argv.slice(2)
const basis = argv.find((a) => /^https?:\/\//.test(a))?.replace(/\/$/, '')
const i = argv.indexOf('--sekunden')
const sekunden = i >= 0 ? Number(argv[i + 1]) : 15
if (!basis) {
  console.error('Aufruf: node tools/kiosk-last-messen.mjs http://127.0.0.1:8392 [--sekunden 15]')
  process.exit(2)
}

const PROBEN = [
  ['alles ruhig (Glas aus, keine Wellen, ruhige Marke)', { glasAus: true, statusWellen: false, ruhigeMarke: true, mpGlas: false, grossGlas: false }],
  ['nur Glas an (Kissen + grosser Player)', { glasAus: false, statusWellen: false, ruhigeMarke: true, mpGlas: true, grossGlas: true }],
  ['nur Wellen an', { glasAus: true, statusWellen: true, ruhigeMarke: true, mpGlas: false, grossGlas: false }],
  ['nur bewegte Spielt-Marke', { glasAus: true, statusWellen: false, ruhigeMarke: false, mpGlas: false, grossGlas: false }],
  ['wie die Box (.62, 27.09.)', { glasAus: false, statusWellen: true, ruhigeMarke: false, mpGlas: true, grossGlas: true }],
]

const stand = await (await fetch(`${basis}/api/darstellung`)).json()
const setzen = (felder) =>
  fetch(`${basis}/api/darstellung`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ aktuell: { ...(stand.aktuell ?? {}), ...felder } }),
  })

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
    const n = ++lfd
    ws.send(JSON.stringify({ id: n, method: m, params: p }))
    const h = (r) => {
      const x = JSON.parse(r)
      if (x.id !== n) return
      ws.off('message', h)
      x.error ? no(new Error(x.error.message)) : ok(x.result)
    }
    ws.on('message', h)
  })
const metriken = async () =>
  Object.fromEntries((await send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))

try {
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Performance.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })
  console.log(`Leerlauf je Probe ${sekunden} s, Hauptfaden-Arbeit in % eines Kerns:`)
  for (const [wort, felder] of PROBEN) {
    await setzen(felder)
    await send('Page.navigate', { url: `${basis}/neu/` })
    // ERST MESSEN, WENN DIE SEITE STEHT: im ersten Anlauf (27.09.2026) stand
    // die Vorschau mitunter noch auf „Medien werden geladen" — gemessen war
    // dann der drehende Lade-Kreisel, nicht die Oberflaeche.
    let geladen = false
    for (let t = 0; t < 40 && !geladen; t++) {
      await new Promise((r) => setTimeout(r, 250))
      const res = await send('Runtime.evaluate', {
        expression: `(() => { const r = document.getElementById('raster'); return !!r && !r.hidden && r.children.length > 0 })()`,
        returnByValue: true,
      })
      geladen = res?.result?.value === true
    }
    if (!geladen) {
      console.log(`  ——      nicht geladen (Raster leer) — uebersprungen: ${wort}`)
      continue
    }
    await new Promise((r) => setTimeout(r, 2000))
    const a = await metriken()
    await new Promise((r) => setTimeout(r, sekunden * 1000))
    const b = await metriken()
    const arbeit = ((b.TaskDuration - a.TaskDuration) / sekunden) * 100
    const stil = (b.RecalcStyleCount - a.RecalcStyleCount) / sekunden
    const layout = (b.LayoutCount - a.LayoutCount) / sekunden
    console.log(
      `  ${arbeit.toFixed(1).padStart(5)} %   Stil ${stil.toFixed(1).padStart(5)}/s   Layout ${layout.toFixed(1).padStart(5)}/s   ${wort}`,
    )
  }
} finally {
  await fetch(`${basis}/api/darstellung`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ aktuell: stand.aktuell ?? {} }),
  })
  ws.close()
  await browser.schliessen()
}
