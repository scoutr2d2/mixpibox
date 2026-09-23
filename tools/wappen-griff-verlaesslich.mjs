#!/usr/bin/env node
/**
 * GEHT DER GRIFF JEDES MAL? — derselbe Handgriff, zwanzigmal hintereinander.
 *
 * ══ WARUM ES DIESES WERKZEUG NEBEN DER PROBE GIBT ══════════════════════════
 *
 * tools/wappen-halten-probe.mjs prueft, ob die Geste RICHTIG ist: Frist, Ring,
 * Abbrechen, Zittern, Stornieren. Jede ihrer Aussagen wird EINMAL gemessen.
 *
 * DAS BEANTWORTET DIE FRAGE DES BETREIBERS NICHT. Sie lautet:
 *
 *     „Ein Griff, der jedes fuenfte Mal danebengeht, ist das Schlimmste — er
 *      sieht nach Zufall aus, und niemand meldet ihn."
 *
 * Ein Fehler, der in 20 % der Faelle auftritt, geht durch JEDE Pruefung, die
 * einmal misst — mit 80 % Wahrscheinlichkeit. Er kommt dann nicht als Fehler
 * zurueck, sondern als „manchmal spinnt das Ding", und das ist die Sorte
 * Meldung, die niemand nachstellen kann. Deshalb wird hier NICHT eine neue
 * Aussage geprueft, sondern eine ALTE oft: WIE OFT VON ZWANZIG.
 *
 * ══ WARUM JEDER GRIFF EIN FRISCHES BLATT BEKOMMT ═══════════════════════════
 *
 * Zwanzigmal auf denselben geladenen Zustand zu druecken misst den zweiten bis
 * zwanzigsten Griff auf einem Bereich, der schon offen ist — das ist keine
 * Wiederholung, das ist ein Griff und neunzehn Nichtse. Zwischen den Laeufen
 * wird deshalb neu geladen und `localStorage` geraeumt (die Freigabe des Tors
 * steht dort und gilt zwei Minuten).
 *
 * ══ WAS GEZAEHLT WIRD ══════════════════════════════════════════════════════
 *   A. 20x die volle Frist       -> MUSS 20/20 oeffnen
 *   B.  5x mit zitterndem Finger -> MUSS 5/5 oeffnen
 *   C.  5x mit leichtem Schieben -> MUSS 5/5 oeffnen (ein Daumen rutscht)
 *   D.  5x mit 800 ms            -> MUSS 0/5 oeffnen
 *   E.  5x mit 3000 ms           -> MUSS 5/5 oeffnen (Halten ueber die Frist
 *                                   hinaus darf nicht zurueckfallen)
 *   F.  5x mit 40 px Wandern     -> OHNE MARKE, nur gemessen. Der Finger
 *                                   verlaesst dabei den 54 px hohen Knopf.
 *
 * DIE MARKE IST 20 VON 20 UND NICHT 19. Ein Einstieg, den ein Elternteil im
 * Halbdunkel mit einem Kind auf dem Arm braucht, hat keine Quote.
 *
 * WARUM F KEINE MARKE HAT: `pointerleave` bricht ab, und das ist richtig. Ob
 * es an der Box STOERT, haengt an der Groesse des Knopfes (7,5 mm, unter der
 * 9-mm-Marke) und nicht an dieser Datei. Sie stellt die Zahl hin; das Urteil
 * gehoert zu tools/beruehrziele-neu.mjs.
 *
 * ══ WAS ES AENDERT ═════════════════════════════════════════════════════════
 * Nichts an einer Datei und NICHTS AN EINER BOX. Ohne Adresse startet es seine
 * eigene Vorschau auf einem freien Port ([[vorschau-wird-geliehen]]).
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/wappen-griff-verlaesslich.mjs
 *   node tools/wappen-griff-verlaesslich.mjs --ziel http://127.0.0.1:9111/neu/
 *   node tools/wappen-griff-verlaesslich.mjs --runden 40
 * ENDE 0, wenn jede Reihe ihre Marke voll trifft.
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { WAPPEN_HALTEN_MS, WAPPEN_MITTE_JS } from './admin-weg.mjs'
import { fingerAufbau } from './finger.mjs'
import { eigenerBrowser, freierPort } from './leihgabe.mjs'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  if (i < 0) return v
  const w = argv[i + 1]
  return w && !w.startsWith('--') ? w : true
}
const MITGEGEBEN = typeof opt('ziel', null) === 'string' ? opt('ziel') : argv.find((a) => a.startsWith('http')) || null
const RUNDEN = Number(opt('runden', 20)) || 20

const warte = (ms) => new Promise((r) => setTimeout(r, ms))
let fehler = 0
const ja = (gut, satz, dazu = '') => {
  if (!gut) fehler++
  console.log(`${gut ? 'ok  ' : 'NEIN'}  ${satz}${dazu ? `  — ${dazu}` : ''}`)
}

/** Siehe tools/wappen-halten-probe.mjs — requestAnimationFrame plus Kette. */
const ZUSCHLAG = 300

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
  const p = await freierPort()
  ZIEL = `http://127.0.0.1:${p}/neu/`
  vorschau = spawn(process.execPath, ['tools/neu-vorschau.mjs', '--port', String(p)], { cwd: WURZEL, stdio: 'ignore' })
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
console.log(`FRIST: ${WAPPEN_HALTEN_MS} ms (WAPPEN_HALTEN_MS, tools/admin-weg.mjs)\n`)

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
  ws = new WebSocket(await browser.seite(), { perMessageDeflate: false })
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  // 800x480 AUSDRUECKLICH — ohne diese Zeile bekommt das Fenster die Groesse
  // abzueglich der Browserleisten, und die Leiste steht anders.
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })
  await fingerAufbau(ws, send)

  const ev = async (e) => {
    const r = await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'Fehler in der Seite')
    return r.result.value
  }

  const laden = async () => {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(1500)
    await ev(`(() => { try { localStorage.clear(); sessionStorage.clear() } catch (_) {} return true })()`)
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(1700)
    const da = await ev(`!!document.getElementById('wappen')`)
    if (!da) throw new Error('#wappen steht nicht im Baum — siehe tools/admin-weg.mjs')
  }

  const offen = () =>
    ev(`(() => { const e = document.getElementById('eltern'); if (!e) return false
      const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 })()`)

  const punkt = (x, y) => ({ x: Math.round(x), y: Math.round(y), radiusX: 12, radiusY: 12, force: 1, id: 1 })
  const auf = (x, y) => send(ws, 'Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [punkt(x, y)] })
  const bewegen = (x, y) => send(ws, 'Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [punkt(x, y)] })
  const ab = () => send(ws, 'Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })

  const mitte = async () => {
    const m = await ev(WAPPEN_MITTE_JS)
    if (!m) throw new Error('#wappen nicht im Baum — siehe tools/admin-weg.mjs')
    return m
  }

  /**
   * EIN GRIFF — aufsetzen, `ms` halten, abheben. `art` faerbt die Bewegung
   * dazwischen: ruhig, zitternd (4 px hin und her) oder schiebend (der Daumen
   * wandert 6 px nach oben, wie beim Nachfassen).
   */
  const griff = async (ms, art = 'ruhig') => {
    const m = await mitte()
    await auf(m.x, m.y)
    const bis = Date.now() + ms
    let n = 0
    while (Date.now() < bis) {
      await warte(40)
      n++
      if (art === 'zittern') await bewegen(m.x + (n % 2 ? 4 : -4), m.y + (n % 2 ? -3 : 3))
      else if (art === 'schieben') await bewegen(m.x, m.y - Math.min(6, n))
      // HINAUS: der Finger wandert ueber den Rand des Knopfes. Bei 54 px Hoehe
      // ist er nach 30 px oben drueber — das sind 3 mm auf diesem Schirm.
      else if (art === 'hinaus') await bewegen(m.x, m.y - Math.min(40, n * 4))
    }
    await ab()
    await warte(350)
    return offen()
  }

  /** Eine ganze Reihe: `n` Griffe derselben Art, jeder auf frischem Blatt. */
  const reihe = async (titel, n, ms, art, sollOeffnen) => {
    console.log(`══ ${titel} ══`)
    let getroffen = 0
    const daneben = []
    for (let i = 1; i <= n; i++) {
      await laden()
      if (await offen()) throw new Error(`Runde ${i}: der Bereich stand schon offen — der Lauf misst nichts`)
      const ging = await griff(ms, art)
      if (ging === sollOeffnen) getroffen++
      else daneben.push(i)
      process.stdout.write(ging ? '+' : '.')
    }
    console.log('')
    const satz = sollOeffnen ? 'oeffnen den Bereich' : 'oeffnen den Bereich NICHT'
    ja(
      getroffen === n,
      `${getroffen}/${n} — ${ms} ms, ${art}, ${satz}`,
      daneben.length ? `daneben: Runde ${daneben.join(', ')}` : 'jedes Mal',
    )
    console.log('')
    return { getroffen, n, daneben }
  }

  // ═══ A. Der Handgriff selbst, zwanzigmal ═══════════════════════════════
  //
  // DIE REIHE, WEGEN DER ES DIESE DATEI GIBT. Alles andere darunter sind
  // Abwandlungen; diese hier ist der Griff, den ein Elternteil an der Box tut.
  const a = await reihe(`A. ${RUNDEN}x die volle Frist`, RUNDEN, WAPPEN_HALTEN_MS + ZUSCHLAG, 'ruhig', true)

  // ═══ B. Mit zitterndem Finger ══════════════════════════════════════════
  const b = await reihe('B. 5x mit zitterndem Finger', 5, WAPPEN_HALTEN_MS + ZUSCHLAG, 'zittern', true)

  // ═══ C. Mit leichtem Schieben ══════════════════════════════════════════
  //
  // EIN DAUMEN WANDERT. Wer 1,2 s haelt, haelt nicht auf dem Pixel still; er
  // rutscht ein paar Punkte, meist nach oben, weil die Hand nachfasst. 6 px
  // sind gemessen wenig — der Fall fragt, ob `pointerleave` dabei zuschlaegt.
  const c = await reihe(
    'C. 5x mit leichtem Schieben (6 px nach oben)',
    5,
    WAPPEN_HALTEN_MS + ZUSCHLAG,
    'schieben',
    true,
  )

  // ═══ D. Zu kurz ════════════════════════════════════════════════════════
  //
  // 800 ms sind die Zahl, ab der ein Griff laut tools/finger-probe.mjs
  // ZUVERLAESSIG HAELT. Der Fall sagt also nicht „zu kurz zum Messen",
  // sondern „lange genug fuer einen Menschen und trotzdem zu kurz hier".
  const d = await reihe('D. 5x mit 800 ms', 5, 800, 'ruhig', false)

  // ═══ E. Lange darueber hinaus ══════════════════════════════════════════
  //
  // WER UNSICHER IST, HAELT LAENGER. Drei Sekunden duerfen nicht schlechter
  // sein als 1,5 — ein Ring, der bei `anteil >= 1` aufhoert zu zeichnen, aber
  // den Griff nicht beendet, koennte hier zurueckfallen.
  const e = await reihe('E. 5x mit 3000 ms', 5, 3000, 'ruhig', true)

  // ═══ F. Der Finger wandert VOM KNOPF HERUNTER ══════════════════════════
  //
  // DIE REIHE, DIE KEINE MARKE HAT — sie MISST, sie urteilt nicht.
  //
  // `pointerleave` bricht ab. Das ist richtig und Absicht: wer den Finger
  // wegzieht, will nicht mehr. ABER DER KNOPF IST 7,5 mm HOCH und liegt am
  // unteren Rand; das ist UNTER der 9-mm-Marke, die tools/beruehrziele-neu.mjs
  // anlegt. Ein Daumen, der 1,2 s haelt und dabei 40 px wandert, ist an einem
  // grossen Ziel harmlos und an einem kleinen der Abbruch.
  //
  // GENAU DAS IST DIE FEHLERGESTALT, VOR DER DER BETREIBER GEWARNT HAT: „geht
  // jedes fuenfte Mal daneben, sieht nach Zufall aus". Ob das an der Box
  // passiert, entscheidet die Groesse des Knopfes und nicht diese Frist —
  // deshalb steht die Zahl hier als BEFUND und nicht als Marke.
  console.log('══ F. 5x mit 40 px Wandern (der Finger verlaesst den Knopf) ══')
  let hinaus = 0
  for (let i = 1; i <= 5; i++) {
    await laden()
    const ging = await griff(WAPPEN_HALTEN_MS + ZUSCHLAG, 'hinaus')
    if (ging) hinaus++
    process.stdout.write(ging ? '+' : '.')
  }
  console.log('')
  console.log(`    ${hinaus}/5 geoeffnet — 40 px Wandern auf einem 54 px hohen Knopf`)
  console.log(
    hinaus === 0
      ? '    BEFUND: der Griff bricht dabei IMMER ab. Das ist die Regel\n' +
          '            (pointerleave) und kein Fehler — aber auf 7,5 mm ist der\n' +
          '            Weg vom Knopf herunter kurz. Wer die Leiste umbaut, sieht\n' +
          '            hier, was er dem Griff antut.'
      : `    BEFUND: ${hinaus} von 5 gingen trotz Wandern auf.`,
  )
  console.log('')

  console.log('══ Zusammen ══')
  const alle = [a, b, c, d, e]
  const summe = alle.reduce((s, r) => s + r.getroffen, 0)
  const gesamt = alle.reduce((s, r) => s + r.n, 0)
  console.log(`    ${summe} von ${gesamt} Griffen taten, was sie sollten.`)
  console.log(fehler ? `\n${fehler} REIHE(N) VERFEHLT` : '\nALLES GRUEN')
} finally {
  try {
    ws?.close()
  } catch {
    /* egal */
  }
  await browser.schliessen()
}
process.exit(fehler ? 1 : 0)
