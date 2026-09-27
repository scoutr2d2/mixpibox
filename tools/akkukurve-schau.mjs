#!/usr/bin/env node
/**
 * DIE AKKUKURVE — nachgemessen, und zwar an der Frage „luegt sie?".
 *
 * ══ WARUM ES DIESES WERKZEUG GIBT ══════════════════════════════════════════
 *
 * Der Betreiber wollte „ein kleinen battie bereich und mupihat status mit
 * graph wann geladen und wann entladen so wie bei android" (07.08.2026). Eine
 * Kurve ist die Sorte Anzeige, die IMMER richtig AUSSIEHT: Ein Linienzug ueber
 * einer Zeitachse wirkt wie eine Messung, auch wenn er gar keine ist. Vier
 * Arten, wie so ein Bild wertlos oder falsch wird, sind hier je ein Fall:
 *
 *   1. DIE LINIE ZEICHNET UEBER EINE LUECKE HINWEG. Die Box war die Nacht
 *      ueber aus; zwischen 23:10 und 06:50 gibt es keinen einzigen Messwert.
 *      Ein Zug von einem Punkt zum naechsten behauptet dort einen
 *      gleichmaessigen Verlauf, den niemand gemessen hat. DAS IST KEIN
 *      Schoenheitsfehler — es ist eine erfundene Aussage ueber sieben
 *      Stunden. Fall 2 prueft es geometrisch: keine gezeichnete Strecke darf
 *      eine Flaeche „keine Messwerte" ueberspannen.
 *
 *   2. LADEN UND ENTLADEN NUR UEBER FARBE. Auf einem Schirm, den jemand mit
 *      Rot-Gruen-Schwaeche ansieht, waeren das zwei gleiche Baender. Fall 3
 *      prueft, dass die Unterscheidung auch OHNE Farbe traegt — verschiedene
 *      Fuellungen (eine davon ein Muster) und verschiedene Zeichen.
 *
 *   3. KEINE ACHSEN. „so wie bei Android" heisst: man sieht, WANN geladen
 *      wurde. Ohne Zeitbezug ist die Linie Zierrat. Fall 4 zaehlt die Marken
 *      und prueft, dass sie im Bild liegen und nicht uebereinander.
 *
 *   4. ZU WENIG PUNKTE. Steht die Box zwei Tage am Strom, ist die Kurve eine
 *      Gerade — und zwei Messwerte sind ein Strich am rechten Rand, den
 *      jemand fuer einen Defekt haelt. Die Faelle 6 bis 10 gehen die fuenf
 *      duennen Lagen durch: zu wenig, waagerecht, gar nichts, kein MuPiHAT,
 *      alter Server ohne diesen Weg.
 *
 * ══ UND DIE ZAHL, DIE ZWEI HAEUSER TEILEN ══════════════════════════════════
 * `AKKU_RUHE_MA` in NewDesign/app.js ist eine ABSCHRIFT von `RUHE_SCHWELLE`
 * aus src/backend-api/src/akkuverlauf.ts — die Antwort schickt den Wert nicht
 * mit. Laufen die beiden auseinander, nennt das BAND einen Abschnitt „laden",
 * waehrend die KOPFZEILE darueber „ruht" sagt: zwei Aussagen auf einem Schirm,
 * und man sieht ihnen nicht an, welche stimmt. Fall 0 liest beide Quellen und
 * haelt sie gegeneinander — ohne Browser, vor allem anderen.
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * Nichts an einer Datei und NICHTS AN EINER BOX. Es stellt Lagen in der
 * Attrappe und LEGT SIE WIEDER HIN ([[vorschau-wird-geliehen]]).
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/akkukurve-schau.mjs
 *   node tools/akkukurve-schau.mjs --ziel http://127.0.0.1:9701/neu/
 *   node tools/akkukurve-schau.mjs --ziel … --bilder /tmp/akku
 * ENDE 0, wenn jede Aussage haelt.
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { kontrast } from './kontrast.mjs'
import { eigenerBrowser, freierPort, vorschauLeihen } from './leihgabe.mjs'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  if (i < 0) return v
  const w = argv[i + 1]
  return w && !w.startsWith('--') ? w : true
}
const MITGEGEBEN = typeof opt('ziel', null) === 'string' ? opt('ziel') : argv.find((a) => a.startsWith('http')) || null
const BILDER = typeof opt('bilder', null) === 'string' ? opt('bilder') : null

const warte = (ms) => new Promise((r) => setTimeout(r, ms))
let fehler = 0
const ja = (gut, satz, dazu = '') => {
  if (!gut) fehler++
  console.log(`${gut ? 'ok  ' : 'NEIN'}  ${satz}${dazu ? `  — ${dazu}` : ''}`)
}

// ═══════════════════════════════════════════════════════════════════════════
//  0. DIE ABGESCHRIEBENE SCHWELLE — ohne Browser, vor allem anderen
// ═══════════════════════════════════════════════════════════════════════════
const NEU = readFileSync(join(WURZEL, 'NewDesign/app.js'), 'utf8')
const SERVER = readFileSync(join(WURZEL, 'src/backend-api/src/akkuverlauf.ts'), 'utf8')
const zahl = (text, muster, wo) => {
  const m = text.match(muster)
  if (!m) throw new Error(`in ${wo} nicht gefunden: ${muster}`)
  return Number(m[1])
}
const RUHE_NEU = zahl(NEU, /const AKKU_RUHE_MA = (\d+)/, 'NewDesign/app.js')
const RUHE_SERVER = zahl(SERVER, /export const RUHE_SCHWELLE = (\d+)/, 'akkuverlauf.ts')
console.log('══ 0. Die Schwelle „ab wann ist es Laden" ══')
ja(
  RUHE_NEU === RUHE_SERVER,
  'app.js und akkuverlauf.ts sind sich einig',
  `Oberflaeche ${RUHE_NEU} mA · Server ${RUHE_SERVER} mA`,
)

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
  let gestorben = null
  vorschau.on('exit', (c) => {
    gestorben = c
  })
  const bis = Date.now() + 10000
  for (;;) {
    if (gestorben !== null) throw new Error(`tools/neu-vorschau.mjs endete sofort (${gestorben}) — Port ${p} belegt`)
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

// DIE GELIEHENE LAGE WIRD WIEDER HINGELEGT. Dieses Werkzeug stellt fuenf
// verschiedene Akkulagen und die Sperre; ohne das Zurueckgeben stuende die
// Vorschau danach auf „kein MuPiHAT", und das naechste Werkzeug maesse eine
// Kopfzeile ohne Akkuzeichen und meldete einen Fehler, den es nicht gibt.
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
  console.log('  kein Browser gefunden — die Faelle 1..10 uebersprungen')
  await geliehen.zurueckgeben()
  process.exit(fehler === 0 ? 0 : 1)
}

/** Eine Lage in der Attrappe stellen. */
const stellen = async (was) => {
  await fetch(new URL(`/vorschau/${was}`, ZIEL)).catch(() => {})
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
  const bild = async (name) => {
    if (!BILDER) return null
    const s = await send(ws, 'Page.captureScreenshot', { format: 'png' })
    const p = join(BILDER, `${name}.png`)
    await writeFile(p, Buffer.from(s.data, 'base64'))
    console.log(`      Bild: ${p}`)
    return p
  }

  /**
   * DIE SEITE „AKKU" AUFSCHLAGEN.
   *
   * ES GEHT UEBER DIE TASTATUR (`Enter` auf dem Wappen) und nicht ueber die
   * Haltegeste: Was die Geste angeht, misst tools/wappen-halten-probe.mjs;
   * hier soll die SEITE gemessen werden, und ein zweiter Weg dorthin waere
   * eine zweite Fehlerquelle in jedem der zehn Faelle.
   */
  const aufschlagen = async ({ dunkel = false } = {}) => {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(1600)
    await ev(
      `(() => { try { localStorage.clear(); sessionStorage.clear();` +
        ` localStorage.setItem('mupibox_neu_licht_v1', ${dunkel ? "'dunkel'" : "'hell'"}) } catch (_) {} return true })()`,
    )
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(2000)
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
  }

  /**
   * ALLES, WAS DIE SEITE GERADE ZEIGT — in EINEM Griff aus dem Baum geholt.
   *
   * Zehn einzelne `Runtime.evaluate` waeren zehn Augenblicke; die Seite laeuft
   * dazwischen weiter (der Takt holt jede Minute neu). Was hier
   * zurueckkommt, gehoert zu EINEM Bild.
   */
  const lesen = () =>
    ev(`(() => {
      const f = document.getElementById('fach-zeilen')
      const svg = f ? f.querySelector('svg.akku-kurve') : null
      const nimm = (k) => [...(svg ? svg.querySelectorAll(k) : [])]
      const kasten = (r) => ({ x: +r.getAttribute('x'), y: +r.getAttribute('y'),
                               b: +r.getAttribute('width'), h: +r.getAttribute('height') })
      const stil = (k) => {
        const e = svg ? svg.querySelector(k) : null
        if (!e) return null
        const s = getComputedStyle(e)
        return { fill: s.fill, stroke: s.stroke, breite: s.strokeWidth }
      }
      return {
        text: (f ? f.textContent : '').replace(/\\s+/g, ' ').trim(),
        svg: !!svg,
        rollt: f ? [f.scrollHeight, f.clientHeight] : null,
        knoepfe: f ? f.querySelectorAll('button, a, input, select, [tabindex]').length : -1,
        arie: svg ? svg.getAttribute('aria-label') : null,
        zuege: nimm('polyline.akku-linie').map((p) =>
          (p.getAttribute('points') || '').split(' ').filter(Boolean).map((s) => s.split(',').map(Number))),
        punkte: nimm('circle.akku-punkt').length,
        luecken: nimm('rect.akku-luecke').filter((r) => +r.getAttribute('height') > 40).map(kasten),
        laden: nimm('rect.akku-band.laedt').map(kasten),
        entladen: nimm('rect.akku-band.entlaedt').map(kasten),
        zeichen: nimm('text.akku-bandzeichen').map((t) => t.textContent),
        achse: nimm('text.akku-achszahl').map((t) => ({ wort: t.textContent, x: +t.getAttribute('x') })),
        stilLinie: stil('polyline.akku-linie'),
        stilLaden: stil('rect.akku-band.laedt'),
        stilEntladen: stil('rect.akku-band.entlaedt'),
        grund: getComputedStyle(document.querySelector('.eltern-fach') || document.body).backgroundColor,
        kopfknopf: (document.getElementById('fach-tat') || {}).textContent || '',
      }
    })()`)

  /** rgb(a) -> #rrggbb, damit kontrast.mjs damit rechnen kann. */
  const hex = (s) => {
    const m = String(s).match(/(\d+(?:\.\d+)?)/g)
    if (!m || m.length < 3) return null
    return '#' + m.slice(0, 3).map((n) => Math.round(Number(n)).toString(16).padStart(2, '0')).join('')
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  1. DER REGELFALL — sieben Tage mit Laden, Entladen und Naechten
  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n══ 1. Der Regelfall (24 Stunden) ══')
  await stellen('hat-akku')
  await stellen('akkuverlauf-voll')
  await stellen('sperre-aus')
  await aufschlagen()
  let s = await lesen()
  ja(s.svg, 'die Kurve steht da')
  ja(s.zuege.length >= 1, 'sie hat mindestens einen Linienzug', `${s.zuege.length} Zuege, ${s.punkte} Einzelpunkte`)
  ja(s.laden.length >= 1, 'das Band zeigt mindestens einen LADE-Abschnitt', `${s.laden.length}`)
  ja(s.entladen.length >= 1, 'und mindestens einen ENTLADE-Abschnitt', `${s.entladen.length}`)
  ja(s.luecken.length >= 1, 'und es gibt mindestens eine Flaeche „keine Messwerte"', `${s.luecken.length}`)
  ja(
    typeof s.arie === 'string' && /geladen/.test(s.arie),
    'die Sprachausgabe bekommt einen Satz statt eines Bildes',
    String(s.arie),
  )
  await bild('regelfall-hell')

  // ═════════════════════════════════════════════════════════════════════════
  //  2. DIE LINIE LUEGT NICHT — keine Strecke ueberspannt eine Luecke
  // ═════════════════════════════════════════════════════════════════════════
  //
  // DAS IST DIE WICHTIGSTE AUSSAGE DIESER DATEI, und sie wird GEOMETRISCH
  // geprueft und nicht an der Zahl der Zuege: Auch bei drei Zuegen koennte
  // einer davon quer ueber eine Nacht laufen, wenn `akkuStuecke` an der
  // falschen Stelle schneidet. Gesucht wird deshalb nach zwei aufeinander
  // folgenden Punkten EINES Zuges, zwischen denen eine ganze Luecken-Flaeche
  // liegt.
  //
  // 1,5 BILDPUNKTE TOLERANZ an jeder Kante: Der letzte Messpunkt vor einer
  // Luecke liegt genau auf ihrem Anfang, der erste danach genau auf ihrem
  // Ende. Ohne die Toleranz zaehlte jede korrekt gezeichnete Kante als
  // Uebertretung.
  console.log('\n══ 2. Kein Zug zeichnet ueber eine Luecke hinweg ══')
  {
    const sünden = []
    for (const zug of s.zuege) {
      for (let i = 1; i < zug.length; i++) {
        const a = Math.min(zug[i - 1][0], zug[i][0])
        const b = Math.max(zug[i - 1][0], zug[i][0])
        for (const l of s.luecken) {
          if (a <= l.x + 1.5 && b >= l.x + l.b - 1.5) sünden.push(`${a.toFixed(0)}..${b.toFixed(0)} über ${l.x.toFixed(0)}..${(l.x + l.b).toFixed(0)}`)
        }
      }
    }
    ja(sünden.length === 0, 'keine gezeichnete Strecke ueberspannt eine Flaeche ohne Messwerte', sünden.slice(0, 3).join(' · ') || 'sauber')
    // UND DIE GEGENPROBE, ZWEIFACH: Gaebe es gar keine Luecke im Bild, waere
    // die Zeile darueber trivial gruen — und ein EINZIGER Linienzug bei
    // vorhandener Luecke waere der Beweis, dass eben doch darueber gezeichnet
    // wird. Beides zusammen ist die Aussage. (Im 24-Stunden-Bild gibt es
    // genau EINE Nacht, also eine Luecke und zwei Zuege.)
    ja(s.luecken.length >= 1, 'und es gab ueberhaupt eine Luecke zu ueberspannen (sonst misst Fall 2 nichts)', `${s.luecken.length}`)
    ja(
      s.zuege.length >= s.luecken.length + 1,
      'die Linie ist an jeder Luecke wirklich UNTERBROCHEN',
      `${s.zuege.length} Zuege bei ${s.luecken.length} Luecke(n)`,
    )
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  3. LADEN UND ENTLADEN — auch OHNE Farbe zu unterscheiden
  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n══ 3. Laden und Entladen ohne Farbe ══')
  {
    const l = s.stilLaden
    const e = s.stilEntladen
    ja(!!l && !!e, 'beide Bandarten stehen im Bild')
    ja(!!l && /url\(/.test(l.fill), 'das Lade-Band ist ein MUSTER, keine Flaeche', l ? l.fill.slice(0, 40) : '—')
    ja(!!e && !/url\(/.test(e.fill), 'das Entlade-Band ist eine volle Flaeche', e ? e.fill : '—')
    ja(!!l && !!e && l.fill !== e.fill, 'und die beiden Fuellungen sind verschieden')
    // DAS ZWEITE MERKMAL: das Zeichen. Es steht nur in Abschnitten, die breit
    // genug dafuer sind — im 24-Stunden-Bild sind das die langen.
    ja(s.zeichen.includes('+') || s.zeichen.includes('−'), 'die Abschnitte tragen + und −', s.zeichen.join(' ') || '(keine)')
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  4. DIE ACHSEN — ohne sie ist die Linie Zierrat
  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n══ 4. Die Achsen ══')
  {
    const prozent = s.achse.filter((a) => /%|^0$/.test(a.wort))
    const zeit = s.achse.filter((a) => /^\d\d:\d\d$/.test(a.wort))
    ja(prozent.length === 3, 'links stehen drei Prozentmarken (0, 50, 100)', prozent.map((a) => a.wort).join(' '))
    ja(zeit.length >= 3 && zeit.length <= 8, 'unten stehen drei bis acht Zeitmarken', zeit.map((a) => a.wort).join(' '))
    // SIE DUERFEN SICH NICHT BERUEHREN. Eine Achse, deren Beschriftungen
    // uebereinanderliegen, ist schlechter als keine.
    const x = zeit.map((a) => a.x).sort((a, b) => a - b)
    let eng = 0
    for (let i = 1; i < x.length; i++) if (x[i] - x[i - 1] < 34) eng++
    ja(eng === 0, 'und keine zwei Zeitmarken stehen enger als 34 Einheiten', `${eng} zu eng`)
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  5. DIE SEITE FUEGT GENAU EIN BEDIENELEMENT HINZU — und das ist der Kopf
  // ═════════════════════════════════════════════════════════════════════════
  //
  // Eine Zeichnung ist Auskunft. Waere sie antippbar, zaehlte sie in
  // tools/beruehrziele-neu.mjs als Ziel mit — und ein 560x200 grosses Ziel,
  // das nichts tut, ist die Sorte Attrappe, vor der die ganze Datei warnt.
  console.log('\n══ 5. Kein Ziel in der Zeichenflaeche ══')
  ja(s.knoepfe === 0, 'in der Zeilenflaeche steht kein einziges Bedienelement', `${s.knoepfe}`)
  ja(/7 Tage|24 Stunden/.test(s.kopfknopf), 'der Zeitraum haengt am Kopfknopf', `„${s.kopfknopf.trim()}"`)
  ja(s.rollt && s.rollt[0] <= s.rollt[1] + 1, 'und die Karte rollt nicht', s.rollt ? `${s.rollt[0]} in ${s.rollt[1]}` : '—')

  // ═════════════════════════════════════════════════════════════════════════
  //  6. SIEBEN TAGE — derselbe Bau, andere Achse
  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n══ 6. Umschalten auf sieben Tage ══')
  {
    await ev(`(async () => { document.getElementById('fach-tat').click()
      await new Promise((r) => setTimeout(r, 2000)); return true })()`)
    const w = await lesen()
    ja(w.svg, 'die Kurve steht auch dort')
    const tage = w.achse.filter((a) => /^(Mo|Di|Mi|Do|Fr|Sa|So)$/.test(a.wort))
    ja(tage.length >= 4, 'die Zeitachse zaehlt jetzt in WOCHENTAGEN', tage.map((a) => a.wort).join(' '))
    ja(/7 Tage/.test(w.text) || /letzten 7 Tage/.test(w.text), 'und der Fusstext nennt die Spanne')
    ja(w.rollt && w.rollt[0] <= w.rollt[1] + 1, 'und die Karte rollt nicht', w.rollt ? `${w.rollt[0]} in ${w.rollt[1]}` : '—')
    await bild('sieben-tage')
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  7. DIE FARBEN TRAGEN — hell UND dunkel, gerechnet statt begutachtet
  // ═════════════════════════════════════════════════════════════════════════
  //
  // Die Linie ist eine GRAFIK und keine Schrift: die Marke ist 3 : 1
  // (WCAG 2.1, 1.4.11). Gerechnet wird gegen den Grund, auf dem sie wirklich
  // liegt — die Flaeche der Karte, nicht gegen `--bg`.
  console.log('\n══ 7. Die Linie gegen ihren Grund ══')
  for (const [wort, dunkel] of [
    ['hell', false],
    ['dunkel', true],
  ]) {
    await aufschlagen({ dunkel })
    const d = await lesen()
    const vg = hex(d.stilLinie && d.stilLinie.stroke)
    const hg = hex(d.grund)
    const k = vg && hg ? kontrast(vg, hg) : 0
    ja(k >= 3, `${wort}: die Kurve haelt die 3-zu-1-Marke`, `${vg} auf ${hg} = ${k.toFixed(2)} : 1`)
    ja(d.svg && d.zuege.length >= 1, `${wort}: und sie ist wirklich gezeichnet`)
    if (dunkel) await bild('regelfall-dunkel')
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  8..10. DIE FUENF DUENNEN LAGEN — jede mit ihrem eigenen Satz
  // ═════════════════════════════════════════════════════════════════════════
  //
  // SIE SIND DER GRUND, WARUM DIESE SEITE MEHR IST ALS EIN DIAGRAMM. „keine
  // Messwerte", „kein Akku angeschlossen", „kein MuPiHAT eingebaut" und „der
  // Server kennt den Weg noch nicht" sind VIER VERSCHIEDENE Auskuenfte, und
  // eine leere Zeichenflaeche saehe fuer alle vier gleich aus.
  console.log('\n══ 8. Zu wenig, waagerecht, gar nichts ══')
  const lagen = [
    ['akkuverlauf-duenn', 'hat-akku', false, /Zu wenig Messwerte|reicht erst/, 'zwei Punkte: der Satz statt der Kurve'],
    ['akkuverlauf-leer', 'hat-akku', false, /Zu wenig Messwerte|kein einziger Messwert/, 'gar kein Messwert: der Satz'],
    ['akkuverlauf-flach', 'hat-akku', true, /nicht messbar geändert/, 'waagerecht: die Gerade wird benannt'],
    ['akkuverlauf-fehlt', 'hat-akku', false, /kennt den Verlauf noch nicht/, 'alter Server: eigener Satz, kein „Fehler"'],
    ['akkuverlauf-voll', 'hat-weg', false, /Kein MuPiHAT eingebaut/, 'ohne MuPiHAT: kein Akku, keine Kurve'],
  ]
  for (const [verlauf, hat, willSvg, muster, satz] of lagen) {
    await stellen(verlauf)
    await stellen(hat)
    await aufschlagen()
    const d = await lesen()
    ja(muster.test(d.text), satz, d.text.slice(0, 90))
    ja(
      d.svg === willSvg,
      `  und die Zeichenflaeche ist ${willSvg ? 'da' : 'weg'}`,
      d.svg ? 'SVG steht' : 'kein SVG',
    )
    // ══ OHNE KAPAZITAET WIRD KEINE RESTZEIT ERFUNDEN ══════════════════
    // Beide Lagen liefern `kapazitaetMah: null` — die Box hat ihren Pack nie
    // von voll bis leer gesehen und es steht kein Aufdruck in der
    // Konfiguration. Dann darf nirgends „reicht noch etwa …" stehen: eine
    // Zahl, die aus einer unbekannten Kapazitaet gerechnet waere, sieht am
    // Schirm genauso aus wie eine gemessene.
    if (verlauf === 'akkuverlauf-flach' || verlauf === 'akkuverlauf-duenn') {
      ja(!/reicht noch etwa|voll in etwa/.test(d.text), '  und ohne Kapazitaet steht keine erfundene Restzeit da')
    }
    if (verlauf === 'akkuverlauf-duenn') {
      ja(/Kapazität des Packs ist ihr unbekannt/.test(d.text), '  sondern der Satz, warum die Box es nicht sagen kann')
    }
    if (verlauf === 'akkuverlauf-flach') await bild('waagerecht')
    if (hat === 'hat-weg') await bild('ohne-mupihat')
  }

  console.log(`\n${fehler === 0 ? 'ALLES GRUEN' : `${fehler} Aussage(n) halten NICHT`}`)
} finally {
  try {
    ws?.close()
  } catch {
    /* egal */
  }
  await browser.schliessen()
  await geliehen.zurueckgeben()
  vorschau?.kill()
}
process.exit(fehler === 0 ? 0 : 1)
