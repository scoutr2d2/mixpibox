#!/usr/bin/env node
/**
 * DIE WAHLLEISTE (F6) NACHGEMESSEN — und zwar die Frage, die der Bau NICHT
 * beantwortet hat: NIMMT SIE ETWAS WEG, DAS VORHER ZU SEHEN WAR?
 *
 * ══ WARUM NOCH EIN WERKZEUG ════════════════════════════════════════════════
 * Der Browserlauf zu F6 (tools/e2e/neu-oberflaeche.test.mjs) misst die beiden
 * Knoepfe gegen sich selbst: gleiche Oberkante, gleiche Hoehe, 12 px Luecke,
 * je >= 64 px. Alles richtig — und alles ueber die Leiste selbst. Die Leiste
 * steht aber IM FLUSS der aufgeklappten Titel-Lane und schiebt damit alles,
 * was unter ihr liegt, um ihre eigene Hoehe nach unten. Auf 480 px Schirm ist
 * das kein Nebeneffekt, sondern die eigentliche Frage:
 *
 *   * Steht das COVER des Albums danach noch ganz im Bild?
 *     (Ausdruecklicher Wunsch: „das Cover soll ganz sichtbar bleiben.")
 *   * Welche Titelkacheln waren OHNE die Leiste im Bild und sind es MIT ihr
 *     nicht mehr?
 *
 * ══ WIE GEMESSEN WIRD ══════════════════════════════════════════════════════
 * ZWEI VOLLE DURCHGAENGE, nicht ein Eingriff am fertigen Baum. Im zweiten
 * wird `.lane-wahl` VOR dem Aufklappen auf `display:none` gesetzt — derselbe
 * Code baut sie, sie nimmt nur keinen Platz. Das ist der Zustand von vor F6.
 *
 * WARUM NICHT EINFACH HERAUSNEHMEN, WENN SIE SCHON DASTEHT: Die Lane rollt
 * sich beim Aufklappen SELBST ins Bild (`laneInsBild`), und die Rechnung dort
 * haengt an ihrer HOEHE. Wer nachtraeglich entfernt, misst einen Rollstand,
 * den es so nie gibt — im ersten Anlauf bewegten sich die Zahlen dadurch in
 * zwei Richtungen zugleich und waren wertlos.
 *
 * GESCHNITTEN WIRD GEGEN DIE BUEHNE, nicht gegen das Fenster: oben sitzt die
 * Kopfleiste, unten der Mini-Player. Gegen `innerHeight` gerechnet bekommt
 * eine Kachel, die halb unter der Kopfleiste steckt, brav „100 % im Bild".
 *
 * GETASTET, NICHT GERECHNET — wie in tools/beruehrziele-neu.mjs. Ein Ziel,
 * das im Rechteck steht und trotzdem nicht getroffen wird, liegt unter einer
 * fremden Ebene; das sieht keine Zahl aus dem Stilblatt.
 *
 * Millimeter: 800x480 auf 5 Zoll = 0,14 mm je Bildpunkt, Marke 9 mm
 * (ISO 9241-411) = 64,3 px.
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * Nichts. Eigener headless-Browser gegen tools/neu-vorschau.mjs. Die Box wird
 * nicht angefasst.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *     node tools/f6-wahlleiste-nachmessen.mjs
 *     node tools/f6-wahlleiste-nachmessen.mjs --bild /tmp/f6   je Lage ein PNG
 */
import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import WebSocket from 'ws'
import { eigenerBrowser } from './leihgabe.mjs'

const argv = process.argv.slice(2)
const optWert = (n) => {
  const i = argv.indexOf(`--${n}`)
  if (i < 0) return null
  const w = argv[i + 1]
  return w && !w.startsWith('--') ? w : true
}
const BILD = optWert('bild')
const ZIEL = 'http://127.0.0.1:8299/neu/'
const MM_JE_PIXEL = 0.14
const MARKE_PX = 9 / MM_JE_PIXEL
const mmS = (px) => (px * MM_JE_PIXEL).toFixed(2)

