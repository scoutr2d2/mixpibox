#!/usr/bin/env node
/**
 * DAS PROFILFENSTER ALS ORT DES KINDES — „Du bist …" und der Griff am Namen.
 *
 * ══ WOZU, UND WARUM NICHT ich-zeichen-schau.mjs ════════════════════════════
 *
 * Jenes misst das ZEICHEN oben links: welches Bild dort steht, ob es geladen
 * ist, wann die Silhouette erscheint, wer es verdeckt. Es fragt nichts ueber
 * das, was am 07.08.2026 dazugekommen ist: dass sich das Kind in diesem
 * Fenster SEINEN NAMEN aendern kann — und ausdruecklich sonst nichts.
 *
 * DIE FRAGE, DIE DIESES WERKZEUG WIRKLICH STELLT, ist nicht „geht es?",
 * sondern „geht NUR DAS?". Dieses Fenster steht VOR jeder Sperre; jedes Kind
 * kommt hinein. Ein Weg von hier zu einem Geschwisterprofil waere kein
 * Schoenheitsfehler, sondern ein Loch — und ein Loch, das man am Schirm nicht
 * sieht, weil dort ja gar kein Knopf dafuer steht. Gemessen wird deshalb der
 * ABRUF, der hinausgeht, und nicht die Zahl der Knoepfe:
 *
 *     erlaubt   POST /api/profil/name   {name}      — Besitzer vom Server
 *     erlaubt   POST /api/profil/figur  {figur}     — dito
 *     erlaubt   POST /api/profil/aktiv  {kennung}   — umschalten
 *     VERBOTEN  PUT  /api/profile                   — die GANZE Liste
 *
 * Der letzte ist der, um den es geht: Wer die Liste schickt, kann Geschwister
 * umbenennen — und wer einen Eintrag WEGLAESST, loescht ihn.
 *
 * ══ UND DIE ZWEITE FRAGE: BLEIBT PLATZ FUER DIE BILDER ═════════════════════
 * Die neue Zeile kostet Hoehe in einem Fenster, dessen Zweck das Bilderraster
 * ist. Gemessen wird der schlimmste Fall, den es geben kann: drei Profile UND
 * zehn Figuren (`/vorschau/figuren-da`).
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/ich-bearbeiten-schau.mjs
 *   node tools/ich-bearbeiten-schau.mjs --ziel http://127.0.0.1:9601/neu/
 *   node tools/ich-bearbeiten-schau.mjs --bilder /tmp/ich
 * ENDE 0, wenn jede Aussage haelt.
 */
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { eigenerBrowser, freierPort } from './leihgabe.mjs'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  return i < 0 ? v : argv[i + 1]
}
const BILDER = opt('bilder')
const warte = (ms) => new Promise((r) => setTimeout(r, ms))
/** Der Schirm der Box: 800x480 auf 5 Zoll = 0,1397 mm je Bildpunkt. */
const MM = 0.1397

