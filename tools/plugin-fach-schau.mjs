#!/usr/bin/env node
/**
 * DAS FACH „PLUGINS" IM ADMIN-MENUE DER BOX — steht es, und fuehrt es irgendwohin?
 *
 * ══ WOZU EIN EIGENES UND NICHT admin-menue-schau.mjs ═══════════════════════
 *
 * Jenes Werkzeug misst das GANZE Menue und traegt die Erwartungen vom
 * 06.08.2026 (vier Gruppen, elf Punkte). Gegen die heutige Oberflaeche meldet
 * es reihenweise Abweichungen, die mit dieser Aenderung nichts zu tun haben —
 * und bricht am Ende ab. Ein Werkzeug, dessen Rot man wegerklaeren muss, ist
 * kein Riegel mehr. Dieses hier stellt NUR die Fragen zu diesem einen Fach:
 *
 *   1. Steht der Punkt „Plugins" in der Gruppe „System"?
 *   2. Steht „Weitere Einstellungen" NICHT mehr da?
 *   3. Sagt die Unterzeile einen ZUSTAND und nicht nur einen Satz? (Sonst
 *      muesste man aufschlagen, um die einzige Frage zu beantworten, die man
 *      hier hat.)
 *   4. Fuehrt ein Tipp auf eine EIGENE Seite — und nicht auf dieselbe
 *      Uebersicht mit anderer Ueberschrift?
 *   5. Stehen dort die Plugins der Box mit ihren Feldern?
 *   6. Fuehrt der EINE Rueckweg genau EINE Ebene zurueck?
 *
 * Frage 4 und 6 sind die, an denen ein neues Fach in dieser Oberflaeche
 * typischerweise scheitert: eine fehlende Weiche in `fachMalen` sieht aus wie
 * eine Seite, und eine fehlende Zeile in `zurueck()` wirft einen aus dem
 * ganzen Bereich statt eine Ebene hoch.
 *
 * DER WEG HINEIN ist der Tastaturweg (`adminAuf`) samt Rechenaufgabe — beides
 * geliehen aus admin-weg.mjs bzw. nachgebaut wie in admin-menue-schau.mjs.
 * Das HALTEN des Schriftzugs prueft er NICHT; dafuer gibt es admin-weg.mjs.
 *
 * Aufruf:
 *   node tools/plugin-fach-schau.mjs                              # gegen die Box
 *   node tools/plugin-fach-schau.mjs http://127.0.0.1:8971/neu/   # gegen eine Vorschau
 */

import WebSocket from 'ws'
import { adminAuf } from './admin-weg.mjs'
import { eigenerBrowser } from './leihgabe.mjs'

const ZIEL = process.argv[2] || 'http://192.168.178.57:8200/neu/'
let fehler = 0
const ja = (frage, gut, befund) => {
  if (!gut) fehler++
  console.log(`${gut ? 'ok   ' : 'FEHL '} ${frage}${befund ? `  — ${befund}` : ''}`)
}
const warte = (ms) => new Promise((f) => setTimeout(f, ms))

const brw = await eigenerBrowser({ fenster: '800,480' })
if (!brw) {
  console.error('kein Browser gefunden (playwright/chromium)')
  process.exit(1)
}

const ws = new WebSocket(await brw.seite())
await new Promise((r, x) => {
  ws.on('open', r)
  ws.on('error', x)
})
let id = 0
const offen = new Map()
ws.on('message', (d) => {
  const n = JSON.parse(d)
  if (n.id && offen.has(n.id)) {
    offen.get(n.id)(n)
    offen.delete(n.id)
  }
})
const rufen = (method, params = {}) =>
  new Promise((f) => {
    const meine = ++id
    offen.set(meine, f)
    ws.send(JSON.stringify({ id: meine, method, params }))
  })
const ev = async (ausdruck) => {
  const a = await rufen('Runtime.evaluate', { expression: ausdruck, returnByValue: true, awaitPromise: true })
  return a?.result?.result?.value
}

