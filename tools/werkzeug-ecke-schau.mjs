#!/usr/bin/env node
/**
 * DAS MIXPI MIT DEM SCHRAUBENSCHLUESSEL — steht es in der richtigen Ecke, im
 * richtigen Modus, und ist es KEIN Knopf?
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 * Der Betreiber (06.08.2026, woertlich): „ich habe ein neues mixpi mit einem
 * schraubenschluessel reinkopiert das koennen wir ... ins eck vom admin
 * bereich machen da ist noch so ein loch" — auf Nachfrage: „oben links".
 *
 * Daran haengen VIER Aussagen, und jede einzelne sieht am Bildschirm genauso
 * aus wie ihr Gegenteil:
 *
 *   1. ES STEHT AUF DEM PLATZ VON „WER HOERT" (`#ich`, x 8..74 / y 0..66).
 *      Das ist der ganze Sinn der Sache: DIESELBE ECKE SAGT, IN WELCHEM MODUS
 *      MAN IST. Draussen steht dort, wer gerade hoert, drinnen das MixPi mit
 *      dem Schluessel. Verrutscht es um 6 px, springt beim Auf- und Zugehen
 *      das Bild — auf einem Standbild faellt das keinem auf, im Betrieb
 *      sofort. Gemessen wird deshalb DECKUNGSGLEICH mit `#ich`, nicht gegen
 *      eine Zahl in dieser Datei ([[drei-orte-eine-anzeige]]).
 *
 *   2. ES IST KEIN BEDIENELEMENT. Kein `button`, kein `aria-label`, kein
 *      `tabindex`, `pointer-events: none`. Am 06.08.2026 ist genau dieser
 *      Fehler schon einmal passiert und einen halben Tag unbemerkt geblieben:
 *      das Wappen wurde ein Knopf und behielt die Hoehe des Textes (54 px =
 *      7,56 mm). Ein Bild, das versehentlich ein Ziel wird, muesste ab dann
 *      9 mm halten und 2 mm Abstand zum Rueckweg mitbringen — und die
 *      Gesamtzahl der zu engen Ziele stiege, ohne dass irgendwo etwas rot
 *      wird. `tools/beruehrziele-neu.mjs` zaehlt es dann einfach mit.
 *
 *   3. ES STEHT NUR IM ADMIN-BEREICH UND ERST HINTER DEM TOR. In der
 *      Kinderoberflaeche hat es nichts verloren, und am STEHENDEN Tor auch
 *      nicht: Hinter dem Tor liegt an einem Bild nichts Geheimes, aber ein
 *      Kind, das die Rechenaufgabe nicht loest, saehe sonst ein
 *      Werkzeug-MixPi, das es nicht erreichen kann — und lernte, dass Tippen
 *      dort nichts tut. Gemessen bei allen DREI Torsorten (Rechenaufgabe,
 *      PIN, Geste), weil sie im Baum verschiedene Wege nehmen.
 *
 *   4. DAS BILD LAEDT WIRKLICH. `naturalWidth > 0`. Ein `src`, der ins Leere
 *      zeigt, ergibt bei `alt=""` ein leeres Feld — und das ist von „hier
 *      steht absichtlich nichts" nicht zu unterscheiden. Genau dieses Loch
 *      sollte das Bild ja zumachen.
 *
 * ══ WARUM GETASTET UND NICHT GERECHNET ═════════════════════════════════════
 * Fuer die LAGE reicht `getBoundingClientRect` — das Bild ist absichtlich
 * nicht antastbar, `elementFromPoint` liefert dort also NIE dieses Element.
 * Genau das wird zur Aussage gemacht: an seiner Mitte muss etwas ANDERES
 * antworten (der Grund des Bereichs), und in der Kinderoberflaeche muss dort
 * `#ich` antworten. „Nicht getroffen" ist hier der Befund, nicht der
 * Messfehler — die umgekehrte Richtung als sonst in dieser Werkzeugkiste.
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * Nichts an der Quelle und nichts an der Box. Eigener headless-Browser gegen
 * eine `tools/neu-vorschau.mjs`; laeuft auf dem Zielport schon eine, wird sie
 * BENUTZT und ihre Lage hinterher wieder hingelegt ([[vorschau-wird-geliehen]]).
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *     node tools/werkzeug-ecke-schau.mjs
 *     node tools/werkzeug-ecke-schau.mjs --ziel http://127.0.0.1:9401/neu/
 *     node tools/werkzeug-ecke-schau.mjs --bild /tmp/werkzeug-ecke
 *
 * ENDE 0, wenn jede Aussage haelt.
 */
