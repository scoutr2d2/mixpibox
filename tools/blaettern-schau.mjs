#!/usr/bin/env node
/*
 * VOLLBILD-BLAETTERN, NACHGEMESSEN — ein Werk je Seite, die Buehne rastet.
 *
 *     node tools/blaettern-schau.mjs --ziel http://192.168.178.57:8200/neu/
 *
 * E44 Block 2 (19.08.2026): Das Darstellungs-Feld `vollbildBlaettern` soll
 * das Raster einspaltig machen (Kachelbreite an der Schirmhoehe), und die
 * Buehne soll beim Rollen auf Kachelmitten einrasten (scroll-snap).
 *
 * VIER ZEUGEN, Vorher/Nachher am selben Raster:
 *   AUS: mehrere Rasterspalten, Kachel klein, kein snap-type an der Buehne.
 *   AN:  EINE Spalte, Kachel = 100vh - 190px (290 px auf 480), snap-type
 *        "y mandatory" — und der RAST-BEWEIS: nach einem Roll auf eine
 *        krumme Stelle liegt eine Kachelmitte binnen 1,5 s auf Buehnenmitte.
 *
 * Es wird NICHTS abgespielt. Das finally stellt das Feld zurueck.
 */
import process from 'node:process'
import WebSocket from 'ws'

import { eigenerBrowser } from './leihgabe.mjs'

const opt = (name, vorgabe) => {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : vorgabe
}
const ZIEL = opt('--ziel', 'http://192.168.178.57:8200/neu/')
const WURZEL = new URL(ZIEL).origin

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

async function bisWahr(ws, ausdruck, was, geduldMs = 20000) {
  const ende = Date.now() + geduldMs
  for (;;) {
    const w = await auswerten(ws, ausdruck)
    if (w) return w
    if (Date.now() > ende) throw new Error(`Zeit um: ${was}`)
    await new Promise((f) => setTimeout(f, 250))
  }
}

const s = (n) => new Promise((f) => setTimeout(f, n))

async function darstellungHolen() {
  const r = await fetch(`${WURZEL}/api/darstellung`, { cache: 'no-store' })
  return r.json()
}

async function feldSetzen(vollbildBlaettern, themen) {
  const r = await fetch(`${WURZEL}/api/darstellung`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ aktuell: { vollbildBlaettern }, themen: themen || {} }),
  })
  if (!r.ok) throw new Error(`PUT /api/darstellung: ${r.status}`)
}

/** Spalten, Kachelmasse und Snap-Angaben des Rasters, in einem Griff. */
async function rasterLesen(ws) {
  return auswerten(
    ws,
    `(() => {
      const raster = document.querySelector('#raster')
      const buehne = document.querySelector('#buehne')
      const kachel = raster && raster.querySelector(':scope > .kachel')
      if (!raster || !buehne || !kachel) return null
      return {
        spalten: getComputedStyle(raster).gridTemplateColumns.split(' ').length,
        kachelBreite: Math.round(kachel.getBoundingClientRect().width),
        snap: getComputedStyle(buehne).scrollSnapType,
        blaettern: document.body.classList.contains('blaettern'),
      }
    })()`,
  )
}

const lauf = await eigenerBrowser({ fenster: '800,480' })
if (!lauf) {
  console.error('Kein Browser gefunden.')
  process.exit(1)
}