try {
  await rufen('Page.enable')
  await rufen('Runtime.enable')
  await rufen('Page.navigate', { url: ZIEL })
  await warte(2500)

  console.log(`Fach „Plugins" gegen ${ZIEL}\n`)

  await adminAuf(ev, { warteMs: 1100 })
  await warte(600)

  // Die Rechenaufgabe, falls eine Sperre davorsteht. Sie wird GELESEN und
  // nicht aus dem Zustand genommen — dass sie dasteht, ist Teil der Sperre.
  const frage = await ev(`(document.getElementById('tor-frage')||{}).textContent || ''`)
  const m = String(frage).match(/(\d+)\s*×\s*(\d+)/)
  if (m) {
    for (const z of String(Number(m[1]) * Number(m[2])))
      await ev(`document.querySelector('#tor-feld [data-taste="${z}"]').click()`)
    await ev(`document.querySelector('#tor-feld .tor-weiter').click()`)
    await warte(900)
  }

  const drin = await ev(`!document.getElementById('eltern').hidden`)
  ja('das Admin-Menue geht auf', drin === true, drin ? '' : 'es bleibt zu')
  if (!drin) throw new Error('ohne Bereich keine Messung')

  // Gruppe „System"
  await ev(`document.querySelector('#eltern-faecher [data-fach="system"]').click()`)
  await warte(800)

  const uebersicht = await ev(`(() => {
    const z = [...document.querySelectorAll('#fach-zeilen .fach-zeile')]
    return z.map((e) => ({
      name: (e.querySelector('.zeile-name')||{}).textContent || '',
      unter: (e.querySelector('.zeile-unter')||{}).textContent || '',
    }))
  })()`)

  const namen = (uebersicht || []).map((z) => z.name.trim())
  ja('der Punkt „Plugins" steht in „System"', namen.includes('Plugins'), namen.join(' · '))
  ja(
    '„Weitere Einstellungen" steht NICHT mehr da',
    !namen.some((n) => n.includes('Weitere Einstellungen')),
    namen.some((n) => n.includes('Weitere Einstellungen')) ? 'es steht noch da' : '',
  )

  const zeile = (uebersicht || []).find((z) => z.name.trim() === 'Plugins')
  // EIN ZUSTAND UND NICHT NUR EIN SATZ: „bereit", „nicht geladen" oder eine
  // Anzahl. Steht dort nur eine Beschreibung, muss man aufschlagen, um die
  // einzige Frage beantwortet zu bekommen, die man hier hat.
  ja(
    'seine Unterzeile sagt einen Zustand',
    !!zeile && /bereit|nicht geladen|Erweiterung/.test(zeile.unter),
    zeile ? zeile.unter : '(keine Zeile)',
  )

  // Antippen
  const kopfVorher = await ev(`(document.getElementById('fach-name')||{}).textContent || ''`)
  await ev(`(() => {
    for (const z of document.querySelectorAll('#fach-zeilen .fach-zeile')) {
      const n = (z.querySelector('.zeile-name')||{}).textContent || ''
      if (n.trim() === 'Plugins') {
        const k = z.querySelector('.zeile-tat')
        ;(k || z).click()
        return true
      }
    }
    return false
  })()`)
  await warte(1400)

  const seite = await ev(`(() => ({
    kopf: (document.getElementById('fach-name')||{}).textContent || '',
    unter: (document.getElementById('eltern-unter')||{}).textContent || '',
    text: (document.getElementById('fach-zeilen')||{}).innerText || '',
    zeilen: [...document.querySelectorAll('#fach-zeilen .fach-zeile')].length,
  }))()`)

  ja(
    'ein Tipp fuehrt auf eine EIGENE Seite',
    seite.kopf === 'Plugins' && seite.kopf !== kopfVorher,
    `Kopf „${seite.kopf}"`,
  )
  ja('die Unterzeile nennt den Ort', /System/.test(seite.unter), seite.unter)

  // Die Plugins dieser Box.
  for (const n of ['Podcast', 'WLED']) {
    ja(`„${n}" steht auf der Seite`, seite.text.includes(n), seite.text.includes(n) ? '' : 'fehlt')
  }

  // Ein Plugin aufschlagen — die zweite Ebene.
  await ev(`(() => {
    const z = document.querySelectorAll('#fach-zeilen .fach-zeile')[1]
    if (!z) return false
    const k = z.querySelector('.zeile-tat')
    ;(k || z).click()
    return true
  })()`)
  await warte(1200)
  const blatt = await ev(`(() => ({
    kopf: (document.getElementById('fach-name')||{}).textContent || '',
    text: (document.getElementById('fach-zeilen')||{}).innerText || '',
  }))()`)
  ja('ein Plugin laesst sich aufschlagen', blatt.kopf !== 'Plugins' && !!blatt.kopf, `Kopf „${blatt.kopf}"`)
  ja(
    'auf dem Blatt stehen seine Felder oder ein Grund',
    /Adresse|Helligkeit|Sichern|braucht nichts/.test(blatt.text),
    blatt.text.split('\n').filter(Boolean).slice(0, 3).join(' · '),
  )

  // ── DER RUECKWEG: EINE EBENE JE TIPP ──────────────────────────────────
  await ev(`document.getElementById('zurueck').click()`)
  await warte(700)
  const nach1 = await ev(`(document.getElementById('fach-name')||{}).textContent || ''`)
  ja('ein Rueckweg fuehrt vom Blatt auf die Liste', nach1 === 'Plugins', `Kopf „${nach1}"`)

  await ev(`document.getElementById('zurueck').click()`)
  await warte(700)
  const nach2 = await ev(`(() => ({
    bereich: !document.getElementById('eltern').hidden,
    kopf: (document.getElementById('fach-name')||{}).textContent || '',
  }))()`)
  ja(
    'noch einer fuehrt auf die Uebersicht — und NICHT aus dem Bereich',
    nach2.bereich === true && nach2.kopf !== 'Plugins',
    `Bereich ${nach2.bereich}, Kopf „${nach2.kopf}"`,
  )
} catch (e) {
  ja('der Lauf kam durch', false, e.message)
} finally {
  ws.close()
  await brw.schliessen?.()
}

console.log(`\n${fehler === 0 ? 'Das Fach steht.' : `${fehler} Beanstandung(en).`}`)
process.exit(fehler === 0 ? 0 : 1)
