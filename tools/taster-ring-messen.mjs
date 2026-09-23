#!/usr/bin/env node
/**
 * DER RING, NACHGEMESSEN — fuellt er sich wirklich, und bricht er wirklich ab?
 *
 *     node tools/taster-ring-messen.mjs
 *
 * WOZU: `taster.integration.spec.ts` beweist, dass der Server die Ereignisse
 * SCHICKT. Was daraus auf dem Schirm wird, beweist es nicht — und genau dort
 * sass der Fehler, den diese Datei jetzt festhaelt.
 *
 * ══ WAS HIER GEMESSEN WIRD UND WARUM ES NICHT ANDERS GEHT ════════════════
 *
 * Der Ring ist eine CSS-Uebergabe auf `stroke-dashoffset`. Ob sie laeuft,
 * weiss nur ein Browser, DER WIRKLICH EIN BILD BAUT. In einer Ansicht ohne
 * Bildaufbau (`visibilityState: "hidden"`) meldet `getComputedStyle` brav
 * Zahlen, nur bewegen sie sich nie — eine Messung dort ist gruen oder rot, je
 * nach Umgebung, und sagt ueber den Ring gar nichts.
 *
 * ══ DIE GEGENPROBE, DIE DEN ECHTEN FEHLER GEFUNDEN HAT ═══════════════════
 *
 * Der letzte Fall unten legt `requestAnimationFrame` LAHM, bevor die Seite
 * laedt. Am 31.08.2026 war das kein gedachter Fall: In einer Ansicht ohne
 * Bildaufbau feuert der Rueckruf NIE, und `taster-ring.ts` hatte sein
 * Einblenden genau daran gehaengt. Ergebnis: `display: flex`, Deckkraft 0, ein
 * Ring, den niemand sieht, und keine Fehlermeldung nirgends.
 *
 * AUF DER BOX WAERE DAS DER ERNSTFALL GEWESEN: `timeout.idleDisplayOff`
 * schaltet den Schirm nach Leerlauf ab; wer die Box dann ausschalten will,
 * drueckt in genau diesem Zustand. Der Ring haette dort gefehlt, wo man ihn am
 * dringendsten braucht. Deshalb bleibt dieser Fall stehen, auch wenn er heute
 * gruen ist — er ist die einzige Wache dafuer, dass niemand das rAF wieder
 * einbaut.
 */

import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { eigenerBrowser, freierPort } from './leihgabe.mjs'

const HIER = dirname(fileURLToPath(import.meta.url))
const HALTEDAUER_MS = 2000

const warte = (ms) => new Promise((f) => setTimeout(f, ms))

let gut = 0
let schlecht = 0
function sagt(bedingung, was, dazu = '') {
  if (bedingung) {
    console.log(`  OK   ${was}`)
    gut++
  } else {
    console.log(`  ROT  ${was}${dazu ? `\n         ${dazu}` : ''}`)
    schlecht++
  }
}

