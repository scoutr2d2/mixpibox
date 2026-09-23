#!/usr/bin/env node
/**
 * DIE SECHS NEUEN ANZEIGEN VOM 07.08.2026 — NACHGEMESSEN STATT NACHGELESEN.
 *
 * ══ WOZU, UND WARUM `beruehrziele-neu.mjs` DAFUER NICHT REICHT ═════════════
 *
 * Am 07.08.2026 sind sechs Stuecke dazugekommen (Knoepfe getauscht, Helligkeit
 * im Admin-Menue, Uhrzeit und Restzeit oben, Titel/Album abschaltbar, der
 * Microplayer, die Kinderzeit-Passung). Der Bericht dazu nennt eine Zahl als
 * Beweis: „beruehrziele-neu: 14 von 211, unveraendert."
 *
 * DIE ZAHL STIMMT — UND SIE BEWEIST NICHT, WAS SIE ZU BEWEISEN SCHEINT.
 * `beruehrziele-neu.mjs` faehrt vierzehn Schirme ab, und KEINER von ihnen
 * betritt eine Unterseite von „Darstellung" (Indikatoren, Farbe und Form,
 * Player, Verhalten). Vier der sechs neuen Stuecke sind ausserdem AB WERK AUS
 * (`uhrzeit`, `restzeit`, `kissenMicro`, `kinderzeitPassung`) — sie stehen bei
 * keiner Messung am Schirm. Eine Zahl bleibt also genau deshalb unveraendert,
 * weil das Neue fuer sie unsichtbar ist. Das ist kein Vorwurf an das Werkzeug;
 * es ist der Grund, warum es dieses hier braucht.
 *
 * ══ WAS HIER GEMESSEN WIRD — die Aussagen des Berichts, eine nach der anderen
 *
 *   1. KISSEN MIT ALBUMZEILE   Behauptet: „25+3+15+5+15 = 63 in 66 px, das
 *      Kissen wird NICHT hoeher." Gemessen: die Hoehe von `.mp`, die Hoehe von
 *      `.mp-text`, ob `.mp-text` ueberlaeuft (`scrollHeight > clientHeight`),
 *      und ob die Albumzeile bei einem Titel OHNE Album wirklich wegfaellt.
 *   2. MICROPLAYER            Behauptet: „bleibt ein 76-px-Ziel." Gemessen:
 *      der Kasten von `.mp-bild`, gegen die 9-mm-Marke gerechnet. Und: ob es
 *      in dieser Stufe wirklich das EINZIGE Ziel ist und ob es hinausfuehrt.
 *   3. HELLIGKEITSZEILE       Der Bericht sagt selbst „ungemessen". Gemessen:
 *      der Kasten des `<input type=range>` in allen vier Lagen, ob im Fall
 *      `da:false` wirklich KEIN Regler dasteht, und ob im Fall `geklemmt` der
 *      Knopf da ist (der Regler steht dort schon am Anschlag und kann nichts
 *      senden).
 *   4. NUR BEIM LOSLASSEN     Behauptet: „setzen bei `change`, nicht `input`;
 *      ein Zug sind ~30 sudo-Aufrufe." Gemessen: die PUTs waehrend eines
 *      nachgestellten Zuges ueber die halbe Bahn werden GEZAEHLT.
 *   5. DIE VIER UNTERSEITEN   Jede Zeile auf „Indikatoren", „Farbe und Form",
 *      „Player" und „Verhalten": Hoehe des Ziels in mm, und ob die Karte
 *      mitten in einem Knopf endet. Das ist die Messung, die `beruehrziele-neu`
 *      nicht macht und auf die sich der Bericht beruft.
 *   6. UHRZEIT UND RESTZEIT   Stehen sie in der Mitte, nehmen sie Beruehrungen
 *      weg (`pointer-events`), und ueberdecken sie einander, wenn beide an
 *      sind?
 *   7. KINDERZEIT-PASSUNG     Steht die Laenge an der Kachel, ist das zu Lange
 *      gekennzeichnet statt versteckt, und bleibt eine Kachel OHNE Laenge
 *      unbeschriftet statt geraten?
 *
 * ══ WAS ES AENDERT ════════════════════════════════════════════════════════
 * Nichts an einer Datei und NICHTS AN EINER BOX. Es schreibt ausschliesslich
 * gegen `tools/neu-vorschau.mjs`. Ohne `--ziel` startet es seine EIGENE
 * Vorschau auf einem freien Port — eine geliehene bediente den Arbeitsbaum
 * dessen, der sie gestartet hat ([[vorschau-wird-geliehen]]).
 *
 * ══ AUFRUF ════════════════════════════════════════════════════════════════
 *   node tools/neue-anzeigen-nachmessen.mjs
 *   node tools/neue-anzeigen-nachmessen.mjs --ziel http://127.0.0.1:9819/neu/
 *   node tools/neue-anzeigen-nachmessen.mjs --bilder /tmp/neu
 * ENDE 0, wenn jede Aussage haelt.
 */
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { eigenerBrowser, freierPort } from './leihgabe.mjs'
import { adminAuf } from './admin-weg.mjs'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  return i < 0 ? v : argv[i + 1]
}
const MITGEGEBEN = opt('ziel')
const BILDER = opt('bilder')

/** 800 px auf 115 mm Glas — dieselbe Zahl wie in beruehrziele-neu.mjs. */
const MM_JE_PX = 0.14
const GRIFF_MM = 9

const warte = (ms) => new Promise((r) => setTimeout(r, ms))
let lfd = 0
function send(ws, methode, params = {}) {
  const id = ++lfd
  return new Promise((loesen, brechen) => {
    const zu = setTimeout(() => brechen(new Error(`${methode} antwortete nicht`)), 20000)
    const hoeren = (roh) => {
      let n = null
      try {
        n = JSON.parse(roh)
      } catch {
        return
      }
      if (n.id !== id) return
      clearTimeout(zu)
      ws.off('message', hoeren)
      n.error ? brechen(new Error(n.error.message)) : loesen(n.result)
    }
    ws.on('message', hoeren)
    ws.send(JSON.stringify({ id, method: methode, params }))
  })
}

