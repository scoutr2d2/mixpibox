#!/usr/bin/env node
/**
 * DER TIPP, DEN NUR DER SCHIRM KENNT — die Schreibschlange der Medienauswahl.
 *
 * ══ WORUM ES GEHT ═════════════════════════════════════════════════════════
 *
 * Auf dem Schirm „Medien für <Kind>" laeuft der Schirm dem Server absichtlich
 * voraus: Ein Tipp faerbt die Zeile sofort und schickt erst danach
 * `PUT /api/profil/auswahl`. Damit fuenf schnelle Tipps nicht fuenf gleichzeitige
 * Schreibvorgaenge auf DIESELBE Datei werden, laeuft immer nur EINER, und wer
 * waehrenddessen tippt, hinterlaesst nur die Notiz „es braucht noch einen"
 * (`auswahlNochmal`). Danach wird der GANZE Stand geschickt.
 *
 * DIE LUECKE, DIE DAS LAESST: Die Notiz sagt „noch einen", aber nicht, WAS.
 * Der Nachschlag las den Stand aus `kindAuswahl` — also aus dem SCHIRM. Ist
 * der inzwischen weitergeblaettert (`blattRaeumen()` setzt `kindAuswahl` beim
 * Verlassen des Fachs auf `null`), findet er nichts mehr und BRICHT AB. Der
 * zweite Tipp ist dann gefaerbt gewesen, in der Box aber nie angekommen — und
 * nichts sagt es. Genau die Sorte Falschauskunft, vor der der Kommentar an
 * dieser Stelle selbst warnt.
 *
 * WIE WAHRSCHEINLICH: Es braucht zwei Tipps und einen Ebenenwechsel innerhalb
 * EINES Schreibvorgangs. Auf einem gesunden Pi sind das Millisekunden — auf
 * einer SD-Karte, die gerade einen Medienlauf wegschreibt, sind es hunderte.
 * Der Schaden ist still und dauerhaft: Wer „Bibi 4" dazunimmt und weiterblaettert,
 * hat sie nicht dazugenommen und sieht es erst, wenn das Kind fragt.
 *
 * ══ WAS DIESES WERKZEUG TUT ═══════════════════════════════════════════════
 *
 * Es HAELT den ersten PUT im Browser fest (`window.fetch` umgehaengt), tippt
 * waehrenddessen den zweiten Eintrag an, blaettert aus dem Fach heraus und
 * laesst den PUT erst dann los. Danach fragt es die Box, was wirklich
 * angekommen ist. Kein Nachbau der Funktion — die echte Seite, die echten
 * Routen, nur die Zeit angehalten.
 *
 * AUFRUF:
 *   node tools/auswahl-schreibstau-probe.mjs
 *   node tools/auswahl-schreibstau-probe.mjs --ziel http://127.0.0.1:9811/neu/
 * ENDE 0, wenn beide Tipps in der Box angekommen sind.
 */
