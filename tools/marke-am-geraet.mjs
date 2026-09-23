#!/usr/bin/env node
/**
 * STEHT DIE MARKE „SPIELT GERADE" AN ALLEN DREI ORTEN — MIT DEN DATEN DER BOX?
 *
 * WOFUER: Am 03.08.2026 meldete der Benutzer „nun sind die indikatoren bei
 * album und titel weg ich wollte ja alles". Die drei Werkzeuge, die es dafuer
 * schon gab (lane-marken-schau, raster-marke-schau, marke-grenzfaelle),
 * meldeten alle „keine Abweichung" — sie messen gegen tools/neu-vorschau.mjs,
 * also gegen ERFUNDENE Antworten. Am Geraet war die Marke trotzdem weg.
 * Genau dieser Unterschied ist hier der Messgegenstand: dieselbe Oberflaeche,
 * aber die ECHTEN Antworten der Box.
 *
 * WAS ES AENDERT: NICHTS AN DER BOX, und das ist hier keine Floskel, sondern
 * gebaut. Die Oberflaeche schickt beim Laufen ein `POST /api/weiterhoeren`
 * (merkStand) — liefe sie direkt gegen die Box, schriebe diese Messung eine
 * Weiterhoeren-Stelle in die resume.json. Der Spiegel reicht deshalb NUR GET
 * weiter; jedes schreibende Verfahren wird oertlich mit 200 beantwortet und
 * mitgeschrieben (`--laut` zeigt es). Auch `/player/<raum>/<befehl>` (Start,
 * Pause, Sprung) endet hier und geht nie zur Box.
 *
 * ── WAS ES MISST ──────────────────────────────────────────────────────────
 *   0. Was die Box wirklich sagt: `/player/state`, `/player/local` — und was
 *      `jetztLaeuft()` daraus macht. Die Bremse gegen Spotifys Nachlauf
 *      haengt an `art === 'spotify'`; liefert die Box hier etwas anderes als
 *      die Attrappe, faellt die Marke ueberall weg.
 *   1. RASTER: Traegt die Kachel des laufenden Werks die Marke?
 *   2. ALBUM-LANE: Ein Tipp auf diese Kachel — traegt das Album, in dem das
 *      laufende Stueck steht, die Marke?
 *   3. TITEL-LANE: Ein Tipp auf dieses Album — traegt der laufende Titel sie?
 *
 * DIE ERWARTUNG KOMMT AUS DEN ANTWORTEN DER BOX, nicht aus app.js: Welches
 * Werk laeuft, sagt `context.uri` gegen `/api/werke`; in welchem Album das
 * Stueck steht, sagt `/api/werke/<s>/alben`. Wer die Erwartung aus der
 * Oberflaeche liest, prueft seine eigene Vermutung.
 *
 * DER LOSE TITEL IST KEIN FEHLER, SONDERN EIN FALL: Eine Playlist zerfaellt in
 * Alben UND in `lose` Titel, die zu keinem ganzen Album gehoeren. Fuer die gibt
 * es in der Album-Lane gar keine Kachel — dann kann dort auch keine Marke
 * stehen, und das Werkzeug sagt das ausdruecklich, statt es als Abweichung zu
 * melden. Mit `--stueck <uri>` laesst sich stattdessen ein Titel stellen, der
 * in einem Album steht (die Box spielt dabei weiter, was sie spielt — nur der
 * Spiegel gibt etwas anderes aus).
 *
 * AUFRUF
 *     node tools/marke-am-geraet.mjs                  # gegen die Box
 *     node tools/marke-am-geraet.mjs --pruefen        # Ende 1 bei Abweichung
 *     node tools/marke-am-geraet.mjs --box 10.0.0.5:8200
 *     node tools/marke-am-geraet.mjs --stueck spotify:track:xxx   # was-waere-wenn
 *     node tools/marke-am-geraet.mjs --kontext spotify:playlist:x # andere Playlist
 *     node tools/marke-am-geraet.mjs --werk spotify:<id>          # anderes Werk
 *     node tools/marke-am-geraet.mjs --bild x.png
 *     node tools/marke-am-geraet.mjs --laut           # jeden Abruf mitschreiben
 */
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { eigenerBrowser } from './leihgabe.mjs'

