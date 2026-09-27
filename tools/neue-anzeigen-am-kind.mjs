#!/usr/bin/env node
/**
 * DIE SECHS NEUEN ANZEIGEN — GEMESSEN, WIE EIN KIND SIE ANTRIFFT.
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 * Am 07.08.2026 sind sechs Stuecke in die neue Oberflaeche gekommen:
 * getauschte Knoepfe im grossen Player, ein Helligkeitsregler im Admin-Menue,
 * Uhrzeit und Restzeit oben in der Mitte, Titel/Album einzeln abschaltbar, das
 * Kissen als blosses Bild („Microplayer") und die Kinderzeit-Passung.
 *
 * Jedes davon ist EINZELN begruendet worden. Was NICHT geprueft war, ist das,
 * was ein Kind wirklich antrifft:
 *
 *   * WIE KOMMT MAN AUS DEM MICROPLAYER WIEDER HERAUS? Die Begruendung sagt
 *     „ein Tipp aufs Bild oeffnet den grossen Player". Das ist eine ABSICHT.
 *     Hier wird die Klickfolge GEFAHREN — und zwar auch der Weg vom grossen
 *     Player zurueck, denn ein Hinweg ohne Rueckweg ist keiner.
 *   * STEHEN ZWEI ANZEIGEN UEBEREINANDER, wenn alles gleichzeitig an ist?
 *     Die Uhr ist absolut zentriert; links steht „14 von 14 Einträgen", rechts
 *     Netz, Wolke und Akku. Drei Kaesten, die einander nicht kennen.
 *   * WIE GROSS SIND DIE ZIELE AUF „FARBE UND FORM"? Der Kommentar an
 *     `reglerZeileBauen` sagt es selbst: „ACHTUNG, DAS WERKZEUG SIEHT DIESE
 *     ZEILE HEUTE NICHT — keine der Szenen von beruehrziele-neu geht auf
 *     Farbe und Form." Die 66 px des Reglers standen bisher aus RECHNUNG.
 *   * LIEGT DER GETAUSCHTE ZURUECK-KNOPF DORT, WO EINE GESTE BEGINNT?
 *
 * ══ WARUM EIN EIGENES WERKZEUG UND KEINE SZENE IN beruehrziele-neu ═════════
 * `beruehrziele-neu.mjs` traegt eine Zahl, die als GRENZE benutzt wird
 * („14 von 211, sie darf nicht steigen"). Eine Szene nachzutragen aendert
 * beide Zahlen und macht die Grenze fuer eine Weile unlesbar — man wuesste
 * nicht mehr, ob 16 von 240 besser oder schlechter ist als 14 von 211. Was
 * hier gemessen wird, wird deshalb HIER gemessen, gegen dieselbe 9-mm-Marke
 * und mit derselben Rechnung (0,1397 mm je Bildpunkt).
 *
 * ══ WAS ES NICHT TUT ═══════════════════════════════════════════════════════
 * Es fasst die Box nicht an. Eigene Vorschau (oder eine mitgegebene), eigener
 * headless-Browser, 800x480 wie der Schirm. Es schreibt nur Bilder, und nur
 * wenn man `--bilder` mitgibt.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *     node tools/neue-anzeigen-am-kind.mjs
 *     node tools/neue-anzeigen-am-kind.mjs --ziel http://127.0.0.1:9811/neu/
 *     node tools/neue-anzeigen-am-kind.mjs --bilder /tmp/anzeigen
 * ENDE 0, wenn jede Aussage haelt.
 */
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { adminAuf } from './admin-weg.mjs'
import { eigenerBrowser, freierPort } from './leihgabe.mjs'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  return i < 0 ? v : argv[i + 1]
}
const BILDER = opt('bilder')
const warte = (ms) => new Promise((r) => setTimeout(r, ms))
/** 800x480 auf 5 Zoll: 0,1397 mm je Bildpunkt. Dieselbe Zahl wie beruehrziele-neu. */
const MM = 0.1397
/** ISO 9241-411: das kleinste Beruehrungsziel. */
const MARKE_MM = 9
/** Der kleinste Abstand zwischen zwei Zielen — 2 mm, hier in Bildpunkten. */
const LUFT_PX = 15

let fehler = 0
const ja = (b, satz, wie = '') => {
  if (!b) fehler++
  console.log(`${b ? 'ok  ' : 'FEHL'}  ${satz}${wie ? '  — ' + wie : ''}`)
}

let vorschau = null
let ZIEL = opt('ziel')
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
console.log(`ZIEL: ${ZIEL}${vorschau ? '  (eigene Vorschau)' : '  (mitgegeben)'}`)

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
 * DIE DARSTELLUNG STELLEN — mit dem GANZEN Stand, nicht mit einem Feld.
 *
 * `PUT /api/darstellung` ERSETZT `aktuell` (Vorschau wie Box). Wer nur sein
 * eines Feld schickt, loescht alles andere — genau die Falle, gegen die die
 * Vorschau ihre Feldzahl auf die Konsole schreibt. Deshalb wird erst gelesen,
 * dann zusammengefuegt, dann geschrieben.
 */
const darstellungSetzen = async (felder) => {
  const jetzt = await (await fetch(new URL('/api/darstellung', ZIEL))).json()
  await fetch(new URL('/api/darstellung', ZIEL), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ aktuell: { ...(jetzt.aktuell || {}), ...felder }, themen: jetzt.themen || {} }),
  })
}

/** Die schmalere Seite eines Rechtecks in Millimetern — wie beruehrziele-neu misst. */
const schmalMm = (r) => Math.min(r.w, r.h) * MM

/* ══ KONTRAST, GERECHNET AUS DEM, WAS WIRKLICH DASTEHT ══════════════════════
 *
 * WARUM NICHT tools/kontrast.mjs: Das rechnet zwei Farben gegeneinander, die
 * man ihm NENNT. Genau daran ist die blasse Titelzeile vorbeigelaufen — ihre
 * Farbe steht nirgends im Stilblatt, sie ENTSTEHT aus `#2E2A3B` und einem
 * `opacity: 0.55` auf einem Untergrund, den erst der Baum verraet. Wer die
 * Zahlen abschreibt, misst die Absicht; hier wird das Ergebnis gemessen.
 *
 * DIE SCHWELLE IST 4,5 : 1 (WCAG 2.1, 1.4.3). Die haeufig zitierten 3,0 gelten
 * fuer GROSSE Schrift: ab 24 px, oder ab 18,66 px wenn sie fett ist. Beides
 * wird hier aus der gemessenen Schriftgroesse und dem Schriftschnitt
 * entschieden und nicht geraten — sonst gaebe man einer 11-px-Zeile die
 * Schwelle einer Ueberschrift. */
