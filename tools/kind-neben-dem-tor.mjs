#!/usr/bin/env node
/**
 * DAS KIND NEBEN DEM TOR — was die neue FORM aufgemacht hat.
 *
 * ══ WOZU, UND WIESO NICHT kind-am-tor.mjs ODER tor-bei-offener-leiste.mjs ══
 * `kind-am-tor.mjs` fragt: wie teuer ist es, das Tor zu LOESEN, ohne die
 * Loesung zu kennen? Es fasst dabei nur das Tor an. Das war richtig, solange
 * `#eltern` ein DECKEL war — ausser dem einen Rueckweg gab es nichts zu
 * fassen.
 *
 * `tor-bei-offener-leiste.mjs` hat die Formen B, C und D als `<style>`
 * VORAB gemessen, um die Entscheidung vorzubereiten. Seine Grundlinie ist
 * „heute = Deckel". Diese Grundlinie ist seit dem 06.08.2026 falsch: die Form
 * ist gebaut, `#eltern` liegt bei `left: 88px` und das Kissen faehrt ein.
 *
 * DIESE DATEI MISST DEN GEBAUTEN STAND, ohne eine einzige Probe-Regel. Sie
 * stellt die Frage, die erst mit der Form entsteht: Ein Kind steht vor dem
 * Tor, und RECHTS UND UNTEN DAVON steht Oberflaeche, die es bedienen darf.
 * Kommt es darueber an der Bremse vorbei?
 *
 * ══ DIE ZWEI WEGE, DIE HIER GEFAHREN WERDEN ════════════════════════════════
 *
 * 1. DER UMWEG UEBER DEN PROFILWECHSEL — die Bremse per Neuladen loeschen.
 *
 *    `torBremse` und `gesteBremse` sind Objekte im Modul (app.js). Sie
 *    ueberleben `eltern.zu()` — das ist gebaut, begruendet und gemessen. Ein
 *    NEULADEN ueberleben sie nicht, und `werWaehlen` endet in
 *    `window.location.reload()`.
 *
 *    `eltern.auf()` setzt `#ich` deshalb auf `disabled`, und die Begruendung
 *    in app.css (`.eltern`, z-index) fuehrt genau diesen Weg als erledigt an:
 *    „ein Profilwechsel ruft `location.reload()`, und das Neuladen loescht die
 *    Bremse des Tors — drei Beruehrungen statt der Wartezeit".
 *
 *    DAS SCHLIESST ABER NUR DIE LAGE „BEREICH OFFEN". `eltern.zu()` setzt
 *    `#ich` wieder frei, und die Bremse laeuft ausdruecklich WEITER. Gefahren
 *    wird deshalb der Weg, der ums Verbot herumgeht:
 *        Fehlversuch -> Bremse steht -> Rueckweg -> „wer hoert" -> Profil
 *        -> Neuladen -> Zahnrad halten -> steht die Bremse noch?
 *    Gezaehlt werden die BERUEHRUNGEN. Eine Bremse, die fuer eine feste,
 *    kleine Zahl Beruehrungen zu haben ist, ist keine Bremse, sondern eine
 *    Wartezeit fuer Geduldige.
 *
 * 2. DAS LAUTSTAERKE-FENSTER UEBER DEM STEHENDEN TOR.
 *
 *    `#mp-laut-fenster` steht im Baum INNERHALB von `#mp` (index.html). In
 *    `body.eltern-offen` hebt app.css `.mp` auf z-index 9 — damit die vier
 *    Knoepfe ueber dem undurchsichtigen Bereich liegen und keine Attrappe
 *    sind. Ein Kind steht damit vor einem Knopf, der ein 704 px breites
 *    Fenster aufmacht, waehrend das Tor steht.
 *
 *    GEFRAGT WIRD DREIERLEI, und keine der drei Fragen stellt
 *    `tor-bei-offener-leiste.mjs`: Geht es auf? Liegt es UEBER dem Tor und
 *    verdeckt es dessen Tasten? Und laesst sich der Regler bedienen — er
 *    schickt `setvolume:N` an den Abspieldienst (app.js, `laut.geschoben`).
 *    Jenes Werkzeug hat den Knopf angetippt und „nichts aendert sich"
 *    gemeldet — es sah auf Bereich, Kategorie, Raster und Adresse, und das
 *    Fenster ist keines davon ([[attrappe-luegt-durch-weglassen]]).
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * Nichts an einer Datei des Baums, keine Probe-Regel, kein Stil. An der Box
 * wird nicht gemessen und nichts ausgeliefert.
 *
 * ══ VORSCHAU UND BROWSER ═══════════════════════════════════════════════════
 * Ohne Adresse startet dieses Werkzeug seine EIGENE Vorschau (Vorgabe 8714)
 * und beendet sie am Ende — eine geliehene Vorschau bedient den Arbeitsbaum
 * dessen, der sie gestartet hat ([[vorschau-wird-geliehen]]).
 * EINEN `--debug-port` GIBT ES NICHT: der Browser kommt aus `eigenerBrowser()`
 * und bekommt seinen Port vom Betriebssystem. Eine Zahl, die man von Hand
 * waehlen kann, ist eine Zahl, die man doppelt waehlen kann — in der Nacht zum
 * 06.08.2026 hat genau das ein FREMDES Browserfenster ferngesteuert und dessen
 * Lage als Messung gemeldet.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *     node tools/kind-neben-dem-tor.mjs
 *     node tools/kind-neben-dem-tor.mjs --port 8714
 *     node tools/kind-neben-dem-tor.mjs http://127.0.0.1:8712/neu/
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
const PORT = Number(opt('port', 8714))

const MM_JE_PIXEL = 0.14
const mmS = (px) => (px * MM_JE_PIXEL).toFixed(2)
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

const befunde = []
const ja = (gut, wort, dazu = '') => {
  befunde.push({ gut, wort, dazu })
  console.log(`${gut ? 'ok  ' : 'NEIN'}  ${wort}${dazu ? `  — ${dazu}` : ''}`)
}
const zeile = (s = '') => console.log(s)

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

/** Die Lage, wie sie am Schirm steht — nichts davon aus dem Gedaechtnis. */
const LAGE_JS = String.raw`
(() => {
  const e = document.getElementById('eltern')
  const tor = document.getElementById('eltern-tor')
  const fl = document.getElementById('eltern-flaeche')
  const k = e ? e.getBoundingClientRect() : null
  return {
    bereichDa: !!e && !e.hidden,
    torDa: !!tor && !tor.hidden,
    flaecheDa: !!fl && !fl.hidden,
    faecher: document.querySelectorAll('#eltern-faecher .fach-knopf').length,
    meldung: (document.getElementById('tor-meldung') || {}).textContent || '',
    frage: (document.getElementById('tor-frage') || {}).textContent || '',
    ichAus: !!(document.getElementById('ich') || {}).disabled,
    ichFensterDa: !!(document.getElementById('ich-fenster') && !document.getElementById('ich-fenster').hidden),
    elternKasten: k ? { x: Math.round(k.x), y: Math.round(k.y), b: Math.round(k.width), h: Math.round(k.height) } : null,
  }
})()`