const arg = (name, standard) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] || standard : standard
}
const BOX = arg('--box', '192.168.178.169:8200')
const PRUEFEN = process.argv.includes('--pruefen')
const LAUT = process.argv.includes('--laut')
const STUECK = arg('--stueck', null)
const KONTEXT = arg('--kontext', null)
const WERK_WAHL = arg('--werk', null)
const BILD = process.argv.includes('--bild') ? arg('--bild', 'marke-am-geraet.png') : null

const HIER = fileURLToPath(new URL('.', import.meta.url))
const SEITE = join(HIER, '..', 'NewDesign')
const SPIEGEL_PORT = 8298

const TYPEN = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
}

let fehler = 0
const melde = (z) => {
  fehler++
  console.error(`  FEHLER  ${z}`)
}
const zeile = (n, w) => console.log(`  ${String(n).padEnd(38)} ${w}`)
const warte = (ms) => new Promise((r) => setTimeout(r, ms))
/** Markiert heisst: Klasse gesetzt, Marke im Baum UND auf dem Schirm zu sehen. */
const istGut = (o) => !!(o && o.spielt && o.marke && o.sichtbar)
const befund = (o) =>
  istGut(o) ? `JA (${o.breite}x${o.hoehe} px)` : `NEIN (klasse=${o.spielt}, marke=${o.marke}, sichtbar=${o.sichtbar})`

const holen = async (pfad) => {
  const a = await fetch(`http://${BOX}${pfad}`, { signal: AbortSignal.timeout(20000) })
  if (!a.ok) throw new Error(`${pfad} -> ${a.status}`)
  return a.json()
}

// ── 0. WAS DIE BOX SAGT ───────────────────────────────────────────────────
console.log(`\n  Box ${BOX} — nur lesend\n`)
let dienst
let lokal
let werke
try {
  ;[dienst, lokal, werke] = await Promise.all([
    holen('/player/state'),
    holen('/player/local'),
    holen('/api/werke?verschmelzen=true'),
  ])
} catch (e) {
  // KEINE BOX HEISST UEBERSPRUNGEN, NICHT ROT — korrigiert am 03.08.2026.
  //
  // Bis dahin endete dieser Zweig mit `PRUEFEN ? 1 : 0`, also mit einem
  // Fehler auf JEDEM Rechner, an dem die Box gerade aus ist oder in einem
  // anderen Netz steht. In tools/pruefen.sh heisst der Schritt „Marke am
  // Geraet (WENN ERREICHBAR)" und der Kommentar daneben sagt ausdruecklich,
  // er „ueberspringt sich selbst, wenn keine Box antwortet" — er tat es nur
  // nicht. Beim Gegenlesen war der Gesamtlauf deshalb rot, ohne dass etwas
  // kaputt war.
  //
  // WARUM DAS SCHLIMMER IST ALS EIN FEHLENDER SCHRITT: steht im Kopf von
  // pruefen.sh — „Ein Pruefschritt, der immer rot ist, ist schlimmer als
  // keiner: Man gewoehnt sich an ihn und uebersieht den Tag, an dem er zu
  // Recht rot wird."
  //
  // WER DIE BOX WIRKLICH VERLANGT, nimmt `tools/pruefen.sh --box`: dort
  // steht mupi-check, und der wird rot, wenn die Box nicht antwortet.
  console.error(`  Die Box antwortet nicht (${e.message}) — Schritt uebersprungen, nichts zu messen.`)
  process.exit(0)
}

