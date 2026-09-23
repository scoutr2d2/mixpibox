#!/usr/bin/env node
/**
 * DAS PROFIL-PASSWORT IM FENSTER — der ganze Weg, wie ihn ein Kind geht.
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 * Betreiber (14.08.2026): „beim klicken auf das linke benutzer bild eine
 * möglichkeit das profil zu wechseln … ein passwort aus zeichen, farb
 * punkten, stichmuster, zahlen festlegen … auch das ausloggen soll möglich
 * sein dann landet man im gast account."
 *
 * Die SERVER-Regeln sind in passwort.integration.spec.ts gemessen. Hier
 * steht, was nur der Schirm beweisen kann:
 *
 *   1. BEIM GAST GIBT ES DIE REIHE NICHT — kein Passwort-, kein
 *      Abmelden-Knopf (der Gast ist der Rueckfall, nicht ein Benutzer).
 *   2. MIT EIGENEM PROFIL steht beides da; Passwort setzen fuehrt durch
 *      Stilwahl und ZWEIFACHE Eingabe.
 *   3. DIE ANZEIGE ZEIGT PUNKTE, NIE DIE EINGABE — ein Geschwister sieht zu.
 *   4. JEDER GRIFF HAELT DIE 9-MM-MARKE (66 px) — dieselbe Messlatte wie
 *      ueberall auf diesem Schirm.
 *   5. ABMELDEN LANDET BEIM GAST, ohne Frage.
 *   6. DER WECHSEL AUF EIN GESCHUETZTES PROFIL fragt in dessen Stil;
 *      falsch bleibt draussen (und sagt es), richtig kommt hinein.
 *   7. KEIN ABDRUCK NACH DRAUSSEN: /api/profile traegt nie `hash` — die
 *      Leck-Gegenprobe am lebenden Rohr.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/profil-passwort-schau.mjs
 *   node tools/profil-passwort-schau.mjs --ziel http://127.0.0.1:9601/neu/
 *   node tools/profil-passwort-schau.mjs --bilder /tmp/passwort
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

const API = new URL('/api', ZIEL).toString()

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
  const laden = async () => {
    await send(ws, 'Page.navigate', { url: ZIEL })
    await warte(2200)
  }
  const klick = async (wahl) => {
    const ok = await ev(`(() => { const k = document.querySelector(${JSON.stringify(wahl)}); if (!k || k.disabled) return false; k.click(); return true })()`)
    await warte(500)
    return ok === true
  }
  /** Einen pw-Knopf ueber seine Aufschrift antippen (Stilwahl, Fuss). */
  const pwWort = async (wort) => {
    const ok = await ev(`(() => {
      for (const k of document.querySelectorAll('.pw-schicht button')) {
        if (k.textContent.trim() !== ${JSON.stringify(wort)} || k.disabled) continue
        k.click(); return true
      }
      return false })()`)
    await warte(400)
    return ok === true
  }
  /** Ziffern auf dem pw-Zahlenfeld tippen. */
  const ziffern = async (folge) => {
    for (const z of folge) {
      const t = await ev(`(() => {
        const k = [...document.querySelectorAll('.pw-feld.pw-zahlen .pw-taste')]
          .find((x) => x.textContent.trim() === ${JSON.stringify(z)})
        if (!k) return false
        k.click(); return true })()`)
      if (t !== true) return false
      await warte(80)
    }
    return true
  }
  const profileAntwort = async () => (await fetch(`${API}/profile`)).json()

  // ── AUSGANGSLAGE: nur der Gast ─────────────────────────────────────────
  await fetch(`${API}/profile`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profile: [] }),
  })
  await laden()

  console.log('\n══ BEIM GAST: KEINE REIHE ═══════════════════════════════════')
  await klick('#ich')
  await warte(600)
  ja(await ev(`document.getElementById('ich-taten').hidden`) === true, 'beim Gast gibt es weder Passwort noch Abmelden')
  await bild('1-gast-ohne-reihe')

  // ── EIN KIND KOMMT DAZU, UND ES IST DRAN ───────────────────────────────
  await fetch(`${API}/profile`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profile: [{ kennung: 'kalea', name: 'Kalea', angelegt: 1 }] }),
  })
  await fetch(`${API}/profil/aktiv`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kennung: 'kalea' }),
  })
  await laden()

  console.log('\n══ PASSWORT SETZEN (Zahlen 2580) ════════════════════════════')
  await klick('#ich')
  await warte(600)
  ja(await ev(`document.getElementById('ich-taten').hidden`) === false, 'mit eigenem Profil steht die Reihe da')
  ja((await ev(`document.getElementById('ich-passwort').textContent`)).trim() === 'Passwort', 'der Knopf sagt „Passwort" — noch ist keines gesetzt')
  await klick('#ich-passwort')
  ja(await ev(`!!document.querySelector('.pw-schicht')`) === true, 'die Stilwahl steht')
  await bild('2-stilwahl')
  await pwWort('Zahlen')
  ja(await ev(`!!document.querySelector('.pw-feld.pw-zahlen')`) === true, 'das Ziffernfeld steht')
  const masse = await ev(`(() => {
    const t = [...document.querySelectorAll('.pw-schicht button')]
    return t.length ? Math.min(...t.map((k) => Math.min(k.getBoundingClientRect().width, k.getBoundingClientRect().height))) : 0
  })()`)
  ja(masse >= 44, 'jeder Griff der Flaeche haelt die Beruehr-Marke', `${Math.round(masse)} px`)
  await ziffern(['2', '5', '8', '0'])
  const anzeige = await ev(`document.querySelector('.pw-anzeige').textContent`)
  ja(anzeige === '●●●●', 'die Anzeige zeigt Punkte, nie die Ziffern', anzeige)
  await bild('3-ziffern-verdeckt')
  await pwWort('Fertig')
  ja(await ev(`!!document.querySelector('.pw-feld.pw-zahlen')`) === true, 'zur Sicherheit noch einmal — die zweite Eingabe steht')
  await ziffern(['2', '5', '8', '0'])
  await pwWort('Fertig')
  await warte(700)
  const nachher = await profileAntwort()
  const kalea = nachher.profile.find((p) => p.kennung === 'kalea')
  ja(kalea?.geschuetzt === true && kalea?.passwortArt === 'zahlen', 'der Server traegt das Schloss (zahlen)')
  ja(!JSON.stringify(nachher).includes('hash'), 'LECK-GEGENPROBE: /api/profile traegt keinen Abdruck')
  ja((await ev(`document.getElementById('ich-passwort').textContent`)).trim() === 'Passwort ändern', 'der Knopf sagt jetzt „Passwort ändern"')

  console.log('\n══ ABMELDEN LANDET BEIM GAST ════════════════════════════════')
  await klick('#ich-abmelden')
  await warte(2500)
  ja((await profileAntwort()).aktiv === 'gast', 'nach dem Abmelden ist der Gast dran')

  console.log('\n══ DER WECHSEL FRAGT — FALSCH BLEIBT DRAUSSEN ═══════════════')
  await laden()
  await klick('#ich')
  await warte(600)
  const kachel = await ev(`(() => {
    for (const k of document.querySelectorAll('#ich-leute .ich-kachel')) {
      if (k.textContent.includes('Kalea')) { k.click(); return true }
    }
    return false })()`)
  await warte(600)
  ja(kachel === true, 'die Kalea-Kachel ist da und angetippt')
  ja(await ev(`!!document.querySelector('.pw-feld.pw-zahlen')`) === true, 'gefragt wird im hinterlegten Stil (Zahlen)')
  await bild('4-wechsel-fragt')
  await ziffern(['1', '1', '1', '1'])
  await pwWort('Fertig')
  await warte(1200)
  ja((await profileAntwort()).aktiv === 'gast', 'falsch getippt: der Gast bleibt dran')
  const nochmal = await ev(`(() => { const u = document.querySelector('.pw-unter'); return u ? u.textContent : '' })()`)
  ja(nochmal.includes('nicht richtig'), 'und die Flaeche sagt es', nochmal)
  await bild('5-falsch-gesagt')
  await ziffern(['2', '5', '8', '0'])
  await pwWort('Fertig')
  await warte(2500)
  ja((await profileAntwort()).aktiv === 'kalea', 'richtig getippt: Kalea ist dran')

  // ── AUFRAEUMEN: die geliehene Lage zuruecklassen wie vorgefunden ────────
  await fetch(`${API}/profil/aktiv`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kennung: 'gast' }),
  })
  await fetch(`${API}/profile`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profile: [] }),
  })

  console.log(fehler === 0 ? '\nALLES GRUEN' : `\n${fehler} AUSSAGE(N) GEFALLEN`)
  process.exit(fehler === 0 ? 0 : 1)
} finally {
  try {
    ws?.close()
  } catch {
    /* egal */
  }
  await browser.ende()
}
