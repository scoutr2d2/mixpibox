#!/usr/bin/env node
/**
 * WAS KOSTET ES, EIN ZU KLEINES ZIEL AUF 9 mm ZU BRINGEN?
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 *
 * tools/beruehrziele-neu.mjs sagt, WELCHE Ziele zu klein sind (llmwiki
 * [[beruehrziele-neue-oberflaeche-gemessen]]). Das ist eine Liste. Zum PLAN
 * fehlt die zweite Zahl: was passiert mit den NACHBARN, wenn das Ziel waechst.
 * Ohne sie klingt „auf 9 mm bringen" nach einer Zeile CSS und ist in
 * Wirklichkeit entweder gratis (der Behaelter hat Luft) oder unmoeglich (die
 * Reihe ist schon voll und etwas anderes muss weichen).
 *
 * DIE MARKE: 9 mm = 64,3 px bei 0,14 mm/px (ISO 9241-411, 5"-Schirm 800x480).
 * DARUM GEHT ES BEI DEN MEISTEN ZIELEN UM GENAU EINEN BILDPUNKT: 64 px sind
 * 8,96 mm. Ein 64er Knopf verfehlt die Marke um 0,3 px, nicht um eine
 * Handbreit. Wer das nicht trennt, plant fuer 95 Ziele, wo 12 gemeint sind.
 *
 * ══ WAS GEMESSEN WIRD ══════════════════════════════════════════════════════
 *
 * Je Ziel:
 *   * sein Rechteck und seine SCHMALERE Seite (das ist die Zahl, die zaehlt)
 *   * der Behaelter, in dem es sitzt, und dessen freie Breite/Hoehe
 *   * die NACHBARN in demselben Behaelter, mit dem Abstand zu jedem
 *   * was UEBER ihm liegt, wenn es waechst — getastet mit elementFromPoint an
 *     den vier Raendern des VERGROESSERTEN Rechtecks. Nur so faellt auf, dass
 *     ein Knopf beim Wachsen unter eine Ebene geraet, die heute daneben liegt.
 *
 * WAS ES AENDERT: nichts. Eigener Browser gegen tools/neu-vorschau.mjs, die
 * geliehene Lage wird zurueckgelegt (tools/leihgabe.mjs).
 *
 * AUFRUF
 *   node tools/e8-kosten-messen.mjs [http://127.0.0.1:8299/neu/]
 */
import WebSocket from 'ws'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'

const ZIEL = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8299/neu/'
const MM_JE_PIXEL = 0.14
const MARKE_PX = 9 / MM_JE_PIXEL // 64,29

