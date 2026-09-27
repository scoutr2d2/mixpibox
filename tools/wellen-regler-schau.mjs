#!/usr/bin/env node
/**
 * WIRKEN DIE WELLEN-REGLER — oder stehen sie nur in der Verwaltung?
 *
 * ── WAS ES PRUEFT (E99-Feinschliff, 31.08.2026) ───────────────────────────
 * Die zwei Eltern-Regler „Hoehe der Wellen" und „Tempo der Wellen"
 * (Darstellung → Mini-Player) wirken auf zwei ganz verschiedenen Wegen:
 *
 *   wellenHub    -> CSS-Variable `--mupi-wellen-hoehe` (40/56/78 px); der
 *                   Hub des Zeichners folgt der Leinwand von selbst.
 *   wellenTempo  -> Pufferlaenge des Foerderbands (90/60/40 Punkte); weniger
 *                   Punkte auf derselben Breite = groesserer Schritt =
 *                   schnelleres Band. Von aussen NICHT am DOM ablesbar —
 *                   deshalb der Messzugang `window.mupiWellenMessung.puffer()`
 *                   (derselbe Kanal, den die Messseite nutzt).
 *
 * Gemessen wird je Stufe: Darstellung per PUT stellen (aktuell GANZ
 * ersetzen, wie es die Optik-Seite tut), Seite neu laden, beide Wirkungen
 * ablesen. Dazu die Rueckfall-Wahrheit: OHNE Regler-Wert (alte
 * darstellung.json) gilt Stufe 2 — exakt der Stand vor dem Feinschliff;
 * eine Box, deren Eltern nie tippen, sieht keine Aenderung.
 *
 * WAS ES AENDERT: nichts Bleibendes. Die Vorschau wird geliehen und samt
 * Darstellung zurueckgelegt (seit 31.08.2026 traegt der Lage-Schnappschuss
 * `darstellung` — genau fuer Werkzeuge wie dieses).
 *
 * AUFRUF
 *     node tools/wellen-regler-schau.mjs             # Tabelle
 *     node tools/wellen-regler-schau.mjs --pruefen   # Ende 1 bei Befund
 */
import WebSocket from 'ws'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const ZIEL = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const PRUEFEN = process.argv.includes('--pruefen')
const zeig = PRUEFEN ? () => {} : console.log

const HOEHE_SOLL = { 1: '40px', 2: '56px', 3: '78px' }
const PUFFER_SOLL = { 1: 90, 2: 60, 3: 40 }

const leihe = await vorschauLeihen(ZIEL)
const brw = await eigenerBrowser({ fenster: '800,480' }).catch(async (e) => {
  await leihe.zurueckgeben()
  console.error(`  Browser kam nicht hoch — Messung nicht moeglich: ${e.message}`)
  process.exit(2)
})
if (!brw) {
  await leihe.zurueckgeben()
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}

let id = 0
const send = (ws, m, p = {}) =>
  new Promise((ok, no) => {
    const i = ++id
    ws.send(JSON.stringify({ id: i, method: m, params: p }))
    const h = (r) => {
      const x = JSON.parse(r)
      if (x.id !== i) return
      ws.off('message', h)
      x.error ? no(new Error(x.error.message)) : ok(x.result)
    }
    ws.on('message', h)
  })
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

/** Die Darstellung stellen, wie es die Optik-Seite tut: `aktuell` GANZ. */
async function stellen(felder) {
  const stand = await (await fetch(new URL('/api/darstellung', ZIEL))).json()
  const aktuell = { ...(stand.aktuell || {}), ...felder }
  const a = await fetch(new URL('/api/darstellung', ZIEL), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ aktuell }),
  })
  if (!a.ok) throw new Error(`PUT /api/darstellung antwortete ${a.status}`)
}

let fehler = 0
try {
  await warte(1200)
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value
  const messen = async () => {
    await send(ws, 'Page.navigate', { url: ZIEL })
    await warte(1800)
    return await ev(`({
      hoehe: getComputedStyle(document.documentElement).getPropertyValue('--mupi-wellen-hoehe').trim(),
      puffer: window.mupiWellenMessung ? window.mupiWellenMessung.puffer() : null,
    })`)
  }

  const pruefe = (name, ist, soll) => {
    const gut = ist === soll
    if (!gut) fehler++
    const zeile = `    ${gut ? 'ok  ' : 'FALSCH'} ${name.padEnd(34)} ist ${String(ist).padEnd(6)} soll ${soll}`
    if (gut) zeig(zeile)
    else console.error(zeile)
  }

  for (const stufe of [1, 2, 3]) {
    await stellen({ wellenHub: stufe, wellenTempo: stufe })
    const m = await messen()
    pruefe(`Stufe ${stufe}: Hoehe (--mupi-wellen-hoehe)`, m?.hoehe ?? '(keine)', HOEHE_SOLL[stufe])
    pruefe(`Stufe ${stufe}: Pufferlaenge (Tempo)`, m?.puffer ?? '(keiner)', PUFFER_SOLL[stufe])
  }

  // DER RUECKFALL: Felder ganz entfernen — eine Box mit alter
  // darstellung.json muss exakt beim bisherigen Stand landen (Stufe 2).
  {
    const stand = await (await fetch(new URL('/api/darstellung', ZIEL))).json()
    const aktuell = { ...(stand.aktuell || {}) }
    delete aktuell.wellenHub
    delete aktuell.wellenTempo
    const a = await fetch(new URL('/api/darstellung', ZIEL), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ aktuell }),
    })
    if (!a.ok) throw new Error(`PUT /api/darstellung antwortete ${a.status}`)
    const m = await messen()
    pruefe('ohne Regler-Wert: Hoehe = alter Stand', m?.hoehe ?? '(keine)', HOEHE_SOLL[2])
    pruefe('ohne Regler-Wert: Puffer = alter Stand', m?.puffer ?? '(keiner)', PUFFER_SOLL[2])
  }

  if (!fehler) console.log('  beide Wellen-Regler wirken auf allen drei Stufen, der Rueckfall ist der alte Stand')
} catch (e) {
  fehler++
  console.error(`  Messung abgebrochen: ${e.message}`)
} finally {
  await brw.schliessen().catch(() => {})
  await leihe.zurueckgeben()
}
process.exitCode = PRUEFEN && fehler ? 1 : 0
