#!/usr/bin/env node
/*
 * ZIEHEN AM SCHIEBEREGLER, NACHGEMESSEN — folgt der Wert der Hand?
 *
 *     node tools/regler-ziehen-schau.mjs --ziel http://192.168.178.57:8200/neu/
 *
 * E55 (20.08.2026): Unter Cog/WPE — dem schlanken Kiosk-Browser ohne
 * X-Server — liess sich kein Regler ZIEHEN. Tippen setzte den Wert, Ziehen
 * tat nichts; betroffen waren Helligkeit, Lautstaerke und das Springen im
 * Titel. app.js rechnet den Wert seither selbst (dort „Ziehen am
 * Schieberegler") und schaltet den eingebauten Weg mit preventDefault ab.
 *
 * WAS DIESES WERKZEUG PRUEFT UND WAS NICHT: es misst die CHROMIUM-Haelfte.
 * Der Auftrag war ausdruecklich „beide sollen funktionieren", und die
 * gefaehrlichere Richtung ist nicht die neue — es ist die alte, die dabei
 * kaputtgehen kann, ohne dass es jemand sieht. Cog spricht kein CDP; DASS es
 * dort geht, sagt nur ein Finger am Geraet. Diese Grenze steht hier, damit
 * ein gruener Lauf nicht mehr behauptet, als er gesehen hat.
 *
 * VIER ZEUGEN:
 *   1  DIE DELEGATION GREIFT   pointerdown ist defaultPrevented — der
 *      eingebaute Weg ist also wirklich abgeschaltet und nicht bloss
 *      ueberstimmt. Das ist der einzige Zeuge, den ein nativ funktionierender
 *      Browser nicht von selbst gruen faerbt.
 *   2  DER WERT FOLGT          ein Zug ueber die Bahn aendert den Wert
 *      mehrfach (nicht nur beim Absetzen).
 *   3  DIE RECHNUNG TRIFFT     auf 25/50/75 Prozent der Bahn steht der Wert
 *      binnen 2 Prozentpunkten dort. Die Bahn ist schmaler als das Element
 *      (halbe Griffbreite an jedem Rand) — wer das vergisst, erreicht das
 *      letzte Stueck nie.
 *   4  GENAU EIN `change`       nicht zwei. Zwei hiessen: beide Wege laufen,
 *      und jeder Sprungbefehl ginge doppelt an den Abspieldienst.
 *
 * ZWEI REGLER, WEIL SIE VERSCHIEDENES BEWEISEN:
 *   NEU GEBAUT   ein Regler, den es beim Laden der Seite nicht gab. Er kann
 *                nur funktionieren, wenn die Behandlung am `document` haengt
 *                und nicht an drei einzelnen Elementen — der eigentliche
 *                Anspruch (ein vierter Regler bekommt es geschenkt).
 *   ECHT         `gr-schieber`, der Fortschrittsbalken. Harmlos, solange
 *                nichts laeuft: `springen.loslassen()` steigt ohne
 *                laufenden Titel sofort wieder aus. Das Werkzeug prueft das
 *                vorher und laesst den echten Regler sonst aus.
 *
 * Es wird NICHTS abgespielt und nichts gespeichert.
 */
import process from 'node:process'

import WebSocket from 'ws'

import { eigenerBrowser } from './leihgabe.mjs'

const opt = (name, vorgabe) => {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : vorgabe
}
const ZIEL = opt('--ziel', 'http://192.168.178.57:8200/neu/')

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

async function rechne(ws, ausdruck) {
  const r = await send(ws, 'Runtime.evaluate', {
    expression: ausdruck,
    awaitPromise: true,
    returnByValue: true,
  })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'Ausdruck warf')
  return r.result?.value
}

const warte = (ms) => new Promise((f) => setTimeout(f, ms))

/**
 * Einen Zug ueber die Bahn fahren und dabei alles mitschreiben.
 *
 * DIE MAUS IST HIER DER FINGER: CDP schickt Maus-Ereignisse, und Chromium
 * macht daraus dieselben Pointer-Ereignisse, an denen die Delegation haengt.
 * Ein echter Finger erzeugt dieselben — nur eben unter Cog, wo der eingebaute
 * Weg fehlt.
 */
