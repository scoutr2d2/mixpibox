#!/usr/bin/env node
/**
 * GEGENPROBE ZUM TOR — nicht „steht es da", sondern „komme ich dran".
 *
 * ══ WOZU, WENN ES SCHON eltern-tor-schau.mjs GIBT ══════════════════════════
 * `tools/eltern-tor-schau.mjs` fragt den Baum: ist `#eltern-tor` sichtbar, ist
 * `#eltern-flaeche` versteckt, wie viele `.fach-knopf` stehen darin. Das ist
 * die richtige Frage — aber es ist DIESELBE Frage, aus der die Aenderung
 * gebaut wurde. Ein Werkzeug, das die eigene Annahme nachschlaegt, ist gruen,
 * sobald die Annahme in sich stimmig ist.
 *
 * DIESES WERKZEUG FRAGT ANDERS HERUM, und zwar so, wie ein Kind fragen wuerde:
 *   1. Es geht den echten Weg hinein (800 ms auf dem Zahnrad).
 *   2. Es liest den SICHTBAREN TEXT des ganzen Schirms und sucht darin die
 *      Woerter, die hinter der Sperre liegen — „WLAN", „Bluetooth", „System".
 *      Ein Tor, das steht, waehrend „WLAN" lesbar dasteht, sperrt nichts.
 *   3. Es TIPPT dort hin, wo die Faecher in der Lage „aus" LIEGEN — an
 *      denselben Bildpunkten, gemessen und nicht geraten — und sieht nach, ob
 *      sich etwas ruehrt: ein Wechsel der Adresse, ein neues Fach, ein anderer
 *      Text. Wer nur `hidden` prueft, uebersieht ein Element, das unter dem
 *      Tor liegt und trotzdem getroffen wird.
 *   4. Es fragt `document.elementFromPoint` an denselben Stellen: WAS liegt
 *      dort wirklich obenauf? Das ist die Frage, die kein `hidden`-Merkmal
 *      beantwortet.
 *
 * Und die zweite Haelfte, die genauso wichtig ist: bei ausdruecklichem „aus"
 * muss all das UMGEKEHRT herauskommen. Eine Vorgabe, die eine ausdrueckliche
 * Wahl ueberschreibt, ist ein Fehler und kein Schutz.
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * Nichts an einer Datei. An der Box wird nicht gemessen.
 *
 * ══ VORSCHAU UND DEBUG-PORT ════════════════════════════════════════════════
 * Ohne Adresse startet es seine EIGENE Vorschau auf einem freien Port; der
 * Browser bekommt seinen Debug-Port vom Betriebssystem (`eigenerBrowser`).
 * Eine geliehene Vorschau bedient den Arbeitsbaum DESSEN, DER SIE GESTARTET
 * HAT — als Pruefschritt in einer Wegwerfkopie waere das eine Messung an der
 * falschen Fassung ([[vorschau-wird-geliehen]]).
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *     node tools/tor-gegenprobe.mjs
 *     node tools/tor-gegenprobe.mjs http://127.0.0.1:8612/neu/
 *
 * ENDE 0, wenn jede Aussage haelt.
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { browserSuchen, eigenerBrowser, freierPort } from './leihgabe.mjs'
import { adminAufHalten } from './admin-weg.mjs'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const MITGEGEBEN = argv.find((a) => a.startsWith('http')) || null

const warte = (ms) => new Promise((r) => setTimeout(r, ms))
const befunde = []
const ja = (gut, wort, dazu = '') => {
  befunde.push({ gut, wort })
  console.log(`${gut ? 'ok  ' : 'NEIN'}  ${wort}${dazu ? `  — ${dazu}` : ''}`)
}

/* ══ DIE WOERTER, DIE ES NUR HINTER DER SPERRE GIBT ═══════════════════════
 *
 * HIER STAND `['WLAN', 'Bluetooth', 'Anzeige', 'System']` — die vier Faecher
 * der flachen Spalte. Seit dem 06.08.2026 traegt die Spalte VIER GRUPPEN
 * (Verbindung, Medien, Darstellung, System), und WLAN und Bluetooth sind
 * Zeilen in der Uebersicht der ersten. „Anzeige" heisst „Darstellung".
 *
 * WAS DIE LISTE LEISTEN MUSS, ist unveraendert und wird nicht abgeschwaecht:
 * Jedes Wort darin muss nach dem geloesten Tor LESBAR dastehen und davor
 * NIRGENDS. Deshalb stehen hier fuenf und nicht vier — die Spaltenwoerter
 * allein saehen auch dann vollstaendig aus, wenn die Karte daneben leer
 * bliebe. „WLAN" und „Bluetooth" beweisen, dass auch der INHALT da ist.
 *
 * „MEDIEN" STEHT MIT ABSICHT NICHT DARIN: Das Wort kommt auch ausserhalb des
 * Bereichs vor (Meldungen der Mediathek), und ein Wort, das davor schon
 * dasteht, kann nichts ueber die Sperre aussagen. */