/**
 * `jetztLaeuft` aus NewDesign/app.js, auf die eine Frage verkuerzt, die hier
 * zaehlt: WELCHE MASCHINE. Bewusst nachgebaut und nicht importiert — app.js
 * ist eine geschlossene Klammer ohne Ausfuhr. Wer sie hier aendert, muss dort
 * mitziehen; deshalb steht die Herkunft dabei (app.js `jetztLaeuft`, der
 * Vorrang von LOKAL kommt aus now-playing.ts toNowPlaying).
 */
function artVon(sp, lo) {
  if (lo && lo.currentPlayer === 'mplayer' && (lo.playing || lo.currentTrackname)) return 'lokal'
  if (sp && sp.item && sp.item.name) return 'spotify'
  return null
}

const art = artVon(dienst, lokal)
const kontext = KONTEXT || ((dienst || {}).context || {}).uri || ''
const laufendeUri =
  STUECK ||
  (dienst && dienst.item && ((dienst.item.linked_from && dienst.item.linked_from.uri) || dienst.item.uri)) ||
  ''
zeile('/player/local currentPlayer', JSON.stringify((lokal || {}).currentPlayer))
zeile('/player/local playing', JSON.stringify((lokal || {}).playing))
zeile('/player/state is_playing', JSON.stringify((dienst || {}).is_playing))
zeile('/player/state context.uri', kontext || '—')
zeile('/player/state item.uri', (dienst && dienst.item && dienst.item.uri) || '—')
zeile('jetztLaeuft().art', String(art))
if (STUECK) zeile('--stueck gestellt', STUECK)

if (art !== 'spotify') {
  console.log('\n  Spotify ist nicht die Tonquelle — die Lane-Marke gibt es nur fuer Spotify-Playlisten.')
  console.log('  Nichts zu messen. (Das ist KEINE Abweichung, sondern die Lage.)\n')
  process.exit(0)
}

// ── Die zweite Meinung: welches Werk, welches Album, welcher Titel? ────────
const kurz = (u) =>
  String(u || '')
    .split(':')
    .pop()
const gesucht = WERK_WAHL || null
const werk = gesucht
  ? werke.werke.find((w) => w.schluessel === gesucht)
  : werke.werke.find((w) => (w.quellen || []).some((q) => q.dienst === 'spotify' && kurz(q.kennung) === kurz(kontext)))
if (!werk) {
  melde(
    `kein Werk in /api/werke traegt die Kennung ${kurz(kontext)} — die Box spielt etwas, das der Katalog nicht kennt`,
  )
  process.exit(PRUEFEN ? 1 : 0)
}
zeile('laufendes Werk', `${werk.titel} (${werk.schluessel})`)

/**
 * WO STEHT DAS LAUFENDE STUECK IN DER ZERLEGUNG — in einem ganzen Album oder
 * unter den LOSEN Titeln?
 *
 * DER LOSE TITEL IST DER FALL, DER DIESES WERKZEUG GEBOREN HAT. Er hatte in
 * der Album-Lane bis zum 03.08.2026 gar keine Kachel; die Marke konnte dort
 * also nicht stehen, und genau das wurde gemeldet. Seitdem sammelt die Lane
 * sie unter einer Kachel „Einzelne Titel" — und dieses Werkzeug erwartet sie
 * dort. Wer den Fall hier wieder zur Ausnahme erklaert („entfaellt"), macht
 * die Pruefung an genau der Stelle blind, an der sie einmal blind war.
 */
const zerlegt = await holen(`/api/werke/${encodeURIComponent(werk.schluessel)}/alben`)
const sollAlbum = (zerlegt.alben || []).find((a) => (a.stuecke || []).some((s) => s.uri === laufendeUri))
const loserTitel = !sollAlbum && (zerlegt.lose || []).find((s) => s.uri === laufendeUri)
const sollTitel = sollAlbum ? (sollAlbum.stuecke || []).find((s) => s.uri === laufendeUri) : loserTitel
/** Wie die Kachel heisst, die das laufende Stueck enthaelt — oder null, wenn
 *  die Zerlegung es gar nicht kennt. Ohne Alben zeigt die Lane die Titel
 *  sofort, dann gibt es keine mittlere Ebene. */