import { writeFile } from 'node:fs/promises'
import WebSocket from 'ws'
import { eigenerBrowser, vorschauLeihen } from './leihgabe.mjs'
import { adminAuf } from './admin-weg.mjs'

const argv = process.argv.slice(2)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  if (i < 0) return v
  const w = argv[i + 1]
  return w && !w.startsWith('--') ? w : true
}
const ZIEL = argv.find((a) => a.startsWith('http')) || opt('ziel', null) || 'http://127.0.0.1:8299/neu/'
const BILD = typeof opt('bild', null) === 'string' ? opt('bild', null) : null

/** Die Auswahl des Bildes. Steht EINMAL hier und einmal in index.html. */
const WERKZEUG = '.eltern-werkzeug'
/** Sein Nachbar in der Kinderoberflaeche — der Massstab fuer Aussage 1. */
const ICH = '#ich'

const warte = (ms) => new Promise((r) => setTimeout(r, ms))
const befunde = []
const ja = (gut, wort, dazu = '') => {
  befunde.push({ gut, wort })
  console.log(`  ${gut ? 'ok  ' : 'NEIN'}  ${wort}${dazu ? `  — ${dazu}` : ''}`)
}

/**
 * Alles, was ueber die Ecke zu sagen ist, in EINEM Griff in die Seite.
 *
 * `rect` fuer die Lage, `elementFromPoint` fuer die Antastbarkeit, und die
 * Merkmale, an denen ein Bedienelement zu erkennen ist — Marke, `tabindex`,
 * `role`, `aria-label`, `onclick`. Wer nur auf `<button>` prueft, uebersieht
 * das `div` mit `role="button"`, und genau die Sorte Attrappe hat dieses Haus
 * schon gebaut.
 */
const SCHAU_JS = String.raw`
JSON.stringify((() => {
  const nimm = (sel) => {
    const e = document.querySelector(sel)
    if (!e) return { da: false }
    const r = e.getBoundingClientRect()
    const sicht = r.width >= 1 && r.height >= 1 && getComputedStyle(e).visibility !== 'hidden'
    const mx = Math.round(r.left + r.width / 2)
    const my = Math.round(r.top + r.height / 2)
    const t = sicht ? document.elementFromPoint(mx, my) : null
    const marke = (x) => {
      const teile = [x.tagName.toLowerCase()]
      if (x.id) teile.push('#' + x.id)
      const kl = (x.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
      if (kl.length) teile.push('.' + kl.join('.'))
      return teile.join('')
    }
    return {
      da: true,
      sichtbar: sicht,
      x: Math.round(r.left), y: Math.round(r.top),
      b: Math.round(r.width), h: Math.round(r.height),
      zeiger: getComputedStyle(e).pointerEvents,
      // WAS AN IHM NACH BEDIENELEMENT AUSSIEHT — alles, was ein Werkzeug oder
      // eine Sprachausgabe als Ziel lesen wuerde.
      knopfhaft: [
        ['button','a','input','select','textarea'].includes(e.tagName.toLowerCase()) ? 'Marke ' + e.tagName.toLowerCase() : '',
        e.hasAttribute('tabindex') && e.getAttribute('tabindex') !== '-1' ? 'tabindex' : '',
        e.getAttribute('role') ? 'role=' + e.getAttribute('role') : '',
        e.getAttribute('aria-label') ? 'aria-label' : '',
        e.hasAttribute('onclick') ? 'onclick' : '',
        e.closest('button, a[href], [role="button"]') ? 'liegt IN einem Ziel' : '',
      ].filter(Boolean),
      versteckt: e.getAttribute('aria-hidden') === 'true',
      mitte: t ? marke(t) : null,
      // DAS BILD DARIN: geladen oder nicht. naturalWidth ist die einzige
      // Auskunft, die ein leeres Feld von einem gefuellten unterscheidet.
      // (Keine Gegenhaken in diesem Block — er ist ein Template-String.)
      bild: (() => {
        const i = e.tagName.toLowerCase() === 'img' ? e : e.querySelector('img')
        if (!i) return null
        return { quelle: (i.getAttribute('src') || ''), breit: i.naturalWidth, hoch: i.naturalHeight }
      })(),
    }
  }
  return {
    werkzeug: nimm(${JSON.stringify(WERKZEUG)}),
    ich: nimm(${JSON.stringify(ICH)}),
    // Wieviele Kopien im Baum stehen. ZWEI waeren ein halb fertiger Umbau,
    // und die zweite laege irgendwo, wo sie niemand sucht.
    anzahl: document.querySelectorAll(${JSON.stringify(WERKZEUG)}).length,
    torOffen: (() => { const t = document.getElementById('eltern-tor'); return !!t && !t.hidden })(),
    bereichOffen: (() => { const e = document.getElementById('eltern'); return !!e && !e.hidden })(),
  }
})())
`

