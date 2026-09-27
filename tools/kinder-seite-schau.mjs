#!/usr/bin/env node
/**
 * DIE SEITE „KINDER" — die drei Ebenen, die drei Riegel und die Rueckfrage.
 *
 * ══ WOZU, UND WARUM NICHT admin-menue-schau.mjs ════════════════════════════
 *
 * Jenes misst die GLIEDERUNG des Admin-Menues: stehen die Gruppen da, fuehrt
 * jeder Punkt irgendwohin, kommt man ueberall wieder heraus. Es kennt keinen
 * Zustand, der sich AENDERT — und genau darum geht es hier: Auf dieser Seite
 * wird angelegt, umbenannt und geloescht, und drei Dinge duerfen dabei niemals
 * passieren. Sie sind nicht verhandelbar, und deshalb werden sie gemessen und
 * nicht bloss beim Lesen des Codes geglaubt:
 *
 *   1. DER GAST LAESST SICH NICHT LOESCHEN. Nicht ausgegraut — der Knopf ist
 *      GAR NICHT DA. Ein ausgegrauter zaehlt in der Beruehrmessung mit und tut
 *      im Gebrauch nichts.
 *   2. DAS AKTIVE KIND LOESCHT SICH NICHT SELBST. Sonst stuende die Box auf
 *      einem Profil, das es nicht mehr gibt. Statt eines gesperrten Knopfes
 *      muss der WEG dastehen: erst umschalten.
 *   3. DIE RUECKFRAGE NENNT DEN NAMEN UND ZAEHLT AUF, WAS MITGEHT. „Wirklich
 *      löschen?" ist auf einem Ordner mit Weiterhoeren, Hoerzeit, Verlauf und
 *      Listen zu wenig.
 *
 * DAZU DIE FRAGE, DIE DIE STROM-SEITE EINMAL TEUER GELERNT HAT: Liegt der
 * scharfe Knopf der Rueckfrage dort, wo im Blatt davor ein anderer lag? Wenn
 * ja, braucht es eine Frist (`STROM_SCHARF_MS`); wenn nein, nicht. Diese Zahl
 * wird hier GEMESSEN und nicht geschaetzt — beim Neustart war die
 * entsprechende Ueberlegung falsch, und ein echter Finger hat es gefunden
 * (tools/admin-doppeltipp-probe.mjs).
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/kinder-seite-schau.mjs
 *   node tools/kinder-seite-schau.mjs --ziel http://127.0.0.1:9601/neu/
 *   node tools/kinder-seite-schau.mjs --bilder /tmp/kinder
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
 * WAS AUF DER KARTE STEHT — Zeilen, Knoepfe und ihre LAGE.
 *
 * Die Lage kommt mit, weil eine der Aussagen sie braucht: Liegt der scharfe
 * Knopf der Rueckfrage dort, wo im Blatt davor einer lag?
 */