const albumWort = sollAlbum ? sollAlbum.titel : loserTitel && (zerlegt.alben || []).length ? 'Einzelne Titel' : null
zeile(
  'Album des laufenden Stuecks',
  albumWort || (loserTitel ? '— (nur lose Titel, keine mittlere Ebene)' : '— (nicht in der Zerlegung)'),
)
if (sollTitel) zeile('Titel des laufenden Stuecks', `${sollTitel.nr}. ${sollTitel.titel}`)

// ── Der Spiegel: GET zur Box, alles Schreibende endet hier ────────────────
const geschluckt = []
const spiegel = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const p = url.pathname
  if (LAUT) console.log(`    ${req.method} ${p}`)

  // 1. Alles, was nicht GET ist, endet HIER. Sonst schriebe `merkStand()`
  //    eine Weiterhoeren-Stelle auf die Box — die Messung veraenderte das
  //    Geraet, das sie misst.
  if (req.method !== 'GET') {
    geschluckt.push(`${req.method} ${p}`)
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end('{}')
  }
  // 2. Abspielbefehle gehen ebenfalls nicht hinaus.
  if (p.startsWith('/player/') && p !== '/player/state' && p !== '/player/local') {
    geschluckt.push(`GET ${p}`)
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end('{}')
  }
  // 3. Die Dateien der Oberflaeche kommen aus dem ARBEITSVERZEICHNIS, nicht
  //    von der Box: gemessen werden soll der Stand, an dem gearbeitet wird.
  if (p === '/neu' || p === '/neu/') return datei(res, 'index.html')
  if (p.startsWith('/neu/')) return datei(res, p.slice(5))

  // 4. Alles andere: GET zur Box durchreichen.
  try {
    const a = await fetch(`http://${BOX}${req.url}`, { signal: AbortSignal.timeout(20000) })
    let leib = Buffer.from(await a.arrayBuffer())
    // DAS WAS-WAERE-WENN: nur hier, nur im Spiegel. Die Box spielt weiter,
    // was sie spielt.
    if ((STUECK || KONTEXT) && p === '/player/state') {
      const j = JSON.parse(leib.toString('utf8'))
      if (j && j.item && STUECK) {
        j.item.uri = STUECK
        delete j.item.linked_from
      }
      if (j && j.context && KONTEXT) j.context.uri = KONTEXT
      leib = Buffer.from(JSON.stringify(j))
    }
    res.writeHead(a.status, { 'content-type': a.headers.get('content-type') || 'application/json' })
    res.end(leib)
  } catch (e) {
    res.writeHead(502, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ fehler: String(e.message) }))
  }
})
async function datei(res, rel) {
  const ziel = join(SEITE, normalize(rel).replace(/^(\.\.[/\\])+/, ''))
  try {
    const b = await readFile(ziel)
    res.writeHead(200, {
      'content-type': TYPEN[extname(ziel)] || 'application/octet-stream',
      'cache-control': 'no-store',
    })
    res.end(b)
  } catch {
    res.writeHead(404).end('weg')
  }
}
await new Promise((r) => spiegel.listen(SPIEGEL_PORT, '127.0.0.1', r))

