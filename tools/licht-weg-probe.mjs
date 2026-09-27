#!/usr/bin/env node
/**
 * TRAEGT DER SCHALTER IM ADMIN-MENUE HELL/DUNKEL WIRKLICH — ohne den Mond oben?
 *
 * ══ WOZU ═══════════════════════════════════════════════════════════════════
 *
 * Am 07.08.2026 ist der Mond aus der Kopfzeile geflogen. Der Betreiber: „was
 * wir auch rausnehmen könen ist hell dunkel aus dem band oben". Damit ist die
 * Zeile „Hell oder dunkel" auf der Seite Darstellung -> Farbe und Form der
 * EINZIGE Weg, die Oberflaeche dunkel zu bekommen.
 *
 * EIN EINZIGER WEG MUSS GEPRUEFT SEIN. Vorher gab es zwei, und der Kopfknopf
 * war der, den jeder benutzt hat — ein stiller Ausfall des zweiten waere
 * niemandem aufgefallen. Jetzt ist das Gegenteil der Fall: faellt DIESER
 * Schalter aus, ist die Oberflaeche dauerhaft hell und niemand kann etwas
 * dagegen tun. Ohne Werkzeug merkt man das erst am Geraet, abends.
 *
 * UND DER AUSFALL WAERE KEIN THEORETISCHER GEWESEN: `lichtSetzen()` hat bis
 * zu diesem Umbau IMMER `$('licht-knopf')` angefasst, um dessen Beschriftung
 * nachzuziehen. `$()` wirft, wenn es das Element nicht gibt. Haette man den
 * Knopf aus index.html genommen und sonst nichts, haette der Schalter im
 * Admin-Menue beim ERSTEN Tipp eine Ausnahme geworfen — data-licht waere
 * schon gesetzt gewesen, das Merken darunter aber nie gelaufen. Also: dunkel
 * bis zum Neuladen, danach wieder hell, und keine Fehlermeldung am Schirm.
 * Genau diesen Fall prueft Schritt 4 (gemerkt) und Schritt 6 (Neuladen).
 *
 * ══ WAS BEHAUPTET WIRD ═════════════════════════════════════════════════════
 *   1. DER WEG GEHT. Menue auf (Halten am Schriftzug bzw. Tastatur), Gruppe
 *      „Darstellung", Punkt „Farbe und Form" — und dort steht die Zeile.
 *   2. DER SCHALTER WIRKT. Nach dem Tipp traegt <html> data-licht="dunkel"
 *      UND die Flaechen haben eine ANDERE Farbe als vorher. Ein Schalter, der
 *      nur ein Attribut setzt und nichts umfaerbt, ist eine Attrappe — das
 *      prueft der Farbvergleich und nicht das Attribut.
 *   3. ER SAGT DIE WAHRHEIT. Zeichen und Wort der Zeile wechseln mit.
 *   4. ES WIRD GEMERKT. localStorage `mupibox_neu_licht_v1` steht auf 'dunkel'.
 *   5. KEINE AUSNAHME dabei. Jede geworfene Ausnahme und jeder Konsolenfehler
 *      waehrend des Umschaltens ist ein Fehlschlag.
 *   6. NEULADEN FAELLT NICHT INS HELLE ZURUECK. Nach `Page.navigate` steht
 *      data-licht sofort auf 'dunkel' (der Einzeiler im Dokumentkopf) und die
 *      Farben sind die dunklen.
 *   7. ZURUECK GEHT AUCH. Derselbe Schalter macht wieder hell — sonst waere
 *      der Weg eine Einbahnstrasse wie der Flugmodus am 06.08.2026.
 *
 * ══ WAS ES NICHT TUT ═══════════════════════════════════════════════════════
 * Es aendert keine Datei und faesst keine Box an. Eigener Browser gegen eine
 * Vorschau, deren Adresse ausdruecklich mitgegeben wird.
 *
 * ══ AUFRUF ═════════════════════════════════════════════════════════════════
 *   node tools/licht-weg-probe.mjs --ziel http://127.0.0.1:9401/neu/
 *   node tools/licht-weg-probe.mjs --ziel … --bilder /tmp/licht
 * ENDE 0, wenn der Weg traegt. ENDE 1, wenn nicht — dann darf der Mond nicht
 * aus der Kopfzeile.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import WebSocket from 'ws'
import { adminAuf } from './admin-weg.mjs'
import { LICHT_SCHLUESSEL, LICHT_TIPP_JS, LICHT_ZEILE_JS, lichtSeiteAuf } from './licht-weg.mjs'
import { eigenerBrowser } from './leihgabe.mjs'

const argv = process.argv.slice(2)
const opt = (n, v = null) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : v
}
const BEKANNT = ['ziel', 'bilder']
for (const a of argv) {
  if (!a.startsWith('--')) continue
  if (BEKANNT.includes(a.slice(2))) continue
  console.error(`${a} kennt dieses Werkzeug nicht. Bekannt: --ziel --bilder`)
  process.exit(2)
}

// KEINE VORGABEADRESSE, DIE STILL EINEN FREMDEN BAUM MISST. Der Vorgabeport
// 8299 ist auf diesem Rechner regelmaessig von einer fremden Sitzung besetzt;
// wer ihn ungefragt nimmt, misst deren Oberflaeche und nennt es sein Ergebnis
// ([[vorschau-wird-geliehen]]).
const ZIEL = opt('ziel')
if (!ZIEL) {
  console.error('Ohne --ziel wird nichts gemessen. Beispiel:\n  node tools/licht-weg-probe.mjs --ziel http://127.0.0.1:9401/neu/')
  process.exit(2)
}
const BILDER = opt('bilder')

const warte = (ms) => new Promise((r) => setTimeout(r, ms))

let fehler = 0
const soll = (was, ist, erwartet) => {
  const ok = JSON.stringify(ist) === JSON.stringify(erwartet)
  console.log(`  ${ok ? 'ok  ' : 'FEHL'} ${String(was).padEnd(46)} ${JSON.stringify(ist)}`)
  if (!ok) {
    fehler++
    console.error(`          erwartet: ${JSON.stringify(erwartet)}`)
  }
}
const anders = (was, a, b) => {
  const ok = JSON.stringify(a) !== JSON.stringify(b)
  console.log(`  ${ok ? 'ok  ' : 'FEHL'} ${String(was).padEnd(46)} ${JSON.stringify(a)} -> ${JSON.stringify(b)}`)
  if (!ok) {
    fehler++
    console.error('          erwartet: eine ANDERE Farbe. Gleich heisst: es wurde nichts umgefaerbt.')
  }
}

/**
 * DIE FARBEN, DIE WIRKLICH AUF DEM SCHIRM STEHEN.
 *
 * Nicht `--grund` aus dem Variablensatz, sondern das, was `getComputedStyle`
 * an den GEMALTEN Flaechen ausrechnet: eine Regel kann richtig geschrieben und
 * von einer spaeteren ueberschrieben sein (siehe tools/farben-am-schirm.mjs).
 * Drei Flaechen und nicht eine, weil hell/dunkel den ganzen Satz umstellt —
 * faerbte sich nur der Hintergrund um und die Schrift bliebe, waere das ein
 * Befund und keine gruene Zahl.
 *
 * DIE KARTE IST `.eltern-fach` und NICHT `#eltern-flaeche`. Letzteres ist nur
 * die Anordnung darum und durchsichtig — eine durchsichtige Flaeche ist in
 * beiden Staenden rgba(0,0,0,0), und die Zeile haette still gemeldet, es habe
 * sich nichts geaendert. Genau so ist sie beim ersten Lauf durchgefallen.
 *
 * KEIN GEGENHAKEN IM BLOCK DARUNTER: Er ist ein Template-String und geht so,
 * wie er dasteht, an den Browser. Ein Kommentar mit Gegenhaken schliesst ihn
 * mitten im Satz — das Werkzeug bricht dann beim Einlesen ab, nicht beim
 * Messen.
 */
