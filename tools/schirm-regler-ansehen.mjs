#!/usr/bin/env node
/**
 * DEN HELLIGKEITSABSCHNITT DER VERWALTUNG ANSEHEN — als BILD, nicht als DOM.
 *
 * ══ WARUM EIN BILD UND NICHT EIN `textContent` ═════════════════════════════
 *
 * tools/schirm-regler-wahrheit.mjs beweist, dass die ZAHLEN stimmen. Das ist
 * die halbe Frage. Die andere: STEHT DER WARNSATZ AUCH SICHTBAR DA? An diesem
 * Baum ist genau das schon auseinandergegangen — beim Wappenring war die
 * Rechnung richtig und gemalt wurde nichts. Ein `<p class="warnung">` in einer
 * einfarbig dunklen Verwaltung, dessen Klasse im Stilblatt gar nicht
 * vorkommt, sieht aus wie ein weiterer Absatz Kleingedrucktes. Der Satz ist
 * dann da und trotzdem nicht gesehen.
 *
 * Deshalb macht dieses Werkzeug BEIDES und stellt es nebeneinander:
 *
 *   * es misst die FARBE, die der Browser dem Warnsatz wirklich gibt, und
 *     haelt sie gegen die Farbe eines gewoehnlichen Absatzes daneben.
 *     Sind beide gleich, hebt sich nichts ab — das ist der Befund.
 *   * es rechnet den KONTRAST gegen den Hintergrund aus (WCAG), damit „hebt
 *     sich ab" eine Zahl ist und kein Eindruck.
 *   * und es legt ein PNG hin, das man ansieht.
 *
 * ══ WAS ES NICHT ANFASST ═══════════════════════════════════════════════════
 *
 * Keine Box, keinen fremden Browser, keine geliehene Vorschau. Der Browser
 * ist ein eigener (tools/leihgabe.mjs, freier Port, eigenes Profil), und der
 * Server ist der, dessen Adresse man mitgibt.
 *
 * ══ FAHREN ═════════════════════════════════════════════════════════════════
 *
 *   # Buehne und Server kommen aus tools/schirm-regler-wahrheit.mjs --halten
 *   node tools/schirm-regler-ansehen.mjs \
 *     --ziel http://127.0.0.1:9975 \
 *     --panel /tmp/mupi-.../backlight/11-0045 \
 *     --nach /tmp/bilder
 *
 * Rueckgabewert 0 = alle Aussagen stimmen, 1 = mindestens eine nicht.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import WebSocket from 'ws'
import { eigenerBrowser } from './leihgabe.mjs'

const args = process.argv.slice(2)
const wert = (name, vorgabe) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : vorgabe
}
const ZIEL = wert('--ziel', 'http://127.0.0.1:9975')
const PANEL = wert('--panel', '')
const NACH = wert('--nach', '/tmp/mupi-schirmbilder')

let gut = 0
let schlecht = 0
function pruefe(behauptung, bedingung, gesehen) {
  if (bedingung) {
    gut++
    console.log(`  ok    ${behauptung}`)
  } else {
    schlecht++
    console.log(`  FEHLT ${behauptung}${gesehen === undefined ? '' : `  — gesehen: ${JSON.stringify(gesehen)}`}`)
  }
}
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

/** Den Rohwert im nachgestellten Panel setzen — `null` heisst „nicht lesbar". */
function rohSetzen(n) {
  if (!PANEL) throw new Error('ohne --panel laesst sich die Lage nicht stellen')
  if (n === null) rmSync(join(PANEL, 'brightness'), { force: true })
  else writeFileSync(join(PANEL, 'brightness'), `${n}\n`)
}
function blPowerSetzen(n) {
  if (!PANEL) throw new Error('ohne --panel laesst sich die Lage nicht stellen')
  writeFileSync(join(PANEL, 'bl_power'), `${n}\n`)
}

/**
 * WCAG-Kontrast zweier Farben. Pure.
 *
 * Damit „der Satz hebt sich ab" eine Zahl ist. 4,5 ist die Schwelle fuer
 * Fliesstext (AA), 3,0 fuer grosse Schrift.
 */