// Browser GELIEHEN ueber eigenerBrowser() (tools/leihgabe.mjs): freier Port
// statt der festen 9366, eigenes Profil, Eigentumsnachweis.
const brw = await eigenerBrowser()
if (!brw) {
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}

// Eine schon laufende Vorschau gehoert jemand anderem und wird nicht angefasst.
let vorschau = null
try {
  await fetch(new URL('/api/werke', ZIEL), { signal: AbortSignal.timeout(1500) })
} catch {
  vorschau = spawn(process.execPath, ['tools/neu-vorschau.mjs'], { stdio: 'ignore' })
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 300))
    try {
      await fetch(new URL('/api/werke', ZIEL), { signal: AbortSignal.timeout(1000) })
      break
    } catch {
      /* noch nicht da */
    }
  }
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
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Die Lage herstellen: die Titel-Lane DES Albums, zu dem eine Stelle gemerkt
 * ist. Nicht „irgendein Album" — die Attrappe haengt die Stelle an genau eines,
 * und es steckt hinter einer Regal-Kachel. Wer die erste beste Kachel nimmt,
 * findet keine Wahlleiste und haelt das fuer ein Ergebnis.
 */
const HINFINDEN_JS = String.raw`(async () => {
  const warte = (ms) => new Promise(r => setTimeout(r, ms))
  const ALBEN = '.lane .lane-kachel:not(.stueck)'
  const blauesAlbum = () => document.querySelector(ALBEN + ' .tipp-spiel.weiter')
  const warteAufLane = async () => {
    for (let n = 0; n < 20; n++) {
      await warte(150)
      if (blauesAlbum()) return 'blau'
      if (document.querySelector(ALBEN)) return 'da'
    }
    return 'nichts'
  }
  const imRaster = async () => {
    const k = [...document.querySelectorAll('#raster .kachel')].filter(x => x.querySelector('.tipp-spiel'))
    for (const kachel of k) {
      kachel.click()
      const stand = await warteAufLane()
      if (stand === 'blau') return true
      kachel.click()
      await warte(150)
    }
    return false
  }
  const oeffne = () => { blauesAlbum().closest('.lane-kachel').click() }
  if (await imRaster()) { oeffne(); return true }
  const wieViele = document.querySelectorAll('#raster .kachel.regal').length
  for (let i = 0; i < wieViele; i++) {
    const regal = document.querySelectorAll('#raster .kachel.regal')[i]
    if (!regal) continue
    regal.click()
    await warte(500)
    if (await imRaster()) { oeffne(); return true }
    const zu = document.getElementById('zurueck')
    if (zu) zu.click()
    await warte(500)
  }
  return false })()`

/**
 * Was steht wo, und was davon ist WIRKLICH zu sehen bzw. zu treffen.
 *
 * `imBild` ist der Anteil des Rechtecks, der im Sichtfenster liegt — die Zahl,
 * die „unten herausgerollt" von „unter einer fremden Ebene" trennt.
 */
