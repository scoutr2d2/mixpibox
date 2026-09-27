#!/usr/bin/env node
/**
 * DAS TOR BEI OFFENER LEISTE — was kann ein Kind, waehrend die Sperre steht?
 *
 * ══ WOZU, UND WIESO NICHT eltern-tor-schau.mjs ODER kind-am-tor.mjs ════════
 * Beide messen das Tor, wie es HEUTE steht: `#eltern` ist ein DECKEL
 * (position fixed, inset 0, z-index 8). Alles ausser dem einen Rueckweg
 * (z-index 9) liegt darunter und ist nicht zu treffen — die Frage „was kann
 * ein Kind sonst noch?" hat heute die Antwort „nichts", und deshalb stellt
 * sie keines der beiden Werkzeuge.
 *
 * Der Betreiber hat am 06.08.2026 entschieden: „ich finde den entwurf gut wo
 * nicht alles zu gedeckt ist". Damit wird `#eltern` zu einer SEITE in der
 * Inhaltsspalte, und die 88-px-Leiste bleibt stehen — auch WAEHREND DAS TOR
 * STEHT. Genau diese Lage misst diese Datei, und zwar in beiden Formen:
 *   B  `.eltern{left:88px}`               Leiste bleibt, Kissen bleibt zu
 *   C  `.eltern{left:88px;bottom:84px}`   Leiste UND Kissen bleiben
 * Dazu die heutige Lage als Grundlinie und ein VORSCHLAG zum Stilllegen.
 *
 * ══ WAS GEMESSEN WIRD ══════════════════════════════════════════════════════
 *   1. ERREICHBAR — welche Bedienelemente ausserhalb von `#eltern` sind bei
 *      stehendem Tor wirklich zu treffen (`document.elementFromPoint`, nicht
 *      „steht im Baum"), in jeder der drei Sperrarten.
 *   2. WIRKUNG — jedes davon wird ANGETIPPT und die Folge abgelesen: steht
 *      das Tor danach noch? hat sich die Adresse geaendert? was schliesst der
 *      Rueckweg jetzt?
 *   3. DIE BREMSE — sie ueberlebt `eltern.zu()` (das ist gebaut und geprueft).
 *      Hier wird die andere Frage gestellt: ueberlebt sie das, was die
 *      erreichbaren Knoepfe ausloesen? Der Profilwechsel endet in
 *      `window.location.reload()` (app.js, `werWaehlen`) — und ein Neuladen
 *      ist etwas anderes als ein Zumachen.
 *   4. STILLLEGEN — ein Vorschlag wird als Probe-Regel eingesetzt und
 *      nachgemessen: wie viele Ziele fallen weg, bleibt der Rueckweg heil,
 *      schrumpft etwas unter 9 mm, faellt ein Paar unter 2 mm.
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * Nichts an einer Datei des Baums. An der Box wird nicht gemessen. Die
 * Formen B, C und der Stilllege-Vorschlag stehen als `<style>` im Browser,
 * nicht in app.css — dieselbe Technik wie `--probe` in
 * tools/beruehrziele-neu.mjs.
 *
 * ══ VORSCHAU UND BROWSER ═══════════════════════════════════════════════════
 * Ohne Adresse startet dieses Werkzeug seine EIGENE Vorschau (Vorgabe 8703)
 * und beendet sie am Ende — eine geliehene Vorschau bedient den Arbeitsbaum
 * dessen, der sie gestartet hat ([[vorschau-wird-geliehen]]).
 *
 * EINEN `--debug-port` GIBT ES HIER NICHT, obwohl der Auftrag eine Zahl nannte
 * (9703). Der Browser kommt aus `eigenerBrowser()` und bekommt seinen Port vom
 * Betriebssystem. Eine Zahl, die man von Hand waehlen kann, ist eine Zahl, die
 * man doppelt waehlen kann — in der Nacht zum 06.08.2026 hat genau das ein
 * FREMDES Browserfenster ferngesteuert und dessen Lage als Messung gemeldet.
 * Eine zugeteilte Zahl schuetzt davor nicht, sie verschiebt nur, wer der
 * naechste ist.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *     node tools/tor-bei-offener-leiste.mjs
 *     node tools/tor-bei-offener-leiste.mjs --port 8703
 *     node tools/tor-bei-offener-leiste.mjs http://127.0.0.1:8299/neu/
 *
 * ENDE 0, wenn jede Aussage haelt. Die Aussagen stehen unten in `ja(...)`.
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { browserSuchen, eigenerBrowser } from './leihgabe.mjs'
import { adminAuf } from './admin-weg.mjs'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  if (i < 0) return v
  const w = argv[i + 1]
  return w && !w.startsWith('--') ? w : true
}
const MITGEGEBEN = argv.find((a) => a.startsWith('http')) || null
const PORT = Number(opt('port', 8703))

const MM_JE_PIXEL = 0.14
const MARKE_MM = 9
const PAAR_MM = 2
const mmS = (px) => (px * MM_JE_PIXEL).toFixed(2)
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

const befunde = []
const ja = (gut, wort, dazu = '') => {
  befunde.push({ gut, wort, dazu })
  console.log(`${gut ? 'ok  ' : 'NEIN'}  ${wort}${dazu ? `  — ${dazu}` : ''}`)
}
const zeile = (s = '') => console.log(s)

// ── DIE DREI FORMEN UND DER VORSCHLAG ──────────────────────────────────────
/*
 * `left: 88px` allein genuegt fuer B: `.eltern` ist `inset: 0`, und `left`
 * ueberschreibt die linke Kante. Fuer C kommt `bottom: 84px` dazu — 84 px ist
 * die Hoehe des Mini-Player-Kissens samt seines Abstands, gemessen von
 * tools/eltern-masse-messen.mjs (Flaeche faellt von 386 auf 302 px).
 */
