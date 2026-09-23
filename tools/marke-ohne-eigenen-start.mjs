#!/usr/bin/env node
/**
 * SITZT DIE MARKE AUCH DANN, WENN DIESE SEITE DEN TON NICHT SELBST GESTARTET HAT?
 *
 * ══ WOZU, UND WARUM NEBEN DEN VIER VORHANDENEN MARKEN-WERKZEUGEN ═══════════
 *
 * F2 hat die Marke auf mpv-Folgenkacheln gebracht (llmwiki
 * [[f2-marke-bei-mpv-und-im-bild]]). Die dritte Kennungsform `folge|<s>|<id>`
 * zaehlt ueber `laufendeFolgen` — die Liste, die `albumSpielen` beim Start
 * ABLEGT. Damit haengt die Marke an einer Auskunft, die NUR IM ARBEITSSPEICHER
 * DIESER SEITE steht.
 *
 * Alle vorhandenen Werkzeuge starten den Ton selbst und messen danach:
 *   marke-titelwechsel-je-dienst.mjs   startet, klappt auf, wechselt den Titel
 *   marke-beim-aufklappen.mjs          startet, klappt auf, misst die Lage
 *   lane-marke-wandert.mjs             der Spotify-Weg
 *   raster-marke-schau.mjs             ob sich die Marke bewegt
 * Keines fragt, was passiert, wenn die Seite den Start NICHT miterlebt hat.
 *
 * DAS IST KEIN Randfall, sondern der Alltag der Box:
 *   * Der Kiosk-Browser laedt beim Einschalten neu, waehrend mpv weiterlaeuft
 *     (die Wiedergabe ueberlebt einen Neustart der Oberflaeche, nicht des
 *     Abspielers).
 *   * Ein zweites Geraet (Telefon, klassische Oberflaeche) startet dasselbe
 *     Werk — dann laeuft es, und diese Seite hat nie eine Liste angelegt.
 *   * `starte()` (Ein-Befehl-Start) setzt `laufendeFolgen` ausdruecklich auf
 *     null.
 * Dieselbe Fehlerklasse wie llmwiki [[flip-liste-nach-neuladen-ohne-bezug]]:
 * eine Auskunft, die nur im Speicher steht, ist nach dem naechsten Laden weg —
 * und die Oberflaeche sieht danach genauso aus wie vor der Reparatur.
 *
 * ══ DREI FAELLE, UND DER ERSTE IST DIE GEGENPROBE ══════════════════════════
 *   1 EIGENER START    ueber den Play-Knopf der Raster-Kachel. MUSS eine Marke
 *                      ergeben — sonst misst dieses Werkzeug nichts.
 *   2 NACH NEULADEN    dieselbe Wiedergabe, die Seite frisch geladen.
 *   3 FOLGE ANGETIPPT  die Lane vor dem Start aufgeklappt und eine Folgenkachel
 *                      getippt (`ardSendungAb`) — der zweite Weg zum Ton.
 *
 * GEZAEHLT WIRD ZWEIERLEI, UND DER UNTERSCHIED IST DER BEFUND:
 *   Kacheln MIT `data-spielt`   der TRAEGER — haengt an der Liste des Servers
 *   Kacheln MIT `.spielt`       die WIRKUNG — haengt an `laufendeFolgen`
 * Traeger da und Wirkung weg heisst: die Kennung stimmt, verglichen wird gegen
 * nichts.
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * Nichts. Eigener headless-Browser gegen tools/neu-vorschau.mjs; eine fremde
 * Vorschau wird geliehen und ihre Lage im `finally` zurueckgelegt. Die Box wird
 * nicht angefasst.
 *
 * AUFRUF
 *     node tools/marke-ohne-eigenen-start.mjs
 *     node tools/marke-ohne-eigenen-start.mjs --pruefen   # Ende 1, wenn Fall 1
 *                                                         # keine Marke ergibt
 */
import WebSocket from 'ws'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const argv = process.argv.slice(2)
const ZIEL = argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const PRUEFEN = argv.includes('--pruefen')

const warte = (ms) => new Promise((r) => setTimeout(r, ms))

const leihe = await vorschauLeihen(ZIEL)
const brw = await eigenerBrowser()
if (!brw) {
  console.log('  kein Browser gefunden — uebersprungen')
  await leihe.zurueckgeben()
  process.exit(0)
}

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

