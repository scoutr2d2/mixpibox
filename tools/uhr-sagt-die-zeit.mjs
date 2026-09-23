#!/usr/bin/env node
/**
 * DIE UHR SAGT DIE ZEIT — gemessen an der echten Seite.
 *
 * ══ WOZU ════════════════════════════════════════════════════════════════
 *
 * Betreiber, 20.09.2026: „ich moechte einen schalter in beiden menues haben
 * uhrzeit beim anklicken vorlesen."
 *
 * ES GIBT DREI SACHEN, DIE MAN HIER GLAUBEN KANN UND NICHT SEHEN:
 *
 *   1. DASS DER TIPP ANKOMMT. `.kopf-mitte` hat `pointer-events: none`
 *      (app.css) — die Kopfmitte laesst Beruehrungen absichtlich durch, damit
 *      die Zahlen dort nicht das Regal dahinter abschirmen. Eine Uhr, die
 *      nicht ausdruecklich `pointer-events: auto` zurueckholt, sieht antippbar
 *      aus und ist es NICHT. Am Bildschirm ist dieser Fehler unsichtbar: die
 *      Uhr steht ja da.
 *   2. DASS UEBERHAUPT ETWAS GESAGT WIRD. Sprache ist der einzige Ausgang
 *      dieser Box, der kein Pixel bewegt — genau deshalb gab es das Vorlesen
 *      hier einmal eingebaut, verdrahtet, dokumentiert UND stumm [llmwiki
 *      vorlesen-beim-halten].
 *   3. DASS DER SATZ ZUR ANZEIGE PASST. Steht oben 15:43 und die Box sagt
 *      „Es ist 16 Uhr 43", klingt das genauso ueberzeugt wie die Wahrheit —
 *      und wer die Ansage braucht, kann die Ziffern nicht lesen.
 *
 * ══ UND DIE GEGENRICHTUNG IST DIE HAELFTE, DIE MAN VERGISST ═════════════
 *
 * Steht der Schalter auf AUS, darf ein Tipp auf die Uhr NICHTS sagen — und
 * ausserdem nichts abfangen, was an das Regal dahinter geht. Ohne diese
 * Messung bestuende die erste auch dann, wenn die Uhr immer spricht.
 *
 * GEMESSEN WIRD DER SATZ AN DER ATTRAPPE (`/vorschau/gesprochen`), nicht am
 * Lautsprecher: Die Vorschau schreibt jeden Text mit, den die Seite an
 * `/api/vorlesen/sprich` schickt. Vor jedem Abschnitt wird es ausdruecklich
 * geleert (`/vorschau/gesprochen-leeren`) — Lesen allein leert es NICHT, und
 * ein Satz von vorhin saehe wie die Antwort auf den naechsten Tipp aus.
 *
 * MIT EINEM ECHTEN FINGER (tools/finger.mjs, `Input.dispatchTouchEvent`) und
 * nicht mit `element.click()`: Ein `click()` aus dem Skript umgeht `hidden`,
 * `pointer-events` und jede Trefferflaeche — es haette also genau die Frage
 * nicht gestellt, um die es unter 1. geht.
 *
 * AUFRUF
 *     node tools/uhr-sagt-die-zeit.mjs
 *     node tools/uhr-sagt-die-zeit.mjs --pruefen      (nur Bilanz, Exit 1 bei rot)
 *     node tools/uhr-sagt-die-zeit.mjs http://127.0.0.1:9000/neu/
 *
 * WAS ES AENDERT: Es stellt in der VORSCHAU `uhrzeit` und `uhrzeitSprechen`
 * (POST /vorschau/lage) und gibt die geliehene Vorschau danach zurueck. An der
 * Box wird nichts angefasst.
 */
import WebSocket from 'ws'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'
import { KIOSK_SCHALTER, fingerAufbau, tippen } from './finger.mjs'

const ZIEL = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const PRUEFEN = process.argv.includes('--pruefen')

/** Frist fuer eine Ansage. Die Attrappe antwortet sofort; die Luft ist fuer
 *  den Warmlauf, der beim Seitenaufbau jede Kachel einmal holt. */
const ANSAGE_FRIST = 8000