/**
 * WAS AN EINER STELLE WIRKLICH LIEGT — `elementFromPoint`, nicht der Baum.
 * „steht da" und „ist zu treffen" sind zwei verschiedene Aussagen.
 */
const obenAn = (x, y) => String.raw`
(() => {
  const e = document.elementFromPoint(${x}, ${y})
  if (!e) return null
  const n = e.closest('button, input, [role="button"]') || e
  return {
    marke: n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/).join('.') : ''),
    text: (n.getAttribute('aria-label') || n.textContent || '').trim().slice(0, 40),
  }
})()`

try {
  const chrome = await eigenerBrowser(ZIEL)
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
  const lage = () => ev(LAGE_JS)

  /**
   * EIN ECHTER TIPP AUF EINEN PUNKT — nicht `element.click()`.
   * `click()` loest auch dann aus, wenn eine fremde Ebene darauf liegt; ein
   * Kind tippt auf eine STELLE, und was dort obenauf liegt, bekommt den Tipp.
   * JEDER Aufruf zaehlt als EINE Beruehrung — daher der Zaehler.
   */
  let beruehrungen = 0
  const tippen = async (x, y) => {
    beruehrungen += 1
    for (const [typ, art] of [
      ['mousePressed', 1],
      ['mouseReleased', 1],
    ]) {
      await send(ws, 'Input.dispatchMouseEvent', { type: typ, x, y, button: 'left', buttons: art, clickCount: 1 })
    }
    await warte(400)
  }
  /** Der Einstieg ist ein LANGES HALTEN, kein Klick (700 ms in app.js). */
  const langHalten = async (ms = 900) => {
    beruehrungen += 1
    // HIER STAND EIN GRIFF ANS ZAHNRAD `#einst-knopf`. Es ist am 06.08.2026
    // ersatzlos entfallen; hinein fuehrt der Schriftzug `#wappen`. Dieser Weg
    // ist der TASTATURWEG und prueft das Halten NICHT — tools/admin-weg.mjs.
    await adminAuf(ev, { warteMs: 900 })
  }
  /** Die Mitte eines Elements — damit getippt wird, wo ein Finger hinginge. */
  const mitte = async (wahl) =>
    ev(`(() => { const e = document.querySelector(${JSON.stringify(wahl)})
      if (!e) return null
      const r = e.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) return null
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2),
               x0: Math.round(r.x), y0: Math.round(r.y), b: Math.round(r.width), h: Math.round(r.height) } })()`)
  /** Eine Tor-Taste ueber ihre Aufschrift finden und antippen. */
  const torTaste = async (auf) => {
    const p = await ev(`(() => {
      const t = [...document.querySelectorAll('#tor-feld .tor-taste')].find((x) => x.textContent.trim() === ${JSON.stringify(auf)})
      if (!t) return null
      const r = t.getBoundingClientRect()
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } })()`)
    if (!p) throw new Error(`Tor-Taste „${auf}" nicht gefunden`)
    await tippen(p.x, p.y)
  }
  /** Ein Fehlversuch, der sicher falsch ist: die Aufgabe lesen und danebenliegen. */
  const fehlversuch = async () => {
    const falsch = await ev(`(() => {
      const f = document.getElementById('tor-frage').textContent || ''
      const m = f.match(/(\d+)\s*[x×*]\s*(\d+)/)
      if (!m) return '11'
      const r = Number(m[1]) * Number(m[2])
      return String(r === 11 ? 12 : 11) })()`)
    for (const z of String(falsch)) await torTaste(z)
    await torTaste('Weiter')
    await warte(500)
  }
  /** Wie viele Sekunden die Bremse laut SCHIRM noch steht (0 = sie steht nicht). */
  const restS = async () => {
    const t = (await lage()).meldung || ''
    const m = t.match(/Noch (\d+) Sekunde/)
    return m ? Number(m[1]) : 0
  }
  /**
   * DIE BREMSE HOCHTREIBEN — auf die dritte Stufe (TOR_WARTEN_S = 0,5,15,30,60).
   *
   * WARUM NICHT EIN EINZIGER FEHLVERSUCH GENUEGT: Der erste kostet 5 Sekunden.
   * Der Umweg selbst (Rueckweg, „wer hoert", Profil, Neuladen) dauert laenger
   * als das — die Bremse waere von SELBST abgelaufen, und die Messung haette
   * „weg" gemeldet, ohne dass das Neuladen etwas damit zu tun hat. Genau so
   * ist der erste Anlauf dieses Werkzeugs falsch gruen geworden.
   * Mit 30 Sekunden ist der Abstand zwischen „abgelaufen" und „geloescht"
   * groesser als der ganze Umweg, und die Aussage traegt.
   */
  const bremseHochtreiben = async (stufen = 3) => {
    for (let i = 0; i < stufen; i++) {
      for (;;) {
        const r = await restS()
        if (!r) break
        await warte((r + 1) * 1000)
      }
      await fehlversuch()
    }
    return restS()
  }

  await stand('name-mitbox')
  await stand('profil-liam') // drei Profile — sonst gibt es gar keinen Wechsel
  await stand('figuren-da')

  // ════════════════════════════════════════════════════════════════════════
  // 1. DER UMWEG UEBER DEN PROFILWECHSEL
  // ════════════════════════════════════════════════════════════════════════
  zeile('══ 1. DER UMWEG UEBER DEN PROFILWECHSEL ═════════════════════════════')
  await stand('voll')
  await stand('sperre-rechnen')
  await neuLaden()
  await langHalten()
  let l = await lage()
  ja(l.torDa, 'das Tor steht (Rechenaufgabe)', l.frage)
  ja(l.ichAus, 'bei OFFENEM Bereich ist „wer hoert" stillgelegt', `#ich disabled = ${l.ichAus}`)

  const stand3 = await bremseHochtreiben(3)
  ja(stand3 >= 20, 'drei Fehlversuche stellen die Bremse auf die dritte Stufe', `noch ${stand3} s`)

  // Der Rueckweg — die Bremse soll das ueberleben, und das ist gebaut.
  const zur = await mitte('#zurueck')
  await tippen(zur.x, zur.y)
  l = await lage()
  ja(!l.bereichDa, 'der Rueckweg fuehrt bei stehendem Tor hinaus', `Bereich da = ${l.bereichDa}`)
  ja(!l.ichAus, 'nach dem Verlassen ist „wer hoert" WIEDER frei', `#ich disabled = ${l.ichAus}`)

  // Gegenprobe OHNE Neuladen: die Bremse muss stehen.
  await langHalten()
  const nochRest = await restS()
  ja(nochRest > 0, 'die Bremse ueberlebt „hinaus und wieder herein"', `noch ${nochRest} s`)
  const zur2 = await mitte('#zurueck')
  await tippen(zur2.x, zur2.y)

  // Und jetzt der Umweg: „wer hoert" -> anderes Profil -> Neuladen.
  const vorUmweg = beruehrungen
  const ich = await mitte('#ich')
  ja(!!ich, 'das Zeichen „wer hoert" ist ausserhalb des Bereichs zu fassen', ich ? `${ich.b}x${ich.h} px` : 'nicht da')
  await tippen(ich.x, ich.y)
  l = await lage()
  ja(l.ichFensterDa, 'die Profilauswahl geht auf', `Fenster da = ${l.ichFensterDa}`)

  /*
   * DIE KACHELN DER PROFILE SIND `.ich-kachel` IN `#ich-leute` — `.leute-kachel`
   * ist die Kachel eines INTERPRETEN und steht ganz woanders. Der erste Anlauf
   * dieses Werkzeugs griff die falsche Klasse, fand nichts, wechselte kein
   * Profil und meldete die Bremse trotzdem als „weg" (sie war abgelaufen).
   * Deshalb steht unten eine Aussage darueber, dass wirklich gewechselt wurde.
   */
  const fremd = await ev(`(() => {
    const k = [...document.querySelectorAll('#ich-leute .ich-kachel')]
    const a = k.find((x) => x.getAttribute('aria-pressed') !== 'true')
    if (!a) return null
    const r = a.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2),
             wort: (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 30) } })()`)
  ja(!!fremd, 'ein FREMDES Profil steht zur Wahl', fremd ? fremd.wort : 'keins')
  const vorherAdresse = await ev('String(location.search)')
  if (fremd) {
    await tippen(fremd.x, fremd.y)
    await warte(3000) // der Wechsel endet in location.reload()
  }
  const umwegKosten = beruehrungen - vorUmweg
  // WURDE WIRKLICH NEU GELADEN? Ohne diese Frage misst der Rest nichts.
  const frischGeladen = await ev('performance.now() < 8000')
  ja(frischGeladen, 'der Profilwechsel hat die Seite wirklich neu geladen', `Seitenalter unter 8 s = ${frischGeladen}`)

  await langHalten()
  const restNachUmweg = await restS()
  ja(
    restNachUmweg > 0,
    'die Bremse ueberlebt den Profilwechsel (Neuladen)',
    restNachUmweg
      ? `noch ${restNachUmweg} s`
      : `sie ist WEG (vorher standen ${stand3} s) — Preis: ${umwegKosten} Beruehrungen`,
  )
  l = await lage()
  ja(l.torDa, 'nach dem Umweg steht das Tor selbst wieder', `Tor da = ${l.torDa}, Faecher = ${l.faecher}`)
  void vorherAdresse

  // ════════════════════════════════════════════════════════════════════════
  // 2. DAS LAUTSTAERKE-FENSTER UEBER DEM STEHENDEN TOR
  // ════════════════════════════════════════════════════════════════════════
  zeile()
  zeile('══ 2. DAS LAUTSTAERKE-FENSTER UEBER DEM STEHENDEN TOR ═══════════════')
  await stand('voll')
  await stand('sperre-pin')
  await neuLaden()
  await langHalten()
  l = await lage()
  ja(l.torDa, 'das Tor steht (PIN)', l.frage)

  const lautKnopf = await mitte('#mp-laut')
  ja(!!lautKnopf, 'der Lautstaerke-Knopf ist bei stehendem Tor zu fassen', lautKnopf ? `${lautKnopf.b}x${lautKnopf.h} px` : 'nicht da')
  const daraufVorher = lautKnopf ? await ev(obenAn(lautKnopf.x, lautKnopf.y)) : null
  ja(
    !!daraufVorher && /mp-laut/.test(daraufVorher.marke),
    'an seiner Stelle liegt er auch wirklich obenauf (kein Deckel darueber)',
    daraufVorher ? daraufVorher.marke : '—',
  )

  if (lautKnopf) await tippen(lautKnopf.x, lautKnopf.y)
  const fenster = await ev(`(() => {
    const f = document.getElementById('mp-laut-fenster')
    if (!f || f.hidden) return { auf: false }
    const r = f.getBoundingClientRect()
    return { auf: true, x: Math.round(r.x), y: Math.round(r.y), b: Math.round(r.width), h: Math.round(r.height),
             z: getComputedStyle(f).zIndex, zMp: getComputedStyle(document.getElementById('mp')).zIndex,
             zEltern: getComputedStyle(document.getElementById('eltern')).zIndex } })()`)
  ja(
    fenster && fenster.auf,
    'DAS FENSTER GEHT BEI STEHENDEM TOR AUF',
    fenster && fenster.auf
      ? `x ${fenster.x}..${fenster.x + fenster.b}, y ${fenster.y}..${fenster.y + fenster.h}; ` +
          `z-index Fenster ${fenster.z}, #mp ${fenster.zMp}, #eltern ${fenster.zEltern}`
      : 'blieb zu',
  )

  if (fenster && fenster.auf) {
    // Liegt es UEBER dem Tor? Gefragt wird an seiner eigenen Mitte.
    const mx = fenster.x + Math.round(fenster.b / 2)
    const my = fenster.y + Math.round(fenster.h / 2)
    const drauf = await ev(obenAn(mx, my))
    ja(
      !!drauf && /mp-laut/.test(drauf.marke),
      'es liegt UEBER dem Eltern-Bereich (sonst waere der Knopf eine Attrappe)',
      drauf ? drauf.marke : '—',
    )

    // Verdeckt es Tasten des Tors? Jede Tor-Taste wird an ihrer Mitte getastet.
    const verdeckt = await ev(String.raw`
      (() => {
        const raus = []
        for (const t of document.querySelectorAll('#tor-feld .tor-taste')) {
          const r = t.getBoundingClientRect()
          const e = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2))
          if (!e || !t.contains(e) && e !== t) raus.push({ auf: t.textContent.trim(), statt: e ? (e.id || e.className || e.tagName) : 'nichts' })
        }
        return raus })()`)
    ja(
      Array.isArray(verdeckt) && verdeckt.length === 0,
      'es verdeckt KEINE Taste des Tors',
      Array.isArray(verdeckt) && verdeckt.length
        ? verdeckt.map((v) => `„${v.auf}" -> ${v.statt}`).join(' | ')
        : 'keine',
    )

    // Und der Regler: laesst er sich bei stehendem Tor bedienen? Er schickt
    // `setvolume:N` an den Abspieldienst (app.js, `laut.geschoben`).
    const reglerDa = await ev(`(() => {
      const r = document.getElementById('mp-laut-regler')
      if (!r || r.disabled) return null
      const k = r.getBoundingClientRect()
      const e = document.elementFromPoint(Math.round(k.x + k.width / 2), Math.round(k.y + k.height / 2))
      return { wert: r.value, max: r.max, treffbar: !!e && (e === r || r.contains(e)),
               obenauf: e ? (e.id || e.tagName) : 'nichts' } })()`)
    ja(
      !(reglerDa && reglerDa.treffbar),
      'der Lautstaerke-Regler ist bei stehendem Tor NICHT zu bedienen',
      reglerDa
        ? `Wert ${reglerDa.wert} von ${reglerDa.max}, treffbar = ${reglerDa.treffbar} (obenauf: ${reglerDa.obenauf})`
        : 'Regler nicht da',
    )
  }

  // ════════════════════════════════════════════════════════════════════════
  // 3. DASSELBE FENSTER UEBER DER OFFENEN FLAECHE
  // ════════════════════════════════════════════════════════════════════════
  /*
   * Das Tor ist nicht die einzige Lage, in der der Bereich offensteht. Faellt
   * es, stehen dort die Faecher und die Karte daneben — und `.mp` liegt
   * weiterhin bei z-index 9. Gefragt wird dasselbe wie oben: verdeckt das
   * Fenster etwas, das man bedienen soll? Ein Erwachsener, der waehrend der
   * Einrichtung die Lautstaerke nachstellt, ist der wahrscheinlichste Fall.
   */
  zeile()
  zeile('══ 3. DASSELBE FENSTER UEBER DER OFFENEN FLAECHE ════════════════════')
  await stand('voll')
  await stand('sperre-aus')
  await neuLaden()
  await langHalten()
  l = await lage()
  ja(l.flaecheDa && l.faecher > 0, 'die Flaeche steht offen (Sperre „aus")', `${l.faecher} Faecher`)

  const lautKnopf2 = await mitte('#mp-laut')
  if (lautKnopf2) await tippen(lautKnopf2.x, lautKnopf2.y)
  const verdecktFlaeche = await ev(String.raw`
    (() => {
      const f = document.getElementById('mp-laut-fenster')
      if (!f || f.hidden) return { auf: false }
      const raus = []
      for (const t of document.querySelectorAll('#eltern-faecher .fach-knopf, #eltern-flaeche button')) {
        const r = t.getBoundingClientRect()
        if (r.width < 1 || r.height < 1) continue
        const e = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2))
        if (!e || (e !== t && !t.contains(e))) {
          raus.push({ auf: (t.getAttribute('aria-label') || t.textContent || '').trim().slice(0, 24),
                      statt: e ? (e.id || e.className || e.tagName) : 'nichts' })
        }
      }
      return { auf: true, raus } })()`)
  ja(
    verdecktFlaeche && verdecktFlaeche.auf,
    'das Fenster geht auch ueber der offenen Flaeche auf',
    verdecktFlaeche && verdecktFlaeche.auf ? 'ja' : 'blieb zu',
  )
  if (verdecktFlaeche && verdecktFlaeche.auf) {
    ja(
      verdecktFlaeche.raus.length === 0,
      'es verdeckt KEINEN Knopf der Flaeche',
      verdecktFlaeche.raus.length ? verdecktFlaeche.raus.map((v) => `„${v.auf}" -> ${v.statt}`).join(' | ') : 'keinen',
    )
  }

  zeile()
  const schlecht = befunde.filter((b) => !b.gut)
  zeile(`${befunde.length - schlecht.length} von ${befunde.length} Aussagen halten.`)
  zeile(`Beruehrungen im ganzen Lauf: ${beruehrungen}`)
  await chrome.schliessen()
  process.exit(schlecht.length ? 1 : 0)
} catch (e) {
  console.error(`  Fehler: ${e.message}`)
  process.exit(2)
}