let fehler = 0
const ja = (b, satz, wie = '') => {
  if (!b) fehler++
  console.log(`${b ? 'ok  ' : 'FEHL'}  ${satz}${wie ? `  — ${wie}` : ''}`)
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
 * DER MITSCHREIBER FUER `fetch` — die Frage „WELCHER Abruf geht hinaus?"
 * laesst sich am Schirm nicht ansehen.
 *
 * Er merkt sich auch den RUMPF. Ohne ihn saehe `POST /api/profil/name` mit
 * einer fremden Kennung darin genauso aus wie einer ohne — und genau das ist
 * der Unterschied, um den es hier geht.
 */
const MITSCHREIBER = `(() => {
  if (window.__rufe) return true
  window.__rufe = []
  const echt = window.fetch
  window.fetch = function (u, o) {
    try {
      window.__rufe.push({
        pfad: String(typeof u === 'string' ? u : (u && u.url) || ''),
        art: (o && o.method) || 'GET',
        rumpf: (o && typeof o.body === 'string') ? o.body.slice(0, 200) : '',
      })
    } catch { /* ein Abruf, den wir nicht lesen koennen, wird nicht gezaehlt */ }
    return echt.apply(this, arguments)
  }
  return true
})()`

/** Was im Fenster steht und wie hoch es baut. */
const FENSTER_JS = `(() => {
  const blatt = document.getElementById('ich-blatt')
  if (!blatt) return null
  const bb = blatt.getBoundingClientRect()
  const knopf = document.getElementById('ich-umbenennen')
  const kb = knopf ? knopf.getBoundingClientRect() : null
  const ganz = (e) => {
    if (!e) return 0
    const b = e.getBoundingClientRect()
    return Math.round(Math.max(0, Math.min(b.bottom, bb.bottom) - Math.max(b.top, bb.top)))
  }
  const kacheln = [...document.querySelectorAll('#ich-bilder .ich-kachel')]
  return {
    du: (document.getElementById('ich-ueber-du') || {}).textContent || '',
    knopfWort: knopf ? knopf.textContent.trim() : '',
    knopfDa: !!knopf && !!kb && kb.width > 0 && kb.height > 0,
    knopfHoch: kb ? Math.round(kb.height) : 0,
    knopfBreit: kb ? Math.round(kb.width) : 0,
    knopfRechts: kb ? Math.round(kb.right) : 0,
    blattRechts: Math.round(bb.right),
    werDa: !document.getElementById('ich-teil-wer').hidden,
    leute: document.querySelectorAll('#ich-leute .ich-kachel').length,
    bilder: kacheln.length,
    bilderGanz: kacheln.filter((k) => ganz(k) >= k.getBoundingClientRect().height - 1).length,
    rollt: blatt.scrollHeight > blatt.clientHeight + 1,
    sicht: Math.round(blatt.clientHeight),
    inhalt: Math.round(blatt.scrollHeight),
    zeichenOben: (() => {
      const b = document.getElementById('ich-bild')
      return b && !b.hidden ? b.getAttribute('src') || '' : ''
    })(),
  }
})()`

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
    await warte(2200)
    await ev(MITSCHREIBER)
  }
  const fensterAuf = async () => {
    await ev(`document.getElementById('ich').click()`)
    await warte(900)
  }
  /** Auf der Bildschirmtastatur tippen und „Fertig" druecken. */
  const tastatur = async (wort) => {
    for (const z of wort.toLowerCase()) {
      const t = await ev(`(() => {
        const k = [...document.querySelectorAll('#tast-feld .tast-taste')]
          .find((x) => x.dataset.taste === ${JSON.stringify(z)})
        if (!k) return false
        k.click(); return true })()`)
      if (t !== true) return false
    }
    await ev(`(() => {
      const k = [...document.querySelectorAll('#tast-feld .tast-taste')].find((x) => x.dataset.taste === 'fertig')
      if (k) k.click() })()`)
    await warte(900)
    return true
  }
  const leeren = async () => {
    await ev(`(() => {
      const k = [...document.querySelectorAll('#tast-feld .tast-taste')].find((x) => x.dataset.taste === 'weg')
      for (let i = 0; i < 45; i++) k.click() })()`)
  }
  const rufe = async () => (await ev(`window.__rufe || []`)) || []
  const rufeLeeren = async () => {
    await ev(`(() => { if (window.__rufe) window.__rufe.length = 0 })()`)
  }

  // ══ 1. DER HEUTIGE STAND DER BOX: NUR DER GAST ════════════════════════
  //
  // Er ist KEIN Randfall — es ist der Zustand jeder ausgelieferten Box. Wer
  // nur den Fall mit drei Kindern ansieht, prueft eine Oberflaeche, die es
  // draussen noch gar nicht gibt.
  console.log('\n══ NUR DER GAST — der heutige Stand jeder Box ═══════════════')
  await stand('profil-allein')
  await stand('figuren-keine')
  await laden()
  await fensterAuf()
  let f = await ev(FENSTER_JS)
  ja(f.du === 'Du bist Gast', 'die erste Zeile sagt, wer gemeint ist', f.du)
  ja(f.knopfDa, 'und der Griff am Namen steht daneben', f.knopfWort)
  ja(f.knopfHoch * MM >= 9, 'er haelt die 9-mm-Marke', `${f.knopfHoch} px = ${(f.knopfHoch * MM).toFixed(2)} mm`)
  ja(!f.werDa, 'die Profilreihe fehlt — eine Wahl ohne Alternative waere keine')
  ja(f.bilder >= 1, 'die Bildauswahl steht trotzdem da', `${f.bilder} Kachel(n)`)
  ja(!f.rollt, 'und das Blatt rollt nicht', `${f.inhalt} in ${f.sicht} px`)
  await bild('1-allein')

  // ══ 2. DER NAME LAESST SICH AENDERN ═══════════════════════════════════
  console.log('\n══ DER NAME — und NUR der Name ════════════════════════════')
  await rufeLeeren()
  await ev(`document.getElementById('ich-umbenennen').click()`)
  await warte(500)
  ja((await ev(`!document.getElementById('tastatur').hidden`)) === true, 'die Bildschirmtastatur geht auf')
  ja(
    (await ev(`document.getElementById('tast-anzeige').textContent`)) === 'Gast',
    'und sie steht auf dem bisherigen Namen — nicht leer',
  )
  await bild('2-name-tippen')
  await leeren()
  ja(
    (await ev(`document.querySelector('#tast-feld .tast-fertig').disabled`)) === true,
    '„Fertig" ist bei leerem Feld gesperrt — ein leerer Name wuerde zur Kennung',
  )
  ja((await tastatur('wir')) === true, 'ein Name laesst sich tippen')
  f = await ev(FENSTER_JS)
  ja(f.du === 'Du bist wir', 'die Zeile traegt ihn sofort', f.du)
  const stand1 = await ev(`(async () => {
    const r = await fetch('/api/profile'); const d = await r.json()
    return d.profile.map((p) => p.kennung + '=' + p.name).join(' · ') })()`)
  ja(/gast=wir/.test(String(stand1)), 'und die Box hat ihn gespeichert', String(stand1))

  const hinaus = (await rufe()).filter((r) => r.art !== 'GET')
  console.log(`      hinausgegangen: ${hinaus.map((r) => `${r.art} ${r.pfad} ${r.rumpf}`).join(' | ') || '—'}`)
  ja(
    hinaus.some((r) => r.art === 'POST' && /\/profil\/name$/.test(r.pfad)),
    'der schmale Weg wurde genommen',
  )
  ja(!hinaus.some((r) => r.art === 'PUT'), 'und KEIN PUT auf die ganze Liste — dieses Fenster steht vor der Sperre')
  ja(
    !hinaus.some((r) => /kennung/.test(r.rumpf)),
    'im Rumpf steht keine Kennung — der Besitzer kommt vom Server',
    hinaus.map((r) => r.rumpf).join(' '),
  )
  await bild('3-umbenannt')

  // ══ 3. DREI KINDER UND ZEHN FIGUREN — der engste Fall ═════════════════
  console.log('\n══ DREI KINDER, ZEHN FIGUREN — bleibt Platz fuer die Bilder? ')
  await stand('profil-liam')
  await stand('figuren-da')
  await laden()
  await fensterAuf()
  f = await ev(FENSTER_JS)
  ja(f.du === 'Du bist Liam', 'die Zeile nennt das Kind, das dran ist', f.du)
  ja(f.werDa && f.leute === 3, 'die Profilreihe steht daneben — Wechseln bleibt, wie es war', `${f.leute} Kacheln`)
  ja(f.bilder === 11, 'und alle elf Bildkacheln sind da (MixPi + zehn Figuren)', `${f.bilder}`)
  console.log(
    `      Blatt: ${f.inhalt} px Inhalt in ${f.sicht} px Sicht  →  ${f.rollt ? 'rollt' : 'rollt nicht'}; ` +
      `${f.bilderGanz} von ${f.bilder} Kacheln ganz im Bild`,
  )
  ja(f.bilderGanz >= 4, 'mindestens eine ganze Reihe Bilder steht ohne Rollen da', `${f.bilderGanz} Kacheln`)
  // ── WAS DIE NEUE ZEILE WIRKLICH KOSTET ────────────────────────────────
  // Gemessen, indem sie kurz weggeblendet wird — nicht gerechnet. Die Frage
  // dahinter ist nicht „rollt es?", sondern „rollt es WEGEN DIESER ZEILE?".
  // Drei Profile und zehn Figuren sprengen das Blatt ohnehin; die Zeile macht
  // es um ihre eigene Hoehe schlimmer und nicht um mehr.
  const ohne = await ev(`(() => {
    const k = document.querySelector('.ich-kopf'); const b = document.getElementById('ich-blatt')
    const vorher = b.scrollHeight
    k.style.display = 'none'
    const nachher = b.scrollHeight
    k.style.display = ''
    return { vorher: Math.round(vorher), nachher: Math.round(nachher) } })()`)
  console.log(`      ohne die neue Zeile waeren es ${ohne.nachher} px — sie kostet ${ohne.vorher - ohne.nachher} px`)
  ja(
    ohne.nachher > f.sicht,
    'das Blatt rollte in diesem Fall SCHON VORHER — die Zeile ist nicht die Ursache',
    `${ohne.nachher} px Inhalt in ${f.sicht} px Sicht`,
  )
  await bild('4-drei-kinder-zehn-figuren')

  // ══ 4. EIN LANGER NAME ════════════════════════════════════════════════
  console.log('\n══ EIN LANGER NAME SPRENGT DAS BLATT NICHT ════════════════')
  await ev(`document.getElementById('ich-umbenennen').click()`)
  await warte(400)
  await leeren()
  await tastatur('wilhelminadorothea')
  f = await ev(FENSTER_JS)
  ja(/wilhelminadorothea/.test(f.du), 'der ganze Name steht da — nicht mit „…" abgeschnitten', f.du)
  ja(f.knopfRechts <= f.blattRechts, 'und der Knopf bleibt IM Blatt', `${f.knopfRechts} <= ${f.blattRechts} px`)
  ja(f.knopfHoch * MM >= 9, 'er haelt weiter die 9-mm-Marke', `${(f.knopfHoch * MM).toFixed(2)} mm`)
  await bild('5-langer-name')

  // ══ 5. DAS UMSCHALTEN IST UNVERAENDERT ════════════════════════════════
  //
  // Es war schon da, und der Wunsch des Betreibers lautete „bearbeiten ODER
  // wechseln" — nicht „bearbeiten statt wechseln". Ein Umbau, der das
  // Vorhandene nebenbei kaputtmacht, ist hier die naheliegende Gefahr.
  console.log('\n══ WECHSELN GEHT WEITER ═══════════════════════════════════')
  await rufeLeeren()
  await ev(`(() => {
    const k = [...document.querySelectorAll('#ich-leute .ich-kachel')]
      .find((x) => (x.textContent || '').includes('Kalea'))
    if (k) k.click() })()`)
  await warte(600)
  // GEPRUEFT WIRD AM SERVER UND NICHT AM MITSCHREIBER: `werWaehlen` laedt bei
  // Erfolg die Seite NEU (an der Kennung haengt der ganze Namensraum im
  // Browserspeicher). Mit der Seite geht auch `window.__rufe` — wer dort
  // nachsaehe, faende NICHTS und hielte das fuer „nicht umgeschaltet".
  await warte(1500)
  const aktiv = await ev(`(async () => {
    const r = await fetch('/api/profile'); const d = await r.json(); return d.aktiv })()`)
  ja(aktiv === 'kalea', 'ein Tipp auf ein anderes Kind schaltet um', String(aktiv))
  ja(
    (await ev(`typeof window.__rufe`)) === 'undefined',
    'und die Seite wird dabei neu geladen — der Namensraum haengt am Profil',
  )

  console.log(fehler === 0 ? '\nALLES GRUEN' : `\n${fehler} Aussage(n) halten nicht`)
} finally {
  try {
    ws?.close()
  } catch {
    /* egal */
  }
  await browser.schliessen?.()
}
process.exit(fehler === 0 ? 0 : 1)
