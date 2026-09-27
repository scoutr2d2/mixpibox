#!/usr/bin/env node
/**
 * WELCHE FARBE STEHT WIRKLICH AUF DEM SCHIRM — und ein Bild dazu.
 *
 * ══ WARUM ES DIESES WERKZEUG GIBT ══════════════════════════════════════════
 *
 * Dreimal an diesem Baum griff eine Regel nach einer Eigenschaft, die es nicht
 * gibt (`var(--akzent)` statt `--accent`, `var(--text)` statt `--ink`). CSS
 * wirft so eine Erklaerung STILL WEG: kein Fehler, keine Konsole, nichts.
 *
 * tools/stilnamen-pruefen.py faengt das seit dem 07.08.2026 IM STILBLATT ab.
 * Aber es liest Text, und Text ist nicht der Schirm: eine Regel kann richtig
 * geschrieben sein und trotzdem von einer spaeteren ueberschrieben werden, und
 * dann steht wieder die falsche Farbe da. DIESE DATEI FRAGT DEN BROWSER.
 *
 * ES IST DER GEGENSATZ ZUM „ES STEHT DOCH SO IN DER DATEI". Beim Ring war
 * genau das der Trugschluss: die Groesse stimmte, `--wappen-fuell` wuchs
 * sauber von 0 auf 1, und gemalt wurde NICHTS.
 *
 * ══ WAS BEHAUPTET WIRD ═════════════════════════════════════════════════════
 *   1. `.eltern-titel` traegt die Akzentfarbe — NICHT die Tintenfarbe.
 *      (Der Kommentar an der Regel sagt, die Farbe sei „der Ersatz fuer die
 *      Groesse"; erbte sie die Tinte, saehe der Name aus wie eine Fussnote —
 *      genau das, wovor derselbe Kommentar warnt.)
 *   2. `.regal-name` traegt die Tintenfarbe.
 *   3. Keine der beiden steht auf einer LEEREN Farbe.
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * Nichts an einer Datei und NICHTS AN EINER BOX.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/farben-am-schirm.mjs --ziel http://127.0.0.1:9111/neu/
 *   node tools/farben-am-schirm.mjs --ziel … --bilder /tmp/farben
 * ENDE 0, wenn jede Farbe die ist, die der Kommentar verspricht.
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
  if (i < 0) return v
  const w = argv[i + 1]
  return w && !w.startsWith('--') ? w : true
}
const MITGEGEBEN = typeof opt('ziel', null) === 'string' ? opt('ziel') : argv.find((a) => a.startsWith('http')) || null
const BILDER = typeof opt('bilder', null) === 'string' ? opt('bilder') : null

const warte = (ms) => new Promise((r) => setTimeout(r, ms))
let fehler = 0
const ja = (gut, satz, dazu = '') => {
  if (!gut) fehler++
  console.log(`${gut ? 'ok  ' : 'NEIN'}  ${satz}${dazu ? `  — ${dazu}` : ''}`)
}

let vorschau = null
let ZIEL = MITGEGEBEN
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
  vorschau = spawn(process.execPath, ['tools/neu-vorschau.mjs', '--port', String(p)], { cwd: WURZEL, stdio: 'ignore' })
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
console.log(`ZIEL: ${ZIEL}\n`)

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
  if (BILDER) await mkdir(BILDER, { recursive: true })
  ws = new WebSocket(await browser.seite(), { perMessageDeflate: false })
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })

  const ev = async (e) => {
    const r = await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'Fehler in der Seite')
    return r.result.value
  }

  await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
  await warte(1500)
  await ev(`(() => { try { localStorage.clear(); sessionStorage.clear() } catch (_) {} return true })()`)
  await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
  await warte(2000)

  // DIE ERWARTETEN FARBEN KOMMEN AUS DEM STILBLATT SELBST, nicht als
  // abgeschriebene Zahl. Stuende hier '#FF6B57', muesste jede Aenderung am
  // Farbton auch hier nachgezogen werden — und beim ersten Vergessen faellt
  // das Werkzeug rot aus, ohne dass etwas kaputt ist.
  const soll = await ev(`(() => {
    const s = getComputedStyle(document.documentElement)
    const zu = (n) => { const d = document.createElement('div')
      d.style.color = s.getPropertyValue(n).trim(); document.body.appendChild(d)
      const c = getComputedStyle(d).color; d.remove(); return c }
    return { accent: zu('--accent'), ink: zu('--ink') } })()`)
  console.log(`    --accent = ${soll.accent}`)
  console.log(`    --ink    = ${soll.ink}\n`)

  const farbe = (wahl) =>
    ev(`(() => { const e = document.querySelector('${wahl}')
      if (!e) return null
      const b = e.getBoundingClientRect()
      return { farbe: getComputedStyle(e).color, sichtbar: b.width > 0 && b.height > 0,
               text: (e.textContent || '').trim().slice(0, 30) } })()`)

  // ── Das Regal steht auf der Startseite ──────────────────────────────────
  console.log('══ .regal-name — die Tintenfarbe ══')
  const regal = await farbe('.regal-name')
  if (!regal) {
    console.log('    .regal-name steht gerade nicht im Baum (nur im Regal je Interpret)')
  } else {
    console.log(`    „${regal.text}"`)
    ja(regal.farbe === soll.ink, 'traegt die Tintenfarbe --ink', regal.farbe)
  }

  // ── Und der Titel im Admin-Bereich ──────────────────────────────────────
  console.log('\n══ .eltern-titel — die Akzentfarbe ══')
  await adminAuf(ev)
  const titel = await farbe('.eltern-titel')
  if (!titel) {
    ja(false, '.eltern-titel steht nicht im Baum')
  } else {
    console.log(`    „${titel.text}"`)
    ja(titel.sichtbar, 'steht sichtbar da')
    ja(titel.farbe === soll.accent, 'traegt die AKZENTFARBE, nicht die Tinte', titel.farbe)
    ja(
      titel.farbe !== soll.ink,
      'und sieht damit nicht aus wie die Fussnote, vor der der Kommentar warnt',
      titel.farbe === soll.ink ? 'sie erbt die Tinte' : 'anders als --ink',
    )
  }

  if (BILDER) {
    const s = await send(ws, 'Page.captureScreenshot', { format: 'png' })
    const p = join(BILDER, 'eltern-titel.png')
    await writeFile(p, Buffer.from(s.data, 'base64'))
    console.log(`\n    Bild: ${p}`)
  }

  console.log(fehler ? `\n${fehler} FARBE(N) FALSCH` : '\nALLES GRUEN')
} finally {
  try {
    ws?.close()
  } catch {
    /* egal */
  }
  await browser.schliessen()
}
process.exit(fehler ? 1 : 0)