const FARBEN_JS = `(() => {
  const g = (sel, prop) => {
    const e = document.querySelector(sel)
    return e ? getComputedStyle(e)[prop] : null
  }
  return {
    licht: document.documentElement.getAttribute('data-licht'),
    grund: g('body', 'backgroundColor'),
    tinte: g('body', 'color'),
    karte: g('.eltern-fach', 'backgroundColor'),
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
  await send(ws, 'Log.enable')

  // OHNE DAS MISST MAN EINEN SCHIRM, DEN ES NICHT GIBT: `--window-size` laesst
  // dem Sichtfenster weniger Hoehe als der Box.
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })

  // JEDE AUSNAHME WIRD MITGESCHRIEBEN. Der Fehler, den dieses Werkzeug fangen
  // soll, ist genau von dieser Sorte: eine geworfene Ausnahme MITTEN in
  // lichtSetzen, nach dem Setzen des Attributs und vor dem Merken.
  const lauteFehler = []
  ws.on('message', (r) => {
    const x = JSON.parse(r)
    if (x.method === 'Runtime.exceptionThrown') {
      const d = x.params.exceptionDetails
      lauteFehler.push(d.exception?.description || d.text)
    }
    if (x.method === 'Log.entryAdded' && x.params.entry.level === 'error') {
      lauteFehler.push(x.params.entry.text)
    }
  })

  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value
  const bild = async (name) => {
    if (!BILDER) return
    const p = `${BILDER}/${name}.png`
    await mkdir(dirname(p), { recursive: true })
    const s = await send(ws, 'Page.captureScreenshot', { format: 'png' })
    await writeFile(p, Buffer.from(s.data, 'base64'))
  }
  const laden = async () => {
    await send(ws, 'Page.navigate', { url: `${ZIEL}?frisch=${Date.now()}` })
    await warte(2200)
  }

  // ── Von einem BEKANNTEN Anfang aus: hell, nichts gemerkt ────────────────
  await laden()
  await ev(`(() => { try { localStorage.removeItem('${LICHT_SCHLUESSEL}') } catch (e) {} })()`)
  await laden()

  const hellVorher = await ev(FARBEN_JS)
  soll('Anfang ohne Gemerktes ist hell', hellVorher.licht, 'hell')

  // ── 1. DER WEG: Menue -> Darstellung -> Farbe und Form ──────────────────
  console.log('\n  DER WEG HINEIN')
  await adminAuf(ev)
  soll('Admin-Menue offen', await ev(`!document.getElementById('eltern').hidden`), true)

  const gruppen = await ev(`[...document.querySelectorAll('.fach-knopf')].map((k) => k.dataset.fach)`)
  soll('Gruppe „Darstellung" in der Spalte', gruppen.includes('anzeige'), true)
  // Die zwei Tipps liegen in tools/licht-weg.mjs und nicht hier — sie sind
  // derselbe Weg, den auch die Werkzeuge daneben gehen, wenn sie ihn brauchen.
  await lichtSeiteAuf(ev)
  const punkte = await ev(`[...document.querySelectorAll('#fach-zeilen .zeile-name')].map((e) => e.textContent)`)
  soll('Seite „Farbe und Form" aufgeschlagen', punkte.includes('Hell oder dunkel'), true)
  await bild('1-farbe-und-form-hell')

  // ── 2. DIE ZEILE STEHT DA ───────────────────────────────────────────────
  console.log('\n  DIE ZEILE')
  const zHell = await ev(LICHT_ZEILE_JS)
  soll('Zeile „Hell oder dunkel" vorhanden', zHell !== null, true)
  if (zHell === null) throw new Error('Ohne die Zeile gibt es nichts weiter zu messen — der Mond darf NICHT weg.')
  soll('sie steht zuoberst', zHell.erste, true)
  soll('Wort im hellen Stand', zHell.wort, 'Dunkel')
  // DER NAME AUS DER KARTE, NICHT DAS ZEICHEN SELBST: seit dem 07.08.2026 ist
  // das Zeichen ein SVG, weil die Box (nur DejaVu) kein Emoji zeichnen kann.
  // Zusaetzlich geprueft, dass wirklich ein SVG darin haengt — ein Name im
  // Datenfeld ohne Bild waere eine leere Scheibe, und die saehe aus wie Absicht.
  soll('Zeichen im hellen Stand', zHell.zeichen, 'sonne')
  soll('und es ist gezeichnet', zHell.zeichenGemalt, true)

  // ── 3. SIE WIRKT ────────────────────────────────────────────────────────
  console.log('\n  DER TIPP')
  const vorher = await ev(FARBEN_JS)
  lauteFehler.length = 0
  soll('der Knopf war da und wurde getippt', await ev(LICHT_TIPP_JS), 'getippt')
  await warte(500)
  await bild('2-farbe-und-form-dunkel')

  const nachher = await ev(FARBEN_JS)
  soll('data-licht steht auf dunkel', nachher.licht, 'dunkel')
  anders('Grundflaeche hat eine andere Farbe', vorher.grund, nachher.grund)
  anders('Tinte hat eine andere Farbe', vorher.tinte, nachher.tinte)
  anders('die Karte hat eine andere Farbe', vorher.karte, nachher.karte)

  const zDunkel = await ev(LICHT_ZEILE_JS)
  soll('Wort im dunklen Stand', zDunkel && zDunkel.wort, 'Hell')
  soll('Zeichen im dunklen Stand', zDunkel && zDunkel.zeichen, 'mond')
  soll('und es ist gezeichnet', zDunkel && zDunkel.zeichenGemalt, true)

  // ── 4./5. GEMERKT, UND OHNE AUSNAHME ────────────────────────────────────
  console.log('\n  GEMERKT UND LEISE')
  soll(`${LICHT_SCHLUESSEL} im Browser`, await ev(`localStorage.getItem('${LICHT_SCHLUESSEL}')`), 'dunkel')
  soll('keine Ausnahme beim Umschalten', lauteFehler, [])

  // ── 6. NEULADEN ─────────────────────────────────────────────────────────
  console.log('\n  NEULADEN')
  await laden()
  const nachNeu = await ev(FARBEN_JS)
  soll('data-licht nach dem Neuladen', nachNeu.licht, 'dunkel')
  soll('Grundflaeche nach dem Neuladen', nachNeu.grund, nachher.grund)
  await bild('3-nach-neuladen')

  // ── 7. UND WIEDER ZURUECK ───────────────────────────────────────────────
  console.log('\n  ZURUECK INS HELLE')
  await adminAuf(ev)
  await lichtSeiteAuf(ev)
  lauteFehler.length = 0
  soll('der Knopf war da und wurde getippt', await ev(LICHT_TIPP_JS), 'getippt')
  await warte(500)
  const zurueck = await ev(FARBEN_JS)
  soll('data-licht wieder hell', zurueck.licht, 'hell')
  soll('Grundflaeche wieder die helle', zurueck.grund, hellVorher.grund)
  soll(`${LICHT_SCHLUESSEL} wieder hell`, await ev(`localStorage.getItem('${LICHT_SCHLUESSEL}')`), 'hell')
  soll('keine Ausnahme beim Zurueckschalten', lauteFehler, [])

  ws.close()
} finally {
  await brw.schliessen?.()
}

console.log(
  fehler === 0
    ? '\n  Der Weg im Admin-Menue traegt hell/dunkel allein. Der Mond in der Kopfzeile ist entbehrlich.'
    : `\n  ${fehler} Befund(e). Solange sie stehen, ist der Mond in der Kopfzeile der einzige verlaessliche Weg — er bleibt.`,
)
process.exit(fehler === 0 ? 0 : 1)
