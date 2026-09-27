#!/usr/bin/env node
/*
 * DER MAUS-WEG, NACHGEGANGEN — Bilder und Klicks der ARD-Folgen, am echten UI.
 *
 *     node tools/mausweg-schau.mjs --ziel http://192.168.178.57:8200/neu/ [--folge 3]
 *
 * GEMELDET am 19.08.2026, woertlich: „ard sounds läd immernoch nicht korrekt
 * die bilder bzw MausZoom hat nur das erste Bild. Es kommt nur ein cover bild
 * auch das klicken auf andere titel klappt nicht es kommt immer das erste."
 *
 * WAS VOR DIESEM WERKZEUG SCHON GEMESSEN IST (Server, 19.08.):
 *   /api/werke/ard:10378841/inhalt  60 Folgen, 60 VERSCHIEDENE Befehle,
 *                                   60 VERSCHIEDENE Bildadressen
 *   /api/bild/<drei ARD-Werke>      drei verschiedene Dateien (md5)
 *   ausgeliefertes app.js           traegt die Reparaturen vom 15.08.
 *
 * Der Server ist also an jeder gemessenen Stelle sauber. Was fehlt, ist der
 * Blick durch die BRILLE DES KINDES: dieselbe Oberflaeche, derselbe Weg
 * (ueber „Die Maus"), echte Beruehrungen — und dann die zwei Fragen:
 *
 *   1. Welche BILDER zeigen die Folgen-Kacheln wirklich (src verschieden?
 *      geladen? naturalWidth > 0?)
 *   2. Welcher BEFEHL geht beim Tipp auf Folge N wirklich hinaus — der der
 *      Folge N, oder der der ersten?
 *
 * KEINE VERMUTUNG IM ERGEBNIS: das Werkzeug sammelt die /player-Anfragen des
 * Browsers (CDP Network) und vergleicht sie ZEICHENWEISE mit dem Befehl, den
 * /inhalt fuer die angetippte Folge nennt.
 *
 * ACHTUNG: Es tippt auf einer ECHTEN Box eine echte Wiedergabe an und stoppt
 * sie danach wieder (/player/current/stop). Kurz Ton ist moeglich.
 */
import process from 'node:process'
import WebSocket from 'ws'

import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'
import { SCHIRM, fingerAufbau, tippen } from './finger.mjs'

const opt = (name, vorgabe) => {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : vorgabe
}
const ZIEL = opt('--ziel', 'http://192.168.178.57:8200/neu/')
const FOLGE = Math.max(2, Number(opt('--folge', '3')) || 3) // nie die erste: die ist der Streitfall
const API = new URL('/api/', ZIEL).toString().replace(/\/$/, '')

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
  const r = await send(ws, 'Runtime.evaluate', {
    expression: ausdruck,
    returnByValue: true,
    awaitPromise: true,
  })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''))
  return r.result?.value
}
const kurz = (s, n = 90) => (String(s ?? '').length > n ? `${String(s).slice(0, n)}…` : String(s ?? ''))
const warte = (ms) => new Promise((f) => setTimeout(f, ms))

async function bisWahr(ws, ausdruck, was, geduldMs = 15000) {
  const bis = Date.now() + geduldMs
  for (;;) {
    const w = await auswerten(ws, ausdruck).catch(() => null)
    if (w) return w
    if (Date.now() > bis) throw new Error(`Zeit um: ${was}`)
    await warte(400)
  }
}

/** Mitte eines Elements, per Suchausdruck im Blatt bestimmt. */
async function mitteVon(ws, sucher, was) {
  const p = await auswerten(
    ws,
    `(() => { const e = ${sucher}; if (!e) return null; e.scrollIntoView({block:'center'});
       const r = e.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2, w: r.width }; })()`,
  )
  if (!p) throw new Error(`nicht gefunden: ${was}`)
  await warte(250) // das scrollIntoView ausklingen lassen
  const q = await auswerten(
    ws,
    `(() => { const e = ${sucher}; const r = e.getBoundingClientRect();
       return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()`,
  )
  return q
}

