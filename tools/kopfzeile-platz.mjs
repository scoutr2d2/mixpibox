#!/usr/bin/env node
/**
 * WIE VIEL PLATZ IST IM BAND OBEN — und passt die Mitte da hinein?
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 *
 * In der Kopfzeile standen bis vor kurzem drei Knoepfe rechts. Zwei sind weg:
 * das Zahnrad am 06.08.2026 (der Weg ins Admin-Menue ist der Schriftzug unten
 * links, gehalten), der Mond am 07.08.2026 (hell/dunkel steht im Admin-Menue).
 *
 * DER BETREIBER WILL DORT UHRZEIT UND RESTZEIT HABEN, MITTIG. Das ist ein
 * eigener Schritt und heute nicht gebaut. Was heute geht: NACHSEHEN, ob der
 * Platz dafuer wirklich da ist — und zwar mit einer Zahl, damit der naechste
 * Schritt nicht mit einem Entwurf anfaengt, der nicht hineinpasst.
 *
 * ══ WARUM DIE MITTE NICHT EINFACH „NOCH EIN KIND" IST ══════════════════════
 *
 * `.kopf` ist eine Flexzeile: links `#kopf-unter` („27 Titel"), rechts
 * `#kopf-status` (Netz, Wolke, Akku) mit `margin-left: auto`, daneben
 * `#bt-knopf`. Ein viertes Kind dazwischen stuende NICHT in der Mitte des
 * Schirms — es stuende in der Mitte des ÜBRIGEN Platzes, und der ist links
 * und rechts verschieden breit. Sobald links „128 Titel" statt „7 Titel"
 * steht oder rechts der Akku erscheint, wanderte die Uhr. Eine Uhr, die
 * wandert, wenn sich der Akku meldet, sieht kaputt aus.
 *
 * DIE MITTE MUSS ALSO AUS DER ZEILE HERAUS — sie darf nicht mitgeschoben
 * werden, wenn links oder rechts etwas breiter wird. WOHIN sie stattdessen
 * gehaengt gehoert, ist die Frage, die der Abschnitt „DIE FALLE" unten
 * beantwortet; die naheliegende Antwort ist dort die falsche.
 *
 * GENAU DAS MISST DIESES WERKZEUG: den freien Streifen um die Mitte, also den
 * Abstand von der Mitte zum naechsten Nachbarn nach links und nach rechts,
 * mal zwei. Und es misst ihn in den Lagen, in denen sich die Zeile
 * verschiebt: die Kategorienleiste faehrt beim Blaettern ein, und dann
 * beginnt der Kopf bei x 0 statt bei x 88.
 *
 * ══ UND HIER LIEGT DIE FALLE, DIE ES GEFUNDEN HAT ══════════════════════════
 *
 * „MITTE" IST ZWEIMAL ETWAS ANDERES. Gemessen 07.08.2026:
 *
 *     Leiste ausgefahren    Band x  88..800   Bandmitte x 444
 *     Leiste eingefahren    Band x   0..800   Bandmitte x 400
 *
 * Der Schirm ist beide Male 800 px breit, seine Mitte liegt beide Male bei
 * x 400. `left: 50%` in einem `position: relative`-Kopf faende aber die
 * BANDMITTE — und die Uhr spraenge beim Blaettern um 44 px hin und her, jedes
 * Mal, wenn die Leiste ein- und wieder ausfaehrt. Das ist dieselbe Sorte
 * Fehler wie beim Rueckweg am 05.08.2026: ein Element, das mitwandert, wo
 * niemand es erwartet.
 *
 * DESHALB WIRD BEIDES GEMESSEN und die Bandmitte nur als Nebenzahl gemeldet.
 * Die Aussage, auf die es ankommt, ist der freie Streifen um die SCHIRMMITTE
 * in BEIDEN Lagen — und ein mittiges Kind gehoert entsprechend an den Schirm
 * gehaengt (`position: fixed`, wie `.zurueck` es schon tut) und nicht an das
 * Band. Ein `position: relative` an `.kopf` waere hier die naheliegende und
 * falsche Vorbereitung.
 *
 * ══ WAS ES NICHT TUT ═══════════════════════════════════════════════════════
 * Es baut nichts. Es faesst keine Box an. Eigener Browser gegen eine Vorschau,
 * deren Adresse ausdruecklich mitgegeben wird.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/kopfzeile-platz.mjs --ziel http://127.0.0.1:9401/neu/
 *   node tools/kopfzeile-platz.mjs --ziel … --bild /tmp/kopf.png
 * ENDE 1, wenn um die Schirmmitte weniger als `MITTE_BRAUCHT` px frei sind
 * oder wenn etwas mitten darauf steht.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import WebSocket from 'ws'
import { eigenerBrowser } from './leihgabe.mjs'

const argv = process.argv.slice(2)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : v
}
const BEKANNT = ['ziel', 'bild']
for (const a of argv) {
  if (!a.startsWith('--')) continue
  if (BEKANNT.includes(a.slice(2))) continue
  console.error(`${a} kennt dieses Werkzeug nicht. Bekannt: --ziel --bild`)
  process.exit(2)
}
const ZIEL = opt('ziel')
if (!ZIEL) {
  console.error('Ohne --ziel wird nichts gemessen:\n  node tools/kopfzeile-platz.mjs --ziel http://127.0.0.1:9401/neu/')
  process.exit(2)
}
const BILD = opt('bild')

/**
 * WAS DIE MITTE BRAUCHT — und woher die Zahl kommt.
 *
 * „14:32" und „noch 12 min" nebeneinander, in der Schriftgroesse der
 * Kopfzeile (11 px, 700er Schnitt, `.kopf-unter`): gemessen rund 44 + 66 px
 * plus 12 px Luft dazwischen = 122. Aufgerundet auf 160 px, weil „noch 1 Std
 * 48 min" laenger ist als „noch 12 min" und weil eine Uhr, die im letzten
 * Augenblick umbricht, schlimmer ist als gar keine.
 *
 * ES IST EINE UNTERGRENZE, KEIN ENTWURF. Wie die beiden Zahlen aussehen, was
 * „Restzeit" ueberhaupt heisst (der Titel? die Liste? der Einschlafzaehler?)
 * und ob sie zusammen oder untereinander stehen — das ist der naechste
 * Schritt und ausdruecklich nicht dieser.
 */