const HINTER_DER_SPERRE = ['Verbindung', 'Darstellung', 'System', 'WLAN', 'Bluetooth']

/**
 * DIE LAGEN. `fehlt` ist die des Betreibers, `aus` ist die Gegenprobe.
 * `quatsch` steht dabei, weil ein unbekanntes Wort in einer von Hand
 * bearbeiteten Datei haeufiger ist als ein leeres Feld.
 */
const LAGEN = [
  { stand: 'sperre-fehlt', wort: 'der Schluessel FEHLT ganz (Box .169)', zu: true },
  { stand: 'sperre-leer', wort: 'der Schluessel steht da, aber leer', zu: true },
  { stand: 'sperre-quatsch', wort: 'ein Wort, das es nicht gibt', zu: true },
  { stand: 'sperre-aus', wort: 'ausdruecklich „aus"', zu: false },
]

if (!browserSuchen()) {
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}

let vorschau = null
let chrome = null
let ZIEL = MITGEGEBEN
let lageVorher = null

// Ein `spawn`-Kind haelt Nodes Ereignisschleife am Leben. Beide Riegel, weil
// jeder allein einen Weg offen laesst (siehe eltern-tor-schau.mjs).
process.on('exit', () => {
  try {
    vorschau?.kill()
  } catch {
    /* schon weg */
  }
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

try {
  if (!ZIEL) {
    const p = await freierPort()
    ZIEL = `http://127.0.0.1:${p}/neu/`
    vorschau = spawn(process.execPath, ['tools/neu-vorschau.mjs', '--port', String(p)], {
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
      if (gestorben !== null) throw new Error(`neu-vorschau endete sofort (${gestorben})`)
      try {
        await fetch(`http://127.0.0.1:${p}/api/werke`)
        break
      } catch {
        if (Date.now() > bis) throw new Error('neu-vorschau kam nicht hoch')
        await warte(150)
      }
    }
  } else {
    try {
      const a = await fetch(new URL('/vorschau/lage', ZIEL), { signal: AbortSignal.timeout(1500) })
      lageVorher = await a.json()
    } catch {
      console.warn(`  ACHTUNG  ${ZIEL} sagt seine Lage nicht — nichts zurueckzulegen.`)
    }
  }

  chrome = await eigenerBrowser()
  if (!chrome) throw new Error('kein Browser erreichbar')
  const ws = new WebSocket(await chrome.seite(), { perMessageDeflate: false })
  await new Promise((r) => ws.once('open', r))
  await send(ws, 'Page.enable')
  await send(ws, 'Runtime.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 800,
    height: 480,
    deviceScaleFactor: 1,
    mobile: false,
  })

  const ev = async (js) => {
    const r = await send(ws, 'Runtime.evaluate', {
      expression: js,
      returnByValue: true,
      awaitPromise: true,
    })
    if (r.exceptionDetails)
      throw new Error(r.exceptionDetails.exception?.description || 'Fehler in der Seite')
    return r.result.value
  }
  const stand = (w) => fetch(new URL(`/vorschau/${w}`, ZIEL))
  const neuLaden = async () => {
    await send(ws, 'Page.navigate', { url: ZIEL })
    await warte(1500)
  }
  const tippen = async (x, y, halteMs = 40) => {
    const g = { x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, pointerType: 'touch' }
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...g })
    await warte(halteMs)
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...g })
    await warte(120)
  }
  /** Der echte Weg hinein — nicht `eltern.auf()`, sondern der Finger. */
  const hinein = async () => {
    // BIS ZUM 06.08.2026 FUEHRTE DAS ZAHNRAD `#einst-knopf` HINEIN, 800 ms
    // gehalten. Es ist ersatzlos entfallen; hinein fuehrt der Schriftzug
    // `#wappen`, WAPPEN_HALTEN_MS = 1200 ms gehalten. Dieses Werkzeug hat eine
    // echte Druckfunktion und geht deshalb den ECHTEN Weg, nicht den
    // Tastaturweg (tools/admin-weg.mjs).
    await adminAufHalten(ev, tippen, { warteMs: 900 })
  }
  /** Sichtbarer Text des ganzen Schirms — was ein Mensch LESEN kann. */
  const sichtbarerText = () =>
    ev(`(() => {
      const raus = []
      const geh = (e) => {
        if (e.nodeType === 3) { raus.push(e.nodeValue); return }
        if (e.nodeType !== 1) return
        if (e.hidden) return
        const s = getComputedStyle(e)
        if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return
        const b = e.getBoundingClientRect()
        if (b.width === 0 || b.height === 0) return
        for (const k of e.childNodes) geh(k)
      }
      geh(document.body)
      return raus.join(' ').replace(/\\s+/g, ' ').trim()
    })()`)

  // ── ERST DIE LAGE „aus" VERMESSEN: WO LIEGEN DIE FAECHER WIRKLICH? ───────
  // Die Bildpunkte werden GEMESSEN und nicht abgeschrieben; danach wird an
  // genau diese Stellen getippt, waehrend das Tor steht.
  await stand('sperre-aus')
  await neuLaden()
  await hinein()
  const fachOrte = await ev(`(() => Array.from(document.querySelectorAll('.fach-knopf')).map((e) => {
      const b = e.getBoundingClientRect()
      return { wort: (e.textContent||'').trim(), x: Math.round(b.left+b.width/2), y: Math.round(b.top+b.height/2) }
    }))()`)
  ja(fachOrte.length >= 4, 'die Faecher sind bei „aus" wirklich da und vermessen',
    fachOrte.map((f) => `${f.wort} @${f.x},${f.y}`).join(' · '))
  const textAus = await sichtbarerText()
  const fehlendAus = HINTER_DER_SPERRE.filter((w) => !textAus.includes(w))
  ja(fehlendAus.length === 0, 'bei „aus" stehen alle fuenf Woerter LESBAR da',
    fehlendAus.length ? `es fehlen: ${fehlendAus.join(', ')}` : HINTER_DER_SPERRE.join(', '))

  // ── UND JETZT JEDE LAGE ──────────────────────────────────────────────────
  for (const L of LAGEN) {
    console.log(`\n── ${L.stand} — ${L.wort} ──`)
    await stand(L.stand)
    await neuLaden()
    await hinein()

    // 1. WAS IST LESBAR?
    const txt = await sichtbarerText()
    const lesbar = HINTER_DER_SPERRE.filter((w) => txt.includes(w))
    if (L.zu)
      ja(lesbar.length === 0, 'kein Wort von hinter der Sperre ist LESBAR',
        lesbar.length ? `lesbar: ${lesbar.join(', ')}` : 'keins von ' + HINTER_DER_SPERRE.join('/'))
    else
      ja(lesbar.length === HINTER_DER_SPERRE.length, 'alle Woerter sind lesbar — „aus" bleibt aus',
        `lesbar: ${lesbar.join(', ')}`)

    // 2. WAS LIEGT AN DEN FACH-STELLEN OBENAUF?
    // `elementFromPoint` gibt das INNERSTE Element zurueck — an einem Fach ist
    // das der `span` mit der Beschriftung, nicht der Knopf. Gefragt ist aber,
    // ob der Punkt ZUM Knopf gehoert; deshalb `closest`. Ohne diese Zeile
    // meldete die Gegenprobe die Bluetooth-Zeile als „kein Fach", obwohl der
    // Knopf gut sichtbar dalag — ein rotes Ergebnis aus dem falschen Grund.
    const obenauf = await ev(`(() => (${JSON.stringify(fachOrte)}).map((f) => {
        const e = document.elementFromPoint(f.x, f.y)
        const k = e && e.closest ? e.closest('.fach-knopf') : null
        return {
          wort: f.wort,
          fach: !!k,
          dort: e ? (e.id ? '#'+e.id : (k ? 'fach-knopf' : (e.className || e.tagName))) : '(nichts)',
        }
      }))()`)
    const traegtFach = obenauf.filter((o) => o.fach)
    if (L.zu)
      ja(traegtFach.length === 0, 'an keiner Fach-Stelle liegt ein Fach obenauf',
        obenauf.map((o) => `${o.wort}->${o.dort}`).join(' · '))
    else
      ja(traegtFach.length === fachOrte.length, 'bei „aus" liegt an jeder Stelle das Fach obenauf',
        obenauf.map((o) => `${o.wort}->${o.dort}`).join(' · '))

    // 3. TIPPEN, WO DIE FAECHER LAEGEN — ruehrt sich etwas?
    const vorher = { url: await ev('location.pathname + location.search'), txt }
    for (const f of fachOrte) await tippen(f.x, f.y)
    await warte(500)
    const nachher = { url: await ev('location.pathname + location.search'), txt: await sichtbarerText() }
    if (L.zu) {
      ja(vorher.url === nachher.url, 'vier Tipper auf die Fach-Stellen wechseln die Adresse NICHT',
        `${vorher.url} -> ${nachher.url}`)
      const jetztLesbar = HINTER_DER_SPERRE.filter((w) => nachher.txt.includes(w))
      ja(jetztLesbar.length === 0, 'und sie machen nichts von hinter der Sperre lesbar',
        jetztLesbar.length ? `lesbar geworden: ${jetztLesbar.join(', ')}` : 'nichts')
      // 4. UND DAS TOR STEHT DANACH IMMER NOCH.
      const nochZu = await ev(`(() => {
        const t = document.getElementById('eltern-tor'); const f = document.getElementById('eltern-flaeche')
        const s = (e) => { if (!e || e.hidden) return false; const b = e.getBoundingClientRect(); return b.width>0 && b.height>0 }
        return s(t) && !s(f) })()`)
      ja(nochZu, 'das Tor steht nach den vier Tippern immer noch')
    }
  }

  // ── DER KURZE TIPP AUF DEN EINSTIEG ──────────────────────────────────────
  //
  // DIE FRAGE, DIE KEIN ANDERES WERKZEUG STELLT. Alle Messungen am Tor gehen
  // den LANGEN Weg hinein und messen dann, wie fest zu ist. Bis zum
  // 06.08.2026 trug derselbe Knopf — das Zahnrad `#einst-knopf` — aber ZWEI
  // Gesten, und die andere war die EINFACHERE: ein kurzer Tipp. Der Satz
  // lautete „ein kurzer Tipp aufs Zahnrad verlaesst die Oberflaeche NICHT",
  // und er stellte die Frage: fuehrt der bequemere Griff daneben ohne Frage in
  // die alte Oberflaeche, dann ist die ganze Sperre eine Verzierung. Der
  // Waechter der alten App hilft dort nicht: sein `alsModus`
  // (src/frontend-box/.../sperrlogik.ts) bildet einen FEHLENDEN Schluessel auf
  // „aus" ab — genau die Lage der Box .169.
  //
  // DAS ZAHNRAD IST ERSATZLOS ENTFALLEN, und der Einstieg `#wappen` traegt
  // genau EINE Geste. DIE FRAGE BLEIBT TROTZDEM ZU STELLEN, und zwar
  // schaerfer: Ein kurzer Tipp darf die Oberflaeche nicht verlassen — und er
  // darf auch den Bereich nicht aufmachen. Eine Geste, die aus Versehen
  // gelingt, waere dieselbe Verzierung.
  console.log('\n── der KURZE Tipp auf den Einstieg, waehrend das Tor steht ──')
  for (const w of ['sperre-fehlt', 'sperre-rechnen']) {
    await stand(w)
    await neuLaden()
    const einstieg = await ev(`(() => { const e = document.getElementById('wappen'); if (!e) return null
      const b = e.getBoundingClientRect()
      return { x: Math.round(b.left+b.width/2), y: Math.round(b.top+b.height/2) } })()`)
    if (!einstieg) throw new Error('#wappen nicht im Baum — siehe tools/admin-weg.mjs')
    const vorher = await ev('location.pathname')
    await tippen(einstieg.x, einstieg.y, 60)
    await warte(1200)
    const nachher = await ev('location.pathname')
    const bereichAuf = await ev(`(() => { const e = document.getElementById('eltern')
      const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 })()`)
    ja(vorher === nachher && !bereichAuf,
      `${w}: ein kurzer Tipp auf den Einstieg tut GAR NICHTS`,
      `${vorher} -> ${nachher}, Bereich ${bereichAuf ? 'GING AUF' : 'bleibt zu'}`)
    if (vorher !== nachher || bereichAuf) await neuLaden()
  }
  // Dasselbe fuer das Bluetooth-Zeichen, sobald es dasteht: `/bluetooth` ist
  // eine der fuenf gesperrten Routen der alten App.
  await stand('sperre-fehlt')
  await stand('bt-verbunden')
  await neuLaden()
  const btOrt = await ev(`(() => { const e = document.getElementById('bt-knopf')
    if (!e || e.hidden) return null
    const b = e.getBoundingClientRect(); if (!b.width) return null
    return { x: Math.round(b.left+b.width/2), y: Math.round(b.top+b.height/2) } })()`)
  if (btOrt) {
    const vorher = await ev('location.pathname')
    await tippen(btOrt.x, btOrt.y, 60)
    await warte(1200)
    const nachher = await ev('location.pathname')
    ja(vorher === nachher, 'ein Tipp aufs Bluetooth-Zeichen verlaesst die Oberflaeche NICHT',
      `${vorher} -> ${nachher}`)
  } else {
    console.log('  (das Bluetooth-Zeichen steht in dieser Lage nicht da — nichts zu messen)')
  }

  // ── DIE GESTE: OEFFNET SIE, UND OEFFNET NUR SIE? ─────────────────────────
  console.log('\n── sperre-geste — die Geste selbst ──')
  await stand('sperre-geste')
  await neuLaden()
  await hinein()
  const flaeche = await ev(`(() => { const b = document.getElementById('eltern-tor').getBoundingClientRect()
    return { x: b.left, y: b.top, b: b.width, h: b.height } })()`)
  const ecke = (i) => {
    const r = 40
    const links = flaeche.x + r
    const rechts = flaeche.x + flaeche.b - r
    const oben = flaeche.y + r
    const unten = flaeche.y + flaeche.h - r
    return [
      { x: links, y: oben },
      { x: rechts, y: oben },
      { x: rechts, y: unten },
      { x: links, y: unten },
    ][i]
  }
  // Zuerst: die MITTE viermal — das ist, was Herumtippen tut.
  for (let i = 0; i < 8; i++) await tippen(flaeche.x + flaeche.b / 2, flaeche.y + flaeche.h / 2)
  let txtM = await sichtbarerText()
  ja(HINTER_DER_SPERRE.every((w) => !txtM.includes(w)), 'achtmal in die Mitte oeffnet nichts')
  // Dann die richtige Folge.
  for (let i = 0; i < 4; i++) await tippen(ecke(i).x, ecke(i).y)
  await warte(600)
  const txtG = await sichtbarerText()
  const nachGeste = HINTER_DER_SPERRE.filter((w) => txtG.includes(w))
  ja(nachGeste.length === HINTER_DER_SPERRE.length, 'die vier Ecken im Uhrzeigersinn OEFFNEN wirklich',
    `lesbar: ${nachGeste.join(', ')}`)

  if (lageVorher?.sperre) await stand(`sperre-${lageVorher.sperre}`)
} finally {
  try {
    await chrome?.schliessen?.()
  } catch {
    /* egal */
  }
  try {
    vorschau?.kill()
  } catch {
    /* egal */
  }
}

const schlecht = befunde.filter((b) => !b.gut).length
console.log(
  schlecht
    ? `\n${schlecht} von ${befunde.length} Aussagen halten NICHT.`
    : `\nAlle ${befunde.length} Aussagen halten.`,
)
process.exit(schlecht ? 1 : 0)