let fehler = 0
let geprueft = 0
function sag(gut, satz, dazu = '') {
  geprueft++
  if (!gut) fehler++
  console.log(`${gut ? 'ok  ' : 'FEHL'}  ${satz}${dazu ? '  — ' + dazu : ''}`)
}
const ueber = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(2, 58 - t.length))}`)

/* ── DIE VORSCHAU ────────────────────────────────────────────────────────── */
let ZIEL = MITGEGEBEN
let vorschau = null
if (!ZIEL) {
  const p = await freierPort()
  ZIEL = `http://127.0.0.1:${p}/neu/`
  vorschau = spawn(process.execPath, ['tools/neu-vorschau.mjs', '--port', String(p)], {
    cwd: WURZEL,
    stdio: 'ignore',
  })
  for (let i = 0; i < 40; i++) {
    await warte(250)
    try {
      if ((await fetch(ZIEL, { signal: AbortSignal.timeout(500) })).ok) break
    } catch {
      /* noch nicht da */
    }
  }
}
console.log(`ZIEL: ${ZIEL}${vorschau ? '  (eigene Vorschau)' : '  (mitgegeben)'}`)

const browser = await eigenerBrowser({ fenster: '800,480' })
if (!browser) {
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}

/**
 * DIE PUTs MITSCHREIBEN — der einzige Weg, „setzt beim Loslassen" zu MESSEN.
 *
 * Die Behauptung ist eine ZAHL („ein Zug sind ~30 sudo-Aufrufe"), und eine Zahl
 * prueft man, indem man zaehlt. `fetch` wird deshalb umwickelt, bevor die Seite
 * etwas tut; gezaehlt wird nur, was an die Helligkeit geht.
 */
const MITSCHREIBER = `(() => {
  window.__licht = []
  const echt = window.fetch
  window.fetch = function (u, o) {
    try {
      const pfad = String(typeof u === 'string' ? u : (u && u.url) || '')
      if (pfad.includes('/schirm/helligkeit')) window.__licht.push(((o && o.method) || 'GET') + ' ' + pfad)
    } catch { /* ein Abruf, den wir nicht lesen koennen, wird nicht gezaehlt */ }
    return echt.apply(this, arguments)
  }
  return true
})()`

