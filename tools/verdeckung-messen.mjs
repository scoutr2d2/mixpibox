#!/usr/bin/env node
/**
 * WER LIEGT AUF WEM — die Ueberdeckungen der neuen Oberflaeche, in Bildpunkten.
 *
 * ══ WOZU, UND WARUM NEBEN DEN DREI VORHANDENEN WERKZEUGEN ══════════════════
 *
 * tools/beruehrziele-neu.mjs misst die GROESSE jedes Ziels. Es kennt genau EINE
 * Art von Ueberdeckung: die vollstaendige — ein Ziel, das an KEINEM Punkt mehr
 * zu treffen ist, faellt dort als „nicht treffbar" heraus. Wird ein Knopf zu
 * einem Drittel verdeckt, meldet es unveraendert seine volle Groesse und einen
 * Treffer in der Mitte. Genau mit dieser Zahl ist am 05.08.2026 belegt worden,
 * `--griff: 64px -> 66px` habe nichts verdeckt („nicht treffbar: unveraendert").
 * DIESE ZAHL KANN DAS NICHT BELEGEN. Sie wuerde sich erst ruehren, wenn ein
 * Ziel GANZ verschwindet.
 *
 * tools/zurueck-luft-messen.mjs misst Abstand und Ueberdeckung richtig — aber
 * nur fuer den EINEN Knopf `#zurueck`.
 *
 * tools/album-gross-schau.mjs misst die bemalte Coverflaeche gegen die
 * Bedienelemente — aber nur auf dem EINEN Schirm „grosse Albumansicht".
 *
 * Hier wird beides fuer JEDEN Schirm und JEDES Paar gemacht, und der Bericht
 * ist als JSON abgreifbar, damit sich zwei Baeume gegeneinander rechnen lassen
 * (`--json`). Die Frage, fuer die es gebaut wurde, lautet: Ist beim Wachsen der
 * Trefferflaechen irgendwo etwas VERDECKT worden?
 *
 * ══ WAS ALS „DING" ZAEHLT, UND WARUM NICHT NUR KNOEPFE ═════════════════════
 * [[rueckweg-verdeckt-die-ueberschrift]] ist die Lehre, die hier eingebaut ist:
 * Der Rueckweg lag mitten auf dem Wort „Eltern-Bereich", und alle vier
 * Pruefdurchgaenge waren gruen — weil sie Bedienelemente GEGENEINANDER massen
 * und eine Ueberschrift keines ist. Gezaehlt werden deshalb drei Sorten:
 *
 *   ZIEL   was angesteuert und getippt werden kann (dieselbe Auswahl wie in
 *          beruehrziele-neu.mjs, damit zwei Werkzeuge nicht zwei Mengen kennen)
 *   BILD   jedes <img> — und zwar mit seiner BEMALTEN Flaeche, nicht mit dem
 *          Kasten. `object-fit: contain` heisst, dass das Element groesser sein
 *          kann als das Bild darin; wer den Kasten schneidet, findet
 *          Ueberlappungen, die es nicht gibt (tools/album-gross-schau.mjs hat
 *          dieselbe Rechnung, hier steht sie ein zweites Mal, weil dieses
 *          Werkzeug alle Schirme sieht).
 *   WORT   ein Element mit eigenem Text — Ueberschriften, Titel, Zahlen.
 *
 * ══ WAS „UEBERDECKT" HEISST, UND WAS ES NICHT HEISST ═══════════════════════
 * Zwei Rechtecke, die sich schneiden und im Baum NICHT ineinander liegen. Ein
 * Kind auf seinem Elternteil ist keine Ueberdeckung, sondern der Bau der Seite
 * (der Play-Knopf liegt in der Kachel, der Titel liegt in der Kachel).
 *
 * WER OBEN LIEGT, WIRD GETASTET UND NICHT GERATEN: an der Mitte der
 * Schnittflaeche entscheidet `document.elementFromPoint`. Das beantwortet die
 * Frage, die einen Finger angeht — mit einer bekannten Grenze: eine Ebene mit
 * `pointer-events: none` (die Spielt-Marke etwa) liegt sichtbar oben und laesst
 * den Finger durch. Sie steht dann als Ueberdeckung im Bericht, und in der
 * Spalte „oben" steht, was der Finger trifft. Beides ist wahr und beides
 * gehoert hin.
 *
 * NICHT gemessen wird die Deckkraft: ein durchsichtiger Verlauf ueber einem
 * Cover zaehlt hier wie eine volle Ueberdeckung. Ein Werkzeug, das Farben liest,
 * waere eine andere Bauart; die Bildschirmfotos der anderen Werkzeuge sind die
 * Gegenprobe dafuer.
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * Nichts. Eigener headless-Browser gegen tools/neu-vorschau.mjs; eine fremde
 * Vorschau wird geliehen und ihre Lage im `finally` zurueckgelegt. Die Box wird
 * nicht angefasst.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *     node tools/verdeckung-messen.mjs
 *     node tools/verdeckung-messen.mjs --json > /tmp/nachher.json
 *     node tools/verdeckung-messen.mjs --schirm cover-voll
 *     node tools/verdeckung-messen.mjs --vergleich /tmp/vorher.json
 *     node tools/verdeckung-messen.mjs --griff 64   # dieselbe Seite, andere
 *                                                   # Trefferflaeche (nur die
 *                                                   # Variable, siehe unten)
 */
