#!/usr/bin/env node
/**
 * DIE MEDIEN EINES KINDES — auswaehlen, uebernehmen, und nichts still verlieren.
 *
 * ══ WOZU, UND WARUM NICHT kinder-seite-schau.mjs ═══════════════════════════
 *
 * Jenes misst die drei Ebenen der Seite „Kinder" und ihre drei Riegel (der
 * Gast laesst sich nicht loeschen, das aktive Kind nicht, die Rueckfrage nennt
 * den Namen). Es kennt die AUSWAHL nicht — die gibt es erst seit dem
 * 07.08.2026 (`ABLAGE_AUSWAHL` in profile.ts, `auswahl.ts`, die zwei Routen
 * unter `/api/profil/auswahl`).
 *
 * Hier wird das gemessen, was an der Auswahl schiefgehen KANN, und das ist
 * etwas anderes als bei den drei Riegeln: Dort ging es darum, dass ein Griff
 * nicht zu weit reicht. Hier geht es darum, dass die Oberflaeche SAGT, was ein
 * Griff bewirkt hat. Eine Auswahl ist eine unsichtbare Einstellung — man sieht
 * ihr Ergebnis erst auf der Startseite eines Kindes, und wer sie versehentlich
 * setzt, merkt es unter Umstaenden wochenlang nicht.
 *
 * ══ DIE VIER AUSSAGEN, DIE NICHT VERHANDELBAR SIND ═════════════════════════
 *
 *   1. „KEINE AUSWAHL" HEISST „ALLES", UND DER SCHIRM SAGT ES. Eine Liste
 *      ohne einen einzigen hervorgehobenen Eintrag sieht aus wie „dieses Kind
 *      sieht nichts" und bedeutet das Gegenteil. Steht der Satz nicht da, ist
 *      der Schirm eine Falschauskunft.
 *   2. DER SPRUNG VON „ALLES" AUF „EINS" WIRD ANGESAGT. Der erste Haken nimmt
 *      dem Kind in einem Tipp den ganzen Rest der Bibliothek weg. Er ist mit
 *      einem zweiten Tipp rueckgaengig — aber nur, wenn jemand weiss, dass er
 *      passiert ist.
 *   3. DER LETZTE HAKEN HERAUS HEISST WIEDER „ALLES". Wer ihn wegnimmt, MEINT
 *      meistens „gar nichts mehr" und bekommt das Gegenteil. Auch das wird
 *      gesagt.
 *   4. DER GAST BEKOMMT KEINEN KNOPF. Nicht ausgegraut, sondern keinen — und
 *      an seiner Stelle den Grund. Ein ausgegrauter Knopf zaehlt in der
 *      Beruehrmessung mit und tut im Gebrauch nichts.
 *
 * DAZU DIE DRITTE FORDERUNG DES BETREIBERS: „Ein leeres Regal sagt, warum."
 * Sie wird auf der STARTSEITE gemessen und nicht in der Verwaltung — dort
 * steht sie ja.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/kind-medien-schau.mjs
 *   node tools/kind-medien-schau.mjs --ziel http://127.0.0.1:9801/neu/
 *   node tools/kind-medien-schau.mjs --bilder /tmp/kindmedien
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
/** Millimeter je Pixel auf dem 7-Zoll-Schirm der Box (800 px auf 111,7 mm). */
const MM = 0.1397

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
 * WAS AUF DER KARTE STEHT — Zeilen, Knoepfe, Lage und HERVORHEBUNG.
 *
 * `an` kommt hier zusaetzlich mit (die Klasse `.an` an der Zeile). Auf dieser
 * Seite ist sie die eigentliche Auskunft: Sie sagt, ob ein Eintrag in der
 * Auswahl steht. Ein Werkzeug, das nur die Knopfwoerter liest, saehe „Dazu"
 * und „Heraus" und wuesste nicht, ob die Faerbung dazu passt.
 */