const MESSEN_JS = String.raw`
(() => {
  const trifft = (e, x, y) => {
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false
    const g = document.elementFromPoint(x, y)
    return !!g && (g === e || e.contains(g))
  }
  // GEGEN DIE BUEHNE GESCHNITTEN, NICHT GEGEN DAS FENSTER — und das war der
  // Unterschied zwischen einer Zahl und einer falschen Zahl. Die Buehne ist
  // der Rollbereich; oben sitzt die Kopfleiste, unten der Mini-Player. Wer
  // gegen die Fensterhoehe rechnet, bekommt fuer eine Kachel, die zur Haelfte
  // unter der Kopfleiste steckt, brav „100 % im Bild".
  const BUEHNE = (document.getElementById('buehne') || document.body).getBoundingClientRect()
  const anteilImBild = (r) => {
    const b = Math.max(0, Math.min(BUEHNE.right, r.right) - Math.max(BUEHNE.left, r.left))
    const h = Math.max(0, Math.min(BUEHNE.bottom, r.bottom) - Math.max(BUEHNE.top, r.top))
    return Math.round((100 * (b * h)) / Math.max(1, r.width * r.height))
  }
  /** Getastete Trefferflaeche von der Mitte des SICHTBAREN Teils aus. */
  const tasten = (e) => {
    const r = e.getBoundingClientRect()
    const l = Math.max(0, r.left), o = Math.max(0, r.top)
    const re0 = Math.min(innerWidth - 1, r.right), u0 = Math.min(innerHeight - 1, r.bottom)
    if (re0 <= l || u0 <= o) return { breite: 0, hoehe: 0, verdeckt: true }
    let sx = Math.round((l + re0) / 2), sy = Math.round((o + u0) / 2)
    if (!trifft(e, sx, sy)) {
      let ok = false
      for (let i = 1; i <= 5 && !ok; i++) for (let j = 1; j <= 5 && !ok; j++) {
        const x = Math.round(l + ((re0 - l) * i) / 6), y = Math.round(o + ((u0 - o) * j) / 6)
        if (trifft(e, x, y)) { sx = x; sy = y; ok = true }
      }
      if (!ok) return { breite: 0, hoehe: 0, verdeckt: true }
    }
    const lauf = (dx, dy, grenze) => { let n = 0; while (n < grenze && trifft(e, sx + dx * (n + 1), sy + dy * (n + 1))) n++; return n }
    const li = lauf(-1, 0, Math.ceil(r.width) + 40), re = lauf(1, 0, Math.ceil(r.width) + 40)
    const ob = lauf(0, -1, Math.ceil(r.height) + 40), un = lauf(0, 1, Math.ceil(r.height) + 40)
    return { breite: li + re + 1, hoehe: ob + un + 1, verdeckt: false }
  }
  const masse = (e, name) => {
    if (!e) return null
    const r = e.getBoundingClientRect()
    const t = tasten(e)
    return {
      name,
      l: Math.round(r.left), o: Math.round(r.top), b: Math.round(r.width), h: Math.round(r.height),
      u: Math.round(r.bottom), re: Math.round(r.right),
      imBild: anteilImBild(r),
      trefferB: t.breite, trefferH: t.hoehe, verdeckt: t.verdeckt,
    }
  }

  const tief = document.querySelector('.lane-tief')
  const leiste = document.querySelector('.lane-tief .lane-wahl')
  const knoepfe = leiste ? [...leiste.querySelectorAll('button')] : []
  // Das COVER des Albums, dessen Lane offen ist — die Kachel traegt die Klasse auf.
  const albumKachel = document.querySelector('.lane-kachel.auf')
  const albumBild = albumKachel ? albumKachel.querySelector('img') : null
  const stuecke = [...document.querySelectorAll('.lane-tief .lane-kachel.stueck')]

  // DER PLATZ, UM DEN ES GEHT: die Buehne ist der Rollbereich, und der
  // Mini-Player steht darueber. Was unter seiner Oberkante liegt, ist weg.
  const buehne = document.getElementById('buehne')
  const mini = document.querySelector('.mini, #mini, .mini-player, footer')

  return {
    fenster: { b: innerWidth, h: innerHeight },
    buehne: masse(buehne, '#buehne'),
    mini: masse(mini, 'Mini-Player'),
    leisteDa: !!leiste,
    leiste: masse(leiste, '.lane-wahl'),
    laneTief: masse(tief, '.lane-tief'),
    knoepfe: knoepfe.map((k, i) => masse(k, (k.getAttribute('aria-label') || 'Knopf ' + i))),
    albumKachel: masse(albumKachel, '.lane-kachel.auf (Cover des offenen Albums)'),
    albumBild: masse(albumBild, 'das Coverbild selbst'),
    stuecke: stuecke.map((s, i) => masse(s, 'Titelkachel ' + (i + 1) + ' „' + ((s.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 20)) + '"')),
    rollstand: (document.getElementById('buehne') || {}).scrollTop,
  }
})()
`

const bericht = []
let fehler = 0
const sage = (s = '') => {
  bericht.push(s)
  console.log(s)
}