function kontrast(a, b) {
  const lum = ([r, g, b2]) => {
    const f = (v) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b2)
  }
  const l1 = lum(a)
  const l2 = lum(b)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}
const zuRgb = (s) => (String(s).match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number)

const brw = await eigenerBrowser({ fenster: '1100,1400' })
if (!brw) {
  console.log('Auf diesem Rechner gibt es keinen Chromium — der Bildteil entfaellt.')
  process.exit(0)
}

mkdirSync(NACH, { recursive: true })
const ws = new WebSocket(await brw.seite())
await new Promise((r) => ws.once('open', r))
let nr = 0
const offen = new Map()
ws.on('message', (d) => {
  const m = JSON.parse(String(d))
  if (m.id && offen.has(m.id)) {
    offen.get(m.id)(m)
    offen.delete(m.id)
  }
})
const cdp = (method, params = {}) =>
  new Promise((ok, no) => {
    const id = ++nr
    offen.set(id, (m) => (m.error ? no(new Error(`${method}: ${m.error.message}`)) : ok(m.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
const ev = async (ausdruck) => {
  const r = await cdp('Runtime.evaluate', { expression: ausdruck, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'Fehler in der Seite')
  return r.result.value
}

async function laden() {
  await cdp('Page.navigate', { url: `${ZIEL}/admin/darstellung` })
  // Auf den Abschnitt warten, nicht auf eine Frist raten.
  for (let i = 0; i < 120; i++) {
    const da = await ev(`!!document.getElementById('h-schirm')`).catch(() => false)
    if (da) return true
    await warte(250)
  }
  return false
}

/** Was der Abschnitt SAGT und wie er AUSSIEHT — in einem Zug aus der Seite. */
const ABSCHNITT_JS = `(() => {
  const regler = document.getElementById('h-schirm')
  if (!regler) return null
  const abschnitt = regler.closest('section')
  const stil = (el) => { const c = getComputedStyle(el); return {
    farbe: c.color, hintergrund: c.backgroundColor, gewicht: c.fontWeight,
    groesse: c.fontSize, rand: c.borderLeftWidth + ' ' + c.borderLeftColor } }
  const seitenGrund = getComputedStyle(document.body).backgroundColor
  const warnung = abschnitt.querySelector('.warnung')
  const knopf = [...abschnitt.querySelectorAll('button')].find((b) => /stellen/i.test(b.textContent))
  const hinweise = [...abschnitt.querySelectorAll('.hinweis')]
  const r = abschnitt.getBoundingClientRect()
  return {
    text: abschnitt.innerText,
    kasten: { x: r.x, y: r.y + window.scrollY, w: r.width, h: r.height },
    reglerWert: regler.value, reglerMin: regler.min, reglerMax: regler.max, reglerSchritt: regler.step,
    ausgabe: abschnitt.querySelector('output')?.textContent?.trim() ?? null,
    seitenGrund,
    warnung: warnung ? { text: warnung.innerText, ...stil(warnung) } : null,
    knopf: knopf ? { text: knopf.innerText, ...stil(knopf) } : null,
    hinweisTexte: hinweise.map((h) => h.innerText),
    hinweisStil: hinweise[0] ? stil(hinweise[0]) : null,
  }
})()`

async function schuss(name, kasten) {
  const p = { format: 'png' }
  if (kasten) {
    p.clip = {
      x: Math.max(0, kasten.x - 10),
      y: Math.max(0, kasten.y - 10),
      width: Math.min(1100, kasten.w + 20),
      height: kasten.h + 20,
      scale: 2,
    }
    p.captureBeyondViewport = true
  }
  const { data } = await cdp('Page.captureScreenshot', p)
  const pfad = join(NACH, `${name}.png`)
  writeFileSync(pfad, Buffer.from(data, 'base64'))
  return pfad
}

const lagen = [
  { name: 'a-normal', roh: 255, bl: 0, was: 'ganz hell, alles in Ordnung' },
  { name: 'b-schwarz', roh: 0, bl: 0, was: 'Rohwert 0 — der Schirm der Box ist SCHWARZ' },
  { name: 'c-dunkler', roh: 25, bl: 0, was: 'Rohwert 25 — dunkler als der Regler kann' },
  { name: 'd-schirm-aus', roh: 255, bl: 4, was: 'bl_power 4 — Schirm abgeschaltet, Regler auf 100 %' },
  { name: 'e-beides', roh: 0, bl: 4, was: 'Schirm abgeschaltet UND Rohwert 0' },
  // Der Rohwert ist NICHT LESBAR (sysfs antwortet bei einem abgemeldeten
  // Treiber mit EIO/ENODEV). Der Server sagt dann ehrlich `prozent: null` —
  // die Frage ist, was die Seite daraus macht.
  { name: 'f-unlesbar', roh: null, bl: 0, was: 'Geraet da, Rohwert nicht lesbar (prozent: null)' },
]

try {
  const gesehen = []
  for (const l of lagen) {
    rohSetzen(l.roh)
    blPowerSetzen(l.bl)
    if (!(await laden())) throw new Error(`Der Abschnitt kam bei „${l.was}" nicht`)
    const a = await ev(ABSCHNITT_JS)
    const bild = await schuss(l.name, a.kasten)
    gesehen.push({ ...l, ...a, bild })
    console.log(`\n── ${l.name}: ${l.was}`)
    console.log(`   Regler: value=${a.reglerWert} min=${a.reglerMin} max=${a.reglerMax} step=${a.reglerSchritt}`)
    console.log(`   Ausgabe daneben: ${a.ausgabe}`)
    console.log(`   Warnsatz: ${a.warnung ? JSON.stringify(a.warnung.text) : '— keiner —'}`)
    if (a.warnung) console.log(`   Warnsatz-Stil: ${JSON.stringify({ farbe: a.warnung.farbe, gewicht: a.warnung.gewicht, groesse: a.warnung.groesse })}`)
    if (a.hinweisStil) console.log(`   Stil eines gewoehnlichen Hinweises: ${JSON.stringify({ farbe: a.hinweisStil.farbe, gewicht: a.hinweisStil.gewicht, groesse: a.hinweisStil.groesse })}`)
    console.log(`   Knopf: ${a.knopf ? JSON.stringify(a.knopf.text) : '— keiner —'}`)
    console.log(`   Bild: ${bild}`)
  }

  console.log('\n── DIE AUSSAGEN ──')
  const normal = gesehen.find((g) => g.name === 'a-normal')
  const schwarz = gesehen.find((g) => g.name === 'b-schwarz')
  const dunkler = gesehen.find((g) => g.name === 'c-dunkler')
  const aus = gesehen.find((g) => g.name === 'd-schirm-aus')
  const beides = gesehen.find((g) => g.name === 'e-beides')

  pruefe('bei ganz hell steht KEIN Warnsatz da', normal.warnung === null, normal.warnung?.text)
  pruefe('bei ganz hell zeigt der Regler 100 %', normal.ausgabe === '100 %', normal.ausgabe)
  pruefe('bei Rohwert 0 steht ein Warnsatz da', !!schwarz.warnung, schwarz.text)
  pruefe('… und er sagt das Wort SCHWARZ', /SCHWARZ/.test(schwarz.warnung?.text || ''), schwarz.warnung?.text)
  pruefe('… und daneben steht ein Knopf', !!schwarz.knopf, schwarz.knopf)
  pruefe('bei Rohwert 25 nennt der Satz den echten Wert (10 %)', /10 %/.test(dunkler.warnung?.text || ''), dunkler.warnung?.text)
  pruefe('bei abgeschaltetem Schirm steht der Satz „ganz abgeschaltet"', /abgeschaltet/.test(aus.text), aus.text)
  pruefe('… und KEIN Klemm-Warnsatz, denn der Regler stimmt ja', aus.warnung === null, aus.warnung?.text)
  pruefe('bei beidem zugleich stehen BEIDE Saetze da', !!beides.warnung && /abgeschaltet/.test(beides.text), beides.text)

  // ══ ZWEI LAGEN, EIN AUSSEHEN ══════════════════════════════════════════════
  //
  // Der Satz „der Schirm ist ganz abgeschaltet" ist eine AUSSAGE UEBER DIE
  // LAGE DER BOX. Der Satz „Gilt sofort und bleibt erhalten" darueber ist
  // Beschreibung, die immer dasteht. Tragen beide dieselbe Klasse, sieht das
  // Dringende aus wie das Immergleiche — und der Regler daneben steht auf
  // 100 %, waehrend vor dem Kind ein schwarzes Rechteck steht.
  const abgeschaltetIstEigen = !!aus.hinweisTexte && aus.hinweisTexte.length > 1
  pruefe(
    'der Satz zum abgeschalteten Schirm sieht ANDERS aus als die immergleiche Beschreibung darueber',
    // Beide sind `.hinweis`. Wenn das so ist, teilen sie jeden Stil — dann ist
    // diese Aussage falsch, und genau das ist der Befund.
    !(abgeschaltetIstEigen && /abgeschaltet/.test(aus.hinweisTexte[1] || '')),
    { hinweisTexte: aus.hinweisTexte, stil: aus.hinweisStil },
  )

  // ══ DAS GERAET SCHWEIGT ═══════════════════════════════════════════════════
  const unlesbar = gesehen.find((g) => g.name === 'f-unlesbar')
  console.log(`\n   Rohwert nicht lesbar -> der Regler zeigt: ${unlesbar.ausgabe}`)
  pruefe(
    'wenn der Rohwert nicht lesbar ist, zeigt die Seite KEINE erfundene Prozentzahl',
    unlesbar.ausgabe === null || /\?|unbekannt|nicht lesbar/i.test(unlesbar.text),
    { ausgabe: unlesbar.ausgabe, text: unlesbar.text },
  )

  // ══ DIE FRAGE, DIE NUR DAS BILD BEANTWORTET ═══════════════════════════════
  if (schwarz.warnung && schwarz.hinweisStil) {
    const w = zuRgb(schwarz.warnung.farbe)
    const h = zuRgb(schwarz.hinweisStil.farbe)
    const grund = zuRgb(schwarz.warnung.hintergrund === 'rgba(0, 0, 0, 0)' ? schwarz.seitenGrund : schwarz.warnung.hintergrund)
    const gleich = w.join() === h.join() && schwarz.warnung.gewicht === schwarz.hinweisStil.gewicht
    console.log(`\n   Warnsatz  Farbe ${schwarz.warnung.farbe}, Gewicht ${schwarz.warnung.gewicht}`)
    console.log(`   Hinweis   Farbe ${schwarz.hinweisStil.farbe}, Gewicht ${schwarz.hinweisStil.gewicht}`)
    console.log(`   Grund     ${schwarz.warnung.hintergrund} / Seite ${schwarz.seitenGrund}`)
    console.log(`   Kontrast des Warnsatzes gegen den Grund: ${kontrast(w, grund).toFixed(2)}:1`)
    pruefe(
      'der Warnsatz sieht ANDERS aus als das gewoehnliche Kleingedruckte daneben (Farbe oder Gewicht)',
      !gleich,
      { warnung: schwarz.warnung.farbe + ' / ' + schwarz.warnung.gewicht, hinweis: schwarz.hinweisStil.farbe + ' / ' + schwarz.hinweisStil.gewicht },
    )
    pruefe(
      `der Warnsatz ist lesbar (WCAG AA fuer Fliesstext: 4,5:1) — gemessen ${kontrast(w, grund).toFixed(2)}:1`,
      kontrast(w, grund) >= 4.5,
      kontrast(w, grund).toFixed(2),
    )
  }

  console.log(`\n${gut} richtig, ${schlecht} falsch.`)
  console.log(`Bilder liegen in ${NACH}`)
  await brw.schliessen()
  process.exit(schlecht === 0 ? 0 : 1)
} catch (e) {
  console.log(`Abbruch: ${e?.stack || e}`)
  await brw.schliessen()
  process.exit(1)
}