const leihe = await vorschauLeihen(ZIEL)
const brw = await eigenerBrowser()
if (!brw) {
  console.error('Kein Chromium am Arbeitsrechner gefunden.')
  process.exit(2)
}
const spieler = [] // alle /player-Anfragen des Browsers, in Reihenfolge
let raus = 1
try {
  const liste = await fetch(`http://127.0.0.1:${brw.port}/json`).then((r) => r.json())
  const ws = new WebSocket(liste.find((t) => t.type === 'page').webSocketDebuggerUrl)
  await new Promise((f) => ws.once('open', f))
  await send(ws, 'Page.enable')
  await send(ws, 'Network.enable')
  ws.on('message', (roh) => {
    const d = JSON.parse(roh)
    if (d.method === 'Network.requestWillBeSent') {
      const u = String(d.params?.request?.url || '')
      if (u.includes('/player/')) spieler.push(decodeURIComponent(u.split('/player/')[1] || ''))
    }
  })
  await fingerAufbau(ws, send)
  await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })

  // ── 1. Die Startseite steht ────────────────────────────────────────────────
  await bisWahr(ws, `document.querySelectorAll('[data-spielt],button').length > 5`, 'Startseite')
  await warte(1500)

  // ── 1b. DER ECHTE WEG DES KINDES: die Interpreten-Kachel „Die Maus" ──────
  // Am Schirm gesehen (19.08.2026): MausZoom liegt NICHT als Werkkachel auf
  // der Startseite — dorthin fuehrt die Interpreten-Kachel „Die Maus,
  // 5 Eintraege, ARD Sounds". Genau den Weg meint der Betreiber.
  // Die Reihe kommt NACH der Startseite (eigener /api/interpreten-Abruf) —
  // erst auf die Kachel selbst warten, dann tippen. Der erste Lauf suchte zu
  // frueh und meldete "nicht gefunden", obwohl sie zwei Sekunden spaeter da war.
  await bisWahr(
    ws,
    `[...document.querySelectorAll('button')].some((b) => /^die maus,/i.test(b.getAttribute('aria-label') || ''))`,
    'Interpreten-Reihe mit "Die Maus"',
    20000,
  )
  const dieMaus = await mitteVon(
    ws,
    `[...document.querySelectorAll('button')].find((b) => /^die maus,/i.test(b.getAttribute('aria-label') || ''))`,
    'Interpreten-Kachel "Die Maus"',
  )
  await tippen(ws, send, dieMaus.x, dieMaus.y)
  await warte(1800)

  // ── 1c. SUCHEN: rollen, bis MausZoom im Bild ist ──────────────────────────
  // Die Startseite haelt nicht alles im Blatt; die eine Trefferkachel des
  // ersten Laufs war eine Weiterhoeren-Kachel mit FOLGENtitel. Gerollt wird
  // die Buehne, nicht das Fenster — wie der Daumen es taete.
  for (let runde = 0; runde < 14; runde++) {
    const da = await auswerten(
      ws,
      `[...document.querySelectorAll('button')].some((b) => /mauszoom/i.test((b.getAttribute('aria-label') || '') + (b.textContent || '')))`,
    )
    if (da) break
    await auswerten(ws, `(document.getElementById('buehne') || document.scrollingElement).scrollTop += 260`)
    await warte(350)
  }

  // ── 2. Der Weg des Kindes: das Regal „Die Maus" ───────────────────────────
  // Regale tragen ihren Namen als Text; gesucht wird ueber den Inhalt, nicht
  // ueber Klassennamen — die sind Bauform, der NAME ist die Zusage ans Kind.
  const regal = await auswerten(
    ws,
    `(() => {
       const koepfe = [...document.querySelectorAll('h2,h3,.regal-name,.regal-kopf,b')]
         .filter((e) => /die maus/i.test(e.textContent || ''))
       return koepfe.length ? true : false
     })()`,
  )
  console.log(`Regal "Die Maus" auf der Startseite: ${regal ? 'gefunden' : 'NICHT gefunden (Weg unklar!)'}`)

  // ── 3. Die MausZoom-Kachel und ihre Nachbarn: welche BILDER zeigen sie? ──
  const kachelBilder = await auswerten(
    ws,
    `(() => {
       const alle = [...document.querySelectorAll('button')]
         .filter((b) => /mauszoom|maushörspiel|gute nacht|herzfunk/i.test((b.getAttribute('aria-label') || '') + (b.textContent || '')))
       return alle.slice(0, 6).map((b) => {
         const i = b.querySelector('img')
         return { text: ((b.getAttribute('aria-label') || b.textContent || '')).trim().slice(0, 34),
                  src: i ? i.src : null, geladen: i ? i.naturalWidth > 0 : false }
       })
     })()`,
  )
  console.log('\n── Werk-Kacheln (Regal/Startseite) ──')
  for (const k of kachelBilder) console.log(`  ${k.text.padEnd(30)} geladen=${k.geladen}  src=${kurz(k.src, 70)}`)
  const werkSrcs = kachelBilder.map((k) => k.src).filter(Boolean)
  console.log(`  verschiedene Bildquellen: ${new Set(werkSrcs).size} von ${werkSrcs.length}`)

  // ── 4. MausZoom OEFFNEN (Tipp auf die Kachel = Lane mit Folgen) ───────────
  // WELCHES VERB TRAEGT DIE KACHEL? Die Beschriftung IST schon ein Befund:
  // `sprichDann` haengt ", öffnen" an, wenn der Tipp die Folgen-Lane oeffnet
  // (istArdSendung), und ", abspielen", wenn er spielt. Steht hier
  // "abspielen", ist der Verdrahtungszweig falsch — noch bevor getippt wurde.
  const beschriftungen = await auswerten(
    ws,
    `[...document.querySelectorAll('button')]
       .map((b) => b.getAttribute('aria-label') || '')
       .filter((a) => /mauszoom/i.test(a))`,
  )
  console.log('\n── MausZoom-Beschriftungen in dieser Sicht ──')
  for (const b of beschriftungen) console.log(`  ${kurz(b, 80)}`)

  const mz = await mitteVon(
    ws,
    `[...document.querySelectorAll('button')].find((b) => {
       const a = b.getAttribute('aria-label') || ''
       return /mauszoom/i.test(a) && !/weiterhören\s*$/i.test(a)
     })`,
    'MausZoom-WERK-Kachel',
  )
  spieler.length = 0
  await tippen(ws, send, mz.x, mz.y)

  // ZWEI MOEGLICHE AUSGAENGE, und GENAU DAS ist die Messfrage: geht die
  // Folgen-Lane auf (richtig) — oder faengt die Box an zu SPIELEN (der
  // gemeldete Fehler: Tipp startet Folge 1 statt zu oeffnen)?
  let ausgang = 'nichts'
  for (let t = 0; t < 30; t++) {
    const lane = await auswerten(ws, `document.querySelectorAll('.lane-kachel.stueck').length`)
    if (lane > 3) { ausgang = 'lane'; break }
    if (spieler.some((s) => s.startsWith('ard/'))) { ausgang = 'spielt' }
    if (ausgang === 'spielt' && t > 8) break
    await warte(400)
  }
  console.log(`\n── Tipp auf die MausZoom-Kachel → Ausgang: ${ausgang.toUpperCase()} ──`)
  if (ausgang === 'spielt') {
    console.log('  DER GEMELDETE FEHLER: der Tipp SPIELT statt zu oeffnen. Erste /player-Anfragen:')
    for (const s of spieler.slice(0, 4)) console.log(`    ${kurz(s)}`)
  }
  if (ausgang !== 'lane') {
    console.log('  (ohne Lane enden die Bild- und Klickmessungen der Folgen hier)')
    process.exitCode = 1
  }
  if (ausgang === 'lane') await warte(1200) // lazy-Bilder nachladen lassen
  if (ausgang !== 'lane') throw new Error('Lane ging nicht auf — Ausgang: ' + ausgang)

  // ── 5. Die Bilder der Folgen ──────────────────────────────────────────────
  const folgen = await auswerten(
    ws,
    `[...document.querySelectorAll('.lane-kachel.stueck')].slice(0, 8).map((k) => {
       const i = k.querySelector('img')
       return { titel: (k.querySelector('.lane-titel')?.textContent || '').slice(0, 34),
                src: i ? i.src : null, geladen: i ? i.naturalWidth > 0 : false }
     })`,
  )
  console.log('\n── Folgen-Kacheln in der Lane ──')
  for (const f of folgen) console.log(`  ${String(f.titel).padEnd(36)} geladen=${f.geladen}  src=${kurz(f.src, 60)}`)
  const fSrcs = folgen.map((f) => f.src).filter(Boolean)
  console.log(`  verschiedene Bildquellen: ${new Set(fSrcs).size} von ${folgen.length}  geladen: ${folgen.filter((f) => f.geladen).length}`)

  // ── 6. Was SOLL Folge N spielen? (der Massstab, vom Server geholt) ───────
  const inhalt = await fetch(`${API}/werke/${encodeURIComponent('ard:10378841')}/inhalt`).then((r) => r.json())
  const soll = decodeURIComponent(String(inhalt?.titel?.[FOLGE - 1]?.befehl || ''))
  console.log(`\n── Tipp auf Folge ${FOLGE}: "${kurz(inhalt?.titel?.[FOLGE - 1]?.titel, 40)}" ──`)
  console.log(`  SOLL:  ${kurz(soll)}`)

  // ── 7. Der Tipp — und was WIRKLICH hinausgeht ────────────────────────────
  spieler.length = 0
  const fk = await mitteVon(
    ws,
    `document.querySelectorAll('.lane-kachel.stueck')[${FOLGE - 1}]`,
    `Folgen-Kachel ${FOLGE}`,
  )
  await tippen(ws, send, fk.x, fk.y)
  await warte(6000) // albumSpielen + Sprung brauchen einen Moment

  console.log('  IST (alle /player-Anfragen nach dem Tipp):')
  for (const s of spieler.slice(0, 8)) console.log(`    ${kurz(s)}`)
  const ard = spieler.filter((s) => s.startsWith('ard/'))
  const erster = decodeURIComponent(String(inhalt?.titel?.[0]?.befehl || '')).replace(/^ard\//, '')
  const getroffen = ard.some((s) => s.replace(/^ard\//, '').startsWith(soll.replace(/^ard\//, '').slice(0, 60)))
  const nurErster = ard.length && ard.every((s) => s.replace(/^ard\//, '').startsWith(erster.slice(0, 60)))
  const sprung = spieler.find((s) => /tracknr:|titelnr|track\//.test(s))
  console.log(`\n── URTEIL ──`)
  console.log(`  Folge-${FOLGE}-Befehl ging hinaus: ${getroffen ? 'JA' : 'NEIN'}`)
  console.log(`  nur Folge-1-Befehl:            ${nurErster ? 'JA (der gemeldete Fehler)' : 'nein'}`)
  if (sprung) console.log(`  Sprungbefehl gesehen:          ${kurz(sprung, 70)}`)
  raus = getroffen || sprung ? 0 : 1
} finally {
  // Nichts weiterspielen lassen: der Test hat eine echte Wiedergabe angetippt.
  await fetch(new URL('/player/current/stop', ZIEL)).catch(() => null)
  await brw?.schliessen()
  await leihe.zurueckgeben()
}
process.exit(raus)