const KARTE_JS = `(() => {
  const f = document.getElementById('fach-zeilen')
  if (!f) return null
  const fb = f.getBoundingClientRect()
  return {
    kopf: (document.getElementById('fach-name') || {}).textContent || '',
    kopfTat: (() => { const k = document.getElementById('fach-tat'); return k && !k.hidden ? k.textContent : '' })(),
    unter: (document.getElementById('eltern-unter') || {}).textContent || '',
    hinweis: (() => { const h = document.getElementById('fach-hinweis'); return h && !h.hidden ? h.textContent : '' })(),
    leer: (() => { const t = f.querySelector('.fach-leer'); return t ? t.textContent : '' })(),
    sichthoehe: Math.round(f.clientHeight),
    zeilen: [...f.querySelectorAll('.fach-zeile')].map((z) => {
      const b = z.getBoundingClientRect()
      const k = z.querySelector('.zeile-tat')
      const kb = k ? k.getBoundingClientRect() : null
      return {
        name: (z.querySelector('.zeile-name') || {}).textContent || '',
        unter: (z.querySelector('.zeile-unter') || {}).textContent || '',
        wort: k ? k.textContent : '',
        knopf: !!k,
        gesperrt: k ? !!k.disabled : false,
        an: z.classList.contains('an'),
        sicht: Math.round(Math.max(0, Math.min(b.bottom, fb.bottom) - Math.max(b.top, fb.top))),
        knopfHoch: kb ? Math.round(kb.height) : 0,
      }
    }),
  }
})()`

/**
 * Was die STARTSEITE gerade zeigt — Kacheln, der Satz im Leerzustand UND SEINE LAGE.
 *
 * DIE LAGE MUSS MIT, sonst misst dieses Werkzeug das Falsche: „Ein leeres Regal
 * sagt, warum" ist keine Aussage ueber den DOM, sondern darueber, was jemand
 * LIEST. Ein Satz, der unter dem Mini-Player oder unter der Bildschirmkante
 * steht, steht zwar da — gesagt hat er nichts. Genau das war beim ersten
 * Bildschirmfoto am 07.08.2026 der Fall.
 */