// ── Der Browser ───────────────────────────────────────────────────────────
// DER DEBUG-PORT WIRD ERFRAGT, NICHT GEWAEHLT.
//
// Hier stand bis zum 04.08.2026 fest 9353. Ein fester Port ist doppelt
// gefaehrlich: Ein Browser, der einen harten Abbruch ueberlebt hat, HAELT ihn;
// der eigene bindet ihn dann NICHT und meldet darueber nichts; und
// `/json/list` liefert klaglos die Ziele des FREMDEN. Was danach gemessen
// wird, ist eine Seite, die dieses Werkzeug nie geoeffnet hat — und gerade
// hier waere das teuer, denn dieses Werkzeug misst gegen die BOX und ist die
// letzte Instanz, wenn die Messungen gegen die Attrappe alle gruen sind.
const brw = await eigenerBrowser().catch((e) => {
  console.error(`  Browser kam nicht hoch — Messung nicht moeglich: ${e.message}`)
  spiegel.close()
  process.exit(2)
})
if (!brw) {
  console.log('  kein Browser gefunden — uebersprungen')
  spiegel.close()
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

/**
 * Was an einem Ort steht, der eine Marke tragen will.
 *
 * DIE MARKE MUSS AUCH ZU SEHEN SEIN, nicht nur im Baum stehen. Die
 * Umbenennung `.lane-laeuft` -> `.spielt-marke` (03.08.2026) haette genau so
 * ausfallen koennen: das Element da, die Regel dazu nicht mehr — und dann
 * misst man ein „JA", das der Benutzer nirgends sieht. Deshalb wird das
 * Rechteck mitgemessen.
 */
const SCHAU = `[...document.querySelectorAll('[data-spielt]')].map(o => {
  const m = o.querySelector('.spielt-marke')
  const r = m && m.getBoundingClientRect()
  const s = m && getComputedStyle(m)
  return {
    klasse: o.className,
    wort: (o.querySelector('.kachel-wort, .lane-titel') || {}).textContent || '',
    kennungen: (o.dataset.spielt || '').split(' '),
    spielt: o.classList.contains('spielt'),
    marke: !!m,
    breite: r ? Math.round(r.width) : 0,
    hoehe: r ? Math.round(r.height) : 0,
    sichtbar: !!(r && r.width >= 12 && r.height >= 12 && s.visibility !== 'hidden' && Number(s.opacity) > 0.1),
  }
})`

try {
  await warte(1500)
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  const ev = async (e) =>
    (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.value

  const laut = []
  ws.on('message', (r) => {
    try {
      const x = JSON.parse(r)
      if (x?.method === 'Runtime.exceptionThrown') {
        const d = x.params?.exceptionDetails
        laut.push(`Ausnahme: ${d?.exception?.description || d?.text || '?'}`)
      }
      if (x?.method === 'Runtime.consoleAPICalled' && x.params?.type === 'error') {
        laut.push(`error: ${(x.params.args || []).map((a) => a?.value ?? a?.description ?? '?').join(' ')}`)
      }
    } catch {
      /* kein JSON */
    }
  })

  await send(ws, 'Page.navigate', { url: `http://127.0.0.1:${SPIEGEL_PORT}/neu/?frisch=${Date.now()}` })
  await warte(4000)

  const werkK = `werk|${werk.schluessel}`
  const stueckK = `stueck|${kurz(kontext)}|${laufendeUri}`
  console.log('\n  Erwartete Kennungen')
  zeile('Raster', werkK)
  zeile('Lane', stueckK)

  // ── 1. RASTER ───────────────────────────────────────────────────────────
  console.log('\n  1. RASTER')
  let orte = await ev(SCHAU)
  const rasterOrt = (orte || []).find((o) => o.kennungen.includes(werkK))
  if (!rasterOrt) {
    melde(
      `keine Kachel im Raster traegt ${werkK} — sie steht vielleicht in einem Regal, das erst geoeffnet werden muss`,
    )
  } else {
    zeile('Kachel', `${rasterOrt.wort.trim() || '(ohne Wort)'} [${rasterOrt.klasse}]`)
    zeile('markiert', befund(rasterOrt))
    if (!istGut(rasterOrt)) melde('die Marke fehlt im RASTER')
  }

  // ── 2. ALBUM-LANE ───────────────────────────────────────────────────────
  console.log('\n  2. ALBUM-LANE (ein Tipp auf die Kachel)')
  const getroffen = await ev(`(() => {
    const k = [...document.querySelectorAll('[data-spielt]')].find(o => (o.dataset.spielt||'').split(' ').includes(${JSON.stringify(werkK)}))
    if (!k) return false
    k.click()
    return true
  })()`)
  if (!getroffen) melde('die Kachel des laufenden Werks liess sich nicht antippen')
  await warte(3000)
  orte = (await ev(SCHAU)) || []
  const laneOrte = orte.filter((o) => o.klasse.includes('lane-kachel'))
  zeile('Kacheln in der Lane', String(laneOrte.length))
  if (!laneOrte.length) melde('die Lane traegt gar keine Kachel mit `data-spielt` — dann misst die Marke das Nichts')
  const albumOrt = laneOrte.find((o) => o.kennungen.includes(stueckK))
  if (albumWort) {
    if (!albumOrt) melde(`keine Kachel der Album-Lane traegt ${stueckK} — erwartet an „${albumWort}"`)
    else {
      zeile('Album-Kachel', albumOrt.wort.trim())
      if (albumOrt.wort.trim() !== albumWort)
        melde(`markiert ist „${albumOrt.wort.trim()}", erwartet war „${albumWort}"`)
      zeile('markiert', befund(albumOrt))
      if (!istGut(albumOrt)) melde('die Marke fehlt an der ALBUM-Kachel')
    }
  } else {
    zeile('Album-Kachel', 'entfaellt — diese Playlist hat gar keine mittlere Ebene')
  }
  // Kein zweites Album darf mitmarkiert sein.
  const falsch = laneOrte.filter((o) => o.spielt && o !== albumOrt)
  if (falsch.length) melde(`auch fremde Lane-Kacheln sind markiert: ${falsch.map((o) => o.wort.trim()).join(', ')}`)

  // ── 3. TITEL-LANE ───────────────────────────────────────────────────────
  console.log('\n  3. TITEL-LANE (ein Tipp auf das Album)')
  if (!albumWort) {
    zeile('entfaellt', 'ohne mittlere Ebene gibt es keine dritte')
  } else {
    const auf = await ev(`(() => {
      const k = [...document.querySelectorAll('.lane-kachel[data-spielt]')].find(o => (o.dataset.spielt||'').split(' ').includes(${JSON.stringify(stueckK)}))
      if (!k) return false
      k.click()
      return true
    })()`)
    if (!auf) melde('die Album-Kachel liess sich nicht antippen')
    await warte(2500)
    orte = (await ev(SCHAU)) || []
    const tief = orte.filter((o) => o.klasse.includes('lane-kachel') && o.klasse.includes('stueck'))
    zeile('Titelkacheln', String(tief.length))
    if (!tief.length) melde('die Titel-Lane traegt keine Kachel mit `data-spielt`')
    const titelOrt = tief.find((o) => o.kennungen.includes(stueckK))
    if (!titelOrt) melde(`keine Titelkachel traegt ${stueckK}`)
    else {
      zeile('Titelkachel', titelOrt.wort.trim())
      zeile('markiert', befund(titelOrt))
      if (!istGut(titelOrt)) melde('die Marke fehlt an der TITEL-Kachel')
    }
    const falschT = tief.filter((o) => o.spielt && o !== titelOrt)
    if (falschT.length) melde(`auch fremde Titelkacheln sind markiert: ${falschT.map((o) => o.wort.trim()).join(', ')}`)
  }

  if (BILD) {
    const bild = await send(ws, 'Page.captureScreenshot', { format: 'png' })
    const { writeFile } = await import('node:fs/promises')
    await writeFile(BILD, Buffer.from(bild.data, 'base64'))
    console.log(`\n  Bild -> ${BILD}`)
  }

  if (laut.length) {
    console.log('\n  Die Seite meldete:')
    for (const l of laut.slice(0, 8)) console.log(`    ${l}`)
  }
  if (geschluckt.length) {
    console.log(`\n  Nicht zur Box durchgelassen (${geschluckt.length}):`)
    for (const g of [...new Set(geschluckt)].slice(0, 8)) console.log(`    ${g}`)
  }
  ws.close()
} finally {
  await brw.schliessen()
  spiegel.close()
}

console.log(fehler ? `\n  ${fehler} Abweichung(en)\n` : '\n  keine Abweichung\n')
process.exit(PRUEFEN && fehler ? 1 : 0)