import WebSocket from 'ws'
import { readFileSync } from 'node:fs'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'
import { adminAuf } from './admin-weg.mjs'

const argv = process.argv.slice(2)
const hat = (n) => argv.includes(`--${n}`)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  if (i < 0) return v
  const w = argv[i + 1]
  return w && !w.startsWith('--') ? w : true
}
const ZIEL = argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const JSONAUS = hat('json')
const NUR = opt('schirm', null)
const GRIFF = opt('griff', null)
const VERGLEICH = opt('vergleich', null)

const MM_JE_PIXEL = 0.14
const warte = (ms) => new Promise((r) => setTimeout(r, ms))
const sagen = (...a) => {
  if (!JSONAUS) console.log(...a)
}

// ── DIE MESSUNG, IM BROWSER ────────────────────────────────────────────────
const MESSEN_JS = String.raw`
(() => {
  const WAHL = 'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="switch"], [tabindex]:not([tabindex="-1"])'

  const sichtbar = (e) => {
    const s = getComputedStyle(e)
    if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return false
    const r = e.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) return false
    if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return false
    /* UNSICHTBARKEIT WIRD VERERBT — DIESE ABFRAGE FRAGTE NUR DAS KIND.
     *
     * opacity 0 und visibility hidden gelten fuer den ganzen Teilbaum, ein
     * Kind darin meldet aber weiter opacity 1. Und ein Vorfahr mit
     * overflow hidden bei Breite 0 schneidet sein Kind ab, ohne dessen
     * Rechteck zu aendern.
     *
     * GEFUNDEN AM 06.08.2026, und es war kein theoretischer Fall: Seit der
     * Eltern-Bereich eine SEITE ist, wird das eingefahrene Kissen dort
     * mitgemessen. Sein .mp-text traegt eingefahren opacity 0, width 0 und
     * overflow hidden — das darin liegende #mp-zeit behielt sein volles
     * Rechteck, und dieses Werkzeug meldete auf BEIDEN Eltern-Schirmen eine
     * Ueberdeckung von 901 px2 (68 Prozent) durch #mp-zurueck. Am Schirm ist
     * dort nichts zu sehen. Eine Meldung, die es nicht gibt, kostet dasselbe
     * wie eine fehlende: beim naechsten Mal liest sie niemand mehr.
     * (Dieselbe Fehlerklasse, die maskottchen-zaehlen.mjs am selben Tag bei
     * pointer-events getroffen hat — nur dort in die bequeme Richtung.) */
    for (let n = e.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      const p = getComputedStyle(n)
      if (p.visibility === 'hidden' || p.display === 'none' || Number(p.opacity) === 0) return false
      if (p.overflow !== 'visible' || p.overflowX !== 'visible' || p.overflowY !== 'visible') {
        const b = n.getBoundingClientRect()
        if (b.width < 2 || b.height < 2) return false
      }
    }
    return true
  }

  /**
   * DIE BEMALTE FLAECHE EINES BILDES, nicht sein Kasten.
   * Bei 'object-fit: contain' sitzt das Bild mittig im Element und laesst zwei
   * Streifen frei. Wer den Kasten nimmt, findet Ueberlappungen, die es nicht
   * gibt — und uebersieht, dass ein Knopf im freien Streifen gar nichts verdeckt.
   */
  const bemalt = (e) => {
    const r = e.getBoundingClientRect()
    const nw = e.naturalWidth || 0
    const nh = e.naturalHeight || 0
    const passung = getComputedStyle(e).objectFit
    if (!nw || !nh || passung !== 'contain') return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
    const f = Math.min(r.width / nw, r.height / nh)
    const b = nw * f
    const h = nh * f
    const l = r.left + (r.width - b) / 2
    const o = r.top + (r.height - h) / 2
    return { left: l, top: o, right: l + b, bottom: o + h }
  }

  /** Hat das Element EIGENEN Text (nicht den seiner Kinder)? */
  const eigenerText = (e) => {
    let s = ''
    for (const k of e.childNodes) if (k.nodeType === 3) s += k.textContent
    return s.replace(/\s+/g, ' ').trim()
  }

  /**
   * LIEGT DAS DING UEBERHAUPT VORN?
   *
   * OHNE DIESE FRAGE IST DER BERICHT RAUSCHEN, und das war der erste Lauf: Steht
   * der grosse Player offen, bleiben die Kacheln der Buehne dahinter im Baum
   * stehen und sind nach jeder Stilangabe „sichtbar". Gezaehlt wurden dann
   * 577 000 px² Ueberdeckung auf dem Cover-Vollbild — jede Kachel gegen jedes
   * Wort, alles hinter derselben Ebene. Eine Zahl, die vom EINEN Befund
   * (verdeckt der Rueckweg das Cover?) nichts mehr uebrig laesst.
   *
   * VORN heisst: an mindestens einem Punkt seiner Flaeche ist das oberste
   * Element es selbst, ein Kind davon ODER EIN VORFAHRE. Der Vorfahr gehoert
   * ausdruecklich dazu — ein Bild in einem Knopf gibt bei elementFromPoint
   * den Knopf zurueck, und das Bild ist trotzdem zu sehen.
   */
  const vorn = (e, k) => {
    const l = Math.max(0, k.left ?? k.l)
    const o = Math.max(0, k.top ?? k.o)
    const r = Math.min(innerWidth - 1, k.right ?? k.r)
    const u = Math.min(innerHeight - 1, k.bottom ?? k.u)
    if (r <= l || u <= o) return false
    for (let i = 1; i <= 5; i++) {
      for (let j = 1; j <= 5; j++) {
        const x = Math.round(l + ((r - l) * i) / 6)
        const y = Math.round(o + ((u - o) * j) / 6)
        const g = document.elementFromPoint(x, y)
        if (g && (g === e || e.contains(g) || g.contains(e))) return true
      }
    }
    return false
  }

  const benennen = (e) => {
    const teile = [e.tagName.toLowerCase()]
    if (e.id) teile.push('#' + e.id)
    const kl = (e.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
    if (kl.length) teile.push('.' + kl.join('.'))
    const s = e.getAttribute('aria-label') || eigenerText(e) || (e.getAttribute('alt') || '')
    return teile.join('') + (s ? '  „' + s.slice(0, 26) + '"' : '')
  }

  // ── DIE DREI SORTEN ──────────────────────────────────────────────────────
  const dinge = []
  const gesehen = new Set()
  const dazu = (e, sorte, kasten) => {
    if (gesehen.has(e)) return
    gesehen.add(e)
    const k = kasten || e.getBoundingClientRect()
    if (!vorn(e, k)) return
    dinge.push({ e, sorte, l: k.left, o: k.top, r: k.right, u: k.bottom })
  }
  for (const e of document.querySelectorAll(WAHL)) {
    if (!sichtbar(e)) continue
    if (e.disabled === true || e.getAttribute('aria-disabled') === 'true') continue
    dazu(e, 'ZIEL')
  }
  for (const e of document.querySelectorAll('img')) {
    if (!sichtbar(e)) continue
    dazu(e, 'BILD', bemalt(e))
  }
  for (const e of document.querySelectorAll('body *')) {
    if (gesehen.has(e) || !eigenerText(e) || !sichtbar(e)) continue
    dazu(e, 'WORT')
  }

  // ── DIE PAARE ────────────────────────────────────────────────────────────
  // Auf den SICHTBAREN Ausschnitt beschnitten: was neben dem Schirm liegt,
  // ueberdeckt dort nichts, und zwei weggerollte Kacheln sind kein Befund.
  const kappen = (d) => ({
    l: Math.max(0, d.l), o: Math.max(0, d.o),
    r: Math.min(innerWidth, d.r), u: Math.min(innerHeight, d.u),
  })
  const raus = []
  for (let i = 0; i < dinge.length; i++) {
    for (let j = i + 1; j < dinge.length; j++) {
      const a = dinge[i]
      const b = dinge[j]
      // IM BAUM INEINANDER IST KEINE UEBERDECKUNG, sondern der Bau der Seite.
      if (a.e.contains(b.e) || b.e.contains(a.e)) continue
      const ka = kappen(a)
      const kb = kappen(b)
      const bx = Math.min(ka.r, kb.r) - Math.max(ka.l, kb.l)
      const by = Math.min(ka.u, kb.u) - Math.max(ka.o, kb.o)
      if (bx <= 0 || by <= 0) continue
      const flaeche = Math.round(bx * by)
      if (flaeche < 4) continue
      const mx = (Math.max(ka.l, kb.l) + Math.min(ka.r, kb.r)) / 2
      const my = (Math.max(ka.o, kb.o) + Math.min(ka.u, kb.u)) / 2
      const g = document.elementFromPoint(mx, my)
      const oben = !g ? '—' : a.e === g || a.e.contains(g) ? 'A' : b.e === g || b.e.contains(g) ? 'B' : 'fremd'
      raus.push({
        a: benennen(a.e), sorteA: a.sorte,
        b: benennen(b.e), sorteB: b.sorte,
        flaeche, breite: Math.round(bx), hoehe: Math.round(by), oben,
        // ANTEIL AM KLEINEREN der beiden: „2000 px² Ueberdeckung" heisst bei
        // einem Cover etwas anderes als bei einer Zahl.
        anteil: Math.round((flaeche / Math.max(1, Math.min(
          (ka.r - ka.l) * (ka.u - ka.o), (kb.r - kb.l) * (kb.u - kb.o)))) * 100),
      })
    }
  }
  raus.sort((x, y) => y.flaeche - x.flaeche)
  return JSON.stringify({
    dinge: dinge.length,
    griff: getComputedStyle(document.documentElement).getPropertyValue('--griff').trim(),
    paare: raus,
  })
})()
`

