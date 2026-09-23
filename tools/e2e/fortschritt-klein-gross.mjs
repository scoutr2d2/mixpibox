/**
 * Springt die Fortschrittsleiste - und wenn ja, in WELCHER Ansicht?
 *
 * WOFUER (gemeldet 2026-07-28): "der Fortschritt springt beim Pummeleinhorn im
 * Player, jedoch im Mini nicht". Beide Ansichten bekommen dieselben Meldungen,
 * rechnen aber getrennt weiter - der Unterschied muss also in der Rechnung
 * liegen. Statt zu raten wird hier in BEIDEN Ansichten mitgeschrieben, was
 * wirklich angezeigt wird.
 *
 * AUFRUF:  node tools/e2e/fortschritt-klein-gross.mjs [https://mupibox:8443]
 */
import WebSocket from 'ws'
import { eigenerBrowser } from '../leihgabe.mjs'

const ZIEL = process.argv[2] || 'https://192.168.178.48:8443'
const PROBEN = 24 // rund 12 Sekunden je Ansicht
const TAKT_MS = 500

// DER DEBUG-PORT WIRD ERFRAGT, NICHT GEWAEHLT.
//
// Hier stand bis zum 04.08.2026 eine feste Nummer — und sie war nicht einmal
// eindeutig: dieselbe 9351 trug tools/marke-tanzt.mjs, dieselbe 9353
// tools/marke-am-geraet.mjs. Ein fester Port ist doppelt gefaehrlich: Ein
// Browser, der einen harten Abbruch ueberlebt hat, HAELT ihn; der eigene
// bindet ihn dann NICHT und sagt darueber nichts; und `/json/list` liefert
// klaglos die Ziele des FREMDEN. Gemessen wird danach eine Seite, die dieses
// Werkzeug nie geoeffnet hat. `eigenerBrowser()` (tools/leihgabe.mjs) holt
// einen freien Port, gibt dem Browser ein eigenes Profil — und weist nach,
// dass der Browser hinter dem Port der eigene ist.
const brw = await eigenerBrowser({ zusatz: ['--ignore-certificate-errors'] }).catch((e) => {
  console.log(`  Browser kam nicht hoch - uebersprungen: ${e.message}`)
  process.exit(0)
})
if (!brw) {
  console.log('  kein Browser gefunden - uebersprungen')
  process.exit(0)
}
let id = 0
const send = (ws, m, p = {}) =>
  new Promise((ok, no) => {
    const i = ++id
    ws.send(JSON.stringify({ id: i, method: m, params: p }))
    const h = (r) => {
      const x = JSON.parse(r)
      if (x.id !== i) return
      ws.off('message', h)
      x.error ? no(new Error(x.error.message)) : ok(x.result)
    }
    ws.on('message', h)
  })

/** Sprünge zählen: was ist zwischen zwei Proben passiert? */
function auswerten(name, werte, taktMs) {
  const echte = werte.filter((w) => typeof w === 'number')
  if (echte.length < 5) return { name, ok: false, text: 'zu wenige Messwerte' }
  let rueck = 0,
    gross = 0,
    steht = 0,
    maxSchritt = 0
  for (let i = 1; i < echte.length; i++) {
    const d = echte[i] - echte[i - 1]
    if (d < -0.05) rueck++
    else if (d === 0) steht++
    if (d > maxSchritt) maxSchritt = d
  }
  // Bei einem Titel von N Sekunden entspricht ein Takt (taktMs) einem
  // erwartbaren Zuwachs. Ein Vielfaches davon ist ein sichtbarer Sprung.
  const schnitt = (echte[echte.length - 1] - echte[0]) / (echte.length - 1)
  for (let i = 1; i < echte.length; i++) {
    const d = echte[i] - echte[i - 1]
    if (schnitt > 0 && d > schnitt * 4) gross++
  }
  // ER MUSS SICH AUCH BEWEGEN. "Keine Ruecksprünge" trifft auch auf einen
  // Balken zu, der stillsteht - und genau so hat dieser Test eine selbst
  // gebaute Verschlimmerung durchgewinkt: die grosse Ansicht stand auf 0,00
  // und galt als "ruhig". Ein Test, der Stillstand fuer Ruhe haelt, ist
  // schlimmer als keiner.
  const gewandert = echte[echte.length - 1] - echte[0]
  const bewegt = gewandert > 0.05
  const ok = rueck === 0 && gross === 0 && bewegt
  return {
    name,
    ok,
    rueck,
    gross,
    steht,
    bewegt,
    text: bewegt
      ? `${echte.length} Proben, ${rueck} rueckwaerts, ${gross} Spruenge, +${gewandert.toFixed(2)} % gewandert`
      : `STEHT STILL bei ${echte[0]?.toFixed(2)} % - der Balken bewegt sich gar nicht`,
  }
}

