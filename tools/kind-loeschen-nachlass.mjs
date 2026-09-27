#!/usr/bin/env node
/**
 * WAS EIN LOESCHEN MITNIMMT — UND WAS ES LIEGEN LAESST.
 *
 * ══ WOZU DIESES WERKZEUG ═══════════════════════════════════════════════════
 *
 * Seit dem 07.08.2026 kann die Seite „Kinder" (Admin-Menue · System) ein Kind
 * LOESCHEN. Der Server legt dabei den Ordner des Kindes beiseite
 * (`bereichBeiseite` in server.ts) — mit der ausdruecklichen Begruendung, ein
 * liegengebliebener Ordner waere eine ERBSCHAFT: „die Kennung kommt aus dem
 * Namen, also faende das zweite Kind namens Liam den Verlauf des ersten vor."
 *
 * DIESES WERKZEUG PRUEFT GENAU DIESEN SATZ — und zwar nicht am Server, sondern
 * dort, wo die Oberflaeche ihre eigenen Sachen hinlegt: IM BROWSER. Der
 * Namensraum `mupibox_p_<kennung>_<schluessel>` (app.js, `speicher`; dieselbe
 * Formel in profile.ts `speicherName` und in favoriten.service.ts) haengt an
 * DERSELBEN Kennung wie der Ordner. Wer den einen aufraeumt und den anderen
 * nicht, hat die Erbschaft nur zur Haelfte abgeschafft.
 *
 * ES MISST DEN DURCHLAUF UND NICHT DEN CODE:
 *   1. Ein Kind hoert etwas    → im Browser liegt etwas unter seiner Kennung.
 *   2. Die Eltern loeschen es  → der Server kennt es nicht mehr.
 *   3. Ein neues Kind DESSELBEN Namens wird angelegt → dieselbe Kennung.
 *   4. UND WAS FINDET ES VOR?  ← das ist die Frage, um die es geht.
 *
 * Dazu die drei Riegel, die der Betreiber ausdruecklich verlangt hat, gemessen
 * NICHT an der Oberflaeche (das tut tools/kinder-seite-schau.mjs), sondern am
 * SERVER — ueber einen direkten Aufruf, wie ihn ein zweiter Bildschirm, ein
 * altes Tab oder ein Skript machen wuerde:
 *   * der Gast laesst sich auch mit einem nackten `PUT /api/profile` ohne ihn
 *     nicht wegnehmen,
 *   * das aktive Kind laesst die Box nicht auf einem Profil zurueck, das es
 *     nicht mehr gibt,
 *   * ein Doppeltipp auf „Ja, … löschen" loescht einmal und nicht zweimal.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/kind-loeschen-nachlass.mjs
 *   node tools/kind-loeschen-nachlass.mjs --ziel http://127.0.0.1:9611/neu/
 *   node tools/kind-loeschen-nachlass.mjs --bilder /tmp/nachlass
 *
 * OHNE `--ziel` STARTET ES SEINE EIGENE VORSCHAU auf einem freien Port
 * ([[vorschau-wird-geliehen]]): eine Messung, die Profile anlegt und loescht,
 * darf keinem fremden Baum in die Lage greifen.
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
  /** Was im Browser unter einer Kennung liegt. */
  const nachlass = async (kennung) =>
    JSON.parse(
      (await ev(`JSON.stringify(Object.keys(localStorage)
        .filter((k) => k.startsWith('mupibox_p_' + ${JSON.stringify(kennung)} + '_'))
        .map((k) => k + ' = ' + localStorage.getItem(k)))`)) || '[]',
    )
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
  const tippenWort = async (wort) => {
    const ok = await ev(`(() => {
      for (const k of document.querySelectorAll('#fach-zeilen .zeile-tat')) {
        if (k.textContent.trim() !== ${JSON.stringify(wort)} || k.disabled) continue
        k.click(); return true
      }
      return false })()`)
    await warte(700)
    return ok === true
  }
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
    await warte(1000)
    return true
  }
  const insMenue = async () => {
    await adminAuf(ev, { warteMs: 1100 })
    await ev(`document.querySelector('#eltern-faecher [data-fach="system"]').click()`)
    await warte(700)
    await tippen('Benutzer')
  }
  const profile = async () => (await fetch(new URL('/api/profile', ZIEL)).then((r) => r.json())).profile
  const kennungen = async () => (await profile()).map((p) => p.kennung).join(',')

  // ══ 1. EIN KIND HOERT ETWAS ═══════════════════════════════════════════
  //
  // DER ECHTE WEG UND KEIN `setItem`: die Kachel wird angetippt, und app.js
  // merkt sich das laufende Werk (`merken`, Schluessel `neu_zuletzt_v1`).
  // Wer den Schluessel selbst hineinschriebe, pruefte seine eigene Annahme.
  console.log('\n══ 1. KALEA HOERT ETWAS ════════════════════════════════════')
  await stand('sperre-aus')
  await stand('profil-kalea')
  await laden()
  ja((await ev(`fetch('/api/profile').then(r=>r.json()).then(d=>d.aktiv)`)) === 'kalea', 'Kalea ist dran')
  const titel = await ev(`(() => {
    const k = document.querySelector('#raster .kachel')
    if (!k) return ''
    k.click()
    return (k.querySelector('.kachel-titel') || {}).textContent || '?'
  })()`)
  await warte(1600)
  const vorher = await nachlass('kalea')
  ja(!!titel, 'eine Kachel liess sich antippen', titel)
  ja(vorher.length > 0, 'im Browser liegt jetzt etwas unter ihrer Kennung', vorher.join(' | '))
  await bild('1-kalea-hoert')

  // ══ 2. DIE ELTERN LOESCHEN SIE ════════════════════════════════════════
  console.log('\n══ 2. DIE ELTERN LOESCHEN SIE ══════════════════════════════')
  // ERST AUF DEN GAST — wer dran ist, loescht sich nicht selbst (Riegel 3).
  await stand('profil-gast')
  await laden()
  await insMenue()
  await tippen('Kalea')
  await tippenWort('Löschen')
  await tippenWort('Ja, Kalea löschen')
  ja(!(await kennungen()).split(',').includes('kalea'), 'die Box kennt Kalea nicht mehr', await kennungen())
  await bild('2-geloescht')

  // ══ 3. UND WAS BLEIBT IM BROWSER LIEGEN? ══════════════════════════════
  //
  // DAS IST DIE FRAGE DIESES WERKZEUGS. Der Ordner auf der Platte wird
  // beiseitegelegt; hier steht, ob das fuer den Browser auch gilt.
  console.log('\n══ 3. WAS DER BROWSER BEHAELT ══════════════════════════════')
  const danach = await nachlass('kalea')
  ja(danach.length === 0, 'unter der Kennung des geloeschten Kindes liegt nichts mehr', danach.join(' | ') || 'leer')

  // ══ 4. EIN NEUES KIND DESSELBEN NAMENS ════════════════════════════════
  console.log('\n══ 4. EIN NEUES KIND HEISST WIEDER KALEA ═══════════════════')
  await tippen('Benutzer hinzufügen')
  await tastatur('kalea')
  const neu = await profile()
  ja(
    neu.some((p) => p.kennung === 'kalea'),
    'es bekommt DIESELBE Kennung — die Kennung kommt aus dem Namen',
    neu.map((p) => p.kennung).join(','),
  )
  await bild('3-neue-kalea')

  // ══ 5. WAS FINDET ES VOR? ═════════════════════════════════════════════
  console.log('\n══ 5. WAS DAS NEUE KIND VORFINDET ══════════════════════════')
  await stand('profil-kalea')
  await laden()
  const geerbt = await nachlass('kalea')
  ja(
    geerbt.length === 0,
    'das neue Kind findet NICHTS vom alten vor',
    geerbt.join(' | ') || 'leer',
  )
  await bild('4-was-die-neue-kalea-sieht')

  // ══ 6. DER GAST — AUCH GEGEN EINEN NACKTEN AUFRUF ═════════════════════
  //
  // NICHT UEBER DIE OBERFLAECHE (dort steht der Knopf gar nicht erst, das
  // misst kinder-seite-schau.mjs), sondern so, wie ein zweiter Bildschirm,
  // ein altes Tab oder ein Skript es taete.
  console.log('\n══ 6. DER GAST GEGEN EINEN DIREKTEN AUFRUF ═════════════════')
  const ohneGast = await fetch(new URL('/api/profile', ZIEL), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profile: [{ kennung: 'liam', name: 'Liam', angelegt: 1 }] }),
  }).then((r) => r.json())
  ja(
    ohneGast.profile[0]?.kennung === 'gast',
    'ein PUT OHNE den Gast bringt ihn trotzdem zurueck — und ganz nach vorn',
    ohneGast.profile.map((p) => p.kennung).join(','),
  )

  // ══ 7. DAS AKTIVE KIND ════════════════════════════════════════════════
  console.log('\n══ 7. DAS AKTIVE KIND GEGEN EINEN DIREKTEN AUFRUF ══════════')
  await stand('profil-liam')
  const ohneAktiv = await fetch(new URL('/api/profile', ZIEL), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profile: [] }),
  }).then((r) => r.json())
  ja(
    ohneAktiv.profile.some((p) => p.kennung === ohneAktiv.aktiv),
    'die Box steht danach NICHT auf einem Profil, das es nicht gibt',
    `aktiv=${ohneAktiv.aktiv} von ${ohneAktiv.profile.map((p) => p.kennung).join(',')}`,
  )

  // ══ 8. DER DOPPELTIPP ═════════════════════════════════════════════════
  //
  // ZWEI KLICKS OHNE PAUSE auf denselben Knopf. Gefragt ist nicht, ob es
  // kracht, sondern ob GENAU EIN Schreiben hinausgeht: ein zweites traefe
  // eine Liste, aus der das Kind schon heraus ist — und schriebe damit den
  // Stand von vorhin zurueck.
  console.log('\n══ 8. EIN DOPPELTIPP AUF DIE SCHARFE ZEILE ═════════════════')
  await stand('profil-gast')
  await laden()
  await ev(`(() => {
    window.__put = 0
    const alt = window.fetch
    window.fetch = function (u, o) {
      if (String(u).includes('/api/profile') && o && o.method === 'PUT') window.__put++
      return alt.apply(this, arguments)
    }
  })()`)
  await insMenue()
  await tippen('Liam')
  await tippenWort('Löschen')
  const zwei = await ev(`(() => {
    const k = [...document.querySelectorAll('#fach-zeilen .zeile-tat')].find((x) => x.textContent.startsWith('Ja,'))
    if (!k) return 'kein Knopf'
    k.click(); k.click()
    return k.textContent
  })()`)
  await warte(1500)
  const puts = await ev(`window.__put`)
  ja(zwei !== 'kein Knopf', 'die scharfe Zeile steht', String(zwei))
  ja(puts === 1, 'ein Doppeltipp schreibt GENAU EINMAL', `${puts} PUT`)
  ja(!(await kennungen()).split(',').includes('liam'), 'und Liam ist einmal geloescht', await kennungen())
  await bild('5-nach-dem-doppeltipp')

  console.log(fehler ? `\n${fehler} FEHLER` : '\nALLES GRUEN')
} finally {
  try {
    ws?.close()
  } catch {
    /* egal */
  }
  await browser.schliessen?.()
}
process.exit(fehler ? 1 : 0)
