#!/usr/bin/env node
/**
 * WO SITZT DAS VORLESE-ZEICHEN, UND VERDECKT ES ETWAS? — gemessen, nicht geglaubt.
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 * Betreiber, 06.09.2026: „der vorlese button soll auf die cover oben links in
 * die ecke". Vorher war es eine Leiste ueber die volle Kachelbreite am unteren
 * Rand, und die Begruendung im CSS behauptete, die Ecken seien vergeben
 * („Plaketten links, Play rechts"). NACHGEMESSEN stimmte das nicht:
 * `.kachel-marken` sitzt UNTEN links (`bottom: 6px`), die Fehlt-Schaerpe
 * mittig — oben links war immer frei.
 *
 * Genau darum gibt es dieses Werkzeug: Die Behauptung „da ist kein Platz" hat
 * eine Gestaltung ein Vierteljahr lang festgehalten, und niemand hat sie
 * nachgemessen. Jetzt kann man.
 *
 * ══ WAS ES PRUEFT ══════════════════════════════════════════════════════════
 *   1. Das Zeichen liegt in der OBEREN LINKEN Ecke des Covers.
 *   2. Es ist gross genug fuer einen Kinderfinger (>= 34 px) — der erste
 *      Anlauf am 04.09. war ein Kreis, und der Betreiber nannte ihn
 *      „ziemlich klein".
 *   3. Es UEBERLAPPT die Plaketten NICHT (die sagen, aus welcher Quelle das
 *      Werk kommt).
 *   4. Es ist ANTIPPBAR — sonst spricht es nie.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *     node tools/sprich-knopf-ecke.mjs
 *     node tools/sprich-knopf-ecke.mjs http://127.0.0.1:8305/neu/
 *
 * Rueckgabe 0 = sitzt richtig, 1 = Befund, 2 = ohne Browser nicht messbar.
 *
 * DIE LAGE WIRD GESTELLT: Ohne `body.vorlesen-an` ist das Zeichen
 * `display: none` und hat gar keine Masse — sichtbar ist es nur bei aktiver
 * Vorlesestimme. Und gemessen wird NACH dem Laden, nie aus einem
 * Zwischenstand (llmwiki `vorschau-ohne-pane-luegt-beim-layout`).
 */

import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const ZIEL = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'

/** Wie nah an der Ecke ist „in der Ecke"? Ein Achtel der Kachel — grosszuegig
 *  genug fuer Rand und Schatten, eng genug, dass „mittig" durchfaellt. */
const ECKE_ANTEIL = 8
/** Darunter trifft ein Kinderfinger nicht zuverlaessig. */
const MASS_MIN = 34

const leihe = await vorschauLeihen(ZIEL)
const brw = await eigenerBrowser().catch((e) => {
  console.error(`  Browser kam nicht hoch — Messung nicht moeglich: ${e.message}`)
  process.exit(2)
})
if (!brw) {
  await leihe.zurueckgeben()
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}

let lfd = 0
// STANDARD-WEBSOCKET-API (addEventListener), NICHT die `.on`-Form: Node bringt
// WebSocket seit v22 selbst mit, und das eingebaute folgt der Browser-API —
// `ws.on is not a function` war der erste Lauf dieses Werkzeugs. Die aelteren
// Schau-Werkzeuge kopieren noch die `.on`-Fassung aus der Zeit des `ws`-Pakets
// (AUDIT-2026-09-06 Rang 6 zaehlt 94 solcher Kopien); wer sie in einen Helfer
// zusammenzieht, nimmt DIESE Form.
const send = (ws, m, p = {}) =>
  new Promise((ok, no) => {
    const i = ++lfd
    ws.send(JSON.stringify({ id: i, method: m, params: p }))
    const h = (e) => {
      const x = JSON.parse(e.data)
      if (x.id !== i) return
      ws.removeEventListener('message', h)
      x.error ? no(new Error(x.error.message)) : ok(x.result)
    }
    ws.addEventListener('message', h)
  })

const warte = (ms) => new Promise((r) => setTimeout(r, ms))
let fehler = 0
const melde = (z) => {
  fehler++
  console.error(`  BEFUND  ${z}`)
}
const ok = (z) => console.log(`  ok      ${z}`)
const zeile = (name, wert) => console.log(`  ${String(name).padEnd(40)} ${wert}`)

try {
  await warte(1500)
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 800,
    height: 480,
    deviceScaleFactor: 1,
    mobile: false,
  })
  const ev = async (e) =>
    (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value

  // Kacheln braucht es, sonst gibt es kein Cover, an dem etwas sitzen koennte.
  await fetch(new URL('/vorschau/voll', ZIEL)).catch(() => null)
  await warte(120)
  await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
  await warte(2500)

  // Vorlesen einschalten — der einzige Zustand, in dem es das Zeichen gibt.
  await ev(`document.body.classList.add('vorlesen-an')`)
  await warte(250)

  const mass = await ev(`(() => {
    const knopf = document.querySelector('.sprich-knopf');
    if (!knopf) return { fehlt: true };
    const bild = knopf.closest('.kachel-bild, .ich-kachel-bild') || knopf.parentElement;
    const k = knopf.getBoundingClientRect();
    const b = bild.getBoundingClientRect();
    const marken = bild.querySelector('.kachel-marken');
    const m = marken ? marken.getBoundingClientRect() : null;
    const s = getComputedStyle(knopf);
    return {
      oben: k.top - b.top, links: k.left - b.left,
      breite: k.width, hoehe: k.height, kachel: b.width,
      zeiger: s.pointerEvents, sichtbar: s.display,
      ueberlappt: m ? !(k.right < m.left || k.left > m.right || k.bottom < m.top || k.top > m.bottom) : null,
    };
  })()`)

  if (!mass || mass.fehlt) {
    melde('kein `.sprich-knopf` auf der Seite — das Zeichen wird gar nicht gebaut')
  } else if (mass.sichtbar === 'none') {
    melde('das Zeichen bleibt `display: none`, obwohl Vorlesen an ist')
  } else {
    zeile('Masse', `${Math.round(mass.breite)}×${Math.round(mass.hoehe)} px`)
    zeile('Abstand oben / links', `${Math.round(mass.oben)} / ${Math.round(mass.links)} px`)
    zeile('Kachelbreite', `${Math.round(mass.kachel)} px`)

    const ecke = mass.kachel / ECKE_ANTEIL
    if (mass.oben > ecke || mass.links > ecke) {
      melde(
        `sitzt nicht oben links (${Math.round(mass.oben)}/${Math.round(mass.links)} px, erlaubt bis ${Math.round(ecke)})`,
      )
    } else ok('sitzt oben links in der Ecke')

    if (mass.breite < MASS_MIN || mass.hoehe < MASS_MIN) {
      melde(`zu klein fuer einen Kinderfinger: ${Math.round(mass.breite)}×${Math.round(mass.hoehe)} px (min ${MASS_MIN})`)
    } else ok(`gross genug fuer einen Kinderfinger (min ${MASS_MIN} px)`)

    if (mass.ueberlappt === true) melde('verdeckt die Plaketten — die Quellen-Auskunft der Kachel')
    else if (mass.ueberlappt === false) ok('laesst die Plaketten frei')

    if (mass.zeiger === 'none') melde('nicht antippbar (pointer-events: none) — es wuerde nie sprechen')
    else ok('antippbar')
  }

  ws.close()
} finally {
  await brw.schliessen?.()
  await leihe.zurueckgeben()
}

console.log()
if (fehler) {
  console.log(`${fehler} BEFUND(E).`)
  process.exit(1)
}
console.log('Das Vorlese-Zeichen sitzt richtig.')