/** Die Vorfuehrung auf einem eigenen Port hochziehen. */
async function vorfuehrungStarten() {
  const port = await freierPort()
  const kind = spawn('node', [join(HIER, 'taster-ring-vorfuehrung.mjs'), String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await new Promise((fertig, fehler) => {
    const frist = setTimeout(() => fehler(new Error('Die Vorfuehrung kam nicht hoch')), 30000)
    kind.stdout.on('data', (d) => {
      if (String(d).includes('Der Ring steht')) {
        clearTimeout(frist)
        fertig()
      }
    })
    kind.stderr.on('data', (d) => process.stderr.write(String(d)))
    kind.on('exit', (c) => {
      clearTimeout(frist)
      fehler(new Error('Die Vorfuehrung endete mit ' + c))
    })
  })
  return { port, kind }
}

/** Eine Sitzung am Browser mit den paar CDP-Aufrufen, die gebraucht werden. */
async function amBrowser(brw) {
  const ws = new WebSocket(await brw.seite())
  await new Promise((f, x) => {
    ws.on('open', f)
    ws.on('error', x)
  })
  let id = 0
  const offen = new Map()
  ws.on('message', (d) => {
    const n = JSON.parse(d)
    if (n.id && offen.has(n.id)) {
      offen.get(n.id)(n)
      offen.delete(n.id)
    }
  })
  const ruf = (method, params = {}) =>
    new Promise((f) => {
      const i = ++id
      offen.set(i, f)
      ws.send(JSON.stringify({ id: i, method, params }))
    })
  await ruf('Page.enable')
  await ruf('Runtime.enable')
  const werten = async (js) => {
    const a = await ruf('Runtime.evaluate', { expression: js, returnByValue: true, awaitPromise: true })
    if (a.result?.exceptionDetails) throw new Error(JSON.stringify(a.result.exceptionDetails))
    return a.result?.result?.value
  }
  return { ruf, werten, schliessen: () => ws.close() }
}

/**
 * Was der Ring GERADE zeigt. Der Fuellstand wird aus dem tatsaechlich
 * gemalten `stroke-dashoffset` zurueckgerechnet, nicht aus einer Absicht.
 */
const ABLESEN = `(() => {
  const panel = document.getElementById('panel')
  const wurzel = panel && panel.querySelector('div[aria-hidden="true"]')
  if (!wurzel) return { da: false }
  const bogen = wurzel.querySelectorAll('circle')[1]
  const text = wurzel.querySelector('div div')
  const s = getComputedStyle(wurzel)
  const umfang = 2 * Math.PI * 68
  const off = parseFloat(getComputedStyle(bogen).strokeDashoffset)
  return {
    da: true,
    sichtbar: s.display !== 'none' && parseFloat(s.opacity) > 0.5,
    deckkraft: parseFloat(s.opacity),
    fuellung: Math.max(0, Math.min(100, Math.round((1 - off / umfang) * 100))),
    farbe: bogen.getAttribute('stroke'),
    text: text ? text.textContent : null,
  }
})()`

async function main() {
  const { port, kind } = await vorfuehrungStarten()
  const brw = await eigenerBrowser({ fenster: '800,480' })
  if (!brw) {
    console.log('kein Browser gefunden (playwright/chromium) — nichts zu messen')
    kind.kill()
    process.exit(2)
  }

  const s = await amBrowser(brw)
  try {
    // ══ 1. EIN LANGER DRUCK: fuellt sich der Ring? ═════════════════════════
    console.log('\n── Ein langer Druck (3 s) ────────────────────────────────')
    await s.ruf('Page.navigate', { url: `http://127.0.0.1:${port}/` })
    await warte(1800)

    const ruhe = await s.werten(ABLESEN)
    sagt(ruhe.da, 'der Ring ist gebaut und haengt in der Seite')
    sagt(!ruhe.sichtbar, 'im Ruhezustand ist er unsichtbar', `deckkraft=${ruhe.deckkraft}`)

    await s.werten(`fetch('/spielen?einer=3000')`)
    await warte(250)
    const frueh = await s.werten(ABLESEN)
    sagt(frueh.sichtbar, 'beim Druck wird er sichtbar', `deckkraft=${frueh.deckkraft}`)
    sagt(frueh.text === 'Halten …', 'er sagt "Halten …"', `text=${JSON.stringify(frueh.text)}`)
    sagt(frueh.farbe === '#4ade80', 'er ist gruen')

    await warte(850)
    const mitte = await s.werten(ABLESEN)
    // Nach rund 1,1 s von 2 s muss er ueber die Haelfte gelaufen sein. Die
    // Spanne ist weit, weil ein Browser unter Last auch mal spaeter misst —
    // eng genug ist sie trotzdem: ein Ring, der GAR NICHT laeuft, steht bei 0.
    sagt(
      mitte.fuellung > frueh.fuellung,
      `er fuellt sich (${frueh.fuellung}% -> ${mitte.fuellung}%)`,
      'ein Ring, der stehenbleibt, zeigt keine Restzeit an',
    )
    sagt(mitte.fuellung > 25 && mitte.fuellung < 90, `nach ~1,1 s steht er bei ${mitte.fuellung}%`)

    await warte(1200)
    const voll = await s.werten(ABLESEN)
    sagt(voll.fuellung >= 97, `nach ${HALTEDAUER_MS} ms ist er voll (${voll.fuellung}%)`)
    sagt(voll.text === 'Tschüss!', 'er sagt "Tschüss!" — ab hier faehrt die Box herunter', `text=${voll.text}`)

    await warte(1200)
    const danach = await s.werten(ABLESEN)
    sagt(
      danach.text === 'Tschüss!' && danach.sichtbar,
      'nach dem Loslassen bleibt der volle Ring stehen (die Box geht ja aus)',
    )

    // ══ 2. DER MEDIAN-DRUCK: bricht er sichtbar ab? ════════════════════════
    console.log('\n── Ein Druck von 432 ms (der gemessene Median von .79) ───')
    await s.ruf('Page.navigate', { url: `http://127.0.0.1:${port}/` })
    await warte(1500)
    await s.werten(`fetch('/spielen?einer=432')`)
    await warte(700)
    const kurz = await s.werten(ABLESEN)
    sagt(kurz.sichtbar, 'auch ein 432-ms-Druck wird ueberhaupt gezeigt')
    sagt(kurz.farbe === '#f87171', 'der Ring wird rot', `farbe=${kurz.farbe}`)
    sagt(
      kurz.text === 'Zu kurz — länger halten',
      'er sagt, WAS ZU TUN IST — die eigentliche Antwort auf 26 von 27 Druecken',
      `text=${JSON.stringify(kurz.text)}`,
    )
    sagt(
      kurz.fuellung > 5 && kurz.fuellung < 45,
      `er friert dort ein, wo er stand (${kurz.fuellung}%)`,
      'springt er auf 0 oder 100, sieht man nicht, wie weit es war',
    )

    await warte(900)
    const weg = await s.werten(ABLESEN)
    sagt(!weg.sichtbar, 'danach blendet er wieder aus')

    // ══ 3. GEGENPROBE: ohne requestAnimationFrame ═════════════════════════
    console.log('\n── Ohne requestAnimationFrame (Schirm aus, Tab verdeckt) ─')
    await s.ruf('Page.addScriptToEvaluateOnNewDocument', {
      source: 'window.requestAnimationFrame = function () { return 0 }',
    })
    await s.ruf('Page.navigate', { url: `http://127.0.0.1:${port}/` })
    await warte(1500)
    const rafTot = await s.werten('typeof requestAnimationFrame === "function" && requestAnimationFrame(()=>{}) === 0')
    sagt(rafTot, 'requestAnimationFrame ist fuer diesen Fall lahmgelegt')

    await s.werten(`fetch('/spielen?einer=2500')`)
    await warte(400)
    const ohneRaf = await s.werten(ABLESEN)
    sagt(
      ohneRaf.sichtbar,
      'der Ring wird AUCH OHNE Bildaufbau-Rueckruf sichtbar',
      `deckkraft=${ohneRaf.deckkraft} — genau hier war der Fehler vom 31.08.2026`,
    )
    sagt(ohneRaf.text === 'Halten …', 'und er zeigt seinen Text')
  } finally {
    s.schliessen()
    await brw.schliessen()
    kind.kill()
  }

  console.log(`\n══ ${gut} OK, ${schlecht} ROT ══`)
  process.exit(schlecht ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