const geliehen = await vorschauLeihen(ZIEL)
const browser = await eigenerBrowser({ fenster: '800,480' })
if (!browser) {
  console.log('  kein Browser gefunden — uebersprungen')
  await geliehen.zurueckgeben()
  process.exit(0)
}

let ws = null
try {
  ws = new WebSocket(await browser.seite())
  await new Promise((r) => ws.on('open', r))
  let lfd = 0
  const send = (m, p = {}) =>
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
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })

  const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value
  const stand = async (w) => {
    await fetch(new URL(`/vorschau/${w}`, ZIEL)).catch(() => null)
    await warte(120)
  }
  const laden = async () => {
    await send('Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(2200)
  }
  const schau = async () => JSON.parse(await ev(SCHAU_JS))
  const bild = async (name) => {
    if (!BILD) return
    const s = await send('Page.captureScreenshot', { format: 'png' })
    await writeFile(`${BILD}-${name}.png`, Buffer.from(s.data, 'base64'))
  }
  /** Der TASTATURWEG hinein — er prueft das Halten nicht, siehe admin-weg.mjs. */
  const hinein = async () => {
    await adminAuf(ev, { warteMs: 900 })
  }

  // ══ 1. DIE KINDEROBERFLAECHE — hier hat es nichts verloren ════════════════
  console.log('\n── DIE KINDEROBERFLAECHE ───────────────────────────────────')
  for (const s of ['voll', 'spielt', 'name-mitbox', 'sperre-aus']) await stand(s)
  await laden()
  let d = await schau()
  await bild('kind')
  ja(d.anzahl === 1, 'ES GIBT GENAU EIN WERKZEUG-MIXPI IM BAUM', `${d.anzahl} Stueck`)
  ja(!d.werkzeug.sichtbar, 'ES IST DRAUSSEN NICHT ZU SEHEN', d.werkzeug.sichtbar ? `steht bei ${d.werkzeug.x},${d.werkzeug.y}` : 'kein Rechteck')
  ja(d.ich.sichtbar, 'STATT DESSEN STEHT DORT „WER HOERT"', `${d.ich.x},${d.ich.y} ${d.ich.b}x${d.ich.h}`)
  ja(d.ich.mitte !== null, 'UND ER IST DORT ANTASTBAR — die Ecke gehoert ihm', String(d.ich.mitte))

  // Die Ecke von „wer hoert" ist der Massstab fuer alles Weitere.
  const eckeSoll = { x: d.ich.x, y: d.ich.y, b: d.ich.b, h: d.ich.h }

  // ══ 2. DIE DREI STEHENDEN TORE — auch hier nicht ══════════════════════════
  for (const [art, wort] of [
    ['rechnen', 'Rechenaufgabe'],
    ['pin', 'PIN'],
    ['geste', 'Geste'],
  ]) {
    console.log(`\n── DAS STEHENDE TOR: ${wort} ────────────────────────────`)
    for (const s of ['voll', 'spielt', 'name-mitbox', `sperre-${art}`]) await stand(s)
    await laden()
    await hinein()
    d = await schau()
    await bild(`tor-${art}`)
    ja(d.bereichOffen && d.torOffen, `${wort}: das Tor steht wirklich (sonst prueft die Zeile darunter nichts)`)
    ja(
      !d.werkzeug.sichtbar,
      `${wort}: KEIN WERKZEUG-MIXPI AM STEHENDEN TOR — kein Bild, das ein Kind nicht erreichen kann`,
      d.werkzeug.sichtbar ? `steht bei ${d.werkzeug.x},${d.werkzeug.y}` : 'nicht im Bild',
    )
  }

  // ══ 3. DER OFFENE BEREICH — hier gehoert es hin ═══════════════════════════
  console.log('\n── DER OFFENE ADMIN-BEREICH ────────────────────────────────')
  for (const s of ['voll', 'spielt', 'name-mitbox', 'sperre-aus']) await stand(s)
  await laden()
  await hinein()
  d = await schau()
  await bild('offen')
  ja(d.bereichOffen && !d.torOffen, 'der Bereich steht wirklich offen (sonst prueft nichts darunter)')
  ja(d.werkzeug.sichtbar, 'DAS WERKZEUG-MIXPI STEHT DA', `${d.werkzeug.x},${d.werkzeug.y} ${d.werkzeug.b}x${d.werkzeug.h}`)
  ja(
    d.werkzeug.x === eckeSoll.x && d.werkzeug.y === eckeSoll.y &&
      d.werkzeug.b === eckeSoll.b && d.werkzeug.h === eckeSoll.h,
    'ES IST DECKUNGSGLEICH MIT „WER HOERT" — beim Auf- und Zugehen springt nichts',
    `Werkzeug ${d.werkzeug.x},${d.werkzeug.y} ${d.werkzeug.b}x${d.werkzeug.h} gegen ` +
      `„wer hoert" ${eckeSoll.x},${eckeSoll.y} ${eckeSoll.b}x${eckeSoll.h}`,
  )
  ja(
    d.werkzeug.x >= 0 && d.werkzeug.y >= 0 &&
      d.werkzeug.x + d.werkzeug.b <= 800 && d.werkzeug.y + d.werkzeug.h <= 480,
    'ES RAGT NICHT UEBER DEN 800x480-SCHIRM',
    `rechts ${d.werkzeug.x + d.werkzeug.b}, unten ${d.werkzeug.y + d.werkzeug.h}`,
  )
  ja(
    !!d.werkzeug.bild && d.werkzeug.bild.breit > 0,
    'DAS BILD IST WIRKLICH GELADEN — ein leeres Feld waere dasselbe Loch wie vorher',
    d.werkzeug.bild ? `${d.werkzeug.bild.quelle} ${d.werkzeug.bild.breit}x${d.werkzeug.bild.hoch}` : 'kein img',
  )

  // ── ES IST KEIN BEDIENELEMENT ────────────────────────────────────────────
  ja(
    d.werkzeug.knopfhaft.length === 0,
    'ES IST KEIN BEDIENELEMENT — kein Knopf, keine Rolle, keine Beschriftung, kein tabindex',
    d.werkzeug.knopfhaft.length ? d.werkzeug.knopfhaft.join(', ') : 'nichts davon',
  )
  ja(d.werkzeug.zeiger === 'none', 'DER FINGER GEHT HINDURCH (pointer-events: none)', d.werkzeug.zeiger)
  ja(
    d.werkzeug.mitte !== null && !String(d.werkzeug.mitte).includes('eltern-werkzeug'),
    'EIN FINGER AUF SEINER MITTE TRIFFT ES NICHT — es verdeckt auch kein fremdes Ziel',
    String(d.werkzeug.mitte),
  )
  ja(d.werkzeug.versteckt, 'EINE SPRACHAUSGABE UEBERGEHT ES (aria-hidden) — ein Bild ohne Wirkung hat nichts zu melden')

  // ── UND DER RUECKWEG DANEBEN BLEIBT FREI ─────────────────────────────────
  const rueck = JSON.parse(
    await ev(String.raw`JSON.stringify((() => {
      const z = document.getElementById('zurueck'); if (!z) return { da: false }
      const r = z.getBoundingClientRect()
      const t = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))
      return { da: true, x: Math.round(r.left), b: Math.round(r.width),
               frei: !!t && (t === z || z.contains(t)) }
    })())`),
  )
  ja(rueck.da && rueck.frei, 'DER RUECKWEG DANEBEN IST FREI — nichts liegt auf ihm', `x ${rueck.x}..${rueck.x + rueck.b}`)
  ja(
    d.werkzeug.x + d.werkzeug.b <= rueck.x,
    'UND DAS BILD REICHT NICHT IN IHN HINEIN',
    `Bild endet bei ${d.werkzeug.x + d.werkzeug.b}, Rueckweg beginnt bei ${rueck.x}`,
  )

  // ══ 4. WIEDER DRAUSSEN — die Ecke gehoert wieder „wer hoert" ══════════════
  console.log('\n── NACH DEM VERLASSEN ──────────────────────────────────────')
  await ev(`(() => { const z = document.getElementById('zurueck'); if (z) z.click(); return true })()`)
  await warte(500)
  d = await schau()
  await bild('zurueck')
  ja(!d.bereichOffen, 'der Bereich ist zu')
  ja(!d.werkzeug.sichtbar, 'DAS WERKZEUG-MIXPI IST MIT IHM VERSCHWUNDEN')
  ja(d.ich.sichtbar && d.ich.mitte !== null, 'UND „WER HOERT" HAT DIE ECKE ZURUECK', String(d.ich.mitte))
} finally {
  if (ws) ws.close()
  await browser.schliessen()
  await geliehen.zurueckgeben()
}

const schlecht = befunde.filter((b) => !b.gut)
console.log(`\n${befunde.length - schlecht.length} von ${befunde.length} Aussagen halten.`)
if (schlecht.length) {
  console.log('NICHT gehalten:')
  for (const b of schlecht) console.log('  ' + b.wort)
}
process.exit(schlecht.length ? 1 : 0)