const FORMEN = {
  heute: '',
  B: '.eltern{left:88px}',
  C: '.eltern{left:88px;bottom:84px}',
  /*
   * ── D, DIE FORM DES ENTWURFS, UND WARUM SIE EIGENS GEMESSEN WIRD ─────────
   *
   * B und C ruecken nur die Kanten. `#eltern` bleibt darin, was es heute ist:
   * ein DECKEL bei z-index 8. Der Entwurf (NewDesign/MixPiBox-standalone.html)
   * macht etwas anderes — dort ist `isAdmin` eine SEITE in der Inhaltsspalte,
   * und die drei echten Ueberlagerungen (sheetOpen 6, expanded 8, showUsers 9)
   * liegen DARUEBER. Wer C baut und die z-index 8 stehen laesst, hat die Masse
   * des Entwurfs und die Schichtung von heute.
   *
   * DAS IST KEIN SCHOENHEITSFEHLER, und deshalb ist D eine eigene Zeile:
   * `.ich-fenster` liegt ebenfalls bei z-index 8 und steht im Baum FRUEHER als
   * `.eltern` — bei Gleichstand malt der spaetere oben, also heute `.eltern`.
   * Faellt `.eltern` unter die 8, kehrt sich das um, und die Auswahl „wer
   * hoert" liegt UEBER dem stehenden Tor. Gemessen wird deshalb beides.
   */
  D: '.eltern{left:88px;bottom:84px;z-index:1}',
}

/*
 * ── DER STILLLEGE-VORSCHLAG ────────────────────────────────────────────────
 *
 * ER IST KEINE ATTRAPPE, und das ist die ganze Schwierigkeit: Eine Leiste, die
 * dasteht und nicht reagiert, ist schlimmer als eine, die weg ist — man tippt
 * sie an, nichts passiert, und man lernt, dass Tippen hier nichts bewirkt
 * ([[attrappe-luegt-durch-weglassen]]).
 *
 * Drei Teile, und jeder einzelne genuegt NICHT:
 *   1. `pointer-events: none` — nicht treffbar. Ohne 2. und 3. ist genau das
 *      die Attrappe.
 *   2. `opacity: .38` + `filter: grayscale(1)` — SICHTBAR stillgelegt. Das
 *      Auge sieht vor dem Finger, dass hier gerade nichts geht.
 *   3. EIN GRUND, der dasteht: das `::after` am `.leiste` schreibt „gesperrt"
 *      quer ueber die Spalte. Ohne ihn ist „grau" eine Vermutung.
 *
 * `#zurueck` IST AUSDRUECKLICH NICHT DABEI. Er liegt bei z-index 9 ausserhalb
 * der Leiste; wer ihn mit stilllegte, haette ein Tor ohne Ausgang gebaut.
 *
 * WAS MIT `#ich` PASSIERT, ist die eigentliche Entscheidung dieses Vorschlags
 * und steht deshalb in einer EIGENEN Zeile: Das Zeichen „wer hoert" ist kein
 * Teil der Leiste (`position: fixed`, z-index 5), es muesste also
 * ausdruecklich mitgenommen werden. Gemessen wird beides — mit und ohne.
 */
const STILL_LEISTE = `
  .leiste{opacity:.38;filter:grayscale(1);pointer-events:none;position:relative}
  .leiste::after{content:"gesperrt";position:absolute;left:0;right:0;top:50%;
    transform:translateY(-50%) rotate(-90deg);text-align:center;
    font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
`
const STILL_ICH = `.ich{opacity:.38;filter:grayscale(1);pointer-events:none}`