const linear = (c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4)
const leuchtdichte = ([r, g, b]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
const kontrast = (a, b) => {
  const [x, y] = [leuchtdichte(a), leuchtdichte(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
/** „rgb(46, 42, 59)" / „rgba(…)" → [r,g,b]; alles andere → null. */
const rgb = (s) => {
  const m = /rgba?\(([^)]+)\)/.exec(String(s || ''))
  if (!m) return null
  const t = m[1].split(',').map((x) => Number.parseFloat(x))
  return t.length >= 3 ? [t[0], t[1], t[2]] : null
}
/** Deckt eine Farbe mit `alpha` einen Untergrund ab, kommt das heraus. */
const ueber = (vorn, hinten, alpha) => vorn.map((v, i) => alpha * v + (1 - alpha) * hinten[i])
/** Ab wann gilt die Schrift als gross (und damit die 3,0 statt der 4,5)? */
const schwelle = (px, gewicht) => {
  const fett = Number(gewicht) >= 700
  return px >= 24 || (fett && px >= 18.66) ? 3 : 4.5
}

const browser = await eigenerBrowser({ fenster: '800,480' })
if (!browser) {
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}
let ws = null
try {
  if (BILDER) await mkdir(BILDER, { recursive: true })
  ws = new WebSocket(await browser.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })

  const ev = async (e) =>
    (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.value
  const bild = async (name) => {
    if (!BILDER) return
    const s = await send(ws, 'Page.captureScreenshot', { format: 'png' })
    await writeFile(join(BILDER, `${name}.png`), Buffer.from(s.data, 'base64'))
    console.log(`      Bild: ${join(BILDER, `${name}.png`)}`)
  }
  const stand = async (w) => {
    await fetch(new URL(`/vorschau/${w}`, ZIEL)).catch(() => null)
    await warte(120)
  }
  const laden = async () => {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(2400)
  }
  /** Hell oder dunkel stellen — wie der Schalter im Admin-Menue es tut. */
  const licht = async (wie) => {
    await ev(`document.documentElement.setAttribute('data-licht', ${JSON.stringify(wie)})`)
    await warte(200)
  }

  /**
   * WIRKLICH TIPPEN, nicht `.click()` aufrufen.
   *
   * Der Unterschied traegt hier alles: `.click()` erreicht auch ein Element,
   * das unter einer anderen Ebene liegt oder `pointer-events: none` hat. Ein
   * Finger erreicht es nicht. Fuer die Frage „kommt ein Kind wieder heraus"
   * ist nur der Finger die Antwort.
   */
  const tippenAuf = async (x, y) => {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send(ws, 'Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
    }
    await warte(650)
  }
  /** Das Rechteck eines Elements — oder null. */
  const kasten = async (wahl) =>
    await ev(`(() => {
      const e = document.querySelector(${JSON.stringify(wahl)})
      if (!e) return null
      const b = e.getBoundingClientRect()
      if (b.width < 1 || b.height < 1) return null
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
    })()`)
  /** Was ein Finger an dieser Stelle WIRKLICH traefe. */
  const trifft = async (x, y) =>
    await ev(`(() => {
      const e = document.elementFromPoint(${x}, ${y})
      if (!e) return null
      const k = e.closest('button, input, a, [data-auf]')
      return { roh: e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/).join('.') : ''),
               ziel: k ? k.tagName.toLowerCase() + (k.id ? '#' + k.id : '') + (k.className && typeof k.className === 'string' ? '.' + k.className.trim().split(/\\s+/).join('.') : '') : null }
    })()`)

  // ════════════════════════════════════════════════════════════════════════
  // 1. DER MICROPLAYER — DER WEG HINEIN UND, VOR ALLEM, WIEDER HERAUS
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n══ 1. MICROPLAYER: KOMMT EIN KIND WIEDER HERAUS? ═══════════')
  await stand('spielt')
  await darstellungSetzen({ kissenMicro: true, uhrzeit: false, restzeit: false, kinderzeitPassung: false })
  await laden()
  await warte(1200)

  const mp = await kasten('#mp')
  ja(!!mp, 'das Kissen steht da', mp ? `${mp.w}x${mp.h} bei ${mp.x},${mp.y}` : 'fehlt')
  const bldK = await kasten('#mp .mp-bild')
  ja(!!bldK, 'das Bild ist das einzige, was uebrig bleibt', bldK ? `${bldK.w}x${bldK.h}` : 'fehlt')
  if (bldK) {
    ja(
      schmalMm(bldK) >= MARKE_MM,
      'das Bild haelt die 9-mm-Marke',
      `${schmalMm(bldK).toFixed(2)} mm (${bldK.w}x${bldK.h} px)`,
    )
  }
  // WAS SONST NOCH DASTEHT. In dieser Stufe soll nichts anderes bedienbar
  // sein — steht doch ein Knopf da, ist er entweder unsichtbar klein oder er
  // widerspricht dem Auftrag („nur das bild").
  const uebrig = await ev(`(() => {
    const mp = document.getElementById('mp')
    if (!mp || mp.hidden) return null
    return [...mp.querySelectorAll('button, input')].filter((e) => {
      const b = e.getBoundingClientRect()
      return b.width > 0 && b.height > 0
    }).map((e) => (e.id || e.className))
  })()`)
  ja(
    Array.isArray(uebrig) && uebrig.length === 1,
    'genau EIN Bedienelement bleibt im Microplayer',
    (uebrig || []).join(' · ') || 'keins',
  )

  await bild('1-micro-hell')
  await licht('dunkel')
  await bild('1-micro-dunkel')
  await licht('hell')

  // DER RING. Er ist der halbe Auftrag („umlaufend den prozess"). Ohne
  // `--ring` an `#mp` waere er ein leerer Kreis — und das saehe aus wie
  // Gestaltung, nicht wie ein Fehler.
  const ring = await ev(`(() => {
    const mp = document.getElementById('mp')
    if (!mp) return null
    return { wert: mp.style.getPropertyValue('--ring') || getComputedStyle(mp).getPropertyValue('--ring'),
             hinter: getComputedStyle(document.querySelector('#mp .mp-bild'), '::after').backgroundImage.slice(0, 40) }
  })()`)
  ja(
    !!ring && /\d/.test(String(ring.wert)),
    'der Fortschritt steht als `--ring` am Kissen',
    ring ? `--ring: ${ring.wert || '(leer)'}` : 'kein #mp',
  )

  // ── DER RUECKWEG, GEFAHREN UND NICHT BEHAUPTET ──────────────────────────
  if (bldK) {
    const mitteX = bldK.x + bldK.w / 2
    const mitteY = bldK.y + bldK.h / 2
    const wer = await trifft(Math.round(mitteX), Math.round(mitteY))
    ja(
      !!wer && String(wer.ziel || '').includes('mp-bild'),
      'ein Finger auf die Mitte des Bildes trifft wirklich das Bild',
      wer ? `${wer.ziel || wer.roh}` : 'nichts',
    )
    await tippenAuf(Math.round(mitteX), Math.round(mitteY))
    const auf = await ev(`(() => {
      const g = document.getElementById('gross')
      return !!g && !g.hidden && getComputedStyle(g).display !== 'none'
    })()`)
    ja(auf === true, 'EIN Tipp aufs Bild oeffnet den grossen Player', auf ? 'offen' : 'nichts passiert')
    await bild('1-micro-danach')

    // Und laeuft die Musik noch? Der Tipp darf NICHT pausieren — das ist die
    // ausdrueckliche Entscheidung in app.css. Hier wird sie nachgemessen.
    const laeuft = await ev(`(() => {
      const b = document.getElementById('gr-spiel')
      return b ? (b.getAttribute('aria-label') || '') : null
    })()`)
    console.log(`      der Spielknopf sagt: „${laeuft}"`)

    // ZURUECK AUS DEM GROSSEN PLAYER — der zweite Halbschritt. Ohne ihn
    // waere der „Rueckweg" nur ein Weg in eine andere Ebene.
    const zk = await kasten('#zurueck')
    if (zk) {
      await tippenAuf(Math.round(zk.x + zk.w / 2), Math.round(zk.y + zk.h / 2))
      const zu = await ev(`(() => {
        const g = document.getElementById('gross')
        return !g || g.hidden || getComputedStyle(g).display === 'none'
      })()`)
      ja(zu === true, 'und der eine Rueckweg oben links fuehrt wieder heraus', zu ? 'zu' : 'der Player bleibt offen')
    } else {
      ja(false, 'der Rueckweg oben links steht im grossen Player da', 'kein #zurueck')
    }
  }

  // ── DIE DREI LAGEN, IN DENEN DAS KISSEN NICHT SPIELT ───────────────────
  //
  // WARUM SIE HIER STEHEN: In der vollen Stufe sagt der Spielknopf, ob die
  // Box laeuft — ein Dreieck heisst „angehalten", zwei Balken „laeuft". In
  // der Micro-Stufe ist der Knopf weg. Bleibt etwas uebrig, woran ein Kind
  // „ich habe aus Versehen angehalten" erkennt? Und, schwerer: verschwindet
  // das Kissen im Halt, dann ist der Weg zurueck zur Musik weg.
  console.log('\n── die Lagen ohne Ton ──────────────────────────────────────')
  for (const lage of ['pause', 'still']) {
    await stand(lage)
    await warte(1400)
    const l = await ev(`(() => {
      const mp = document.getElementById('mp')
      if (!mp) return null
      const versteckt = mp.hidden || getComputedStyle(mp).display === 'none'
      const b = mp.getBoundingClientRect()
      const s = document.getElementById('mp-spiel')
      return { versteckt, w: Math.round(b.width), h: Math.round(b.height),
               ring: mp.style.getPropertyValue('--ring'),
               knopfSichtbar: s ? getComputedStyle(s).display !== 'none' : null,
               klasse: mp.className }
    })()`)
    console.log(`      [${lage}] ` + JSON.stringify(l))
    if (lage === 'pause') {
      ja(l && l.versteckt === false, '[pause] das Kissen bleibt stehen — der Weg zurueck zur Musik auch', JSON.stringify(l))
      await bild('1-micro-pause')
    } else {
      ja(l && l.versteckt === true, '[still] ohne Ton ist auch kein Kissen da', JSON.stringify(l))
    }
  }
  await stand('spielt')
  await warte(900)

  // ── UND WAEHREND DES BLAETTERNS ────────────────────────────────────────
  // Stufe 2 („Platz beim Blaettern") und Stufe 3 koennen GLEICHZEITIG gelten.
  // Die Regel `body.mp-micro.platz-machen .mp` ist ausdruecklich dafuer
  // geschrieben worden; ob sie traegt, sagt nur eine Messung.
  await darstellungSetzen({ kissenMicro: true, platzBeimBlaettern: true })
  await laden()
  await warte(1400)
  await ev(`(() => { const b = document.querySelector('.buehne'); if (b) b.scrollTop = 200; b?.dispatchEvent(new Event('scroll')) })()`)
  await warte(900)
  const beimBlaettern = await ev(`(() => {
    const mp = document.getElementById('mp')
    if (!mp) return null
    const b = mp.getBoundingClientRect()
    return { klassen: document.body.className, x: Math.round(b.x), y: Math.round(b.y),
             w: Math.round(b.width), h: Math.round(b.height) }
  })()`)
  console.log('      ' + JSON.stringify(beimBlaettern))
  if (beimBlaettern) {
    ja(
      beimBlaettern.x >= 0 && beimBlaettern.y >= 0 && beimBlaettern.x + beimBlaettern.w <= 800 && beimBlaettern.y + beimBlaettern.h <= 480,
      'auch beim Blaettern bleibt das Bild ganz im Schirm',
      `${beimBlaettern.x},${beimBlaettern.y} ${beimBlaettern.w}x${beimBlaettern.h}`,
    )
    ja(Math.min(beimBlaettern.w, beimBlaettern.h) * MM >= MARKE_MM, 'und gross genug', `${(Math.min(beimBlaettern.w, beimBlaettern.h) * MM).toFixed(2)} mm`)
  }
  await bild('1-micro-blaettern')
  await darstellungSetzen({ platzBeimBlaettern: false })

  // ════════════════════════════════════════════════════════════════════════
  // 2. OBEN IN DER MITTE — UEBERLAPPT ETWAS, WENN ALLES AN IST?
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n══ 2. UHRZEIT UND RESTZEIT OBEN IN DER MITTE ═══════════════')
  await stand('kz-knapp')
  await stand('name-lang')
  await stand('netz-gut')
  await stand('hat-akku')
  await darstellungSetzen({ kissenMicro: false, uhrzeit: true, restzeit: true, kinderzeitPassung: false })
  await laden()
  await warte(1800)

  const kopfTeile = await ev(`(() => {
    const g = (id) => {
      const e = document.getElementById(id)
      if (!e || e.hidden) return null
      const b = e.getBoundingClientRect()
      if (b.width < 1) return null
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), t: (e.textContent || '').trim() }
    }
    return { uhr: g('km-uhr'), rest: g('km-rest'), links: g('kopf-unter'), rechts: g('kopf-status'), zurueck: g('zurueck') }
  })()`)
  console.log('      ' + JSON.stringify(kopfTeile))
  ja(!!kopfTeile.uhr, 'die Uhrzeit steht da', kopfTeile.uhr ? `„${kopfTeile.uhr.t}"` : 'fehlt')
  ja(!!kopfTeile.rest, 'die Restzeit steht daneben', kopfTeile.rest ? `„${kopfTeile.rest.t}"` : 'fehlt')

  /** Ueberschneiden sich zwei Rechtecke? */
  const kreuzt = (a, b) =>
    !!a && !!b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  const mitte = [kopfTeile.uhr, kopfTeile.rest].filter(Boolean)
  for (const m of mitte) {
    ja(!kreuzt(m, kopfTeile.links), `„${m.t}" liegt nicht auf der Zaehlzeile links`, kopfTeile.links ? `links endet bei x ${kopfTeile.links.x + kopfTeile.links.w}, „${m.t}" beginnt bei ${m.x}` : 'keine Zaehlzeile')
    ja(!kreuzt(m, kopfTeile.rechts), `„${m.t}" liegt nicht auf den Zeichen rechts`, kopfTeile.rechts ? `„${m.t}" endet bei x ${m.x + m.w}, rechts beginnt bei ${kopfTeile.rechts.x}` : 'keine Zeichen')
    ja(!kreuzt(m, kopfTeile.zurueck), `„${m.t}" liegt nicht auf dem Rueckweg`, kopfTeile.zurueck ? `Rueckweg endet bei x ${kopfTeile.zurueck.x + kopfTeile.zurueck.w}` : 'kein Rueckweg')
    ja(m.x >= 0 && m.x + m.w <= 800, `„${m.t}" steht ganz im Bild`, `x ${m.x}..${m.x + m.w}`)
  }
  // DIE AUSKUNFT DARF KEINEN TIPP SCHLUCKEN. Sie liegt absolut ueber der
  // Kopfzeile; ohne `pointer-events: none` faengt sie Tipps ab, die dem
  // Bluetooth-Zeichen oder dem Rueckweg gelten — unsichtbar.
  if (kopfTeile.uhr) {
    const w = await trifft(kopfTeile.uhr.x + Math.round(kopfTeile.uhr.w / 2), kopfTeile.uhr.y + Math.round(kopfTeile.uhr.h / 2))
    ja(
      !!w && !String(w.roh).includes('km-uhr') && !String(w.roh).includes('kopf-mitte'),
      'die Uhr schluckt keinen Tipp (sie ist Auskunft, kein Ziel)',
      w ? `getroffen: ${w.roh}` : 'nichts',
    )
  }
  await bild('2-kopf-hell')
  await licht('dunkel')
  await bild('2-kopf-dunkel')
  await licht('hell')

  // ════════════════════════════════════════════════════════════════════════
  // 3. DER GETAUSCHTE ZURUECK-KNOPF IM GROSSEN PLAYER
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n══ 3. DIE KNOEPFE DES GROSSEN PLAYERS ══════════════════════')
  await ev(`(() => { const b = document.querySelector('#mp .mp-bild'); if (b) b.click() })()`)
  await warte(900)
  const reihe = await ev(`(() => {
    const t = document.querySelector('.gross-tasten')
    if (!t) return null
    return [...t.querySelectorAll('button')].map((b) => {
      const r = b.getBoundingClientRect()
      return { id: b.id, wort: b.getAttribute('aria-label'), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
    })
  })()`)
  if (!reihe) ja(false, 'die Knopfreihe des grossen Players steht da', 'nicht gefunden')
  else {
    console.log('      ' + reihe.map((b) => `${b.id}(${b.x})`).join(' · '))
    ja(
      reihe.map((b) => b.id).join(',') === 'gr-zurueck,gr-leiser,gr-spiel,gr-vor,gr-lauter',
      'die Reihe liest sich zurueck · leiser · spiel · vor · lauter',
      reihe.map((b) => b.id).join(' · '),
    )
    // DIE REIHENFOLGE IM BAUM IST DIE REIHENFOLGE AM SCHIRM. Ein `order:` im
    // Stilblatt wuerde beides auseinanderziehen — dann liefe die Tastatur
    // anders als das Auge, und genau das war der Grund des Tauschs.
    const nachX = [...reihe].sort((a, b) => a.x - b.x).map((b) => b.id).join(',')
    ja(
      nachX === reihe.map((b) => b.id).join(','),
      'Tastaturreihe und Augenschein laufen in dieselbe Richtung',
      nachX,
    )
    for (const b of reihe) {
      ja(schmalMm(b) >= MARKE_MM, `„${b.wort}" haelt die 9-mm-Marke`, `${schmalMm(b).toFixed(2)} mm (${b.w}x${b.h})`)
    }
    for (let i = 1; i < reihe.length; i++) {
      const luft = reihe[i].x - (reihe[i - 1].x + reihe[i - 1].w)
      ja(luft >= LUFT_PX, `zwischen „${reihe[i - 1].wort}" und „${reihe[i].wort}" bleiben 2 mm`, `${luft} px = ${(luft * MM).toFixed(2)} mm`)
    }
    // WO BEGINNEN DIE GESTEN? Der Randwisch von links und die vier Ecken des
    // Tors sind die Stellen, an denen ein Tipp etwas ANDERES ausloest als das,
    // was dort steht. Der Zurueck-Knopf ist nach dem Tausch der linkeste der
    // Reihe — die Frage ist also nicht theoretisch.
    const z = reihe[0]
    ja(z.x >= 24, 'der linkeste Knopf liegt nicht im Randstreifen fuer Wischgesten', `beginnt bei x ${z.x}`)
    const ecke = 80
    const inEcke = (b) =>
      (b.x < ecke || b.x + b.w > 800 - ecke) && (b.y < ecke || b.y + b.h > 480 - ecke)
    ja(!inEcke(z), 'und er liegt in keiner der vier Ecken (dort beginnt das Tor)', `${z.x},${z.y} ${z.w}x${z.h}`)
  }
  await bild('3-player-hell')
  await licht('dunkel')
  await bild('3-player-dunkel')
  await licht('hell')

  // ════════════════════════════════════════════════════════════════════════
  // 4. „FARBE UND FORM" — DIE SEITE, DIE BISHER NIEMAND GEMESSEN HAT
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n══ 4. HELLIGKEIT IM ADMIN-MENUE (ungemessene Seite) ════════')
  for (const lage of ['licht-da', 'licht-geklemmt', 'licht-weg']) {
    await stand(lage)
    await laden()
    await adminAuf(ev, { warteMs: 1200 })
    await ev(`document.querySelector('#eltern-faecher [data-fach="anzeige"]').click()`)
    await warte(700)
    const hin = await ev(`(() => {
      for (const z of document.querySelectorAll('#fach-zeilen .fach-zeile')) {
        const n = z.querySelector('.zeile-name')
        if (n && n.textContent.trim().startsWith('Farbe und Form')) { z.click(); return true }
      }
      return false })()`)
    ja(hin === true, `[${lage}] „Farbe und Form" ist erreichbar`)
    await warte(900)
    const seite = await ev(`(() => {
      const f = document.getElementById('fach-zeilen')
      if (!f) return null
      const fb = f.getBoundingClientRect()
      return {
        sicht: Math.round(f.clientHeight), inhalt: Math.round(f.scrollHeight),
        zeilen: [...f.querySelectorAll('.fach-zeile')].map((z) => {
          const b = z.getBoundingClientRect()
          const ziele = [...z.querySelectorAll('input, button')].map((e) => {
            const r = e.getBoundingClientRect()
            return { was: e.tagName.toLowerCase() + (e.type ? ':' + e.type : ''), wort: (e.textContent || e.getAttribute('aria-label') || '').trim(),
                     x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
                     aus: !!e.disabled,
                     sicht: Math.round(Math.max(0, Math.min(r.bottom, fb.bottom) - Math.max(r.top, fb.top))) }
          })
          return { name: (z.querySelector('.zeile-name') || {}).textContent || '',
                   unter: (z.querySelector('.zeile-unter') || {}).textContent || '',
                   warnt: z.classList.contains('warnt'),
                   y: Math.round(b.y), h: Math.round(b.height), ziele }
        }),
      }
    })()`)
    const hell = (seite?.zeilen || []).find((z) => /Helligkeit/i.test(z.name))
    if (lage === 'licht-weg') {
      ja(!!hell, `[${lage}] die Zeile steht trotzdem da (der Grund gehoert hin)`, hell ? `„${hell.unter}"` : 'fehlt')
      ja(
        !!hell && !hell.ziele.some((t) => t.was === 'input:range'),
        `[${lage}] KEIN Regler, wo es keine Hardware gibt`,
        hell ? hell.ziele.map((t) => t.was).join(' · ') || 'keine Ziele' : '',
      )
    } else {
      ja(!!hell, `[${lage}] die Helligkeitszeile steht da`, hell ? `„${hell.name}"` : 'fehlt')
      const regler = hell?.ziele.find((t) => t.was === 'input:range')
      ja(!!regler, `[${lage}] mit einem Regler`, regler ? `${regler.w}x${regler.h}` : 'keiner')
      if (regler) {
        ja(
          schmalMm(regler) >= MARKE_MM,
          `[${lage}] der Regler haelt die 9-mm-Marke — ZUM ERSTEN MAL GEMESSEN`,
          `${schmalMm(regler).toFixed(2)} mm (${regler.w}x${regler.h} px)`,
        )
        ja(regler.sicht === regler.h, `[${lage}] der Regler ist GANZ im Bild, nicht angeschnitten`, `${regler.sicht} von ${regler.h} px`)
      }
      if (lage === 'licht-geklemmt') {
        // `was` traegt bei einem `<button type="button">` den Typ mit
        // („button:button"); ein Vergleich auf „button" allein fand ihn nie
        // und meldete dreimal einen Fehler, den es nicht gab.
        const k = hell?.ziele.find((t) => t.was.startsWith('button'))
        ja(!!k, '[licht-geklemmt] es gibt den Knopf, den der Regler nicht ersetzen kann', k ? `„${k.wort}"` : 'keiner')
        if (k) {
          ja(schmalMm(k) >= MARKE_MM, '[licht-geklemmt] und er haelt die 9-mm-Marke', `${schmalMm(k).toFixed(2)} mm (${k.w}x${k.h})`)
          ja(k.sicht === k.h, '[licht-geklemmt] und er ist ganz im Bild', `${k.sicht} von ${k.h} px`)
          if (regler) {
            const luft = k.x - (regler.x + regler.w)
            ja(luft >= LUFT_PX, '[licht-geklemmt] zwischen Regler und Knopf bleiben 2 mm', `${luft} px = ${(luft * MM).toFixed(2)} mm`)
          }
        }
        ja(hell?.warnt === true, '[licht-geklemmt] die Zeile warnt sichtbar')
      }
    }
    // JEDES ZIEL DER SEITE, nicht nur das neue: eine Zeile, die dazukommt,
    // schiebt die anderen — und was unten herausfaellt, faellt still heraus.
    for (const z of seite?.zeilen || []) {
      for (const t of z.ziele) {
        if (t.h < 1 || t.w < 1) continue
        ja(schmalMm(t) >= MARKE_MM, `[${lage}] „${z.name}" / ${t.wort || t.was} haelt die Marke`, `${schmalMm(t).toFixed(2)} mm`)
        ja(t.sicht === t.h, `[${lage}] „${z.name}" / ${t.wort || t.was} ist ganz im Bild`, `${t.sicht} von ${t.h} px`)
      }
    }
    await bild(`4-${lage}-hell`)
    if (lage === 'licht-da') {
      await licht('dunkel')
      await bild('4-licht-da-dunkel')
      await licht('hell')
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // 4a. EIN ZUG UEBER DEN REGLER — WIE VIELE AUFRUFE GEHEN WIRKLICH HINAUS?
  // ════════════════════════════════════════════════════════════════════════
  //
  // DIE BEGRUENDUNG IM COMMIT SAGT: „Ein Zug ueber die halbe Bahn sind rund
  // dreissig input-Ereignisse — das waeren dreissig sudo-Aufrufe und dreissig
  // Schreibvorgaenge." Das ist die Zahl, an der dieses Stueck haengt, und sie
  // stand bisher als BEHAUPTUNG da. Hier wird wirklich gezogen (echte
  // Mausereignisse, kein `.value = x`) und mitgezaehlt, was hinausgeht.
  //
  // GEZAEHLT WIRD IN DER SEITE und nicht am Server: So faellt auch ein Aufruf
  // auf, den ein Fehler unterwegs verschluckt.
  console.log('\n══ 4a. EIN ZUG UEBER DEN HELLIGKEITSREGLER ═════════════════')
  // DER AUSGANGSWERT WIRD GESETZT UND NICHT GEERBT. Beim zweiten Lauf gegen
  // dieselbe Vorschau stand der Regler noch auf 100 — der Zug endete dort,
  // wo er anfing, `change` feuerte nicht, und das Werkzeug meldete „kein PUT"
  // als Fehler, wo es in Wahrheit richtig war ([[vorschau-wird-geliehen]]).
  // 35 % liegen weit genug vom rechten Anschlag entfernt, dass der Zug etwas
  // aendert. Nebenbei ist das genau die Beobachtung, auf der die Lage
  // `geklemmt` beruht: ein Regler, der schon am Ziel steht, schickt nichts.
  await stand('licht-35')
  await stand('licht-da')
  await laden()
  await adminAuf(ev, { warteMs: 1200 })
  await ev(`document.querySelector('#eltern-faecher [data-fach="anzeige"]').click()`)
  await warte(700)
  await ev(`(() => {
    for (const z of document.querySelectorAll('#fach-zeilen .fach-zeile')) {
      const n = z.querySelector('.zeile-name')
      if (n && n.textContent.trim().startsWith('Farbe und Form')) { z.click(); return true }
    }
    return false })()`)
  await warte(900)
  await ev(`(() => {
    window.__hell = []
    const alt = window.fetch
    window.fetch = function (...a) {
      try {
        const u = String(a[0] && a[0].url ? a[0].url : a[0])
        const m = (a[1] && a[1].method) || 'GET'
        if (/schirm\\/helligkeit/.test(u)) window.__hell.push(m)
      } catch (e) { /* egal */ }
      return alt.apply(this, a)
    }
    return true })()`)
  const bahn = await ev(`(() => {
    const r = document.querySelector('#fach-zeilen input[type=range]')
    if (!r) return null
    const b = r.getBoundingClientRect()
    return { x: Math.round(b.x), y: Math.round(b.y + b.height / 2), w: Math.round(b.width), wert: r.value, min: r.min, max: r.max, schritt: r.step }
  })()`)
  console.log('      ' + JSON.stringify(bahn))
  if (bahn) {
    // ECHT ZIEHEN: druecken, dreissig Schritte bewegen, loslassen. Ein
    // `r.value = x` haette gar kein `input` ausgeloest und damit genau das
    // nicht geprueft, worum es geht.
    const y = bahn.y
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: bahn.x + 12, y, button: 'left', clickCount: 1 })
    for (let n = 1; n <= 30; n++) {
      await send(ws, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: bahn.x + 12 + Math.round(((bahn.w - 24) * n) / 30),
        y,
        button: 'left',
        buttons: 1,
      })
      await warte(25)
    }
    const waehrend = await ev(`window.__hell.length`)
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: bahn.x + bahn.w - 12, y, button: 'left', clickCount: 1 })
    await warte(1400)
    const danach = await ev(`window.__hell.slice()`)
    console.log('      Aufrufe: waehrend des Zuges ' + waehrend + ', insgesamt ' + JSON.stringify(danach))
    ja(waehrend === 0, 'waehrend des Ziehens geht KEIN Aufruf hinaus', `${waehrend} Aufrufe bei 30 Bewegungen`)
    ja(
      (danach || []).filter((m) => m === 'PUT').length === 1,
      'beim Loslassen geht GENAU EIN PUT hinaus',
      (danach || []).join(' · ') || 'keiner',
    )
    const nachher = await ev(`(() => { const r = document.querySelector('#fach-zeilen input[type=range]'); return r ? r.value : null })()`)
    ja(nachher !== bahn.wert, 'und der Regler steht danach woanders als vorher', `${bahn.wert} → ${nachher}`)
  } else {
    ja(false, 'der Helligkeitsregler steht auf „Farbe und Form"', 'nicht gefunden')
  }

  // ════════════════════════════════════════════════════════════════════════
  // 4b. JEDE SEITE UNTER „DARSTELLUNG" — VIER NEUE ZEILEN WOLLEN PLATZ
  // ════════════════════════════════════════════════════════════════════════
  //
  // WARUM DAS HIER STEHT UND NICHT NUR „FARBE UND FORM": Die vier neuen
  // Schalter (Uhrzeit, Restzeit, Kissen-nur-Bild, Passung) sind ZEILEN, und
  // Zeilen schieben. Die Karte des Bereichs zeigt zweieinhalb bis drei; was
  // unten herausfaellt, faellt STILL heraus. Genau das ist am 06.08.2026
  // schon einmal passiert (`punktZeileBauen`: der dritte Knopf „Öffnen" war
  // zu 86 Prozent da und sah ganz aus) und hat 26 gruene Aussagen ueberlebt.
  //
  // GEPRUEFT WIRD DESHALB ZWEIERLEI, und das zweite ist das schaerfere:
  //   * jedes Ziel haelt die 9-mm-Marke,
  //   * jedes Ziel ist GANZ im Bild ODER die Seite laesst sich rollen und
  //     bringt es herein. Ein Ziel, das weder ganz dasteht noch erreichbar
  //     ist, ist ein Schalter, den niemand umlegen kann.
  console.log('\n══ 4b. ALLE SEITEN UNTER „DARSTELLUNG" ═════════════════════')
  await stand('licht-da')
  await laden()
  await adminAuf(ev, { warteMs: 1200 })
  await ev(`document.querySelector('#eltern-faecher [data-fach="anzeige"]').click()`)
  await warte(700)
  const punkte = await ev(`[...document.querySelectorAll('#fach-zeilen .fach-zeile .zeile-name')].map((n) => n.textContent.trim())`)
  console.log('      Punkte: ' + (punkte || []).join(' · '))
  ja((punkte || []).length > 0, 'die Gruppe „Darstellung" hat Punkte', String((punkte || []).length))
  for (const p of punkte || []) {
    const hin = await ev(`(() => {
      for (const z of document.querySelectorAll('#fach-zeilen .fach-zeile')) {
        const n = z.querySelector('.zeile-name')
        if (n && n.textContent.trim() === ${JSON.stringify(p)}) { z.click(); return true }
      }
      return false })()`)
    await warte(900)
    if (hin !== true) {
      ja(false, `„${p}" laesst sich oeffnen`)
      continue
    }
    // ROLLEN UND DABEI MESSEN. Eine Zeile, die erst nach dem Rollen ganz
    // dasteht, ist in Ordnung — der Bereich rollt, und das ist angekuendigt.
    // Eine, die es NIE tut, ist ein Befund.
    const bericht = await ev(`(async () => {
      const f = document.getElementById('fach-zeilen')
      if (!f) return null
      const warte = (ms) => new Promise((r) => setTimeout(r, ms))
      const beste = new Map()
      const messen = () => {
        const fb = f.getBoundingClientRect()
        for (const z of f.querySelectorAll('.fach-zeile')) {
          const name = (z.querySelector('.zeile-name') || {}).textContent || '?'
          for (const [i, e] of [...z.querySelectorAll('input, button')].entries()) {
            const r = e.getBoundingClientRect()
            if (r.width < 1 || r.height < 1) continue
            const sicht = Math.max(0, Math.min(r.bottom, fb.bottom) - Math.max(r.top, fb.top))
            const schl = name + '#' + i
            const alt = beste.get(schl)
            const jetzt = { name, wort: (e.textContent || e.getAttribute('aria-label') || '').trim(),
                            w: Math.round(r.width), h: Math.round(r.height), sicht: Math.round(sicht) }
            if (!alt || jetzt.sicht > alt.sicht) beste.set(schl, jetzt)
          }
        }
      }
      messen()
      const schritte = Math.ceil(f.scrollHeight / Math.max(1, f.clientHeight)) + 1
      for (let n = 0; n < schritte; n++) {
        f.scrollTop = f.scrollTop + f.clientHeight * 0.8
        await warte(180)
        messen()
      }
      f.scrollTop = 0
      return { sicht: Math.round(f.clientHeight), inhalt: Math.round(f.scrollHeight), ziele: [...beste.values()] }
    })()`)
    const zuKlein = (bericht?.ziele || []).filter((t) => Math.min(t.w, t.h) * MM < MARKE_MM)
    const nieGanz = (bericht?.ziele || []).filter((t) => t.sicht < t.h)
    ja(
      zuKlein.length === 0,
      `„${p}": jedes Ziel haelt die 9-mm-Marke`,
      `${bericht?.ziele.length} Ziele` + (zuKlein.length ? ' — zu klein: ' + zuKlein.map((t) => `${t.name}/${t.wort} ${t.w}x${t.h}`).join(', ') : ''),
    )
    ja(
      nieGanz.length === 0,
      `„${p}": jedes Ziel kommt beim Rollen GANZ ins Bild`,
      `Karte ${bericht?.sicht} px, Inhalt ${bericht?.inhalt} px` +
        (nieGanz.length ? ' — nie ganz: ' + nieGanz.map((t) => `${t.name}/${t.wort} ${t.sicht} von ${t.h}`).join(', ') : ''),
    )
    await bild(`4b-${p.replace(/[^a-zA-Z0-9]+/g, '-')}`)
    await ev(`document.getElementById('zurueck').click()`)
    await warte(800)
  }

  // ════════════════════════════════════════════════════════════════════════
  // 5. ALLES GLEICHZEITIG AN — DER FALL, DEN NIEMAND EINZELN BAUT
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n══ 5. ALLES AN: UHR, RESTZEIT, PASSUNG, MICRO ══════════════')
  await stand('licht-da')
  await stand('kz-knapp')
  await stand('dauer-da')
  await stand('spielt')
  await darstellungSetzen({ uhrzeit: true, restzeit: true, kinderzeitPassung: true, kissenMicro: true, spielTitel: true, spielAlbum: true })
  await laden()
  await warte(2000)
  await bild('5-alles-hell')
  await licht('dunkel')
  await bild('5-alles-dunkel')
  await licht('hell')

  const alles = await ev(`(() => {
    const g = (s) => { const e = document.querySelector(s); if (!e || e.hidden) return null
      const b = e.getBoundingClientRect(); return b.width < 1 ? null : { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } }
    return { uhr: g('#km-uhr'), rest: g('#km-rest'), mp: g('#mp'), kopf: g('.kopf') }
  })()`)
  ja(!!alles.uhr && !!alles.rest && !!alles.mp, 'Uhr, Restzeit und Microplayer stehen gleichzeitig da', JSON.stringify(alles))
  if (alles.mp && alles.kopf) {
    ja(alles.mp.y > alles.kopf.y + alles.kopf.h, 'das Kissen liegt unter der Kopfzeile, nicht darauf', `Kissen bei y ${alles.mp.y}, Kopf endet bei ${alles.kopf.y + alles.kopf.h}`)
  }

  // ── DIE PASSUNG: STEHT DIE DAUER AN DER KACHEL? ────────────────────────
  console.log('\n══ 6. KINDERZEIT-PASSUNG AN DEN KACHELN ════════════════════')
  /**
   * BIS ZUR TITELLISTE — und das sind DREI Ebenen, nicht eine.
   *
   * Ein Tipp auf eine gewoehnliche Album-Kachel STARTET die Wiedergabe; er
   * oeffnet nichts. Nur eine Spotify-Playlist und eine ARD-Sendung klappen
   * auf, und von aussen erkennt man sie an ihrem eigenen Play-Knopf
   * (`.tipp-spiel`). Derselbe Griff steht in beruehrziele-neu.mjs, aus
   * demselben Grund dort aufgeschrieben.
   *
   * ══ ES SIND ZWEI WEGE, UND SIE ENDEN VERSCHIEDEN ═══════════════════════
   * Und DAS ist der Grund, warum hier beide gefahren werden statt einer:
   *   ARD-SENDUNG   `GET /api/werke/<k>/inhalt` -> `dauerMs` je Folge, die
   *                 Laenge steht an der Kachel. Hier MUSS sie erscheinen.
   *   PLAYLIST      `GET /api/werke/<k>/alben` -> `stuecke` ohne Dauer. Hier
   *                 steht nichts, obwohl Spotify die Zahl kennt.
   * Wer nur den ersten Weg misst, haelt die Passung fuer fertig. Wer nur den
   * zweiten misst, haelt sie fuer kaputt. Beides waere falsch.
   */
  const bisZurTitelliste = async (wahl) => {
    await ev(`(() => {
      const k = [...document.querySelectorAll('#raster .kachel')]
        .filter((x) => x.querySelector('.tipp-spiel'))
        .find((x) => ${wahl})
      if (k) { k.scrollIntoView({ block: 'center' }); k.click(); return true }
      return false })()`)
    for (let n = 0; n < 16; n++) {
      await warte(250)
      if (await ev(`document.querySelectorAll('.lane-kachel').length > 0`)) break
    }
    const ok = await ev(`(() => {
      const k = document.querySelector('.lane-kachel')
      if (!k) return false
      k.scrollIntoView({ block: 'center' }); k.click(); return true })()`)
    for (let n = 0; n < 16; n++) {
      await warte(250)
      if (await ev(`document.querySelectorAll('.lane-kachel.stueck').length > 0`)) break
    }
    await ev(`(() => { const k = document.querySelector('.lane-kachel.stueck'); if (k) k.scrollIntoView({ block: 'center' }) })()`)
    await warte(400)
    return ok
  }
  const titellisteLesen = async () =>
    await ev(`(() => {
      const st = [...document.querySelectorAll('.lane-kachel.stueck')]
      return { zahl: st.length,
        mit: st.filter((k) => k.querySelector(':scope > .stueck-dauer')).length,
        rot: st.filter((k) => k.classList.contains('passt-nicht')).length,
        ohneDauer: st.filter((k) => !k.dataset.dauerMs).length,
        beispiel: st.slice(0, 3).map((k) => {
          const d = k.querySelector(':scope > .stueck-dauer')
          const b = d ? d.getBoundingClientRect() : null
          const kb = k.getBoundingClientRect()
          return { dauer: k.dataset.dauerMs || null, text: d ? d.textContent : null, lang: d ? d.classList.contains('zu-lang') : null,
                   hoehe: b ? Math.round(b.height) : 0, kachel: Math.round(kb.width) + 'x' + Math.round(kb.height),
                   marke: (k.getAttribute('aria-label') || '') }
        }) }
    })()`)

  // ── DER WEG, AUF DEM DIE LAENGE ANKOMMT: DIE ARD-SENDUNG ───────────────
  const reinArd = await bisZurTitelliste(`/ARD/i.test(x.getAttribute('aria-label') || '')`)
  const ard = await titellisteLesen()
  console.log('      ARD:  ' + JSON.stringify(ard))
  ja(reinArd === true, '[ARD] eine Titelliste laesst sich oeffnen')
  ja((ard?.zahl || 0) > 0, '[ARD] sie zeigt Folgen', `${ard?.zahl} Kacheln`)
  ja((ard?.mit || 0) > 0, '[ARD] und jede traegt ihre Laenge', `${ard?.mit} von ${ard?.zahl}`)
  ja((ard?.rot || 0) > 0, '[ARD] was nicht mehr in die Hoerzeit passt, steht rot', `${ard?.rot} von ${ard?.zahl}`)
  ja(
    (ard?.beispiel || []).some((b) => /passt heute nicht mehr/.test(b.marke)),
    '[ARD] und sagt es auch der Vorlesestimme',
    (ard?.beispiel || []).map((b) => b.marke.slice(0, 60)).join(' | '),
  )
  await bild('6-passung-ard-hell')
  await licht('dunkel')
  await bild('6-passung-ard-dunkel')
  await licht('hell')

  // ── DER WEG, AUF DEM SIE FEHLT: DIE PLAYLIST ───────────────────────────
  // Die Aussage ist hier ausdruecklich „es steht NICHTS da" und nicht „es
  // steht etwas Falsches da". Geraten wird nicht — das ist die Entscheidung,
  // die in app.js begruendet ist. Was fehlt, fehlt am SERVER; diese Zeile
  // haelt fest, dass es bis dahin still bleibt und nicht luegt.
  await laden()
  await warte(1800)
  const reinPl = await bisZurTitelliste(`!/ARD/i.test(x.getAttribute('aria-label') || '')`)
  const pl = await titellisteLesen()
  console.log('      Playlist:  ' + JSON.stringify(pl))
  ja(reinPl === true, '[Playlist] eine Titelliste laesst sich oeffnen')
  ja((pl?.zahl || 0) > 0, '[Playlist] sie zeigt Titel', `${pl?.zahl} Kacheln`)
  ja(
    (pl?.mit || 0) === 0 && (pl?.rot || 0) === 0,
    '[Playlist] ohne Laenge steht NICHTS da — geraten wird nicht',
    `${pl?.mit} Dauerzeilen, ${pl?.rot} rot bei ${pl?.zahl} Titeln`,
  )
  if ((pl?.ohneDauer || 0) === (pl?.zahl || 0)) {
    console.log(`      OFFEN: alle ${pl.zahl} Titel dieses Weges kommen OHNE Laenge an.`)
    console.log('             /api/werke/<k>/alben laesst `dauerMs` weg, obwohl Spotify sie kennt.')
    console.log('             Die Oberflaeche faengt es auf, sobald der Server es nachtraegt (src/, nicht hier).')
  }
  await bild('6-passung-playlist-hell')

  // DIE KACHEL BLEIBT EIN KNOPF. Das ist die halbe Entscheidung dieses
  // Stuecks: gekennzeichnet, nicht gesperrt. Waere sie `disabled`, waere aus
  // der Anzeige eine Erlaubnis geworden.
  await laden()
  await warte(1800)
  await bisZurTitelliste(`/ARD/i.test(x.getAttribute('aria-label') || '')`)
  const nochKnopf = await ev(`(() => {
    const k = document.querySelector('.lane-kachel.stueck.passt-nicht')
    if (!k) return null
    const b = k.getBoundingClientRect()
    return { tag: k.tagName.toLowerCase(), aus: !!k.disabled, zeiger: getComputedStyle(k).pointerEvents,
             w: Math.round(b.width), h: Math.round(b.height) }
  })()`)
  if (nochKnopf) {
    ja(nochKnopf.aus === false, 'eine Kachel, die nicht mehr passt, bleibt antippbar', JSON.stringify(nochKnopf))
    ja(nochKnopf.zeiger !== 'none', 'und sie nimmt Tipps an', `pointer-events: ${nochKnopf.zeiger}`)
    ja(schmalMm(nochKnopf) >= MARKE_MM, 'und sie bleibt gross genug', `${schmalMm(nochKnopf).toFixed(2)} mm`)
  } else {
    console.log('      (keine Kachel „passt nicht" in dieser Lage — nicht geprueft)')
  }

  // ════════════════════════════════════════════════════════════════════════
  // 7. LESBAR AUS EINEM HALBEN METER — IN BEIDEN STAENDEN
  // ════════════════════════════════════════════════════════════════════════
  //
  // WAS HIER GEMESSEN WIRD UND SONST NIRGENDS: die Farbe, die WIRKLICH
  // dasteht. Sie steht bei zwei der neuen Anzeigen nirgends im Stilblatt —
  // die blasse Titelzeile entsteht erst aus Schriftfarbe, `opacity` und dem
  // Untergrund, den erst der Baum verraet. Genau daran ist sie am 07.08.2026
  // vorbeigelaufen: 3,35 : 1 bei 11 px im hellen Stand, also im
  // Auslieferungszustand.
  //
  // BEIDE STAENDE, weil sie sich verschieden verhalten. Dieselbe Zeile ist im
  // dunklen Stand 5,36 : 1 und im hellen 3,35 — wer nur einen misst, misst
  // mit einer Wahrscheinlichkeit von der Haelfte gar nichts.
  console.log('\n══ 7. LESBAR AUS EINEM HALBEN METER ════════════════════════')
  const MESSSTELLEN = [
    ['#km-uhr', 'Uhrzeit oben'],
    ['#km-rest', 'Restzeit oben'],
    ['.lane-kachel.stueck.passt-nicht .lane-titel', 'Titel, der heute nicht mehr passt'],
    ['.lane-kachel.stueck.passt-nicht .stueck-dauer', 'die Laenge daneben'],
  ]
  const messen = async (wie, wahl, name) => {
    const m = await ev(`(() => {
        const e = document.querySelector(${JSON.stringify(wahl)})
        if (!e) return null
        const c = getComputedStyle(e)
        if (c.display === 'none' || e.hidden) return null
        let deckung = 1
        let n = e
        while (n && n !== document.documentElement) {
          deckung *= Number(getComputedStyle(n).opacity)
          n = n.parentElement
        }
        let grund = null
        n = e.parentElement
        while (n) {
          const f = getComputedStyle(n).backgroundColor
          if (f && f !== 'rgba(0, 0, 0, 0)' && f !== 'transparent') { grund = f; break }
          n = n.parentElement
        }
        return { farbe: c.color, grund, deckung, px: Number.parseFloat(c.fontSize), gewicht: c.fontWeight,
                 text: (e.textContent || '').trim().slice(0, 24) }
      })()`)
    if (!m || !rgb(m.farbe) || !rgb(m.grund)) {
      console.log(`      [${wie}] ${name}: steht in dieser Lage nicht da — nicht gemessen`)
      return
    }
    const v = ueber(rgb(m.farbe), rgb(m.grund), m.deckung)
    const k = kontrast(v, rgb(m.grund))
    const soll = schwelle(m.px, m.gewicht)
    ja(
      k >= soll,
      `[${wie}] „${name}" ist lesbar`,
      `${k.toFixed(2)} : 1 (verlangt ${soll}) — ${m.px} px, Deckung ${m.deckung.toFixed(2)}, „${m.text}"`,
    )
  }

  for (const wie of ['hell', 'dunkel']) {
    await licht(wie)
    await warte(400)
    for (const [wahl, name] of MESSSTELLEN) await messen(wie, wahl, name)
  }

  /* ── DIE RESTZEIT HAT ZWEI FARBEN, UND DIE RUHIGE IST DIE HAEUFIGE ───────
   *
   * Unter fuenf Minuten steht sie rot (`.knapp`), sonst in `--muted`. Die
   * Messung oben trifft nur die rote — sie laeuft in der Lage `kz-knapp`, die
   * fuer alles andere gebraucht wird. Damit bliebe genau die Farbe ungemessen,
   * die ein Kind an fast jedem Tag sieht.
   *
   * ES MUSS NEU GELADEN WERDEN und ein `stand()` reicht nicht: Der Stand der
   * Kinderzeit wird nur im Takt geholt (`kopfMitte.takt()`, 20 s). Wer die
   * Lage umstellt und eine Sekunde spaeter misst, misst die alte Antwort —
   * beim ersten Versuch stand hier weiter „noch 3 min". */
  await stand('kz-an')
  await laden()
  await warte(2000)
  const ruhig = await ev(`(() => {
    const r = document.getElementById('km-rest')
    return r && !r.hidden ? { text: (r.textContent || '').trim(), knapp: r.classList.contains('knapp') } : null
  })()`)
  console.log('      die ruhige Lage: ' + JSON.stringify(ruhig))
  ja(!!ruhig && ruhig.knapp === false, 'ueber fuenf Minuten steht die Restzeit RUHIG da und nicht rot', JSON.stringify(ruhig))
  /* ── UND DANEBEN DAS, WAS DORT SCHON IMMER STAND ─────────────────────────
   *
   * DAS IST KEINE ZUGABE, SONDERN DIE EINORDNUNG. Die ruhige Restzeit traegt
   * `--muted` — dieselbe Farbe wie die Zaehlzeile links neben ihr, wie jede
   * Unterzeile im Admin-Menue und wie die Laenge an einer Kachel. Faellt sie
   * durch, faellt nicht dieses eine Stueck durch, sondern eine Hausfarbe.
   *
   * DER UNTERSCHIED, DER TROTZDEM ZAEHLT: `kopf-unter` ist eine Fussnote
   * („14 von 14 Einträgen"), die Restzeit ist die Auskunft selbst. Dieselbe
   * Zahl bedeutet an den beiden Stellen nicht dasselbe.
   *
   * WER DIESE ZEILE EINES TAGES GRUEN MACHEN WILL, aendert `--muted` — und
   * dann diese Messstelle NICHT allein, sondern mit der daneben. Sie steht
   * hier, damit niemand die eine still lauter dreht und die andere vergisst. */
  for (const wie of ['hell', 'dunkel']) {
    await licht(wie)
    await warte(400)
    await messen(wie, '#km-rest', 'Restzeit oben, ruhige Lage')
    await messen(wie, '#kopf-unter', 'die Zaehlzeile daneben (dieselbe Hausfarbe)')
  }
  await licht('hell')

  console.log(`\n${fehler === 0 ? 'ALLES HAELT' : `${fehler} AUSSAGEN HALTEN NICHT`}`)
} finally {
  try {
    ws?.close()
  } catch {
    /* egal */
  }
  await browser.schliessen()
}
process.exit(fehler === 0 ? 0 : 1)
