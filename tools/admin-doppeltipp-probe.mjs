#!/usr/bin/env node
/**
 * DER ZWEITE TIPP AUF DIESELBE STELLE — was trifft er?
 *
 * ══ WOZU, UND WARUM KEINES DER ZEHN VORHANDENEN ════════════════════════════
 *
 * `tools/admin-menue-schau.mjs` fragt, ob Neustart und Ausschalten NACHFRAGEN,
 * und ob ihre Knoepfe AUF DER SEITE auseinanderliegen (gemessen: 90 px). Beide
 * Aussagen halten. Sie beantworten aber nicht die Frage, die ein Finger
 * stellt:
 *
 *     Ein Mensch tippt auf einen Knopf. Der Bildschirm wechselt darunter weg.
 *     WAS LIEGT JETZT AN DERSELBEN STELLE — und was tut der zweite Tipp, der
 *     schon unterwegs war?
 *
 * Das ist keine erfundene Sorge. `tools/eltern-gefahr-probe.mjs` stellt genau
 * diese Frage seit dem 05.08.2026 fuer das LOESCHEN einer Mediendatei, und sie
 * steht dort in der Kopfzeile als Punkt 3. Fuer NEUSTART und AUSSCHALTEN — die
 * beiden Taten, die am 06.08.2026 dazugekommen sind und die die einzigen im
 * Haus sind, die das GERAET anhalten — hat sie bis heute niemand gestellt.
 *
 * DER UNTERSCHIED ZU „liegen sie auseinander": Zwei Knoepfe koennen auf EINER
 * Seite 12 mm auseinanderliegen und trotzdem an DERSELBEN Bildschirmstelle
 * uebereinanderliegen, wenn die Seite dazwischen wechselt. Der Abstand misst
 * den Raum; diese Probe misst die ZEIT.
 *
 * ══ WIE GEMESSEN WIRD ══════════════════════════════════════════════════════
 * 1. Die Mitte des Knopfes wird VOR dem ersten Tipp genommen.
 * 2. Es wird mit einem ECHTEN FINGER getippt (`Input.dispatchTouchEvent` ueber
 *    tools/finger.mjs), nicht mit `element.click()` — eine Beruehrung trifft
 *    einen PUNKT, ein Klick trifft ein Element, und der Unterschied ist genau
 *    das, was hier gefragt ist.
 * 3. Danach wird an DERSELBEN Koordinate `document.elementFromPoint` gelesen:
 *    Was liegt da jetzt, und ist es gefaehrlich?
 * 4. Erst dann faellt der zweite Tipp — und ein Mitschreiber zaehlt, ob ein
 *    Aufruf hinausgegangen ist.
 *
 * GEMESSEN WIRD BEI 150 ms UND BEI 400 ms. Die erste Zahl ist ein schneller
 * Doppeltipp, wie ihn ein ungeduldiger Finger auf einem Schirm macht, der
 * nicht sofort reagiert; die zweite ist der Abstand, den ein Mensch braucht,
 * um zu MERKEN, dass sich etwas geaendert hat, und noch nicht, um es zu LESEN.
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * Nichts an einer Datei und NICHTS AN EINER BOX. Ohne Adresse startet es seine
 * eigene Vorschau auf einem freien Port ([[vorschau-wird-geliehen]]); jeder
 * Aufruf geht gegen diese Attrappe, die mitzaehlt und nichts tut.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/admin-doppeltipp-probe.mjs
 *   node tools/admin-doppeltipp-probe.mjs http://127.0.0.1:8982/neu/
 *   node tools/admin-doppeltipp-probe.mjs --bilder /tmp/dopp
 * ENDE 0, wenn kein zweiter Tipp etwas ausloest, was der erste nicht wollte.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import WebSocket from 'ws'
import { eigenerBrowser, freierPort, vorschauLeihen } from './leihgabe.mjs'
import { fingerAufbau, fingerBestaetigen, tippen } from './finger.mjs'
import { adminAufHalten } from './admin-weg.mjs'

const argv = process.argv.slice(2)
const MITGEGEBEN = argv.find((a) => a.startsWith('http')) || null
const BILDER = (() => {
  const i = argv.indexOf('--bilder')
  return i < 0 ? null : argv[i + 1]
})()
const warte = (ms) => new Promise((r) => setTimeout(r, ms))

let fehler = 0
const ja = (b, satz, wie = '') => {
  if (!b) fehler++
  console.log(`${b ? 'ok  ' : 'FEHL'}  ${satz}${wie ? '  — ' + wie : ''}`)
}

/**
 * DIE ABSTAENDE, BEI DENEN GEMESSEN WIRD.
 *
 * 150 ms: ein schneller Doppeltipp. 400 ms: der Finger ist schon unterwegs,
 * das Auge hat den Wechsel noch nicht verarbeitet.
 */
