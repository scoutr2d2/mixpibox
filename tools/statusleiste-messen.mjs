/**
 * DIE STATUSANZEIGEN OBEN RECHTS AN DEN BILDPUNKTEN NACHMESSEN.
 *
 * WOZU (Betreiber, 08.08.2026): „bitte überprüfe das die icons alle gleich
 * groß sind und den gleichen abstand haben."
 *
 * Das ist keine Frage, die man am Quelltext beantwortet. Im Stilblatt steht
 * `gap: 9px` — was am Schirm herauskommt, haengt aber an der Breite jedes
 * einzelnen Zeichens, an seinem inneren `gap: 3px` (die Akkuzahl!) und daran,
 * welche Anzeigen ueberhaupt sichtbar sind. Zwei Zeichen mit gleichem
 * `width`-Attribut koennen verschieden breit RENDERN, wenn ihre viewBox ein
 * anderes Seitenverhaeltnis hat — genau das ist beim Akku der Fall (30x24
 * gegen 24x24 bei den anderen).
 *
 * ES MISST AUSSERDEM DIE OPTISCHE MITTE, nicht nur die Kaesten: Zeichen, deren
 * Kasten gleich gross ist, deren gezeichnete Flaeche aber verschieden hoch
 * sitzt, stehen am Schirm trotzdem versetzt.
 *
 * WAS ES AENDERT: nichts. Es liest die Vorschau und schreibt ein Bild.
 *
 * AUFRUF
 *     node tools/statusleiste-messen.mjs
 *     STATUS_ZIEL=http://192.168.178.169:8200/neu/ node tools/statusleiste-messen.mjs
 */
import { writeFileSync } from 'node:fs'
import { WebSocket } from 'ws'
import { eigenerBrowser } from './leihgabe.mjs'

const ZIEL = process.env.STATUS_ZIEL || 'http://127.0.0.1:9301/neu/'
const ORD = process.env.STATUS_ORD || '/tmp'