try {
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 800,
    height: 480,
    deviceScaleFactor: 1,
    mobile: false,
  })
  const ev = async (e) =>
    (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.value
  const stand = async (was) => {
    await fetch(new URL(`/vorschau/${was}`, ZIEL)).catch(() => null)
    await warte(150)
  }
  const foto = async (datei) => {
    if (!BILD) return
    const r = await send(ws, 'Page.captureScreenshot', { format: 'png' })
    await writeFile(datei, Buffer.from(r.data, 'base64'))
  }

  /**
   * EIN DURCHGANG — und die Gegenprobe ist ein ZWEITER, nicht ein Eingriff
   * am fertigen Baum.
   *
   * WARUM NICHT EINFACH `.lane-wahl` HERAUSNEHMEN: Die Lane rollt sich beim
   * Aufklappen SELBST ins Bild (`laneInsBild`, und die Rechnung dort haengt
   * an der HOEHE der Lane). Wer erst aufklappen laesst und dann die Leiste
   * entfernt, misst einen Rollstand, den es so nie gibt — die Zahlen bewegen
   * sich dann in beide Richtungen zugleich und sind wertlos.
   *
   * DESHALB: frisch laden, und im Durchgang „ohne" wird die Leiste VOR dem
   * Aufklappen auf `display:none` gesetzt. Derselbe Code baut sie, dieselbe
   * Reihenfolge, sie nimmt nur keinen Platz — also genau der Zustand von
   * VOR F6, mit der laneInsBild-Rechnung von vor F6.
   */
  const durchgang = async (mitLeiste) => {
    await stand('voll')
    await stand('spielt')
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(2400)
    if (!mitLeiste) {
      await ev(`(() => { const s = document.createElement('style')
        s.textContent = '.lane-wahl { display: none !important }'
        document.head.appendChild(s); return true })()`)
    }
    const gefunden = await ev(HINFINDEN_JS)
    if (!gefunden) throw new Error('kein Album mit gemerkter Stelle gefunden')
    // `laneInsBild` rollt WEICH. Wer sofort misst, misst die Bewegung.
    await warte(1800)
    const m = await ev(MESSEN_JS)
    await foto(`${BILD}-${mitLeiste ? 'mit' : 'ohne'}.png`)
    return m
  }

  const mit = await durchgang(true)
  if (!mit?.leisteDa) throw new Error('die Wahlleiste steht nicht in der Lane')
  const ohne = await durchgang(false)

  // ── Ausgabe ─────────────────────────────────────────────────────────────
  sage()
  sage('F6 — die Wahlleiste nachgemessen   (800x480, 0,14 mm/px, Marke 9 mm = 64,3 px)')
  sage('══════════════════════════════════════════════════════════════════════')
  sage()
  sage('DIE BEIDEN KNOEPFE')
  for (const k of mit.knoepfe) {
    sage(
      `  ${k.name}`.padEnd(46) +
        `Rechteck ${k.b}x${k.h} px   getastet ${k.trefferB}x${k.trefferH} px  ` +
        `= ${mmS(Math.min(k.trefferB, k.trefferH))} mm   Oberkante y=${k.o}   im Bild ${k.imBild}%`,
    )
  }
  if (mit.knoepfe.length === 2) {
    const [a, b] = mit.knoepfe
    const gleich = a.o === b.o
    const luecke = b.l - a.re
    sage()
    sage(`  gleiche Oberkante: ${gleich ? 'JA' : 'NEIN'} (y=${a.o} / y=${b.o})`)
    sage(`  gleiche Hoehe:     ${a.h === b.h ? 'JA' : 'NEIN'} (${a.h} / ${b.h} px)`)
    sage(`  Luecke dazwischen: ${luecke} px = ${mmS(luecke)} mm`)
    if (!gleich) fehler++
    for (const k of mit.knoepfe) {
      const klein = Math.min(k.trefferB, k.trefferH)
      if (klein < MARKE_PX) {
        sage(`  UNTER DER MARKE: „${k.name}" ist getastet nur ${mmS(klein)} mm`)
        fehler++
      }
      if (k.imBild < 100) {
        sage(`  NICHT GANZ IM BILD: „${k.name}" nur zu ${k.imBild} %`)
        fehler++
      }
      if (k.verdeckt) {
        sage(`  NICHT ZU TREFFEN: „${k.name}" liegt unter einer fremden Ebene`)
        fehler++
      }
    }
  }

  sage()
  sage('DAS COVER DES OFFENEN ALBUMS — bleibt es ganz sichtbar?')
  for (const feld of ['albumKachel', 'albumBild']) {
    const m = mit[feld]
    const o = ohne[feld]
    if (!m) {
      sage(`  ${feld}: nicht gefunden`)
      continue
    }
    sage(
      `  ${m.name}`.padEnd(46) +
        `y=${m.o}..${m.u}  im Bild ${m.imBild}%   (ohne die Leiste: ${o ? `y=${o.o}..${o.u}, ${o.imBild}%` : '—'})`,
    )
    if (o && m.imBild < o.imBild) {
      sage(`  DIE LEISTE NIMMT COVER WEG: ${o.imBild}% -> ${m.imBild}%`)
      fehler++
    }
    // Die getastete Trefferflaeche wird fuer das BILD nicht bewertet: in der
    // Mitte des Covers sitzt der Spielknopf, und der ist kein Fehler, sondern
    // der Entwurf. Bewertet wird nur die Kachel als Ziel.
    if (feld === 'albumKachel' && m.verdeckt) {
      sage('  DIE KACHEL IST NICHT ZU TREFFEN — eine Ebene liegt darueber')
      fehler++
    }
  }

  sage()
  sage('DER PLATZ, UM DEN GERECHNET WIRD')
  for (const s of [mit, ohne]) {
    const wie = s === mit ? 'mit ' : 'ohne'
    sage(
      `  ${wie} Leiste:  Buehne y=${s.buehne?.o}..${s.buehne?.u}   Lane-tief y=${s.laneTief?.o}..${s.laneTief?.u} (${s.laneTief?.h} px hoch)` +
        `   Rollstand ${s.rollstand}`,
    )
  }

  sage()
  sage('DIE TITELKACHELN — was war OHNE die Leiste im Bild und ist es MIT ihr nicht mehr?')
  const nachName = new Map(ohne.stuecke.map((s) => [s.name, s]))
  let verloren = 0
  for (const s of mit.stuecke) {
    const o = nachName.get(s.name)
    if (!o) continue
    const zeile = `  ${s.name}`.padEnd(46) + `mit: y=${s.o}, ${s.imBild}%   ohne: y=${o.o}, ${o.imBild}%`
    if (o.imBild > 0 && s.imBild === 0) {
      sage(`${zeile}   << GANZ AUS DEM BILD GESCHOBEN`)
      verloren++
    } else if (o.imBild - s.imBild >= 10) {
      sage(`${zeile}   << ${o.imBild - s.imBild} Prozentpunkte weniger`)
      verloren++
    } else {
      sage(zeile)
    }
  }
  sage()
  sage(
    `  Die Leiste ist ${mit.leiste.h} px hoch (${mmS(mit.leiste.h)} mm) und schiebt alles darunter ` +
      `um ${mit.stuecke[0] && nachName.get(mit.stuecke[0].name) ? mit.stuecke[0].o - nachName.get(mit.stuecke[0].name).o : '?'} px nach unten.`,
  )
  if (verloren) sage(`  ${verloren} Titelkachel(n) verlieren dadurch Sichtbarkeit.`)

  sage()
  sage('══════════════════════════════════════════════════════════════════════')
  sage(
    fehler === 0
      ? 'Kein Verstoss gegen die drei Zusagen (gleiche Hoehe, 9 mm, Cover ganz sichtbar).'
      : `${fehler} Befund(e).`,
  )
} catch (e) {
  console.error(`\nMESSUNG NICHT ZUSTANDE GEKOMMEN: ${e.message}`)
  fehler++
} finally {
  await brw.schliessen()
  vorschau?.kill()
}
process.exit(fehler ? 1 : 0)
