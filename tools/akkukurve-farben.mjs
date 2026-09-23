#!/usr/bin/env node
/**
 * DIE AKKUKURVE IN ALLEN ACHTZEHN STAENDEN — gemessen am gerenderten Bild.
 *
 * ══ WARUM ES DIESES WERKZEUG NEBEN farbsaetze-messen.mjs GIBT ══════════════
 *
 * Der Betreiber am 08.08.2026: „laed in gruen statt rot das ist ein bisschen
 * verwirrend". Das Ladeband trug bis dahin `--accentDark`, den roten
 * Hausakzent; rot heisst auf jedem anderen Schirm dieser Box „Achtung".
 *
 * tools/farbsaetze-messen.mjs rechnet die Paarung `--laden-gruen` gegen `--bg`
 * in allen achtzehn Staenden nach — aber es rechnet mit den Zahlen, die IN DER
 * LISTE stehen. Ob die Regel `.akku-band.laedt` am Ende wirklich diese Farbe
 * bekommt, weiss nur der Browser: eine spaetere Regel, ein vergessenes
 * `--accentDark` im Muster, eine Palette, die `--laden-gruen` ueberschreibt —
 * das alles faende eine Rechnung auf Vorrat nicht.
 *
 * HIER WIRD DESHALB GELESEN, WAS DER BROWSER MALT: `getComputedStyle` des
 * Balkens, des Schraffurstrichs und des Grunds, in jeder der neun Paletten
 * mal hell und dunkel — und der Kontrast daraus.
 *
 * ══ WAS ES PRUEFT ══════════════════════════════════════════════════════════
 *   1. Das Ladeband ist in JEDEM Stand GRUEN und nicht rot. Gemessen als
 *      Farbwinkel, nicht als Zeichenkette: `var(--laden-gruen)` kann in einer
 *      Palette etwas anderes werden, ohne dass der Name sich aendert.
 *   2. Es haelt die 3-zu-1-Marke fuer grafische Objekte (WCAG 1.4.11) gegen
 *      den Grund, auf dem es liegt.
 *   3. Die Schraffur traegt dieselbe Farbe wie der Umriss — sonst waere das
 *      Band zweifarbig und die Aussage unscharf.
 *   4. DIE FORM BLEIBT. Laden ist schraffiert (`url(#akku-m-laden)`), Entladen
 *      ist voll. Wer nur die Farbe tauscht, darf das nicht verlieren — sonst
 *      ist der Tausch fuer Menschen mit Farbsehschwaeche ein Verlust.
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * Nichts an einer Datei und NICHTS AN EINER BOX. Es leiht sich die Lage der
 * Vorschau und legt sie wieder hin ([[vorschau-wird-geliehen]]).
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/akkukurve-farben.mjs
 *   node tools/akkukurve-farben.mjs --bilder /tmp/akkufarben
 * ENDE 0, wenn jede Aussage haelt.
 */
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { SAETZE as FARBSAETZE } from './farbsaetze-bauen.mjs'
import { kontrast } from './kontrast.mjs'
import { eigenerBrowser, freierPort, vorschauLeihen } from './leihgabe.mjs'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const ARGS = process.argv.slice(2)
const holen = (n) => {
  const i = ARGS.indexOf(n)
  return i >= 0 ? ARGS[i + 1] : null
}
const BILDER = holen('--bilder')
const MITGEGEBEN = holen('--ziel')
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

/* ── DIE STAENDE ───────────────────────────────────────────────────────────
 * JEDER Farbsatz, hell und dunkel. DIE LISTE WIRD NICHT ABGESCHRIEBEN,
 * sondern aus `SAETZE` in tools/farbsaetze-bauen.mjs geholt — dort steht sie
 * ohnehin, und eine zweite Abschrift lief am 08.08.2026 schon einmal
 * zurueck: Das Werkzeug mass fuenf Saetze weiter, als es neun gab, und
 * meldete dabei GRUEN. Ein Pruefer, der die Haelfte nicht ansieht und
 * trotzdem gruen sagt, ist schlimmer als keiner.
 *
 * `creme` TRAEGT KEIN ATTRIBUT — so steht es auch in app.js
 * (`FARB_VORGABE`), und ein `data-farbe='creme'` waere ein anderer Wahler
 * als die Vorgabe. */