const SEITE_JS = `(() => {
  const t = document.querySelector('#zustand .zustand-text')
  const tb = t ? t.getBoundingClientRect() : null
  const mp = document.getElementById('mini')
  const mb = mp && mp.offsetParent !== null ? mp.getBoundingClientRect() : null
  return {
    kacheln: document.querySelectorAll('#raster .kachel, #raster .regal-kachel').length,
    weiter: document.querySelectorAll('#weiter .weiter-kachel, #weiter .kachel').length,
    zustand: (() => { const z = document.getElementById('zustand'); return z && !z.hidden ? (t || {}).textContent || '' : '' })(),
    satzUnten: tb ? Math.round(tb.bottom) : 0,
    satzOben: tb ? Math.round(tb.top) : 0,
    schirm: Math.round(window.innerHeight),
    playerOben: mb ? Math.round(mb.top) : 0,
    unter: (document.getElementById('kopf-unter') || {}).textContent || '',
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
  const zurueck = async () => {
    await ev(`document.getElementById('zurueck').click()`)
    await warte(500)
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
    await warte(900)
    return true
  }

  /**
   * DIE AUSWAHLEN WERDEN VOR JEDEM DURCHGANG GELEERT.
   *
   * `/vorschau/profil-<x>` tut das (es setzt die ganze Profillage zurueck).
   * Ohne diese Zeile traege ein Durchgang, der etwas ausgewaehlt hat, sein
   * Ergebnis in den naechsten — [[vorschau-wird-geliehen]], und hier waere es
   * besonders bitter: Der Zustand „keine Auswahl" ist genau der, den jede
   * heute laufende Box hat.
   */
  /**
   * `--dunkel` MALT DIESELBEN SCHIRME IM DUNKELN.
   *
   * Hell und dunkel sind in dieser Oberflaeche nicht dieselbe Datei mit
   * anderen Zahlen (tools/kinder-dunkel-schau.mjs sagt, warum) — und auf
   * dieser Seite haengt eine Auskunft an der FARBE: die Hervorhebung `.an`,
   * die sagt, ob ein Eintrag in der Auswahl steht. Was hell gut zu sehen ist,
   * kann dunkel verschwinden. Die Aussagen sind dieselben; die BILDER gehoeren
   * angesehen.
   */
  const DUNKEL = argv.includes('--dunkel')

  const hinein = async (welchesProfil) => {
    await stand('sperre-aus')
    await stand('figuren-keine')
    await stand(`profil-${welchesProfil}`)
    if (DUNKEL) {
      await send(ws, 'Page.navigate', { url: ZIEL })
      await warte(600)
      await ev(`localStorage.setItem('mupibox_neu_licht_v1','dunkel')`)
    }
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(2200)
    await adminAuf(ev, { warteMs: 1100 })
    await ev(`document.querySelector('#eltern-faecher [data-fach="system"]').click()`)
    await warte(700)
    await tippen('Benutzer')
  }

  // ══ 1. DIE ZEILE „MEDIEN" AUF DEM BLATT ═══════════════════════════════
  console.log('\n══ DIE ZEILE AUF DEM BLATT EINES KINDES ════════════════════')
  await hinein('liam')
  await tippen('Liam')
  let k = await ev(KARTE_JS)
  const zeile = k.zeilen.find((z) => z.name === 'Medien')
  ja(!!zeile, 'das Blatt hat eine Zeile „Medien"', k.zeilen.map((z) => z.name).join(' · '))
  ja(zeile?.wort === 'Ändern', 'und sie fuehrt weiter', zeile?.wort)
  ja(
    /Alles/.test(zeile?.unter || ''),
    'AUSSAGE 1: „keine Auswahl" steht als „Alles" da und nicht als Leere',
    zeile?.unter,
  )
  await bild('1-blatt-mit-medien')

  // ══ 2. DER GAST — KEIN KNOPF, ABER DER GRUND ══════════════════════════
  console.log('\n══ AUSSAGE 4: DER GAST BEKOMMT KEINEN KNOPF ════════════════')
  await zurueck()
  await tippen('Gast')
  k = await ev(KARTE_JS)
  const gastZeile = k.zeilen.find((z) => z.name === 'Medien')
  ja(!!gastZeile, 'auch der Gast hat die Zeile — sie fehlt nicht einfach')
  ja(gastZeile?.knopf === false, 'aber sie hat KEINEN Knopf, auch keinen ausgegrauten', gastZeile?.wort || '(keiner)')
  ja(/sieht immer alles/.test(gastZeile?.unter || ''), 'und sie sagt, warum', gastZeile?.unter)
  await bild('2-gast-ohne-knopf')

  // ══ 3. DIE MEDIENSEITE IM ZUSTAND „ALLES" ═════════════════════════════
  console.log('\n══ AUSSAGE 1: DIE SEITE SAGT, DASS „ALLES" GILT ════════════')
  await zurueck()
  await tippen('Liam')
  await tippen('Medien')
  k = await ev(KARTE_JS)
  ja(k.kopf === 'Medien für Liam', 'die Medienseite steht', k.kopf)
  ja(k.kopfTat === 'Suchen', 'und der Kopf traegt „Suchen"', k.kopfTat)
  ja(k.unter === 'Kinder · Liam · Medien', 'die Unterzeile sagt, wo man ist', k.unter)
  const zustand = k.zeilen[0]
  ja(zustand?.name === 'Alles', 'die erste Zeile nennt den Zustand', zustand?.name)
  ja(
    /sieht die ganze Box/.test(zustand?.unter || ''),
    'und sie sagt es in Worten — nicht nur durch fehlende Haken',
    zustand?.unter,
  )
  ja(
    /schränkt das ein/.test(zustand?.unter || ''),
    'AUSSAGE 2 (vorher): sie warnt VOR dem ersten Haken, nicht erst danach',
  )
  ja(zustand?.knopf === false, 'im Zustand „Alles" hat sie keinen Knopf — es gibt nichts aufzuheben')
  const eintraege = k.zeilen.filter((z) => z.wort === 'Dazu' || z.wort === 'Heraus')
  ja(eintraege.length >= 3, 'die Bibliothek steht darunter', `${eintraege.length} Eintraege`)
  ja(eintraege.every((z) => !z.an), 'und ohne Auswahl ist keiner hervorgehoben')
  ja(
    k.zeilen.every((z) => !z.knopf || z.knopfHoch * MM >= 9),
    'jeder Knopf haelt die 9-mm-Marke',
    `${(Math.min(...k.zeilen.filter((z) => z.knopf).map((z) => z.knopfHoch)) * MM).toFixed(2)} mm`,
  )
  await bild('3-medien-alles')

  // ══ 4. DER ERSTE HAKEN ════════════════════════════════════════════════
  console.log('\n══ AUSSAGE 2: DER SPRUNG VON „ALLES" AUF „EINS" ════════════')
  const ersterName = eintraege[0].name
  await tippen(ersterName)
  k = await ev(KARTE_JS)
  ja(/ausgewählt/.test(k.zeilen[0].name), 'die Zustandszeile zaehlt jetzt', k.zeilen[0].name)
  ja(k.zeilen[0].wort === 'Alles zeigen', 'und sie bietet den Weg zurueck an', k.zeilen[0].wort)
  ja(
    /nur noch/.test(k.hinweis) && k.hinweis.includes('Liam'),
    'DIE MELDUNG SAGT, WAS EBEN PASSIERT IST — mit Namen',
    k.hinweis,
  )
  ja(/Alles zeigen/.test(k.hinweis), 'und sie nennt den Weg zurueck', k.hinweis)
  const gewaehlt = k.zeilen.find((z) => z.name === ersterName)
  ja(gewaehlt?.an === true, 'der gewaehlte Eintrag ist hervorgehoben — nicht nur sein Knopf beschriftet')
  ja(gewaehlt?.wort === 'Heraus', 'und sein Knopf nimmt ihn wieder heraus', gewaehlt?.wort)
  await bild('4-erster-haken')

  // ══ 5. DER SERVER HAT ES WIRKLICH ═════════════════════════════════════
  //
  // NICHT NUR DER SCHIRM. Die Seite schreibt bewusst OHNE zu sperren (siehe
  // `auswahlSchreibt` in app.js) — sie laeuft dem Server also voraus. Genau
  // deshalb muss hier nachgesehen werden, dass er nachkommt: Ein Haken, den
  // nur der Schirm kennt, waere die Sorte Falschauskunft, die man erst Wochen
  // spaeter bemerkt.
  const beimServer = await fetch(new URL('/api/profil/auswahl?profil=liam', ZIEL)).then((a) => a.json())
  ja(beimServer.werke.length === 1, 'die Box hat den Haken auch — nicht nur der Schirm', JSON.stringify(beimServer.werke))
  ja(beimServer.alle === false, 'und sie meldet „nicht alles"')

  // ══ 6. DEN LETZTEN HAKEN WEGNEHMEN ════════════════════════════════════
  console.log('\n══ AUSSAGE 3: DER LETZTE HAKEN HERAUS HEISST WIEDER „ALLES" ═')
  await tippen(ersterName)
  k = await ev(KARTE_JS)
  ja(k.zeilen[0].name === 'Alles', 'der Zustand ist wieder „Alles"', k.zeilen[0].name)
  ja(
    /wieder alles/.test(k.hinweis),
    'und die Meldung sagt es — sonst waere das der stillste Fehler der Seite',
    k.hinweis,
  )
  const leerBeimServer = await fetch(new URL('/api/profil/auswahl?profil=liam', ZIEL)).then((a) => a.json())
  ja(leerBeimServer.alle === true, 'auch bei der Box steht wieder „alles"', JSON.stringify(leerBeimServer))

  // ══ 7. DER SAMMELGRIFF UNTER DER SUCHE ════════════════════════════════
  console.log('\n══ DER SAMMELGRIFF — EIN TIPP STATT EINES HAKENS JE ALBUM ══')
  await ev(`document.getElementById('fach-tat').click()`)
  await warte(500)
  await tastatur('a')
  k = await ev(KARTE_JS)
  const suchZeile = k.zeilen.find((z) => /^Suche:/.test(z.name))
  ja(!!suchZeile, 'die laufende Suche steht in einer eigenen Zeile', suchZeile?.name)
  ja(suchZeile?.wort === 'Alle', 'und sie laesst sich aufheben — wortgleich zum Fach „Medien"')
  const griff = k.zeilen.find((z) => /^Alle \d+ Treffer/.test(z.name))
  ja(!!griff, 'der Sammelgriff steht da', griff?.name)
  ja(griff?.wort === 'Dazu', 'und er nimmt auf', griff?.wort)
  await bild('5-suche-mit-griff')
  await tippen('Alle ')
  k = await ev(KARTE_JS)
  ja(/ausgewählt/.test(k.zeilen[0].name), 'ein Tipp hat alle Treffer aufgenommen', k.zeilen[0].name)
  const nachGriff = await fetch(new URL('/api/profil/auswahl?profil=liam', ZIEL)).then((a) => a.json())
  ja(nachGriff.werke.length >= 2, 'und die Box hat sie alle', `${nachGriff.werke.length} Schluessel`)
  const griffAus = (await ev(KARTE_JS)).zeilen.find((z) => /^Alle \d+ Treffer/.test(z.name))
  ja(griffAus?.wort === 'Heraus', 'der Griff dreht sich um, wenn alles dabei ist', griffAus?.wort)
  await bild('6-nach-dem-griff')

  // ══ 8. „ÜBERNEHMEN VON …" ═════════════════════════════════════════════
  console.log('\n══ „ÜBERNEHMEN VON …" — EIN GRIFF, KEIN HAEKCHEN JE ALBUM ══')
  // DIE SUCHE WIRD UEBER IHRE EIGENE ZEILE AUFGEHOBEN und nicht ueber das Wort
  // „Alle": Der Sammelgriff darunter heisst in diesem Augenblick „Alle 4
  // Treffer heraus" und faengt mit demselben Wort an. Beim ersten Lauf hat
  // dieses Werkzeug damit die eben gesetzte Auswahl selbst wieder abgeraeumt
  // und daraufhin dem Uebernahmeschirm vorgeworfen, er uebernehme nichts.
  await tippen('Suche:')
  await warte(300)
  await tippen('Von einem anderen Kind')
  k = await ev(KARTE_JS)
  ja(k.kopf === 'Medien für Liam', 'der Uebernahmeschirm traegt denselben Kopf', k.kopf)
  ja(k.unter === 'Kinder · Liam · übernehmen', 'die Unterzeile sagt, wo man ist', k.unter)
  const alles = k.zeilen.find((z) => /^Alles/.test(z.name))
  ja(!!alles, '„Alles" steht oben — es ist die Vorgabe', alles?.name)
  // HIER HAT LIAM EINE AUSWAHL, also ist „Alles" eine TAT und keine Auskunft:
  // die Zeile traegt einen Knopf und sagt, was er aufhebt. Der Satz ueber
  // „nichts übernehmen" gehoert in den anderen Fall (ein frisch angelegtes
  // Kind) und wird dort gemessen — ihn hier zu verlangen hiesse, zwei
  // verschiedene Lagen mit einem Satz zu bedienen.
  ja(alles?.wort === 'Nehmen', 'und bei einem Kind MIT Auswahl ist es eine Tat', alles?.wort)
  ja(/Hebt die Auswahl von Liam/.test(alles?.unter || ''), 'die sagt, was sie aufhebt', alles?.unter)
  const wieBei = k.zeilen.find((z) => /^Wie bei /.test(z.name))
  ja(!!wieBei, 'das andere Kind steht mit EINEM Griff da', wieBei?.name)
  ja(wieBei?.wort === 'Übernehmen', 'und der Griff heisst, was er tut', wieBei?.wort)
  await bild('7-uebernehmen')

  // ══ 9. DER RUECKWEG — EIN TIPP, EINE EBENE ════════════════════════════
  console.log('\n══ DER RUECKWEG: EIN TIPP, EINE EBENE ══════════════════════')
  await zurueck()
  k = await ev(KARTE_JS)
  ja(k.kopf === 'Medien für Liam' && k.unter === 'Kinder · Liam · Medien', 'aus „übernehmen" geht es auf die Medien', k.unter)
  await zurueck()
  k = await ev(KARTE_JS)
  ja(k.kopf === 'Liam' && k.unter === 'Kinder · Liam', 'von dort auf das Blatt', k.unter)
  await zurueck()
  k = await ev(KARTE_JS)
  ja(k.kopf === 'Benutzer', 'und von dort auf die Liste', k.kopf)

  // ══ 10. BEIM ANLEGEN WIRD GEFRAGT ═════════════════════════════════════
  console.log('\n══ BEIM ANLEGEN: „ÜBERNEHMEN VON …" KOMMT VON SELBST ═══════')
  await tippen('Benutzer hinzufügen')
  await tastatur('mira')
  k = await ev(KARTE_JS)
  ja(/^Medien für /.test(k.kopf), 'nach dem Anlegen steht der Uebernahmeschirm da', k.kopf)
  ja(
    k.zeilen.some((z) => /^Wie bei Liam/.test(z.name)) && k.zeilen.some((z) => /^Wie bei Kalea/.test(z.name)),
    'und er nennt JEDES vorhandene Kind',
    k.zeilen.map((z) => z.name).join(' · '),
  )
  ja(!k.zeilen.some((z) => /^Wie bei Gast/.test(z.name)), 'aber nicht den Gast — der hat nie eine Auswahl')
  // ── HIER GEHOERT DER SATZ HIN, DEN DIE AUFGABE VERLANGT ──────────────
  // „nichts übernehmen UND alles (letzteres ist dasselbe wie keine Auswahl —
  // sag das auch so)". Ein frisch angelegtes Kind IST der Fall, in dem beide
  // gemeint sein koennten; hier steht deshalb, dass es dasselbe ist, statt
  // zwei Knoepfe anzubieten, die dasselbe tun.
  const neuAlles = k.zeilen.find((z) => /^Alles/.test(z.name))
  ja(neuAlles?.knopf === false, 'beim neuen Kind ist „Alles" Auskunft und kein Knopf — es gilt ja schon', neuAlles?.wort)
  ja(
    /Nichts übernehmen/.test(neuAlles?.unter || ''),
    'und es sagt, dass „nichts übernehmen" DASSELBE waere — statt zwei Knoepfe fuer eines',
    neuAlles?.unter,
  )
  await bild('8-nach-dem-anlegen')
  const wieLiam = k.zeilen.find((z) => /^Wie bei Liam/.test(z.name))
  ja(/\d+ Einträge|1 Eintrag|sieht alles/.test(wieLiam?.unter || ''), 'jede Zeile sagt, was man bekaeme', wieLiam?.unter)
  await tippen('Wie bei Liam')
  k = await ev(KARTE_JS)
  ja(/dasselbe wie Liam/.test(k.hinweis), 'nach dem Griff steht da, was passiert ist', k.hinweis)
  const mira = await fetch(new URL('/api/profil/auswahl?profil=mira', ZIEL)).then((a) => a.json())
  ja(mira.werke.length === nachGriff.werke.length, 'und das neue Kind hat dieselbe Auswahl', JSON.stringify(mira.werke))
  // EINE EIGENE LISTE UND KEINE VERKNUEPFUNG: was bei Liam passiert, geht Mira
  // nichts mehr an. Der Unterschied ist von aussen nicht zu sehen — deshalb
  // wird er gemessen.
  await fetch(new URL('/api/profil/auswahl', ZIEL), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profil: 'liam', werke: [] }),
  })
  const miraDanach = await fetch(new URL('/api/profil/auswahl?profil=mira', ZIEL)).then((a) => a.json())
  ja(
    miraDanach.werke.length === mira.werke.length,
    'und sie bleibt, wenn das Vorbild seine aufhebt — eine Kopie, keine Kopplung',
    JSON.stringify(miraDanach.werke),
  )

  // ══ 11. EIN LEERES REGAL SAGT, WARUM ══════════════════════════════════
  //
  // AUF DER STARTSEITE UND NICHT IN DER VERWALTUNG. Das ist der Schirm, vor
  // dem ein Kind steht — und die Lage entsteht ohne Zutun: Die Medien zu einer
  // Auswahl koennen geloescht worden sein, oder die Box ist offline und
  // `active_data.json` ist gerade die kurze Liste (auswahl.ts).
  console.log('\n══ PUNKT 3: EIN LEERES REGAL SAGT, WARUM ═══════════════════')
  await fetch(new URL('/api/profil/auswahl', ZIEL), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profil: 'liam', werke: ['gibtesnicht:1', 'gibtesnicht:2'] }),
  })
  await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
  await warte(2500)
  let s = await ev(SEITE_JS)
  ja(s.kacheln === 0, 'das Regal ist leer', `${s.kacheln} Kacheln`)
  ja(s.zustand !== '', 'und es steht ein Satz da statt einer leeren Flaeche', s.zustand)
  ja(/2 Einträge ausgewählt/.test(s.zustand), 'der Satz nennt die ZAHL — sie trennt „kaputt" von „so eingestellt"', s.zustand)
  ja(!/noch keine Medien/.test(s.zustand), 'und er behauptet NICHT, die Box sei leer — sie ist es nicht')
  ja(s.weiter === 0, '„Weiterhören" zeigt nichts, was das Kind nicht sehen darf', `${s.weiter} Kacheln`)
  // ── UND ER IST ZU LESEN ──────────────────────────────────────────────
  // Der Satz muss GANZ im Bild stehen und darf nicht unter dem Mini-Player
  // liegen. Ohne diese Messung ist „ein leeres Regal sagt, warum" eine Aussage
  // ueber den DOM und nicht ueber das, was jemand liest.
  ja(s.satzUnten > 0 && s.satzUnten <= s.schirm, 'und er steht ganz im Bild', `unten bei ${s.satzUnten} von ${s.schirm}`)
  ja(
    s.playerOben === 0 || s.satzUnten <= s.playerOben,
    'und nicht unter dem Mini-Player',
    `Satz bis ${s.satzUnten}, Player ab ${s.playerOben}`,
  )
  await bild('9-leeres-regal')

  // ══ 12. OHNE AUSWAHL AENDERT SICH NICHTS ══════════════════════════════
  //
  // PUNKT 1 DER NICHT VERHANDELBAREN LISTE: „Eine bestehende Box darf nach dem
  // Update genau dasselbe zeigen wie vorher." Der Fall wird ausdruecklich mit
  // einer Box OHNE jede Auswahl gemessen — es ist der Zustand JEDER heute
  // laufenden Box, und er ist der einzige, den niemand extra einstellt.
  console.log('\n══ PUNKT 1: OHNE AUSWAHL AENDERT SICH NICHTS ═══════════════')
  await fetch(new URL('/api/profil/auswahl', ZIEL), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profil: 'liam', werke: [] }),
  })
  await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
  await warte(2500)
  const ohne = await ev(SEITE_JS)
  ja(ohne.kacheln > 0, 'ohne Auswahl steht das ganze Regal da', `${ohne.kacheln} Kacheln`)
  ja(ohne.zustand === '', 'und kein Leersatz')
  const alleWerke = await fetch(new URL('/api/werke', ZIEL)).then((a) => a.json())
  ja(
    alleWerke.auswahl && alleWerke.auswahl.gewaehlt === 0 && alleWerke.auswahl.sichtbar === alleWerke.auswahl.vorrat,
    'der Server meldet: nichts gewaehlt, alles sichtbar',
    JSON.stringify(alleWerke.auswahl),
  )
  await bild('10-ohne-auswahl')

  // ══ 13. DIE GROESSE, AN DER DIE FORM HAENGT ═══════════════════════════
  //
  // DIE ENTSCHEIDUNG FUER EINE FLACHE LISTE MIT SUCHE (statt eines
  // Interpretenbaums) haengt an EINER Zahl: wie dicht die Bibliothek wirklich
  // ist. An der Box .169 sind es 28 Eintraege auf 20 Interpreten, von denen 15
  // genau EIN Werk tragen (gemessen 07.08.2026, lesend). Ein Baum haette
  // daraus 20 Zeilen gemacht und die haeufigste Sache TEURER: zwei Tipps fuer
  // einen Haken.
  //
  // MIT VIER EINTRAEGEN LAESST SICH DAS NICHT MESSEN — die Liste rollt nicht
  // einmal. `/vorschau/bibliothek-viele` stellt die echte Groesse her.
  console.log('\n══ DIE GROESSE, AN DER DIE FORM HAENGT ═════════════════════')
  await stand('bibliothek-viele')
  await hinein('liam')
  await tippen('Liam')
  await tippen('Medien')
  k = await ev(KARTE_JS)
  ja(k.zeilen.length >= 28, 'die volle Bibliothek steht in EINER Liste', `${k.zeilen.length} Zeilen`)
  ja(/alle 28 Einträge/.test(k.zeilen[0].unter || ''), 'und die Zustandszeile nennt die Zahl', k.zeilen[0].unter)
  ja(
    k.zeilen.every((z) => !z.knopf || z.knopfHoch * MM >= 9),
    'auch bei 28 Zeilen haelt jeder Knopf die 9-mm-Marke',
    `${(Math.min(...k.zeilen.filter((z) => z.knopf).map((z) => z.knopfHoch)) * MM).toFixed(2)} mm`,
  )
  await bild('11-volle-bibliothek')
  // DER GRIFF, UM DEN ES GEHT: „alles von Bibi Blocksberg" ist ein Suchwort
  // und EIN Tipp — nicht fuenf Haken.
  await ev(`document.getElementById('fach-tat').click()`)
  await warte(500)
  await tastatur('bibi')
  k = await ev(KARTE_JS)
  // DER SAMMELGRIFF TRAEGT DASSELBE WORT WIE EIN EINTRAG („Dazu") und muss
  // deshalb ausgenommen werden — sonst zaehlt dieses Werkzeug ihn als sechstes
  // Album mit. Genau so ist es beim ersten Lauf passiert.
  const bibi = k.zeilen.filter((z) => (z.wort === 'Dazu' || z.wort === 'Heraus') && !/^Alle \d+ Treffer/.test(z.name))
  ja(bibi.length === 5, 'die Suche findet das ganze Regal', `${bibi.length} Treffer`)
  await tippen('Alle 5 Treffer')
  k = await ev(KARTE_JS)
  ja(/^5 von 28 ausgewählt/.test(k.zeilen[0].name), 'EIN Tipp nimmt alle fuenf auf', k.zeilen[0].name)
  await bild('12-regal-in-einem-griff')
} finally {
  try {
    ws?.close()
  } catch {
    /* egal */
  }
  await browser.schliessen?.()
}

console.log(fehler ? `\n${fehler} Aussage(n) halten nicht.` : '\nJede Aussage haelt.')
process.exit(fehler ? 1 : 0)