const ABSTAENDE = [150, 400]

let ZIEL = MITGEGEBEN
if (!ZIEL) {
  // Ohne Adresse: ein freier Port — vorschauLeihen startet dort gleich die
  // eigene Vorschau (ausdruecklich mit `--port`, nicht auf dem Vorgabeport
  // 8299, der womoeglich einem anderen Arbeitsbaum gehoert).
  const p = await freierPort()
  ZIEL = `http://127.0.0.1:${p}/neu/`
}

// EINE SCHON LAUFENDE VORSCHAU WIRD GELIEHEN — UND ZURUECKGELEGT.
//
// Wer eine Lage stellt (/vorschau/…), muss sie am Ende wieder hinlegen,
// wenn ihm die Vorschau nicht gehoert: sonst misst der naechste Lauf gegen
// eine Vorschau, die jemand anders verstellt hat. Laeuft unter ZIEL noch
// keine, startet vorschauLeihen dort selbst eine und beendet sie am Ende.
// Beides samt der Messungen dahinter: tools/leihgabe.mjs.
const leihe = await vorschauLeihen(ZIEL)
console.log(`ZIEL: ${ZIEL}${leihe.eigene ? '  (eigene Vorschau)' : '  (mitgegeben)'}`)

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

/** Der Mitschreiber. Ob ein Aufruf hinausging, sieht man am Schirm nicht. */
const MITSCHREIBER = `(() => {
  if (window.__rufe) return true
  window.__rufe = []
  const echt = window.fetch
  window.fetch = function (u, o) {
    try { window.__rufe.push({ pfad: String(typeof u === 'string' ? u : (u && u.url) || ''), art: (o && o.method) || 'GET' }) } catch {}
    return echt.apply(this, arguments)
  }
  return true
})()`

