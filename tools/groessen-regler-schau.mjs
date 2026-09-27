#!/usr/bin/env node
/**
 * WIRKEN DIE GROESSEN-REGLER — oder werden die Faktoren wieder nur gelesen?
 *
 * ── WAS ES PRUEFT (E113, 31.08.2026) ──────────────────────────────────────
 * `--mupi-cover-f` und `--mupi-titel-f` standen seit dem ersten Tag in
 * `anwenden()` und wurden aus `w.skalen` GELESEN — geschrieben hat sie in der
 * neuen Oberflaeche NIEMAND. Zwei Variablen ohne Schreibseite: nichts wird
 * rot, nichts faellt, und der Betreiber sucht die Cover-Groesse im Menue.
 * Seit E113 gibt es die zwei Zeilen („Größe des Covers" auf der Player-Seite,
 * „Größe der Namen" bei den Indikatoren), und diese Wache haelt sie fest.
 *
 * GEMESSEN WIRD NICHT DIE VARIABLE, SONDERN DIE WIRKUNG. Eine gesetzte
 * CSS-Variable beweist nur die halbe Kette; die teure Haelfte ist die andere
 * (E23 „Falle 1": ein Schalter, dessen Variable nirgends verbraucht wird,
 * BLEIBT SICHTBAR und tut NICHTS). Darum je Stufe zwei Zahlen:
 *
 *   cover  -> `--mupi-cover-f` UND die gemessene Kante von `.gross-bild`.
 *             app.css rechnet `min(260px, calc(200px * f))`, also
 *             170 / 200 / 260 px. Bei Stufe 3 liegt der Wert GENAU auf dem
 *             Deckel — deshalb hoert die Skala dort auf.
 *   titel  -> `--mupi-titel-f` UND die gemessene Schriftgroesse von
 *             `.kachel-titel` (15 px mal Faktor), also 12,75 / 15 / 18,75 px.
 *             In DIESER Oberflaeche haengt `--mupi-titel-f` an den Namen
 *             unter den Kacheln und nicht am Titel des grossen Players; wer
 *             das aendert, macht diese Wache rot statt es zu verschweigen.
 *
 * Dazu die Rueckfall-Wahrheit: OHNE `skalen` (alte darstellung.json) gilt
 * Stufe 2 — exakt der Stand vor E113. Eine Box, deren Eltern nie tippen,
 * sieht keine Aenderung.
 *
 * ── UND DIE SCHREIBSEITE, OHNE DIE ES DIESE WACHE NICHT BRAeUCHTE ─────────
 * Der erste Teil misst den LESEWEG, und der stand schon vor E113: wer die
 * Faktoren per PUT setzte, sah sie wirken. Genau darum waere eine Wache, die
 * nur das prueft, am alten Baum ebenso gruen gewesen wie am neuen — sie
 * bewacht nichts von der Arbeit. Der zweite Teil geht deshalb durch die
 * OBERFLAECHE: Admin-Bereich auf, Anzeige → Player bzw. Indikatoren, die
 * Zeile suchen, den Knopf DRUECKEN und danach am Server nachsehen, was in
 * `skalen` steht. Damit haengt an dieser Wache auch, dass die zwei Zeilen
 * ueberhaupt DA sind — der Befund, mit dem E113 anfing.
 *
 * DABEI WIRD MITGEPRUEFT, DASS FREMDE `skalen`-SCHLUESSEL UEBERLEBEN. Vor dem
 * Tippen steht `fav: 1.4` im Stand (so, wie es die alte Verwaltung schreiben
 * wuerde). Ein Regler, der `skalen` ersetzt statt zu ergaenzen, raeumte dem
 * Betreiber beim Cover-Tippen den Favoriten-Knopf mit ab — lautlos.
 *
 * DER GROSSE PLAYER WIRD ZUM MESSEN AUFGEDECKT (`.gross` traegt `hidden`,
 * app.css blendet ihn damit auf `display: none`). Das geschieht IM BROWSER
 * und nach jedem Neuladen erneut — es aendert nichts am Stand der Box und
 * nichts an der Vorschau. Ohne das Aufdecken haette `getBoundingClientRect`
 * fuer alle drei Stufen dieselbe 0 geliefert, und die Wache waere gruen
 * gewesen, weil sie nichts gesehen hat.
 *
 * WAS ES AENDERT: nichts Bleibendes. Die Vorschau wird geliehen und samt
 * Darstellung zurueckgelegt.
 *
 * AUFRUF
 *     node tools/groessen-regler-schau.mjs             # Tabelle
 *     node tools/groessen-regler-schau.mjs --pruefen   # Ende 1 bei Befund
 *     node tools/groessen-regler-schau.mjs http://127.0.0.1:8383/neu/
 */