// ── Lauf ───────────────────────────────────────────────────────────────────
const leihe = await vorschauLeihen(ZIEL)
const brw = await eigenerBrowser()
if (!brw) {
  console.log('  kein Browser gefunden — uebersprungen')
  await leihe.zurueckgeben()
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

const berichte = []
let abbruch = 0
try {
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  // 800x480 GENAU — headless gibt sonst 800x337 her, und auf einem Schirm, den
  // es nicht gibt, liegt nichts dort, wo es liegt.
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })

  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value
  const stellen = async (was) => {
    await fetch(new URL(`/vorschau/${was}`, ZIEL)).catch(() => null)
    await warte(150)
  }
  const warteAuf = async (e, ms = 8000) => {
    const bis = Date.now() + ms
    while (Date.now() < bis) {
      if (await ev(e)) return true
      await warte(150)
    }
    return false
  }
  const neuLaden = async () => {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warteAuf(`!!document.getElementById('zustand')`)
    await warte(700)
    // DIE VARIABLE ERST NACH DEM LADEN, sonst nimmt sie die Seite nicht mit.
    // Sie aendert NUR `--griff` — alles, was daran haengt (Kopfzeilenhoehe,
    // Einzug, Tastenhoehe), folgt von selbst. Was NICHT daran haengt, folgt
    // auch nicht; genau das ist die Frage, die damit gestellt wird.
    if (GRIFF) await ev(`document.documentElement.style.setProperty('--griff', '${GRIFF}px')`)
    await warte(200)
  }
  const langHalten = async () => {
    // HIER STAND EIN GRIFF ANS ZAHNRAD `#einst-knopf`. Es ist am 06.08.2026
    // ersatzlos entfallen; hinein fuehrt der Schriftzug `#wappen`. Dieser Weg
    // ist der TASTATURWEG und prueft das Halten NICHT — tools/admin-weg.mjs.
    await adminAuf(ev, { warteMs: 700 })
  }
  const aufklappen = async () => {
    await warteAuf(`document.getElementById('raster').children.length > 0`)
    const wer = await ev(`(() => {
      const k = [...document.querySelectorAll('#raster .kachel')].find((x) => x.querySelector('.tipp-spiel'))
      if (!k) return null
      k.click(); return 'ok' })()`)
    if (!wer) throw new Error('keine aufklappbare Kachel im Raster')
    if (!(await warteAuf(`document.querySelectorAll('.lane-kachel').length > 0`, 6000)))
      throw new Error('die Lane klappte nicht auf')
  }

  const SCHIRME = [
    {
      name: 'start',
      was: 'Startseite mit Regalen und Mini-Player',
      hin: async () => {
        await stellen('voll')
        await stellen('spielt')
        await neuLaden()
      },
    },
    {
      name: 'raster',
      was: 'Raster einer Kategorie',
      hin: async () => {
        await stellen('voll')
        await stellen('spielt')
        await neuLaden()
        await ev(`(() => { const k = document.querySelectorAll('.kat')[1]; if (k) k.click(); return true })()`)
        await warte(900)
      },
    },
    {
      name: 'lane',
      was: 'aufgeklappte Album-Lane',
      hin: async () => {
        await stellen('voll')
        await stellen('spielt')
        await neuLaden()
        await aufklappen()
        await warte(900)
      },
    },
    {
      name: 'lane-tief',
      was: 'Titelliste eines Albums — die 96-px-Kacheln',
      hin: async () => {
        await stellen('voll')
        await stellen('spielt')
        await neuLaden()
        await aufklappen()
        await ev(`(() => { const k = document.querySelector('.lane-kachel'); if (k) k.click(); return true })()`)
        if (!(await warteAuf(`document.querySelectorAll('.lane-kachel.stueck').length > 0`, 6000)))
          throw new Error('die Titelliste klappte nicht auf')
        await warte(900)
      },
    },
    {
      name: 'player',
      was: 'grosser Player',
      hin: async () => {
        await stellen('voll')
        await stellen('spielt')
        await neuLaden()
        await ev(`(() => { const a = document.querySelector('.mp-bild'); if (a) a.click(); return true })()`)
        await warte(1100)
      },
    },
    {
      name: 'cover-voll',
      was: 'Cover-Vollbild — der ausdrueckliche Wunsch: ganz sichtbar',
      hin: async () => {
        await stellen('voll')
        await stellen('spielt')
        await neuLaden()
        await ev(`(() => {
          const a = document.querySelector('.mp-bild'); if (!a) return 'kein Mini-Player'
          a.click()
          const c = document.querySelector('#gross .gross-bild'); if (!c) return 'kein Cover'
          c.click(); return 'ok' })()`)
        await warte(1100)
      },
    },
    {
      name: 'laut',
      was: 'Lautstaerke-Fenster am Mini-Player',
      hin: async () => {
        await stellen('voll')
        await stellen('spielt')
        await neuLaden()
        await ev(`(() => { const k = document.getElementById('mp-laut'); if (k) k.click(); return true })()`)
        await warte(800)
      },
    },
    {
      name: 'eltern-tor',
      was: 'PIN-Tor',
      hin: async () => {
        await stellen('voll')
        await stellen('sperre-pin')
        await neuLaden()
        await langHalten()
        if (!(await ev(`!document.getElementById('eltern-tor').hidden`))) throw new Error('das Tor ging nicht auf')
      },
    },
    {
      name: 'eltern-flaeche',
      was: 'Eltern-Bereich mit Faechern',
      hin: async () => {
        await stellen('voll')
        await stellen('sperre-aus')
        await neuLaden()
        await langHalten()
        if (!(await ev(`!document.getElementById('eltern-flaeche').hidden`)))
          throw new Error('die Eltern-Flaeche ging nicht auf')
      },
    },
  ]

  for (const s of SCHIRME) {
    if (NUR && s.name !== NUR) continue
    try {
      await s.hin()
      const roh = await ev(MESSEN_JS)
      const d = JSON.parse(roh)
      berichte.push({ schirm: s.name, was: s.was, ...d })
    } catch (f) {
      abbruch++
      berichte.push({ schirm: s.name, was: s.was, fehler: String((f && f.message) || f), paare: [] })
    }
  }
} finally {
  await brw.schliessen()
  await leihe.zurueckgeben()
}