const MITTE_BRAUCHT = 160

const warte = (ms) => new Promise((r) => setTimeout(r, ms))
let fehler = 0
const melde = (z) => {
  fehler++
  console.error(`  FEHLER  ${z}`)
}
const zeile = (n, w) => console.log(`  ${String(n).padEnd(40)} ${w}`)

/**
 * DIE ZEILE ALS ZAHLEN.
 *
 * KEIN GEGENHAKEN IN DIESEM BLOCK: er geht als Template-String an den Browser.
 *
 * Gemessen werden nur SICHTBARE Kinder. `#bt-knopf` traegt `hidden`, solange
 * kein Lautsprecher gekoppelt ist — ein Kind ohne Rechteck engt nichts ein,
 * und es als Nachbarn mitzurechnen ergaebe eine zu pessimistische Zahl. Es
 * steht trotzdem in der Liste, mit dem Vermerk „verborgen", weil es an einer
 * Box mit Lautsprecher DA IST und die Rechnung dann eine andere ist.
 */
const KOPF_JS = `(() => {
  const k = document.querySelector('.kopf')
  if (!k) return null
  const kb = k.getBoundingClientRect()
  const kinder = [...k.children].map((e) => {
    const b = e.getBoundingClientRect()
    const sichtbar = b.width > 0 && b.height > 0
    return {
      was: (e.id ? '#' + e.id : '') + (e.className ? '.' + String(e.className).split(' ').join('.') : e.tagName),
      links: Math.round(b.left), rechts: Math.round(b.right),
      breite: Math.round(b.width), hoehe: Math.round(b.height),
      sichtbar,
    }
  })
  const st = getComputedStyle(k)
  const sicht = kinder.filter((x) => x.sichtbar)
  const streifen = (mitte) => {
    const l = sicht.filter((x) => x.rechts <= mitte).map((x) => x.rechts)
    const r = sicht.filter((x) => x.links >= mitte).map((x) => x.links)
    return {
      mitte,
      nachLinks: l.length ? mitte - Math.max(...l) : mitte - Math.round(kb.left),
      nachRechts: r.length ? Math.min(...r) - mitte : Math.round(kb.right) - mitte,
      kreuzt: sicht.filter((x) => x.links < mitte && x.rechts > mitte).map((x) => x.was),
    }
  }
  return {
    kopf: { links: Math.round(kb.left), rechts: Math.round(kb.right), breite: Math.round(kb.width), hoehe: Math.round(kb.height) },
    polsterLinks: st.paddingLeft,
    kinder,
    schirmBreite: Math.round(document.documentElement.clientWidth),
    schirm: streifen(Math.round(document.documentElement.clientWidth / 2)),
    band: streifen(Math.round(kb.left + kb.width / 2)),
  }
})()`

const brw = await eigenerBrowser({ fenster: '800,480' }).catch((e) => {
  console.error(`  Browser kam nicht hoch — Messung nicht moeglich: ${e.message}`)
  process.exit(2)
})
if (!brw) {
  console.log('  kein Browser gefunden — uebersprungen')
  process.exit(0)
}

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