import WebSocket from 'ws'
import { adminAuf } from './admin-weg.mjs'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const ZIEL = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const PRUEFEN = process.argv.includes('--pruefen')
const zeig = PRUEFEN ? () => {} : console.log

// Die Stufen der zwei Regler — dieselben Zahlen wie COVER_JE_STUFE und
// TITEL_JE_STUFE in NewDesign/app.js. Sie stehen hier ABGESCHRIEBEN und nicht
// importiert: app.js ist eine Browser-Datei ohne Ausfuhr, und eine Wache, die
// ihre Sollwerte aus dem Gemessenen holt, prueft nichts.
const COVER_F = { 1: 0.85, 2: 1, 3: 1.3 }
const TITEL_F = { 1: 0.85, 2: 1, 3: 1.25 }
// Und was daraus am Schirm werden MUSS (app.css: `.gross-bild` und
// `.kachel-titel`). 260 ist der Deckel aus `min(260px, …)`.
const COVER_PX = { 1: 170, 2: 200, 3: 260 }
const TITEL_PX = { 1: 12.75, 2: 15, 3: 18.75 }

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
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

/** Die Darstellung stellen, wie es die Optik-Seite tut: `aktuell` GANZ. */
async function stellen(felder) {
  const stand = await (await fetch(new URL('/api/darstellung', ZIEL))).json()
  const aktuell = { ...(stand.aktuell || {}), ...felder }
  const a = await fetch(new URL('/api/darstellung', ZIEL), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ aktuell }),
  })
  if (!a.ok) throw new Error(`PUT /api/darstellung antwortete ${a.status}`)
}

