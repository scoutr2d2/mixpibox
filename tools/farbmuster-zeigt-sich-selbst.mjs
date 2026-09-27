#!/usr/bin/env node
/**
 * ZEIGT JEDES FARBMUSTER SEINEN EIGENEN SATZ — auch das der Vorgabe?
 *
 * ══ DIE FRAGE ══════════════════════════════════════════════════════════════
 *
 * Im Admin-Menue unter „Darstellung > Farbe und Form" stehen neun Muster
 * nebeneinander. Jedes zeigt drei Streifen — Grund, Flaeche, Schrift — und
 * verspricht damit: „so sieht die Box aus, wenn du mich waehlst."
 *
 * EIN MUSTER, DAS STATTDESSEN DEN GERADE EINGESTELLTEN SATZ ZEIGT, IST EINE
 * ATTRAPPE. Man tippt Creme an, weil das Muster cremefarben aussieht, und
 * bekommt etwas anderes. Schlimmer noch: solange man ohnehin auf Creme steht,
 * stimmt es zufaellig — der Fehler zeigt sich also NUR dann, wenn man ihn
 * gerade nicht sucht.
 *
 * ══ WARUM DAS NICHT AM STILBLATT ABZULESEN IST ═════════════════════════════
 *
 * Acht der neun Muster tragen `data-farbe` und treffen damit einen eigenen
 * Block. Das fuenfte (die Vorgabe) traegt keines — und dann entscheidet nicht
 * die Spezifitaet, sondern die VERERBUNG: eine Erklaerung, die direkt auf dem
 * Element steht, schlaegt jeden geerbten Wert, egal wie spezifisch dessen
 * Wahler war. Wer das im Kopf nachrechnet, rechnet es einmal richtig und
 * einmal falsch. Der Browser rechnet es immer gleich.
 *
 * ══ WAS BEHAUPTET WIRD ═════════════════════════════════════════════════════
 *   1. Jedes der neun Muster zeigt SEINE Palette — gemessen an den drei
 *      Streifen, in ALLEN fuenf Einstellungen und hell wie dunkel.
 *      Das sind 9 Muster x 9 Einstellungen x 2 Staende = 162 Vergleiche.
 *   2. Und das gilt besonders fuer das Muster der VORGABE, denn nur dieses
 *      haengt an der Vererbung.
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * Nichts an einer Datei und NICHTS AN EINER BOX. Eigener Browser, eigener
 * localStorage.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/farbmuster-zeigt-sich-selbst.mjs --ziel http://127.0.0.1:9722/neu/
 * ENDE 0, wenn jedes Muster sich selbst zeigt.
 */
import WebSocket from 'ws'
import { adminAuf } from './admin-weg.mjs'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'
import { SAETZE, palette } from './farbsaetze-bauen.mjs'

const argv = process.argv.slice(2)
const opt = (n) => {
  const i = argv.indexOf(`--${n}`)
  return i < 0 ? null : argv[i + 1]
}
const ZIEL = opt('ziel') || argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

let fehler = 0
const ja = (gut, satz, dazu = '') => {
  if (!gut) fehler++
  console.log(`${gut ? 'ok  ' : 'NEIN'}  ${satz}${dazu ? `  — ${dazu}` : ''}`)
}

/* Die drei Baender eines Musters und die Palettenrolle, die sie zeigen.
 *
 * ES WAREN GRUND, FLAECHE UND SCHRIFT — bis zum 08.08.2026. Im HELLEN Satz
 * sagten zwei davon nichts: `--surface` ist bei allen Paletten dasselbe
 * Weiss (ΔE 0,0), und `--bg` unterscheidet sich im schlechtesten Paar um 2,5.
 * Uebrig blieb ein fast schwarzer Balken auf acht Prozent der Flaeche — der
 * Betreiber sah "nur schwarze balken". Die ganze Rechnung steht in app.css bei
 * `.farbwahl-hell` und in tools/farbmuster-unterschied.py.
 *
 * DIE PRUEFUNG SELBST BLEIBT DIESELBE: zeigt jedes Muster die Farben SEINES
 * Satzes, oder erbt es die gerade eingestellte Palette? Das war der Fehler,
 * wegen dem es dieses Werkzeug gibt, und er ist von den Baendern unabhaengig. */
const STREIFEN = [
  ['.farbwahl-hell', 'hl'],
  ['.farbwahl-mitte', 'muted'],
  ['.farbwahl-grund', 'bg'],
]

console.log('══ ZEIGT JEDES FARBMUSTER SEINEN EIGENEN SATZ ════════════════')
console.log(`   Vorschau: ${ZIEL}`)