// ── Browser ────────────────────────────────────────────────────────────────
if (!browserSuchen()) {
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
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
  ZIEL = `http://127.0.0.1:${PORT}/neu/`
  vorschau = spawn(process.execPath, ['tools/neu-vorschau.mjs', '--port', String(PORT)], {
    cwd: WURZEL,
    stdio: 'ignore',
  })
  vorschau.unref()
  let gestorben = null
  vorschau.on('exit', (c) => {
    gestorben = c
  })
  const bis = Date.now() + 10000
  for (;;) {
    if (gestorben !== null) throw new Error(`tools/neu-vorschau.mjs endete sofort (${gestorben}) — Port ${PORT} belegt`)
    try {
      await fetch(`http://127.0.0.1:${PORT}/api/werke`)
      break
    } catch {
      if (Date.now() > bis) throw new Error('tools/neu-vorschau.mjs kam nicht hoch')
      await warte(150)
    }
  }
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

/**
 * WAS EIN KIND BEI STEHENDEM TOR ANFASSEN KANN.
 *
 * Gefragt wird `document.elementFromPoint` und nicht der Baum: „steht da" und
 * „ist zu treffen" sind zwei verschiedene Aussagen, und der ganze Unterschied
 * zwischen dem Deckel von heute und der Seite des Entwurfs liegt genau darin.
 *
 * AUSSERHALB VON `#eltern` — der Inhalt des Tors selbst (zwoelf Tasten) ist
 * hier nicht die Frage; er gehoert zur Sperre.
 */
const ERREICHBAR_JS = String.raw`
(() => {
  const WAHL = 'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="switch"], [tabindex]:not([tabindex="-1"])'
  const sichtbar = (e) => {
    const s = getComputedStyle(e)
    if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return false
    if (e.disabled === true || e.getAttribute('aria-disabled') === 'true') return false
    if (s.pointerEvents === 'none') return false
    const r = e.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return false
    return true
  }
  const trifft = (e, x, y) => {
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false
    const g = document.elementFromPoint(x, y)
    return !!g && (g === e || e.contains(g))
  }
  const benennen = (e) => {
    const t = [e.tagName.toLowerCase()]
    if (e.id) t.push('#' + e.id)
    const kl = (e.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
    if (kl.length) t.push('.' + kl.join('.'))
    const s = e.getAttribute('aria-label') || (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24)
    return t.join('') + (s ? '  „' + s + '"' : '')
  }
  /* Von der Mitte nach aussen tasten — wortgleich zu beruehrziele-neu.mjs,
     damit die Millimeter dieselben sind wie dort und nicht „auch ungefaehr". */
  const tasten = (e) => {
    const r = e.getBoundingClientRect()
    const l = Math.max(0, r.left), o = Math.max(0, r.top)
    const re0 = Math.min(innerWidth - 1, r.right), u0 = Math.min(innerHeight - 1, r.bottom)
    if (re0 <= l || u0 <= o) return null
    let sx = Math.round((l + re0) / 2), sy = Math.round((o + u0) / 2)
    if (!trifft(e, sx, sy)) {
      let da = false
      for (let i = 1; i <= 5 && !da; i++) for (let j = 1; j <= 5 && !da; j++) {
        const x = Math.round(l + ((re0 - l) * i) / 6), y = Math.round(o + ((u0 - o) * j) / 6)
        if (trifft(e, x, y)) { sx = x; sy = y; da = true }
      }
      if (!da) return null
    }
    const Z = 40
    const lauf = (dx, dy, g) => { let n = 0; while (n < g && trifft(e, sx + dx * (n + 1), sy + dy * (n + 1))) n++; return n }
    const li = lauf(-1, 0, Math.ceil(r.width) + Z), re = lauf(1, 0, Math.ceil(r.width) + Z)
    const ob = lauf(0, -1, Math.ceil(r.height) + Z), un = lauf(0, 1, Math.ceil(r.height) + Z)
    return { breite: li + re + 1, hoehe: ob + un + 1, l: sx - li, r: sx + re, o: sy - ob, u: sy + un, x: sx, y: sy }
  }
  const drin = document.getElementById('eltern')
  const aus = []
  for (const e of [...document.querySelectorAll(WAHL)].filter(sichtbar)) {
    if (drin && drin.contains(e)) continue
    const t = tasten(e)
    if (!t) continue
    aus.push({ name: benennen(e), id: e.id || '', breite: t.breite, hoehe: t.hoehe,
               klein: Math.min(t.breite, t.hoehe), k: { l: t.l, r: t.r, o: t.o, u: t.u },
               x: t.x, y: t.y })
  }
  let engste = null
  for (let i = 0; i < aus.length; i++) for (let j = i + 1; j < aus.length; j++) {
    const a = aus[i].k, b = aus[j].k
    const dx = Math.max(0, Math.max(a.l - b.r, b.l - a.r))
    const dy = Math.max(0, Math.max(a.o - b.u, b.o - a.u))
    const d = Math.round(Math.hypot(dx, dy))
    if (!engste || d < engste.px) engste = { px: d, a: aus[i].name, b: aus[j].name }
  }
  return { ziele: aus, engste }
})()
`

/** Die Lage in EINEM Griff — alles, was nach einem Tipp anders sein kann. */
const LAGE_JS = String.raw`
(() => {
  const da = (id) => { const e = document.getElementById(id); return !!e && !e.hidden }
  const txt = (id) => { const e = document.getElementById(id); return e ? (e.textContent || '').trim() : null }
  const e = document.getElementById('eltern')
  const r = e ? e.getBoundingClientRect() : null
  return {
    pfad: location.pathname + location.search,
    elternDa: da('eltern'),
    torDa: da('eltern-tor'),
    flaecheDa: da('eltern-flaeche'),
    ichDa: da('ich-fenster'),
    unter: txt('eltern-unter'),
    frage: txt('tor-frage'),
    anzeige: txt('tor-anzeige'),
    meldung: txt('tor-meldung'),
    elternKasten: r ? { x: Math.round(r.x), y: Math.round(r.y), b: Math.round(r.width), h: Math.round(r.height) } : null,
    zurueckAus: (() => { const z = document.getElementById('zurueck'); return z ? !!z.disabled : null })(),
    /* aria-pressed, NICHT aria-selected — der erste Anlauf fragte nach
       aria-selected, das an keinem .kat steht (leisteBauen setzt
       aria-pressed). Jeder Kategorietipp meldete deshalb „nichts aendert
       sich", und genau das war die Frage. Eine Messung, die immer dieselbe
       Antwort gibt, ist keine.
       (KEINE BACKTICKS IN DIESEM BLOCK: er steht in einer Vorlagen-
       zeichenkette, und ein Backtick beendet sie mitten im Kommentar —
       genau das ist hier einmal passiert.) */
    kat: (() => { const k = document.querySelector('.kat[aria-pressed="true"]'); return k ? (k.textContent || '').trim() : null })(),
    /* WIE VIELE KACHELN HINTER DEM TOR STEHEN — die zweite Haelfte derselben
       Frage. aria-pressed sagt, welcher Knopf leuchtet; das Raster sagt, ob
       der Tipp wirklich etwas neu gezeichnet hat. */
    kacheln: document.querySelectorAll('#raster .kachel').length,
    /* DER EINSTIEG IST DER WEG HINEIN. Ob er bei stehendem Tor zu treffen ist,
       entscheidet, ob ein Kind das Tor neu aufziehen kann.
       BIS ZUM 06.08.2026 WAR DAS DAS ZAHNRAD #einst-knopf in der Kopfzeile;
       es ist ersatzlos entfallen. Der Weg ist jetzt der Schriftzug #wappen
       unten links, 1200 ms gehalten. Die Frage ist unveraendert. */
    einstieg: (() => { const k = document.getElementById('wappen')
      if (!k) return 'fehlt'
      const r = k.getBoundingClientRect()
      const mx = Math.max(0, Math.min(innerWidth - 1, r.x + r.width / 2))
      const my = Math.max(0, Math.min(innerHeight - 1, r.y + r.height / 2))
      const g = document.elementFromPoint(mx, my)
      return (!!g && (g === k || k.contains(g))) ? 'treffbar'
           : ('verdeckt durch ' + (g ? (g.id ? '#' + g.id : (g.className || g.tagName)) : 'nichts')) })(),
  }
})()
`

let chrome = null
try {
  chrome = await eigenerBrowser({ fenster: '800,480' })
  if (!chrome) {
    console.log('  kein Browser gefunden — uebersprungen')
    process.exit(0)
  }
  const liste = await chrome.ziele()
  const seite = liste.find((t) => t.type === 'page')
  const ws = new WebSocket(seite.webSocketDebuggerUrl)
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 800,
    height: 480,
    deviceScaleFactor: 1,
    mobile: false,
  })

  const ev = async (e) =>
    (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: false }))?.result?.value
  const stand = async (was) => {
    await fetch(new URL(`/vorschau/${was}`, ZIEL)).catch(() => null)
    await warte(120)
  }
  const neuLaden = async () => {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(2200)
  }
  /** DIE FORM EINSETZEN — als `<style>`, nie in app.css. */
  const form = async (css) => {
    await ev(`(() => {
      document.getElementById('tor-form-probe')?.remove()
      if (!${JSON.stringify(css)}) return true
      const s = document.createElement('style')
      s.id = 'tor-form-probe'
      s.textContent = ${JSON.stringify(css)}
      document.head.appendChild(s)
      return true })()`)
    await warte(250)
  }
  /** Der Einstieg ist ein LANGES HALTEN, kein Klick (700 ms in app.js). */
  const langHalten = async (ms = 900) => {
    // HIER STAND EIN GRIFF ANS ZAHNRAD `#einst-knopf`. Es ist am 06.08.2026
    // ersatzlos entfallen; hinein fuehrt der Schriftzug `#wappen`. Dieser Weg
    // ist der TASTATURWEG und prueft das Halten NICHT — tools/admin-weg.mjs.
    await adminAuf(ev, { warteMs: 800 })
  }
  /**
   * EIN ECHTER TIPP AUF EINEN PUNKT — nicht `element.click()`.
   *
   * Der Unterschied ist genau die Frage dieses Werkzeugs: `click()` auf ein
   * Element loest auch dann aus, wenn eine fremde Ebene darauf liegt. Ein
   * Kind tippt auf eine STELLE, und was dort obenauf liegt, bekommt den Tipp.
   */
  const tippen = async (x, y) => {
    for (const [typ, art] of [
      ['mousePressed', 1],
      ['mouseReleased', 1],
    ]) {
      await send(ws, 'Input.dispatchMouseEvent', {
        type: typ,
        x,
        y,
        button: 'left',
        buttons: art,
        clickCount: 1,
      })
    }
    await warte(450)
  }
  const lage = () => ev(LAGE_JS)
  const erreichbar = () => ev(ERREICHBAR_JS)

  /** Das Tor in einer Sorte herstellen — und nachsehen, ob es wirklich steht. */
  const torStellen = async (sorte, formCss) => {
    await stand('voll')
    await stand(`sperre-${sorte}`)
    await neuLaden()
    await form(formCss)
    await langHalten()
    await form(formCss) // nach dem Aufmachen erneut: `raeumen()` ruehrt den Kopf an
    const l = await lage()
    if (!l.torDa) throw new Error(`das Tor (${sorte}) ging nicht auf`)
    return l
  }

  await stand('name-mitbox')
  await stand('profil-liam') // drei Profile — sonst gibt es gar keinen Wechsel
  await stand('figuren-da')

  // ══════════════════════════════════════════════════════════════════════════
  // 1. WAS KANN EIN KIND WIRKLICH — je Form, je Sperrart
  // ══════════════════════════════════════════════════════════════════════════
  zeile('══ 1. ERREICHBAR BEI STEHENDEM TOR ══════════════════════════════════')
  const tabelle = {}
  for (const [fname, fcss] of Object.entries(FORMEN)) {
    for (const sorte of ['rechnen', 'pin', 'geste']) {
      const l = await torStellen(sorte, fcss)
      const m = await erreichbar()
      const schluessel = `${fname}/${sorte}`
      tabelle[schluessel] = { lage: l, ziele: m.ziele, engste: m.engste }
      const k = l.elternKasten
      zeile(
        `  ${schluessel.padEnd(14)} #eltern ${k.x}/${k.y} ${k.b}x${k.h}` +
          `   ${m.ziele.length} erreichbar` +
          (m.engste ? `   engstes Paar ${mmS(m.engste.px)} mm` : ''),
      )
      for (const z of m.ziele) zeile(`      ${mmS(z.breite).padStart(5)} x ${mmS(z.hoehe).padStart(5)} mm  ${z.name}`)
    }
  }

  const heuteZ = tabelle['heute/rechnen'].ziele
  ja(
    heuteZ.length === 1 && heuteZ[0].id === 'zurueck',
    'HEUTE: bei stehendem Tor ist NUR der eine Rueckweg erreichbar',
    heuteZ.map((z) => z.name).join(' | ') || 'gar nichts',
  )

  for (const sorte of ['rechnen', 'pin', 'geste']) {
    const b = tabelle[`B/${sorte}`].ziele
    ja(
      b.length > 1,
      `B/${sorte}: die Leiste ist bei stehendem Tor bedienbar`,
      `${b.length} Ziele: ${b.map((z) => z.id || z.name.slice(0, 18)).join(', ')}`,
    )
  }
  for (const sorte of ['rechnen', 'pin', 'geste']) {
    const t = tabelle[`B/${sorte}`]
    const zuKlein = t.ziele.filter((z) => Math.min(z.breite, z.hoehe) * MM_JE_PIXEL < MARKE_MM)
    ja(
      zuKlein.length === 0,
      `B/${sorte}: kein erreichbares Ziel unter ${MARKE_MM} mm`,
      zuKlein.map((z) => `${z.name} ${mmS(z.klein)}`).join(' | ') || `${t.ziele.length} Ziele`,
    )
    ja(
      !t.engste || t.engste.px * MM_JE_PIXEL >= PAAR_MM,
      `B/${sorte}: kein Paar unter ${PAAR_MM} mm`,
      t.engste ? `${mmS(t.engste.px)} mm zwischen ${t.engste.a} und ${t.engste.b}` : 'nur ein Ziel',
    )
  }
  const cZ = tabelle['C/rechnen'].ziele
  ja(
    cZ.length >= tabelle['B/rechnen'].ziele.length,
    'C bringt gegenueber B weitere Ziele (das Kissen)',
    `B ${tabelle['B/rechnen'].ziele.length} -> C ${cZ.length}: ` +
      cZ
        .filter((z) => !tabelle['B/rechnen'].ziele.some((y) => y.name === z.name))
        .map((z) => z.name.slice(0, 26))
        .join(', ') || 'keine',
  )

  // ══════════════════════════════════════════════════════════════════════════
  // 2. IST DAS SCHAEDLICH — jedes erreichbare Ziel wird ANGETIPPT
  // ══════════════════════════════════════════════════════════════════════════
  zeile()
  zeile('══ 2. WIRKUNG — jedes erreichbare Ziel wird angetippt (Form B, rechnen) ══')
  const wirkungen = []
  for (const z of tabelle['B/rechnen'].ziele) {
    const vor = await torStellen('rechnen', FORMEN.B)
    await tippen(z.x, z.y)
    const nach = await lage()
    const anders = []
    if (vor.pfad !== nach.pfad) anders.push(`Adresse ${vor.pfad} -> ${nach.pfad}`)
    if (vor.torDa !== nach.torDa) anders.push(`Tor ${vor.torDa} -> ${nach.torDa}`)
    if (vor.elternDa !== nach.elternDa) anders.push(`Bereich ${vor.elternDa} -> ${nach.elternDa}`)
    if (vor.flaecheDa !== nach.flaecheDa) anders.push(`FLAECHE OFFEN ${vor.flaecheDa} -> ${nach.flaecheDa}`)
    if (vor.ichDa !== nach.ichDa) anders.push(`Auswahl „wer hoert" ${vor.ichDa} -> ${nach.ichDa}`)
    if (vor.frage !== nach.frage) anders.push(`Frage „${vor.frage}" -> „${nach.frage}"`)
    if (vor.kat !== nach.kat) anders.push(`Kategorie „${vor.kat}" -> „${nach.kat}"`)
    if (vor.kacheln !== nach.kacheln) anders.push(`Raster ${vor.kacheln} -> ${nach.kacheln} Kacheln`)
    wirkungen.push({ ziel: z.name, id: z.id, torDanach: nach.torDa, flaeche: nach.flaecheDa, anders })
    zeile(`  ${z.name}`)
    zeile(`      ${anders.length ? anders.join('  |  ') : 'nichts aendert sich'}`)
  }
  ja(
    wirkungen.every((w) => !w.flaeche),
    'KEIN erreichbarer Knopf oeffnet die Eltern-Flaeche',
    wirkungen
      .filter((w) => w.flaeche)
      .map((w) => w.ziel)
      .join(', ') || 'keiner',
  )
  ja(
    wirkungen.every((w) => w.torDanach),
    'nach jedem Tipp steht das Tor noch',
    wirkungen
      .filter((w) => !w.torDanach)
      .map((w) => w.ziel)
      .join(', ') || 'alle',
  )

  /*
   * DER EINSTIEG — die Frage „laesst sich das Tor neu aufziehen?".
   *
   * BIS ZUM 06.08.2026 STAND HIER: „Das Zahnrad steht in der Kopfzeile, also
   * in .spalte und damit RECHTS der 88 px. In jeder der drei Formen liegt
   * #eltern darueber. Das ist der Grund, warum der Weg hinein bei stehendem
   * Tor nicht noch einmal gegangen werden kann — und es ist eine FOLGE DER
   * GEOMETRIE, nicht eine Regel im Code. Wer den Bereich spaeter schmaler
   * macht, hebt sie auf, ohne eine Zeile anzufassen."
   *
   * GENAU DAS IST EINGETRETEN, und zwar von der anderen Seite: Nicht der
   * Bereich ist schmaler geworden, sondern DER EINSTIEG IST UMGEZOGEN. Er ist
   * seit dem Abend des 06.08.2026 der Schriftzug `#wappen` — und der steht
   * unten LINKS, also INNERHALB der 88 px, genau in dem Streifen, den die
   * Vorschlaege B, C und D freilassen wollen.
   *
   * GEMESSEN (06.08.2026): In der Form „heute" (Vollbild) haelt der Satz.
   * In B, C und D ist der Einstieg bei stehendem Tor TREFFBAR — ein Kind
   * kann das Tor dort beliebig oft neu aufziehen. Das ist keine Zeile Code,
   * die kaputt ist, sondern der Preis der drei Vorschlaege, und er gehoert
   * benannt, bevor einer von ihnen gebaut wird.
   */
  for (const fname of ['heute', 'B', 'C', 'D']) {
    const l = await torStellen('rechnen', FORMEN[fname])
    // FRUEHER: „das Zahnrad ist bei stehendem Tor NICHT zu treffen". Es galt,
    // weil das Zahnrad der Weg hinein war; seit dem 06.08.2026 ist es das
    // Wappen. Derselbe Satz, neues Ziel.
    ja(l.einstieg !== 'treffbar', `${fname}: der Einstieg #wappen ist bei stehendem Tor NICHT zu treffen`, l.einstieg)
  }

  // ── Das Zeichen „wer hoert": geht die Auswahl auf, und ist sie zu sehen? ──
  zeile()
  zeile('══ 2b. DER PROFILWECHSEL ════════════════════════════════════════════')
  /*
   * DIE WICHTIGSTE FRAGE DIESES WERKZEUGS, und sie hat je Form eine andere
   * Antwort. Ein Profilwechsel endet in `window.location.reload()` (app.js,
   * `werWaehlen`) — er ist damit der einzige erreichbare Knopf, der die
   * Oberflaeche NEU STARTET. Ob er erreichbar ist, entscheidet die Schichtung,
   * nicht die Absicht.
   */
  for (const fname of ['B', 'C', 'D']) {
    await torStellen('rechnen', FORMEN[fname])
    const m = await erreichbar()
    const ichZiel = m.ziele.find((z) => z.id === 'ich')
    if (!ichZiel) {
      ja(false, `${fname}: das Zeichen „wer hoert" war gar nicht erreichbar`)
      continue
    }
    await tippen(ichZiel.x, ichZiel.y)
    const nachIch = await lage()
    ja(
      nachIch.ichDa,
      `${fname}: ein Tipp auf „wer hoert" oeffnet die Auswahl bei stehendem Tor`,
      `#ich-fenster hidden=${!nachIch.ichDa}`,
    )
    const sicht = await ev(`(() => {
      const b = document.getElementById('ich-blatt')
      if (!b) return null
      const r = b.getBoundingClientRect()
      const pkt = [[r.x + r.width/2, r.y + r.height/2], [r.x + 12, r.y + 12], [r.x + r.width - 12, r.y + r.height - 12]]
      const wer = pkt.map(([x, y]) => { const g = document.elementFromPoint(x, y)
        return g ? (g.id ? '#' + g.id : (g.className || g.tagName)) : 'nichts' })
      const zaehl = (wahl) => { const a = [...document.querySelectorAll(wahl)]
        const t = a.filter((k) => { const q = k.getBoundingClientRect()
          if (q.width < 1 || q.height < 1) return false
          const mx = Math.max(0, Math.min(innerWidth - 1, q.x + q.width/2))
          const my = Math.max(0, Math.min(innerHeight - 1, q.y + q.height/2))
          const g = document.elementFromPoint(mx, my)
          return !!g && (g === k || k.contains(g)) }).length
        return { da: a.length, treffbar: t } }
      return { kasten: { x: Math.round(r.x), y: Math.round(r.y), b: Math.round(r.width), h: Math.round(r.height) },
               obenauf: wer, leute: zaehl('#ich-leute .ich-kachel'), bilder: zaehl('#ich-bilder .ich-kachel') } })()`)
    zeile(
      `  ${fname}: Blatt ${sicht.kasten.x}/${sicht.kasten.y} ${sicht.kasten.b}x${sicht.kasten.h}` +
        `   obenauf: ${[...new Set(sicht.obenauf)].join(', ')}`,
    )
    zeile(
      `     Profilkacheln ${sicht.leute.treffbar}/${sicht.leute.da} treffbar,` +
        ` Bildkacheln ${sicht.bilder.treffbar}/${sicht.bilder.da} treffbar`,
    )
    ja(
      sicht.leute.treffbar === 0,
      `${fname}: KEINE Profilkachel ist bei stehendem Tor zu treffen`,
      `${sicht.leute.treffbar} von ${sicht.leute.da} treffbar, obenauf ${sicht.obenauf[0]}` +
        (sicht.leute.treffbar ? '  <-- ein Wechsel laedt neu und loescht die Bremse' : ''),
    )
    // Der Knopf, der ein unsichtbares Fenster oeffnet, IST eine Attrappe —
    // auch wenn dahinter nichts passiert. Er kostet einen Rueckweg-Tipp.
    ja(
      !nachIch.ichDa || sicht.leute.treffbar > 0 || sicht.bilder.treffbar > 0,
      `${fname}: „wer hoert" ist keine Attrappe (Fenster auf UND bedienbar)`,
      `Fenster ${nachIch.ichDa ? 'offen' : 'zu'}, bedienbar ${sicht.leute.treffbar + sicht.bilder.treffbar} Kacheln`,
    )
    const rw = await ev(`(() => { const z = document.getElementById('zurueck')
      const r = z.getBoundingClientRect()
      const g = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2)
      return { treffbar: !!g && (g === z || z.contains(g)), aus: !!z.disabled } })()`)
    ja(rw.treffbar && !rw.aus, `${fname}: der eine Rueckweg bleibt auch dann erreichbar`, JSON.stringify(rw))
    await ev(`document.getElementById('zurueck').click()`)
    await warte(400)
    const nach1 = await lage()
    zeile(
      `     1. Rueckweg-Tipp: Auswahl ${nach1.ichDa ? 'noch offen' : 'zu'}, Bereich ${nach1.elternDa ? 'noch offen' : 'zu'}`,
    )
    ja(
      !nach1.ichDa && nach1.elternDa,
      `${fname}: der Rueckweg schliesst ZUERST die Auswahl, das Tor bleibt stehen`,
      `ich=${nach1.ichDa} eltern=${nach1.elternDa}`,
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. DIE BREMSE — ueberlebt sie, was die offene Leiste ausloest?
  // ══════════════════════════════════════════════════════════════════════════
  zeile()
  zeile('══ 3. DIE BREMSE ════════════════════════════════════════════════════')
  /** Einmal falsch antworten. Danach steht die Bremse 5 s (TOR_WARTEN_S[1]). */
  const einmalFalsch = async () => {
    await ev(`(() => { const f = document.getElementById('tor-feld')
      const t = [...f.querySelectorAll('.tor-taste')]
      t.find((k) => k.dataset.taste === '1').click()
      t.find((k) => k.dataset.taste === 'weiter').click()
      return true })()`)
    await warte(350)
  }
  const bremseSteht = async () => {
    const l = await lage()
    return /Noch \d+ Sekunde/.test(l.meldung || '')
  }

  await torStellen('rechnen', FORMEN.B)
  await einmalFalsch()
  ja(await bremseSteht(), 'ein Fehlversuch stellt die Bremse', (await lage()).meldung)

  // (a) hinaus und wieder herein — der bekannte Weg, hier zur Gegenprobe
  await ev(`document.getElementById('zurueck').click()`)
  await warte(300)
  await langHalten()
  await form(FORMEN.B)
  ja(await bremseSteht(), 'die Bremse ueberlebt „hinaus und wieder herein"', (await lage()).meldung)

  // (b) DAS NEULADEN — genau das, was `werWaehlen` nach einem Profilwechsel tut
  await neuLaden()
  await form(FORMEN.B)
  await langHalten()
  await form(FORMEN.B)
  const nachLaden = await lage()
  const haelt = /Noch \d+ Sekunde/.test(nachLaden.meldung || '')
  ja(
    haelt,
    'die Bremse ueberlebt ein NEULADEN der Seite',
    `Meldung nach dem Neuladen: „${nachLaden.meldung}"` +
      (haelt ? '' : '  <-- die Bremse ist weg; ein Profilwechsel laedt neu (app.js, werWaehlen)'),
  )

  // (c) und die Geste?
  /*
   * IMMER DIESELBE ECKE, und das ist kein Detail — der erste Anlauf tippte
   * `p[i % 4]`, also links oben, rechts oben, rechts unten, links unten. Das
   * IST die Geste. Nach vier Beruehrungen war das Tor offen, `gesteBremse`
   * zurueckgesetzt, und die Messung meldete „die Bremse steht nicht" ueber
   * ein Tor, das gar nicht mehr stand. Eine Folge, die aus lauter Ecke 0
   * besteht, faengt bei jeder Beruehrung von vorn an (`gesteSchritt`) und
   * kann nie oeffnen — sie zaehlt nur.
   */
  const gesteTippen = async (n) => {
    await ev(`(() => { const t = document.getElementById('eltern-tor')
      const r = t.getBoundingClientRect()
      for (let i = 0; i < ${n}; i++)
        t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true,
          clientX: r.left + 20, clientY: r.top + 20 }))
      return true })()`)
    await warte(300)
  }
  await torStellen('geste', FORMEN.B)
  // 12 Beruehrungen sind frei (GESTE_FREI); die 16. ist die vierte danach und
  // stellt die Bremse auf 5 s (gesteWartenS -> torWartenS(1)).
  await gesteTippen(20)
  const gB = await lage()
  ja(/Noch \d+ Sekunde/.test(gB.meldung || ''), 'die Gesten-Bremse steht nach 20 Beruehrungen', gB.meldung)
  await neuLaden()
  await form(FORMEN.B)
  await langHalten()
  await form(FORMEN.B)
  const gN = await lage()
  ja(/Noch \d+ Sekunde/.test(gN.meldung || ''), 'die Gesten-Bremse ueberlebt ein Neuladen', `„${gN.meldung}"`)

  /*
   * ── DER GANZE WEG, IN EINEM STUECK GEFAHREN ──────────────────────────────
   * Bis hierher stehen zwei Aussagen nebeneinander: „ein Neuladen loescht die
   * Bremse" und „in Form D ist die Profilkachel zu treffen". Beide fuer sich
   * sind harmlose Befunde. Was zaehlt, ist die Verbindung — und die wird
   * gefahren, nicht geschlossen: Bremse stellen, Profil wechseln, wiederkommen.
   */
  zeile()
  zeile('  — der ganze Weg in Form D (Tor steht, Kind wechselt das Profil) —')
  await torStellen('rechnen', FORMEN.D)
  await einmalFalsch()
  const dVor = await lage()
  const dIch = (await erreichbar()).ziele.find((z) => z.id === 'ich')
  let dGefahren = null
  if (dIch && /Noch \d+ Sekunde/.test(dVor.meldung || '')) {
    await tippen(dIch.x, dIch.y)
    const geklickt = await ev(`(() => {
      const k = [...document.querySelectorAll('#ich-leute .ich-kachel')]
      const w = k.find((x) => x.getAttribute('aria-pressed') !== 'true')
      if (!w) return 'keine fremde Profilkachel'
      const q = w.getBoundingClientRect()
      const g = document.elementFromPoint(q.x + q.width/2, q.y + q.height/2)
      if (!g || !(g === w || w.contains(g))) return 'nicht treffbar'
      w.click(); return 'getippt' })()`)
    await warte(3000) // das Neuladen aus `werWaehlen`
    await form(FORMEN.D)
    await langHalten()
    await form(FORMEN.D)
    const dNach = await lage()
    dGefahren = { geklickt, meldung: dNach.meldung, tor: dNach.torDa }
    zeile(`     ${geklickt} -> Tor ${dNach.torDa ? 'steht wieder' : 'STEHT NICHT'}, Meldung „${dNach.meldung}"`)
    ja(
      geklickt !== 'getippt' || /Noch \d+ Sekunde/.test(dNach.meldung || ''),
      'D: ein Profilwechsel bei stehendem Tor loescht die Bremse NICHT',
      dGefahren.meldung || '(keine)',
    )
  } else {
    zeile(`     nicht gefahren (Zeichen erreichbar: ${!!dIch}, Bremse stand: ${/Noch/.test(dVor.meldung || '')})`)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. STILLLEGEN — was kostet es?
  // ══════════════════════════════════════════════════════════════════════════
  zeile()
  zeile('══ 4. STILLLEGEN ════════════════════════════════════════════════════')
  const vorschlaege = {
    'B + Leiste still': FORMEN.B + STILL_LEISTE,
    'B + Leiste und „wer hoert" still': FORMEN.B + STILL_LEISTE + STILL_ICH,
    'C + Leiste und „wer hoert" still': FORMEN.C + STILL_LEISTE + STILL_ICH,
  }
  for (const [wie, css] of Object.entries(vorschlaege)) {
    await torStellen('rechnen', css)
    const m = await erreichbar()
    zeile(
      `  ${wie.padEnd(34)} ${m.ziele.length} erreichbar` + (m.engste ? `, engstes Paar ${mmS(m.engste.px)} mm` : ''),
    )
    for (const z of m.ziele) zeile(`      ${mmS(z.breite).padStart(5)} x ${mmS(z.hoehe).padStart(5)} mm  ${z.name}`)
    const rw = m.ziele.find((z) => z.id === 'zurueck')
    ja(!!rw, `${wie}: der eine Rueckweg bleibt erreichbar`, rw ? `${mmS(rw.breite)} x ${mmS(rw.hoehe)} mm` : 'WEG')
    const klein = m.ziele.filter((z) => z.klein * MM_JE_PIXEL < MARKE_MM)
    ja(
      klein.length === 0,
      `${wie}: kein Ziel unter ${MARKE_MM} mm`,
      klein.map((z) => `${z.name} ${mmS(z.klein)}`).join(' | ') || 'keins',
    )
    // Und sieht man den Grund? Ein `::after` ohne Inhalt waere eine graue
    // Flaeche ohne Erklaerung — genau die Attrappe, die vermieden werden soll.
    const grund = await ev(`(() => { const l = document.getElementById('leiste')
      if (!l) return null
      const s = getComputedStyle(l, '::after')
      return { inhalt: s.content, deckung: getComputedStyle(l).opacity, grau: getComputedStyle(l).filter } })()`)
    ja(
      grund && grund.inhalt && grund.inhalt !== 'none',
      `${wie}: der Grund steht sichtbar an der Leiste`,
      JSON.stringify(grund),
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 5. DIE GEGENFRAGE — ist der Rueckweg waehrend des Tors erreichbar?
  // ══════════════════════════════════════════════════════════════════════════
  zeile()
  zeile('══ 5. DER RUECKWEG WAEHREND DES TORS ════════════════════════════════')
  for (const sorte of ['rechnen', 'pin', 'geste']) {
    await torStellen(sorte, FORMEN.heute)
    const r = await ev(`(() => { const z = document.getElementById('zurueck')
      const q = z.getBoundingClientRect()
      const g = document.elementFromPoint(q.x + q.width/2, q.y + q.height/2)
      return { treffbar: !!g && (g === z || z.contains(g)), aus: !!z.disabled } })()`)
    await ev(`document.getElementById('zurueck').click()`)
    await warte(400)
    const l = await lage()
    ja(
      r.treffbar && !r.aus && !l.elternDa,
      `${sorte} (heutige Form): der eine Rueckweg fuehrt bei stehendem Tor hinaus`,
      `treffbar=${r.treffbar} aus=${r.aus} Bereich danach ${l.elternDa ? 'offen' : 'zu'}`,
    )
  }

  zeile()
  const schlecht = befunde.filter((b) => !b.gut)
  zeile(`${befunde.length - schlecht.length} von ${befunde.length} Aussagen halten.`)
  process.exitCode = schlecht.length ? 1 : 0
} finally {
  try {
    await chrome?.schliessen()
  } catch {
    /* egal */
  }
  try {
    vorschau?.kill()
  } catch {
    /* schon weg */
  }
}
