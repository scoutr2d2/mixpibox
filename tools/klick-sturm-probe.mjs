#!/usr/bin/env node
/**
 * KLICK-STURM-PROBE — stellt das wahllose Schnelltippen eines Kleinkinds nach
 * und prueft, ob die neue Oberflaeche danach noch laedt.
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 *
 * ACHTUNG, HIER STAND EINE ERFUNDENE MELDUNG. Der urspruengliche Kopf schrieb
 * dem Betreiber woertlich zu, sein zweijaehriger Sohn tippe wahllos und danach
 * „laedt nichts mehr" — mit Datum. NICHTS DAVON IST GESAGT WORDEN. Der Satz
 * ist beim Nachlesen des Gespraechs am 06.08.2026 aufgefallen und hier
 * ersetzt, statt still geloescht: Ein Werkzeug, das seine Daseinsberechtigung
 * aus einem Zitat zieht, das es nicht gibt, ist beim naechsten Lesen nicht von
 * einem echten Befund zu unterscheiden — und der Naechste baut darauf auf.
 *
 * DER ECHTE GRUND, und er traegt: Diese Oberflaeche laeuft auf dem Geraet
 * eines KINDES, im Kiosk, ohne Adresszeile und ohne Neuladen-Knopf. Wer sie
 * in einen Zustand bringt, aus dem sie nicht selbst herausfindet, hat sie bis
 * zum Neustart. Schnelles, wahlloses Tippen ist dabei keine boesartige
 * Eingabe, sondern die normale Bedienung durch ein kleines Kind — und die
 * uebrigen Werkzeuge dieses Baumes messen ausnahmslos EINEN geordneten Tipp
 * nach dem anderen. Diese Fehlerklasse sieht keines von ihnen.
 *
 * Es prasselt deshalb in RUNDEN echte Tipps auf die Seite und stellt nach
 * jeder Runde dieselbe Frage — „geht noch was auf?". OHNE Neuladen zwischen
 * den Runden, damit sich Schaden aufaddieren darf.
 *
 * WAS ES BISHER GEFUNDEN HAT: nichts, was haengenblieb. Der eine echte Fund
 * des Tages kam aus einer gezielten Messung daneben und nicht von hier — ein
 * Doppeltipp auf „Neu starten" oeffnete die Rueckfrage und beantwortete sie
 * im selben Zug, weil Knopf und Bestaetigung auf demselben Punkt lagen
 * (Commit „Admin-Menue: der zweite Tipp startete die Box neu").
 *
 * ══ WIE — und warum genau so ═══════════════════════════════════════════════
 *
 * 1. ECHTE KOORDINATEN-KLICKS (Input.dispatchMouseEvent), NICHT el.click().
 *    el.click() feuert auch auf verdeckten Elementen und wuerde damit genau
 *    die Fehlerklasse verstecken, um die es geht: ein Overlay/eine Ebene, die
 *    alles schluckt. Der Koordinaten-Klick trifft, was WIRKLICH obenauf liegt
 *    — wie der Finger.
 *
 * 2. GEZIELT UND WAHLLOS GEMISCHT: ~70 % der Tipps landen (mit Zittern) auf
 *    der Mitte eines sichtbaren Bedienelements, der Rest voellig zufaellig im
 *    Bild. Ein Kleinkind trifft beides.
 *
 * 3. WUERFEL MIT SAAT (--seed): jeder Lauf ist wiederholbar. Die Saat steht
 *    im Protokoll — ein roter Lauf laesst sich exakt nachfahren.
 *
 * 4. DAS ORAKEL nach jeder Runde benutzt nur, was auch das Kind hat:
 *    den Rueckweg-Knopf (#zurueck) druecken, bis er erlischt, dann eine
 *    Kachel antippen und nachsehen, ob binnen Frist Inhalt erscheint
 *    (#raster .lane mit Kacheln). Scheitert das, wird der Zustand seziert:
 *    was liegt ueber dem Raster (elementFromPoint), welche Anfragen haengen
 *    seit wann, welche Ausnahmen hat die Seite geworfen, welche Ebenen sind
 *    offen.
 *
 * ══ WAS ES NICHT KANN ══════════════════════════════════════════════════════
 *
 *   * Es misst gegen die ATTRAPPE (tools/neu-vorschau.mjs): Antworten kommen
 *     sofort und fehlerlos. Serverseitige Mechanismen (Spotify-429 nach
 *     Anfrage-Sturm, haengende Upstream-Abrufe, resume-Sperren) sieht es
 *     NICHT — dafuer braucht es die Box. Was es sieht: alles, was die SEITE
 *     selbst verklemmt (Latches, Overlays, Wettlaeufe zweier Oeffnungen,
 *     verlorene finally-Pfade).
 *   * Es prueft die NEUE Oberflaeche. Die klassische hat kein solches Geschirr.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *
 *     node tools/klick-sturm-probe.mjs                      # eigene Attrappe
 *     node tools/klick-sturm-probe.mjs http://127.0.0.1:8391/neu/
 *     node tools/klick-sturm-probe.mjs --runden 8 --tipps 40 --abstand 50
 *     node tools/klick-sturm-probe.mjs --seed 1234          # roten Lauf nachfahren
 *     node tools/klick-sturm-probe.mjs --zaeh 9000          # Box-Lage: Backend antwortet erst nach 9 s
 *
 * Ende 0 = alle Runden erholt. Ende 1 = mindestens eine Runde blieb stecken
 * (Diagnose steht dann im Protokoll). Ohne Browser: uebersprungen, Ende 0.
 */