import { spawn } from 'node:child_process'
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
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

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
  const bis = Date.now() + 10000
  for (;;) {
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
 * DIE ZEIT ANHALTEN — aber nur fuer den einen Weg, um den es geht.
 *
 * Nur `PUT …/profil/auswahl` wird festgehalten. Wuerde hier jeder Abruf
 * haengen, staende auch der GET beim Aufschlagen still und die Seite kaeme gar
 * nicht erst in den Zustand, den dieser Lauf messen will.
 */
const STAU_AN = `(() => {
  const echt = window.fetch
  window.__stau = { haltend: [], zahl: 0, koerper: [], frei: false }
  window.fetch = function (u, o) {
    const s = String(u && u.url ? u.url : u)
    if (o && String(o.method).toUpperCase() === 'PUT' && s.indexOf('/profil/auswahl') >= 0) {
      window.__stau.zahl++
      window.__stau.koerper.push(String(o.body || ''))
      // NUR DER ERSTE WIRD FESTGEHALTEN. Wer danach kommt, geht durch —
      // sonst hielte dieses Werkzeug den NACHSCHLAG fest und maesse seinen
      // eigenen Griff statt der Luecke in der Seite. Genau daran ist der
      // erste Anlauf am 07.08.2026 gescheitert.
      if (window.__stau.frei) return echt(u, o)
      return new Promise((ok, no) => { window.__stau.haltend.push(() => echt(u, o).then(ok, no)) })
    }
    return echt(u, o)
  }
  return true })()`

const browser = await eigenerBrowser({ fenster: '800,480' })
if (!browser) {
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}
let ws = null
try {
  ws = new WebSocket(await browser.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })

  const ev = async (e) =>
    (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.value
  const stand = async (w) => {
    await fetch(new URL(`/vorschau/${w}`, ZIEL)).catch(() => null)
    await warte(120)
  }
  const tippen = async (name, ms = 400) => {
    const ok = await ev(`(() => {
      for (const z of document.querySelectorAll('#fach-zeilen .fach-zeile')) {
        const n = z.querySelector('.zeile-name')
        if (!n || !n.textContent.trim().startsWith(${JSON.stringify(name)})) continue
        const k = z.querySelector('.zeile-tat')
        if (k && !k.disabled) { k.click(); return true }
        if (z.tagName === 'BUTTON') { z.click(); return true }
      }
      return false })()`)
    await warte(ms)
    return ok === true
  }
  const auswahlDerBox = async (kennung) => {
    const a = await fetch(new URL(`/api/profil/auswahl?profil=${kennung}`, ZIEL)).then((r) => r.json())
    return Array.isArray(a.werke) ? a.werke : []
  }

  // ── Die Ausgangslage: Liam, ohne Auswahl, mit der grossen Bibliothek ──────
  await stand('sperre-aus')
  await stand('figuren-keine')
  await stand('profil-liam')
  await stand('bibliothek-viele')
  await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
  await warte(2200)
  await adminAuf(ev, { warteMs: 1100 })
  await ev(`document.querySelector('#eltern-faecher [data-fach="system"]').click()`)
  await warte(700)
  await tippen('Benutzer', 700)
  await tippen('Liam', 700)
  await tippen('Medien', 900)

  const kopf = await ev(`(document.getElementById('fach-name') || {}).textContent || ''`)
  ja(/Medien für/.test(kopf), 'der Schirm „Medien für …" steht da', kopf)

  const namen = await ev(`(() => [...document.querySelectorAll('#fach-zeilen .fach-zeile .zeile-name')]
    .map((n) => n.textContent.trim()).filter((n) => n.indexOf('Bibi') === 0).slice(0, 2))()`)
  ja(Array.isArray(namen) && namen.length === 2, 'zwei Eintraege zum Antippen gefunden', (namen || []).join(' · '))
  if (!Array.isArray(namen) || namen.length < 2) throw new Error('die Vorschau liefert zu wenige Eintraege')

  ja((await auswahlDerBox('liam')).length === 0, 'Liam faengt ohne Auswahl an — der Zustand jeder bestehenden Box')

  // ── Die Zeit anhalten und die drei Griffe tun ────────────────────────────
  ja((await ev(STAU_AN)) === true, 'der PUT laesst sich festhalten')

  await tippen(namen[0], 500) //  Tipp 1 — der PUT geht los und bleibt haengen
  await tippen(namen[1], 500) //  Tipp 2 — er kann nur vorgemerkt werden
  const gehalten = await ev(`window.__stau.zahl`)
  ja(gehalten === 1, 'genau EIN Schreibvorgang ist unterwegs — der zweite Tipp ist vorgemerkt', `${gehalten} PUT`)

  // WEITERGEBLAETTERT, BEVOR DER SCHREIBVORGANG ZURUECK IST. Das ist der
  // ganze Trick: `blattRaeumen()` setzt `kindAuswahl` auf null, und der
  // Nachschlag hatte sich nichts als den Schirm gemerkt.
  await ev(`document.querySelector('#eltern-faecher [data-fach="anzeige"]').click()`)
  await warte(400)
  const wegKopf = await ev(`(document.getElementById('fach-name') || {}).textContent || ''`)
  ja(!/Medien für/.test(wegKopf), 'aus dem Fach „Kinder" herausgeblaettert — der Schirm traegt einen anderen Namen', wegKopf)

  await ev(`(() => {
    window.__stau.frei = true
    const h = window.__stau.haltend
    window.__stau.haltend = []
    h.forEach((f) => f())
    return h.length })()`)
  await warte(1500)

  // ── Was ist wirklich angekommen? ─────────────────────────────────────────
  const inDerBox = await auswahlDerBox('liam')
  const puts = await ev(`window.__stau.zahl`)
  console.log(`      in der Box: ${JSON.stringify(inDerBox)}  (${puts} PUT insgesamt)`)
  ja(
    inDerBox.length === 2,
    'BEIDE Tipps sind in der Box angekommen — ein vorgemerkter Stand darf nicht mit dem Schirm verfallen',
    `${inDerBox.length} von 2`,
  )
} finally {
  try {
    ws?.close()
  } catch {
    /* egal */
  }
  await browser.schliessen?.()
}

console.log(fehler ? `\n${fehler} Aussage(n) haelt nicht.` : '\nJede Aussage haelt.')
process.exit(fehler ? 1 : 0)
