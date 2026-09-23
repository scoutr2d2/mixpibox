/**
 * DIE BILDWAHL MIT ZWEI EBENEN — nachgemessen, nicht nachgedacht.
 *
 * ══ WOZU ══════════════════════════════════════════════════════════════════
 * Betreiber, 08.08.2026: „es gibt auch doppelte kannst du die jeweiligen
 * zusammen fassen das man auf einen klickt und dann alle von dem mixpie
 * auswählen kann" — und später „die profil bilder zu gruppieren beim klick
 * öffnet sich der jeweilige mixpi in de profil auswahl".
 *
 * 78 Bilder sind acht Bildschirme zum Rollen. Seit der Gruppierung zeigt die
 * Wahl erst die Figuren und nach dem Tippen deren Posen. Ob das am Schirm
 * stimmt, sieht man nicht am Quelltext: `figurGruppen()` laesst sich zwar
 * ausrechnen, aber ob die zweite Ebene wirklich AUFGEHT, ob der Rueckweg da
 * ist und ob die Kacheln noch tastbar sind, entscheidet die Seite.
 *
 * ══ WAS ES PRUEFT ═════════════════════════════════════════════════════════
 *   1. Erste Ebene: es stehen GRUPPEN da, nicht 78 Bilder.
 *   2. Jede Gruppenkachel traegt ihre Anzahl im Namen.
 *   3. Ein Tipp auf eine Gruppe zeigt genau deren Bilder — und NUR deren.
 *   4. Auf der zweiten Ebene steht der Rueckweg „← Alle Figuren" als erste
 *      Kachel (er ist keine Randleiste, sondern eine Kachel wie die anderen).
 *   5. Das kindlose MixPi steht NUR in seiner eigenen Gruppe.
 *   6. Jede Kachel bleibt tastbar: die kurze Seite >= 66 px (9 mm nach
 *      ISO 9241-411 auf 0,14 mm/px).
 *
 * ══ WAS ES AENDERT ════════════════════════════════════════════════════════
 * Nichts an der Box. Es tippt in einer Vorschau auf Kacheln und liest ab; die
 * Bildwahl selbst wird NIE bestaetigt (`bildWaehlen` wird nicht ausgeloest) —
 * sonst truege es dem Kind ein Bild ein, das niemand wollte.
 *
 * ══ AUFRUF ════════════════════════════════════════════════════════════════
 *     node tools/neu-vorschau.mjs --port 9317 &
 *     node tools/bildwahl-gruppen-schau.mjs --ziel http://127.0.0.1:9317/neu/
 *     node tools/bildwahl-gruppen-schau.mjs --pruefen      # Ende 1 bei Fehler
 *     node tools/bildwahl-gruppen-schau.mjs --bild /tmp/bildwahl.png
 *
 * NICHT GEGEN DIE BOX: Der Eltern-Bereich braucht echten Fokus, und ein
 * Fernzugriff bekommt ihn nicht — gegen die VORSCHAU messen, den Server
 * getrennt mit curl. Die Bildwahl selbst liegt zwar davor, aber die Vorschau ist der
 * Ort, an dem man tippen darf, ohne dem Kind etwas umzustellen.
 */
import { writeFileSync } from 'node:fs'
import { WebSocket } from 'ws'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const argv = process.argv.slice(2)
const opt = (n) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? argv[i + 1] : null
}
const ZIEL = opt('ziel') || 'http://127.0.0.1:9317/neu/'
const NUR_PRUEFEN = argv.includes('--pruefen')
const BILD = opt('bild')

/** 9 mm auf 0,14 mm/px. Steht so in tools/beruehrziele-neu.mjs. */
const GRIFF = 66

const leihe = await vorschauLeihen(ZIEL).catch(() => null)
const brw = await eigenerBrowser({ fenster: '800,480' }).catch(async (e) => {
  if (leihe) await leihe.zurueckgeben()
  console.error(`  Browser kam nicht hoch: ${e.message}`)
  process.exit(2)
})

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
const soll = (was, ist, erwartet) => {
  const ok = JSON.stringify(ist) === JSON.stringify(erwartet)
  console.log(`  ${ok ? 'ok  ' : 'FEHL'} ${String(was).padEnd(48)} ${JSON.stringify(ist)}`)
  if (!ok) {
    fehler++
    console.error(`          erwartet: ${JSON.stringify(erwartet)}`)
  }
}
const zeile = (was, wert) => console.log(`  ${String(was).padEnd(53)} ${wert}`)

/**
 * WAS AUF DEM GITTER STEHT — als Daten.
 *
 * Gelesen wird `aria-label` und die Beschriftung, nicht die Bildquelle: Ob
 * eine Kachel „Junge 2 (12)" heisst, ist die Frage; welche Datei ihr Bild
 * hat, entscheidet sie selbst.
 */
const GITTER = `(() => {
  const g = document.getElementById('ich-bilder')
  if (!g) return null
  const k = [...g.querySelectorAll('.ich-kachel')].map((e) => {
    const r = e.getBoundingClientRect()
    const w = e.querySelector('.ich-kachel-wort')
    return {
      wort: (w ? w.textContent : e.textContent).trim(),
      gewaehlt: e.getAttribute('aria-pressed') === 'true',
      griff: Math.round(Math.min(r.width, r.height)),
    }
  })
  return JSON.stringify({ anzahl: k.length, kacheln: k })
})()`