let ws = null
try {
  if (BILDER) await mkdir(BILDER, { recursive: true })
  ws = new WebSocket(await browser.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })

  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value
  const stand = async (w) => {
    await fetch(new URL(`/vorschau/${w}`, ZIEL)).catch(() => null)
    await warte(120)
  }
  const laden = async () => {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(2400)
    await ev(MITSCHREIBER)
  }
  const bild = async (name) => {
    if (!BILDER) return
    const s = await send(ws, 'Page.captureScreenshot', { format: 'png' })
    await writeFile(join(BILDER, `${name}.png`), Buffer.from(s.data, 'base64'))
  }

  /**
   * EINEN SCHALTER SETZEN — ueber `PUT /api/darstellung` UND MIT DEM GANZEN
   * STAND. Nur das eine Feld zu schicken, loeschte am Server alles andere
   * (`aktuell` wird ERSETZT, nicht zusammengefuegt) — genau die Falle, die die
   * Vorschau absichtlich nachbaut.
   */
  const darstSetzen = async (felder) => {
    const jetzt = await (await fetch(new URL('/api/darstellung', ZIEL))).json()
    await fetch(new URL('/api/darstellung', ZIEL), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aktuell: { ...(jetzt.aktuell || {}), ...felder }, themen: jetzt.themen || {} }),
    })
  }

  /** Der Kasten eines Elements, in px und in mm der schmaleren Seite. */
  const kasten = async (wahl) => {
    const r = await ev(`(() => {
      const e = document.querySelector(${JSON.stringify(wahl)})
      if (!e) return null
      const b = e.getBoundingClientRect()
      const s = getComputedStyle(e)
      return { b: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.x), y: Math.round(b.y),
               zeiger: s.pointerEvents, sicht: s.display !== 'none' && s.visibility !== 'hidden' }
    })()`)
    return r
  }
  const mm = (px) => Number((px * MM_JE_PX).toFixed(2))

  /* ════════════════════════════════════════════════════════════════════════
   * 1. DAS KISSEN MIT SEINER NEUEN ALBUMZEILE
   * ══════════════════════════════════════════════════════════════════════ */
  ueber('1. Kissen: die Albumzeile kostet keine Hoehe')
  await stand('voll')
  await stand('spotify')
  await laden()
  await bild('kissen-mit-album')

  const kissen = await kasten('#mp')
  sag(!!kissen && kissen.h === 76, 'das Kissen ist 76 px hoch — wie vor der Albumzeile', kissen ? `${kissen.b}x${kissen.h}` : 'kein Kissen')

  const text = await ev(`(() => {
    const t = document.querySelector('.mp-text'); if (!t) return null
    const teil = (w) => { const e = t.querySelector(w); if (!e) return null
      const b = e.getBoundingClientRect(); return { h: Math.round(b.height), text: (e.textContent||'').trim().slice(0,40) } }
    return { hoehe: Math.round(t.getBoundingClientRect().height), roll: t.scrollHeight, sicht: t.clientHeight,
             titel: teil('.mp-titel'), unter: teil('.mp-unter'), leiste: teil('.mp-leiste') }
  })()`)
  sag(!!text && text.roll <= text.sicht + 1, 'nichts laeuft aus `.mp-text` heraus', text ? `Inhalt ${text.roll} px in ${text.sicht} px` : '—')
  sag(!!text?.unter && text.unter.text.length > 0, 'die Albumzeile steht da und traegt einen Text', text?.unter ? `„${text.unter.text}" (${text.unter.h} px)` : 'keine')
  const summe = text ? (text.titel?.h || 0) + (text.unter?.h || 0) + (text.leiste?.h || 0) : 0
  sag(summe > 0 && summe <= 66, 'Titel + Album + Leiste bleiben unter 66 px', `${summe} px  (Titel ${text?.titel?.h} + Album ${text?.unter?.h} + Leiste ${text?.leiste?.h})`)

  /* OHNE ALBUM MUSS SIE GANZ WEG — und das wird ERZWUNGEN und nicht erhofft.
     Hier stand zuerst ein Zustandswechsel der Vorschau (`spotify-lose`); der
     traegt aber weiterhin einen Albumnamen, die Zeile blieb gefuellt, und die
     Aussage ging GRUEN durch, ohne je den leeren Fall gesehen zu haben. Genau
     die Sorte Messung, die nichts haelt. Jetzt wird der Text geleert und
     danach gemessen — das ist der Fall, den `.mp-unter:empty` behauptet. */
  const ohne = await ev(`(() => {
    const u = document.querySelector('.mp-unter'); if (!u) return null
    const vorher = Math.round(u.getBoundingClientRect().height)
    const mpVorher = Math.round(document.getElementById('mp').getBoundingClientRect().height)
    u.textContent = ''
    const nachher = Math.round(u.getBoundingClientRect().height)
    const s = getComputedStyle(u)
    return { vorher, nachher, mpVorher, anzeige: s.display,
             mpNachher: Math.round(document.getElementById('mp').getBoundingClientRect().height) }
  })()`)
  sag(!!ohne && ohne.vorher > 0 && ohne.nachher === 0 && ohne.anzeige === 'none',
    'wird die Albumzeile leer, verschwindet sie ganz (`:empty`) — kein leerer Streifen',
    ohne ? `${ohne.vorher} px -> ${ohne.nachher} px (display ${ohne.anzeige})` : 'kein Element')
  sag(!!ohne && ohne.mpVorher === ohne.mpNachher, 'und das Kissen bleibt dabei gleich hoch', ohne ? `${ohne.mpVorher} -> ${ohne.mpNachher} px` : '—')

  /* ════════════════════════════════════════════════════════════════════════
   * 2. DER MICROPLAYER
   * ══════════════════════════════════════════════════════════════════════ */
  ueber('2. Microplayer: das Bild ist das einzige Ziel — und wie gross?')
  await stand('voll')
  await stand('spotify')
  await darstSetzen({ kissenMicro: true })
  await laden()
  await bild('microplayer')

  const micro = await ev(`document.body.classList.contains('mp-micro')`)
  sag(micro === true, 'der Schalter kommt an: `body.mp-micro` steht')

  const bildZiel = await kasten('.mp-bild')
  const mMicro = bildZiel ? mm(Math.min(bildZiel.b, bildZiel.h)) : 0
  sag(!!bildZiel && bildZiel.b === 76 && bildZiel.h === 76, 'das Bild ist 76 x 76 px — die Zahl aus dem Bericht', bildZiel ? `${bildZiel.b}x${bildZiel.h}` : 'kein Bild')
  sag(mMicro >= GRIFF_MM, `und damit ueber der 9-mm-Marke`, `${mMicro} mm`)

  const zieleMicro = await ev(`(() => {
    const raus = []
    for (const e of document.querySelectorAll('#mp button, #mp [data-auf], #mp input')) {
      const b = e.getBoundingClientRect()
      if (b.width < 1 || b.height < 1) continue
      const s = getComputedStyle(e)
      if (s.display === 'none' || s.visibility === 'hidden') continue
      raus.push((e.id || e.className || e.tagName) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height))
    }
    return raus
  })()`)
  sag(Array.isArray(zieleMicro) && zieleMicro.length === 1, 'in dieser Stufe steht GENAU EIN Ziel im Kissen', (zieleMicro || []).join(' · ') || 'keines')

  // DER WEG HERAUS. Ein Zustand, aus dem man nicht zurueckfindet, war die
  // ausdrueckliche Sorge des Auftrags — also wird der Rueckweg GEFAHREN.
  const nachTipp = await ev(`(() => {
    const a = document.querySelector('.mp-bild'); if (!a) return 'kein Bild'
    a.click(); return 'ok' })()`)
  await warte(900)
  const grossAuf = await ev(`(() => { const g = document.getElementById('gross'); return !!g && !g.hidden })()`)
  sag(nachTipp === 'ok' && grossAuf === true, 'ein Tipp aufs Bild oeffnet den grossen Player — der Weg heraus')
  const spieltNoch = await ev(`(() => { const s = document.getElementById('mp-symbol'); return s ? s.getAttribute('d') : '' })()`)
  sag(typeof spieltNoch === 'string' && spieltNoch.includes('M7 5h3.5v14H7'), 'und er pausiert NICHT — das Pausenzeichen steht weiter', spieltNoch ? spieltNoch.slice(0, 18) + '…' : '—')

  await darstSetzen({ kissenMicro: false })

  /* ════════════════════════════════════════════════════════════════════════
   * 3./4./5. DAS ADMIN-MENUE: DIE VIER UNTERSEITEN UND DIE HELLIGKEIT
   * ══════════════════════════════════════════════════════════════════════ */
  const hinein = async () => {
    await ev(`(() => { const g = document.getElementById('gross'); if (g && !g.hidden) { const z = document.querySelector('#gross .zurueck'); if (z) z.click() } return true })()`)
    await warte(300)
    await adminAuf(ev, { warteMs: 1100 })
  }
  const zurGruppe = async (fach) => {
    const r = await ev(`(() => {
      const k = document.querySelector('#eltern-faecher [data-fach=${JSON.stringify(fach)}]')
      if (!k) return 'keine Gruppe'
      k.click(); return 'ok' })()`)
    await warte(800)
    return r
  }
  const zumPunkt = async (name) => {
    const r = await ev(`(() => {
      for (const e of document.querySelectorAll('#fach-zeilen .fach-zeile')) {
        const n = e.querySelector('.zeile-name')
        if (n && n.textContent.trim() === ${JSON.stringify(name)}) { e.click(); return 'ok' }
      }
      return 'die Zeile steht nicht da' })()`)
    await warte(900)
    return r
  }

  /**
   * JEDE ZEILE EINER UNTERSEITE MESSEN — Ziel-Hoehe und der angeschnittene
   * Knopf. „Angeschnitten" heisst hier: der Knopf ragt ueber den sichtbaren
   * Bereich der Karte hinaus, ist aber nicht ganz draussen. Das ist der
   * Fehler, gegen den der vierte Punkt „Player" gebaut wurde — hier wird er
   * nachgerechnet statt geglaubt.
   */
  const zeilenMessen = async () => await ev(`(() => {
    const karte = document.getElementById('fach-zeilen'); if (!karte) return null
    const k = karte.getBoundingClientRect()
    const raus = { rollt: karte.scrollHeight > karte.clientHeight + 1, zeilen: [] }
    for (const z of karte.querySelectorAll('.fach-zeile')) {
      const n = z.querySelector('.zeile-name')
      const t = z.querySelector('.zeile-tat, .zeile-regler, button, input')
      const b = t ? t.getBoundingClientRect() : null
      const oben = b ? b.top >= k.top - 0.5 : true
      const unten = b ? b.bottom <= k.bottom + 0.5 : true
      raus.zeilen.push({
        name: n ? n.textContent.trim() : '?',
        art: t ? (t.tagName + (t.type ? ':' + t.type : '')) : 'kein Ziel',
        b: b ? Math.round(b.width) : 0, h: b ? Math.round(b.height) : 0,
        ganz: oben && unten,
        garnicht: b ? (b.bottom <= k.top || b.top >= k.bottom) : true,
      })
    }
    return raus
  })()`)

  const seitePruefen = async (punkt) => {
    ueber(`5. Unterseite „${punkt}" — jede Zeile gemessen`)
    const r = await zumPunkt(punkt)
    if (r !== 'ok') return sag(false, `„${punkt}" liess sich nicht oeffnen`, String(r))
    await bild(`seite-${punkt.replace(/\W+/g, '-')}`)
    const m = await zeilenMessen()
    if (!m) return sag(false, `„${punkt}": keine Karte`)
    for (const z of m.zeilen) {
      const s = Math.min(z.b, z.h)
      sag(z.garnicht || s * MM_JE_PX >= GRIFF_MM - 0.001, `„${z.name}": Ziel mindestens 9 mm`, `${z.art} ${z.b}x${z.h} = ${mm(s)} mm${z.garnicht ? ' (ausserhalb — Rollstellung)' : ''}`)
      sag(z.ganz || z.garnicht, `„${z.name}": der Knopf endet nicht mitten im Kartenrand`, z.ganz ? 'ganz da' : z.garnicht ? 'ganz draussen' : 'ANGESCHNITTEN')
    }
    // ZURUECK AUF DIE UEBERSICHT — ueber den EINEN Rueckweg `#zurueck` und
    // nicht ueber einen Pfeil im Blatt. Es gibt seit dem 03.08.2026 nur diesen
    // einen; ein zweiter Wahlausdruck hier fand am 07.08. gar nichts und liess
    // dieses Werkzeug drei Seiten spaeter ins Leere greifen.
    await ev(`(() => { const z = document.getElementById('zurueck'); if (z) z.click(); return true })()`)
    await warte(800)
    return m
  }

  await stand('voll')
  await stand('sperre-aus')
  await stand('licht-da')
  await laden()
  await hinein()
  const gruppe = await zurGruppe('anzeige')
  sag(gruppe === 'ok', 'die Gruppe „Darstellung" geht auf')

  const uebersicht = await ev(`(() => Array.from(document.querySelectorAll('#fach-zeilen .zeile-name')).map(e => e.textContent.trim()))()`)
  sag(Array.isArray(uebersicht) && uebersicht.length === 4, 'sie traegt VIER Punkte', (uebersicht || []).join(' · '))

  for (const p of ['Indikatoren', 'Farbe und Form', 'Player', 'Verhalten']) await seitePruefen(p)

  /* ══ DIE BEGRUENDUNG DES VIERTEN PUNKTES — NACHGERECHNET ═══════════════════
   *
   * Der vierte Punkt „Player" ist laut Commit-Nachricht GEMESSEN entstanden:
   * „mit Uhrzeit, Restzeit, Titel und Album waeren es sieben Zeilen geworden,
   * und die Karte endet dann MITTEN IM KNOPF der sechsten." Das ist die
   * einzige Begruendung fuer eine ganze neue Unterseite — also wird sie
   * nachgerechnet und nicht geglaubt.
   *
   * OHNE EINE DATEI ANZUFASSEN: Die fuenf Zeilen von „Indikatoren" stehen da;
   * zwei weitere werden im Browser dazugehaengt (dieselbe Bauart, dieselbe
   * Hoehe). Waeren es sieben, saehe die Karte genau so aus. Ein Umbau von
   * app.js waere hier nicht nur unnoetig, sondern gefaehrlich — an dieser
   * Datei arbeitet gerade noch jemand. */
  ueber('5b. Waeren sieben Zeilen wirklich zu viel? (nachgerechnet)')
  await zumPunkt('Indikatoren')
  const sieben = await ev(`(() => {
    const karte = document.getElementById('fach-zeilen'); if (!karte) return null
    const zeilen = [...karte.querySelectorAll('.fach-zeile')]
    if (!zeilen.length) return null
    const vorher = zeilen.length
    for (let i = 0; i < 7 - vorher; i++) karte.appendChild(zeilen[0].cloneNode(true))
    const k = karte.getBoundingClientRect()
    const alle = [...karte.querySelectorAll('.fach-zeile')]
    const stand = alle.map((z, i) => {
      const t = z.querySelector('.zeile-tat, button, input')
      if (!t) return { i, art: 'kein Ziel' }
      const b = t.getBoundingClientRect()
      const sichtbar = Math.max(0, Math.min(b.bottom, k.bottom) - Math.max(b.top, k.top))
      return { i, h: Math.round(b.height), sichtbar: Math.round(sichtbar),
               anteil: b.height > 0 ? Math.round((sichtbar / b.height) * 100) : 0 }
    })
    return { vorher, jetzt: alle.length, karte: Math.round(k.height), stand }
  })()`)
  if (!sieben) sag(false, 'die Zeilen von „Indikatoren" waren nicht zu fassen')
  else {
    sag(sieben.vorher === 5, '„Indikatoren" traegt heute FUENF Zeilen', `${sieben.vorher}`)
    const angeschnitten = sieben.stand.filter((z) => z.anteil > 0 && z.anteil < 100)
    sag(angeschnitten.length > 0, 'bei SIEBEN Zeilen wird wirklich ein Knopf angeschnitten — die Begruendung haelt',
      angeschnitten.map((z) => `Zeile ${z.i + 1}: ${z.sichtbar} von ${z.h} px (${z.anteil} %)`).join(' · ') || 'keiner')
  }
  await ev(`(() => { const z = document.getElementById('zurueck'); if (z) z.click(); return true })()`)
  await warte(800)

  /* ── DIE HELLIGKEIT IN IHREN VIER LAGEN ────────────────────────────────── */
  /* EINE LAGE EINSTELLEN UND DIE SEITE NEU BETRETEN.
     ERST HINAUS, DANN WIEDER HINEIN — und das ist nicht Umstaendlichkeit:
     `helligkeitHolen()` laeuft, wenn die Seite BETRETEN wird. Steht man schon
     darauf, tut ein zweiter Griff nach derselben Zeile gar nichts, und die
     Messung sah dreimal hintereinander dieselbe erste Antwort. Hier stand
     genau das, und drei Lagen gingen rot, obwohl die Oberflaeche in Ordnung
     war. */
  const lichtLage = async (was) => {
    await stand(was)
    // GANZ NEU HINEIN. Ein Klick auf den Rueckweg reichte nicht: je nachdem,
    // auf welcher Ebene die vorige Messung endete, landete er einmal auf der
    // Uebersicht und einmal ganz draussen — und die naechste Lage wurde am
    // falschen Ort gesucht. Neu laden ist langsamer und immer dasselbe.
    await laden()
    await hinein()
    await zurGruppe('anzeige')
    await zumPunkt('Farbe und Form')
    await warte(900)
  }
  const reglerLesen = async () => await ev(`(() => {
    const karte = document.getElementById('fach-zeilen'); if (!karte) return null
    for (const z of karte.querySelectorAll('.fach-zeile')) {
      const n = z.querySelector('.zeile-name')
      if (!n || !n.textContent.includes('Helligkeit')) continue
      const r = z.querySelector('input[type=range]')
      const k = z.querySelector('.zeile-tat, button')
      const u = z.querySelector('.zeile-unter')
      const b = r ? r.getBoundingClientRect() : null
      return {
        regler: !!r, b: b ? Math.round(b.width) : 0, h: b ? Math.round(b.height) : 0,
        wert: r ? Number(r.value) : null, min: r ? Number(r.min) : null, max: r ? Number(r.max) : null,
        schritt: r ? Number(r.step) : null, aus: r ? r.disabled : null,
        knopf: k ? k.textContent.trim() : '', warnt: z.classList.contains('warnt'),
        unter: u ? u.textContent.trim() : '',
      }
    }
    return null
  })()`)

  ueber('3. Helligkeit: der Regler in seinen vier Lagen')
  await lichtLage('licht-da')
  await bild('licht-da')
  let L = await reglerLesen()
  sag(!!L?.regler, 'Regelfall: ein Regler steht da', L?.unter || '—')
  sag(!!L && L.h === 66, 'und er ist 66 px hoch (das volle Griffmass)', L ? `${L.b}x${L.h} = ${mm(Math.min(L.b, L.h))} mm` : '—')
  sag(!!L && mm(Math.min(L.b, L.h)) >= GRIFF_MM, 'die schmalere Seite haelt die 9-mm-Marke', L ? `${mm(Math.min(L.b, L.h))} mm` : '—')
  // DIE GRENZEN KOMMEN AUS DER ANTWORT — nachgerechnet gegen das, was der
  // Server sagt, und nicht gegen eine Zahl in app.js.
  const vomServer = await (await fetch(new URL('/api/schirm/helligkeit', ZIEL))).json()
  sag(!!L && L.min === vomServer.min && L.max === vomServer.max && L.schritt === vomServer.schritt,
    'min/max/schritt stehen so am Regler, wie der Server sie nennt',
    L ? `Regler ${L.min}–${L.max}/${L.schritt} · Server ${vomServer.min}–${vomServer.max}/${vomServer.schritt}` : '—')
  sag(!!L && L.wert === vomServer.prozent, 'und der Stand ist der des Servers', L ? `${L.wert} % / ${vomServer.prozent} %` : '—')

  await lichtLage('licht-weg')
  await bild('licht-weg')
  L = await reglerLesen()
  sag(!!L && L.regler === false, '`da:false`: KEIN Regler', L?.unter?.slice(0, 70) || '—')
  sag(!!L && /Hintergrundlicht/i.test(L.unter), 'sondern der Grund aus der Antwort', L?.unter?.slice(0, 70) || '—')

  await lichtLage('licht-geklemmt')
  await bild('licht-geklemmt')
  L = await reglerLesen()
  sag(!!L?.regler && L.wert === L.min, '`geklemmt`: der Regler steht schon ganz links', L ? `${L.wert} % (min ${L.min})` : '—')
  sag(!!L && L.knopf !== '', 'und daneben steht ein Knopf — sonst kann nichts gesendet werden', L?.knopf || 'KEINER')
  sag(!!L && L.warnt === true, 'die Zeile warnt sichtbar', L?.unter?.slice(0, 70) || '—')

  /* EIN FEHLSCHLAG BEIM SETZEN (`licht-stur`, PUT antwortet 500). Der Bericht
     nennt vier Lagen; das hier ist die fuenfte, und sie ist die einzige, in
     der die Oberflaeche etwas BEHAUPTEN koennte, das nicht stimmt: Bliebe der
     Regler stehen, wo der Finger ihn hingezogen hat, saehe es aus wie
     gesetzt. Der Kommentar in app.js sagt, er springe auf den Stand zurueck,
     den die Box zuletzt gemeldet hat — also wird genau das gemessen. */
  await lichtLage('licht-da')
  const vorFehler = (await reglerLesen())?.wert
  await stand('licht-stur')
  /* KEINE `async`-FUNKTION IN `Runtime.evaluate` OHNE `awaitPromise` — sie gibt
     ein Promise zurueck, das als leeres Objekt herueberkommt. Hier stand genau
     das, und `d.meldung !== ''` war deshalb IMMER wahr (`undefined !== ''`):
     eine gruene Aussage ueber eine Meldung, die niemand gesehen hat. Deshalb
     jetzt zwei Schritte mit einem Warten dazwischen, in node und nicht im
     Browser. */
  await ev(`(() => {
    const r = document.querySelector('#fach-zeilen input[type=range]'); if (!r) return 'kein Regler'
    r.value = String(Number(r.min))
    r.dispatchEvent(new Event('change', { bubbles: true }))
    return 'ok' })()`)
  await warte(2000)
  const meldung = await ev(`(() => {
    // #fach-hinweis ist die Stelle, an der der Admin-Bereich seine Meldung
    // hinschreibt (kopfMalen in app.js). Die vier Namen davor waren geraten
    // und fanden nichts — und die Aussage ging trotzdem gruen durch, weil sie
    // in einer async-Auswertung auf undefined traf. Beides ist jetzt behoben.
    // (KEINE GEGENHAKEN HIER: der Block geht als Zeichenkette an den Browser.)
    for (const w of ['#fach-hinweis', '#eltern-meldung', '.fach-meldung', '.meldung']) {
      const m = document.querySelector(w)
      if (m && (m.textContent || '').trim()) return (m.textContent || '').trim().slice(0, 90)
    }
    return '' })()`)
  const jetztAmRegler = (await reglerLesen())?.wert
  sag(jetztAmRegler === vorFehler, 'nach einem Fehlschlag springt der Regler auf den Stand der Box zurueck',
    `vorher ${vorFehler} %, gezogen auf 20 %, jetzt ${jetztAmRegler} %`)
  sag(meldung !== '', 'und es steht eine Meldung da — der Fehlschlag bleibt nicht stumm', meldung || 'KEINE')
  await stand('licht-da')

  /* ── SETZT ES WIRKLICH ERST BEIM LOSLASSEN? ────────────────────────────── */
  ueber('4. Gezaehlt: wie viele PUTs kostet ein Zug ueber die Bahn?')
  await lichtLage('licht-da')
  await ev(`window.__licht = []`)
  const gezogen = await ev(`(() => {
    const r = document.querySelector('#fach-zeilen input[type=range]'); if (!r) return 'kein Regler'
    // EIN ZUG, NACHGESTELLT: dreissig Zwischenwerte wie ein Finger sie erzeugt.
    // Jeder loest input aus, KEINER change — genau wie am Glas.
    // (KEIN GEGENHAKEN IN DIESEM BLOCK: er geht als Zeichenkette an den
    //  Browser, und einer in einem Kommentar beendet sie mitten im Satz.)
    for (let i = 0; i <= 30; i++) {
      r.value = String(Math.round(Number(r.min) + (Number(r.max) - Number(r.min)) * (i / 30)))
      r.dispatchEvent(new Event('input', { bubbles: true }))
    }
    return 'ok' })()`)
  await warte(500)
  const waehrend = await ev(`window.__licht.filter(s => s.startsWith('PUT')).length`)
  sag(gezogen === 'ok' && waehrend === 0, 'waehrend des Zuges geht KEIN PUT hinaus', `${waehrend} PUT(s) bei 31 Bewegungen`)
  await ev(`(() => { const r = document.querySelector('#fach-zeilen input[type=range]'); r.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  await warte(900)
  const nachher = await ev(`window.__licht.filter(s => s.startsWith('PUT')).length`)
  sag(nachher === 1, 'und beim Loslassen genau EINER', `${nachher}`)

  /* ════════════════════════════════════════════════════════════════════════
   * 5c. TITEL UND ALBUM — TRIFFT DIE REGEL WIRKLICH ALLE DREI ORTE?
   *
   * Behauptet war: „Zwei CSS-Regeln ueber [data-anzeigeort], trifft alle drei
   * Orte." Drei Orte, zwei Regeln — das ist genau die Bauart, die man glauben
   * ODER messen kann. Gemessen wird sie so: beide Schalter aus, dann bei
   * JEDEM Ort nachsehen, ob Titel und Albumzeile verschwunden sind. Ein Ort,
   * der uebersehen wurde, ist der Fehler, den dieses Projekt am 03.08.2026
   * schon einmal hatte ([[drei-orte-eine-anzeige]]).
   * ══════════════════════════════════════════════════════════════════════ */
  ueber('5c. Titel und Album aus — an allen drei Orten?')
  await stand('voll')
  await stand('spotify')
  await darstSetzen({ spielTitel: false, spielAlbum: false })
  await laden()
  await warte(800)
  // Alle drei Orte oeffnen: Kissen steht schon, Player und Cover-Vollbild
  // ueber die Griffe, die es dafuer gibt.
  await ev(`(() => { const a = document.querySelector('.mp-bild'); if (a) a.click(); return true })()`)
  await warte(700)
  await ev(`(() => { const c = document.querySelector('#gross .gross-bild'); if (c) c.click(); return true })()`)
  await warte(700)
  const orte = await ev(`(() => {
    const raus = []
    for (const h of document.querySelectorAll('[data-anzeigeort]')) {
      const sicht = (e) => { if (!e) return 'fehlt'
        const s = getComputedStyle(e); const b = e.getBoundingClientRect()
        return s.display === 'none' ? 'weg' : (b.height > 0 ? 'DA' : 'leer') }
      raus.push({ ort: h.dataset.anzeigeort,
                  titel: sicht(h.querySelector('[data-np=titel]')),
                  album: sicht(h.querySelector('[data-np=unter]')) })
    }
    return raus
  })()`)
  sag(Array.isArray(orte) && orte.length === 3, 'es sind wirklich DREI Orte mit `data-anzeigeort`', (orte || []).map((o) => o.ort).join(' · '))
  for (const o of orte || []) {
    sag(o.titel !== 'DA', `„${o.ort}": der Titel ist weg`, o.titel)
    sag(o.album !== 'DA', `„${o.ort}": das Album ist weg`, o.album)
  }
  await darstSetzen({ spielTitel: true, spielAlbum: true })

  /* ════════════════════════════════════════════════════════════════════════
   * 6. UHRZEIT UND RESTZEIT OBEN IN DER MITTE
   * ══════════════════════════════════════════════════════════════════════ */
  ueber('6. Uhrzeit und Restzeit oben in der Mitte')
  await stand('voll')
  await stand('spotify')
  await darstSetzen({ uhrzeit: true, restzeit: true })
  await laden()
  await warte(900)
  await bild('kopf-mitte')

  const kopf = await ev(`(() => {
    const raus = {}
    for (const w of ['#kopf-uhr', '#kopf-rest', '.kopf-mitte', '#kopf-mitte']) {
      const e = document.querySelector(w); if (!e) continue
      const b = e.getBoundingClientRect(); const s = getComputedStyle(e)
      raus[w] = { b: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.x), y: Math.round(b.y),
                  mitte: Math.round(b.x + b.width / 2), zeiger: s.pointerEvents, text: (e.textContent||'').trim() }
    }
    return raus
  })()`)
  const namen = Object.keys(kopf || {})
  sag(namen.length > 0, 'oben in der Mitte steht etwas', namen.join(' · '))
  /* DIE MITTE IST 444 UND NICHT 400 — und das ist keine Nachsicht, sondern
     die Zahl, die in app.css bei `.kopf-mitte` ausdruecklich steht: die
     Kopfzeile beginnt rechts der 88 px breiten Leiste, zentriert wird also im
     INHALT. 800/2 = 400 waere die Mitte des Glases, ueber der die Leiste
     liegt. Hier stand zuerst 400, und die Messung wurde rot, obwohl die
     Oberflaeche genau das tat, was sie ankuendigt. */
  const SOLL_MITTE = 444
  for (const n of namen) {
    const e = kopf[n]
    if (!e.text) continue
    sag(Math.abs(e.mitte - SOLL_MITTE) <= 3, `${n} steht in der Mitte des Inhalts (${SOLL_MITTE})`, `Mitte ${e.mitte}, „${e.text}"`)
  }
  const traeger = kopf['.kopf-mitte'] || kopf['#kopf-mitte'] || kopf[namen[0]]
  sag(!!traeger && traeger.zeiger === 'none', 'sie nimmt keine Beruehrung weg (`pointer-events: none`)', traeger?.zeiger || '—')

  // UEBERDECKEN SIE EINANDER ODER ETWAS ANDERES, wenn beide an sind?
  const stoert = await ev(`(() => {
    const m = document.querySelector('.kopf-mitte, #kopf-mitte'); if (!m) return 'kein Traeger'
    const b = m.getBoundingClientRect()
    const treffer = []
    for (const e of document.querySelectorAll('.kopf button, .kopf a, #wappen, .kopf-rechts *')) {
      const r = e.getBoundingClientRect()
      if (r.width < 1) continue
      if (r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top)
        treffer.push((e.id || e.className || e.tagName) + ' ' + Math.round(r.x) + ',' + Math.round(r.y))
    }
    return treffer
  })()`)
  sag(Array.isArray(stoert) && stoert.length === 0, 'und sie ueberschneidet nichts, was man antippen kann', (Array.isArray(stoert) ? stoert.join(' · ') : String(stoert)) || 'nichts')
  await darstSetzen({ uhrzeit: false, restzeit: false })

  /* ════════════════════════════════════════════════════════════════════════
   * 7. DIE KINDERZEIT-PASSUNG
   * ══════════════════════════════════════════════════════════════════════ */
  ueber('7. Passt es noch in die Hoerzeit? — kennzeichnen statt verstecken')
  await stand('voll')
  await stand('kz-knapp').catch(() => null)
  await darstSetzen({ kinderzeitPassung: true })
  await laden()
  await warte(600)
  /* NICHT DIE ERSTE KACHEL, SONDERN EINE, DIE AUFKLAPPT — und danach noch eine
     Ebene tiefer. Die Dauerzeile haengt an `.lane-kachel.stueck`, also an der
     TITELLISTE; ein Tipp auf eine gewoehnliche Album-Kachel startet dagegen
     nur die Wiedergabe. Hier stand ein Griff nach `#raster .kachel`, und die
     Messung meldete „ging nicht auf", obwohl sie am falschen Ort suchte. */
  /* DIE ARD-SENDUNG UND NICHT DIE ERSTBESTE KACHEL — und der Umweg ist selbst
     ein Befund. Hier stand ein Griff nach der ersten aufklappbaren Kachel; das
     ist an dieser Vorschau eine SPOTIFY-PLAYLIST, deren Titelliste ueber
     `GET /api/werke/<k>/alben` kommt — und die traegt kein `dauerMs`. Die
     Messung meldete „0 von 10 mit Laenge" und sah damit genau die Luecke, die
     der Bericht selbst nennt, nur an einer Stelle, an der sie wie ein Fehler
     der Oberflaeche aussah.
     Die ARD-Sendung geht ueber `/inhalt`, und dort steht die Laenge. Beides
     wird deshalb gemessen: DASS sie bei /inhalt ankommt (unten), und DASS sie
     bei /alben fehlt (die Aussage darunter haelt die Luecke fest, damit sie
     auffaellt, sobald der Server sie schliesst). */
  const auf = await ev(`(() => {
    const k = [...document.querySelectorAll('#raster .kachel')]
      .find((x) => (x.getAttribute('aria-label') || '').includes('ARD'))
    if (!k) return 'keine ARD-Kachel'
    k.click(); return 'ok' })()`)
  for (let n = 0; n < 24; n++) {
    await warte(250)
    if (await ev(`document.querySelectorAll('.lane-kachel.stueck').length > 0`)) break
  }
  await bild('passung')

  const lane = await ev(`(() => {
    const kacheln = Array.from(document.querySelectorAll('.lane-kachel.stueck'))
    if (!kacheln.length) return null
    return {
      alle: kacheln.length,
      mitDauer: kacheln.filter(k => k.dataset.dauerMs).length,
      rot: kacheln.filter(k => k.classList.contains('passt-nicht')).length,
      versteckt: kacheln.filter(k => { const s = getComputedStyle(k); return s.display === 'none' || s.visibility === 'hidden' }).length,
      zeilen: kacheln.slice(0, 6).map(k => {
        const z = k.querySelector(':scope > .stueck-dauer')
        return { dauer: k.dataset.dauerMs || '', text: z ? z.textContent.trim() : '', rot: k.classList.contains('passt-nicht'),
                 marke: (k.getAttribute('aria-label')||'').includes('passt heute nicht mehr') }
      }),
    }
  })()`)
  if (!lane) sag(false, 'die Titelliste ging nicht auf', String(auf))
  else {
    sag(lane.versteckt === 0, 'KEINE Kachel ist versteckt — es wird gekennzeichnet, nicht weggenommen', `${lane.versteckt} von ${lane.alle}`)
    sag(lane.mitDauer > 0, 'die Laenge steht an den Kacheln, die eine haben', `${lane.mitDauer} von ${lane.alle}`)
    const ohneDauer = lane.zeilen.filter((z) => !z.dauer)
    sag(ohneDauer.every((z) => z.text === ''), 'wo keine Laenge bekannt ist, steht NICHTS statt einer geratenen Zahl', `${ohneDauer.length} ohne Laenge`)
    const roteMitMarke = lane.zeilen.filter((z) => z.rot)
    sag(roteMitMarke.every((z) => z.marke), 'was rot ist, sagt es auch der Vorlesehilfe (`aria-label`)', `${roteMitMarke.length} rot`)
    sag(lane.rot > 0, 'und bei knapper Hoerzeit ist wirklich etwas gekennzeichnet', `${lane.rot} von ${lane.alle} rot`)
  }

  /* ── DIE LUECKE, DIE DER BERICHT SELBST NENNT — HIER FESTGEHALTEN ────────
   * `GET /api/werke/<k>/alben` laesst `dauerMs` weg, obwohl die Spotify-Daten
   * es mitbringen. Die Titelliste einer PLAYLIST bekommt deshalb keine Laenge,
   * die einer ARD-Sendung (ueber `/inhalt`) schon. Das steht hier als MESSUNG
   * und nicht als Satz in einem Bericht: traegt der Server das Feld nach, wird
   * diese Zeile rot — und dann weiss der Naechste, dass die Luecke zu ist und
   * die Anmerkung im Bericht weg kann. */
  ueber('7b. Die Luecke: /alben traegt keine Laenge, /inhalt schon')
  const ausInhalt = await (await fetch(new URL('/api/werke/vorschau%3A13/inhalt', ZIEL))).json()
  const ausAlben = await (await fetch(new URL('/api/werke/vorschau%3A1/alben', ZIEL))).json().catch(() => null)
  const inhaltHat = Array.isArray(ausInhalt?.titel) && ausInhalt.titel.some((t) => Number(t.dauerMs) > 0)
  const stuecke = (ausAlben?.alben || []).flatMap((a) => a.stuecke || [])
  const albenHat = stuecke.some((t) => Number(t.dauerMs) > 0)
  sag(inhaltHat, '/inhalt traegt `dauerMs` — dort greift die Passung', `${(ausInhalt?.titel || []).length} Titel`)
  sag(!albenHat, '/alben traegt es NICHT — die bekannte Luecke besteht noch', `${stuecke.length} Stuecke, keines mit Laenge`)
  await darstSetzen({ kinderzeitPassung: false })
} finally {
  try {
    if (ws) ws.close()
  } catch {
    /* der Browser ist schon weg */
  }
  await browser.schliessen()
  if (vorschau) vorschau.kill()
}

console.log(`\n${fehler === 0 ? 'ALLES GRUEN' : `${fehler} von ${geprueft} Aussagen HALTEN NICHT`}`)
process.exit(fehler === 0 ? 0 : 1)