const KARTE_JS = `(() => {
  const f = document.getElementById('fach-zeilen')
  if (!f) return null
  return {
    kopf: (document.getElementById('fach-name') || {}).textContent || '',
    unter: (document.getElementById('eltern-unter') || {}).textContent || '',
    hinweis: (() => { const h = document.getElementById('fach-hinweis'); return h && !h.hidden ? h.textContent : '' })(),
    sichthoehe: Math.round(f.clientHeight),
    inhalt: Math.round(f.scrollHeight),
    zeilen: [...f.children].map((z) => {
      const b = z.getBoundingClientRect()
      const fb = f.getBoundingClientRect()
      const k = z.querySelector('.zeile-tat')
      const kb = k ? k.getBoundingClientRect() : null
      return {
        name: (z.querySelector('.zeile-name') || {}).textContent || '',
        unter: (z.querySelector('.zeile-unter') || {}).textContent || '',
        wort: k ? k.textContent : '',
        knopf: !!k,
        gesperrt: k ? !!k.disabled : false,
        gefahr: k ? k.classList.contains('gefahr') : false,
        sicht: Math.round(Math.max(0, Math.min(b.bottom, fb.bottom) - Math.max(b.top, fb.top))),
        hoch: Math.round(b.height),
        knopfY: kb ? Math.round(kb.top + kb.height / 2) : 0,
        knopfHoch: kb ? Math.round(kb.height) : 0,
      }
    }),
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
  /** Eine Zeile antippen — ueber ihren NAMEN, wie ein Mensch. */
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
  /**
   * EINEN KNOPF UEBER SEINE AUFSCHRIFT ANTIPPEN.
   *
   * `tippen` sucht die ZEILE; in der Rueckfrage heisst die Zeile aber „Kalea
   * löschen" und ihr Knopf „Ja, Kalea löschen". Wer nur ueber die Zeile ginge,
   * traefe in beiden Ebenen dasselbe und merkte den Unterschied nie.
   */
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
  const zurueck = async () => {
    await ev(`document.getElementById('zurueck').click()`)
    await warte(500)
  }
  /** Auf der Bildschirmtastatur einen Namen eintippen und „Fertig" druecken. */
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
   * DIE FIGURENLAGE WIRD GESETZT UND NICHT GEERBT.
   *
   * SIE STAND HIER NICHT, UND DAS HAT EINE MESSUNG GEKOSTET: Ohne diese Zeile
   * gilt, was zuletzt jemand anders auf derselben Vorschau eingestellt hat
   * ([[vorschau-wird-geliehen]]). Und die Figurenlage aendert das BLATT — hat
   * ein Kind ein Bild, traegt die Zeile „Bild" einen Knopf „Zurücksetzen", und
   * dann steht auf dem Blatt eine Zeile mehr mit Knopf als ohne. Genau diese
   * Zeile hat die Aussage weiter unten einmal rot und einmal gruen gemacht,
   * ohne dass sich eine Zeile Code geaendert haette.
   *
   * `keine` IST DER HEUTIGE STAND DER BOX (`bilder/figuren/` ist leer), `da`
   * der angekuendigte: der Betreiber hat am 05.08.2026 gesagt, dass er Figuren
   * erzeugen will. Gemessen werden BEIDE — eine Aussage, die nur fuer den
   * leeren Ordner gilt, faellt an dem Tag um, an dem er nicht mehr leer ist.
   */
  const hinein = async (welchesProfil, figuren = 'keine') => {
    await stand('sperre-aus')
    await stand(`figuren-${figuren}`)
    await stand(`profil-${welchesProfil}`)
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(2200)
    await adminAuf(ev, { warteMs: 1100 })
    await ev(`document.querySelector('#eltern-faecher [data-fach="system"]').click()`)
    await warte(700)
    await tippen('Benutzer')
  }

  // ══ 1. DER WEG HINEIN ═════════════════════════════════════════════════
  console.log('\n══ DER WEG ZUR SEITE ═══════════════════════════════════════')
  await hinein('gast')
  let k = await ev(KARTE_JS)
  ja(k?.kopf === 'Benutzer', 'die Seite „Benutzer" steht', `Kopf „${k?.kopf}"`)
  ja(
    k.zeilen.some((z) => z.name === 'Gast') && k.zeilen.some((z) => z.name === 'Liam'),
    'jedes Profil hat seine Zeile',
    k.zeilen.map((z) => z.name).join(' · '),
  )
  ja(
    k.zeilen[k.zeilen.length - 1].name === 'Benutzer hinzufügen',
    'und „Benutzer hinzufügen" steht UNTEN — ein Fehlgriff faellt auf die erste Zeile',
  )
  ja(
    k.zeilen.every((z) => z.sicht >= 10),
    'von jeder Zeile sind mindestens 10 px zu sehen',
    k.zeilen.map((z) => `${z.name}: ${z.sicht}`).join(' | '),
  )
  ja(
    k.zeilen.every((z) => !z.knopf || z.knopfHoch * MM >= 9),
    'jeder Knopf haelt die 9-mm-Marke',
    k.zeilen.filter((z) => z.knopf).map((z) => `${(z.knopfHoch * MM).toFixed(2)} mm`)[0],
  )
  await bild('1-kinder-liste')

  // ══ 2. DER GAST ═══════════════════════════════════════════════════════
  console.log('\n══ RIEGEL 1: DER GAST LAESST SICH NICHT LOESCHEN ════════════')
  await tippen('Gast')
  k = await ev(KARTE_JS)
  ja(k.kopf === 'Gast', 'das Blatt des Gasts steht', k.kopf)
  ja(
    !k.zeilen.some((z) => /löschen/i.test(z.name) || /löschen/i.test(z.wort)),
    'es gibt KEINEN Loeschknopf — auch keinen ausgegrauten',
    k.zeilen.map((z) => z.name + (z.wort ? ` [${z.wort}]` : '')).join(' · '),
  )
  ja(
    k.zeilen.some((z) => z.name === 'Name' && z.wort === 'Ändern'),
    'umbenennen geht trotzdem — der Gast ist ein Profil wie die anderen',
  )
  await bild('2-gast-ohne-loeschen')
  await zurueck()

  // ══ 3. DAS AKTIVE KIND ════════════════════════════════════════════════
  console.log('\n══ RIEGEL 2: WER HOERT, LOESCHT SICH NICHT SELBST ═══════════')
  await hinein('liam')
  await tippen('Liam')
  k = await ev(KARTE_JS)
  ja(k.kopf === 'Liam', 'das Blatt des aktiven Kindes steht', k.kopf)
  ja(
    !k.zeilen.some((z) => /^Liam löschen/.test(z.name)),
    'kein Loeschknopf, solange es dran ist',
    k.zeilen.map((z) => z.name).join(' · '),
  )
  const weg = k.zeilen.find((z) => z.name === 'Hört gerade')
  ja(!!weg, 'stattdessen steht der WEG da', weg?.unter || '')
  ja(weg?.wort === 'Auf Gast umschalten', 'und er ist ein Knopf, keine Belehrung', weg?.wort)
  await bild('3-aktives-kind')

  // ══ 4. DIE RUECKFRAGE ═════════════════════════════════════════════════
  console.log('\n══ RIEGEL 3: DIE RUECKFRAGE NENNT NAMEN UND FOLGEN ══════════')
  await zurueck()
  await tippen('Kalea')
  const blatt = await ev(KARTE_JS)
  const loeschZeile = blatt.zeilen.find((z) => /^Kalea löschen/.test(z.name))
  ja(!!loeschZeile, 'ein anderes Kind hat den Loeschknopf', loeschZeile?.wort)
  ja(loeschZeile?.gefahr === true, 'und er ist als Gefahr gezeichnet')
  await bild('4-kalea-blatt')
  await tippenWort('Löschen')
  k = await ev(KARTE_JS)
  ja(/Kalea löschen\?/.test(k.kopf), 'die Rueckfrage nennt den NAMEN', k.kopf)
  const folgen = k.zeilen.find((z) => z.name === 'Das geht mit')
  ja(!!folgen, 'und sie zaehlt auf, was mitgeht')
  for (const wort of ['Weiterhören', 'Hörzeit', 'Titel', 'Listen']) {
    ja((folgen?.unter || '').includes(wort), `  … „${wort}" steht darin`)
  }
  ja(
    /Bibliothek bleibt/.test(folgen?.unter || ''),
    'und was NICHT mitgeht, steht auch da — sonst klingt es nach „die Hörspiele sind weg"',
  )
  ja(k.zeilen[0].wort === 'Abbrechen', 'oben der Abbruch', k.zeilen[0].wort)
  ja(/^Ja, /.test(k.zeilen[1].wort), 'unten die Tat', k.zeilen[1].wort)
  ja(
    k.zeilen.every((z) => z.sicht >= 10),
    'von beiden Zeilen sind mindestens 10 px zu sehen',
    k.zeilen.map((z) => `${z.name}: ${z.sicht}`).join(' | '),
  )
  await bild('5-loeschfrage')

  // ══ 5. DER DOPPELTIPP ═════════════════════════════════════════════════
  //
  // DIE FRAGE, DIE DIE STROM-SEITE TEUER GELERNT HAT. Dort lag „Ja, Box neu
  // starten" auf derselben Stelle wie „Neu starten" im Blatt davor, und ein
  // echter Finger loeste beides mit einem Doppeltipp aus. Hier wird die Lage
  // GEMESSEN, statt sie zu ueberlegen.
  //
  // ══ WELCHER KNOPF ZAEHLT — DAS IST HIER AM 07.08.2026 PRAEZISIERT WORDEN ══
  //
  // Bis dahin stand hier: „kein Knopf des Blattes davor liegt unter der
  // scharfen Zeile". Das ist EIN Knopf zu breit, und es ist am selben Tag rot
  // geworden, ohne dass sich eine Zeile Code geaendert haette: Sobald ein Kind
  // ein Bild hat, traegt die Zeile „Bild" einen Knopf „Zurücksetzen" — und der
  // liegt in der ZWEITEN Zeile, also genau dort, wo in der Rueckfrage „Ja, …
  // löschen" steht. Null Pixel Abstand.
  //
  // GEFAEHRLICH IST DAS TROTZDEM NICHT, und der Unterschied ist der Kern der
  // Strom-Lehre: Der zweite Tipp eines Doppeltipps trifft die scharfe Zeile
  // nur, wenn der ERSTE die Rueckfrage AUFGEMACHT hat. Das kann genau ein
  // Knopf, naemlich „Löschen". „Zurücksetzen" fuehrt nirgendwohin — es bleibt
  // dasselbe Blatt stehen, und der Knopf ist waehrend des Schreibens ausser
  // Betrieb. Ein Ueberlappen mit ihm kostet nichts.
  //
  // DIE BREITE MESSUNG BLEIBT ALS AUSKUNFT STEHEN (sie zeigt, WIE eng es ist),
  // die AUSSAGE haengt am Knopf, der wirklich hierher fuehrt. Ein Werkzeug,
  // das aus einem harmlosen Ueberlappen einen Fehler macht, wird abgeschaltet
  // — und dann sieht auch das gefaehrliche niemand mehr.
  const doppeltippPruefen = (blattZeilen, frageZeilen, wieHeisstDerWeg) => {
    const scharf = frageZeilen[1]
    const knoepfe = blattZeilen
      .filter((z) => z.knopf)
      .map((z) => ({ name: z.name, wort: z.wort, abstand: Math.abs(z.knopfY - scharf.knopfY) }))
      .sort((a, b) => a.abstand - b.abstand)
    const marke = Math.round(scharf.knopfHoch / 2)
    console.log(
      `      „${scharf.wort}" liegt bei y=${scharf.knopfY}; Knoepfe des Blattes davor: ` +
        knoepfe.map((n) => `„${n.wort}" (${n.name}) ${n.abstand} px`).join(' · '),
    )
    const weg = knoepfe.find((n) => n.wort === wieHeisstDerWeg)
    ja(!!weg, `der Weg in die Rueckfrage ist gefunden — „${wieHeisstDerWeg}"`)
    ja(
      !weg || weg.abstand > marke,
      'der Knopf, der die Rueckfrage AUFMACHT, liegt nicht unter der scharfen Zeile — keine Frist noetig',
      `${weg?.abstand} px > ${marke} px`,
    )
    const harmlos = knoepfe.filter((n) => n.wort !== wieHeisstDerWeg && n.abstand <= marke)
    if (harmlos.length) {
      console.log(
        `      (ueberlappt, aber ungefaehrlich — fuehrt nicht hierher: ` +
          harmlos.map((n) => `„${n.wort}"`).join(' · ') +
          `)`,
      )
    }
    // UND DIE 9-MM-MARKE AUF BEIDEN EBENEN. Sie stand bisher nur fuer die
    // LISTE da; das Blatt und die Rueckfrage sind aber die zwei Schirme, auf
    // denen etwas Unwiderrufliches passiert.
    for (const [wo, zeilen] of [
      ['Blatt', blattZeilen],
      ['Rückfrage', frageZeilen],
    ]) {
      const zuKlein = zeilen.filter((z) => z.knopf && z.knopfHoch * MM < 9)
      ja(
        zuKlein.length === 0,
        `jeder Knopf der Ebene „${wo}" haelt die 9-mm-Marke`,
        zuKlein.map((z) => `${z.wort}: ${(z.knopfHoch * MM).toFixed(2)} mm`).join(' | ') ||
          `${zeilen.filter((z) => z.knopf).length} Knopf/Knoepfe`,
      )
    }
  }
  console.log('\n══ LIEGT DIE TAT AUF EINEM VORHERIGEN KNOPF? ════════════════')
  doppeltippPruefen(blatt.zeilen, k.zeilen, 'Löschen')

  // ══ 6. ABBRECHEN TUT NICHTS ═══════════════════════════════════════════
  console.log('\n══ ABBRECHEN, UND DANN WIRKLICH LOESCHEN ════════════════════')
  await tippenWort('Abbrechen')
  k = await ev(KARTE_JS)
  ja(k.kopf === 'Kalea', 'ein Abbruch fuehrt auf das Blatt zurueck — EINE Ebene', k.kopf)
  const nachAbbruch = await ev(`(async () => {
    const r = await fetch('/api/profile'); const d = await r.json()
    return d.profile.map((p) => p.kennung).join(',') })()`)
  ja(String(nachAbbruch).includes('kalea'), 'und es ist nichts geloescht', String(nachAbbruch))

  await tippenWort('Löschen')
  ja(await tippenWort('Ja, Kalea löschen'), 'die Tat laesst sich ausloesen')
  await warte(400)
  k = await ev(KARTE_JS)
  ja(k.kopf === 'Benutzer', 'nach dem Loeschen steht wieder die Liste da', k.kopf)
  ja(/Kalea ist gelöscht/.test(k.hinweis), 'und der Schirm sagt es', k.hinweis)
  ja(
    !k.zeilen.some((z) => z.name === 'Kalea'),
    'Kalea steht nicht mehr in der Liste',
    k.zeilen.map((z) => z.name).join(' · '),
  )
  await bild('6-nach-dem-loeschen')

  // ══ 7. ANLEGEN ════════════════════════════════════════════════════════
  console.log('\n══ EIN KIND ANLEGEN ════════════════════════════════════════')
  await tippenWort('Anlegen')
  const tastDa = await ev(`!document.getElementById('tastatur').hidden`)
  ja(tastDa === true, 'die Bildschirmtastatur geht auf — dieselbe wie fuer WLAN und Suche')
  await bild('7-name-tippen')
  ja((await tastatur('mila')) === true, 'ein Name laesst sich tippen')
  // ── SEIT DEM 07.08.2026 KOMMT ZUERST DIE FRAGE NACH DEN MEDIEN ──────
  // Vorher stand hier gleich das Blatt. Die Entscheidung des Betreibers vom
  // 05.08.2026 (BACKLOG E18) verlangt beim Anlegen ein „übernehmen von …" —
  // es geht deshalb VON SELBST auf, sobald es ein anderes Kind gibt, von dem
  // sich etwas uebernehmen liesse. Was auf diesem Schirm steht, misst
  // tools/kind-medien-schau.mjs; hier wird nur gemessen, dass er den Weg zum
  // Blatt nicht verstellt: EIN Tipp zurueck, und man ist dort.
  k = await ev(KARTE_JS)
  ja(/^Medien für /i.test(k.kopf), 'zuerst wird nach den Medien gefragt', k.kopf)
  await zurueck()
  k = await ev(KARTE_JS)
  ja(k.kopf === 'Mila' || k.kopf === 'mila', 'ein Tipp zurueck, und das Blatt des neuen Kindes steht', k.kopf)
  const anLegend = await ev(`(async () => {
    const r = await fetch('/api/profile'); const d = await r.json()
    return d.profile.map((p) => p.kennung + '=' + p.name).join(' · ') })()`)
  ja(/mila/.test(String(anLegend)), 'und die Box kennt es', String(anLegend))
  await bild('8-neues-kind')

  // ══ 8. UMBENENNEN ═════════════════════════════════════════════════════
  console.log('\n══ UMBENENNEN ═════════════════════════════════════════════')
  await tippenWort('Ändern')
  await ev(`(() => {
    const k = [...document.querySelectorAll('#tast-feld .tast-taste')].find((x) => x.dataset.taste === 'weg')
    for (let i = 0; i < 20; i++) k.click() })()`)
  ja((await tastatur('nele')) === true, 'der Name laesst sich aendern')
  k = await ev(KARTE_JS)
  ja(/nele/i.test(k.kopf), 'das Blatt traegt den neuen Namen', k.kopf)
  const umbenannt = await ev(`(async () => {
    const r = await fetch('/api/profile'); const d = await r.json()
    return d.profile.map((p) => p.kennung + '=' + p.name).join(' · ') })()`)
  ja(/mila=nele/.test(String(umbenannt)), 'die KENNUNG bleibt — nur der Name wandert', String(umbenannt))
  await bild('9-umbenannt')

  // ══ 8b. DER RUECKWEG: DREI EBENEN, DREI TIPPS ═════════════════════════
  //
  // EIN TIPP, EINE EBENE. Genau hier ist es bei den Medien einmal falsch
  // gewesen: Blatt und Loeschfrage fielen zusammen ab, und ein Tipp nahm zwei
  // Ebenen (tools/admin-nichts-verloren.mjs, 06.08.2026).
  console.log('\n══ DER RUECKWEG — EIN TIPP, EINE EBENE ═════════════════════')
  await tippenWort('Löschen')
  ja((await ev(KARTE_JS)).kopf.endsWith('löschen?'), 'die Loeschfrage steht')
  await zurueck()
  ja(!(await ev(KARTE_JS)).kopf.endsWith('löschen?'), 'ein Tipp raeumt NUR die Rueckfrage ab')
  ja((await ev(KARTE_JS)).kopf === 'nele', 'und das Blatt steht noch offen', (await ev(KARTE_JS)).kopf)
  await zurueck()
  ja((await ev(KARTE_JS)).kopf === 'Benutzer', 'der naechste fuehrt auf die Liste', (await ev(KARTE_JS)).kopf)
  await zurueck()
  ja((await ev(KARTE_JS)).unter === 'System', 'und der naechste auf die Uebersicht der Gruppe')
  await tippen('Benutzer')

  // ══ 9. EIN LANGER NAME ════════════════════════════════════════════════
  //
  // DER KNOPF DER LOESCHFRAGE TRAEGT DEN NAMEN, und er WAECHST mit seiner
  // Aufschrift. Ein Name darf 40 Zeichen lang sein (`profilNormalisieren`) —
  // ohne Deckel liefe der Knopf aus der Karte heraus, und der gefaehrlichste
  // Knopf des Bereichs waere angeschnitten. Gemessen, nicht ueberlegt.
  console.log('\n══ EIN LANGER NAME SPRENGT DIE KARTE NICHT ═════════════════')
  await tippen('nele')
  await tippenWort('Ändern')
  await ev(`(() => {
    const k = [...document.querySelectorAll('#tast-feld .tast-taste')].find((x) => x.dataset.taste === 'weg')
    for (let i = 0; i < 45; i++) k.click() })()`)
  await tastatur('wilhelminadorothea')
  await tippenWort('Löschen')
  const lang = await ev(`(() => {
    const f = document.getElementById('fach-zeilen')
    const fb = f.getBoundingClientRect()
    const k = [...f.querySelectorAll('.zeile-tat')].pop()
    const kb = k.getBoundingClientRect()
    return { wort: k.textContent, rechts: Math.round(kb.right), rand: Math.round(fb.right),
             kopf: (document.getElementById('fach-name') || {}).textContent || '',
             zeile: (f.lastElementChild.querySelector('.zeile-name') || {}).textContent || '' } })()`)
  ja(/wilhelminadorothea/.test(lang.kopf), 'der ganze Name steht in der Ueberschrift', lang.kopf)
  ja(/wilhelminadorothea/.test(lang.zeile), 'und in der Zeile', lang.zeile)
  ja(lang.rechts <= lang.rand, 'aber der Knopf bleibt IN der Karte', `${lang.rechts} <= ${lang.rand} px`)
  ja(lang.wort === 'Ja, löschen', 'auf ihm steht dann das Kurze', lang.wort)
  await bild('10-langer-name')

  // ══ 10. DIESELBE SEITE, WENN ES FIGUREN GIBT ══════════════════════════
  //
  // ALLES BISHERIGE IST AUF DEM HEUTIGEN STAND DER BOX GEMESSEN:
  // `bilder/figuren/` ist LEER, kein Kind hat ein Bild, und die Zeile „Bild"
  // traegt deshalb keinen Knopf. Der Betreiber hat am 05.08.2026 angekuendigt,
  // dass er Figuren erzeugen will („ich habe vor von den mixpis
  // unterschiedliche zu generieren") — dann hat das Blatt eine Zeile mit Knopf
  // MEHR, und zwar an zweiter Stelle, genau dort, wo in der Rueckfrage die
  // scharfe Zeile steht.
  //
  // DIESER DURCHGANG MISST DIESEN TAG VORWEG. Ohne ihn faellt die Aussage
  // oben an dem Tag um, an dem jemand ein PNG in einen Ordner legt — und es
  // saehe aus wie ein Fehler in einer ganz anderen Aenderung.
  console.log('\n══ DIESELBE SEITE, WENN ES FIGUREN GIBT ════════════════════')
  await hinein('gast', 'da')
  await tippen('Kalea')
  const mitBild = await ev(KARTE_JS)
  const bildZeile = mitBild.zeilen.find((z) => z.name === 'Bild')
  ja(!!bildZeile?.knopf, 'die Zeile „Bild" traegt jetzt einen Knopf', bildZeile?.wort)
  ja(bildZeile?.wort === 'Zurücksetzen', 'und er setzt zurueck — ausgesucht wird im Profilfenster', bildZeile?.wort)
  await bild('11-blatt-mit-bild')
  await tippenWort('Löschen')
  const frageMitBild = await ev(KARTE_JS)
  ja(/Kalea löschen\?/.test(frageMitBild.kopf), 'die Rueckfrage steht auch hier', frageMitBild.kopf)
  doppeltippPruefen(mitBild.zeilen, frageMitBild.zeilen, 'Löschen')
  await bild('12-loeschfrage-mit-bild')

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
