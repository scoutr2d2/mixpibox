#!/usr/bin/env node
// Sieht nach, ob die Spielt-Anzeige sich WIRKLICH bewegt — und ob der
// Schalter aus der Verwaltung sie WIRKLICH anhaelt.
//
// SEIT DEM 12.09.2026 MISST DAS DEN LAUFENDEN RAHMEN, NICHT MEHR DIE BALKEN.
// Der Rahmen hat die Marke am 11.09.2026 ERSETZT (app.css: `.spielt-marke {
// display: none }`, Betreiber: „die spiel marke … ersetzen mit einem
// laufenden rahmen um das cover"). Diese Wache mass danach weiter die
// Balkenhoehen eines tot gestellten Elements — Hoehe 0, „bewegt=false", und
// stand DAUERROT fuer heilen Code. Eine dauerrote Wache ist keine: sie
// verdeckt den naechsten echten Fund (llmwiki `dauerrote-wache-ist-keine`).
//
// WOZU ES DIE WACHE GIBT (unveraendert): Eine Animation ist die Sorte
// Aenderung, die man fuer geprueft haelt, weil man sie einmal gesehen hat.
// Der Schalter stellt nichts still, wenn die Klasse am falschen Element
// haengt oder das Feld gar nicht ankommt; die Attrappe muss `ruhigeMarke`
// ueberhaupt liefern, sonst misst man den Vorgabewert
// [attrappe-luegt-durch-weglassen].
//
// GEMESSEN WIRD DIE WIRKLICHE BEWEGUNG UEBER DIE ZEIT: der Rahmen dreht den
// WINKEL des Verlaufs (`--cover-rahmen-winkel`, als `@property <angle>`
// registriert und darum animierbar UND im getComputedStyle des `::before`
// als Momentanwert ablesbar). Zwei Ablesungen im Abstand von 250 ms; steht
// der Winkel, bewegt sich nichts. Das ist dieselbe „nach der Wirkung
// gemessen"-Idee wie vorher die Balkenhoehe nach der Transformation — nur am
// Traeger, der heute wirklich zu sehen ist.
//
// WAS ES NICHT PRUEFT: ob es huebsch aussieht (das sagt nur ein Blick) und
// ob der Rahmen an der richtigen Kachel ERSCHEINT — dafuer gibt es
// tools/lane-marken-schau.mjs und tools/marke-ohne-eigenen-start.mjs. Hier
// wird eine Probe-Kachel selbst eingesetzt und durchlaeuft dieselben
// CSS-Regeln.
//
// AUFRUF
//     node tools/marke-tanzt.mjs
//     node tools/marke-tanzt.mjs --pruefen    (Ende 1 bei Abweichung)
//
// Rueckgabe: 0 = wie erwartet, 1 = Abweichung, 2 = Messung nicht moeglich.
import WebSocket from 'ws'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const ZIEL = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const PRUEFEN = process.argv.includes('--pruefen')