const leihe = await vorschauLeihen(ZIEL)
const brw = await eigenerBrowser({ fenster: '800,480' }).catch(async (e) => {
  await leihe.zurueckgeben()
  console.error(`  Browser kam nicht hoch: ${e.message}`)
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

/** Die Messung im Browser. Nimmt eine CSS-Wahl, gibt je Treffer die Kosten. */
const MESSEN = (wahl) => `(() => {
  const MARKE = ${MARKE_PX}
  const el = [...document.querySelectorAll(${JSON.stringify(wahl)})]
  const rr = (e) => { const r = e.getBoundingClientRect()
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
             r: Math.round(r.right), b: Math.round(r.bottom) } }
  const name = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') +
    (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/).join('.') : '')
  return el.map((e) => {
    const r = rr(e)
    const schmal = Math.min(r.w, r.h)
    const p = e.parentElement
    const pr = rr(p)
    const ps = getComputedStyle(p)
    // Die Geschwister, die WIRKLICH Platz belegen (nicht die versteckten).
    const gesch = [...p.children].filter((c) => c !== e && c.getBoundingClientRect().width > 0).map((c) => {
      const cr = rr(c)
      // Abstand in der Richtung, in der die Reihe laeuft — waagerecht, wenn
      // sich die Rechtecke senkrecht ueberlappen, sonst senkrecht.
      const ueberlapptY = cr.y < r.b && cr.b > r.y
      const luecke = ueberlapptY
        ? (cr.x >= r.r ? cr.x - r.r : r.x >= cr.r ? r.x - cr.r : 0)
        : (cr.y >= r.b ? cr.y - r.b : r.y >= cr.b ? r.y - cr.b : 0)
      return { name: name(c).slice(0, 46), richtung: ueberlapptY ? 'waagerecht' : 'senkrecht',
               luecke, w: cr.w, h: cr.h }
    })
    // Belegte Breite/Hoehe im Behaelter — daraus die LUFT.
    const kinder = [...p.children].filter((c) => c.getBoundingClientRect().width > 0).map(rr)
    const belegtB = kinder.reduce((s, c) => s + c.w, 0)
    const belegtH = kinder.reduce((s, c) => s + c.h, 0)
    // WOHIN WUERDE ES WACHSEN? Das vergroesserte Rechteck an den vier Raendern
    // abtasten: wer dort antwortet, ist der, den es beim Wachsen trifft.
    const noetig = Math.max(0, Math.ceil(MARKE - schmal))
    const halb = Math.ceil(noetig / 2)
    const tasten = []
    for (const [tx, ty, wo] of [
      [r.x - halb - 1, r.y + r.h / 2, 'links'], [r.r + halb + 1, r.y + r.h / 2, 'rechts'],
      [r.x + r.w / 2, r.y - halb - 1, 'oben'], [r.x + r.w / 2, r.b + halb + 1, 'unten'],
    ]) {
      if (tx < 0 || ty < 0 || tx >= innerWidth || ty >= innerHeight) { tasten.push({ wo, wer: '(ausserhalb des Schirms)' }); continue }
      const t = document.elementFromPoint(Math.round(tx), Math.round(ty))
      tasten.push({ wo, wer: t ? (e.contains(t) ? '(sich selbst)' : name(t).slice(0, 46)) : '(nichts)' })
    }
    return {
      name: name(e).slice(0, 60), beschriftung: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 46),
      rect: r, schmal, mm: +(schmal * ${MM_JE_PIXEL}).toFixed(2), noetig,
      behaelter: { name: name(p).slice(0, 46), rect: pr, anzeige: ps.display, richtung: ps.flexDirection || '',
                   luftB: pr.w - belegtB, luftH: pr.h - belegtH, kinder: kinder.length },
      geschwister: gesch.slice(0, 8), tasten,
    }
  })
})()`

try {
  await warte(1500)
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  // 800x480 GENAU — ohne das gibt headless nur 337 px Hoehe her, siehe
  // tools/beruehrziele-neu.mjs.
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })
  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value
  const stand = async (was) => {
    await fetch(new URL(`/vorschau/${was}`, ZIEL)).catch(() => null)
    await warte(150)
  }
  const neuLaden = async () => {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(2200)
  }
  const rollenZu = async (wahl) => {
    await ev(`(() => { const e = document.querySelector(${JSON.stringify(wahl)}); if (e) e.scrollIntoView({ block: 'center' }); return !!e })()`)
    await warte(900)
  }

  const SCHIRME = [
    {
      name: 'start — Kopfleiste und Mini-Player',
      hin: async () => {
        await stand('voll'); await stand('spielt'); await neuLaden()
      },
      // `#einst-knopf` (das Zahnrad) stand hier bis zum 06.08.2026; es ist
      // ersatzlos entfallen. An seiner Stelle steht `#wappen` — der Schriftzug
      // unten links, der seither der Weg ins Admin-Menue IST und damit ein
      // Beruehrziel, das vorher keines war.
      wahl: ['#mp-spiel', '#mp-vor', '#mp-zurueck', '#mp-laut', '.mp-bild', '.mp-text', '#wappen', '.kat'],
    },
    {
      name: 'lane-tief — der Spielknopf auf der Titelkachel',
      hin: async () => {
        await stand('voll'); await stand('spielt'); await neuLaden()
        await rollenZu('#raster .kachel')
        await ev(`(() => { const k = [...document.querySelectorAll('#raster .kachel')].find((x) => x.querySelector('.tipp-spiel')); if (k) k.click(); return !!k })()`)
        for (let n = 0; n < 16; n++) { await warte(250); if (await ev(`document.querySelectorAll('.lane-kachel').length > 0`)) break }
        await ev(`(() => { const k = document.querySelector('.lane-kachel'); if (k) k.click(); return !!k })()`)
        for (let n = 0; n < 16; n++) { await warte(250); if (await ev(`document.querySelectorAll('.lane-kachel.stueck').length > 0`)) break }
        await rollenZu('.lane-kachel.stueck')
      },
      wahl: ['.tipp-spiel', '.lane-kachel.stueck', '#zurueck'],
    },
    {
      name: 'laut — Regler und was darunter liegt',
      hin: async () => {
        await stand('voll'); await stand('spielt'); await neuLaden()
        await ev(`(() => { const k = document.getElementById('mp-laut'); if (k) k.click(); return !!k })()`)
        await warte(900)
      },
      wahl: ['#mp-laut-regler', '.mp-laut-fenster', '.leute-kachel'],
    },
    {
      name: 'player — der Stellschieber',
      hin: async () => {
        await stand('voll'); await stand('spielt'); await neuLaden()
        await ev(`(() => { const a = document.querySelector('.mp-bild'); if (a) a.click(); return !!a })()`)
        await warte(900)
      },
      wahl: ['#gr-schieber', '#gr-spiel', '#zurueck'],
    },
    {
      name: 'cover-voll — die Knoepfe auf dem Bild',
      hin: async () => {
        await stand('voll'); await stand('spielt'); await neuLaden()
        await ev(`(() => { const a = document.querySelector('.mp-bild'); if (!a) return false; a.click()
          const c = document.querySelector('#gross .gross-bild'); if (c) c.click(); return !!c })()`)
        await warte(900)
      },
      wahl: ['#ag-lauter', '#ag-leiser', '#ag-spiel', '#zurueck'],
    },
  ]

  console.log(`KOSTEN, UM AUF 9 mm ZU KOMMEN — 800x480, ${MM_JE_PIXEL} mm/px, Marke ${MARKE_PX.toFixed(1)} px\n`)
  for (const s of SCHIRME) {
    console.log(`\n══ ${s.name} ${'═'.repeat(Math.max(0, 58 - s.name.length))}`)
    try {
      await s.hin()
    } catch (e) {
      console.log(`   NICHT ERREICHT: ${e.message}`)
      continue
    }
    for (const wahl of s.wahl) {
      const treffer = await ev(MESSEN(wahl))
      if (!treffer || !treffer.length) {
        console.log(`\n  ${wahl}: nicht im Baum`)
        continue
      }
      // Gleich grosse Geschwister nur EINMAL zeigen — vier PIN-Tasten mit
      // identischer Zahl sind eine Auskunft, nicht vier.
      const gesehen = new Set()
      for (const t of treffer) {
        const schluessel = `${t.name}|${t.schmal}|${t.rect.w}x${t.rect.h}`
        if (gesehen.has(schluessel)) continue
        gesehen.add(schluessel)
        const wieOft = treffer.filter((x) => `${x.name}|${x.schmal}|${x.rect.w}x${x.rect.h}` === schluessel).length
        console.log(`\n  ${t.name}${wieOft > 1 ? `  (${wieOft}x gleich)` : ''}`)
        console.log(`    „${t.beschriftung}"`)
        console.log(`    ${t.rect.w}x${t.rect.h} bei ${t.rect.x},${t.rect.y} — schmalste Seite ${t.schmal} px = ${t.mm} mm` +
          (t.noetig ? `  →  ${t.noetig} px FEHLEN` : '  →  schon ueber der Marke'))
        console.log(`    Behaelter ${t.behaelter.name} ${t.behaelter.rect.w}x${t.behaelter.rect.h} (${t.behaelter.anzeige}${t.behaelter.richtung ? ' ' + t.behaelter.richtung : ''}, ${t.behaelter.kinder} Kinder)`)
        console.log(`      Luft waagerecht ${t.behaelter.luftB} px, senkrecht ${t.behaelter.luftH} px`)
        for (const g of t.geschwister)
          console.log(`      Nachbar ${g.richtung.padEnd(11)} Luecke ${String(g.luecke).padStart(4)} px  ${g.name} (${g.w}x${g.h})`)
        console.log(`      beim Wachsen stiesse es auf: ${t.tasten.map((x) => `${x.wo}=${x.wer}`).join(', ')}`)
      }
    }
  }
} finally {
  await brw.schliessen()
  await leihe.zurueckgeben()
}