let zurueck = null
try {
  const vorher = await darstellungHolen()
  const a = vorher?.aktuell || {}
  zurueck = a.vollbildBlaettern === true
  console.log(`Profil aktiv: ${vorher?.profil || '?'} — vollbildBlaettern vorher: ${a.vollbildBlaettern ?? '(fehlt)'}`)

  const seite = new WebSocket(await lauf.seite())
  await new Promise((f, k) => (seite.on('open', f), seite.on('error', k)))
  await send(seite, 'Page.enable')
  // DER SCHIRM MUSS 800x480 SEIN, nicht ungefaehr: --window-size gibt dem
  // headless-Fenster 480, dem INHALT aber nur 337 (gemessen 19.08.2026 —
  // die Kachel mass exakt 337-190=147 px, die Formel stimmte, der Schirm
  // nicht). Die Emulation setzt das VIEWPORT-Mass, auf das es ankommt.
  await send(seite, 'Emulation.setDeviceMetricsOverride', {
    width: 800,
    height: 480,
    deviceScaleFactor: 1,
    mobile: false,
  })

  // ── AUS ──────────────────────────────────────────────────────────────────
  await send(seite, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
  await bisWahr(seite, `!!document.querySelector('#raster > .kachel')`, 'Startseite mit Kacheln')
  const aus = await rasterLesen(seite)
  console.log(`\n── AUS ──`)
  console.log(`Spalten: ${aus.spalten}, Kachel: ${aus.kachelBreite}px, snap: ${aus.snap}, Klasse: ${aus.blaettern}`)

  // ── AN ───────────────────────────────────────────────────────────────────
  await feldSetzen(true, vorher?.themen)
  await send(seite, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now() + 1}` })
  await bisWahr(seite, `document.body.classList.contains('blaettern')`, 'Seite uebernimmt vollbildBlaettern')
  await bisWahr(seite, `!!document.querySelector('#raster > .kachel')`, 'Kacheln (AN-Lauf)')
  const an = await rasterLesen(seite)
  console.log(`\n── AN ──`)
  console.log(`Spalten: ${an.spalten}, Kachel: ${an.kachelBreite}px (erwartet 290), snap: ${an.snap}`)
  if (an.kachelBreite < 285) {
    const diag = await auswerten(
      seite,
      `(() => {
        const k = document.querySelector('#raster > .kachel')
        const c = getComputedStyle(k)
        let regeln = 0
        for (const s of document.styleSheets) {
          try {
            for (const r of s.cssRules) if ((r.selectorText || '').includes('blaettern')) regeln++
          } catch {}
        }
        return {
          bodyKlassen: document.body.className,
          kachelKlassen: k.className,
          computed: { width: c.width, align: c.scrollSnapAlign, stop: c.scrollSnapStop },
          blaetternRegeln: regeln,
          rasterKinder: [...document.querySelector('#raster').children].slice(0, 6).map((e) => e.className),
          vh: innerHeight,
        }
      })()`,
    )
    console.log(`Diagnose: ${JSON.stringify(diag, null, 1)}`)
  }

  // ── Der Rast-Beweis: WISCHEN, nicht scrollTo. Ein programmatisches
  //    scrollTo zieht Chromium NICHT nach auf den Schnapp-Punkt (am Geraet
  //    gemessen: 42 px daneben, waehrend dieselbe Seite unter dem Finger
  //    einrastet) — nur eine echte Geste laesst den Snap greifen. ───────────
  await send(seite, 'Input.synthesizeScrollGesture', {
    x: 400,
    y: 240,
    xDistance: 0,
    yDistance: -260,
    speed: 900,
  })
  await s(1500)
  const rast = await auswerten(
    seite,
    `(() => {
      const b = document.querySelector('#buehne')
      const bm = b.getBoundingClientRect()
      const mitte = bm.top + bm.height / 2
      const abstaende = [...document.querySelectorAll('#raster > .kachel')].map((k) => {
        const r = k.getBoundingClientRect()
        return Math.abs(r.top + r.height / 2 - mitte)
      })
      return Math.round(Math.min(...abstaende))
    })()`,
  )
  console.log(`Rast-Beweis: naechste Kachelmitte liegt ${rast}px neben der Buehnenmitte (erwartet < 8)`)

  const urteil =
    aus.spalten > 1 &&
    !aus.blaettern &&
    an.spalten === 1 &&
    an.kachelBreite >= 285 &&
    an.kachelBreite <= 295 &&
    String(an.snap).includes('y mandatory') &&
    rast < 8
  console.log(`\nURTEIL: ${urteil ? 'BLAETTERN TRAEGT' : 'ABWEICHUNG — siehe oben'}`)
  process.exitCode = urteil ? 0 : 1
} finally {
  if (zurueck !== null) {
    const jetzt = await darstellungHolen().catch(() => null)
    await feldSetzen(zurueck, jetzt?.themen).catch((f) => console.error(`Zuruecksetzen scheiterte: ${f.message}`))
    console.log(`Zurueckgestellt: vollbildBlaettern=${zurueck}`)
  }
  await lauf.schliessen?.()
}