const leihe = await vorschauLeihen(ZIEL)
const brw = await eigenerBrowser({ fenster: '800,480', zusatz: KIOSK_SCHALTER }).catch(async (e) => {
  await leihe.zurueckgeben()
  console.error(`  Browser kam nicht hoch — Messung nicht moeglich: ${e.message}`)
  process.exit(2)
})
if (!brw) {
  await leihe.zurueckgeben()
  console.log('  kein Browser gefunden — uebersprungen')
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

const warte = (ms) => new Promise((r) => setTimeout(r, ms))
let fehler = 0
const melde = (z) => {
  fehler++
  console.error(`  FEHLER  ${z}`)
}
const zeile = (n, w) => {
  if (!PRUEFEN) console.log(`  ${String(n).padEnd(46)} ${w}`)
}

const holen = async (pfad) => {
  const a = await fetch(new URL(pfad, ZIEL)).catch(() => null)
  return a ? await a.json().catch(() => null) : null
}

/**
 * DIE SCHALTER DER DARSTELLUNG IN DER VORSCHAU STELLEN.
 *
 * ERST LESEN, DANN ZUSAMMENFUEHREN: `POST /vorschau/lage` legt `darstellung`
 * mit `Object.assign` hin, `aktuell` wird also ganz ERSETZT. Wer nur zwei
 * Felder schickt, nimmt der Vorschau alle anderen — und dann messen die
 * naechsten Zeilen eine Seite, die nebenher auf Werkseinstellung gefallen ist.
 */
async function stellen(felder) {
  const alt = await holen('/vorschau/lage')
  const aktuell = { ...(alt?.darstellung?.aktuell || {}), ...felder }
  const a = await fetch(new URL('/vorschau/lage', ZIEL), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...(alt || {}), darstellung: { ...(alt?.darstellung || {}), aktuell } }),
  }).catch(() => null)
  return !!a && a.ok
}

/** Das Sprechprotokoll leeren — es leert sich beim Lesen NICHT von selbst. */
const leeren = () => holen('/vorschau/gesprochen-leeren')

/** Alles Gesprochene abholen (ohne zu leeren). */
async function gesprochen() {
  const j = await holen('/vorschau/gesprochen')
  const roh = Array.isArray(j?.gesprochen) ? j.gesprochen : []
  // NUR ECHTE ANSAGEN: Der Warmlauf holt dieselbe Naht ohne `abspielen`, um
  // die WAV in den Zwischenspeicher zu legen. Wer ihn mitzaehlt, misst das
  // Vorheizen und nicht den Tipp (derselbe Flatterfund wie in
  // tools/auswahl-sagt-sich-an.mjs).
  return roh.filter((e) => e && e.abspielen === true).map((e) => String(e.text || ''))
}

/** Warten, bis das Sprechprotokoll zur Ruhe kommt (Warmlauf durch). */
async function warmlaufAbwarten(msMax = 25000) {
  let letzte = -1
  let seit = Date.now()
  const ende = Date.now() + msMax
  for (;;) {
    const j = await holen('/vorschau/gesprochen')
    const n = Array.isArray(j?.gesprochen) ? j.gesprochen.length : 0
    if (n !== letzte) {
      letzte = n
      seit = Date.now()
    } else if (Date.now() - seit > 1200) return true
    if (Date.now() > ende) return false
    await warte(250)
  }
}

async function bis(pruef, msMax, takt = 150) {
  const ende = Date.now() + msMax
  for (;;) {
    const w = await pruef()
    if (w) return w
    if (Date.now() > ende) return null
    await warte(takt)
  }
}

/**
 * DER SATZ, DEN DIE SEITE JETZT SAGEN MUESSTE — nach DERSELBEN Regel.
 *
 * Nachgebaut waere er hier eine zweite Fassung von `uhrSatz`, die ohne ein Rot
 * auseinanderlaufen kann. Deshalb kommt sie aus dem Auszug, den
 * tools/pruef-neu-regeln.js ohnehin aus app.js erzeugt.
 */
const { uhrSatz } = await import('./neu-regelnfns-auszug.js').then((m) => m.default ?? m)