try {
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 800,
    height: 480,
    deviceScaleFactor: 2,
    mobile: false,
  })
  const ev = async (e) =>
    (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.value

  await send(ws, 'Page.navigate', { url: ZIEL + '?f=' + process.pid })
  await warte(3200)

  // DAS FENSTER GEHT UEBER SEINEN EIGENEN KNOPF AUF und nicht ueber einen
  // Aufruf ins Innere: Was ein Kind nicht antippen kann, muss auch dieses
  // Werkzeug nicht messen.
  await ev(`document.getElementById('ich').click()`)
  await warte(700)

  const roh = await ev(GITTER)
  if (!roh) {
    console.error('  FEHLER  das Bildgitter steht nicht da — Fenster nicht aufgegangen?')
    process.exit(2)
  }
  const eins = JSON.parse(roh)

  console.log('\n══ ERSTE EBENE — die Figuren ═════════════════════════════════')
  for (const k of eins.kacheln) zeile(`  ${k.wort}`, `${k.griff} px${k.gewaehlt ? '   (gewaehlt)' : ''}`)

  // ZWEI EBENEN GIBT ES ERST AB ZWOELF BILDERN UND MEHR ALS EINER GRUPPE.
  // Steht in der Vorschau nur ein Dutzend Bilder, ist EINEBENIG richtig — das
  // Werkzeug sagt dann, was es sieht, statt einen Fehler zu melden.
  const mitZahl = eins.kacheln.filter((k) => /\(\d+\)$/.test(k.wort))
  if (!mitZahl.length) {
    console.log('\n  Diese Vorschau hat zu wenige Bilder fuer zwei Ebenen — einebenig ist hier richtig.')
    zeile('  Kacheln', eins.anzahl)
    process.exit(fehler && NUR_PRUEFEN ? 1 : 0)
  }

  soll('erste Ebene zeigt Gruppen, nicht alle Bilder', eins.anzahl === mitZahl.length, true)
  soll('erste Ebene ist ein Bildschirm wert (<= 20 Kacheln)', eins.anzahl <= 20, true)
  const engErste = eins.kacheln.filter((k) => k.griff < GRIFF)
  soll(`jede Gruppenkachel >= ${GRIFF} px`, engErste.map((k) => `${k.wort}:${k.griff}`), [])

  // ── HINEIN IN EINE GRUPPE ────────────────────────────────────────────────
  // Genommen wird die GROESSTE Gruppe ausser MixPi: dort faellt am ehesten
  // auf, wenn versehentlich alle 78 Bilder stehenbleiben.
  const ziel = mitZahl
    .filter((k) => !/^MixPi/.test(k.wort))
    .sort((a, b) => Number(/\((\d+)\)/.exec(b.wort)[1]) - Number(/\((\d+)\)/.exec(a.wort)[1]))[0]
  const erwartet = Number(/\((\d+)\)/.exec(ziel.wort)[1])
  console.log(`\n══ ZWEITE EBENE — Tipp auf „${ziel.wort}" ══════════════════`)

  await ev(`(() => {
    const g = document.getElementById('ich-bilder')
    const k = [...g.querySelectorAll('.ich-kachel')].find(e => e.textContent.trim().indexOf(${JSON.stringify(ziel.wort)}) === 0)
    if (k) k.click()
    return !!k
  })()`)
  await warte(500)
  const zwei = JSON.parse(await ev(GITTER))
  for (const k of zwei.kacheln.slice(0, 4)) zeile(`  ${k.wort}`, `${k.griff} px`)
  if (zwei.anzahl > 4) zeile(`  … und ${zwei.anzahl - 4} weitere`, '')

  soll('der Rueckweg ist die erste Kachel', zwei.kacheln[0]?.wort, '← Alle Figuren')
  soll('genau die Bilder dieser Gruppe (plus Rueckweg)', zwei.anzahl, erwartet + 1)
  soll('das kindlose MixPi steht hier NICHT', zwei.kacheln.some((k) => k.wort === 'MixPi'), false)
  const engZwei = zwei.kacheln.filter((k) => k.griff < GRIFF)
  soll(`jede Bildkachel >= ${GRIFF} px`, engZwei.map((k) => `${k.wort}:${k.griff}`), [])

  // ── UND WIEDER ZURUECK ───────────────────────────────────────────────────
  await ev(`(() => {
    const g = document.getElementById('ich-bilder')
    const k = [...g.querySelectorAll('.ich-kachel')][0]
    if (k) k.click()
    return true
  })()`)
  await warte(500)
  const drei = JSON.parse(await ev(GITTER))
  soll('der Rueckweg fuehrt auf die Figuren zurueck', drei.anzahl, eins.anzahl)

  if (BILD) {
    for (const licht of ['hell', 'dunkel']) {
      await ev(`(()=>{document.documentElement.setAttribute('data-licht','${licht}'); return 1})()`)
      await warte(350)
      const d = (await send(ws, 'Page.captureScreenshot', { format: 'png' })).data
      const weg = BILD.replace(/(\.png)?$/, `-${licht}.png`)
      writeFileSync(weg, Buffer.from(d, 'base64'))
      console.log(`  Bild: ${weg}`)
    }
  }

  console.log(fehler ? `\n${fehler} Abweichung(en)` : '\nalles haelt')
} finally {
  await brw.schliessen()
  if (leihe) await leihe.zurueckgeben()
}
process.exit(fehler && NUR_PRUEFEN ? 1 : 0)