import WebSocket from 'ws'
import { browserSuchen, eigenerBrowser, freierPort, vorschauLeihen } from './leihgabe.mjs'

// ── Aufrufzeile ─────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const wert = (name, vorgabe) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] !== undefined ? Number(argv[i + 1]) : vorgabe
}
const RUNDEN = wert('runden', 6)
const TIPPS = wert('tipps', 30)
const ABSTAND_MS = wert('abstand', 60) // Kleinkind-Tempo: ~15 Tipps je Sekunde schafft keins, ~10-16/s mit 60 ms schon
const SAAT = wert('seed', (Date.now() % 2147483647) | 1)
// --zaeh N: JEDE /api/- und /player/-Antwort kommt N ms spaeter (CDP-Fetch-
// Abfangen, die Attrappe bleibt unangetastet). Das ist die Box-Lage, die die
// Attrappe nicht kennt: Spotify-Nachlauf, traeges Backend, 429-Wartezeiten.
// Die eigentliche Frage dahinter: bleibt nach Sturm + Zaehigkeit eine KLEMME
// stehen, wenn die Antworten wieder schnell kommen?
const ZAEH_MS = wert('zaeh', 0)
const ZIEL_ARG = argv.find((a) => a.startsWith('http'))
const FRIST_MS = Math.max(8000, ZAEH_MS + 4000)