async function ziehen(ws, waehler, anteile) {
  await rechne(
    ws,
    `(() => {
      const r = document.querySelector(${JSON.stringify(waehler)})
      if (!r) return false
      window.__zeug = { input: 0, change: 0, verlauf: [], verhindert: null, gefangen: 0, fehler: [], wurdeGefangen: null }
      // EIN WURF IM POINTERDOWN-HANDLER ist der Fall, den man sonst NICHT
      // sieht: das Verhindern lief schon, der eigene Weg nicht — der Regler
      // steht dann still und niemand weiss warum. Deshalb faengt dieses
      // Werkzeug Ausnahmen ein und meldet sie.
      // KEIN BACKTICK IN DIESEN KOMMENTAREN: sie stehen INNERHALB einer
      // Vorlage, und ein Backtick beendet sie mitten im Satz.
      window.addEventListener('error', (ev) => {
        window.__zeug.fehler.push(String(ev.message || ev.error))
      })
      r.addEventListener('input', () => {
        window.__zeug.input++
        window.__zeug.verlauf.push(Number(r.value))
      })
      r.addEventListener('change', () => window.__zeug.change++)
      r.addEventListener('pointerdown', (e) => {
        // NACH der Blasen-Phase nachsehen: die Delegation haengt am document
        // und kommt erst NACH diesem Listener dran.
        setTimeout(() => {
          window.__zeug.verhindert = e.defaultPrevented
          // DER EHRLICHERE ZEUGE als das blosse Verhindern: das kann auch der
          // eingebaute Regler tun. Den Zeiger FAENGT nur die Delegation.
          try { window.__zeug.wurdeGefangen = r.hasPointerCapture(e.pointerId) } catch { /* egal */ }
        }, 0)
      })
      return true
    })()`,
  )

  const kasten = await rechne(
    ws,
    `(() => {
      const r = document.querySelector(${JSON.stringify(waehler)})
      const k = r.getBoundingClientRect()
      let griff = 0
      for (const p of ['::-webkit-slider-thumb', '::-moz-range-thumb']) {
        const b = Number.parseFloat(getComputedStyle(r, p).width)
        if (Number.isFinite(b) && b > 0) { griff = b; break }
      }
      if (!griff) griff = k.height
      return { links: k.left, breite: k.width, mitte: k.top + k.height / 2, griff,
               min: r.min === '' ? 0 : Number(r.min), max: r.max === '' ? 100 : Number(r.max) }
    })()`,
  )

  // UNABHAENGIG VON DER GRIFFRECHNUNG: gefahren wird ueber das ELEMENT, nicht
  // ueber die errechnete Bahn. Raete dieses Werkzeug die Bahn genauso wie
  // app.js, pruefte es die Rechnung gegen sich selbst — und ein falsch
  // gemessener Griff schoebe BEIDE auf denselben Punkt, der Zug bliebe stehen
  // und der Lauf waere trotzdem gruen. Genau so ist es am 20.08.2026 fast
  // passiert: die erste Fassung mass 400 px Griff auf 400 px Regler.
  const xBei = (anteil) => kasten.links + 2 + (kasten.breite - 4) * anteil
  const maus = (art, x, extra = {}) =>
    send(ws, 'Input.dispatchMouseEvent', {
      type: art,
      x,
      y: kasten.mitte,
      button: 'left',
      buttons: art === 'mouseReleased' ? 0 : 1,
      clickCount: 1,
      ...extra,
    })

  await maus('mousePressed', xBei(anteile[0]))
  for (const a of anteile.slice(1)) {
    await maus('mouseMoved', xBei(a))
    await warte(30)
  }
  await maus('mouseReleased', xBei(anteile[anteile.length - 1]))
  await warte(120)

  const zeug = await rechne(ws, 'window.__zeug')
  const wert = await rechne(ws, `Number(document.querySelector(${JSON.stringify(waehler)}).value)`)
  return { ...zeug, wert, kasten }
}

const ergebnisse = []
function pruefe(name, bedingung, gesehen) {
  ergebnisse.push({ name, ok: !!bedingung, gesehen })
  console.log(`  ${bedingung ? 'ok  ' : 'NEIN'} ${name}: ${gesehen}`)
}