const geliehen = await vorschauLeihen(ZIEL).catch(() => null)
const browser = await eigenerBrowser({ fenster: '800,480' })
if (!browser) {
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}
let ws = null
try {
  ws = new WebSocket(await browser.seite())
  await new Promise((r) => ws.on('open', r))
  let nr = 0
  const offen = new Map()
  ws.on('message', (d) => {
    const m = JSON.parse(d)
    if (m.id && offen.has(m.id)) {
      offen.get(m.id)(m.result)
      offen.delete(m.id)
    }
  })
  const send = (methode, params = {}) =>
    new Promise((r) => {
      const id = ++nr
      offen.set(id, r)
      ws.send(JSON.stringify({ id, method: methode, params }))
    })
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })
  const ev = async (e) =>
    (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.value

  await fetch(new URL('/vorschau/sperre-aus', ZIEL)).catch(() => null)
  await send('Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
  await warte(1800)

  /* Auf die Seite „Farbe und Form". */
  await adminAuf(ev, { warteMs: 1100, pruefen: false })
  await warte(300)
  await ev('(() => { const k = document.querySelector(\'#eltern-faecher [data-fach="anzeige"]\'); if (k) k.click() })()')
  await warte(600)
  const dort = await ev(
    '(() => { for (const z of document.querySelectorAll("#fach-zeilen .fach-zeile")) {' +
      ' const n = z.querySelector(".zeile-name");' +
      ' if (n && n.textContent.trim() === "Farbe und Form") { (z.querySelector(".zeile-tat") || z).click(); return true } }' +
      ' return false })()',
  )
  await warte(700)
  ja(dort === true, 'die Seite „Farbe und Form" laesst sich oeffnen')

  const namen = SAETZE.map((s) => s.id)
  for (const licht of ['hell', 'dunkel']) {
    for (const eingestellt of namen) {
      /* Den Satz ueber den KNOPF stellen, nicht ueber das Attribut — so, wie
         es ein Mensch tut, und damit laeuft `farbeSetzen` wirklich mit. */
      const gestellt = await ev(
        '(() => { const k = [...document.querySelectorAll(".farbwahl-muster")]' +
          '.find((x) => (x.querySelector(".farbwahl-name") || {}).textContent === ' +
          JSON.stringify(SAETZE.find((s) => s.id === eingestellt).wort) +
          '); if (!k) return false; k.click(); return true })()',
      )
      if (gestellt !== true) {
        ja(false, `der Knopf fuer „${eingestellt}" steht da`)
        continue
      }
      await ev(
        '(() => { const w = document.documentElement;' +
          (licht === 'dunkel' ? ' w.setAttribute("data-licht", "dunkel");' : ' w.removeAttribute("data-licht");') +
          ' return true })()',
      )
      await warte(220)

      const gemessen = await ev(
        '(() => { const aus = {};' +
          ' for (const k of document.querySelectorAll(".farbwahl-muster")) {' +
          '   const n = (k.querySelector(".farbwahl-name") || {}).textContent;' +
          '   const e = {};' +
          '   for (const w of ' +
          JSON.stringify(STREIFEN.map((s) => s[0])) +
          ') { const s = k.querySelector(w); e[w] = s ? getComputedStyle(s).backgroundColor : null }' +
          '   aus[n] = e } return aus })()',
      )

      for (const s of SAETZE) {
        const soll = palette(s.id, licht)
        const hat = gemessen && gemessen[s.wort]
        if (!hat) {
          ja(false, `Muster „${s.wort}" steht da (${licht}, eingestellt: ${eingestellt})`)
          continue
        }
        for (const [wahl, rolle] of STREIFEN) {
          const ist = hex(hat[wahl])
          const erwartet = soll[rolle].hex.toUpperCase()
          ja(
            ist === erwartet,
            `${licht.padEnd(6)} eingestellt ${eingestellt.padEnd(6)} — Muster „${s.wort}" zeigt ${rolle}`,
            ist === erwartet ? '' : `${ist} statt ${erwartet}`,
          )
        }
      }
    }
  }
} finally {
  if (ws) ws.close()
  if (browser) await browser.schliessen()
  if (geliehen) await geliehen.zurueckgeben().catch(() => null)
}

function hex(s) {
  const m = String(s).match(/[\d.]+/g)
  if (!m) return String(s)
  return (
    '#' +
    m
      .slice(0, 3)
      .map((x) => Math.round(Number(x)).toString(16).padStart(2, '0').toUpperCase())
      .join('')
  )
}

console.log(`\n${fehler ? `${fehler} Abweichungen` : 'alles haelt'}`)
process.exit(fehler ? 1 : 0)