const FARBEN = FARBSAETZE.map((x) => x.id)
/** Die Marke fuer grafische Objekte (WCAG 2.1, 1.4.11). */
const MARKE = 3.0

let fehler = 0
const sagt = (satz, wahr, dazu = '') => {
  if (wahr) console.log(`  ok    ${satz}${dazu ? '  — ' + dazu : ''}`)
  else {
    fehler++
    console.log(`  NEIN  ${satz}${dazu ? '  — ' + dazu : ''}`)
  }
}

/** `rgb(34, 160, 85)` -> `#22a055`. Alles andere -> null. */
function hex(s) {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(String(s ?? ''))
  if (!m) return null
  return '#' + [1, 2, 3].map((i) => Math.round(Number(m[i])).toString(16).padStart(2, '0')).join('')
}

/**
 * IST DAS GRUEN? — als Farbwinkel und nicht als Zeichenkette.
 *
 * Ein Vergleich gegen `'#22a055'` haette geprueft, dass jemand denselben Text
 * hingeschrieben hat. Gefragt ist aber, ob am Schirm etwas Gruenes steht.
 * 80 bis 170 Grad ist der gruene Sektor; Rot liegt bei 0 bis 20, und genau der
 * Fall soll auffallen.
 */
function gruenlich(h) {
  if (!h) return false
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max - min < 0.06) return false // grau ist keine Farbe
  let wink
  if (max === r) wink = ((g - b) / (max - min)) * 60
  else if (max === g) wink = (2 + (b - r) / (max - min)) * 60
  else wink = (4 + (r - g) / (max - min)) * 60
  if (wink < 0) wink += 360
  return wink >= 80 && wink <= 170
}

let vorschau = null
let ZIEL = MITGEGEBEN
process.on('exit', () => {
  try {
    vorschau?.kill()
  } catch {
    /* schon weg */
  }
})

if (!ZIEL) {
  const p = await freierPort()
  ZIEL = `http://127.0.0.1:${p}/neu/`
  vorschau = spawn(process.execPath, ['tools/neu-vorschau.mjs', '--port', String(p)], { cwd: WURZEL, stdio: 'ignore' })
  vorschau.unref()
  const bis = Date.now() + 10000
  for (;;) {
    try {
      await fetch(`http://127.0.0.1:${p}/api/werke`)
      break
    } catch {
      if (Date.now() > bis) throw new Error('tools/neu-vorschau.mjs kam nicht hoch')
      await warte(150)
    }
  }
}
console.log(`\nZIEL: ${ZIEL}${vorschau ? '  (eigene Vorschau)' : '  (mitgegeben)'}\n`)

const geliehen = await vorschauLeihen(ZIEL)

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

const browser = await eigenerBrowser({ fenster: '800,480' })
if (!browser) {
  console.log('  kein Browser gefunden — nichts gemessen')
  await geliehen.zurueckgeben()
  process.exit(1)
}

