#!/usr/bin/env node
/*
 * DER META-INTERPRET, NACHGEMESSEN — gehoert er der Box oder Spotify?
 *
 *     node tools/meta-interpret-schau.mjs --ziel http://192.168.178.57:8200/neu/
 *
 * E45 (19.08.2026). Betreiber: „baue die interpreten so um das es meta
 * interpreten der box sind nicht nur von Spotify … Falls Spotify wegbricht
 * soll es immer noch interpeten geben können … wichtig ist mir auch das die
 * service tags dort angezeigt werden."
 *
 * ZWEI LAEUFE AN DERSELBEN KACHEL:
 *
 *   1. NORMAL — die Rundkachel oeffnet die Interpretenseite; die Kacheln
 *      tragen die Plakette IHRES Dienstes (bei „Die Maus": ARD, nicht
 *      Spotify), und die Kopfzeile nennt den Dienst.
 *
 *   2. SPOTIFY WEGGEBROCHEN — die Antwort von /api/interpreten wird im Flug
 *      um ihre Spotify-Kennungen gebracht (id: null), also GENAU der Zustand
 *      nach einem Ausfall der Erkennung. Die Kachel muss trotzdem die Seite
 *      oeffnen (Abruf an `/api/interpret/-`), und „In deiner Box" muss stehen.
 *      Vor dem Umbau landete das Kind hier im Regal.
 *
 * Es wird NICHTS abgespielt und NICHTS auf der Box veraendert: der Eingriff
 * lebt nur im Browser dieses Laufs.
 */
import process from 'node:process'
import WebSocket from 'ws'

import { eigenerBrowser } from './leihgabe.mjs'

const opt = (name, vorgabe) => {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : vorgabe
}
const ZIEL = opt('--ziel', 'http://192.168.178.57:8200/neu/')
const INTERPRET = opt('--interpret', 'Die Maus')

let naechste = 1
function send(ws, methode, params = {}) {
  const id = naechste++
  return new Promise((fertig, kaputt) => {
    const horch = (roh) => {
      const d = JSON.parse(roh)
      if (d.id !== id) return
      ws.off('message', horch)
      d.error ? kaputt(new Error(`${methode}: ${d.error.message}`)) : fertig(d.result)
    }
    ws.on('message', horch)
    ws.send(JSON.stringify({ id, method: methode, params }))
  })
}