// ── Bericht ────────────────────────────────────────────────────────────────
if (JSONAUS) {
  console.log(JSON.stringify(berichte, null, 1))
} else {
  sagen(`UEBERDECKUNGEN DER NEUEN OBERFLAECHE — 800x480, ${MM_JE_PIXEL} mm/px`)
  sagen(`--griff: ${berichte.find((b) => b.griff)?.griff || '?'}${GRIFF ? `  (von aussen gestellt)` : ''}`)
  let summe = 0
  for (const b of berichte) {
    sagen(`\n── ${b.schirm} ${'─'.repeat(Math.max(0, 22 - b.schirm.length))}`)
    sagen(`   ${b.was}`)
    if (b.fehler) {
      sagen(`   FEHLER: ${b.fehler}`)
      continue
    }
    const s = b.paare.reduce((a, p) => a + p.flaeche, 0)
    summe += s
    sagen(`   ${b.dinge} Dinge, ${b.paare.length} Ueberdeckungen, zusammen ${s} px²`)
    for (const p of b.paare.slice(0, 12)) {
      sagen(`    ${String(p.flaeche).padStart(6)} px²  ${String(p.breite + 'x' + p.hoehe).padStart(9)}  ${p.anteil}% des kleineren`)
      sagen(`            ${p.oben === 'A' ? '↑' : ' '} ${p.sorteA} ${p.a}`)
      sagen(`            ${p.oben === 'B' ? '↑' : ' '} ${p.sorteB} ${p.b}`)
    }
    if (b.paare.length > 12) sagen(`    … ${b.paare.length - 12} weitere`)
  }
  sagen(`\nZUSAMMEN: ${summe} px² Ueberdeckung auf ${berichte.length} Schirmen.`)
}