let fehler = 0
try {
  await warte(1200)
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value
  const messen = async () => {
    await send(ws, 'Page.navigate', { url: ZIEL })
    await warte(1800)
    return await ev(`(() => {
      const s = getComputedStyle(document.documentElement)
      // Den grossen Player zum Messen aufdecken — siehe der Kasten oben.
      const gross = document.querySelector('.gross')
      if (gross) gross.hidden = false
      const bild = document.querySelector('.gross-bild')
      const kachel = document.querySelector('.kachel-titel')
      return {
        coverF: s.getPropertyValue('--mupi-cover-f').trim(),
        titelF: s.getPropertyValue('--mupi-titel-f').trim(),
        coverPx: bild ? Math.round(bild.getBoundingClientRect().width * 100) / 100 : null,
        titelPx: kachel ? Math.round(parseFloat(getComputedStyle(kachel).fontSize) * 100) / 100 : null,
      }
    })()`)
  }

  const pruefe = (name, ist, soll) => {
    // Zahlen mit Spielraum (Unterpixel), Zeichenketten genau.
    const gut =
      typeof soll === 'number' ? Number.isFinite(Number(ist)) && Math.abs(Number(ist) - soll) < 0.2 : String(ist) === String(soll)
    if (!gut) fehler++
    const zeile = `    ${gut ? 'ok  ' : 'FALSCH'} ${name.padEnd(38)} ist ${String(ist).padEnd(8)} soll ${soll}`
    if (gut) zeig(zeile)
    else console.error(zeile)
  }

  for (const stufe of [1, 2, 3]) {
    await stellen({ skalen: { cover: COVER_F[stufe], titel: TITEL_F[stufe] } })
    const m = await messen()
    pruefe(`Stufe ${stufe}: --mupi-cover-f`, m?.coverF ?? '(keine)', String(COVER_F[stufe]))
    pruefe(`Stufe ${stufe}: Cover-Kante am Schirm`, m?.coverPx ?? '(keine)', COVER_PX[stufe])
    pruefe(`Stufe ${stufe}: --mupi-titel-f`, m?.titelF ?? '(keine)', String(TITEL_F[stufe]))
    pruefe(`Stufe ${stufe}: Schrift unter der Kachel`, m?.titelPx ?? '(keine)', TITEL_PX[stufe])
  }

  // DER RUECKFALL: `skalen` ganz entfernen — eine Box mit alter
  // darstellung.json muss exakt beim bisherigen Stand landen (Stufe 2).
  {
    const stand = await (await fetch(new URL('/api/darstellung', ZIEL))).json()
    const aktuell = { ...(stand.aktuell || {}) }
    delete aktuell.skalen
    const a = await fetch(new URL('/api/darstellung', ZIEL), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ aktuell }),
    })
    if (!a.ok) throw new Error(`PUT /api/darstellung antwortete ${a.status}`)
    const m = await messen()
    pruefe('ohne skalen: Cover = alter Stand', m?.coverPx ?? '(keine)', COVER_PX[2])
    pruefe('ohne skalen: Schrift = alter Stand', m?.titelPx ?? '(keine)', TITEL_PX[2])
  }

  // ══ TEIL 2: DIE SCHREIBSEITE — durch die Oberflaeche, nicht per PUT ══════
  {
    // Ein FREMDER Schluessel im Stand, den kein Regler kennt: er muss das
    // Tippen ueberleben (siehe der Kasten oben).
    await stellen({ skalen: { fav: 1.4 } })
    await send(ws, 'Page.navigate', { url: ZIEL })
    await warte(1800)
    await adminAuf(ev, { warteMs: 1200 })

    /** Eine Gruppe in der Spalte antippen — ueber `data-fach`, nicht ueber Text. */
    const gruppe = async (id) => {
      await ev(`document.querySelector('#eltern-faecher [data-fach="${id}"]').click()`)
      await warte(800)
    }
    /** Eine Unterseite oeffnen. Ihre Sprung-Zeile traegt den Namen im aria-label. */
    const unterseite = async (name) => {
      const da = await ev(
        `(() => { const b = [...document.querySelectorAll('#fach-zeilen .fach-sprung')]
            .find((e) => (e.getAttribute('aria-label') || '').startsWith(${JSON.stringify(name)}))
          if (!b) return false
          b.click()
          return true })()`,
      )
      await warte(800)
      return da === true
    }
    /**
     * Die Zeile mit diesem Namen suchen, ihre Unterzeile lesen und den Knopf
     * druecken. Gefunden wird ueber das `aria-label` des Knopfes
     * (`wort + ' — ' + name`, siehe `zeileBauen`) — also ueber das, was auch
     * die Vorlesestimme hoert.
     */
    const zeileTippen = async (name) => {
      const vorher = await ev(
        `(() => { const z = [...document.querySelectorAll('#fach-zeilen .fach-zeile')]
            .find((e) => (e.querySelector('.zeile-name') || {}).textContent === ${JSON.stringify(name)})
          if (!z) return null
          const k = z.querySelector('.zeile-tat')
          if (!k) return null
          const unter = (z.querySelector('.zeile-unter') || {}).textContent || ''
          k.click()
          return { unter: unter.trim(), wort: k.textContent.trim() } })()`,
      )
      await warte(1200)
      return vorher
    }
    /** Was nach dem Tippen wirklich auf dem Server steht. */
    const skalenLesen = async () => ((await (await fetch(new URL('/api/darstellung', ZIEL))).json()).aktuell || {}).skalen || {}

    await gruppe('anzeige')
    pruefe('Admin: Unterseite „Player" ist da', await unterseite('Player'), true)
    const cov = await zeileTippen('Größe des Covers')
    pruefe('Admin: Zeile „Größe des Covers" ist da', cov ? 'ja' : '(fehlt)', 'ja')
    pruefe('Admin: sie steht auf dem alten Stand', cov?.unter ?? '(keine)', 'Wie groß das Albumbild im großen Player ist. Jetzt: mittel.')
    pruefe('Admin: ihr Knopf sagt die naechste Stufe', cov?.wort ?? '(keins)', 'groß')
    let sk = await skalenLesen()
    pruefe('nach dem Tippen: skalen.cover geschrieben', sk.cover ?? '(nichts)', 1.3)
    pruefe('nach dem Tippen: fremdes skalen.fav lebt', sk.fav ?? '(weg)', 1.4)

    await gruppe('anzeige')
    pruefe('Admin: Unterseite „Indikatoren" ist da', await unterseite('Indikatoren'), true)
    const tit = await zeileTippen('Größe der Namen')
    pruefe('Admin: Zeile „Größe der Namen" ist da', tit ? 'ja' : '(fehlt)', 'ja')
    pruefe('Admin: sie steht auf dem alten Stand', tit?.unter ?? '(keine)', 'Wie groß die Schrift unter den Kacheln ist. Jetzt: mittel.')
    sk = await skalenLesen()
    pruefe('nach dem Tippen: skalen.titel geschrieben', sk.titel ?? '(nichts)', 1.25)
    pruefe('nach dem Tippen: skalen.cover bleibt stehen', sk.cover ?? '(weg)', 1.3)
    pruefe('nach dem Tippen: fremdes skalen.fav lebt', sk.fav ?? '(weg)', 1.4)
  }

  if (!fehler) console.log('  beide Groessen-Regler stehen im Menue, schreiben `skalen` und wirken auf allen drei Stufen')
} catch (e) {
  fehler++
  console.error(`  Messung abgebrochen: ${e.message}`)
} finally {
  await brw.schliessen().catch(() => {})
  await leihe.zurueckgeben()
}
process.exitCode = PRUEFEN && fehler ? 1 : 0