// Wiederholbarer Wuerfel (mulberry32) — die Saat steht im Protokoll.
function wuerfel(saat) {
  let a = saat >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const wurf = wuerfel(SAAT)
const schlafen = (ms) => new Promise((r) => setTimeout(r, ms))

// ── CDP-Geschirr (dasselbe Muster wie tools/e2e/neu-oberflaeche.test.mjs) ──
let ws = null
let naechsteId = 1
const senden = (methode, params = {}) =>
  new Promise((ok, nein) => {
    const id = naechsteId++
    const h = (roh) => {
      const x = JSON.parse(roh)
      if (x.id !== id) return
      ws.off('message', h)
      x.error ? nein(new Error(`${methode}: ${x.error.message}`)) : ok(x.result)
    }
    ws.on('message', h)
    ws.send(JSON.stringify({ id, method: methode, params }))
  })
const ev = async (ausdruck) => {
  const r = await senden('Runtime.evaluate', { expression: ausdruck, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(`Seite warf: ${r.exceptionDetails.text} — ${ausdruck.slice(0, 120)}`)
  return r.result?.value
}
const warteAuf = async (ausdruck, was, frist = FRIST_MS, oder = null) => {
  const bis = Date.now() + frist
  while (Date.now() < bis) {
    try {
      if (await ev(ausdruck)) return true
    } catch {
      /* Seite laedt gerade neu — weiter warten */
    }
    if (oder?.()) return true
    await schlafen(100)
  }
  return false
}

// ── Der Tipp: druecken + loslassen an einer Koordinate ─────────────────────
async function tipp(x, y) {
  await senden('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await senden('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}

/** Sichtbare Bedienelemente samt Mitte — jedes Mal frisch, denn der Sturm
 *  selbst oeffnet und schliesst Ebenen. */
const ZIELE_AUSDRUCK = `(() => {
  const ziele = []
  for (const e of document.querySelectorAll('button, [role="button"], .kachel, .weiter-kachel, a, input, select')) {
    const r = e.getBoundingClientRect()
    if (r.width < 8 || r.height < 8) continue
    if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue
    const s = getComputedStyle(e)
    if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) continue
    ziele.push({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) })
  }
  return ziele
})()`

// ── Netz- und Fehler-Beobachtung ────────────────────────────────────────────
const unterwegs = new Map() // requestId -> { url, seit }
const ausnahmen = []
let seitenwechsel = 0
let befehleGesehen = 0 // /player/- und /api/-Anfragen insgesamt — das Orakel misst daran "es tut noch was"

function beobachten() {
  ws.on('message', (roh) => {
    let x
    try {
      x = JSON.parse(roh)
    } catch {
      return
    }
    if (x.method === 'Network.requestWillBeSent') {
      const url = x.params.request.url
      if (url.includes('/player/') || url.includes('/api/')) befehleGesehen++
      unterwegs.set(x.params.requestId, { url, seit: Date.now() })
    } else if (
      x.method === 'Network.loadingFinished' ||
      x.method === 'Network.loadingFailed' ||
      x.method === 'Network.requestServedFromCache'
    ) {
      unterwegs.delete(x.params.requestId)
    } else if (x.method === 'Page.frameNavigated' && !x.params.frame.parentId) {
      // Die Seite hat NEU GELADEN (z. B. Profilwechsel) — alte Anfragen sind
      // damit Geschichte, aber der Wechsel selbst ist ein Befund und wird
      // gezaehlt: an der Box verliert ein Neuladen den gesamten Ebenen-Stand.
      seitenwechsel++
      unterwegs.clear()
    } else if (x.method === 'Runtime.exceptionThrown') {
      const d = x.params.exceptionDetails
      ausnahmen.push(`${d.text || ''} ${d.exception?.description || ''}`.trim().slice(0, 300))
    } else if (x.method === 'Fetch.requestPaused') {
      // Der Zaeh-Modus: die Anfrage N ms festhalten, DANN weiterlassen.
      // IMMER weiterlassen — eine nie fortgesetzte Anfrage waere ein Haenger,
      // den dieses Werkzeug selbst gebaut hat, kein gemessener.
      const id = x.params.requestId
      setTimeout(() => {
        senden('Fetch.continueRequest', { requestId: id }).catch(() => {
          /* Ziel schon weg (Seitenwechsel) — dann gibt es nichts fortzusetzen */
        })
      }, ZAEH_MS)
    }
  })
}

/** Haengende Anfragen: aelter als `ab` Millisekunden. */
const haengt = (ab = 5000) =>
  [...unterwegs.values()].filter((a) => Date.now() - a.seit > ab).map((a) => `${Math.round((Date.now() - a.seit) / 1000)}s ${a.url}`)

// ── Das Orakel: geht noch was? ──────────────────────────────────────────────

/** Rueckweg druecken, bis er erlischt (hoechstens `hoechstens` Mal) — mit
 *  ECHTEN Klicks auf seine Mitte, denn auch der Rueckweg kann verdeckt sein. */
async function heimfinden(hoechstens = 10) {
  for (let i = 0; i < hoechstens; i++) {
    const z = await ev(`(() => {
      const k = document.getElementById('zurueck')
      if (!k || k.disabled) return null
      const r = k.getBoundingClientRect()
      if (!r.width) return null
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    })()`)
    if (!z) return true // erloschen = ganz oben
    await tipp(z.x, z.y)
    await schlafen(350)
  }
  return !(await ev(`(() => { const k = document.getElementById('zurueck'); return k && !k.disabled })()`))
}

/** Der Kern: Raster erreichbar? Kachel antippen -> kommt Inhalt? Danach wieder zu. */
async function orakel() {
  const heim = await heimfinden()
  const rasterDa = await warteAuf(
    `!document.getElementById('raster').hidden && document.querySelectorAll('#raster > .kachel').length > 0`,
    'Raster mit Kacheln',
    FRIST_MS,
  )
  if (!rasterDa) return { ok: false, schritt: heim ? 'raster-leer-oder-versteckt' : 'rueckweg-erlischt-nicht' }

  // Eine Kachel wirklich ANTIPPEN (Koordinate!) — bevorzugt keine Regal-Kachel,
  // damit direkt eine Lane mit Inhalt aufgehen muss.
  //
  // ERST INS BILD ROLLEN: Das Raster ist auf 800x480 laenger als der Schirm.
  // Der erste Anlauf dieses Werkzeugs nahm die Mitte der ERSTEN Kachel und
  // tippte damit unter Umstaenden ins Leere (Mitte ausserhalb des Fensters)
  // — die Nullprobe war rot, ohne dass die Seite etwas dafuer konnte.
  // Danach BEWEISEN, wen der Tipp trifft: elementFromPoint muss die Kachel
  // selbst (oder ein Kind von ihr) nennen — sonst ist GENAU DAS der Befund
  // (etwas liegt darueber), und er gehoert benannt, nicht uebertippt.
  const k = await ev(`(async () => {
    const k = document.querySelector('#raster > .kachel:not(.regal)') || document.querySelector('#raster > .kachel')
    if (!k) return null
    k.scrollIntoView({ block: 'center' })
    await new Promise((r) => setTimeout(r, 250))
    const r = k.getBoundingClientRect()
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2)
    const oben = document.elementFromPoint(x, y)
    const trifft = !!oben && (oben === k || k.contains(oben))
    const wer = oben ? oben.tagName.toLowerCase() + (oben.id ? '#' + oben.id : '') + (typeof oben.className === 'string' && oben.className ? '.' + oben.className.split(' ')[0] : '') : 'nichts'
    return { x, y, regal: k.classList.contains('regal'), trifft, wer }
  })()`)
  if (!k) return { ok: false, schritt: 'keine-kachel' }
  if (!k.trifft) return { ok: false, schritt: `kachel-verdeckt-von:${k.wer}` }

  // WAS ALS "REAGIERT" ZAEHLT: Nicht jede Kachel oeffnet eine Lane — die
  // ganze Kachel ist ein <button>, und je nach Werk SPIELT der Tipp direkt
  // (kachelBauen, app.js). Der erste Anlauf dieses Orakels wartete stur auf
  // eine Lane und war rot, obwohl die Seite alles richtig machte (der Tipp
  // hatte /player/current/musicsearch/... gefeuert). Reaktion heisst also:
  // eine Lane ERSCHEINT oder ein Befehl GEHT HINAUS (/player/ oder /api/).
  const befehleVorher = befehleGesehen
  await tipp(k.x, k.y)
  const inhalt = await warteAuf(
    k.regal ? `document.querySelectorAll('#raster > .kachel').length > 0` : `!!document.querySelector('#raster .lane')`,
    'Reaktion nach Kachel-Tipp',
    FRIST_MS,
    () => befehleGesehen > befehleVorher,
  )
  await heimfinden(4)
  return inhalt ? { ok: true } : { ok: false, schritt: 'kachel-tipp-laedt-nichts' }
}

/** Wenn das Orakel rot ist: den Zustand sezieren, damit der Befund einen
 *  TATORT hat und nicht nur ein "ging nicht". */
async function sezieren() {
  const dom = await ev(`(() => {
    const raster = document.getElementById('raster')
    const mitte = document.elementFromPoint(Math.round(innerWidth / 2), Math.round(innerHeight / 2))
    const kette = []
    for (let e = mitte; e && e !== document.body && kette.length < 6; e = e.parentElement)
      kette.push(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ').slice(0, 3).join('.') : ''))
    const offeneEbenen = [...document.querySelectorAll('[role="dialog"], .ich-fenster, .eltern, [class*="fach"]')]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && !e.hidden })
      .map((e) => e.id || e.className.split(' ')[0])
    return {
      rasterVersteckt: raster.hidden,
      rasterKacheln: document.querySelectorAll('#raster > .kachel').length,
      laneOffen: !!document.querySelector('#raster .lane'),
      zustandText: (document.getElementById('zustand') || {}).textContent?.trim().slice(0, 120) || '',
      zustandSichtbar: !(document.getElementById('zustand') || { hidden: true }).hidden,
      koerperKlassen: document.body.className,
      obenAufDerMitte: kette,
      offeneEbenen,
      rueckwegAus: (document.getElementById('zurueck') || {}).disabled,
    }
  })()`)
  // MEINE BUCHFUEHRUNG GEGEN DIE DER SEITE HALTEN: Ein Eintrag, der bei mir
  // "haengt", kann in Wahrheit laengst fertig sein (Ereignis verpasst, aus dem
  // Cache bedient, Beacon). performance.getEntriesByType('resource') fuehrt
  // die Seite selbst — steht dort ein responseEnd > 0, war die Antwort da,
  // und "haengend" waere eine Falschmeldung DIESES Werkzeugs, kein Befund.
  const offen = [...unterwegs.values()].map((a) => ({ url: a.url, alterMs: Date.now() - a.seit }))
  let seitenSicht = []
  if (offen.length) {
    seitenSicht = await ev(
      `(() => { const urls = ${JSON.stringify(offen.map((o) => o.url))};
        return urls.map((u) => { const e = [...performance.getEntriesByType('resource')].reverse().find((x) => x.name === u);
          return { url: u.slice(-80), fertigLautSeite: !!e && e.responseEnd > 0 } }) })()`,
    ).catch(() => [])
  }
  return { dom, offeneAnfragen: offen, seitenSicht, ausnahmen: ausnahmen.slice(-5), seitenwechsel }
}

// ── Hauptlauf ───────────────────────────────────────────────────────────────
async function haupt() {
  if (!browserSuchen()) {
    console.log('KEIN BROWSER auf diesem Rechner — Probe uebersprungen (kein Fehler).')
    return 0
  }

  // Eigene Attrappe auf eigenem Port — ein per Argument genanntes Ziel wird
  // dagegen GENUTZT, nicht neu gestartet.
  let ziel = ZIEL_ARG
  if (!ziel) {
    const port = await freierPort()
    ziel = `http://127.0.0.1:${port}/neu/`
  }

  // EINE SCHON LAUFENDE VORSCHAU WIRD GELIEHEN — UND ZURUECKGELEGT.
  //
  // Wer eine Lage stellt (/vorschau/…), muss sie am Ende wieder hinlegen,
  // wenn ihm die Vorschau nicht gehoert: sonst misst der naechste Lauf gegen
  // eine Vorschau, die jemand anders verstellt hat. Laeuft unter dem Ziel
  // noch keine, startet vorschauLeihen dort selbst die Attrappe und beendet
  // sie am Ende. Beides samt der Messungen dahinter: tools/leihgabe.mjs.
  const leihe = await vorschauLeihen(ziel)
  if (!ZIEL_ARG) {
    // Volle Bibliothek + laufende Wiedergabe: so viele Bedienelemente wie
    // moeglich im Bild — das Kind hat auch alle.
    await fetch(new URL('/vorschau/voll', ziel))
    await fetch(new URL('/vorschau/spielt', ziel))
  }

  const chrome = await eigenerBrowser().catch(async (e) => {
    // Scheitert der Browserstart, ist das finally unten noch nicht erreicht —
    // die geliehene Vorschau muss trotzdem zurueck, bevor der Abbruchsweg
    // (ABBRUCH, Ende 2) den Lauf beendet.
    await leihe.zurueckgeben()
    throw e
  })
  let ende = 1
  try {
    ws = new WebSocket(await chrome.seite())
    await new Promise((r) => ws.on('open', r))
    await senden('Runtime.enable')
    await senden('Page.enable')
    await senden('Network.enable')
    beobachten()

    console.log(`Klick-Sturm-Probe  ziel=${ziel}  saat=${SAAT}  runden=${RUNDEN}  tipps=${TIPPS}  abstand=${ABSTAND_MS}ms`)
    await senden('Page.navigate', { url: ziel })
    const bereit = await warteAuf(
      `!!document.getElementById('zustand') && (!document.getElementById('raster').hidden || !document.getElementById('zustand').hidden)`,
      'Seite bereit',
      12000,
    )
    if (!bereit) throw new Error('Die Seite kam gar nicht erst hoch — vor jedem Sturm.')

    seitenwechsel = 0 // die eigene Anfahrt zaehlt nicht als Befund
    const null0 = await orakel()
    if (!null0.ok) {
      console.error(`  ROT schon VOR dem ersten Sturm (${null0.schritt}) — das misst dann nicht den Sturm.`)
      console.error(JSON.stringify(await sezieren(), null, 2))
      return 1
    }
    console.log('  Nullprobe: Oberflaeche laedt (Orakel gruen).')

    // ERST NACH der Nullprobe zaeh werden: die Anfahrt der Seite soll schnell
    // sein, gemessen wird das Verhalten UNTER Last, nicht das Hochkommen.
    if (ZAEH_MS > 0) {
      await senden('Fetch.enable', {
        patterns: [{ urlPattern: '*/api/*' }, { urlPattern: '*/player/*' }],
      })
      console.log(`  Zaeh-Modus: /api/- und /player/-Antworten kommen ${ZAEH_MS} ms spaeter.`)
    }

    const ergebnisse = []
    for (let runde = 1; runde <= RUNDEN; runde++) {
      // ── Der Sturm ──
      for (let i = 0; i < TIPPS; i++) {
        let x
        let y
        if (wurf() < 0.7) {
          const ziele = await ev(ZIELE_AUSDRUCK).catch(() => [])
          if (ziele && ziele.length) {
            const z = ziele[Math.floor(wurf() * ziele.length)]
            // Zittern: ein Kinderfinger trifft nicht die Mitte.
            x = Math.max(0, Math.min(799, z.x + Math.round((wurf() - 0.5) * 24)))
            y = Math.max(0, Math.min(479, z.y + Math.round((wurf() - 0.5) * 24)))
          }
        }
        if (x === undefined) {
          x = Math.floor(wurf() * 800)
          y = Math.floor(wurf() * 480)
        }
        try {
          await tipp(x, y)
        } catch {
          /* Seite laedt gerade neu — der naechste Tipp trifft wieder */
        }
        await schlafen(ABSTAND_MS)
      }

      // ── Beruhigen: bis keine Anfrage mehr unterwegs ist. Im Zaeh-Modus
      // muss der Deckel die festgehaltenen Anfragen ueberdauern — sonst misst
      // das Orakel den Rueckstau, nicht die Klemme. ──
      const ruhe = Date.now() + (ZAEH_MS > 0 ? ZAEH_MS * 2 + 6000 : 6000)
      while (unterwegs.size > 0 && Date.now() < ruhe) await schlafen(200)
      if (unterwegs.size > 0) console.log(`    (Beruhigen: ${unterwegs.size} Anfragen weiterhin offen)`)

      // ── Das Orakel ──
      const erg = await orakel()
      if (erg.ok) {
        console.log(`  Runde ${runde}: erholt (Orakel gruen).`)
        ergebnisse.push(true)
      } else {
        console.error(`  Runde ${runde}: STECKT (${erg.schritt}). Sektion:`)
        console.error(JSON.stringify(await sezieren(), null, 2))
        ergebnisse.push(false)
      }
    }

    const rot = ergebnisse.filter((e) => !e).length
    if (ausnahmen.length) {
      console.log(`  Seiten-Ausnahmen waehrend des Laufs (${ausnahmen.length}):`)
      for (const a of [...new Set(ausnahmen)].slice(0, 8)) console.log(`    - ${a}`)
    }
    if (seitenwechsel) console.log(`  Seiten-Neuladungen waehrend des Sturms: ${seitenwechsel} (Profilwechsel-Weg?)`)
    console.log(
      rot === 0
        ? `GRUEN: ${RUNDEN} Runden a ${TIPPS} Tipps — die Oberflaeche hat sich jedes Mal erholt.`
        : `ROT: ${rot} von ${RUNDEN} Runden blieben stecken (Saat ${SAAT} zum Nachfahren).`,
    )
    ende = rot === 0 ? 0 : 1
  } finally {
    try {
      ws?.close()
    } catch {
      /* egal */
    }
    await chrome?.schliessen()
    // IM `finally`: Ein Werkzeug, das nur auf dem gruenen Weg aufraeumt, laesst
    // die geliehene Vorschau gerade dann verstellt stehen, wenn es einen Fehler
    // gefunden hat — also genau dann, wenn als naechstes jemand hinsieht. Die
    // eigene Attrappe wird auf demselben Weg beendet.
    await leihe.zurueckgeben()
  }
  return ende
}

haupt().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`ABBRUCH: ${e.message}`)
    process.exit(2)
  },
)