try {
  await new Promise((r) => setTimeout(r, 1500))
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.navigate', { url: ZIEL })
  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value
  await new Promise((r) => setTimeout(r, 9000))

  // KLEIN: die Leiste zeigt den Fortschritt in der Breite ihres Balkens.
  const kleinWerte = []
  for (let i = 0; i < PROBEN; i++) {
    kleinWerte.push(
      await ev(`(()=>{const b=document.querySelector('app-now-playing-bar .npb-fortschritt i, app-now-playing-bar ion-range');
      if(!b) return null; if(b.tagName==='ION-RANGE') return Number(b.value)||0;
      return parseFloat(getComputedStyle(b).width)||0})()`),
    )
    await new Promise((r) => setTimeout(r, TAKT_MS))
  }

  // GROSS: dieselbe Messung auf der Player-Seite.
  await ev(`document.querySelector('app-now-playing-bar .npb-cover').closest('div').click()`)
  await new Promise((r) => setTimeout(r, 3000))
  const grossWerte = []
  for (let i = 0; i < PROBEN; i++) {
    grossWerte.push(
      await ev(`(()=>{const r=document.querySelector('app-player ion-range.mupi-fortschritt');
      return r? Number(r.value) : null})()`),
    )
    await new Promise((r) => setTimeout(r, TAKT_MS))
  }

  const a = auswerten('klein', kleinWerte, TAKT_MS)
  const b = auswerten('gross', grossWerte, TAKT_MS)
  for (const e of [a, b]) console.log(`  ${e.name.padEnd(6)} ${e.ok ? 'ruhig' : 'SPRINGT'}  ${e.text}`)
  process.exitCode = a.ok && b.ok ? 0 : 1
  ws.close()
} catch (e) {
  console.log(`  FEHLER: ${e.message}`)
  process.exitCode = 1
} finally {
  await brw.schliessen()
}

// AUFRAEUMEN: dieser Test laesst die Box tief in der Bibliothek stehen. Der
// Weg ist derselbe, den die Box ohnehin geht (sie fragt einmal je Minute nach
// ihrem Stand und laedt bei einer Aenderung neu) - kein F5 von aussen, kein
// Kiosk-Neustart. Schlaegt es fehl, ist das kein Testfehler: gemessen wurde
// trotzdem richtig.
try {
  // ADRESSE BEWUSST NEU BAUEN: die Oberflaeche laeuft ueber https auf 8443,
  // die API ueber PLAIN http auf 8200. Ein blosses Ersetzen des Ports ergab
  // 'https://box:8200' - das warf, der catch schluckte es, und das Aufraeumen
  // blieb still aus. Ein stiller Fehlschlag ist schlimmer als gar keiner.
  const api = `http://${new URL(ZIEL).hostname}:8200/api/oberflaeche/neuladen`
  const a = await fetch(api, { method: 'POST' })
  console.log(
    a.ok
      ? '  Aufgeraeumt: die Box laedt ihre Oberflaeche neu'
      : `  Aufraeumen fehlgeschlagen (HTTP ${a.status}) - die Box bleibt stehen, wo sie ist`,
  )
} catch (e) {
  // Kein Testfehler: gemessen wurde trotzdem richtig. Aber sichtbar.
  console.log(`  Aufraeumen nicht moeglich: ${e?.message || e}`)
}