const brw = await eigenerBrowser()
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
const w = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  await w(1200)
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 2, mobile: false })
  const ev = async (e) =>
    (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.value

  await send(ws, 'Page.navigate', { url: ZIEL + '?f=' + Date.now() })
  await w(3000)

  // ALLE ANZEIGEN SICHTBAR MACHEN — sonst misst man die Abstaende einer
  // Leiste, in der die Haelfte fehlt, und haelt das Ergebnis fuer die Regel.
  // Das ist eine REINE ANZEIGE-Aenderung im Browser; es wird nichts geschrieben.
  // UND SIE BEKOMMEN EINEN ECHTEN ZUSTAND MIT. Beim ersten Lauf stand hier nur
  // `hidden = false` — dann zeichnet das Netz-Zeichen BALKEN UND KABEL
  // uebereinander (`.st-netz .netz-kabel` ist nur per Klasse aus), und das
  // Bild zeigte einen Klumpen, den es am Geraet nie gibt. Ein Messwerkzeug,
  // das einen Zustand herstellt, den es nicht gibt, misst nichts.
  await ev(`(()=>{
    for (const k of ['st-vol','st-bt','st-netz','st-wolke','st-akku','st-kette']) {
      const e = document.getElementById(k); if (e) e.hidden = false }
    const n = document.getElementById('st-netz')
    if (n) { n.classList.remove('ist-kabel','stufe1','stufe2'); n.classList.add('netz-gut') }
    const b = document.getElementById('st-bt')
    if (b) { b.classList.remove('bt-aus','bt-getrennt'); b.classList.add('bt-verbunden') }
    const k = document.getElementById('st-kette')
    if (k) k.classList.add('kombi')
    const v = document.getElementById('st-vol'); if (v) { v.classList.remove('stumm'); v.classList.add('stufe2') }
    const bz = document.getElementById('st-bt-zahl'); if (bz) { bz.hidden = false; bz.textContent = '2' }
    const z = document.getElementById('st-akku-zahl'); if (z && !z.textContent) z.textContent = '84%'
    return 1})()`)
  await w(400)

  for (const licht of ['hell', 'dunkel']) {
    await ev(`(()=>{document.documentElement.setAttribute('data-licht','${licht}'); return 1})()`)
    await w(500)
    const roh = await ev(`(() => {
      const leiste = document.getElementById('kopf-status')
      if (!leiste) return null
      const sicht = [...leiste.children].filter(e => !e.hidden && e.getBoundingClientRect().width > 0)
      const kaesten = sicht.map(e => {
        const r = e.getBoundingClientRect()
        const s = e.querySelector('svg')
        const sr = s ? s.getBoundingClientRect() : null
        // DIE GEZEICHNETE FLAECHE, nicht der Kasten: getBBox gibt die Huelle
        // der Pfade in viewBox-Einheiten. Erst damit sieht man, ob zwei
        // Zeichen wirklich gleich GROSS wirken.
        let bb = null
        if (s) { try { const g = s.getBBox(); bb = { x: g.x, y: g.y, w: g.width, h: g.height } } catch {} }
        const zahl = e.querySelector('.st-zahl')
        return {
          id: e.id,
          kasten: { l: Math.round(r.left * 10) / 10, b: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 },
          svg: sr ? { b: Math.round(sr.width * 10) / 10, h: Math.round(sr.height * 10) / 10,
                      oben: Math.round((sr.top - r.top) * 10) / 10 } : null,
          viewBox: s ? s.getAttribute('viewBox') : null,
          gezeichnet: bb,
          zahl: zahl ? zahl.textContent : null,
        }
      })
      // ══ GEMESSEN WIRD VON ZEICHEN ZU ZEICHEN, NICHT VON KASTEN ZU KASTEN
      //
      // Seit dem 08.08.2026 ist der Bluetooth-Indikator ein KNOPF mit voller
      // Trefferflaeche (66x66) und negativen Raendern; sein Kasten ist also
      // absichtlich groesser als sein Zeichen und ueberlappt die Nachbarn.
      // Kasten zu Kasten gemessen kaemen dort -14 px heraus und das Urteil
      // hiesse „ungleich" — waehrend am Schirm ueberall dieselben 9 px
      // stehen. Der Betreiber hat nach dem Abstand der ZEICHEN gefragt
      // („bitte überprüfe das die icons … den gleichen abstand haben"), und
      // das ist auch die einzige Frage, die man sehen kann.
      const luecken = []
      const bild = (e) => (e.querySelector('svg') || e).getBoundingClientRect()
      for (let i = 1; i < sicht.length; i++) {
        const a = bild(sicht[i-1]), c = bild(sicht[i])
        luecken.push({ zwischen: sicht[i-1].id + ' -> ' + sicht[i].id, px: Math.round((c.left - a.right) * 10) / 10 })
      }
      return JSON.stringify({ kaesten, luecken })
    })()`)
    if (!roh) {
      console.log(`${licht}: keine Leiste gefunden`)
      continue
    }
    const d = JSON.parse(roh)
    console.log(`\n══ ${licht.toUpperCase()} ═══════════════════════════════════════`)
    console.log('  Anzeige      Kasten b×h    SVG b×h   oben   viewBox    gezeichnet (viewBox-Einheiten)')
    for (const k of d.kaesten) {
      const g = k.gezeichnet
      console.log(
        `  ${k.id.padEnd(11)}  ${String(k.kasten.b).padStart(5)}×${String(k.kasten.h).padEnd(5)} ` +
          `${String(k.svg?.b ?? '—').padStart(5)}×${String(k.svg?.h ?? '—').padEnd(5)} ` +
          `${String(k.svg?.oben ?? '—').padStart(5)}  ${(k.viewBox || '—').padEnd(10)} ` +
          (g ? `${g.w.toFixed(1)}×${g.h.toFixed(1)} bei y ${g.y.toFixed(1)}` : '—') +
          (k.zahl ? `   Zahl: ${k.zahl}` : ''),
      )
    }
    console.log('  Lücken:')
    for (const l of d.luecken) console.log(`    ${l.zwischen.padEnd(26)} ${l.px} px`)
    const breiten = d.kaesten.map((k) => k.svg?.b).filter((x) => x != null)
    const hoehen = d.kaesten.map((k) => k.svg?.h).filter((x) => x != null)
    const px = d.luecken.map((l) => l.px)
    const spanne = (a) => (a.length ? Math.max(...a) - Math.min(...a) : 0)
    console.log(
      `  URTEIL: SVG-Breiten ${spanne(breiten) === 0 ? 'GLEICH' : 'ungleich (Spanne ' + spanne(breiten).toFixed(1) + ' px)'}` +
        `, Höhen ${spanne(hoehen) === 0 ? 'GLEICH' : 'ungleich (' + spanne(hoehen).toFixed(1) + ')'}` +
        `, Lücken ${spanne(px) === 0 ? 'GLEICH' : 'ungleich (' + spanne(px).toFixed(1) + ')'}`,
    )

    const kasten = await ev(`(()=>{const l=document.getElementById('kopf-status'); if(!l) return null
      const r=l.getBoundingClientRect(); return JSON.stringify({x:r.left-10,y:r.top-8,w:r.width+20,h:r.height+16})})()`)
    if (kasten) {
      const c = JSON.parse(kasten)
      const bild = (await send(ws, 'Page.captureScreenshot', { format: 'png', clip: { ...c, width: c.w, height: c.h, scale: 4 } })).data
      writeFileSync(`${ORD}/statusleiste-${licht}.png`, Buffer.from(bild, 'base64'))
      console.log(`  Bild: ${ORD}/statusleiste-${licht}.png`)
    }
  }
} finally {
  await brw.schliessen()
}