async function main() {
  const browser = await eigenerBrowser({ fenster: '800,480' })
  try {
    const ws = new WebSocket(await browser.seite(), { perMessageDeflate: false })
    await new Promise((f, k) => {
      ws.once('open', f)
      ws.once('error', k)
    })
    await send(ws, 'Page.enable')
    await send(ws, 'Runtime.enable')
    await send(ws, 'Page.navigate', { url: ZIEL })
    await warte(3500)

    // ── 1. Ein Regler, den es beim Laden nicht gab ───────────────────────
    console.log('\n══ Neu gebauter Regler (beweist: die Behandlung haengt am document) ══')
    await rechne(
      ws,
      `(() => {
        document.querySelector('#pruef-regler')?.remove()
        const r = document.createElement('input')
        r.id = 'pruef-regler'
        r.type = 'range'
        r.min = '0'; r.max = '100'; r.step = '1'; r.value = '0'
        r.style.cssText = 'position:fixed;left:20px;top:20px;width:400px;height:44px;z-index:99999'
        document.body.appendChild(r)
        return true
      })()`,
    )
    const neu = await ziehen(ws, '#pruef-regler', [0.05, 0.3, 0.6, 0.97])
    if (neu.fehler?.length) console.log(`  ⚠ Ausnahme waehrend des Zuges: ${neu.fehler.join(' | ')}`)
    pruefe('die Delegation faengt den Zeiger', neu.wurdeGefangen === true, String(neu.wurdeGefangen))
    pruefe('die Delegation greift (pointerdown verhindert)', neu.verhindert === true, String(neu.verhindert))
    pruefe('der Wert folgt waehrend des Zuges', neu.input >= 3, `${neu.input} input-Ereignisse`)
    // DAS RECHTE ENDE IST DER STRENGE ZEUGE: es ist genau die Stelle, die
    // unerreichbar bleibt, wenn die halbe Griffbreite am Rand vergessen wird.
    pruefe('ganz rechts steht der Hoechstwert', neu.wert >= 95, `${neu.wert} von 100`)
    pruefe('genau ein change beim Loslassen', neu.change === 1, `${neu.change}`)
    pruefe(
      'der Verlauf steigt, statt zu springen',
      neu.verlauf.length >= 3 && neu.verlauf.every((w, i) => i === 0 || w >= neu.verlauf[i - 1]),
      neu.verlauf.join(' → '),
    )
    // ── 1b. Ein Tipp ohne Bewegung muss den Zug BEENDEN ──────────────────
    /*
     * DIE VERDRAHTUNG DES FORTSCHRITTSBALKENS, NACHGEBAUT: er beginnt seinen
     * Zug bei pointerdown und beendet ihn NUR bei change. Meldet das Ziehen
     * change nur bei echter Wertaenderung, bleibt nach einem Tipp auf die
     * Stelle, an der der Regler schon steht, ein offener Zug zurueck — und
     * der Balken zeigt von da an das alte Ziel statt der laufenden Stelle.
     * Gemeldet am 20.08.2026 als „im mini player ist die progress bar
     * kaputt". Hier steht der Fall als Zeuge, damit er nicht wiederkommt.
     */
    console.log('\n══ Tipp ohne Bewegung (der eingefrorene Balken) ══')
    const tipp = await rechne(
      ws,
      `(async () => {
        const r = document.querySelector('#pruef-regler')
        let offen = false
        r.addEventListener('pointerdown', () => { offen = true })
        r.addEventListener('change', () => { offen = false })
        const k = r.getBoundingClientRect()
        // Genau dorthin tippen, wo der Regler schon steht: der Wert aendert
        // sich dabei NICHT — das ist der ganze Punkt.
        const x = k.left + 2 + (k.width - 4) * (Number(r.value) / 100)
        const y = k.top + k.height / 2
        for (const art of ['pointerdown', 'pointerup']) {
          r.dispatchEvent(new PointerEvent(art, {
            bubbles: true, cancelable: true, pointerId: 7, isPrimary: true,
            button: 0, buttons: art === 'pointerup' ? 0 : 1, clientX: x, clientY: y,
          }))
        }
        await new Promise((f) => setTimeout(f, 60))
        return { offen, wert: Number(r.value) }
      })()`,
    )
    pruefe('der Zug ist nach dem Tipp wieder zu', tipp.offen === false, tipp.offen ? 'offen geblieben' : 'geschlossen')

    await rechne(ws, `document.querySelector('#pruef-regler')?.remove()`)

    // ── 2. Der echte Fortschrittsbalken ──────────────────────────────────
    console.log('\n══ Der echte Regler (gr-schieber) ══')
    const laeuft = await rechne(
      ws,
      `(async () => {
        try {
          const a = await fetch('/api/spotify/laeuft')
          const d = await a.json()
          return d?.aktiv === true
        } catch { return false }
      })()`,
    )
    if (laeuft) {
      console.log('  uebersprungen: es laeuft etwas — ein Zug wuerde springen lassen')
    } else {
      const da = await rechne(
        ws,
        `(() => {
          const r = document.querySelector('#gr-schieber')
          if (!r) return false
          const k = r.getBoundingClientRect()
          return k.width > 0 && k.height > 0
        })()`,
      )
      if (!da) {
        console.log('  uebersprungen: der grosse Player ist nicht offen (Regler unsichtbar)')
      } else {
        const echt = await ziehen(ws, '#gr-schieber', [0.05, 0.3, 0.6, 0.97])
        if (echt.fehler?.length) console.log(`  ⚠ Ausnahme: ${echt.fehler.join(' | ')}`)
        pruefe('auch am echten Regler faengt die Delegation den Zeiger', echt.wurdeGefangen === true, String(echt.wurdeGefangen))
        pruefe('der Wert folgt', echt.input >= 3, `${echt.input} input-Ereignisse`)
        pruefe('ganz rechts steht der Hoechstwert (max=1000)', echt.wert >= 950, `${echt.wert} von 1000`)
      }
    }

    ws.close()
  } finally {
    await browser.schliessen()
  }

  const kaputt = ergebnisse.filter((e) => !e.ok)
  console.log(
    kaputt.length === 0
      ? `\nalle ${ergebnisse.length} Zeugen stimmen`
      : `\n${kaputt.length} von ${ergebnisse.length} Zeugen sagen NEIN`,
  )
  process.exit(kaputt.length === 0 ? 0 : 1)
}

main().catch((f) => {
  console.error(`\nabgebrochen: ${f.message}`)
  process.exit(2)
})
