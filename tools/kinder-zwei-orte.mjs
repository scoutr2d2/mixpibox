#!/usr/bin/env node
/**
 * ZWEI ORTE, EINE SACHE — laufen sie auseinander?
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 *
 * Seit dem 07.08.2026 fassen ZWEI Schirme Kinderprofile an:
 *   * das Profilfenster `#ich` (oben links, VOR der Sperre) — nur das Kind,
 *     das gerade dran ist;
 *   * die Seite Admin · System · Benutzer (HINTER dem Tor) — jedes Kind.
 * Genau an dieser Naht ist dieser Baum schon dreimal auseinandergelaufen
 * ([[drei-orte-eine-anzeige]]). Der Code sagt, dass beide durch DIESELBE
 * Funktion schreiben (`kinder.umbenennen`). Dieses Werkzeug prueft, ob das
 * auch am Schirm stimmt — und zwar an dem, was HINAUSGEHT, nicht an dem, was
 * im Code steht.
 *
 * DREI AUSSAGEN:
 *   1. Was im Profilfenster geaendert wird, steht danach im Admin-Menue.
 *   2. Was im Admin-Menue geaendert wird, steht danach im Profilfenster.
 *   3. UND DIE WEICHE STEHT AN EINER STELLE: Dasselbe Kind umbenennen geht
 *      ueber den SCHMALEN Weg (`POST /api/profil/name`), wenn es dran ist —
 *      und zwar VON BEIDEN SCHIRMEN AUS. Waere die Weiche im Schirm gebaut,
 *      schickte das Admin-Menue hier eine ganze Liste.
 *
 *   node tools/kinder-zwei-orte.mjs
 *   node tools/kinder-zwei-orte.mjs --ziel http://127.0.0.1:9611/neu/
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
  const laden = async () => {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(2400)
  }
  /** Mitschreiben, WAS hinausgeht — der einzige ehrliche Zeuge fuer die Weiche. */
  const lauschen = async () =>
    ev(`(() => {
      window.__weg = []
      // DAS ECHTE fetch MERKEN UND WIEDERVERWENDEN. Ohne das legt der zweite
      // Aufruf eine Huelle um die erste, und jeder Aufruf steht danach zweimal
      // in der Liste — eine Messung, die sich selbst verdoppelt.
      if (!window.__echtesFetch) window.__echtesFetch = window.fetch
      const alt = window.__echtesFetch
      window.fetch = function (u, o) {
        if (String(u).includes('/api/profil')) window.__weg.push(((o && o.method) || 'GET') + ' ' + String(u).replace(/^https?:\\/\\/[^/]+/, '') + ' ' + ((o && o.body) || ''))
        return alt.apply(this, arguments)
      }
      return true })()`)
  const gehoert = async () => JSON.parse((await ev(`JSON.stringify(window.__weg || [])`)) || '[]')
  const tastatur = async (wort) => {
    await ev(`(() => {
      const k = [...document.querySelectorAll('#tast-feld .tast-taste')].find((x) => x.dataset.taste === 'weg')
      for (let i = 0; i < 45; i++) k.click() })()`)
    for (const z of wort.toLowerCase()) {
      await ev(`(() => {
        const k = [...document.querySelectorAll('#tast-feld .tast-taste')].find((x) => x.dataset.taste === ${JSON.stringify(z)})
        if (k) k.click() })()`)
    }
    await ev(`(() => {
      const k = [...document.querySelectorAll('#tast-feld .tast-taste')].find((x) => x.dataset.taste === 'fertig')
      if (k) k.click() })()`)
    await warte(1000)
  }
  const tippen = async (name) => {
    const ok = await ev(`(() => {
      for (const z of document.querySelectorAll('#fach-zeilen .fach-zeile')) {
        const n = z.querySelector('.zeile-name')
        if (!n || !n.textContent.trim().startsWith(${JSON.stringify(name)})) continue
        const k = z.querySelector('.zeile-tat')
        if (k && !k.disabled) { k.click(); return true }
        if (z.tagName === 'BUTTON') { z.click(); return true }
      }
      return false })()`)
    await warte(700)
    return ok === true
  }
  const insMenue = async () => {
    await adminAuf(ev, { warteMs: 1100 })
    await ev(`document.querySelector('#eltern-faecher [data-fach="system"]').click()`)
    await warte(700)
    await tippen('Benutzer')
  }
  /**
   * WAS DAS ADMIN-MENUE ZEIGT — Ueberschrift UND Zeilen.
   *
   * BEIDES, WEIL DER NAME MAL HIER UND MAL DORT STEHT: Auf dem BLATT eines
   * Kindes traegt die Ueberschrift den Namen und die Zeilen heissen „Name",
   * „Bild", „… löschen"; in der LISTE ist es umgekehrt. Wer nur die Zeilen
   * liest, faende das aktive Kind nie wieder — bei ihm fehlt die Loeschzeile.
   */
  const menue = async () =>
    JSON.parse(
      (await ev(`JSON.stringify({
        kopf: (document.getElementById('fach-name') || {}).textContent || '',
        zeilen: [...document.querySelectorAll('#fach-zeilen .zeile-name')].map((n) => n.textContent),
      })`)) || '{}',
    )
  const stehtImMenue = async (name) => {
    const m = await menue()
    return { treffer: m.kopf.includes(name) || m.zeilen.some((z) => z.includes(name)), wie: `${m.kopf} | ${m.zeilen.join(' · ')}` }
  }
  /** Den Eltern-Bereich verlassen — so oft zurueck, bis er zu ist. */
  const hinaus = async () => {
    for (let i = 0; i < 6; i++) {
      if ((await ev(`document.body.classList.contains('eltern-offen')`)) !== true) return true
      await ev(`document.getElementById('zurueck').click()`)
      await warte(450)
    }
    return (await ev(`document.body.classList.contains('eltern-offen')`)) !== true
  }
  /** Die Namen, wie das PROFILFENSTER sie zeigt — plus die Zeile „Du bist …". */
  const namenImFenster = async () => {
    await ev(`document.getElementById('ich').click()`)
    await warte(800)
    return JSON.parse(
      (await ev(`JSON.stringify({
        du: (document.getElementById('ich-ueber-du') || {}).textContent || '',
        reihe: [...document.querySelectorAll('#ich-leute .ich-kachel')].map((k) => k.textContent),
      })`)) || '{}',
    )
  }

  await stand('sperre-aus')
  await stand('figuren-keine')
  await stand('profil-liam')

  // ══ 1. IM FENSTER GEAENDERT — STEHT ES IM MENUE? ══════════════════════
  console.log('\n══ 1. IM PROFILFENSTER GEAENDERT ═══════════════════════════')
  await laden()
  await lauschen()
  await ev(`document.getElementById('ich').click()`)
  await warte(800)
  await ev(`document.getElementById('ich-umbenennen').click()`)
  await warte(700)
  await tastatur('lasse')
  const wegAusFenster = await gehoert()
  ja(
    wegAusFenster.some((z) => z.startsWith('POST /api/profil/name')),
    'das Fenster nimmt den schmalen Weg',
    wegAusFenster.join(' | '),
  )
  ja(
    !wegAusFenster.some((z) => z.startsWith('PUT /api/profile')),
    'und KEINE ganze Liste — es steht vor der Sperre',
  )
  await ev(`document.getElementById('ich-fenster').hidden = true`)
  await insMenue()
  const imMenue = await stehtImMenue('lasse')
  ja(imMenue.treffer, 'derselbe Name steht im Admin-Menue', imMenue.wie)

  // ══ 2. IM MENUE GEAENDERT — STEHT ES IM FENSTER? ══════════════════════
  //
  // EIN ANDERES KIND, ausdruecklich: Kalea ist nicht dran, hier MUSS also die
  // Liste hinausgehen. Das Fenster muss den neuen Namen trotzdem zeigen — es
  // liest denselben Stand.
  console.log('\n══ 2. IM ADMIN-MENUE GEAENDERT (ein anderes Kind) ══════════')
  await tippen('Kalea')
  await tippen('Name')
  await tastatur('mira')
  const nachMenue = await stehtImMenue('mira')
  ja(nachMenue.treffer, 'das Blatt traegt den neuen Namen', nachMenue.wie)
  ja(await hinaus(), 'der Eltern-Bereich laesst sich verlassen')
  const imFenster = await namenImFenster()
  ja(
    (imFenster.reihe || []).some((n) => /mira/i.test(n)),
    'und das Profilfenster zeigt ihn auch',
    (imFenster.reihe || []).join(' · '),
  )
  ja(/lasse/i.test(imFenster.du || ''), 'die eigene Zeile steht weiter richtig da', imFenster.du)

  // ══ 3. DIE WEICHE STEHT AN EINER STELLE ═══════════════════════════════
  //
  // DIE EIGENTLICHE FRAGE. Benennt das ADMIN-MENUE das Kind um, das GERADE
  // DRAN ist, muss derselbe schmale Weg herausgehen wie im Profilfenster —
  // denn die Entscheidung faellt in `kinder.umbenennen` und nicht im Schirm.
  // Ginge hier eine Liste hinaus, gaebe es zwei Regelsaetze fuer dieselbe
  // Datei, und der naechste Umbau brauchte nur einen davon zu vergessen.
  console.log('\n══ 3. DIE WEICHE — dasselbe Kind, der andere Schirm ════════')
  await ev(`document.getElementById('ich-fenster').hidden = true`)
  await lauschen()
  await insMenue()
  await tippen('lasse')
  await tippen('Name')
  await tastatur('bo')
  const wegAusMenue = (await gehoert()).filter((z) => !z.startsWith('GET'))
  ja(
    wegAusMenue.some((z) => z.startsWith('POST /api/profil/name')),
    'auch das Admin-Menue nimmt fuer das AKTIVE Kind den schmalen Weg',
    wegAusMenue.join(' | '),
  )
  ja(
    !wegAusMenue.some((z) => z.startsWith('PUT /api/profile')),
    'und schickt dafuer KEINE ganze Liste — die Weiche steht in `kinder`, nicht im Schirm',
  )
  const zumSchluss = await stehtImMenue('bo')
  ja(zumSchluss.treffer, 'und der Name steht da', zumSchluss.wie)

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