try {
  await warte(1200)
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await fingerAufbau(ws, send)
  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value

  /** Lage der Uhr am Schirm: sichtbar? antippbar? wie gross? was steht da? */
  const uhrLage = () =>
    ev(`(() => {
      const u = document.getElementById('km-uhr')
      if (!u) return null
      const r = u.getBoundingClientRect()
      return {
        versteckt: u.hidden,
        klasse: u.classList.contains('km-sprechend'),
        rolle: u.getAttribute('role') || '',
        zeiger: getComputedStyle(u).pointerEvents,
        text: (u.textContent || '').trim(),
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 2),
        b: Math.round(r.width),
        h: Math.round(r.height),
      }
    })()`)

  async function frisch() {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(2500)
    await warmlaufAbwarten()
  }

  /* ══ 1. UHR AN, ANSAGE AN ═══════════════════════════════════════════════ */
  if (!(await stellen({ uhrzeit: true, uhrzeitSprechen: true }))) {
    melde('die Vorschau nahm die Darstellung nicht an (POST /vorschau/lage)')
  }
  await frisch()

  let lage = await bis(async () => {
    const l = await uhrLage()
    return l && !l.versteckt ? l : null
  }, 8000)
  if (!lage) {
    melde('die Uhr wurde bei uhrzeit=true nicht sichtbar — alles Weitere ist nicht messbar')
  } else {
    zeile('Uhr steht oben', `"${lage.text}" bei ${lage.x}/${lage.y}`)
    if (!/^\d{2}:\d{2}$/.test(lage.text)) melde(`die Uhr zeigt "${lage.text}" und nicht HH:MM`)
    if (!lage.klasse) melde('die Klasse km-sprechend fehlt, obwohl uhrzeitSprechen an ist')
    if (lage.zeiger !== 'auto') melde(`pointer-events ist "${lage.zeiger}" — ein Tipp kommt dort nicht an`)
    if (lage.rolle !== 'button') melde(`role ist "${lage.rolle}" statt "button"`)
    zeile('Trefferflaeche', `${lage.b}x${lage.h} px`)
    // 9-MM-REGEL, dieselbe wie bei den Knoepfen der Kopfzeile (index.html):
    // 34 px sind auf 800x480 rund 5 mm — weniger ist fuer einen Kinderfinger
    // zu wenig, und die Uhr selbst ist nur rund 20 px hoch.
    if (lage.h < 34) melde(`die Trefferflaeche ist nur ${lage.h} px hoch — zu wenig fuer einen Finger`)
    if (lage.b < 60) melde(`die Trefferflaeche ist nur ${lage.b} px breit`)

    await leeren()
    // DER SATZ WIRD VOR DEM TIPP FESTGEHALTEN, nicht danach: zwischen Tipp und
    // Auswertung kann die Minute umschlagen, und dann verglichen wir eine
    // richtige Ansage mit einer frischeren Uhr.
    const d = new Date()
    const soll = new Set([uhrSatz(d.getHours(), d.getMinutes())])
    await tippen(ws, send, lage.x, lage.y)
    const saetze = await bis(async () => {
      const g = await gesprochen()
      return g.length ? g : null
    }, ANSAGE_FRIST)
    // Die Minute kann WAEHREND der Messung umschlagen — dann ist auch der
    // Satz der naechsten Minute richtig. Beide gelten, und keiner sonst.
    const d2 = new Date()
    soll.add(uhrSatz(d2.getHours(), d2.getMinutes()))
    if (!saetze) {
      melde('der Tipp auf die Uhr sagte NICHTS')
    } else {
      zeile('gesagt', saetze.map((s) => `"${s}"`).join(' | '))
      if (saetze.length !== 1) melde(`${saetze.length} Ansagen auf EINEN Tipp`)
      if (!soll.has(saetze[0])) {
        melde(`gesagt wurde "${saetze[0]}", erwartet war ${[...soll].map((s) => `"${s}"`).join(' oder ')}`)
      }
      // UND DER SATZ MUSS ZUR ANZEIGE PASSEN. Die Ziffern am Schirm und die
      // Zahlen im Satz kommen aus zwei getrennten Rechnungen; genau zwischen
      // ihnen liegt der Fehler, den niemand sehen kann.
      const nachLage = await uhrLage()
      const [hh, mm] = String(nachLage?.text || '').split(':')
      const zumSchirm = uhrSatz(Number(hh), Number(mm))
      if (saetze[0] !== zumSchirm) melde(`am Schirm steht ${nachLage?.text}, gesagt wurde "${saetze[0]}"`)
    }
  }

  /* ══ 2. UHR AN, ANSAGE AUS — sie muss schweigen UND durchlassen ═════════ */
  if (!(await stellen({ uhrzeit: true, uhrzeitSprechen: false }))) melde('Vorschau nahm die zweite Lage nicht an')
  await frisch()
  const aus = await bis(async () => {
    const l = await uhrLage()
    return l && !l.versteckt ? l : null
  }, 8000)
  if (!aus) {
    melde('bei uhrzeitSprechen=false war die Uhr gar nicht zu sehen')
  } else {
    if (aus.klasse) melde('die Klasse km-sprechend steht noch, obwohl die Ansage aus ist')
    if (aus.zeiger !== 'none') melde(`pointer-events ist "${aus.zeiger}" — die Uhr faengt Tipps ab, die ans Regal gehen`)
    if (aus.rolle) melde(`role="${aus.rolle}" bei ausgeschalteter Ansage — eine Sprachausgabe kuendigt einen Knopf an, den es nicht gibt`)
    await leeren()
    await tippen(ws, send, aus.x, aus.y)
    await warte(1200)
    const still = await gesprochen()
    zeile('Ansage aus: gesagt', still.length ? still.join(' | ') : '(nichts)')
    if (still.length) melde(`bei ausgeschalteter Ansage wurde gesprochen: ${still.join(' | ')}`)

    /* ══ UND JETZT DER ZWEITE RIEGEL, EINZELN ═══════════════════════════════
     *
     * DAS IST EIN GEGENPROBEN-FUND VOM 20.09.2026: Ausgeschaltet halten die
     * Uhr ZWEI Riegel still — das fehlende `pointer-events: auto` (der Finger
     * kommt nicht an) UND die Pruefung in `ansagen()`. Solange der erste haelt,
     * ist der zweite mit einem Finger GAR NICHT messbar: Eine Sabotage, die
     * `ansagen()` den Schalter ignorieren liess, blieb gruen
     * [llmwiki gegenprobe-bleibt-gruen-ist-der-fund].
     *
     * `element.click()` umgeht Trefferflaeche und `pointer-events` und ruft den
     * Hoerer unmittelbar. Genau deshalb ist es fuer die Messung DARUEBER
     * falsch und hier richtig: Es fragt allein, ob die Oberflaeche auch dann
     * schweigt, wenn der Tipp sie doch erreicht — etwa durch eine
     * Tastaturbedienung oder eine kuenftige zweite Trefferflaeche.
     */
    await leeren()
    await ev(`document.getElementById('km-uhr').click()`)
    await warte(1200)
    const trotzdem = await gesprochen()
    zeile('Ansage aus: auch am Hoerer vorbei', trotzdem.length ? trotzdem.join(' | ') : '(nichts)')
    if (trotzdem.length) {
      melde(`der Hoerer spricht trotz ausgeschalteter Ansage: ${trotzdem.join(' | ')}`)
    }
  }

  /* ══ 3. UHR AUS — nichts zu sehen, nichts zu tippen ════════════════════ */
  if (!(await stellen({ uhrzeit: false, uhrzeitSprechen: true }))) melde('Vorschau nahm die dritte Lage nicht an')
  await frisch()
  const weg = await uhrLage()
  zeile('Uhr aus', weg ? (weg.versteckt ? 'versteckt' : 'SICHTBAR') : '(kein Element)')
  if (weg && !weg.versteckt) melde('die Uhr steht da, obwohl uhrzeit=false — dann sagt sie auch etwas')
  if (weg && weg.klasse) melde('km-sprechend an einer ausgeblendeten Uhr: ein Sprechknopf, den niemand sieht')

  await brw.schliessen()
  ws.close()
} finally {
  await leihe.zurueckgeben()
}

console.log(fehler ? `\n  ${fehler} FEHLER` : '\n  die Uhr sagt die Zeit, und nur wenn sie soll')
process.exitCode = fehler ? 1 : 0