let ws = null
try {
  if (BILDER) await mkdir(BILDER, { recursive: true })
  ws = new WebSocket(await browser.seite(), { perMessageDeflate: false })
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })

  const ev = async (e) => {
    const r = await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'Fehler in der Seite')
    return r.result.value
  }

  // Die Lage: eine Kurve mit einem Ladeabschnitt darin.
  await fetch(new URL('/vorschau/spielt', ZIEL)).catch(() => {})

  for (const farbe of FARBEN) {
    for (const stand of ['hell', 'dunkel']) {
      // DER SPEICHER WIRD VOR DEM LADEN GESETZT und die Seite danach neu
      // geholt: Der Einzeiler im Kopf von index.html liest ihn, bevor
      // irgendetwas gezeichnet wird (gegen das Aufblitzen). Wer nachtraeglich
      // das Attribut setzt, misst eine Seite, die so nie hochkommt.
      await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
      await warte(1400)
      await ev(
        `(() => { try { localStorage.clear(); sessionStorage.clear();`
          + ` localStorage.setItem('mupibox_neu_licht_v1', '${stand}');`
          + ` localStorage.setItem('mupibox_neu_farbe_v1', '${farbe}') } catch (_) {} return true })()`,
      )
      await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
      await warte(1800)

      const ok = await ev(`(async () => {
        const w = document.getElementById('wappen')
        if (!w) return 'kein Wappen'
        w.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await new Promise((r) => setTimeout(r, 1200))
        const g = [...document.querySelectorAll('#eltern-faecher button')].find((b) => b.textContent.trim() === 'System')
        if (!g) return 'keine Gruppe System'
        g.click()
        await new Promise((r) => setTimeout(r, 500))
        const z = [...document.querySelectorAll('#fach-zeilen .fach-zeile')]
          .find((x) => ((x.querySelector('.zeile-name') || {}).textContent || '') === 'Akku')
        if (!z) return 'keine Zeile Akku'
        ;(z.querySelector('button') || z).click()
        await new Promise((r) => setTimeout(r, 1800))
        return 'ok'
      })()`)
      if (ok !== 'ok') throw new Error(`Die Seite „Akku" liess sich nicht aufschlagen: ${ok}`)

      const g = await ev(`(() => {
        const svg = document.querySelector('svg.akku-kurve')
        if (!svg) return null
        const laden = svg.querySelector('rect.akku-band.laedt')
        const entladen = svg.querySelector('rect.akku-band.entlaedt')
        const strich = svg.querySelector('.akku-m-strich')
        const s = (e) => e ? getComputedStyle(e) : null
        const sl = s(laden), se = s(entladen), ss = s(strich)
        return {
          ladenStrich: sl ? sl.stroke : null,
          ladenFuellung: sl ? sl.fill : null,
          entladenStrich: se ? se.stroke : null,
          entladenFuellung: se ? se.fill : null,
          musterStrich: ss ? ss.fill : null,
          grund: getComputedStyle(document.body).backgroundColor,
          gesetzt: document.documentElement.getAttribute('data-farbe') + '/' + document.documentElement.getAttribute('data-licht'),
        }
      })()`)

      console.log(`══ ${farbe} · ${stand} ${'═'.repeat(Math.max(0, 40 - farbe.length - stand.length))}`)
      if (!g) {
        sagt('die Kurve steht da', false, 'kein SVG')
        continue
      }
      const strich = hex(g.ladenStrich)
      const muster = hex(g.musterStrich)
      const grund = hex(g.grund)
      // CREME TRAEGT KEIN ATTRIBUT. Es ist die Vorgabe, und die Vorgabe steht
      // in `:root` — `data-farbe` bleibt dann weg. Beim ersten Lauf hat diese
      // Zeile deshalb zweimal „NEIN" gemeldet, obwohl der Stand richtig war.
      const erwartet = farbe === 'creme' ? `null/${stand}` : `${farbe}/${stand}`
      sagt('der Stand ist wirklich eingestellt', g.gesetzt === erwartet, g.gesetzt)
      sagt('das Ladeband ist GRUEN und nicht rot', gruenlich(strich), String(strich))
      sagt('die Schraffur traegt dieselbe Farbe', strich === muster, `${strich} / ${muster}`)
      const k = strich && grund ? kontrast(strich, grund) : 0
      sagt(`es haelt die ${MARKE}-zu-1-Marke gegen den Grund`, k >= MARKE, `${strich} auf ${grund} = ${k.toFixed(2)} : 1`)
      // DIE FORM IST DAS ERSTE MERKMAL UND BLEIBT ES.
      sagt('Laden ist schraffiert', /akku-m-laden/.test(String(g.ladenFuellung)), String(g.ladenFuellung))
      sagt('Entladen ist VOLL und nicht schraffiert', !/url\(/.test(String(g.entladenFuellung)), String(g.entladenFuellung))

      if (BILDER) {
        const s = await send(ws, 'Page.captureScreenshot', { format: 'png' })
        const p = join(BILDER, `akku-${farbe}-${stand}.png`)
        await writeFile(p, Buffer.from(s.data, 'base64'))
        console.log(`      Bild: ${p}`)
      }
    }
  }
} finally {
  try {
    ws?.close()
  } catch {
    /* egal */
  }
  await browser.aufraeumen?.()
  await geliehen.zurueckgeben()
}

console.log(fehler === 0 ? '\nALLES GRUEN\n' : `\n${fehler} Abweichung(en)\n`)
process.exit(fehler === 0 ? 0 : 1)