async function auswerten(ws, ausdruck) {
  const r = await send(ws, 'Runtime.evaluate', { expression: ausdruck, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'Auswertung gescheitert')
  return r.result?.value
}

async function bisWahr(ws, ausdruck, was, geduldMs = 25000) {
  const ende = Date.now() + geduldMs
  for (;;) {
    const w = await auswerten(ws, ausdruck)
    if (w) return w
    if (Date.now() > ende) throw new Error(`Zeit um: ${was}`)
    await new Promise((f) => setTimeout(f, 250))
  }
}

const s = (n) => new Promise((f) => setTimeout(f, n))

/** Die Rundkachel des Interpreten antippen. */
async function rundkachelTippen(ws) {
  await bisWahr(ws, `!!document.querySelector('button.leute-kachel')`, 'Interpreten-Reihe')
  const gefunden = await auswerten(
    ws,
    `(() => {
      const k = [...document.querySelectorAll('button.leute-kachel')]
        .find((b) => (b.textContent || '').includes(${JSON.stringify(INTERPRET)}))
      if (!k) return null
      const marken = [...k.querySelectorAll('.marke')].map((m) => m.className.replace('marke marke-', ''))
      const aria = k.getAttribute('aria-label')
      k.click()
      return { marken, aria }
    })()`,
  )
  if (!gefunden) throw new Error(`Rundkachel "${INTERPRET}" nicht gefunden`)
  return gefunden
}

/** Was steht auf der Seite? */
async function seiteLesen(ws) {
  return auswerten(
    ws,
    `(() => {
      const s = document.querySelector('#interpret')
      if (!s || s.hidden) return { offen: false }
      const reihen = [...s.querySelectorAll('.int-reihe')].map((r) => ({
        kopf: ((r.querySelector('.int-reihe-kopf') || {}).textContent || '').trim(),
        kacheln: r.querySelectorAll('.lane-kachel').length,
      }))
      const marken = [...s.querySelectorAll('.lane-kachel .marke')].map((m) =>
        m.className.replace('marke marke-', ''),
      )
      return {
        offen: true,
        name: (document.querySelector('#interpret-name') || {}).textContent,
        zeile: (document.querySelector('#interpret-zeile') || {}).textContent,
        reihen,
        marken: [...new Set(marken)],
        regalOffen: !document.querySelector('#regal-kopf')?.hidden,
      }
    })()`,
  )
}

const lauf = await eigenerBrowser({ fenster: '800,480' })
if (!lauf) {
  console.error('Kein Browser gefunden.')
  process.exit(1)
}

try {
  const seite = new WebSocket(await lauf.seite())
  await new Promise((f, k) => (seite.on('open', f), seite.on('error', k)))
  await send(seite, 'Page.enable')
  await send(seite, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })
  await send(seite, 'Network.enable')
  const interpretAbrufe = []
  seite.on('message', (roh) => {
    try {
      const d = JSON.parse(roh)
      const u = d.method === 'Network.requestWillBeSent' ? String(d.params?.request?.url || '') : ''
      if (u.includes('/api/interpret/')) interpretAbrufe.push(u)
    } catch {
      /* fremde Nachricht */
    }
  })

  // ── LAUF 1: normal ───────────────────────────────────────────────────────
  await send(seite, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
  const kachel1 = await rundkachelTippen(seite)
  await s(4000)
  const a1 = await seiteLesen(seite)
  console.log(`── LAUF 1: normal ──`)
  console.log(`Rundkachel:  ${kachel1.aria}`)
  // IM KREIS GEHOERT KEIN ZEICHEN (Betreiber, 19.08.2026: „im runden
  // interpeten kreis braucht es keinen dienst batch"). Der Interpret gehoert
  // der Box; die Herkunft steht an den WERKEN dahinter.
  console.log(`  Plaketten: ${kachel1.marken.join(', ') || 'keine (richtig)'}`)
  console.log(`Seite offen: ${a1.offen ? 'JA' : 'NEIN (FALSCH)'}   Regal offen: ${a1.regalOffen ? 'JA (FALSCH)' : 'nein'}`)
  console.log(`  Kopf:      ${a1.name} — ${a1.zeile}`)
  console.log(`  Reihen:    ${(a1.reihen || []).map((r) => `${r.kopf} (${r.kacheln})`).join(' | ')}`)
  console.log(`  Plaketten auf den Kacheln: ${(a1.marken || []).join(', ') || 'KEINE'}`)
  console.log(`  Abruf:     ${interpretAbrufe[interpretAbrufe.length - 1] || '—'}`)

  /* ── LAUF 2: Spotify weggebrochen ──────────────────────────────────────
   *
   * Die Antwort von /api/interpreten wird im Flug um ihre Kennungen
   * gebracht — genau der Zustand, den die Erkennung bei einem Spotify-
   * Ausfall liefert („lieber zeigen", id: null). Der Eingriff lebt nur in
   * diesem Browser; auf der Box aendert sich nichts. */
  // `requestStage: 'Response'` IST DER GANZE TRICK: ohne ihn pausiert CDP in
  // der ANFRAGE-Phase, es gibt noch keinen Koerper zu lesen, und der Lauf
  // reicht die Anfrage unveraendert durch — die Messung sieht dann aus, als
  // haette der Eingriff nichts bewirkt (am 19.08.2026 genau so passiert).
  await send(seite, 'Fetch.enable', {
    patterns: [{ urlPattern: '*/api/interpreten*', requestStage: 'Response' }],
  })
  seite.on('message', async (roh) => {
    try {
      const d = JSON.parse(roh)
      if (d.method !== 'Fetch.requestPaused') return
      const koerper = await send(seite, 'Fetch.getResponseBody', { requestId: d.params.requestId }).catch(() => null)
      if (!koerper) {
        console.error('  ! Koerper nicht lesbar — Eingriff faellt aus')
        await send(seite, 'Fetch.continueResponse', { requestId: d.params.requestId }).catch(() => {})
        return
      }
      const roh2 = koerper.base64Encoded ? Buffer.from(koerper.body, 'base64').toString('utf8') : koerper.body
      const j = JSON.parse(roh2)
      for (const p of j.reihe || []) p.id = null
      await send(seite, 'Fetch.fulfillRequest', {
        requestId: d.params.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify(j), 'utf8').toString('base64'),
      }).catch(() => {})
    } catch {
      /* nicht unsere Nachricht */
    }
  })

  interpretAbrufe.length = 0
  await send(seite, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now() + 1}` })
  const kachel2 = await rundkachelTippen(seite)
  await s(4000)
  const a2 = await seiteLesen(seite)
  console.log(`\n── LAUF 2: Spotify weggebrochen (alle Kennungen null) ──`)
  console.log(`Rundkachel:  ${kachel2.aria}`)
  console.log(`Seite offen: ${a2.offen ? 'JA (richtig)' : 'NEIN (FALSCH — im Regal gelandet?)'}`)
  console.log(`  Regal:     ${a2.regalOffen ? 'OFFEN (FALSCH)' : 'zu (richtig)'}`)
  console.log(`  Kopf:      ${a2.name} — ${a2.zeile}`)
  console.log(`  Reihen:    ${(a2.reihen || []).map((r) => `${r.kopf} (${r.kacheln})`).join(' | ') || 'KEINE'}`)
  console.log(`  Plaketten: ${(a2.marken || []).join(', ') || 'KEINE'}`)
  console.log(`  Abruf:     ${interpretAbrufe[interpretAbrufe.length - 1] || '—'}`)

  const ohneSpotifyWeg = String(interpretAbrufe[interpretAbrufe.length - 1] || '').includes('/api/interpret/-')
  const boxReihe = (a2.reihen || []).some((r) => r.kopf.startsWith('In deiner Box') && r.kacheln > 0)
  const urteil =
    a1.offen &&
    !a1.regalOffen &&
    kachel1.marken.length === 0 && // im Kreis KEIN Zeichen
    (a1.marken || []).length > 0 && // an den Werken schon
    a2.offen &&
    !a2.regalOffen &&
    ohneSpotifyWeg &&
    boxReihe
  console.log(`\nURTEIL: ${urteil ? 'DER INTERPRET GEHOERT DER BOX' : 'ABWEICHUNG — siehe oben'}`)
  process.exitCode = urteil ? 0 : 1
} finally {
  await lauf.schliessen?.()
}
