#!/usr/bin/env node
/**
 * DIE SCHUBLADE ZEIGT IHREN INHALT NICHT VOR SICH HER.
 *
 * ══ DER BEFUND (Betreiber, 20.09.2026) ══════════════════════════════════
 *
 * „die app schublade beim rausziehen — die apps sind zuerst sichtbar und
 * dann erscheint die schublade, das sieht seltsam aus."
 *
 * Er hatte recht, und es war zu messen. `.sch-apps` sprang per `display:
 * flex` beim ERSTEN Pixel des Zuges an seinen ENDPLATZ (88..176), waehrend
 * die Flaeche darunter noch bei 92 stand:
 *
 *     Zug  92 px   Flaeche bis  92   Spalte bis 176   -> 84 px in der Luft
 *     Zug 110 px   Flaeche bis 110   Spalte bis 176   -> 66 px
 *     Zug 140 px   Flaeche bis 140   Spalte bis 176   -> 36 px
 *
 * Eine Schublade gibt ihren Inhalt frei, waehrend sie aufgeht — sie traegt
 * ihn nicht voraus.
 *
 * ══ WAS HIER GEMESSEN WIRD ══════════════════════════════════════════════
 *
 * DER UEBERSTAND: wie weit die SICHTBARE Kante der App-Spalte rechts ueber
 * die Kante der Flaeche hinausragt. Er muss in JEDER Lage 0 sein — zu, in
 * vier Zwischenstellungen, offen, und wieder zu.
 *
 * „SICHTBAR" HEISST NICHT „getBoundingClientRect": Der Kasten der Spalte
 * steht seit der Behebung IMMER auf seinem Endplatz; was ihn kuerzt, ist
 * `clip-path`. Wer den Kasten misst, misst am Fehler vorbei und bekommt
 * einen Ueberstand, den niemand sieht. Dieses Werkzeug rechnet den Beschnitt
 * deshalb heraus.
 *
 * UND DIE KEHRSEITE: `visibility: hidden` laesst den Kasten im Layout. Im
 * geschlossenen Zustand darf es deshalb keinen SICHTBAREN App-Knopf geben —
 * sonst laegen sie ueber dem Inhalt, und der Ring der Fernbedienung koennte
 * sie finden (und saege sie seit dem 19.09.2026 sogar an). Was dieses
 * Werkzeug dabei NICHT beweist, steht unten an der Messung selbst.
 *
 * AUFRUF
 *     node tools/schublade-deckt-auf.mjs
 *     node tools/schublade-deckt-auf.mjs --pruefen
 */
import WebSocket from 'ws'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const ZIEL = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const PRUEFEN = process.argv.includes('--pruefen')

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
const melde = (z) => {
  fehler++
  console.error(`  FEHLER  ${z}`)
}
const zeile = (name, wert) => console.log(`  ${String(name).padEnd(30)} ${wert}`)