try {
  const ws = new WebSocket(await brw.seite())
  await new Promise((r) => ws.on('open', r))
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })
  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value

  await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
  await warte(2400)

  // ZWEI LAGEN, WEIL DER KOPF IN BEIDEN ANDERSWO ANFAENGT. Beim Blaettern
  // faehrt die Kategorienleiste ein (`body.platz-machen`), der Kopf beginnt
  // dann bei x 0 und bekommt dafuer ein groesseres `padding-left`. Nur eine
  // von beiden zu messen hiesse, die Haelfte der Zeit nicht zu wissen, wo die
  // Mitte auf welchen Nachbarn trifft.
  const LAGEN = [
    ['Leiste ausgefahren (Ruhe)', `document.body.classList.remove('platz-machen'), true`],
    ['Leiste eingefahren (blaettern)', `document.body.classList.add('platz-machen'), true`],
  ]

  const bandmitten = []
  for (const [name, stellen] of LAGEN) {
    await ev(stellen)
    await warte(500)
    const m = await ev(KOPF_JS)
    if (!m) {
      melde('.kopf steht gar nicht im Baum')
      break
    }
    bandmitten.push(m.band.mitte)
    console.log(`\n── ${name} ──────────────────────────────────`)
    zeile('Band', `x ${m.kopf.links}..${m.kopf.rechts} (${m.kopf.breite} px), Hoehe ${m.kopf.hoehe}`)
    zeile('Polster links', m.polsterLinks)
    for (const k of m.kinder) {
      zeile(`  ${k.was}`, k.sichtbar ? `x ${k.links}..${k.rechts} (${k.breite} px)` : 'verborgen')
    }

    // DIE ZAHL, AUF DIE ES ANKOMMT: um die Mitte des SCHIRMS. Dort will der
    // Betreiber Uhrzeit und Restzeit haben, und dort bleiben sie auch, wenn
    // die Leiste ein- und ausfaehrt.
    const frei = 2 * Math.min(m.schirm.nachLinks, m.schirm.nachRechts)
    zeile('Mitte des Schirms', `x ${m.schirm.mitte} (Schirm ${m.schirmBreite} px)`)
    if (m.schirm.kreuzt.length) melde(`${name}: ${m.schirm.kreuzt.join(', ')} steht auf der Schirmmitte`)
    zeile('freier Streifen um die Schirmmitte', `${frei} px  (links ${m.schirm.nachLinks}, rechts ${m.schirm.nachRechts})`)
    if (frei < MITTE_BRAUCHT) {
      melde(`${name}: nur ${frei} px um die Schirmmitte, Uhrzeit und Restzeit brauchen ${MITTE_BRAUCHT}`)
    }
    zeile('(Nebenzahl) Mitte des Bandes', `x ${m.band.mitte}`)
  }

  // DER SPRUNG. Wandert die Bandmitte zwischen den Lagen, ist `left: 50%` in
  // einem `position: relative`-Kopf die falsche Vorbereitung — die Uhr
  // spraenge beim Blaettern genau um diesen Betrag. Das ist kein Fehler DER
  // OBERFLAECHE, sondern eine Ansage an den naechsten Schritt: also eine
  // Zeile, die dasteht, und kein Abbruch.
  if (bandmitten.length === 2 && bandmitten[0] !== bandmitten[1]) {
    console.log(
      `\n  ACHTUNG fuer den naechsten Schritt: die Bandmitte wandert um ` +
        `${Math.abs(bandmitten[0] - bandmitten[1])} px (x ${bandmitten[0]} -> x ${bandmitten[1]}), ` +
        `die Schirmmitte nicht.\n` +
        `  Ein mittiges Kind gehoert deshalb an den SCHIRM (position: fixed, left: 50%,\n` +
        `  transform: translateX(-50%)) — so wie .zurueck es schon macht — und NICHT\n` +
        `  mit left: 50% in ein position: relative gesetztes .kopf. Sonst springt die Uhr\n` +
        `  bei jedem Blaettern.`,
    )
  }

  if (BILD) {
    await ev(`document.body.classList.remove('platz-machen'), true`)
    await warte(400)
    await mkdir(dirname(BILD), { recursive: true })
    const s = await send(ws, 'Page.captureScreenshot', { format: 'png' })
    await writeFile(BILD, Buffer.from(s.data, 'base64'))
    zeile('Bild abgelegt', BILD)
  }

  ws.close()
} finally {
  await brw.schliessen?.()
}

console.log(
  fehler === 0
    ? `\n  Um die Schirmmitte sind ${MITTE_BRAUCHT} px oder mehr frei — in beiden Lagen.\n  Uhrzeit und Restzeit koennen dort hin. GEBAUT SIND SIE NICHT; das ist der naechste Schritt.`
    : `\n  ${fehler} Befund(e).`,
)
process.exit(fehler === 0 ? 0 : 1)