const browser = await eigenerBrowser({ fenster: '800,480' }).catch(async (e) => {
  // Scheitert der Browserstart, ist das finally unten noch nicht erreicht —
  // die geliehene Vorschau muss trotzdem zurueck.
  await leihe.zurueckgeben()
  console.error(`  Browser kam nicht hoch — Messung nicht moeglich: ${e.message}`)
  process.exit(2)
})
if (!browser) {
  await leihe.zurueckgeben()
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}
let ws = null
try {
  if (BILDER) await mkdir(BILDER, { recursive: true })
  ws = new WebSocket(await browser.seite(), { perMessageDeflate: false })
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await fingerAufbau(ws, send)

  const ev = async (e) => {
    const r = await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'Fehler in der Seite')
    return r.result.value
  }
  const bild = async (name) => {
    if (!BILDER) return
    const s = await send(ws, 'Page.captureScreenshot', { format: 'png' })
    await writeFile(join(BILDER, `${name}.png`), Buffer.from(s.data, 'base64'))
    console.log(`      Bild: ${join(BILDER, `${name}.png`)}`)
  }
  // ── `ontouchstart` ENTSTEHT ERST BEIM LADEN ────────────────────────────
  // Auf `about:blank` meldet `fingerBestaetigen` `ontouchstart: false`, obwohl
  // der Aufbau gegriffen hat: Blink haengt die Beruehrungs-Ereignisse an ein
  // Dokument, das es noch gar nicht gibt. Deshalb wird NACH dem ersten Laden
  // bestaetigt — und dann wirklich, nicht angenommen.
  let bestaetigt = false
  /**
   * WARTEN, BIS DIE SEITE WIRKLICH DA IST — und nicht 2200 ms lang hoffen.
   *
   * Eine feste Wartezeit hat hier einmal mit
   * „SecurityError: Access is denied for this document" abgebrochen: das
   * Fenster stand noch auf dem leeren Anfangsdokument, und dort gibt es kein
   * `localStorage`. Das sah nach einem Befund ueber die Oberflaeche aus und
   * war einer ueber die Wartezeit.
   */
  const seiteDa = async () => {
    const bis = Date.now() + 15000
    for (;;) {
      const da = await ev(
        // `#wappen` statt des am 06.08.2026 entfallenen Zahnrads `#einst-knopf`:
        // die Frage ist unveraendert „steht die Oberflaeche schon?", nur das
        // Zeichen dafuer ist ein anderes.
        `(() => { try { return document.readyState !== 'loading' && !!document.getElementById('wappen') && !!window.localStorage } catch { return false } })()`,
      ).catch(() => false)
      if (da === true) return
      if (Date.now() > bis) throw new Error('die Seite kam nicht hoch')
      await warte(150)
    }
  }
  const laden = async () => {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await seiteDa()
    await warte(900)
    if (!bestaetigt) {
      const f = await fingerBestaetigen(ws, send)
      if (!f.taugt) throw new Error(`Beruehrung kam nicht an: ${JSON.stringify(f)}`)
      console.log(`Finger: ontouchstart ${f.ontouchstart}, ${f.breite}x${f.hoehe}, grob ${f.grob}`)
      bestaetigt = true
    }
    await ev(MITSCHREIBER)
  }
  const tipp = (x, y) => tippen(ws, send, x, y, 70)
  /** Die Mitte eines Elements — oder null, wenn es nicht sichtbar dasteht. */
  const mitte = (wahl) =>
    ev(`(() => { const e = ${wahl}; if (!e) return null
      const b = e.getBoundingClientRect(); if (!b.width || !b.height) return null
      return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) } })()`)

  /** WAS LIEGT AN DIESEM PUNKT? Der Kern dieser Probe. */
  const wasLiegtDa = (x, y) =>
    ev(`(() => {
      const e = document.elementFromPoint(${x}, ${y})
      if (!e) return null
      const k = e.closest('button')
      if (!k) return { art: 'nichts', wort: (e.textContent||'').trim().slice(0, 40) }
      const z = k.closest('.fach-zeile')
      return {
        art: 'knopf',
        wort: (k.textContent || '').trim(),
        name: z ? ((z.querySelector('.zeile-name')||{}).textContent || '').trim() : '',
        gefahr: k.classList.contains('gefahr'),
        jetzt: k.classList.contains('jetzt'),
        gesperrt: k.disabled === true,
      } })()`)

  const rufeLeeren = () => ev(`(window.__rufe = [], true)`)
  const rufe = async (art = 'POST') =>
    JSON.parse(await ev(`JSON.stringify((window.__rufe||[]).filter((r) => r.art === ${JSON.stringify(art)}))`))

  // ── Der Weg hinein: Tor loesen, Gruppe waehlen, Punkt oeffnen ─────────────
  const hinein = async () => {
    // HIER STAND EIN 70-ms-TIPP AUFS ZAHNRAD `#einst-knopf`. Es ist am
    // 06.08.2026 ersatzlos entfallen; hinein fuehrt der Schriftzug `#wappen`,
    // 1200 ms GEHALTEN. Dieses Werkzeug tippt mit echten Beruehrungen — es
    // geht deshalb den ECHTEN Weg und nicht den Tastaturweg.
    await adminAufHalten(ev, (x, y, ms) => tippen(ws, send, x, y, ms), { warteMs: 1100 })
  }
  /**
   * DAS TOR MUSS ERST EINGESCHALTET WERDEN.
   *
   * `tools/neu-vorschau.mjs` startet mit `sperre: 'aus'` — wer das nicht
   * setzt, misst hinter einem Tor, das gar keines ist. Der Doppeltipp-Befund
   * haengt daran zwar nicht (die Seite sieht dahinter gleich aus), aber eine
   * Probe, die eine Sperre zu durchlaufen GLAUBT und es nicht tut, ist eine
   * Probe, der man beim naechsten Mal zu viel glaubt.
   */
  const rechnen = async () => {
    const fr = await ev(`(document.getElementById('tor-frage')||{}).textContent || ''`)
    const m = String(fr).match(/(\d+)\s*×\s*(\d+)/)
    if (!m) throw new Error('kein Tor am Schirm — wurde /vorschau/sperre-rechnen gesetzt?')
    for (const z of String(Number(m[1]) * Number(m[2]))) {
      const p = await mitte(`document.querySelector('#tor-feld [data-taste="${z}"]')`)
      await tipp(p.x, p.y)
      await warte(90)
    }
    const w = await mitte(`document.querySelector('#tor-feld .tor-weiter')`)
    await tipp(w.x, w.y)
    await warte(1000)
    return true
  }
  const gruppe = async (id) => {
    const p = await mitte(`document.querySelector('#eltern-faecher [data-fach="${id}"]')`)
    if (!p) throw new Error(`Gruppe „${id}" fehlt`)
    await tipp(p.x, p.y)
    await warte(800)
  }
  /** Eine Zeile der Uebersicht antippen — sie IST der Knopf. */
  const punkt = async (name) => {
    const wahl = `[...document.querySelectorAll('#fach-zeilen .fach-zeile')].find((z) => ((z.querySelector('.zeile-name')||{}).textContent||'').trim().startsWith(${JSON.stringify(name)}))`
    await ev(`(() => { const z = ${wahl}; if (z) z.scrollIntoView({ block: 'center' }); return true })()`)
    await warte(150)
    const p = await mitte(wahl)
    if (!p) throw new Error(`Punkt „${name}" fehlt`)
    await tipp(p.x, p.y)
    await warte(800)
  }
  /** Der Knopf IN einer Zeile — vorher in den Blick rollen. */
  const zeilenKnopf = async (name) => {
    const wahl = `[...document.querySelectorAll('#fach-zeilen .fach-zeile')].find((z) => ((z.querySelector('.zeile-name')||{}).textContent||'').trim().startsWith(${JSON.stringify(name)}))`
    await ev(`(() => { const z = ${wahl}; if (z) z.scrollIntoView({ block: 'center' }); return true })()`)
    await warte(150)
    return mitte(`${wahl}?.querySelector('.zeile-tat')`)
  }

  /**
   * DIE PROBE SELBST — einmal fuer eine Stelle, bei jedem Abstand.
   *
   * `hin` fuehrt bis auf die Seite, `name` ist die Zeile mit dem gefaehrlichen
   * Knopf, `soll` nennt den Aufruf, der NICHT hinausgehen darf.
   */
  const proben = async (titel, hin, name, soll) => {
    console.log(`\n══ ${titel} ═══════════════════════════════════`)
    for (const ms of ABSTAENDE) {
      await fetch(new URL('/vorschau/sperre-rechnen', ZIEL)).catch(() => null)
      await laden()
      // DIE GEMEINSAME FREIGABE GILT ZWEI MINUTEN und ueberlebt einen
      // Seitenaufbau (NewDesign/freigabe.json). Ohne dieses Wegraeumen faehrt
      // der zweite Durchgang ohne Tor — und die Probe misst einen anderen Weg
      // als der erste.
      await ev(`(localStorage.removeItem('mupibox_eltern_freigabe'), true)`)
      await laden()
      await hinein()
      await rechnen()
      await hin()
      const p = await zeilenKnopf(name)
      if (!p) {
        ja(false, `${ms} ms: der Knopf „${name}" steht da`)
        continue
      }
      await rufeLeeren()
      await tipp(p.x, p.y)
      await warte(ms)
      const da = await wasLiegtDa(p.x, p.y)
      const wo = da ? (da.art === 'knopf' ? `„${da.wort}" (${da.name})` : `kein Knopf: „${da.wort}"`) : 'nichts'
      console.log(`      nach ${ms} ms liegt an (${p.x},${p.y}): ${wo}`)
      ja(
        !(da && da.art === 'knopf' && da.jetzt && !da.gesperrt),
        `${ms} ms: an der Stelle des ersten Tipps liegt KEINE scharfe Tat`,
        wo,
      )
      if (BILDER) await bild(`dopp-${titel.replace(/[^a-z]/gi, '-').toLowerCase()}-${ms}`)
      // Der zweite Tipp faellt trotzdem — die Aussage soll die WIRKUNG nennen
      // und nicht nur die Absicht des Stilblatts.
      await tipp(p.x, p.y)
      await warte(500)
      const r = await rufe('POST')
      const treffer = r.filter((x) => x.pfad.includes(soll))
      ja(treffer.length === 0, `${ms} ms: und der zweite Tipp loest ${soll} NICHT aus`, `${r.length} POST insgesamt`)

      // ── UND DANACH GEHT ES DOCH ─────────────────────────────────────────
      // Eine Sperre, die nicht wieder aufgeht, waere kein Schutz, sondern ein
      // kaputter Knopf. WER DIE FRAGE LIEST, soll sie beantworten koennen —
      // deshalb wird hier absichtlich noch einmal getippt, nachdem die Frist
      // sicher um ist.
      await warte(900)
      const jetzt = await mitte(
        `[...document.querySelectorAll('#fach-zeilen .fach-zeile')].find((z) => ((z.querySelector('.zeile-name')||{}).textContent||'').trim().startsWith('Ja,'))?.querySelector('.zeile-tat')`,
      )
      if (!jetzt) {
        ja(false, `${ms} ms: die Rueckfrage steht noch`)
        continue
      }
      await rufeLeeren()
      await tipp(jetzt.x, jetzt.y)
      await warte(600)
      const nach = (await rufe('POST')).filter((x) => x.pfad.includes(soll))
      ja(nach.length === 1, `${ms} ms: wer die Frage LIEST, kann sie beantworten`, `${nach.length}× ${soll}`)
    }
  }

  await proben(
    'Neu starten',
    async () => {
      await gruppe('system')
      await punkt('Neu laden und neu starten')
    },
    'Box neu starten',
    '/api/reboot',
  )

  await proben(
    'Ausschalten',
    async () => {
      await gruppe('system')
      await punkt('Neu laden und neu starten')
    },
    'Box ausschalten',
    '/api/shutdown',
  )

  /* ══ DIE ZWEITE STELLE MIT DERSELBEN BEHAUPTUNG ══════════════════════════
   *
   * Im Code stehen DREI Rueckfragen, und ueber jede steht derselbe Satz: „Wer
   * zweimal auf dieselbe Stelle tippt, trifft nichts / Abbrechen." Bei einer
   * davon (Neustart) stimmte er nicht. Damit ist er bei den anderen beiden
   * kein Beleg mehr, sondern eine Behauptung, die zu pruefen ist.
   *
   * HIER: „Keine Sperre" auf der Unterseite Sperre. Sie ist der interessante
   * Fall, weil diese Seite ROLLT — die Zeile „Keine Sperre" ist die vierte
   * von vier und nur zu erreichen, wenn man vorher heruntergerollt hat. Ihre
   * Lage haengt also nicht am Aufbau, sondern daran, wie weit jemand gerollt
   * hat. Die Rechnung im Kommentar („y ≈ 258 gegen y ≈ 86") gilt fuer die
   * ungerollte Seite; gemessen wird die gerollte, weil nur die vorkommt.
   */
  console.log('\n══ „KEINE SPERRE" — DIESELBE BEHAUPTUNG ═════════════')
  {
    await fetch(new URL('/vorschau/sperre-rechnen', ZIEL)).catch(() => null)
    await laden()
    await ev(`(localStorage.removeItem('mupibox_eltern_freigabe'), true)`)
    await laden()
    await hinein()
    await rechnen()
    await gruppe('system')
    await punkt('Sperre vor diesem Bereich')
    // GANZ NACH UNTEN, wie jemand, der die vierte Zeile sucht.
    await ev(`(() => { const k = document.getElementById('fach-zeilen'); k.scrollTop = k.scrollHeight; return true })()`)
    await warte(250)
    const p = await mitte(
      `[...document.querySelectorAll('#fach-zeilen .fach-zeile')].find((z) => ((z.querySelector('.zeile-name')||{}).textContent||'').trim().startsWith('Keine Sperre'))?.querySelector('.zeile-tat')`,
    )
    if (!p) ja(false, 'die Zeile „Keine Sperre" ist erreichbar')
    else {
      await rufeLeeren()
      await tipp(p.x, p.y)
      await warte(300)
      const da = await wasLiegtDa(p.x, p.y)
      const wo = da ? (da.art === 'knopf' ? `„${da.wort}" (${da.name})` : `kein Knopf: „${da.wort.slice(0, 40)}"`) : 'nichts'
      console.log(`      nach 300 ms liegt an (${p.x},${p.y}): ${wo}`)
      ja(!(da && da.art === 'knopf' && da.jetzt && !da.gesperrt), 'an der Stelle des ersten Tipps liegt KEINE scharfe Tat', wo)
      await tipp(p.x, p.y)
      await warte(500)
      const r = (await rufe('POST')).filter((x) => x.pfad.includes('/api/konfiguration'))
      ja(r.length === 0, 'und der zweite Tipp schaltet die Sperre NICHT ab', `${r.length} POST auf /api/konfiguration`)
    }
  }

  /* ══ WAS DIE FRAGE SAGT — UND WIE WEIT SIE DABEI WANDERT ═════════════════
   *
   * ZWEI FRAGEN IN EINEM DURCHGANG, weil sie an derselben Zeile haengen:
   *
   * 1. NENNT SIE, WAS GERADE PASSIERT? Das ist Punkt 1 der nicht
   *    verhandelbaren Liste vom 06.08.2026, und er hat DREI Faelle: es laeuft
   *    etwas, es ist etwas angehalten, es laeuft nichts. „Angehalten" ist
   *    nicht „nichts" — ein pausiertes Hoerspiel steht an einer Stelle, die
   *    ein Neustart vergisst. Ohne diese Messung ist nur der erste Fall je
   *    angesehen worden (`admin-menue-schau.mjs` faehrt die Vorschau im Stand
   *    „spielt").
   *
   * 2. WIE HOCH IST DIE ERSTE ZEILE DABEI? Sie traegt diesen Satz, und die
   *    scharfe Zeile steht darunter. Ein Titel mehr oder weniger verschiebt
   *    sie. Das ist der Beleg dafuer, dass die Sicherung gegen den zweiten
   *    Tipp NICHT ueber den Ort gehen kann (siehe `STROM_SCHARF_MS` in
   *    app.js): ein Abstand, den der Name eines Hoerspiels verstellt, ist
   *    keiner.
   */
  console.log('\n══ WAS DIE FRAGE SAGT ═══════════════════════════════')
  const lagen = []
  for (const [w, was] of [
    ['spielt', 'es laeuft etwas'],
    ['pause', 'es ist etwas angehalten'],
    ['still', 'es laeuft nichts'],
  ]) {
    await fetch(new URL('/vorschau/sperre-aus', ZIEL)).catch(() => null)
    await fetch(new URL(`/vorschau/${w}`, ZIEL)).catch(() => null)
    await warte(200)
    await laden()
    await hinein()
    await gruppe('system')
    await punkt('Neu laden und neu starten')
    const p = await zeilenKnopf('Box neu starten')
    await tipp(p.x, p.y)
    await warte(900)
    const m = JSON.parse(
      await ev(`JSON.stringify((() => {
        const z = [...document.querySelectorAll('#fach-zeilen .fach-zeile')]
        const erste = z.find((e) => ((e.querySelector('.zeile-name')||{}).textContent||'').startsWith('Das passiert'))
        const ja = z.find((e) => ((e.querySelector('.zeile-name')||{}).textContent||'').startsWith('Ja,'))
        const k = ja && ja.querySelector('.zeile-tat')
        const r = k && k.getBoundingClientRect()
        return {
          satz: erste ? ((erste.querySelector('.zeile-unter')||{}).textContent||'').trim() : '',
          hoch: erste ? Math.round(erste.getBoundingClientRect().height) : 0,
          y: r ? Math.round(r.top + r.height / 2) : 0,
        } })())`),
    )
    lagen.push({ w, ...m })
    console.log(`      ${w}: erste Zeile ${m.hoch} px, „Ja" bei y=${m.y}`)
    // DER SATZ MUSS DEN FALL NENNEN und nicht nur „Sicher?" fragen.
    ja(m.satz.length > 20, `${was}: die Frage sagt es`, m.satz.slice(0, 95))
  }
  const ys = [...new Set(lagen.map((l) => l.y))]
  // KEINE FORDERUNG, SONDERN EINE FESTSTELLUNG — deshalb kein `ja(...)`. Sie
  // steht hier, damit der naechste, der die Sicherung „ueber den Abstand"
  // loesen will, die Zahl vor sich hat.
  console.log(
    ys.length > 1
      ? `      DIE SCHARFE ZEILE WANDERT: y ${ys.join(' / ')} — je nachdem, was gerade laeuft.`
      : `      Die scharfe Zeile steht in allen drei Faellen bei y=${ys[0]}.`,
  )

  console.log(fehler === 0 ? '\nALLES GRUEN' : `\n${fehler} AUSSAGE(N) GEFEHLT`)
} finally {
  try {
    ws?.close()
  } catch {
    /* egal */
  }
  await browser.schliessen?.()
  // IM `finally`: Ein Werkzeug, das nur auf dem gruenen Weg aufraeumt, laesst
  // die geliehene Vorschau gerade dann verstellt stehen, wenn es einen Fehler
  // gefunden hat — also genau dann, wenn als naechstes jemand hinsieht.
  await leihe.zurueckgeben()
}
process.exit(fehler === 0 ? 0 : 1)