try {
  await warte(1500)
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })
  await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
  await warte(2800)
  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value

  const da = await ev(`!!(document.querySelector('.sch-flaeche') && document.querySelector('.sch-apps'))`)
  if (!da) {
    // ABBRUCH UND NICHT ROT: Fehlt die Schublade im Baum, ist das eine
    // andere Nachricht als „sie deckt falsch auf" — und sie gehoert nicht
    // in dieselbe Zeile.
    console.error(
      '\nABBRUCH: `.sch-flaeche` oder `.sch-apps` gibt es nicht.\n' +
        '  Dieses Werkzeug misst die App-Spalte der Schublade gegen ihre Flaeche.\n' +
        '  Sind die Klassen umbenannt, gehoeren sie hier nachgezogen — NICHT die Wache entfernt.\n',
    )
    process.exit(2)
  }

  /** Flaechenkante, sichtbare Kante der Spalte, und die Differenz. */
  const mess = () =>
    ev(`(() => {
      const f = document.querySelector('.sch-flaeche'); const a = document.querySelector('.sch-apps')
      const rf = f.getBoundingClientRect(); const ra = a.getBoundingClientRect()
      const s = getComputedStyle(a)
      if (s.visibility === 'hidden' || s.display === 'none') {
        return { flaeche: Math.round(rf.right), sichtbar: false, ueberstand: 0 }
      }
      // DEN BESCHNITT HERAUSRECHNEN — sonst misst man den Kasten statt das Bild.
      let rechts = ra.right
      const m = /inset\\(([^)]*)\\)/.exec(s.clipPath || '')
      if (m) {
        const teile = m[1].trim().split(/\\s+/)
        const roh = String(teile[1] ?? '0')
        const zahl = parseFloat(roh) || 0
        rechts = ra.right - (roh.endsWith('%') ? (ra.width * zahl) / 100 : zahl)
      }
      return { flaeche: Math.round(rf.right), sichtbar: true, ueberstand: Math.round(rechts - rf.right) }
    })()`)

  await ev(`document.body.classList.add('schublade')`)

  const lagen = []
  lagen.push(['zu', await mess()])
  for (const px of [92, 110, 140, 176]) {
    await ev(`document.body.classList.add('sch-zieht'); document.body.style.setProperty('--sch-jetzt','${px}px')`)
    await warte(120)
    lagen.push([`am Finger, ${px} px`, await mess()])
  }
  await ev(
    `document.body.classList.remove('sch-zieht'); document.body.style.removeProperty('--sch-jetzt'); document.body.classList.add('sch-offen')`,
  )
  await warte(450)
  lagen.push(['offen', await mess()])
  await ev(`document.body.classList.remove('sch-offen')`)
  await warte(450)
  lagen.push(['wieder zu', await mess()])

  for (const [name, m] of lagen) {
    zeile(name, `Flaeche bis ${m.flaeche}, Ueberstand ${m.ueberstand} px${m.sichtbar ? '' : '  (Spalte unsichtbar)'}`)
    if (m.ueberstand > 0) {
      melde(`${name}: die App-Spalte steht ${m.ueberstand} px vor der Schubladenkante — sie zeigt sich, bevor die Schublade da ist`)
    }
  }

  // ── DIE GEGENKONTROLLE: OFFEN MUSS SIE AUCH WIRKLICH DA SEIN ───────────
  //
  // Ohne sie bestuende diese Messung auch auf einer Schublade, deren Spalte
  // NIE sichtbar wird — Ueberstand 0 ist dann trivial wahr.
  const offenSichtbar = lagen.find(([n]) => n === 'offen')?.[1]?.sichtbar
  zeile('offen ist die Spalte sichtbar', offenSichtbar ? 'ja' : 'NEIN')
  if (!offenSichtbar) {
    melde('offen ist die App-Spalte unsichtbar — dann misst „Ueberstand 0" nichts, sondern nur ihr Fehlen')
  }

  /* ── ZU: KEIN SICHTBARER APP-KNOPF ────────────────────────────────────
   *
   * WAS HIER STEHT UND WAS NICHT — die Unterscheidung hat mich eine
   * Gegenprobe gekostet:
   *
   * GEMESSEN WIRD EINE DOM-TATSACHE: Bei geschlossener Schublade darf es
   * keinen SICHTBAREN App-Knopf geben. Das ist die Eigenschaft, die sich
   * mit der Behebung geaendert hat (frueher `display: none`, jetzt
   * `visibility: hidden` — der Kasten bleibt im Layout).
   *
   * NICHT BEWIESEN WIRD, dass `auswahlBewegen` in app.js das beachtet. Die
   * erste Fassung dieser Zeile hat genau das behauptet und dafuer den
   * FILTER VON `auswahlBewegen` ABGESCHRIEBEN — und prompt blieb die
   * Gegenprobe gruen, als ich die Pruefung dort entfernte: Das Werkzeug mass
   * seine eigene Abschrift, nicht den Code. Dieselbe Krankheit wie bei der
   * Einstufungs-Wache am Vortag [[gegenprobe-bleibt-gruen-ist-der-fund]].
   *
   * Wer die Ring-Seite messen will, muss den Ring FAHREN (Anweisungen
   * schicken und sehen, wo `.fb-auswahl` landet) — das gehoert in ein
   * eigenes Werkzeug und nicht hierher, wo es die Messung traege und
   * flatterhaft machte.
   */
  const sichtbareApps = await ev(`
    Array.from(document.querySelectorAll('.sch-apps button')).filter((b) =>
      getComputedStyle(b).visibility !== 'hidden' && b.getBoundingClientRect().width > 8).length`)
  zeile('zu: sichtbare App-Knoepfe', String(sichtbareApps))
  if (sichtbareApps > 0) {
    melde(
      `bei geschlossener Schublade sind ${sichtbareApps} App-Knopf/Knoepfe sichtbar — ` +
        'sie liegen dann ueber dem Inhalt, und der Ring der Fernbedienung kann sie finden',
    )
  }

  console.log(fehler ? `\n  ${fehler} Abweichung(en)` : '\n  ohne Abweichung')
} finally {
  await brw.schliessen()
  await leihe.zurueckgeben()
}

process.exit(PRUEFEN && fehler ? 1 : 0)