// ── Vergleich mit einem frueheren Lauf ─────────────────────────────────────
if (VERGLEICH) {
  const alt = JSON.parse(readFileSync(String(VERGLEICH), 'utf8'))
  const schluessel = (p) => `${p.a} || ${p.b}`
  console.log(`\n══ VERGLEICH mit ${VERGLEICH} ══════════════════════════════`)
  for (const b of berichte) {
    const a = alt.find((x) => x.schirm === b.schirm)
    if (!a) continue
    const va = new Map(a.paare.map((p) => [schluessel(p), p]))
    const vb = new Map(b.paare.map((p) => [schluessel(p), p]))
    const zeilen = []
    for (const [k, p] of vb) {
      const q = va.get(k)
      if (!q) zeilen.push(`   NEU      ${p.flaeche} px²  ${p.a}  <->  ${p.b}`)
      else if (q.flaeche !== p.flaeche) zeilen.push(`   ${p.flaeche > q.flaeche ? 'MEHR' : 'weniger'}  ${q.flaeche} -> ${p.flaeche} px²  ${p.a}  <->  ${p.b}`)
    }
    for (const [k, p] of va) if (!vb.has(k)) zeilen.push(`   WEG      ${p.flaeche} px²  ${p.a}  <->  ${p.b}`)
    const sa = a.paare.reduce((x, p) => x + p.flaeche, 0)
    const sb = b.paare.reduce((x, p) => x + p.flaeche, 0)
    console.log(`\n── ${b.schirm}: ${sa} -> ${sb} px² (${sb - sa >= 0 ? '+' : ''}${sb - sa})`)
    if (!zeilen.length) console.log('   unveraendert')
    for (const z of zeilen) console.log(z)
  }
}

process.exit(abbruch ? 1 : 0)