// EINE SCHON LAUFENDE VORSCHAU WIRD GELIEHEN — UND ZURUECKGELEGT.
//
// Wer eine Lage stellt (/vorschau/…), muss sie am Ende wieder hinlegen,
// wenn ihm die Vorschau nicht gehoert: sonst misst der naechste Lauf gegen
// eine Vorschau, die jemand anders verstellt hat. Und der eigene Browser
// laeuft auf einem FREIEN Port mit eigenem Profil statt auf einer festen
// Nummer, die ein Ueberlebender eines harten Abbruchs noch halten koennte —
// `/json/list` liefert dann klaglos die Ziele des fremden.
// Beides samt der Messungen dahinter: tools/leihgabe.mjs.
const leihe = await vorschauLeihen(ZIEL)
const brw = await eigenerBrowser({ fenster: '800,480' }).catch(async (e) => {
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
/** „Messung nicht moeglich" (Ende 2) — gesetzt, wenn die geliehene Vorschau
 *  die gestellte Lage gar nicht ausliefert. Siehe den Block in der Schleife. */
let unmoeglich = false
const melde = (zeile) => {
  fehler++
  console.error(`  FEHLER  ${zeile}`)
}

// Auf den Browser warten muss hier niemand mehr: `eigenerBrowser()` kehrt erst
// zurueck, wenn eine Seite da ist UND nachgewiesen ist, dass der Port dem
// eigenen Browser gehoert — vorher stand hier eine Warteschleife auf der festen
// Nummer 9351, die genau das nicht unterscheiden konnte.
const ws = new WebSocket(await brw.seite())
await new Promise((r) => ws.on('open', r))
await send(ws, 'Page.enable')
await send(ws, 'Runtime.enable')

const werte = async (js) =>
  (await send(ws, 'Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true })).result.value

/** Der Momentanwert des Rahmen-Winkels am ::before der Probe-Kachel. */
const WINKEL = `(() => {
  const b = document.querySelector('.marke-probe .kachel-bild')
  if (!b) return null
  const roh = getComputedStyle(b, '::before').getPropertyValue('--cover-rahmen-winkel')
  const zahl = Number.parseFloat(roh)
  return Number.isFinite(zahl) ? Math.round(zahl * 100) / 100 : null
})()`

// DIE REIHENFOLGE IST DER GRUND FUER DAS `finally`. Dieses Werkzeug lief seine
// zwei Faelle bis zum 04.08.2026 in der Folge `marke-bewegt`, `marke-ruhig`
// durch und ging nach dem LETZTEN heim; die geliehene Vorschau stand danach
// dauerhaft auf „Bewegung abgeschaltet". tools/raster-marke-schau.mjs misst
// genau diese Bewegung und meldete daran prompt zwei Fehler, die es nicht gab.
try {
  /* ══ ES MUSS ETWAS LAUFEN, SONST STEHT DIE MARKE MIT RECHT ══════════════
   *
   * AM 20.09.2026 GEFUNDEN, und zwar an einem falschen Roten: Dieses
   * Werkzeug meldete `marke-bewegt: bewegt=false`, und der Code war heil.
   *
   * `body.ton-pausiert .spielt .kachel-bild::before { animation-play-state:
   * paused }` — die Marke haelt an, wenn der Ton pausiert. Das ist gewollt
   * („ein laufender Rahmen an einer stummen Box waere eine falsche
   * Auskunft"). Eine frisch gestartete Vorschau spielt NICHTS, also steht
   * die Marke, also misst dieses Werkzeug Null.
   *
   * GRUEN WAR ES BIS DAHIN AUS ZUFALL: Wer vorher misst, laesst oft etwas
   * laufen, und die geliehene Vorschau trug das weiter. Die Messung hing
   * damit an dem, was sie VORFAND, statt an dem, was sie STELLT — dieselbe
   * Krankheit wie in [[vorschau-wird-geliehen]] beschrieben, nur
   * andersherum: nicht ein falsches Rot, sondern ein unverdientes Gruen.
   *
   * Nachgemessen (20.09.2026): ohne `spielt` vorher 0 / nachher 0; mit
   * `spielt` vorher 39,23 / nachher 73,84. Dieselbe Minute, derselbe Baum.
   *
   * Zurueckgelegt wird es unten im `finally` zusammen mit dem Rest.
   */
  await fetch(new URL('/vorschau/spielt', ZIEL))

  for (const [lage, soll] of [
    ['marke-bewegt', true],
    ['marke-ruhig', false],
  ]) {
    await fetch(new URL(`/vorschau/${lage}`, ZIEL))
    // ══ DER SCHALTER MUSS AUCH BEIM LESER ANKOMMEN — NICHT NUR IN DER LAGE ══
    //
    // GEMESSEN, NICHT BEFUERCHTET (31.08.2026, im E95/V-Stufe-2-Lauf als
    // „marke-ruhig: bewegt=true" gemeldet und hier nachgestellt): Sobald
    // irgendwer der geliehenen Vorschau einmal `PUT /api/darstellung`
    // geschickt hat (Menue-Werkzeuge, ein Eltern-Bereich-Besuch), gilt dort
    // DARSTELLUNG.geschrieben — und die Lage-Schalter `/vorschau/marke-*`
    // erreichen `/api/darstellung` NIE MEHR. Der Schnappschuss der Leihgabe
    // kennt dieses Feld nicht, das Zuruecklegen heilt es also auch nicht.
    // Dieses Werkzeug mass dann eine tanzende Marke, hielt sie fuer den
    // Befund und meldete Rot fuer heilen Code — dieselbe Bauart wie
    // [veraltete-vorschau-meldet-falsches-rot], nur mit geschriebener statt
    // veralteter Attrappe. Deshalb: erst fragen, was der Leser der Seite
    // WIRKLICH serviert bekommt; weicht es von der gestellten Lage ab, ist
    // die Messung NICHT MOEGLICH (Ende 2, wie „kein Browser"), kein Befund.
    // KEIN `process.exit` an dieser Stelle: es uebersprange das `finally`,
    // und Browser wie geliehene Lage blieben stehen.
    let serviert = null
    try {
      serviert = await (await fetch(new URL('/api/darstellung', ZIEL))).json()
    } catch {
      /* bleibt null und faellt gleich als „unmoeglich" auf */
    }
    if (!serviert || (serviert.aktuell || {}).ruhigeMarke !== !soll) {
      console.error(`  FEHLER  /vorschau/${lage} kommt bei /api/darstellung nicht an — die Vorschau traegt`)
      console.error('          eine GESCHRIEBENE Darstellung (DARSTELLUNG.geschrieben), die Lage-Schalter')
      console.error('          sind wirkungslos. Erst die Vorschau neu starten, dann messen.')
      unmoeglich = true
      break
    }
    await send(ws, 'Page.navigate', { url: new URL('/neu/', ZIEL).href })
    await warte(2500)

    // DIE PROBE-KACHEL WIRD HIER SELBST EINGESETZT, statt sie zu erspielen.
    //
    // Das ist Absicht und die Grenze dieses Werkzeugs: Ob der Rahmen an der
    // richtigen Kachel ERSCHEINT, messen lane-marken-schau und
    // marke-ohne-eigenen-start — und zwar gruendlicher, als es hier nebenbei
    // ginge. Neu ist die BEWEGUNG und der Schalter, und beides haengt allein
    // an der CSS-Regel (`.spielt .kachel-bild::before`) und der Klasse am
    // `body`. Ein eingesetztes Element durchlaeuft genau dieselben Regeln.
    //
    // Der erste Anlauf wollte sich die Marke erspielen (Kachel antippen, Album
    // antippen, auf den Zustandstakt warten) und fand keine — die Vorschau
    // laesst nicht jedes Werk laufen. Gemessen haette man dann gar nichts und
    // haette es fuer ein Ergebnis gehalten.
    await werte(`(() => {
    document.querySelectorAll('.marke-probe').forEach((e) => e.remove())
    const m = document.createElement('div')
    m.className = 'spielt marke-probe'
    const bild = document.createElement('div')
    bild.className = 'kachel-bild'
    m.appendChild(bild)
    document.body.appendChild(m)
    return 1
  })()`)
    await warte(300)

    const a = await werte(WINKEL)
    await warte(250)
    const b = await werte(WINKEL)
    // Der Rahmen dreht 360 Grad in 2,6 s — in 250 ms also gut 34 Grad. Ein
    // Grad Schwelle trennt „laeuft" sicher von Rundungsrauschen.
    const bewegt = a != null && b != null && Math.abs(a - b) > 1

    if (!PRUEFEN) {
      console.log(`  ${lage.padEnd(14)} vorher ${JSON.stringify(a)}  nachher ${JSON.stringify(b)}`)
      console.log(`  ${''.padEnd(14)} bewegt sich: ${bewegt ? 'ja' : 'nein'}   erwartet: ${soll ? 'ja' : 'nein'}`)
    }
    if (bewegt !== soll) melde(`${lage}: bewegt=${bewegt}, erwartet=${soll}`)
  }
} finally {
  // IM `finally`: Ein Werkzeug, das nur auf dem gruenen Weg aufraeumt, laesst
  // die geliehene Vorschau gerade dann verstellt stehen, wenn es einen Fehler
  // gefunden hat — also genau dann, wenn als naechstes jemand hinsieht.
  ws.close()
  await brw.schliessen()
  await leihe.zurueckgeben()
}
if (unmoeglich) process.exit(2)
if (!fehler && !PRUEFEN) console.log('  Marke und Schalter verhalten sich wie erwartet.')
process.exit(fehler ? 1 : 0)