const zeilen = []
let fehler = 0
try {
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })

  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value
  const stellen = async (was) => {
    await fetch(new URL(`/vorschau/${was}`, ZIEL)).catch(() => null)
    await warte(150)
  }
  const warteAuf = async (e, ms = 9000) => {
    const bis = Date.now() + ms
    while (Date.now() < bis) {
      if (await ev(e)) return true
      await warte(150)
    }
    return false
  }
  const neuLaden = async () => {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warteAuf(`!!document.getElementById('zustand')`)
    await warte(800)
  }
  /** Die ARD-Kachel im Raster — an ihrem eigenen Play-Knopf zu erkennen. */
  const ARD = `[...document.querySelectorAll('#raster .kachel')].find((x) => (x.getAttribute('aria-label') || '').includes('MausHörspiel'))`
  const starten = async () => {
    await warteAuf(`document.getElementById('raster').children.length > 0`)
    const r = await ev(`(() => {
      const k = ${ARD}
      if (!k) return 'keine ARD-Kachel'
      const s = k.querySelector('.tipp-spiel')
      if (!s) return 'kein Play-Knopf'
      s.click(); return 'ok' })()`)
    if (r !== 'ok') throw new Error(`Start: ${r}`)
    if (!(await warteAuf(`!document.getElementById('mp').hidden`))) throw new Error('der Mini-Player kam nicht')
  }
  const aufklappen = async () => {
    const r = await ev(`(() => { const k = ${ARD}; if (!k) return 'keine ARD-Kachel'; k.click(); return 'ok' })()`)
    if (r !== 'ok') throw new Error(`Aufklappen: ${r}`)
    if (!(await warteAuf(`document.querySelectorAll('.lane-kachel.stueck').length > 0`)))
      throw new Error('die Folgen-Lane kam nicht')
    await warte(900)
  }
  const zaehlen = async () =>
    await ev(`(() => {
      const alle = [...document.querySelectorAll('.lane-kachel.stueck')]
      const m = alle.filter((k) => k.dataset.spielt)
      const s = alle.filter((k) => k.classList.contains('spielt'))
      // DIE RUNDEN INTERPRETEN-KACHELN ZAEHLEN MIT (12.09.2026): sie tragen
      // seit demselben Tag data-spielt (interpretKachel, app.js), und der
      // Rahmen am Kreis haengt an '.spielt .leute-bild::before'. Der
      // animationName sagt, ob die CSS-Seite wirklich verdrahtet ist — eine
      // markierte Kachel ohne Rahmenregel saehe im Zaehler gruen aus.
      const leute = [...document.querySelectorAll('.leute-kachel')]
      const leuteS = leute.filter((k) => k.classList.contains('spielt'))
      const leuteBild = leuteS[0] ? leuteS[0].querySelector('.leute-bild') : null
      return {
        kacheln: alle.length,
        traeger: m.length,
        markiert: s.length,
        wo: s.length ? alle.indexOf(s[0]) : -1,
        zeichen: !!document.querySelector('.lane-kachel.stueck.spielt .spielt-marke'),
        raster: [...document.querySelectorAll('#raster .kachel.spielt')].length,
        leute: leute.length,
        leuteTraeger: leute.filter((k) => k.dataset.spielt).length,
        leuteMarkiert: leuteS.length,
        leuteWer: leuteS[0] ? (leuteS[0].querySelector('.leute-name') || {}).textContent || '' : '',
        leuteRahmen: leuteBild ? getComputedStyle(leuteBild, '::before').animationName : '',
      } })()`)

  const melden = (fall, d, erwartet) => {
    const gut = erwartet === 'marke' ? d.markiert === 1 : true
    zeilen.push({ fall, ...d, gut })
    console.log(`\n══ ${fall}`)
    console.log(`  Folgenkacheln                ${d.kacheln}`)
    console.log(`  davon mit data-spielt        ${d.traeger}   (der TRAEGER)`)
    console.log(`  davon markiert (.spielt)     ${d.markiert}   (die WIRKUNG)${d.markiert ? `, Platz ${d.wo}` : ''}`)
    console.log(`  Zeichen eingehaengt          ${d.zeichen ? 'ja' : 'nein'}`)
    console.log(`  Raster-Marke                 ${d.raster ? 'steht' : '— keine —'}`)
    if (d.leute) {
      console.log(
        `  Interpreten-Kreise           ${d.leute}, Traeger ${d.leuteTraeger}, markiert ${d.leuteMarkiert}${d.leuteWer ? ` („${d.leuteWer.trim()}", Rahmen: ${d.leuteRahmen || '—'})` : ''}`,
      )
    }
    if (erwartet === 'marke' && !gut) console.log(`  BEFUND                       erwartet war GENAU EINE Marke`)
  }

  // ── 1. EIGENER START — die Gegenprobe ────────────────────────────────────
  await stellen('voll')
  await stellen('spielt')
  await stellen('mpv-eigen')
  await stellen('mpv-erste')
  await neuLaden()
  await starten()
  await aufklappen()
  const f1 = await zaehlen()
  melden('1. EIGENER START (Play-Knopf der Raster-Kachel)', f1, 'marke')
  if (f1.markiert !== 1) fehler++

  // ── 2. NACH DEM NEULADEN — mpv spielt unveraendert weiter ────────────────
  await neuLaden()
  await warteAuf(`!document.getElementById('mp').hidden`)
  await aufklappen()
  const f2 = await zaehlen()
  melden('2. NACH DEM NEULADEN (dieselbe Wiedergabe, frische Seite)', f2, 'offen')

  // ── 3. DIE FOLGENKACHEL SELBST ANGETIPPT ────────────────────────────────
  await stellen('voll')
  await stellen('spielt')
  await stellen('mpv-eigen')
  await stellen('mpv-erste')
  await neuLaden()
  await aufklappen()
  const getippt = await ev(`(() => {
    const a = [...document.querySelectorAll('.lane-kachel.stueck')]
    if (a.length < 3) return 'zu wenige Folgen'
    a[2].click(); return 'ok' })()`)
  if (getippt !== 'ok') throw new Error(`Folge antippen: ${getippt}`)
  await warte(2500)
  const f3 = await zaehlen()
  melden('3. FOLGENKACHEL ANGETIPPT (ardSendungAb, ohne Raster-Play)', f3, 'offen')

  // ── 4. LOKALES ALBUM, NUR DER SERVER KENNT DEN TITEL ────────────────────
  //
  // Der Fall, an dem „von lokal geht es nicht" wirklich hing (12.09.2026),
  // und er hat ZWEI Zaehne, die die ARD-Faelle oben beide nicht haben:
  //
  //   * Die Titelkennung ist ein DATEIPFAD MIT LEERZEICHEN („…/WDR/Die
  //     Maus#3"). `data-spielt` ist eine leerzeichengetrennte Liste — ohne
  //     die Kodierung in `kennungsWort` (app.js) zerbricht genau diese
  //     Kennung beim split in Fragmente, und die Schnittmenge trifft NIE.
  //     ARD-Kennungen (`1660000N`) koennen das nicht zeigen; eine Sabotage
  //     an `kennungsWort` liess die Faelle oben allesamt gruen.
  //   * Die Seite hat NICHTS gestartet (frisch geladen): die Zuordnung kommt
  //     allein aus dem Start-Gedaechtnis des Servers (`laeuft` an
  //     /player/local, laufendes-werk.ts) — nicht aus `laufendeFolgen`.
  //
  // Unter der Lage `spielt` laeuft in der Vorschau seit jeher „Die Maus"
  // (lokal, vorschau:0); `mpv-erste` stellt Titel 1. Erwartet: nach dem
  // Aufklappen traegt GENAU die erste Titelkachel die Marke.
  await stellen('voll')
  await stellen('spielt')
  await stellen('mpv-eigen')
  await stellen('mpv-erste')
  // Fall 3 hat der Attrappe einen ARD-Start ins Gedaechtnis gelegt; hier
  // laeuft wieder der Grundzustand („Die Maus", lokal). Ausdruecklich
  // zurueckstellen — Begruendung am Schalter in neu-vorschau.mjs.
  await stellen('gestartet-grund')
  await neuLaden()
  const MAUS = `[...document.querySelectorAll('#raster .kachel')].find((x) => (x.getAttribute('aria-label') || '').startsWith('Die Maus'))`
  const auf4 = await ev(`(() => { const k = ${MAUS}; if (!k) return 'keine Maus-Kachel'; k.click(); return 'ok' })()`)
  if (auf4 !== 'ok') throw new Error(`Aufklappen (lokal): ${auf4}`)
  if (!(await warteAuf(`document.querySelectorAll('.lane-kachel.stueck').length > 0`)))
    throw new Error('die Titel-Lane des lokalen Albums kam nicht')
  await warte(900)
  const f4 = await zaehlen()
  melden('4. LOKALES ALBUM AUFGEKLAPPT (Kennung mit Leerzeichen, nur der Server weiss es)', f4, 'marke')
  if (f4.markiert !== 1) fehler++
  else if (f4.wo !== 0) {
    console.log(`  BEFUND                       markiert ist Platz ${f4.wo}, laufen tut Titel 1`)
    fehler++
  }
  // UND DER INTERPRETEN-KREIS: „Die Maus" gehoert WDR, die Reihe fuehrt ihn
  // (Attrappe: /api/interpreten, schluessel 'wdr', Werke ['vorschau:0']).
  // Erwartet: GENAU dieser eine Kreis markiert, und sein Rahmen ist die
  // Rahmen-Animation — nicht bloss eine Klasse ohne Regel.
  if (f4.leuteMarkiert !== 1 || f4.leuteWer.trim() !== 'WDR') {
    console.log(`  BEFUND                       Interpreten-Kreis: markiert ${f4.leuteMarkiert} („${f4.leuteWer.trim()}"), erwartet genau „WDR"`)
    fehler++
  } else if (f4.leuteRahmen !== 'cover-rahmen-lauf') {
    console.log(`  BEFUND                       der markierte Kreis traegt keinen laufenden Rahmen (animationName: ${f4.leuteRahmen || '—'})`)
    fehler++
  }
} catch (f) {
  console.error(`  FEHLER  ${(f && f.message) || f}`)
  fehler++
} finally {
  await brw.schliessen()
  await leihe.zurueckgeben()
}

console.log('')
for (const z of zeilen) {
  console.log(
    `  ${z.markiert === 1 ? 'MARKE  ' : 'KEINE  '} Traeger ${z.traeger}/${z.kacheln}, markiert ${z.markiert}  —  ${z.fall}`,
  )
}
process.exit(PRUEFEN && fehler ? 1 : 0)
